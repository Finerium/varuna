// Executor replay pause-persist — contracts.md Bagian 2 dan 3.
//
// Bentuk yang dituntut kontrak: "executor mem-pause run A0 pada tiap tool-call,
// mempersist state percakapan ke Blob, dan melanjutkan pada invokasi berikutnya.
// Satu invokasi HTTP = maksimum satu langkah tool." Mekanismenya bukan buatan
// sendiri: A1-A10 dipasang sebagai tool ber-`needsApproval`, sehingga runner
// @openai/agents berhenti SEBELUM tool dijalankan dan memulangkan RunState yang
// bisa diserialisasi. Satu invokasi = setujui satu tool tertunda, jalankan,
// biarkan A0 memilih tool berikutnya, lalu berhenti lagi. Itulah cara batas 300
// detik Vercel dipenuhi tanpa mengubah arsitektur agents-as-tools paper.
//
// Yang TIDAK dilakukan agen mana pun di berkas ini: menghitung status. PASHA
// dipanggil executor (server) dari artefak yang dikutip replay, sesuai Bagian 4.

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ModelBehaviorError,
  RunState,
  tool,
  type RunToolApprovalItem,
  type Tool,
} from "@openai/agents";
import { z } from "zod";

import { cekDiksi } from "@varuna/core/diksi";
import {
  artIdsPada,
  periksaEnvelope,
  resolverGrounding,
  type Resolver,
} from "@varuna/core/grounding";
import { computeStatus, type StatusServer } from "@varuna/core/pasha";
import {
  AgentEnvelopeSchema,
  InvIdSchema,
  type Artifact,
  type Investigation,
} from "@varuna/core/schemas";

import {
  ArgumenAlatSchema,
  DESKRIPSI_ALAT,
  ID_ALAT,
  buatA0,
  buatSubAgen,
  idDariNamaAlat,
  namaAlat,
  type IdAlat,
} from "./agen.ts";
import {
  SEED,
  TTL_DETIK,
  katalog,
  kunciDariRef,
  kunciJejak,
  kunciKeluaran,
  kunciState,
  masukanA0,
  masukanSubAgen,
  refState,
  type BarisKatalog,
  type MesinAgen,
} from "./mesin.ts";

/** A0 bisa memanggil sepuluh tool, masing-masing satu giliran, plus giliran
 *  penutup. Batas ini menahan lingkaran tak berujung, bukan mengatur alur. */
const MAX_GILIRAN = 24;

// ---------------------------------------------------------------------------
// resume_token (Bagian 3)
// ---------------------------------------------------------------------------

/** Lima field pertama adalah kontrak apa adanya. Dua terakhir aditif dan
 *  keduanya wajib: `expires_at` karena ttl tanpa jangkar waktu tidak bisa
 *  ditegakkan, `run_id` karena satu investigasi boleh diputar berkali-kali dan
 *  jejaknya tidak boleh tercampur. */
export const ResumeTokenSchema = z.object({
  inv_id: InvIdSchema,
  step_idx: z.number().int().min(0),
  state_ref: z.string().startsWith("blob://"),
  seed: z.literal(SEED),
  ttl_s: z.literal(TTL_DETIK),
  run_id: z.string().regex(/^[a-z0-9]{6,32}$/),
  expires_at: z.iso.datetime({ offset: true }),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ResumeToken = z.infer<typeof ResumeTokenSchema>;

/** Token adalah bearer yang bolak-balik lewat klien; tanpa tanda tangan, field
 *  mana pun (terutama state_ref) bisa diganti. HMAC atas JSON kanonis tujuh
 *  field non-sig; rahasia dari env, fallback nilai dev yang sama konvensinya
 *  dengan garam MMSI. */
const rahasiaToken = (): string =>
  process.env.RESUME_TOKEN_SECRET ?? process.env.MMSI_HASH_SALT ?? "varuna-dev-salt-2026";

const tandaTanganToken = (t: Omit<ResumeToken, "sig">): string =>
  createHmac("sha256", rahasiaToken())
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(t).sort(([a], [b]) => (a < b ? -1 : 1))),
      ),
    )
    .digest("hex");

const sigCocok = (t: ResumeToken): boolean => {
  const { sig, ...tanpa } = t;
  const a = Buffer.from(tandaTanganToken(tanpa), "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

// ---------------------------------------------------------------------------
// Peristiwa SSE (Bagian 3, event `agent_step`)
// ---------------------------------------------------------------------------

export type FaseAgen = "start" | "output" | "retry" | "discarded" | "done";

export type PeristiwaAgen = {
  agent: string;
  phase: FaseAgen;
  output_ref: string | null;
  trace_ref: string;
  diff: { status_sama: boolean; artefak_sama: boolean } | null;
  pasha: StatusServer | null;
};

export type Pemancar = (p: PeristiwaAgen) => void | Promise<void>;

export type HasilLangkah = {
  selesai: boolean;
  resume_token: ResumeToken | null;
  /** Agen yang akan dijalankan invokasi berikutnya; null bila run selesai. */
  agen_berikut: IdAlat | null;
  trace_ref: string;
  run_id: string;
  step_idx: number;
};

/** Kegagalan yang harus tampil sebagai keadaan jujur di klien, bukan sebagai
 *  langkah agen yang gagal. Dipakai route untuk membedakan "model menolak
 *  keluaran" (fase discarded, bagian sah dari cerita) dari "replay tidak bisa
 *  dilanjutkan sama sekali". */
export class GalatReplay extends Error {
  constructor(
    readonly sebab: "token" | "kedaluwarsa" | "state" | "investigasi",
    pesan: string,
  ) {
    super(pesan);
    this.name = "GalatReplay";
  }
}

// ---------------------------------------------------------------------------
// Konteks satu run
// ---------------------------------------------------------------------------

type Konteks = {
  inv: Investigation;
  artefak: Artifact[];
  baris: BarisKatalog[];
  resolver: Resolver;
  run_id: string;
  trace_ref: string;
  step_idx: number;
};

const acak = (): string => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

async function siapkan(
  m: MesinAgen,
  inv_id: string,
  run_id: string,
  step_idx: number,
): Promise<Konteks> {
  const inv = await m.sumber.investigasi(inv_id);
  if (inv === null) {
    throw new GalatReplay("investigasi", `Investigasi ${inv_id} tidak ada di Evidence Store.`);
  }
  const artefak = await m.sumber.artefak(inv_id);
  // Resolver grounding = union(indeks statis golden, indeks runtime append-only)
  // — architecture.md. Union, bukan fallback: artefak runtime (mis. laporan
  // patroli) sama sahnya dengan artefak golden.
  const resolver = resolverGrounding(
    await m.sumber.indeksStatis(),
    await m.sumber.indeksRuntime(inv_id),
  );
  return {
    inv,
    artefak,
    baris: katalog(artefak),
    resolver,
    run_id,
    trace_ref: kunciJejak(inv_id, run_id),
    step_idx,
  };
}

/** Satu pintu untuk memancarkan DAN mencatat: peristiwa yang tampil di klien
 *  wajib punya baris jejaknya, kalau tidak "dapat diulang" cuma klaim. */
function pencatat(m: MesinAgen, ktx: Konteks, emit: Pemancar) {
  return async (p: PeristiwaAgen, tambahan: Record<string, unknown> = {}): Promise<void> => {
    await m.store.append(ktx.trace_ref, {
      at: m.sekarang(),
      inv_id: ktx.inv.inv_id,
      run_id: ktx.run_id,
      step_idx: ktx.step_idx,
      seed: SEED,
      ...p,
      ...tambahan,
    });
    await emit(p);
  };
}

// ---------------------------------------------------------------------------
// Sub-agen sebagai tool: validasi -> tepat satu perbaikan -> dibuang
// ---------------------------------------------------------------------------

type Amplop = {
  agent: string;
  inv_id: string;
  output: Record<string, unknown>;
  artifacts_cited: string[];
  status: "ok" | "retry_fixed" | "discarded";
};

type Percobaan = { amplop: Amplop; salah: string | null; unresolved: string[] };

/** Tiga gerbang, urutannya sengaja: bentuk (skema kontrak), diksi (Bagian 7),
 *  lalu grounding (Bagian 1). Grounding terakhir karena ia yang memutuskan
 *  `discarded` pada level amplop. */
function periksa(id: IdAlat | "A0", inv_id: string, keluaran: unknown): Percobaan {
  const amplop: Amplop = {
    agent: id,
    inv_id,
    output: (keluaran ?? {}) as Record<string, unknown>,
    // Diturunkan dari output, bukan diminta terpisah ke model: dua daftar yang
    // bisa berbeda satu sama lain adalah lubang grounding.
    artifacts_cited: artIdsPada(keluaran),
    status: "ok",
  };

  const bentuk = AgentEnvelopeSchema.safeParse(amplop);
  if (!bentuk.success) {
    const rinci = bentuk.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return {
      amplop: { ...amplop, status: "discarded" },
      salah: `amplop gagal skema (${rinci})`,
      unresolved: [],
    };
  }

  const diksi = cekDiksi(JSON.stringify(keluaran));
  if (!diksi.ok) {
    return {
      amplop: { ...amplop, status: "discarded" },
      salah: `keluaran memuat kata putusan terlarang (${diksi.kata.join(", ")})`,
      unresolved: [],
    };
  }

  return { amplop, salah: null, unresolved: [] };
}

function periksaGrounding(percobaan: Percobaan, resolver: Resolver): Percobaan {
  if (percobaan.salah !== null) return percobaan;
  const { envelope, unresolved } = periksaEnvelope(percobaan.amplop, resolver);
  if (unresolved.length === 0) return percobaan;
  return {
    amplop: envelope as Amplop,
    salah: `art_id tidak resolvable pada indeks grounding (${unresolved.join(", ")})`,
    unresolved,
  };
}

/** Menjalankan satu sub-agen sampai tuntas: run pertama, dan bila keluarannya
 *  ditolak salah satu gerbang, TEPAT SATU run perbaikan (Bagian 2). Kegagalan
 *  transport (kunci API, kuota, jaringan) sengaja dilempar ulang — itu keadaan
 *  jujur milik route, bukan keluaran agen yang dibuang. */
async function jalankanSubAgen(
  m: MesinAgen,
  ktx: Konteks,
  id: IdAlat,
  fokus: string,
): Promise<{ amplop: Amplop; diperbaiki: boolean; catatan: string | null }> {
  const sub = buatSubAgen(id);

  const sekali = async (perbaikan?: string): Promise<Percobaan> => {
    try {
      const hasil = await m.runner.run(sub, masukanSubAgen(ktx.inv, ktx.baris, fokus, perbaikan), {
        maxTurns: 2,
      });
      return periksaGrounding(periksa(id, ktx.inv.inv_id, hasil.finalOutput), ktx.resolver);
    } catch (e) {
      if (!(e instanceof ModelBehaviorError)) throw e;
      return {
        amplop: {
          agent: id,
          inv_id: ktx.inv.inv_id,
          output: {},
          artifacts_cited: [],
          status: "discarded",
        },
        salah: `keluaran tidak memenuhi structured outputs (${e.message})`,
        unresolved: [],
      };
    }
  };

  const pertama = await sekali();
  if (pertama.salah === null) return { amplop: pertama.amplop, diperbaiki: false, catatan: null };

  const kedua = await sekali(
    `Keluaran pertamamu ditolak server: ${pertama.salah}. Perbaiki tepat sekali. Kutip hanya art_id yang ada di katalog dan patuhi skema keluaran.`,
  );
  if (kedua.salah === null) {
    return {
      amplop: { ...kedua.amplop, status: "retry_fixed" },
      diperbaiki: true,
      catatan: pertama.salah,
    };
  }
  return {
    amplop: { ...kedua.amplop, status: "discarded" },
    diperbaiki: true,
    catatan: `${pertama.salah}; setelah satu perbaikan: ${kedua.salah}`,
  };
}

function alatAgen(
  m: MesinAgen,
  ktx: Konteks,
  id: IdAlat,
  catat: ReturnType<typeof pencatat>,
): Tool<unknown> {
  return tool({
    name: namaAlat(id),
    description: DESKRIPSI_ALAT[id],
    parameters: ArgumenAlatSchema,
    // Titik pause. Tanpa ini seluruh rangkaian A1-A10 berjalan dalam satu
    // invokasi HTTP dan batas 300 detik jadi taruhan, bukan desain.
    needsApproval: true,
    execute: async ({ fokus }) => {
      await catat({
        agent: id,
        phase: "start",
        output_ref: null,
        trace_ref: ktx.trace_ref,
        diff: null,
        pasha: null,
      });

      const { amplop, diperbaiki, catatan } = await jalankanSubAgen(m, ktx, id, fokus);
      const output_ref = kunciKeluaran(ktx.inv.inv_id, ktx.run_id, ktx.step_idx, id);
      await m.store.append(output_ref, amplop);

      if (diperbaiki) {
        await catat(
          {
            agent: id,
            phase: "retry",
            output_ref,
            trace_ref: ktx.trace_ref,
            diff: null,
            pasha: null,
          },
          { catatan },
        );
      }
      await catat(
        {
          agent: id,
          phase: amplop.status === "discarded" ? "discarded" : "output",
          output_ref,
          trace_ref: ktx.trace_ref,
          diff: null,
          pasha: null,
        },
        { amplop, catatan },
      );

      // A0 menerima amplop apa adanya, termasuk yang discarded: kegagalan
      // grounding adalah bagian dari cerita yang harus dilihat orkestrator.
      return JSON.stringify(amplop);
    },
  });
}

// ---------------------------------------------------------------------------
// Langkah
// ---------------------------------------------------------------------------

const bangunA0 = (m: MesinAgen, ktx: Konteks, catat: ReturnType<typeof pencatat>) =>
  buatA0(ID_ALAT.map((id) => alatAgen(m, ktx, id, catat)));

type AgenA0 = ReturnType<typeof bangunA0>;

const namaTertunda = (i: RunToolApprovalItem): string | undefined =>
  i.name ?? ("name" in i.rawItem ? (i.rawItem.name as string) : undefined);

/** art_id yang benar-benar dikutip sepanjang run, dibaca kembali dari jejak.
 *  Jejak adalah satu-satunya ingatan lintas invokasi HTTP yang kita punya —
 *  proses berikutnya adalah proses lain. */
async function dikutipDariJejak(m: MesinAgen, ktx: Konteks): Promise<string[]> {
  const baris = await m.store.read(ktx.trace_ref).catch(() => []);
  const keluar = new Set<string>();
  for (const b of baris) {
    const rec = b as { amplop?: Amplop };
    if (rec.amplop === undefined || rec.amplop.status === "discarded") continue;
    for (const id of rec.amplop.artifacts_cited) keluar.add(id);
  }
  return [...keluar].sort();
}

const setaraSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

async function tutupRun(
  m: MesinAgen,
  ktx: Konteks,
  keluaranA0: unknown,
  catat: ReturnType<typeof pencatat>,
): Promise<HasilLangkah> {
  const percobaan = periksaGrounding(periksa("A0", ktx.inv.inv_id, keluaranA0), ktx.resolver);
  const output_ref = kunciKeluaran(ktx.inv.inv_id, ktx.run_id, ktx.step_idx, "A0");
  await m.store.append(output_ref, percobaan.amplop);

  const dikutip = await dikutipDariJejak(m, ktx);

  // PASHA di sini, bukan di dalam agen: server menghitung status dari artefak
  // yang DIPILIH replay, lalu membandingkannya dengan status tersimpan. Itulah
  // isi `diff` — apakah panggilan agen live mereproduksi hasil yang tercatat.
  const pasha = computeStatus(
    ktx.artefak.filter((a) => dikutip.includes(a.art_id)),
    m.sekarang(),
    m.thresholds,
  );
  const diff = {
    status_sama: pasha.status === ktx.inv.status_server.status,
    artefak_sama: setaraSet(dikutip, ktx.inv.artifacts),
  };

  await catat(
    {
      agent: "A0",
      phase: percobaan.salah === null ? "done" : "discarded",
      output_ref,
      trace_ref: ktx.trace_ref,
      diff,
      pasha,
    },
    { amplop: percobaan.amplop, dikutip, catatan: percobaan.salah },
  );

  return {
    selesai: true,
    resume_token: null,
    agen_berikut: null,
    trace_ref: ktx.trace_ref,
    run_id: ktx.run_id,
    step_idx: ktx.step_idx,
  };
}

/** `state` cukup dilihat sebagai sesuatu yang bisa diserialisasi: itu satu-
 *  satunya hal yang dibutuhkan jeda, dan generik RunState berbeda antara run
 *  yang dimulai dari string dan yang dilanjutkan dari state. */
async function jeda(
  m: MesinAgen,
  ktx: Konteks,
  state: { toString: () => string },
  tertunda: RunToolApprovalItem[],
): Promise<HasilLangkah> {
  const berikut = ktx.step_idx + 1;
  const kunci = kunciState(ktx.inv.inv_id, ktx.run_id, berikut);
  await m.store.append(kunci, {
    at: m.sekarang(),
    step_idx: berikut,
    seed: SEED,
    state: state.toString(),
  });

  const nama = namaTertunda(tertunda[0] as RunToolApprovalItem);
  const tanpaSig: Omit<ResumeToken, "sig"> = {
    inv_id: ktx.inv.inv_id,
    step_idx: berikut,
    state_ref: refState(kunci),
    seed: SEED,
    ttl_s: TTL_DETIK,
    run_id: ktx.run_id,
    expires_at: new Date(Date.parse(m.sekarang()) + TTL_DETIK * 1000).toISOString(),
  };
  return {
    selesai: false,
    resume_token: { ...tanpaSig, sig: tandaTanganToken(tanpaSig) },
    agen_berikut: nama === undefined ? null : idDariNamaAlat(nama),
    trace_ref: ktx.trace_ref,
    run_id: ktx.run_id,
    step_idx: berikut,
  };
}

/** POST /api/replay/{inv_id} — langkah 0: A0 dijalankan sampai permintaan tool
 *  pertamanya. Tidak ada tool yang dieksekusi pada langkah ini. */
export async function mulaiReplay(
  m: MesinAgen,
  inv_id: string,
  emit: Pemancar,
): Promise<HasilLangkah> {
  const run_id = (m.idRun ?? acak)();
  const ktx = await siapkan(m, inv_id, run_id, 0);
  const catat = pencatat(m, ktx, emit);

  await catat({
    agent: "A0",
    phase: "start",
    output_ref: null,
    trace_ref: ktx.trace_ref,
    diff: null,
    pasha: null,
  });

  const a0 = bangunA0(m, ktx, catat);
  const hasil = await m.runner.run(a0, masukanA0(ktx.inv, ktx.artefak.length, ktx.trace_ref), {
    maxTurns: MAX_GILIRAN,
  });

  const tertunda = hasil.interruptions;
  if (tertunda.length === 0) return tutupRun(m, ktx, hasil.finalOutput, catat);
  return jeda(m, ktx, hasil.state, tertunda);
}

/** POST /api/replay/{inv_id}/step — satu tool disetujui, dijalankan, lalu A0
 *  memilih langkah berikutnya dan run dijeda lagi. */
export async function lanjutkanReplay(
  m: MesinAgen,
  tokenMentah: unknown,
  emit: Pemancar,
): Promise<HasilLangkah> {
  const token = ResumeTokenSchema.safeParse(tokenMentah);
  if (!token.success) {
    throw new GalatReplay("token", "resume_token tidak sah atau bukan milik protokol replay ini.");
  }
  if (!sigCocok(token.data)) {
    throw new GalatReplay("token", "tanda tangan resume_token tidak cocok; token diubah atau berasal dari server lain.");
  }
  if (Date.parse(token.data.expires_at) <= Date.parse(m.sekarang())) {
    throw new GalatReplay(
      "kedaluwarsa",
      `resume_token melewati batas ${TTL_DETIK} detik; mulai replay dari awal.`,
    );
  }

  const ktx = await siapkan(m, token.data.inv_id, token.data.run_id, token.data.step_idx);
  const catat = pencatat(m, ktx, emit);
  const a0 = bangunA0(m, ktx, catat);

  const kunci = kunciDariRef(token.data.state_ref);
  const rekaman = kunci === null ? [] : await m.store.read(kunci).catch(() => []);
  const terakhir = rekaman.at(-1) as { state?: string } | undefined;
  if (terakhir?.state === undefined) {
    throw new GalatReplay("state", "State percakapan tidak ditemukan pada penyimpanan runtime.");
  }

  const state = await RunState.fromString<undefined, AgenA0>(a0, terakhir.state);
  const tertunda = state.getInterruptions();
  if (tertunda.length === 0) {
    throw new GalatReplay("state", "State yang dimuat tidak menunggu persetujuan tool mana pun.");
  }
  // SATU tool per invokasi, bahkan bila model meminta beberapa sekaligus:
  // sisanya tetap tertunda dan runner berhenti lagi tanpa memanggil model.
  state.approve(tertunda[0] as RunToolApprovalItem);

  const hasil = await m.runner.run(a0, state, { maxTurns: MAX_GILIRAN });
  const lagi = hasil.interruptions;
  if (lagi.length === 0) return tutupRun(m, ktx, hasil.finalOutput, catat);
  return jeda(m, ktx, hasil.state, lagi);
}

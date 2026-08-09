import { describe, expect, it } from "vitest";

import {
  GalatReplay,
  ResumeTokenSchema,
  lanjutkanReplay,
  mulaiReplay,
  type HasilLangkah,
  type PeristiwaAgen,
} from "../src/executor";
import { SEED, TTL_DETIK, kunciDariRef, kunciJejak, kunciKeluaran, kunciState } from "../src/mesin";
import {
  ART,
  INVESTIGASI_UJI,
  INV_ID,
  NOW,
  modelPalsu,
  mesinPalsu,
  sumberPalsu,
  teksMasukan,
  untukA0,
  type Balasan,
  type ModelPalsu,
} from "./palsu";

// ============================================================================
// Executor pause-persist — contracts.md Bagian 2 dan 3.
//
// Kontrak: "executor mem-pause run A0 pada tiap tool-call, mempersist state
// percakapan ke Blob, dan melanjutkan pada invokasi berikutnya. Satu invokasi
// HTTP = maksimum satu langkah tool."
//
// TANPA PANGGILAN API: Model, SumberBukti, dan RuntimeStore disuntik palsu
// (test/palsu.ts). Kode yang dieksekusi adalah kode produksi yang sama.
// ============================================================================

const jejak: string = kunciJejak(INV_ID, "uji001");

/** A0 memanggil A2 lalu A7, lalu menutup dengan ringkasan_ref = trace_ref. */
function naskahStandar(kutipan: string[] = [ART.deteksi]) {
  return (req: Parameters<Parameters<typeof modelPalsu>[0]>[0], n: number): Balasan => {
    if (untukA0(req)) {
      const teks = teksMasukan(req);
      if (!teks.includes("agen_a2")) return { alat: "agen_a2" };
      if (!teks.includes("agen_a7")) return { alat: "agen_a7" };
      return { jawab: { ringkasan_ref: jejak } };
    }
    const instruksi = req.systemInstructions ?? "";
    if (instruksi.includes("Kamu A2")) return { jawab: { detection_art_ids: kutipan } };
    if (instruksi.includes("Kamu A7")) {
      return {
        jawab: {
          sections: [
            { claim: "Deteksi berada di dalam zona yang dipersoalkan.", art_ids: kutipan },
          ],
        },
      };
    }
    throw new Error(`naskah tidak menyiapkan balasan untuk panggilan ke-${n}`);
  };
}

type Rekaman = {
  peristiwa: PeristiwaAgen[];
  model: ModelPalsu;
  mesin: ReturnType<typeof mesinPalsu>;
};

function siapkan(naskah: Parameters<typeof modelPalsu>[0]): Rekaman {
  const model = modelPalsu(naskah);
  return { peristiwa: [], model, mesin: mesinPalsu(model) };
}

const fase = (p: PeristiwaAgen[]): string[] => p.map((x) => `${x.agent}:${x.phase}`);

describe("mulaiReplay — langkah 0 berhenti sebelum tool pertama", () => {
  it("memulangkan resume_token sah dan belum menjalankan tool apa pun", async () => {
    const r = siapkan(naskahStandar());
    const hasil = await mulaiReplay(r.mesin, INV_ID, (p) => void r.peristiwa.push(p));

    expect(hasil.selesai).toBe(false);
    expect(hasil.agen_berikut).toBe("A2");
    expect(fase(r.peristiwa)).toEqual(["A0:start"]);

    const token = ResumeTokenSchema.parse(hasil.resume_token);
    expect(token).toMatchObject({
      inv_id: INV_ID,
      step_idx: 1,
      seed: SEED,
      ttl_s: TTL_DETIK,
      run_id: "uji001",
    });
    expect(token.state_ref).toBe(`blob://${kunciState(INV_ID, "uji001", 1)}`);
    expect(Date.parse(token.expires_at) - Date.parse(NOW)).toBe(TTL_DETIK * 1000);

    // State percakapan tersimpan; tidak ada satu pun amplop keluaran, karena
    // tidak ada tool yang dieksekusi pada langkah ini.
    expect(r.mesin.store.isi.get(kunciState(INV_ID, "uji001", 1))).toHaveLength(1);
    expect([...r.mesin.store.isi.keys()].filter((k) => k.includes("keluaran-"))).toEqual([]);
    expect(r.model.permintaan).toHaveLength(1);
  });

  it("menolak investigasi yang tidak ada di Evidence Store", async () => {
    const model = modelPalsu(() => ({ jawab: {} }));
    const mesin = mesinPalsu(model, { sumber: sumberPalsu({ investigasi: null }) });
    await expect(mulaiReplay(mesin, INV_ID, () => {})).rejects.toBeInstanceOf(GalatReplay);
    expect(model.permintaan).toHaveLength(0);
  });
});

describe("lanjutkanReplay — satu invokasi, satu langkah agen", () => {
  it("menjalankan tepat satu tool lalu berhenti lagi", async () => {
    const r = siapkan(naskahStandar());
    const awal = await mulaiReplay(r.mesin, INV_ID, () => {});

    const hasil = await lanjutkanReplay(
      r.mesin,
      awal.resume_token,
      (p) => void r.peristiwa.push(p),
    );

    expect(fase(r.peristiwa)).toEqual(["A2:start", "A2:output"]);
    expect(hasil.selesai).toBe(false);
    expect(hasil.agen_berikut).toBe("A7");
    expect(ResumeTokenSchema.parse(hasil.resume_token).step_idx).toBe(2);

    const amplop = r.mesin.store.isi.get(kunciKeluaran(INV_ID, "uji001", 1, "A2"));
    expect(amplop).toEqual([
      {
        agent: "A2",
        inv_id: INV_ID,
        output: { detection_art_ids: [ART.deteksi] },
        artifacts_cited: [ART.deteksi],
        status: "ok",
      },
    ]);
  });

  it("menjalankan satu tool saja walau model meminta dua sekaligus", async () => {
    const r = siapkan((req) => {
      if (untukA0(req)) {
        const teks = teksMasukan(req);
        if (!teks.includes("agen_a2")) return { alatJamak: ["agen_a2", "agen_a3"] };
        return { jawab: { ringkasan_ref: jejak } };
      }
      const instruksi = req.systemInstructions ?? "";
      if (instruksi.includes("Kamu A2")) return { jawab: { detection_art_ids: [ART.deteksi] } };
      return { jawab: { anomaly_art_ids: [ART.gap] } };
    });

    const awal = await mulaiReplay(r.mesin, INV_ID, () => {});
    const langkah1 = await lanjutkanReplay(
      r.mesin,
      awal.resume_token,
      (p) => void r.peristiwa.push(p),
    );

    expect(fase(r.peristiwa)).toEqual(["A2:start", "A2:output"]);
    expect(langkah1.selesai).toBe(false);
    expect(langkah1.agen_berikut).toBe("A3");
  });

  it("menutup run dengan pasha dan diff dari server saat A0 selesai", async () => {
    const r = siapkan(naskahStandar());
    let token: unknown = (await mulaiReplay(r.mesin, INV_ID, () => {})).resume_token;
    let hasil: HasilLangkah | null = null;

    for (let i = 0; i < 5 && token !== null; i++) {
      hasil = await lanjutkanReplay(r.mesin, token, (p) => void r.peristiwa.push(p));
      token = hasil.resume_token;
    }

    expect(hasil?.selesai).toBe(true);
    expect(fase(r.peristiwa)).toEqual([
      "A2:start",
      "A2:output",
      "A7:start",
      "A7:output",
      "A0:done",
    ]);

    const done = r.peristiwa.at(-1) as PeristiwaAgen;
    expect(done.trace_ref).toBe(jejak);
    // Status datang dari server (computeStatus), bukan dari agen mana pun.
    expect(done.pasha?.status).toBe("terindikasi");
    expect(done.pasha?.sensors_independent).toBe(1);
    // Replay hanya mengutip deteksi; investigasi tersimpan berdiri di atas
    // empat artefak. diff harus mengatakan itu apa adanya.
    expect(done.diff).toEqual({ status_sama: false, artefak_sama: false });
    expect(INVESTIGASI_UJI.status_server.status).toBe("terkonfirmasi");
  });

  it("melaporkan diff sama ketika replay mengutip seluruh artefak tersimpan", async () => {
    const r = siapkan(naskahStandar([ART.deteksi, ART.gap, ART.kinematik, ART.zona]));
    let token: unknown = (await mulaiReplay(r.mesin, INV_ID, () => {})).resume_token;
    let hasil: HasilLangkah | null = null;

    for (let i = 0; i < 5 && token !== null; i++) {
      hasil = await lanjutkanReplay(r.mesin, token, (p) => void r.peristiwa.push(p));
      token = hasil.resume_token;
    }

    expect(hasil?.selesai).toBe(true);
    const done = r.peristiwa.at(-1) as PeristiwaAgen;
    expect(done.pasha?.status).toBe("terkonfirmasi");
    expect(done.diff).toEqual({ status_sama: true, artefak_sama: true });
  });
});

describe("resume_token — penjaga batas kepercayaan", () => {
  const tokenSah = async () => {
    const r = siapkan(naskahStandar());
    const awal = await mulaiReplay(r.mesin, INV_ID, () => {});
    return { r, token: ResumeTokenSchema.parse(awal.resume_token) };
  };

  it("menolak token kedaluwarsa (ttl 900 detik)", async () => {
    // Jam dimajukan, token utuh: tanda tangan tetap sah, yang gugur murni TTL.
    const { r, token } = await tokenSah();
    (r.mesin as { sekarang: () => string }).sekarang = () =>
      new Date(Date.parse(token.expires_at) + 1000).toISOString();
    await expect(lanjutkanReplay(r.mesin, token, () => {})).rejects.toMatchObject({
      sebab: "kedaluwarsa",
    });
  });

  it("menolak token dengan seed, ttl, atau state_ref yang bukan milik protokol", async () => {
    const { r, token } = await tokenSah();
    for (const cacat of [
      { ...token, seed: 1 },
      { ...token, ttl_s: 60 },
      { ...token, state_ref: "https://contoh/state.json" },
      { ...token, inv_id: "bukan-inv" },
      { ...token, step_idx: -1 },
      {},
      null,
    ]) {
      await expect(lanjutkanReplay(r.mesin, cacat, () => {})).rejects.toMatchObject({
        sebab: "token",
      });
    }
  });

  it("menolak token yang state-nya tidak ada di penyimpanan runtime", async () => {
    const { r, token } = await tokenSah();
    r.mesin.store.isi.clear();
    await expect(lanjutkanReplay(r.mesin, token, () => {})).rejects.toMatchObject({
      sebab: "state",
    });
  });
});

describe("determinisme seed 20260809", () => {
  it("menyuntikkan seed dan katalog terurut ke setiap sub-agen", async () => {
    const r = siapkan(naskahStandar());
    const awal = await mulaiReplay(r.mesin, INV_ID, () => {});
    await lanjutkanReplay(r.mesin, awal.resume_token, () => {});

    const kePelaksana = r.model.permintaan.filter((q) => !untukA0(q));
    expect(kePelaksana).toHaveLength(1);
    const masukan = teksMasukan(kePelaksana[0]!);
    expect(masukan).toContain(`Seed determinisme ${SEED}`);

    // Masukan sudah jadi item percakapan, jadi tanda kutip katalog ikut ter-escape;
    // yang diperiksa di sini urutan kemunculan art_id-nya, bukan bentuk JSON-nya.
    const posisi = ART_TERURUT.map((id) => masukan.indexOf(id));
    expect(posisi.every((p) => p >= 0)).toBe(true);
    expect([...posisi].sort((a, b) => a - b)).toEqual(posisi);
  });

  it("menolak resume_token yang tanda tangannya dirusak", async () => {
    const r = siapkan(naskahStandar());
    const awal = await mulaiReplay(r.mesin, INV_ID, () => {});
    const rusak = {
      ...(awal.resume_token as Record<string, unknown>),
      state_ref: "blob://runtime/lain/state.jsonl",
    };
    await expect(lanjutkanReplay(r.mesin, rusak, () => {})).rejects.toMatchObject({
      sebab: "token",
    });
  });

  it("menolak state_ref traversal path meski tanda tangan dibuat ulang", async () => {
    // kunciDariRef adalah gerbangnya: ".." tidak pernah jadi kunci store.
    expect(kunciDariRef("blob://../../etc/passwd")).toBeNull();
    expect(kunciDariRef("blob:///etc/passwd")).toBeNull();
    expect(kunciDariRef("blob://runtime/inv/..%2F")).toBeNull();
    expect(kunciDariRef("blob://runtime/inv-x/state.jsonl")).toBe("runtime/inv-x/state.jsonl");
  });

  it("menulis jejak dan state di bawah run_id yang sama", async () => {
    const r = siapkan(naskahStandar());
    const awal = await mulaiReplay(r.mesin, INV_ID, () => {});
    await lanjutkanReplay(r.mesin, awal.resume_token, () => {});

    const kunci = [...r.mesin.store.isi.keys()];
    expect(kunci).toContain(jejak);
    expect(kunci.every((k) => k.startsWith(`runtime/${INV_ID}/`))).toBe(true);
    const barisJejak = r.mesin.store.isi.get(jejak) as Array<{ seed: number; run_id: string }>;
    expect(barisJejak.every((b) => b.seed === SEED && b.run_id === "uji001")).toBe(true);
  });
});

/** Katalog diurutkan leksikografis art_id (mesin.ts, katalog()). */
const ART_TERURUT = [ART.deteksi, ART.gap, ART.kinematik, ART.zona].sort();

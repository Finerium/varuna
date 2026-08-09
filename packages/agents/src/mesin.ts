// Mesin agen: port ke dunia luar + katalog bukti deterministik.
//
// Paket ini tidak tahu apa-apa tentang Next, Blob, atau filesystem. Semua yang
// menyentuh dunia luar masuk lewat dua port di bawah (SumberBukti, RuntimeStore)
// dan satu Runner. Itu pula yang membuat suite unit bisa hijau tanpa satu pun
// panggilan API: tesnya menyuntik port palsu dan Model palsu, sementara jalur
// live memakai port sungguhan — kode produksinya sama persis, bukan cabang tes.

import { Runner, type Model } from "@openai/agents";

import type { Thresholds } from "@varuna/core/pasha";
import type { Artifact, Investigation } from "@varuna/core/schemas";
// Tipe saja: store.ts membaca akar golden lewat import.meta.url dan bundler
// server Next menolak jejak itu (lihat apps/web/lib/gudang.ts). `import type`
// terhapus saat transpile, jadi antarmukanya tetap satu tanpa menyeret modulnya.
import type { RuntimeStore } from "@varuna/core/store";

/** Seed global (contracts.md Bagian 1, Investigation.seed). */
export const SEED = 20260809;

/** contracts.md Bagian 3: resume_token.ttl_s. */
export const TTL_DETIK = 900;

/** Evidence Store dari sudut agen: baca saja, dan hanya investigasi ini. */
export type SumberBukti = {
  investigasi(inv_id: string): Promise<Investigation | null>;
  artefak(inv_id: string): Promise<Artifact[]>;
  /** Indeks grounding statis golden (union seluruh investigasi). */
  indeksStatis(): Promise<string[]>;
  /** Indeks grounding runtime append-only untuk investigasi ini. */
  indeksRuntime(inv_id: string): Promise<string[]>;
};

export type MesinAgen = {
  sumber: SumberBukti;
  /** Persistensi state percakapan, amplop, dan jejak (append-only). */
  store: RuntimeStore;
  runner: Runner;
  /** Ambang PASHA, DI-SEED dari experiments/e5/thresholds.lock.json oleh
   *  pemanggil — paket agen tidak boleh punya salinan angkanya sendiri. */
  thresholds: Thresholds;
  sekarang: () => string;
  /** Pembuat run_id; disuntik supaya replay di tes punya id yang tetap. */
  idRun?: () => string;
};

// ---------------------------------------------------------------------------
// Kunci penyimpanan runtime (contracts.md Bagian 1, "runtime/<inv_id>/...")
// ---------------------------------------------------------------------------

export const kunciState = (inv_id: string, run_id: string, langkah: number): string =>
  `runtime/${inv_id}/replay/${run_id}/state-${langkah}.jsonl`;

export const kunciKeluaran = (
  inv_id: string,
  run_id: string,
  langkah: number,
  agen: string,
): string => `runtime/${inv_id}/replay/${run_id}/keluaran-${langkah}-${agen}.jsonl`;

/** Jejak replay runtime. Ruang nama terpisah dari jejak golden statis
 *  (`investigations/<inv_id>/trace/replay-<n>.jsonl`, Bagian 1) karena run
 *  runtime tidak punya nomor urut yang stabil lintas instansi. */
export const kunciJejak = (inv_id: string, run_id: string): string =>
  `runtime/${inv_id}/trace/replay-${run_id}.jsonl`;

/** state_ref pada resume_token berbentuk "blob://<kunci>" (Bagian 3). Skema
 *  "blob" adalah nama LOGIS penyimpanan runtime; adapter yang memutuskan itu
 *  Vercel Blob atau filesystem dev. */
export const refState = (kunci: string): string => `blob://${kunci}`;

export const kunciDariRef = (ref: string): string | null =>
  ref.startsWith("blob://") ? ref.slice("blob://".length) : null;

// ---------------------------------------------------------------------------
// Katalog bukti
// ---------------------------------------------------------------------------

export type BarisKatalog = {
  art_id: string;
  type: string;
  dataset: string;
  observed_at: string | null;
  ringkas: Record<string, unknown>;
};

/** Lintasan AIS bisa membawa ribuan fix; mengirim semuanya ke model mahal dan
 *  tidak menambah keputusan apa pun. Yang dipakai agen adalah bentuk lintasan,
 *  bukan tiap fix-nya. */
function ringkasPayload(a: Artifact): Record<string, unknown> {
  if (a.type !== "ais_track_segment") return a.payload as Record<string, unknown>;
  const { points, ...sisa } = a.payload;
  const awal = points[0];
  const akhir = points[points.length - 1];
  return {
    ...sisa,
    jumlah_fix: points.length,
    fix_awal: awal === undefined ? null : { t: awal.t, lat: awal.lat, lon: awal.lon },
    fix_akhir: akhir === undefined ? null : { t: akhir.t, lat: akhir.lat, lon: akhir.lon },
  };
}

/** Terurut art_id: dua replay dengan seed sama melihat katalog yang identik,
 *  sampai ke urutan barisnya. */
export function katalog(artefak: readonly Artifact[]): BarisKatalog[] {
  return [...artefak]
    .sort((x, y) => x.art_id.localeCompare(y.art_id))
    .map((a) => ({
      art_id: a.art_id,
      type: a.type,
      dataset: a.source.dataset,
      observed_at: a.observed_at ?? null,
      ringkas: ringkasPayload(a),
    }));
}

/** Masukan sub-agen: perintah fokus dari A0 + katalog yang sama untuk semua.
 *  Katalog datang dari server, bukan dari argumen model. */
export function masukanSubAgen(
  inv: Investigation,
  baris: readonly BarisKatalog[],
  fokus: string,
  perbaikan?: string,
): string {
  const bagian = [
    `INVESTIGASI ${inv.inv_id} — AOI ${inv.aoi}, zona ${inv.zona ?? "tidak ditetapkan"}, kasus ${inv.kasus.label}.`,
    `Akuisisi ${inv.t_acquisition}; observasi terakhir ${inv.t_observasi_terakhir}.`,
    `Kandidat: ${inv.candidate.lat.toFixed(4)} lintang, ${inv.candidate.lon.toFixed(4)} bujur.`,
    `Seed determinisme ${SEED}: urutkan setiap daftar art_id secara leksikografis.`,
    `FOKUS DARI A0: ${fokus}`,
    `KATALOG ARTEFAK (${baris.length} artefak; hanya art_id di sini yang boleh dikutip):`,
    JSON.stringify(baris),
  ];
  if (perbaikan !== undefined) bagian.push(`PERBAIKAN WAJIB: ${perbaikan}`);
  return bagian.join("\n");
}

/** Masukan A0. trace_ref diberikan supaya A0 bisa memulangkannya sebagai
 *  ringkasan_ref — rujukan jejak, bukan rencana naratif (Bagian 2). */
export function masukanA0(inv: Investigation, jumlahArtefak: number, trace_ref: string): string {
  return [
    `Investigasi ${inv.inv_id}: AOI ${inv.aoi}, zona ${inv.zona ?? "tidak ditetapkan"}, kasus ${inv.kasus.label}.`,
    `Evidence Store memuat ${jumlahArtefak} artefak untuk investigasi ini; agen spesialis yang membacanya, bukan kamu.`,
    `Seed determinisme ${SEED}.`,
    `trace_ref = ${trace_ref}. Kembalikan nilai ini persis sebagai ringkasan_ref setelah rangkaian tool selesai.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Model bawaan. Non-reasoning dan bersuhu — dua syarat agar temperature 0
 *  bermakna; ganti lewat env kalau armada model bergeser.
 *  ponytail: kalau VARUNA_MODEL diarahkan ke model reasoning, buang temperature
 *  di sini (API menolaknya). */
export const modelBawaan = (): string => process.env.VARUNA_MODEL ?? "gpt-4.1-mini";

/** Satu Runner untuk A0 dan seluruh sub-agen. tracingDisabled: jejak yang
 *  mengikat sudah kita tulis sendiri ke Evidence Store runtime, dan bukti tidak
 *  perlu dikirim ke pihak ketiga untuk itu. */
export function runnerVaruna(model?: string | Model): Runner {
  return new Runner({
    model: model ?? modelBawaan(),
    modelSettings: { temperature: 0, topP: 1 },
    tracingDisabled: true,
  });
}

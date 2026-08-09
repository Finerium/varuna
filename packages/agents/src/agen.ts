// Definisi agen A0-A10 — contracts.md Bagian 2.
//
// Bentuk eksekusi (keputusan v2 kontrak, dipertahankan dari paper): A0 adalah
// SATU-SATUNYA agen yang dipanggil executor; A1-A10 adalah agen yang dipasang
// sebagai TOOL milik A0 (agents-as-tools). Pembungkusnya hidup di executor.ts
// karena satu panggilan tool bukan cuma "jalankan sub-agen": ia juga memvalidasi
// amplop, memberi tepat satu kesempatan perbaikan, melewatkan grounding dan
// diksi, lalu menulis jejak. `Agent.asTool()` tidak dipakai justru karena
// perbaikan itu menuntut RUN KEDUA, sesuatu yang `customOutputExtractor` (yang
// hanya menerima hasil run pertama) tidak bisa lakukan.
//
// Dua lapis skema, sengaja:
// - SKEMA_KELUARAN (di sini) = skema yang DILIHAT MODEL. Ia harus tetap di
//   dalam subset JSON Schema yang diterima structured outputs ketat: objek,
//   string, angka, boolean, enum, array, nullable. TANPA regex, TANPA min/max,
//   TANPA tuple, TANPA record.
// - Skema kontrak (packages/core/src/schemas.ts, mis. ArtIdSchema yang ber-regex
//   dan TargetPackageDraftSchema yang bertuple) dipakai SERVER untuk memvalidasi
//   apa yang model kembalikan. Pemisahan ini yang membuat "gagal validasi ->
//   tepat 1 perbaikan -> dibuang" punya arti.
//
// Tidak ada agen yang menghitung status: computeStatus milik server (Bagian 4).

import { Agent, type Tool } from "@openai/agents";
import { z } from "zod";

export const ID_AGEN = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"] as const;
export type IdAgen = (typeof ID_AGEN)[number];

/** A1-A10: yang dipasang sebagai tool. A0 tidak memanggil dirinya sendiri. */
export const ID_ALAT = ID_AGEN.filter((a) => a !== "A0") as Exclude<IdAgen, "A0">[];
export type IdAlat = (typeof ID_ALAT)[number];

/** Nama tool yang dilihat model: ^[a-zA-Z0-9_-]+$. */
export const namaAlat = (id: IdAlat): string => `agen_${id.toLowerCase()}`;

export const idDariNamaAlat = (nama: string): IdAlat | null =>
  ID_ALAT.find((id) => namaAlat(id) === nama) ?? null;

/** Argumen tool yang boleh diisi model. Bukti TIDAK lewat sini — katalog
 *  artefak disuntikkan server saat sub-agen dijalankan, sehingga model tidak
 *  punya jalan mengarang isi bukti lewat argumen. */
export const ArgumenAlatSchema = z.object({
  fokus: z.string().describe("Satu kalimat: apa yang perlu diperiksa agen ini."),
});

// ---------------------------------------------------------------------------
// Skema keluaran per agen (Bagian 2, "output per agen")
// ---------------------------------------------------------------------------

const artIds = (ket: string) => z.array(z.string()).describe(ket);

export const SKEMA_KELUARAN = {
  // "urutan tool tampak di trace, bukan plan tekstual" — karena itu A0 hanya
  // memulangkan rujukan jejak, tanpa ringkasan naratif.
  A0: z.object({ ringkasan_ref: z.string() }),
  A1: z.object({
    scenes: z.array(z.object({ scene_id: z.string(), t_acq: z.string(), sumber: z.string() })),
  }),
  A2: z.object({ detection_art_ids: artIds("art_id sar_detection terpilih") }),
  A3: z.object({ anomaly_art_ids: artIds("art_id ais_gap/ais_anomaly terpilih") }),
  A4: z.object({
    assoc_art_ids: artIds("art_id assoc_result"),
    dark_art_ids: artIds("art_id assoc_result dengan dark=true"),
  }),
  // Nullable, bukan wajib: investigasi tanpa artefak behavior_class tidak boleh
  // memaksa model mengarang satu art_id supaya skemanya terisi.
  A5: z.object({ behavior_art_id: z.string().nullable() }),
  A6: z.object({
    supporting_art_ids: artIds("art_id yang menguatkan"),
    conflicting_art_ids: artIds("art_id yang bertentangan"),
  }),
  A7: z.object({
    sections: z.array(z.object({ claim: z.string(), art_ids: artIds("art_id pendukung klaim") })),
  }),
  A8: z.object({
    verdict: z.enum(["lolos", "revisi"]),
    violations: z.array(z.object({ idx: z.number(), alasan: z.string() })),
  }),
  // TargetPackageDraft versi yang-dilihat-model: heading_sector_deg tuple
  // kontrak diturunkan jadi array angka karena structured outputs ketat tidak
  // menerima prefixItems. Server memvalidasi ulang dengan skema kontrak.
  A9: z.object({
    usulan_paket: z.object({
      area: z.object({
        center: z.object({ lat: z.number(), lon: z.number() }),
        radius_km: z.number(),
        heading_sector_deg: z.array(z.number()).nullable(),
        zona_clip: z.enum(["ZEE-ID", "WPP-711-proxy"]),
      }),
      berkas_ringkas_ref: z.string(),
    }),
  }),
  A10: z.object({
    updates: z.array(
      z.object({
        param: z.string(),
        lama: z.number(),
        baru: z.number(),
        basis_art_ids: artIds("art_id dasar usulan kalibrasi"),
      }),
    ),
  }),
} as const satisfies Record<IdAgen, z.ZodObject>;

// ---------------------------------------------------------------------------
// Instruksi
// ---------------------------------------------------------------------------

/** Aturan yang berlaku untuk SEMUA sub-agen. Ditulis sekali; pelanggarannya
 *  ditangkap server (grounding + diksi), bukan dipercayakan pada kepatuhan. */
const ATURAN_BERSAMA = [
  "Kamu bekerja pada satu investigasi maritim. Seluruh bukti yang boleh kamu sebut ada di KATALOG ARTEFAK pada masukan.",
  "Kutip artefak HANYA dengan art_id yang benar-benar tertulis di katalog. art_id yang tidak ada di katalog membuat seluruh keluaranmu dibuang server.",
  "Jangan mengarang artefak, angka, atau kejadian yang tidak ada di katalog. Kalau bukti tidak cukup, kembalikan daftar kosong.",
  "Jangan menyimpulkan status investigasi (terkonfirmasi/terindikasi/ABSTAIN). Status dihitung server, bukan olehmu.",
  "Bahasa Indonesia. Nada deskriptif, bukan putusan: dilarang memakai kata bersalah, terbukti, vonis, pidana, pelaku, kriminal, hukuman, dakwaan, terdakwa, tersangka.",
].join(" ");

const TUGAS: Record<IdAlat, string> = {
  A1: "Kamu A1, penyiap akuisisi. Daftarkan scene SAR yang relevan dari katalog: scene_id, waktu akuisisi (t_acq), dan sumber datasetnya. Ambil nilainya apa adanya dari katalog.",
  A2: "Kamu A2, pemilih deteksi. Pilih art_id bertipe sar_detection yang relevan dengan kandidat investigasi. Kamu MEMILIH artefak T1 yang sudah ada; kamu tidak mencipta deteksi baru.",
  A3: "Kamu A3, pemeriksa anomali AIS. Pilih art_id bertipe ais_gap atau ais_anomaly yang relevan.",
  A4: "Kamu A4, pengasosiasi. Pilih art_id bertipe assoc_result; masukkan ke dark_art_ids yang payload-nya dark=true (deteksi tanpa pasangan lintasan).",
  A5: "Kamu A5, pengelas perilaku. Pilih satu art_id bertipe behavior_class yang paling relevan, atau null bila tidak ada di katalog.",
  A6: "Kamu A6, pemeriksa silang. Pisahkan artefak yang saling menguatkan dari yang saling bertentangan pada jendela waktu yang sama.",
  A7: "Kamu A7, penyusun berkas. Tulis klaim-klaim pendek berbahasa Indonesia; setiap klaim WAJIB membawa art_id pendukungnya. Satu klaim tanpa artefak pendukung membuat berkas ditolak.",
  A8: "Kamu A8, pemeriksa diksi dan dukungan. Nilai bagian berkas dari A7: verdict 'lolos' bila setiap klaim didukung artefak dan bebas kata putusan, 'revisi' bila tidak. Sebut idx bagian yang bermasalah beserta alasannya.",
  A9: "Kamu A9, penyusun usulan paket target. Usulkan AREA PENCARIAN (pusat, radius km, sektor haluan bila diketahui), bukan posisi pasti. Server yang mencetak paket resmi beserta masa berlakunya.",
  A10: "Kamu A10, pengusul kalibrasi. Usulkan perubahan parameter ambang HANYA bila hasil pemeriksaan di katalog mendasarinya; kalau tidak, kembalikan daftar kosong.",
};

export const DESKRIPSI_ALAT: Record<IdAlat, string> = {
  A1: "A1 — daftar scene SAR yang relevan untuk investigasi ini.",
  A2: "A2 — pilih artefak deteksi SAR yang relevan.",
  A3: "A3 — pilih artefak anomali AIS (gap, spoofing, ganti identitas).",
  A4: "A4 — asosiasi deteksi dengan lintasan AIS, termasuk yang gelap.",
  A5: "A5 — kelas perilaku (fishing/transit) untuk kandidat.",
  A6: "A6 — pemeriksaan silang: artefak yang menguatkan versus yang bertentangan.",
  A7: "A7 — susun bagian berkas: klaim beserta art_id pendukungnya.",
  A8: "A8 — periksa berkas A7 terhadap diksi dan dukungan artefak.",
  A9: "A9 — usulkan area pencarian untuk paket target patroli.",
  A10: "A10 — usulkan delta kalibrasi ambang berdasarkan hasil pemeriksaan.",
};

const INSTRUKSI_A0 = [
  "Kamu A0, orkestrator investigasi maritim VARUNA.",
  "Kamu tidak membaca bukti sendiri dan tidak menyimpulkan status: kamu memanggil agen spesialis A1-A10 sebagai tool, satu per satu, dalam urutan yang masuk akal untuk kasus ini (umumnya A1 lalu A2 lalu A3, A4, A5, A6, kemudian A7 dan A8; A9 hanya bila berkas layak ditindaklanjuti patroli; A10 hanya bila ada dasar kalibrasi).",
  "Panggil SATU tool per giliran dan tunggu hasilnya. Setiap hasil kembali sebagai amplop JSON berisi status: 'ok', 'retry_fixed', atau 'discarded'.",
  "Amplop 'discarded' berarti keluaran agen itu ditolak server (biasanya mengutip art_id yang tidak resolvable). Jangan memakai isinya dan jangan mengulang tool yang sama lebih dari sekali; lanjutkan dengan bukti yang sah atau hentikan rangkaian.",
  "Status investigasi (terkonfirmasi/terindikasi/ABSTAIN) dihitung server dari artefak, bukan olehmu. Jangan menyebutnya.",
  "Setelah rangkaian selesai, kembalikan ringkasan_ref yang persis sama dengan trace_ref pada masukanmu. Urutan tool sudah terekam di jejak; jangan menulis rencana naratif.",
].join(" ");

// ---------------------------------------------------------------------------
// Pabrik agen
// ---------------------------------------------------------------------------

/** Sub-agen A1-A10. Tanpa tool sendiri: buktinya disuntikkan sebagai katalog
 *  pada masukan, jadi tidak ada jalan bagi sub-agen untuk mengambil data di
 *  luar Evidence Store investigasi ini. */
export function buatSubAgen(id: IdAlat, model?: string) {
  return new Agent({
    name: `VARUNA ${id}`,
    instructions: `${TUGAS[id]} ${ATURAN_BERSAMA}`,
    outputType: SKEMA_KELUARAN[id],
    ...(model === undefined ? {} : { model }),
  });
}

/** A0 dengan A1-A10 terpasang sebagai tool. `parallelToolCalls: false` bukan
 *  kosmetik: kontrak menuntut "satu invokasi HTTP = satu langkah agen", dan
 *  giliran yang meminta dua tool sekaligus akan menjalankan dua langkah dalam
 *  satu invokasi (executor tetap menahan sisanya, ini lapis pertama). */
export function buatA0(alat: Tool<unknown>[], model?: string) {
  return new Agent({
    name: "VARUNA A0",
    instructions: INSTRUKSI_A0,
    tools: alat,
    outputType: SKEMA_KELUARAN.A0,
    modelSettings: { parallelToolCalls: false },
    ...(model === undefined ? {} : { model }),
  });
}

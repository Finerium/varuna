import { describe, expect, it } from "vitest";

import { KATA_TERLARANG, cekDiksi } from "../src/diksi";

// ============================================================================
// Penyaring diksi — contracts.md Bagian 7. DITULIS SEBELUM IMPLEMENTASI.
//
// Kontrak: "Penyaring diksi (packages/core/src/diksi.ts): menolak bersalah,
// terbukti, vonis, pidana, pidanakan, pelaku, kriminal, hukuman, dakwaan,
// terdakwa, tersangka pada keluaran tampil; teruji unit."
//
// Interpretasi (dicatat karena kontrak tidak menuliskan bentuk API):
// D1. `cekDiksi(teks) -> { ok, kata }`; ok=true berarti teks boleh tampil,
//     `kata` = daftar kata terlarang yang ditemukan, huruf kecil, tanpa duplikat.
//     Boolean `berkas.diksi_ok` di Bagian 1 adalah nilai `ok` ini.
// D2. Pencocokan pada BATAS KATA, bukan substring. Kontrak melarang kata-kata
//     tertentu, bukan potongan huruf; menolak "bukti" karena "terbukti" ada di
//     daftar akan melumpuhkan kosakata bukti yang justru inti produk.
// D3. Tidak peka huruf besar-kecil (keluaran tampil bisa berhuruf kapital).
// D4. Penolak pola identitas Bagian 3 (regex MMSI, callsign, nama kapal) BUKAN
//     urusan berkas ini — Bagian 7 hanya menetapkan daftar kata.
// ============================================================================

/** Persis, dan dalam urutan, seperti tertulis di contracts.md Bagian 7. */
const DAFTAR_KONTRAK = [
  "bersalah",
  "terbukti",
  "vonis",
  "pidana",
  "pidanakan",
  "pelaku",
  "kriminal",
  "hukuman",
  "dakwaan",
  "terdakwa",
  "tersangka",
] as const;

describe("penyaring diksi — daftar kata beku Bagian 7", () => {
  it("mengekspor tepat sebelas kata kontrak dalam urutan kontrak", () => {
    expect([...KATA_TERLARANG]).toEqual([...DAFTAR_KONTRAK]);
  });

  it.each(DAFTAR_KONTRAK)("menolak kalimat yang memuat '%s'", (kata) => {
    const hasil = cekDiksi(`Sistem menyatakan kapal itu ${kata} pada berkas ini.`);
    expect(hasil.ok).toBe(false);
    expect(hasil.kata).toContain(kata);
  });

  it.each(DAFTAR_KONTRAK)("menolak '%s' walau berdiri sendiri tanpa kalimat", (kata) => {
    expect(cekDiksi(kata).ok).toBe(false);
  });
});

describe("kalimat bersih lolos", () => {
  const bersih = [
    "Dua modalitas sensor menguatkan kandidat pada jendela akuisisi yang sama.",
    "ABSTAIN: bukti berasal dari satu sumber saja; sistem menunggu lintasan berikutnya.",
    "Area pencarian, bukan posisi pasti.",
    "Celah AIS selama enam jam tercatat sebagai celah, bukan sebagai kepastian.",
    "Kapal terlihat menarik alat tangkap di dalam ZEE-ID pada rentang yang dipersoalkan.",
  ];

  it.each(bersih)("meloloskan: %s", (teks) => {
    const hasil = cekDiksi(teks);
    expect(hasil.ok).toBe(true);
    expect(hasil.kata).toEqual([]);
  });

  it("meloloskan string kosong", () => {
    expect(cekDiksi("").ok).toBe(true);
  });
});

describe("tidak peka huruf besar-kecil", () => {
  it.each(["BERSALAH", "TeRbUkTi", "Vonis", "TERSANGKA", "PeLaKu"])("menolak '%s'", (kata) => {
    expect(cekDiksi(`Laporan menyebut ${kata} di paragraf pertama.`).ok).toBe(false);
  });

  it("melaporkan kata temuan dalam huruf kecil apa pun bentuk aslinya", () => {
    expect(cekDiksi("TERBUKTI dan Vonis").kata).toEqual(["terbukti", "vonis"]);
  });
});

describe("batas kata: substring TIDAK boleh memicu false-positive", () => {
  // Pasangan (lolos, tolak): kiri adalah kata sah yang berbagi huruf dengan
  // kanan. Implementasi yang men-stem atau memakai includes() akan jatuh.
  const pasangan: Array<[string, string]> = [
    ["bukti", "terbukti"],
    ["salah", "bersalah"],
    ["hukum", "hukuman"],
    ["dakwa", "dakwaan"],
    ["sangka", "tersangka"],
    ["krim", "kriminal"],
  ];

  it.each(pasangan)("'%s' lolos sementara '%s' ditolak", (lolos, tolak) => {
    expect(cekDiksi(`Kata ${lolos} muncul di berkas.`).ok).toBe(true);
    expect(cekDiksi(`Kata ${tolak} muncul di berkas.`).ok).toBe(false);
  });

  it("'bukti' lolos: kosakata inti produk tidak boleh ikut tersapu", () => {
    const hasil = cekDiksi("Bukti kuat, bukti lemah, dan bukti yang saling bertentangan.");
    expect(hasil.ok).toBe(true);
    expect(hasil.kata).toEqual([]);
  });

  it("'terbukti' ditolak walau 'bukti' di kalimat yang sama lolos", () => {
    const hasil = cekDiksi("Bukti ini belum terbukti secara hukum.");
    expect(hasil.ok).toBe(false);
    expect(hasil.kata).toEqual(["terbukti"]);
  });

  it("'salah satu' — frasa paling umum bahasa Indonesia — tidak boleh ditolak", () => {
    expect(cekDiksi("Salah satu artefak hilang pada rentang ini.").ok).toBe(true);
  });

  it("'hukum laut internasional' lolos, 'hukuman' ditolak", () => {
    expect(cekDiksi("Rujukan hukum laut internasional dipakai sebagai basis aturan.").ok).toBe(true);
    expect(cekDiksi("Rujukan hukuman dipakai sebagai basis aturan.").ok).toBe(false);
  });
});

describe("batas kata: tanda baca dan pembungkus tidak menyembunyikan kata", () => {
  it.each([
    "Statusnya terbukti.",
    "Statusnya (terbukti) menurut sistem.",
    "terbukti, lalu diarsipkan",
    '"terbukti"',
    "terbukti\npada baris berikutnya",
    "—terbukti—",
    "status:terbukti",
  ])("tetap menolak: %s", (teks) => {
    expect(cekDiksi(teks).ok).toBe(false);
  });
});

describe("pelaporan temuan", () => {
  it("mengumpulkan banyak kata terlarang dalam satu kalimat", () => {
    const hasil = cekDiksi("Pelaku dinyatakan bersalah dan menerima hukuman.");
    expect(hasil.ok).toBe(false);
    expect([...hasil.kata].sort()).toEqual(["bersalah", "hukuman", "pelaku"]);
  });

  it("tidak menduplikasi kata yang muncul berkali-kali", () => {
    expect(cekDiksi("vonis, vonis, dan sekali lagi vonis").kata).toEqual(["vonis"]);
  });

  it("'pidana' dan 'pidanakan' adalah dua entri terpisah di daftar", () => {
    expect(cekDiksi("jangan pidanakan").kata).toEqual(["pidanakan"]);
    expect(cekDiksi("bukan ranah pidana").kata).toEqual(["pidana"]);
  });
});

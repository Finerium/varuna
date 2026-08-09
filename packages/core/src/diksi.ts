// Penyaring diksi — contracts.md Bagian 7.
// Menolak kata bernada putusan pada keluaran tampil. Boolean `berkas.diksi_ok`
// (Bagian 1) adalah `ok` dari fungsi ini.
//
// Penolak pola identitas Bagian 3 (MMSI, callsign, nama kapal) BUKAN urusan
// berkas ini: Bagian 7 hanya menetapkan daftar kata.

/** Persis, dan dalam urutan, seperti tertulis di contracts.md Bagian 7. */
export const KATA_TERLARANG = [
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

export type KataTerlarang = (typeof KATA_TERLARANG)[number];

export type HasilDiksi = { ok: boolean; kata: KataTerlarang[] };

// Batas kata, bukan substring: "bukti" (kosakata inti produk) harus lolos
// walau "terbukti" dilarang, dan "salah satu" tidak boleh tersapu "bersalah".
// \b tidak dipakai karena harus cocok juga pada "status:terbukti" dan
// "—terbukti—"; yang menentukan adalah tetangga BUKAN huruf/angka.
const HURUF = /[\p{L}\p{N}]/u;

function adaKata(teks: string, kata: string): boolean {
  const pola = new RegExp(kata, "giu");
  for (const cocok of teks.matchAll(pola)) {
    const i = cocok.index;
    const sebelum = i > 0 ? teks.charAt(i - 1) : "";
    const sesudah = teks.charAt(i + kata.length);
    if (!HURUF.test(sebelum) && !HURUF.test(sesudah)) return true;
  }
  return false;
}

/** `ok: true` berarti teks boleh tampil. `kata` = temuan huruf kecil, tanpa
 *  duplikat, dalam urutan daftar kontrak. */
export function cekDiksi(teks: string): HasilDiksi {
  const kata = KATA_TERLARANG.filter((k) => adaKata(teks, k));
  return { ok: kata.length === 0, kata: [...kata] };
}

// Stack gerak — architecture.md "Gerak & visual" (MENGIKAT): GSAP + ScrollTrigger
// untuk Entry dan Portal, Lenis untuk momentum scroll, Motion untuk komponen
// React. Tanpa Three.js. Yang dianimasikan HANYA transform dan opacity: tidak ada
// properti layout dan tidak ada filter, jadi seluruh gerak tinggal di compositor.
//
// Kontrak reduced-motion dipegang satu bendera. Skrip inline di <body> memasang
// `data-gerak="hidup"` pada <html> SEBELUM isi tergambar, dan hanya kalau
// pengguna tidak meminta reduced motion. Seluruh pra-sembunyi CSS bergantung pada
// bendera itu, sehingga tiga jalur ini menghasilkan halaman yang sama persis —
// utuh, hanya diam: prefers-reduced-motion, JavaScript mati, dan modul gerak
// gagal dimuat (padamkanGerak mencabut benderanya).

/** Nilai bendera. CSS (`html[data-gerak="hidup"]`) dan skrip inline harus
 *  menyepakatinya; makanya keduanya membaca konstanta ini, bukan literal
 *  masing-masing. Ketidaksepakatan = isi tersembunyi selamanya. */
export const BENDERA_GERAK = "hidup";

/** Dijalankan sinkron sebagai skrip inline pertama di <body>, bukan lewat efek
 *  React: bendera harus sudah terpasang saat parser menyentuh isi, kalau tidak
 *  ada satu frame konten penuh yang berkedip sebelum animasi masuk. */
export const SKRIP_GERAK = `try{if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.dataset.gerak=${JSON.stringify(
  BENDERA_GERAK,
)}}catch(e){}`;

export function gerakHidup(): boolean {
  return (
    typeof document !== "undefined" && document.documentElement.dataset.gerak === BENDERA_GERAK
  );
}

/** Jalan keluar saat modul gerak gagal dimuat: bendera dicabut, pra-sembunyi CSS
 *  berhenti cocok, dan isi yang menunggu animasi langsung terlihat. */
export function padamkanGerak(): void {
  if (typeof document !== "undefined") delete document.documentElement.dataset.gerak;
}

/** Hero dipecah per kata di server, bukan oleh pemecah teks runtime: markupnya
 *  sudah final sebelum JS jalan, spasi tetap simpul teks di luar span, jadi
 *  salinan teks dan pembaca layar membaca kalimat yang sama. */
export const pecahKata = (teks: string): string[] => teks.split(/\s+/).filter((k) => k.length > 0);

/** Nilai akhir count-up dibaca dari teks yang sudah dirender server — angka tidak
 *  pernah dikarang di klien. Hanya bilangan bulat non-negatif yang diterima:
 *  count-up menulis ulang textContent, jadi ia hanya boleh menyentuh teks yang
 *  bisa dipulihkan persis. Sisanya (em dash, angka berpemisah) dilewati. */
export function bacaAngka(teks: string | null): number | null {
  if (teks === null) return null;
  const bersih = teks.trim();
  return /^\d+$/.test(bersih) ? Number(bersih) : null;
}

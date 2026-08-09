// Geometri peta SVG — TANPA tile server, TANPA pustaka peta.
//
// Peta di produk ini menjawab satu pertanyaan saja ("di mana kandidatnya, di
// dalam zona mana"), pada satu register visual yang sudah dikunci token. Tile
// raster pihak ketiga akan membawa palet, tipografi, dan permintaan jaringan
// yang tak satupun kita kendalikan — dan geometri zona yang dipakai gerbang
// zona sudah ada di repo. Jadi: proyeksi equirectangular ke viewBox, cincin
// GeoJSON tersederhanakan (scripts/zona_web.py) sebagai path, selesai.
//
// Seluruh berkas ini fungsi murni; komponennya (components/peta.tsx) hanya
// menuliskan hasilnya. Diuji di test/peta.test.tsx.

export type Titik = { lat: number; lon: number };

/** Kotak geografis, selalu lon0<=lon1 dan lat0<=lat1. */
export type Kotak = { lon0: number; lat0: number; lon1: number; lat1: number };

export type Bingkai = {
  kotak: Kotak;
  /** cos(lintang tengah): kompresi bujur supaya bentuk tidak melar ke samping. */
  k: number;
  lebar: number;
  tinggi: number;
};

const jepit = (v: number, min: number, maks: number) => Math.min(Math.max(v, min), maks);

/** Batas aman equirectangular: kutub dibuang (tan/cos jadi tak berguna di sana,
 *  dan tidak ada AOI maritim di 89 derajat). */
const LAT_MAKS = 84;

export function gabungKotak(a: Kotak, b: Kotak): Kotak {
  return {
    lon0: Math.min(a.lon0, b.lon0),
    lat0: Math.min(a.lat0, b.lat0),
    lon1: Math.max(a.lon1, b.lon1),
    lat1: Math.max(a.lat1, b.lat1),
  };
}

/** Kotak pembungkus sekumpulan titik; null kalau tidak ada titik sama sekali
 *  (pemanggil yang memutuskan kotak dasarnya, bukan fungsi ini yang mengarang). */
export function kotakTitik(titik: readonly Titik[]): Kotak | null {
  if (titik.length === 0) return null;
  const lat = titik.map((t) => t.lat);
  const lon = titik.map((t) => t.lon);
  return {
    lon0: Math.min(...lon),
    lat0: Math.min(...lat),
    lon1: Math.max(...lon),
    lat1: Math.max(...lat),
  };
}

export type OpsiBingkai = {
  /** Margin sebagai pecahan sisi terpanjang. */
  margin?: number;
  /** Rasio lebar:tinggi terkecil dan terbesar yang boleh dipakai. Di luar itu
   *  sisi yang pendek DITUMBUHKAN — peta strip setinggi 30 px tidak terbaca,
   *  dan peta setinggi layar mengusir antrean dari lipatan. */
  aspekMin?: number;
  aspekMaks?: number;
  /** Lebar viewBox dalam satuan gambar. Tinggi mengikuti aspek geografis. */
  lebar?: number;
};

/** Kotak geografis -> bingkai viewBox. Titik kalibrasi ada di sini: margin dan
 *  jepitan aspek adalah selera tampilan, bukan geografi, jadi keduanya
 *  parameter dan bukan angka yang tertanam di dalam proyeksi. */
export function bingkai(kotak: Kotak, opsi: OpsiBingkai = {}): Bingkai {
  const { margin = 0.08, aspekMin = 0.9, aspekMaks = 2.4, lebar = 1000 } = opsi;

  // Kotak setitik (satu kandidat, tanpa zona) tidak punya bentang: beri bentang
  // minimum supaya pembagian di bawah tidak jadi nol.
  const MIN_BENTANG = 0.05;
  let dLon = Math.max(kotak.lon1 - kotak.lon0, MIN_BENTANG);
  let dLat = Math.max(kotak.lat1 - kotak.lat0, MIN_BENTANG);
  let cLon = (kotak.lon0 + kotak.lon1) / 2;
  let cLat = (kotak.lat0 + kotak.lat1) / 2;

  const m = Math.max(dLon, dLat) * margin;
  dLon += 2 * m;
  dLat += 2 * m;

  // Kompresi bujur dihitung dari lintang tengah SEBELUM jepitan aspek: nilainya
  // ikut menentukan aspek, jadi ia harus stabil saat aspek disetel.
  const k = Math.cos((jepit(cLat, -LAT_MAKS, LAT_MAKS) * Math.PI) / 180);

  const aspek = (dLon * k) / dLat;
  if (aspek > aspekMaks) dLat = (dLon * k) / aspekMaks;
  else if (aspek < aspekMin) dLon = (dLat * aspekMin) / k;

  // Jepit ke rentang bujur/lintang yang sah tanpa mengubah bentang: geser pusat
  // dulu, baru potong kalau bentangnya memang lebih besar dari dunia.
  cLon = jepit(cLon, -180 + dLon / 2, 180 - dLon / 2);
  cLat = jepit(cLat, -LAT_MAKS + dLat / 2, LAT_MAKS - dLat / 2);

  const akhir: Kotak = {
    lon0: Math.max(cLon - dLon / 2, -180),
    lon1: Math.min(cLon + dLon / 2, 180),
    lat0: Math.max(cLat - dLat / 2, -LAT_MAKS),
    lat1: Math.min(cLat + dLat / 2, LAT_MAKS),
  };

  return {
    kotak: akhir,
    k,
    lebar,
    tinggi: (lebar * (akhir.lat1 - akhir.lat0)) / ((akhir.lon1 - akhir.lon0) * k),
  };
}

/** lat/lon -> x/y viewBox. Equirectangular: bujur linear (dikompresi cos lintang
 *  tengah), lintang linear dan terbalik karena y SVG tumbuh ke bawah. */
export function proyeksi(b: Bingkai): (t: Titik) => { x: number; y: number } {
  const sx = b.lebar / ((b.kotak.lon1 - b.kotak.lon0) * b.k);
  const sy = b.tinggi / (b.kotak.lat1 - b.kotak.lat0);
  return (t) => ({
    x: (t.lon - b.kotak.lon0) * b.k * sx,
    y: (b.kotak.lat1 - t.lat) * sy,
  });
}

/** Kotak sekumpulan cincin GeoJSON ([lon,lat][]); null kalau tidak ada titik. */
export function kotakCincin(cincin: readonly (readonly number[][])[]): Kotak | null {
  return kotakTitik(cincin.flatMap((r) => r.map(([lon, lat]) => ({ lon, lat }))));
}

/** Kotak satu cincin. */
function kotakSatuCincin(r: readonly (readonly number[])[]): Kotak {
  let lon0 = Infinity;
  let lat0 = Infinity;
  let lon1 = -Infinity;
  let lat1 = -Infinity;
  for (const [lon, lat] of r) {
    if (lon < lon0) lon0 = lon;
    if (lon > lon1) lon1 = lon;
    if (lat < lat0) lat0 = lat;
    if (lat > lat1) lat1 = lat;
  }
  return { lon0, lat0, lon1, lat1 };
}

/** Cincin GeoJSON ([lon,lat][]) -> atribut `d` satu path. Cincin yang kotaknya
 *  tidak beririsan dengan bingkai dibuang lebih dulu: pada bingkai Natuna,
 *  sebagian besar dari 133 cincin ZEE nasional tidak menyentuh satu piksel pun. */
export function jalurCincin(b: Bingkai, cincin: readonly (readonly number[][])[]): string {
  const p = proyeksi(b);
  const potong: string[] = [];
  for (const r of cincin) {
    const kr = kotakSatuCincin(r);
    if (
      kr.lon1 < b.kotak.lon0 ||
      kr.lon0 > b.kotak.lon1 ||
      kr.lat1 < b.kotak.lat0 ||
      kr.lat0 > b.kotak.lat1
    )
      continue;
    const titik = r.map(([lon, lat]) => {
      const { x, y } = p({ lon, lat });
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    potong.push(`M${titik.join("L")}Z`);
  }
  return potong.join("");
}

/** Label mana yang boleh ditulis, serakah menurut urutan masuk (pemanggil
 *  menaruh yang dipilih di depan). Dua kandidat berdekatan menuliskan dua teks
 *  selebar ~150 unit persis di atas satu sama lain: pada bingkai Komando golden
 *  set, dua scene Laut Utara hanya berjarak 13 unit. Yang kalah kehilangan
 *  TEKSNYA saja — titik, denyut, <title>, dan tautannya tetap ada, dan antrean
 *  di sebelah peta tetap memuat semuanya.
 *
 *  Kotak tabrakan dipakai apa adanya (bukan jarak euclid): teks 20 unit itu
 *  jauh lebih lebar daripada tinggi, jadi dua titik yang bertumpuk vertikal
 *  memang tidak bertabrakan dan tidak perlu dibungkam.
 *
 *  ponytail: O(n^2) atas label yang lolos; peta ini menggambar puluhan titik,
 *  bukan ribuan. Kalau nanti ribuan, saring dulu per-sel grid. */
export function saringLabel(
  posisi: readonly { x: number; y: number }[],
  kotak: { lebar: number; tinggi: number },
): boolean[] {
  const tertulis: { x: number; y: number }[] = [];
  return posisi.map((p) => {
    const muat = tertulis.every(
      (q) => Math.abs(p.x - q.x) >= kotak.lebar || Math.abs(p.y - q.y) >= kotak.tinggi,
    );
    if (muat) tertulis.push(p);
    return muat;
  });
}

/** Poligon area pencarian datang JADI dari server (`geometri` pada paket
 *  runtime: packages/core/src/runtime.ts areaPencarian()), jadi peta tidak
 *  punya versi kedua dari hitungan radius — ia hanya menggambar cincin yang
 *  sudah dicetak. Gunakan jalurCincin() di atas untuk itu. */

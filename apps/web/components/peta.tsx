// Peta SVG mandiri — tanpa tile server, tanpa pustaka peta, tanpa JS klien.
// Dirender server-side dari cincin zona tersederhanakan (scripts/zona_web.py)
// dan dari posisi yang SUDAH ada di Evidence Store; geometrinya di lib/peta.ts.
//
// Kenapa bukan MapLibre/Leaflet: peta ini menjawab satu pertanyaan ("di mana
// kandidatnya, di dalam zona mana") pada palet yang dikunci token. Tile pihak
// ketiga membawa warna, tipografi, dan permintaan jaringan yang tidak kita
// kendalikan — tiga hal yang justru dikunci kontrak. Dan geometri zona yang
// dipakai gerbang zona sudah ada di repo, jadi peta menggambar POLIGON YANG
// SAMA yang memutuskan inside/outside, bukan latar dekoratif yang mirip.

import type { StatusServerZod } from "@varuna/core/schemas";

import {
  bingkai,
  gabungKotak,
  jalurCincin,
  kotakCincin,
  kotakTitik,
  proyeksi,
  saringLabel,
  type Kotak,
  type Titik,
} from "@/lib/peta";
import nasional from "@/lib/zona/nasional.json";
import natuna from "@/lib/zona/natuna.json";

const ZONA = { nasional, natuna };
export type NamaZona = keyof typeof ZONA;

const kotakZona = (z: NamaZona): Kotak => {
  const [lon0, lat0, lon1, lat1] = ZONA[z].bbox;
  return { lon0, lat0, lon1, lat1 };
};

export type TitikKandidat = Titik & {
  inv_id: string;
  status: StatusServerZod["status"];
  /** Ada = titiknya jadi tautan ke berkas yang sama dengan baris antrean. */
  href?: string;
};

/** Area pencarian SUDAH berbentuk poligon saat keluar dari server (geometri
 *  paket runtime, packages/core/src/runtime.ts). Peta menggambar cincin itu apa
 *  adanya — tidak ada hitungan radius kedua di sisi tampilan. */
export type AreaPeta = {
  id: string;
  /** coordinates GeoJSON Polygon: cincin -> titik -> [lon, lat]. */
  cincin: readonly (readonly number[][])[];
  judul: string;
};

/** Jari-jari (satuan viewBox) dipilih di sekitar lebar 1000; pemanggil yang
 *  petanya sempit (frame Patroli) memperkecil `lebar` alih-alih memperbesar
 *  angka-angka ini, supaya ukuran tampak di layar tetap sama. */
const R_TITIK = 8;
const R_DENYUT = 22;
const R_PILIH = 15;

/** Kotak tabrakan label, satuan viewBox. Teks label 20 unit tingginya berapa
 *  pun `lebar` (CSS px di dalam SVG = unit pengguna), jadi angkanya tetap dan
 *  tidak ikut diskalakan: ~11 unit per karakter, 150x26 memuat inv_id
 *  terpanjang golden set beserta napasnya.
 *  ponytail: satu kotak untuk semua label, bukan lebar per-teks; ukur per-label
 *  kalau nanti ada label yang jauh lebih panjang dari inv_id. */
const LABEL_TABRAK = { lebar: 150, tinggi: 26 };

export function Peta({
  label,
  zona,
  titik = [],
  area = [],
  dipilih = null,
  lebar = 1000,
  catatan,
}: {
  /** Kalimat yang dibaca pembaca layar sebagai ganti gambar. */
  label: string;
  /** Minimal satu lapisan: bingkai peta lahir dari gabungan kotak zona. */
  zona: readonly [NamaZona, ...NamaZona[]];
  titik?: readonly TitikKandidat[];
  area?: readonly AreaPeta[];
  dipilih?: string | null;
  lebar?: number;
  catatan?: string;
}) {
  // Bingkai = gabungan SEMUA yang digambar. Zona ikut dihitung supaya peta tidak
  // pernah memotong geometri yang jadi dasar putusan zona; pemanggil memilih
  // lapisan zona mana yang relevan, jadi Patroli tetap dapat bingkai lokal.
  let kotak = zona.map(kotakZona).reduce(gabungKotak);
  for (const t of [kotakTitik(titik), ...area.map((a) => kotakCincin(a.cincin))])
    if (t !== null) kotak = gabungKotak(kotak, t);

  const b = bingkai(kotak, { lebar });
  const p = proyeksi(b);
  const tinggi = Math.round(b.tinggi);
  const sumber = [...new Set(zona.map((z) => ZONA[z].sumber))];

  // Label yang bertabrakan dibungkam, dengan yang dipilih menang lebih dulu.
  // sort stabil, jadi sisanya mempertahankan urutan antrean.
  const xy = titik.map(p);
  const prioritas = [...xy.keys()].sort(
    (a, c) => Number(titik[c].inv_id === dipilih) - Number(titik[a].inv_id === dipilih),
  );
  const muat = saringLabel(
    prioritas.map((i) => xy[i]),
    LABEL_TABRAK,
  );
  const berlabel = new Set(prioritas.filter((_, k) => muat[k]));

  return (
    <figure className="peta">
      {/* role="img" + aria-label sesuai permintaan aksesibilitas: peta ini
          adalah PENGULANGAN VISUAL dari daftar di sebelahnya, dan daftar itulah
          jalur non-visual yang lengkap (tautannya identik). Tautan di dalam
          peta tetap ada untuk tetikus dan papan ketik. */}
      <svg
        className="peta__gambar"
        viewBox={`0 0 ${b.lebar} ${tinggi}`}
        role="img"
        aria-label={label}
      >
        <rect className="peta__laut" x={0} y={0} width={b.lebar} height={tinggi} />

        {zona.map((z) => (
          <path
            key={z}
            className={`peta__zona${z === "natuna" ? " peta__zona--fokus" : ""}`}
            fillRule="evenodd"
            d={jalurCincin(b, ZONA[z].cincin)}
          />
        ))}

        {area.map((a) => (
          <g key={a.id}>
            <title>{a.judul}</title>
            <path className="peta__area" fillRule="evenodd" d={jalurCincin(b, a.cincin)} />
          </g>
        ))}

        {titik.map((t, i) => {
          const { x, y } = xy[i];
          const kiri = x > b.lebar * 0.72;
          const isi = (
            <>
              {t.status !== "abstain" && (
                <circle className="peta__denyut" cx={x} cy={y} r={R_DENYUT} />
              )}
              {t.inv_id === dipilih && <circle className="peta__pilih" cx={x} cy={y} r={R_PILIH} />}
              <circle
                className={`peta__titik peta__titik--${t.status}`}
                cx={x}
                cy={y}
                r={R_TITIK}
              />
              {berlabel.has(i) && (
                <text
                  className="peta__label"
                  x={kiri ? x - R_TITIK - 8 : x + R_TITIK + 8}
                  y={y + 7}
                  textAnchor={kiri ? "end" : "start"}
                >
                  {t.inv_id.replace(/^inv-/, "")}
                </text>
              )}
            </>
          );
          const judul = `${t.inv_id}, ${t.status === "abstain" ? "ABSTAIN" : t.status}, ${t.lat.toFixed(3)} lintang / ${t.lon.toFixed(3)} bujur`;
          return t.href === undefined ? (
            <g key={t.inv_id}>
              <title>{judul}</title>
              {isi}
            </g>
          ) : (
            <a key={t.inv_id} href={t.href} aria-label={`Buka berkas ${judul}`}>
              <title>{judul}</title>
              {isi}
            </a>
          );
        })}
      </svg>
      <figcaption className="peta__kaki">
        {catatan !== undefined && <span className="peta__catatan">{catatan} </span>}
        Proyeksi equirectangular, bukan alat navigasi. Geometri zona: {sumber.join("; ")}.
      </figcaption>
    </figure>
  );
}

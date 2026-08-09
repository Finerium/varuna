// Geometri peta (lib/peta.ts) + smoke render komponennya (components/peta.tsx).
// Yang diuji adalah bagian yang bisa diam-diam salah: proyeksi lat/lon -> x/y,
// bingkai yang menjepit aspek, dan bahwa komponennya sungguh memancarkan titik
// beserta tautannya.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Peta, type AreaPeta, type TitikKandidat } from "@/components/peta";
import {
  bingkai,
  gabungKotak,
  jalurCincin,
  kotakCincin,
  kotakTitik,
  proyeksi,
  saringLabel,
} from "@/lib/peta";

const KOTAK = { lon0: 107, lat0: 3, lon1: 111, lat1: 7 };

describe("proyeksi lat/lon -> x/y viewBox", () => {
  const b = bingkai(KOTAK, { margin: 0, lebar: 1000 });
  const p = proyeksi(b);

  it("memetakan sudut barat-laut ke (0,0) dan tenggara ke (lebar,tinggi)", () => {
    expect(p({ lon: b.kotak.lon0, lat: b.kotak.lat1 })).toEqual({ x: 0, y: 0 });
    const kanan = p({ lon: b.kotak.lon1, lat: b.kotak.lat0 });
    expect(kanan.x).toBeCloseTo(b.lebar, 6);
    expect(kanan.y).toBeCloseTo(b.tinggi, 6);
  });

  it("y tumbuh ke selatan (SVG terbalik terhadap lintang)", () => {
    const utara = p({ lon: 109, lat: 6 });
    const selatan = p({ lon: 109, lat: 4 });
    expect(selatan.y).toBeGreaterThan(utara.y);
  });

  it("x tumbuh ke timur dan linear terhadap bujur", () => {
    const a = p({ lon: 108, lat: 5 });
    const c = p({ lon: 110, lat: 5 });
    const tengah = p({ lon: 109, lat: 5 });
    expect(c.x).toBeGreaterThan(a.x);
    expect(tengah.x).toBeCloseTo((a.x + c.x) / 2, 6);
  });

  it("mengompresi bujur dengan cos lintang tengah, jadi kotak 4x4 derajat di 5 LU tidak persegi", () => {
    // k = cos(5 deg) = 0.9962: 4 derajat bujur di sini lebih pendek dari 4
    // derajat lintang, dan tinggi viewBox ikut lebih besar dari lebarnya.
    expect(b.k).toBeCloseTo(Math.cos((5 * Math.PI) / 180), 10);
    expect(b.tinggi).toBeCloseTo(1000 / b.k, 6);
  });

  it("kompresinya nyata di lintang tinggi", () => {
    const utara = bingkai({ lon0: 0, lat0: 55, lon1: 10, lat1: 60 }, { margin: 0 });
    expect(utara.k).toBeLessThan(0.6);
  });
});

describe("bingkai", () => {
  it("menambah margin di kedua sisi tanpa menggeser pusat", () => {
    const b = bingkai(KOTAK, { margin: 0.1, aspekMin: 0, aspekMaks: 99 });
    expect((b.kotak.lon0 + b.kotak.lon1) / 2).toBeCloseTo(109, 6);
    expect((b.kotak.lat0 + b.kotak.lat1) / 2).toBeCloseTo(5, 6);
    expect(b.kotak.lon1 - b.kotak.lon0).toBeCloseTo(4 + 2 * 0.4, 6);
  });

  it("menjepit aspek yang terlalu lebar dengan menumbuhkan lintang", () => {
    const b = bingkai({ lon0: 0, lat0: 0, lon1: 100, lat1: 2 }, { margin: 0, aspekMaks: 2.4 });
    expect(b.lebar / b.tinggi).toBeCloseTo(2.4, 6);
    expect(b.kotak.lat1 - b.kotak.lat0).toBeGreaterThan(2);
  });

  it("menjepit aspek yang terlalu tinggi dengan menumbuhkan bujur", () => {
    const b = bingkai({ lon0: 0, lat0: 0, lon1: 1, lat1: 40 }, { margin: 0, aspekMin: 0.9 });
    expect(b.lebar / b.tinggi).toBeCloseTo(0.9, 6);
    expect(b.kotak.lon1 - b.kotak.lon0).toBeGreaterThan(1);
  });

  it("satu titik tunggal tidak membuat pembagian nol", () => {
    const b = bingkai({ lon0: 109.4, lat0: 4.6, lon1: 109.4, lat1: 4.6 });
    expect(Number.isFinite(b.tinggi)).toBe(true);
    expect(b.tinggi).toBeGreaterThan(0);
    expect(b.kotak.lon1).toBeGreaterThan(b.kotak.lon0);
  });

  it("tetap di dalam bujur/lintang yang sah walau diminta seluruh dunia", () => {
    const b = bingkai({ lon0: -179, lat0: -80, lon1: 179, lat1: 80 }, { margin: 0.5 });
    expect(b.kotak.lon0).toBeGreaterThanOrEqual(-180);
    expect(b.kotak.lon1).toBeLessThanOrEqual(180);
    expect(b.kotak.lat0).toBeGreaterThanOrEqual(-85);
    expect(b.kotak.lat1).toBeLessThanOrEqual(85);
  });
});

describe("kotak", () => {
  it("kotakTitik kosong = null, bukan kotak karangan", () => {
    expect(kotakTitik([])).toBeNull();
    expect(kotakCincin([])).toBeNull();
  });

  it("kotakTitik membungkus semua titik", () => {
    expect(
      kotakTitik([
        { lat: 4, lon: 109 },
        { lat: 60, lon: -1 },
      ]),
    ).toEqual({
      lon0: -1,
      lat0: 4,
      lon1: 109,
      lat1: 60,
    });
  });

  it("gabungKotak mengambil pembungkus keduanya", () => {
    expect(gabungKotak(KOTAK, { lon0: 90, lat0: -10, lon1: 100, lat1: 0 })).toEqual({
      lon0: 90,
      lat0: -10,
      lon1: 111,
      lat1: 7,
    });
  });
});

describe("jalurCincin", () => {
  const b = bingkai(KOTAK, { margin: 0 });

  it("membuang cincin yang tidak menyentuh bingkai", () => {
    const jauh = [
      [
        [10, 50],
        [11, 50],
        [11, 51],
        [10, 50],
      ],
    ];
    expect(jalurCincin(b, jauh)).toBe("");
  });

  it("menuliskan satu subpath tertutup per cincin yang terlihat", () => {
    const dekat = [
      [
        [108, 4],
        [110, 4],
        [110, 6],
        [108, 4],
      ],
      [
        [108.5, 4.5],
        [109, 4.5],
        [109, 5],
        [108.5, 4.5],
      ],
    ];
    const d = jalurCincin(b, dekat);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(d.startsWith("M")).toBe(true);
  });
});

describe("saringLabel", () => {
  const KOTAK_LABEL = { lebar: 150, tinggi: 26 };

  it("yang pertama selalu dapat labelnya", () => {
    expect(saringLabel([{ x: 10, y: 10 }], KOTAK_LABEL)).toEqual([true]);
    expect(saringLabel([], KOTAK_LABEL)).toEqual([]);
  });

  it("membungkam label yang bertabrakan, bukan menumpuknya", () => {
    // Jarak nyata dua scene Laut Utara pada bingkai Komando golden set.
    expect(
      saringLabel(
        [
          { x: 104.3, y: 91.6 },
          { x: 117.1, y: 94.8 },
        ],
        KOTAK_LABEL,
      ),
    ).toEqual([true, false]);
  });

  it("membiarkan yang terpisah cukup jauh mendatar", () => {
    expect(
      saringLabel(
        [
          { x: 0, y: 50 },
          { x: 150, y: 50 },
        ],
        KOTAK_LABEL,
      ),
    ).toEqual([true, true]);
  });

  it("tidak membungkam yang hanya bertumpuk mendatar: teks itu lebar, bukan tinggi", () => {
    expect(
      saringLabel(
        [
          { x: 100, y: 0 },
          { x: 100, y: 26 },
        ],
        KOTAK_LABEL,
      ),
    ).toEqual([true, true]);
  });

  it("yang dibungkam tidak ikut memblokir label berikutnya", () => {
    // Rantai 0-100-200: 100 kalah oleh 0, tapi 200 tetap boleh karena yang
    // sungguh tertulis hanya 0.
    expect(
      saringLabel(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 200, y: 0 },
        ],
        KOTAK_LABEL,
      ),
    ).toEqual([true, false, true]);
  });
});

// --- smoke render -----------------------------------------------------------

const TITIK: TitikKandidat[] = [
  {
    inv_id: "inv-natuna-20260805-01",
    lat: 4.6435,
    lon: 109.4027,
    status: "abstain",
    href: "/komando?inv=inv-natuna-20260805-01",
  },
  { inv_id: "inv-x3-570f8bf7-01", lat: 59.916294, lon: -0.423867, status: "terindikasi" },
];

describe("komponen Peta", () => {
  const markup = renderToStaticMarkup(
    <Peta
      label="Peta kandidat uji"
      zona={["nasional", "natuna"]}
      titik={TITIK}
      dipilih="inv-natuna-20260805-01"
    />,
  );

  it("adalah gambar beraksesibilitas: role img + aria-label", () => {
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Peta kandidat uji"');
    expect(markup).toContain("viewBox=");
  });

  it("menggambar laut dan kedua lapisan zona", () => {
    expect(markup).toContain("peta__laut");
    expect(markup).toContain("peta__zona");
    expect(markup).toContain("peta__zona--fokus");
  });

  it("mewarnai titik dari status server, ABSTAIN memakai kelasnya sendiri", () => {
    expect(markup).toContain("peta__titik--abstain");
    expect(markup).toContain("peta__titik--terindikasi");
    // Denyut hanya untuk kandidat yang bukan ABSTAIN.
    expect(markup.match(/peta__denyut/g)).toHaveLength(1);
  });

  it("menandai titik terpilih dan membuka berkas lewat tautan yang sama dengan antrean", () => {
    expect(markup).toContain("peta__pilih");
    expect(markup).toContain('href="/komando?inv=inv-natuna-20260805-01"');
    expect(markup).toContain("Buka berkas inv-natuna-20260805-01");
    // Titik tanpa href tidak boleh jadi tautan buntu.
    expect(markup.match(/<a /g)).toHaveLength(1);
  });

  it("menyertakan atribusi geometri zona", () => {
    expect(markup).toContain("Marine Regions");
  });

  it("melabeli kandidat dengan inv_id tanpa awalan", () => {
    expect(markup).toContain(">natuna-20260805-01<");
  });
});

describe("komponen Peta dengan kandidat berdempetan", () => {
  // Dua kandidat 0.05 derajat terpisah: ~12 unit viewBox pada bingkai Natuna,
  // jadi labelnya pasti bertabrakan. Yang dipilih harus yang bertahan.
  const dempet: TitikKandidat[] = [
    { inv_id: "inv-a-01", lat: 4.6, lon: 109.4, status: "terindikasi" },
    { inv_id: "inv-b-02", lat: 4.62, lon: 109.45, status: "terindikasi" },
  ];
  const markup = renderToStaticMarkup(
    <Peta label="Peta dempet" zona={["natuna"]} titik={dempet} dipilih="inv-b-02" />,
  );

  it("menulis satu label saja, milik yang dipilih", () => {
    expect(markup.match(/peta__label/g)).toHaveLength(1);
    expect(markup).toContain(">b-02<");
    expect(markup).not.toContain(">a-01<");
  });

  it("kandidat yang labelnya dibungkam tetap punya titik dan judulnya", () => {
    expect(markup.match(/peta__titik /g)).toHaveLength(2);
    expect(markup).toContain("<title>inv-a-01, terindikasi");
  });
});

describe("komponen Peta dengan area pencarian", () => {
  const area: AreaPeta[] = [
    {
      id: "pkg-x3-570f8bf7-01",
      // Cincin kecil di dalam bingkai Natuna, bentuk yang sama dengan
      // geometri.coordinates paket runtime.
      cincin: [
        [
          [109, 4.5],
          [109.2, 4.5],
          [109.2, 4.7],
          [109, 4.7],
          [109, 4.5],
        ],
      ],
      judul: "pkg-x3-570f8bf7-01: area pencarian, bukan posisi pasti, radius 12.0 km",
    },
  ];
  const markup = renderToStaticMarkup(
    <Peta
      label="Peta area operasi uji"
      zona={["natuna"]}
      area={area}
      lebar={480}
      catatan="Batas putus-putus: area pencarian, bukan posisi pasti."
    />,
  );

  it("menggambar poligonnya dan menyebut labelnya yang beku", () => {
    expect(markup).toContain("peta__area");
    expect(markup).toContain("area pencarian, bukan posisi pasti");
  });

  it("memakai viewBox sempit yang diminta pemanggil", () => {
    expect(markup).toContain('viewBox="0 0 480 ');
  });

  it("tanpa kandidat, peta tetap sah dan tidak memuat tautan", () => {
    expect(markup).not.toContain("<a ");
    expect(markup).toContain("peta__zona--fokus");
  });
});

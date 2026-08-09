// Jalur tulis runtime — contracts.md Bagian 1, 3, 4, 5.
//
// Isinya: adapter Postgres untuk RuntimeStore, skema badan permintaan tiga
// jalur tulis (validasi, paket sasaran, hasil patroli, kalibrasi), dan
// perhitungan server yang menyertainya (area pencarian, artefak patrol_report
// ber-hash kanonis, overlay ambang). SEMUA murni kecuali adapter, yang pun
// hanya memegang sebuah fungsi kueri — bukan driver.
//
// Kenapa modul terpisah dari store.ts: store.ts menemukan akar golden lewat
// `new URL("../golden/", import.meta.url)` dan bundler server Next menolak
// jejak itu (alasan panjangnya di apps/web/lib/gudang.ts), jadi apps/web hanya
// boleh mengimpor TIPE dari sana. Berkas ini tidak menyentuh node:fs sama
// sekali, sehingga route handler boleh mengimpor NILAI-nya.
//
// Yang TIDAK dilakukan berkas ini: menyentuh computeStatus. Validasi analis,
// paket, dan hasil patroli adalah keputusan manusia DI ATAS status server;
// status_server tetap murni turunan artefak (Bagian 4).

import { createHash } from "node:crypto";

import { z } from "zod";

import { cekDiksi } from "./diksi.ts";
import { canonicalJson, posisi, type ArtifactLike, type Thresholds } from "./pasha.ts";
import {
  ArtIdSchema,
  ArtifactSchema,
  InvIdSchema,
  IsoSchema,
  LatSchema,
  LonSchema,
  PackageIdSchema,
  PatrolResultSchema,
  TargetPackageSchema,
  ZonaSchema,
  type Artifact,
  type Investigation,
  type PatrolResult,
} from "./schemas.ts";
// Tipe saja: antarmukanya satu, modulnya tidak ikut terseret (lihat catatan di
// kepala berkas).
import type { RuntimeStore } from "./store.ts";

type Zona = z.infer<typeof ZonaSchema>;

const JAM_MS = 3_600_000;
const KM_PER_NM = 1.852;
const R_BUMI_KM = 6371.0088;

const sha256 = (teks: string): string => createHash("sha256").update(teks, "utf8").digest("hex");

// ---------------------------------------------------------------------------
// Adapter Postgres (produksi) — contracts.md Bagian 1, "append-only"
// ---------------------------------------------------------------------------

/** Satu-satunya bentuk driver yang dibutuhkan adapter: kueri berparameter yang
 *  memulangkan baris. Ditulis sebagai fungsi supaya core tidak menarik
 *  @neondatabase/serverless (apps/web yang menyuntik `sql.query`), dan supaya
 *  tesnya memakai tabel di memori tanpa kerangka mock apa pun. */
export type EksekutorSql = (
  teks: string,
  params: readonly unknown[],
) => Promise<Record<string, unknown>[]>;

export const TABEL_RUNTIME = "runtime_rekaman";

const DDL_TABEL = `CREATE TABLE IF NOT EXISTS ${TABEL_RUNTIME} (
  kunci text NOT NULL,
  idx bigserial PRIMARY KEY,
  rekaman jsonb NOT NULL,
  dibuat timestamptz DEFAULT now()
)`;

/** Setiap baca memfilter kunci; tanpa indeks ia menjadi sequential scan yang
 *  tumbuh seiring SELURUH tulisan runtime, bukan seiring satu investigasi. */
const DDL_INDEKS = `CREATE INDEX IF NOT EXISTS ${TABEL_RUNTIME}_kunci_idx ON ${TABEL_RUNTIME} (kunci, idx)`;

/** Adapter produksi. Urutan baca = urutan tulis (ORDER BY idx pada bigserial),
 *  dan tidak ada satu pun UPDATE atau DELETE di sini — itulah arti append-only
 *  Bagian 1. Kunci masuk sebagai parameter, jadi ia teks buram: containment
 *  jalur yang dipegang adapter filesystem tidak punya padanan (dan tidak punya
 *  bahaya) di sini. */
export function postgresRuntimeStore(eksekutor: EksekutorSql): RuntimeStore {
  // Migrasi idempoten, sekali per proses: Promise yang sama dipakai ulang
  // sehingga dua permintaan serempak tidak berlomba menjalankan DDL. Kegagalan
  // membatalkan memoisasi — sekali gagal bukan berarti gagal selamanya.
  let migrasi: Promise<void> | null = null;
  const siap = (): Promise<void> =>
    (migrasi ??= (async () => {
      await eksekutor(DDL_TABEL, []);
      await eksekutor(DDL_INDEKS, []);
    })().catch((e: unknown) => {
      migrasi = null;
      throw e;
    }));

  return {
    async append(kunci, rekaman) {
      await siap();
      await eksekutor(`INSERT INTO ${TABEL_RUNTIME} (kunci, rekaman) VALUES ($1, $2::jsonb)`, [
        kunci,
        JSON.stringify(rekaman),
      ]);
    },
    async read(kunci) {
      await siap();
      const baris = await eksekutor(
        `SELECT rekaman FROM ${TABEL_RUNTIME} WHERE kunci = $1 ORDER BY idx`,
        [kunci],
      );
      // Driver yang memparse jsonb memulangkan objek; yang tidak, memulangkan
      // teks. Keduanya sah, dan pemanggil tidak boleh peduli yang mana.
      return baris.map((b) =>
        typeof b.rekaman === "string" ? (JSON.parse(b.rekaman) as unknown) : b.rekaman,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Kunci penyimpanan runtime
// ---------------------------------------------------------------------------

export const KUNCI_VALIDASI = "runtime/validasi.jsonl";
export const KUNCI_PAKET = "runtime/paket.jsonl";
export const KUNCI_HASIL = "runtime/hasil-patroli.jsonl";
export const KUNCI_KALIBRASI = "runtime/kalibrasi.jsonl";

/** Indeks grounding runtime per investigasi (Bagian 1). */
export const kunciGrounding = (inv_id: string): string => `runtime/${inv_id}/grounding.jsonl`;

/** Artefak runtime per investigasi. Terpisah dari indeks grounding: indeks
 *  menjawab "boleh dikutip?", berkas ini menjawab "apa isinya?". */
export const kunciArtefak = (inv_id: string): string => `runtime/${inv_id}/artefak.jsonl`;

const tanpaAwalanInv = (inv_id: string): string => inv_id.replace(/^inv-/, "");

/** package_id = "pkg-<inv>" (Bagian 5) — satu paket hidup per investigasi,
 *  jadi pencetakan berulang idempoten alih-alih beranak. */
export const paketIdDari = (inv_id: string): string => `pkg-${tanpaAwalanInv(inv_id)}`;

export const invDariPaketId = (package_id: string): string =>
  `inv-${package_id.replace(/^pkg-/, "")}`;

// ---------------------------------------------------------------------------
// POST /api/validate — aksi validasi analis (Bagian 3)
// ---------------------------------------------------------------------------

export const AksiValidasiSchema = z.enum(["terima", "minta_penguatan", "arsip"]);
export type AksiValidasi = z.infer<typeof AksiValidasiSchema>;

/** Kontrak Bagian 3 menuliskan `action: terima|minta_penguatan|arsip`; jalur
 *  build memakai ejaan `aksi: setuju|tolak`. Keduanya diterima di pintu masuk
 *  dan DINORMALKAN ke kosakata kontrak — dua ejaan yang boleh masuk, satu
 *  kosakata yang tersimpan. */
const SINONIM_AKSI = {
  terima: "terima",
  setuju: "terima",
  minta_penguatan: "minta_penguatan",
  arsip: "arsip",
  tolak: "arsip",
} as const satisfies Record<string, AksiValidasi>;

const EjaanAksiSchema = z.enum(["terima", "minta_penguatan", "arsip", "setuju", "tolak"]);

export const PermintaanValidasiSchema = z
  .object({
    inv_id: InvIdSchema,
    action: EjaanAksiSchema.optional(),
    aksi: EjaanAksiSchema.optional(),
    catatan: z.string().max(500).nullish(),
  })
  .refine((b) => b.action !== undefined || b.aksi !== undefined, {
    error: "wajib memuat `action` (ejaan kontrak) atau `aksi`",
  })
  .transform((b) => ({
    inv_id: b.inv_id,
    aksi: SINONIM_AKSI[(b.action ?? b.aksi) as keyof typeof SINONIM_AKSI],
    catatan: b.catatan ?? null,
  }));

export const RekamanValidasiSchema = z.object({
  jenis: z.literal("aksi_validasi"),
  inv_id: InvIdSchema,
  aksi: AksiValidasiSchema,
  catatan: z.string().nullable(),
  /** Paket yang tercetak oleh aksi ini, bila ada (Bagian 3: "terima" mencetak). */
  package_id: PackageIdSchema.nullable(),
  oleh: z.literal("analis"),
  at: IsoSchema,
});
export type RekamanValidasi = z.infer<typeof RekamanValidasiSchema>;

/** Overlay antrean: aksi TERAKHIR per investigasi. Menimpa pada BACAAN, bukan
 *  pada simpanan — barisnya tetap append-only. status_server tidak ikut
 *  bergeser: keputusan manusia duduk di atasnya, bukan di dalamnya. */
export function overlayValidasi(baris: readonly unknown[]): Map<string, RekamanValidasi> {
  const per = new Map<string, RekamanValidasi>();
  for (const b of baris) {
    const r = RekamanValidasiSchema.safeParse(b);
    if (r.success) per.set(r.data.inv_id, r.data);
  }
  return per;
}

// ---------------------------------------------------------------------------
// Area pencarian (server-side) — Bagian 5
// ---------------------------------------------------------------------------

/** Cincin luar poligon lingkaran. */
export const TITIK_LINGKARAN = 32;

/** Plafon radius. Di atas ini "area pencarian" berhenti bermakna sebagai
 *  penugasan: kapal patroli tidak menyapu lingkaran 300 km. */
export const RADIUS_MAKS_KM = 150;

/** Lantai radius. Nol akan menyatakan posisi PASTI, dan label paket berbunyi
 *  persis sebaliknya ("area pencarian, bukan posisi pasti").
 *  ponytail: 1 km adalah angka tertib untuk galat geolokasi deteksi SAR plus
 *  panjang kapal — knob kalibrasi, bukan konstanta alam. Geser di sini kalau
 *  lapangan bilang lain. */
export const RADIUS_MIN_KM = 1;

/** bbox geometri zona: [lon_min, lat_min, lon_max, lat_max]. Geometri penuhnya
 *  hidup di data/processed/zona/*.geojson, yang TIDAK ikut repo publik maupun
 *  bundel produksi (`data/` ada di .gitignore dan .vercelignore) — yang bisa
 *  dibawa hanyalah kotaknya. Angka = NATUNA_BBOX pada scripts/build_zona_t4.py.
 *  Kedua nilai enum memakai kotak yang sama karena WPP-711-proxy memang
 *  "geometri ZEE-ID terpotong bbox Natuna" (scripts/golden_zona_perilaku_anomali.py). */
export const BBOX_ZONA: Record<Zona, readonly [number, number, number, number]> = {
  "ZEE-ID": [107, 3, 111, 7],
  "WPP-711-proxy": [107, 3, 111, 7],
};

export type Observasi = { art_id: string; lat: number; lon: number; at: string };

/** Posisi observasi TERAKHIR: artefak berposisi (deteksi SAR, fix akhir segmen
 *  AIS) dengan waktu kejadian terbaru. Memakai posisi() dari pasha.ts, bukan
 *  salinan aturan kedua — pusat area patroli dan sumbu waktu PASHA wajib
 *  membaca artefak dengan cara yang sama persis. */
export function observasiTerakhir(artefak: readonly ArtifactLike[]): Observasi | null {
  let terbaik: { art_id: string; t: number; lat: number; lon: number } | null = null;
  for (const a of artefak) {
    const p = posisi(a);
    if (p === null || !Number.isFinite(p.t)) continue;
    if (terbaik === null || p.t > terbaik.t) terbaik = p;
  }
  if (terbaik === null) return null;
  return {
    art_id: terbaik.art_id,
    lat: terbaik.lat,
    lon: terbaik.lon,
    at: new Date(terbaik.t).toISOString(),
  };
}

/** Zona yang benar-benar dinyatakan artefak zone_rule. null = tidak ada
 *  geometri untuk dipotong, dan itu bukan kekurangan yang ditambal tebakan. */
export function zonaDariArtefak(artefak: readonly ArtifactLike[]): Zona | null {
  for (const a of artefak) {
    if (a.type !== "zone_rule") continue;
    const z = ZonaSchema.safeParse((a.payload as { zona?: unknown }).zona);
    if (z.success) return z.data;
  }
  return null;
}

const bulat6 = (v: number): number => Math.round(v * 1e6) / 1e6;

const jepit = (v: number, min: number, maks: number): number => Math.min(Math.max(v, min), maks);

/** Cincin GeoJSON (RFC 7946): TITIK_LINGKARAN simpul berlawanan arah jarum jam,
 *  ditutup dengan mengulang simpul pertama.
 *  ponytail: pemotongan bbox dilakukan dengan MENJEPIT tiap simpul, bukan
 *  memotong poligon secara geometris — hasilnya poligon sah bersisi rata di
 *  tepi zona, cukup untuk area pencarian. Kalau nanti perlu potongan sejati,
 *  ganti fungsi ini dengan Sutherland-Hodgman. Bujur ikut dijepit ke
 *  [-180, 180]: area yang menyeberang antimeridian akan gepeng, dan tak satu
 *  pun AOI produk ini berada di sana. */
function cincinLingkaran(
  lat: number,
  lon: number,
  radius_km: number,
  bbox: readonly [number, number, number, number] | null,
): Array<[number, number]> {
  const dLat = (radius_km / R_BUMI_KM) * (180 / Math.PI);
  // Derajat bujur menyempit dengan lintang; dekat kutub cos -> 0, jadi lebarnya
  // dibatasi supaya lingkaran tidak meledak mengelilingi bumi.
  const dLon = Math.min(dLat / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6), 180);

  const cincin: Array<[number, number]> = [];
  for (let i = 0; i < TITIK_LINGKARAN; i++) {
    const a = (2 * Math.PI * i) / TITIK_LINGKARAN;
    const x = jepit(lon + dLon * Math.cos(a), bbox?.[0] ?? -180, bbox?.[2] ?? 180);
    const y = jepit(lat + dLat * Math.sin(a), bbox?.[1] ?? -90, bbox?.[3] ?? 90);
    cincin.push([bulat6(x), bulat6(y)]);
  }
  cincin.push(cincin[0] as [number, number]);
  return cincin;
}

export type AreaPencarian = {
  center: { lat: number; lon: number };
  radius_km: number;
  heading_sector_deg: null;
  zona_clip: Zona | null;
  /** Poligon GeoJSON, cincin luar tertutup. */
  geometri: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
  /** Bahan hitungan, disimpan supaya paket bisa diaudit tanpa mengulangnya. */
  dasar: {
    art_id: string;
    observed_at: string;
    jam_sejak_observasi: number;
    ambang_kn: number;
    radius_dipotong: boolean;
  };
};

/** Radius = kecepatan maksimum yang masuk akal x waktu sejak observasi, dijepit
 *  di antara lantai dan plafon. ambang_kn datang dari thresholds (DI-SEED dari
 *  experiments/e5/thresholds.lock.json, digeser hanya oleh kalibrasi beraudit),
 *  jadi angka gerbang dan angka area pencarian tidak pernah punya dua sumber. */
export function areaPencarian(
  artefak: readonly ArtifactLike[],
  sekarang: string,
  thresholds: Thresholds,
): AreaPencarian | null {
  const obs = observasiTerakhir(artefak);
  if (obs === null) return null;

  // Observasi di masa depan (jam dinding server meleset) tidak boleh membuat
  // radius negatif; ia jatuh ke nol, lalu ke lantai.
  const jam = Math.max(0, (Date.parse(sekarang) - Date.parse(obs.at)) / JAM_MS);
  const mentah = thresholds.ambang_kn * jam * KM_PER_NM;
  const radius_km = bulat6(jepit(mentah, RADIUS_MIN_KM, RADIUS_MAKS_KM));

  const zona_clip = zonaDariArtefak(artefak);
  const bbox = zona_clip === null ? null : BBOX_ZONA[zona_clip];

  return {
    center: { lat: bulat6(obs.lat), lon: bulat6(obs.lon) },
    radius_km,
    heading_sector_deg: null,
    zona_clip,
    geometri: {
      type: "Polygon",
      coordinates: [cincinLingkaran(obs.lat, obs.lon, radius_km, bbox)],
    },
    dasar: {
      art_id: obs.art_id,
      observed_at: obs.at,
      jam_sejak_observasi: bulat6(jam),
      ambang_kn: thresholds.ambang_kn,
      radius_dipotong: mentah > RADIUS_MAKS_KM,
    },
  };
}

// ---------------------------------------------------------------------------
// TargetPackage (Bagian 5)
// ---------------------------------------------------------------------------

/** Paket yang TERSIMPAN = bentuk kontrak + geometri GeoJSON + jejak hitungan.
 *  Bentuk kontrak tetap ditegakkan oleh TargetPackageSchema di dalamnya;
 *  dua field tambahan bersifat aditif, seperti observed_at pada amandemen K-A1. */
export const PaketRuntimeSchema = TargetPackageSchema.extend({
  area: TargetPackageSchema.shape.area.extend({
    // Amandemen aditif: zona_clip boleh null. Bagian 5 menuliskannya sebagai
    // enum, tetapi lima dari tujuh investigasi golden (termasuk KEDUA kasus
    // berlabel "patroli") tidak punya artefak zone_rule sama sekali; menulis
    // "ZEE-ID" di situ akan mengarang klaim yurisdiksi. null = tidak ada
    // geometri zona yang memotong area ini.
    zona_clip: ZonaSchema.nullable(),
  }),
  geometri: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
  dasar: z.object({
    art_id: ArtIdSchema,
    observed_at: IsoSchema,
    jam_sejak_observasi: z.number(),
    ambang_kn: z.number(),
    radius_dipotong: z.boolean(),
  }),
});
export type PaketRuntime = z.infer<typeof PaketRuntimeSchema>;

export type HasilCetakPaket = { paket: PaketRuntime } | { tolak: string };

/** Server pemilik package_id, issued_at, dan expires_at (Bagian 5) — bukan
 *  agen, bukan klien. Penolakan dipulangkan sebagai kalimat, bukan null, supaya
 *  route bisa mengatakan APA yang kurang. */
export function cetakPaket(
  // Hanya dua bidang yang dibaca. Menuntut Investigation utuh akan memaksa
  // pemanggil mengarang `berkas` yang ditolak grounding (InvestigasiTampil
  // memulangkannya null) padahal paket tidak bergantung padanya sama sekali.
  inv: Pick<Investigation, "inv_id" | "status_server">,
  artefak: readonly ArtifactLike[],
  sekarang: string,
  thresholds: Thresholds,
): HasilCetakPaket {
  const tingkat = inv.status_server.status;
  if (tingkat !== "terkonfirmasi" && tingkat !== "terindikasi") {
    return {
      tolak:
        "Status server investigasi ini ABSTAIN; paket sasaran hanya dicetak untuk status terkonfirmasi atau terindikasi.",
    };
  }

  const area = areaPencarian(artefak, sekarang, thresholds);
  if (area === null) {
    return {
      tolak:
        "Tidak ada artefak berposisi (deteksi SAR atau segmen AIS) pada investigasi ini, sehingga pusat area pencarian tidak dapat dihitung server.",
    };
  }

  const { geometri, dasar, ...bidangArea } = area;
  return {
    paket: PaketRuntimeSchema.parse({
      area: bidangArea,
      // Rujukan ke berkas di Evidence Store, mengikuti gaya geometri_ref
      // as-built ("<path>#<bagian>"). Bukan salinan berkas: paket menunjuk,
      // tidak menggandakan.
      berkas_ringkas_ref: `investigations/${inv.inv_id}/investigation.json#berkas`,
      package_id: paketIdDari(inv.inv_id),
      inv_id: inv.inv_id,
      status_tingkat: tingkat,
      label: "area pencarian, bukan posisi pasti",
      issued_at: sekarang,
      // Paket tidak boleh hidup lebih lama daripada buktinya: usia_max_h adalah
      // ambang yang sama yang meluruhkan status (Bagian 4), bukan angka baru.
      expires_at: new Date(Date.parse(sekarang) + thresholds.usia_max_h * JAM_MS).toISOString(),
      geometri,
      dasar,
    }),
  };
}

export const PermintaanPaketSchema = z.object({ inv_id: InvIdSchema });

/** Paket per package_id, yang terakhir menang. Pencetakan ulang investigasi
 *  yang sama menimpa pada bacaan, jadi daftar patroli tidak pernah memuat dua
 *  paket untuk satu investigasi. */
export function paketTerkini(baris: readonly unknown[]): PaketRuntime[] {
  const per = new Map<string, PaketRuntime>();
  for (const b of baris) {
    const p = PaketRuntimeSchema.safeParse(b);
    if (p.success) per.set(p.data.package_id, p.data);
  }
  return [...per.values()].sort((a, b) => a.package_id.localeCompare(b.package_id));
}

// ---------------------------------------------------------------------------
// POST /api/patrol/results — satu-satunya ingress teks bebas (Bagian 3)
// ---------------------------------------------------------------------------

/** Penolak pola identitas, pendamping penyaring diksi. Bagian 3 menyebut tiga
 *  pola: MMSI 9-digit, callsign, dan awalan nama kapal. Ini batas kepercayaan,
 *  jadi ia sengaja terlalu ketat ke arah menolak: identitas mentah TIDAK PERNAH
 *  keluar server (Bagian 1), dan catatan kru bukan tempat pertamanya bocor. */
export const POLA_IDENTITAS: ReadonlyArray<{ nama: string; pola: RegExp }> = [
  { nama: "mmsi", pola: /(?<!\d)\d{9}(?!\d)/ },
  // Callsign maritim ITU: 1-3 huruf, sebuah angka, lalu 1-4 alfanumerik.
  { nama: "callsign", pola: /(?<![A-Z0-9])[A-Z]{1,3}\d[A-Z0-9]{1,4}(?![A-Z0-9])/ },
  { nama: "nama_kapal", pola: /(?<![\p{L}\p{N}])(?:KM|KMN|KLM|MV|M\/V|FV|MT|TB|TK|KRI|SPOB)\.?\s+\p{L}/iu },
];

export function cekIdentitas(teks: string): { ok: boolean; pola: string[] } {
  const kena = POLA_IDENTITAS.filter((p) => p.pola.test(teks)).map((p) => p.nama);
  return { ok: kena.length === 0, pola: kena };
}

/** Gerbang teks bebas: diksi (Bagian 7) lalu identitas (Bagian 3), keduanya
 *  SEBELUM tulisan. `null` = lolos. */
export function tolakTeksBebas(teks: string, bidang: string): string | null {
  const diksi = cekDiksi(teks);
  if (!diksi.ok) {
    return `Kolom ${bidang} memuat kata bernada putusan yang tidak boleh tampil (${diksi.kata.join(", ")}); tulis ulang sebagai pengamatan.`;
  }
  const identitas = cekIdentitas(teks);
  if (!identitas.ok) {
    return `Kolom ${bidang} memuat pola identitas kapal (${identitas.pola.join(", ")}); identitas mentah tidak pernah keluar server, tulis ulang tanpa nomor atau nama.`;
  }
  return null;
}

const SINONIM_FINDING = {
  sesuai: "sesuai",
  berbeda: "berbeda",
  tidak_sesuai: "berbeda",
  tidak_ditemukan: "tidak_ditemukan",
  tidak_terjangkau: "tidak_terjangkau",
} as const;

const EjaanFindingSchema = z.enum([
  "sesuai",
  "berbeda",
  "tidak_sesuai",
  "tidak_ditemukan",
  "tidak_terjangkau",
]);

/** Sama seperti validasi: dua ejaan boleh masuk (`package_id`/`paket_id`,
 *  `finding`/`hasil`, `note`/`catatan`), satu kosakata tersimpan. */
export const PermintaanHasilSchema = z
  .object({
    package_id: PackageIdSchema.optional(),
    paket_id: PackageIdSchema.optional(),
    finding: EjaanFindingSchema.optional(),
    hasil: EjaanFindingSchema.optional(),
    note: z.string().max(500).nullish(),
    catatan: z.string().max(500).nullish(),
    posisi: z.object({ lat: LatSchema, lon: LonSchema }).nullish(),
    submitted_at: IsoSchema.optional(),
  })
  .refine((b) => b.package_id !== undefined || b.paket_id !== undefined, {
    error: "wajib memuat `package_id` (ejaan kontrak) atau `paket_id`",
  })
  .refine((b) => b.finding !== undefined || b.hasil !== undefined, {
    error: "wajib memuat `finding` (ejaan kontrak) atau `hasil`",
  })
  .transform((b) => ({
    package_id: (b.package_id ?? b.paket_id) as string,
    finding: SINONIM_FINDING[(b.finding ?? b.hasil) as keyof typeof SINONIM_FINDING],
    note: b.note ?? b.catatan ?? "",
    posisi: b.posisi ?? null,
    submitted_at: b.submitted_at ?? null,
  }));

/** Baris hasil yang tersimpan: PatrolResult kontrak + posisi kru (opsional) +
 *  art_id laporan yang lahir darinya. `posisi` sengaja TIDAK masuk payload
 *  artefak: payload patrol_report dibekukan pada empat field Bagian 1, dan
 *  field kelima akan dibuang zod saat dibaca ulang — hash artefak lalu tidak
 *  lagi cocok dengan isinya. */
export const RekamanHasilSchema = PatrolResultSchema.extend({
  inv_id: InvIdSchema,
  art_id: ArtIdSchema,
  posisi: z.object({ lat: LatSchema, lon: LonSchema }).nullable(),
  at: IsoSchema,
});
export type RekamanHasil = z.infer<typeof RekamanHasilSchema>;

/** Artefak patrol_report ber-hash kanonis — konvensi yang SAMA PERSIS dengan
 *  artefak golden: sha256 atas JSON kanonis (kunci terurut rekursif, tanpa
 *  spasi) dari seluruh artefak TANPA field hash_sha256 (scripts/e5_compose.py,
 *  scripts/golden_denmark_asosiasi.py).
 *
 *  Ruas terakhir art_id adalah sidik payload, bukan nomor urut: dua kru yang
 *  mengirim serempak tidak bisa saling menimpa, dan kiriman ulang yang identik
 *  (antrean offline patroli) menghasilkan art_id yang sama alih-alih artefak
 *  kembar. */
export function artefakPatrolReport(
  hasil: PatrolResult,
  inv_id: string,
  sekarang: string,
): Artifact {
  const payload = {
    package_id: hasil.package_id,
    finding: hasil.finding,
    note: hasil.note,
    submitted_at: hasil.submitted_at,
  };
  const inti = {
    art_id: `a-${tanpaAwalanInv(inv_id)}-pr${sha256(canonicalJson(payload)).slice(0, 8)}`,
    inv_id,
    type: "patrol_report" as const,
    source: {
      dataset: "runtime" as const,
      ref: hasil.package_id,
      provenance: `Laporan pemeriksaan kru patroli atas paket ${hasil.package_id}, dikirim ${hasil.submitted_at} lewat POST /api/patrol/results dan ditulis ke Evidence Store runtime. Catatan kru sudah melewati penyaring diksi dan penolak pola identitas sebelum ditulis; ini kesaksian lapangan, bukan akuisisi sensor.`,
    },
    sintetis: false,
    payload,
    created_at: sekarang,
    // Waktu kejadian dunia nyata laporan = saat kru mengirimkannya (K-A1).
    observed_at: hasil.submitted_at,
  };
  return ArtifactSchema.parse({ ...inti, hash_sha256: sha256(canonicalJson(inti)) });
}

// ---------------------------------------------------------------------------
// POST/GET /api/calibration — delta A10 beraudit (Bagian 3 + 4)
// ---------------------------------------------------------------------------

export const AMBANG_PARAM = ["ambang_kn", "usia_max_h", "konflik_jendela_jam"] as const;

export const PermintaanKalibrasiSchema = z
  .object({
    ambang: z.object({
      ambang_kn: z.number().positive().optional(),
      usia_max_h: z.number().positive().optional(),
      konflik_jendela_jam: z.number().positive().optional(),
    }),
    alasan: z.string().min(1).max(500),
    basis_art_ids: z.array(ArtIdSchema).default([]),
    sumber_package_id: PackageIdSchema.nullish(),
  })
  .refine((b) => AMBANG_PARAM.some((p) => b.ambang[p] !== undefined), {
    error: "`ambang` wajib memuat sedikitnya satu dari ambang_kn, usia_max_h, konflik_jendela_jam",
  });

/** Satu baris per parameter yang berubah — bentuk item GET /api/calibration
 *  Bagian 3, ditambah `alasan` (jejak audit yang dituntut jalur tulis). */
export const DeltaKalibrasiSchema = z.object({
  param: z.enum(AMBANG_PARAM),
  lama: z.number(),
  baru: z.number(),
  basis_art_ids: z.array(ArtIdSchema),
  sumber_package_id: PackageIdSchema.nullable(),
  alasan: z.string(),
  at: IsoSchema,
});
export type DeltaKalibrasi = z.infer<typeof DeltaKalibrasiSchema>;

/** Ambang efektif = seed lock + overlay delta beraudit, diterapkan berurutan
 *  (yang terakhir menang per parameter). experiments/e5/thresholds.lock.json
 *  TIDAK PERNAH ditulis: ia seed sejarah yang memayungi angka paper. */
export function ambangEfektif(seed: Thresholds, baris: readonly unknown[]): Thresholds {
  const efektif = { ...seed };
  for (const b of baris) {
    const d = DeltaKalibrasiSchema.safeParse(b);
    if (d.success) efektif[d.data.param] = d.data.baru;
  }
  return efektif;
}

/** Delta untuk parameter yang SUNGGUH berubah. Menulis "50 -> 50" akan mengisi
 *  jejak audit dengan peristiwa yang tidak terjadi. */
export function deltaKalibrasi(
  efektif: Thresholds,
  minta: z.infer<typeof PermintaanKalibrasiSchema>,
  sekarang: string,
): DeltaKalibrasi[] {
  return AMBANG_PARAM.flatMap((param) => {
    const baru = minta.ambang[param];
    if (baru === undefined || baru === efektif[param]) return [];
    return [
      {
        param,
        lama: efektif[param],
        baru,
        basis_art_ids: minta.basis_art_ids,
        sumber_package_id: minta.sumber_package_id ?? null,
        alasan: minta.alasan,
        at: sekarang,
      },
    ];
  });
}

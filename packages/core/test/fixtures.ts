// ============================================================================
// FIXTURE SINTETIS — TIDAK ADA DATA NYATA DI BERKAS INI.
// Gaya nilai meniru rezim operasional (koordinat Laut Natuna Utara ~3-5 LU /
// 106-109 BT, ZEE-ID, mmsi_hash 16-hex, scene xView3-style) SUPAYA tes menekan
// jalur kode yang sama dengan produksi, tetapi SETIAP angka di sini dikarang
// oleh penulis tes. Semua artefak diberi label `sintetis: true` sesuai
// contracts.md Bagian 0 ("sintetis tanpa label = defect").
//
// mmsi_hash di bawah BUKAN HMAC dari MMSI mana pun; ia string 16-hex acak.
// ============================================================================

/** Bentuk longgar; skema zod yang mengikat hidup di src/schemas.ts (belum ada). */
export type ArtifactFixture = {
  art_id: string;
  inv_id: string;
  type: string;
  source: { dataset: string; ref: string; provenance: string };
  sintetis: boolean;
  payload: Record<string, unknown>;
  created_at: string;
  hash_sha256: string;
};

export const INV = "inv-natuna-20260809-001";
export const SEED = 20260809;

/** 16-hex, sintetis (bukan HMAC MMSI apa pun). Bagian 1: mmsi_hash = 16-hex. */
export const MMSI_HASH = "9f3c1a77b2e05d64";
export const MMSI_HASH_B = "4b81de02c7a63f15";

/** Garis waktu bersama. Jendela "going-dark" = [gapStart, gapEnd]; akuisisi SAR
 *  jatuh DI DALAM jendela itu (itulah yang membuat kasus going-dark koheren),
 *  dan jendela sudah TERTUTUP sebelum `now` — kontrak Bagian 4 menyebut
 *  "ais_gap historis", bukan celah yang masih berjalan. */
export const T = {
  gapStart: "2026-08-08T20:00:00.000Z",
  acq: "2026-08-09T02:00:00.000Z",
  gapEnd: "2026-08-09T03:00:00.000Z",
  /** 2 jam setelah akuisisi — jauh di bawah ambang usia. */
  now: "2026-08-09T04:00:00.000Z",
  /** 122 jam setelah akuisisi — di atas ambang usia (72 j). */
  nowLewatAmbang: "2026-08-14T04:00:00.000Z",
} as const;

/** Koordinat sintetis di Laut Natuna Utara. */
export const POS = {
  a: { lat: 3.9412, lon: 108.2137 },
  /** ~110 km utara POS.a — dipakai untuk pasangan posisi tak-terdamaikan. */
  bJauh: { lat: 4.9312, lon: 108.2137 },
  /** ~2 km dari POS.a — masih terdamaikan pada dt kecil. */
  bDekat: { lat: 3.9592, lon: 108.2137 },
} as const;

/** sha256 sintetis: 64-hex deterministik dari seed teks, cukup untuk lolos regex. */
export function hexHash(seedStr: string): string {
  let h = 0x811c9dc5;
  let out = "";
  for (let i = 0; i < 8; i++) {
    for (const ch of `${seedStr}:${i}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** art_id = "a-<inv>-<seq>" (Bagian 1). `<inv>` dibaca sebagai token yang sama
 *  dengan pada `inv-<...>`, yaitu inv_id tanpa awalan "inv-" — kalau tidak,
 *  setiap art_id akan berbunyi "a-inv-...". */
export function artId(seqStr: string): string {
  return `a-${INV.replace(/^inv-/, "")}-${seqStr}`;
}

/** package_id = "pkg-<inv>" (Bagian 5), `<inv>` dibaca sama seperti pada artId. */
export const PKG_ID = `pkg-${INV.replace(/^inv-/, "")}`;

let seq = 0;
/** Nomor urut art_id bersifat global-per-proses; tes tidak boleh bergantung padanya. */
export function resetSeq(): void {
  seq = 0;
}

export function art(
  type: string,
  payload: Record<string, unknown>,
  over: Partial<ArtifactFixture> = {},
): ArtifactFixture {
  seq += 1;
  const art_id = over.art_id ?? artId(String(seq).padStart(3, "0"));
  return {
    art_id,
    inv_id: INV,
    type,
    source: {
      dataset: "cdse-natuna",
      ref: "S1A_IW_GRDH_1SDV_20260809T020000_SINTETIS",
      provenance: "Fixture sintetis penulis tes; bukan akuisisi nyata.",
    },
    sintetis: true,
    payload,
    created_at: T.acq,
    hash_sha256: hexHash(art_id),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pembentuk artefak per type (payload wajib sesuai contracts.md Bagian 1).
// ---------------------------------------------------------------------------

export const mk = {
  sar: (
    over: Partial<ArtifactFixture> = {},
    pos: { lat: number; lon: number } = POS.a,
    payloadPatch: Record<string, unknown> = {},
  ) =>
    art(
      "sar_detection",
      {
        lat: pos.lat,
        lon: pos.lon,
        row: 4821,
        col: 9137,
        length_m_est: 41.6,
        objectness_p: 0.93,
        vessel_p: 0.91,
        fishing_p: 0.74,
        confidence_calibrated: 0.82,
        scene_id: "S1A-SINTETIS-0001",
        ...payloadPatch,
      },
      over,
    ),

  aisTrack: (over: Partial<ArtifactFixture> = {}) =>
    art(
      "ais_track_segment",
      {
        mmsi_hash: MMSI_HASH,
        points: [
          { t: "2026-08-09T01:30:00.000Z", lat: 3.9101, lon: 108.1902, sog: 8.2, cog: 41.5 },
          { t: "2026-08-09T02:00:00.000Z", lat: 3.9412, lon: 108.2137, sog: 8.0, cog: 42.1 },
        ],
        start: "2026-08-09T01:30:00.000Z",
        end: "2026-08-09T02:00:00.000Z",
      },
      over,
    ),

  aisGap: (over: Partial<ArtifactFixture> = {}) =>
    art(
      "ais_gap",
      {
        mmsi_hash: MMSI_HASH,
        t_start: T.gapStart,
        t_end: T.gapEnd,
        durasi_jam: 7,
        sog_sebelum: 8.2,
      },
      over,
    ),

  aisAnomaly: (over: Partial<ArtifactFixture> = {}) =>
    art(
      "ais_anomaly",
      {
        jenis: "gap",
        skor: 0.88,
        model_ref: "e2-anomali-v1",
        detail: { durasi_jam: 6, konteks: "sintetis" },
      },
      over,
    ),

  zone: (violation: boolean, over: Partial<ArtifactFixture> = {}) =>
    art(
      "zone_rule",
      {
        zona: "ZEE-ID",
        posisi: "inside",
        violation,
        basis_aturan: "T4-R07",
        geometri_ref: "marineregions-eez/idn-200nm",
      },
      { source: { dataset: "marineregions-eez", ref: "IDN-EEZ", provenance: "Fixture sintetis." }, ...over },
    ),

  behavior: (over: Partial<ArtifactFixture> = {}) =>
    art("behavior_class", { kelas: "fishing", skor: 0.79, model_ref: "e3-temporal-v1" }, over),

  assoc: (det_art_id: string, track_art_id: string | null, over: Partial<ArtifactFixture> = {}) =>
    art(
      "assoc_result",
      { det_art_id, track_art_id, cost: 0.31, metode: "hungarian", dark: track_art_id === null },
      over,
    ),

  kinematic: (gap_art_id: string, det_art_id: string, lolos: boolean, over: Partial<ArtifactFixture> = {}) =>
    art(
      "kinematic_feasibility",
      {
        gap_art_id,
        det_art_id,
        jarak_km: lolos ? 18.4 : 612.0,
        dt_jam: 2,
        sog_implied: lolos ? 4.97 : 165.2,
        ambang_kn: 25,
        lolos,
      },
      over,
    ),

  weather: (over: Partial<ArtifactFixture> = {}) =>
    art(
      "weather",
      { t: T.acq, lat: POS.a.lat, lon: POS.a.lon, wave_m: 1.4, wind_ms: 6.1, sumber: "open-meteo" },
      { source: { dataset: "open-meteo", ref: "3.94N108.21E", provenance: "Fixture sintetis." }, ...over },
    ),

  patrol: (over: Partial<ArtifactFixture> = {}) =>
    art(
      "patrol_report",
      {
        package_id: PKG_ID,
        finding: "sesuai",
        note: "Kapal terlihat menarik alat tangkap di area pencarian.",
        submitted_at: "2026-08-09T03:40:00.000Z",
      },
      { source: { dataset: "runtime", ref: PKG_ID, provenance: "Fixture sintetis." }, ...over },
    ),
};

// ---------------------------------------------------------------------------
// Utilitas fixture-negatif untuk tes skema.
// ---------------------------------------------------------------------------

/** Salinan dalam tanpa satu kunci (dukung jalur bertitik: "payload.lat"). */
export function tanpaKunci<T>(obj: T, path: string): unknown {
  const salinan = structuredClone(obj) as Record<string, unknown>;
  const bagian = path.split(".");
  let node: Record<string, unknown> = salinan;
  for (const k of bagian.slice(0, -1)) node = node[k] as Record<string, unknown>;
  delete node[bagian[bagian.length - 1] as string];
  return salinan;
}

/** Salinan dalam dengan satu kunci ditimpa (dukung jalur bertitik). */
export function dengan<T>(obj: T, path: string, nilai: unknown): unknown {
  const salinan = structuredClone(obj) as Record<string, unknown>;
  const bagian = path.split(".");
  let node: Record<string, unknown> = salinan;
  for (const k of bagian.slice(0, -1)) node = node[k] as Record<string, unknown>;
  node[bagian[bagian.length - 1] as string] = nilai;
  return salinan;
}

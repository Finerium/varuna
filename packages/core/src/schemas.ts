// Skema kontrak VARUNA (zod) — contracts.md Bagian 1, 2, 3, 5.
// Satu sumber skema untuk validasi server DAN structured outputs agen
// (architecture.md, "Rasional TS tunggal").
//
// Catatan interpretasi (kontrak diam soal detail ini; dipilih bacaan paling
// sederhana yang memenuhi teks):
// - `<inv>` pada pola "a-<inv>-<seq>" dan "pkg-<inv>" = inv_id TANPA awalan
//   "inv-". Golden as-built memakainya persis begitu: inv-dk-01 -> a-dk-01-b01.
// - Objek TIDAK strict terhadap kunci asing (kontrak tidak menuntutnya); kunci
//   tak dikenal dibuang oleh zod, tidak menolak dokumen.
// - Semua stempel waktu ISO8601 wajib membawa zona (Z atau offset); seluruh
//   golden as-built memakai "Z".

import { z } from "zod";

import type { StatusServer } from "./pasha.ts";

// ---------------------------------------------------------------------------
// Primitif
// ---------------------------------------------------------------------------

/** "a-<inv>-<seq>" — minimal tiga ruas, jadi "a-1" ditolak. */
export const ArtIdSchema = z
  .string()
  .regex(/^a-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/, "art_id harus berpola a-<inv>-<seq>");

export const InvIdSchema = z
  .string()
  .regex(/^inv-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, "inv_id harus berawalan inv-");

export const PackageIdSchema = z
  .string()
  .regex(/^pkg-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, "package_id harus berpola pkg-<inv>");

/** sha256 heksadesimal huruf kecil. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "wajib 64 heksadesimal huruf kecil");

/** mmsi_hash = HMAC-SHA256 dipotong 16-hex; pseudonim, bukan MMSI mentah. */
export const MmsiHashSchema = z.string().regex(/^[0-9a-f]{16}$/, "mmsi_hash wajib 16 heksadesimal");

export const IsoSchema = z.iso.datetime({ offset: true });

export const LatSchema = z.number().min(-90).max(90);
export const LonSchema = z.number().min(-180).max(180);

export const ZonaSchema = z.enum(["ZEE-ID", "WPP-711-proxy"]);
export const StatusWireSchema = z.enum(["terkonfirmasi", "terindikasi", "abstain"]);
export const FindingSchema = z.enum(["sesuai", "berbeda", "tidak_ditemukan", "tidak_terjangkau"]);
export const ModalitasSchema = z.enum(["SAR", "AIS"]);

// ---------------------------------------------------------------------------
// Artifact (Bagian 1)
// ---------------------------------------------------------------------------

export const SourceSchema = z.object({
  dataset: z.enum([
    "xview3-public",
    "cdse-natuna",
    "cdse-denmark",
    "dma-aisdk",
    "gfw-events",
    "marineregions-eez",
    "open-meteo",
    "runtime",
  ]),
  ref: z.string(),
  provenance: z.string().min(1, "provenance wajib berisi kalimat"),
});

/** Field perseptual boleh null (golden a-dk-01-d01: target placeholder tanpa
 *  angka yang dikarang), tetapi kuncinya wajib hadir. lat/lon/scene_id tidak. */
const SarDetectionPayload = z.object({
  lat: LatSchema,
  lon: LonSchema,
  row: z.number().nullable(),
  col: z.number().nullable(),
  length_m_est: z.number().nullable(),
  objectness_p: z.number().nullable(),
  vessel_p: z.number().nullable(),
  fishing_p: z.number().nullable(),
  confidence_calibrated: z.number().nullable(),
  scene_id: z.string(),
});

const AisTrackSegmentPayload = z.object({
  mmsi_hash: MmsiHashSchema,
  points: z.array(
    z.object({ t: IsoSchema, lat: LatSchema, lon: LonSchema, sog: z.number(), cog: z.number() }),
  ),
  start: IsoSchema,
  end: IsoSchema,
});

const AisGapPayload = z.object({
  mmsi_hash: MmsiHashSchema,
  t_start: IsoSchema,
  t_end: IsoSchema,
  durasi_jam: z.number(),
  sog_sebelum: z.number(),
});

const AisAnomalyPayload = z.object({
  jenis: z.enum(["gap", "spoofing", "ganti_identitas"]),
  skor: z.number(),
  model_ref: z.string(),
  detail: z.record(z.string(), z.unknown()),
});

const ZoneRulePayload = z.object({
  zona: ZonaSchema,
  posisi: z.enum(["inside", "outside"]),
  violation: z.boolean(),
  basis_aturan: z.string(),
  geometri_ref: z.string(),
});

const BehaviorClassPayload = z.object({
  kelas: z.enum(["fishing", "transit"]),
  skor: z.number(),
  model_ref: z.string(),
});

const AssocResultPayload = z.object({
  det_art_id: ArtIdSchema,
  track_art_id: ArtIdSchema.nullable(),
  cost: z.number(),
  metode: z.literal("hungarian"),
  dark: z.boolean(),
});

const KinematicFeasibilityPayload = z.object({
  gap_art_id: ArtIdSchema,
  det_art_id: ArtIdSchema,
  jarak_km: z.number(),
  dt_jam: z.number(),
  sog_implied: z.number(),
  ambang_kn: z.number(),
  lolos: z.boolean(),
});

/** Konteks, BUKAN modalitas sensor (Bagian 1, kalimat penutup). */
const WeatherPayload = z.object({
  t: IsoSchema,
  lat: LatSchema,
  lon: LonSchema,
  wave_m: z.number(),
  wind_ms: z.number(),
  sumber: z.literal("open-meteo"),
});

const PatrolReportPayload = z.object({
  package_id: PackageIdSchema,
  finding: FindingSchema,
  note: z.string(),
  submitted_at: IsoSchema,
});

const amplopArtefak = {
  art_id: ArtIdSchema,
  inv_id: InvIdSchema,
  source: SourceSchema,
  sintetis: z.boolean(),
  created_at: IsoSchema,
  /** Amandemen K-A1: waktu kejadian dunia nyata (akuisisi scene, akhir segmen
   *  AIS). OPSIONAL dan aditif — artefak golden as-built ditulis sebelum
   *  amandemen dan tetap sah. Usia bukti memakai observed_at, created_at hanya
   *  fallback (pasha.ts). */
  observed_at: IsoSchema.nullable().optional(),
  hash_sha256: Sha256Schema,
};

const varianArtefak = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  z.object({ ...amplopArtefak, type: z.literal(type), payload });

export const ArtifactSchema = z.discriminatedUnion("type", [
  varianArtefak("sar_detection", SarDetectionPayload),
  varianArtefak("ais_track_segment", AisTrackSegmentPayload),
  varianArtefak("ais_gap", AisGapPayload),
  varianArtefak("ais_anomaly", AisAnomalyPayload),
  varianArtefak("zone_rule", ZoneRulePayload),
  varianArtefak("behavior_class", BehaviorClassPayload),
  varianArtefak("assoc_result", AssocResultPayload),
  varianArtefak("kinematic_feasibility", KinematicFeasibilityPayload),
  varianArtefak("weather", WeatherPayload),
  varianArtefak("patrol_report", PatrolReportPayload),
]);

// ---------------------------------------------------------------------------
// StatusServer (Bagian 1 + 4)
// ---------------------------------------------------------------------------

export const RuleSchema = z.enum([
  "dua_sensor",
  "zona",
  "kinematik_gap",
  "usia",
  "konflik",
  "cakupan",
]);

export const AbstainReasonSchema = z.enum([
  "bukti_tunggal",
  "konflik_artefak",
  "kurang_cakupan",
  "kedaluwarsa_tanpa_penguatan",
]);

export const DisplayStateSchema = z.enum(["degraded", "kosong", "error", "kedaluwarsa"]);

export const StatusServerSchema = z.object({
  status: StatusWireSchema,
  computed_at: IsoSchema,
  hash: Sha256Schema,
  sensors_independent: z.number().int().min(0),
  zone_violation: z.boolean(),
  evidence_age_h: z.number(),
  decay_applied: z.boolean(),
  conflicting_art_ids: z.array(ArtIdSchema),
  missing_coverage: z.array(ModalitasSchema),
  reasons: z.array(z.object({ rule: RuleSchema, passed: z.boolean(), art_ids: z.array(ArtIdSchema) })),
  abstain_reason: AbstainReasonSchema.nullable(),
  display_state: z.array(DisplayStateSchema),
});

/** Bagian 4 menuliskan `reasons` sebagai berkas keputusan lengkap: keenam rule
 *  hadir persis sekali, yang tidak menyala tercatat `passed: false` — status
 *  tanpa satu rule berarti aturan itu tidak pernah dijalankan, bukan lulus.
 *  computeStatus selalu memancarkan keenamnya; skema ini yang menahan pintu
 *  bagi status_server yang DITULIS (pembangun golden set, tulisan runtime).
 *
 *  Kenapa varian terpisah, bukan refinement pada StatusServerSchema: suite
 *  kontrak yang dibekukan sebelum amandemen memarse fixture status_server
 *  parsial (dua rule) lewat StatusServerSchema, dan tes lama tidak boleh
 *  berubah. Jalur BACA tetap longgar (investigasi as-built ber-reasons parsial
 *  masih tampil apa adanya); jalur TULIS memakai skema ini.
 *  ponytail: gabungkan keduanya begitu fixture tes kontrak ikut diamandemen —
 *  hapus varian ini dan pindahkan .refine() ke StatusServerSchema. */
export const StatusServerKetatSchema = StatusServerSchema.refine(
  (s) => s.reasons.length === 6 && new Set(s.reasons.map((r) => r.rule)).size === 6,
  { error: "reasons wajib memuat keenam rule Bagian 4 persis sekali masing-masing" },
);

// ---------------------------------------------------------------------------
// TargetPackage + PatrolResult (Bagian 5)
// ---------------------------------------------------------------------------

export const TargetPackageDraftSchema = z.object({
  area: z.object({
    center: z.object({ lat: LatSchema, lon: LonSchema }),
    radius_km: z.number(),
    heading_sector_deg: z.tuple([z.number(), z.number()]).nullable(),
    zona_clip: ZonaSchema,
  }),
  berkas_ringkas_ref: z.string(),
});

export const TargetPackageSchema = TargetPackageDraftSchema.extend({
  package_id: PackageIdSchema,
  inv_id: InvIdSchema,
  status_tingkat: z.enum(["terkonfirmasi", "terindikasi"]),
  label: z.literal("area pencarian, bukan posisi pasti"),
  issued_at: IsoSchema,
  expires_at: IsoSchema,
});

export const PatrolResultSchema = z.object({
  package_id: PackageIdSchema,
  finding: FindingSchema,
  note: z.string().max(500),
  submitted_at: IsoSchema,
  by_role: z.literal("patroli"),
});

// ---------------------------------------------------------------------------
// Investigation (Bagian 1)
// ---------------------------------------------------------------------------

export const BerkasSectionSchema = z.object({ claim: z.string(), art_ids: z.array(ArtIdSchema) });

export const InvestigationSchema = z.object({
  inv_id: InvIdSchema,
  seed: z.literal(20260809),
  aoi: z.union([z.literal("natuna"), z.literal("denmark"), z.string().regex(/^xview3-.+$/)]),
  zona: ZonaSchema.nullable(),
  t_acquisition: IsoSchema,
  t_observasi_terakhir: IsoSchema,
  split: z.enum(["kalibrasi", "pelaporan", "demo"]),
  sintetis: z.boolean(),
  kasus: z.object({
    label: z.enum([
      "going-dark",
      "spoofing",
      "alih-muatan",
      "abstain",
      "peluruhan",
      "asosiasi-denmark",
      "patroli",
    ]),
    peran_demo: z.string(),
  }),
  candidate: z.object({
    lat: LatSchema,
    lon: LonSchema,
    length_m_est: z.number(),
    confidence_calibrated: z.number(),
  }),
  artifacts: z.array(ArtIdSchema),
  status_server: StatusServerSchema,
  agent_proposal: z
    .object({ status_usulan: z.string(), trace_ref: z.string() })
    .nullable(),
  berkas: z.object({ sections: z.array(BerkasSectionSchema), diksi_ok: z.boolean() }),
  patrol: z.object({
    package_id: PackageIdSchema.nullable(),
    result: PatrolResultSchema.nullable(),
  }),
});

/** index/manifest.json — daftar inv ringan (Bagian 1). `kasus` null pada
 *  investigasi golden yang belum diberi label kasus. */
export const ManifestSchema = z.object({
  items: z.array(
    z.object({
      inv_id: InvIdSchema,
      split: z.enum(["kalibrasi", "pelaporan", "demo"]),
      kasus: z.string().nullable(),
    }),
  ),
});

/** grounding.json per-investigasi dan indeks runtime append-only. */
export const GroundingIndexSchema = z.object({
  art_ids: z.array(ArtIdSchema),
  hash: z.record(ArtIdSchema, Sha256Schema),
});

// ---------------------------------------------------------------------------
// Envelope agen (Bagian 2) + ringkasan antrean (Bagian 3)
// ---------------------------------------------------------------------------

export const AgentIdSchema = z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);

export const AgentEnvelopeSchema = z.object({
  agent: AgentIdSchema,
  inv_id: InvIdSchema,
  output: z.record(z.string(), z.unknown()),
  artifacts_cited: z.array(ArtIdSchema),
  status: z.enum(["ok", "retry_fixed", "discarded"]),
});

export const InvestigationSummarySchema = z.object({
  inv_id: InvIdSchema,
  status: StatusWireSchema,
  sensors_independent: z.number().int().min(0),
  zona: ZonaSchema.nullable(),
  evidence_age_h: z.number(),
  t_acquisition: IsoSchema,
  t_observasi_terakhir: IsoSchema,
  aoi: z.string(),
  kasus_label: z.string().nullable(),
  display_state: z.array(DisplayStateSchema),
});

// ---------------------------------------------------------------------------
// Tipe turunan
// ---------------------------------------------------------------------------

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactType = Artifact["type"];
export type Source = z.infer<typeof SourceSchema>;
export type StatusServerZod = z.infer<typeof StatusServerSchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type InvestigationSummary = z.infer<typeof InvestigationSummarySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type GroundingIndex = z.infer<typeof GroundingIndexSchema>;
export type TargetPackageDraft = z.infer<typeof TargetPackageDraftSchema>;
export type TargetPackage = z.infer<typeof TargetPackageSchema>;
export type PatrolResult = z.infer<typeof PatrolResultSchema>;
export type AgentEnvelope = z.infer<typeof AgentEnvelopeSchema>;
export type BerkasSection = z.infer<typeof BerkasSectionSchema>;

/** Penjaga waktu-kompilasi: bentuk zod dan tipe murni pasha.ts wajib sama.
 *  Kalau salah satu bergeser, typecheck gagal di sini, bukan di produksi. */
export const statusZodCocokDenganPasha = (s: StatusServerZod): StatusServer => s;

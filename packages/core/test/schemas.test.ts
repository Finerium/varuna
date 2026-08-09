import { describe, expect, it } from "vitest";

import { computeStatus } from "../src/pasha";
import {
  AgentEnvelopeSchema,
  ArtifactSchema,
  InvestigationSchema,
  PatrolResultSchema,
  StatusServerKetatSchema,
  StatusServerSchema,
  TargetPackageDraftSchema,
  TargetPackageSchema,
} from "../src/schemas";
import {
  INV,
  PKG_ID,
  POS,
  SEED,
  T,
  artId,
  dengan,
  hexHash,
  mk,
  resetSeq,
  tanpaKunci,
} from "./fixtures";

// ============================================================================
// Skema kontrak (zod) — contracts.md Bagian 1, 2, 5.
// DITULIS SEBELUM IMPLEMENTASI. Semua fixture SINTETIS (lihat test/fixtures.ts).
//
// Kontrak: "Kontrak: zod parse fixture dua arah per skema" (architecture.md).
// Tes ini adalah arah itu: fixture SAH harus parse, fixture CACAT harus ditolak.
//
// Interpretasi (kontrak tidak menuliskan nama ekspor):
// S1. Nama skema = <Nama>Schema di packages/core/src/schemas.ts (arsitektur
//     hanya menyebut "zod schemas (kontrak)"; nama berkas dipilih paling polos).
// S2. `<inv>` pada pola "a-<inv>-<seq>" dan "pkg-<inv>" = inv_id tanpa awalan
//     "inv-" (lihat catatan di test/fixtures.ts).
// S3. `type` + `payload` adalah discriminated union: payload salah-type ditolak.
// S4. Tes ini TIDAK menetapkan apakah objek strict terhadap kunci asing —
//     kontrak diam soal itu, jadi tidak diuji.
// ============================================================================

const bolehParse = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

// ---------------------------------------------------------------------------
// Artifact (Bagian 1)
// ---------------------------------------------------------------------------

resetSeq();
const A = {
  sar: mk.sar(),
  aisTrack: mk.aisTrack(),
  aisGap: mk.aisGap(),
  aisAnomaly: mk.aisAnomaly(),
  zone: mk.zone(true),
  behavior: mk.behavior(),
  assoc: mk.assoc(artId("001"), artId("002")),
  kinematic: mk.kinematic(artId("003"), artId("001"), true),
  weather: mk.weather(),
  patrol: mk.patrol(),
};

/** [type, fixture sah, jalur payload wajib yang dihapus di varian cacat] */
const PER_TYPE: Array<[string, unknown, string]> = [
  ["sar_detection", A.sar, "payload.lat"],
  ["ais_track_segment", A.aisTrack, "payload.points"],
  ["ais_gap", A.aisGap, "payload.durasi_jam"],
  ["ais_anomaly", A.aisAnomaly, "payload.skor"],
  ["zone_rule", A.zone, "payload.violation"],
  ["behavior_class", A.behavior, "payload.kelas"],
  ["assoc_result", A.assoc, "payload.metode"],
  ["kinematic_feasibility", A.kinematic, "payload.lolos"],
  ["weather", A.weather, "payload.wave_m"],
  ["patrol_report", A.patrol, "payload.finding"],
];

describe("ArtifactSchema — sepuluh type Bagian 1", () => {
  it("daftar uji menutup seluruh sepuluh type kontrak", () => {
    expect(PER_TYPE.map(([t]) => t).sort()).toEqual(
      [
        "ais_anomaly",
        "ais_gap",
        "ais_track_segment",
        "assoc_result",
        "behavior_class",
        "kinematic_feasibility",
        "patrol_report",
        "sar_detection",
        "weather",
        "zone_rule",
      ].sort(),
    );
  });

  it.each(PER_TYPE)("menerima artefak %s yang lengkap", (_type, sah) => {
    expect(bolehParse(ArtifactSchema, sah)).toBe(true);
  });

  it.each(PER_TYPE)("menolak artefak %s tanpa field payload wajib", (_type, sah, jalur) => {
    expect(bolehParse(ArtifactSchema, tanpaKunci(sah, jalur))).toBe(false);
  });

  it("menolak payload milik type lain (union terdiskriminasi)", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "payload", A.aisGap.payload))).toBe(false);
  });

  it("menolak type di luar enum kontrak", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "type", "radar_detection"))).toBe(false);
  });
});

describe("ArtifactSchema — field amplop", () => {
  it("menolak art_id yang tidak berpola a-<inv>-<seq>", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "art_id", "artefak-1"))).toBe(false);
  });

  it("menolak inv_id tanpa awalan inv-", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "inv_id", "natuna-20260809-001"))).toBe(false);
  });

  it("menolak hash_sha256 yang bukan 64 heksadesimal", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "hash_sha256", "abc123"))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "hash_sha256", `${hexHash("x")}ff`))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "hash_sha256", "z".repeat(64)))).toBe(false);
  });

  it("menolak source.dataset di luar enum kontrak", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "source.dataset", "kaggle"))).toBe(false);
  });

  it("menerima seluruh dataset enum kontrak", () => {
    for (const ds of [
      "xview3-public",
      "cdse-natuna",
      "cdse-denmark",
      "dma-aisdk",
      "gfw-events",
      "marineregions-eez",
      "open-meteo",
      "runtime",
    ]) {
      expect(bolehParse(ArtifactSchema, dengan(A.sar, "source.dataset", ds))).toBe(true);
    }
  });

  it("mewajibkan source.provenance sebagai kalimat", () => {
    expect(bolehParse(ArtifactSchema, tanpaKunci(A.sar, "source.provenance"))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "source.provenance", ""))).toBe(false);
  });

  it("menolak created_at yang bukan ISO8601", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "created_at", "9 Agustus 2026"))).toBe(false);
  });

  it("menerima ISO8601 tanpa milidetik (bentuk yang dipakai golden as-built)", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "created_at", "2026-08-09T10:12:27Z"))).toBe(true);
  });

  it("mewajibkan label sintetis (Bagian 0: sintetis tanpa label = defect)", () => {
    expect(bolehParse(ArtifactSchema, tanpaKunci(A.sar, "sintetis"))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "sintetis", "false"))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "sintetis", false))).toBe(true);
  });
});

describe("ArtifactSchema — aturan payload spesifik", () => {
  it("mewajibkan mmsi_hash tepat 16 heksadesimal (pseudonim, bukan MMSI mentah)", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.aisGap, "payload.mmsi_hash", "9f3c1a77b2e05d6"))).toBe(
      false,
    );
    expect(
      bolehParse(ArtifactSchema, dengan(A.aisGap, "payload.mmsi_hash", "9f3c1a77b2e05d64ff")),
    ).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.aisGap, "payload.mmsi_hash", "525011234"))).toBe(false);
  });

  it("menolak zona di luar {ZEE-ID, WPP-711-proxy}", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.zone, "payload.zona", "ZEE-MY"))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.zone, "payload.zona", "WPP-711-proxy"))).toBe(true);
  });

  it("menolak posisi zona di luar {inside, outside}", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.zone, "payload.posisi", "dalam"))).toBe(false);
  });

  it("menolak jenis anomali di luar {gap, spoofing, ganti_identitas}", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.aisAnomaly, "payload.jenis", "penyelundupan"))).toBe(
      false,
    );
  });

  it("menolak kelas perilaku di luar {fishing, transit}", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.behavior, "payload.kelas", "loitering"))).toBe(false);
  });

  it("mengunci metode asosiasi pada hungarian", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.assoc, "payload.metode", "greedy"))).toBe(false);
  });

  it("mengizinkan track_art_id null pada asosiasi gelap", () => {
    const gelap = dengan(dengan(A.assoc, "payload.track_art_id", null), "payload.dark", true);
    expect(bolehParse(ArtifactSchema, gelap)).toBe(true);
  });

  it("mengunci sumber cuaca pada open-meteo", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.weather, "payload.sumber", "bmkg"))).toBe(false);
  });

  it("menolak finding patroli di luar enum Bagian 5", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.patrol, "payload.finding", "mencurigakan"))).toBe(
      false,
    );
  });

  it("menolak lolos kinematik yang bukan boolean", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.kinematic, "payload.lolos", "true"))).toBe(false);
  });

  // Golden as-built (a-dk-01-d01) menulis SELURUH field perseptual sar_detection
  // sebagai null pada target placeholder — "tidak ada angka yang dikarang".
  // Field wajib HADIR tetapi boleh null; lat/lon/scene_id tetap terisi.
  it("menerima field perseptual sar_detection bernilai null (target placeholder)", () => {
    let placeholder: unknown = A.sar;
    for (const k of [
      "row",
      "col",
      "length_m_est",
      "objectness_p",
      "vessel_p",
      "fishing_p",
      "confidence_calibrated",
    ]) {
      placeholder = dengan(placeholder, `payload.${k}`, null);
    }
    expect(bolehParse(ArtifactSchema, placeholder)).toBe(true);
  });

  it("tetap menolak lat/lon/scene_id sar_detection yang null", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "payload.lat", null))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "payload.scene_id", null))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StatusServer + Investigation (Bagian 1, 4)
// ---------------------------------------------------------------------------

const STATUS_SAH = {
  status: "terkonfirmasi",
  computed_at: T.now,
  hash: hexHash("status-sintetis"),
  sensors_independent: 2,
  zone_violation: true,
  evidence_age_h: 2,
  decay_applied: false,
  conflicting_art_ids: [] as string[],
  missing_coverage: [] as string[],
  reasons: [
    { rule: "dua_sensor", passed: true, art_ids: [artId("001"), artId("002")] },
    { rule: "zona", passed: true, art_ids: [artId("005")] },
  ],
  abstain_reason: null,
  display_state: [] as string[],
};

const INVESTIGASI_SAH = {
  inv_id: INV,
  seed: SEED,
  aoi: "natuna",
  zona: "ZEE-ID",
  t_acquisition: T.acq,
  t_observasi_terakhir: T.gapEnd,
  split: "demo",
  sintetis: true,
  kasus: {
    label: "going-dark",
    peran_demo: "Kasus utama demo: deteksi SAR jatuh di dalam celah AIS enam jam.",
  },
  candidate: { lat: POS.a.lat, lon: POS.a.lon, length_m_est: 41.6, confidence_calibrated: 0.82 },
  artifacts: [artId("001"), artId("002"), artId("005")],
  status_server: STATUS_SAH,
  agent_proposal: { status_usulan: "terkonfirmasi", trace_ref: "trace/replay-1.jsonl" },
  berkas: {
    sections: [
      { claim: "Deteksi SAR berada di dalam ZEE-ID pada jendela celah AIS.", art_ids: [artId("001")] },
    ],
    diksi_ok: true,
  },
  patrol: { package_id: null, result: null },
};

describe("StatusServerSchema — Bagian 4", () => {
  it("menerima status server yang lengkap", () => {
    expect(bolehParse(StatusServerSchema, STATUS_SAH)).toBe(true);
  });

  it("menolak nilai status huruf besar (wire selalu lowercase)", () => {
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "status", "ABSTAIN"))).toBe(false);
  });

  it("menerima ketiga nilai status wire", () => {
    for (const s of ["terkonfirmasi", "terindikasi", "abstain"]) {
      expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "status", s))).toBe(true);
    }
  });

  it("menolak rule di luar enam rule kontrak", () => {
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "reasons.0.rule", "cuaca"))).toBe(false);
  });

  it("menerima keenam rule kontrak", () => {
    for (const r of ["dua_sensor", "zona", "kinematik_gap", "usia", "konflik", "cakupan"]) {
      expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "reasons.0.rule", r))).toBe(true);
    }
  });

  it("menolak abstain_reason di luar empat kode enum", () => {
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "abstain_reason", "bukti-tunggal"))).toBe(
      false,
    );
  });

  it("menerima keempat kode abstain_reason dan null", () => {
    for (const a of [
      "bukti_tunggal",
      "konflik_artefak",
      "kurang_cakupan",
      "kedaluwarsa_tanpa_penguatan",
      null,
    ]) {
      expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "abstain_reason", a))).toBe(true);
    }
  });

  it("menolak display_state di luar kosakata beku Bagian 1", () => {
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "display_state", ["merah"]))).toBe(false);
    expect(
      bolehParse(StatusServerSchema, dengan(STATUS_SAH, "display_state", ["degraded", "kedaluwarsa"])),
    ).toBe(true);
  });

  it("menolak hash yang bukan 64 heksadesimal", () => {
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "hash", "belum-dihitung"))).toBe(false);
  });

  it("menolak sensors_independent negatif atau pecahan", () => {
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "sensors_independent", -1))).toBe(false);
    expect(bolehParse(StatusServerSchema, dengan(STATUS_SAH, "sensors_independent", 1.5))).toBe(false);
  });

  it("mewajibkan seluruh field status_server hadir", () => {
    for (const k of Object.keys(STATUS_SAH)) {
      expect(bolehParse(StatusServerSchema, tanpaKunci(STATUS_SAH, k))).toBe(false);
    }
  });
});

describe("InvestigationSchema — Bagian 1", () => {
  it("menerima investigasi yang lengkap", () => {
    expect(bolehParse(InvestigationSchema, INVESTIGASI_SAH)).toBe(true);
  });

  it("mengunci seed global 20260809", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "seed", 1234))).toBe(false);
  });

  it("menolak inv_id tanpa awalan inv-", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "inv_id", "natuna-1"))).toBe(false);
  });

  it("menerima aoi natuna, denmark, dan xview3-<scene>", () => {
    for (const aoi of ["natuna", "denmark", "xview3-abc123"]) {
      expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "aoi", aoi))).toBe(true);
    }
  });

  it("menolak aoi di luar pola kontrak", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "aoi", "arafura"))).toBe(false);
  });

  it("mengizinkan zona null", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "zona", null))).toBe(true);
  });

  it("menolak zona di luar enum", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "zona", "ZEE-MY"))).toBe(false);
  });

  it("menolak split di luar {kalibrasi, pelaporan, demo}", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "split", "produksi"))).toBe(false);
  });

  it("menerima ketujuh label kasus kontrak", () => {
    for (const label of [
      "going-dark",
      "spoofing",
      "alih-muatan",
      "abstain",
      "peluruhan",
      "asosiasi-denmark",
      "patroli",
    ]) {
      expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "kasus.label", label))).toBe(true);
    }
  });

  it("menolak label kasus di luar enum", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "kasus.label", "ilegal"))).toBe(
      false,
    );
  });

  it("mewajibkan label sintetis pada investigasi", () => {
    expect(bolehParse(InvestigationSchema, tanpaKunci(INVESTIGASI_SAH, "sintetis"))).toBe(false);
  });

  it("mewajibkan status_server valid dan menolak yang cacat", () => {
    expect(
      bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "status_server.status", "ABSTAIN")),
    ).toBe(false);
    expect(bolehParse(InvestigationSchema, tanpaKunci(INVESTIGASI_SAH, "status_server"))).toBe(false);
  });

  it("mewajibkan berkas.diksi_ok boolean dan sections berbentuk klaim+art_ids", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "berkas.diksi_ok", "ya"))).toBe(
      false,
    );
    expect(
      bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "berkas.sections", [{ claim: "x" }])),
    ).toBe(false);
  });

  it("menolak art_id cacat di daftar artifacts", () => {
    expect(
      bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "artifacts", [artId("001"), "a-1"])),
    ).toBe(false);
  });

  it("menerima patrol yang sudah terisi paket dan hasil", () => {
    const terisi = dengan(INVESTIGASI_SAH, "patrol", {
      package_id: PKG_ID,
      result: {
        package_id: PKG_ID,
        finding: "sesuai",
        note: "Tim memverifikasi area pencarian.",
        submitted_at: "2026-08-09T05:10:00.000Z",
        by_role: "patroli",
      },
    });
    expect(bolehParse(InvestigationSchema, terisi)).toBe(true);
  });

  it("menolak agent_proposal tanpa trace_ref", () => {
    expect(
      bolehParse(InvestigationSchema, tanpaKunci(INVESTIGASI_SAH, "agent_proposal.trace_ref")),
    ).toBe(false);
  });

  // Golden as-built (inv-natuna-20260805-01) menulis agent_proposal: null —
  // investigasi yang belum pernah dijalankan agennya.
  it("menerima agent_proposal null (belum ada usulan agen)", () => {
    expect(bolehParse(InvestigationSchema, dengan(INVESTIGASI_SAH, "agent_proposal", null))).toBe(
      true,
    );
  });

  it("menerima investigasi golden yang bertumpu pada satu modalitas dan ABSTAIN", () => {
    const abstain = dengan(
      dengan(dengan(INVESTIGASI_SAH, "status_server.status", "abstain"), "status_server.abstain_reason", "kurang_cakupan"),
      "status_server.missing_coverage",
      ["SAR", "AIS"],
    );
    expect(bolehParse(InvestigationSchema, abstain)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TargetPackage (Bagian 5)
// ---------------------------------------------------------------------------

const DRAFT_SAH = {
  area: {
    center: { lat: POS.a.lat, lon: POS.a.lon },
    radius_km: 12.5,
    heading_sector_deg: [30, 75],
    zona_clip: "ZEE-ID",
  },
  berkas_ringkas_ref: `blob://berkas/${INV}/ringkas.json`,
};

const PAKET_SAH = {
  ...DRAFT_SAH,
  package_id: PKG_ID,
  inv_id: INV,
  status_tingkat: "terkonfirmasi",
  label: "area pencarian, bukan posisi pasti",
  issued_at: "2026-08-09T04:05:00.000Z",
  expires_at: "2026-08-10T04:05:00.000Z",
};

describe("TargetPackageDraftSchema — usulan A9", () => {
  it("menerima draft yang lengkap", () => {
    expect(bolehParse(TargetPackageDraftSchema, DRAFT_SAH)).toBe(true);
  });

  it("mengizinkan heading_sector_deg null", () => {
    expect(bolehParse(TargetPackageDraftSchema, dengan(DRAFT_SAH, "area.heading_sector_deg", null))).toBe(
      true,
    );
  });

  it("menolak heading_sector_deg yang bukan pasangan [a, b]", () => {
    expect(bolehParse(TargetPackageDraftSchema, dengan(DRAFT_SAH, "area.heading_sector_deg", [30]))).toBe(
      false,
    );
    expect(
      bolehParse(TargetPackageDraftSchema, dengan(DRAFT_SAH, "area.heading_sector_deg", [30, 75, 110])),
    ).toBe(false);
  });

  it("mewajibkan radius_km", () => {
    expect(bolehParse(TargetPackageDraftSchema, tanpaKunci(DRAFT_SAH, "area.radius_km"))).toBe(false);
  });

  it("menolak zona_clip di luar enum", () => {
    expect(bolehParse(TargetPackageDraftSchema, dengan(DRAFT_SAH, "area.zona_clip", "ZEE-MY"))).toBe(
      false,
    );
  });

  it("menolak koordinat pusat di luar rentang bumi", () => {
    expect(bolehParse(TargetPackageDraftSchema, dengan(DRAFT_SAH, "area.center.lat", 95))).toBe(false);
    expect(bolehParse(TargetPackageDraftSchema, dengan(DRAFT_SAH, "area.center.lon", 200))).toBe(false);
  });

  it("draft telanjang ditolak oleh skema paket (server pemilik issued_at/expires_at)", () => {
    expect(bolehParse(TargetPackageSchema, DRAFT_SAH)).toBe(false);
  });
});

describe("TargetPackageSchema — cetakan server", () => {
  it("menerima paket yang lengkap", () => {
    expect(bolehParse(TargetPackageSchema, PAKET_SAH)).toBe(true);
  });

  it("mengunci label beku 'area pencarian, bukan posisi pasti'", () => {
    expect(bolehParse(TargetPackageSchema, dengan(PAKET_SAH, "label", "posisi kapal"))).toBe(false);
  });

  it("menolak package_id yang tidak berpola pkg-<inv>", () => {
    expect(bolehParse(TargetPackageSchema, dengan(PAKET_SAH, "package_id", "paket-1"))).toBe(false);
  });

  it("menerima status_tingkat terkonfirmasi dan terindikasi", () => {
    for (const s of ["terkonfirmasi", "terindikasi"]) {
      expect(bolehParse(TargetPackageSchema, dengan(PAKET_SAH, "status_tingkat", s))).toBe(true);
    }
  });

  it("menolak status_tingkat huruf besar", () => {
    expect(bolehParse(TargetPackageSchema, dengan(PAKET_SAH, "status_tingkat", "ABSTAIN"))).toBe(false);
  });

  it("mewajibkan issued_at dan expires_at ISO8601", () => {
    expect(bolehParse(TargetPackageSchema, tanpaKunci(PAKET_SAH, "expires_at"))).toBe(false);
    expect(bolehParse(TargetPackageSchema, dengan(PAKET_SAH, "issued_at", "besok pagi"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PatrolResult (Bagian 5) — satu-satunya ingress teks bebas
// ---------------------------------------------------------------------------

const HASIL_SAH = {
  package_id: PKG_ID,
  finding: "sesuai",
  note: "Tim memverifikasi kapal di dalam area pencarian; alat tangkap terpasang.",
  submitted_at: "2026-08-09T05:10:00.000Z",
  by_role: "patroli",
};

describe("PatrolResultSchema — Bagian 5", () => {
  it("menerima hasil patroli yang lengkap", () => {
    expect(bolehParse(PatrolResultSchema, HASIL_SAH)).toBe(true);
  });

  it("menerima keempat nilai finding kontrak", () => {
    for (const f of ["sesuai", "berbeda", "tidak_ditemukan", "tidak_terjangkau"]) {
      expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "finding", f))).toBe(true);
    }
  });

  it("menolak finding di luar enum", () => {
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "finding", "mencurigakan"))).toBe(false);
  });

  it("menerima note tepat 500 karakter dan menolak 501", () => {
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "note", "a".repeat(500)))).toBe(true);
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "note", "a".repeat(501)))).toBe(false);
  });

  it("menerima note kosong", () => {
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "note", ""))).toBe(true);
  });

  it("mengunci by_role pada patroli", () => {
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "by_role", "analis"))).toBe(false);
  });

  it("menolak submitted_at yang bukan ISO8601", () => {
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "submitted_at", "kemarin"))).toBe(false);
  });

  it("menolak package_id cacat", () => {
    expect(bolehParse(PatrolResultSchema, dengan(HASIL_SAH, "package_id", "pkg"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Envelope agen (Bagian 2)
// ---------------------------------------------------------------------------

const ENVELOPE_SAH = {
  agent: "A7",
  inv_id: INV,
  output: {
    sections: [
      { claim: "Deteksi SAR berada di dalam ZEE-ID.", art_ids: [artId("001")] },
    ],
  },
  artifacts_cited: [artId("001")],
  status: "ok",
};

describe("AgentEnvelopeSchema — Bagian 2", () => {
  it("menerima envelope yang lengkap", () => {
    expect(bolehParse(AgentEnvelopeSchema, ENVELOPE_SAH)).toBe(true);
  });

  it.each(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"])(
    "menerima id agen %s",
    (agent) => {
      expect(bolehParse(AgentEnvelopeSchema, dengan(ENVELOPE_SAH, "agent", agent))).toBe(true);
    },
  );

  it("menolak id agen di luar A0..A10", () => {
    expect(bolehParse(AgentEnvelopeSchema, dengan(ENVELOPE_SAH, "agent", "A11"))).toBe(false);
    expect(bolehParse(AgentEnvelopeSchema, dengan(ENVELOPE_SAH, "agent", "a7"))).toBe(false);
  });

  it("menerima ketiga status envelope kontrak", () => {
    for (const s of ["ok", "retry_fixed", "discarded"]) {
      expect(bolehParse(AgentEnvelopeSchema, dengan(ENVELOPE_SAH, "status", s))).toBe(true);
    }
  });

  it("menolak status envelope di luar enum", () => {
    expect(bolehParse(AgentEnvelopeSchema, dengan(ENVELOPE_SAH, "status", "gagal"))).toBe(false);
  });

  it("menolak art_id cacat di artifacts_cited", () => {
    expect(
      bolehParse(AgentEnvelopeSchema, dengan(ENVELOPE_SAH, "artifacts_cited", ["bukan-art-id"])),
    ).toBe(false);
  });

  it("menerima artifacts_cited kosong (mis. A0 hanya merujuk ringkasan)", () => {
    const a0 = dengan(
      dengan(dengan(ENVELOPE_SAH, "agent", "A0"), "output", { ringkasan_ref: "blob://ringkasan/1" }),
      "artifacts_cited",
      [],
    );
    expect(bolehParse(AgentEnvelopeSchema, a0)).toBe(true);
  });

  it("mewajibkan output, inv_id, dan artifacts_cited hadir", () => {
    for (const k of ["output", "inv_id", "artifacts_cited", "agent", "status"]) {
      expect(bolehParse(AgentEnvelopeSchema, tanpaKunci(ENVELOPE_SAH, k))).toBe(false);
    }
  });
});

// ============================================================================
// AMANDEMEN KONTRAK K-A1 (Bagian 1, 9 Agu) — blok BARU, tidak menyentuh yang di
// atas. Dua tambahan kontrak yang diuji di sini:
//
// K1. Artifact: `"observed_at": "ISO8601|null"` — field OPSIONAL aditif. Artefak
//     golden as-built (ditulis sebelum amandemen, tanpa field ini) tetap sah.
// K2. `reasons` Bagian 1 mendaftar keenam rule dan Bagian 4 memberi tiap rule
//     syarat lulusnya sendiri: status_server yang DITULIS wajib memuat keenam
//     rule persis sekali. Ditahan StatusServerKetatSchema (jalur tulis); jalur
//     baca tetap memakai StatusServerSchema yang longgar supaya investigasi
//     as-built ber-reasons parsial tampil apa adanya, bukan hilang diam-diam.
// ============================================================================

const ENAM_REASON = [
  { rule: "dua_sensor", passed: true, art_ids: [artId("001")] },
  { rule: "zona", passed: true, art_ids: [artId("005")] },
  { rule: "kinematik_gap", passed: false, art_ids: [] as string[] },
  { rule: "usia", passed: true, art_ids: [artId("001")] },
  { rule: "konflik", passed: true, art_ids: [] as string[] },
  { rule: "cakupan", passed: true, art_ids: [] as string[] },
];

describe("K-A1: Artifact.observed_at (Bagian 1, field opsional aditif)", () => {
  it("menerima artefak tanpa observed_at (seluruh golden as-built)", () => {
    expect(bolehParse(ArtifactSchema, A.sar)).toBe(true);
    expect("observed_at" in (A.sar as object)).toBe(false);
  });

  it("menerima observed_at ISO8601 dan null", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "observed_at", T.acq))).toBe(true);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "observed_at", null))).toBe(true);
    expect(bolehParse(ArtifactSchema, dengan(A.aisGap, "observed_at", "2026-08-09T03:00:00Z"))).toBe(
      true,
    );
  });

  it("menolak observed_at yang bukan ISO8601 berzona", () => {
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "observed_at", "9 Agustus 2026"))).toBe(false);
    expect(bolehParse(ArtifactSchema, dengan(A.sar, "observed_at", "2026-08-09T10:12:27"))).toBe(
      false,
    );
  });

  it("mempertahankan observed_at pada hasil parse (bukan dibuang seperti kunci asing)", () => {
    const hasil = ArtifactSchema.parse(dengan(A.sar, "observed_at", T.acq));
    expect(hasil.observed_at).toBe(T.acq);
  });
});

describe("K-A1: StatusServerKetatSchema — keenam rule wajib pada jalur tulis", () => {
  const KETAT_SAH = dengan(STATUS_SAH, "reasons", ENAM_REASON);

  it("menerima status_server yang memuat keenam rule persis sekali", () => {
    expect(bolehParse(StatusServerKetatSchema, KETAT_SAH)).toBe(true);
  });

  it("menolak status_server yang kehilangan satu rule", () => {
    for (const r of ["dua_sensor", "zona", "kinematik_gap", "usia", "konflik", "cakupan"]) {
      const kurang = dengan(
        KETAT_SAH,
        "reasons",
        ENAM_REASON.filter((x) => x.rule !== r),
      );
      expect(bolehParse(StatusServerKetatSchema, kurang)).toBe(false);
    }
  });

  it("menolak rule yang terbit dua kali", () => {
    const ganda = dengan(KETAT_SAH, "reasons", [...ENAM_REASON, ENAM_REASON[0]]);
    expect(bolehParse(StatusServerKetatSchema, ganda)).toBe(false);
  });

  it("menolak reasons parsial as-built yang masih diterima skema longgar", () => {
    expect(bolehParse(StatusServerSchema, STATUS_SAH)).toBe(true);
    expect(bolehParse(StatusServerKetatSchema, STATUS_SAH)).toBe(false);
  });

  it("tetap menegakkan seluruh aturan field StatusServerSchema", () => {
    expect(bolehParse(StatusServerKetatSchema, dengan(KETAT_SAH, "status", "ABSTAIN"))).toBe(false);
    expect(bolehParse(StatusServerKetatSchema, dengan(KETAT_SAH, "hash", "belum"))).toBe(false);
  });

  it("keluaran computeStatus lolos skema ketat pada setiap cabang klasifikasi", () => {
    resetSeq();
    const th = { usia_max_h: 72, ambang_kn: 25, konflik_jendela_jam: 1 };
    const skenario = [
      [mk.sar(), mk.aisTrack(), mk.zone(true)],
      [mk.sar(), mk.zone(true)],
      [] as ReturnType<typeof mk.sar>[],
    ];
    for (const artefak of skenario) {
      expect(bolehParse(StatusServerKetatSchema, computeStatus(artefak, T.now, th))).toBe(true);
    }
  });
});

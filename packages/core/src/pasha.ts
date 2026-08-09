// PASHA — fungsi murni server, contracts.md Bagian 4.
//
// Modul ini SENGAJA tanpa dependensi selain node:crypto: ia dipakai oleh route
// handler, pembangun golden set, DAN harness python lewat bin/gate.ts
// (architecture.md, "Pola kunci"). Angka evaluasi harus mendeskripsikan persis
// gerbang yang dikirim, jadi tidak boleh ada jalur kedua.
//
// Titik yang tidak dituliskan Bagian 4 memakai bacaan paling sederhana yang
// memenuhi teks; masing-masing dicatat di tempatnya.

import { createHash } from "node:crypto";

export type Modalitas = "SAR" | "AIS";
export type StatusWire = "terkonfirmasi" | "terindikasi" | "abstain";
export type RuleName = "dua_sensor" | "zona" | "kinematik_gap" | "usia" | "konflik" | "cakupan";
export type AbstainReason =
  | "bukti_tunggal"
  | "konflik_artefak"
  | "kurang_cakupan"
  | "kedaluwarsa_tanpa_penguatan";
export type DisplayState = "degraded" | "kosong" | "error" | "kedaluwarsa";

/** DI-SEED dari experiments/e5/thresholds.lock.json; hanya bergeser lewat delta
 *  A10 yang beraudit (Bagian 4). Tiga nilai, tiga jangkar tekstual: ambang usia
 *  ("evidence_age_h > ambang"), ambang kinematik (kinematic_feasibility.ambang_kn),
 *  dan lebar "jendela waktu yang sama" untuk konflik. */
export type Thresholds = {
  usia_max_h: number;
  ambang_kn: number;
  konflik_jendela_jam: number;
};

export type Reason = { rule: RuleName; passed: boolean; art_ids: string[] };

export type StatusServer = {
  status: StatusWire;
  computed_at: string;
  hash: string;
  sensors_independent: number;
  zone_violation: boolean;
  evidence_age_h: number;
  decay_applied: boolean;
  conflicting_art_ids: string[];
  missing_coverage: Modalitas[];
  reasons: Reason[];
  abstain_reason: AbstainReason | null;
  display_state: DisplayState[];
};

/** Bentuk minimum yang dibaca computeStatus. Sengaja longgar (bukan Artifact
 *  hasil zod) supaya harness dan pembangun golden bisa memanggil tanpa parse
 *  ulang; validasi bentuk penuh urusan schemas.ts di batas masuk. */
export type ArtifactLike = {
  art_id: string;
  type: string;
  created_at: string;
  /** Amandemen K-A1: waktu kejadian dunia nyata. Opsional — artefak yang
   *  ditulis sebelum amandemen tidak punya field ini. */
  observed_at?: string | null;
  payload: Record<string, unknown>;
};

/** Waktu KEJADIAN satu artefak (amandemen K-A1, Bagian 1): observed_at bila
 *  ada, created_at (waktu tulis) sebagai fallback. Satu helper untuk seluruh
 *  modul — usia bukti dan jendela konflik harus membaca sumbu waktu yang sama,
 *  kalau tidak divergensi semantik yang sama muncul lagi di tempat lain. */
const waktuKejadian = (a: ArtifactLike): number => Date.parse(a.observed_at ?? a.created_at);

/** Kalimat template Bagian 1. `abstain_reason` pada wire adalah KODE enum;
 *  kalimatnya hidup di sini supaya satu-satunya salinan teks beku ada di core. */
export const ABSTAIN_REASON_TEXT: Record<AbstainReason, string> = {
  bukti_tunggal: "Bukti berasal dari satu sumber saja; sistem menunggu lintasan berikutnya.",
  konflik_artefak:
    "Dua artefak saling bertentangan pada jendela waktu yang sama; lihat daftar konflik.",
  kurang_cakupan:
    "Tidak ada akuisisi pada rentang waktu yang dipersoalkan; berkas bertumpu pada sensor yang merekam.",
  kedaluwarsa_tanpa_penguatan:
    "Bukti melewati ambang usia tanpa penguatan lintasan berikutnya; status diturunkan.",
};

const JAM_MS = 3_600_000;
const KM_PER_NM = 1.852;
const R_BUMI_KM = 6371.0088;

/** Artefak yang lahir dari sensor AIS — termasuk ais_gap (yang direkam adalah
 *  senyap) dan ais_anomaly. Dipakai untuk CAKUPAN, bukan untuk menghitung
 *  modalitas yang MENGAMATI; dua gagasan berbeda (lihat sensors_independent). */
const TIPE_AIS = new Set(["ais_track_segment", "ais_gap", "ais_anomaly"]);

const unik = (xs: string[]): string[] => [...new Set(xs)].sort();

/** JSON kanonik: kunci terurut rekursif, urutan array dipertahankan, tanpa
 *  spasi, kunci undefined dibuang. Basis `hash` Bagian 4. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const isi = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
    return `{${isi.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function haversineKm(a: Titik, b: Titik): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_BUMI_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Titik = {
  art_id: string;
  t: number;
  lat: number;
  lon: number;
  /** Satu akuisisi (scene SAR): dua posisi di dalamnya SEREMPAK. */
  akuisisi: string | null;
  /** Subjek yang teridentifikasi (mmsi_hash) kalau artefak menyebutnya. */
  subjek: string | null;
};

/** Posisi objek yang diklaim satu artefak, atau null kalau artefak itu tidak
 *  mengklaim posisi objek. `weather` punya lat/lon tetapi itu titik kueri
 *  cuaca, bukan posisi kapal — konteks, bukan klaim (Bagian 1).
 *  ponytail: hanya fix TERAKHIR ais_track_segment yang dipindai. Rekonsiliasi
 *  per-fix adalah pekerjaan artefak kinematic_feasibility/assoc_result (A4/A6);
 *  kalau nanti perlu, ganti map ini jadi flatMap seluruh points. */
function posisi(a: ArtifactLike): Titik | null {
  if (a.type === "sar_detection") {
    const { lat, lon, scene_id } = a.payload as {
      lat?: unknown;
      lon?: unknown;
      scene_id?: unknown;
    };
    if (typeof lat === "number" && typeof lon === "number") {
      return {
        art_id: a.art_id,
        t: waktuKejadian(a),
        lat,
        lon,
        akuisisi: typeof scene_id === "string" ? scene_id : null,
        subjek: null,
      };
    }
    return null;
  }
  if (a.type === "ais_track_segment") {
    const { points, mmsi_hash } = a.payload as {
      points?: Array<{ t: string; lat: number; lon: number }>;
      mmsi_hash?: unknown;
    };
    const p = points?.[points.length - 1];
    if (p) {
      return {
        art_id: a.art_id,
        t: Date.parse(p.t),
        lat: p.lat,
        lon: p.lon,
        akuisisi: null,
        subjek: typeof mmsi_hash === "string" ? mmsi_hash : null,
      };
    }
  }
  return null;
}

/** Konflik hanya masuk akal untuk OBJEK YANG SAMA (Bagian 4 menuliskan syarat
 *  itu pada kalimat kelas kontradiktif; ia mengikat seluruh gagasan konflik).
 *  Dua hal membuktikan objeknya BERBEDA, dan keduanya nyata pada golden:
 *  - satu scene SAR berisi banyak kapal serempak (xview3: 3 deteksi, 100 km
 *    terpisah, satu akuisisi) — bukan kontradiksi, cuma armada;
 *  - dua lintasan AIS ber-mmsi_hash berbeda adalah dua kapal (dk-01: 8 kapal).
 *  Pasangan lintas-modalitas (deteksi SAR vs lintasan AIS) TETAP diperiksa:
 *  itulah rekonsiliasi yang dicari kontrak. */
function objekBisaSama(a: Titik, b: Titik): boolean {
  if (a.akuisisi !== null && a.akuisisi === b.akuisisi) return false;
  if (a.subjek !== null && b.subjek !== null && a.subjek !== b.subjek) return false;
  return true;
}

/** Konflik deterministik (Bagian 4): dua artefak saling eksklusif pada jendela
 *  waktu sama. Dua bentuk, keduanya dituliskan kontrak:
 *  (1) posisi tak-terdamaikan secara kinematik: sog_implied > ambang_kn;
 *  (2) kelas kontradiktif untuk objek yang sama. Satu investigasi = satu
 *      kandidat, jadi dua behavior_class berlawanan pada jendela sama sudah
 *      kontradiktif (payload behavior_class tidak membawa rujukan subjek). */
function cariKonflik(artifacts: ArtifactLike[], th: Thresholds): string[] {
  const tabrakan: string[] = [];

  const titik = artifacts.map(posisi).filter((p): p is Titik => p !== null && Number.isFinite(p.t));
  for (let i = 0; i < titik.length; i++) {
    for (let j = i + 1; j < titik.length; j++) {
      const a = titik[i] as Titik;
      const b = titik[j] as Titik;
      if (!objekBisaSama(a, b)) continue;
      const dtJam = Math.abs(a.t - b.t) / JAM_MS;
      if (dtJam > th.konflik_jendela_jam) continue;
      const jarakKm = haversineKm(a, b);
      if (jarakKm === 0) continue;
      const sogImplied = dtJam === 0 ? Infinity : jarakKm / dtJam / KM_PER_NM;
      if (sogImplied > th.ambang_kn) tabrakan.push(a.art_id, b.art_id);
    }
  }

  const kelas = artifacts.filter((a) => a.type === "behavior_class");
  for (let i = 0; i < kelas.length; i++) {
    for (let j = i + 1; j < kelas.length; j++) {
      const a = kelas[i] as ArtifactLike;
      const b = kelas[j] as ArtifactLike;
      if (a.payload.kelas === b.payload.kelas) continue;
      const dtJam = Math.abs(waktuKejadian(a) - waktuKejadian(b)) / JAM_MS;
      if (dtJam <= th.konflik_jendela_jam) tabrakan.push(a.art_id, b.art_id);
    }
  }

  return unik(tabrakan);
}

export function computeStatus(
  artifacts: ArtifactLike[],
  now: string,
  thresholds: Thresholds,
): StatusServer {
  const idDari = (pred: (a: ArtifactLike) => boolean) =>
    unik(artifacts.filter(pred).map((a) => a.art_id));

  // --- modalitas sensor (HANYA {SAR, AIS}; behavior/weather/patrol = konteks)
  const sar = idDari((a) => a.type === "sar_detection");
  const aisPositif = idDari((a) => a.type === "ais_track_segment");
  const gap = idDari((a) => a.type === "ais_gap");
  // "lolos" saja yang menghitung; kinematic_feasibility yang gagal justru
  // membuktikan deteksi itu BUKAN kapal yang sama.
  const kinematik = idDari((a) => a.type === "kinematic_feasibility");
  const kinematikLolos = idDari(
    (a) => a.type === "kinematic_feasibility" && a.payload.lolos === true,
  );
  // going-dark = sar_detection + ais_gap historis + kinematic_feasibility.lolos
  const goingDark = sar.length > 0 && gap.length > 0 && kinematikLolos.length > 0;

  const modalitas = new Set<Modalitas>();
  if (sar.length > 0) modalitas.add("SAR");
  if (aisPositif.length > 0 || goingDark) modalitas.add("AIS");
  const sensors_independent = modalitas.size;

  // --- zona
  const zonaIds = idDari((a) => a.type === "zone_rule");
  const zone_violation = artifacts.some(
    (a) => a.type === "zone_rule" && a.payload.violation === true,
  );

  // --- cakupan: modalitas yang tidak punya artefak APA PUN pada investigasi.
  const punya: Record<Modalitas, boolean> = {
    SAR: sar.length > 0,
    AIS: artifacts.some((a) => TIPE_AIS.has(a.type)),
  };
  const missing_coverage = (["SAR", "AIS"] as const).filter((m) => !punya[m]);

  // --- usia bukti (amandemen K-A1): jam dari waktu kejadian TERBARU seluruh
  // artefak ke `now`, dengan waktu kejadian = max(observed_at || created_at).
  // Artefak tanpa observed_at jatuh ke created_at, jadi golden pra-amandemen
  // berperilaku persis seperti sebelumnya.
  const stempel = artifacts.map(waktuKejadian).filter(Number.isFinite);
  const terbaru = stempel.length > 0 ? Math.max(...stempel) : null;
  const evidence_age_h = terbaru === null ? 0 : (Date.parse(now) - terbaru) / JAM_MS;
  const usiaIds = terbaru === null ? [] : idDari((a) => waktuKejadian(a) === terbaru);
  const usiaLewat = evidence_age_h > thresholds.usia_max_h;

  // --- konflik
  const conflicting_art_ids = cariKonflik(artifacts, thresholds);

  // --- klasifikasi (Bagian 4). abstain memaksa; peluruhan menurunkan satu
  //     tingkat SETELAHNYA dan tidak menembus lantai abstain.
  let status: StatusWire;
  let abstain_reason: AbstainReason | null = null;
  if (conflicting_art_ids.length > 0) {
    status = "abstain";
    abstain_reason = "konflik_artefak";
  } else if (sensors_independent === 0) {
    // Pemicu kurang-cakupan lebih sempit daripada rule "cakupan": satu
    // modalitas yang hilang pasangannya tetap terindikasi (butir d Bagian 4).
    status = "abstain";
    abstain_reason = "kurang_cakupan";
  } else if (sensors_independent >= 2 && zone_violation) {
    status = "terkonfirmasi";
  } else {
    status = "terindikasi";
  }

  let decay_applied = false;
  if (usiaLewat && status !== "abstain") {
    decay_applied = true;
    if (status === "terkonfirmasi") {
      status = "terindikasi";
    } else {
      status = "abstain";
      abstain_reason = "kedaluwarsa_tanpa_penguatan";
    }
  }

  // --- keadaan tampilan turunan (Bagian 1 + matriks Bagian 8). "error" milik
  //     kegagalan agen, bukan fungsi ini.
  const display_state: DisplayState[] = [];
  if (gap.length > 0) display_state.push("degraded");
  if (artifacts.length === 0) display_state.push("kosong");
  if (decay_applied) display_state.push("kedaluwarsa");

  // reasons[].passed = "kriteria terpenuhi", bukan "aturan menyala".
  // INVARIAN: keenam rule Bagian 4 SELALU dipancarkan, persis sekali, dalam
  // urutan kontrak — rule yang tidak menyala hadir dengan passed:false, tidak
  // pernah dihilangkan (rule yang absen berarti "tidak dijalankan", klaim yang
  // berbeda). Ditahan oleh StatusServerKetatSchema pada jalur tulis.
  const reasons: Reason[] = [
    {
      rule: "dua_sensor",
      passed: sensors_independent >= 2,
      art_ids: unik([...sar, ...aisPositif, ...(goingDark ? [...gap, ...kinematikLolos] : [])]),
    },
    { rule: "zona", passed: zone_violation, art_ids: zonaIds },
    {
      rule: "kinematik_gap",
      passed: goingDark,
      art_ids: unik([...sar, ...gap, ...kinematik]),
    },
    { rule: "usia", passed: !usiaLewat, art_ids: usiaIds },
    { rule: "konflik", passed: conflicting_art_ids.length === 0, art_ids: conflicting_art_ids },
    { rule: "cakupan", passed: missing_coverage.length === 0, art_ids: [] },
  ];

  const tanpaHash = {
    status,
    computed_at: now,
    sensors_independent,
    zone_violation,
    evidence_age_h,
    decay_applied,
    conflicting_art_ids,
    missing_coverage: [...missing_coverage],
    reasons,
    abstain_reason,
    display_state,
  };

  return {
    ...tanpaHash,
    hash: createHash("sha256").update(canonicalJson(tanpaHash), "utf8").digest("hex"),
  };
}

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ABSTAIN_REASON_TEXT, computeStatus, type StatusServer, type Thresholds } from "../src/pasha";
import { MMSI_HASH, POS, T, art, mk, resetSeq } from "./fixtures";

// ============================================================================
// PASHA — tabel kebenaran contracts.md Bagian 4. DITULIS SEBELUM IMPLEMENTASI.
// Semua fixture SINTETIS (lihat header test/fixtures.ts).
//
// Bagian 4 tidak menuliskan setiap detail mekanis. Di titik-titik itu tes ini
// memilih interpretasi PALING SEDERHANA yang memenuhi teks kontrak dan
// mencatatnya di sini; implementasi wajib mengikuti daftar ini.
//
// I1. `now` adalah string ISO8601 (semua stempel waktu kontrak ISO8601) dan
//     `computed_at === now` — kalau tidak, hash tidak bisa dipakai sebagai
//     bukti determinisme lintas replay (Bagian 4, kalimat hash).
// I2. `evidence_age_h` = selisih jam antara `now` dan WAKTU OBSERVASI TERBARU
//     di antara artefak. Fixture peluruhan di bawah menyetel `created_at` sama
//     dengan stempel observasi payload, jadi tes ini lolos baik untuk bacaan
//     "pakai created_at" maupun "pakai stempel payload (ais_gap.t_end,
//     ais_track_segment.end, weather.t, patrol_report.submitted_at) lalu
//     jatuh ke created_at". Pilih salah satu; jangan campur.
//     CATATAN UNTUK PENULIS KODE: golden as-built
//     (golden/investigations/inv-natuna-20260805-01) memakai bacaan KETIGA —
//     evidence_age_h 85.64 j di sana = computed_at - t_observasi_terakhir,
//     sedangkan created_at artefaknya adalah waktu TULIS (10:12:27Z, selisih
//     ~3 menit dari computed_at). Tanda tangan beku
//     computeStatus(artifacts, now, thresholds) tidak menerima investigasi,
//     jadi bacaan itu tidak dapat direproduksi dari artefak saja: golden perlu
//     dibangun ulang dengan created_at membawa waktu observasi, ATAU angka
//     status_server-nya dihitung ulang lewat computeStatus. Ini ketegangan
//     nyata antara kontrak dan data as-built — bukan kelalaian tes.
// I3. `reasons[].passed` = "kriteria terpenuhi / bukti sehat", bukan "aturan
//     menyala". Jadi: dua_sensor passed <=> sensors_independent>=2; zona
//     passed <=> zone_violation; kinematik_gap passed <=> lolos;
//     usia passed <=> evidence_age_h <= ambang; konflik passed <=> TIDAK ada
//     konflik; cakupan passed <=> tidak ada modalitas hilang. Bacaan ini yang
//     konsisten dengan `kinematic_feasibility.lolos` dan `zone_rule.violation`.
// I4. Modalitas AIS dihitung dari observasi AIS POSITIF (ais_track_segment).
//     `ais_gap` adalah bukti KETIADAAN sinyal; ia baru menjadi modalitas AIS
//     kedua lewat rule "kinematik_gap" (sar_detection + ais_gap +
//     kinematic_feasibility.lolos=true). Ini pembacaan langsung dari kalimat
//     going-dark Bagian 4 dan satu-satunya yang membuat kasus (c) mungkin.
//     JANGAN keliru dengan I5(i): untuk CAKUPAN, ais_gap tetap terhitung
//     "artefak AIS ada". Dua gagasan berbeda — modalitas yang MENGAMATI
//     (sensors_independent) versus modalitas yang PUNYA ARTEFAK (cakupan).
// I5. Cakupan, DUA aturan terpisah (satu-satunya bacaan yang sekaligus
//     memenuhi Bagian 4, butir (d) "satu sensor = terindikasi", dan status
//     golden as-built inv-natuna-20260805-01):
//     (i) `missing_coverage` = modalitas {SAR, AIS} yang TIDAK punya artefak
//         apa pun pada investigasi. `ais_gap` DIHITUNG sebagai artefak AIS di
//         sini — sensornya merekam, yang direkam adalah senyap; ini persis
//         kalimat template kurang_cakupan "berkas bertumpu pada sensor yang
//         merekam". rule "cakupan" passed <=> missing_coverage kosong.
//     (ii) PEMICU abstain "kurang-cakupan" LEBIH SEMPIT: hanya ketika
//         sensors_independent === 0, yakni tidak ada satu pun modalitas yang
//         benar-benar mengamati. Kalau tidak, satu sensor yang hilang
//         pasangannya akan selalu jatuh ke abstain dan butir (d) mustahil.
//     Uji silang: golden inv-natuna-20260805-01 berisi tujuh zone_rule dan nol
//     artefak SAR/AIS -> missing_coverage ["SAR","AIS"], sensors 0, abstain
//     kurang_cakupan — persis status_server yang tertulis di sana.
// I6. Konflik posisi: dua artefak berposisi yang stempel waktunya berjarak
//     <= thresholds.konflik_jendela_jam dan kecepatan tersirat antar posisinya
//     > thresholds.ambang_kn ("posisi tak-terdamaikan secara kinematik").
// I7. `abstain_reason` adalah KODE enum (skema Bagian 1 menaruhnya sebagai
//     skalar nullable); kalimat template Indonesia diekspor terpisah sebagai
//     peta `ABSTAIN_REASON_TEXT`.
// I8. `thresholds` = {usia_max_h, ambang_kn, konflik_jendela_jam} — tiga nilai,
//     masing-masing punya jangkar tekstual di Bagian 4/Bagian 1. Bentuk penuh
//     dikunci nanti oleh experiments/e5/thresholds.lock.json.
// I9. abstain adalah LANTAI: peluruhan tidak menurunkannya lebih jauh dan tidak
//     menimpa abstain_reason pemicu utama.
// I10. `display_state` (turunan server, Bagian 1) diturunkan dari baris matriks
//     Bagian 8: ada ais_gap -> "degraded" ("celah cakupan tampil sebagai
//     celah"); decay_applied -> "kedaluwarsa"; tanpa artefak -> "kosong".
//     "error" milik kegagalan agen, bukan computeStatus.
// ============================================================================

const TH: Thresholds = { usia_max_h: 72, ambang_kn: 25, konflik_jendela_jam: 1 };

/** now = tepat di ambang usia (acq + 72 j). Kontrak bilang "> ambang". */
const NOW_TEPAT_AMBANG = "2026-08-12T02:00:00.000Z";

function reason(s: StatusServer, rule: string) {
  return s.reasons.find((r) => r.rule === rule);
}

/** JSON kanonik: kunci terurut rekursif, urutan array dipertahankan, tanpa spasi. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const isi = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`);
    return `{${isi.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// --- rakitan skenario -------------------------------------------------------

/** SAR + AIS positif (dua modalitas), zona opsional melanggar. */
function setDuaSensor(violation: boolean) {
  resetSeq();
  return [mk.sar(), mk.aisTrack(), mk.zone(violation)];
}

/** going-dark: deteksi SAR DI DALAM jendela gap + uji kinematik. */
function setGoingDark(lolos: boolean, violation = true) {
  resetSeq();
  const det = mk.sar();
  const gap = mk.aisGap();
  const kin = mk.kinematic(gap.art_id, det.art_id, lolos);
  const zone = mk.zone(violation);
  return { det, gap, kin, zone, artifacts: [det, gap, kin, zone] };
}

/** Dua deteksi SAR ~110 km terpisah dalam 15 menit: tak terdamaikan (~240 kn).
 *  Scene berbeda — satu scene Sentinel-1 terakuisisi dalam hitungan detik. */
function setKonflik() {
  resetSeq();
  const a = mk.sar({}, POS.a);
  const b = mk.sar({ created_at: "2026-08-09T02:15:00.000Z" }, POS.bJauh, {
    scene_id: "S1A-SINTETIS-0002",
  });
  const zone = mk.zone(true);
  return { a, b, artifacts: [a, b, zone] };
}

/** Kontrol konflik: jarak sama, tetapi 6 jam terpisah (~10 kn, wajar). */
function setTanpaKonflik() {
  resetSeq();
  const a = mk.sar({}, POS.a);
  const b = mk.sar({ created_at: "2026-08-09T08:00:00.000Z" }, POS.bJauh, {
    scene_id: "S1A-SINTETIS-0002",
  });
  return [a, b, mk.zone(true)];
}

/** Ada celah AIS (artefak AIS ada), tetapi nol akuisisi SAR -> sensors 0. */
function setKurangCakupan() {
  resetSeq();
  const gap = mk.aisGap();
  return { gap, artifacts: [gap, mk.zone(true)] };
}

// ============================================================================

describe("PASHA computeStatus — tabel kebenaran Bagian 4", () => {
  describe("(a) dua modalitas {SAR, AIS} + pelanggaran zona", () => {
    it("memberi status terkonfirmasi dengan sensors_independent = 2", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      expect(s.status).toBe("terkonfirmasi");
      expect(s.sensors_independent).toBe(2);
      expect(s.zone_violation).toBe(true);
      expect(s.abstain_reason).toBeNull();
    });

    it("mencatat rule dua_sensor dan zona sebagai terpenuhi", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      expect(reason(s, "dua_sensor")?.passed).toBe(true);
      expect(reason(s, "zona")?.passed).toBe(true);
    });

    it("tidak menandai konflik, kurang cakupan, atau peluruhan", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      expect(s.conflicting_art_ids).toEqual([]);
      expect(s.missing_coverage).toEqual([]);
      expect(s.decay_applied).toBe(false);
    });
  });

  describe("(b) going-dark: sar_detection + ais_gap + kinematik lolos + zona", () => {
    it("terkonfirmasi karena pasangan gap-deteksi dihitung dua sensor", () => {
      const { artifacts } = setGoingDark(true);
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.status).toBe("terkonfirmasi");
      expect(s.sensors_independent).toBe(2);
    });

    it("mencatat rule kinematik_gap terpenuhi beserta artefak pendukungnya", () => {
      const { det, gap, kin, artifacts } = setGoingDark(true);
      const s = computeStatus(artifacts, T.now, TH);
      const r = reason(s, "kinematik_gap");
      expect(r).toBeDefined();
      expect(r?.passed).toBe(true);
      expect(r?.art_ids).toEqual(expect.arrayContaining([det.art_id, gap.art_id, kin.art_id]));
    });

    it("menandai display_state degraded karena celah AIS tampil sebagai celah", () => {
      const { artifacts } = setGoingDark(true);
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.display_state).toContain("degraded");
    });

    it("tidak melaporkan kurang cakupan: deteksi SAR jatuh di dalam jendela gap", () => {
      const { artifacts } = setGoingDark(true);
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.missing_coverage).toEqual([]);
      expect(reason(s, "cakupan")?.passed).toBe(true);
    });
  });

  describe("(c) kinematic_feasibility.lolos = false", () => {
    it("TIDAK menghitung pasangan gap-deteksi sebagai dua sensor", () => {
      const { artifacts } = setGoingDark(false);
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.sensors_independent).toBe(1);
    });

    it("menurunkan status ke terindikasi meski zona dilanggar", () => {
      const { artifacts } = setGoingDark(false);
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.zone_violation).toBe(true);
      expect(s.status).toBe("terindikasi");
    });

    it("mencatat rule kinematik_gap sebagai tidak terpenuhi", () => {
      const { kin, artifacts } = setGoingDark(false);
      const s = computeStatus(artifacts, T.now, TH);
      expect(reason(s, "kinematik_gap")?.passed).toBe(false);
      expect(reason(s, "kinematik_gap")?.art_ids).toContain(kin.art_id);
    });
  });

  describe("(d) satu modalitas saja", () => {
    it("memberi terindikasi walau zona dilanggar", () => {
      resetSeq();
      const s = computeStatus([mk.sar(), mk.zone(true)], T.now, TH);
      expect(s.sensors_independent).toBe(1);
      expect(s.zone_violation).toBe(true);
      expect(s.status).toBe("terindikasi");
    });

    it("menyisakan abstain_reason null dan rule dua_sensor tidak terpenuhi", () => {
      resetSeq();
      const s = computeStatus([mk.sar(), mk.zone(true)], T.now, TH);
      expect(s.abstain_reason).toBeNull();
      expect(reason(s, "dua_sensor")?.passed).toBe(false);
    });
  });

  describe("(e) dua modalitas tanpa pelanggaran zona", () => {
    it("memberi terindikasi, bukan terkonfirmasi", () => {
      const s = computeStatus(setDuaSensor(false), T.now, TH);
      expect(s.sensors_independent).toBe(2);
      expect(s.zone_violation).toBe(false);
      expect(s.status).toBe("terindikasi");
    });

    it("mencatat dua_sensor terpenuhi tetapi zona tidak", () => {
      const s = computeStatus(setDuaSensor(false), T.now, TH);
      expect(reason(s, "dua_sensor")?.passed).toBe(true);
      expect(reason(s, "zona")?.passed).toBe(false);
    });
  });

  describe("(f) konflik artefak: dua posisi tak terdamaikan pada jendela sama", () => {
    it("memaksa abstain", () => {
      const { artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.status).toBe("abstain");
    });

    it("mengisi conflicting_art_ids dengan tepat pasangan yang bertabrakan", () => {
      const { a, b, artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.now, TH);
      expect([...s.conflicting_art_ids].sort()).toEqual([a.art_id, b.art_id].sort());
    });

    it("mencatat rule konflik sebagai tidak terpenuhi", () => {
      const { a, b, artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.now, TH);
      const r = reason(s, "konflik");
      expect(r?.passed).toBe(false);
      expect(r?.art_ids).toEqual(expect.arrayContaining([a.art_id, b.art_id]));
    });

    it("memakai abstain_reason konflik_artefak", () => {
      const { artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.abstain_reason).toBe("konflik_artefak");
    });

    it("kontrol: jarak sama tetapi 6 jam terpisah bukan konflik", () => {
      const s = computeStatus(setTanpaKonflik(), "2026-08-09T09:00:00.000Z", TH);
      expect(s.conflicting_art_ids).toEqual([]);
      expect(reason(s, "konflik")?.passed).toBe(true);
      expect(s.status).toBe("terindikasi");
    });
  });

  describe("(g) kurang cakupan", () => {
    it("memaksa abstain dengan abstain_reason kurang_cakupan", () => {
      const { artifacts } = setKurangCakupan();
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.status).toBe("abstain");
      expect(s.abstain_reason).toBe("kurang_cakupan");
    });

    it("mendaftar modalitas yang hilang, bukan modalitas yang merekam", () => {
      const { artifacts } = setKurangCakupan();
      const s = computeStatus(artifacts, T.now, TH);
      expect(s.missing_coverage).toContain("SAR");
      expect(s.missing_coverage).not.toContain("AIS");
    });

    it("mencatat rule cakupan sebagai tidak terpenuhi", () => {
      const { artifacts } = setKurangCakupan();
      const s = computeStatus(artifacts, T.now, TH);
      expect(reason(s, "cakupan")?.passed).toBe(false);
    });

    it("daftar artefak kosong = abstain, kedua modalitas hilang, display kosong", () => {
      const s = computeStatus([], T.now, TH);
      expect(s.status).toBe("abstain");
      expect(s.sensors_independent).toBe(0);
      expect(s.abstain_reason).toBe("kurang_cakupan");
      expect([...s.missing_coverage].sort()).toEqual(["AIS", "SAR"]);
      expect(s.display_state).toContain("kosong");
    });

    // Regresi terhadap golden as-built inv-natuna-20260805-01: hanya artefak
    // zone_rule (konteks aturan), nol akuisisi SAR maupun AIS.
    it("hanya artefak zone_rule = abstain kurang_cakupan dengan nol sensor", () => {
      resetSeq();
      const s = computeStatus([mk.zone(true), mk.zone(true), mk.zone(false)], T.now, TH);
      expect(s.sensors_independent).toBe(0);
      expect(s.zone_violation).toBe(true);
      expect(s.status).toBe("abstain");
      expect(s.abstain_reason).toBe("kurang_cakupan");
      expect([...s.missing_coverage].sort()).toEqual(["AIS", "SAR"]);
    });

    // Sisi lain aturan (ii): satu modalitas hilang TIDAK memaksa abstain,
    // sekalipun rule cakupan tercatat tidak terpenuhi.
    it("satu modalitas hilang tercatat di cakupan tetapi tetap terindikasi", () => {
      resetSeq();
      const s = computeStatus([mk.sar(), mk.zone(true)], T.now, TH);
      expect(s.missing_coverage).toEqual(["AIS"]);
      expect(reason(s, "cakupan")?.passed).toBe(false);
      expect(s.status).toBe("terindikasi");
      expect(s.abstain_reason).toBeNull();
    });
  });

  describe("(h) peluruhan usia", () => {
    it("terkonfirmasi turun satu tingkat menjadi terindikasi", () => {
      const s = computeStatus(setDuaSensor(true), T.nowLewatAmbang, TH);
      expect(s.status).toBe("terindikasi");
      expect(s.decay_applied).toBe(true);
      expect(s.abstain_reason).toBeNull();
    });

    it("terindikasi turun satu tingkat menjadi abstain kedaluwarsa_tanpa_penguatan", () => {
      const s = computeStatus(setDuaSensor(false), T.nowLewatAmbang, TH);
      expect(s.status).toBe("abstain");
      expect(s.decay_applied).toBe(true);
      expect(s.abstain_reason).toBe("kedaluwarsa_tanpa_penguatan");
    });

    it("melaporkan evidence_age_h dan mencatat rule usia tidak terpenuhi", () => {
      const s = computeStatus(setDuaSensor(true), T.nowLewatAmbang, TH);
      expect(s.evidence_age_h).toBeCloseTo(122, 6);
      expect(reason(s, "usia")?.passed).toBe(false);
    });

    it("menandai display_state kedaluwarsa saat peluruhan diterapkan", () => {
      const s = computeStatus(setDuaSensor(true), T.nowLewatAmbang, TH);
      expect(s.display_state).toContain("kedaluwarsa");
    });

    it("TEPAT di ambang belum meluruh (kontrak: usia > ambang)", () => {
      const s = computeStatus(setDuaSensor(true), NOW_TEPAT_AMBANG, TH);
      expect(s.evidence_age_h).toBeCloseTo(TH.usia_max_h, 6);
      expect(s.decay_applied).toBe(false);
      expect(s.status).toBe("terkonfirmasi");
      expect(reason(s, "usia")?.passed).toBe(true);
    });

    it("abstain adalah lantai: peluruhan tidak menimpa alasan pemicu utama", () => {
      const { artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.nowLewatAmbang, TH);
      expect(s.status).toBe("abstain");
      expect(s.abstain_reason).toBe("konflik_artefak");
    });
  });

  describe("(i) artefak konteks bukan modalitas sensor", () => {
    it("weather dan patrol_report tidak menambah sensors_independent", () => {
      resetSeq();
      const dasar = [mk.sar(), mk.zone(true)];
      const dengan_konteks = [...dasar, mk.weather(), mk.patrol(), mk.behavior()];
      const a = computeStatus(dasar, T.now, TH);
      const b = computeStatus(dengan_konteks, T.now, TH);
      expect(a.sensors_independent).toBe(1);
      expect(b.sensors_independent).toBe(1);
    });

    it("artefak konteks tidak mengubah status server", () => {
      resetSeq();
      const dasar = [mk.sar(), mk.zone(true)];
      const dengan_konteks = [...dasar, mk.weather(), mk.patrol(), mk.behavior()];
      expect(computeStatus(dengan_konteks, T.now, TH).status).toBe(
        computeStatus(dasar, T.now, TH).status,
      );
    });

    it("konteks tidak bisa menggenapkan terkonfirmasi dari satu modalitas", () => {
      resetSeq();
      const s = computeStatus([mk.sar(), mk.zone(true), mk.weather(), mk.behavior()], T.now, TH);
      expect(s.status).toBe("terindikasi");
    });

    it("ais_anomaly tetap AIS: tidak dihitung sebagai modalitas ketiga", () => {
      resetSeq();
      const s = computeStatus([mk.sar(), mk.aisTrack(), mk.aisAnomaly(), mk.zone(true)], T.now, TH);
      expect(s.sensors_independent).toBe(2);
    });
  });

  describe("(j) hash determinisme lapisan server", () => {
    it("dua panggilan dengan input sama menghasilkan hash sama", () => {
      const a = computeStatus(setDuaSensor(true), T.now, TH);
      const b = computeStatus(setDuaSensor(true), T.now, TH);
      expect(a.hash).toBe(b.hash);
      expect(a).toEqual(b);
    });

    it("urutan artefak tidak mengubah hash (replay tidak menjamin urutan store)", () => {
      const maju = setDuaSensor(true);
      const a = computeStatus(maju, T.now, TH);
      const b = computeStatus([...setDuaSensor(true)].reverse(), T.now, TH);
      expect(b.hash).toBe(a.hash);
    });

    it("input berbeda menghasilkan hash berbeda", () => {
      const a = computeStatus(setDuaSensor(true), T.now, TH);
      const zonaBeda = computeStatus(setDuaSensor(false), T.now, TH);
      const waktuBeda = computeStatus(setDuaSensor(true), T.nowLewatAmbang, TH);
      expect(zonaBeda.hash).not.toBe(a.hash);
      expect(waktuBeda.hash).not.toBe(a.hash);
    });

    it("hash = sha256 JSON kanonik status_server tanpa field hash", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      const { hash: _abaikan, ...tanpaHash } = s;
      const diharapkan = createHash("sha256").update(canonical(tanpaHash), "utf8").digest("hex");
      expect(s.hash).toBe(diharapkan);
    });

    it("hash berbentuk 64 heksadesimal huruf kecil", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("computed_at memantulkan `now` yang diberikan (bukan jam dinding)", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      expect(s.computed_at).toBe(T.now);
    });
  });

  describe("(k) abstain_reason: enum kode + kalimat template Bagian 1", () => {
    it("bukti_tunggal memakai kalimat kontrak persis", () => {
      expect(ABSTAIN_REASON_TEXT.bukti_tunggal).toBe(
        "Bukti berasal dari satu sumber saja; sistem menunggu lintasan berikutnya.",
      );
    });

    it("konflik_artefak memakai kalimat kontrak persis", () => {
      expect(ABSTAIN_REASON_TEXT.konflik_artefak).toBe(
        "Dua artefak saling bertentangan pada jendela waktu yang sama; lihat daftar konflik.",
      );
    });

    it("kurang_cakupan memakai kalimat kontrak persis", () => {
      expect(ABSTAIN_REASON_TEXT.kurang_cakupan).toBe(
        "Tidak ada akuisisi pada rentang waktu yang dipersoalkan; berkas bertumpu pada sensor yang merekam.",
      );
    });

    it("kedaluwarsa_tanpa_penguatan memakai kalimat kontrak persis", () => {
      expect(ABSTAIN_REASON_TEXT.kedaluwarsa_tanpa_penguatan).toBe(
        "Bukti melewati ambang usia tanpa penguatan lintasan berikutnya; status diturunkan.",
      );
    });

    it("peta alasan berisi tepat empat kode enum kontrak", () => {
      expect(Object.keys(ABSTAIN_REASON_TEXT).sort()).toEqual([
        "bukti_tunggal",
        "kedaluwarsa_tanpa_penguatan",
        "konflik_artefak",
        "kurang_cakupan",
      ]);
    });

    it("setiap status abstain membawa alasan yang punya kalimat template", () => {
      const abstains = [
        computeStatus(setKonflik().artifacts, T.now, TH),
        computeStatus(setKurangCakupan().artifacts, T.now, TH),
        computeStatus(setDuaSensor(false), T.nowLewatAmbang, TH),
      ];
      for (const s of abstains) {
        expect(s.status).toBe("abstain");
        expect(s.abstain_reason).not.toBeNull();
        expect(ABSTAIN_REASON_TEXT[s.abstain_reason as keyof typeof ABSTAIN_REASON_TEXT]).toBeTypeOf(
          "string",
        );
      }
    });
  });

  describe("nilai wire (Bagian 4: lowercase; token TAMPIL 'ABSTAIN' bukan urusan server)", () => {
    it("status selalu salah satu dari tiga nilai lowercase", () => {
      const semua = [
        computeStatus(setDuaSensor(true), T.now, TH),
        computeStatus(setDuaSensor(false), T.now, TH),
        computeStatus(setKonflik().artifacts, T.now, TH),
        computeStatus([], T.now, TH),
      ];
      for (const s of semua) {
        expect(["terkonfirmasi", "terindikasi", "abstain"]).toContain(s.status);
        expect(s.status).not.toBe("ABSTAIN");
      }
    });

    it("display_state hanya memakai kosakata beku Bagian 1", () => {
      const semua = [
        computeStatus(setGoingDark(true).artifacts, T.now, TH),
        computeStatus(setDuaSensor(true), T.nowLewatAmbang, TH),
        computeStatus([], T.now, TH),
      ];
      for (const s of semua) {
        for (const d of s.display_state) {
          expect(["degraded", "kosong", "error", "kedaluwarsa"]).toContain(d);
        }
      }
    });
  });

  describe("ambang datang dari parameter, bukan konstanta tertanam", () => {
    it("menaikkan usia_max_h membatalkan peluruhan pada input yang sama", () => {
      const longgar: Thresholds = { ...TH, usia_max_h: 240 };
      const s = computeStatus(setDuaSensor(true), T.nowLewatAmbang, longgar);
      expect(s.decay_applied).toBe(false);
      expect(s.status).toBe("terkonfirmasi");
    });

    it("menaikkan ambang_kn membuat pasangan posisi jauh berhenti dianggap konflik", () => {
      const longgar: Thresholds = { ...TH, ambang_kn: 400 };
      const { artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.now, longgar);
      expect(s.conflicting_art_ids).toEqual([]);
      expect(s.status).not.toBe("abstain");
    });

    it("mengecilkan konflik_jendela_jam melepas pasangan dari jendela yang sama", () => {
      const sempit: Thresholds = { ...TH, konflik_jendela_jam: 0.1 };
      const { artifacts } = setKonflik();
      const s = computeStatus(artifacts, T.now, sempit);
      expect(s.conflicting_art_ids).toEqual([]);
    });
  });

  describe("konflik kelas kontradiktif untuk objek yang sama", () => {
    // payload behavior_class (Bagian 1) = {kelas, skor, model_ref}: tidak ada
    // referensi subjek. Interpretasi paling sederhana yang memenuhi teks
    // "kelas kontradiktif untuk objek yang sama": satu investigasi = satu
    // kandidat, jadi dua behavior_class berlawanan pada jendela waktu sama
    // di dalam investigasi yang sama SUDAH kontradiktif.
    it("dua behavior_class bertentangan pada jendela sama mengisi conflicting_art_ids", () => {
      resetSeq();
      const fishing = art("behavior_class", {
        kelas: "fishing",
        skor: 0.81,
        model_ref: "e3-temporal-v1",
      });
      const transit = art("behavior_class", {
        kelas: "transit",
        skor: 0.77,
        model_ref: "e3-temporal-v1",
      });
      const s = computeStatus(
        [mk.sar(), mk.aisTrack(), fishing, transit, mk.zone(true)],
        T.now,
        TH,
      );
      expect(s.status).toBe("abstain");
      expect([...s.conflicting_art_ids].sort()).toEqual([fishing.art_id, transit.art_id].sort());
      expect(s.abstain_reason).toBe("konflik_artefak");
    });
  });

  describe("pseudonimitas identitas tidak bocor ke status server", () => {
    it("StatusServer tidak memuat mmsi_hash atau field identitas apa pun", () => {
      const s = computeStatus(setDuaSensor(true), T.now, TH);
      expect(JSON.stringify(s)).not.toContain(MMSI_HASH);
      expect(Object.keys(s)).not.toContain("mmsi_hash");
    });
  });
});

// ============================================================================
// AMANDEMEN KONTRAK K-A1 (Bagian 1, 9 Agu) — blok BARU, tidak menyentuh yang di
// atas. Dua klaim yang dikutip langsung dari kontrak teramandemen:
//
// K1. "Semantik waktu: `observed_at` = waktu kejadian dunia nyata artefak
//     (akuisisi scene, akhir segmen AIS); `created_at` = waktu tulis. Usia
//     bukti dihitung dari observed_at (fallback created_at bila null)."
//     -> ini MENYELESAIKAN ketegangan I2 di atas: bacaan yang dipilih bukan
//     "created_at saja" melainkan max(observed_at || created_at). Artefak tanpa
//     observed_at berperilaku persis seperti sebelumnya, jadi seluruh tabel
//     kebenaran di atas tetap berlaku apa adanya.
// K2. Bagian 1 `status_server.reasons` mendaftar keenam rule
//     (dua_sensor|zona|kinematik_gap|usia|konflik|cakupan) dan Bagian 4
//     memberi tiap rule syarat lulusnya sendiri; rule yang absen berarti
//     "tidak dijalankan", bukan "lulus". Jadi keenamnya wajib selalu terbit.
// ============================================================================

describe("K-A1: usia bukti dari observed_at, bukan created_at", () => {
  /** `observed_at` adalah field amandemen; test/fixtures.ts dibekukan sebelum
   *  amandemen dan tidak disentuh, jadi field dipasang di sini. */
  const obs = <T extends object>(a: T, observed_at: string | null) => ({ ...a, observed_at });

  /** created_at BARUSAN (waktu tulis), observed_at 10 hari sebelum `now`.
   *  Kontrak: yang dipakai adalah observed_at, jadi bukti ini TUA. */
  function setObservasiLama() {
    resetSeq();
    const observed = "2026-08-04T04:00:00.000Z"; // 10 hari sebelum T.nowLewatAmbang
    const tulis = "2026-08-14T03:59:00.000Z"; // satu menit sebelum `now`
    return [
      obs(mk.sar({ created_at: tulis }), observed),
      obs(mk.aisTrack({ created_at: tulis }), observed),
      obs(mk.zone(true, { created_at: tulis }), observed),
    ];
  }

  it("mengukur evidence_age_h dari observed_at walau created_at baru saja ditulis", () => {
    const s = computeStatus(setObservasiLama(), T.nowLewatAmbang, TH);
    expect(s.evidence_age_h).toBeCloseTo(240, 6);
  });

  it("meluruhkan status: terkonfirmasi turun ke terindikasi karena observed_at tua", () => {
    const s = computeStatus(setObservasiLama(), T.nowLewatAmbang, TH);
    expect(s.zone_violation).toBe(true);
    expect(s.sensors_independent).toBe(2);
    expect(s.decay_applied).toBe(true);
    expect(s.status).toBe("terindikasi");
    expect(reason(s, "usia")?.passed).toBe(false);
    expect(s.display_state).toContain("kedaluwarsa");
  });

  it("created_at yang sama tanpa observed_at TIDAK meluruh (bukti bacaan berbeda)", () => {
    resetSeq();
    const tulis = "2026-08-14T03:59:00.000Z";
    const tanpaObservasi = [
      mk.sar({ created_at: tulis }),
      mk.aisTrack({ created_at: tulis }),
      mk.zone(true, { created_at: tulis }),
    ];
    const s = computeStatus(tanpaObservasi, T.nowLewatAmbang, TH);
    expect(s.evidence_age_h).toBeCloseTo(1 / 60, 6);
    expect(s.decay_applied).toBe(false);
    expect(s.status).toBe("terkonfirmasi");
  });

  it("observed_at null jatuh ke created_at (fallback yang dituliskan kontrak)", () => {
    resetSeq();
    const eksplisitNull = [
      obs(mk.sar(), null),
      obs(mk.aisTrack(), null),
      obs(mk.zone(true), null),
    ];
    resetSeq();
    const tanpaField = [mk.sar(), mk.aisTrack(), mk.zone(true)];
    expect(computeStatus(eksplisitNull, T.now, TH).hash).toBe(
      computeStatus(tanpaField, T.now, TH).hash,
    );
  });

  it("usia memakai artefak dengan waktu kejadian TERBARU, bukan yang terlama", () => {
    resetSeq();
    const lama = obs(mk.sar(), "2026-08-04T04:00:00.000Z");
    const baru = obs(mk.aisTrack(), "2026-08-14T02:00:00.000Z");
    const s = computeStatus([lama, baru, mk.zone(true)], T.nowLewatAmbang, TH);
    expect(s.evidence_age_h).toBeCloseTo(2, 6);
    expect(reason(s, "usia")?.passed).toBe(true);
    expect(reason(s, "usia")?.art_ids).toEqual([baru.art_id]);
  });
});

describe("K-A1: reasons selalu memancarkan keenam rule kontrak", () => {
  const ENAM = ["dua_sensor", "zona", "kinematik_gap", "usia", "konflik", "cakupan"];

  /** Setiap cabang klasifikasi Bagian 4, plus daftar artefak kosong. */
  const SEMUA_SKENARIO: Array<[string, StatusServer]> = [
    ["terkonfirmasi dua sensor", computeStatus(setDuaSensor(true), T.now, TH)],
    ["terindikasi tanpa zona", computeStatus(setDuaSensor(false), T.now, TH)],
    ["going-dark lolos", computeStatus(setGoingDark(true).artifacts, T.now, TH)],
    ["going-dark gagal", computeStatus(setGoingDark(false).artifacts, T.now, TH)],
    ["abstain konflik", computeStatus(setKonflik().artifacts, T.now, TH)],
    ["abstain kurang cakupan", computeStatus(setKurangCakupan().artifacts, T.now, TH)],
    ["abstain peluruhan", computeStatus(setDuaSensor(false), T.nowLewatAmbang, TH)],
    ["peluruhan dari terkonfirmasi", computeStatus(setDuaSensor(true), T.nowLewatAmbang, TH)],
    ["daftar artefak kosong", computeStatus([], T.now, TH)],
  ];

  it.each(SEMUA_SKENARIO)("%s memuat keenam rule persis sekali", (_nama, s) => {
    expect(s.reasons.map((r) => r.rule)).toEqual(ENAM);
  });

  it.each(SEMUA_SKENARIO)("%s memberi tiap rule passed boolean dan art_ids array", (_nama, s) => {
    for (const r of s.reasons) {
      expect(typeof r.passed).toBe("boolean");
      expect(Array.isArray(r.art_ids)).toBe(true);
    }
  });

  it("rule yang tidak menyala hadir dengan passed:false, bukan dihilangkan", () => {
    const s = computeStatus([], T.now, TH);
    expect(s.reasons.filter((r) => !r.passed).map((r) => r.rule)).toEqual(
      expect.arrayContaining(["dua_sensor", "zona", "kinematik_gap", "cakupan"]),
    );
    expect(s.reasons).toHaveLength(6);
  });
});

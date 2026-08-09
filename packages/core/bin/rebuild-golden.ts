#!/usr/bin/env node
// Pembangun ulang investigation.json golden set dari artefaknya sendiri —
// contracts.md Bagian 1 + 4, amandemen K-A1.
//
//   node packages/core/bin/rebuild-golden.ts [--now=ISO8601] [--dry]
//
// Kenapa ada: status_server as-built ditulis tangan sebelum computeStatus ada,
// dan hasilnya menyimpang (reasons parsial, evidence_age_h dari sumbu waktu
// lain). Satu-satunya cara membuat golden mendeskripsikan gerbang yang benar-
// benar dikirim adalah MENGHITUNGNYA dengan computeStatus yang sama
// (architecture.md, "Pola kunci": endpoint, builder golden, dan harness
// evaluasi memakai fungsi yang sama, tidak ada jalur kedua).
//
// Yang TIDAK disentuh: berkas artefak dan grounding.json. `observed_at`
// diturunkan DI MEMORI saja — menuliskannya ke artefak akan membatalkan
// hash_sha256 artefak itu dan salinan hash di grounding.json (dan melanggar
// asersi kunci-persis pada golden/verifikasi_*.py). Untuk golden as-built
// sekarang tidak ada bedanya: satu-satunya type yang membawa stempel kejadian
// di payload (ais_track_segment, ais_gap) hanya hidup di inv-dk-01, yang
// dilewati.
//
// Ekstensi ".ts" pada import wajib (Node type stripping, sama seperti gate.ts).

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeStatus, type Thresholds } from "../src/pasha.ts";
import {
  ArtifactSchema,
  InvestigationSchema,
  StatusServerKetatSchema,
  type Artifact,
  type Investigation,
} from "../src/schemas.ts";
import { GOLDEN_ROOT, bacaManifest } from "../src/store.ts";

/** Ambang terpin (Bagian 4: "DI-SEED dari experiments/e5/thresholds.lock.json").
 *  Dibaca, tidak disalin — angka gerbang tidak boleh punya dua sumber. */
const LOCK = fileURLToPath(new URL("../../../experiments/e5/thresholds.lock.json", import.meta.url));

/** `now` TERPIN, bukan jam dinding: hash status_server adalah bukti
 *  determinisme lintas replay, jadi membangun ulang golden dua kali harus
 *  memberi berkas yang identik. Nilai default = computed_at as-built, supaya
 *  pembangunan ulang ini tidak diam-diam menggeser garis waktu demo.
 *  Knob: --now=ISO8601 untuk kalibrasi/skenario peluruhan. */
const NOW_TERPIN = "2026-08-09T10:20:30Z";

const argv = process.argv.slice(2);
const argNow = argv.find((a) => a.startsWith("--now="))?.slice("--now=".length);
const dry = argv.includes("--dry");
const NOW = argNow ?? NOW_TERPIN;

function gagal(pesan: string): never {
  process.stderr.write(`rebuild-golden: ${pesan}\n`);
  process.exit(1);
}

if (Number.isNaN(Date.parse(NOW))) gagal(`--now bukan ISO8601: ${NOW}`);

async function bacaThresholds(): Promise<Thresholds> {
  const isi = JSON.parse(await readFile(LOCK, "utf8")) as Record<string, unknown>;
  const ambil = (k: keyof Thresholds): number => {
    const v = isi[k];
    if (typeof v !== "number") gagal(`thresholds.lock.json: ${k} wajib angka, dapat ${String(v)}`);
    return v;
  };
  return {
    usia_max_h: ambil("usia_max_h"),
    ambang_kn: ambil("ambang_kn"),
    konflik_jendela_jam: ambil("konflik_jendela_jam"),
  };
}

/** Waktu kejadian dunia nyata yang BISA diturunkan dari payload (K-A1).
 *  sar_detection: akuisisi scene tidak ada di payload kontrak -> null.
 *  zone_rule / behavior_class / ais_anomaly: konteks turunan, bukan observasi
 *  -> null, jatuh ke created_at di computeStatus. */
function observedAt(a: Artifact): string | null {
  if (a.observed_at != null) return a.observed_at; // sudah ditulis di artefak: hormati
  if (a.type === "ais_track_segment") return a.payload.end;
  if (a.type === "ais_gap") return a.payload.t_end;
  return null;
}

const invDir = (inv_id: string) => join(GOLDEN_ROOT, "investigations", inv_id);

async function bacaArtefakInv(inv_id: string): Promise<Artifact[]> {
  const dir = join(invDir(inv_id), "artifacts");
  const berkas = await readdir(dir).then(
    (f) => f.filter((n) => n.endsWith(".json")).sort(),
    () => [] as string[],
  );
  return Promise.all(
    berkas.map(async (f) =>
      ArtifactSchema.parse(JSON.parse(await readFile(join(dir, f), "utf8"))),
    ),
  );
}

/** Investigasi as-built, kalau ada. Field kurasi yang TIDAK dapat diturunkan
 *  dari artefak (kasus, split, t_acquisition, berkas, ...) dipertahankan dari
 *  sini — membangun ulang status bukan alasan membuang tulisan kurator. */
async function bacaInvestigasiLama(inv_id: string): Promise<Investigation | null> {
  const isi = await readFile(join(invDir(inv_id), "investigation.json"), "utf8").catch(() => null);
  if (isi === null) return null;
  const hasil = InvestigationSchema.safeParse(JSON.parse(isi));
  return hasil.success ? hasil.data : null;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

/** aoi = "natuna|denmark|xview3-<scene>" (Bagian 1). */
function aoiDari(inv_id: string, sar: Artifact | undefined): string {
  if (inv_id.startsWith("inv-natuna")) return "natuna";
  if (inv_id.startsWith("inv-dk")) return "denmark";
  if (sar?.type === "sar_detection") return `xview3-${sar.payload.scene_id}`;
  return gagal(`aoi tidak dapat diturunkan untuk ${inv_id}`);
}

async function main(): Promise<void> {
  const th = await bacaThresholds();
  const { items } = await bacaManifest();
  process.stdout.write(
    `now=${NOW} thresholds=${JSON.stringify(th)}${dry ? " (dry-run)" : ""}\n`,
  );

  for (const { inv_id, split } of items) {
    const artefak = await bacaArtefakInv(inv_id);
    if (artefak.length === 0) {
      process.stdout.write(`  ${inv_id}: DILEWATI (tanpa artefak)\n`);
      continue;
    }

    // Aturan lingkup: investigasi yang status-nya didorong artefak SINTETIS
    // tidak dibangun ulang di sini. Penanda operasionalnya satu — deteksi SAR
    // sintetis (Bagian 0: "sintetis tanpa label = defect", jadi labelnya boleh
    // dipercaya). inv-dk-01 memakai target placeholder d01/d02 untuk uji
    // kinematik, jadi ia jatuh ke sini.
    const sarSintetis = artefak.filter((a) => a.type === "sar_detection" && a.sintetis);
    if (sarSintetis.length > 0) {
      process.stdout.write(
        `  ${inv_id}: DILEWATI (sar_detection sintetis: ${sarSintetis.map((a) => a.art_id).join(", ")})\n`,
      );
      continue;
    }

    const dgnObservasi = artefak.map((a) => ({ ...a, observed_at: observedAt(a) }));
    const status_server = computeStatus(dgnObservasi, NOW, th);

    const lama = await bacaInvestigasiLama(inv_id);
    const sar = artefak.find((a) => a.type === "sar_detection");
    const zone = artefak.find((a) => a.type === "zone_rule");

    const kejadian = dgnObservasi.map((a) => Date.parse(a.observed_at ?? a.created_at));
    const observasi = dgnObservasi
      .map((a) => a.observed_at)
      .filter((t): t is string => t !== null);

    const inv: Investigation = {
      inv_id,
      seed: 20260809,
      aoi: aoiDari(inv_id, sar),
      zona: zone?.type === "zone_rule" ? zone.payload.zona : (lama?.zona ?? null),
      // t_acquisition tidak dapat diturunkan dari payload kontrak mana pun
      // (sar_detection tidak membawa t_acq); pakai tulisan kurator kalau ada,
      // kalau tidak jatuh ke kejadian paling awal.
      t_acquisition: lama?.t_acquisition ?? iso(Math.min(...kejadian)),
      // "t_observasi_terakhir = max observed_at". Kalau tidak ada satu pun
      // observed_at yang dapat diturunkan, nilai kurator as-built DIPERTAHANKAN
      // (untuk inv-natuna ia memegang akhir loitering GFW nyata yang hanya
      // hidup di prosa provenance); baru sesudah itu jatuh ke created_at.
      t_observasi_terakhir:
        observasi.length > 0
          ? iso(Math.max(...observasi.map((t) => Date.parse(t))))
          : (lama?.t_observasi_terakhir ?? iso(Math.max(...kejadian))),
      split: lama?.split ?? split,
      sintetis: lama?.sintetis ?? artefak.some((a) => a.sintetis),
      kasus: lama?.kasus ?? {
        label: "going-dark",
        peran_demo:
          `Kasus satu-modalitas: ${artefak.length} deteksi SAR nyata xView3 tanpa artefak AIS ` +
          `apa pun pada investigasi ini, sehingga rule kinematik_gap tidak terpenuhi dan ` +
          `cakupan AIS tercatat hilang. Label kasus adalah entri TERDEKAT pada enum beku ` +
          `Bagian 1 (kapal terlihat radar tanpa AIS); index/manifest.json masih mencatat ` +
          `kasus null dan penetapan label final menunggu keputusan kurasi.`,
      },
      // "candidate dari artefak sar pertama bila ada". Tanpa SAR: nilai kurator
      // as-built (inv-natuna memegang koordinat loitering GFW nyata) sebelum
      // jatuh ke nol — nol yang dikarang lebih buruk daripada nol yang benar.
      candidate:
        sar?.type === "sar_detection"
          ? {
              lat: sar.payload.lat,
              lon: sar.payload.lon,
              length_m_est: sar.payload.length_m_est ?? 0,
              confidence_calibrated: sar.payload.confidence_calibrated ?? 0,
            }
          : (lama?.candidate ?? { lat: 0, lon: 0, length_m_est: 0, confidence_calibrated: 0 }),
      artifacts: artefak.map((a) => a.art_id),
      status_server,
      agent_proposal: lama?.agent_proposal ?? null,
      berkas: lama?.berkas ?? { sections: [], diksi_ok: true },
      patrol: lama?.patrol ?? { package_id: null, result: null },
    };

    // Batas tulis: bentuk penuh Bagian 1 + keenam rule Bagian 4. Golden yang
    // gagal skema tidak boleh mendarat di repo.
    InvestigationSchema.parse(inv);
    StatusServerKetatSchema.parse(status_server);

    if (!dry) {
      await writeFile(join(invDir(inv_id), "investigation.json"), JSON.stringify(inv, null, 1));
    }
    const s = status_server;
    process.stdout.write(
      `  ${inv_id}: ${s.status}${s.abstain_reason ? `/${s.abstain_reason}` : ""} ` +
        `sensors=${s.sensors_independent} zona=${s.zone_violation} ` +
        `usia=${s.evidence_age_h.toFixed(3)}j decay=${s.decay_applied} ` +
        `reasons=${s.reasons.length} hash=${s.hash}\n`,
    );
  }
}

await main();

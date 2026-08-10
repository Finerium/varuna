// ============================================================================
// PORT PALSU + MODEL PALSU — TIDAK ADA PANGGILAN API DI SELURUH SUITE INI.
//
// Setiap angka dan koordinat di berkas ini dikarang penulis tes; semua artefak
// berlabel `sintetis: true` sesuai contracts.md Bagian 0. Yang diuji adalah
// KODE PRODUKSI yang sama persis dengan jalur live — yang berbeda hanya tiga
// port yang disuntik: Model, SumberBukti, dan RuntimeStore.
// ============================================================================

import { Runner, Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";

import { computeStatus, type Thresholds } from "@varuna/core/pasha";
import { InvestigationSchema, type Artifact, type Investigation } from "@varuna/core/schemas";
import type { RuntimeStore } from "@varuna/core/store";

import type { MesinAgen, SumberBukti } from "../src/mesin.ts";

export const INV_ID = "inv-uji-01";
export const NOW = "2026-08-09T06:00:00.000Z";

/** Sama dengan experiments/e5/thresholds.lock.json pada saat tes ditulis;
 *  disalin ke sini supaya tes tidak bergantung pada berkas eksperimen. */
export const AMBANG: Thresholds = { usia_max_h: 144, ambang_kn: 50, konflik_jendela_jam: 6 };

const hex = (n: number): string => n.toString(16).padStart(64, "0");

export const ART = {
  deteksi: "a-uji-01-d01",
  gap: "a-uji-01-g01",
  kinematik: "a-uji-01-k01",
  zona: "a-uji-01-z01",
  /** Hanya ada di indeks runtime, bukan di golden statis. */
  runtime: "a-uji-01-r01",
} as const;

const sumber = (dataset: Artifact["source"]["dataset"], ref: string) => ({
  dataset,
  ref,
  provenance: `Artefak sintetis penulis tes (${ref}); bukan data nyata.`,
});

export const ARTEFAK_UJI: Artifact[] = [
  {
    art_id: ART.deteksi,
    inv_id: INV_ID,
    type: "sar_detection",
    source: sumber("xview3-public", "scene-uji-01"),
    sintetis: true,
    payload: {
      lat: 3.94,
      lon: 108.21,
      row: 100,
      col: 200,
      length_m_est: 62,
      objectness_p: 0.9,
      vessel_p: 0.88,
      fishing_p: 0.7,
      confidence_calibrated: 0.81,
      scene_id: "scene-uji-01",
    },
    created_at: "2026-08-09T05:00:00.000Z",
    observed_at: "2026-08-09T02:00:00.000Z",
    hash_sha256: hex(1),
  },
  {
    art_id: ART.gap,
    inv_id: INV_ID,
    type: "ais_gap",
    source: sumber("dma-aisdk", "mmsi-uji"),
    sintetis: true,
    payload: {
      mmsi_hash: "9f3c1a77b2e05d64",
      t_start: "2026-08-08T20:00:00.000Z",
      t_end: "2026-08-09T03:00:00.000Z",
      durasi_jam: 7,
      sog_sebelum: 8.2,
    },
    created_at: "2026-08-09T05:00:00.000Z",
    observed_at: "2026-08-09T03:00:00.000Z",
    hash_sha256: hex(2),
  },
  {
    art_id: ART.kinematik,
    inv_id: INV_ID,
    type: "kinematic_feasibility",
    source: sumber("runtime", "uji-kinematik"),
    sintetis: true,
    payload: {
      gap_art_id: ART.gap,
      det_art_id: ART.deteksi,
      jarak_km: 18,
      dt_jam: 6,
      sog_implied: 1.6,
      ambang_kn: 50,
      lolos: true,
    },
    created_at: "2026-08-09T05:00:00.000Z",
    observed_at: "2026-08-09T03:00:00.000Z",
    hash_sha256: hex(3),
  },
  {
    art_id: ART.zona,
    inv_id: INV_ID,
    type: "zone_rule",
    source: sumber("marineregions-eez", "zee-id-uji"),
    sintetis: true,
    payload: {
      zona: "ZEE-ID",
      posisi: "inside",
      violation: true,
      basis_aturan: "T4-ZEE-INSIDE-UNLICENSED",
      geometri_ref: "uji#0",
    },
    created_at: "2026-08-09T05:00:00.000Z",
    observed_at: "2026-08-09T02:00:00.000Z",
    hash_sha256: hex(4),
  },
];

/** status_server dihitung PASHA sungguhan, bukan ditulis tangan: fixture yang
 *  statusnya dikarang akan membuat `diff` pada peristiwa done tidak bermakna. */
export const INVESTIGASI_UJI: Investigation = InvestigationSchema.parse({
  inv_id: INV_ID,
  seed: 20260809,
  aoi: "natuna",
  zona: "ZEE-ID",
  t_acquisition: "2026-08-09T02:00:00.000Z",
  t_observasi_terakhir: "2026-08-09T03:00:00.000Z",
  split: "demo",
  sintetis: true,
  kasus: { label: "going-dark", peran_demo: "Fixture sintetis untuk suite executor." },
  candidate: { lat: 3.94, lon: 108.21, length_m_est: 62, confidence_calibrated: 0.81 },
  artifacts: ARTEFAK_UJI.map((a) => a.art_id),
  status_server: computeStatus(ARTEFAK_UJI, NOW, AMBANG),
  agent_proposal: null,
  berkas: { sections: [], diksi_ok: true },
  patrol: { package_id: null, result: null },
});

// ---------------------------------------------------------------------------
// Port palsu
// ---------------------------------------------------------------------------

export function storePalsu(): RuntimeStore & { isi: Map<string, unknown[]> } {
  const isi = new Map<string, unknown[]>();
  return {
    isi,
    async append(kunci, rekaman) {
      isi.set(kunci, [...(isi.get(kunci) ?? []), rekaman]);
    },
    async read(kunci) {
      return isi.get(kunci) ?? [];
    },
  };
}

export function sumberPalsu(opsi: { investigasi?: Investigation | null } = {}): SumberBukti {
  const inv = opsi.investigasi === undefined ? INVESTIGASI_UJI : opsi.investigasi;
  return {
    async investigasi(inv_id) {
      return inv !== null && inv_id === inv.inv_id ? inv : null;
    },
    async artefak() {
      return ARTEFAK_UJI;
    },
    async indeksStatis() {
      return ARTEFAK_UJI.map((a) => a.art_id);
    },
    async indeksRuntime() {
      return [ART.runtime];
    },
  };
}

// ---------------------------------------------------------------------------
// Model palsu
// ---------------------------------------------------------------------------

export type Balasan =
  | { alat: string; fokus?: string }
  | { alatJamak: string[] }
  | { jawab: unknown }
  | { teksMentah: string };

/** Cacah token karangan, tetap per panggilan: instrumentasi biaya (executor
 *  `Pemakaian`) baru bisa diuji kalau model palsu memulangkan angka, dan angka
 *  tetap membuat totalnya bisa dihitung tangan di tes. */
export const PAKAI_PALSU = { in: 100, out: 10, requests: 1 } as const;
const usage = () => new Usage({ inputTokens: PAKAI_PALSU.in, outputTokens: PAKAI_PALSU.out });

function balasanKeResponse(b: Balasan, n: number): ModelResponse {
  if ("alat" in b) {
    return {
      usage: usage(),
      output: [
        {
          type: "function_call",
          callId: `call-${n}`,
          name: b.alat,
          arguments: JSON.stringify({ fokus: b.fokus ?? "periksa bukti investigasi ini" }),
          status: "completed",
        },
      ],
    };
  }
  if ("alatJamak" in b) {
    return {
      usage: usage(),
      output: b.alatJamak.map((nama, i) => ({
        type: "function_call" as const,
        callId: `call-${n}-${i}`,
        name: nama,
        arguments: JSON.stringify({ fokus: "periksa bukti investigasi ini" }),
        status: "completed" as const,
      })),
    };
  }
  const teks = "teksMentah" in b ? b.teksMentah : JSON.stringify(b.jawab);
  return {
    usage: usage(),
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: teks }],
      },
    ],
  };
}

export type ModelPalsu = Model & { permintaan: ModelRequest[] };

/** `naskah` menerima permintaan model dan nomor urut panggilan, lalu memutuskan
 *  balasannya. Sengaja fungsi, bukan antrean: tes jadi menyatakan "kalau A0
 *  ditanya, panggil A2" alih-alih bergantung pada urutan panggilan internal. */
export function modelPalsu(naskah: (req: ModelRequest, n: number) => Balasan): ModelPalsu {
  const permintaan: ModelRequest[] = [];
  return {
    permintaan,
    async getResponse(req) {
      permintaan.push(req);
      return balasanKeResponse(naskah(req, permintaan.length), permintaan.length);
    },
    getStreamedResponse() {
      throw new Error("model palsu: jalur streaming tidak dipakai executor");
    },
  };
}

/** Permintaan milik A0 dikenali dari kehadiran tool; sub-agen tidak punya tool. */
export const untukA0 = (req: ModelRequest): boolean => req.tools.length > 0;

export const teksMasukan = (req: ModelRequest): string =>
  typeof req.input === "string" ? req.input : JSON.stringify(req.input);

export function mesinPalsu(
  model: Model,
  opsi: {
    sumber?: SumberBukti;
    store?: ReturnType<typeof storePalsu>;
    sekarang?: () => string;
  } = {},
): MesinAgen & { store: ReturnType<typeof storePalsu> } {
  const store = opsi.store ?? storePalsu();
  return {
    sumber: opsi.sumber ?? sumberPalsu(),
    store,
    runner: new Runner({ model, modelSettings: { temperature: 0 }, tracingDisabled: true }),
    thresholds: AMBANG,
    sekarang: opsi.sekarang ?? (() => NOW),
    idRun: () => "uji001",
  };
}

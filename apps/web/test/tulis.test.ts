// Jalur tulis di level ROUTE — contracts.md Bagian 3, 4, 5.
//
// Logikanya sendiri diuji unit di packages/core/test/runtime.test.ts (murni,
// tanpa I/O). Yang diperiksa DI SINI adalah PEMASANGANNYA: penjaga peran,
// kode status, urutan gerbang, dan bahwa satu kiriman patroli sungguh berakhir
// sebagai artefak yang boleh dikutip replay berikutnya. Handler dipanggil
// langsung sebagai fungsi — Request masuk, Response keluar — jadi tidak ada
// server yang perlu hidup dan tidak ada .env produksi yang tersentuh.
//
// Adapter runtime yang dipakai: filesystem, di direktori sementara. DATABASE_URL
// dikosongkan di sini supaya tes tidak pernah bisa menulis ke basis data
// produksi, bahkan bila lingkungan kebetulan memuatnya.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COOKIE_PERAN, type Peran } from "@varuna/core/peran";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as getKalibrasi, POST as postKalibrasi } from "@/app/api/calibration/route";
import { GET as getPaket } from "@/app/api/patrol/packages/route";
import { POST as postHasil } from "@/app/api/patrol/results/route";
import { GET as getAntrean } from "@/app/api/queue/route";
import { POST as postValidasi } from "@/app/api/validate/route";
import { ambilArtefak, indeksGroundingRuntime } from "@/lib/gudang";
import { AMBANG_SEED } from "@/lib/tulis";

/** Kasus golden berlabel "patroli", status terindikasi, dua deteksi SAR — persis
 *  investigasi yang alur ini memang dimaksudkan untuk dijalani. */
const INV = "inv-x3-c078ff51-01";
const PKG = "pkg-x3-c078ff51-01";
/** Kasus going-dark yang status servernya ABSTAIN; paket tidak boleh lahir. */
const INV_ABSTAIN = "inv-natuna-20260805-01";

beforeAll(() => {
  process.env.DATABASE_URL = "";
  process.env.VARUNA_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "varuna-tulis-"));
});

const minta = (jalur: string, peran: Peran | null, badan?: unknown): Request =>
  new Request(`http://tes.local${jalur}`, {
    method: badan === undefined ? "GET" : "POST",
    headers: peran === null ? {} : { cookie: `${COOKIE_PERAN}=${peran}` },
    body: badan === undefined ? undefined : JSON.stringify(badan),
  });

const isi = async (r: Response): Promise<Record<string, never>> =>
  (await r.json()) as Record<string, never>;

describe("penjaga peran ditegakkan di route sebelum apa pun yang lain", () => {
  it("menolak tulis tanpa cookie peran", async () => {
    const r = await postValidasi(minta("/api/validate", null, { inv_id: INV, aksi: "setuju" }));
    expect(r.status).toBe(403);
  });

  it("menolak peran yang salah pada tiap jalur tulis", async () => {
    expect(
      (await postValidasi(minta("/api/validate", "patroli", { inv_id: INV, aksi: "setuju" })))
        .status,
    ).toBe(403);
    expect(
      (
        await postHasil(
          minta("/api/patrol/results", "analis", { paket_id: PKG, hasil: "sesuai", catatan: "" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postKalibrasi(
          minta("/api/calibration", "patroli", { ambang: { ambang_kn: 42 }, alasan: "coba" }),
        )
      ).status,
    ).toBe(403);
  });

  it("menolak badan yang tidak sesuai kontrak dengan 400, bukan 500", async () => {
    expect((await postValidasi(minta("/api/validate", "analis", { inv_id: INV }))).status).toBe(
      400,
    );
    expect(
      (await postHasil(minta("/api/patrol/results", "patroli", { hasil: "sesuai" }))).status,
    ).toBe(400);
  });
});

describe("alur analis -> patroli lewat route sungguhan", () => {
  it("aksi setuju mencetak paket; status_server tidak ikut bergeser", async () => {
    const r = await postValidasi(
      minta("/api/validate", "analis", { inv_id: INV, aksi: "setuju", catatan: "Layak dicek." }),
    );
    expect(r.status).toBe(200);
    expect(await isi(r)).toMatchObject({ package_id: PKG, aksi: "terima" });

    const antrean = await isi(await getAntrean(minta("/api/queue?limit=50", "analis")));
    const item = (antrean.items as unknown as Array<Record<string, never>>).find(
      (i) => (i.inv_id as unknown) === INV,
    );
    // Overlay terbaca; statusnya tetap yang dihitung PASHA dari artefak.
    expect((item?.validasi as unknown as { aksi: string }).aksi).toBe("terima");
    expect(item?.status as unknown).toBe("terindikasi");
  });

  it("paket tampil di daftar patroli sebagai area pencarian, bukan posisi pasti", async () => {
    const daftar = await isi(await getPaket(minta("/api/patrol/packages", "patroli")));
    const paket = (daftar.items as unknown as Array<Record<string, never>>)[0] as unknown as {
      package_id: string;
      label: string;
      issued_at: string;
      expires_at: string;
      area: { radius_km: number };
      geometri: { coordinates: Array<Array<[number, number]>> };
    };

    expect(paket.package_id).toBe(PKG);
    expect(paket.label).toBe("area pencarian, bukan posisi pasti");
    expect(paket.geometri.coordinates[0]).toHaveLength(33);
    expect(paket.area.radius_km).toBeGreaterThan(0);
    expect(paket.area.radius_km).toBeLessThanOrEqual(150);
    expect(Date.parse(paket.expires_at)).toBeGreaterThan(Date.parse(paket.issued_at));
  });

  it("catatan berpola identitas ditolak 422 SEBELUM apa pun ditulis", async () => {
    const r = await postHasil(
      minta("/api/patrol/results", "patroli", {
        paket_id: PKG,
        hasil: "sesuai",
        catatan: "kapal 525123456 terlihat",
      }),
    );
    expect(r.status).toBe(422);
    expect(await indeksGroundingRuntime(INV)).toEqual([]);
  });

  it("hasil bersih lahir sebagai artefak patrol_report yang boleh dikutip replay", async () => {
    const r = await postHasil(
      minta("/api/patrol/results", "patroli", {
        paket_id: PKG,
        hasil: "tidak_sesuai",
        catatan: "Kapal berbeda ukuran dari yang dijelaskan berkas.",
        posisi: { lat: 3.94, lon: 108.21 },
      }),
    );
    expect(r.status).toBe(201);
    const { art_id } = (await isi(r)) as unknown as { art_id: string };

    const laporan = (await ambilArtefak(INV)).find((a) => a.art_id === art_id);
    expect(laporan?.type).toBe("patrol_report");
    expect(laporan?.source.dataset).toBe("runtime");
    // Separuh runtime resolver grounding: tanpa baris ini artefaknya ada tetapi
    // tidak pernah boleh dikutip.
    expect(await indeksGroundingRuntime(INV)).toContain(art_id);
  });

  it("hasil atas paket yang tidak pernah dicetak ditolak 404", async () => {
    const r = await postHasil(
      minta("/api/patrol/results", "patroli", { paket_id: "pkg-tidak-ada", hasil: "sesuai" }),
    );
    expect(r.status).toBe(404);
  });

  it("aksi setuju atas investigasi ABSTAIN gagal apa adanya, tanpa paket hantu", async () => {
    const r = await postValidasi(
      minta("/api/validate", "analis", { inv_id: INV_ABSTAIN, aksi: "setuju" }),
    );
    expect(r.status).toBe(409);
    expect((await isi(r)).pesan as unknown).toContain("ABSTAIN");

    const daftar = await isi(await getPaket(minta("/api/patrol/packages", "patroli")));
    expect(daftar.items as unknown as unknown[]).toHaveLength(1);
  });

  it("investigasi yang tidak ada di Evidence Store ditolak 404", async () => {
    const r = await postValidasi(
      minta("/api/validate", "analis", { inv_id: "inv-x3-00000000-99", aksi: "setuju" }),
    );
    expect(r.status).toBe(404);
  });
});

describe("kalibrasi: overlay beraudit, seed lock tak tersentuh", () => {
  it("POST menggeser ambang efektif dan mencatat lama -> baru", async () => {
    const r = await postKalibrasi(
      minta("/api/calibration", "analis", {
        ambang: { ambang_kn: 42 },
        alasan: "Hasil patroli tidak pernah menegaskan kecepatan implied di atas 42 kn.",
      }),
    );
    expect(r.status).toBe(201);
    expect(((await isi(r)).deltas as unknown as Array<Record<string, never>>)[0]).toMatchObject({
      param: "ambang_kn",
      lama: AMBANG_SEED.ambang_kn,
      baru: 42,
    });

    const daftar = await isi(await getKalibrasi(minta("/api/calibration", "analis")));
    expect((daftar.ambang_efektif as unknown as { ambang_kn: number }).ambang_kn).toBe(42);
    // experiments/e5/thresholds.lock.json TIDAK PERNAH ditulis produk.
    expect(daftar.ambang_seed as unknown).toEqual(AMBANG_SEED);
    expect(AMBANG_SEED.ambang_kn).toBe(50);
  });

  it("mengirim ulang nilai yang sudah berlaku ditolak 409", async () => {
    const r = await postKalibrasi(
      minta("/api/calibration", "analis", { ambang: { ambang_kn: 42 }, alasan: "ulang" }),
    );
    expect(r.status).toBe(409);
  });
});

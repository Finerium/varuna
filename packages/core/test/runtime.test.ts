import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { canonicalJson, type ArtifactLike, type Thresholds } from "../src/pasha";
import {
  AMBANG_PARAM,
  BBOX_ZONA,
  KUNCI_VALIDASI,
  PermintaanHasilSchema,
  PermintaanKalibrasiSchema,
  PermintaanValidasiSchema,
  RADIUS_MAKS_KM,
  RADIUS_MIN_KM,
  RekamanValidasiSchema,
  TITIK_LINGKARAN,
  ambangEfektif,
  areaPencarian,
  artefakPatrolReport,
  cekIdentitas,
  cetakPaket,
  deltaKalibrasi,
  invDariPaketId,
  kunciArtefak,
  kunciGrounding,
  observasiTerakhir,
  overlayValidasi,
  paketIdDari,
  paketTerkini,
  postgresRuntimeStore,
  tolakTeksBebas,
  type EksekutorSql,
} from "../src/runtime";
import { ArtifactSchema, type Investigation } from "../src/schemas";
import type { RuntimeStore } from "../src/store";
import { INV, MMSI_HASH, POS, PKG_ID, T, mk, resetSeq } from "./fixtures";

// ============================================================================
// Jalur tulis runtime — contracts.md Bagian 1, 3, 4, 5.
//
// Interpretasi yang diuji di sini (dicatat karena kontrak diam soal detailnya):
// R1. Kontrak menuliskan dua kosakata untuk badan permintaan yang sama
//     (action/aksi, finding/hasil). Keduanya diterima di pintu masuk dan
//     DINORMALKAN ke kosakata kontrak; yang tersimpan hanya satu.
// R2. Radius area pencarian dijepit di antara lantai (RADIUS_MIN_KM: radius nol
//     akan menyatakan posisi pasti, dan label paket berbunyi sebaliknya) dan
//     plafon (RADIUS_MAKS_KM).
// R3. zona_clip null = tidak ada artefak zone_rule untuk dipotong. Menuliskan
//     zona di situ akan mengarang klaim yurisdiksi.
// R4. Overlay validasi dan overlay kalibrasi menimpa pada BACAAN; simpanannya
//     tetap append-only.
// ============================================================================

const AMBANG: Thresholds = { usia_max_h: 144, ambang_kn: 50, konflik_jendela_jam: 6 };

const T_NOW = "2026-08-09T04:00:00.000Z";

beforeEach(() => resetSeq());

// ---------------------------------------------------------------------------
// Adapter: kontrak RuntimeStore
// ---------------------------------------------------------------------------

/** Tabel di memori yang berperilaku seperti runtime_rekaman: bigserial menaik,
 *  jsonb, tanpa UPDATE dan tanpa DELETE. Ini yang menggantikan mock DB — jalur
 *  produksi memakai eksekutor yang sama bentuknya, tanpa cabang tes. */
function tabelMemori(): { eksekutor: EksekutorSql; jejak: string[]; baris: number } {
  const isi: Array<{ kunci: string; idx: number; rekaman: string }> = [];
  const jejak: string[] = [];
  let idx = 0;
  const state = {
    jejak,
    get baris() {
      return isi.length;
    },
    eksekutor: (async (teks, params) => {
      jejak.push(teks.split("\n")[0] as string);
      if (teks.startsWith("CREATE")) return [];
      if (teks.startsWith("INSERT")) {
        idx += 1;
        isi.push({ kunci: params[0] as string, idx, rekaman: params[1] as string });
        return [];
      }
      if (teks.startsWith("SELECT")) {
        return isi
          .filter((b) => b.kunci === params[0])
          .sort((a, b) => a.idx - b.idx)
          .map((b) => ({ rekaman: JSON.parse(b.rekaman) as unknown }));
      }
      throw new Error(`kueri tak dikenal: ${teks}`);
    }) satisfies EksekutorSql,
  };
  return state;
}

describe("postgresRuntimeStore — kontrak adapter RuntimeStore", () => {
  it("membaca kembali apa yang ditulis, dalam urutan tulis", async () => {
    const { eksekutor } = tabelMemori();
    const store = postgresRuntimeStore(eksekutor);

    await store.append("runtime/a.jsonl", { n: 1 });
    await store.append("runtime/a.jsonl", { n: 2 });
    await store.append("runtime/a.jsonl", { n: 3 });

    expect(await store.read("runtime/a.jsonl")).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("memisahkan kunci: satu kunci tidak pernah melihat baris kunci lain", async () => {
    const { eksekutor } = tabelMemori();
    const store = postgresRuntimeStore(eksekutor);

    await store.append("runtime/a.jsonl", { dari: "a" });
    await store.append("runtime/b.jsonl", { dari: "b" });

    expect(await store.read("runtime/a.jsonl")).toEqual([{ dari: "a" }]);
    expect(await store.read("runtime/b.jsonl")).toEqual([{ dari: "b" }]);
  });

  it("mengembalikan daftar kosong untuk kunci yang belum pernah ditulis", async () => {
    const { eksekutor } = tabelMemori();
    expect(await postgresRuntimeStore(eksekutor).read("runtime/kosong.jsonl")).toEqual([]);
  });

  it("menjalankan migrasi idempoten tepat sekali per adapter", async () => {
    const { eksekutor, jejak } = tabelMemori();
    const store = postgresRuntimeStore(eksekutor);

    await Promise.all([
      store.append("runtime/a.jsonl", { n: 1 }),
      store.append("runtime/a.jsonl", { n: 2 }),
    ]);
    await store.read("runtime/a.jsonl");

    expect(jejak.filter((q) => q.startsWith("CREATE TABLE"))).toHaveLength(1);
    expect(jejak.filter((q) => q.startsWith("CREATE INDEX"))).toHaveLength(1);
    // DDL selalu IF NOT EXISTS: dijalankan ulang oleh instansi fungsi lain pun
    // tidak melempar.
    expect(jejak[0]).toContain("IF NOT EXISTS");
  });

  it("mencoba migrasi lagi setelah gagal (sekali gagal bukan gagal selamanya)", async () => {
    let gagalkan = true;
    const dasar = tabelMemori();
    const store = postgresRuntimeStore(async (teks, params) => {
      if (gagalkan && teks.startsWith("CREATE TABLE")) throw new Error("jaringan putus");
      return dasar.eksekutor(teks, params);
    });

    await expect(store.append("runtime/a.jsonl", { n: 1 })).rejects.toThrow("jaringan putus");
    gagalkan = false;
    await store.append("runtime/a.jsonl", { n: 1 });
    expect(await store.read("runtime/a.jsonl")).toEqual([{ n: 1 }]);
  });

  it("menerima jsonb yang dipulangkan driver sebagai teks maupun objek", async () => {
    const store = postgresRuntimeStore(async (teks) =>
      teks.startsWith("SELECT") ? [{ rekaman: '{"n":7}' }] : [],
    );
    expect(await store.read("runtime/a.jsonl")).toEqual([{ n: 7 }]);
  });

  it("tidak pernah memancarkan UPDATE atau DELETE (append-only, Bagian 1)", async () => {
    const { eksekutor, jejak } = tabelMemori();
    const store = postgresRuntimeStore(eksekutor);
    await store.append("runtime/a.jsonl", { n: 1 });
    await store.read("runtime/a.jsonl");
    expect(jejak.some((q) => /^(UPDATE|DELETE)/.test(q))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Area pencarian
// ---------------------------------------------------------------------------

/** Artefak dengan waktu kejadian yang ditentukan tes. `observed_at` ditempel di
 *  sini (bukan lewat fixture) karena amandemen K-A1 aditif: bentuk fixture
 *  lama tetap apa adanya. */
const sarPada = (at: string, pos: { lat: number; lon: number } = POS.a): ArtifactLike => ({
  ...(mk.sar({ created_at: at }, pos) as unknown as ArtifactLike),
  observed_at: at,
});

const jamSetelah = (dasar: string, jam: number): string =>
  new Date(Date.parse(dasar) + jam * 3_600_000).toISOString();

describe("areaPencarian — geometri dihitung server (Bagian 5)", () => {
  it("memusatkan area pada observasi TERAKHIR, bukan yang pertama", () => {
    const area = areaPencarian(
      [sarPada("2026-08-09T00:00:00.000Z", POS.bJauh), sarPada("2026-08-09T02:00:00.000Z", POS.a)],
      T_NOW,
      AMBANG,
    );
    expect(area?.center).toEqual({ lat: POS.a.lat, lon: POS.a.lon });
    expect(area?.dasar.observed_at).toBe("2026-08-09T02:00:00.000Z");
  });

  it("jam = 0 jatuh ke lantai radius, bukan ke lingkaran nol", () => {
    const at = "2026-08-09T04:00:00.000Z";
    const area = areaPencarian([sarPada(at)], at, AMBANG);
    expect(area?.dasar.jam_sejak_observasi).toBe(0);
    expect(area?.radius_km).toBe(RADIUS_MIN_KM);
    // Lantai tetap poligon sah, bukan titik: 32 simpul berbeda + penutup.
    const cincin = area?.geometri.coordinates[0] ?? [];
    expect(cincin).toHaveLength(TITIK_LINGKARAN + 1);
    expect(new Set(cincin.slice(0, TITIK_LINGKARAN).map((c) => c.join(","))).size).toBe(
      TITIK_LINGKARAN,
    );
  });

  it("tumbuh dengan ambang_kn x jam x 1,852 sebelum menyentuh plafon", () => {
    const at = "2026-08-09T00:00:00.000Z";
    // 50 kn x 1 jam x 1,852 km/NM = 92,6 km, masih di bawah plafon 150 km.
    const area = areaPencarian([sarPada(at)], jamSetelah(at, 1), AMBANG);
    expect(area?.radius_km).toBeCloseTo(50 * 1 * 1.852, 6);
    expect(area?.dasar.radius_dipotong).toBe(false);
  });

  it("jam besar terpotong plafon 150 km dan menandainya", () => {
    const at = "2026-08-09T00:00:00.000Z";
    const area = areaPencarian([sarPada(at)], jamSetelah(at, 240), AMBANG);
    expect(area?.radius_km).toBe(RADIUS_MAKS_KM);
    expect(area?.dasar.radius_dipotong).toBe(true);
  });

  it("observasi di masa depan tidak membuat radius negatif", () => {
    const at = "2026-08-09T10:00:00.000Z";
    const area = areaPencarian([sarPada(at)], "2026-08-09T04:00:00.000Z", AMBANG);
    expect(area?.dasar.jam_sejak_observasi).toBe(0);
    expect(area?.radius_km).toBe(RADIUS_MIN_KM);
  });

  it("tanpa artefak zone_rule: zona_clip null dan tidak ada pemotongan", () => {
    const at = "2026-08-09T00:00:00.000Z";
    const area = areaPencarian([sarPada(at)], jamSetelah(at, 1), AMBANG);
    expect(area?.zona_clip).toBeNull();
    const lon = (area?.geometri.coordinates[0] ?? []).map((c) => c[0]);
    // Lingkaran 92,6 km di 108,2 BT menembus tepi bbox Natuna (111 BT? tidak),
    // tetapi yang diuji di sini: tanpa zona, tepi barat/timur simetris.
    expect(Math.max(...lon) - POS.a.lon).toBeCloseTo(POS.a.lon - Math.min(...lon), 5);
  });

  it("dengan artefak zone_rule: seluruh simpul berada di dalam bbox zona", () => {
    const at = "2026-08-09T00:00:00.000Z";
    const zona = mk.zone(true) as unknown as ArtifactLike;
    // 30 jam x 50 kn -> jauh melampaui kotak Natuna, jadi pemotongan pasti
    // menggigit di keempat sisi.
    const area = areaPencarian([sarPada(at), zona], jamSetelah(at, 30), AMBANG);
    expect(area?.zona_clip).toBe("ZEE-ID");

    const [lonMin, latMin, lonMaks, latMaks] = BBOX_ZONA["ZEE-ID"];
    for (const [x, y] of area?.geometri.coordinates[0] ?? []) {
      expect(x).toBeGreaterThanOrEqual(lonMin);
      expect(x).toBeLessThanOrEqual(lonMaks);
      expect(y).toBeGreaterThanOrEqual(latMin);
      expect(y).toBeLessThanOrEqual(latMaks);
    }
  });

  it("memulangkan cincin GeoJSON tertutup dan berlawanan arah jarum jam", () => {
    const at = "2026-08-09T00:00:00.000Z";
    const cincin = areaPencarian([sarPada(at)], jamSetelah(at, 1), AMBANG)?.geometri
      .coordinates[0] as Array<[number, number]>;

    expect(cincin[0]).toEqual(cincin[cincin.length - 1]);
    // Luas bertanda (shoelace) positif = berlawanan arah jarum jam (RFC 7946).
    let luas2 = 0;
    for (let i = 0; i < cincin.length - 1; i++) {
      const [x1, y1] = cincin[i] as [number, number];
      const [x2, y2] = cincin[i + 1] as [number, number];
      luas2 += x1 * y2 - x2 * y1;
    }
    expect(luas2).toBeGreaterThan(0);
  });

  it("memakai fix TERAKHIR segmen AIS sebagai posisi observasi", () => {
    const trek = mk.aisTrack() as unknown as ArtifactLike;
    const obs = observasiTerakhir([trek]);
    expect(obs?.lat).toBeCloseTo(3.9412, 6);
    expect(obs?.at).toBe("2026-08-09T02:00:00.000Z");
  });

  it("tanpa artefak berposisi sama sekali: null, bukan pusat karangan", () => {
    expect(areaPencarian([mk.behavior() as unknown as ArtifactLike], T_NOW, AMBANG)).toBeNull();
    expect(observasiTerakhir([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Paket sasaran
// ---------------------------------------------------------------------------

const invPalsu = (over: Partial<Investigation> = {}): Investigation =>
  ({
    inv_id: INV,
    seed: 20260809,
    aoi: "natuna",
    zona: "ZEE-ID",
    t_acquisition: T.acq,
    t_observasi_terakhir: T.acq,
    split: "demo",
    sintetis: true,
    kasus: { label: "patroli", peran_demo: "Fixture sintetis." },
    candidate: { lat: POS.a.lat, lon: POS.a.lon, length_m_est: 41.6, confidence_calibrated: 0.82 },
    artifacts: [],
    status_server: {
      status: "terindikasi",
      computed_at: T_NOW,
      hash: "0".repeat(64),
      sensors_independent: 1,
      zone_violation: true,
      evidence_age_h: 2,
      decay_applied: false,
      conflicting_art_ids: [],
      missing_coverage: [],
      reasons: [],
      abstain_reason: null,
      display_state: [],
    },
    agent_proposal: null,
    berkas: { sections: [], diksi_ok: true },
    patrol: { package_id: null, result: null },
    ...over,
  }) as Investigation;

describe("cetakPaket — server pemilik package_id/issued_at/expires_at (Bagian 5)", () => {
  it("mencetak paket untuk status terindikasi, terpin ke investigasinya", () => {
    const hasil = cetakPaket(invPalsu(), [sarPada(T.acq)], T_NOW, AMBANG);
    expect("paket" in hasil).toBe(true);
    if (!("paket" in hasil)) return;

    expect(hasil.paket.package_id).toBe(PKG_ID);
    expect(hasil.paket.inv_id).toBe(INV);
    expect(hasil.paket.status_tingkat).toBe("terindikasi");
    expect(hasil.paket.label).toBe("area pencarian, bukan posisi pasti");
    expect(hasil.paket.issued_at).toBe(T_NOW);
    // Paket tidak hidup lebih lama daripada buktinya: usia_max_h yang sama.
    expect(Date.parse(hasil.paket.expires_at) - Date.parse(T_NOW)).toBe(
      AMBANG.usia_max_h * 3_600_000,
    );
    expect(hasil.paket.geometri.coordinates[0]).toHaveLength(TITIK_LINGKARAN + 1);
  });

  it("menolak status ABSTAIN dengan kalimat, bukan diam", () => {
    const hasil = cetakPaket(
      invPalsu({ status_server: { ...invPalsu().status_server, status: "abstain" } }),
      [sarPada(T.acq)],
      T_NOW,
      AMBANG,
    );
    expect("tolak" in hasil && hasil.tolak).toContain("ABSTAIN");
  });

  it("menolak investigasi tanpa artefak berposisi", () => {
    const hasil = cetakPaket(invPalsu(), [], T_NOW, AMBANG);
    expect("tolak" in hasil && hasil.tolak).toContain("pusat area pencarian");
  });

  it("package_id dan inv_id bolak-balik tanpa kehilangan ruas", () => {
    expect(paketIdDari(INV)).toBe(PKG_ID);
    expect(invDariPaketId(PKG_ID)).toBe(INV);
  });

  it("pencetakan ulang idempoten: satu paket per investigasi pada bacaan", () => {
    const a = cetakPaket(invPalsu(), [sarPada(T.acq)], T_NOW, AMBANG);
    const b = cetakPaket(invPalsu(), [sarPada(T.acq)], jamSetelah(T_NOW, 1), AMBANG);
    if (!("paket" in a) || !("paket" in b)) throw new Error("kedua pencetakan harus berhasil");

    const daftar = paketTerkini([a.paket, b.paket]);
    expect(daftar).toHaveLength(1);
    expect(daftar[0]?.issued_at).toBe(b.paket.issued_at);
  });
});

// ---------------------------------------------------------------------------
// Teks bebas: diksi + pola identitas (Bagian 3 + 7)
// ---------------------------------------------------------------------------

describe("penolak pola identitas — ingress teks bebas satu-satunya", () => {
  it("meloloskan catatan pengamatan biasa", () => {
    for (const teks of [
      "Kapal terlihat menarik alat tangkap di sisi timur area pencarian.",
      "Tidak ada kapal pada koordinat yang diberikan; cuaca berkabut.",
      "",
    ]) {
      expect(cekIdentitas(teks).ok, teks).toBe(true);
      expect(tolakTeksBebas(teks, "note"), teks).toBeNull();
    }
  });

  it("menolak MMSI 9 digit", () => {
    expect(cekIdentitas("kapal 525123456 terlihat").pola).toContain("mmsi");
    // 8 dan 10 digit bukan MMSI; batas angka diuji supaya penolakan tidak
    // menyapu setiap bilangan panjang.
    expect(cekIdentitas("koordinat 12345678").ok).toBe(true);
  });

  it("menolak callsign dan awalan nama kapal", () => {
    expect(cekIdentitas("callsign YB1ABC").pola).toContain("callsign");
    expect(cekIdentitas("KM Sinar Jaya berada di utara").pola).toContain("nama_kapal");
    expect(cekIdentitas("MV Nordvik lego jangkar").pola).toContain("nama_kapal");
  });

  it("menolak kata bernada putusan sebelum menolak identitas", () => {
    const pesan = tolakTeksBebas("kapal ini terbukti melanggar", "note");
    expect(pesan).toContain("terbukti");
  });

  it("kalimat penolakan menyebut kolomnya", () => {
    expect(tolakTeksBebas("hubungi 525123456", "note")).toContain("note");
    expect(tolakTeksBebas("hubungi 525123456", "catatan")).toContain("catatan");
  });
});

// ---------------------------------------------------------------------------
// Artefak patrol_report
// ---------------------------------------------------------------------------

describe("artefakPatrolReport — hash kanonis sama dengan artefak golden", () => {
  const hasil = {
    package_id: PKG_ID,
    finding: "sesuai" as const,
    note: "Kapal terlihat menarik alat tangkap.",
    submitted_at: "2026-08-09T03:40:00.000Z",
    by_role: "patroli" as const,
  };

  it("memenuhi skema Artifact dan berjenis patrol_report dari sumber runtime", () => {
    const a = artefakPatrolReport(hasil, INV, T_NOW);
    expect(ArtifactSchema.safeParse(a).success).toBe(true);
    expect(a.type).toBe("patrol_report");
    expect(a.source.dataset).toBe("runtime");
    expect(a.inv_id).toBe(INV);
    expect(a.sintetis).toBe(false);
    expect(a.observed_at).toBe(hasil.submitted_at);
  });

  it("hash = sha256 atas JSON kanonis tanpa field hash_sha256", () => {
    const a = artefakPatrolReport(hasil, INV, T_NOW);
    const { hash_sha256, ...tanpa } = a;
    expect(hash_sha256).toBe(createHash("sha256").update(canonicalJson(tanpa), "utf8").digest("hex"));
  });

  it("art_id deterministik dari payload: kiriman ulang identik tidak beranak", () => {
    const a = artefakPatrolReport(hasil, INV, T_NOW);
    const b = artefakPatrolReport(hasil, INV, jamSetelah(T_NOW, 3));
    expect(b.art_id).toBe(a.art_id);
  });

  it("art_id berbeda ketika temuan berbeda", () => {
    const a = artefakPatrolReport(hasil, INV, T_NOW);
    const b = artefakPatrolReport({ ...hasil, finding: "tidak_ditemukan" }, INV, T_NOW);
    expect(b.art_id).not.toBe(a.art_id);
  });
});

// ---------------------------------------------------------------------------
// Alur penuh: validasi -> paket -> hasil -> grounding runtime
// ---------------------------------------------------------------------------

/** Adapter memori dengan bentuk RuntimeStore, di atas tabel memori yang sama
 *  yang dipakai tes adapter — jadi alur ini melewati kode adapter sungguhan. */
const gudangMemori = (): RuntimeStore => postgresRuntimeStore(tabelMemori().eksekutor);

describe("alur happy path validasi -> paket -> hasil -> indeks grounding", () => {
  it("melahirkan artefak patrol_report yang boleh dikutip replay berikutnya", async () => {
    const gudang = gudangMemori();
    const inv = invPalsu();
    const artefak = [sarPada(T.acq)];

    // 1. Analis menyetujui (ejaan tugas build; dinormalkan ke kosakata kontrak).
    const minta = PermintaanValidasiSchema.parse({ inv_id: INV, aksi: "setuju" });
    expect(minta.aksi).toBe("terima");

    // 2. Server mencetak paket.
    const cetak = cetakPaket(inv, artefak, T_NOW, AMBANG);
    if (!("paket" in cetak)) throw new Error(cetak.tolak);
    const paket = cetak.paket;

    await gudang.append(
      KUNCI_VALIDASI,
      RekamanValidasiSchema.parse({
        jenis: "aksi_validasi",
        inv_id: INV,
        aksi: minta.aksi,
        catatan: null,
        package_id: paket.package_id,
        oleh: "analis",
        at: T_NOW,
      }),
    );

    // 3. Kru patroli mengirim hasil (ejaan tugas build).
    const kiriman = PermintaanHasilSchema.parse({
      paket_id: paket.package_id,
      hasil: "tidak_sesuai",
      catatan: "Kapal berbeda ukuran dari yang dijelaskan berkas.",
      posisi: { lat: POS.a.lat, lon: POS.a.lon },
    });
    expect(kiriman.finding).toBe("berbeda");
    expect(tolakTeksBebas(kiriman.note, "note")).toBeNull();

    const laporan = artefakPatrolReport(
      {
        package_id: kiriman.package_id,
        finding: kiriman.finding,
        note: kiriman.note,
        submitted_at: T_NOW,
        by_role: "patroli",
      },
      invDariPaketId(kiriman.package_id),
      T_NOW,
    );

    // 4. Artefak + indeks grounding runtime, dua tulisan yang jalan bersama.
    await gudang.append(kunciArtefak(INV), laporan);
    await gudang.append(kunciGrounding(INV), {
      art_ids: [laporan.art_id],
      hash: { [laporan.art_id]: laporan.hash_sha256 },
    });

    // 5. Replay berikutnya menemukan art_id itu di indeks runtime.
    const indeks = (await gudang.read(kunciGrounding(INV))).flatMap(
      (b) => (b as { art_ids: string[] }).art_ids,
    );
    expect(indeks).toContain(laporan.art_id);

    const tersimpan = await gudang.read(kunciArtefak(INV));
    expect(ArtifactSchema.parse(tersimpan[0]).art_id).toBe(laporan.art_id);

    // 6. Antrean membaca overlay validasi; status_server tidak ikut bergeser.
    const overlay = overlayValidasi(await gudang.read(KUNCI_VALIDASI));
    expect(overlay.get(INV)?.aksi).toBe("terima");
    expect(overlay.get(INV)?.package_id).toBe(paket.package_id);
    expect(inv.status_server.status).toBe("terindikasi");
  });

  it("overlay validasi mengambil aksi terakhir per investigasi", async () => {
    const gudang = gudangMemori();
    for (const [aksi, at] of [
      ["minta_penguatan", "2026-08-09T04:00:00.000Z"],
      ["terima", "2026-08-09T05:00:00.000Z"],
    ] as const) {
      await gudang.append(
        KUNCI_VALIDASI,
        RekamanValidasiSchema.parse({
          jenis: "aksi_validasi",
          inv_id: INV,
          aksi,
          catatan: null,
          package_id: null,
          oleh: "analis",
          at,
        }),
      );
    }
    const overlay = overlayValidasi(await gudang.read(KUNCI_VALIDASI));
    expect(overlay.get(INV)?.aksi).toBe("terima");
    // Barisnya tetap dua: yang menimpa adalah bacaan, bukan simpanan.
    expect(await gudang.read(KUNCI_VALIDASI)).toHaveLength(2);
  });

  it("menolak badan permintaan tanpa aksi maupun action", () => {
    expect(PermintaanValidasiSchema.safeParse({ inv_id: INV }).success).toBe(false);
    expect(PermintaanValidasiSchema.safeParse({ inv_id: "dk-01", aksi: "setuju" }).success).toBe(
      false,
    );
    expect(PermintaanValidasiSchema.parse({ inv_id: INV, action: "arsip" }).aksi).toBe("arsip");
    expect(PermintaanValidasiSchema.parse({ inv_id: INV, aksi: "tolak" }).aksi).toBe("arsip");
  });

  it("menolak kiriman hasil tanpa paket maupun temuan", () => {
    expect(PermintaanHasilSchema.safeParse({ hasil: "sesuai" }).success).toBe(false);
    expect(PermintaanHasilSchema.safeParse({ paket_id: PKG_ID }).success).toBe(false);
    expect(PermintaanHasilSchema.safeParse({ paket_id: PKG_ID, hasil: "ragu" }).success).toBe(false);
    expect(
      PermintaanHasilSchema.safeParse({ package_id: PKG_ID, finding: "sesuai", note: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kalibrasi
// ---------------------------------------------------------------------------

describe("kalibrasi — overlay di atas seed lock (Bagian 4)", () => {
  it("tanpa satu pun delta, ambang efektif = seed apa adanya", () => {
    expect(ambangEfektif(AMBANG, [])).toEqual(AMBANG);
  });

  it("delta terakhir per parameter yang menang; parameter lain tak tersentuh", () => {
    const minta = PermintaanKalibrasiSchema.parse({
      ambang: { ambang_kn: 42 },
      alasan: "Hasil patroli menunjukkan kecepatan implied di atas 42 kn tidak pernah terkonfirmasi.",
    });
    const d1 = deltaKalibrasi(AMBANG, minta, "2026-08-09T05:00:00.000Z");
    const setelah1 = ambangEfektif(AMBANG, d1);
    const d2 = deltaKalibrasi(
      setelah1,
      PermintaanKalibrasiSchema.parse({ ambang: { ambang_kn: 38 }, alasan: "Kalibrasi lanjutan." }),
      "2026-08-09T06:00:00.000Z",
    );

    const efektif = ambangEfektif(AMBANG, [...d1, ...d2]);
    expect(efektif.ambang_kn).toBe(38);
    expect(efektif.usia_max_h).toBe(AMBANG.usia_max_h);
    expect(efektif.konflik_jendela_jam).toBe(AMBANG.konflik_jendela_jam);
    // Seed sejarah tidak ikut bergeser: overlay tidak pernah menulis balik.
    expect(AMBANG.ambang_kn).toBe(50);
  });

  it("mencatat nilai lama -> baru dan jejak auditnya", () => {
    const minta = PermintaanKalibrasiSchema.parse({
      ambang: { usia_max_h: 96 },
      alasan: "Revisit nominal turun jadi 4 hari pada AOI ini.",
      sumber_package_id: PKG_ID,
    });
    const [d] = deltaKalibrasi(AMBANG, minta, "2026-08-09T05:00:00.000Z");
    expect(d).toMatchObject({
      param: "usia_max_h",
      lama: 144,
      baru: 96,
      sumber_package_id: PKG_ID,
      at: "2026-08-09T05:00:00.000Z",
    });
    expect(d?.alasan).toContain("Revisit");
  });

  it("tidak mencatat delta untuk nilai yang tidak berubah", () => {
    const minta = PermintaanKalibrasiSchema.parse({
      ambang: { ambang_kn: 50, usia_max_h: 96 },
      alasan: "Satu berubah, satu tidak.",
    });
    const deltas = deltaKalibrasi(AMBANG, minta, "2026-08-09T05:00:00.000Z");
    expect(deltas.map((d) => d.param)).toEqual(["usia_max_h"]);
  });

  it("menolak permintaan tanpa parameter ambang mana pun, dan tanpa alasan", () => {
    expect(PermintaanKalibrasiSchema.safeParse({ ambang: {}, alasan: "kosong" }).success).toBe(
      false,
    );
    expect(PermintaanKalibrasiSchema.safeParse({ ambang: { ambang_kn: 42 } }).success).toBe(false);
    expect(
      PermintaanKalibrasiSchema.safeParse({ ambang: { ambang_kn: -1 }, alasan: "negatif" }).success,
    ).toBe(false);
  });

  it("mengabaikan baris runtime yang tidak sesuai skema delta", () => {
    expect(ambangEfektif(AMBANG, [{ param: "warna_kapal", baru: 3 }, null, "bukan objek"])).toEqual(
      AMBANG,
    );
  });

  it("hanya mengenal tiga parameter ambang PASHA", () => {
    expect([...AMBANG_PARAM]).toEqual(["ambang_kn", "usia_max_h", "konflik_jendela_jam"]);
  });
});

// ---------------------------------------------------------------------------
// Penjaga fixture: mmsi_hash tidak pernah bocor lewat jalur ini
// ---------------------------------------------------------------------------

it("catatan yang memuat mmsi_hash mentah tetap teks biasa, bukan MMSI", () => {
  // mmsi_hash adalah pseudonim 16-hex, bukan MMSI 9-digit; ia tidak boleh
  // memicu penolak identitas, dan tidak boleh pula dianggap aman untuk ditulis
  // kru — kru tidak punya aksesnya sama sekali.
  expect(cekIdentitas(MMSI_HASH).ok).toBe(true);
});

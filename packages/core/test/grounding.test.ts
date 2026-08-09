import { describe, expect, it } from "vitest";

import { periksaBerkas, periksaEnvelope, resolverGrounding } from "../src/grounding";
import { INV, artId } from "./fixtures";

// ============================================================================
// Resolver grounding — contracts.md Bagian 1 (ATURAN GROUNDING) + architecture.md
// ("Grounding resolver = union(indeks statis golden, indeks runtime Blob
// append-only); penolakan level envelope"). DITULIS SEBELUM IMPLEMENTASI.
//
// Teks yang mengikat:
//   "RESOLVER GROUNDING = union(indeks statis, indeks runtime)."
//   "SETIAP art_id pada keluaran agen mana pun wajib resolvable di resolver
//    grounding; pelanggaran = keluaran `discarded` + tercatat trace; klaim
//    berkas dengan art_id tak-resolvable menolak seluruh berkas dari tampilan."
//
// Interpretasi (kontrak tidak menuliskan bentuk API):
// G1. `resolverGrounding(statis, runtime)` menerima dua koleksi art_id dan
//     mengembalikan `{ resolve(art_id): boolean }`. Union, bukan fallback:
//     tidak ada prioritas antara indeks statis dan runtime.
// G2. `periksaEnvelope(env, resolver)` mengembalikan `{ envelope, unresolved }`.
//     Pada pelanggaran, `envelope.status` menjadi "discarded"; kalau bersih,
//     status yang sudah ada DIPERTAHANKAN (envelope hasil satu perbaikan sah
//     berstatus "retry_fixed", Bagian 2). Pencatatan trace urusan executor,
//     bukan fungsi murni ini.
// G3. "SETIAP art_id pada keluaran agen" dibaca harfiah: bukan hanya
//     `artifacts_cited`, tetapi juga art_id di dalam `output`. Aturan pemindaian
//     paling sederhana yang menangkap SEMUA field art_id kontrak Bagian 2:
//     setiap kunci yang berakhiran `art_id` atau `art_ids`. Nilai null
//     (mis. `track_art_id: null` pada A4/assoc_result) bukan pelanggaran.
// G4. `periksaBerkas(sections, resolver)` -> `{ ok, unresolved }`; satu klaim
//     cacat menjatuhkan SELURUH berkas (ok=false), bukan hanya klaim itu.
// ============================================================================

const STATIS = [artId("001"), artId("002"), artId("003")];
/** Indeks runtime append-only: artefak patrol_report ditulis saat produksi. */
const RUNTIME = [artId("900"), artId("901")];
const HANTU = artId("777");

const resolver = resolverGrounding(STATIS, RUNTIME);

function envelope(over: Record<string, unknown> = {}) {
  return {
    agent: "A7",
    inv_id: INV,
    output: { sections: [] },
    artifacts_cited: [] as string[],
    status: "ok",
    ...over,
  };
}

describe("resolver = union(indeks statis, indeks runtime)", () => {
  it("meresolusi art_id yang hanya ada di indeks statis", () => {
    expect(resolver.resolve(artId("001"))).toBe(true);
  });

  it("meresolusi art_id yang hanya ada di indeks runtime", () => {
    expect(resolver.resolve(artId("900"))).toBe(true);
  });

  it("menolak art_id yang tidak ada di keduanya", () => {
    expect(resolver.resolve(HANTU)).toBe(false);
  });

  it("menolak string kosong dan id berbentuk lain", () => {
    expect(resolver.resolve("")).toBe(false);
    expect(resolver.resolve("a-")).toBe(false);
  });

  it("id yang muncul di kedua indeks tetap resolvable (union idempoten)", () => {
    const tumpang = resolverGrounding(STATIS, [artId("001"), ...RUNTIME]);
    expect(tumpang.resolve(artId("001"))).toBe(true);
  });

  it("indeks runtime kosong tidak melumpuhkan indeks statis", () => {
    expect(resolverGrounding(STATIS, []).resolve(artId("002"))).toBe(true);
  });

  it("indeks statis kosong tetap melayani artefak runtime (mis. patrol_report)", () => {
    expect(resolverGrounding([], RUNTIME).resolve(artId("901"))).toBe(true);
  });

  it("kedua indeks kosong meresolusi apa pun sebagai gagal", () => {
    expect(resolverGrounding([], []).resolve(artId("001"))).toBe(false);
  });
});

describe("penolakan level envelope", () => {
  it("meloloskan envelope yang seluruh artifacts_cited-nya resolvable", () => {
    const hasil = periksaEnvelope(
      envelope({ artifacts_cited: [artId("001"), artId("900")] }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("ok");
    expect(hasil.unresolved).toEqual([]);
  });

  it("membuang envelope dengan satu artifacts_cited tak-resolvable", () => {
    const hasil = periksaEnvelope(
      envelope({ artifacts_cited: [artId("001"), HANTU] }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("discarded");
    expect(hasil.unresolved).toEqual([HANTU]);
  });

  it("meloloskan envelope tanpa kutipan artefak sama sekali (mis. A0)", () => {
    const hasil = periksaEnvelope(
      envelope({ agent: "A0", output: { ringkasan_ref: "blob://ringkasan/1" } }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("ok");
    expect(hasil.unresolved).toEqual([]);
  });

  it("mempertahankan status retry_fixed saat grounding bersih", () => {
    const hasil = periksaEnvelope(
      envelope({ status: "retry_fixed", artifacts_cited: [artId("003")] }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("retry_fixed");
  });

  it("menimpa status retry_fixed menjadi discarded saat grounding cacat", () => {
    const hasil = periksaEnvelope(
      envelope({ status: "retry_fixed", artifacts_cited: [HANTU] }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("discarded");
  });

  it("tidak memutasi envelope masukan", () => {
    const masuk = envelope({ artifacts_cited: [HANTU] });
    periksaEnvelope(masuk, resolver);
    expect(masuk.status).toBe("ok");
  });

  it("memindai art_id di dalam output (A2 detection_art_ids), bukan hanya artifacts_cited", () => {
    const hasil = periksaEnvelope(
      envelope({
        agent: "A2",
        output: { detection_art_ids: [artId("001"), HANTU] },
        artifacts_cited: [artId("001")],
      }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("discarded");
    expect(hasil.unresolved).toContain(HANTU);
  });

  it("memindai art_ids bersarang di output A7 sections", () => {
    const hasil = periksaEnvelope(
      envelope({
        output: {
          sections: [
            { claim: "Dua modalitas menguatkan kandidat.", art_ids: [artId("001")] },
            { claim: "Celah AIS enam jam tercatat.", art_ids: [HANTU] },
          ],
        },
        artifacts_cited: [artId("001")],
      }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("discarded");
    expect(hasil.unresolved).toContain(HANTU);
  });

  it("field art_id tunggal bernilai null bukan pelanggaran (assoc dark)", () => {
    const hasil = periksaEnvelope(
      envelope({
        agent: "A4",
        output: { assoc_art_ids: [artId("002")], dark_art_ids: [], track_art_id: null },
        artifacts_cited: [artId("002")],
      }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("ok");
    expect(hasil.unresolved).toEqual([]);
  });

  it("melaporkan setiap id cacat sekali walau dikutip berulang", () => {
    const hasil = periksaEnvelope(
      envelope({
        output: { supporting_art_ids: [HANTU], conflicting_art_ids: [HANTU] },
        artifacts_cited: [HANTU],
      }),
      resolver,
    );
    expect(hasil.unresolved).toEqual([HANTU]);
  });

  it("artefak runtime yang baru ditulis (patrol_report) lolos tanpa perlu indeks statis", () => {
    const hasil = periksaEnvelope(
      envelope({ agent: "A10", output: { updates: [{ param: "ambang_kn", lama: 25, baru: 24, basis_art_ids: [artId("901")] }] } }),
      resolver,
    );
    expect(hasil.envelope.status).toBe("ok");
  });
});

describe("penolakan level berkas", () => {
  const sections = [
    { claim: "Deteksi SAR berada di dalam ZEE-ID.", art_ids: [artId("001"), artId("003")] },
    { claim: "Celah AIS enam jam mendahului deteksi.", art_ids: [artId("002")] },
  ];

  it("meloloskan berkas yang seluruh klaimnya ter-ground", () => {
    const hasil = periksaBerkas(sections, resolver);
    expect(hasil.ok).toBe(true);
    expect(hasil.unresolved).toEqual([]);
  });

  it("SATU klaim tak-resolvable menolak SELURUH berkas", () => {
    const cacat = [...sections, { claim: "Kapal berada di luar jangkauan patroli.", art_ids: [HANTU] }];
    const hasil = periksaBerkas(cacat, resolver);
    expect(hasil.ok).toBe(false);
    expect(hasil.unresolved).toEqual([HANTU]);
  });

  it("klaim cacat di posisi pertama juga menjatuhkan berkas", () => {
    const cacat = [{ claim: "Klaim pembuka.", art_ids: [HANTU] }, ...sections];
    expect(periksaBerkas(cacat, resolver).ok).toBe(false);
  });

  it("mengumpulkan semua id cacat dari beberapa klaim", () => {
    const hantuKedua = artId("778");
    const cacat = [
      { claim: "Klaim satu.", art_ids: [HANTU] },
      { claim: "Klaim dua.", art_ids: [artId("001"), hantuKedua] },
    ];
    const hasil = periksaBerkas(cacat, resolver);
    expect([...hasil.unresolved].sort()).toEqual([HANTU, hantuKedua].sort());
  });

  it("berkas tanpa section sama sekali tidak dianggap cacat grounding", () => {
    expect(periksaBerkas([], resolver).ok).toBe(true);
  });

  it("berkas yang mengutip artefak runtime saja tetap lolos", () => {
    const hasil = periksaBerkas(
      [{ claim: "Patroli melaporkan temuan sesuai.", art_ids: [artId("900")] }],
      resolver,
    );
    expect(hasil.ok).toBe(true);
  });
});

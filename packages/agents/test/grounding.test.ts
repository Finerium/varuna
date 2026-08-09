import { describe, expect, it } from "vitest";

import { lanjutkanReplay, mulaiReplay, type PeristiwaAgen } from "../src/executor";
import { kunciJejak, kunciKeluaran } from "../src/mesin";
import { ART, INV_ID, mesinPalsu, modelPalsu, teksMasukan, untukA0, type Balasan } from "./palsu";

// ============================================================================
// Grounding pada KELUARAN AGEN — contracts.md Bagian 1 (ATURAN GROUNDING) dan
// Bagian 2 ("gagal validasi -> tepat 1 perbaikan -> dibuang").
//
// "SETIAP art_id pada keluaran agen mana pun wajib resolvable di resolver
// grounding; pelanggaran = keluaran `discarded` + tercatat trace."
//
// Semantik murni resolver diuji di packages/core/test/grounding.test.ts; yang
// diuji DI SINI adalah pemasangannya pada jalur agen: gerbangnya benar-benar
// dilewati tiap panggilan tool, perbaikannya tepat satu kali, dan amplop yang
// dibuang tetap sampai ke A0 sebagai keadaan yang terlihat.
// ============================================================================

const jejak = kunciJejak(INV_ID, "uji001");

/** A0 memanggil A2 sekali lalu menutup; balasan A2 diatur tiap tes. */
function naskahA2(balasanA2: (percobaan: number) => Balasan) {
  let percobaan = 0;
  return (req: Parameters<Parameters<typeof modelPalsu>[0]>[0]): Balasan => {
    if (untukA0(req)) {
      return teksMasukan(req).includes("agen_a2")
        ? { jawab: { ringkasan_ref: jejak } }
        : { alat: "agen_a2" };
    }
    percobaan += 1;
    return balasanA2(percobaan);
  };
}

async function langkahA2(naskah: Parameters<typeof modelPalsu>[0]) {
  const model = modelPalsu(naskah);
  const mesin = mesinPalsu(model);
  const peristiwa: PeristiwaAgen[] = [];
  const awal = await mulaiReplay(mesin, INV_ID, () => {});
  const hasil = await lanjutkanReplay(mesin, awal.resume_token, (p) => void peristiwa.push(p));
  const amplop = (mesin.store.isi.get(kunciKeluaran(INV_ID, "uji001", 1, "A2")) ?? [])[0] as {
    status: string;
    artifacts_cited: string[];
    output: Record<string, unknown>;
  };
  return {
    model,
    mesin,
    hasil,
    amplop,
    // Hanya fase sub-agen: penutupan run A0 diuji di executor.test.ts.
    fase: peristiwa.filter((p) => p.agent !== "A0").map((p) => `${p.agent}:${p.phase}`),
    jejakBaris: (mesin.store.isi.get(jejak) ?? []) as Array<{ phase: string; catatan?: string }>,
  };
}

describe("art_id tak-resolvable pada keluaran agen", () => {
  it("membuang amplop setelah tepat satu perbaikan yang tetap gagal", async () => {
    const r = await langkahA2(naskahA2(() => ({ jawab: { detection_art_ids: ["a-uji-01-x99"] } })));

    expect(r.fase).toEqual(["A2:start", "A2:retry", "A2:discarded"]);
    expect(r.amplop.status).toBe("discarded");
    // Dua kali dijalankan, tidak tiga: "tepat 1 perbaikan".
    expect(r.model.permintaan.filter((q) => !untukA0(q))).toHaveLength(2);

    const dibuang = r.jejakBaris.find((b) => b.phase === "discarded");
    expect(dibuang?.catatan).toContain("a-uji-01-x99");
    expect(dibuang?.catatan).toContain("tidak resolvable");
  });

  it("menandai amplop retry_fixed bila perbaikan berhasil", async () => {
    const r = await langkahA2(
      naskahA2((n) => ({
        jawab: { detection_art_ids: n === 1 ? ["a-uji-01-x99"] : [ART.deteksi] },
      })),
    );

    expect(r.fase).toEqual(["A2:start", "A2:retry", "A2:output"]);
    expect(r.amplop.status).toBe("retry_fixed");
    expect(r.amplop.artifacts_cited).toEqual([ART.deteksi]);
  });

  it("meneruskan amplop yang dibuang ke A0 apa adanya", async () => {
    const r = await langkahA2(naskahA2(() => ({ jawab: { detection_art_ids: ["a-uji-01-x99"] } })));
    const keA0 = r.model.permintaan.filter((q) => untukA0(q)).at(-1);
    expect(teksMasukan(keA0!)).toContain("discarded");
  });

  it("menerima art_id yang hanya ada di indeks runtime (union statis+runtime)", async () => {
    const r = await langkahA2(naskahA2(() => ({ jawab: { detection_art_ids: [ART.runtime] } })));

    expect(r.fase).toEqual(["A2:start", "A2:output"]);
    expect(r.amplop.status).toBe("ok");
    expect(r.amplop.artifacts_cited).toEqual([ART.runtime]);
  });

  it("tidak menghitung daftar kosong sebagai pelanggaran", async () => {
    const r = await langkahA2(naskahA2(() => ({ jawab: { detection_art_ids: [] } })));
    expect(r.fase).toEqual(["A2:start", "A2:output"]);
    expect(r.amplop.status).toBe("ok");
  });
});

describe("gerbang bentuk dan diksi sebelum grounding", () => {
  it("menolak art_id yang tidak berpola kontrak lewat skema amplop", async () => {
    const r = await langkahA2(
      naskahA2((n) => ({ jawab: { detection_art_ids: n === 1 ? ["palsu"] : [ART.deteksi] } })),
    );

    expect(r.fase).toEqual(["A2:start", "A2:retry", "A2:output"]);
    const retry = r.jejakBaris.find((b) => b.phase === "retry");
    expect(retry?.catatan).toContain("amplop gagal skema");
  });

  it("menolak keluaran yang memuat kata putusan (Bagian 7)", async () => {
    const naskah = (req: Parameters<Parameters<typeof modelPalsu>[0]>[0]): Balasan => {
      if (untukA0(req)) {
        return teksMasukan(req).includes("agen_a7")
          ? { jawab: { ringkasan_ref: jejak } }
          : { alat: "agen_a7" };
      }
      return {
        jawab: {
          sections: [
            { claim: "Kapal ini terbukti melanggar aturan zona.", art_ids: [ART.deteksi] },
          ],
        },
      };
    };

    const model = modelPalsu(naskah);
    const mesin = mesinPalsu(model);
    const peristiwa: PeristiwaAgen[] = [];
    const awal = await mulaiReplay(mesin, INV_ID, () => {});
    await lanjutkanReplay(mesin, awal.resume_token, (p) => void peristiwa.push(p));

    expect(peristiwa.filter((p) => p.agent !== "A0").map((p) => `${p.agent}:${p.phase}`)).toEqual([
      "A7:start",
      "A7:retry",
      "A7:discarded",
    ]);
    const baris = (mesin.store.isi.get(jejak) ?? []) as Array<{ phase: string; catatan?: string }>;
    expect(baris.find((b) => b.phase === "discarded")?.catatan).toContain("terbukti");
  });

  it("memperlakukan keluaran yang bukan structured output sebagai kegagalan yang bisa diperbaiki", async () => {
    const r = await langkahA2(
      naskahA2((n) =>
        n === 1
          ? { teksMentah: "maaf, saya jawab dengan prosa" }
          : { jawab: { detection_art_ids: [ART.deteksi] } },
      ),
    );

    expect(r.fase).toEqual(["A2:start", "A2:retry", "A2:output"]);
    expect(r.amplop.status).toBe("retry_fixed");
  });
});

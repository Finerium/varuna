import { describe, expect, it } from "vitest";

import {
  COOKIE_PERAN,
  PERAN,
  PERAN_TULIS,
  bolehTulis,
  jalurTulis,
  peranDariCookie,
  pesanTolakTulis,
  type JalurTulis,
  type Peran,
} from "../src/peran";

// ============================================================================
// Matriks role-write — contracts.md Bagian 3, kalimat penutup:
// "Role-write matrix (teruji): validate=analis; patrol/results=patroli;
//  lainnya read-all-roles."
//
// Interpretasi (dicatat karena kontrak tidak menuliskan bentuk API):
// P1. Hanya DUA jalur tulis. "lainnya read-all-roles" dibaca sebagai: rute lain
//     tidak punya penjaga tulis sama sekali -> jalurTulis() mengembalikan null.
// P2. Peran datang dari cookie demo prefilled (Bagian 3, "Rute halaman").
//     Tanpa cookie = tanpa peran = tidak boleh menulis; demo tetap menuntut
//     pilihan eksplisit lewat /enter/{peran}.
// P3. Cookie cacat berperilaku identik dengan cookie yang tidak ada.
// ============================================================================

const SEMUA_JALUR = Object.keys(PERAN_TULIS) as JalurTulis[];

describe("matriks role-write Bagian 3", () => {
  it("memuat tepat dua jalur tulis kontrak", () => {
    expect(SEMUA_JALUR).toEqual(["/api/validate", "/api/patrol/results"]);
    expect(PERAN_TULIS["/api/validate"]).toBe("analis");
    expect(PERAN_TULIS["/api/patrol/results"]).toBe("patroli");
  });

  // Matriks penuh: 2 jalur x 3 peran x (peran null) — tepat satu sel true per baris.
  const matriks: Array<[JalurTulis, Peran | null, boolean]> = [
    ["/api/validate", "analis", true],
    ["/api/validate", "patroli", false],
    ["/api/validate", "publik", false],
    ["/api/validate", null, false],
    ["/api/patrol/results", "analis", false],
    ["/api/patrol/results", "patroli", true],
    ["/api/patrol/results", "publik", false],
    ["/api/patrol/results", null, false],
  ];

  it.each(matriks)("%s x %s -> %s", (jalur, peran, boleh) => {
    expect(bolehTulis(jalur, peran)).toBe(boleh);
  });

  it("mengizinkan tepat satu peran per jalur tulis", () => {
    for (const jalur of SEMUA_JALUR) {
      expect(PERAN.filter((p) => bolehTulis(jalur, p))).toHaveLength(1);
    }
  });

  it("menyebut jalur dan peran aktif pada kalimat penolakan", () => {
    expect(pesanTolakTulis("/api/validate", "patroli")).toContain("analis");
    expect(pesanTolakTulis("/api/validate", "patroli")).toContain("patroli");
    expect(pesanTolakTulis("/api/patrol/results", null)).toContain("belum dipilih");
  });
});

describe("jalurTulis — rute baca tidak berpenjaga (read-all-roles)", () => {
  it("mengenali kedua jalur tulis", () => {
    expect(jalurTulis("/api/validate")).toBe("/api/validate");
    expect(jalurTulis("/api/patrol/results")).toBe("/api/patrol/results");
  });

  it("mengabaikan garis miring di ujung dan query string", () => {
    expect(jalurTulis("/api/validate/")).toBe("/api/validate");
    expect(jalurTulis("/api/patrol/results?x=1")).toBe("/api/patrol/results");
  });

  it("mengembalikan null untuk rute baca dan rute mirip", () => {
    for (const p of [
      "/api/queue",
      "/api/patrol/packages",
      "/api/replay/inv-dk-01",
      "/api/replay/inv-dk-01/step",
      "/api/calibration",
      "/api/public/aggregate",
      "/api/validate/x",
      "/api/validatex",
      "",
    ]) {
      expect(jalurTulis(p), p).toBeNull();
    }
  });
});

describe("peranDariCookie", () => {
  it("membaca peran dari header cookie tunggal maupun jamak", () => {
    expect(peranDariCookie(`${COOKIE_PERAN}=analis`)).toBe("analis");
    expect(peranDariCookie(`a=1; ${COOKIE_PERAN}=patroli; b=2`)).toBe("patroli");
    expect(peranDariCookie(`${COOKIE_PERAN}=publik;`)).toBe("publik");
  });

  it("memperlakukan cookie cacat, kosong, atau tak dikenal sebagai tanpa peran", () => {
    for (const h of [
      null,
      undefined,
      "",
      "lain=analis",
      `${COOKIE_PERAN}=admin`,
      `${COOKIE_PERAN}=`,
      `${COOKIE_PERAN}`,
      `${COOKIE_PERAN}=ANALIS`,
    ]) {
      expect(peranDariCookie(h)).toBeNull();
    }
  });

  it("tidak tertipu nama cookie yang berakhiran sama", () => {
    expect(peranDariCookie(`x_${COOKIE_PERAN}=analis`)).toBeNull();
  });
});

// Peran demo prefilled — contracts.md Bagian 3 ("Rute halaman").
// Cookie peran BUKAN otentikasi: ia memilih register tampilan demo.
//
// Matriks role-write (validate=analis, patrol/results=patroli) pindah ke
// @varuna/core/peran: ia bagian kontrak dan punya suite unit sendiri di sana
// (packages/core/test/peran.test.ts), sejajar dengan pasha/diksi/grounding.
// Yang tinggal di sini hanyalah yang khas tampilan: ke mana tiap peran mendarat
// dan label Indonesianya.

import type { Peran } from "@varuna/core/peran";

export {
  COOKIE_PERAN,
  PERAN,
  PERAN_TULIS,
  adalahPeran,
  bolehTulis,
  jalurTulis,
  peranDariCookie,
  pesanTolakTulis,
  type JalurTulis,
  type Peran,
} from "@varuna/core/peran";

export const PENDARATAN: Record<Peran, "/komando" | "/patroli" | "/portal"> = {
  analis: "/komando",
  patroli: "/patroli",
  publik: "/portal",
};

export const LABEL_PERAN: Record<Peran, string> = {
  analis: "Analis",
  patroli: "Kru patroli",
  publik: "Publik",
};

// Peran demo + matriks role-write — contracts.md Bagian 3.
//
// Cookie peran BUKAN otentikasi: ia memilih register tampilan demo. Yang
// MENGIKAT adalah matriks tulis di bawah ("Role-write matrix (teruji):
// validate=analis; patrol/results=patroli; lainnya read-all-roles"), dan
// matriks itu hidup di core — bukan di apps/web — karena ia bagian kontrak
// dan harus punya suite unit sendiri, sejajar dengan pasha/diksi/grounding.
//
// Modul ini murni: tidak ada Next, tidak ada node:*; masukannya cuma string
// header cookie, keluarannya keputusan.

export const PERAN = ["analis", "patroli", "publik"] as const;
export type Peran = (typeof PERAN)[number];

export const COOKIE_PERAN = "varuna_peran";

export const adalahPeran = (v: string): v is Peran => (PERAN as readonly string[]).includes(v);

/** Satu-satunya dua jalur TULIS pada Bagian 3. Sisanya read-all-roles, dan
 *  ketiadaan entri di sini berarti persis itu — bukan "belum diisi". */
export const PERAN_TULIS = {
  "/api/validate": "analis",
  "/api/patrol/results": "patroli",
} as const satisfies Record<string, Peran>;

export type JalurTulis = keyof typeof PERAN_TULIS;

/** Pathname -> jalur tulis, atau null untuk rute baca. Query string dan garis
 *  miring di ujung tidak boleh mengubah keputusan otorisasi. */
export function jalurTulis(pathname: string): JalurTulis | null {
  const bersih = (pathname.split("?")[0] ?? "").replace(/\/+$/, "");
  return bersih in PERAN_TULIS ? (bersih as JalurTulis) : null;
}

/** Peran null (tanpa cookie) tidak pernah boleh menulis: demo prefilled tetap
 *  menuntut pilihan peran yang eksplisit lewat /enter/{peran}. */
export const bolehTulis = (jalur: JalurTulis, peran: Peran | null): boolean =>
  peran !== null && PERAN_TULIS[jalur] === peran;

/** Parse header `Cookie` mentah. Nilai tak dikenal = null (bukan lempar):
 *  cookie cacat harus berperilaku sama dengan cookie yang tidak ada. */
export function peranDariCookie(header: string | null | undefined): Peran | null {
  for (const potong of (header ?? "").split(";")) {
    const batas = potong.indexOf("=");
    if (batas < 0) continue;
    if (potong.slice(0, batas).trim() !== COOKIE_PERAN) continue;
    const nilai = decodeURIComponent(potong.slice(batas + 1).trim());
    if (adalahPeran(nilai)) return nilai;
  }
  return null;
}

/** Kalimat penolakan (Indonesia) untuk 403. Satu salinan, dipakai route mana
 *  pun yang menegakkan matriks. */
export const pesanTolakTulis = (jalur: JalurTulis, peran: Peran | null): string =>
  `Jalur ${jalur} hanya boleh ditulis peran ${PERAN_TULIS[jalur]}; peran aktif: ${peran ?? "belum dipilih"}.`;

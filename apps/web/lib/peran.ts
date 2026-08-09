// Peran demo prefilled — contracts.md Bagian 3 ("Rute halaman").
// Cookie peran BUKAN otentikasi: ia memilih register tampilan demo. Matriks
// role-write (validate=analis, patrol/results=patroli) ditegakkan di route
// handler-nya masing-masing saat jalur tulis itu hidup, bukan di sini.

export const PERAN = ["analis", "patroli", "publik"] as const;
export type Peran = (typeof PERAN)[number];

export const COOKIE_PERAN = "varuna_peran";

export const adalahPeran = (v: string): v is Peran => (PERAN as readonly string[]).includes(v);

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

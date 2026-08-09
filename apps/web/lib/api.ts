// Utilitas bersama route handler — contracts.md Bagian 3.

export const LIMIT_DEFAULT = 20;
export const LIMIT_MAX = 50;

/** "semua daftar berpaginasi; limit<=50 default 20" (Bagian 3). Nilai cacat
 *  jatuh ke default, bukan error: parameter kosmetik tidak boleh menjatuhkan
 *  permintaan yang sah. */
export function bacaLimit(sp: URLSearchParams): number {
  const mentah = Number(sp.get("limit"));
  if (!Number.isInteger(mentah) || mentah < 1) return LIMIT_DEFAULT;
  return Math.min(mentah, LIMIT_MAX);
}

/** Kontrak tidak menetapkan gramatika `cursor`; dipilih bacaan paling sederhana
 *  yang memenuhi teks: cursor = id item TERAKHIR yang sudah diterima, kelanjutan
 *  dimulai tepat sesudahnya. Stabil karena setiap daftar terurut id.
 *  `null` = cursor tidak dikenal (pemanggil membalas 400, bukan diam-diam
 *  mengulang dari awal — halaman terulang lebih berbahaya daripada error). */
export function potong<T>(
  items: readonly T[],
  id: (t: T) => string,
  cursor: string | null,
  limit: number,
): { items: T[]; next_cursor: string | null } | null {
  let mulai = 0;
  if (cursor !== null) {
    const i = items.findIndex((t) => id(t) === cursor);
    if (i < 0) return null;
    mulai = i + 1;
  }
  const irisan = items.slice(mulai, mulai + limit);
  const terakhir = irisan.at(-1);
  return {
    items: irisan,
    next_cursor: terakhir !== undefined && mulai + limit < items.length ? id(terakhir) : null,
  };
}

export const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

export const galat = (pesan: string, status: number): Response =>
  json({ error: true, pesan }, status);

/** Keadaan jujur M0: rutenya ada, kontraknya berlaku, mesinnya belum dipasang.
 *  501 + kalimat Indonesia, TANPA data karangan sebagai pengganti. */
export const belumTersedia = (bagian: string): Response =>
  json(
    {
      error: "belum_tersedia",
      milestone: "M0",
      pesan: `${bagian} belum tersedia pada M0. Tidak ada data yang dikarang untuk menutupi kekosongan ini; rute ini akan menjawab sungguhan setelah lapisan agen dan tulisan runtime terpasang.`,
    },
    501,
  );

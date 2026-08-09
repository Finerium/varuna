// Resolver grounding + penolakan level envelope — contracts.md Bagian 1
// (ATURAN GROUNDING) dan architecture.md ("union(indeks statis, indeks runtime)").
//
// "SETIAP art_id pada keluaran agen mana pun wajib resolvable" dibaca harfiah:
// bukan hanya artifacts_cited, tetapi juga art_id di dalam `output`. Pemindaian
// paling sederhana yang menangkap seluruh field art_id Bagian 2 (detection_art_ids,
// assoc_art_ids, dark_art_ids, supporting_art_ids, conflicting_art_ids,
// basis_art_ids, det_art_id, track_art_id, sections[].art_ids): setiap KUNCI
// yang berakhiran "art_id" atau "art_ids".
//
// Pencatatan trace adalah urusan executor; fungsi-fungsi di sini murni.

import type { BerkasSection } from "./schemas.ts";

export type Resolver = { resolve(art_id: string): boolean };

/** Envelope agen apa adanya. Sengaja longgar: fungsi ini berjalan SEBELUM
 *  (dan sesudah) validasi zod, termasuk pada envelope yang gagal parse. */
export type EnvelopeLike = Record<string, unknown>;

/** Union, bukan fallback: tidak ada prioritas antara indeks statis golden dan
 *  indeks runtime Blob append-only. */
export function resolverGrounding(
  statis: Iterable<string>,
  runtime: Iterable<string>,
): Resolver {
  const indeks = new Set<string>([...statis, ...runtime]);
  return { resolve: (art_id: string) => indeks.has(art_id) };
}

const KUNCI_ART_ID = /art_ids?$/;

function kumpulkan(nilai: unknown, kunci: string | null, keluar: string[]): void {
  if (Array.isArray(nilai)) {
    for (const v of nilai) kumpulkan(v, kunci, keluar);
    return;
  }
  if (nilai !== null && typeof nilai === "object") {
    for (const [k, v] of Object.entries(nilai)) kumpulkan(v, k, keluar);
    return;
  }
  // null (mis. track_art_id pada asosiasi gelap) bukan pelanggaran.
  if (typeof nilai === "string" && kunci !== null && KUNCI_ART_ID.test(kunci)) keluar.push(nilai);
}

const takResolvable = (ids: string[], resolver: Resolver): string[] =>
  [...new Set(ids)].filter((id) => !resolver.resolve(id));

/** Seluruh art_id yang disebut satu nilai (pemindaian kunci yang sama dengan
 *  periksaEnvelope). Dipakai executor agen untuk MENURUNKAN `artifacts_cited`
 *  dari `output`, bukan mempercayai daftar terpisah yang bisa berbeda darinya. */
export function artIdsPada(nilai: unknown): string[] {
  const keluar: string[] = [];
  kumpulkan(nilai, null, keluar);
  return [...new Set(keluar)];
}

/** Pelanggaran = keluaran `discarded`. Envelope bersih mempertahankan statusnya
 *  (envelope hasil satu perbaikan sah berstatus "retry_fixed", Bagian 2).
 *  Masukan tidak pernah dimutasi. */
export function periksaEnvelope(
  env: EnvelopeLike,
  resolver: Resolver,
): { envelope: EnvelopeLike; unresolved: string[] } {
  const ids: string[] = [];
  kumpulkan(env.artifacts_cited, "art_ids", ids);
  kumpulkan(env.output, null, ids);

  const unresolved = takResolvable(ids, resolver);
  return unresolved.length > 0
    ? { envelope: { ...env, status: "discarded" }, unresolved }
    : { envelope: env, unresolved };
}

/** Klaim berkas dengan art_id tak-resolvable menolak SELURUH berkas dari
 *  tampilan (Bagian 1) — bukan hanya klaim yang cacat. */
export function periksaBerkas(
  sections: readonly BerkasSection[],
  resolver: Resolver,
): { ok: boolean; unresolved: string[] } {
  const ids: string[] = [];
  kumpulkan(sections, null, ids);

  const unresolved = takResolvable(ids, resolver);
  return { ok: unresolved.length === 0, unresolved };
}

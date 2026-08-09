// Agregat publik — satu implementasi dipakai route handler /api/public/aggregate
// DAN halaman Portal, supaya angka yang tampil dan angka yang dilayani API tidak
// pernah bisa berbeda.
//
// "nol field identitas level skema" (contracts.md Bagian 3): keluaran hanya
// memuat cacah, label zona, dan nama dataset — tidak ada inv_id, art_id,
// mmsi_hash, koordinat, maupun stempel waktu per-kapal.

import type { StatusServerZod } from "@varuna/core/schemas";

import { ambilArtefak, daftarInvestigasi } from "./gudang";

/** Kontrak tidak menetapkan gramatika `period`; dipilih bacaan paling sederhana
 *  yang memenuhi teks dan sejalan dengan keadaan "periode tanpa data"
 *  (Bagian 8): awalan ISO — YYYY, YYYY-MM, atau YYYY-MM-DD — dicocokkan pada
 *  t_acquisition. */
export const POLA_PERIODE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** zona boleh null pada Investigation; kunci cacahnya dinamai eksplisit supaya
 *  pembaca agregat tidak perlu menebak arti "null". */
export const KUNCI_TANPA_ZONA = "tanpa_zona";

export type Agregat = {
  periode: string;
  counts: Record<StatusServerZod["status"], Record<string, number>>;
  updated_at: string;
  sumber: string[];
};

export async function hitungAgregat(period: string | null): Promise<Agregat> {
  const semua = await daftarInvestigasi();
  const terpilih =
    period === null ? semua : semua.filter((i) => i.t_acquisition.startsWith(period));

  const counts = {} as Agregat["counts"];
  for (const inv of terpilih) {
    const perZona = (counts[inv.status_server.status] ??= {});
    const kunci = inv.zona ?? KUNCI_TANPA_ZONA;
    perZona[kunci] = (perZona[kunci] ?? 0) + 1;
  }

  // Sumber = dataset yang sungguh menyumbang artefak pada periode ini, bukan
  // daftar kredit statis.
  const artefak = await Promise.all(terpilih.map((i) => ambilArtefak(i.inv_id)));
  const sumber = [...new Set(artefak.flat().map((a) => a.source.dataset))].sort();

  return { periode: period ?? "semua", counts, updated_at: new Date().toISOString(), sumber };
}

/** Periode yang benar-benar diwakili Evidence Store (YYYY-MM), untuk pemilih
 *  Portal. Tidak ada bulan karangan di dalam daftar ini. */
export async function periodeTersedia(): Promise<string[]> {
  const semua = await daftarInvestigasi();
  return [...new Set(semua.map((i) => i.t_acquisition.slice(0, 7)))].sort();
}

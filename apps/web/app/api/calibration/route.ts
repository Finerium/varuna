// GET /api/calibration?cursor -> {items:[{param, lama, baru, basis_art_ids,
// sumber_package_id, at}], next_cursor}. contracts.md Bagian 3.
//
// Sumbernya adalah tulisan runtime append-only (delta A10 yang beraudit,
// Bagian 4). Pada M0 belum ada satu pun penulis, jadi jawabannya daftar kosong
// yang JUJUR — bukan contoh kalibrasi karangan.

import { z } from "zod";

import { ArtIdSchema, IsoSchema, PackageIdSchema } from "@varuna/core/schemas";

import { bacaLimit, galat, json, potong } from "@/lib/api";
import { bacaRuntime } from "@/lib/gudang";

export const dynamic = "force-dynamic";

const KUNCI = "runtime/kalibrasi.jsonl";

/** Batas kepercayaan: baris runtime divalidasi sebelum keluar, sama seperti
 *  artefak golden divalidasi oleh core. */
const DeltaSchema = z.object({
  param: z.string(),
  lama: z.unknown(),
  baru: z.unknown(),
  basis_art_ids: z.array(ArtIdSchema),
  sumber_package_id: PackageIdSchema.nullable(),
  at: IsoSchema,
});

export async function GET(req: Request) {
  const baris = await bacaRuntime(KUNCI).catch(() => []);
  const terurai = z.array(DeltaSchema).safeParse(baris);
  if (!terurai.success)
    return galat("Catatan kalibrasi runtime tidak sesuai skema; daftar tidak ditampilkan.", 500);

  const sp = new URL(req.url).searchParams;
  const halaman = potong(
    terurai.data,
    (d) => `${d.param}@${d.at}`,
    sp.get("cursor"),
    bacaLimit(sp),
  );
  if (halaman === null) return galat("Cursor tidak dikenal pada daftar ini.", 400);

  return json(halaman);
}

// GET /api/investigations/{inv_id}/artifacts?cursor&limit -> {items:[Artifact], next_cursor}
// contracts.md Bagian 3.

import { bacaLimit, galat, json, potong } from "@/lib/api";
import { ambilArtefak, ambilInvestigasi } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ inv_id: string }> }) {
  const { inv_id } = await ctx.params;
  // Investigasi tak dikenal harus 404, bukan daftar kosong: kosong berarti
  // "belum ada artefak", dan itu klaim yang berbeda.
  if ((await ambilInvestigasi(inv_id)) === null)
    return galat(`Investigasi ${inv_id} tidak ada pada Evidence Store.`, 404);

  const sp = new URL(req.url).searchParams;
  const halaman = potong(
    await ambilArtefak(inv_id),
    (a) => a.art_id,
    sp.get("cursor"),
    bacaLimit(sp),
  );
  if (halaman === null) return galat("Cursor tidak dikenal pada daftar ini.", 400);

  return json(halaman);
}

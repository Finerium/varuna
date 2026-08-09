// GET /api/investigations/{inv_id} -> Investigation (artifacts = 20 pertama + next_cursor)
// contracts.md Bagian 3.

import { galat, json, potong, LIMIT_DEFAULT } from "@/lib/api";
import { ambilInvestigasi } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ inv_id: string }> }) {
  const { inv_id } = await ctx.params;
  const inv = await ambilInvestigasi(inv_id);
  if (inv === null) return galat(`Investigasi ${inv_id} tidak ada pada Evidence Store.`, 404);

  // "artifacts = 20 pertama + next_cursor": objek Investigation apa adanya
  // dengan senarai art_id dipotong pada halaman pertama, plus next_cursor di
  // level atas. Halaman berikutnya diambil lewat /artifacts?cursor=.
  const halaman = potong(inv.artifacts, (id) => id, null, LIMIT_DEFAULT);
  return json({
    ...inv,
    artifacts: halaman?.items ?? [],
    next_cursor: halaman?.next_cursor ?? null,
  });
}

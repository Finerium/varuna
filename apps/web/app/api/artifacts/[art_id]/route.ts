// GET /api/artifacts/{art_id} -> Artifact. contracts.md Bagian 3.

import { galat, json } from "@/lib/api";
import { cariArtefak } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ art_id: string }> }) {
  const { art_id } = await ctx.params;
  const artefak = await cariArtefak(art_id);
  if (artefak === null) return galat(`Artefak ${art_id} tidak ada pada Evidence Store.`, 404);
  return json(artefak);
}

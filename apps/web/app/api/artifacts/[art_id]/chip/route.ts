// GET /api/artifacts/{art_id}/chip -> PNG chip (web-optimized <=300KB, Bagian 1).

import { galat } from "@/lib/api";
import { bacaChip } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ art_id: string }> }) {
  const { art_id } = await ctx.params;
  const png = await bacaChip(art_id);
  // Tidak semua artefak punya chip (hanya deteksi SAR yang dikurasi punya).
  if (png === null) return galat(`Tidak ada chip untuk artefak ${art_id}.`, 404);

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // Chip golden statis dan berhash; aman di-cache lama.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

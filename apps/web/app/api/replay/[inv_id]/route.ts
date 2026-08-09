// POST /api/replay/{inv_id} (mulai) — contracts.md Bagian 3.
//
// SSE replay memancarkan tiap peristiwa dari panggilan API LIVE; tidak ada
// respons kalengan (architecture.md). Langkah 0 menjalankan A0 sampai ia MEMINTA
// tool pertamanya, lalu berhenti: tool-nya sendiri dieksekusi invokasi
// berikutnya lewat /step. Satu invokasi HTTP = satu langkah agen (VAR-LIVE-02).

import { mulaiReplay } from "@varuna/agents";

import { PESAN_TANPA_KUNCI, alirkanReplay, modelSiap } from "@/lib/agen";
import { galat } from "@/lib/api";
import { ambilInvestigasi } from "@/lib/gudang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Batas fungsi Vercel; kontrak memenuhinya dengan memecah run jadi langkah. */
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ inv_id: string }> }) {
  const { inv_id } = await ctx.params;

  if ((await ambilInvestigasi(inv_id)) === null) {
    return galat(`Investigasi ${inv_id} tidak ada di Evidence Store.`, 404);
  }
  if (!modelSiap()) return galat(PESAN_TANPA_KUNCI, 503);

  return alirkanReplay((m, emit) => mulaiReplay(m, inv_id, emit));
}

// POST /api/replay/{inv_id}/step {resume_token} — contracts.md Bagian 3.
//
// Satu invokasi menyetujui SATU tool tertunda, menjalankannya, membiarkan A0
// memilih langkah berikutnya, lalu menjeda run lagi dan memulangkan
// resume_token baru. State percakapan dimuat dari state_ref, bukan dari ingatan
// proses: invokasi ini boleh berjalan di instansi fungsi yang berbeda.

import { lanjutkanReplay } from "@varuna/agents";

import { PESAN_TANPA_KUNCI, alirkanReplay, modelSiap } from "@/lib/agen";
import { galat } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ inv_id: string }> }) {
  const { inv_id } = await ctx.params;

  const badan = (await req.json().catch(() => null)) as { resume_token?: unknown } | null;
  if (badan === null || typeof badan !== "object") {
    return galat("Badan permintaan wajib JSON berisi {resume_token}.", 400);
  }
  const token = badan.resume_token;
  // Token milik investigasi lain tidak boleh dilanjutkan lewat URL ini: rute dan
  // token harus menyebut investigasi yang sama.
  if (
    typeof token === "object" &&
    token !== null &&
    (token as { inv_id?: unknown }).inv_id !== inv_id
  ) {
    return galat("resume_token bukan milik investigasi pada alamat ini.", 400);
  }
  if (!modelSiap()) return galat(PESAN_TANPA_KUNCI, 503);

  return alirkanReplay((m, emit) => lanjutkanReplay(m, token, emit));
}

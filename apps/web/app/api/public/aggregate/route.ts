// GET /api/public/aggregate?period -> {periode, counts:{status x zona}, updated_at, sumber:[]}
// contracts.md Bagian 3. Perhitungannya hidup di lib/agregat.ts, dipakai bersama
// halaman Portal.

import { galat, json } from "@/lib/api";
import { POLA_PERIODE, hitungAgregat } from "@/lib/agregat";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const period = new URL(req.url).searchParams.get("period");
  if (period !== null && !POLA_PERIODE.test(period))
    return galat("Parameter period harus berupa awalan ISO: YYYY, YYYY-MM, atau YYYY-MM-DD.", 400);

  return json(await hitungAgregat(period));
}

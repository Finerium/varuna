// GET /enter/{analis|patroli|publik} — set cookie peran (demo prefilled) lalu
// redirect. contracts.md Bagian 3, "Rute halaman".

import { NextResponse } from "next/server";

import { COOKIE_PERAN, PENDARATAN, adalahPeran } from "@/lib/peran";

export async function GET(req: Request, ctx: { params: Promise<{ role: string }> }) {
  const { role } = await ctx.params;
  if (!adalahPeran(role))
    return NextResponse.json(
      { error: true, pesan: `Peran ${role} tidak dikenal. Yang ada: analis, patroli, publik.` },
      { status: 404 },
    );

  const res = NextResponse.redirect(new URL(PENDARATAN[role], req.url));
  res.cookies.set(COOKIE_PERAN, role, {
    path: "/",
    sameSite: "lax",
    httpOnly: false, // demo prefilled: peran adalah pilihan tampilan, bukan rahasia
    maxAge: 60 * 60 * 12,
  });
  return res;
}

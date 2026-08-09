// GET /api/queue?status&zona&cursor&limit -> {items:[InvestigationSummary], next_cursor}
// contracts.md Bagian 3.
//
// Tiap item membawa OVERLAY aksi validasi analis (`validasi`, null bila belum
// pernah divalidasi). Overlay, bukan status: status_server tetap turunan murni
// artefak (Bagian 4), dan keputusan manusia duduk di atasnya sebagai lapisan
// yang bisa dibaca terpisah.

import { KUNCI_VALIDASI, overlayValidasi } from "@varuna/core/runtime";
import { StatusWireSchema, ZonaSchema } from "@varuna/core/schemas";

import { bacaLimit, galat, json, potong } from "@/lib/api";
import { bacaRuntime, daftarInvestigasi, ringkas } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const statusMentah = sp.get("status");
  const zonaMentah = sp.get("zona");
  // Filter tak dikenal = permintaan salah, bukan alasan mengembalikan daftar
  // penuh yang menyesatkan pemanggil.
  const status = statusMentah === null ? null : StatusWireSchema.safeParse(statusMentah);
  if (status !== null && !status.success)
    return galat(`Nilai status tidak dikenal: ${statusMentah}`, 400);
  const zona = zonaMentah === null ? null : ZonaSchema.safeParse(zonaMentah);
  if (zona !== null && !zona.success) return galat(`Nilai zona tidak dikenal: ${zonaMentah}`, 400);

  const validasi = overlayValidasi(await bacaRuntime(KUNCI_VALIDASI).catch(() => []));

  const items = (await daftarInvestigasi())
    .map(ringkas)
    .filter(
      (s) =>
        (status === null || s.status === status.data) && (zona === null || s.zona === zona.data),
    )
    .map((s) => ({ ...s, validasi: validasi.get(s.inv_id) ?? null }));

  const halaman = potong(items, (s) => s.inv_id, sp.get("cursor"), bacaLimit(sp));
  if (halaman === null) return galat("Cursor tidak dikenal pada daftar ini.", 400);

  return json(halaman);
}

// GET  /api/patrol/packages?cursor -> {items:[TargetPackage], next_cursor}  [patroli]
// POST /api/patrol/packages {inv_id} -> {paket}                             [analis]
// contracts.md Bagian 3 + 5.
//
// GET dibiarkan read-all-roles seperti seluruh rute baca (matriks Bagian 3);
// POST menulis, jadi ia menuntut peran analis. Area pencarian dihitung SERVER
// (@varuna/core/runtime), tidak pernah oleh klien dan tidak pernah oleh agen:
// A9 mengusulkan, server yang mencetak.

import { KUNCI_PAKET, PermintaanPaketSchema, paketTerkini } from "@varuna/core/runtime";

import { bacaLimit, galat, json, potong, wajibPeran } from "@/lib/api";
import { bacaRuntime } from "@/lib/gudang";
import { cetakDanSimpanPaket } from "@/lib/tulis";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const items = paketTerkini(await bacaRuntime(KUNCI_PAKET).catch(() => []));

  const sp = new URL(req.url).searchParams;
  const halaman = potong(items, (p) => p.package_id, sp.get("cursor"), bacaLimit(sp));
  if (halaman === null) return galat("Cursor tidak dikenal pada daftar ini.", 400);

  return json(halaman);
}

export async function POST(req: Request) {
  const tolak = wajibPeran(req, "analis", "/api/patrol/packages");
  if (tolak !== null) return tolak;

  const badan = PermintaanPaketSchema.safeParse(await req.json().catch(() => null));
  if (!badan.success) return galat("Badan permintaan wajib JSON berisi {inv_id}.", 400);

  const hasil = await cetakDanSimpanPaket(badan.data.inv_id);
  if ("tolak" in hasil) return galat(hasil.tolak, hasil.status);

  return json({ paket: hasil.paket }, 201);
}

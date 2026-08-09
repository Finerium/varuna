// POST /api/validate — contracts.md Bagian 3 [analis].
//
// {inv_id, action:"terima|minta_penguatan|arsip"} -> {recorded_at, package_id|null}.
// Ejaan {aksi:"setuju|tolak"} juga diterima dan dinormalkan (lihat
// PermintaanValidasiSchema). Aksi "terima" pada status terkonfirmasi/terindikasi
// MENCETAK TargetPackage; server pemilik package_id, issued_at, expires_at.
//
// status_server TIDAK disentuh. Validasi adalah keputusan manusia DI ATAS
// status, bukan masukan bagi computeStatus — antrean membacanya sebagai overlay
// (GET /api/queue), bukan sebagai status yang berubah.

import {
  KUNCI_VALIDASI,
  PermintaanValidasiSchema,
  RekamanValidasiSchema,
  tolakTeksBebas,
} from "@varuna/core/runtime";

import { galat, json, tolakPeran } from "@/lib/api";
import { gudangRuntime } from "@/lib/gudang";
import { cetakDanSimpanPaket, sekarang } from "@/lib/tulis";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tolak = tolakPeran(req, "/api/validate");
  if (tolak !== null) return tolak;

  const badan = PermintaanValidasiSchema.safeParse(await req.json().catch(() => null));
  if (!badan.success) {
    return galat(
      `Badan permintaan tidak sesuai kontrak: ${badan.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      400,
    );
  }
  const { inv_id, aksi, catatan } = badan.data;

  // Kontrak Bagian 3 menyebut note patroli sebagai "ingress teks bebas
  // SATU-SATUNYA". Catatan analis melewati gerbang yang SAMA supaya kalimat itu
  // tetap benar dalam praktiknya: tidak ada teks bebas yang masuk tanpa saring.
  if (catatan !== null && catatan.length > 0) {
    const salah = tolakTeksBebas(catatan, "catatan");
    if (salah !== null) return galat(salah, 422);
  }

  const paket = aksi === "terima" ? await cetakDanSimpanPaket(inv_id) : null;
  // Aksi "terima" atas investigasi yang tidak ada, atau yang statusnya ABSTAIN,
  // gagal APA ADANYA: mencatat persetujuan tanpa paket akan menyembunyikan
  // bahwa penugasan patroli tidak pernah lahir.
  if (paket !== null && "tolak" in paket) return galat(paket.tolak, paket.status);

  const rekaman = RekamanValidasiSchema.parse({
    jenis: "aksi_validasi",
    inv_id,
    aksi,
    catatan,
    package_id: paket === null ? null : paket.paket.package_id,
    oleh: "analis",
    at: sekarang(),
  });
  await gudangRuntime().append(KUNCI_VALIDASI, rekaman);

  return json({
    recorded_at: rekaman.at,
    package_id: rekaman.package_id,
    inv_id,
    aksi,
  });
}

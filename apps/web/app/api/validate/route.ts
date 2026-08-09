// POST /api/validate — contracts.md Bagian 3 [analis].
// Aksi "terima" MENCETAK TargetPackage dari usulan A9; tulisan runtime itu
// belum hidup, jadi rute masih menjawab jujur alih-alih mengarang package_id.
//
// Yang SUDAH hidup: matriks role-write. Otorisasi mendahului ketersediaan —
// peran patroli atau publik ditolak 403 di sini, bukan diberi 501 yang seolah
// mengundangnya kembali nanti.

import { belumTersedia, tolakPeran } from "@/lib/api";

export const POST = (req: Request) =>
  tolakPeran(req, "/api/validate") ?? belumTersedia("Aksi validasi analis");

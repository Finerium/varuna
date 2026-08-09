// POST /api/patrol/results — contracts.md Bagian 3 [patroli].
// Ingress teks bebas satu-satunya (note) baru boleh dibuka bersama penyaring
// diksi + penolak pola identitas di jalur tulisnya; sampai itu terpasang, rute
// ini menolak dengan jujur alih-alih menerima dan membuang.
//
// Matriks role-write sudah ditegakkan: hanya peran patroli yang sampai ke sini.

import { belumTersedia, tolakPeran } from "@/lib/api";

export const POST = (req: Request) =>
  tolakPeran(req, "/api/patrol/results") ?? belumTersedia("Pengiriman hasil pemeriksaan patroli");

// GET /api/patrol/packages?cursor — contracts.md Bagian 3 [patroli].
// Paket sasaran hanya lahir dari aksi validasi (POST /api/validate), yang belum
// hidup di M0. Daftar kosong akan berbohong: ia berarti "belum ada penugasan",
// padahal yang benar adalah "jalurnya belum terpasang".

import { belumTersedia } from "@/lib/api";

export const GET = () => belumTersedia("Daftar paket sasaran patroli");

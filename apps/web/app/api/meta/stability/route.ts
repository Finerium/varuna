// GET /api/meta/stability -> {k_replay, agreement_status, agreement_artifacts, catatan}
// contracts.md Bagian 3. Angka disalin apa adanya dari manifests/e5-stabilitas.json
// (E5.4, k=5 replay LIVE terhadap produksi, now 2026-08-09T11:00:00Z).
// catatan: disalin, bukan diimpor — .vercelignore mengecualikan manifests/ dari
// bundel build, jadi import akan menggagalkan build. Sinkron manual saat manifest baru.

import { json } from "@/lib/api";

export const GET = () =>
  json({
    k_replay: 5,
    n_inv: 6,
    agreement_status: "6/6",
    agreement_artifacts: "3/6",
    hash_server_identik: "0/6",
    catatan:
      "hash_server_identik < 1.0 berarti lapisan server TIDAK deterministik lintas replay — pelanggaran Bagian 0.7 yang WAJIB dilaporkan, bukan ditutup.",
    sumber: "manifests/e5-stabilitas.json",
    diukur_pada: "2026-08-09T11:00:00Z",
  });

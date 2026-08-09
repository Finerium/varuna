// POST /api/patrol/results — contracts.md Bagian 3 [patroli].
//
// {package_id, finding, note<=500, submitted_at} -> {recorded_at, calibration_ref}.
// Ejaan {paket_id, hasil, catatan} juga diterima dan dinormalkan.
//
// Ini INGRESS TEKS BEBAS SATU-SATUNYA. `note` melewati penyaring diksi dan
// penolak pola identitas (MMSI, callsign, awalan nama kapal) SEBELUM ditulis —
// bukan sesudah, dan bukan saat ditampilkan.
//
// Hasil yang lolos menjadi ARTEFAK patrol_report ber-hash kanonis (konvensi
// yang sama persis dengan artefak golden) dan masuk indeks grounding runtime,
// sehingga replay berikutnya boleh mengutipnya sebagai bukti sederajat.

import {
  KUNCI_HASIL,
  KUNCI_PAKET,
  PermintaanHasilSchema,
  RekamanHasilSchema,
  artefakPatrolReport,
  paketTerkini,
  tolakTeksBebas,
} from "@varuna/core/runtime";
import { PatrolResultSchema } from "@varuna/core/schemas";

import { galat, json, tolakPeran } from "@/lib/api";
import { bacaRuntime, gudangRuntime } from "@/lib/gudang";
import { sekarang, tulisArtefakRuntime } from "@/lib/tulis";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tolak = tolakPeran(req, "/api/patrol/results");
  if (tolak !== null) return tolak;

  const badan = PermintaanHasilSchema.safeParse(await req.json().catch(() => null));
  if (!badan.success) {
    return galat(
      `Badan permintaan tidak sesuai kontrak: ${badan.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      400,
    );
  }
  const { package_id, finding, note, posisi } = badan.data;

  // Paket harus sungguh ada: hasil pemeriksaan atas penugasan yang tidak pernah
  // dicetak tidak punya investigasi untuk dilekati, dan artefaknya akan
  // menggantung di luar rantai bukti mana pun.
  const paket = paketTerkini(await bacaRuntime(KUNCI_PAKET).catch(() => [])).find(
    (p) => p.package_id === package_id,
  );
  if (paket === undefined) {
    return galat(
      `Paket ${package_id} tidak ada pada daftar penugasan; hasil pemeriksaan tidak dapat dilekatkan pada investigasi mana pun.`,
      404,
    );
  }

  const salah = tolakTeksBebas(note, "note");
  if (salah !== null) return galat(salah, 422);

  const at = sekarang();
  const hasil = PatrolResultSchema.parse({
    package_id,
    finding,
    note,
    // Stempel kru boleh ikut (kontrak menuliskannya di badan), tetapi
    // ketiadaannya diisi jam server, bukan ditolak: kiriman dari antrean offline
    // datang terlambat dan itu keadaan sah.
    submitted_at: badan.data.submitted_at ?? at,
    by_role: "patroli",
  });

  const artefak = artefakPatrolReport(hasil, paket.inv_id, at);
  await tulisArtefakRuntime(artefak);

  await gudangRuntime().append(
    KUNCI_HASIL,
    RekamanHasilSchema.parse({
      ...hasil,
      inv_id: paket.inv_id,
      art_id: artefak.art_id,
      // Posisi kru disimpan pada baris hasil, TIDAK pada payload artefak:
      // payload patrol_report dibekukan pada empat field Bagian 1, dan field
      // kelima akan dibuang saat dibaca ulang — hash lalu tidak cocok dengan
      // isinya.
      posisi,
      at,
    }),
  );

  return json(
    {
      recorded_at: at,
      // Hasil ini belum menggeser ambang apa pun. Kalibrasi adalah keputusan
      // beraudit tersendiri (POST /api/calibration), jadi rujukannya null —
      // bukan tautan ke peristiwa yang tidak terjadi.
      calibration_ref: null,
      art_id: artefak.art_id,
      inv_id: paket.inv_id,
    },
    201,
  );
}

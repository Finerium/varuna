// GET  /api/calibration?cursor -> {items:[{param, lama, baru, basis_art_ids,
//      sumber_package_id, alasan, at}], next_cursor, ambang_efektif, ambang_seed}
// POST /api/calibration {ambang, alasan} -> {recorded_at, deltas, ambang_efektif}
// contracts.md Bagian 3 + 4.
//
// Ambang PASHA DI-SEED dari experiments/e5/thresholds.lock.json dan hanya
// bergeser lewat delta beraudit di sini. Berkas lock itu TIDAK PERNAH ditulis:
// ia seed sejarah yang memayungi angka paper. Yang bergerak adalah overlay
// append-only di atasnya.

import {
  DeltaKalibrasiSchema,
  KUNCI_KALIBRASI,
  PermintaanKalibrasiSchema,
  ambangEfektif,
  deltaKalibrasi,
} from "@varuna/core/runtime";
import { z } from "zod";

import { bacaLimit, galat, json, potong, wajibPeran } from "@/lib/api";
import { bacaRuntime, gudangRuntime } from "@/lib/gudang";
import { AMBANG_SEED, ambangSekarang, sekarang } from "@/lib/tulis";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const baris = await bacaRuntime(KUNCI_KALIBRASI).catch(() => []);
  // Batas kepercayaan: baris runtime divalidasi sebelum keluar, sama seperti
  // artefak golden divalidasi oleh core.
  const terurai = z.array(DeltaKalibrasiSchema).safeParse(baris);
  if (!terurai.success)
    return galat("Catatan kalibrasi runtime tidak sesuai skema; daftar tidak ditampilkan.", 500);

  const sp = new URL(req.url).searchParams;
  const halaman = potong(
    terurai.data,
    (d) => `${d.param}@${d.at}`,
    sp.get("cursor"),
    bacaLimit(sp),
  );
  if (halaman === null) return galat("Cursor tidak dikenal pada daftar ini.", 400);

  return json({
    ...halaman,
    // Kedua angka ditampilkan bersama supaya pergeseran terbaca sebagai
    // pergeseran, bukan sebagai nilai yang seolah selalu begitu.
    ambang_seed: AMBANG_SEED,
    ambang_efektif: ambangEfektif(AMBANG_SEED, terurai.data),
  });
}

export async function POST(req: Request) {
  // Kontrak menandai /api/calibration [analis] pada jalur baca dan tidak
  // menuliskan bentuk POST-nya; jalur tulis mewarisi peran yang sama, lebih
  // ketat daripada read-all-roles dan tidak pernah lebih longgar.
  const tolak = wajibPeran(req, "analis", "/api/calibration");
  if (tolak !== null) return tolak;

  const badan = PermintaanKalibrasiSchema.safeParse(await req.json().catch(() => null));
  if (!badan.success) {
    return galat(
      `Badan permintaan tidak sesuai kontrak: ${badan.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      400,
    );
  }

  const sebelum = await ambangSekarang();
  const deltas = deltaKalibrasi(sebelum, badan.data, sekarang());
  if (deltas.length === 0) {
    return galat(
      "Tidak ada ambang yang berubah: nilai yang dikirim sama dengan yang sudah berlaku. Jejak audit tidak diisi peristiwa yang tidak terjadi.",
      409,
    );
  }

  const gudang = gudangRuntime();
  // Satu baris per parameter — bentuk item GET Bagian 3. Append-only: nilai
  // lama tetap terbaca, jadi pergeserannya bisa ditelusuri mundur.
  for (const d of deltas) await gudang.append(KUNCI_KALIBRASI, d);

  return json(
    {
      recorded_at: deltas[0]?.at,
      deltas,
      ambang_efektif: { ...sebelum, ...Object.fromEntries(deltas.map((d) => [d.param, d.baru])) },
    },
    201,
  );
}

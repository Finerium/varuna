// Badan bersama jalur tulis — contracts.md Bagian 3, 4, 5.
//
// Tiga hal yang dipakai lebih dari satu route dan tidak boleh punya dua salinan:
// ambang efektif (seed lock + overlay kalibrasi), pencetakan paket sasaran, dan
// penulisan artefak runtime beserta indeks groundingnya. Logikanya sendiri
// tinggal di @varuna/core/runtime (murni, teruji unit); berkas ini hanya
// merangkainya dengan Evidence Store apps/web.

import {
  KUNCI_KALIBRASI,
  KUNCI_PAKET,
  ambangEfektif,
  cetakPaket,
  kunciArtefak,
  kunciGrounding,
  type PaketRuntime,
} from "@varuna/core/runtime";
import type { Thresholds } from "@varuna/core/pasha";
import type { Artifact } from "@varuna/core/schemas";

// Ambang PASHA DI-SEED dari protokol beku (contracts.md Bagian 4). Diimpor,
// bukan disalin: satu angka yang menyimpang membuat status runtime berbeda dari
// angka yang dilaporkan paper.
import kunciAmbang from "../../../experiments/e5/thresholds.lock.json";

import { ambilArtefak, ambilInvestigasi, bacaRuntime, gudangRuntime } from "./gudang";

export const sekarang = (): string => new Date().toISOString();

/** Seed sejarah, apa adanya dari experiments/e5/thresholds.lock.json. Berkas
 *  itu TIDAK PERNAH ditulis oleh produk: ia memayungi angka paper. */
export const AMBANG_SEED: Thresholds = {
  usia_max_h: kunciAmbang.usia_max_h,
  ambang_kn: kunciAmbang.ambang_kn,
  konflik_jendela_jam: kunciAmbang.konflik_jendela_jam,
};

/** Ambang yang BERLAKU sekarang = seed + overlay delta kalibrasi beraudit
 *  (Bagian 4: "hanya bergeser lewat delta A10 yang beraudit"). */
export const ambangSekarang = async (): Promise<Thresholds> =>
  ambangEfektif(AMBANG_SEED, await bacaRuntime(KUNCI_KALIBRASI).catch(() => []));

export type HasilPaket = { paket: PaketRuntime } | { tolak: string; status: 404 | 409 };

/** Cetak (atau cetak ulang) paket sasaran satu investigasi dan simpan barisnya.
 *  Idempoten: package_id = "pkg-<inv>", dan pembacaan mengambil baris terakhir
 *  per package_id, jadi memanggil dua kali tidak melahirkan dua paket. */
export async function cetakDanSimpanPaket(inv_id: string): Promise<HasilPaket> {
  const inv = await ambilInvestigasi(inv_id);
  if (inv === null) {
    return { tolak: `Investigasi ${inv_id} tidak ada di Evidence Store.`, status: 404 };
  }
  const hasil = cetakPaket(inv, await ambilArtefak(inv_id), sekarang(), await ambangSekarang());
  if ("tolak" in hasil) return { tolak: hasil.tolak, status: 409 };

  await gudangRuntime().append(KUNCI_PAKET, hasil.paket);
  return { paket: hasil.paket };
}

/** Satu artefak runtime, dua tulisan yang harus jalan bersama: isinya dan
 *  izin kutipnya. Indeks grounding runtime adalah separuh resolver
 *  (architecture.md), jadi artefak tanpa entri indeks tidak akan pernah bisa
 *  dikutip replay — dan entri indeks tanpa artefak adalah janji kosong. */
export async function tulisArtefakRuntime(a: Artifact): Promise<void> {
  const gudang = gudangRuntime();
  await gudang.append(kunciArtefak(a.inv_id), a);
  await gudang.append(kunciGrounding(a.inv_id), {
    art_ids: [a.art_id],
    hash: { [a.art_id]: a.hash_sha256 },
  });
}

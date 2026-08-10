// Perkabelan lapisan agen ke Evidence Store apps/web — architecture.md.
//
// packages/agents tidak tahu apa-apa soal Next, filesystem, atau golden set: ia
// menerima tiga port. Berkas inilah yang mengisinya dengan pembaca nyata,
// penyimpanan runtime nyata, dan Runner ber-kunci-API nyata. Tidak ada jalur
// kedua yang memutar rekaman: kalau model tidak bisa dipanggil, rute menjawab
// keadaan jujur (lihat modelSiap dan event `gagal`).

import {
  GalatReplay,
  runnerVaruna,
  type HasilLangkah,
  type MesinAgen,
  type Pemancar,
} from "@varuna/agents";
import type { Investigation } from "@varuna/core/schemas";

import { aliranSSE } from "./api";
import {
  ambilArtefak,
  ambilInvestigasi,
  gudangRuntime,
  indeksGroundingRuntime,
  indeksGroundingStatis,
} from "./gudang";
// Ambang PASHA hidup di lib/tulis: DI-SEED dari protokol beku (contracts.md
// Bagian 4) lalu di-overlay delta kalibrasi beraudit. Satu sumber untuk jalur
// agen dan jalur tulis — kalau tidak, status yang dihitung replay dan area
// patroli yang dicetak server bisa memakai angka yang berbeda.
import { ambangSekarang, sekarang } from "./tulis";

export { AMBANG_SEED as AMBANG } from "./tulis";

/** Jalur live menuntut kunci API. Ketiadaannya adalah keadaan yang diumumkan,
 *  bukan alasan memutar respons kalengan. */
export const modelSiap = (): boolean => (process.env.OPENAI_API_KEY ?? "").length > 0;

export const PESAN_TANPA_KUNCI =
  "Replay memanggil model sungguhan pada tiap langkah, dan kunci API belum terpasang di lingkungan ini. Tidak ada rekaman kalengan yang diputar sebagai gantinya.";

export async function mesinReplay(): Promise<MesinAgen> {
  return {
    sumber: {
      async investigasi(inv_id): Promise<Investigation | null> {
        const inv = await ambilInvestigasi(inv_id);
        if (inv === null) return null;
        // Berkas yang ditolak grounding tampil sebagai kosong bagi agen: agen
        // tidak membacanya (mereka menyusunnya), dan penolakan itu urusan
        // lapisan tampil.
        const { berkas_ditolak: _, ...sisa } = inv;
        return { ...sisa, berkas: inv.berkas ?? { sections: [], diksi_ok: false } };
      },
      artefak: (inv_id) => ambilArtefak(inv_id),
      indeksStatis: () => indeksGroundingStatis(),
      indeksRuntime: (inv_id) => indeksGroundingRuntime(inv_id),
    },
    store: gudangRuntime(),
    runner: runnerVaruna(),
    thresholds: await ambangSekarang(),
    sekarang,
  };
}

/** Pesan galat penyedia model boleh memuat potongan kunci API (OpenAI
 *  memulangkan "sk-abc****xyz" pada 401). Kalimat jujur tidak menuntut kunci
 *  ikut tampil di layar analis, jadi ia disamarkan sebelum keluar server. */
const bersihkan = (teks: string): string =>
  teks.replace(/sk-[A-Za-z0-9_*-]{4,}/g, "sk-[disamarkan]");

const potong = (teks: string): string => {
  const bersih = bersihkan(teks);
  return bersih.length <= 300 ? bersih : `${bersih.slice(0, 297)}...`;
};

/** Satu bentuk aliran untuk kedua rute replay: peristiwa `agent_step` per
 *  kontrak, lalu tepat satu peristiwa penutup — `lanjut` (bawa resume_token),
 *  `selesai`, atau `gagal`. `gagal` selalu membawa dapat_diulang supaya klien
 *  punya tombol ulang, bukan jalan buntu (V13). */
export function alirkanReplay(
  jalankan: (m: MesinAgen, emit: Pemancar) => Promise<HasilLangkah>,
): Response {
  return aliranSSE(async (tulis) => {
    try {
      const hasil = await jalankan(await mesinReplay(), (p) => tulis("agent_step", p));
      tulis(hasil.selesai ? "selesai" : "lanjut", {
        selesai: hasil.selesai,
        resume_token: hasil.resume_token,
        agen_berikut: hasil.agen_berikut,
        trace_ref: hasil.trace_ref,
        run_id: hasil.run_id,
        step_idx: hasil.step_idx,
        // Aditif: cacah token invokasi ini (in/out/requests). Tidak ada yang
        // memutuskan apa pun darinya — ia ada supaya biaya bisa diukur, bukan
        // ditaksir. Biaya satu investigasi = jumlahnya atas semua langkah.
        usage: hasil.usage,
      });
    } catch (e) {
      const galat = e as Error;
      tulis("gagal", {
        sebab: galat instanceof GalatReplay ? galat.sebab : "panggilan_model",
        pesan:
          galat instanceof GalatReplay
            ? galat.message
            : `Panggilan model gagal: ${potong(galat.message)}`,
        dapat_diulang: true,
      });
    }
  });
}

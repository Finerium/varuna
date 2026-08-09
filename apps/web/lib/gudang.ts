// Pembaca Evidence Store untuk apps/web — contracts.md Bagian 1.
//
// Kenapa tidak memakai packages/core/src/store.ts apa adanya: akar golden di
// sana adalah `new URL("../golden/", import.meta.url)`, dan bundler server Next
// menolak jejak itu (Turbopack: "Module not found: Can't resolve '../golden/'")
// karena ia mencoba menyelesaikannya sebagai aset build. Modul core tetap benar
// untuk pemanggil Node langsung (bin/gate.ts, harness python); yang berbeda di
// jalur web hanyalah CARA menemukan akar. Skema — bagian yang membawa kontrak —
// tetap satu, diimpor dari @varuna/core/schemas.
// ponytail: kalau nanti core menerima akar suntikan (mis. bacaManifest(root)),
// empat pembaca di bawah ini dihapus dan diganti pemanggilan core lagi.

import { access, appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { periksaBerkas, resolverGrounding } from "@varuna/core/grounding";
import type { RuntimeStore } from "@varuna/core/store";
import {
  ArtIdSchema,
  ArtifactSchema,
  GroundingIndexSchema,
  InvIdSchema,
  InvestigationSchema,
  ManifestSchema,
  type Artifact,
  type Investigation,
  type InvestigationSummary,
} from "@varuna/core/schemas";

/** inv_id dan art_id datang dari URL dan masuk ke path filesystem. Pola kontrak
 *  (huruf, angka, tanda hubung) sudah menutup traversal — tidak ada titik dan
 *  tidak ada garis miring yang bisa lolos — jadi satu penjaga di sini cukup dan
 *  gagalnya tertutup: id cacat menjadi null, dan pemanggil membalas 404. */
const invSah = (inv_id: string): boolean => InvIdSchema.safeParse(inv_id).success;

/** Kandidat akar golden, dicoba berurutan. Semuanya relatif cwd karena itulah
 *  satu-satunya jangkar yang selamat dari bundling: `next build`/`next start`
 *  dan fungsi serverless sama-sama ber-cwd di direktori aplikasi. */
const KANDIDAT = [
  process.env.VARUNA_GOLDEN_DIR,
  join(process.cwd(), "..", "..", "packages", "core", "golden"),
  join(process.cwd(), "packages", "core", "golden"),
].filter((p): p is string => typeof p === "string" && p.length > 0);

let akarTerpilih: Promise<string | null> | null = null;

/** null = Evidence Store tidak ditemukan sama sekali. Itu bukan crash: seluruh
 *  surface lalu menampilkan keadaan kosong yang jujur. */
function akar(): Promise<string | null> {
  akarTerpilih ??= (async () => {
    for (const p of KANDIDAT) {
      if (
        await access(join(p, "index")).then(
          () => true,
          () => false,
        )
      )
        return p;
    }
    return null;
  })();
  return akarTerpilih;
}

async function bacaJson(...ruas: string[]): Promise<unknown | null> {
  const root = await akar();
  if (root === null) return null;
  // turbopackIgnore: akar golden ditelusuri lewat outputFileTracingIncludes di
  // next.config.ts, jadi penelusuran seluruh proyek tidak diperlukan.
  return readFile(join(/* turbopackIgnore: true */ root, ...ruas), "utf8").then(
    (isi) => JSON.parse(isi) as unknown,
    () => null,
  );
}

/** inv_id yang disebut manifest, tanpa menuntut investigation.json-nya sudah
 *  ada. Dipakai pembaca level artefak (chip), yang tidak bergantung pada berkas
 *  investigasi. Manifest sendiri boleh belum ada. */
export async function daftarInvId(): Promise<string[]> {
  const manifest = ManifestSchema.safeParse(await bacaJson("index", "manifest.json"));
  return manifest.success ? manifest.data.items.map((i) => i.inv_id) : [];
}

/** Indeks grounding statis = union art_id SELURUH investigasi golden
 *  (contracts.md Bagian 1; architecture.md "union(indeks statis, indeks
 *  runtime)"). Union, bukan per-investigasi: klaim boleh mengutip artefak
 *  investigasi lain dan itu tetap resolvable. Dihitung sekali — golden set
 *  adalah data plane STATIS ("dibaca, tidak pernah ditulis"), sama alasannya
 *  dengan akar() di atas.
 *  ponytail: sisi runtime masih kosong; belum ada satu pun penulis (lihat
 *  bacaRuntime di bawah). Isi dari indeks Blob append-only begitu aksi
 *  validasi/patroli hidup di M1. */
let indeksStatis: Promise<string[]> | null = null;

function grounding(): Promise<string[]> {
  indeksStatis ??= (async () => {
    const per = await Promise.all(
      (await daftarInvId()).map(async (id) =>
        GroundingIndexSchema.safeParse(await bacaJson("investigations", id, "grounding.json")),
      ),
    );
    return per.flatMap((r) => (r.success ? r.data.art_ids : []));
  })();
  return indeksStatis;
}

/** Investigation apa adanya, KECUALI berkas yang gagal grounding: ia diganti
 *  keadaan penolakan yang jujur sebelum menyentuh UI (lihat ambilInvestigasi). */
export type InvestigasiTampil = Omit<Investigation, "berkas"> & {
  berkas: Investigation["berkas"] | null;
  berkas_ditolak: { alasan: string } | null;
};

/** Golden set dibangun bertahap: manifest boleh sudah menyebut inv_id yang
 *  investigation.json-nya belum ditulis. Entri yang belum lengkap DILEWATI dari
 *  antrean, bukan ditambal objek karangan — antrean hanya berisi investigasi
 *  yang berkasnya sungguh ada. */
export async function daftarInvestigasi(): Promise<InvestigasiTampil[]> {
  const semua = await Promise.all((await daftarInvId()).map((id) => ambilInvestigasi(id)));
  return semua
    .filter((i): i is InvestigasiTampil => i !== null)
    .sort((a, b) => a.inv_id.localeCompare(b.inv_id));
}

export async function ambilInvestigasi(inv_id: string): Promise<InvestigasiTampil | null> {
  if (!invSah(inv_id)) return null;
  const hasil = InvestigationSchema.safeParse(
    await bacaJson("investigations", inv_id, "investigation.json"),
  );
  if (!hasil.success) return null;
  const inv = hasil.data;

  // ATURAN GROUNDING, Bagian 1: "klaim berkas dengan art_id tak-resolvable
  // menolak SELURUH berkas dari tampilan". Ditegakkan DI SINI, di satu-satunya
  // jalur baca investigasi apps/web, supaya tidak ada pemanggil yang bisa
  // melewatinya. Penolakan tampil sebagai keadaan, bukan berkas yang diam-diam
  // hilang atau — lebih buruk — klaim tak-terdukung yang lolos ke layar.
  const { ok, unresolved } = periksaBerkas(
    inv.berkas.sections,
    resolverGrounding(await grounding(), []),
  );
  if (ok) return { ...inv, berkas_ditolak: null };
  return {
    ...inv,
    berkas: null,
    berkas_ditolak: {
      alasan: `Berkas ditolak dari tampilan: ${unresolved.length} art_id tidak resolvable pada indeks grounding (${unresolved.join(", ")}).`,
    },
  };
}

/** Artefak satu investigasi, terurut art_id. Berkas yang gagal skema dilewati:
 *  satu artefak cacat tidak boleh menyembunyikan sisa rantai bukti. */
export async function ambilArtefak(inv_id: string): Promise<Artifact[]> {
  const root = await akar();
  if (root === null || !invSah(inv_id)) return [];
  const dir = join(root, "investigations", inv_id, "artifacts");
  const berkas = await readdir(dir).then(
    (f) => f.filter((n) => n.endsWith(".json")).sort(),
    () => [],
  );
  const isi = await Promise.all(
    berkas.map((f) => bacaJson("investigations", inv_id, "artifacts", f)),
  );
  return isi
    .map((v) => ArtifactSchema.safeParse(v))
    .filter((r) => r.success)
    .map((r) => r.data);
}

/** Frontend HANYA membaca status_server (architecture.md, VAR-SRF-03): ringkasan
 *  ini menyalin, tidak menghitung ulang apa pun. */
export const ringkas = (inv: InvestigasiTampil): InvestigationSummary => ({
  inv_id: inv.inv_id,
  status: inv.status_server.status,
  sensors_independent: inv.status_server.sensors_independent,
  zona: inv.zona,
  evidence_age_h: inv.status_server.evidence_age_h,
  t_acquisition: inv.t_acquisition,
  t_observasi_terakhir: inv.t_observasi_terakhir,
  aoi: inv.aoi,
  kasus_label: inv.kasus.label,
  display_state: inv.status_server.display_state,
});

/** art_id "a-<inv>-<seq>" -> inv_id "inv-<inv>" (konvensi as-built yang sudah
 *  dicatat di packages/core/src/schemas.ts): buang awalan "a-", buang ruas
 *  terakhir, pasang awalan "inv-". */
export function invDariArtId(art_id: string): string | null {
  if (!ArtIdSchema.safeParse(art_id).success) return null;
  const batas = art_id.lastIndexOf("-");
  if (batas <= 2) return null;
  return `inv-${art_id.slice(2, batas)}`;
}

export async function cariArtefak(art_id: string): Promise<Artifact | null> {
  const inv_id = invDariArtId(art_id);
  if (inv_id === null) return null;
  return (await ambilArtefak(inv_id)).find((a) => a.art_id === art_id) ?? null;
}

async function chipPath(art_id: string): Promise<string | null> {
  const root = await akar();
  const inv_id = invDariArtId(art_id);
  if (root === null || inv_id === null) return null;
  return join(root, "investigations", inv_id, "chips", `${art_id}.png`);
}

/** Chip web-optimized (Bagian 1). Ketiadaan chip adalah keadaan sah, bukan galat:
 *  hanya deteksi SAR terkurasi yang punya. */
export async function bacaChip(art_id: string): Promise<Buffer | null> {
  const p = await chipPath(art_id);
  if (p === null) return null;
  return readFile(p).catch(() => null);
}

export async function adaChip(art_id: string): Promise<boolean> {
  const p = await chipPath(art_id);
  if (p === null) return false;
  return access(p).then(
    () => true,
    () => false,
  );
}

/** Deteksi SAR pertama yang sungguh punya chip. Dipakai Entry sebagai hero
 *  konten-nyata (blueprint 7.3); kalau golden belum punya chip, pemanggil
 *  menampilkan bingkai kosong yang jujur, bukan gambar pengganti. */
export async function chipPertama(n: number): Promise<Artifact[]> {
  const keluar: Artifact[] = [];
  // Dari manifest, bukan dari daftarInvestigasi(): chip melekat pada artefak dan
  // sudah nyata walau berkas investigasinya belum disusun.
  for (const inv_id of await daftarInvId()) {
    for (const a of await ambilArtefak(inv_id)) {
      if (a.type !== "sar_detection") continue;
      if (!(await adaChip(a.art_id))) continue;
      keluar.push(a);
      if (keluar.length === n) return keluar;
    }
  }
  return keluar;
}

/** Akar tulisan runtime. Di Vercel hanya /tmp yang bisa ditulis, dan isinya
 *  hidup selama instansi fungsi — cukup untuk satu rangkaian replay yang
 *  langkah-langkahnya berdekatan, tidak untuk simpanan jangka panjang.
 *  ponytail: filesystem, dengan langit-langit yang disebut di atas; naikkan ke
 *  @vercel/blob dengan mengganti DUA fungsi di bawah — RuntimeStore adalah
 *  antarmuka yang sama yang dipakai packages/core dan packages/agents. */
const dirRuntime = (): string =>
  process.env.VARUNA_RUNTIME_DIR ??
  (process.env.VERCEL === undefined ? join(process.cwd(), ".runtime") : "/tmp/varuna-runtime");

/** Tulisan runtime (state replay, jejak agen, hasil patroli, kalibrasi):
 *  append-only JSONL. packages/core/src/store.ts sengaja menyerahkan
 *  implementasinya ke jalur produk ini ("blobRuntimeStore: diisi di apps/web"). */
export function gudangRuntime(): RuntimeStore {
  // Containment: kunci apa pun (termasuk dari resume_token) tidak boleh
  // menembus keluar direktori runtime.
  const path = (kunci: string) => {
    const dasar = resolve(dirRuntime());
    const p = resolve(/* turbopackIgnore: true */ dasar, kunci);
    if (p !== dasar && !p.startsWith(dasar + sep)) {
      throw new Error(`kunci runtime di luar direktori: ${kunci}`);
    }
    return p;
  };
  return {
    async append(kunci, rekaman) {
      const p = path(kunci);
      await mkdir(dirname(p), { recursive: true });
      await appendFile(p, `${JSON.stringify(rekaman)}\n`, "utf8");
    },
    async read(kunci) {
      const isi = await readFile(path(kunci), "utf8").catch(() => "");
      return isi
        .split("\n")
        .filter((b) => b.length > 0)
        .map((b) => JSON.parse(b) as unknown);
    },
  };
}

export const bacaRuntime = (kunci: string): Promise<unknown[]> => gudangRuntime().read(kunci);

/** Separuh runtime dari resolver grounding (Bagian 1: "Indeks runtime ...
 *  append-only, aturan hash sama"). Baris boleh menyebut satu art_id atau
 *  sekumpulan; keduanya bentuk yang sama sahnya untuk indeks append-only. */
export async function indeksGroundingRuntime(inv_id: string): Promise<string[]> {
  if (!invSah(inv_id)) return [];
  const baris = await bacaRuntime(`runtime/${inv_id}/grounding.jsonl`).catch(() => []);
  return baris.flatMap((b) => {
    const r = b as { art_id?: unknown; art_ids?: unknown };
    if (typeof r.art_id === "string") return [r.art_id];
    return Array.isArray(r.art_ids)
      ? r.art_ids.filter((v): v is string => typeof v === "string")
      : [];
  });
}

/** Separuh statis: union art_id seluruh investigasi golden. */
export const indeksGroundingStatis = (): Promise<string[]> => grounding();

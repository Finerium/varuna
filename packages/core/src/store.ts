// Evidence Store — pembaca golden set (statis, dalam repo) + penulis runtime.
// contracts.md Bagian 1; architecture.md "Topologi deploy".
//
// Golden set = data plane STATIS: dibaca, tidak pernah ditulis. Tulisan runtime
// (hasil patroli, aksi validasi, kalibrasi) append-only ke adapter runtime:
// filesystem untuk dev lokal, penyimpanan runtime (Postgres/Neon) di produksi.

import { readFile, readdir, mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ArtifactSchema,
  GroundingIndexSchema,
  InvestigationSchema,
  ManifestSchema,
  type Artifact,
  type GroundingIndex,
  type Investigation,
  type Manifest,
} from "./schemas.ts";

/** packages/core/golden/ — relatif terhadap berkas ini, bukan terhadap cwd,
 *  supaya route handler dan CLI membaca akar yang sama. */
export const GOLDEN_ROOT = fileURLToPath(new URL("../golden/", import.meta.url));

const invDir = (inv_id: string) => join(GOLDEN_ROOT, "investigations", inv_id);

const bacaJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"));

/** index/manifest.json — daftar inv ringan untuk antrean. */
export async function bacaManifest(): Promise<Manifest> {
  return ManifestSchema.parse(await bacaJson(join(GOLDEN_ROOT, "index", "manifest.json")));
}

export async function bacaInvestigation(inv_id: string): Promise<Investigation> {
  return InvestigationSchema.parse(await bacaJson(join(invDir(inv_id), "investigation.json")));
}

/** Artefak satu investigasi, terurut art_id (paginasi urusan pemanggil). */
export async function bacaArtefak(inv_id: string): Promise<Artifact[]> {
  const dir = join(invDir(inv_id), "artifacts");
  const berkas = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    berkas.map(async (f) => ArtifactSchema.parse(await bacaJson(join(dir, f)))),
  );
}

export async function bacaGrounding(inv_id: string): Promise<GroundingIndex> {
  return GroundingIndexSchema.parse(await bacaJson(join(invDir(inv_id), "grounding.json")));
}

/** Indeks grounding statis = union art_id seluruh investigasi golden. Separuh
 *  masukan resolverGrounding(); separuh lagi datang dari adapter runtime. */
export async function bacaIndeksStatis(): Promise<string[]> {
  const { items } = await bacaManifest();
  const per = await Promise.all(items.map((i) => bacaGrounding(i.inv_id)));
  return per.flatMap((g) => g.art_ids);
}

// ---------------------------------------------------------------------------
// Penulis runtime (append-only, aturan hash sama — Bagian 1)
// ---------------------------------------------------------------------------

/** Satu antarmuka, dua adapter: filesystem (dev) dan Blob (produksi).
 *  `key` adalah jalur logis, mis. "runtime/<inv_id>/grounding.jsonl". */
export type RuntimeStore = {
  append(key: string, record: unknown): Promise<void>;
  read(key: string): Promise<unknown[]>;
};

/** Dev lokal: JSONL di bawah `root`. Append-only, tidak pernah menimpa. */
export function filesystemRuntimeStore(root: string): RuntimeStore {
  const path = (key: string) => join(root, key);
  return {
    async append(key, record) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await appendFile(p, `${JSON.stringify(record)}\n`, "utf8");
    },
    async read(key) {
      const isi = await readFile(path(key), "utf8").catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return "";
        throw e;
      });
      return isi
        .split("\n")
        .filter((baris) => baris.length > 0)
        .map((baris) => JSON.parse(baris) as unknown);
    },
  };
}

/** Produksi: Vercel Blob. Implementasinya hidup di jalur PRODUK apps/web
 *  (paket ini tidak boleh menarik @vercel/blob ke dalam core murni); stub ini
 *  menjaga antarmuka tetap satu sehingga pemanggil identik di dev dan produksi. */
export function blobRuntimeStore(): RuntimeStore {
  const belum = (): never => {
    throw new Error("blobRuntimeStore: diisi di apps/web (Vercel Blob); core hanya memegang antarmuka");
  };
  return { append: async () => belum(), read: async () => belum() };
}

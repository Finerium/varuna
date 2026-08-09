#!/usr/bin/env node
// Gerbang PASHA sebagai satu subprocess untuk harness python (architecture.md,
// "Pola kunci"): angka evaluasi harus mendeskripsikan persis gerbang yang
// dikirim, jadi harness memanggil computeStatus yang sama, bukan port python.
//
//   echo '{"artifacts":[...],"now":"...","thresholds":{...}}' | node bin/gate.ts
//
// stdout = StatusServer JSON satu baris. Galat -> stderr + exit 1.
// Ekstensi ".ts" pada import wajib: Node menjalankan berkas ini apa adanya
// (type stripping) dan resolvernya tidak menebak ekstensi.

import { computeStatus, type ArtifactLike, type Thresholds } from "../src/pasha.ts";

function gagal(pesan: string): never {
  process.stderr.write(`gate: ${pesan}\n`);
  process.exit(1);
}

const potongan: Buffer[] = [];
for await (const c of process.stdin) potongan.push(c as Buffer);

let masukan: unknown;
try {
  masukan = JSON.parse(Buffer.concat(potongan).toString("utf8"));
} catch (e) {
  gagal(`stdin bukan JSON yang sah: ${(e as Error).message}`);
}

// Validasi batas kepercayaan: bentuk amplop saja. Bentuk penuh tiap artefak
// divalidasi di jalur produk lewat schemas.ts; di sini gerbang harus gagal
// keras dan jelas, bukan diam-diam menghitung status dari sampah.
const { artifacts, now, thresholds } = (masukan ?? {}) as {
  artifacts?: unknown;
  now?: unknown;
  thresholds?: unknown;
};

if (!Array.isArray(artifacts)) gagal("field 'artifacts' wajib array");
if (typeof now !== "string" || Number.isNaN(Date.parse(now))) {
  gagal("field 'now' wajib stempel waktu ISO8601");
}
const th = thresholds as Partial<Thresholds> | undefined;
for (const k of ["usia_max_h", "ambang_kn", "konflik_jendela_jam"] as const) {
  if (typeof th?.[k] !== "number") gagal(`thresholds.${k} wajib angka`);
}

process.stdout.write(
  `${JSON.stringify(computeStatus(artifacts as ArtifactLike[], now, th as Thresholds))}\n`,
);

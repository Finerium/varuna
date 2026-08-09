#!/usr/bin/env node
// E7 red-team — SHIM lapis grounding + diksi (BUKAN reimplementasi).
//
// Status server SUDAH punya CLI produksi (packages/core/bin/gate.ts); shim ini
// hanya mengekspos DUA lapis lain yang jadi subjek uji E7 tetapi tak tercakup
// gate.ts: (2) indeks grounding / resolvabilitas art_id, dan (5) penyaring diksi.
// Ia MENGIMPOR fungsi asli apa adanya (grounding.ts, diksi.ts) — tidak ada
// salinan logika di sini (invarian E7-B: pasha/grounding/diksi tak diubah).
//
//   echo '[{"id":"s1","op":"grounding",...},{"id":"s2","op":"diksi",...}]' \
//     | npx tsx experiments/e7/layers.ts
//
// stdin = ARRAY permintaan (dibatch supaya satu proses, bukan 48 spawn).
// stdout = ARRAY hasil sejajar. Galat -> stderr + exit 1.

import { periksaBerkas, periksaEnvelope, resolverGrounding } from "../../packages/core/src/grounding.ts";
import { cekDiksi } from "../../packages/core/src/diksi.ts";

type Req =
  | {
      id: string;
      op: "grounding";
      statis: string[];
      runtime?: string[];
      envelope?: Record<string, unknown> | null;
      berkas?: Array<{ claim: string; art_ids: string[] }> | null;
    }
  | { id: string; op: "diksi"; teks: string };

function gagal(pesan: string): never {
  process.stderr.write(`layers: ${pesan}\n`);
  process.exit(1);
}

const potongan: Buffer[] = [];
for await (const c of process.stdin) potongan.push(c as Buffer);

let reqs: Req[];
try {
  reqs = JSON.parse(Buffer.concat(potongan).toString("utf8"));
} catch (e) {
  gagal(`stdin bukan JSON sah: ${(e as Error).message}`);
}
if (!Array.isArray(reqs)) gagal("stdin wajib array permintaan");

const hasil = reqs.map((r) => {
  if (r.op === "diksi") {
    return { id: r.id, op: r.op, ...cekDiksi(r.teks) };
  }
  if (r.op === "grounding") {
    const resolver = resolverGrounding(r.statis ?? [], r.runtime ?? []);
    const env = r.envelope
      ? periksaEnvelope(r.envelope, resolver)
      : { envelope: null, unresolved: [] as string[] };
    const berkas = r.berkas
      ? periksaBerkas(r.berkas, resolver)
      : { ok: true, unresolved: [] as string[] };
    return {
      id: r.id,
      op: r.op,
      // status envelope SETELAH grounding: "discarded" bila ada art_id tak-resolvable.
      envelope_status: r.envelope ? (env.envelope as Record<string, unknown>).status ?? "ok" : null,
      envelope_unresolved: env.unresolved,
      berkas_ok: berkas.ok,
      berkas_unresolved: berkas.unresolved,
    };
  }
  return gagal(`op tak dikenal: ${JSON.stringify((r as { op?: unknown }).op)}`);
});

process.stdout.write(`${JSON.stringify(hasil)}\n`);

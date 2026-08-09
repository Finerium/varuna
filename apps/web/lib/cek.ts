// Pemeriksaan mandiri untuk dua potong logika non-sepele apps/web: batas
// paginasi dan turunan inv_id dari art_id. Bukan kerangka tes — assert biasa,
// dijalankan `node lib/cek.ts` (skrip `test` paket ini). Gagal = keluar bukan-nol.
//
// Sisa berkas ini sengaja tidak diuji di sini: route handler diverifikasi lewat
// smoke HTTP, dan pembawa kontrak (PASHA, diksi, grounding, skema) punya suite
// vitest sendiri di packages/core.

import assert from "node:assert/strict";

import { LIMIT_DEFAULT, LIMIT_MAX, bacaLimit, potong } from "./api.ts";
import { daftarInvestigasi, invDariArtId } from "./gudang.ts";

const id = (s: string) => s;
const halaman = (items: string[], cursor: string | null, limit: number) =>
  potong(items, id, cursor, limit);

// --- potong: batas halaman dan cursor
{
  const abc = ["a", "b", "c"];

  const h1 = halaman(abc, null, 2);
  assert.deepEqual(h1, { items: ["a", "b"], next_cursor: "b" }, "halaman pertama");

  const h2 = halaman(abc, "b", 2);
  assert.deepEqual(
    h2,
    { items: ["c"], next_cursor: null },
    "halaman terakhir tidak menawarkan lanjutan",
  );

  assert.deepEqual(halaman(abc, null, 3), { items: abc, next_cursor: null }, "muat sekali habis");
  assert.deepEqual(halaman([], null, 20), { items: [], next_cursor: null }, "daftar kosong");
  assert.deepEqual(halaman(abc, "c", 2), { items: [], next_cursor: null }, "cursor di ujung");
  assert.equal(halaman(abc, "zzz", 2), null, "cursor tak dikenal ditolak, bukan diulang dari awal");

  // Tidak ada item yang hilang atau terulang saat seluruh daftar disusuri.
  const semua: string[] = [];
  let cursor: string | null = null;
  do {
    const h = halaman(abc, cursor, 1);
    assert.ok(h !== null);
    semua.push(...h.items);
    cursor = h.next_cursor;
  } while (cursor !== null);
  assert.deepEqual(semua, abc, "susur penuh utuh");
}

// --- bacaLimit: default 20, maks 50, nilai cacat jatuh ke default
{
  const sp = (q: string) => new URLSearchParams(q);
  assert.equal(bacaLimit(sp("")), LIMIT_DEFAULT);
  assert.equal(bacaLimit(sp("limit=5")), 5);
  assert.equal(bacaLimit(sp("limit=9999")), LIMIT_MAX);
  assert.equal(bacaLimit(sp("limit=0")), LIMIT_DEFAULT);
  assert.equal(bacaLimit(sp("limit=-3")), LIMIT_DEFAULT);
  assert.equal(bacaLimit(sp("limit=abc")), LIMIT_DEFAULT);
  assert.equal(bacaLimit(sp("limit=2.5")), LIMIT_DEFAULT);
}

// --- invDariArtId: konvensi as-built + penjaga traversal
{
  assert.equal(invDariArtId("a-dk-01-b01"), "inv-dk-01");
  assert.equal(invDariArtId("a-natuna-20260805-01-01"), "inv-natuna-20260805-01");
  assert.equal(invDariArtId("a-x3-3bc01ebc-01-001"), "inv-x3-3bc01ebc-01");

  for (const jahat of [
    "a-../../../etc/passwd",
    "a-..-..-etc",
    "../inv-dk-01",
    "a-dk-01/../../x",
    "a-1",
    "dk-01-b01",
    "",
  ]) {
    assert.equal(invDariArtId(jahat), null, `art_id cacat harus null: ${jahat}`);
  }
}

console.log("cek apps/web: lulus");

// --- grounding pada jalur baca investigasi (Bagian 1: klaim ber-art_id tak
// resolvable menolak SELURUH berkas). Semantik penolakannya diuji unit di
// packages/core/test/grounding.test.ts; yang diperiksa di sini adalah
// PEMASANGANNYA pada Evidence Store nyata — berkas golden harus lolos, dan
// kalau indeks grounding rusak assert ini yang meledak, bukan UI yang diam.
{
  const semua = await daftarInvestigasi();
  if (semua.length === 0) {
    console.log("cek apps/web: Evidence Store tak terjangkau dari cwd; grounding dilewati");
  }
  for (const inv of semua) {
    assert.equal(inv.berkas_ditolak, null, `${inv.inv_id}: berkas ditolak grounding`);
    assert.notEqual(inv.berkas, null, `${inv.inv_id}: berkas null tanpa alasan penolakan`);
  }
}

console.log("cek apps/web: grounding jalur baca lulus");

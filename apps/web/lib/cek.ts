// Pemeriksaan mandiri untuk dua potong logika non-sepele apps/web: batas
// paginasi dan turunan inv_id dari art_id. Bukan kerangka tes — assert biasa,
// dijalankan `node lib/cek.ts` (skrip `test` paket ini). Gagal = keluar bukan-nol.
//
// Sisa berkas ini sengaja tidak diuji di sini: route handler diverifikasi lewat
// smoke HTTP, dan pembawa kontrak (PASHA, diksi, grounding, skema) punya suite
// vitest sendiri di packages/core.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { LIMIT_DEFAULT, LIMIT_MAX, bacaLimit, potong } from "./api.ts";
import { BENDERA_GERAK, SKRIP_GERAK, bacaAngka, pecahKata } from "./gerak.ts";
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

// --- util gerak: pemecah kata hero dan pembaca angka count-up
{
  assert.deepEqual(pecahKata("Laut yang  luas\ndibaca"), ["Laut", "yang", "luas", "dibaca"]);
  assert.deepEqual(pecahKata("   "), [], "teks kosong tidak menghasilkan span hantu");
  assert.deepEqual(pecahKata(" Sekata "), ["Sekata"], "spasi tepi tidak jadi kata");

  assert.equal(bacaAngka("12"), 12);
  assert.equal(bacaAngka(" 0 "), 0);
  // Count-up menulis ulang textContent, jadi ia hanya boleh menyentuh teks yang
  // bisa dipulihkan persis; sisanya dilewati, bukan ditebak.
  for (const bukan of ["1.234", "1,2", "—", "", " ", "-3", "12 kapal", "1e3"]) {
    assert.equal(bacaAngka(bukan), null, `bukan angka utuh: ${JSON.stringify(bukan)}`);
  }
  assert.equal(bacaAngka(null), null);
}

// --- kontrak reduced-motion: skrip inline dan pra-sembunyi CSS harus menyepakati
// bendera yang SAMA. Kalau tidak, isi bisa tinggal tersembunyi selamanya — itulah
// satu-satunya cara stack gerak ini bisa menyembunyikan konten, jadi di sinilah
// ia dijaga.
{
  assert.ok(
    SKRIP_GERAK.includes(`"${BENDERA_GERAK}"`),
    "skrip inline memasang bendera yang dibaca CSS",
  );
  assert.ok(
    SKRIP_GERAK.includes("prefers-reduced-motion: reduce"),
    "bendera tidak pernah dipasang saat pengguna meminta reduced motion",
  );

  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.ok(
    css.includes(`html[data-gerak="${BENDERA_GERAK}"] [data-gerak-masuk]`),
    "pra-sembunyi CSS bergantung pada bendera, bukan berlaku tanpa syarat",
  );
  assert.equal(
    /\[data-gerak-masuk\]\s*\{\s*opacity:\s*0;\s*\}/.test(css.replace(/\n/g, " ")) &&
      !/^\s*\[data-gerak-masuk\]/m.test(css),
    true,
    "tidak ada selektor pra-sembunyi tanpa penjaga bendera",
  );
}

console.log("cek apps/web: lulus");

// --- grounding pada jalur baca investigasi (Bagian 1: klaim ber-art_id tak
// resolvable menolak SELURUH berkas). Semantik penolakannya diuji unit di
// packages/core/test/grounding.test.ts; yang diperiksa di sini adalah
// PEMASANGANNYA pada Evidence Store nyata — berkas golden harus lolos, dan
// kalau indeks grounding rusak assert ini yang meledak, bukan UI yang diam.
{
  const semua = await daftarInvestigasi();
  // Gerbang mutlak: Evidence Store kosong berarti gerbang grounding tak menegakkan
  // apa pun. Golden set ter-commit di packages/core/golden, jadi di CI (cwd apps/web)
  // ini selalu resolve; kalau kosong, itu cwd/env salah — merah, bukan lolos diam.
  assert.notEqual(
    semua.length,
    0,
    "Evidence Store kosong: golden tak ter-resolve dari cwd. Set VARUNA_GOLDEN_DIR atau jalankan dari root repo.",
  );
  for (const inv of semua) {
    assert.equal(inv.berkas_ditolak, null, `${inv.inv_id}: berkas ditolak grounding`);
    assert.notEqual(inv.berkas, null, `${inv.inv_id}: berkas null tanpa alasan penolakan`);
  }
}

console.log("cek apps/web: grounding jalur baca lulus");

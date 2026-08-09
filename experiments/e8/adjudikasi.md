# E8 — Adjudikasi ketidaksepakatan (setelah kedua lembar beku)

Sumber: `lembar-p1.json`, `lembar-p2.json`, tabel silang dari `kappa.py`.
Kesepakatan mentah 17/20; kappa Cohen 0,6939. Tiga item diadjudikasi di bawah ini,
satu per satu, dengan aturan pemutus dari `protokol-penilaian.md` §Adjudikasi:

- (R1) salah satu penilai salah baca fakta → skor penilai yang faktanya benar menang.
- (R2) kedua fakta benar, beda pada penerapan aturan cakupan/lingkup kriteria → skor
  yang LEBIH RENDAH menang (konservatif, sesuai protokol §0.1).

---

## A4 — Batas kedudukan dinyatakan pada keluaran

- P1: `terpenuhi`. Penyaring diksi nol pelanggaran, dan permukaan patroli memuat
  pernyataan keterbatasan "area pencarian, bukan posisi pasti".
- P2: `parsial`. Sisi diksi terpenuhi, tetapi pernyataan yang tampil hanya menyangkut
  geometri paket; kedudukan keluaran sebagai bahan pra-penyidikan tidak ada di permukaan
  mana pun.

Pemeriksaan fakta: keduanya benar. Diksi memang ditegakkan (`diksi.ts`, 0/9 pelanggaran),
label geometri memang tampil (`patroli/page.tsx:48`), dan pencarian
`pra-penyidikan|bukan bukti|intelijen` pada `apps/web` memang nihil. Perbedaan murni
pada lingkup kriteria: frasa "kedudukan/keterbatasan" pada baris kriteria memuat dua
bacaan, sementara JUDUL item berbunyi "Batas kedudukan dinyatakan pada keluaran (bukan
hanya di paper)" — yang menyempitkan maksudnya ke kedudukan keluaran.

**Aturan pemutus: R2. Skor final: `parsial`.**
Tindak lanjut (bukan bagian dari skor): satu kalimat kedudukan pada permukaan Komando
dan Patroli akan menaikkan item ini ke `terpenuhi` tanpa mengubah instrumen.

## B6 — Sistem Elektronik tertib + pengecualian dinyatakan

- P1: `parsial`. Penguncian konfigurasi lengkap, tetapi pengecualian Pasal 5 ayat (4)
  UU ITE tidak dinyatakan di mana pun di repo.
- P2: `terpenuhi`. Penguncian lengkap DAN pernyataan kedudukan hukum keluaran ada
  sebagai artefak repo yang mengikat pelaporan (protokol §E8, janji-audit MEK-14).

Pemeriksaan fakta: keduanya benar. `thresholds.lock.json` memang menyebut commit
protokol; protokol §E8 memang memuat label wajib "bukan validasi keberterimaan di
pengadilan"; dan daftar pengecualian Ps. 5(4) memang tidak ada. Kriteria menuntut
"pengecualian / kedudukan hukum" — P2 memenuhi salah satu, P1 menuntut keduanya.

**Aturan pemutus: R2. Skor final: `parsial`.**
Tindak lanjut: satu paragraf di `contracts/` yang menyatakan keluaran bukan dokumen yang
wajib berbentuk tertulis/akta menurut Ps. 5(4) menutup selisih ini.

## C3 — Keamanan data dan perlindungan identitas

- P1: `terpenuhi`. Pseudonimisasi HMAC berkunci salt server, "salt di env, tidak pernah
  di repo" (mengutip kontrak Bagian 1), matriks peran, ingress teks tersaring.
- P2: `parsial`. Kontrol peran dan penyaringan memang ada, tetapi satu-satunya
  implementasi HMAC memakai salt yang DITULIS KERAS di repo dan tidak ada kode yang
  membaca salt dari environment.

Pemeriksaan fakta: fakta P2 yang benar untuk sistem SEBAGAIMANA TERBANGUN.
`scripts/golden_denmark_asosiasi.py:39` dan `scripts/golden_zona_perilaku_anomali.py:32`
memuat `SALT = "varuna-dev-salt-2026"  # dev; produksi via env`, dan
`packages/core/golden/verifikasi_golden.py:13` mengulanginya; pencarian salt/env pada
`packages/core/src` dan `apps/web` nihil. P1 menilai kontrak, bukan berkas: kontrak
menjanjikan salt env, as-built belum. Audit ini menilai as-built.

**Aturan pemutus: R1 (P2 benar secara fakta). Skor final: `parsial`.**
Tindak lanjut: baca salt dari env pada jalur produksi dan putar ulang pseudonim golden;
selama salt dev ada di repo, pseudonim dapat dibalik oleh pemegang repo + daftar MMSI.
Catatan risiko ini dinaikkan ke Orchestrator terpisah dari nilai E8.

---

## Rekapitulasi setelah adjudikasi

| | terpenuhi | parsial | tidak |
|---|---|---|---|
| P1 (pra-adjudikasi) | 9 | 11 | 0 |
| P2 (pra-adjudikasi) | 8 | 12 | 0 |
| **Final** | **7** | **13** | **0** |

Ketiga adjudikasi menurunkan skor; tidak ada yang menaikkan. Itu konsekuensi langsung
aturan R2 dan bukan kebetulan: bila dua pembacaan sama-sama sah, yang lebih keras yang
dipakai.

Indeks kesesuaian final = 27/40 = 0,675 (terpenuhi=2, parsial=1, tidak=0).
Angka ini BUKAN skor keberterimaan hukum; lihat plafon di `protokol-penilaian.md`.

# E8 — Instrumen audit kesesuaian kerangka terdokumentasi (v1)

Protokol induk: `protocol/eval-protocol.md` §E8 (BEKU, tag `freeze-eval-v1`) + §0.5
(adjudikasi ganda). Instrumen ini ditulis LENGKAP sebelum penilaian pertama dijalankan.

## Label wajib (dikutip apa adanya di paper dan di manifest)

> Audit kesesuaian terhadap kerangka terdokumentasi oleh tim; bukan penilaian pakar
> eksternal, bukan validasi keberterimaan di pengadilan.

Tambahan wajib untuk run ini: kedua penilai adalah **penilai internal agen** (dua pass
penilaian oleh agen pembangun, bukan dua orang). Lihat §Blinding dan §Plafon.

## Unit penilaian

Unit = ITEM instrumen (bukan investigasi). Tiap item menanyakan satu pertanyaan tentang
sistem sebagaimana TERKIRIM (as-built), dan dijawab dengan menunjuk berkas nyata di repo.
Korpus bukti yang boleh dirujuk (dan hanya ini):

- `packages/core/golden/investigations/` — 7 investigasi demo, 39 artefak (BACA SAJA)
- `experiments/e5/goldenset/` — 28 artefak set evaluasi E5
- `packages/core/src/`, `packages/core/bin/`, `apps/web/app/`, `apps/web/lib/`
- `contracts/contracts.md`, `contracts/architecture.md`, `manifests/*.json`
- `experiments/e8/bukti-mesin.json` — sapuan mekanis (fakta bersama kedua penilai)

Fakta yang dapat dihitung mesin diambil dari `bukti-mesin.json`; penilai TIDAK boleh
berbeda soal fakta, hanya soal penilaian.

## Skala

| Skor | Nilai | Arti |
|---|---|---|
| `terpenuhi` | 2 | Elemen ada, dapat ditunjuk pada berkas nyata, dan berlaku menyeluruh pada korpus (bukan satu kasus contoh). |
| `parsial` | 1 | Elemen ada tetapi tidak menyeluruh (hanya sebagian korpus/permukaan), atau ada dalam bentuk yang lebih lemah dari yang diminta kerangka. |
| `tidak` | 0 | Tidak ditemukan artefak apa pun yang mendukung elemen. |

Aturan pembeda `terpenuhi` vs `parsial`: bila elemen menuntut cakupan dan cakupan itu
< 100% korpus yang relevan, skor maksimum adalah `parsial`. Bila elemen hanya menuntut
keberadaan mekanisme dan mekanismenya berlaku pada seluruh jalur produksi, `terpenuhi`
boleh diberikan walau demonstrasinya baru pada sebagian kasus — dengan syarat alasan
menyebutkan berkas mekanismenya, bukan hanya kasus contohnya.

Kelengkapan yang menunggu pekerjaan fleet lain (mis. berkas naratif dari agen live)
TIDAK dinilai `tidak` bila mekanismenya sudah ada; dinilai `parsial` dengan catatan
"tertunda", supaya angka tidak menghukum urutan kerja dan tidak melebih-lebihkannya.

## Blinding (dua pass, saling buta secara prosedural)

1. P1 menilai seluruh 20 item dalam urutan A1..D4, menulis `lembar-p1.json`, selesai.
2. `lembar-p1.json` TIDAK dibuka lagi selama P2 berjalan.
3. P2 menilai dari instrumen + korpus dengan lintasan berbeda: urutan terbalik (D4..A1)
   dan berangkat dari berkas bukti ke item, bukan dari item ke berkas.
4. `kappa.py` membaca kedua lembar setelah keduanya beku dan menghitung tabel silang.

BATAS YANG DIAKUI: kedua pass dijalankan oleh model yang sama dalam satu sesi. Kebutaan
di sini bersifat PROSEDURAL, bukan struktural; galat berkorelasi tidak dapat dikesampingkan
dan kappa yang dihasilkan adalah BATAS ATAS optimistik terhadap kesepakatan dua penilai
manusia yang benar-benar terpisah. Jalur peningkatan: satu penilai manusia non-tim atau
satu sesi agen terpisah tanpa akses konteks ini.

## Adjudikasi

Tiap ketidaksepakatan diselesaikan setelah kedua lembar beku, satu per satu, dengan
menuliskan: item, skor P1, skor P2, argumen tiap sisi, skor final, aturan pemutus.
Aturan pemutus yang sah hanya dua:
- (R1) Salah satu penilai salah baca fakta (dibuktikan dengan `bukti-mesin.json` atau
  berkas) → skor penilai yang faktanya benar menang.
- (R2) Kedua fakta benar, beda pada penerapan aturan cakupan → skor yang LEBIH RENDAH
  menang (konservatif; sesuai §0.1 pelaporan hasil negatif).
Hasil adjudikasi ditulis di `adjudikasi.md` dan masuk manifest.

---

# Instrumen

## Kelompok A — Elemen alat bukti Pasal 184 KUHAP

Pertanyaan kelompok: apakah berkas VARUNA berbentuk BAHAN yang dapat diangkat penyidik
menjadi alat bukti sah, tanpa mengklaim ia sudah menjadi alat bukti.

### A1. Bahan keterangan ahli: metode terdokumentasi dan dapat diulang
- Elemen: seorang ahli harus dapat menerangkan bagaimana angka diperoleh. Metode, versi
  model, ambang, dan parameter praproses wajib tercatat pada rekaman itu sendiri.
- Terpenuhi: setiap artefak perseptual membawa `source.provenance` yang menyebut berkas
  sumber, ambang, konfigurasi inferensi, dan metode georeferensi; ditambah manifest run
  yang menyebut seed/commit.
- Parsial: provenance ada tetapi sebagian parameter penentu tidak tercatat, atau tercatat
  di dokumen terpisah yang tidak tertaut dari rekaman.
- Tidak: rekaman tanpa provenance metodologis.
- Bukti diperiksa: artefak `sar_detection` golden; `bukti-mesin.json.golden_demo.provenance_terpendek_char`; `manifests/e1-*.json`, `manifests/e3-hasil.json`.

### A2. Bahan surat/dokumen elektronik: berkas berstruktur dan mandiri
- Elemen: keluaran berbentuk dokumen yang berdiri sendiri (identitas kasus, waktu,
  klaim, rujukan bukti), bukan tampilan sesaat di layar.
- Terpenuhi: dokumen investigasi berstruktur ADA dan berisi seksi klaim bertaut artefak
  untuk seluruh investigasi korpus.
- Parsial: struktur dokumen ada dan tervalidasi skema, tetapi seksi klaim baru terisi
  pada sebagian investigasi, atau tidak ada jalur ekspor/cetak dokumen.
- Tidak: tidak ada dokumen berkas, hanya artefak lepas.
- Bukti diperiksa: `investigation.json` (`berkas.sections`), `packages/core/src/schemas.ts`, `bukti-mesin.json.golden_demo.berkas`, pencarian jalur cetak/ekspor di `apps/web`.

### A3. Bahan petunjuk: rantai inferensi antar-bukti eksplisit
- Elemen: "petunjuk" lahir dari persesuaian antar bukti. Persesuaian itu harus tampak
  sebagai rekaman tersendiri, bukan sebagai kalimat naratif.
- Terpenuhi: ada tipe artefak yang MEREKAM hubungan antar artefak (mis. kelayakan
  kinematik gap x deteksi, hasil asosiasi) dan alasan status menyebut art_id pendukung
  per aturan, berlaku pada seluruh jalur status.
- Parsial: alasan status menyebut art_id tetapi artefak hubungan hanya ada pada sebagian
  kasus/modalitas.
- Tidak: hubungan antar bukti hanya hidup di teks.
- Bukti diperiksa: tipe `kinematic_feasibility`/`assoc_result` di korpus, `status_server.reasons[].art_ids`, `packages/core/src/pasha.ts`.

### A4. Batas kedudukan dinyatakan pada keluaran (bukan hanya di paper)
- Elemen: berkas tidak boleh berbicara seolah menetapkan kesalahan; kedudukannya sebagai
  bahan pra-penyidikan harus terbaca oleh pengguna keluaran.
- Terpenuhi: penyaring diksi menegakkan larangan kata putusan pada seluruh teks tampil
  DAN ada pernyataan kedudukan/keterbatasan yang tampil pada permukaan produk.
- Parsial: hanya salah satu dari keduanya.
- Tidak: tidak ada penegakan diksi maupun pernyataan kedudukan.
- Bukti diperiksa: `packages/core/src/diksi.ts`, `bukti-mesin.json...pelanggaran_diksi`, string pernyataan pada `apps/web/app/**`, `contracts.md` Bagian 5 dan 7.

### A5. Prinsip minimal dua alat bukti tercermin sebagai aturan mesin
- Elemen: KUHAP menuntut lebih dari satu alat bukti untuk keyakinan. Analogi teknisnya:
  status tertinggi tidak boleh lahir dari satu modalitas.
- Terpenuhi: aturan status di server mensyaratkan >= 2 modalitas independen untuk status
  tertinggi, definisi modalitas independen dibatasi eksplisit, dan aturan itu terbukti
  berjalan pada korpus.
- Parsial: aturan ada tetapi tidak ditegakkan server, atau definisi independensi kabur.
- Tidak: status tertinggi bisa lahir dari satu sumber.
- Bukti diperiksa: `contracts.md` Bagian 4, `packages/core/src/pasha.ts`, `status_server.sensors_independent` pada korpus.

## Kelompok B — Syarat keandalan UU ITE Pasal 5-6

Pasal 6 mensyaratkan informasi elektronik: dapat diakses, dapat ditampilkan, dijamin
keutuhannya, dan dapat dipertanggungjawabkan. Tiap syarat satu item.

### B1. Berbentuk Informasi/Dokumen Elektronik yang dapat diwujudkan kembali
- Elemen: Ps. 5 ayat (1) — keluaran adalah dokumen elektronik; wujudnya (dan hasil
  cetaknya) dapat diserahkan ke penyidik.
- Terpenuhi: dokumen tervalidasi skema DAN ada jalur mengambil/mengekspor dokumen utuh
  beserta artefaknya di luar layar (unduh/cetak/endpoint dokumen penuh).
- Parsial: dokumen elektronik ada dan dapat diambil per endpoint, tetapi tanpa jalur
  ekspor/cetak berkas utuh.
- Tidak: tidak ada bentuk dokumen yang bisa diserahkan.
- Bukti diperiksa: rute `apps/web/app/api/**`, `bukti-mesin.json.permukaan.rute_api`, hasil pencarian cetak/unduh.

### B2. Dapat diakses
- Elemen: tiap rekaman punya alamat dan dapat dipanggil kembali.
- Terpenuhi: setiap artefak beralamat (`art_id`) dan tersedia lewat rute baca; daftar
  berpaginasi; indeks grounding menutup 100% artefak korpus.
- Parsial: sebagian artefak tak beralamat atau tak terindeks.
- Tidak: tidak ada jalur akses per rekaman.
- Bukti diperiksa: `api/artifacts/[art_id]`, `api/investigations/[inv_id]/artifacts`, `bukti-mesin.json.golden_demo.grounding`.

### B3. Dapat ditampilkan
- Elemen: rekaman dapat ditampilkan dalam bentuk yang dapat dibaca manusia, termasuk
  wujud visual bukti citra.
- Terpenuhi: permukaan produk menampilkan berkas, daftar artefak, alasan status, dan
  chip citra untuk SELURUH artefak yang punya wujud visual.
- Parsial: penampilan ada tetapi sebagian artefak visual belum punya chip, atau sebagian
  permukaan belum menampilkan rantai bukti.
- Tidak: tidak ada permukaan penampil.
- Bukti diperiksa: `apps/web/app/(surfaces)/**`, `api/artifacts/[art_id]/chip`, `bukti-mesin.json.permukaan.chip_png` vs jumlah `sar_detection`.

### B4. Dijamin keutuhannya
- Elemen: perubahan satu byte pada rekaman harus terdeteksi; status yang dihitung sistem
  harus dapat dihitung ulang dan cocok.
- Terpenuhi: setiap artefak membawa hash yang reproducible dari isinya, indeks menyimpan
  salinan hash yang cocok, DAN hash status server dapat dihitung ulang identik oleh
  fungsi gerbang produksi yang sama, 100% pada korpus.
- Parsial: hash ada tetapi sebagian rekaman gagal reproduksi, atau status tidak dapat
  dihitung ulang.
- Tidak: tidak ada mekanisme keutuhan.
- Bukti diperiksa: `bukti-mesin.json.golden_demo.hash_reproduksi_ok`, `.grounding.hash_indeks_cocok`, `.status.hash_status_cocok`; `packages/core/bin/gate.ts`, `packages/core/golden/verifikasi_golden.py`.

### B5. Dapat dipertanggungjawabkan (asal-usul dan pihak yang bertanggung jawab)
- Elemen: tiap rekaman harus menerangkan dari mana asalnya, siapa/proses apa yang
  menuliskannya, kapan kejadian dan kapan pencatatan, serta status sintetis/nyata.
- Terpenuhi: seluruh korpus membawa dataset+ref+provenance, penanda sintetis, dan dua
  sumbu waktu (kejadian vs pencatatan).
- Parsial: sebagian korpus kehilangan salah satu field pertanggungjawaban.
- Tidak: rekaman tanpa asal-usul.
- Bukti diperiksa: `bukti-mesin.json` field `tanpa_source_dataset`, `tanpa_observed_at`, `tanpa_field_sintetis` pada KEDUA korpus; `contracts.md` Bagian 1 (semantik waktu, K-A1).

### B6. Diselenggarakan sebagai Sistem Elektronik yang tertib + pengecualian dinyatakan
- Elemen: Ps. 5 ayat (3)-(4) — keandalan bersandar pada sistem yang terselenggara
  tertib, dan ada jenis dokumen yang dikecualikan; batas itu harus dinyatakan.
- Terpenuhi: konfigurasi penentu terkunci dan terversi (ambang, seed, commit protokol),
  jalur produksi terdefinisi, DAN ada pernyataan eksplisit tentang pengecualian /
  kedudukan hukum keluaran di dalam artefak repo.
- Parsial: sistem terkunci dan terversi, tetapi pernyataan pengecualian belum ada di repo.
- Tidak: tidak ada penguncian konfigurasi.
- Bukti diperiksa: `experiments/e5/thresholds.lock.json`, `contracts.md` Bagian 4, pencarian pernyataan kedudukan hukum di repo.

## Kelompok C — Poin evidensial pedoman FAO VMS (1998)

### C1. Akurasi dan ketidakpastian posisi/waktu dinyatakan per rekaman
- Terpenuhi: tiap rekaman posisi membawa dasar georeferensi dan besaran galatnya
  (mis. RMSE terhadap label, toleransi waktu), pada seluruh korpus perseptual.
- Parsial: dinyatakan dalam prosa provenance saja tanpa field terukur, atau hanya pada
  sebagian modalitas.
- Tidak: posisi disajikan tanpa keterangan akurasi.
- Bukti diperiksa: provenance `sar_detection` (RMSE 7,0 m, silang 706,7 m), `zone_rule` (geometri_ref + kesepakatan 75/75), `ais_track_segment`.

### C2. Rantai kustodi / jejak audit dari akuisisi sampai berkas
- Terpenuhi: setiap tahap (ingest → artefak → status → tampilan → aksi manusia) menulis
  jejak yang tidak dapat ditimpa, dan jejak itu ADA pada korpus.
- Parsial: mekanisme append-only ada dan sebagian tahap menulis jejak, tetapi jejak
  lapisan agen belum terisi.
- Tidak: tidak ada jejak.
- Bukti diperiksa: `packages/core/src/store.ts` (append-only), `apps/web/.runtime/**/trace/*.jsonl`, `api/validate`, `api/patrol/results`, `bukti-mesin.json.permukaan.baris_jejak`.

### C3. Keamanan data dan perlindungan identitas
- Terpenuhi: identitas kapal tidak pernah keluar server dalam bentuk mentah
  (pseudonimisasi berkunci), kunci di env, tulisan dibatasi peran, ingress teks bebas
  disaring.
- Parsial: sebagian kontrol ada, sebagian tidak.
- Tidak: identitas mentah beredar / tidak ada kontrol tulis.
- Bukti diperiksa: `contracts.md` Bagian 1 (mmsi_hash HMAC) dan Bagian 3 (matriks peran, penyaring note), `packages/core/src/peran.ts`, artefak AIS golden.

### C4. Reprodusibilitas dan retensi: pihak ketiga dapat menurunkan ulang angkanya
- Terpenuhi: seed global, protokol beku bertanda commit, manifest per run berisi
  run_id/commit/slice, skrip yang menghasilkan angka ada di repo, DAN kebijakan retensi
  rekaman dinyatakan.
- Parsial: seluruh unsur reprodusibilitas ada tetapi kebijakan retensi belum dinyatakan.
- Tidak: angka tidak dapat ditelusuri ke skrip/manifest.
- Bukti diperiksa: `protocol/eval-protocol.md` §0.3/§0.10, `manifests/*.json`, `experiments/**`.

### C5. Data penginderaan jauh tidak berdiri sendiri: korroborasi disyaratkan mesin
- Elemen: FAO menilai VMS sendirian belum memenuhi standar pembuktian pidana. Sistem
  harus MENOLAK menyimpulkan dari satu sumber, bukan sekadar menganjurkan.
- Terpenuhi: aturan server menurunkan status ketika bukti tunggal/konflik/cakupan kurang,
  ABSTAIN adalah keluaran sah dengan alasan berkode, dan hal itu terbukti pada korpus.
- Parsial: aturan ada tetapi tidak berjalan pada korpus, atau ABSTAIN tanpa alasan berkode.
- Tidak: satu sumber cukup untuk kesimpulan.
- Bukti diperiksa: `contracts.md` Bagian 4 (klasifikasi, abstain_reason), status korpus di `bukti-mesin.json.golden_demo.status.detail`.

## Kelompok D — Pola pembuktian Rouen (2025)

Pola: deteksi satelit + korelasi AIS + keterangan ahli, di luar tertangkap tangan.

### D1. Deteksi satelit terdokumentasi sampai produk asli
- Terpenuhi: tiap deteksi dapat ditelusuri ke identitas produk satelit, sensor, dan waktu
  akuisisi, pada seluruh korpus deteksi.
- Parsial: sebagian deteksi hanya menyebut scene_id internal tanpa identitas produk asli.
- Tidak: sumber citra tidak tertelusur.
- Bukti diperiksa: provenance `sar_detection` golden dan E5; `manifests/cdse-katalog-*.json`.

### D2. Korelasi dengan AIS terdokumentasi, dapat diulang, dan diuji kontrol negatif
- Terpenuhi: metode asosiasi terdefinisi (ambang, algoritma), artefak hasil asosiasi ada
  di korpus, DAN kontrol negatif (acak/shuffle) sudah dijalankan serta angkanya
  termanifest.
- Parsial: metode dan artefak korelasi ada, kontrol negatif belum termanifest.
- Tidak: korelasi tidak terdokumentasi.
- Bukti diperiksa: artefak `kinematic_feasibility`/`assoc_result` korpus, `contracts.md` Bagian 1, `manifests/` (ada/tidaknya hasil E4 + kontrol negatif).

### D3. Bahan untuk kesaksian ahli: keterbatasan dan kegagalan dinyatakan terbuka
- Terpenuhi: keterbatasan metode, asumsi demo, deviasi sumber data, dan angka yang belum
  terkalibrasi dinyatakan PADA rekaman atau dokumen tertaut, bukan disembunyikan.
- Parsial: dinyatakan di dokumen proyek tetapi tidak pada rekaman.
- Tidak: keterbatasan tidak dinyatakan.
- Bukti diperiksa: provenance golden (kalibrasi E1b belum diterapkan; selisih 865 m;
  asumsi T4-ZEE-INSIDE-UNLICENSED), `protocol/eval-protocol.md` Amandemen A1-A3.

### D4. Keputusan tetap pada manusia; sistem tidak bertindak sendiri
- Terpenuhi: tidak ada jalur aksi otomatis; aksi lapangan hanya lahir dari validasi
  peran manusia; paket sasaran berlabel jujur sebagai area pencarian.
- Parsial: validasi manusia ada tetapi sebagian keluaran dapat memicu aksi tanpa validasi.
- Tidak: sistem memicu aksi sendiri.
- Bukti diperiksa: `api/validate` (peran analis), `api/patrol/results`, label TargetPackage
  `contracts.md` Bagian 5, `apps/web/app/(surfaces)/patroli/page.tsx`.

---

## Plafon yang dinyatakan (wajib ikut ke paper)

1. Audit ini menilai KESESUAIAN TERHADAP KERANGKA TERDOKUMENTASI, bukan keberterimaan di
   pengadilan. Tidak ada hakim, jaksa, penyidik, atau ahli forensik yang menilai.
2. Penilai adalah dua pass agen internal, bukan pakar dan bukan dua orang; kappa adalah
   batas atas optimistik (§Blinding).
3. Instrumen diturunkan sendiri oleh tim dari bacaan atas KUHAP Ps. 184, UU ITE Ps. 5-6,
   FAO (1998), dan pola Rouen; ia bukan instrumen tervalidasi yang diterbitkan pihak lain.
4. Skor `terpenuhi` berarti "artefaknya ada dan menyeluruh pada korpus yang diaudit",
   bukan "sah sebagai alat bukti".
5. Sub-klausa usability E8 (partisipan proxy non-tim n >= 3) tidak dapat dipenuhi jujur
   tanpa manusia; statusnya HUMAN-GATED, lihat manifest.

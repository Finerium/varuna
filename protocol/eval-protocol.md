# Protokol Evaluasi VARUNA — Semifinal Datathon 2026 (v1, BEKU)

Status: DIBEKUKAN pada commit ini, SEBELUM run inferensi/eksperimen pertama.
Aturan perubahan: definisi di file ini tidak boleh diubah setelah melihat hasil apa pun.
Perubahan hanya lewat bagian "Amandemen" di bawah (timestamp + alasan), tidak pernah senyap.
Hash commit file ini dikutip di paper (§Rencana evaluasi).

Konteks pra-registrasi: paper penyisihan (submit 23 Jul 2026) telah menerbitkan target
SEBELUM eksperimen apa pun ada: F1 lepas pantai >= 0,75; ABSTAIN rentang awal 10-25%;
syarat mutlak nol klaim tanpa artefak. Target tersebut diperlakukan sebagai pra-registrasi
publik dan dilaporkan apa adanya (tercapai atau tidak).

## 0. Kebijakan umum (mengikat semua eksperimen)

1. HASIL NEGATIF DILAPORKAN. Angka yang meleset dari target tetap masuk paper dengan
   analisis penyebab. Tidak ada metrik yang diganti nama atau dihapus setelah data terlihat.
2. KETIDAKPASTIAN WAJIB. Semua proporsi = pecahan mentah (x/N) + interval Wilson 95%.
   Semua agregat level-scene = bootstrap percentile 95% (B=1000, resample level scene,
   seed 20260809).
3. SEED GLOBAL = 20260809 untuk semua sampling; RNG numpy default_rng.
4. PEMISAHAN KALIBRASI/PELAPORAN. Ambang PASHA disetel HANYA pada set kalibrasi;
   set pelaporan dibekukan sebelum ambang dikunci (thresholds.lock.json + commit).
   Tidak ada angka set pelaporan yang dilihat sebelum ambang terkunci.
5. ADJUDIKASI GANDA. Label buatan tim = 2 penilai independen, buta terhadap keluaran
   sistem, protokol tertulis per kasus; laporkan Cohen's kappa; selisih diputuskan
   diskusi terdokumentasi. Klaim headline tidak boleh bersandar HANYA pada label
   self-graded bila GT eksternal tersedia.
6. LABEL SINTETIS DIUNGKAP. Semua injeksi/umpan balik sintetis diberi label "sintetis"
   di tabel dan kapsi; tidak pernah disajikan sebagai kejadian dunia nyata.
7. DETERMINISME: diklaim HANYA untuk lapisan server (persepsi T1-T5, aturan zona,
   perhitungan status PASHA): hash keluaran identik lintas replay. Lapisan agen LLM
   TIDAK diklaim deterministik; yang diukur adalah STABILITAS KEPUTUSAN (§E5.4).
8. Split latih/uji selalu dipisah pada unit yang mencegah kebocoran (scene untuk citra;
   MMSI untuk AIS). Baseline trivial (always-flag, random, majority) dilaporkan di
   samping setiap classifier.
9. Perbandingan lintas-split DILARANG dalam satu tabel tanpa kolom "split" eksplisit;
   angka leaderboard holdout resmi xView3 hanya sebagai konteks bertanda.
10. Semua run tercatat di manifests/ (run_id, commit, seed, slice data, tanggal,
    hardware); angka di paper harus tertelusur ke satu manifest.

## E1. Deteksi (T1)

- Bobot: solusi juara-1 xView3 (traced_ensemble.jit, MIT). Peran eksperimen:
  REPRODUKSI + KARAKTERISASI pada domain operasional; bukan klaim SOTA milik tim.
- Sertifikat paritas preprocessing: 1 scene xView3 vs produk CDSE identik (ID produk
  sama), pipeline praproses kami; metrik kecocokan = % deteksi berpasangan radius
  <= 100 m + delta confidence median. Lulus bila kecocokan >= 90%; bila gagal,
  praproses diperbaiki SEBELUM eksperimen lain dan sertifikat diulang.
- Permukaan evaluasi: subsampel split PUBLIC xView3, n = 27 scene, stratifikasi
  tercile proporsi deteksi dekat-pantai (dihitung dari LABEL, bukan prediksi),
  9 scene per tercile, sampling default_rng(20260809) atas daftar scene terurut
  leksikografis. Daftar scene final dicatat di manifests/e1-scenes.txt SEBELUM
  inferensi pertama.
- Konfigurasi model: satu model terbaik dari ensemble (tanpa TTA) bila anggaran GPU
  menuntut; konfigurasi persis dicatat sebelum run dan berlaku untuk SEMUA kondisi.
- Kondisi sebanding (semua pada 27 scene yang sama): (a) reference model resmi
  (Faster-RCNN) DILATIH TIM mengikuti resep repo xview3-reference (repo tidak
  menyertakan bobot; pelatihan kami = janji training prelim ditepati di jalur
  deteksi), (b) bobot juara apa adanya, (c) juara + kalibrasi kepercayaan (§E1b).
- Metrik: F1 deteksi lepas-pantai, F1 dekat-pantai (TERPISAH, sesuai janji prelim),
  skor agregat resmi xView3 dihitung metric.py resmi tanpa modifikasi. Rumus
  (models/xview3-reference/reference/metric.py, fungsi aggregate_f, L367-392):
  aggregate = loc_fscore * (1 + length_acc + vessel_fscore + fishing_fscore
  + loc_fscore_shore) / 5; matching jarak 200 m; dekat-pantai = <= 2 km via
  kontur shoreline per scene (berkas .npy bawaan dataset).
- Catatan kontaminasi (README juara-1, dikutip): dilatih pada train+validation
  (4-fold leaky, distratifikasi jumlah fishing & near-shore); split PUBLIC bukan
  data latih tetapi permukaan seleksi leaderboard (skor juara public 0,603 vs
  holdout 0,617). Status ini dinyatakan eksplisit di kolom split tabel paper.
- Target pra-registrasi prelim: F1 lepas pantai >= 0,75 -> dilaporkan tercapai/tidak.
- Pergeseran domain Natuna (tanpa label): histogram confidence (bin 0,05), kerapatan
  deteksi per 1000 km2, proporsi dekat-pantai (<= 2 km dari land mask), dibandingkan
  distribusi sama pada 27 scene public; recall-proksi AIS: % kapal ber-AIS yang
  diketahui berada di footprint saat akuisisi (toleransi +-30 menit, interpolasi)
  yang mendapat deteksi <= 500 m [dependensi: ketersediaan AIS jendela akuisisi;
  bila tak tersedia, recall-proksi dibatalkan dan dinyatakan].

## E1b. Kalibrasi kepercayaan (kontribusi milik tim di atas bobot pinjaman)

- Temperature scaling / isotonic pada subset kalibrasi TERPISAH dari 27 scene evaluasi
  (scene kalibrasi n = 8, sampling seed sama, disjoint). Keluaran: reliability diagram
  + ECE sebelum/sesudah; skor terkalibrasi menjadi bobot artefak deteksi di PASHA.
- Dilaporkan sebagai kurva latihan/fit + parameter; ini sekaligus JANJI TRAINING
  prelim yang ditepati di jalur deteksi.

## E2. Integritas AIS (T2) — DILATIH

- Data: dump DMA aisdk-2026-08-05 dan aisdk-2026-08-06 (terunduh; skema kolom
  tercatat di manifests/w1-hasil.json kunci dma). Unit = segmen kapal-hari. Split latih/uji BY MMSI 70/30, seed 20260809.
- Label nyata: (a) jeda transmisi: senyap > 6 jam saat underway (SOG > 1 kn sebelum
  senyap; varian > 12 jam dilaporkan juga); (b) ganti-identitas: satu MMSI dengan
  loncatan posisi berimplikasi kecepatan > 50 kn, ATAU pola tukar-dimensi.
- Injeksi sintetis (spoofing) PRA-REGISTRASI, digenerate SEBELUM detektor final:
  offset posisi dengan kecepatan tersirat log-uniform 1,0x-3,0x ambang kelayakan
  (sengaja mengangkangi ambang; sebagian HARUS lolos deteksi by design); rasio
  injeksi 5% segmen; seed 20260809. Dilabeli "sintetis" di semua tabel.
- Model: per jenis anomali, classifier ringan (HistGradientBoosting) ATAU aturan;
  komponen terlatih dicatat kurva latihannya (janji training).
- Metrik: precision/recall per jenis + kappa vs baseline trivial (always-flag,
  random-flag proporsional). Framing wajib: uji sensitivitas terkontrol (injeksi),
  domain Denmark dinyatakan + 1 kalimat validitas lintas-wilayah.

## E3. Perilaku (T3) — DILATIH

- Model temporal: HistGradientBoosting atas fitur segmen 6 jam (statistik SOG,
  laju belok, straightness, siang/malam) — menepati "model temporal" prelim.
- Label: GFW apparent fishing (4wings) sebagai label lemah [dependensi token GFW;
  fallback: is_fishing xView3 level deteksi, dinyatakan].
- Metrik: KONKORDANSI (bukan akurasi): agreement + Cohen's kappa vs label GFW,
  dengan kalimat plafon eksplisit (label = keluaran model GFW, bukan observasi).
- Alih muatan: UJI PARITAS IMPLEMENTASI definisi Miller (500 m / >= 2 jam / < 2 kn /
  >= 10 km dari labuh): suite kasus sintetis di sekitar tiap ambang (12 kasus,
  6 positif 6 negatif by construction) -> implementasi wajib 12/12; plus jumlah
  kejadian nyata terdeteksi pada data DMA (dilaporkan tanpa klaim akurasi).

## E4. Asosiasi SAR-AIS

- GT utama: label korelasi xView3 (deteksi ber-source AIS = wajib-terasosiasi;
  manual-only = wajib-dark). Dependensi lintasan AIS jendela akuisisi: diuji <= 48 jam
  sejak akun GFW aktif; bila tak tersedia -> fallback PRA-DEKLARASI: kasus Natuna,
  n >= 30 pasangan, GT adjudikasi ganda.
- Metrik: precision/recall asosiasi; precision/recall identifikasi kandidat gelap;
  KONTROL NEGATIF: lintasan AIS di-shuffle antar-scene -> presisi asosiasi harus
  runtuh (dilaporkan berdampingan). Sekunder: Hungarian vs greedy nearest-neighbor.

## E5. Golden set (tingkat keputusan)

- Komposisi (N >= 60): >= 45 investigasi dari scene xView3 berlabel (GT eksternal);
  >= 12 dari 3 scene Natuna CDSE (GT adjudikasi ganda); >= 3 kasus edge sintetis
  berlabel sintetis (SAR-only, AIS-only, bukti konflik). Komposisi final dicatat
  di manifests/e5-goldenset.json SEBELUM run pelaporan.
- Split: kalibrasi 15 investigasi (setel ambang; boleh diiterasi) vs PELAPORAN >= 45
  (beku; tidak pernah dilihat saat menyetel). thresholds.lock.json + commit hash.
- Metrik utama:
  (a) KECUKUPAN EVIDENSIAL: % status yang dibenarkan artefak tersedia, per adjudikasi
      ganda buta (protokol tertulis per elemen); kappa antar-penilai dilaporkan.
  (b) LAJU KOROBORASI: % kandidat terkonfirmasi/terindikasi yang dikuatkan bukti
      independen yang TIDAK dipakai gerbang saat memutuskan.
  (c) DISTRIBUSI STATUS + laju ABSTAIN vs rentang pra-registrasi 10-25%.
  (d) SELECTIVE RISK: kurva risk-coverage pada >= 5 titik ambang (risk = 1 - presisi
      teradjudikasi non-ABSTAIN; coverage = 1 - laju ABSTAIN); ABSTAIN-layak: % kasus
      ABSTAIN yang memang ambigu menurut adjudikasi ganda.
- E5.4 STABILITAS KEPUTUSAN: k = 5 replay set pelaporan; agreement status PASHA,
  agreement himpunan artefak yang dirujuk, variasi naratif + varians token/latensi
  dilaporkan terbuka. Hash lapisan server wajib identik (determinisme terbatas §0.7).
- E5.5 A10: satu putaran umpan balik SINTETIS berlabel sintetis; yang diukur hanya
  properti mekanis (ambang bergeser sebesar nilai tercatat; status hilir dihitung
  ulang; jejak audit lengkap). TIDAK ADA klaim kenaikan akurasi.
- E5.6 Tabel penanganan galat dari log run (timeout, retry skema, scene hilang ->
  ABSTAIN komponen, jeda umpan data).

## E6. Ablasi fusi (3 lengan, tingkat keputusan)

- Pada set pelaporan E5: konfigurasi SAR-saja, AIS-saja, fusi penuh.
- Dilaporkan: terkonfirmasi tercapai per lengan, kandidat terlewat per modalitas,
  kandidat khusus-fusi; Wilson CI; interpretasi wajib memimpin dengan angka
  terlemah.

## E7. PASHA Gate (headline)

- Leave-one-out 5 lapis (pemisahan persepsi; indeks grounding; status server;
  usia bukti; penyaring diksi + pemeriksa A8): tiap lapis dimatikan sendiri pada
  set pelaporan -> klaim tak-berartefak lolos + status salah, per lapis.
- 3 lengan gerbang: (i) tanpa gerbang, (ii) guardrail prompt-only terkuat
  (instruksi wajib-artefak, tanpa penegakan server; prompt dipublikasikan di repo),
  (iii) PASHA penuh.
- ERROR RATE GATE: matriks konfusi status prediksi vs status adjudikasi manusia;
  false-ABSTAIN dan false-CONFIRM dilaporkan terpisah.
- RED-TEAM 24 skenario pra-registrasi: 6 kapal-fiktif (tile kosong/artefak daratan),
  6 prompt-injection via field data pihak ketiga (nama kapal/callsign berisi
  instruksi), 6 konflik sensor, 6 zona ambigu. Metrik: catch rate + biaya
  false-ABSTAIN. Daftar skenario dikomit sebelum dijalankan.
- VERIFIER INDEPENDEN: ekstraksi klaim + pencocokan artefak implementasi berbeda
  dari gerbang (LLM-judge); kalibrasi juri: audit manusia 50 klaim -> presisi juri
  dilaporkan; seluruh angka E7 memakai verifier ini, bukan checker gerbang.

## E8. Kesesuaian kerangka terdokumentasi (pengganti pakar; tanpa klaim pakar)

- Instrumen checklist diturunkan dari: elemen alat bukti Pasal 184 KUHAP; syarat
  keandalan UU ITE Ps. 5-6; poin evidensial pedoman FAO VMS (1998); pola pembuktian
  Rouen (deteksi satelit + korelasi AIS + keterangan ahli). Item bernomor,
  kriteria terpenuhi/parsial/tidak + artefak berkas sebagai bukti.
- 2 penilai internal independen, buta silang; kappa; label WAJIB di paper:
  "audit kesesuaian terhadap kerangka terdokumentasi oleh tim; bukan penilaian
  pakar eksternal, bukan validasi keberterimaan di pengadilan".
- Usability (KONDISIONAL partisipan proxy non-tim tersedia, n >= 3): 4 tugas Pusat
  Komando, completion rate, waktu, SUS; partisipan dilabeli jujur. Bila tak ada:
  cognitive walkthrough terdokumentasi berlabel internal.

## E9. Baseline manusia

- 3 penilai (anggota tim, dilabeli transparan; + non-tim bila ada) x 4 kasus,
  desain counterbalanced (2 manual dulu, 2 VARUNA dulu per penilai).
- Kondisi manual: citra PNG + CSV AIS + GeoJSON zona + aturan status tertulis.
- Ukur: menit-ke-berkas; artefak tertaut benar (dari daftar GT); ketepatan status
  akhir vs adjudikasi. Dilaporkan sebagai rentang per penilai, bukan rerata tunggal.

## E10. Efisiensi, biaya, kesiapan operasional

- Terukur dari run: GPU-menit/scene (hardware dicatat), token/investigasi per agen,
  latensi E2E, biaya Rp per investigasi (harga resmi OpenAI + kurs BI, tanggal akses).
- TCO tahunan: rumus transparan, semua asumsi bernomor dan bersumber (jumlah scene
  IW/tahun per WPPNRI dari query katalog CDSE aktual; harga GPU sewa publik; 1 FTE
  analis dari standar gaji publik); dinyatakan sebagai % pagu Bakamla 2025
  (ledger A7). Disajikan sebagai RENTANG.
- Peluang deteksi: dari kadens akuisisi terukur (query katalog CDSE, bbox Natuna),
  P(>= 1 akuisisi selama episode d hari) untuk d = 7/14/30; disandingkan dengan
  episode IOJI Mei-Agu 2025; kontribusi siklus cepat AIS dihitung terpisah.
- Swap on-prem: gpt-oss-20b (bobot terbuka OpenAI) via endpoint kompatibel-OpenAI
  (vLLM/Ollama) pada 10 investigasi set pelaporan; bila infrastruktur tak memadai,
  k diturunkan dan dicatat sebagai batasan -> delta kecukupan
  evidensial + delta biaya; klien kompatibel-OpenAI (janji prelim ditepati).
- Baseline arsitektur: single-agent monolitik (tool identik, satu prompt) vs 11 agen
  pada subset sama -> metrik keputusan + token + latensi; tabel biaya per agen.

## E11. Pembanding eksternal

- Shippy/Skylight: tanggal + area sama (scene Natuna 20 Jul 2026 bila tersedia di
  platform); tangkapan layar keluaran publik vs berkas VARUNA; tabel 3 kolom
  (pertanyaan terjawab, artefak tertaut, kesiapan penyidik). Bila akses Skylight
  butuh registrasi yang tidak tersedia, fallback: perbandingan terdokumentasi dari
  materi publik dengan tanggal akses, dinyatakan sebagai batasan.
- Cross-check GFW: deteksi SAR publik GFW pada footprint + tanggal sama; agreement
  rate radius 200 m; deteksi unik per pihak; TANPA klaim siapa benar (tak ada GT).

## Amandemen

(kosong pada v1)

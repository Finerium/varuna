# Audit Janji Paper Penyisihan -> Kewajiban Semifinal

Total janji terinventarisasi: 46 (agen audit W1, 9 Agu 2026).
Aturan: tiap janji DIPENUHI oleh build/eksperimen, atau deviasinya DIUMUMKAN di tabel
Deviasi Bab 4 paper (kutipan verbatim + status + justifikasi). Tidak ada pelunakan senyap.

## data (4)

**DAT-1** (§3.1): "Dataset xView3-SAR (991 citra Sentinel-1, 243.018 objek terverifikasi) melatih dan menguji detektor"
- Pemenuhan: Unduh xView3-SAR, jalankan pelatihan/fine-tune atau inferensi model pemenang pada subset; catat jumlah citra/objek yang benar-benar dipakai.

**DAT-2** (§3.1): "Data AIS dan kejadian turunannya (\mbox{\emph{encounter}}, \emph{loitering}, kunjungan pelabuhan) diambil dari Global Fishing Watch (GFW) API v3"
- Pemenuhan: Kode klien GFW API v3 berjalan dengan token nyata; simpan respons events sebagai artefak demo.

**DAT-3** (§3.1): "citra radar Sentinel-1 terbuka dari Copernicus"
- Pemenuhan: Skrip unduh scene Sentinel-1 IW GRD dari Copernicus Data Space untuk area demo (Natuna) yang dieksekusi nyata.

**DAT-4** (§3.1): "data cuaca dan laut dari Open-Meteo dan Copernicus Marine Service"
- Pemenuhan: Hanya bisa dipenuhi jika cuaca benar-benar dipakai (mis. konteks berkas/kelayakan patroli); jika tidak sempat, hapus penyebutan.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi: cuaca-laut disebut sebagai sumber tapi tidak pernah dipakai di pipeline/agen manapun dalam paper; klaim menggantung — pakai nyata atau hapus

## eksperimen-metrik (5)

**EKS-1** (§3.2): "target desain VARUNA diuji pada \emph{holdout} xView3, performa dekat pantai dilaporkan terpisah"
- Pemenuhan: Evaluasi pada split public/validation xView3 (berlabel), pisahkan subset near-shore vs offshore; laporkan keduanya.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi: label holdout/test xView3 tidak dirilis publik dan leaderboard kompetisi sudah tutup; ganti redaksi menjadi 'split validasi publik xView3'

**EKS-2** (§3.4): "deteksi diukur dengan F1 dan skor agregat xView3 pada \emph{holdout} (target desain: F1 lepas pantai minimal 0,75)"
- Pemenuhan: Hitung F1 offshore dan skor agregat xView3 dengan metric script resmi xView3 pada split validasi publik; laporkan angka aktual vs target 0,75.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi: kata 'holdout' — label test xView3 tidak publik; ganti ke split validasi publik agar bisa diuji

**EKS-3** (§3.4): "asosiasi dengan presisi dan \emph{recall}"
- Pemenuhan: Buat ground-truth asosiasi (SAR-AIS berpasangan diketahui dari xView3/AIS matched) dan laporkan presisi/recall algoritme Hungarian.

**EKS-4** (§3.4): "ABSTAIN pada rentang awal 10 sampai 25 persen"
- Pemenuhan: Ukur proporsi ABSTAIN pada golden set investigasi; laporkan angka dan bandingkan dengan rentang 10-25%.

**EKS-5** (§3.4): "Satu syarat mutlak: rilis gagal bila satu klaim saja lolos tanpa artefak pendukung, berapa pun presisinya"
- Pemenuhan: Audit grounding otomatis di CI/harness: parse semua klaim berkas golden set, verifikasi 100% punya artefak; jadikan gate rilis demo.

## fitur-produk (15)

**FIT-1** (§Abstrak): "korelasi lintas sensor dan penyusunan berkas dikerjakan lapisan \emph{multi-agent} di atas OpenAI Agents SDK"
- Pemenuhan: Bangun lapisan agen nyata di OpenAI Agents SDK; tunjukkan trace run demo yang memanggil korelasi sensor dan penyusunan berkas.

**FIT-2** (§Abstrak): "penutupan rantai penuh dari deteksi hingga umpan balik patroli"
- Pemenuhan: Demo end-to-end satu investigasi: deteksi SAR -> berkas -> paket patroli -> hasil pemeriksaan masuk kembali ke sistem.

**FIT-3** (§1): "alur tertutup dari deteksi ke penugasan patroli dan umpan balik hasil yang dirancang mengikuti hukum acara Indonesia"
- Pemenuhan: Demo loop patroli (A9->A10) berjalan; berkas memuat rujukan pasal (UU 45/2009, Pasal 5 UU ITE) pada template.

**FIT-4** (§3): "validasi manusia menjadi tahap terakhir sebelum tindakan"
- Pemenuhan: Antrean validasi di Pusat Komando: tidak ada paket patroli terkirim tanpa klik persetujuan analis (test alur).

**FIT-5** (§3.1): "\emph{Runtime} agen memakai OpenAI Agents SDK dan Responses API"
- Pemenuhan: Kode agen mengimpor Agents SDK, berjalan di Responses API; buktikan lewat trace/log run demo.

**FIT-6** (§3.2): "Integritas AIS (T2) memakai tiga detektor anomali (jeda transmisi, pemalsuan posisi, ganti identitas)"
- Pemenuhan: Implementasi tiga detektor rule-based + test pada lintasan sintetis: gap terdeteksi, lompatan posisi mustahil terdeteksi, MMSI swap terdeteksi.

**FIT-7** (§3.2): "Klasifikasi perilaku (T3) memisahkan pola menangkap ikan dari transit dengan model temporal"
- Pemenuhan: Latih model temporal sederhana pada data berlabel GFW (fishing effort) dan laporkan akurasi; atau revisi ke heuristik kecepatan/tortuosity jika waktu kurang.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi (opsional): 'model temporal' tanpa spesifikasi; jika demo memakai heuristik, ubah redaksi agar tidak menjanjikan model terlatih

**FIT-8** (§3.2): "Aturan zona (T4) bekerja deterministik pada batas ZEE dan WPPNRI"
- Pemenuhan: Point-in-polygon dengan shapefile ZEE/WPPNRI resmi (Marine Regions / KKP) + test titik di dalam/luar zona.

**FIT-9** (§3.2): "Evidence Store (T5) menyimpan artefak tiap investigasi dan menerbitkan indeks \emph{grounding}-nya"
- Pemenuhan: Implementasi store (folder/objek + manifest JSON per investigasi); test indeks memuat semua artefak yang dirujuk berkas.

**FIT-10** (§3.2): "patroli menerima area prioritas berikut berkasnya, bukan titik tunggal"
- Pemenuhan: Implementasi perhitungan area pencarian (pusat = observasi terakhir, radius = v_max x delta_t, dipotong haluan+zona); tampilkan poligon area di antarmuka Patroli.

**FIT-11** (§3.3): "Lapisan agen berisi sebelas agen berpola \emph{agents-as-tools}: orkestrator (A0) memanggil sepuluh spesialis (A1 sampai A10) sebagai \emph{tool}"
- Pemenuhan: Definisikan A0-A10 di Agents SDK dan buktikan lewat trace bahwa A0 memanggil spesialis sebagai tool; atau revisi jumlah agen jika sebagian digabung saat build.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi (risiko): 11 agen adalah angka yang bisa diaudit; pastikan hitungan di kode persis 11 atau longgarkan redaksi

**FIT-12** (§3.3): "tiap investigasi terekam dengan \emph{tracing} penuh untuk audit"
- Pemenuhan: Aktifkan tracing Agents SDK; tunjukkan satu trace lengkap investigasi demo yang bisa diputar ulang.

**FIT-13** (§3.3): "siklus cepat memproses aliran AIS per jam"
- Pemenuhan: Scheduler per jam (cron/loop) yang menarik AIS dan memperbarui kandidat; tunjukkan dua siklus berturut di demo.

**FIT-14** (§3.4): "hasil pemeriksaan patroli menjadi masukan kalibrasi ambang (A10)"
- Pemenuhan: Implementasi A10: input hasil pemeriksaan (benar/salah sasaran) mengubah satu ambang nyata (mis. ambang biaya asosiasi) dan tercatat di log; demokan sekali.

**FIT-15** (§3.5): "Empat antarmuka melayani empat peran: Pusat Komando, dasbor analis dengan peta kandidat, status bukti, dan antrean validasi; Patroli, aplikasi lapangan penerima paket sasaran yang "
- Pemenuhan: Bangun keempat antarmuka dalam satu web app; checklist fitur per antarmuka persis seperti klausanya (peta+status+antrean; kirim-balik hasil; replay golden set; agregat tanpa identitas).

## komitmen-eksplisit (2)

**KOM-1** (§3.4): "Demonstrasi menjalankan seluruh alur, termasuk umpan balik patroli, dari \emph{seed} deterministik agar reprodusibel, dengan panggilan agen langsung ke model, bukan rekaman"
- Pemenuhan: Skrip demo dengan seed tetap untuk data/skenario; agen dipanggil live. Verifikasi status akhir stabil antar-run (status deterministik di server walau narasi LLM bervariasi).
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi (nuansa): panggilan LLM live tidak deterministik; persempit klaim ke 'reprodusibel pada tingkat data, artefak, dan status' agar bisa diuji jujur

**KOM-2** (§4 (Kesimpulan)): "di semifinal tim membangun keempat antarmuka dan alur demo"
- Pemenuhan: Ini komitmen paling eksplisit dan pasti diaudit juri: keempat antarmuka harus ada dan alur demo end-to-end harus jalan; jadikan definisi selesai (DoD) build semifinal.

## mekanisme (20)

**MEK-1** (§Abstrak): "status kandidat terkonfirmasi memerlukan minimal dua sensor independen dan pelanggaran zona"
- Pemenuhan: Unit test tabel kebenaran fungsi status server-side: (2 sensor + zona)=TERKONFIRMASI, kombinasi lain tidak.

**MEK-2** (§Abstrak): "setiap klaim harus menunjuk artefak tercatat"
- Pemenuhan: Test validator grounding: berkas dengan klaim ber-artifact_id di luar indeks ditolak otomatis.

**MEK-3** (§Abstrak): "bukti tidak memadai menghasilkan ABSTAIN"
- Pemenuhan: Test kasus bukti tunggal/berkonflik pada golden set menghasilkan status ABSTAIN, bukan tebakan.

**MEK-4** (§1): "arsitektur yang memisahkan persepsi deterministik dari penalaran agen sehingga model tidak dapat menghasilkan deteksi fiktif"
- Pemenuhan: Test adversarial: prompt agen diminta menambah deteksi baru; verifikasi tidak ada deteksi masuk Evidence Store tanpa keluaran tool T1.

**MEK-5** (§1): "PASHA Gate, yang menghitung status bukti di sisi server dari minimal dua sensor independen"
- Pemenuhan: Implementasi fungsi status di server (bukan di prompt); test bahwa field status usulan agen diabaikan oleh server.

**MEK-6** (§3): "status dihitung deterministik di server, usulan agen hanya metadata"
- Pemenuhan: Test: dua run dengan usulan agen berbeda tapi bukti sama menghasilkan status identik.

**MEK-7** (§3.2): "Detektor SAR (T1) mengikuti solusi pemenang xView3-SAR: arsitektur \emph{encoder-decoder} gaya U-Net, tulang punggung EfficientNet-B4 dan B5, pusat objek sebagai \emph{heatmap}, da"
- Pemenuhan: Jalankan kode terbuka pemenang xView3 (atau reimplementasi satu backbone) dan inferensi pada scene demo.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi: dua backbone + ensembling berat untuk semifinal; pertimbangkan melonggarkan jadi 'mengikuti arsitektur pemenang (U-Net + EfficientNet)' tanpa mengunci B4+B5+ensemble

**MEK-8** (§3.2): "alih muatan memakai definisi operasional: dua kapal dalam radius 500 meter minimal dua jam pada kecepatan di bawah dua knot, sedikitnya 10 kilometer dari tempat berlabuh"
- Pemenuhan: Implementasi aturan deterministik + unit test kasus batas (499 m vs 501 m, 1,9 vs 2,1 knot, 1h59m vs 2h01m).

**MEK-9** (§3.2): "Tiap lintasan diinterpolasi ke waktu akuisisi; kandidat pasangan dibatasi ambang kelayakan jarak, kecepatan maksimum wajar dikali selisih waktu"
- Pemenuhan: Implementasi interpolasi + gating kelayakan; test lintasan sintetis yang seharusnya lolos/gugur gate.

**MEK-10** (§3.2): "Biaya penugasan menggabungkan jarak ternormalisasi, kecocokan panjang kapal (estimasi SAR terhadap registrasi), dan konsistensi haluan; penugasannya diselesaikan algoritme Hungaria"
- Pemenuhan: Pakai scipy.optimize.linear_sum_assignment dengan matriks biaya 3 komponen; test kasus kecil dengan penugasan optimal diketahui.

**MEK-11** (§3.2): "Deteksi tanpa pasangan AIS ditandai sebagai kandidat gelap (\emph{dark candidate})"
- Pemenuhan: Test fusi: deteksi tanpa pasangan dalam gate kelayakan keluar berlabel dark_candidate.

**MEK-12** (§3.3): "Seluruh keluaran berskema JSON dengan \emph{structured outputs} ketat; keluaran gagal validasi mendapat satu kali perbaikan berdasarkan pesan galat dan dibuang bila tetap gagal"
- Pemenuhan: Semua agen pakai strict structured outputs; test jalur retry-sekali-lalu-buang dengan skema yang sengaja digagalkan.

**MEK-13** (§3.3): "indeks \emph{grounding} menolak klaim berartefak di luar daftar"
- Pemenuhan: Test negatif: berkas dengan referensi artefak fiktif ditolak gate sebelum sampai analis.

**MEK-14** (§3.3): "dua sensor independen dan pelanggaran zona menghasilkan kandidat terkonfirmasi (meniru asas dua alat bukti hukum acara); satu sensor, atau dua sensor tanpa pelanggaran zona, terind"
- Pemenuhan: Unit test tabel status lengkap (semua kombinasi sensor x zona x konflik) pada fungsi server.

**MEK-15** (§3.3): "deteksi SAR yang berimpit jeda transmisi jejak historisnya (T2) terhitung dua sensor independen"
- Pemenuhan: Implementasi uji kelayakan kinematik dari titik hilang sinyal ke posisi deteksi + test kasus layak/tak layak.

**MEK-16** (§3.3): "Usia bukti ikut dihitung: bobot artefak meluruh; kandidat tanpa penguatan lintasan berikutnya turun status"
- Pemenuhan: Implementasi fungsi peluruhan + test: kandidat terkonfirmasi tanpa artefak baru setelah N hari turun ke terindikasi.

**MEK-17** (§3.3): "Penyaring diksi menolak kata bernada putusan"
- Pemenuhan: Wordlist bahasa Indonesia (mis. 'terbukti bersalah', 'pelaku') + test berkas mengandung kata terlarang ditolak/ditandai.

**MEK-18** (§3.4): "\emph{Golden set} investigasi diputar ulang melalui \emph{trace}; tiap perubahan \emph{prompt}, ambang, atau model diuji regresi sebelum rilis"
- Pemenuhan: Susun golden set (5-10 investigasi berlabel) + skrip replay/regresi yang membandingkan status akhir terhadap ekspektasi.

**MEK-19** (§3.5): "\emph{worker} GPU mengolah citra tiap lintasan menjadi artefak di penyimpanan objek, agen berjalan pada Responses API"
- Pemenuhan: Worker inferensi (GPU lokal/Kaggle) menghasilkan artefak deteksi ke object storage; jika demo praproses batch, revisi redaksi 'tiap lintasan'.
- ⚠ REVISI/DEVIASI: perlu-revisi-redaksi (opsional): 'tiap lintasan' menyiratkan pipeline kontinu; untuk semifinal cukup worker yang berjalan on-demand pada scene demo

**MEK-20** (§3.5): "klien kompatibel-OpenAI memungkinkan migrasi \emph{on-premise} ke model berbobot terbuka"
- Pemenuhan: Demokan satu run agen dengan base_url dialihkan ke server model berbobot terbuka (mis. vLLM/Ollama) tanpa mengubah kode agen.

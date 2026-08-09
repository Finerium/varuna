# E11 — Review dokumentasi publik Skylight/Shippy (jalur fallback)

Tanggal akses semua sumber: **9 Agustus 2026** (WIB/UTC-7 sesuai lokasi akses).
Metode: review dokumentasi publik saja. Akses platform Skylight butuh registrasi
kelembagaan dengan persetujuan manual (bukan self-service), dan Shippy saat ini
dibatasi ke "a small group of trusted agencies" — maka sesuai protokol E11
(freeze-eval-v1), dipakai **fallback: perbandingan terdokumentasi dari materi
publik dengan tanggal akses, dinyatakan sebagai batasan**. Head-to-head layar
vs layar pada scene yang sama berstatus **human-gated** (butuh akun Skylight).

## A. Klaim terdokumentasi Shippy/Skylight (tiap klaim: tanggal + URL)

| # | Klaim | Batas tanggal | Sumber |
|---|-------|---------------|--------|
| S1 | Skylight = platform maritime domain awareness gratis dari Ai2 untuk pemerintah, badan perikanan regional, dan NGO yang memenuhi syarat; akses lewat form/email dengan persetujuan (bukan self-registration). | per dokumentasi publik 9 Agu 2026 | https://www.skylight.global/ ; https://support.skylight.global/access-to-skylight?kb_language=en_US |
| S2 | Shippy = agen AI di atas Skylight, menjawab pertanyaan bahasa alami atas data pelacakan kapal + satelit live; diumumkan publik ±8 Jun 2026 (tanggal terbit artikel GeekWire). | per publikasi 8 Jun 2026, diakses 9 Agu 2026 | https://www.skylight.global/news/shippy-launch ; https://www.geekwire.com/2026/ai2s-skylight-project-launches-shippy-an-ai-agent-that-dives-into-ocean-data/ |
| S3 | Jawaban bersitasi: "shows its work, citing each data source so analysts can verify"; tiap respons memuat sumber batas wilayah, data cutoff, timestamp query, dan deep link ke peta Skylight. | per dokumentasi publik 9 Agu 2026 | https://www.skylight.global/news/shippy-launch ; https://allenai.org/blog/shippy-deep-dive |
| S4 | Abstain terdokumentasi: "Where a question reaches beyond its scope, Shippy stops rather than guessing"; menolak penentuan hukum ("won't make legal determinations... that is a determination for people"); menolak permintaan militer/pertahanan. | per dokumentasi publik 9 Agu 2026 | https://www.skylight.global/news/shippy-launch ; https://allenai.org/blog/shippy-deep-dive |
| S5 | Cakupan data Skylight: AIS (~100 juta pesan/hari, ~290 ribu kapal/minggu), Sentinel-1, Sentinel-2, Landsat 8-9, VIIRS night lights; mitra komersial Maxar & Spire; data mitra GFW, TMT, SkyTruth, ProtectedSeas; "100% EEZs surveyed every month". | per dokumentasi publik 9 Agu 2026 | https://www.skylight.global/platform ; https://www.skylight.global/news/shippy-launch |
| S6 | Jenis event analitik: night lights (kapal gelap), dark rendezvous, standard rendezvous, fishing (trawl/purse seine/longline/squid jig), entry EEZ/MPA, speed range/loitering. | per dokumentasi publik 9 Agu 2026 | https://www.skylight.global/platform |
| S7 | Akses Shippy saat ini terbatas: "limited to a small group of trusted agencies" (termasuk UNODC); perluasan bertahap direncanakan. | per dokumentasi publik 9 Agu 2026 | https://www.skylight.global/news/shippy-launch ; https://www.geekwire.com/2026/ai2s-skylight-project-launches-shippy-an-ai-agent-that-dives-into-ocean-data/ |
| S8 | Arsitektur Shippy: Claude Opus 4.6 + framework agen OpenClaw; skills berbentuk markdown; tool deterministik via CLI purpose-built; isolasi per sesi (deployment Kubernetes khusus per user, file tidak dibagi antar user). | per dokumentasi publik 9 Agu 2026 | https://allenai.org/blog/shippy-deep-dive |
| S9 | Alur penindakan: alert real-time + zona pantau + API; keputusan penindakan/patroli tetap di manusia ("decisions... stay with 'the humans in the room'"). Evaluasi internal menandai Shippy PERNAH overstep ke rekomendasi taktis patroli — dan itu diperlakukan sebagai bug, bukan fitur. | per dokumentasi publik 9 Agu 2026 | https://allenai.org/blog/shippy-deep-dive ; https://www.geekwire.com/2026/ai2s-skylight-project-launches-shippy-an-ai-agent-that-dives-into-ocean-data/ |
| S10 | TIDAK terdokumentasi publik (hasil pencarian 9 Agu 2026, absence of evidence — bukan bukti absence): dukungan Bahasa Indonesia/multibahasa; keluaran selaras kerangka hukum RI (UU Perikanan/KUHAP); builder berkas perkara/chain-of-custody; siklus patroli tertutup (hasil pemeriksaan lapangan → kalibrasi sistem). | per pencarian dokumentasi publik 9 Agu 2026 | https://www.skylight.global/platform ; https://support.skylight.global/ (KB hanya en_US) ; https://allenai.org/blog/shippy-deep-dive |

## B. Tabel side-by-side — HANYA dimensi terbukti dua sisi

Sisi VARUNA = fitur yang diverifikasi **live** di https://varuna-gamma.vercel.app
(fetch 9 Agu 2026) atau **ada sebagai kode di repo** (path dicantumkan). Tidak ada
klaim fitur yang belum jadi. Tabel ini deskriptif, bukan klaim keunggulan.

| Dimensi | Shippy/Skylight (dok publik, 9 Agu 2026) | VARUNA (live/repo, 9 Agu 2026) |
|---|---|---|
| Data satelit + AIS | Sentinel-1/-2, Landsat 8-9, VIIRS, AIS, komersial Maxar/Spire (S5) | Sentinel-1 SAR (CDSE; chip SAR VH tampil di landing live) + AIS + sumber `gfw-events`, `xview3-public` (field `sumber` di `/api/public/aggregate`, live) |
| Deteksi kapal gelap | Query dark vessel detections + event night lights/dark rendezvous (S5,S6) | Fusi deteksi SAR + trajektori AIS jadi satu bundel bukti (landing live; `apps/web/app/api/artifacts/[art_id]/route.ts`) |
| Verifikasi/keterlacakan jawaban | Sitasi per sumber + deep link peta + data cutoff + timestamp (S3) | Provenance per artefak via `/api/artifacts/<art_id>` (live, endpoint disebut di landing); status dihitung server, bukan model (landing live) |
| Perilaku abstain | "stops rather than guessing" + caveat data (S4) | Status `abstain` adalah keluaran kelas satu: `/api/public/aggregate` live menampilkan `counts.abstain = {"ZEE-ID": 1}` (fetch 9 Agu 2026 14:54 UTC) |
| Model akses | Registrasi kelembagaan + persetujuan; Shippy terbatas trusted agencies (S1,S7) | Portal publik agregat per zona tanpa login (live); permukaan analis/patroli/komando via `enter/[role]` (repo: `apps/web/app/enter/[role]/route.ts`) |
| Alur patroli | Alert + zona pantau; keputusan patroli di manusia; rekomendasi taktis di luar scope (S9) | API paket target + hasil verifikasi patroli di repo (`apps/web/app/api/patrol/packages/route.ts`, `.../patrol/results/route.ts`) + endpoint kalibrasi (`.../api/calibration/route.ts`) |
| Posisi thd penentuan hukum | Menolak membuat penentuan hukum sama sekali (S4) | Tidak memutus perkara; menyusun bundel bukti mengikuti struktur hukum acara RI (teks landing live) — keputusan tetap di penyidik |

Dimensi yang TIDAK dimasukkan tabel karena hanya terbukti satu sisi (lihat S10):
bahasa antarmuka, kerangka hukum RI, siklus patroli tertutup, replay agen.
(Sisi Shippy tidak terdokumentasi; mengklaim ketiadaannya sebagai kekalahan
Shippy tidak fair — dicatat sebagai asimetri dokumentasi saja.)

## C. Head-to-head scene yang sama — status HUMAN-GATED

Protokol E11 meminta tangkapan layar keluaran Skylight vs berkas VARUNA pada
tanggal+area sama, tabel 3 kolom (pertanyaan terjawab, artefak tertaut, kesiapan
penyidik). Ini butuh akun Skylight (persetujuan manual; Shippy terbatas trusted
agencies). **Bahan sudah disiapkan**: daftar klaim A + tabel B + scene kandidat.
Tindakan manusia: ajukan akses via https://support.skylight.global/access-to-skylight
atau email support@skylight.global; bila ditolak/terlambat, bagian ini tetap
dalam mode fallback dan batasannya dinyatakan di paper.

## D. Cross-check GFW — status HUMAN-GATED (token)

- Scene: `S1C_IW_GRDH_1SDV_20260805T171634_20260805T171659_008863_01194A`
  (German Bight/pantai barat Denmark), ContentDate 2026-08-05T17:16:34Z,
  bbox kerja [4.798, 53.241, 9.278, 55.161] (footprint di
  `manifests/cdse-katalog-denmark.json`).
- Dataset GFW: `public-global-sar-presence:latest` (deteksi kapal SAR Sentinel-1,
  cakupan 2017 s.d. ±5 hari lalu) — per dokumentasi
  https://globalfishingwatch.org/our-apis/documentation diakses 9 Agu 2026.
- Verifikasi akses 9 Agu 2026: endpoint API tanpa token menjawab
  `{"error":"invalid token"}` → API publik GFW **butuh token** (registrasi gratis
  https://globalfishingwatch.org/our-apis/tokens). Token tidak dibaca oleh agen ini.
- Skrip siap: `experiments/e11/gfw_crosscheck.py` (baca env `GFW_TOKEN`;
  agreement rate radius 200 m dua arah + deteksi unik per pihak; tanpa klaim
  siapa benar, sesuai protokol; selftest haversine lulus 9 Agu 2026).
- Catatan latensi: scene 2026-08-05 = 4 hari sebelum hari akses; dokumentasi GFW
  menyebut cakupan "sampai ±5 hari lalu" → ketersediaan tanggal ini borderline;
  skrip melaporkan hasil kosong apa adanya bila belum tersedia.
- Angka hasil HANYA akan ditulis ke manifest baru oleh jalur EVAL setelah run
  ber-token; tidak ada angka agreement yang diklaim di dokumen ini.

## E. Batasan

1. Semua klaim Shippy bersumber dari materi vendor/press (Ai2, Skylight, GeekWire),
   bukan uji hands-on — dinyatakan sebagai batasan sesuai protokol E11.
2. Snapshot dokumentasi bertanggal 9 Agu 2026; dokumentasi vendor bisa berubah.
3. "Tidak terdokumentasi" (S10) ≠ "tidak ada"; hanya pernyataan tentang
   dokumentasi publik pada tanggal akses.
4. Perbandingan layar-vs-layar scene sama dan angka agreement GFW: human-gated
   (akun Skylight; token GFW).

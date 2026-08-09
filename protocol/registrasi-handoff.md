# Handoff registrasi 3 akun (bagian manusia, ±15 menit total)

Password per layanan sudah digenerate di `secrets/semifinal-accounts.md` (buka sendiri; jangan paste ke chat).
Email semua akun: ghaisan.khoirul.b@gmail.com

## 1. CDSE / Copernicus (untuk scene Sentinel-1 Natuna) — PRIORITAS TERTINGGI
1. Buka: https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/registrations?client_id=cdse-public&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fdataspace.copernicus.eu
2. Isi: First name `Ghaisan`, Last name `Badruzaman`, Email, Password (dari secrets), Country `Indonesia`; field sektor/domain pilih `Education/Research` bila ada; centang terms; Register.
3. Cek inbox Gmail -> klik link verifikasi.
4. Setelah aktif, jalankan di sesi ini (ketik persis, dengan tanda seru di depan):
   `! bash ~/Documents/Datathon/varuna/scripts/cdse-login.sh`
   (skrip minta password secara tersembunyi, menukar jadi refresh token di `secrets/cdse-refresh-token`; gw selanjutnya hanya pakai token)

## 2. xView3 (untuk split public 150 scene berlabel)
1. Buka: https://iuu.xview.us/ -> tombol "Register/Login to Download Data"
2. Registrasi dengan email + password (dari secrets); afiliasi: `Politeknik Negeri Bandung` / student research.
3. Verifikasi email bila diminta. CATATAN: approval bisa tidak instan; kalau ada layar "pending approval", laporkan ke gw — fallback SARFish sudah disiapkan.
4. Setelah bisa login: buka halaman Downloads, JANGAN unduh apa pun dulu — beri tahu gw "xview3 sudah bisa login", gw yang tentukan file mana (subsampel pra-deklarasi).

## 3. Global Fishing Watch (untuk AIS events + deteksi SAR publik)
1. Buka: https://gateway.api.globalfishingwatch.org/auth (atau menu "Access tokens" dari https://globalfishingwatch.org/our-apis/)
2. Registrasi akun gratis (email + password dari secrets), tujuan: academic research, non-commercial.
3. Di dashboard API, buat token baru (nama: `varuna-semifinal`), copy token, simpan ke file:
   `~/Documents/Datathon/secrets/gfw-token` (satu baris, tanpa spasi). Bilang "gfw token ready" — gw ambil dari file itu, tidak perlu paste ke chat.

Setelah tiga-tiganya: bilang "akun beres" — gw langsung lanjut unduhan CDSE Natuna + subsampel xView3 + tarik events GFW.

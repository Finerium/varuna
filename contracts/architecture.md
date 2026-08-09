# Arsitektur Implementasi VARUNA (dalam batas blueprint 8.5; direview lalu BEKU)

## Dekomposisi monorepo (ADR-1 dihormati: satu repo publik Finerium/varuna)

```
varuna/
  apps/web/            # Next.js (App Router, TypeScript) = SATU aplikasi web
    app/(surfaces)/komando|patroli|konsol|portal/     # 4 antarmuka
    app/enter/[role]/  # entry multi-persona (5th surface = halaman root "/")
    app/api/...        # route handlers sesuai contracts.md Bagian 3
  packages/core/       # TS murni: zod schemas (kontrak), pasha.ts (computeStatus),
                       # grounding.ts, diksi.ts, store.ts (reader golden + Blob writer)
  packages/agents/     # @openai/agents (TS) A0-A10; executor replay per-langkah
  packages/core/golden/ # artefak golden set (JSON + chip web-optimized) = data plane statis
  experiments/ protocol/ manifests/ scripts/ video/     # as-built, tidak direstrukturisasi
  contracts/           # dokumen ini + contracts.md (beku)
```
Rasional TS tunggal: satu runtime untuk Vercel (route handlers + agen), @openai/agents
SDK TS resmi tersedia, zod = satu sumber skema untuk validasi server dan structured
outputs; eksperimen python tetap di experiments/ tanpa disentuh.

## Topologi deploy
- Satu proyek Vercel `varuna` -> URL produksi; auto-deploy dari main via koneksi git.
- Runtime data: golden set = artefak statis dalam repo (kecil, web-optimized);
  tulisan runtime (hasil pemeriksaan patroli, aksi validasi, kalibrasi) -> Vercel Blob
  (tersedia di plan hobby tanpa biaya baru); dev lokal pakai filesystem adapter.
- Batas 300 dtk dipenuhi by design dengan MEMPERTAHANKAN agents-as-tools: A0 memanggil
  A1-A10 sebagai tool; executor mem-pause run A0 di tiap tool-call, mempersist state
  percakapan ke Blob (state_ref), invokasi berikutnya melanjutkan; resume_token
  {inv_id, step_idx, state_ref, seed, ttl 900s}. Kasus terpanjang diuji di produksi
  (VAR-LIVE-02).
- Env: OPENAI_API_KEY, OPENAI_BASE_URL (default api.openai.com; satu variabel = jalur
  migrasi on-premise klien kompatibel-OpenAI, janji paper), MMSI_HASH_SALT, HF_TOKEN;
  dipropagasi via `vercel env`, tidak pernah masuk repo.

## Pola kunci
- computeStatus = fungsi murni packages/core; endpoint, builder golden set, DAN harness
  evaluasi memakainya lewat CLI node `packages/core/bin/gate.ts` (satu subprocess dari
  python eksperimen) sehingga angka evaluasi mendeskripsikan persis gerbang yang dikirim;
  frontend HANYA membaca status_server (VAR-SRF-03 by construction).
- Grounding resolver = union(indeks statis golden, indeks runtime Blob append-only);
  penolakan level envelope: art_id tak-resolvable pada keluaran agen mana pun = discarded
  (VAR-HON-01 by construction, termasuk artefak patrol_report runtime).
- SSE replay memancarkan tiap event dari panggilan Responses API LIVE; tidak ada respons
  kalengan; kegagalan API tampil sebagai keadaan jujur dengan tombol ulang (V13).
- Paginasi semua endpoint daftar; limit default 20, maks 50 (VAR-SRF-09).
- Phone frame Patroli: route patroli dirender dalam frame di desktop (komponen frame di
  Entry/desktop), penuh di mobile; interaksi identik.

## Testing dan CI
- vitest: unit PASHA (tabel kebenaran dari contracts.md 4), diksi filter, grounding reject.
- Kontrak: zod parse fixture dua arah per skema contracts.md.
- Playwright: E2E alur M1 (antrean -> berkas -> artefak -> replay -> patroli -> kalibrasi);
  smoke produksi per milestone (VAR-LIVE-01).
- GitHub Actions: install, typecheck, lint, unit+kontrak, build; Playwright job terpisah.
- TDD dipakai pada pembawa kontrak: pasha.ts, diksi.ts, grounding.ts (tes ditulis dari
  contracts.md SEBELUM implementasi, oleh penulis tes terpisah dari penulis kode).

## Gerak & visual (mengikat dari blueprint 7; detil implementasi)
- Stack gerak: GSAP + ScrollTrigger (Entry/Portal), Lenis momentum, Motion untuk komponen
  React; TANPA Three.js (tidak ada alasan kuat). Hanya transform+opacity; reduced-motion
  path statis bermartabat.
- Tipografi TERKUNCI (keputusan foundation): display "Space Grotesk", body
  "Instrument Sans" (keduanya variable, open, karakter teknis; bukan default terlarang).
- Token warna TERKUNCI: ink berlapis #0B141B / #0F1B25 / #13222E; glass
  rgba(202,220,228,0.08) rim rgba(220,240,245,0.22); amber penuh #F0A63C; amber redup #9A7B3F (non-teks) dengan varian teks
  --amber-redup-teks #C79B54 (>=4.5:1 di atas komposit panel); slate ABSTAIN #8A97A3; teks near-tone #E6ECEF di gelap, #10181E di terang; teks redup #A8B4BC;
  kontras diuji terprogram di gate (VAR-A11Y-01).
```

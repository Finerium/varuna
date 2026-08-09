# VARUNA

Sistem investigasi kapal gelap (*dark vessels*) berbasis multi-sensor untuk perairan
yurisdiksi Indonesia. VARUNA menggabungkan deteksi SAR (Sentinel-1) dengan lintasan
AIS, lalu menyusun berkas investigasi yang setiap klaimnya terikat pada artefak bukti
yang dapat ditelusuri. Status akhir sebuah investigasi — `terkonfirmasi`,
`terindikasi`, atau `ABSTAIN` — dihitung sepenuhnya di server oleh mesin status PASHA;
antarmuka tidak pernah menghitung status sendiri. Ketika bukti bertentangan atau
cakupan sensor tidak memadai, sistem memilih ABSTAIN dan mengatakannya apa adanya.

**Produksi:** https://varuna-gamma.vercel.app

## Arsitektur ringkas

Satu aplikasi web dari sudut pandang pengguna; satu monorepo TypeScript.

```
varuna/
  apps/web/            # Next.js (App Router) — satu aplikasi, lima permukaan:
    app/(surfaces)/    #   komando | patroli | konsol | portal
    app/enter/[role]/  #   entry multi-persona (root "/")
    app/api/           #   route handlers sesuai contracts/contracts.md
  packages/core/       # TS murni: skema zod, pasha.ts (computeStatus),
                       #   grounding.ts, diksi.ts, store.ts
  packages/core/golden/# golden set: investigasi + artefak + chip SAR web-optimized
  contracts/           # kontrak field & arsitektur (BEKU)
  protocol/            # protokol evaluasi (BEKU, lihat bawah)
  experiments/         # eksperimen E1..E5 (python), tidak disentuh aplikasi
  manifests/           # manifes bukti & hasil eksperimen (append-only)
  scripts/             # akuisisi & preparasi data (CDSE, DMA, GFW, xView3)
```

Prinsip yang mengikat implementasi:

- **Status hanya server-side.** `computeStatus` adalah fungsi murni di
  `packages/core`; endpoint, builder golden set, dan harness evaluasi memakai fungsi
  yang sama, sehingga angka evaluasi mendeskripsikan persis gerbang yang dikirim.
- **Grounding wajib.** Setiap `art_id` pada keluaran agen harus resolvable di indeks
  bukti; yang tidak resolvable dibuang dan tercatat di trace.
- **Replay deterministik.** Golden set + trace dibangun dengan seed 20260809; replay
  memutar ulang artefak dengan panggilan agen live, satu langkah per invokasi.
- **Identitas dilindungi.** MMSI hanya hidup sebagai HMAC-SHA256 pseudonim; salt di
  environment, tidak pernah di repo.

## Menjalankan lokal

Prasyarat: Node.js >= 22 dan pnpm (repo ini memakai pnpm workspaces; aktifkan lewat
`corepack enable` bila belum ada).

```bash
pnpm install                      # dependensi seluruh workspace
pnpm test                         # vitest packages/core + cek mandiri apps/web
pnpm typecheck && pnpm lint       # tsc --noEmit + eslint per workspace
pnpm --filter @varuna/web dev     # dev server di http://localhost:3000
```

Permukaan baca dan golden set berjalan tanpa secret apa pun. Fitur replay agen live
membutuhkan variabel environment (`OPENAI_API_KEY`, dst.) yang dipropagasi via
`vercel env` — tidak ada secret di dalam repo.

## Struktur direktori

| Direktori | Isi |
|---|---|
| `apps/web/` | Aplikasi Next.js: lima permukaan + API |
| `packages/core/` | Kontrak runtime: skema, PASHA, grounding, penyaring diksi |
| `packages/core/golden/` | Golden set demo (JSON + chip PNG web-optimized) |
| `contracts/` | `contracts.md` (kontrak field, BEKU) + `architecture.md` |
| `protocol/` | Protokol evaluasi beku + janji audit |
| `experiments/` | E1 (deteksi SAR), E2, E3, E5 (evaluasi sistem) |
| `manifests/` | Manifes hasil; satu-satunya sumber angka yang boleh dikutip |
| `scripts/` | Skrip akuisisi data (python) |
| `video/` | Naskah video demo |

## Protokol evaluasi (beku)

Protokol evaluasi dibekukan sebelum implementasi pada tag `freeze-eval-v1`
(commit `0bc9af9`) di `protocol/eval-protocol.md`. Semua angka hasil datang dari
jalur evaluasi tersebut dan dicatat di `manifests/`; README ini sengaja tidak
mengklaim angka apa pun di luar itu. Perubahan protokol hanya melalui bagian
Amandemen yang tercatat.

## Tangkapan layar

*Segera menyusul — tangkapan layar kelima permukaan (Komando, Patroli, Konsol,
Portal, Entry) akan ditambahkan di sini.*

## Lisensi & atribusi

Sistem ini berdiri di atas data dan kode terbuka berikut:

- **xView3 first place solution** — Eugene Khvedchenya (BloodAxe),
  [DIUx-xView/xView3_first_place](https://github.com/DIUx-xView/xView3_first_place)
  — MIT License. Kode inferensi + bobot juara dipakai apa adanya pada E1.
- **xView3-SAR labels** — lisensi CC BY-NC-SA; label tidak didistribusikan dalam
  repo ini, unduh dari [iuu.xview.us](https://iuu.xview.us/).
- **Copernicus Sentinel-1** — citra SAR via Copernicus Data Space Ecosystem;
  mengandung data Copernicus Sentinel termodifikasi.
- **Danish Maritime Authority (DMA)** — data AIS terbuka
  ([aisdk](https://web.ais.dk/aisdata/)) untuk kasus asosiasi Denmark.
- **Global Fishing Watch** — data event publik ([globalfishingwatch.org](https://globalfishingwatch.org/)),
  CC BY-NC.
- **Marine Regions** — geometri ZEE ([marineregions.org](https://marineregions.org/)).

Data mentah (GeoTIFF, AIS mentah) tidak pernah masuk repo; yang terdistribusi hanya
artefak turunan web-optimized. Identitas kapal hanya hadir sebagai pseudonim.

---

Dibangun oleh **Finerium** untuk Datathon 2026.

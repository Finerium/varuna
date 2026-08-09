# Kontrak Level Field VARUNA (v2, BEKU)

Spesifikasi teknis level field untuk Evidence Store, agen, API, dan format status.
Sumber kebenaran: paper semifinal bab 3, protokol evaluasi (freeze-eval-v1 @0bc9af9),
blueprint Bagian 9. Seed global 20260809. Perubahan terhadap dokumen ini setelah
tanggal beku memicu verifikasi ulang menyeluruh dan tercatat.

## 0. Disambiguasi himpunan data (keputusan v2)

- SET EVALUASI E5 (protokol beku): N>=60 investigasi, split kalibrasi-15/pelaporan-45,
  >=3 kasus sintetis berlabel; hidup di `experiments/e5/`; angka paper datang dari sini.
- SET DEMO PRODUK (`packages/core/golden/`): kurasi komposisi minimum demo (going-dark,
  dua-sensor lain, terindikasi, ABSTAIN, peluruhan, kasus Denmark, alur patroli penuh),
  subset kasus pelaporan + kasus demo; tiap kasus berlabel `split` dan `sintetis`.
  Sapuan mock mengecualikan artefak `sintetis:true` yang berlabel; sintetis tanpa label = defect.

## 1. Evidence Store dan indeks grounding

```
golden/
  investigations/<inv_id>/investigation.json
  investigations/<inv_id>/artifacts/<art_id>.json
  investigations/<inv_id>/chips/<art_id>.png        # web-optimized <=300KB
  investigations/<inv_id>/trace/replay-<n>.jsonl
  investigations/<inv_id>/grounding.json            # indeks per-investigasi
  index/manifest.json                                # daftar inv ringan {inv_id, split, kasus}
```
Indeks runtime (tulisan saat produksi): Blob `runtime/<inv_id>/grounding.json`,
append-only, aturan hash sama. RESOLVER GROUNDING = union(indeks statis, indeks runtime).

`Artifact`:
```json
{ "art_id": "a-<inv>-<seq>", "inv_id": "inv-<...>",
  "type": "sar_detection|ais_track_segment|ais_gap|ais_anomaly|zone_rule|behavior_class|assoc_result|kinematic_feasibility|weather|patrol_report",
  "source": { "dataset": "xview3-public|cdse-natuna|cdse-denmark|dma-aisdk|gfw-events|marineregions-eez|open-meteo|runtime",
              "ref": "<scene_id|mmsi_hash|event_id|package_id>", "provenance": "<kalimat>" },
  "sintetis": false,
  "payload": { }, "created_at": "ISO8601", "observed_at": "ISO8601|null",
  "hash_sha256": "<hex>" }
Semantik waktu: `observed_at` = waktu kejadian dunia nyata artefak (akuisisi scene, akhir
segmen AIS); `created_at` = waktu tulis. Usia bukti dihitung dari observed_at (fallback
created_at bila null). [Amandemen kontrak K-A1, 9 Agu: field opsional aditif; ronde
verifikasi wave-1 menemukan divergensi semantik usia; matriks diverifikasi ulang.]
```
`payload` per type:
- sar_detection: {lat, lon, row, col, length_m_est, objectness_p, vessel_p, fishing_p, confidence_calibrated, scene_id}
- ais_track_segment: {mmsi_hash, points:[{t,lat,lon,sog,cog}], start, end}
- ais_gap: {mmsi_hash, t_start, t_end, durasi_jam, sog_sebelum}
- ais_anomaly: {jenis:"gap|spoofing|ganti_identitas", skor, model_ref, detail}
- zone_rule: {zona:"ZEE-ID|WPP-711-proxy", posisi:"inside|outside", violation: false, basis_aturan:"<id aturan T4>", geometri_ref}
- behavior_class: {kelas:"fishing|transit", skor, model_ref}
- assoc_result: {det_art_id, track_art_id|null, cost, metode:"hungarian", dark: false}
- kinematic_feasibility: {gap_art_id, det_art_id, jarak_km, dt_jam, sog_implied, ambang_kn, lolos: false}
- weather: {t, lat, lon, wave_m, wind_ms, sumber:"open-meteo"}   # konteks; BUKAN modalitas sensor
- patrol_report: {package_id, finding, note, submitted_at}
Identitas: `mmsi_hash` = HMAC-SHA256(salt server, mmsi) 16-hex; pseudonim (bukan anonim),
identitas mentah tidak pernah keluar server; salt di env, tidak pernah di repo.
Modalitas sensor yang dihitung independen: HANYA {SAR, AIS}; behavior/weather/patrol = konteks.

`Investigation`:
```json
{ "inv_id": "inv-<aoi>-<t>-<seq>", "seed": 20260809,
  "aoi": "natuna|denmark|xview3-<scene>", "zona": "ZEE-ID|WPP-711-proxy|null",
  "t_acquisition": "ISO8601", "t_observasi_terakhir": "ISO8601",
  "split": "kalibrasi|pelaporan|demo", "sintetis": false,
  "kasus": { "label": "going-dark|spoofing|alih-muatan|abstain|peluruhan|asosiasi-denmark|patroli", "peran_demo": "<kalimat>" },
  "candidate": { "lat":0, "lon":0, "length_m_est":0, "confidence_calibrated":0 },
  "artifacts": ["art_id"],
  "status_server": {
     "status": "terkonfirmasi|terindikasi|abstain",
     "computed_at": "ISO8601", "hash": "<sha256 canonical-json status_server tanpa field hash>",
     "sensors_independent": 0, "zone_violation": false,
     "evidence_age_h": 0, "decay_applied": false,
     "conflicting_art_ids": [], "missing_coverage": [],
     "reasons": [ { "rule": "dua_sensor|zona|kinematik_gap|usia|konflik|cakupan", "passed": true, "art_ids": [] } ],
     "abstain_reason": null,
     "display_state": [] },
  "agent_proposal": { "status_usulan": "...", "trace_ref": "trace/replay-1.jsonl" },
  "berkas": { "sections": [ { "claim": "<kalimat>", "art_ids": [] } ], "diksi_ok": true },
  "patrol": { "package_id": null, "result": null } }
```
`display_state[]` (turunan server): subset {"degraded","kosong","error","kedaluwarsa"}.
`abstain_reason` enum + template kalimat (Indonesia):
- bukti_tunggal: "Bukti berasal dari satu sumber saja; sistem menunggu lintasan berikutnya."
- konflik_artefak: "Dua artefak saling bertentangan pada jendela waktu yang sama; lihat daftar konflik."
- kurang_cakupan: "Tidak ada akuisisi pada rentang waktu yang dipersoalkan; berkas bertumpu pada sensor yang merekam."
- kedaluwarsa_tanpa_penguatan: "Bukti melewati ambang usia tanpa penguatan lintasan berikutnya; status diturunkan."
ATURAN GROUNDING (level envelope): SETIAP art_id pada keluaran agen mana pun wajib
resolvable di resolver grounding; pelanggaran = keluaran `discarded` + tercatat trace;
klaim berkas dengan art_id tak-resolvable menolak seluruh berkas dari tampilan.

## 2. Kontrak I/O agen A0-A10

Model eksekusi (keputusan v2, mempertahankan agents-as-tools paper): A0 adalah agen
yang memanggil A1-A10 sebagai tool DI DALAM gilirannya; executor mem-pause run A0 pada
tiap tool-call, mempersist state percakapan ke Blob, dan melanjutkan pada invokasi
berikutnya. Satu invokasi HTTP = maksimum satu langkah tool.

Envelope (structured outputs ketat; gagal validasi -> tepat 1 perbaikan -> dibuang):
```json
{ "agent": "A0..A10", "inv_id": "...", "output": { }, "artifacts_cited": ["art_id"],
  "status": "ok|retry_fixed|discarded" }
```
`output` per agen (pola artefak-saja untuk hasil perseptual):
- A0: {ringkasan_ref}                       # urutan tool tampak di trace, bukan plan tekstual
- A1: {scenes:[{scene_id, t_acq, sumber}]}
- A2: {detection_art_ids:[]}                # memilih artefak T1; tidak mencipta
- A3: {anomaly_art_ids:[]}
- A4: {assoc_art_ids:[], dark_art_ids:[]}
- A5: {behavior_art_id}
- A6: {supporting_art_ids:[], conflicting_art_ids:[]}
- A7: {sections:[{claim, art_ids}]}
- A8: {verdict:"lolos|revisi", violations:[{idx, alasan}]}
- A9: {usulan_paket: TargetPackageDraft}    # server yang mencetak paket (lihat 3)
- A10: {updates:[{param, lama, baru, basis_art_ids}]}

## 3. API backend-frontend (semua daftar berpaginasi; limit<=50 default 20)

Rute halaman: `/` = Entry multi-persona; `/enter/{analis|patroli|publik}` set cookie
role (demo prefilled) lalu redirect; Konsol Skenario = role analis.

- `GET  /api/queue?status&zona&cursor&limit` -> {items:[InvestigationSummary], next_cursor}
  InvestigationSummary: {inv_id, status, sensors_independent, zona, evidence_age_h,
  t_acquisition, t_observasi_terakhir, aoi, kasus_label, display_state}
- `GET  /api/investigations/{inv_id}` -> Investigation (artifacts = 20 pertama + next_cursor)
- `GET  /api/investigations/{inv_id}/artifacts?cursor&limit` -> {items:[Artifact], next_cursor}
- `GET  /api/artifacts/{art_id}` ; `GET /api/artifacts/{art_id}/chip`
- `POST /api/validate` {inv_id, action:"terima|minta_penguatan|arsip"} -> {recorded_at, package_id|null}
  [analis] action "terima" pada status terkonfirmasi/terindikasi MENCETAK TargetPackage
  dari usulan A9 (server pemilik issued_at/expires_at).
- `POST /api/replay/{inv_id}` (mulai) dan `POST /api/replay/{inv_id}/step` {resume_token}
  -> SSE `agent_step`: {agent, phase:"start|output|retry|discarded|done", output_ref,
     trace_ref, diff:{status_sama:bool, artefak_sama:bool}|null, pasha: StatusServer|null}
  resume_token = {inv_id, step_idx, state_ref:"blob://...", seed:20260809, ttl_s:900};
  satu invokasi = satu langkah agen (VAR-LIVE-02 by design).
- `GET  /api/patrol/packages?cursor` [patroli] -> {items:[TargetPackage], next_cursor}
- `POST /api/patrol/results` {package_id, finding, note<=500, submitted_at} -> {recorded_at, calibration_ref}
  Ingress teks bebas SATU-SATUNYA: note melewati penyaring diksi + penolak pola identitas
  (regex MMSI 9-digit, callsign, awalan nama kapal) SEBELUM ditulis.
- `GET  /api/calibration?cursor` [analis] -> {items:[{param, lama, baru, basis_art_ids, sumber_package_id, at}], next_cursor}
- `GET  /api/public/aggregate?period` -> {periode, counts:{status x zona}, updated_at, sumber:[]}
  (nol field identitas level skema)
- `GET  /api/meta/stability` -> {k_replay, agreement_status, agreement_artifacts, catatan}
Role-write matrix (teruji): validate=analis; patrol/results=patroli; lainnya read-all-roles.

## 4. Status PASHA (fungsi murni server)

`computeStatus(artifacts, now, thresholds) -> StatusServer`; `thresholds` DI-SEED dari
`experiments/e5/thresholds.lock.json` (pin commit protokol) dan hanya bergeser lewat
delta A10 yang beraudit (`/api/calibration`), di luar jalur pelaporan angka paper.
- sensors_independent: modalitas unik {SAR, AIS}; going-dark = sar_detection + ais_gap
  historis + kinematic_feasibility.lolos = 2 sensor (rule "kinematik_gap").
- zone_violation = OR(zone_rule.violation).
- Konflik deterministik (rule "konflik"): dua artefak yang saling eksklusif pada jendela
  waktu sama (posisi tak-terdamaikan secara kinematik, atau kelas kontradiktif untuk
  objek sama) -> conflicting_art_ids terisi.
- Cakupan (rule "cakupan"): tidak ada artefak modalitas pada jendela dipersoalkan ->
  missing_coverage berisi modalitas hilang.
- Klasifikasi: terkonfirmasi = sensors>=2 AND zone_violation; abstain = konflik ATAU
  kurang-cakupan ATAU hasil peluruhan dari terindikasi (kedaluwarsa_tanpa_penguatan);
  selain itu terindikasi. Peluruhan: evidence_age_h > ambang -> turun satu tingkat,
  decay_applied, reason "usia".
- `hash` = sha256 canonical JSON (kunci terurut, tanpa field hash) — dipakai bukti
  determinisme lapisan server lintas replay.
Nilai wire lowercase ("abstain"); token TAMPIL selalu "ABSTAIN" (kosakata beku).

## 5. TargetPackage dan PatrolResult

```json
TargetPackageDraft (A9): { "area": { "center":{"lat","lon"}, "radius_km", "heading_sector_deg":[a,b]|null,
  "zona_clip":"ZEE-ID|WPP-711-proxy" }, "berkas_ringkas_ref":"..." }
TargetPackage (server): draft + { "package_id":"pkg-<inv>", "inv_id", "status_tingkat",
  "label":"area pencarian, bukan posisi pasti", "issued_at", "expires_at" }
PatrolResult: { "package_id", "finding":"sesuai|berbeda|tidak_ditemukan|tidak_terjangkau",
  "note":"<=500 (tersaring)", "submitted_at":"ISO", "by_role":"patroli" }
```

## 6. Format entri manifest bukti build (beku)

```json
{ "id": "VAR-XXX-NN", "tier": "SHIP|TAG|POLISH",
  "check": "perintah persis atau id tes atau prosedur fleet",
  "expected": "hasil yang membuat kriteria lulus, spesifik",
  "artifact": "path artefak bukti relatif working root",
  "instrument_validation": "n/a | path bukti validasi instrumen (wajib untuk kriteria numerik)",
  "justification": "hanya untuk bukti mahal, satu baris" }
```

## 7. Kosakata beku

Status: "terkonfirmasi", "terindikasi", "ABSTAIN" (tampil). Keadaan tampilan: "degraded",
"kosong", "error", "kedaluwarsa". Amber = satu-satunya warna sinyal; ABSTAIN = slate.
Penyaring diksi (`packages/core/src/diksi.ts`): menolak bersalah, terbukti, vonis,
pidana, pidanakan, pelaku, kriminal, hukuman, dakwaan, terdakwa, tersangka pada keluaran
tampil; teruji unit.

## 8. Keadaan wajib per surface (matriks; kehadiran = kriteria SHIP)

| Keadaan | Komando | Patroli | Konsol | Portal | Entry |
|---|---|---|---|---|---|
| ABSTAIN + alasan + artefak konflik/kurang | wajib (2 klik dari antrean) | pada berkas ringkas | dirayakan sebagai kasus | agregat menghitungnya | n/a |
| kosong (tanpa lintasan/paket/periode) | "tidak ada lintasan pada rentang ini" | "belum ada penugasan" | pemilih kosong jujur | "periode tanpa data" | n/a |
| degraded-AIS (celah cakupan tampil sebagai celah) | pada lintasan berlubang | pada berkas | pada artefak lintasan | n/a | n/a |
| error agen (retry 1x -> dibuang, tampil) | n/a | n/a | simpul "dibuang" + ulang | n/a | n/a |
| kedaluwarsa/peluruhan (indikator turun status) | indikator antrean | paket kedaluwarsa | kasus peluruhan | n/a | n/a |
| loading jujur (skeleton, tanpa angka palsu) | wajib | wajib | wajib | wajib | wajib |
| kiriman tertunda (antrian offline sederhana) | n/a | wajib, status jujur | n/a | n/a | n/a |
| tautan hidup tanpa dead-end | n/a | n/a | n/a | n/a | wajib (5 tautan) |

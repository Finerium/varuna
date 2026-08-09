#!/usr/bin/env python
"""Bangun artefak golden inv-dk-01 (jalur asosiasi Denmark, Amandemen A1) dari data NYATA.

Kontrak: contracts/contracts.md Bagian 1 (field persis, tanpa tambahan).
Sumber:
  lintasan  - data/raw/dma/aisdk-2026-08-05.zip (CSV mentah; dipakai karena parquet olahan
              tidak menyimpan COG, sedangkan payload ais_track_segment mewajibkannya)
              disaring ke 8 MMSI terpilih, jendela 2026-08-05 15:00-19:00 UTC
  seleksi   - data/processed/dma/trajectories.parquet (uji lintas-footprint, 9,55 jt baris)
  celah     - data/processed/dma/gap_candidates.csv (129 celah >6 jam)
  footprint - data/raw/denmark/S1C_*.zip -> SAFE/preview/map-overlay.kml (gx:LatLonQuad)
              waktu akuisisi dari manifest.safe startTime

Deteksi SAR scene Denmark BELUM diinferensi: sisi target pada uji kinematik adalah
placeholder BERLABEL sintetis:true; artefak lintasan dan celah tetap sintetis:false.

hash_sha256 artefak = sha256(canonical JSON kunci-terurut, tanpa field hash_sha256),
konvensi sama dengan scripts/golden_zona_perilaku_anomali.py dan status_server.hash Bagian 4.

Jalankan: .venv/bin/python scripts/golden_denmark_asosiasi.py
Verifikasi: .venv/bin/python packages/core/golden/verifikasi_golden.py
"""
import hashlib
import hmac
import json
import math
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "packages/core/golden"
CACHE = Path("/private/tmp/claude-501/-Users-ghaisan-Documents-Datathon/"
             "8aa7dc64-e926-4305-b5b6-5e4a3f3b577a/scratchpad")
SEED = 20260809
SALT = "varuna-dev-salt-2026"  # dev; produksi via env
INV = "inv-dk-01"
ART_DIR = GOLDEN / "investigations" / INV / "artifacts"

SCENE = "S1C_IW_GRDH_1SDV_20260805T171634_20260805T171659_008863_01194A_E663"
T_ACQ = pd.Timestamp("2026-08-05 17:16:34.886564")   # manifest.safe startTime, UTC
T_ACQ_ISO = "2026-08-05T17:16:34.886564Z"
QUAD = [(4.834043, 54.743980), (8.876246, 55.161621),
        (9.268373, 53.667686), (5.368205, 53.253666)]  # (lon,lat) gx:LatLonQuad
FOOT = ("footprint gx:LatLonQuad preview/map-overlay.kml "
        "(4.834043,54.743980)-(8.876246,55.161621)-(9.268373,53.667686)-(5.368205,53.253666)")
W0, W1 = pd.Timestamp("2026-08-05 15:00:00"), pd.Timestamp("2026-08-05 19:00:00")
MAX_PTS = 200
AMBANG_KN = 50.0

# 8 lintasan: bergerak (SOG median >=3 kn), >=30 titik di dalam footprint, berada di dalam
# footprint pada detik akuisisi, dipilih untuk ragam tipe kapal dan sebaran bujur 6,2-8,7.
TRACKS = [211325510, 229291000, 255739000, 636016858,
          211209290, 219027309, 211839040, 211796430]
# 3 celah >6 jam yang jendelanya MEMUAT waktu akuisisi dan posisi sinyal-terakhirnya
# berada di dalam footprint (laut lepas, bukan dermaga).
GAPS = [219384000, 250369000, 232018395]
N_KIN = 2  # pasangan (celah, target placeholder) yang diuji kinematik


def mmsi_hash(mmsi):
    return hmac.new(SALT.encode(), str(int(mmsi)).encode(), hashlib.sha256).hexdigest()[:16]


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def in_quad(lon, lat):
    """ray casting atas poligon 4 titik footprint."""
    inside = False
    for i in range(4):
        x1, y1 = QUAD[i]
        x2, y2 = QUAD[(i + 1) % 4]
        if (y1 > lat) != (y2 > lat):
            if lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def hav_km(lat1, lon1, lat2, lon2):
    R = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def midpoint(lat1, lon1, lat2, lon2):
    """titik tengah lingkaran-besar."""
    p1, l1, p2 = math.radians(lat1), math.radians(lon1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    bx, by = math.cos(p2) * math.cos(dl), math.cos(p2) * math.sin(dl)
    p3 = math.atan2(math.sin(p1) + math.sin(p2),
                    math.sqrt((math.cos(p1) + bx) ** 2 + by ** 2))
    l3 = l1 + math.atan2(by, math.cos(p1) + bx)
    return round(math.degrees(p3), 6), round((math.degrees(l3) + 540) % 360 - 180, 6)


def iso(ts):
    return pd.Timestamp(ts).isoformat() + "Z"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def tulis(art_id, tipe, source, payload, sintetis, now):
    a = {"art_id": art_id, "inv_id": INV, "type": tipe, "source": source,
         "sintetis": sintetis, "payload": payload, "created_at": now, "hash_sha256": ""}
    a["hash_sha256"] = hashlib.sha256(
        canonical({k: v for k, v in a.items() if k != "hash_sha256"}).encode()).hexdigest()
    ART_DIR.mkdir(parents=True, exist_ok=True)
    (ART_DIR / f"{art_id}.json").write_text(json.dumps(a, indent=1, ensure_ascii=False))
    print(f"  {art_id}  {tipe}  {'SINTETIS' if sintetis else 'nyata'}")
    return art_id


COLS = ("Timestamp,Type of mobile,MMSI,Latitude,Longitude,Navigational status,ROT,SOG,COG,"
        "Heading,IMO,Callsign,Name,Ship type,Cargo type,Width,Length,"
        "Type of position fixing device,Draught,Destination,ETA,Data source type,A,B,C,D").split(",")


def baca_mentah():
    """Saring CSV mentah 3,5 GB sekali jalan (unzip|grep, ~12 s) -> cache."""
    p = CACHE / "raw_tracks.csv"
    if not p.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        pola = (r"^05/08/2026 (1[5-8]:[0-9]{2}:[0-9]{2}|19:00:00),Class A,("
                + "|".join(str(m) for m in TRACKS) + r"),")
        with open(p, "wb") as out:
            uz = subprocess.Popen(
                ["unzip", "-p", str(ROOT / "data/raw/dma/aisdk-2026-08-05.zip"),
                 "aisdk-2026-08-05.csv"], stdout=subprocess.PIPE)
            subprocess.run(["grep", "-E", pola], stdin=uz.stdout, stdout=out,
                           env={"LC_ALL": "C", "PATH": "/usr/bin:/bin"}, check=True)
            uz.stdout.close(), uz.wait()
    d = pd.read_csv(p, names=COLS, low_memory=False)
    d["ts"] = pd.to_datetime(d.Timestamp, format="%d/%m/%Y %H:%M:%S")
    return d[(d.ts >= W0) & (d.ts <= W1)]


def main():
    now = now_iso()
    raw = baca_mentah()

    # ---- 1. ais_track_segment (nyata) ----
    for n, m in enumerate(TRACKS, 1):
        d = raw[raw.MMSI == m].sort_values("ts").drop_duplicates("ts")
        n_asli = len(d)
        assert n_asli, f"tidak ada baris untuk MMSI {m}"
        n_in = sum(in_quad(a, b) for a, b in zip(d.Longitude, d.Latitude))
        assert n_in, f"lintasan {m} tidak melintasi footprint"
        stride = max(1, math.ceil(n_asli / MAX_PTS))
        keep = list(range(0, n_asli, stride))
        if keep[-1] != n_asli - 1:
            keep.append(n_asli - 1)
        ds = d.iloc[keep]
        pts = [{"t": iso(r.ts), "lat": round(float(r.Latitude), 6),
                "lon": round(float(r.Longitude), 6),
                "sog": None if pd.isna(r.SOG) else round(float(r.SOG), 1),
                "cog": None if pd.isna(r.COG) else round(float(r.COG), 1)}
               for r in ds.itertuples()]
        assert len(pts) <= MAX_PTS
        tipe = str(d["Ship type"].mode().iloc[0])
        tulis(f"a-dk-01-t{n:02d}", "ais_track_segment",
              {"dataset": "dma-aisdk", "ref": mmsi_hash(m), "provenance": (
                  f"AIS Kelas A Danish Maritime Authority aisdk-2026-08-05.csv, kapal tipe {tipe}, "
                  f"jendela 2026-08-05T15:00:00Z-19:00:00Z UTC; {n_in} dari {n_asli} titik asli berada "
                  f"di dalam {FOOT} scene {SCENE}; downsample jujur stride seragam k={stride} -> "
                  f"{len(pts)} titik, titik awal dan akhir dipertahankan, tanpa penghalusan; "
                  "lat/lon/sog/cog nilai apa adanya dari CSV mentah.")},
              {"mmsi_hash": mmsi_hash(m), "points": pts,
               "start": iso(d.ts.iloc[0]), "end": iso(d.ts.iloc[-1])}, False, now)

    # ---- 2. ais_gap (nyata) + posisi hilang/muncul dari parquet ----
    gc = pd.read_csv(ROOT / "data/processed/dma/gap_candidates.csv",
                     parse_dates=["t_awal", "t_akhir"])
    traj = pq.read_table(ROOT / "data/processed/dma/trajectories.parquet",
                         filters=[("MMSI", "in", set(GAPS))]).to_pandas()
    gap_ctx = {}
    for n, m in enumerate(GAPS, 1):
        r = gc[gc.mmsi == m].iloc[0]
        assert r.durasi_jam > 6 and r.t_awal <= T_ACQ <= r.t_akhir, f"celah {m} tidak memenuhi"
        d = traj[traj.MMSI == m].sort_values("ts")
        last = d[d.ts <= r.t_awal].iloc[-1]
        nxt = d[d.ts >= r.t_akhir].iloc[0]
        assert in_quad(last.lon, last.lat), f"sinyal terakhir {m} di luar footprint"
        aid = tulis(f"a-dk-01-g{n:02d}", "ais_gap",
                    {"dataset": "dma-aisdk", "ref": mmsi_hash(m), "provenance": (
                        "Celah AIS terdeteksi pada aisdk-2026-08-05 "
                        "(data/processed/dma/gap_candidates.csv); posisi sinyal terakhir "
                        f"{last.lat:.6f},{last.lon:.6f} berada DI DALAM {FOOT}; jendela celah memuat "
                        f"waktu akuisisi scene {SCENE} ({T_ACQ_ISO}); posisi muncul kembali "
                        f"{nxt.lat:.6f},{nxt.lon:.6f}.")},
                    {"mmsi_hash": mmsi_hash(m), "t_start": iso(r.t_awal), "t_end": iso(r.t_akhir),
                     "durasi_jam": round(float(r.durasi_jam), 3),
                     "sog_sebelum": round(float(r.sog_sebelum), 1)}, False, now)
        gap_ctx[aid] = dict(mmsi=m, t_awal=r.t_awal, lat=float(last.lat), lon=float(last.lon),
                            lat_n=float(nxt.lat), lon_n=float(nxt.lon))

    # ---- 3. target placeholder (SINTETIS) + kinematic_feasibility ----
    for n, gid in enumerate(list(gap_ctx)[:N_KIN], 1):
        c = gap_ctx[gid]
        tlat, tlon = midpoint(c["lat"], c["lon"], c["lat_n"], c["lon_n"])
        assert in_quad(tlon, tlat), f"target placeholder {gid} jatuh di luar footprint"
        did = tulis(f"a-dk-01-d{n:02d}", "sar_detection",
                    {"dataset": "cdse-denmark", "ref": SCENE, "provenance": (
                        "PLACEHOLDER-TARGET, BUKAN deteksi SAR: inferensi scene Denmark belum "
                        "dijalankan, artefak ini menunggu inferensi scene Denmark. Koordinat "
                        "diturunkan dari data AIS nyata sebagai titik tengah lingkaran-besar antara "
                        "posisi sinyal-terakhir dan posisi muncul-kembali kapal pada celah "
                        f"{gid}, dan diverifikasi berada di dalam {FOOT}. Seluruh field perseptual "
                        "(row, col, length_m_est, objectness_p, vessel_p, fishing_p, "
                        "confidence_calibrated) sengaja null: tidak ada angka yang dikarang.")},
                    {"lat": tlat, "lon": tlon, "row": None, "col": None, "length_m_est": None,
                     "objectness_p": None, "vessel_p": None, "fishing_p": None,
                     "confidence_calibrated": None, "scene_id": SCENE}, True, now)
        jarak = hav_km(c["lat"], c["lon"], tlat, tlon)
        dt_jam = (T_ACQ - c["t_awal"]).total_seconds() / 3600
        sog_implied = (jarak / 1.852) / dt_jam
        tulis(f"a-dk-01-k{n:02d}", "kinematic_feasibility",
              {"dataset": "dma-aisdk", "ref": mmsi_hash(c["mmsi"]), "provenance": (
                  f"Geometri celah NYATA ({gid}, dma-aisdk) terhadap target PLACEHOLDER {did} "
                  "(sintetis, menunggu inferensi scene Denmark). jarak_km = haversine R=6371.0088 km "
                  f"dari posisi sinyal-terakhir {c['lat']:.6f},{c['lon']:.6f} ke target; dt_jam = "
                  f"selisih t_start celah ke waktu akuisisi scene {T_ACQ_ISO}; sog_implied = "
                  "(jarak_km/1.852)/dt_jam knot; ambang 50 kn. Artefak ditandai sintetis karena "
                  "sisi targetnya placeholder.")},
              {"gap_art_id": gid, "det_art_id": did, "jarak_km": round(jarak, 3),
               "dt_jam": round(dt_jam, 3), "sog_implied": round(sog_implied, 3),
               "ambang_kn": AMBANG_KN, "lolos": bool(sog_implied <= AMBANG_KN)}, True, now)

    # ---- 4. index/manifest.json: gabung, jangan timpa entri agen lain ----
    # Bentuk {"items":[...]} + kasus sebagai label mengikuti penulis yang SUDAH ADA di repo
    # (scripts/golden_zona_perilaku_anomali.py tahap index), bukan bentuk ketiga.
    p = GOLDEN / "index/manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    items = {}
    if p.exists():
        lama = json.loads(p.read_text())
        for e in (lama["items"] if isinstance(lama, dict) else lama):  # toleran dua bentuk
            items[e["inv_id"]] = e
    items[INV] = {"inv_id": INV, "split": "demo", "kasus": "asosiasi-denmark"}
    p.write_text(json.dumps({"items": [items[k] for k in sorted(items)]}, indent=1,
                            ensure_ascii=False))
    print(f"index/manifest.json: {len(items)} investigasi")
    print(f"HASIL n_track={len(TRACKS)} n_gap={len(GAPS)} n_kinematik={N_KIN} seed={SEED}")


if __name__ == "__main__":
    main()

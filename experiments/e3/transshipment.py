#!/usr/bin/env python
"""E3 alih muatan: aturan Miller (jarak <=500 m, durasi >=2 jam, SOG <2 kn,
>=10 km dari pelabuhan) + suite paritas 12 kasus sintetis (6 pos, 6 neg).

Jalankan langsung untuk suite: `python transshipment.py` -> wajib 12/12.
"""
import numpy as np
import pandas as pd

R_EARTH = 6371.0
BIN_MIN = 10          # bin waktu (menit)
DIST_M = 500.0        # ambang jarak antar kapal
DUR_MIN = 120         # ambang durasi (menit)
SOG_KN = 2.0          # ambang kecepatan
PORT_KM = 10.0        # ambang jarak pelabuhan/daratan


def haversine_m(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH * 1000 * np.arcsin(np.sqrt(a))


def detect(df):
    """df: kolom MMSI, ts, lat, lon, sog, dist_port_km. Return list event dict.

    Implementasi: bin 10 menit; posisi median per (kapal, bin); kandidat = bin
    dgn median SOG < 2 kn dan jarak pelabuhan >= 10 km; pasangan kapal <= 500 m
    pada >= 12 bin BERTURUT-TURUT (>= 2 jam kontinu).
    """
    d = df.copy()
    d["bin"] = d.ts.values.astype("datetime64[m]").astype("int64") // BIN_MIN
    g = d.groupby(["MMSI", "bin"]).agg(lat=("lat", "median"), lon=("lon", "median"),
                                       sog=("sog", "median"), dpk=("dist_port_km", "median")).reset_index()
    g = g[(g.sog < SOG_KN) & (g.dpk >= PORT_KM)]
    if g.empty:
        return []
    # spatial hash per bin: sel ~500 m, cek pasangan di sel tetangga
    cell_lat = DIST_M / 111000.0
    g["cy"] = (g.lat / cell_lat).astype(int)
    g["cx"] = (g.lon * np.cos(np.radians(g.lat)) / cell_lat).astype(int)
    pair_bins = {}
    for b, sub in g.groupby("bin"):
        idx = {}
        for r in sub.itertuples():
            idx.setdefault((r.cy, r.cx), []).append(r)
        seen = set()
        for (cy, cx), rows in idx.items():
            cand = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    cand.extend(idx.get((cy + dy, cx + dx), []))
            for r1 in rows:
                for r2 in cand:
                    if r1.MMSI >= r2.MMSI:
                        continue
                    key = (r1.MMSI, r2.MMSI)
                    if (key, b) in seen:
                        continue
                    seen.add((key, b))
                    if haversine_m(r1.lat, r1.lon, r2.lat, r2.lon) <= DIST_M:
                        pair_bins.setdefault(key, []).append((b, r1.lat, r1.lon))
    events = []
    need = DUR_MIN // BIN_MIN
    for (m1, m2), bl in pair_bins.items():
        bl.sort()
        run = [bl[0]]
        for item in bl[1:] + [(10**18, 0, 0)]:  # sentinel penutup
            if item[0] == run[-1][0] + 1:
                run.append(item)
            else:
                if len(run) >= need:
                    events.append({"mmsi1": int(m1), "mmsi2": int(m2),
                                   "start_bin": int(run[0][0]), "n_bins": len(run),
                                   "dur_min": len(run) * BIN_MIN,
                                   "lat": float(run[0][1]), "lon": float(run[0][2])})
                run = [item]
    return events


# ---------- suite paritas 12 kasus sintetis (by construction) ----------

def _make_pair(dist_m=100.0, dur_min=150, sog=0.5, dist_port=20.0,
               lat0=56.0, lon0=6.0, step_s=60):
    """Dua kapal diam berdampingan selama dur_min menit."""
    ts = pd.date_range("2026-08-05 00:00", periods=dur_min * 60 // step_s, freq=f"{step_s}s")
    dlat = dist_m / 111000.0
    rows = []
    for m, la in ((111, lat0), (222, lat0 + dlat)):
        rows.append(pd.DataFrame({"MMSI": m, "ts": ts, "lat": la, "lon": lon0,
                                  "sog": sog, "dist_port_km": dist_port}))
    return pd.concat(rows, ignore_index=True)


def suite():
    cases = []
    # 6 positif (masing-masing tepat di sisi lolos tiap ambang)
    cases.append(("P1 jarak 400m", _make_pair(dist_m=400), True))
    cases.append(("P2 jarak 490m (tepat di bawah 500)", _make_pair(dist_m=490), True))
    cases.append(("P3 durasi 125min (tepat di atas 2 jam)", _make_pair(dur_min=125), True))
    cases.append(("P4 sog 1.8kn (tepat di bawah 2)", _make_pair(sog=1.8), True))
    cases.append(("P5 jarak pelabuhan 10.5km (tepat di atas 10)", _make_pair(dist_port=10.5), True))
    cases.append(("P6 4 jam @100m", _make_pair(dur_min=240), True))
    # 6 negatif
    cases.append(("N1 jarak 600m (>500)", _make_pair(dist_m=600), False))
    cases.append(("N2 durasi 90min (<2 jam)", _make_pair(dur_min=90), False))
    cases.append(("N3 sog 2.5kn (>=2)", _make_pair(sog=2.5), False))
    cases.append(("N4 jarak pelabuhan 8km (<10)", _make_pair(dist_port=8.0), False))
    df5 = _make_pair()
    cases.append(("N5 kapal tunggal", df5[df5.MMSI == 111].copy(), False))
    # N6: 60min dekat, 60min pisah (2 km), 60min dekat -> tidak kontinu 2 jam
    a = _make_pair(dur_min=60)
    b = _make_pair(dur_min=60, dist_m=2000)
    b["ts"] += pd.Timedelta(minutes=60)
    c = _make_pair(dur_min=60)
    c["ts"] += pd.Timedelta(minutes=120)
    cases.append(("N6 dekat-pisah-dekat (tanpa 2 jam kontinu)", pd.concat([a, b, c]), False))

    npass = 0
    for name, df, expect in cases:
        got = len(detect(df)) > 0
        ok = got == expect
        npass += ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}: expect={expect} got={got}")
    print(f"paritas: {npass}/12")
    return npass


if __name__ == "__main__":
    assert suite() == 12, "suite paritas WAJIB 12/12"

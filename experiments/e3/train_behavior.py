#!/usr/bin/env python
"""E3 (protokol E3, Perilaku T3): klasifikasi segmen 6 jam Fishing vs transit (Cargo/Tanker/Passenger).

Label = tipe kapal terdaftar DMA (PROXY perilaku, keputusan konservatif krn 4wings Natuna
hanya 15 baris). Metrik = KONKORDANSI dgn tipe terdaftar, bukan akurasi perilaku.
Seed 20260809, split BY MMSI 70/30 (protokol §0.3, §0.8).
"""
import json, datetime
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import cohen_kappa_score, confusion_matrix

SEED = 20260809
R_EARTH = 6371.0
DATA = "data/processed/dma/trajectories.parquet"
OUTDIR = "experiments/e3"
MANIFEST = "manifests/e3-hasil.json"
# wilayah plausibel DMA (buang fix rusak spt lat=0/lon=89); dicatat di manifest
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 50.0, 63.5, -12.0, 20.0
MIN_PTS, MIN_SPAN_S = 30, 3600  # segmen valid: >=30 fix dan rentang >=1 jam (konservatif, dicatat)


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH * np.arcsin(np.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlon = lon2 - lon1
    y = np.sin(dlon) * np.cos(lat2)
    x = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
    return np.degrees(np.arctan2(y, x))


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def build_segments(df):
    df = df.sort_values(["MMSI", "ts"], kind="mergesort").reset_index(drop=True)
    same = df.MMSI.eq(df.MMSI.shift())
    dt = (df.ts - df.ts.shift()).dt.total_seconds().where(same)
    dist = haversine_km(df.lat.shift().values, df.lon.shift().values, df.lat.values, df.lon.values)
    dist = np.where(same, dist, np.nan)
    brg = bearing_deg(df.lat.shift().values, df.lon.shift().values, df.lat.values, df.lon.values)
    brg = np.where(same & (dist > 0.01), brg, np.nan)  # bearing hanya bila pindah >10 m
    dbrg = np.abs((pd.Series(brg).diff() + 180) % 360 - 180)
    ok_dt = (dt > 0) & (dt <= 600)
    turn = np.where(ok_dt & pd.notna(dbrg) & (df.sog > 0.5), dbrg / (dt / 60.0), np.nan)
    step = np.where(ok_dt, dist, np.nan)

    df = df.assign(dt=dt, step=step, turn=turn,
                   seg=df.ts.dt.hour // 6,
                   is_stat=(df.sog < 0.5).astype(float),
                   # siang lokal Denmark musim panas = UTC+2, jam [06,18)
                   is_day=(((df.ts + pd.Timedelta(hours=2)).dt.hour.between(6, 17))).astype(float))
    g = df.groupby(["MMSI", "seg"])
    feats = g.agg(
        n=("sog", "size"), span=("dt", lambda s: np.nan),  # placeholder
        sog_mean=("sog", "mean"), sog_std=("sog", "std"),
        sog_p10=("sog", lambda s: s.quantile(0.1)), sog_p25=("sog", lambda s: s.quantile(0.25)),
        sog_p50=("sog", "median"), sog_p75=("sog", lambda s: s.quantile(0.75)),
        sog_p90=("sog", lambda s: s.quantile(0.9)), sog_max=("sog", "max"),
        turn_mean=("turn", "mean"), turn_p90=("turn", lambda s: s.quantile(0.9)),
        frac_stat=("is_stat", "mean"), frac_day=("is_day", "mean"),
        path_km=("step", "sum"),
        lat0=("lat", "first"), lon0=("lon", "first"), lat1=("lat", "last"), lon1=("lon", "last"),
        t0=("ts", "min"), t1=("ts", "max"), ship_type=("ship_type", "first"),
    ).reset_index()
    feats["span"] = (feats.t1 - feats.t0).dt.total_seconds()
    net = haversine_km(feats.lat0.values, feats.lon0.values, feats.lat1.values, feats.lon1.values)
    feats["straightness"] = np.where(feats.path_km > 0.5, net / feats.path_km, np.nan)
    feats = feats[(feats.n >= MIN_PTS) & (feats.span >= MIN_SPAN_S)].reset_index(drop=True)
    return feats


def main():
    df = pd.read_parquet(DATA)
    n_raw = len(df)
    df = df[df.ship_type.isin(["Fishing", "Cargo", "Tanker", "Passenger"])]
    df = df.dropna(subset=["sog"])
    df = df[df.lat.between(LAT_MIN, LAT_MAX) & df.lon.between(LON_MIN, LON_MAX)]
    n_filt = len(df)

    feats = build_segments(df)
    feats["y"] = (feats.ship_type == "Fishing").astype(int)

    mmsi = np.sort(feats.MMSI.unique())
    rng = np.random.default_rng(SEED)
    rng.shuffle(mmsi)
    n_tr = int(round(0.7 * len(mmsi)))
    tr_mmsi = set(mmsi[:n_tr].tolist())
    tr = feats[feats.MMSI.isin(tr_mmsi)]
    te = feats[~feats.MMSI.isin(tr_mmsi)]

    fcols = ["sog_mean", "sog_std", "sog_p10", "sog_p25", "sog_p50", "sog_p75", "sog_p90",
             "sog_max", "turn_mean", "turn_p90", "straightness", "frac_stat", "frac_day"]
    clf = HistGradientBoostingClassifier(random_state=SEED, early_stopping=True,
                                         validation_fraction=0.15, scoring="loss")
    clf.fit(tr[fcols], tr.y)
    np.savetxt(f"{OUTDIR}/train_curve.csv",
               np.c_[clf.train_score_, clf.validation_score_], delimiter=",",
               header="train_score,validation_score", comments="")

    yp = clf.predict(te[fcols])
    yt = te.y.values
    agree = float((yp == yt).mean())
    kappa = float(cohen_kappa_score(yt, yp))
    # baseline trivial (protokol §0.8)
    maj = int(tr.y.mode()[0])
    base_major = float((yt == maj).mean())
    rng2 = np.random.default_rng(SEED)
    yr = rng2.choice([0, 1], size=len(yt), p=[(tr.y == 0).mean(), (tr.y == 1).mean()])
    base_rand = float((yr == yt).mean())
    kappa_major = float(cohen_kappa_score(yt, np.full_like(yt, maj)))
    kappa_rand = float(cohen_kappa_score(yt, yr))

    tn, fp, fn, tp = confusion_matrix(yt, yp, labels=[0, 1]).ravel()
    per_class = {}
    for name, (k_p, n_p, k_r, n_r) in {
        "fishing": (tp, tp + fp, tp, tp + fn),
        "transit": (tn, tn + fn, tn, tn + fp),
    }.items():
        pw, rw = wilson(k_p, n_p), wilson(k_r, n_r)
        per_class[name] = {
            "precision": {"frac": f"{k_p}/{n_p}", "p": k_p / n_p, "wilson95": [round(pw[0], 4), round(pw[1], 4)]},
            "recall": {"frac": f"{k_r}/{n_r}", "p": k_r / n_r, "wilson95": [round(rw[0], 4), round(rw[1], 4)]},
        }

    out = {
        "run_id": "e3-behavior-20260809",
        "date": datetime.datetime.now().isoformat(),
        "seed": SEED,
        "protocol": "eval-protocol.md §E3 + §0",
        "data": {"file": DATA, "rows_raw": n_raw, "rows_filtered_4types": n_filt,
                 "region_filter": [LAT_MIN, LAT_MAX, LON_MIN, LON_MAX],
                 "day": "2026-08-05 (DMA, 1 hari)",
                 "segments": int(len(feats)), "segments_train": int(len(tr)), "segments_test": int(len(te)),
                 "mmsi_total": int(len(mmsi)), "mmsi_train": int(n_tr), "mmsi_test": int(len(mmsi) - n_tr),
                 "segment_rule": f"6 jam (jam UTC//6), valid bila >={MIN_PTS} fix & rentang >={MIN_SPAN_S}s"},
        "label_definition": ("Label LEMAH = ship_type terdaftar DMA: Fishing=1 vs Cargo/Tanker/Passenger=0. "
                             "PROXY perilaku, BUKAN ground truth perilaku; 4wings GFW Natuna (15 baris) terlalu "
                             "kecil utk label lemah berskala -> fallback konservatif, dicatat sesuai protokol E3. "
                             "PLAFON: kapal ikan yang sedang transit tetap berlabel 1; metrik = KONKORDANSI dgn "
                             "tipe terdaftar, bukan akurasi perilaku."),
        "model": "HistGradientBoostingClassifier(random_state=20260809, early_stopping, val_frac=0.15)",
        "features": fcols,
        "split": "by MMSI 70/30, default_rng(20260809) shuffle atas MMSI terurut",
        "results": {
            "concordance": agree, "kappa": kappa,
            "baseline_majority": {"agreement": base_major, "kappa": kappa_major},
            "baseline_random_stratified": {"agreement": base_rand, "kappa": kappa_rand},
            "per_class": per_class,
            "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "train_curve_file": f"{OUTDIR}/train_curve.csv",
            "n_iter": int(clf.n_iter_),
        },
    }
    with open(f"{OUTDIR}/behavior_result.json", "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps(out["results"], indent=1, default=str)[:2000])


if __name__ == "__main__":
    main()

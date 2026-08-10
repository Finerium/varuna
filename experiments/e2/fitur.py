# E2 fitur segmen kapal-hari + injeksi spoofing sintetis (protokol E2, seed 20260809)
# Jalankan: .venv/bin/python experiments/e2/fitur.py
# Output: experiments/e2/out/{fitur_clean.parquet,fitur_spoof.parquet,injeksi.csv,labels.parquet}
import json
import os

import numpy as np
import pandas as pd

BASE = "."
DMA = f"{BASE}/data/processed/dma"
OUT = f"{BASE}/experiments/e2/out"
SEED = 20260809
KN_THRESHOLD = 50.0  # ambang kelayakan (implied speed)
INJ_RATIO = 0.05

EARTH_NM = 3440.065


def haversine_nm(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_NM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def compute_features(df):
    """df: kolom MMSI, ts, lat, lon, sog; sorted by (MMSI, ts). Return fitur per MMSI."""
    g = df.groupby("MMSI", sort=True)
    same = df["MMSI"].eq(df["MMSI"].shift())
    dt = df["ts"].diff().dt.total_seconds().where(same)
    dist = pd.Series(
        haversine_nm(df["lat"].shift().values, df["lon"].shift().values, df["lat"].values, df["lon"].values),
        index=df.index,
    ).where(same)
    vimp = dist / (dt / 3600.0)  # kn; inf bila dt=0
    vimp = vimp.replace(np.inf, np.nan)
    sog_prev = df["sog"].shift().where(same)

    ping = g.agg(n_pings=("ts", "size"), sog_mean=("sog", "mean"), sog_std=("sog", "std"), sog_max=("sog", "max"))
    ping["frac_underway"] = df["sog"].gt(1).groupby(df["MMSI"]).mean()

    t = pd.DataFrame({"MMSI": df["MMSI"], "dt": dt, "dist": dist, "vimp": vimp, "sog_prev": sog_prev}).dropna(
        subset=["dt"]
    )
    tg = t.groupby("MMSI")
    tr = tg.agg(
        dt_mean_s=("dt", "mean"),
        dt_median_s=("dt", "median"),
        dt_max_s=("dt", "max"),
        vimp_max=("vimp", "max"),
        dist_max_nm=("dist", "max"),
    )
    tr["vimp_p99"] = tg["vimp"].quantile(0.99)
    tr["dt_max_underway_s"] = t.loc[t["sog_prev"] > 1].groupby("MMSI")["dt"].max()
    tr["n_vimp_gt50"] = t.loc[t["vimp"] > 50].groupby("MMSI").size()
    tr["n_vimp_50_150"] = t.loc[t["vimp"].between(50, 150, inclusive="neither") | t["vimp"].eq(150)].groupby("MMSI").size()
    tr["n_vimp_150_1000"] = t.loc[(t["vimp"] > 150) & (t["vimp"] <= 1000)].groupby("MMSI").size()
    tr["n_vimp_gt1000"] = t.loc[t["vimp"] > 1000].groupby("MMSI").size()
    tr["n_jump_gt5nm_gt50kn"] = t.loc[(t["dist"] > 5) & (t["vimp"] > 50)].groupby("MMSI").size()
    feat = ping.join(tr)
    for c in ["n_vimp_gt50", "n_vimp_50_150", "n_vimp_150_1000", "n_vimp_gt1000", "n_jump_gt5nm_gt50kn"]:
        feat[c] = feat[c].fillna(0)
    return feat


def main():
    os.makedirs(OUT, exist_ok=True)
    df = pd.read_parquet(f"{DMA}/trajectories.parquet").sort_values(["MMSI", "ts"]).reset_index(drop=True)
    mmsi_all = np.sort(df["MMSI"].unique())

    # ---- Injeksi spoofing sintetis (PRA-REGISTRASI: digenerate sebelum model) ----
    rng = np.random.default_rng(SEED)
    counts = df.groupby("MMSI").size()
    # eligible: >=2 ping dan ada transisi dengan 1s <= dt <= 3600s
    dt_all = df["ts"].diff().dt.total_seconds().where(df["MMSI"].eq(df["MMSI"].shift()))
    ok_tr = dt_all.between(1, 3600)
    eligible = np.sort(df.loc[ok_tr, "MMSI"].unique())
    n_inj = int(round(INJ_RATIO * len(mmsi_all)))
    injected = np.sort(rng.choice(eligible, size=n_inj, replace=False))

    inj_rows = []
    df_spoof_parts = []
    for m in injected:
        seg = df[df["MMSI"] == m].copy().reset_index(drop=True)
        dts = seg["ts"].diff().dt.total_seconds()
        cand = np.where(dts.between(1, 3600))[0]  # index i: transisi (i-1 -> i)
        i = int(rng.choice(cand))
        mult = float(np.exp(rng.uniform(np.log(1.0), np.log(3.0))))
        v_target = mult * KN_THRESHOLD
        dt_h = float(dts.iloc[i]) / 3600.0
        d_nm = v_target * dt_h
        brg = float(rng.uniform(0, 2 * np.pi))
        dlat = (d_nm / 60.0) * np.cos(brg)
        dlon = (d_nm / 60.0) * np.sin(brg) / np.cos(np.radians(seg.loc[i, "lat"]))
        seg.loc[i:, "lat"] = seg.loc[i:, "lat"] + dlat
        seg.loc[i:, "lon"] = seg.loc[i:, "lon"] + dlon
        v_achieved = float(
            haversine_nm(seg.loc[i - 1, "lat"], seg.loc[i - 1, "lon"], seg.loc[i, "lat"], seg.loc[i, "lon"]) / dt_h
        )
        df_spoof_parts.append(seg)
        inj_rows.append(
            dict(mmsi=int(m), ts_transisi=str(seg.loc[i, "ts"]), dt_s=float(dts.iloc[i]), multiplier=mult,
                 v_target_kn=v_target, v_achieved_kn=v_achieved, offset_nm=d_nm, bearing_rad=brg)
        )
    pd.DataFrame(inj_rows).to_csv(f"{OUT}/injeksi.csv", index=False)

    # ---- Fitur ----
    feat_clean = compute_features(df)
    seg_inj = pd.concat(df_spoof_parts, ignore_index=True).sort_values(["MMSI", "ts"]).reset_index(drop=True)
    feat_inj = compute_features(seg_inj)
    feat_spoof = feat_clean.copy()
    feat_spoof.loc[feat_inj.index] = feat_inj

    # ---- Label nyata ----
    gaps = pd.read_csv(f"{DMA}/gap_candidates.csv")
    jumps = pd.read_csv(f"{DMA}/jump_candidates.csv")
    labels = pd.DataFrame(index=feat_clean.index)
    labels["gap6"] = labels.index.isin(gaps.loc[gaps["durasi_jam"] > 6, "mmsi"]).astype(int)
    labels["gap12"] = labels.index.isin(gaps.loc[gaps["durasi_jam"] > 12, "mmsi"]).astype(int)
    # jump_candidates.csv = daftar kandidat >50kn dari upstream (kolom kecepatan dibulatkan 1dp,
    # beberapa baris tampil 50.0) -> label literal = muncul di CSV
    labels["ident_5nm"] = labels.index.isin(jumps.loc[jumps["jarak_nm"] > 5, "mmsi"]).astype(int)
    labels["ident_50kn"] = labels.index.isin(jumps["mmsi"]).astype(int)
    labels["spoof"] = labels.index.isin(injected).astype(int)

    feat_clean.to_parquet(f"{OUT}/fitur_clean.parquet")
    feat_spoof.to_parquet(f"{OUT}/fitur_spoof.parquet")
    labels.to_parquet(f"{OUT}/labels.parquet")
    print(json.dumps({"n_segmen": len(feat_clean), "n_injeksi": n_inj, "n_eligible": len(eligible),
                      "label_counts": labels.sum().to_dict()}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""E2 data prep: DMA AIS dump -> Class A trajectories parquet + kandidat label nyata.

Usage: python dma_e2_prep.py <zip1> [zip2 ...]
Output: data/processed/dma/{trajectories.parquet, gap_candidates.csv, jump_candidates.csv, summary.json}
"""
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path("/Users/ghaisan/Documents/Datathon/varuna/data/processed/dma")
USECOLS = ["# Timestamp", "Type of mobile", "MMSI", "Latitude", "Longitude", "SOG", "Ship type"]
TS_FMT = "%d/%m/%Y %H:%M:%S"


def load_zip(path):
    parts = []
    raw = 0
    with zipfile.ZipFile(path) as z:
        member = z.namelist()[0]
        with z.open(member) as f:
            for chunk in pd.read_csv(f, usecols=USECOLS, chunksize=2_000_000,
                                     dtype={"MMSI": "int64", "SOG": "float32",
                                            "Latitude": "float64", "Longitude": "float64"}):
                raw += len(chunk)
                chunk = chunk[chunk["Type of mobile"] == "Class A"]
                chunk = chunk[(chunk["Latitude"].abs() <= 90) & (chunk["Longitude"].abs() <= 180)]
                chunk = chunk.drop(columns=["Type of mobile"])
                chunk["ts"] = pd.to_datetime(chunk.pop("# Timestamp"), format=TS_FMT, cache=True)
                parts.append(chunk)
    return pd.concat(parts, ignore_index=True), raw


def haversine_nm(lat1, lon1, lat2, lon2):
    r = np.radians
    dlat, dlon = r(lat2 - lat1), r(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(r(lat1)) * np.cos(r(lat2)) * np.sin(dlon / 2) ** 2
    return 2 * 3440.065 * np.arcsin(np.sqrt(a))  # nautical miles


def main(zips):
    total_raw = 0
    frames = []
    for zp in zips:
        df, raw = load_zip(zp)
        total_raw += raw
        print(f"{zp}: {raw} raw rows, {len(df)} Class A valid-pos rows", flush=True)
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values(["MMSI", "ts"], kind="stable").drop_duplicates(["MMSI", "ts"]).reset_index(drop=True)
    df = df.rename(columns={"Latitude": "lat", "Longitude": "lon", "SOG": "sog", "Ship type": "ship_type"})
    df = df[["MMSI", "ts", "lat", "lon", "sog", "ship_type"]]

    OUT.mkdir(parents=True, exist_ok=True)
    pq = OUT / "trajectories.parquet"
    df.to_parquet(pq, compression="zstd", index=False)

    # consecutive-point deltas per MMSI
    same = df["MMSI"].eq(df["MMSI"].shift())
    dt_h = (df["ts"] - df["ts"].shift()).dt.total_seconds() / 3600.0
    dist = haversine_nm(df["lat"].shift(), df["lon"].shift(), df["lat"], df["lon"])
    prev_sog = df["sog"].shift()

    # (a) transmission gaps while underway (prev SOG > 1 kn)
    gap_mask = same & (dt_h > 6) & (prev_sog > 1)
    gaps = pd.DataFrame({
        "mmsi": df.loc[gap_mask, "MMSI"],
        "t_awal": df["ts"].shift()[gap_mask],
        "t_akhir": df.loc[gap_mask, "ts"],
        "durasi_jam": dt_h[gap_mask].round(3),
        "sog_sebelum": prev_sog[gap_mask],
    }).sort_values("durasi_jam", ascending=False)
    gaps.to_csv(OUT / "gap_candidates.csv", index=False)

    # (b) position jumps implying > 50 kn within one MMSI
    with np.errstate(divide="ignore", invalid="ignore"):
        implied = dist / dt_h
    jump_mask = same & (dt_h > 0) & (implied > 50)
    jumps = pd.DataFrame({
        "mmsi": df.loc[jump_mask, "MMSI"],
        "t_awal": df["ts"].shift()[jump_mask],
        "t_akhir": df.loc[jump_mask, "ts"],
        "jarak_nm": dist[jump_mask].round(3),
        "dt_detik": (dt_h[jump_mask] * 3600).round(1),
        "kecepatan_tersirat_kn": implied[jump_mask].round(1),
    }).sort_values("kecepatan_tersirat_kn", ascending=False)
    jumps.to_csv(OUT / "jump_candidates.csv", index=False)

    ship_type_mmsi = df.groupby("MMSI")["ship_type"].first().value_counts()
    summary = {
        "files": [str(z) for z in zips],
        "rows_raw": total_raw,
        "rows_classA": int(len(df)),
        "unique_mmsi": int(df["MMSI"].nunique()),
        "ship_type_by_mmsi": ship_type_mmsi.to_dict(),
        "gap_gt6h": int(len(gaps)),
        "gap_gt6h_mmsi": int(gaps["mmsi"].nunique()),
        "gap_gt12h": int((gaps["durasi_jam"] > 12).sum()),
        "gap_gt12h_mmsi": int(gaps.loc[gaps["durasi_jam"] > 12, "mmsi"].nunique()),
        "jump_gt50kn": int(len(jumps)),
        "jump_gt50kn_mmsi": int(jumps["mmsi"].nunique()),
        "parquet_bytes": pq.stat().st_size,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])

#!/usr/bin/env python
"""E3: hitung kejadian alih-muatan (aturan Miller) nyata pada DMA 2026-08-05.

Jarak pelabuhan tidak tersedia -> PROXY jarak dari daratan >= 10 km
(global_land_mask grid 0.01 derajat + distance transform), sesuai instruksi tugas; dicatat.
Dilaporkan TANPA klaim akurasi (protokol E3).
"""
import json
import numpy as np
import pandas as pd
from scipy.ndimage import distance_transform_edt
from global_land_mask import globe
from transshipment import detect

DATA = "/Users/ghaisan/Documents/Datathon/varuna/data/processed/dma/trajectories.parquet"
OUT = "/Users/ghaisan/Documents/Datathon/varuna/experiments/e3/transshipment_dma_events.json"
LAT0, LAT1, LON0, LON1, STEP = 50.0, 63.5, -12.0, 20.0, 0.01

lats = np.arange(LAT0, LAT1, STEP)
lons = np.arange(LON0, LON1, STEP)
lon_g, lat_g = np.meshgrid(lons, lats)
land = globe.is_land(lat_g, lon_g)
# sampling km per sel; skala lon pakai cos(56 deg) (lintang tengah perairan DK);
# ponytail: galat skala lon +-15% di tepi utara/selatan grid, cukup utk proxy 10 km — dicatat di manifest
km_lat = STEP * 111.32
km_lon = STEP * 111.32 * np.cos(np.radians(56.0))
dist_km = distance_transform_edt(~land, sampling=(km_lat, km_lon))

df = pd.read_parquet(DATA).dropna(subset=["sog"])
iy = ((df.lat - LAT0) / STEP).astype(int)
ix = ((df.lon - LON0) / STEP).astype(int)
inb = (iy >= 0) & (iy < len(lats)) & (ix >= 0) & (ix < len(lons))
df = df[inb].copy()
df["dist_port_km"] = dist_km[iy[inb], ix[inb]]

# prefilter kandidat utk hemat memori (kriteria sama dgn detect)
cand = df[(df.sog < 2.0) & (df.dist_port_km >= 10.0)]
events = detect(cand)

fishing_mmsi = set(df.loc[df.ship_type == "Fishing", "MMSI"].unique().tolist())
n_fish = sum(1 for e in events if e["mmsi1"] in fishing_mmsi or e["mmsi2"] in fishing_mmsi)
summary = {
    "n_events": len(events),
    "n_events_with_fishing_vessel": n_fish,
    "n_pairs": len({(e["mmsi1"], e["mmsi2"]) for e in events}),
    "rows_in_grid": int(len(df)),
    "candidate_rows": int(len(cand)),
    "events": events,
}
with open(OUT, "w") as f:
    json.dump(summary, f, indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != "events"}, indent=1))

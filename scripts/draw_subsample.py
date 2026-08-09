#!/usr/bin/env python3
"""Subsampel pra-deklarasi E1 (protokol beku freeze-eval-v1, seed 20260809).
Stratifikasi: tercile proporsi deteksi dekat-pantai (<=2 km) per scene, dari LABEL.
27 scene evaluasi (9/tercile) + 8 scene kalibrasi disjoint (3/3/2)."""
import csv, collections, pathlib
import numpy as np

BASE = pathlib.Path.home() / "Documents/Datathon/varuna"
rows = list(csv.DictReader(open(BASE / "data/raw/xview3/public.csv")))
per_scene = collections.defaultdict(lambda: [0, 0])
for r in rows:
    s = per_scene[r["scene_id"]]
    s[1] += 1
    try:
        if float(r["distance_from_shore_km"]) <= 2.0:
            s[0] += 1
    except ValueError:
        pass

scenes = sorted(per_scene)                       # leksikografis (protokol)
prop = {s: per_scene[s][0] / per_scene[s][1] for s in scenes}
ranked = sorted(scenes, key=lambda s: (prop[s], s))
t = len(ranked) // 3
terciles = [ranked[:t], ranked[t:2*t], ranked[2*t:]]

rng = np.random.default_rng(20260809)
eval_set, calib_set = [], []
for i, terc in enumerate(terciles):
    pick = rng.choice(sorted(terc), size=9, replace=False).tolist()
    eval_set += pick
    sisa = sorted(set(terc) - set(pick))
    n_cal = [3, 3, 2][i]
    calib_set += rng.choice(sisa, size=n_cal, replace=False).tolist()

out = BASE / "manifests/e1-scenes.txt"
with open(out, "w") as f:
    f.write("# Subsampel E1 pra-deklarasi. seed=20260809, protokol freeze-eval-v1.\n")
    f.write("# Stratifikasi tercile proporsi dekat-pantai (<=2km) dari public.csv (150 scene).\n")
    for s in eval_set:
        f.write(f"eval\t{s}\t{prop[s]:.4f}\n")
    for s in calib_set:
        f.write(f"calib\t{s}\t{prop[s]:.4f}\n")
print(f"eval={len(eval_set)} calib={len(calib_set)} (disjoint: {not set(eval_set)&set(calib_set)})")
print("proporsi dekat-pantai eval: min={:.3f} med={:.3f} max={:.3f}".format(
    min(prop[s] for s in eval_set),
    sorted(prop[s] for s in eval_set)[13],
    max(prop[s] for s in eval_set)))

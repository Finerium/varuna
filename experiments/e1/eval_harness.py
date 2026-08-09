#!/usr/bin/env python3
"""E1 eval harness (protokol freeze-eval-v1).

- Gabungkan CSV prediksi per-scene -> satu inference CSV, konversi probabilitas ke
  boolean memakai ambang RILIS juara (vessel 0.338, fishing 0.35).
- Poin estimate: panggil reference/metric.py RESMI apa adanya (subprocess CLI),
  flags: --drop_low_detect --costly_dist, toleransi 200 m, shore 2 km.
- CI bootstrap (B=1000, resample level scene, seed 20260809): orkestrasi fungsi
  per-scene dari metric.py resmi (tanpa modifikasi fungsi).

Pakai:
  .venv/bin/python eval_harness.py <pred_dir> <label_csv> <out_prefix> [shore_root]
"""
import json, pathlib, subprocess, sys

import numpy as np
import pandas as pd

BASE = pathlib.Path.home() / "Documents/Datathon/varuna"
METRIC_DIR = BASE / "models/xview3-reference/reference"
TH_VESSEL, TH_FISHING = 0.338, 0.350
SEED, B = 20260809, 1000


def build_inference_csv(pred_dir: pathlib.Path, out_csv: pathlib.Path) -> pd.DataFrame:
    parts = []
    for f in sorted(pred_dir.glob("*.csv")):
        df = pd.read_csv(f)
        parts.append(df)
    allp = pd.concat(parts).reset_index(drop=True)
    allp["is_vessel"] = allp["is_vessel_p"] >= TH_VESSEL
    allp["is_fishing"] = allp["is_fishing_p"] >= TH_FISHING
    allp.to_csv(out_csv, index=False)
    return allp


def official_point(inference_csv, label_csv, out_json, shore_root=None):
    cmd = [sys.executable, str(METRIC_DIR / "metric.py"),
           "--inference_file", str(pathlib.Path(inference_csv).resolve()),
           "--label_file", str(pathlib.Path(label_csv).resolve()),
           "--output", str(pathlib.Path(out_json).resolve()),
           "--distance_tolerance", "200",
           "--drop_low_detect", "--costly_dist"]
    if shore_root:
        cmd += ["--shore_tolerance", "2", "--shore_root", str(pathlib.Path(shore_root).resolve())]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=str(METRIC_DIR))
    return json.loads(pathlib.Path(out_json).read_text())


def bootstrap_ci(inference: pd.DataFrame, gt: pd.DataFrame):
    sys.path.insert(0, str(METRIC_DIR))
    from metric import (compute_loc_performance, calculate_p_r_f,
                        drop_low_confidence_preds, aggregate_f,
                        compute_vessel_class_performance,
                        compute_fishing_class_performance, compute_length_performance)
    gt_hm = gt[gt["confidence"].isin(["HIGH", "MEDIUM"])].reset_index(drop=True)
    inference = drop_low_confidence_preds(inference.reset_index(drop=True), gt.reset_index(drop=True),
                                          distance_tolerance=200, costly_dist=True)
    per_scene = {}
    for sid in gt_hm["scene_id"].unique():
        p = inference[inference["scene_id"] == sid].reset_index(drop=True)
        g = gt_hm[gt_hm["scene_id"] == sid].reset_index(drop=True)
        tp, fp, fn = compute_loc_performance(p, g, distance_tolerance=200, costly_dist=True)
        per_scene[sid] = {"tp": len(tp), "fp": len(fp), "fn": len(fn)}
    scenes = sorted(per_scene)
    rng = np.random.default_rng(SEED)
    f1s = []
    for _ in range(B):
        pick = rng.choice(scenes, size=len(scenes), replace=True)
        tp = sum(per_scene[s]["tp"] for s in pick)
        fp = sum(per_scene[s]["fp"] for s in pick)
        fn = sum(per_scene[s]["fn"] for s in pick)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * prec * rec / (prec + rec) if prec + rec else 0.0)
    lo, hi = np.percentile(f1s, [2.5, 97.5])
    return {"loc_f1_bootstrap_ci95": [float(lo), float(hi)], "B": B, "seed": SEED,
            "per_scene": per_scene}


def main():
    pred_dir = pathlib.Path(sys.argv[1])
    label_csv = pathlib.Path(sys.argv[2])
    out_prefix = pathlib.Path(sys.argv[3])
    shore_root = pathlib.Path(sys.argv[4]) if len(sys.argv) > 4 else None
    out_prefix.parent.mkdir(parents=True, exist_ok=True)

    inf_csv = out_prefix.with_suffix(".inference.csv")
    inference = build_inference_csv(pred_dir, inf_csv)
    print(f"prediksi: {len(inference)} baris, {inference['scene_id'].nunique()} scene")

    gt = pd.read_csv(label_csv)
    gt = gt[gt["scene_id"].isin(inference["scene_id"].unique())].reset_index(drop=True)
    print(f"GT: {len(gt)} baris ({(gt['confidence'].isin(['HIGH','MEDIUM'])).sum()} HIGH/MEDIUM)")

    point = official_point(inf_csv, label_csv, out_prefix.with_suffix(".point.json"), shore_root)
    print("POIN RESMI:", json.dumps(point, indent=1))

    ci = bootstrap_ci(inference, gt)
    print("CI: loc_f1 95%:", ci["loc_f1_bootstrap_ci95"])
    out_prefix.with_suffix(".ci.json").write_text(json.dumps(ci, indent=1))


if __name__ == "__main__":
    main()

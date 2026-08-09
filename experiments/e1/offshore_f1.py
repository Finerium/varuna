#!/usr/bin/env python3
"""F1 lepas pantai (offshore, >2 km dari garis pantai) — vonis pra-registrasi E1.

Cermin dari cabang near-shore di reference/metric.py:score(), tapi komplemennya:
  GT  offshore : distance_from_shore_km > 2
  pred offshore: pred yang TIDAK berada dalam (2 - 200m) km dari garis pantai,
                 memakai get_shore_preds() resmi lalu diambil komplemennya.
Margin -200 m itu simetri dari margin +200 m yang dipakai score() di sisi near-shore:
supaya pred di 1.9 km masih boleh menjodoh GT di 2.05 km (toleransi jarak 200 m).

metric.py TIDAK dimodifikasi; semua fungsi diimpor apa adanya.

Pakai:
  .venv/bin/python offshore_f1.py <inference_csv> <label_csv> <shore_root> <out_json>
  .venv/bin/python offshore_f1.py --selfcheck
"""
import json, pathlib, sys

import pandas as pd

BASE = pathlib.Path.home() / "Documents/Datathon/varuna"
METRIC_DIR = BASE / "models/xview3-reference/reference"
sys.path.insert(0, str(METRIC_DIR))

from metric import (  # noqa: E402
    calculate_p_r_f, compute_loc_performance, drop_low_confidence_preds, get_shore_preds,
)

DIST_TOL_M, SHORE_TOL_KM = 200, 2


def offshore_preds(pred_sc, shore_root, scene_id):
    """Pred yang jauh dari pantai = komplemen get_shore_preds pada radius 1.8 km."""
    near = get_shore_preds(pred_sc, shore_root, scene_id, SHORE_TOL_KM - DIST_TOL_M / 1000)
    return pred_sc.drop(index=near.index) if len(near) else pred_sc


def offshore_score(inference, gt_all, shore_root):
    """inference/gt_all mentah (GT masih termasuk LOW), seperti metric.main()."""
    gt_all = gt_all[gt_all["scene_id"].isin(inference["scene_id"].unique())].reset_index(drop=True)
    inference = drop_low_confidence_preds(
        inference, gt_all, distance_tolerance=DIST_TOL_M, costly_dist=True)
    gt = gt_all[gt_all["confidence"].isin(["HIGH", "MEDIUM"])].reset_index(drop=True)

    tp, fp, fn = [], [], []
    per_scene = {}
    for sid in gt["scene_id"].unique():
        g = gt[(gt["scene_id"] == sid) & (gt["distance_from_shore_km"] > SHORE_TOL_KM)]
        p = offshore_preds(inference[inference["scene_id"] == sid], shore_root, sid)
        if len(g) == 0 or len(p) == 0:
            # tanpa pasangan, tak ada yang bisa dijodohkan: hitung apa adanya
            fn += list(g.index)
            fp += list(p.index)
            per_scene[sid] = {"tp": 0, "fp": len(p), "fn": len(g)}
            continue
        t, f, n = compute_loc_performance(p, g, distance_tolerance=DIST_TOL_M, costly_dist=True)
        tp += t; fp += f; fn += n
        per_scene[sid] = {"tp": len(t), "fp": len(f), "fn": len(n)}

    prec, rec, f1 = calculate_p_r_f(tp, fp, fn)
    return {"offshore_precision": prec, "offshore_recall": rec, "offshore_fscore": f1,
            "tp": len(tp), "fp": len(fp), "fn": len(fn),
            "definisi": "GT distance_from_shore_km > 2 km; pred di luar radius 1.8 km dari kontur pantai",
            "per_scene": per_scene}


def selfcheck():
    """Pantai di baris 0 -> deteksi pada baris 100 (1 km) dekat, baris 500 (5 km) lepas pantai."""
    import tempfile, numpy as np
    with tempfile.TemporaryDirectory() as d:
        np.save(f"{d}/xp_shoreline.npy", np.array([[[0, 0]], [[0, 1000]]], dtype=object),
                allow_pickle=True)
        p = pd.DataFrame({"detect_scene_row": [100, 500], "detect_scene_column": [10, 10]})
        out = offshore_preds(p, d, "xp")
        assert list(out["detect_scene_row"]) == [500], out
    print("selfcheck OK: hanya deteksi >1.8 km yang lolos filter lepas pantai")


def main():
    if sys.argv[1:2] == ["--selfcheck"]:
        return selfcheck()
    inf_csv, label_csv, shore_root, out_json = sys.argv[1:5]
    res = offshore_score(pd.read_csv(inf_csv, index_col=False),
                         pd.read_csv(label_csv, index_col=False), shore_root)
    pathlib.Path(out_json).write_text(json.dumps(res, indent=1))
    print(json.dumps({k: v for k, v in res.items() if k != "per_scene"}, indent=1))


if __name__ == "__main__":
    main()

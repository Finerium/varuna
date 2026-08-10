# E2 training + evaluasi (protokol E2): HistGradientBoosting per jenis anomali,
# split BY MMSI 70/30 seed 20260809, precision/recall + Wilson 95% + kappa vs baseline trivial.
# Jalankan setelah fitur.py: .venv/bin/python experiments/e2/train_e2.py
import json
import pickle
from datetime import date

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import cohen_kappa_score

BASE = "."
OUT = f"{BASE}/experiments/e2/out"
SEED = 20260809
Z = 1.959963984540054


def wilson(k, n):
    if n == 0:
        return None
    p = k / n
    den = 1 + Z**2 / n
    ctr = (p + Z**2 / (2 * n)) / den
    hw = Z * np.sqrt(p * (1 - p) / n + Z**2 / (4 * n**2)) / den
    return [round(ctr - hw, 4), round(ctr + hw, 4)]


def pr_metrics(y, yhat):
    tp = int(((y == 1) & (yhat == 1)).sum())
    fp = int(((y == 0) & (yhat == 1)).sum())
    fn = int(((y == 1) & (yhat == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    return {
        "precision": round(prec, 4) if prec is not None else None,
        "precision_frac": f"{tp}/{tp + fp}",
        "ci_wilson_precision": wilson(tp, tp + fp),
        "recall": round(rec, 4) if rec is not None else None,
        "recall_frac": f"{tp}/{tp + fn}",
        "ci_wilson_recall": wilson(tp, tp + fn),
        "kappa": round(float(cohen_kappa_score(y, yhat)), 4),
    }


def main():
    feat_clean = pd.read_parquet(f"{OUT}/fitur_clean.parquet")
    feat_spoof = pd.read_parquet(f"{OUT}/fitur_spoof.parquet")
    labels = pd.read_parquet(f"{OUT}/labels.parquet")

    mmsi = np.sort(feat_clean.index.values)
    rng = np.random.default_rng(SEED)
    perm = rng.permutation(len(mmsi))
    n_train = int(round(0.7 * len(mmsi)))
    train_m = set(mmsi[perm[:n_train]])
    is_train = feat_clean.index.isin(train_m)

    tasks = {
        "gap6": feat_clean, "gap12": feat_clean,
        "ident_5nm": feat_clean, "ident_50kn": feat_clean,
        "spoof": feat_spoof,
    }
    results = {}
    for name, feat in tasks.items():
        X, y = feat.values, labels[name].values
        Xtr, ytr, Xte, yte = X[is_train], y[is_train], X[~is_train], y[~is_train]
        clf = HistGradientBoostingClassifier(
            random_state=SEED, early_stopping=True, validation_fraction=None, n_iter_no_change=20
        )
        clf.fit(Xtr, ytr)
        yhat = clf.predict(Xte)
        with open(f"{BASE}/experiments/e2/model_{name}.pkl", "wb") as f:
            pickle.dump({"model": clf, "features": list(feat.columns)}, f)

        # baseline trivial
        always = np.ones_like(yte)
        p_train = ytr.mean()
        brng = np.random.default_rng(SEED)
        rand = (brng.uniform(size=len(yte)) < p_train).astype(int)

        results[name] = {
            "n_train": int(len(ytr)), "n_pos_train": int(ytr.sum()),
            "n_test": int(len(yte)), "n_pos_test": int(yte.sum()),
            "model": pr_metrics(yte, yhat),
            "baseline_always_flag": pr_metrics(yte, always),
            "baseline_random_prop": {**pr_metrics(yte, rand), "p_flag": round(float(p_train), 4)},
            "train_curve_neg_loss": [round(float(s), 5) for s in clf.train_score_],
            "n_iter": int(clf.n_iter_),
        }
        print(name, json.dumps(results[name]["model"]))

    inj = pd.read_csv(f"{OUT}/injeksi.csv")
    manifest = {
        "run_id": f"e2-{date.today().isoformat()}",
        "tanggal": date.today().isoformat(),
        "seed": SEED,
        "protokol": "eval-protocol.md E2 (beku)",
        "data": {
            "sumber": "data/processed/dma/trajectories.parquet (aisdk-2026-08-05, Class A)",
            "n_baris": 9555850, "n_mmsi": int(len(mmsi)),
            "catatan_hari": "Hanya 1 hari data (2026-08-05); segmen kapal-hari == 1 segmen per MMSI; "
                            "protokol menyebut juga aisdk-2026-08-06 tetapi hanya 05 yang terproses.",
        },
        "split": {"unit": "MMSI (= segmen kapal-hari, 1 hari data)", "train": int(is_train.sum()),
                  "test": int((~is_train).sum()), "rasio": "70/30", "metode": "default_rng(20260809).permutation atas MMSI terurut"},
        "definisi_label": {
            "gap6": "MMSI dengan jeda transmisi > 6 jam saat underway (SOG>1 kn sebelum senyap), dari gap_candidates.csv",
            "gap12": "varian > 12 jam",
            "ident_5nm": "MMSI dengan loncatan implied speed > 50 kn DAN jarak > 5 nm (keputusan: irisan bermakna jarak, "
                         "menyaring glitch GPS; protokol literal hanya > 50 kn — KEDUANYA dilaporkan)",
            "ident_50kn": "varian literal protokol: implied speed > 50 kn saja",
            "spoof": "injeksi sintetis (label SINTETIS, bukan kejadian nyata)",
        },
        "injeksi_spoof": {
            "pra_registrasi": "digenerate sebelum model final (fitur.py dijalankan sebelum train_e2.py)",
            "mekanisme": "offset posisi permanen mulai satu transisi acak (1s<=dt<=3600s); implied speed transisi "
                         "= log-uniform 1.0x-3.0x ambang 50 kn; bearing acak; daftar di experiments/e2/out/injeksi.csv",
            "n_injeksi": int(len(inj)), "rasio": "5% dari 3134 segmen",
            "v_target_kn_range": [round(float(inj.v_target_kn.min()), 2), round(float(inj.v_target_kn.max()), 2)],
        },
        "model": "HistGradientBoostingClassifier default, random_state=20260809, early_stopping=True "
                 "(validation_fraction=None -> kurva skor latih tercatat), ambang keputusan 0.5 (default predict; "
                 "protokol tidak menetapkan ambang -> pilihan konservatif)",
        "fitur": list(feat_clean.columns),
        "hasil": results,
    }
    with open(f"{BASE}/manifests/e2-hasil.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print("manifest ditulis")


if __name__ == "__main__":
    main()

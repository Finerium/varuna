"""Kappa Cohen E8 dari dua lembar penilai + proporsi ber-CI (protokol §0.2, §0.5).

Jalankan:  .venv/bin/python experiments/e8/kappa.py
Self-check: .venv/bin/python experiments/e8/kappa.py --check
   (validasi instrumen: kappa kami vs sklearn.metrics.cohen_kappa_score + kasus
    buku teks kappa=0,4; syarat "instrument_validation" untuk kriteria numerik.)

Keluaran JSON: tabel silang, kappa, agreement mentah + Wilson 95%, bootstrap
percentile 95% kappa (B=1000, seed 20260809, resample per ITEM), daftar
ketidaksepakatan untuk diadjudikasi.
"""
import json
import math
import os
import sys

import numpy as np

AKAR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
E8 = os.path.join(AKAR, "experiments/e8")
SEED = 20260809
KELAS = ["terpenuhi", "parsial", "tidak"]


def wilson(x, n, z=1.96):
    """Interval Wilson 95% — protokol §0.2 mewajibkan untuk SEMUA proporsi."""
    if n == 0:
        return [0.0, 0.0]
    p = x / n
    d = 1 + z * z / n
    pusat = (p + z * z / (2 * n)) / d
    lebar = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, pusat - lebar), 4), round(min(1.0, pusat + lebar), 4)]


def tabel(a, b):
    """Tabel silang 3x3 (baris = penilai 1, kolom = penilai 2)."""
    t = np.zeros((len(KELAS), len(KELAS)), dtype=int)
    for x, y in zip(a, b):
        t[KELAS.index(x), KELAS.index(y)] += 1
    return t


def kappa_dari_tabel(t):
    """Cohen's kappa. None bila pe == 1 (tabel degenerat: satu kelas saja)."""
    n = t.sum()
    po = np.trace(t) / n
    pe = float((t.sum(axis=1) @ t.sum(axis=0)) / (n * n))
    if abs(1 - pe) < 1e-12:
        return None
    return (po - pe) / (1 - pe)


def baca_lembar(nama):
    with open(os.path.join(E8, nama), encoding="utf-8") as f:
        l = json.load(f)
    return l, {s["item"]: s["skor"] for s in l["skor"]}


def hitung():
    l1, s1 = baca_lembar("lembar-p1.json")
    l2, s2 = baca_lembar("lembar-p2.json")
    assert set(s1) == set(s2), "kedua lembar wajib menilai item yang sama"
    item = sorted(s1)  # urutan lembar berbeda by design; adu per ITEM, bukan per posisi
    a = [s1[i] for i in item]
    b = [s2[i] for i in item]

    t = tabel(a, b)
    n = len(item)
    setuju = int(np.trace(t))
    k = kappa_dari_tabel(t)

    rng = np.random.default_rng(SEED)
    boot, degenerat = [], 0
    for _ in range(1000):
        idx = rng.integers(0, n, n)
        kb = kappa_dari_tabel(tabel([a[i] for i in idx], [b[i] for i in idx]))
        boot.append(kb) if kb is not None else (degenerat := degenerat + 1)
    lo, hi = (np.percentile(boot, [2.5, 97.5]) if boot else (float("nan"),) * 2)

    return {
        "n_item": n,
        "penilai": [l1["penilai"], l2["penilai"]],
        "jenis_penilai": [l1["jenis_penilai"], l2["jenis_penilai"]],
        "kelas": KELAS,
        "tabel_silang": t.tolist(),
        "marginal_p1": {c: int(v) for c, v in zip(KELAS, t.sum(axis=1))},
        "marginal_p2": {c: int(v) for c, v in zip(KELAS, t.sum(axis=0))},
        "agreement": {
            "frac": f"{setuju}/{n}",
            "p": round(setuju / n, 4),
            "wilson95": wilson(setuju, n),
        },
        "kappa_cohen": round(k, 4),
        "kappa_bootstrap95": [round(float(lo), 4), round(float(hi), 4)],
        "kappa_bootstrap_catatan": (
            f"B=1000, seed {SEED}, resample per item; {degenerat} resample degenerat "
            "(pe=1) dibuang. N=20 membuat interval ini lebar dan hanya indikatif."
        ),
        "ketidaksepakatan": [
            {"item": i, "p1": s1[i], "p2": s2[i]} for i in item if s1[i] != s2[i]
        ],
    }


def check():
    from sklearn.metrics import cohen_kappa_score

    # Kasus buku teks: [[20,5],[10,15]] -> po=0,7 pe=0,5 kappa=0,4
    t = np.array([[20, 5], [10, 15]])
    n = t.sum()
    po = np.trace(t) / n
    pe = float((t.sum(axis=1) @ t.sum(axis=0)) / (n * n))
    assert abs((po - pe) / (1 - pe) - 0.4) < 1e-9, "rumus kappa meleset pada kasus buku teks"
    # Wilson 17/20: pusat 0,94604/1,19208 = 0,79361; lebar 0,183613/1,19208 = 0,15403
    # (hitungan tangan; statsmodels tidak terpasang di venv ini).
    lo, hi = wilson(17, 20)
    assert abs(lo - 0.6396) < 5e-4 and abs(hi - 0.9476) < 5e-4, f"Wilson meleset: {lo},{hi}"
    assert wilson(20, 20)[1] == 1.0 and wilson(0, 20)[0] == 0.0, "Wilson wajib terpotong di [0,1]"

    # Validasi instrumen pada data nyata: kappa kami harus sama dengan sklearn.
    _, s1 = baca_lembar("lembar-p1.json")
    _, s2 = baca_lembar("lembar-p2.json")
    item = sorted(s1)
    a, b = [s1[i] for i in item], [s2[i] for i in item]
    kami = kappa_dari_tabel(tabel(a, b))
    sk = cohen_kappa_score(a, b, labels=KELAS)
    assert abs(kami - sk) < 1e-12, f"kappa kami {kami} != sklearn {sk}"
    print(f"OK self-check kappa (buku teks 0,4; Wilson; kappa nyata {kami:.4f} == sklearn {sk:.4f})")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        print(json.dumps(hitung(), indent=1, ensure_ascii=False))

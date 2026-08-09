#!/usr/bin/env python3
"""E5 composer, lengan xView3 (protokol beku E5: >=45 inv dari scene berlabel GT).

Membangun investigasi evaluasi di experiments/e5/goldenset/ dari deteksi E1 nyata
(results/batch/*.csv) disilangkan ground truth public.csv DI RUANG PIKSEL
(kolom detect_scene_row/column; 10 m per piksel xView3). Status TIDAK ditulis
tangan: tiap inv dihitung via CLI gate (packages/core/bin/gate.ts) dengan
thresholds.lock.json, fungsi murni yang sama dengan produksi. Basis adjudikasi GT
dicatat TERPISAH dari artefak (manifests/e5-adjudikasi-basis.json) untuk penilai
buta. Deterministik: seed 20260809. Jalan ulang aman: inv ditimpa utuh.
"""
import csv, json, hashlib, math, pathlib, random, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BATCH = ROOT / "experiments/e1/results/batch"
GT = ROOT / "data/raw/xview3/public.csv"
OUT = ROOT / "experiments/e5/goldenset"
ADJ = ROOT / "manifests/e5-adjudikasi-basis.json"
LOCK = ROOT / "experiments/e5/thresholds.lock.json"
SEED = 20260809
OBJ_THR = 0.300          # ambang objectness E1 terkunci
MATCH_M = 200.0          # radius silang GT (meter; 20 piksel)
PX_M = 10.0              # jarak piksel xView3
PER_SCENE = 2
NOW = "2026-08-09T11:00:00Z"  # jam demo-frame, sama dengan rebuild demo set


def canon(a):
    b = {k: v for k, v in a.items() if k != "hash_sha256"}
    return hashlib.sha256(json.dumps(b, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def load_gt():
    rows = {}
    with open(GT) as fh:
        for r in csv.DictReader(fh):
            rows.setdefault(r["scene_id"], []).append(r)
    return rows


def nearest_px(gt_rows, row, col):
    best, bd = None, float("inf")
    for r in gt_rows:
        d = math.hypot(float(r["detect_scene_row"]) - row,
                       float(r["detect_scene_column"]) - col) * PX_M
        if d < bd:
            bd, best = d, r
    return best, bd


def gt_class(gt_row, dist):
    if gt_row is None or dist > MATCH_M:
        return "tanpa_label"
    if gt_row["is_vessel"].strip().lower() != "true":
        return "non_kapal"
    if gt_row["source"].strip() == "manual":
        return "gelap_gt"          # kapal terlihat radar TANPA korelasi AIS (GT resmi)
    return "ais_hadir"             # source ais atau ais/manual


def build_inv(scene, det, klas, gt_row, gt_dist, idx, thresholds):
    inv_id = f"inv-e5-{scene[:8]}-{idx:02d}"
    d = OUT / inv_id
    (d / "artifacts").mkdir(parents=True, exist_ok=True)
    art = {
        "art_id": f"a-e5-{scene[:8]}-{idx:02d}-001",
        "type": "sar_detection",
        "inv_id": inv_id,
        "t_tulis": NOW,
        "payload": {
            "scene_id": scene,
            "row": det["detect_scene_row"], "col": det["detect_scene_column"],
            "objectness_p": det["objectness_p"],
            "vessel_p": det["is_vessel_p"],
            "fishing_p": det["is_fishing_p"],
            "length_m_est": det["vessel_length_m"],
        },
        "source": {
            "provenance": (
                f"Deteksi E1 nyata (experiments/e1/results/batch/{scene}.csv, "
                f"ambang objectness {OBJ_THR}, tile 2048/stride 1536, fp16, TTA fliplr). "
                "Scene historis dataset xView3 direplay untuk evaluasi E5; usia bukti "
                "dihitung sejak ingest."
            ),
        },
    }
    art["hash_sha256"] = canon(art)
    (d / "artifacts" / f"{art['art_id']}.json").write_text(
        json.dumps(art, indent=1, ensure_ascii=False))
    (d / "grounding.json").write_text(json.dumps(
        {"art_ids": [art["art_id"]], "hash": {art["art_id"]: art["hash_sha256"]}},
        indent=1))
    gate_in = json.dumps({"artifacts": [art], "now": NOW, "thresholds": thresholds})
    r = subprocess.run(["npx", "tsx", str(ROOT / "packages/core/bin/gate.ts")],
                       input=gate_in, capture_output=True, text=True,
                       cwd=ROOT / "packages/core")
    if r.returncode != 0:
        sys.exit(f"gate gagal {inv_id}: {r.stderr.strip()[:300]}")
    status = json.loads(r.stdout)
    (d / "investigation.json").write_text(json.dumps({
        "inv_id": inv_id, "arm": "xview3", "status_server": status,
        "artifacts": [art["art_id"]], "t_now_frame": NOW,
    }, indent=1, ensure_ascii=False))
    basis = {
        "inv_id": inv_id, "kelas_gt": klas, "scene_id": scene,
        "gt_jarak_m": None if gt_row is None else round(gt_dist, 1),
        "gt_source": None if gt_row is None else gt_row["source"],
        "gt_is_vessel": None if gt_row is None else gt_row["is_vessel"],
        "gt_is_fishing": None if gt_row is None else gt_row["is_fishing"],
        "gt_confidence": None if gt_row is None else gt_row["confidence"],
        "gt_shore_km": None if gt_row is None else gt_row["distance_from_shore_km"],
        "status_gate": status.get("status"),
    }
    return inv_id, basis


def main():
    rng = random.Random(SEED)
    thresholds = {k: v for k, v in json.loads(LOCK.read_text()).items()
                  if k in ("usia_max_h", "ambang_kn", "konflik_jendela_jam")}
    gt = load_gt()
    csvs = sorted(BATCH.glob("*.csv"))
    if not csvs:
        sys.exit("tidak ada CSV batch")
    adjudikasi, dibangun, lewat = [], [], []
    for f in csvs:
        scene = f.stem
        if scene not in gt:
            lewat.append((scene, "scene tanpa GT public.csv"))
            continue
        dets = []
        with open(f) as fh:
            for r in csv.DictReader(fh):
                if float(r.get("objectness_p") or 0) < OBJ_THR:
                    continue
                dets.append({k: float(r[k]) for k in
                             ("vessel_length_m", "detect_scene_row",
                              "detect_scene_column", "objectness_p",
                              "is_vessel_p", "is_fishing_p") if r.get(k) not in ("", None)})
        if not dets:
            lewat.append((scene, "nol deteksi >= ambang"))
            continue
        per_klas = {}
        for det in dets:
            row, dist = nearest_px(gt[scene], det["detect_scene_row"],
                                   det["detect_scene_column"])
            per_klas.setdefault(gt_class(row, dist), []).append((det, row, dist))
        ordered = [k for k in ("gelap_gt", "ais_hadir", "non_kapal", "tanpa_label")
                   if k in per_klas]
        idx = 1
        for k in ordered[:PER_SCENE]:
            kandidat = sorted(per_klas[k], key=lambda x: -x[0]["objectness_p"])
            det, row, dist = kandidat[rng.randrange(min(3, len(kandidat)))]
            inv_id, basis = build_inv(scene, det, k, row, dist, idx, thresholds)
            idx += 1
            dibangun.append(inv_id)
            adjudikasi.append(basis)
    ADJ.write_text(json.dumps({
        "seed": SEED, "ambang_objectness": OBJ_THR, "radius_silang_m": MATCH_M,
        "ruang_silang": "piksel (10 m/px)",
        "kelas": sorted({b["kelas_gt"] for b in adjudikasi}),
        "n_inv": len(dibangun), "basis": adjudikasi,
        "catatan": "Basis GT untuk penilai buta E5; BUKAN artefak investigasi. "
                   "Lengan Natuna + sintetis dikomposisi terpisah sebelum lock "
                   "e5-goldenset.json.",
    }, indent=1, ensure_ascii=False))
    print(f"terbangun {len(dibangun)} inv dari {len(csvs)} CSV")
    for s, alasan in lewat:
        print(f"LEWAT {s}: {alasan}")
    from collections import Counter
    print("kelas:", dict(Counter(b["kelas_gt"] for b in adjudikasi)))
    print("status:", dict(Counter(b["status_gate"] for b in adjudikasi)))


if __name__ == "__main__":
    main()

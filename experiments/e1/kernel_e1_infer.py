#!/usr/bin/env python3
"""E1 — Inferensi detektor juara-1 xView3 (traced ensemble, MIT) pada subsampel
pra-deklarasi (manifests/e1-scenes.txt, protokol freeze-eval-v1).

Didesain untuk Kaggle GPU kernel (internet ON):
  - clone repo juara (kode inferensi resmi dipakai apa adanya)
  - unduh traced_ensemble.jit dari GitHub release (URL publik stabil)
  - loop: unduh scene tar.gz (URL presigned) -> ekstrak -> prediksi -> CSV -> hapus citra
  - keluaran: predictions/<scene_id>.csv + run manifest JSON

Konfigurasi inferensi = PERSIS rilis juara (tile 2048, step 1536, fp16, TTA fliplr
tertanam di graf traced, ambang 0.300/0.338/0.350). Berlaku untuk SEMUA kondisi E1.
METADATA_* diisi dari checkpoint b4_fold0 (lihat manifests/e1-metadata.json).
"""
import gc, json, os, pathlib, shutil, subprocess, sys, tarfile, time, urllib.request

WORK = pathlib.Path("/kaggle/working") if pathlib.Path("/kaggle").exists() else pathlib.Path.cwd() / "e1_work"
REPO = WORK / "xview3-first-place"
WEIGHTS = WORK / "traced_ensemble.jit"
PRED_DIR = WORK / "predictions"
SCENES_DIR = WORK / "scenes"

REPO_URL = "https://github.com/DIUx-xView/xView3_first_place"
JIT_URL = f"{REPO_URL}/releases/download/1.1/traced_ensemble.jit"

# ---- diisi dari checkpoint metadata (manifests/e1-metadata.json) ----
METADATA_CHANNELS = None        # mis. ["vv","vh"]
METADATA_NORMALIZATION = None   # dict config albumentations dari checkpoint
METADATA_CODER = None           # kwargs MultilabelCircleNetCoder dari checkpoint
# ---------------------------------------------------------------------

THRESHOLDS = {"objectness": 0.300, "vessel": 0.338, "fishing": 0.350}
TILE_SIZE, TILE_STEP = 2048, 1536
MAX_OBJECTS = 2048


def sh(cmd, **kw):
    print("+", cmd, flush=True)
    subprocess.run(cmd, shell=True, check=True, **kw)


def fetch(url, dest, resume=True):
    dest = pathlib.Path(dest)
    have = dest.stat().st_size if (resume and dest.exists()) else 0
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                               "Range": f"bytes={have}-"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "ab" if have else "wb") as f:
        if r.status == 200 and have:
            f.seek(0); f.truncate()
        shutil.copyfileobj(r, f, length=1 << 22)
    return dest


def setup():
    WORK.mkdir(parents=True, exist_ok=True)
    PRED_DIR.mkdir(exist_ok=True)
    SCENES_DIR.mkdir(exist_ok=True)
    if not REPO.exists():
        sh(f"git clone --depth 1 {REPO_URL} {REPO}")
    if not WEIGHTS.exists() or WEIGHTS.stat().st_size < 1_200_000_000:
        print("unduh traced_ensemble.jit ...", flush=True)
        fetch(JIT_URL, WEIGHTS)
    sh("pip install -q rasterio tifffile omegaconf fire pytorch-toolbelt albumentations opencv-python-headless")
    sys.path.insert(0, str(REPO))


def build_runtime():
    import albumentations  # noqa
    import torch
    from xview3.factory import build_normalization
    from xview3.centernet.bboxer.multilabel_circle_coder import MultilabelCircleNetCoder
    from omegaconf import OmegaConf

    assert METADATA_CHANNELS and METADATA_NORMALIZATION and METADATA_CODER, \
        "isi METADATA_* dari manifests/e1-metadata.json dulu"
    normalization = build_normalization(OmegaConf.create(METADATA_NORMALIZATION))
    box_coder = MultilabelCircleNetCoder(image_size=(TILE_SIZE, TILE_SIZE), **METADATA_CODER)
    model = torch.jit.load(str(WEIGHTS), map_location="cuda")
    model.eval()
    return model, box_coder, normalization


def run_scene(model, box_coder, normalization, scene_dir):
    from xview3.inference import predict_multilabel_scenes
    df = predict_multilabel_scenes(
        model=model, box_coder=box_coder, scenes=[str(scene_dir)],
        channels=METADATA_CHANNELS, tile_step=TILE_STEP, tile_size=TILE_SIZE,
        objectness_thresholds_lower_bound=THRESHOLDS["objectness"],
        normalization=normalization, accumulate_on_gpu=False, fp16=True,
        batch_size=1, apply_activation=False, save_raw_predictions=False,
        max_objects=MAX_OBJECTS, channels_last=False, output_predictions_dir=None,
    )
    return df


def main(manifest_path):
    """manifest: baris 'scene_id<TAB>url_presigned' (dibuat lokal dari public.txt)."""
    setup()
    model, box_coder, normalization = build_runtime()
    rows = [l.strip().split("\t") for l in open(manifest_path) if "\t" in l]
    run_meta = {"scenes": [], "config": {"tile": TILE_SIZE, "step": TILE_STEP,
                "fp16": True, "tta": "fliplr(traced)", "thresholds": THRESHOLDS}}
    for sid, url in rows:
        out_csv = PRED_DIR / f"{sid}.csv"
        if out_csv.exists():
            print(sid, "sudah ada, lewati"); continue
        t0 = time.time()
        tgz = SCENES_DIR / f"{sid}.tar.gz"
        fetch(url, tgz)
        with tarfile.open(tgz) as t:
            t.extractall(SCENES_DIR)
        tgz.unlink()
        t_dl = time.time() - t0
        t1 = time.time()
        df = run_scene(model, box_coder, normalization, SCENES_DIR / sid)
        t_inf = time.time() - t1
        df.to_csv(out_csv, index=False)
        shutil.rmtree(SCENES_DIR / sid, ignore_errors=True)
        gc.collect()
        run_meta["scenes"].append({"scene": sid, "n_det": len(df),
                                   "t_unduh_s": round(t_dl, 1), "t_infer_s": round(t_inf, 1)})
        print(f"{sid}: {len(df)} deteksi, unduh {t_dl:.0f}s, infer {t_inf:.0f}s", flush=True)
        json.dump(run_meta, open(WORK / "run_manifest.json", "w"), indent=1)
    print("E1 KERNEL SELESAI")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(WORK / "scene_manifest.tsv"))

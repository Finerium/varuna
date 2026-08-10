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
TMP = pathlib.Path("/kaggle/tmp") if pathlib.Path("/kaggle").exists() else WORK / "tmp"
TMP.mkdir(parents=True, exist_ok=True)
REPO = TMP / "xview3-first-place"
WEIGHTS = TMP / "traced_ensemble.jit"
PRED_DIR = WORK / "predictions"
SCENES_DIR = TMP / "scenes"

REPO_URL = "https://github.com/DIUx-xView/xView3_first_place"
JIT_URL = f"{REPO_URL}/releases/download/1.1/traced_ensemble.jit"

# ---- metadata tertanam (dari checkpoint b4_fold0; manifests/e1-metadata.json) ----
META = json.loads("{\n \"sumber\": \"b4_fold0 checkpoint (release 1.0) checkpoint_data.config\",\n \"channels\": [\n  \"vh\",\n  \"vv\"\n ],\n \"num_channels\": 2,\n \"normalization\": {\n  \"slug\": \"fixed\",\n  \"channels\": {\n   \"vv\": {\n    \"_target_\": \"xview3.SigmoidNormalization\",\n    \"midpoint\": -20.0,\n    \"temperature\": 0.18\n   },\n   \"vh\": {\n    \"_target_\": \"xview3.SigmoidNormalization\",\n    \"midpoint\": -20.0,\n    \"temperature\": 0.18\n   },\n   \"diff(vv,vh)\": {\n    \"_target_\": \"xview3.SigmoidNormalization\",\n    \"midpoint\": -5.0,\n    \"temperature\": 0.18\n   },\n   \"mean(vv,vh)\": {\n    \"_target_\": \"xview3.SigmoidNormalization\",\n    \"midpoint\": -20,\n    \"temperature\": 0.18\n   },\n   \"bathymetry\": {\n    \"_target_\": \"xview3.CubicRootNormalization\"\n   },\n   \"wind_direction\": null,\n   \"wind_speed\": null,\n   \"mask\": null\n  }\n },\n \"box_coder\": {\n  \"_target_\": \"xview3.centernet.MultilabelCircleNetCoder\",\n  \"image_size\": [\n   1024,\n   1024\n  ],\n  \"max_objects\": 512,\n  \"heatmap_encoding\": \"umich\",\n  \"labels_encoding\": \"circle\",\n  \"ignore_value\": {\n   \"_target_\": \"xview3.ignore_value\"\n  },\n  \"fixed_radius\": 3,\n  \"labels_radius\": 1,\n  \"ignore_low_confidence_detections\": true\n },\n \"head\": {\n  \"_target_\": \"xview3.centernet.models.heads.DecoupledHeadGroupNormLateShuffle\",\n  \"classifier_dim\": 128,\n  \"objectness_dim\": 128,\n  \"size_dim\": 64,\n  \"offset_dim\": 16,\n  \"dropout_rate\": 0.1,\n  \"activation\": \"silu\",\n  \"num_blocks\": 3\n },\n \"encoder_target\": \"pytorch_toolbelt.modules.encoders.TimmB4Encoder\",\n \"catatan_stride\": \"output_stride = encoder.strides[0] // (head.upsample_factor * input_upsample_factor); slug b4_unet_s2 (stride 2)\",\n \"thresholds_rilis\": {\n  \"objectness\": 0.3,\n  \"vessel\": 0.338,\n  \"fishing\": 0.35\n },\n \"tile\": {\n  \"size\": 2048,\n  \"step\": 1536\n },\n \"fp16\": true,\n \"tta\": \"fliplr (tertanam di traced graph)\"\n}")
METADATA_CHANNELS = META["channels"]            # ['vh', 'vv']
METADATA_NORMALIZATION = META["normalization"]  # SigmoidNormalization per kanal
METADATA_BOX_CODER = META["box_coder"]          # target hydra + kwargs
OUTPUT_STRIDE = 2  # slug b4_unet_s2; strides[0]=4 // head LateShuffle upsample 2
# ------------------------------------------------------------------------

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


def stage(m):
    print(f"### TAHAP: {m}", flush=True)


def setup():
    WORK.mkdir(parents=True, exist_ok=True)
    PRED_DIR.mkdir(exist_ok=True)
    SCENES_DIR.mkdir(exist_ok=True)
    stage("clone repo")
    if not REPO.exists():
        sh(f"git clone --depth 1 {REPO_URL} {REPO}")
    stage("unduh jit")
    if not WEIGHTS.exists() or WEIGHTS.stat().st_size < 1_200_000_000:
        print("unduh traced_ensemble.jit ...", flush=True)
        fetch(JIT_URL, WEIGHTS)
    stage("pip install")
    gpu = subprocess.run("nvidia-smi --query-gpu=name --format=csv,noheader", shell=True,
                         capture_output=True, text=True).stdout.strip()
    print("GPU terdeteksi:", gpu, flush=True)
    assert "torch" not in sys.modules, "torch terlanjur diimport sebelum swap"
    pra_sm70 = any(k in gpu for k in ("P100", "K80"))
    if pra_sm70:
        stage("GPU pra-sm70: swap torch ke cu118 (sm_60 didukung) SEBELUM import torch")
        sh("pip install -q --force-reinstall torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu118")

    # ---- Jangan lawan pin numpy image. Akar 12+ kegagalan sekarang jelas: image
    # mengunci numpy==2.0.2 (PIP_CONSTRAINT Kaggle, upgrade tak nempel) TAPI membawa
    # scipy 1.14 yang memanggil simbol numpy>=2.1 (_blas_supports_fpe, _center) yang
    # tak ada di 2.0.2 -> crash import albumentations/skimage/scipy. Menurunkan numpy
    # memicu ABI 'dtype size changed 96 vs 88' (opencv/skimage ter-compile numpy-2).
    # Solusi bersih & minimal: BIARKAN numpy 2.0.2 (ABI cocok seluruh paket image),
    # TURUNKAN scipy -> 1.13.1 (mendukung numpy 2.0, ABI numpy-2, tak pernah memanggil
    # simbol numpy>=2.1). Bersihkan PIP_CONSTRAINT khusus langkah scipy.
    # numpy image ternyata FRANKENSTEIN: core .so 2.0.2 tapi file .py 2.4.4 nyelip
    # (numpy.testing/utils.py 2.4.4 memanggil _blas_supports_fpe yang tak ada di core
    # 2.0.2). Force-reinstall numpy 2.0.2 utuh (py+core koheren) + scipy 1.13.1
    # (tak memanggil simbol itu). Keduanya ABI numpy-2.0, cocok opencv/skimage image.
    stage("koherenkan numpy 2.0.2 + scipy 1.13.1 (perbaiki frankenstein numpy)")
    sh("PIP_CONSTRAINT= pip install -q --force-reinstall --no-deps 'numpy==2.0.2' 'scipy==1.13.1'")
    # albumentations 1.3.1: champion impor _maybe_process_in_chunks dari
    # albumentations.augmentations.functional, yang dihapus di 1.4.x bawaan image.
    # 1.3.1 pure-python (ABI tak relevan) + masih punya fungsi itu; alias numpy-1 di
    # build_runtime menutup np.float dst.
    sh("PIP_CONSTRAINT= pip install -q --no-deps --force-reinstall 'albumentations==1.3.1' 'qudida==0.0.4' 'timm==0.4.12' 'pytorch_toolbelt==0.5.2'")
    sh("pip install -q hydra-core omegaconf fire")
    sys.path.insert(0, str(REPO))
    sh("python -c \"import numpy,scipy; print('VERSI numpy',numpy.__version__,'scipy',scipy.__version__)\"")
    stage("setup selesai (scipy 1.13.1 / numpy 2.0.2)")


def _shim_legacy_imports():
    """Alias modul legacy timm 0.4.x -> lokasi modern, kalau pin gagal terpasang."""
    import sys, types, importlib
    def alias(old_name, candidates):
        if old_name in sys.modules: return
        try:
            importlib.import_module(old_name); return
        except ModuleNotFoundError: pass
        for cand in candidates:
            try:
                src = importlib.import_module(cand)
            except ModuleNotFoundError: continue
            shim = types.ModuleType(old_name)
            for k in dir(src): setattr(shim, k, getattr(src, k))
            sys.modules[old_name] = shim
            print(f"shim: {old_name} -> {cand}", flush=True); return
    alias("albumentations.augmentations.functional", ["albumentations.augmentations.utils", "albucore.utils", "albucore"])
    alias("timm.models.efficientnet_blocks", ["timm.models._efficientnet_blocks", "timm.layers"])
    alias("timm.models.layers", ["timm.layers"])

    # stub universal utk framework training yang TIDAK dipakai inferensi
    class _DummyMeta(type):
        def __getattr__(cls, k): return _mkdummy(k)
    def _mkdummy(name):
        return _DummyMeta(str(name), (object,), {
            "__init__": (lambda self, *a, **k: None),
            "__call__": (lambda self, *a, **k: None)})
    class _StubModule(types.ModuleType):
        def __getattr__(self, k):
            if k.startswith("__") and k not in ("__all__",): raise AttributeError(k)
            if k == "__all__": return []
            return _mkdummy(k)
    for name in ("catalyst", "catalyst.dl", "catalyst.core", "catalyst.core.callback",
                 "catalyst.callbacks", "catalyst.contrib", "catalyst.contrib.nn",
                 "catalyst.data", "catalyst.runners", "catalyst.utils",
                 "pytorch_toolbelt.utils.catalyst", "pytorch_toolbelt.utils.catalyst.pipeline"):
        if name not in sys.modules:
            sys.modules[name] = _StubModule(name)
    print("stub catalyst terpasang", flush=True)


def build_runtime():
    stage("build runtime: import")
    import numpy as _np  # kembalikan alias yang dihapus numpy-2 utk kode champion era numpy-1
    for _a, _t in (("float", float), ("int", int), ("bool", bool), ("object", object),
                   ("str", str), ("complex", complex), ("long", int), ("unicode", str)):
        if not hasattr(_np, _a):
            setattr(_np, _a, _t)
    print("numpy", _np.__version__, "| alias numpy-1 dikembalikan", flush=True)
    _shim_legacy_imports()
    import albumentations  # noqa
    import torch
    from xview3.factory import build_normalization
    from omegaconf import OmegaConf

    from hydra.utils import instantiate
    normalization = build_normalization(OmegaConf.create(METADATA_NORMALIZATION))
    coder_cfg = OmegaConf.create(METADATA_BOX_CODER)
    box_coder = instantiate(coder_cfg, output_stride=OUTPUT_STRIDE)
    box_coder = box_coder.box_coder_for_image_size((TILE_SIZE, TILE_SIZE))
    stage("jit load")
    import subprocess as sp
    print(sp.run("nvidia-smi --query-gpu=name,memory.total --format=csv", shell=True, capture_output=True, text=True).stdout, flush=True)
    print("torch", torch.__version__, "| cuda", torch.version.cuda,
          "| capability", torch.cuda.get_device_capability(0) if torch.cuda.is_available() else "NO-CUDA",
          "| archs", torch.cuda.get_arch_list(), flush=True)
    model = torch.jit.load(str(WEIGHTS), map_location="cpu")
    print("jit load CPU OK", flush=True)
    model = model.cuda()
    x = torch.zeros(1, 2, TILE_SIZE, TILE_SIZE, device="cuda")
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
        out = model(x)
    print("forward cuda 2048 OK:", type(out), flush=True)
    del x, out; torch.cuda.empty_cache()
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


def main_dataset_flat(dataset_dir):
    """E1b Natuna: dua scene 2026 (S1A jun, S1D jul), file rata ber-prefix
    '<scene>__VH_dB.tif'. Susun ulang direktori scene via symlink, lalu
    inferensi identik E1. Tanpa label -> keluaran = deteksi + statistik
    pergeseran domain (dibahas paper 4.2), bukan skor."""
    import pandas as pd
    setup()
    model, box_coder, normalization = build_runtime()
    # rglob (bukan glob rata) supaya tahan struktur mount Kaggle yang mungkin bersarang;
    # bangun peta sid -> {pol: path nyata} dan symlink dari path yang benar-benar ada.
    tifs = sorted(dataset_dir.rglob("*__V*_dB.tif")) or sorted(dataset_dir.rglob("*_dB.tif"))
    if not tifs:
        print("DEBUG isi dataset_dir:", [str(p) for p in dataset_dir.rglob("*")][:40], flush=True)
    per_scene = {}
    for p in tifs:
        sid, _, rest = p.name.partition("__")
        pol = rest.split("_")[0] if rest else "VH"      # "VH"/"VV"
        per_scene.setdefault(sid, {})[pol] = p
    scenes = sorted(per_scene)
    print("scene ditemukan:", scenes, "| n_tif:", len(tifs), flush=True)
    hasil_meta = []
    for sid in scenes:
        sdir = SCENES_DIR / sid
        sdir.mkdir(parents=True, exist_ok=True)
        for pol in ("VH", "VV"):
            tautan = sdir / f"{pol}_dB.tif"
            src = per_scene[sid].get(pol)
            if src and not tautan.exists():
                tautan.symlink_to(src)
        t0 = time.time()
        df = run_scene(model, box_coder, normalization, sdir)
        t_inf = time.time() - t0
        df["scene_id"] = sid
        (PRED_DIR / f"{sid}.csv").write_text(df.to_csv(index=False))
        hasil_meta.append({"scene": sid, "n_det": len(df), "t_inferensi_s": round(t_inf, 1)})
        print("SELESAI", hasil_meta[-1], flush=True)
    (WORK / "run_manifest_natuna.json").write_text(json.dumps({
        "scenes": hasil_meta,
        "config": {"tile": TILE_SIZE, "step": TILE_STEP, "fp16": True,
                    "tta": "fliplr(traced)", "thresholds": THRESHOLDS},
        "catatan": "E1b pergeseran domain Natuna; preprocessing sar_grd_to_xview3.py "
                   "paritas-terverifikasi; tanpa label."}, indent=1))


if __name__ == "__main__":
    PRED_DIR.mkdir(parents=True, exist_ok=True)
    root = pathlib.Path("/kaggle/input")
    print("DEBUG /kaggle/input:", [p.name for p in root.iterdir()] if root.exists() else "TAK ADA", flush=True)
    ds = pathlib.Path("/kaggle/input/varuna-natuna-s1-2026")
    if root.exists() and not any(ds.rglob("*_dB.tif")):
        for d in root.iterdir():                      # cari dir mana pun yg punya *_dB.tif
            if d.is_dir() and any(d.rglob("*_dB.tif")):
                ds = d
                print("DEBUG dataset ditemukan di:", str(ds), flush=True)
                break
    main_dataset_flat(ds)

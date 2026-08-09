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
    if any(k in gpu for k in ("P100", "K80")):
        stage("GPU pra-sm70: swap torch ke cu118 (sm_60 didukung) SEBELUM import torch")
        sh("pip install -q --force-reinstall torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu118")
    sh("pip install -q hydra-core rasterio tifffile omegaconf fire opencv-python-headless")
    sh("pip install -q --no-deps timm==0.4.12 pytorch_toolbelt==0.5.2 albumentations==1.1.0 qudida==0.0.4")
    sys.path.insert(0, str(REPO))
    stage("setup selesai")


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


def main(manifest_path):
    """manifest: baris 'scene_id<TAB>url_presigned' (dibuat lokal dari public.txt)."""
    setup()
    model, box_coder, normalization = build_runtime()
    rows = [l.strip().split("\t") for l in open(manifest_path) if "\t" in l]
    run_meta = {"scenes": [], "config": {"tile": TILE_SIZE, "step": TILE_STEP,
                "fp16": True, "tta": "fliplr(traced)", "thresholds": THRESHOLDS}}
    gagal = []
    for sid, url in rows:
        out_csv = PRED_DIR / f"{sid}.csv"
        if out_csv.exists():
            print(sid, "sudah ada, lewati"); continue
        t0 = time.time()
        tgz = SCENES_DIR / f"{sid}.tar.gz"
        try:
            fetch(url, tgz)
        except Exception as e:
            print(f"GAGAL-UNDUH {sid}: {e}; lanjut scene berikutnya", flush=True)
            gagal.append(sid); continue
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
    print("E1 KERNEL SELESAI; gagal-unduh:", gagal)


SMOKE_TSV = "05bc615a9b0e1159t\thttps://xview3downloads.xview.us/train/05bc615a9b0e1159t.tar.gz?Expires=1786264036&Signature=KkKqsIIgNR~iOOjc85R07jWUYop~7zkFUFbT9Z2LKLOjERESjWJz0asQixZEZ643V1s8IShz7i89BIA9xzu4Hezt9LS~gIMkqzEGoVUo38aYprLX92siMEo-GvzrvHXrPTIl2ytB4TBhDKH99SV2sVvU1Pa1ILcqQWgP-C0e4Ipqo-S9tWzmekR4YzaQRBmkyrnBs5l0Yecn8sJN~ijc4vNCz4Ve4bn5gQmUGKOAZh2HkqRYsTT7g48k0Lz81G-~e8~cjOMc~pBxfVyj~tFDNQsw-n4BJ3n5iwhHbC4FN0BlOX~LyYojXGoehv5Xy54vpAnGcG97HzRWV2lBdnL6yg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n"
FULL_TSV = "1c904ce36a05bdddp\thttps://xview3downloads.xview.us/public/1c904ce36a05bdddp.tar.gz?Expires=1786288363&Signature=Z7DKMER1dARc7FgmEIBc4yzcyvqDciLw21cdRll41jJCVMpJgV1l6A-0MVB9~YfCkmNPrUejiytxra0neWC4dCj79viDEfH9-5vZs-8IXU82j7voAV6STrKkO4SViqPnsFdIq6SL4sv7Fno632~N0MDMhMxh5zxmyGtyORgw4UefQCib4-k~Uah-ddRK8plt6DDgyz9L1Dj~MtPDR9UaW3PRd7fYzqwyA0pGYe1-TP2iR7AEOjSWulLqi~64oFEu8gSYqfF5aRjDbu1I-Y4xz1I-UhsusTCR5eERlN0Oey74cgoirRmVeAXMc7udbHTXgPIh6pKiHmhEgbbIpqn2Bw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n4f1ac44118a7cc96p\thttps://xview3downloads.xview.us/public/4f1ac44118a7cc96p.tar.gz?Expires=1786288364&Signature=kRGey2MjZwnwTsl~eYUmcU5N8cGrE-nstp4x53-R1ifzhPQK2QgEQAPUaG4J0aI5tScjTxb-iFJXTNAgm~cud6rtMABrPtjQxn27r1ZCmaOHuo9mCXaOPhcBT0RuIFoFMRTtCc1LgTasSaGmlLj7jXyUB5PK7L2Lu-vFD~D7QeQhWOGvT1yjbm2Jx-qu~qjoN3u4Op8Xrx2NwTcmFntZgjr1J5bvC3wZLFr0GUHLy-xj7x7JP~0gtoiBl10D4cxDqaLXvLMe8dFjCYemxetHqSRcYYq4b8ez~-gEhoxvVqK3gbEv3PqDcyTz2---kNUYpwYKxYDDxPeTgTwnVSXvMg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n97e4833c46771a67p\thttps://xview3downloads.xview.us/public/97e4833c46771a67p.tar.gz?Expires=1786288363&Signature=IXZ1KDANtI5zvGiC--YRs4fEaYVvS9Wz~gE~ia6MhkJ7yhhYdue2HWT0sguA25V-XIXNSb3GFjadtZpg7GGwvkpCW7S7CWPiIb19iTVFpU490EPzHEVZHA3o97trHeeolWUZjJhnbwiQsJtPf2WQcbjplZ413drvib9KHbjtJqlMvEM4FjUGn6MuCk5Smvf1CXiBs9R9WERHHfenqIeJI5lTI0tsH8HgRF9OZhbYi5P7a~CCjd1V04VOqh6CAOZe6ykusDYA92AYdf9WDGAnN~K3hhBxvkNtptH-3O8xYPj3J329zdnMdXNcvemjZEd7cWmKQ3maBe8lcjBUBWLktw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n6ed4301901fa31fbp\thttps://xview3downloads.xview.us/public/6ed4301901fa31fbp.tar.gz?Expires=1786288363&Signature=MutWABHGgXAUrEh2MX7vWVa2XERze1Zd7TS2mpXsQWXmNKGxKWC0i8~c2nr~KwPhDEDnh0oczvRAcidErc~I8y0eBkyJ80SfDKf-UH2ZGcFY5qQS2jBiPfWiJvQc0h-KkKfIji1Vru-XH17FI3nFdZh~oB8Lfq62Q~qwLAxI0u0yUoPXG68Mq-LG1EcRaRkD2OfG2ptcVGwxOQpk3XLcJ2fq5juXFDutUFA9S0gn8uBbbymaL1hGuU9yrdMxYdV8mBbTUqhsoS~pFd99~8~T593AvFZpDw1QhDCk3y5oAjDBI2okZzwhfxnYdJHOOm4xVlQjHqDtTEAyYA-hH9-Dtw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n5af616b150417f93p\thttps://xview3downloads.xview.us/public/5af616b150417f93p.tar.gz?Expires=1786288364&Signature=mtxPZpc92ZKJetk223bgVQgCnYd7uwpqQ~1BhR6oTo5hXTTJF0SrSGCmhlxGBFboK2TULxzcpgzsU0MpNBDNOCAgJoebu2OBSWcBgmdWPaoeBCVdkx1LrMpcgvxB26dOJLupVjxyFGxp2cWU9G8xDZBf5st83UU4kK68x3wv-nyf05~MSMm4fOCgrTtk-yRILQGfhqyR5r1lMYblRD9wQj6WIQzNW2xxS20s~oG6uopOKELT-kHrzJfZI0FwsOxBC4q-UeeIfqEKaKSj~ctPV~pErRTCY59XeIuWgkk4YNnODN4g1UvXhBMZw0bntUxgaNYxf34Cm6e9XS6zrQUf2Q__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n55281e894b4445dfp\thttps://xview3downloads.xview.us/public/55281e894b4445dfp.tar.gz?Expires=1786288364&Signature=XzhB7nOLlTS6h7F8i1NWIlwhiyIvHJfavfPbFvJZqnHQ1y2dWgJdstOOqyMn~qL-MREo9B8~9K1-Yaaqv76pz9-fp7rKHUJ7QO8cR8s2aPt~5aNjkj8xsLtdlpLA19Vz8lP0z8hqML1Diok1UO72NRby6amjS7S9Qb0qAsY8T4hKU6fNoHuUQ5Ey9-~zuIpN6qXW~sNwygl2mlpwqVqWsGax~wdu9THJS5iXPb90EdGVmowNk8OYNDysEj68xL77TTexD2hzU2YyIzl7iDUYRoKzj81AK2Tlw5hKxD7fCDu6s-QUH1OcsTQR51pNoe3-BgPCQ1O14~JPhJL2-CSCRA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n7dd2a5a4d2e9e27bp\thttps://xview3downloads.xview.us/public/7dd2a5a4d2e9e27bp.tar.gz?Expires=1786288363&Signature=eSURLWQpJJ20y6D1t51aKx9OPLvnTTinkVyJ2pMihovKtB6ULL~CEEFjFQiwLIg9c59ix2BO5PL8YNPwlaajKtYwEzBD23xHtkPiJFZC4NhXxpy2nPT8GFg9l3~Sr5CXC6xuSBA~rl0Qcfb7jDS63xFVEEskUllRKoQlWZFSo1Pv0iLS4ogGlmApMHYqd1dL7NDYsl25dOU2Cn~Szh9x7OymWFEIkaFY3ZMisfhRd4waGTWWLWU95wO-AcMJW-mhi-MeMA2ePEAg8sVsH0pPqTorOY10gDJj1IaMzA1hxp4BOEJ-kKA2HJ8gT~zIr-3ybXtXz2c2RFohm6ch6rPaYA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\ncf10d2ab427c6aedp\thttps://xview3downloads.xview.us/public/cf10d2ab427c6aedp.tar.gz?Expires=1786288363&Signature=Du7GKPLJ5WzR7J1Sx09NeVMOC49AFP9InolohJhE-EK7HFRqbYCjDfZ~cj54pKsklWCjtILywFNHYyDtMnwQXMiDCmrfjr5Gfsabf-bZN4Ckab-o4304NULoBB76UJNEOBrfYnsL10kr6y8PsAWmtYcZox-v27BJ9QuMHdJ92aTUKtGqHt9rT6piUJlrQE3oVJP~FOkBij2~9sHwJROLZTRsQUCwRHwFg1WA9DgfRnZMe7qxtrjmPkwPH67SB99bL-00WLwaaJG6EqbnxTQ3n0AmbLb7CIkE29QGCQJIVSS3MltKEB7RXqbb7UV83M3W8aM3H7DucOWyotAzo8MM5g__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nb5857d9d4719c304p\thttps://xview3downloads.xview.us/public/b5857d9d4719c304p.tar.gz?Expires=1786288363&Signature=k1uIYrQwToAfOhu~LUCDptWLBolGlMeHjI-2N56Wml0JO740r8q0loBNcE0vbx5iVsdlUj~3iNA~x8l4iPKW~tTv5Gkk2LcWy2i5mMNLCivhpTItyIhsjPHQw9vBDZSddtM-Mn-y7ZktmMUUpnK6PPROAJd5oOK8MmeS-3GVpfIG4fKBESw5-Dr0VkiFsDW2lH-kTfiIXaDRcuqSQdBAVmN31paTNQq8mRbjdhCg9ffbUXoS4PosV0j24-XrdvP0bDAYQJqpUccH353yQf629DFbVQtBAJaMWyviPQOE3VQDows7RsiryrSX01KoiUy-Sre~6zzsPEWkZ7a~55xCnA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\ndff6047c947e8fb6p\thttps://xview3downloads.xview.us/public/dff6047c947e8fb6p.tar.gz?Expires=1786288363&Signature=o8LOoh3cCzozAdBPcdxOXTr63ZrgzUr1H2jMa1QnxlL5IsDxh7q9xbJejT4OqCAxPmH01iv~DSxw4O0o7WesodX2wO1R4Mo~ESbUbW~p8O3oGRrgVHUO5ppG~5gzYpeeBG0xjrXPB2h0jzdZ0ByVQ~0Y7Exj8BqM9y8ZJUxdVpz733SbTGXy-04xRj8XtPLwCwslisa52P2~lR5Q3HFrqGADwUgv0I2hgKOVfnOAot57gWkWLdxa2DcwomYbMETsL863YoIUKRICsn2rbzY~os60Kbrt7c7GirY68MPH~NR9aoQWl4DZhii~92OebdvwwvsojjL0Xz0D2YC~uooa9w__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n9afdf1b6ba2e069ep\thttps://xview3downloads.xview.us/public/9afdf1b6ba2e069ep.tar.gz?Expires=1786288364&Signature=nGRqPM9kEFnjSFzCgNZrjde4b2VIh8h3133P0796hc3JOFDTUVW2e5OtKNukkCPIyLrJNSd0h4yzv31FBJwYBdmK-bW4cIWUn~7X~sGTSddL1Hm1O3XPOjNL7nypuNiudjY~OQszkHFQglg7fwNmV2ds-rY8KBOc9kYZMjLklVEgD-5wzE-uALL0m3wOKOHkFRAAMNHCGSyAnv6bgKWzW5DMPZutelRfBBmFwbxYRKIhZo4Vf1YTNDky-EopTMseOgRGhMIAYJt~vjimckJFBwNMlMn9OiMnrZJBnmjr4UgfJC8Nqge1MMSc6azalSt7isxMJlExK6ErHGL7kfl6kQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n"
RUN_MODE = "FULL"  # SMOKE | FULL

if __name__ == "__main__":
    mpath = WORK / "scene_manifest.tsv"
    WORK.mkdir(parents=True, exist_ok=True)
    mpath.write_text(SMOKE_TSV if RUN_MODE == "SMOKE" else FULL_TSV)
    main(str(mpath))

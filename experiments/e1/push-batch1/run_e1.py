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


SMOKE_TSV = "05bc615a9b0e1159t\thttps://xview3downloads.xview.us/train/05bc615a9b0e1159t.tar.gz?Expires=1786264036&Signature=KkKqsIIgNR~iOOjc85R07jWUYop~7zkFUFbT9Z2LKLOjERESjWJz0asQixZEZ643V1s8IShz7i89BIA9xzu4Hezt9LS~gIMkqzEGoVUo38aYprLX92siMEo-GvzrvHXrPTIl2ytB4TBhDKH99SV2sVvU1Pa1ILcqQWgP-C0e4Ipqo-S9tWzmekR4YzaQRBmkyrnBs5l0Yecn8sJN~ijc4vNCz4Ve4bn5gQmUGKOAZh2HkqRYsTT7g48k0Lz81G-~e8~cjOMc~pBxfVyj~tFDNQsw-n4BJ3n5iwhHbC4FN0BlOX~LyYojXGoehv5Xy54vpAnGcG97HzRWV2lBdnL6yg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n"
FULL_TSV = "8e8df9a7440c1243p\thttps://xview3downloads.xview.us/public/8e8df9a7440c1243p.tar.gz?Expires=1786264037&Signature=Cy5Zr8wAu9Mzn7S8lXZtED8G3WCuJA2VWSy3lRJg1QgG0PYDxTIWL1mApLR2vOsIW5lDfkw7MwT1pm~btkL-nDRAysaACc8mK5GAiykqjkjlszmMBz9pd9XX~wksPPhsbkDP8Wm60NmVQDcV00WfeFlQoy5InSxiTvjf8QMrcaw2hUqFwV7YRugSmT1GRAL43KdxRXSKQDaziTTNkylzJ-24hHpbxuUFzxyF2MODZjDZpov1T0A9tjK2W4VtMnQYakVhpUgXqOs3ek1zPLIlDajEgZtlMgq4t34k5YGlOnn1GHiZYChRjo8Ljm6805sOZgfeIY8E548v37IepR98ww__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nf77492d9a28db605p\thttps://xview3downloads.xview.us/public/f77492d9a28db605p.tar.gz?Expires=1786264037&Signature=NU9dHqw9N6FBaATpZibpZ1J0DtRl-oq5GSOVE~QVSCf1pfpWoJgOLSocCMhUEwurZh2cJpcBpYOlcZqmDVv8odZWhbUYqVLJRNI4VvnzxnAQLUih~EBZeOf38P6JADJsE3xkjX9gH68y9q2TpWpGxfzBZDjw9~i5rNAOH3~ujCvIxmpGthsWmKW-gNzzhOQV9UtgSPOWFQx5qSUt-8I8bu-Tt9QId--FviQC4pnfOi9A-xfNgzZmgsGbeKBI~pPERnYRkG~nFf6i1DvsXBGrDoofpfWxZUFhCK44jKKK6QW6myiBoKY0G5qqMKDBuNIlNKtmk7LWETmqCkmTKvOobA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n3bc01ebcedc7e328p\thttps://xview3downloads.xview.us/public/3bc01ebcedc7e328p.tar.gz?Expires=1786264037&Signature=VkdS2xCzMLsnRe2vt0-ohjNjl5l-v9Q1AbrzbHA0hjQCMYDhJ7MikmRzE2AzPibBZ5CMrd5A353Dq94e8cJA3ojYC5BNlRQfHeNeXOrWO-QK6ZDGEmSAJD-2MLQmeMIZmEjfjtZcGM5~DSaUwfV2eAwdNVtWZpvVXH0QFu~5de0c~JTe2BmDNR90ygKBG903eyfb2CUO0fB8R9MzBoY5sj20vxUAtRiL5JoAD-vfTv~CzNB8Qs9uzPx0pXeQTbBY5T3EGBGoX11N~tfdBr-jBe7pP~3nxNgZg8fhk2TyxFEDqAVXU3TCnKamu2HhReH5YIhYDMfgu4gusn8~4bt2cg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\naad0cc0c9ff85960p\thttps://xview3downloads.xview.us/public/aad0cc0c9ff85960p.tar.gz?Expires=1786264037&Signature=A8Ust1zE2VyLH~u9Rra-waPHGbClAbhTbBghVG620sZjc8jKV3OYZEg9sQ6yIu3PPcDpACC1YeUVEe9GGJE8adJxGTh62B~-8Mlw0tjYlXn1hBras5lqf5mGJNrjVYxogX~TQi-f6AbRyhd6JGfVT-~uGkEYG3mXjVpLtuolonV5CZl7H2vpBbRIDBCi27j28I46GhxEEz9lnnuKM5imrc3z9bRIxtJoLqwsKwDeYhXdOcM2w2aW4XD700pKXuJeeUrzRjv~4O3O9vr8fMnU64A8uNT-wKNfiPzAXIQnEr1Rv1~SxqV08BQwCL1rZ~tru~gnEjdX0Dv6CYiJbg9Cww__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\ned7647eaf1bfdbdep\thttps://xview3downloads.xview.us/public/ed7647eaf1bfdbdep.tar.gz?Expires=1786264037&Signature=K6UmczSLL2lOFT2~4L~~C9UN~5Zw3oVEU~0POPuefRsJk1uAKMOOM5xFo4G27rWnY93Wpt5yqHk98uG5M3w0MYuReUnuiBTCrSbpwN5mbp6Kk8nhOArJaUXyralzehf~~YP-JFwc83BSsToY80rBfLbmjTfWNG658t~nSdoOlZT7N8FFNvI1JaVVT9irhrJa20Li6vLXcKKLTZznnfykhfu6iPXCjlqQvQ3M2-oLJaboT5UxWYJy1FOghZ5eXQeVuBURX4JizKcV~8WL6SftX0qT0NyXQDZOEqnWP9pG8aIkz0Q38ihoWsZTzerwYr3RfuAo1uMf2Ium3ifrcZLgvQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n860e65f9f3191ffdp\thttps://xview3downloads.xview.us/public/860e65f9f3191ffdp.tar.gz?Expires=1786264037&Signature=cOnbJt1ugJkGQv-50v-NsgbqXaCcRMFCR50E8zqDA~8emDQNVAqMQD-o3iPsxdO1OmTxjqJbHhuozblNd9I5PnWAJz4qbNKK11YVfPqDEsbpJkD1cGGswFrp5dBq36mL5ZnWFYbjCcKSzUCVej0NJsPvuHFKovERIidApZ~BdSgQh3ysPguiIuUsXMmcv0CyJkDA8TUvptMzBmQ9hCPkbZBPBUcWGtuTC~aN9tRWW8afMAKsGiBiBJKVv1AeiHu1aElMCxNdBI5cpvkwFAVez6udey6oqe~-zLkPIqZmsjxeK8krI4GvkeWHUk~yRSAPuchhJuUvtnxSsqvTKX~9HA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n583ae138189d9121p\thttps://xview3downloads.xview.us/public/583ae138189d9121p.tar.gz?Expires=1786264037&Signature=GkPnO-umFIrcbmjApny9u7ysP1kg7NkU~0eZhk0xkrijbGOd9eEfdXJDAFceVm14irMQh9QatXnOKAT5NhCTnCpP5d9k2ni7xFoqfiD4xgscQm~hi2RTGwTe1z1L5k7k22oJbrfiUPpJHRwqKtfway~OeIoUVTRwPRstjyUSWKPhAe-~XBwBWdgrc6RFy7RUWb-ZHmkW4gZyhzL2mXihjLPr4M1QevaYCZ-G0T4f44nH2qenYzZNEv1qr~WdAz-~VpFLcQT~nYZ17WbtmviBGFUIy1jQ4OEHqcslKFlSMjNy~eypKeVmAD5Qs-VQuIHjuIfcGerR-iaMPPO78p-Akw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n1c904ce36a05bdddp\thttps://xview3downloads.xview.us/public/1c904ce36a05bdddp.tar.gz?Expires=1786264036&Signature=Z8wcpyOvwHOlkmeMDQukYLO77xYQJC~739X~~RzFo~ZqzBpZz7eA5KWX0Gzydr~D5l~OJ3EHbFywjI8mXtwE~Bg7A2~N78fCiuams~yt1EW39foeL-mNa3fdpwqEdvaijUWwpNVPmYajFg~y7YxxsZXulZjRqQcY5d97URNhYXD95FKtABcml9foILv0ksVS8c-rE0gGoMfD-s2GxF1DvgD2bexaC6fLL5OwsQSm6sfo9~sJDoxYtdv7HLCpkR~o4hGHKOfv0qtA4LgZ4H0pz5eBmJI8hwewCMsmTumCw3wheK-xmDtkbeXX0Pf2VHfBzLEvaBvfmHBg0N--umJ72g__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n4f1ac44118a7cc96p\thttps://xview3downloads.xview.us/public/4f1ac44118a7cc96p.tar.gz?Expires=1786264037&Signature=pqn66BMIXuQkcnOd4coCxDMk~r9CsvkumHCdrZbZunEWmwwR1uF~hs9dzMjcu-97VZjvyB1VafW205jWhSWkd-25lUGW0vUPa9V2ruEPUYPwpc3FUfvjrXMI2OhdTu4RBqMsFSWdPZqOH7-X2dS32Y5JMdYf62VN0jyHqf90ITg9LhcZjq~m9ROYQuf--muoagMNXqDsuc8zv4THaOZFBwBXfhUaN0~8r5FHC5d54dviYCpZea4Itbbo-RDHxtvwoP9A4jFMAkvGmDoKWi4UvyMCo-23NfnkSNCYpKEP9DirBz-hCnQXd9T6sfhxkfSCs4WIypw2jcLLz~gh897pNQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n97e4833c46771a67p\thttps://xview3downloads.xview.us/public/97e4833c46771a67p.tar.gz?Expires=1786264037&Signature=HcW3SbrLp--STHxc4Ldly0MHrORkb84WLvYVQekiwj5ER~4uZJ7l20V-XuURgCtewc9xyLjTnxCVoEcd0xCsRPzTwfNoyYdu9SHsWbDaPvEJ7ZltlBd5KMoGmU~V7XfvriNoubdQT-~zHpELLdlOIhwuw5euIrALgEnO4Jmg8~IcTW3VEcrpKWyxZnTMgIhr-Wa4Ub7CESGSOnZjEfLxCZvgMfqR0jzRZf3RXS6vxHHBk5GiwRB9Reif1hbDDpwAToNWtSWbHxEiXiPnObXh6W62aL1qcdOZymUZWZGoz2tq1iBdAu0l01w5nT0A3poavXQuLbQEq1eMFGeyFyusHA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n6ed4301901fa31fbp\thttps://xview3downloads.xview.us/public/6ed4301901fa31fbp.tar.gz?Expires=1786264036&Signature=f7NHJ3FNnCq-uSyFzmZPjr9N79Pp3gmKdCkTvDrSmtSwKwKTF1MlRQWkUlj5IGUsAXG7iVVKOvFUbPb-Z18zibhbvlTa8qdgXu1zV4a7I~wTz-vp0ortYGn7knJOsEmbFIoBvglQfZc~ET0UYi-Et4ctlvqcp4AIBk-M8EPGjiYm~2burPDE08eq9Zen-1wzcJlokGY3G~4Us492GKamoWOX04-1BNCJbT4gg3S7mj-wcS6msb6IndBpgfyy20ene3lA1qyc2X1iruCEOsvDKIsM3lRYy4Q7H6bXEUeuDWTxjq9jwX8XJ8v2efPB1JyT0fxYmxhpTWVh7QxDATGMTQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n5af616b150417f93p\thttps://xview3downloads.xview.us/public/5af616b150417f93p.tar.gz?Expires=1786264037&Signature=Prq3yA-5a9LXZ~Z0lvaY11mGuiBrR0w3GpPgh~Ska9ZP2c2dGEKa6kL2pmpLP60bJ~l8qLsM6qZu40dfkzk426z-T9FPucnWtKIF2uiiU80Ze~Dl2oGYk~IvnLfoA0xpRaRsD2mv6HRQI19U~ZY2kDDs8zGWFBH2IfbT501acT1LGKdJtHLZBGkHkrgNcozvnEUyw6vsMdQZ7za~Dc2-M2NFeDK3O2QBwwrJGue6URreoxv5zDL2BNNkbZ-ePZD~jRIiDianUotuu7qwEJ0NoGOrLA5jnOUHglwSwKrgFwgbye~6EoMBPKJqDJrUR7bJj1h89fh8ERNZIhdZur9rRA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n55281e894b4445dfp\thttps://xview3downloads.xview.us/public/55281e894b4445dfp.tar.gz?Expires=1786264037&Signature=WE6fOTfBGkDZK95J8ivaFHaFw1xS7HMAq114MXHLtmjRCJ9cNnTZjKIXRJYB5sC1dwzpWKVnPtsgrqC4FO71rqoYGAZ5RO1y9dm5RWF-l3G0Rqk9EDE~04Dfi3QD1XdLJEkAQcYhRHovP3ernfa2gVYfzaeukpUOXd63saWEg2ld-uAdNst7IYIb8X6pCvSglgWJWxXs-93bjVxDZSBpD8wnCIwes2CZebZzNatH-Yg0I3UoNDgFj-J~SZRTxbtPY0sNjoURStbmHxUtHncoxc9MBydd8HfsqBRof4oTES3xpdTdJQf1ReCNVNA~3ohjZUiN7o~Pjvv3X9rwqeAC5Q__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n7dd2a5a4d2e9e27bp\thttps://xview3downloads.xview.us/public/7dd2a5a4d2e9e27bp.tar.gz?Expires=1786264037&Signature=XwmzAoLnQXvd-hoT8jMUI-XT9BKEplL6K27pijZAhV9VgPPm9NbeUrSugGP3J9N~Snd329bHpIWntJuVQIbGmrIM2c9qnk94VkdLBdcWPtaC42cdt7N1FLn-unq-~86zmIUitqTL5xCG8E59Jq~Ic-OERVvgKzTYcT3qvRXKVX3J~DXTRN9TvpQGWKoDRZTvyFrtaIWAZ1cY9-JwlZHRyey-WB8nesOJwMVkMqg0UzUhAJMZGn1ljse0spSFLnrgmFi9CXnJCP2VBSSh3pIcZuYP3aZ5~CCrjEIchWwRme37Uwn-4j4LLh21jRYYrmGNxqit3L7VtOLii0dpMVRHSQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\ncf10d2ab427c6aedp\thttps://xview3downloads.xview.us/public/cf10d2ab427c6aedp.tar.gz?Expires=1786264037&Signature=llOoBTy2l3HgAt4Q7Mun-Ce-RuSnmhCR4hGqxD7ro2E4fmYmPGnz1J-c1RlLrLpsj1Atj0o8XM65ZpPWgGd3WO11b~ijkz76yKdGP5TdZy8RiSz3uUVAO8BLMlIvjBUcVtLHsoFyIBJWRqV0SSNJ1c38dpMfwvHs4lVHdM8mWffJTgz3YKhCT0j3ckri9oySOLFxkvbI5mr2-JRJOk0h~mRkCBnWuUjAXVLAIcQ5JzcI6dh-JUweRIzZRdvEJpkJ8gCunNU8yBD-j0cvhtMrVwlboMK9eTAX4HyygkiXX7oY08X~cltSwOAa2VafwpQjcet9KqiYLWnX7TXOKuZ70A__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nb5857d9d4719c304p\thttps://xview3downloads.xview.us/public/b5857d9d4719c304p.tar.gz?Expires=1786264036&Signature=naEw6B3rWBgsvL~0yo46ATkjIX-bBdB2gftmJxG4uClUHauc8bc2KdA1W-KF9xIU7TQbaJ~Me3fxLj61qiFmgUU9pdsAzE91mSU04NoiGHyL7tlXzByafa9PfZ7Cs06d7~dmutdoRtngezAvnL95~1M4Z2QcjIMctckLUzc8WpH0DqZHmUuLDU053tbesaDYfKVC1gIC9GUmCnZu6Xkgb5NyHkkzu6IIprIFwYTR~XZllChTWpm7afgFySVObqtSX96HB3vxie0hQI4LSbZcUG8HUZDwjmxA6-UH19Sa0CnRvsY~wxGCOsPhsPPEQuDZENBZPlutXyWm~rnIN1-7MQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\ndff6047c947e8fb6p\thttps://xview3downloads.xview.us/public/dff6047c947e8fb6p.tar.gz?Expires=1786264037&Signature=FixtK-srBBiYm6Ut7Vjx~9y2OQ7X7MB~nw088JysD4p712PfJLQP6NooyOmSd0Qbn12wXOX5Y8LuLSg4OVUP50V5Sujqk6bUUU~zsmQk6vygRYqEhEIlVFyhbHHzHIPftBqdlkvVbQGeMYx0TRnXbLo9f13~lQeNjtFG4QSvFioCxk-2sP412e1G78GZlqBCp2a9iRXB5drhFaQGDojKgL3eovRXp21PhrqnZNRXThYsUBMPbOVC3qZtYluBR2atGQjbe7rd5FiUr5H8qEOOAkhNzb-IzcYmjoqz-tMgGCqGaVe5JCg-KGUKbF7wQRvK-NAbfRrzuPZgtu0kyuFQlw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n9afdf1b6ba2e069ep\thttps://xview3downloads.xview.us/public/9afdf1b6ba2e069ep.tar.gz?Expires=1786264037&Signature=QG94VX4J~aoFtwgZp0FS8HKTeCo2EPeN2f7ngwA~~A2yJ5kO7y73FBOBiJJ8tJaUfqPowT6Qsfz6E2Ftko1WfOfCya8y9GlGCCTI1ht2-ihC3efStYmxrxnYKK37EIS-flMKZgDoaDw324R0BAYeqQgMO65iDE3qeyx-EfVMEb-EgDIuNgrkAq-xWgLbcUY-ccG39QT~vpFlD1K04hX8YTuKI9n9B9TUQaeElo9hz83QUp4xroHNXHbOu0FdHYoV3n8uq1YkGhzUDQS~1D6aJirHR7Y9tPZ4fQir3M6D-yDwzLoN4oQF5hHNLUKa7VQMCjXItf-hZ3FHodeDjVZdjg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n"
RUN_MODE = "FULL"  # SMOKE | FULL

if __name__ == "__main__":
    mpath = WORK / "scene_manifest.tsv"
    WORK.mkdir(parents=True, exist_ok=True)
    mpath.write_text(SMOKE_TSV if RUN_MODE == "SMOKE" else FULL_TSV)
    main(str(mpath))

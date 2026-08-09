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
FULL_TSV = "c078ff51eb54a68fp\thttps://xview3downloads.xview.us/public/c078ff51eb54a68fp.tar.gz?Expires=1786264036&Signature=HB0LGVDo51fVIf~~VrPLnsNxhVzKba2hLk4j4yrd4uxVeH9I9wKOZnS~tUXI8v6ejEga44ueC6acXUhShls12VB7RcUUm5FTgTpYar2fZu8Ic-TP8RV3JZLvh5PNYe7-Yq1RjMnfAogUng6umd6VD0qqWlDLSovtDca0M1VSVwSyIM0UE0X8Nszyr2~n8bWoNfrBbNUgaA2C4mA0F9lL5Zso0B7MV23DqiSWda82edK-8-51Ag~xi12qVf36UXY7T6uaC1tHdrwlau1GAs8Hi01Nwte9NeJfKU-jMrX~IY5Y1nfcbv6IMh3Cx9i-S0EDI7WW3Mkwy93EPrjQACXmkA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n0bc18737319f2ce6p\thttps://xview3downloads.xview.us/public/0bc18737319f2ce6p.tar.gz?Expires=1786264036&Signature=flelOh40FAhkdmlu6goh-uptbQvVWHmtZR-HcfXdHLEbeeHzKRpRNq73Q8n9TTZhCpmql4XWrvfuiIRuAnDXaepiyrTFkpD10QbshBveBUxcon-EUiDPeuqLo2a~iuqThyHugR2MzEg4QAKe4z53k2iQ6o~PV-PLlwuX6RyrHSoy89EEBYQ5cbFP3aXQe0cupB3tUE9cdckQ0-8QjGo5uVtFmBR5Fj3XaWoGtpsxz~xTSnHAwraBIjx9-UTGDHN9Mc6txeIxu9CKIvqlwmIQy0I4P9AfaQMOVqwfR6kesNtv9s7-h-obNlwW4l0VFqRZFgSCeCpP6d9kfQMbyZC9yw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\ncd67e528fd692386p\thttps://xview3downloads.xview.us/public/cd67e528fd692386p.tar.gz?Expires=1786264036&Signature=eetpNUtqyCYtaWhLaNCmzpApzhklZ~Ne5Y-6uGLKyII999fy3HQjDtk8Up7mq0N4VMKixAiPxuoW~FHvNNLCHBGs4Auil3oTWy2zqVCQWUvu~N8Mn3vfs3qP2jyFCxR729Eh6S3jI13laKLDhRAV5FlX-QwyoGzThNThwPlNCawGTCl5HEegU3DowdMOjUtXDtfMJHmAh7Zp6vYGCu9VavBrIgGa07XETzQgMAzJflwpoLMiJ4FSFWdLSrZqxvHpbDgqNIOl9Ukr8AakYQSe5RJv8E9WTIOYhr49f6lU6-sqE~-fbxGIhE1fLeKeAZZNIm6zuXerhWeaSWeKABkImA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n2afbfbcc8499a514p\thttps://xview3downloads.xview.us/public/2afbfbcc8499a514p.tar.gz?Expires=1786264037&Signature=WyFiJvj2SCuZD0HNztIHps~JXdqn8R2v0EsywgZetkcKEy4vQeXp6WsOLcQgypHAmtkcts-Gcbj0c8srH3XhvZaL2cIqPEfkp3Ablu58P1lsEq4uIBDl~2p3m7wHHSKcIakdMVS9BdC7ugKxZWKhpGKxzQMkd8U6XrIW9PRk1cP7Y4KQQs2kXxlU8Dvhvcaf7iXj3IDUvVkApBytr0NnZGb51BACSQc3L1ddPeFbW18Xhx9lZ0A~dGVUS2JfyXR~a~4gt7QOPsiNDeWR25OW8kx15oYdGELPxYZ-o-~7WsNUbEqGnEj5XWjputq5Hj9f5w4HLN2vrOyTSqN2h3x3Qg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n570f8bf76cac1d94p\thttps://xview3downloads.xview.us/public/570f8bf76cac1d94p.tar.gz?Expires=1786264037&Signature=cxzoFuf455dU4d1yEKXEJZ7MJpingR~Px1Oyl7A898h88BhRIX32wdvO5G2zr3KW~sDpI11lkVJ~eYRA27EcthPemygVWTgPziLfAN8s0-5uqSgRd4PntDjZbDxsvyLVwYN~S1nUm9XeOIzX29wa6Dth6~Z1FIDt9RZxNWEccMjsKpg5kC-9KoUALvY0np0AbJgSb~EOZFqDBzI-hngCUaPjTAS8jlzMvMLMpfcBoeHhUeXedPH8~vpl7opYdx6Bglp1YGPitGhyPhTanh4dgEkMC-ZetwowTcxOdPBix4aHlHmSSxcHpxTFFLNKCgSDSD9yS4E8I3olv9wpT55ymw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nf72465088b4c4276p\thttps://xview3downloads.xview.us/public/f72465088b4c4276p.tar.gz?Expires=1786264037&Signature=bArDG57k4HrehKnUhuHBHlnEqvtrkbk~3i8tguGEMPU8bYscUs7ySDCPWdAbqBqenFwfDbdvdojlLdEKs3VHlQLPdjw6iKQZtQJ~V5~QhIS5jss3ec8aolj9VInFQe99Gbz0HDqB7cqe79f-kthI05DVFltm0PvI2tZnpNRsGq34Dgewr4oC7~cnTN5yx-zzwuPTzpDAn3xRXI1nguXqV8ufojgTHcodeVNcxLRGlUaQqh75dCRrDsoja7yNNvuBn7t6xqJ9I~tatSrlMa8zcWiRx38G9Z3mh51nuK3pK7Du7nlTRwRUI6~KFnaBBUoiKhnAkPmHPOmA~A7fovlolA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n93cd69e7a7ca7b2ap\thttps://xview3downloads.xview.us/public/93cd69e7a7ca7b2ap.tar.gz?Expires=1786264037&Signature=pDHVy0~VUXRFuk01JmlF1PeOqWqi-ODobPH6Z65ID2aGDmDPYww3JN9GDsmWZlzz8Xl5EJPXnU2ZQkohcSiCOy6eaQvbtJ6SAKyypb9RpnY8xyS8w0MZw6C6cRGdoTnREIoFIOMKqyjX05CU98voxVDjzNpt923JEwmtTEH0z5jwcDy1uyNHlACxiUBExIHi~nAb7Kf8pQE6Mqt9cWTsDOZsF7KVzWlEGo12rTImG7XHsnc2AWoxpW6~nxm0p1biysX2mCjLp8XSF3UTL1y594CmCd0odcmx~h3TkcreFM4wMQsnQBBIA3csWz-4k3M0E5I7ezGe~DrOuTF95BMpjQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n8bac7ec905895b12p\thttps://xview3downloads.xview.us/public/8bac7ec905895b12p.tar.gz?Expires=1786264037&Signature=m08ngho3L3b~GHXa3ig~M3wUJzhPeQG9TE8OtOPDhiNZ~xT7su9QtJ9J5iPFRANlCYEOknFqpisnCpePYttVXg4ISipK~B5bnV5GvcFUSuf5ID3Yhg9OKThU3l1HyDtqq0wUbxhdXVNlE9mElS4VKRtto1uH-cBakuAks6iyo0lPx5QDS1RZZvLaAj5552C8037dhriPnOJ-m2Rk4brIM2JIow0mfeaRi0-3xHp~SnWyrWUYrOypfRnXM9t~VkfHD8UtYO3bpqzWD~GSzq688ramZAyYTsmRIBgIjwLryc5K6NfjQ9VP-NEvjF2HlioFOzXIqFtkIU0zf-A3c6RiQQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n679f1af0ae91e23ep\thttps://xview3downloads.xview.us/public/679f1af0ae91e23ep.tar.gz?Expires=1786264036&Signature=ROcx~9jHHh7nDvxJgbSxIMF5juGwpE29RSEOivEumZg~RIdEiAJIJq0lwxJTSK2mGizS8tQOZMqUTa89vq~gluRqWbLoaKk77D3wrsF-kHKkBRlZVk-1mF3lJBL~Gqaog41mCvdFi4Db~VrZBacHr2jc4wg5YJ1y7UzAYAk0DdZtDGwC~~wiTHAeq~LMmsZ87oCzO0NWZ98XW~cDC8L4Wj4bKdiryzI6JddQt3fnsklzA1h1vLrjYGDAsAafc~HrBQVu~EYR3YDTedQSTBY5T2n7fdRrZUwXkRzy6Ma9qwpwSeXPmFRhBMWcQPKhpBJv1xs2O~JpRf7yqOFlYPH3wA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n0e815a40b2fbdc76p\thttps://xview3downloads.xview.us/public/0e815a40b2fbdc76p.tar.gz?Expires=1786264036&Signature=aJAz3kGK9hiXXN5GMigwx7LEUumb85VDV4oaNkB-JWXYwXSaxXDLn~rKzJGqBEqlTX4HlazOZjGGlPwTfbFPRk~zBzulT84IUrjNZKfk5svipn89y0vbib5Q9za5dfMBcEHoVoIOia~8Rc41bSSwHNwAwChKGtGxWEXZ1pINVIuerPq53Np3M4jjHe7TXBDChUB0V9TXFEM6RtMTMy71ulnmk9cqPQihJmd3dBoGxLiLhDrQ4hIvw3WVy5DQNzE4axARBamrIQTPe8~eQws4rhA6ju3LKcojb3mbIlE6pG5W9--8bdIWENNn2ZIjbXGuP-Ye9q5a04klkzNGVn1gZQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nf9db277f662e8bcap\thttps://xview3downloads.xview.us/public/f9db277f662e8bcap.tar.gz?Expires=1786264037&Signature=XY~p3t7oFzlb1HJKIGw2o3VIgmnyqitdxy6JezhA8sOObRHMcFinlFozKl5pLqp2liORwik4NLj3DznBQe5263VtJjgLpj0GLF2bKXfiJ2n~PqZJ5z3LppmwipmHbrhA7AJaB-xmt4Zh5MSd4SOgyZ6fbA-jI6qhjk7tXzay0vNwK9AhCTPsAMvZN81V-KPVSeGw1VNEhbJpUNknmzPmVL2bOUtEOME2SnnNA62Ml4fZv-BmodNoJPfObQQblKLRfpuE8Sypreda9gxDBZbMZ0YlLOjU7trxXqARgQBoU9KUWjYkh7wl5PBU8hh4wOcqOPdGi7dUkeIXqrnec~a-xw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nebbbee77e0b8bfbdp\thttps://xview3downloads.xview.us/public/ebbbee77e0b8bfbdp.tar.gz?Expires=1786264037&Signature=SIzD8G9litiYtmYqJ~pjjafW~Vv9CQ~SfKjnwnsoHw~sQGfs9cyYL9Ar1nGigwwz2bkCOm8Xlc1dnoTkBtBtKK3aGqK0ffnZ7LzwbrRhDGQ8dFJAfQMRQ3XPs-jOhbjuifIHyw4LQxT1tx8dY9TNC6SEtRMRC8lUUJXgEhnJB7Xp-Jz1f5Btai8U4c1vIlI9Al6CADTupfSf4K0tdekdCunBTD2Oxhl4Np3wHncQQhkvX6pvHKCdl74VqwwKvLB6OHI8SM8S2P3muGTsABQ2c0fq8CPLkcYcTFWNdQO5WdV1W8xxkKk2inSR23x8l3L~NBIl8w7XpFB9KO~HE0TQsg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nf9e403da040d714cp\thttps://xview3downloads.xview.us/public/f9e403da040d714cp.tar.gz?Expires=1786264037&Signature=d0H5WYubHIe6YNH-ADbJtIF6ywTbyIPzi7xDJfMQxb977vrG7r~vvhFwZwR3bAf5Y~Ec0SQaWXj61MhfRrTMLfp-7C0fUO3SUP8LQ6IRNc-hikCahWs-RQPXGypzXjSXP~rc2XfvCqXB-IVymH7-78Lf7XqExwzsPQGYVjT9nZPcqyyaHOS10cUmAwK10Yh-PyJOf0xya2C4DT8D2wUIyCMA-Gz00BPIcmSKY452icFAcL8XiioQm8QoQTnR2vfxkrXbCTXTMHXazfIN7EHvMa2noxcFc7nwx2YFdBt7ZIcZPkqljX-BRx69Pr0QPRnBURDp56aJjqtObKS3XU3JRg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n8decb780ddc167b9p\thttps://xview3downloads.xview.us/public/8decb780ddc167b9p.tar.gz?Expires=1786264037&Signature=Hx8P5mqEfGlC1aoEboNHS-ZAPRwqhvDDF9zzFqrPm51y3XPrzOnkqMaR-kE2hD1pCHqF9z1LXTX8MG43pwWm-pPMdiFPG9Kc9zC87xZf03URVIEP~v6sbuWz-EMwyzl5U5eMrS-vO9N1C-sC~F~03GtqsXi-xEpGXQkjbCCZaRJwCpVCNJbhzw03TDJNp5qfdtO8lgKfH9tc1vPKdE7aGfavZ1UB031PZlbibAZrOqwjMSKV9oKP9-s5MLGC9ONtaK6ySkwAXK3Qu8K6znkndubSj7o30gGJ-FhSoXDsrKav1jPswQirrF0Mqk2peZ40UQ9Uf9TN2xOa2~XckN4vTg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nec00f105aafbade6p\thttps://xview3downloads.xview.us/public/ec00f105aafbade6p.tar.gz?Expires=1786264037&Signature=o8o5r6XuvdtO1ju5Q2331jVNmChq6MYiVXKtiPLF61r0SEPDJG5NJQNrD-LF8uMgUefa6fYQXS1jyKG1cNwWKpO7X88Br-8owrII4gASDJ38Wv7A-uTBvp5IwuM52Lo7oyEmhIeJAsifxdxYoP0~H2G7YV4ceTJpmmZQXLKRe2yomAh1ORiVGqp2k4wsRUxX-m89UkSlGh~JHwMNb5R-MKV2kDnpmn8cTcIkS1w-AphjEcVMAP4Tj3q6B8MnEKtYg8se2k8DI4~U2vD7zFJqKkIBp186Go80ScmEcSI-KlNLC8JMHOlT67MWrjiBUycWxEy-6dijseBGzaXOPvU5~w__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nb771e72b21c08775p\thttps://xview3downloads.xview.us/public/b771e72b21c08775p.tar.gz?Expires=1786264036&Signature=dPfeMkCMGssjVT4nMuEpnQvf2ESvnEljoSPMgp0FTZo54Ovjny~WkC3mFC4svaHRT~bDE4c2b6-FDvEtbd~FqG4chvZ-MX9BxFms4CLAZ1ijOyshBWUyijtiIRotnbi9P~V29ZTRkHX47-~dpBW5oaOznM3f1Z9Jv63scdsKFQgSiXI05SCLUQgt0JRNweQggPuHzLIhKTXcgYr4Hf8W24P92kiPbl4yh54N8rbP~eMwq83-W3AtE5v4NHmhBMaCMARlE7qjgTNytkS6IyopddnpxIrf7LD-3g7aFP857FKE8F~7fbsCTeagX10Lf9tJDN-6Xl7-sFT5ZzQJDulh~A__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n3a0fff47ada3e269p\thttps://xview3downloads.xview.us/public/3a0fff47ada3e269p.tar.gz?Expires=1786264037&Signature=k2XnqR0mZ9YnAd7Eu5eoQrlMojrtC-60WC~zi61UWmCY92~EQXzDHvra~bopXEcLpjDvyWLtNZVD8wH2iaswk-FueEMOqmXgv5fH94oZH7lWPiAz4CorbHcFkCPzf6naKFT8VUgGn5FYny2hT~qvFmAUnw5wS~ppp~zr~nS9OftxviBXxO6roeH9RHTqe8F~2oJJ-eYeEoH0PauOYLyNVNflR7whzSb2Ac91QxFf-XeWTmxiqjqPWIf8hf4a5xfy7TuOsNp~f-BWwyoUM2rSxoNBDJVwsgXI1lKzaB8JlVyIZFQHKNKOn6mwjp20wM4vUluH1q8GFsch2iYplcyPGw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n"
RUN_MODE = "FULL"  # SMOKE | FULL

if __name__ == "__main__":
    mpath = WORK / "scene_manifest.tsv"
    WORK.mkdir(parents=True, exist_ok=True)
    mpath.write_text(SMOKE_TSV if RUN_MODE == "SMOKE" else FULL_TSV)
    main(str(mpath))

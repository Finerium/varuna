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
FULL_TSV = "8bac7ec905895b12p\thttps://xview3downloads.xview.us/public/8bac7ec905895b12p.tar.gz?Expires=1786288363&Signature=QcSErxY7yJ9FB3hA2ovobRgyEAbY-LGwXhx0jkVTxMz6BwC5ugNgRIta0tvMxNNtK8UKCUGs-WeQhsONYywmzz7YFtYIZ5alrLKLPsJcTbb9XpovDKISkCASNN46KT-~1t7lTUeZynJ5R7uUwVFbuUBc~WGDXG3MD-TICJuN2lRYsPab51O1-7UWRiEpC4QbmAm4ckPb2jicMzTPYBWL0N0~9iH6EtjXBuZg1~WXLmIi1ihhYcQoDeu8dijIx6MLGNoFqfCqmv0yPkonniU56ewzAVihxAa8DyJoIANMdnKd5t1vwjPYETDaPK1HrTjJ53kcAuikrnxO9OhZsUCHtg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n679f1af0ae91e23ep\thttps://xview3downloads.xview.us/public/679f1af0ae91e23ep.tar.gz?Expires=1786288363&Signature=NenfoxZg7iqOThpspIATdVT-8WLM2uEVu-0Wbsy4CI-O1wF9GjaAj23SKWmVzyCPoZmhBBE3LpDzF1Qrqcj8W1uKwZ54pBk0VV61s~kb-2p1IAkas9nVbSMHK-w1HNUpbeh4No-wgg~l~gri5wIOMYgl35s4Vd96RmGNVCfGlvOni0v8pqSK3f11RCxb4wEfmQZixULR8pG99r9TkNWpIp0jfb-XTWVqApyRhLJrX9G-7SMbTt108r3-BqP74W~RdW~aIyvopWS0XTxvGE~dDwwt6~Ij5QSsH8hCkhYTD0s5ttE~bjMt9-KUv50SiOIO18IFdMT0H81Zka~~gl7n7g__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n0e815a40b2fbdc76p\thttps://xview3downloads.xview.us/public/0e815a40b2fbdc76p.tar.gz?Expires=1786288363&Signature=hKdi~9bizLPDX3A8KMrG8U8jI6eAJEoULJwqy~zVRpZChehaJ5aqBfokwj9~6OEZTcGCl-sSwyysZIHlJeSpkOopKqgbKPOibxeFLx5o85VRhk2hh3WUT~nXHTra4RUo~E7xVST9m0mlcXNeUCYEu~2Xkx~~7uxnIwJGPQCUvdQPsGMTsQdqbBYosrFrutfNaJUwb9yIZ8KIM9V4457ruX7401iKY0t0bgPckl4mEBpbY~R7Ud~peoJtZOT-Zp6TJtmueqP~JyjbeOZ6ueWGeLDjoAlr0COtS0b94RVyqr12oxooC~aqJzsxHzDHMOqEzrOLazmFWVXueeBceiFbXg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nf9db277f662e8bcap\thttps://xview3downloads.xview.us/public/f9db277f662e8bcap.tar.gz?Expires=1786288364&Signature=McSPDpxXtXcAxxqK9tEFP4Q7zohZ36iB1ArbidBYPBX7deB4jOYFAj8ht06Ug9LLjhV8dwOsUMxva2orLq4UDLx47Y-SrJX2~kXdijPTlr0N9yY0dCGLIW3ojxWkbm1RFlSLNQlNg~LIOUbmyjcXAbBVWHVINS6tJYIfCE9nt~yA9AkAQZ~7tDqBtK~41ANm9K0zuHp9TYtU3puxzEfpIe28f6z2VbfU~F93ZRL2aAsLqq9TAatyZvTwv66anmJ1Y-wgAuoHT1D1-jO~n2OuTVdD1uA1bOSnx9hDKdA4~YYN6U3O8UsnEjCd1YuseDFt8Wo0SS7AyVdsW35~mwlqPA__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nebbbee77e0b8bfbdp\thttps://xview3downloads.xview.us/public/ebbbee77e0b8bfbdp.tar.gz?Expires=1786288364&Signature=RIAxuqzc3Lfr2pWdahTLG30GQXul6l4QlZwdL794iKKDT8Z5uUKzmjp31WcSFYzche4IYJ4Tg8aOpVxtpQnlU3TLLFp0Ox3jfErve2MHJVqA9ZqguNpvmjPNfEgRw8HftnbwZxsS64fqMc9OCH5HIx8vzAmynl9NVp2i4TvMqIqw-RPSF4sryGd0lWWsXai2CxNJ12wfmwQEx4wq9t3-M8wz-r2UXYFZYLNvZrHZdsgc-COqbIyC4su2Vzcl~sOUtn8vCTdtGi9RIS9WXTM5d5QHHB605xMxdVmGONy1OD6dZ0~9rfnMkvETRtFv9pYbu5DZ9LxBYsPTEfEBMOW5Pw__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nf9e403da040d714cp\thttps://xview3downloads.xview.us/public/f9e403da040d714cp.tar.gz?Expires=1786288364&Signature=M-2Nvg2nk16KIPV6pVa7dWADd4sjq-~i3SKsm2EhgRsnbFgoUL8MUDNzq6Or2XBdX~Hd69Cam8LcL-yiW3wzF7mCCTl7sbva4Tkf9xCHswx5Vn9jymXDD2AhYWVrL0D6m~ESdY8-FnMkga7OCGu1igr4IoyU~vJ~5dIwrfJHf-w3OTTr3Ye6-pfaozkoFJKQTmToTYYiuDFdSYbd4vGmnsnY47qVE74fXf8hD9-p0xM~7xDHZVFdYRIF4szNFMM3RTFMuthnngdfSLSOamPjzxvWDZaWiy0pAtbSctsGUeVCVpZi~UPUkJtlArY7CxLm6aM2WRhrkHd2hmg2CG8K1g__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n8decb780ddc167b9p\thttps://xview3downloads.xview.us/public/8decb780ddc167b9p.tar.gz?Expires=1786288363&Signature=NsX7eewarBcsOsbtAaLkuxrL5q57w5IFMmkyjG~jX9tZD~uP9il4gwpPp2fdY~AiqDDzGiz25g3dR9oUvvP7xnFJqA9NzSw9Uz20d1-3aMtu4lFXvwgwenHsj2Rs2OgotvaAWsXwoOj8TmJ7KTlbm~gK52EaIU4t4izX96uWZYcqfpdw3lkDHX51EwS1jf7ucsdPD-nXGh~KQiwtqE5v4J44MYepo0~G2w4xuR6WpmZ0MFDw5Pouh5fRUp3QkLDyu8Kk~kKVdNuOpI9~ckC85w2v1HEkxnZScp0cR7VfptnvHoWZaSvhDFUloh9AtT0tBgnkq3Kid9HbJ1Me41mP1Q__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nec00f105aafbade6p\thttps://xview3downloads.xview.us/public/ec00f105aafbade6p.tar.gz?Expires=1786288364&Signature=bghtXWGUs7txaKKEZR47SED~7xxZ8N6iLeAyIU0FuBRyaKTVc9TWwLJ0H~4CZSpg2AgRVm-ERnPa5jOwPYgFqnvfbuUkYeGHgngEIfS1Icf~7RHbAH2EMNhoxiYHoKlN2Tz49te2LFDKfun5LaZw4uHzcVSMaZJeDF15qLH1xfVVaQrSH15Eb~aGBZHIHMgzTQQhNKzP5Rl3DQQXyDKnIt1NwcmyJRKz4HzbDjuFNMUbCrFM2-LwmSWP-y3Maf9T5CMWxKa3mh24ry1c830aw1g0jJ5NN3YuqH96EFSsySMFrt7H4EKXf--9h0QxxnR7q4ZnyzB-FCOmxzQsaXQ2JQ__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\nb771e72b21c08775p\thttps://xview3downloads.xview.us/public/b771e72b21c08775p.tar.gz?Expires=1786288363&Signature=ha39pdpzhQXnpV0BSe69~nWjKirs~iDDABgACEAmO4pgT9XL~KeSKtOFU77q9MUuoSwLSlaVxuXDC9GWXM7s9yhwHORAoPtCdtV4nEFSvSuBtcpQ7lI42xdUV2J9U1ct5krBkzf7XTfWZG-7Diapj9vE4QiQw7cIJJi8cg3Q61whr2EhpRJJf3btC~0xFOm2KQMMY9iLvM7-z806cEdGwKzpm7KmZT2d8aAE0LtuoqvHTzI-iwhyh~G7Zau06XajLpBkrRhnGD5LZ6Sjf0wteSmLNzrH4uNot~en8PkSx9vgfjTcFbf0saFdbcW41TDv6H9LOyPovageJjMMjQYlqg__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n3a0fff47ada3e269p\thttps://xview3downloads.xview.us/public/3a0fff47ada3e269p.tar.gz?Expires=1786288363&Signature=q7pAonTRZ7lDA5aq6VEPhr0pAorrFAHChBFJ0X5IRCzfm22aZv3ZiIWq8pM~4C7csF9w18343LwnCFIY-Br6qPsKbV2JH50zMv4fPNY4XzA6GxW6oMu3T9RQ5-QsfkNL2U3JGol4yulMOs2saF~0iOEcrLLGEXhPY6yN8T-6Sbx6aglzWIg3-wPsOAN-aN6UzeDzjPzq5H36sV77uHiVq7h2zRgJ-Fjm~oAdwBfajcv5Jsz3txhxD3kqSIswi~6YCi9bkp0cnCe850PHP-IbxGxf753PJS8UJRBPHUPNKoMs0~EO53cjCYknqWhxzXlHPy8qIzvxuohx7tgQFkzx~Q__&Key-Pair-Id=APKAIKGDJB5C3XUL2DXQ\n"
RUN_MODE = "FULL"  # SMOKE | FULL

if __name__ == "__main__":
    mpath = WORK / "scene_manifest.tsv"
    WORK.mkdir(parents=True, exist_ok=True)
    mpath.write_text(SMOKE_TSV if RUN_MODE == "SMOKE" else FULL_TSV)
    main(str(mpath))

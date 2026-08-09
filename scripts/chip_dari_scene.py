#!/usr/bin/env python3
"""Chip SAR 256x256 px untuk golden set E5, dibaca PER-WINDOW dari tar scene.

Masukan: artefak sar_detection di experiments/e5/goldenset/inv-e5-*/artifacts/*.json
(payload.scene_id + payload.row/col) x scene di data/raw/xview3/scenes/<scene>.tar.gz.
Keluaran: experiments/e5/goldenset/<inv>/chips/chip-00N.png + chips.json (path, sha256,
jendela, rentang kontras) per investigasi.

Tar TIDAK PERNAH diekstrak: GDAL /vsitar/ membuka <scene>/VH_dB.tif di dalam arsip dan
rasterio membaca hanya jendela 256x256 yang diminta (band VH_dB, float16 dB). Satu
rasterio.open per scene — membuka arsip yang dimampatkan maksimal itu mahal (~6 dtk),
membaca jendela tidak (~0,1 dtk).

Gaya visual mengikuti chip golden lama (packages/core/golden/investigations/inv-x3-*):
regangan kontras persentil 2-98 pada piksel berhingga, dibulatkan ke 8-bit. Tambahan
untuk E5: penanda amber #F0A63C (cincin terbuka, tidak menutupi target) di piksel
deteksi, jadi chip berwarna RGB, bukan L seperti chip lama.

  .venv/bin/python scripts/chip_dari_scene.py [inv-e5-...]   # semua inv bila kosong
  .venv/bin/python scripts/chip_dari_scene.py --selftest     # cek jalan tunggal

--selftest mereproduksi chip golden a-x3-3bc01ebc-01-001 lewat jalur baca yang sama
dan menuntut kesamaan piksel-per-piksel; itu yang gagal kalau jendela, band, atau
regangan kontras bergeser.
"""
import glob
import hashlib
import json
import os
import pathlib
import sys

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.windows import Window

ROOT = pathlib.Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "experiments/e5/goldenset"
SCENES = ROOT / "data/raw/xview3/scenes"
CHIP_PX = 256
CHIP_KB_MAX = 300
PERSENTIL = (2, 98)
AMBER = (0xF0, 0xA6, 0x3C)  # tokens.css --amber, status terkonfirmasi
MARKER_R, MARKER_W = 12, 2


def vsipath(scene):
    return f"/vsitar/{SCENES}/{scene}.tar.gz/{scene}/VH_dB.tif"


def baca_jendela(ds, row, col):
    """Jendela CHIP_PX berpusat di (row,col), digeser ke dalam batas scene bila
    deteksi dekat tepi. Mengembalikan (array, off_x, off_y) supaya penanda tetap
    jatuh di piksel deteksi, bukan di tengah chip secara buta."""
    x = int(min(max(col - CHIP_PX // 2, 0), max(ds.width - CHIP_PX, 0)))
    y = int(min(max(row - CHIP_PX // 2, 0), max(ds.height - CHIP_PX, 0)))
    a = ds.read(1, window=Window(x, y, CHIP_PX, CHIP_PX)).astype("float32")
    return a, x, y


def regang(a):
    """Persentil 2-98 -> uint8. None bila jendela tidak punya piksel berhingga."""
    m = np.isfinite(a)
    if not m.any():
        return None, None, None
    lo, hi = (float(v) for v in np.percentile(a[m], PERSENTIL))
    if hi <= lo:
        return None, lo, hi
    g = np.clip((np.nan_to_num(a, nan=lo) - lo) / (hi - lo), 0, 1)
    return (g * 255).round().astype("uint8"), lo, hi


def render(g, cx, cy):
    im = Image.fromarray(g, mode="L").convert("RGB")
    d = ImageDraw.Draw(im)
    d.ellipse(
        [cx - MARKER_R, cy - MARKER_R, cx + MARKER_R, cy + MARKER_R],
        outline=AMBER,
        width=MARKER_W,
    )
    return im


def sha256_file(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


def kumpulkan(pola):
    """(scene -> [(inv, art, row, col)]), plus daftar inv yang dilewati + alasannya."""
    per_scene, lewat = {}, []
    for p in sorted(glob.glob(str(GOLDEN / pola / "artifacts" / "*.json"))):
        a = json.loads(pathlib.Path(p).read_text())
        inv = a["inv_id"]
        if a["type"] != "sar_detection":
            continue
        d = a["payload"]
        if d.get("row") is None or d.get("col") is None:
            lewat.append((inv, a["art_id"], d.get("scene_id"), "row/col null (artefak sintetis)"))
            continue
        if not (SCENES / f"{d['scene_id']}.tar.gz").exists():
            lewat.append((inv, a["art_id"], d["scene_id"], "tar scene tidak ada lokal"))
            continue
        per_scene.setdefault(d["scene_id"], []).append((inv, a["art_id"], d["row"], d["col"]))
    return per_scene, lewat


def selftest():
    """Chip golden lama harus lahir kembali identik dari jalur baca ini."""
    ref_png = (
        ROOT / "packages/core/golden/investigations/inv-x3-3bc01ebc-01"
        "/chips/a-x3-3bc01ebc-01-001.png"
    )
    art = json.loads(
        (
            ROOT / "packages/core/golden/investigations/inv-x3-3bc01ebc-01"
            "/artifacts/a-x3-3bc01ebc-01-001.json"
        ).read_text()
    )
    d = art["payload"]
    with rasterio.open(vsipath(d["scene_id"])) as ds:
        a, x, y = baca_jendela(ds, d["row"], d["col"])
    g, lo, hi = regang(a)
    ref = np.array(Image.open(ref_png))
    beda = int(np.abs(g.astype(int) - ref.astype(int)).max())
    assert ref.shape == (CHIP_PX, CHIP_PX) and beda == 0, f"chip golden tidak lahir kembali: {beda}"
    print(f"selftest OK: a-x3-3bc01ebc-01-001 identik (jendela {x},{y}; p2-p98 {lo:.2f},{hi:.2f})")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    pola = argv[0] if argv else "inv-e5-*"
    per_scene, lewat = kumpulkan(pola)
    if not per_scene and not lewat:
        sys.exit(f"tidak ada artefak sar_detection cocok pola {pola}")

    per_inv, gagal = {}, []
    for scene in sorted(per_scene):
        with rasterio.open(vsipath(scene)) as ds:
            for inv, art_id, row, col in sorted(per_scene[scene]):
                a, x, y = baca_jendela(ds, row, col)
                g, lo, hi = regang(a)
                if g is None:
                    gagal.append((inv, art_id, f"jendela tanpa piksel berhingga/kontras nol ({lo},{hi})"))
                    continue
                cx, cy = int(round(col)) - x, int(round(row)) - y
                dst = GOLDEN / inv / "chips"
                dst.mkdir(parents=True, exist_ok=True)
                nama = f"chip-{len(per_inv.get(inv, [])) + 1:03d}.png"
                render(g, cx, cy).save(dst / nama, optimize=True)
                kb = (dst / nama).stat().st_size / 1024.0
                if kb > CHIP_KB_MAX:
                    gagal.append((inv, art_id, f"{kb:.0f}KB > {CHIP_KB_MAX}KB"))
                per_inv.setdefault(inv, []).append(
                    {
                        "art_id": art_id,
                        "path": f"chips/{nama}",
                        "sha256": sha256_file(dst / nama),
                        "bytes": (dst / nama).stat().st_size,
                        "scene_id": scene,
                        "band": "VH_dB",
                        "row": row,
                        "col": col,
                        "jendela_px": {"x": x, "y": y, "w": CHIP_PX, "h": CHIP_PX},
                        "pusat_deteksi_px": {"x": cx, "y": cy},
                        "kontras_db_p2_p98": [round(lo, 4), round(hi, 4)],
                        "penanda": f"cincin #{'%02X%02X%02X' % AMBER} r={MARKER_R}px w={MARKER_W}px",
                    }
                )

    for inv, chips in per_inv.items():
        (GOLDEN / inv / "chips.json").write_text(
            json.dumps(
                {
                    "inv_id": inv,
                    "dibuat_oleh": "scripts/chip_dari_scene.py",
                    "sumber": "data/raw/xview3/scenes/<scene>.tar.gz -> /vsitar/ "
                    "<scene>/VH_dB.tif, baca per-window (tar tidak diekstrak)",
                    "render": f"regangan kontras persentil {PERSENTIL[0]}-{PERSENTIL[1]} "
                    f"pada piksel berhingga jendela, 8-bit; penanda amber di piksel deteksi",
                    "chips": chips,
                },
                indent=1,
                ensure_ascii=False,
            )
            + "\n"
        )

    n = sum(len(v) for v in per_inv.values())
    print(f"chip jadi: {n} pada {len(per_inv)} inv, {len(per_scene)} scene")
    for inv, art_id, scene, alasan in lewat:
        print(f"LEWAT {inv} {art_id} scene={scene}: {alasan}")
    for inv, art_id, alasan in gagal:
        print(f"GAGAL {inv} {art_id}: {alasan}")
    if gagal:
        sys.exit(f"{len(gagal)} chip bermasalah")


if __name__ == "__main__":
    main(sys.argv[1:])

"""Cek jalan tunggal untuk artefak SAR xView3 (inv-x3-*): patuh contracts.md Bagian 1.

Jalankan: .venv/bin/python packages/core/golden/verifikasi_sar_x3.py
Gagal = assert meledak. Tidak ada framework, tidak ada fixture.
Pendamping verifikasi_golden.py (yang mencakup inv-dk-*); keduanya memakai konvensi hash sama:
hash_sha256 = sha256(canonical JSON artefak TANPA field hash_sha256).
"""
import glob
import hashlib
import json
import os

from PIL import Image

GOLDEN = os.path.dirname(os.path.abspath(__file__))
CHIP_PX, CHIP_KB_MAX = 256, 300
TIPE = {"sar_detection", "ais_track_segment", "ais_gap", "ais_anomaly", "zone_rule",
        "behavior_class", "assoc_result", "kinematic_feasibility", "weather", "patrol_report"}
DATASET = {"xview3-public", "cdse-natuna", "cdse-denmark", "dma-aisdk", "gfw-events",
           "marineregions-eez", "open-meteo", "runtime"}
KUNCI_SAR = {"lat", "lon", "row", "col", "length_m_est", "objectness_p", "vessel_p",
             "fishing_p", "confidence_calibrated", "scene_id"}
SCENE_DIR = f"{os.path.dirname(GOLDEN)}/../../data/raw/xview3/scenes"


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def main():
    berkas = sorted(glob.glob(f"{GOLDEN}/investigations/inv-x3-*/artifacts/*.json"))
    assert berkas, "tidak ada artefak inv-x3-*"
    invs, scenes = set(), set()

    for p in berkas:
        a = json.load(open(p))
        inv = os.path.basename(os.path.dirname(os.path.dirname(p)))
        assert set(a) == {"art_id", "inv_id", "type", "source", "sintetis", "payload",
                          "created_at", "hash_sha256"}, (p, sorted(a))
        assert a["art_id"] == os.path.basename(p)[:-5] and a["inv_id"] == inv, p
        assert a["type"] == "sar_detection" and a["type"] in TIPE, p
        assert set(a["source"]) == {"dataset", "ref", "provenance"}, p
        assert a["source"]["dataset"] == "xview3-public" and a["source"]["dataset"] in DATASET, p
        assert len(a["source"]["provenance"]) > 40, p  # kalimat, bukan stub

        # deteksi E1 nyata: tidak boleh berlabel sintetis, dan tidak boleh berisi placeholder
        assert a["sintetis"] is False, f"deteksi E1 nyata tak boleh sintetis: {p}"
        assert a["created_at"].endswith("Z") and len(a["created_at"]) == 20, p

        body = {k: v for k, v in a.items() if k != "hash_sha256"}
        assert hashlib.sha256(canonical(body).encode()).hexdigest() == a["hash_sha256"], \
            f"hash tidak reproducible: {p}"

        d = a["payload"]
        assert set(d) == KUNCI_SAR, (p, sorted(d))
        assert all(d[k] is not None for k in KUNCI_SAR), f"artefak nyata tak boleh punya null: {p}"
        assert -90 <= d["lat"] <= 90 and -180 <= d["lon"] <= 180, p
        assert d["lat"] != 0 or d["lon"] != 0, p
        assert d["row"] >= CHIP_PX // 2 and d["col"] >= CHIP_PX // 2, f"chip keluar batas: {p}"
        assert d["length_m_est"] > 0, p
        for k in ("objectness_p", "vessel_p", "fishing_p", "confidence_calibrated"):
            assert 0.0 <= d[k] <= 1.0, (p, k)
        # kalibrasi E1b belum ada: confidence_calibrated masih objectness_p apa adanya
        assert d["confidence_calibrated"] == d["objectness_p"], p
        assert d["scene_id"] == a["source"]["ref"], p
        assert os.path.exists(f"{SCENE_DIR}/{d['scene_id']}.tar.gz"), \
            f"scene sumber hilang: {d['scene_id']}"

        chip = f"{GOLDEN}/investigations/{inv}/chips/{a['art_id']}.png"
        assert os.path.exists(chip), f"chip hilang: {chip}"
        kb = os.path.getsize(chip) / 1024.0
        assert kb <= CHIP_KB_MAX, f"chip {kb:.0f}KB > {CHIP_KB_MAX}KB: {chip}"
        with Image.open(chip) as im:
            assert im.mode == "L" and im.size == (CHIP_PX, CHIP_PX), (chip, im.mode, im.size)
        invs.add(inv)
        scenes.add(d["scene_id"])

    # tiap chip punya artefak (tidak ada chip yatim)
    chips = glob.glob(f"{GOLDEN}/investigations/inv-x3-*/chips/*.png")
    assert len(chips) == len(berkas), f"{len(chips)} chip vs {len(berkas)} artefak"

    # entri manifest sementara wajib ada untuk tiap investigasi
    man = json.load(open(f"{GOLDEN}/index/manifest.json"))
    items = man["items"] if isinstance(man, dict) else man
    punya = {e["inv_id"] for e in items}
    assert invs <= punya, f"investigasi tanpa entri manifest: {invs - punya}"
    for e in items:
        if e["inv_id"] in invs:
            assert e["split"] == "demo", e

    print(f"OK {len(berkas)} artefak sar_detection, {len(chips)} chip, "
          f"{len(invs)} investigasi, {len(scenes)} scene")


if __name__ == "__main__":
    main()

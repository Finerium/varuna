"""Cek jalan tunggal untuk artefak golden: patuh contracts.md Bagian 1.

Jalankan: .venv/bin/python packages/core/golden/verifikasi_golden.py
Gagal = assert meledak. Tidak ada framework, tidak ada fixture.
"""
import glob
import hashlib
import hmac
import json
import os

GOLDEN = os.path.dirname(os.path.abspath(__file__))
SALT = "varuna-dev-salt-2026"  # dev; produksi via env
QUAD = [(4.834043, 54.743980), (8.876246, 55.161621),
        (9.268373, 53.667686), (5.368205, 53.253666)]
T_ACQ = "2026-08-05T17:16:34.886564Z"
TIPE = {"sar_detection", "ais_track_segment", "ais_gap", "ais_anomaly", "zone_rule",
        "behavior_class", "assoc_result", "kinematic_feasibility", "weather", "patrol_report"}
DATASET = {"xview3-public", "cdse-natuna", "cdse-denmark", "dma-aisdk", "gfw-events",
           "marineregions-eez", "open-meteo", "runtime"}
KUNCI = {
    "ais_track_segment": {"mmsi_hash", "points", "start", "end"},
    "ais_gap": {"mmsi_hash", "t_start", "t_end", "durasi_jam", "sog_sebelum"},
    "sar_detection": {"lat", "lon", "row", "col", "length_m_est", "objectness_p", "vessel_p",
                      "fishing_p", "confidence_calibrated", "scene_id"},
    "kinematic_feasibility": {"gap_art_id", "det_art_id", "jarak_km", "dt_jam", "sog_implied",
                              "ambang_kn", "lolos"},
}


def in_quad(lon, lat):
    inside = False
    for i in range(4):
        x1, y1 = QUAD[i]
        x2, y2 = QUAD[(i + 1) % 4]
        if (y1 > lat) != (y2 > lat):
            if lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def main():
    # mmsi_hash: HMAC-SHA256(salt, mmsi) 16-hex — vektor sanity, bukan sha256 polos
    assert hmac.new(SALT.encode(), b"219384000", hashlib.sha256).hexdigest()[:16] == "7b8e491213848e98"

    # LINGKUP: hanya investigasi Denmark jalur asosiasi. Golden dir ditulis beberapa agen
    # paralel dengan konvensi hash yang belum seragam; melebarkan glob = memeriksa unit
    # kerja orang lain. Lebarkan ke "*" setelah konvensi hash artefak diseragamkan.
    berkas = sorted(glob.glob(f"{GOLDEN}/investigations/inv-dk-*/artifacts/*.json"))
    assert berkas, "tidak ada artefak"
    art = {}
    for p in berkas:
        a = json.load(open(p))
        assert set(a) == {"art_id", "inv_id", "type", "source", "sintetis", "payload",
                          "created_at", "hash_sha256"}, (p, sorted(a))
        assert a["art_id"] == os.path.basename(p)[:-5], p
        assert a["type"] in TIPE and a["source"]["dataset"] in DATASET, p
        assert len(a["source"]["provenance"]) > 40, p  # provenance wajib kalimat, bukan stub
        assert isinstance(a["sintetis"], bool), p
        body = {k: v for k, v in a.items() if k != "hash_sha256"}
        ulang = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"),
                                          ensure_ascii=False).encode()).hexdigest()
        assert ulang == a["hash_sha256"], f"hash tidak reproducible: {p}"
        if a["type"] in KUNCI:
            assert set(a["payload"]) == KUNCI[a["type"]], (p, sorted(a["payload"]))
        art[a["art_id"]] = a

    n = {t: 0 for t in TIPE}
    for a in art.values():
        n[a["type"]] += 1
        t = a["type"]
        if t in ("ais_track_segment", "ais_gap"):
            assert a["sintetis"] is False, f"artefak AIS nyata tak boleh sintetis: {a['art_id']}"
            assert len(a["payload"]["mmsi_hash"]) == 16, a["art_id"]
            int(a["payload"]["mmsi_hash"], 16)  # 16-hex
        if t == "ais_track_segment":
            pts = a["payload"]["points"]
            assert 0 < len(pts) <= 200, (a["art_id"], len(pts))
            assert [p["t"] for p in pts] == sorted(p["t"] for p in pts), a["art_id"]
            assert a["payload"]["start"] == pts[0]["t"] and a["payload"]["end"] == pts[-1]["t"]
            assert all("2026-08-05T15:00:00Z" <= p["t"] <= "2026-08-05T19:00:00Z" for p in pts)
            assert all(set(p) == {"t", "lat", "lon", "sog", "cog"} for p in pts), a["art_id"]
            assert any(in_quad(p["lon"], p["lat"]) for p in pts), \
                f"lintasan tidak melintasi footprint: {a['art_id']}"
        if t == "ais_gap":
            g = a["payload"]
            assert g["durasi_jam"] > 6, a["art_id"]
            assert g["t_start"] <= T_ACQ <= g["t_end"], \
                f"celah tidak beririsan akuisisi: {a['art_id']}"
        if t == "sar_detection" and a["sintetis"]:
            # placeholder menunggu inferensi: nol angka perseptual yang dikarang
            assert all(a["payload"][k] is None for k in
                       ("row", "col", "length_m_est", "objectness_p", "vessel_p", "fishing_p",
                        "confidence_calibrated")), a["art_id"]
            assert in_quad(a["payload"]["lon"], a["payload"]["lat"]), a["art_id"]
        if t == "kinematic_feasibility":
            k = a["payload"]
            # ATURAN GROUNDING: setiap art_id yang dikutip wajib resolvable
            assert k["gap_art_id"] in art and k["det_art_id"] in art, a["art_id"]
            assert art[k["gap_art_id"]]["type"] == "ais_gap", a["art_id"]
            assert abs(k["sog_implied"] - (k["jarak_km"] / 1.852) / k["dt_jam"]) < 1e-2, a["art_id"]
            assert k["lolos"] == (k["sog_implied"] <= k["ambang_kn"]), a["art_id"]
            # target placeholder menular: kinematik ikut berlabel sintetis
            assert a["sintetis"] == art[k["det_art_id"]]["sintetis"], a["art_id"]

    man = json.load(open(f"{GOLDEN}/index/manifest.json"))
    items = man["items"] if isinstance(man, dict) else man
    assert items, "manifest kosong"
    inv_dir = {os.path.basename(os.path.dirname(os.path.dirname(p))) for p in berkas}
    for e in items:
        assert set(e) == {"inv_id", "split", "kasus"}, e
        assert e["split"] in ("kalibrasi", "pelaporan", "demo"), e
    punya = {e["inv_id"] for e in items}
    assert inv_dir <= punya, f"investigasi tanpa entri manifest: {inv_dir - punya}"

    print(f"OK {len(art)} artefak, {len(items)} entri manifest: "
          f"track={n['ais_track_segment']} gap={n['ais_gap']} "
          f"kinematik={n['kinematic_feasibility']} placeholder_det={n['sar_detection']}")


if __name__ == "__main__":
    main()

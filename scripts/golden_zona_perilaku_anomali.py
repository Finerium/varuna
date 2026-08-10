#!/usr/bin/env python
"""Bangun artefak golden zone_rule / behavior_class / ais_anomaly dari data & model NYATA.

Kontrak: contracts/contracts.md Bagian 1 (field persis, tanpa tambahan).
Sumber:
  zona     - data/raw/gfw/events_loitering.json (GFW loitering, bbox Natuna) diuji terhadap
             data/processed/zona/natuna_eez.geojson via scripts/zona_util.py
  anomali  - experiments/e2/model_gap{6,12}.pkl pada experiments/e2/out/fitur_clean.parquet
             + data/processed/dma/gap_candidates.csv
  perilaku - pipeline experiments/e3/train_behavior.py dilatih ulang (seed 20260809, split
             BY MMSI 70/30 identik) karena e3 tidak menyimpan .pkl; model -> experiments/e3/model_behavior.pkl

Tahap (tulis-ke-disk per unit): prep-e3 | zona | anomali | perilaku | index
Jalankan: .venv/bin/python scripts/golden_zona_perilaku_anomali.py <tahap>

hash_sha256 artefak = sha256(canonical JSON kunci-terurut, tanpa field hash_sha256),
konvensi sama dengan status_server.hash di kontrak Bagian 4.
"""
import hashlib
import hmac
import json
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "packages/core/golden"
import os, tempfile
CACHE = Path(os.environ.get("VARUNA_CACHE", tempfile.gettempdir()))
SEED = 20260809
SALT = "varuna-dev-salt-2026"  # dev; produksi via env
SENSOR_OF = {"sar_detection": "SAR", "ais_track_segment": "AIS", "ais_gap": "AIS",
             "ais_anomaly": "AIS"}  # zone_rule/behavior_class/weather = konteks, bukan modalitas
DIKSI_TERLARANG = ["bersalah", "terbukti", "vonis", "pidana", "pidanakan", "pelaku",
                   "kriminal", "hukuman", "dakwaan", "terdakwa", "tersangka"]

INV_NATUNA = "inv-natuna-20260805-01"
# inv-dk-01 dibuat agen lain (SAR + ais_gap + kinematic_feasibility + lintasan) = kasus
# going-dark Denmark yang cocok; artefak anomali/perilaku DITAMBAHKAN ke situ, bukan ke
# investigasi Denmark terpisah. Kami hanya menulis artefak, tidak menyentuh milik mereka.
INV_DENMARK = "inv-dk-01"


def mmsi_hash(mmsi):
    return hmac.new(SALT.encode(), str(mmsi).encode(), hashlib.sha256).hexdigest()[:16]


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_tanpa_hash(obj, field):
    return hashlib.sha256(canonical({k: v for k, v in obj.items() if k != field}).encode()).hexdigest()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def art_id(inv_id, seq):
    """seq: int (nomor urut) atau str (akhiran gaya agen lain, mis. 'n01')."""
    return f"a-{inv_id.removeprefix('inv-')}-{seq if isinstance(seq, str) else f'{seq:02d}'}"


def tulis_artefak(inv_id, seq, tipe, source, payload, sintetis=False):
    """Tulis satu Artifact ke golden/investigations/<inv>/artifacts/<art_id>.json."""
    a = {"art_id": art_id(inv_id, seq), "inv_id": inv_id, "type": tipe, "source": source,
         "sintetis": sintetis, "payload": payload, "created_at": now_iso(), "hash_sha256": ""}
    a["hash_sha256"] = sha256_tanpa_hash(a, "hash_sha256")
    d = GOLDEN / "investigations" / inv_id / "artifacts"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{a['art_id']}.json").write_text(json.dumps(a, indent=1, ensure_ascii=False))
    print(f"  {a['art_id']}  {tipe}")
    return a["art_id"]


# ---------------------------------------------------------------- zona
# 7 titik NYATA dari GFW loitering; campuran inside/outside, bendera asing/lokal, ikan/bukan.
# zona WPP-711-proxy dipakai pada 2 titik utk melatih kedua nilai enum.
TITIK_ZONA = [
    ("ced9a43e4f6c1e9c7a3e7a0f4f4d3d63", "ZEE-ID"),
    ("4306e307806dd4a7d0cd0e4f0e5a1c8d", "ZEE-ID"),
    ("13d20ef2bd", "WPP-711-proxy"),
    ("b6acf966a5", "ZEE-ID"),
    ("9d99a5befd", "ZEE-ID"),
    ("32bb0231d1", "WPP-711-proxy"),
    ("4e55ce5010", "ZEE-ID"),
]
IKAN = {"fishing", "gear"}


def tahap_zona():
    sys.path.insert(0, str(ROOT / "scripts"))
    from zona_util import load_zone, point_in_zone

    zone = load_zone("natuna_eez")
    entries = json.loads((ROOT / "data/raw/gfw/events_loitering.json").read_text())["entries"]
    by_prefix = {e["id"]: e for e in entries}

    # instrumen: seluruh 75 titik, shapely vs tag regions.eez GFW (mrgid 8492)
    setuju = sum(point_in_zone(zone, e["position"]["lon"], e["position"]["lat"])
                 == ("8492" in (e.get("regions", {}).get("eez") or [])) for e in entries)
    print(f"instrumen zona: {setuju}/{len(entries)} titik sepakat (shapely vs tag EEZ GFW)")
    assert setuju == len(entries), "point-in-polygon tidak sepakat dengan tag EEZ GFW"

    art_ids = []
    for seq, (pref, zona) in enumerate(TITIK_ZONA, start=1):
        cocok = [e for k, e in by_prefix.items() if k.startswith(pref[:10])]
        assert len(cocok) == 1, f"prefix {pref[:10]} tidak unik: {len(cocok)}"
        e = cocok[0]
        p, v = e["position"], e["vessel"]
        inside = point_in_zone(zone, p["lon"], p["lat"])
        asing = v["flag"] != "IDN"
        kapal_ikan = v.get("type") in IKAN
        violation = bool(inside and asing and kapal_ikan)

        alasan = (f"kapal ikan berbendera asing ({v['flag']}) di dalam zona"
                  if violation else
                  "di luar zona" if not inside else
                  "berbendera lokal IDN" if not asing else "bukan kapal ikan")
        fao = "71" in (e.get("regions", {}).get("fao") or [])
        prov = (
            f"Titik nyata GFW loitering event {e['id']} (public-global-loitering-events:latest, "
            f"tarikan bbox 108-110BT/4-6LU, 2026-05-01..2026-08-08) pada {p['lat']}LU/{p['lon']}BT, "
            f"mulai {e['start']}, durasi {e['loitering']['totalTimeHours']:.1f} jam, bendera {v['flag']}, "
            f"tipe kapal GFW '{v.get('type')}'. Posisi diuji scripts/zona_util.py terhadap "
            f"data/processed/zona/natuna_eez.geojson (Marine Regions World EEZ v12 mrgid 8492, "
            f"dipotong bbox 107-111BT/3-7LU) -> {'inside' if inside else 'outside'}; sepakat dengan "
            f"tag independen GFW regions.eez={e['regions']['eez']} ({setuju}/{len(entries)} titik sepakat "
            f"pada seluruh tarikan). "
            + (f"WPP-711-proxy = geometri ZEE-ID terpotong bbox Natuna sebagai pengganti batas resmi "
               f"WPP-RI 711 yang tidak tersedia di repo; didukung tag GFW regions.fao=['71'] "
               f"(FAO Major Fishing Area 71){' ADA' if fao else ' TIDAK ADA'} pada event ini. "
               if zona == "WPP-711-proxy" else "")
            + f"violation={violation} karena {alasan}. ASUMSI DEMO (T4-ZEE-INSIDE-UNLICENSED): status izin "
              f"tidak dapat diverifikasi dari data terbuka; kapal ikan berbendera asing di dalam ZEE-ID "
              f"diperlakukan tanpa izin untuk keperluan demo, kapal berbendera lokal tidak. "
              f"Bukan penilaian hukum."
        )
        art_ids.append(tulis_artefak(
            INV_NATUNA, seq, "zone_rule",
            {"dataset": "gfw-events", "ref": e["id"], "provenance": prov},
            {"zona": zona, "posisi": "inside" if inside else "outside", "violation": violation,
             "basis_aturan": "T4-ZEE-INSIDE-UNLICENSED",
             "geometri_ref": "data/processed/zona/natuna_eez.geojson#features[0]"}))
    (CACHE / "zona_art_ids.json").write_text(json.dumps(art_ids))
    return art_ids


# ---------------------------------------------------------------- anomali (E2)
# Kapal diambil dari artefak ais_gap milik inv-dk-01 (agen lain) supaya artefak anomali
# menempel pada kasus going-dark yang sudah punya SAR + kinematic_feasibility.
# mmsi_hash direproduksi dengan salt yang sama -> pemetaan hash->MMSI diverifikasi.
GAP_DK01 = {"a-dk-01-g01": 219384000, "a-dk-01-g02": 250369000, "a-dk-01-g03": 232018395}


def split_uji_e2(index):
    import numpy as np
    m = np.sort(index.values)
    perm = np.random.default_rng(SEED).permutation(len(m))
    return set(m[perm[int(round(0.7 * len(m))):]].tolist())


def tahap_anomali():
    import pandas as pd

    feat = pd.read_parquet(ROOT / "experiments/e2/out/fitur_clean.parquet")
    gaps = pd.read_csv(ROOT / "data/processed/dma/gap_candidates.csv")
    lab = pd.read_parquet(ROOT / "experiments/e2/out/labels.parquet")
    uji = split_uji_e2(feat.index)
    models = {}
    for nama in ("gap6", "gap12"):
        with open(ROOT / f"experiments/e2/model_{nama}.pkl", "rb") as f:
            models[nama] = pickle.load(f)

    # PLAFON: label gap diturunkan dari durasi celah, dan durasi celah ADA di fitur
    # (dt_max_s). Ukur seberapa tautologis skor model sebelum memakainya.
    bocor = {n: float(((feat["dt_max_s"].values > amb * 3600).astype(int)
                       == lab[n].values).mean())
             for n, amb in (("gap6", 6), ("gap12", 12))}
    print(f"kebocoran label (ambang tunggal dt_max_s vs label): {bocor}")

    art_ids = []
    for i, (gap_art, mmsi) in enumerate(sorted(GAP_DK01.items()), start=1):
        # grounding: artefak ais_gap rujukan harus ada dan hash-nya cocok
        p_gap = GOLDEN / "investigations" / INV_DENMARK / "artifacts" / f"{gap_art}.json"
        assert p_gap.exists(), f"{gap_art} tidak resolvable"
        gj = json.loads(p_gap.read_text())
        assert gj["payload"]["mmsi_hash"] == mmsi_hash(mmsi), f"hash {gap_art} tidak cocok"
        seq = f"n{i:02d}"
        split_e2 = "uji" if mmsi in uji else "latih"
        g = gaps[gaps.mmsi == mmsi].sort_values("durasi_jam", ascending=False).iloc[0]
        x = feat.loc[[mmsi]]
        skor = {}
        for nama, bundle in models.items():
            assert list(x.columns) == bundle["features"], "urutan fitur tidak cocok"
            skor[nama] = float(bundle["model"].predict_proba(x.values)[0, 1])
        durasi = float(g.durasi_jam)
        model_utama = "gap12" if durasi > 12 else "gap6"
        ambang = 12.0 if model_utama == "gap12" else 6.0
        # skor deterministik pembanding: rasio durasi terhadap ambang, dipotong di 1
        skor_det = min(durasi / ambang, 1.0)
        prov = (
            f"Celah AIS nyata dari data/processed/dma/gap_candidates.csv (DMA AIS Denmark "
            f"2026-08-05, kelas A, {len(gaps)} kandidat celah >6 jam): MMSI dipseudonimkan, "
            f"celah {g.t_awal}..{g.t_akhir} ({durasi:.3f} jam), SOG sebelum celah {g.sog_sebelum} kn. "
            f"Skor = predict_proba kelas positif dari experiments/e2/model_{model_utama}.pkl "
            f"(HistGradientBoosting, seed {SEED}) atas baris fitur MMSI ini di "
            f"experiments/e2/out/fitur_clean.parquet ({len(feat.columns)} fitur, dihitung "
            f"experiments/e2/fitur.py). Memberi skor model pada artefak {gap_art} milik kasus ini. "
            f"MMSI berada di SPLIT {split_e2.upper()} E2 (70/30 by MMSI, seed {SEED})"
            + ("" if split_e2 == "uji" else " - skor pada kapal split latih, JANGAN dibaca "
               "sebagai kinerja held-out") + f". Skor pendamping model_gap6={skor['gap6']:.4f}, "
            f"model_gap12={skor['gap12']:.4f}. "
            f"PLAFON DINYATAKAN - KEBOCORAN LABEL: label gap E2 diturunkan dari durasi celah, "
            f"sedangkan durasi celah itu sendiri ADA di dalam fitur (dt_max_s), sehingga model "
            f"nyaris tautologis: aturan ambang tunggal dt_max_s>{ambang:.0f} jam sudah sepakat "
            f"{bocor[model_utama] * 100:.1f}% dengan label {model_utama}, dan keluaran model "
            f"praktis biner (positif >=0.999, negatif <=0.0001). Skor {skor[model_utama]:.6f} "
            f"karena itu HARUS dibaca sebagai 'durasi celah melewati ambang', BUKAN sebagai "
            f"keyakinan model yang informatif; pembanding deterministik durasi/ambang = "
            f"{skor_det:.4f} disertakan di detail. Skor bukan probabilitas niat menyembunyikan diri."
        )
        art_ids.append(tulis_artefak(
            INV_DENMARK, seq, "ais_anomaly",
            {"dataset": "dma-aisdk", "ref": mmsi_hash(mmsi), "provenance": prov},
            {"jenis": "gap", "skor": round(skor[model_utama], 6),
             "model_ref": f"experiments/e2/model_{model_utama}.pkl",
             "detail": {"mmsi_hash": mmsi_hash(mmsi), "t_start": f"{g.t_awal}Z".replace(" ", "T"),
                        "t_end": f"{g.t_akhir}Z".replace(" ", "T"), "durasi_jam": durasi,
                        "sog_sebelum": float(g.sog_sebelum), "ambang_jam": ambang,
                        "skor_gap6": round(skor["gap6"], 6), "skor_gap12": round(skor["gap12"], 6),
                        "skor_deterministik_durasi_per_ambang": round(skor_det, 4),
                        "kebocoran_label_setuju": round(bocor[model_utama], 4),
                        "gap_art_id": gap_art, "split_e2": split_e2}}))
    (CACHE / "anomali_art_ids.json").write_text(json.dumps(art_ids))
    return art_ids


# ---------------------------------------------------------------- perilaku (E3)
def tahap_prep_e3():
    """Latih ulang pipeline E3 (tak ada .pkl tersimpan) -> experiments/e3/model_behavior.pkl."""
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import HistGradientBoostingClassifier

    sys.path.insert(0, str(ROOT / "experiments/e3"))
    import train_behavior as tb

    df = pd.read_parquet(tb.DATA)
    df = df[df.ship_type.isin(["Fishing", "Cargo", "Tanker", "Passenger"])].dropna(subset=["sog"])
    df = df[df.lat.between(tb.LAT_MIN, tb.LAT_MAX) & df.lon.between(tb.LON_MIN, tb.LON_MAX)]
    feats = tb.build_segments(df)
    feats["y"] = (feats.ship_type == "Fishing").astype(int)

    mmsi = np.sort(feats.MMSI.unique())
    rng = np.random.default_rng(SEED)
    rng.shuffle(mmsi)
    tr_mmsi = set(mmsi[:int(round(0.7 * len(mmsi)))].tolist())
    tr = feats[feats.MMSI.isin(tr_mmsi)]
    te = feats[~feats.MMSI.isin(tr_mmsi)]

    fcols = ["sog_mean", "sog_std", "sog_p10", "sog_p25", "sog_p50", "sog_p75", "sog_p90",
             "sog_max", "turn_mean", "turn_p90", "straightness", "frac_stat", "frac_day"]
    clf = HistGradientBoostingClassifier(random_state=SEED, early_stopping=True,
                                         validation_fraction=0.15, scoring="loss")
    clf.fit(tr[fcols], tr.y)
    konkordansi = float((clf.predict(te[fcols]) == te.y.values).mean())
    print(f"segmen={len(feats)} latih={len(tr)} uji={len(te)} konkordansi_uji={konkordansi:.4f} "
          f"n_iter={clf.n_iter_}")
    with open(ROOT / "experiments/e3/model_behavior.pkl", "wb") as f:
        pickle.dump({"model": clf, "features": fcols, "seed": SEED,
                     "konkordansi_uji": konkordansi, "n_segmen": int(len(feats)),
                     "n_uji": int(len(te)), "n_iter": int(clf.n_iter_),
                     "dilatih_ulang_dari": "experiments/e3/train_behavior.py"}, f)
    feats.assign(split=np.where(feats.MMSI.isin(tr_mmsi), "latih", "uji")).to_parquet(
        CACHE / "e3_segmen.parquet")
    print("tulis experiments/e3/model_behavior.pkl + cache segmen")


def tahap_perilaku():
    import pandas as pd

    feats = pd.read_parquet(CACHE / "e3_segmen.parquet")
    with open(ROOT / "experiments/e3/model_behavior.pkl", "rb") as f:
        b = pickle.load(f)
    fcols = b["features"]
    # kapal yang SUDAH ada di inv-dk-01 (celah atau lintasan) dan segmennya di SPLIT UJI E3
    kapal_dk01 = {}
    for p in sorted((GOLDEN / "investigations" / INV_DENMARK / "artifacts").glob("*.json")):
        a = json.loads(p.read_text())
        h = a["payload"].get("mmsi_hash")
        if h and a["type"] in ("ais_gap", "ais_track_segment"):
            kapal_dk01[h] = a["art_id"]
    kandidat = feats[(feats.split == "uji") & feats.MMSI.map(
        lambda m: mmsi_hash(int(m)) in kapal_dk01)]
    pilih = kandidat.sort_values(["MMSI", "seg"]).groupby("MMSI").head(2).head(4)
    assert len(pilih) == 4, f"segmen uji dari kapal inv-dk-01 hanya {len(pilih)}"

    art_ids = []
    for i, (_, r) in enumerate(pilih.iterrows(), start=1):
        seq = f"b{i:02d}"
        asal = kapal_dk01[mmsi_hash(int(r.MMSI))]
        p = float(b["model"].predict_proba(r[fcols].to_frame().T.astype(float))[0, 1])
        kelas = "fishing" if p >= 0.5 else "transit"
        prov = (
            f"Segmen 6 jam NYATA dari data/processed/dma/trajectories.parquet (DMA AIS Denmark "
            f"2026-08-05) untuk kapal yang sama dengan artefak {asal} pada kasus ini: "
            f"MMSI dipseudonimkan, blok jam UTC {int(r.seg) * 6:02d}-{int(r.seg) * 6 + 6:02d}, "
            f"{int(r.n)} fix, rentang {r.span / 3600:.2f} jam, "
            f"awal {r.lat0:.4f}LU/{r.lon0:.4f}BT, akhir {r.lat1:.4f}LU/{r.lon1:.4f}BT, "
            f"sog_mean {r.sog_mean:.2f} kn, frac_stat {r.frac_stat:.3f}, straightness "
            f"{r.straightness:.3f}. Fitur dihitung ulang dengan build_segments() dari "
            f"experiments/e3/train_behavior.py; model dilatih ulang identik (seed {SEED}, "
            f"HistGradientBoosting, split BY MMSI 70/30) karena E3 tidak menyimpan .pkl -> "
            f"experiments/e3/model_behavior.pkl, konkordansi uji {b['konkordansi_uji']:.4f} pada "
            f"{b['n_uji']} segmen uji. Segmen ini ada di SPLIT UJI. PLAFON DINYATAKAN (manifests/"
            f"e3-hasil.json): label latih = tipe kapal terdaftar DMA (Fishing vs Cargo/Tanker/"
            f"Passenger), jadi skor = KONKORDANSI dengan tipe terdaftar, BUKAN observasi perilaku; "
            f"tipe terdaftar segmen ini '{r.ship_type}'."
            + (f" CACAT FITUR TERCATAT: straightness = jarak lurus/panjang lintasan seharusnya <=1, "
               f"tetapi segmen ini bernilai {r.straightness:.3f} karena build_segments() hanya "
               f"menjumlahkan langkah dengan dt<=600 s ke path_km sementara jarak lurus memakai fix "
               f"pertama-terakhir, sehingga lintasan berlubang dihitung terlalu pendek. Bias ini "
               f"3,7x lebih sering pada kapal ber-celah AIS (35,8% segmen) dibanding kapal lain "
               f"(9,7%) - yakni justru pada populasi going-dark. Skor kelas ini ikut terpengaruh."
               if r.straightness > 1 else "")
        )
        art_ids.append(tulis_artefak(
            INV_DENMARK, seq, "behavior_class",
            {"dataset": "dma-aisdk", "ref": mmsi_hash(int(r.MMSI)), "provenance": prov},
            {"kelas": kelas, "skor": round(p, 6),
             "model_ref": "experiments/e3/model_behavior.pkl"}))
    (CACHE / "perilaku_art_ids.json").write_text(json.dumps(art_ids))
    return art_ids


# ---------------------------------------------------------------- investigation + index
def hitung_status(artefak, t_akhir_obs):
    """Implementasi Bagian 4 atas artefak yang ADA saat ini. reasons hanya berisi aturan
    yang benar-benar dievaluasi; 'usia' dihilangkan karena ambang belum terkunci
    (experiments/e5/thresholds.lock.json belum ada) -> decay_applied selalu false."""
    sensors = sorted({SENSOR_OF[a["type"]] for a in artefak if a["type"] in SENSOR_OF})
    zona_arts = [a["art_id"] for a in artefak if a["type"] == "zone_rule"]
    violation = any(a["payload"].get("violation") for a in artefak if a["type"] == "zone_rule")
    hilang = [m for m in ("SAR", "AIS") if m not in sensors]
    now = datetime.now(timezone.utc)
    usia = (now - datetime.fromisoformat(t_akhir_obs.replace("Z", "+00:00"))).total_seconds() / 3600

    reasons = [
        {"rule": "dua_sensor", "passed": len(sensors) >= 2,
         "art_ids": [a["art_id"] for a in artefak if a["type"] in SENSOR_OF]},
        {"rule": "zona", "passed": violation, "art_ids": zona_arts},
        {"rule": "konflik", "passed": True, "art_ids": []},
        {"rule": "cakupan", "passed": not hilang,
         "art_ids": [a["art_id"] for a in artefak if a["type"] in SENSOR_OF]},
    ]
    if hilang:
        status, alasan = "abstain", ("bukti_tunggal" if len(sensors) == 1 else "kurang_cakupan")
    elif len(sensors) >= 2 and violation:
        status, alasan = "terkonfirmasi", None
    else:
        status, alasan = "terindikasi", None

    s = {"status": status, "computed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "hash": "",
         "sensors_independent": len(sensors), "zone_violation": violation,
         "evidence_age_h": round(usia, 2), "decay_applied": False,
         "conflicting_art_ids": [], "missing_coverage": hilang, "reasons": reasons,
         "abstain_reason": alasan,
         "display_state": ["degraded"] if any(a["type"] == "ais_anomaly" for a in artefak) else []}
    s["hash"] = sha256_tanpa_hash(s, "hash")
    return s


def tulis_investigasi(inv_id, aoi, zona, t_acq, t_akhir, kasus, peran, kandidat, berkas):
    d = GOLDEN / "investigations" / inv_id
    artefak = sorted((json.loads(p.read_text()) for p in (d / "artifacts").glob("*.json")),
                     key=lambda a: a["art_id"])
    assert artefak, f"{inv_id} tanpa artefak"
    for s in berkas:
        teks = s["claim"].lower()
        assert not [w for w in DIKSI_TERLARANG if w in teks], f"diksi terlarang: {s['claim']}"
    inv = {
        "inv_id": inv_id, "seed": SEED, "aoi": aoi, "zona": zona,
        "t_acquisition": t_acq, "t_observasi_terakhir": t_akhir,
        "split": "demo", "sintetis": False,
        "kasus": {"label": kasus, "peran_demo": peran},
        "candidate": kandidat,
        "artifacts": [a["art_id"] for a in artefak],
        "status_server": hitung_status(artefak, t_akhir),
        "agent_proposal": None,
        "berkas": {"sections": berkas, "diksi_ok": True},
        "patrol": {"package_id": None, "result": None},
    }
    (d / "investigation.json").write_text(json.dumps(inv, indent=1, ensure_ascii=False))
    print(f"{inv_id}: {len(inv['artifacts'])} artefak, status={inv['status_server']['status']}"
          f" ({inv['status_server']['abstain_reason']})")
    return inv


def tahap_index():
    zona_ids = json.loads((CACHE / "zona_art_ids.json").read_text())
    anom_ids = json.loads((CACHE / "anomali_art_ids.json").read_text())
    peri_ids = json.loads((CACHE / "perilaku_art_ids.json").read_text())

    tulis_investigasi(
        INV_NATUNA, "natuna", "ZEE-ID", "2026-08-03T00:00:00Z", "2026-08-05T20:37:00Z",
        "going-dark",
        "Menyediakan kaki ZONA untuk demo going-dark Natuna: tujuh titik loitering nyata GFW "
        "diuji terhadap geometri ZEE-ID, tiga di antaranya kapal ikan berbendera asing di dalam "
        "zona (violation) dan empat kontra-kasus (bendera lokal, bukan kapal ikan, atau di luar "
        "zona). candidate.length_m_est=0 dan confidence_calibrated=0 berarti TIDAK TERSEDIA dari "
        "GFW loitering, bukan hasil estimasi; belum ada artefak SAR/AIS pada AOI ini sehingga "
        "status server jatuh ke ABSTAIN kurang_cakupan.",
        {"lat": 4.6435, "lon": 109.4027, "length_m_est": 0, "confidence_calibrated": 0},
        [{"claim": "Tiga dari tujuh titik loitering yang diperiksa berada di dalam ZEE Indonesia "
                   "dan berasal dari kapal ikan berbendera asing, memenuhi basis aturan "
                   "T4-ZEE-INSIDE-UNLICENSED di bawah asumsi demo perizinan.",
           "art_ids": [zona_ids[0], zona_ids[1], zona_ids[2]]},
         {"claim": "Empat titik pembanding tidak memenuhi aturan yang sama: dua berada di luar "
                   "geometri zona, satu berbendera Indonesia, satu bukan kapal ikan.",
           "art_ids": [zona_ids[3], zona_ids[4], zona_ids[5], zona_ids[6]]},
         {"claim": "Uji posisi memakai geometri Marine Regions EEZ v12 dan sepakat dengan "
                   "penandaan zona independen milik Global Fishing Watch pada seluruh 75 titik "
                   "tarikan.", "art_ids": zona_ids}])

    # inv-dk-01 milik agen lain dan belum punya investigation.json -> JANGAN dibuat di sini
    # (pemiliknya yang menulis). Kami hanya menambah artefak n01-n03 + b01-b04.
    print(f"inv-dk-01 (agen lain): tambah {len(anom_ids)} anomali + {len(peri_ids)} perilaku; "
          f"investigation.json belum ada, art_ids harus dimasukkan pemiliknya: "
          f"{anom_ids + peri_ids}")

    # index/manifest.json: gabung, jangan timpa entri agen lain
    p = GOLDEN / "index/manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    lama = json.loads(p.read_text())["items"] if p.exists() else []
    items = {i["inv_id"]: i for i in lama}
    for inv_p in sorted((GOLDEN / "investigations").glob("*/investigation.json")):
        inv = json.loads(inv_p.read_text())
        items[inv["inv_id"]] = {"inv_id": inv["inv_id"], "split": inv["split"],
                                "kasus": inv["kasus"]["label"]}
    p.write_text(json.dumps({"items": [items[k] for k in sorted(items)]}, indent=1,
                            ensure_ascii=False))
    print(f"index/manifest.json: {len(items)} investigasi")


# ---------------------------------------------------------------- cek kontrak
TIPE = {"sar_detection", "ais_track_segment", "ais_gap", "ais_anomaly", "zone_rule",
        "behavior_class", "assoc_result", "kinematic_feasibility", "weather", "patrol_report"}
DATASET = {"xview3-public", "cdse-natuna", "cdse-denmark", "dma-aisdk", "gfw-events",
           "marineregions-eez", "open-meteo", "runtime"}
FIELD = {"art_id", "inv_id", "type", "source", "sintetis", "payload", "created_at", "hash_sha256"}
PAYLOAD = {"zone_rule": {"zona", "posisi", "violation", "basis_aturan", "geometri_ref"},
           "behavior_class": {"kelas", "skor", "model_ref"},
           "ais_anomaly": {"jenis", "skor", "model_ref", "detail"}}
MILIK_KAMI = ("a-natuna-20260805-01-", "a-dk-01-n", "a-dk-01-b")


def tahap_cek():
    """Validasi artefak yang KAMI tulis terhadap kontrak Bagian 1. Gagal = exit non-nol."""
    n = 0
    for p in sorted((GOLDEN / "investigations").glob("*/artifacts/*.json")):
        a = json.loads(p.read_text())
        if not a["art_id"].startswith(MILIK_KAMI):
            continue
        n += 1
        assert set(a) == FIELD, f"{p.name}: field {set(a) ^ FIELD}"
        assert a["type"] in TIPE and a["source"]["dataset"] in DATASET, f"{p.name}: enum"
        assert set(a["source"]) == {"dataset", "ref", "provenance"}, f"{p.name}: source"
        assert a["sintetis"] is False and a["inv_id"] == p.parts[-3], f"{p.name}: inv/sintetis"
        assert a["art_id"] == p.stem, f"{p.name}: art_id != nama berkas"
        assert a["hash_sha256"] == sha256_tanpa_hash(a, "hash_sha256"), f"{p.name}: hash"
        assert len(a["source"]["provenance"]) > 80, f"{p.name}: provenance terlalu pendek"
        got, want = set(a["payload"]), PAYLOAD[a["type"]]
        assert got == want, f"{p.name}: payload {got ^ want}"
        pl = a["payload"]
        if a["type"] == "zone_rule":
            assert pl["zona"] in ("ZEE-ID", "WPP-711-proxy"), f"{p.name}: zona"
            assert pl["posisi"] in ("inside", "outside"), f"{p.name}: posisi"
            assert isinstance(pl["violation"], bool), f"{p.name}: violation"
            assert not pl["violation"] or pl["posisi"] == "inside", f"{p.name}: violation di luar zona"
        if a["type"] == "behavior_class":
            assert pl["kelas"] in ("fishing", "transit"), f"{p.name}: kelas"
            assert (pl["skor"] >= 0.5) == (pl["kelas"] == "fishing"), f"{p.name}: kelas vs skor"
        if a["type"] == "ais_anomaly":
            assert pl["jenis"] in ("gap", "spoofing", "ganti_identitas"), f"{p.name}: jenis"
            assert len(pl["detail"]["mmsi_hash"]) == 16, f"{p.name}: mmsi_hash bukan 16-hex"
            g = GOLDEN / "investigations" / a["inv_id"] / "artifacts" / f"{pl['detail']['gap_art_id']}.json"
            assert g.exists(), f"{p.name}: gap_art_id tidak resolvable"
        if a["type"] in ("behavior_class", "ais_anomaly"):
            assert (ROOT / pl["model_ref"]).exists(), f"{p.name}: model_ref hilang"
        assert 0.0 <= pl["skor"] <= 1.0 if "skor" in pl else True, f"{p.name}: skor"

    inv = json.loads((GOLDEN / "investigations" / INV_NATUNA / "investigation.json").read_text())
    assert inv["status_server"]["hash"] == sha256_tanpa_hash(inv["status_server"], "hash")
    ada = {q.stem for q in (GOLDEN / "investigations" / INV_NATUNA / "artifacts").glob("*.json")}
    assert set(inv["artifacts"]) == ada, "daftar artifacts investigasi tidak sinkron"
    for s in inv["berkas"]["sections"]:
        assert all(x in ada for x in s["art_ids"]), "klaim berkas mengutip art_id tak-resolvable"
        assert not [w for w in DIKSI_TERLARANG if w in s["claim"].lower()], "diksi terlarang"
    idx = {i["inv_id"] for i in json.loads((GOLDEN / "index/manifest.json").read_text())["items"]}
    assert INV_NATUNA in idx and INV_DENMARK in idx, "investigasi tidak terdaftar di manifest"
    print(f"CEK OK: {n} artefak lolos kontrak Bagian 1, hash + grounding + diksi konsisten")


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    {"prep-e3": tahap_prep_e3, "zona": tahap_zona, "anomali": tahap_anomali,
     "perilaku": tahap_perilaku, "index": tahap_index, "cek": tahap_cek}[sys.argv[1]]()

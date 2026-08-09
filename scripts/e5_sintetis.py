#!/usr/bin/env python3
"""Lengan SINTETIS E5 (protokol beku, E5 komposisi: ">= 3 kasus edge sintetis
berlabel sintetis (SAR-only, AIS-only, bukti konflik)").

Tiga investigasi BY-CONSTRUCTION. Tidak satu pun angka di sini mengaku berasal dari
sensor: yang diuji hanya MEKANIKA gerbang — bahwa PASHA memberi status yang
dituliskan kontrak pada tiga bentuk bukti yang tidak muncul di scene berlabel
(satu modalitas saja; dua modalitas yang saling meniadakan). Sesuai E5.5, tidak ada
klaim akurasi yang boleh disandarkan pada lengan ini.

Status TIDAK ditulis tangan: tiap inv dihitung via CLI gerbang
(packages/core/bin/gate.ts) dengan experiments/e5/thresholds.lock.json — fungsi murni
yang sama dengan produksi. HARAPAN per jenis dituliskan DULU (tabel HARAPAN di bawah)
lalu dibandingkan dengan keluaran gerbang; ketidakcocokan DILAPORKAN apa adanya dan
exit != 0, tidak pernah disetel sampai cocok.

Amplop artefak mengikuti packages/core/src/schemas.ts (created_at / observed_at /
sintetis), BUKAN 't_tulis' yang dipakai scripts/e5_compose.py: gerbang membaca
created_at, dan kasus konflik mustahil dibangun di atas sumbu waktu yang tidak terbaca
gerbang. Basis adjudikasi di-APPEND ke manifests/e5-adjudikasi-basis.json; entri lama
tidak pernah disentuh. Deterministik: tanpa RNG, seed dicatat untuk jejak saja.

Jalankan: .venv/bin/python scripts/e5_sintetis.py
"""
import hashlib
import json
import math
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "experiments/e5/goldenset"
ADJ = ROOT / "manifests/e5-adjudikasi-basis.json"
LOCK = ROOT / "experiments/e5/thresholds.lock.json"
SEED = 20260809
NOW = "2026-08-09T11:00:00Z"  # jam demo-frame, sama dengan e5_compose.py
T_INGEST = "2026-08-09T10:55:00Z"  # waktu tulis artefak (created_at)
LABEL = "SINTETIS by-construction utk E5 edge"

# Harapan pra-registrasi, ditulis SEBELUM gerbang dijalankan (protokol E5 edge):
#   (status, abstain_reason)
HARAPAN = {
    "inv-e5-sint-01": ("terindikasi", None),
    "inv-e5-sint-02": ("terindikasi", None),
    "inv-e5-sint-03": ("abstain", "konflik_artefak"),
}

R_BUMI_KM = 6371.0088
KM_PER_NM = 1.852


def canon(a):
    """sha256 JSON kanonik artefak TANPA field hash_sha256 (konvensi golden)."""
    b = {k: v for k, v in a.items() if k != "hash_sha256"}
    return hashlib.sha256(
        json.dumps(b, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def haversine_km(lat1, lon1, lat2, lon2):
    r = math.radians
    dlat, dlon = r(lat2 - lat1), r(lon2 - lon1)
    h = math.sin(dlat / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * R_BUMI_KM * math.asin(min(1.0, math.sqrt(h)))


def mmsi_hash(label):
    """Pseudonim 16-hex deterministik. Bukan MMSI: tidak ada kapal nyata di sini."""
    return hashlib.sha256(label.encode()).hexdigest()[:16]


def artefak(art_id, inv_id, tipe, payload, observed_at, alasan):
    a = {
        "art_id": art_id,
        "inv_id": inv_id,
        "type": tipe,
        "source": {
            "dataset": "runtime",
            "ref": f"e5-sintetis/{inv_id}",
            "provenance": f"{LABEL}. {alasan} Dibangkitkan scripts/e5_sintetis.py "
            f"(seed {SEED}, frame waktu {NOW}); TIDAK ada piksel, fix AIS, atau "
            "scene nyata di balik angka ini. Dipakai hanya untuk menguji mekanika "
            "gerbang PASHA pada bentuk bukti edge; tidak boleh menjadi dasar klaim "
            "akurasi atau kecukupan evidensial (protokol E5.5).",
        },
        "sintetis": True,
        "payload": payload,
        "created_at": T_INGEST,
        "observed_at": observed_at,
    }
    a["hash_sha256"] = canon(a)
    return a


# --- tiga kasus edge ---------------------------------------------------------
# Geografi: Laut Natuna Utara (WPP-711), angka bulat supaya jelas dikarang.
SAR_LAT, SAR_LON = 4.5, 108.5
KONFLIK_LAT, KONFLIK_LON = 4.5, 110.3  # ~200 km timur; 1 jam -> ~108 kn


def kasus_sar_only():
    inv = "inv-e5-sint-01"
    a = artefak(
        f"a-{inv[4:]}-001",
        inv,
        "sar_detection",
        {
            "lat": SAR_LAT,
            "lon": SAR_LON,
            # row/col/probabilitas SENGAJA null: tidak ada scene, jadi tidak ada
            # angka perseptual yang boleh dikarang (preseden golden a-dk-01-d01).
            "row": None,
            "col": None,
            "length_m_est": None,
            "objectness_p": None,
            "vessel_p": None,
            "fishing_p": None,
            "confidence_calibrated": None,
            "scene_id": "SINTETIS-SAR-ONLY-01",
        },
        "2026-08-09T09:00:00Z",
        "Kasus edge SAR-only: satu deteksi radar tanpa artefak AIS apa pun, "
        "sehingga cakupan AIS kosong dan hanya satu modalitas yang mengamati.",
    )
    return inv, [a], "sintetis-sar-only", (
        "Satu artefak sar_detection; nol artefak bermodalitas AIS. "
        "sensors_independent = 1, missing_coverage = [AIS]."
    )


def kasus_ais_only():
    inv = "inv-e5-sint-02"
    mh = mmsi_hash("SINTETIS-E5-AIS-ONLY-01")
    pts = [
        {"t": "2026-08-09T08:00:00Z", "lat": 4.400, "lon": 108.400, "sog": 8.0, "cog": 45.0},
        {"t": "2026-08-09T09:00:00Z", "lat": 4.450, "lon": 108.450, "sog": 8.0, "cog": 45.0},
        {"t": "2026-08-09T10:00:00Z", "lat": 4.500, "lon": 108.500, "sog": 8.0, "cog": 45.0},
    ]
    a = artefak(
        f"a-{inv[4:]}-001",
        inv,
        "ais_track_segment",
        {"mmsi_hash": mh, "points": pts, "start": pts[0]["t"], "end": pts[-1]["t"]},
        pts[-1]["t"],
        "Kasus edge AIS-only: satu segmen lintasan AIS tanpa deteksi SAR apa pun, "
        "sehingga cakupan SAR kosong dan hanya satu modalitas yang mengamati.",
    )
    return inv, [a], "sintetis-ais-only", (
        "Satu artefak ais_track_segment (3 fix); nol artefak sar_detection. "
        "sensors_independent = 1, missing_coverage = [SAR]."
    )


def kasus_konflik(th):
    inv = "inv-e5-sint-03"
    t_sar, t_ais = "2026-08-09T09:00:00Z", "2026-08-09T10:00:00Z"
    dt_jam = 1.0
    jarak = haversine_km(SAR_LAT, SAR_LON, KONFLIK_LAT, KONFLIK_LON)
    sog = jarak / dt_jam / KM_PER_NM
    detail = (
        f"Dua artefak mengklaim posisi objek yang sama pada jendela {dt_jam:.0f} jam "
        f"(<= konflik_jendela_jam = {th['konflik_jendela_jam']} jam), terpisah "
        f"{jarak:.1f} km: sog_implied {sog:.1f} kn > ambang_kn {th['ambang_kn']}. "
        "Posisi tak terdamaikan secara kinematik."
    )
    sar = artefak(
        f"a-{inv[4:]}-001",
        inv,
        "sar_detection",
        {
            "lat": SAR_LAT,
            "lon": SAR_LON,
            "row": None,
            "col": None,
            "length_m_est": None,
            "objectness_p": None,
            "vessel_p": None,
            "fishing_p": None,
            "confidence_calibrated": None,
            "scene_id": "SINTETIS-KONFLIK-01",
        },
        t_sar,
        f"Kasus edge bukti-konflik (sisi SAR). {detail}",
    )
    ais = artefak(
        f"a-{inv[4:]}-002",
        inv,
        "ais_track_segment",
        {
            "mmsi_hash": mmsi_hash("SINTETIS-E5-KONFLIK-01"),
            "points": [
                {
                    "t": "2026-08-09T09:00:00Z",
                    "lat": KONFLIK_LAT,
                    "lon": KONFLIK_LON - 0.05,
                    "sog": 9.0,
                    "cog": 90.0,
                },
                {"t": t_ais, "lat": KONFLIK_LAT, "lon": KONFLIK_LON, "sog": 9.0, "cog": 90.0},
            ],
            "start": "2026-08-09T09:00:00Z",
            "end": t_ais,
        },
        t_ais,
        f"Kasus edge bukti-konflik (sisi AIS). {detail}",
    )
    return inv, [sar, ais], "sintetis-konflik", detail


def gate(artifacts, th):
    r = subprocess.run(
        ["npx", "tsx", str(ROOT / "packages/core/bin/gate.ts")],
        input=json.dumps({"artifacts": artifacts, "now": NOW, "thresholds": th}),
        capture_output=True,
        text=True,
        cwd=ROOT / "packages/core",
    )
    if r.returncode != 0:
        sys.exit(f"gate gagal: {r.stderr.strip()[:400]}")
    return json.loads(r.stdout)


def tulis(inv, arts, status):
    d = OUT / inv
    (d / "artifacts").mkdir(parents=True, exist_ok=True)
    for a in arts:
        (d / "artifacts" / f"{a['art_id']}.json").write_text(
            json.dumps(a, indent=1, ensure_ascii=False) + "\n"
        )
    (d / "grounding.json").write_text(
        json.dumps(
            {
                "art_ids": [a["art_id"] for a in arts],
                "hash": {a["art_id"]: a["hash_sha256"] for a in arts},
            },
            indent=1,
        )
        + "\n"
    )
    (d / "investigation.json").write_text(
        json.dumps(
            {
                "inv_id": inv,
                "arm": "sintetis",
                "sintetis": True,
                "status_server": status,
                "artifacts": [a["art_id"] for a in arts],
                "t_now_frame": NOW,
            },
            indent=1,
            ensure_ascii=False,
        )
        + "\n"
    )


def main():
    th = {
        k: v
        for k, v in json.loads(LOCK.read_text()).items()
        if k in ("usia_max_h", "ambang_kn", "konflik_jendela_jam")
    }
    baru, cocok = [], True
    for bangun in (kasus_sar_only, kasus_ais_only, lambda: kasus_konflik(th)):
        inv, arts, kelas, konstruksi = bangun()
        status = gate(arts, th)
        tulis(inv, arts, status)
        harap_s, harap_r = HARAPAN[inv]
        ok = status["status"] == harap_s and status["abstain_reason"] == harap_r
        cocok = cocok and ok
        print(
            f"{'OK  ' if ok else 'BEDA'} {inv} [{kelas}] harap="
            f"{harap_s}/{harap_r} gerbang={status['status']}/{status['abstain_reason']} "
            f"sensor={status['sensors_independent']} "
            f"cakupan_hilang={status['missing_coverage']} "
            f"konflik={status['conflicting_art_ids']}"
        )
        baru.append(
            {
                "inv_id": inv,
                "kelas_gt": kelas,
                "scene_id": None,
                "gt_jarak_m": None,
                "gt_source": None,
                "gt_is_vessel": None,
                "gt_is_fishing": None,
                "gt_confidence": None,
                "gt_shore_km": None,
                "status_gate": status["status"],
                "sintetis": True,
                "status_harapan": harap_s,
                "abstain_reason_harapan": harap_r,
                "abstain_reason_gate": status["abstain_reason"],
                "harapan_cocok": ok,
                "basis_konstruksi": konstruksi,
                "catatan_penilai": f"{LABEL}: GT adalah konstruksinya sendiri, bukan "
                "pengamatan. Tidak masuk hitungan akurasi/kecukupan evidensial.",
            }
        )

    m = json.loads(ADJ.read_text())
    punya = {b["inv_id"] for b in m["basis"]}
    m["basis"].extend(b for b in baru if b["inv_id"] not in punya)  # entri lama tak disentuh
    m["n_inv"] = len(m["basis"])
    m["kelas"] = sorted({b["kelas_gt"] for b in m["basis"]})
    m.setdefault(
        "catatan_sintetis",
        "Entri kelas_gt berawalan 'sintetis-' adalah kasus edge by-construction "
        "(scripts/e5_sintetis.py), protokol E5 komposisi. Harapan status "
        "pra-registrasi ada di field status_harapan; lengan ini menguji mekanika "
        "gerbang, bukan akurasi.",
    )
    ADJ.write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n")
    print(f"basis: n_inv {m['n_inv']} (+{len(baru)}), kelas {m['kelas']}")
    if not cocok:
        sys.exit("HARAPAN TIDAK COCOK — dilaporkan apa adanya, ambang/artefak tidak disetel.")


if __name__ == "__main__":
    main()

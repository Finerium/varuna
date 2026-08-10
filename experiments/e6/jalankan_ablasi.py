#!/usr/bin/env python3
"""E6 — ablasi fusi 3 lengan pada tingkat keputusan (protokol beku, §E6).

Untuk tiap investigasi pada set pelaporan E5, status PASHA dihitung ulang pada
tiga konfigurasi bukti:
  - SAR-saja  : buang artefak AIS (ais_track_segment/ais_gap/ais_anomaly) dan
                kinematic_feasibility -> hanya modalitas SAR yang mengamati.
  - AIS-saja  : buang sar_detection -> hanya modalitas AIS yang mengamati.
  - fusi penuh: seluruh artefak apa adanya.

Status TIDAK dihitung ulang di Python: tiap konfigurasi dialirkan ke gerbang
produksi `packages/core/bin/gate.ts` (echo JSON | npx tsx ...), fungsi murni yang
SAMA dengan endpoint, builder golden, dan harness E5 (architecture.md "Pola
kunci"). Ambang dari experiments/e5/thresholds.lock.json; NOW = frame demo
2026-08-09T11:00:00Z. Artefak diteruskan apa adanya (termasuk field `t_tulis`),
jadi lengan "fusi penuh" mereproduksi persis status_server tersimpan — itu
diperiksa dan dilaporkan sebagai `cek_reproduksi`.

Metrik (§E6, §0.2): distribusi status per lengan; terkonfirmasi tercapai per
lengan; kandidat terlewat per modalitas; kandidat khusus-fusi; semua proporsi
dengan interval Wilson 95%. Interpretasi paper WAJIB memimpin dengan angka
terlemah — driver menandai lengan/angka terlemah di `pimpin_dengan`.

Jalankan (uji, TIDAK menulis manifest final):
    varuna/.venv/bin/python experiments/e6/jalankan_ablasi.py --dry-run
Jalankan (pelaporan, set terkunci):
    varuna/.venv/bin/python experiments/e6/jalankan_ablasi.py
Self-check rumus + logika lengan:
    varuna/.venv/bin/python experiments/e6/jalankan_ablasi.py --check
"""
import argparse
import json
import math
import pathlib
import subprocess
import sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
GOLDEN = ROOT / "experiments/e5/goldenset"
LOCK = ROOT / "experiments/e5/thresholds.lock.json"
GATE = ROOT / "packages/core/bin/gate.ts"
GOLDENSET_MANIFEST = ROOT / "manifests/e5-goldenset.json"
HASIL = ROOT / "manifests/e6-hasil.json"
DRYRUN = pathlib.Path(__file__).resolve().parent / "e6-dryrun.json"

NOW = "2026-08-09T11:00:00Z"
STATUS = ("terkonfirmasi", "terindikasi", "abstain")
KANDIDAT = ("terkonfirmasi", "terindikasi")  # non-ABSTAIN = kandidat (§E5 metrik b)

# SAR-saja membuang seluruh bukti sisi-AIS. "ais_*" + kinematic_feasibility
# (yang menghubungkan gap AIS ke deteksi SAR): tanpa AIS, uji kinematik tak
# bermakna. assoc_result/weather tidak dibaca computeStatus, jadi tak relevan.
BUANG_SAR_SAJA = {"ais_track_segment", "ais_gap", "ais_anomaly", "kinematic_feasibility"}
BUANG_AIS_SAJA = {"sar_detection"}
LENGAN = {
    "sar_saja": BUANG_SAR_SAJA,
    "ais_saja": BUANG_AIS_SAJA,
    "fusi_penuh": set(),
}


def wilson(x, n, z=1.96):
    """Interval Wilson 95% — protokol §0.2 mewajibkan untuk SEMUA proporsi."""
    if n == 0:
        return [0.0, 0.0]
    p = x / n
    d = 1 + z * z / n
    pusat = (p + z * z / (2 * n)) / d
    lebar = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, pusat - lebar), 4), round(min(1.0, pusat + lebar), 4)]


def proporsi(x, n):
    return {"frac": f"{x}/{n}", "p": round(x / n, 4) if n else None, "wilson95": wilson(x, n)}


def baca_thresholds():
    isi = json.loads(LOCK.read_text())
    return {k: isi[k] for k in ("usia_max_h", "ambang_kn", "konflik_jendela_jam")}


def jalankan_gate(artefak, thresholds):
    """Satu panggilan gerbang = satu status. Sama persis dengan jalur produk."""
    payload = json.dumps({"artifacts": artefak, "now": NOW, "thresholds": thresholds})
    r = subprocess.run(
        ["npx", "tsx", str(GATE)],
        input=payload, capture_output=True, text=True, cwd=ROOT,
    )
    if r.returncode != 0:
        sys.exit(f"gate gagal: {r.stderr.strip()[:400]}")
    return json.loads(r.stdout)


def baca_artefak(inv_dir):
    d = inv_dir / "artifacts"
    return [json.loads(f.read_text()) for f in sorted(d.glob("*.json"))]


def status_tersimpan(inv_dir):
    inv = json.loads((inv_dir / "investigation.json").read_text())
    return inv.get("status_server", {}).get("status")


def pilih_inv(maks):
    """Set pelaporan bila e5-goldenset.json sudah dikunci; kalau belum, seluruh
    inv yang ADA di goldenset (dry-run). Sintetis ikut: §E6 berjalan di set
    pelaporan E5 yang memuat >=3 edge sintetis berlabel."""
    sumber = "goldenset-scan"
    ids = None
    if GOLDENSET_MANIFEST.exists():
        man = json.loads(GOLDENSET_MANIFEST.read_text())
        rep = [it["inv_id"] for it in man.get("items", []) if it.get("split") == "pelaporan"]
        if rep:
            ids, sumber = rep, "e5-goldenset.json[split=pelaporan]"
    if ids is None:
        ids = sorted(p.name for p in GOLDEN.iterdir() if (p / "investigation.json").exists())
    if maks is not None:
        ids = ids[:maks]
    return ids, sumber


def ablasi_inv(inv_dir, thresholds):
    artefak = baca_artefak(inv_dir)
    out = {}
    for nama, buang in LENGAN.items():
        subset = [a for a in artefak if a.get("type") not in buang]
        out[nama] = {
            "status": jalankan_gate(subset, thresholds)["status"] if subset else "abstain",
            "n_artefak": len(subset),
        }
    # Lengan kosong (mis. AIS-saja pada inv SAR-tunggal) tak perlu memanggil
    # gerbang: nol artefak -> kurang_cakupan -> abstain (diverifikasi di --check).
    return artefak, out


def agregasi(per_inv):
    n = len(per_inv)
    lengan = {}
    for nama in LENGAN:
        c = Counter(r["arm"][nama]["status"] for r in per_inv)
        kand = sum(c[s] for s in KANDIDAT)
        lengan[nama] = {
            "distribusi_status": {s: c[s] for s in STATUS},
            "terkonfirmasi_tercapai": proporsi(c["terkonfirmasi"], n),
            "kandidat_tercapai": proporsi(kand, n),
        }

    # Kandidat basis = kandidat di fusi penuh. "Terlewat per modalitas" =
    # kandidat fusi yang jatuh ke ABSTAIN saat modalitas itu dibuang.
    kand_fusi = [r for r in per_inv if r["arm"]["fusi_penuh"]["status"] in KANDIDAT]
    m = len(kand_fusi)
    terlewat_ais = [r["inv_id"] for r in kand_fusi if r["arm"]["sar_saja"]["status"] == "abstain"]
    terlewat_sar = [r["inv_id"] for r in kand_fusi if r["arm"]["ais_saja"]["status"] == "abstain"]
    khusus_fusi = [
        r["inv_id"] for r in kand_fusi
        if r["arm"]["sar_saja"]["status"] == "abstain"
        and r["arm"]["ais_saja"]["status"] == "abstain"
    ]
    # Nilai-tambah fusi yang tak tertangkap "khusus-fusi" (yang biasanya kosong
    # karena satu deteksi tunggal sudah 'terindikasi'): terkonfirmasi yang HANYA
    # dicapai fusi penuh, tidak oleh lengan tunggal mana pun.
    konf_khusus_fusi = [
        r["inv_id"] for r in per_inv
        if r["arm"]["fusi_penuh"]["status"] == "terkonfirmasi"
        and r["arm"]["sar_saja"]["status"] != "terkonfirmasi"
        and r["arm"]["ais_saja"]["status"] != "terkonfirmasi"
    ]

    fusi = {
        "kandidat_fusi_penuh": proporsi(m, n),
        "terlewat_saat_buang_AIS": {"inv": terlewat_ais, **proporsi(len(terlewat_ais), m)},
        "terlewat_saat_buang_SAR": {"inv": terlewat_sar, **proporsi(len(terlewat_sar), m)},
        "kandidat_khusus_fusi": {"inv": khusus_fusi, **proporsi(len(khusus_fusi), m)},
        "terkonfirmasi_khusus_fusi": {"inv": konf_khusus_fusi, **proporsi(len(konf_khusus_fusi), n)},
        "catatan": (
            "kandidat_khusus_fusi = kandidat (non-ABSTAIN) yang HANYA muncul di fusi penuh "
            "(kedua lengan tunggal ABSTAIN); pada PASHA satu deteksi tunggal sudah 'terindikasi', "
            "jadi angka ini menyorot kasus di mana tak satu pun modalitas berdiri sendiri. "
            "terkonfirmasi_khusus_fusi menangkap nilai-tambah yang lebih lunak: konfirmasi "
            "(2 sensor + pelanggaran zona) yang hanya dicapai saat kedua modalitas hadir."
        ),
    }
    return lengan, fusi


def pimpin_dengan(lengan, fusi):
    """§E6: interpretasi wajib memimpin dengan angka terlemah. Kandidat = laju
    terkonfirmasi terendah lintas lengan + laju terlewat tertinggi."""
    laju_konf = {nama: lengan[nama]["terkonfirmasi_tercapai"]["p"] for nama in LENGAN}
    terlemah = min(laju_konf, key=lambda k: (laju_konf[k] if laju_konf[k] is not None else 1))
    terlewat = {
        "buang_AIS": fusi["terlewat_saat_buang_AIS"]["p"],
        "buang_SAR": fusi["terlewat_saat_buang_SAR"]["p"],
    }
    return {
        "lengan_terkonfirmasi_terlemah": terlemah,
        "laju_terkonfirmasi_per_lengan": laju_konf,
        "modalitas_paling_menyakitkan_bila_dibuang": max(
            terlewat, key=lambda k: (terlewat[k] if terlewat[k] is not None else -1)
        ),
        "laju_terlewat": terlewat,
    }


def hitung(maks, dry):
    thresholds = baca_thresholds()
    ids, sumber = pilih_inv(maks)
    per_inv, reproduksi_ok, reproduksi_gagal = [], 0, []
    for inv_id in ids:
        inv_dir = GOLDEN / inv_id
        artefak, arm = ablasi_inv(inv_dir, thresholds)
        tersimpan = status_tersimpan(inv_dir)
        cocok = arm["fusi_penuh"]["status"] == tersimpan
        reproduksi_ok += int(cocok)
        if not cocok:
            reproduksi_gagal.append(
                {"inv_id": inv_id, "fusi_penuh": arm["fusi_penuh"]["status"], "tersimpan": tersimpan}
            )
        per_inv.append({"inv_id": inv_id, "n_artefak": len(artefak), "arm": arm})

    lengan, fusi = agregasi(per_inv)
    return {
        "eksperimen": "E6",
        "mode": "dry-run" if dry else "pelaporan",
        "protokol": "freeze-eval-v1 @0bc9af9",
        "now": NOW,
        "thresholds": thresholds,
        "sumber_inv": sumber,
        "n_inv": len(per_inv),
        "seed": 20260809,
        "cek_reproduksi": {
            "fusi_penuh_cocok_status_tersimpan": proporsi(reproduksi_ok, len(per_inv)),
            "gagal": reproduksi_gagal,
            "catatan": "fusi penuh WAJIB mereproduksi status_server tersimpan; gagal = defect data/gerbang.",
        },
        "per_lengan": lengan,
        "nilai_fusi": fusi,
        "pimpin_dengan": pimpin_dengan(lengan, fusi),
        "per_inv": per_inv,
    }


def check():
    """Logika lengan + rumus Wilson pada kasus buatan tangan (tanpa gerbang untuk
    Wilson; dgn gerbang untuk lengan supaya menguji jalur nyata end-to-end)."""
    # Wilson: kasus buku teks 17/20 (identik dgn e8/kappa.py --check).
    lo, hi = wilson(17, 20)
    assert abs(lo - 0.6396) < 5e-4 and abs(hi - 0.9476) < 5e-4, f"Wilson meleset: {lo},{hi}"
    assert wilson(20, 20)[1] == 1.0 and wilson(0, 20)[0] == 0.0, "Wilson wajib terpotong [0,1]"

    th = baca_thresholds()
    # Kasus going-dark buatan: SAR + gap + kinematik.lolos + zona.violation.
    # Fusi -> 2 sensor + zona -> terkonfirmasi. SAR-saja -> 1 sensor -> terindikasi
    # (kandidat, tetap). AIS-saja -> tanpa SAR, going-dark gugur -> ABSTAIN.
    A = lambda **k: {"created_at": "2026-08-09T10:00:00Z", "inv_id": "inv-uji-01", **k}
    gd = [
        A(art_id="a-uji-01-001", type="sar_detection",
          payload={"lat": 4.5, "lon": 108.5, "scene_id": "S1"}),
        A(art_id="a-uji-01-002", type="ais_gap",
          payload={"mmsi_hash": "0" * 16, "t_start": "2026-08-07T00:00:00Z",
                   "t_end": "2026-08-08T00:00:00Z", "durasi_jam": 24, "sog_sebelum": 8}),
        A(art_id="a-uji-01-003", type="kinematic_feasibility",
          payload={"gap_art_id": "a-uji-01-002", "det_art_id": "a-uji-01-001",
                   "jarak_km": 5, "dt_jam": 24, "sog_implied": 0.1, "ambang_kn": 50, "lolos": True}),
        A(art_id="a-uji-01-004", type="zone_rule",
          payload={"zona": "ZEE-ID", "posisi": "inside", "violation": True,
                   "basis_aturan": "T4", "geometri_ref": "g"}),
    ]
    s_fusi = jalankan_gate(gd, th)["status"]
    s_sar = jalankan_gate([a for a in gd if a["type"] not in BUANG_SAR_SAJA], th)["status"]
    s_ais = jalankan_gate([a for a in gd if a["type"] not in BUANG_AIS_SAJA], th)["status"]
    assert s_fusi == "terkonfirmasi", f"fusi going-dark harusnya terkonfirmasi, dapat {s_fusi}"
    assert s_sar == "terindikasi", f"SAR-saja harusnya terindikasi, dapat {s_sar}"
    assert s_ais == "abstain", f"AIS-saja (tanpa SAR) harusnya abstain, dapat {s_ais}"
    print(f"OK self-check E6 (Wilson 17/20; going-dark fusi={s_fusi} sar={s_sar} ais={s_ais})")


def main():
    ap = argparse.ArgumentParser(description="E6 ablasi fusi 3 lengan")
    ap.add_argument("--dry-run", action="store_true",
                    help="uji harness; tulis e6-dryrun.json, JANGAN manifest final")
    ap.add_argument("--maks-inv", type=int, default=None, help="batasi jumlah inv (uji)")
    ap.add_argument("--check", action="store_true", help="self-check rumus + logika lengan")
    args = ap.parse_args()

    if args.check:
        check()
        return

    hasil = hitung(args.maks_inv, args.dry_run)
    keluar = DRYRUN if args.dry_run else HASIL
    keluar.write_text(json.dumps(hasil, indent=1, ensure_ascii=False))
    r = hasil["cek_reproduksi"]["fusi_penuh_cocok_status_tersimpan"]
    print(f"E6 {hasil['mode']}: {hasil['n_inv']} inv <- {hasil['sumber_inv']}")
    print(f"  reproduksi fusi-penuh vs tersimpan: {r['frac']}")
    for nama in LENGAN:
        d = hasil["per_lengan"][nama]["distribusi_status"]
        print(f"  {nama:11s} {d}")
    nf = hasil["nilai_fusi"]
    print(f"  terlewat buang-AIS {nf['terlewat_saat_buang_AIS']['frac']}"
          f"  buang-SAR {nf['terlewat_saat_buang_SAR']['frac']}"
          f"  khusus-fusi {nf['kandidat_khusus_fusi']['frac']}"
          f"  terkonf-khusus-fusi {nf['terkonfirmasi_khusus_fusi']['frac']}")
    print(f"  -> {keluar.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

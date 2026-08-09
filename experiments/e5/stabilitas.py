#!/usr/bin/env python3
"""E5.4 — Stabilitas keputusan: k=5 replay per investigasi (protokol beku, §E5.4).

Untuk tiap investigasi set pelaporan, replay dijalankan k kali lewat endpoint
PRODUKSI /api/replay (SSE, cookie peran) — panggilan agen LIVE, bukan rekaman.
Yang diukur dan dilaporkan TERBUKA (§E5.4 + §0.7):
  - agreement STATUS PASHA lintas k replay,
  - HASH lapisan server WAJIB identik lintas k (determinisme terbatas §0.7 —
    ketidakcocokan = defect determinisme, dilaporkan, bukan disembunyikan),
  - agreement HIMPUNAN ARTEFAK yang dirujuk (dari pasha.reasons[].art_ids),
  - variasi NARATIF (proksi: urutan agen:fase yang teramati di SSE) + varians
    LATENSI. Token per replay TIDAK dipancarkan SSE -> null + ditandai butuh
    instrumentasi server (E10), tidak pernah diarang.

Biaya: k * jumlah-langkah panggilan model per inv. Karena itu eksekusi LIVE
DIGERBANG di belakang --jalan-live + --maks-inv + --k. Mode default = --rencana:
memilih set pelaporan, cek keterjangkauan tiap inv di produk (GET, nol biaya
model), dan melaporkan kesiapan — inv E5 belum termuat di produk (replay -> 404)
sampai set pelaporan dikunci & di-deploy, jadi mode ini adalah "dry-run" E5.4.

  Rencana (default, nol biaya):
      varuna/.venv/bin/python experiments/e5/stabilitas.py
  Jalankan LIVE (budget):
      varuna/.venv/bin/python experiments/e5/stabilitas.py --jalan-live --maks-inv 5 --k 5
  Self-check agregasi:
      varuna/.venv/bin/python experiments/e5/stabilitas.py --check
"""
import argparse
import json
import math
import pathlib
import statistics
import sys
import urllib.error
import urllib.request
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
GOLDEN = ROOT / "experiments/e5/goldenset"
GOLDENSET_MANIFEST = ROOT / "manifests/e5-goldenset.json"
RENCANA = pathlib.Path(__file__).resolve().parent / "stabilitas-rencana.json"
HASIL = ROOT / "manifests/e5-stabilitas.json"

sys.path.insert(0, str(ROOT / "experiments"))
from replay_client import BASE_DEFAULT, replay_once  # noqa: E402

NOW = "2026-08-09T11:00:00Z"
K_DEFAULT = 5


def wilson(x, n, z=1.96):
    """Interval Wilson 95% — protokol §0.2 untuk SEMUA proporsi."""
    if n == 0:
        return [0.0, 0.0]
    p = x / n
    d = 1 + z * z / n
    pusat = (p + z * z / (2 * n)) / d
    lebar = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, pusat - lebar), 4), round(min(1.0, pusat + lebar), 4)]


def proporsi(x, n):
    return {"frac": f"{x}/{n}", "p": round(x / n, 4) if n else None, "wilson95": wilson(x, n)}


def pilih_inv(maks):
    """Set pelaporan bila e5-goldenset.json terkunci; kalau belum, scan goldenset."""
    sumber, ids = "goldenset-scan", None
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


def terjangkau(inv_id, base=BASE_DEFAULT, peran="analis"):
    """GET /api/investigations/{inv_id} — cek keberadaan tanpa memanggil model."""
    req = urllib.request.Request(f"{base}/api/investigations/{inv_id}", method="GET")
    req.add_header("Cookie", f"varuna_peran={peran}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError:
        return None


def agregat_inv(inv_id, replays):
    """Ringkas k replay satu inv: agreement status/hash/artefak + varians latensi."""
    status = [r.get("pasha_status") for r in replays]
    hashes = [r.get("pasha_hash") for r in replays]
    artefak = [tuple(r.get("artefak_dirujuk") or []) for r in replays]
    agen = ["|".join(r.get("agen_urut") or []) for r in replays]
    lat_total = [sum(r.get("latensi_ms") or [0.0]) for r in replays]
    sukses = [r for r in replays if r.get("ok")]

    mode_status = Counter(s for s in status if s is not None).most_common(1)
    def semua_sama(xs):
        bersih = [x for x in xs if x is not None and x != ()]
        return len(bersih) == len(xs) and len(set(bersih)) == 1

    return {
        "inv_id": inv_id, "k": len(replays), "k_sukses": len(sukses),
        "status_per_replay": status,
        "status_agreement": {
            "identik": semua_sama(status),
            "modus": mode_status[0][0] if mode_status else None,
            "modus_frac": (f"{mode_status[0][1]}/{len(status)}" if mode_status else None),
        },
        "hash_server_identik": semua_sama(hashes),
        "hash_contoh": hashes[0] if hashes else None,
        "artefak_dirujuk_identik": semua_sama(artefak),
        "artefak_dirujuk_contoh": list(artefak[0]) if artefak else [],
        "naratif_agen_urut_distinct": len(set(agen)),
        "latensi_ms": {
            "mean": round(statistics.mean(lat_total), 1) if lat_total else None,
            "stdev": round(statistics.pstdev(lat_total), 1) if len(lat_total) > 1 else 0.0,
            "min": round(min(lat_total), 1) if lat_total else None,
            "max": round(max(lat_total), 1) if lat_total else None,
        },
        "token_usage": None,  # tak dipancarkan SSE; butuh instrumentasi server (E10)
        "replays": replays,
    }


def agregat_global(per_inv):
    n = len(per_inv)
    return {
        "n_inv": n,
        "status_agreement_penuh": proporsi(sum(1 for r in per_inv if r["status_agreement"]["identik"]), n),
        "hash_server_identik": proporsi(sum(1 for r in per_inv if r["hash_server_identik"]), n),
        "artefak_dirujuk_identik": proporsi(sum(1 for r in per_inv if r["artefak_dirujuk_identik"]), n),
        "determinisme_server_catatan": (
            "hash_server_identik < 1.0 berarti lapisan server TIDAK deterministik lintas replay — "
            "pelanggaran §0.7 yang WAJIB dilaporkan, bukan ditutup."
        ),
    }


def jalan_live(maks, k, base):
    ids, sumber = pilih_inv(maks)
    per_inv = []
    for inv_id in ids:
        replays = [replay_once(inv_id, base=base, maks_langkah=40) for _ in range(k)]
        per_inv.append(agregat_inv(inv_id, replays))
    return {
        "eksperimen": "E5.4", "sub": "stabilitas-keputusan", "mode": "live",
        "protokol": "freeze-eval-v1 @0bc9af9, §E5.4", "now": NOW, "base": base,
        "k_replay": k, "sumber_inv": sumber, "seed": 20260809,
        "global": agregat_global(per_inv), "per_inv": per_inv,
    }


def rencana(maks, base):
    ids, sumber = pilih_inv(maks)
    baris, siap = [], 0
    for inv_id in ids:
        kode = terjangkau(inv_id, base)
        ok = kode == 200
        siap += int(ok)
        baris.append({"inv_id": inv_id, "http_get": kode, "live_siap": ok})
    return {
        "eksperimen": "E5.4", "sub": "stabilitas-keputusan", "mode": "rencana (nol biaya model)",
        "protokol": "freeze-eval-v1 @0bc9af9, §E5.4", "now": NOW, "base": base,
        "k_replay_target": K_DEFAULT, "sumber_inv": sumber, "seed": 20260809,
        "kesiapan_live": proporsi(siap, len(ids)),
        "catatan": (
            "Set pelaporan E5 (inv-e5-*) belum termuat di produk -> GET 404 sampai e5-goldenset.json "
            "dikunci & di-deploy. Setelah itu: --jalan-live --maks-inv N --k 5. Endpoint replay produksi "
            "sudah LIVE (diverifikasi pada inv demo)."
        ),
        "target": baris,
    }


def check():
    lo, hi = wilson(17, 20)
    assert abs(lo - 0.6396) < 5e-4 and abs(hi - 0.9476) < 5e-4, f"Wilson meleset: {lo},{hi}"

    def rep(status, h, arts, agen, lat, ok=True):
        return {"ok": ok, "pasha_status": status, "pasha_hash": h, "artefak_dirujuk": arts,
                "agen_urut": agen, "latensi_ms": lat}

    # Inv stabil sempurna: k=5 identik.
    stabil = agregat_inv("inv-uji-stabil", [
        rep("terindikasi", "ab" * 32, ["a-x-001"], ["A0:start", "A2:output", "A0:done"], [100.0, 200.0])
        for _ in range(5)])
    assert stabil["status_agreement"]["identik"] and stabil["hash_server_identik"] \
        and stabil["artefak_dirujuk_identik"] and stabil["naratif_agen_urut_distinct"] == 1, "kasus stabil salah"
    assert stabil["latensi_ms"]["stdev"] == 0.0, "latensi identik harus stdev 0"

    # Determinisme server BOCOR: satu replay beda hash -> hash_server_identik False.
    bocor = agregat_inv("inv-uji-bocor", [
        rep("terindikasi", "aa" * 32, ["a-x-001"], ["A0:done"], [100.0]),
        rep("terindikasi", "bb" * 32, ["a-x-001"], ["A0:done"], [120.0]),
    ])
    assert bocor["hash_server_identik"] is False, "hash mismatch harus tertangkap (pelanggaran §0.7)"
    assert bocor["status_agreement"]["identik"] is True, "status boleh sama walau hash beda"

    # Keputusan tak stabil: status berbeda lintas replay + latensi bervarians.
    goyah = agregat_inv("inv-uji-goyah", [
        rep("terindikasi", "cc" * 32, ["a-x-001"], ["A0:done"], [100.0]),
        rep("abstain", "dd" * 32, [], ["A0:done"], [300.0]),
    ])
    assert goyah["status_agreement"]["identik"] is False, "status divergen harus terdeteksi"
    assert goyah["latensi_ms"]["stdev"] > 0, "latensi bervarians harus > 0"

    g = agregat_global([stabil, bocor, goyah])
    # stabil + bocor sepakat status (2/3); hanya stabil yang hash-nya identik (1/3).
    assert g["status_agreement_penuh"]["frac"] == "2/3", "stabil+bocor sepakat status"
    assert g["hash_server_identik"]["frac"] == "1/3", "hanya stabil yang hash-identik"
    print("OK self-check E5.4 (Wilson; stabil/bocor/goyah; global agreement "
          f"{g['status_agreement_penuh']['frac']}, hash {g['hash_server_identik']['frac']})")


def main():
    ap = argparse.ArgumentParser(description="E5.4 stabilitas keputusan k-replay")
    ap.add_argument("--jalan-live", action="store_true", help="jalankan k replay via produksi (BIAYA model)")
    ap.add_argument("--maks-inv", type=int, default=None, help="batas jumlah inv (budget)")
    ap.add_argument("--k", type=int, default=K_DEFAULT, help="replay per inv (default 5)")
    ap.add_argument("--base", default=BASE_DEFAULT, help="basis URL produksi")
    ap.add_argument("--check", action="store_true", help="self-check agregasi (nol jaringan)")
    args = ap.parse_args()

    if args.check:
        check()
        return
    if args.jalan_live:
        hasil = jalan_live(args.maks_inv, args.k, args.base)
        HASIL.write_text(json.dumps(hasil, indent=1, ensure_ascii=False))
        g = hasil["global"]
        print(f"E5.4 live: {g['n_inv']} inv x k={hasil['k_replay']}")
        print(f"  status full-agreement {g['status_agreement_penuh']['frac']}"
              f"  hash-identik {g['hash_server_identik']['frac']}"
              f"  artefak-identik {g['artefak_dirujuk_identik']['frac']}")
        print(f"  -> {HASIL.relative_to(ROOT)}")
        return

    hasil = rencana(args.maks_inv, args.base)
    RENCANA.write_text(json.dumps(hasil, indent=1, ensure_ascii=False))
    print(f"E5.4 rencana: {hasil['kesiapan_live']['frac']} inv live-siap <- {hasil['sumber_inv']}")
    print(f"  {hasil['catatan']}")
    print(f"  -> {RENCANA.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

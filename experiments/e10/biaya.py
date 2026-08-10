#!/usr/bin/env python3
"""E10 — Biaya token satu investigasi (dipakai §4.5 paper).

Angkanya datang dari `usage` yang dipulangkan Responses API, ditangkap executor
(packages/agents/src/executor.ts) dan dipancarkan APA ADANYA di SSE replay:
`usage` pada tiap peristiwa penutup (`lanjut`/`selesai`) = token satu invokasi
HTTP; `usage` pada tiap `agent_step` = token agen itu sendiri. Klien tidak
pernah menaksir: bila server yang dihubungi belum berinstrumentasi, hasilnya
null dan run dilaporkan gagal-ukur.

  Self-check agregasi (nol jaringan, nol biaya):
      varuna/.venv/bin/python experiments/e10/biaya.py --check
  Jalankan metered (BIAYA model — satu replay penuh per inv):
      # server lokal, terminal lain:
      #   cd apps/web && VARUNA_GOLDEN_DIR=../../packages/core/golden \\
      #     OPENAI_API_KEY=... pnpm start
      varuna/.venv/bin/python experiments/e10/biaya.py --jalan-live --n 3

Biaya: satu replay = beberapa panggilan model (A0 tiap langkah + tiap sub-agen).
Karena itu eksekusi digerbang di belakang --jalan-live dan --n; modul ini tidak
pernah mengulang otomatis.
"""
import argparse
import json
import pathlib
import statistics
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
MANIFEST_GOLDEN = ROOT / "packages/core/golden/index/manifest.json"
GOLDEN_INV = ROOT / "packages/core/golden/investigations"
HASIL = ROOT / "manifests/e10-token.json"
RENCANA = pathlib.Path(__file__).resolve().parent / "biaya-rencana.json"
BASE_LOKAL = "http://127.0.0.1:3000"

sys.path.insert(0, str(ROOT / "experiments"))
from replay_client import replay_once  # noqa: E402

SEED = 20260809


def pilih_demo(n):
    """Investigasi demo, satu per kasus, urut inv_id. Yang tidak ada di disk
    golden dilewati: manifest boleh menyebut inv yang belum termuat produk."""
    items = json.loads(MANIFEST_GOLDEN.read_text())["items"]
    keluar, kasus_dipakai = [], set()
    for it in sorted(items, key=lambda x: x["inv_id"]):
        if it.get("split") != "demo" or it["kasus"] in kasus_dipakai:
            continue
        if not (GOLDEN_INV / it["inv_id"] / "investigation.json").exists():
            continue
        kasus_dipakai.add(it["kasus"])
        keluar.append({"inv_id": it["inv_id"], "kasus": it["kasus"]})
        if len(keluar) == n:
            break
    return keluar


def ringkas(baris):
    """Rata-rata token per investigasi. Hanya run yang BENAR-BENAR terukur yang
    masuk rata-rata; run gagal tetap tercatat di per_inv sebagai keadaannya."""
    ukur = [b for b in baris if b.get("token") is not None]
    if not ukur:
        return {"n_terukur": 0, "rata2_in": None, "rata2_out": None, "rata2_requests": None}
    return {
        "n_terukur": len(ukur),
        "rata2_in": round(statistics.mean([b["token"]["in"] for b in ukur]), 1),
        "rata2_out": round(statistics.mean([b["token"]["out"] for b in ukur]), 1),
        "rata2_requests": round(statistics.mean([b["token"]["requests"] for b in ukur]), 2),
        "semua_konsisten": all(b["token"].get("konsisten") for b in ukur),
    }


def jalan_live(n, base, model):
    baris = []
    for t in pilih_demo(n):
        r = replay_once(t["inv_id"], base=base, maks_langkah=40)
        baris.append({
            "inv_id": t["inv_id"],
            "kasus": t["kasus"],
            "ok": r.get("ok", False),
            "penutup": r.get("penutup") or f'http {r.get("http_status")}',
            "n_langkah_http": r.get("n_langkah_http"),
            "n_agent_step": len(r.get("agen_urut") or []),
            "pasha_status": r.get("pasha_status"),
            "token": r.get("token_usage"),
        })
    return {
        "eksperimen": "E10", "sub": "biaya-token-replay", "mode": "live-metered",
        "base": base, "model": model, "seed": SEED, "k_replay_per_inv": 1,
        "sumber_angka": (
            "usage Responses API -> executor.ts -> SSE (`usage` pada peristiwa penutup "
            "dan pada tiap agent_step). Tidak ada taksiran."
        ),
        "per_inv": baris,
        **ringkas(baris),
        "catatan": (
            "Satu replay per investigasi (k=1): angka ini biaya SATU jalur, bukan sebaran. "
            "Token run yang melempar ModelBehaviorError tidak terhitung (usage tak terjangkau "
            "lewat error), jadi laporan ini adalah BATAS BAWAH pada inv yang punya run cacat "
            "skema. `konsisten=false` berarti total penutup != jumlah per-agen."
        ),
    }


def _kode(url, metode):
    req = urllib.request.Request(url, method=metode)
    req.add_header("Cookie", "varuna_peran=analis")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError:
        return None


def rencana(n, base):
    """Kesiapan metered tanpa satu pun panggilan model: GET tiap inv (harus 200)
    dan POST replay (503 = kunci API belum terpasang; itu keadaan jujur rute,
    bukan kegagalan instrumentasi)."""
    baris = []
    for t in pilih_demo(n):
        baris.append({
            **t,
            "http_get": _kode(f"{base}/api/investigations/{t['inv_id']}", "GET"),
            "http_replay": _kode(f"{base}/api/replay/{t['inv_id']}", "POST"),
        })
    siap = [b for b in baris if b["http_get"] == 200]
    return {
        "eksperimen": "E10", "sub": "biaya-token-replay",
        "mode": "rencana (nol biaya model)", "base": base, "seed": SEED,
        "instrumentasi": (
            "TERPASANG: executor.ts menangkap usage Responses API per run (A0 dan tiap "
            "sub-agen); SSE membawanya di `usage` peristiwa penutup dan tiap agent_step; "
            "replay_client.kumpulkan_token menjumlahkannya. Diuji di "
            "packages/agents/test/executor.test.ts dan replay_client.py --check."
        ),
        "inv_terjangkau": f"{len(siap)}/{len(baris)}",
        "target": baris,
        "catatan": (
            "http_replay 503 = OPENAI_API_KEY belum ada di lingkungan server. Jalankan "
            "server dengan kunci lalu `--jalan-live` untuk menulis manifests/e10-token.json; "
            "manifest itu sengaja TIDAK dibuat selama belum ada angka terukur."
        ),
    }


def check():
    """Self-check agregasi (nol jaringan)."""
    demo = pilih_demo(3)
    assert len(demo) == 3, f"harus dapat 3 inv demo, dapat {demo}"
    assert len({d["kasus"] for d in demo}) == 3, f"kasus harus berbeda: {demo}"

    r = ringkas([
        {"token": {"in": 1000, "out": 100, "requests": 4, "konsisten": True}},
        {"token": {"in": 2000, "out": 200, "requests": 6, "konsisten": True}},
        {"token": None},  # run gagal: tidak boleh menarik rata-rata ke bawah
    ])
    assert r == {"n_terukur": 2, "rata2_in": 1500.0, "rata2_out": 150.0,
                 "rata2_requests": 5.0, "semua_konsisten": True}, r
    kosong = ringkas([{"token": None}])
    assert kosong["n_terukur"] == 0 and kosong["rata2_in"] is None, kosong
    print(f"OK self-check E10 (inv demo {[d['inv_id'] for d in demo]}; "
          f"rata2 {r['rata2_in']}/{r['rata2_out']} dari {r['n_terukur']} run terukur)")


def main():
    ap = argparse.ArgumentParser(description="E10 biaya token replay")
    ap.add_argument("--jalan-live", action="store_true", help="jalankan replay (BIAYA model)")
    ap.add_argument("--n", type=int, default=3, help="jumlah investigasi demo (default 3)")
    ap.add_argument("--base", default=BASE_LOKAL, help="basis URL server metered")
    ap.add_argument("--model", default=None, help="model server (untuk dicatat di manifest)")
    ap.add_argument("--check", action="store_true", help="self-check agregasi (nol jaringan)")
    args = ap.parse_args()

    if args.check:
        check()
        return
    if not args.jalan_live:
        hasil = rencana(args.n, args.base)
        RENCANA.write_text(json.dumps(hasil, indent=1, ensure_ascii=False))
        print(f"E10 rencana: {hasil['inv_terjangkau']} inv terjangkau di {hasil['base']}")
        for b in hasil["target"]:
            print(f"  {b['inv_id']:26s} GET {b['http_get']}  POST replay {b['http_replay']}")
        print(f"  -> {RENCANA.relative_to(ROOT)}")
        return

    import os
    hasil = jalan_live(args.n, args.base, args.model or os.environ.get("VARUNA_MODEL", "gpt-4.1-mini"))
    HASIL.write_text(json.dumps(hasil, indent=1, ensure_ascii=False))
    print(f"E10: {hasil['n_terukur']}/{len(hasil['per_inv'])} inv terukur "
          f"@ {hasil['model']}  rata2 in {hasil['rata2_in']}  out {hasil['rata2_out']}")
    for b in hasil["per_inv"]:
        t = b["token"]
        print(f"  {b['inv_id']:26s} {b['penutup']:10s} "
              f"{'in ' + str(t['in']) + ' out ' + str(t['out']) if t else 'tak terukur'}")
    print(f"  -> {HASIL.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

"""Sapuan bukti mekanis E8 — basis fakta bersama untuk kedua penilai.

Penilai boleh berbeda dalam PENILAIAN, tidak boleh berbeda dalam FAKTA. Skrip ini
mengumpulkan fakta yang dapat diperiksa ulang (hash, kelengkapan field, keterpanggilan
gerbang, rute API yang ada) dan menuliskannya ke experiments/e8/bukti-mesin.json.
Tidak ada penilaian di sini.

Jalankan: .venv/bin/python experiments/e8/periksa_bukti.py
Self-check: .venv/bin/python experiments/e8/periksa_bukti.py --check
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

AKAR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GOLDEN = os.path.join(AKAR, "packages/core/golden")
E5 = os.path.join(AKAR, "experiments/e5/goldenset")
KELUARAN = os.path.join(AKAR, "experiments/e8/bukti-mesin.json")


def kanonik(obj):
    """Aturan hash kontrak: sha256 atas JSON kanonik tanpa field hash sendiri."""
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def baca(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def sapu_artefak(akar, pola="*"):
    berkas = sorted(glob.glob(f"{akar}/{pola}/artifacts/*.json"))
    h_ok = h_gagal = 0
    tipe = {}
    kunci = set()
    prov_min = None
    tanpa_dataset = tanpa_observed = tanpa_sintetis = 0
    for p in berkas:
        a = baca(p)
        kunci |= set(a.keys())
        tipe[a.get("type", "?")] = tipe.get(a.get("type", "?"), 0) + 1
        badan = {k: v for k, v in a.items() if k != "hash_sha256"}
        if kanonik(badan) == a.get("hash_sha256"):
            h_ok += 1
        else:
            h_gagal += 1
        prov = a.get("source", {}).get("provenance", "")
        prov_min = len(prov) if prov_min is None else min(prov_min, len(prov))
        if not a.get("source", {}).get("dataset"):
            tanpa_dataset += 1
        if "observed_at" not in a:
            tanpa_observed += 1
        if "sintetis" not in a:
            tanpa_sintetis += 1
    return {
        "n_artefak": len(berkas),
        "hash_reproduksi_ok": h_ok,
        "hash_reproduksi_gagal": h_gagal,
        "tipe": tipe,
        "union_kunci": sorted(kunci),
        "provenance_terpendek_char": prov_min,
        "tanpa_source_dataset": tanpa_dataset,
        "tanpa_observed_at": tanpa_observed,
        "tanpa_field_sintetis": tanpa_sintetis,
    }


def sapu_grounding(akar):
    """Indeks grounding wajib menutup seluruh artefak dan menyalin hash yang sama."""
    total = cocok = hilang = 0
    for gp in sorted(glob.glob(f"{akar}/*/grounding.json")):
        g = baca(gp)
        inv = os.path.dirname(gp)
        arts = {
            baca(p)["art_id"]: baca(p)["hash_sha256"]
            for p in sorted(glob.glob(f"{inv}/artifacts/*.json"))
        }
        for aid, h in arts.items():
            total += 1
            if aid not in g.get("art_ids", []):
                hilang += 1
            elif g.get("hash", {}).get(aid) == h:
                cocok += 1
    return {"artefak_terindeks_total": total, "hash_indeks_cocok": cocok, "tak_terindeks": hilang}


def gate(artefak, now, ambang):
    """Hitung ulang status lewat gerbang produksi yang sama (bin/gate.ts)."""
    masuk = json.dumps({"artifacts": artefak, "now": now, "thresholds": ambang})
    hasil = subprocess.run(
        ["node", os.path.join(AKAR, "packages/core/bin/gate.ts")],
        input=masuk, capture_output=True, text=True, cwd=AKAR, check=True,
    )
    return json.loads(hasil.stdout)


def sapu_status(akar):
    """Determinisme lapisan server: hash status tersimpan vs hash hitung-ulang."""
    lock = baca(os.path.join(AKAR, "experiments/e5/thresholds.lock.json"))
    ambang = {k: lock[k] for k in ("usia_max_h", "ambang_kn", "konflik_jendela_jam")}
    cocok = beda = 0
    detail = []
    for ip in sorted(glob.glob(f"{akar}/*/investigation.json")):
        inv = baca(ip)
        ss = inv.get("status_server")
        if not ss or "hash" not in ss:
            continue
        arts = [baca(p) for p in sorted(glob.glob(f"{os.path.dirname(ip)}/artifacts/*.json"))]
        ulang = gate(arts, ss["computed_at"], ambang)
        sama = ulang["hash"] == ss["hash"]
        cocok += sama
        beda += not sama
        detail.append({"inv_id": inv["inv_id"], "status": ss["status"], "hash_sama": sama})
    return {"n_investigasi": len(detail), "hash_status_cocok": cocok, "hash_status_beda": beda,
            "detail": detail}


def diksi(teks_list):
    """Penyaring diksi produksi (packages/core/src/diksi.ts) — satu sumber, tanpa port."""
    skrip = (
        "import {cekDiksi} from './packages/core/src/diksi.ts';"
        "const t=JSON.parse(await new Response(process.stdin).text());"
        "console.log(JSON.stringify(t.map(cekDiksi)));"
    )
    hasil = subprocess.run(
        ["node", "--input-type=module", "-e", skrip],
        input=json.dumps(teks_list), capture_output=True, text=True, cwd=AKAR, check=True,
    )
    return json.loads(hasil.stdout)


def sapu_berkas(akar):
    """Berkas naratif: berapa investigasi punya seksi, apakah art_id-nya resolvable,
    apakah teks tampil lolos penyaring diksi."""
    indeks = set()
    for gp in glob.glob(f"{akar}/*/grounding.json"):
        indeks |= set(baca(gp).get("art_ids", []))
    n_inv = n_dengan_berkas = n_seksi = tak_resolvable = 0
    teks = []
    for ip in sorted(glob.glob(f"{akar}/*/investigation.json")):
        inv = baca(ip)
        n_inv += 1
        seksi = inv.get("berkas", {}).get("sections", [])
        n_dengan_berkas += bool(seksi)
        n_seksi += len(seksi)
        for s in seksi:
            teks.append(s["claim"])
            tak_resolvable += sum(1 for a in s.get("art_ids", []) if a not in indeks)
        if inv.get("kasus", {}).get("peran_demo"):
            teks.append(inv["kasus"]["peran_demo"])
    hasil = diksi(teks) if teks else []
    return {
        "n_investigasi": n_inv,
        "n_dengan_berkas": n_dengan_berkas,
        "n_seksi_klaim": n_seksi,
        "art_id_klaim_tak_resolvable": tak_resolvable,
        "n_teks_tampil_diuji_diksi": len(teks),
        "pelanggaran_diksi": sum(1 for h in hasil if not h["ok"]),
    }


def sapu_permukaan():
    """Aksesibilitas & keterpampanan: rute API dan halaman yang benar-benar ada."""
    api = sorted(
        os.path.relpath(p, AKAR)
        for p in glob.glob(f"{AKAR}/apps/web/app/api/**/route.ts", recursive=True)
    )
    hal = sorted(
        os.path.relpath(p, AKAR)
        for p in glob.glob(f"{AKAR}/apps/web/app/**/page.tsx", recursive=True)
    )
    jejak = sorted(
        os.path.relpath(p, AKAR)
        for p in glob.glob(f"{AKAR}/apps/web/.runtime/**/*.jsonl", recursive=True)
    )
    return {
        "rute_api": api,
        "halaman": hal,
        "chip_png": len(glob.glob(f"{GOLDEN}/investigations/*/chips/*.png")),
        "jejak_replay_jsonl": jejak,
        "baris_jejak": sum(
            sum(1 for _ in open(os.path.join(AKAR, p), encoding="utf-8")) for p in jejak
        ),
    }


def kumpulkan():
    return {
        "akar_repo": "varuna",
        "golden_demo": {
            **sapu_artefak(f"{GOLDEN}/investigations"),
            "grounding": sapu_grounding(f"{GOLDEN}/investigations"),
            "status": sapu_status(f"{GOLDEN}/investigations"),
            "berkas": sapu_berkas(f"{GOLDEN}/investigations"),
        },
        "e5_goldenset": sapu_artefak(E5),
        "permukaan": sapu_permukaan(),
    }


def check():
    """Self-check: aturan hash kanonik harus menolak perubahan satu byte."""
    a = {"art_id": "x", "payload": {"b": 1, "a": 2}}
    b = {"payload": {"a": 2, "b": 1}, "art_id": "x"}
    assert kanonik(a) == kanonik(b), "urutan kunci tidak boleh mengubah hash"
    c = {"art_id": "x", "payload": {"b": 1, "a": 3}}
    assert kanonik(a) != kanonik(c), "perubahan nilai wajib mengubah hash"
    assert diksi(["kapal terindikasi", "pelaku terbukti"]) == [
        {"ok": True, "kata": []},
        {"ok": False, "kata": ["terbukti", "pelaku"]},
    ], "penyaring diksi tidak terpanggil sebagaimana mestinya"
    print("OK self-check periksa_bukti")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        bukti = kumpulkan()
        with open(KELUARAN, "w", encoding="utf-8") as f:
            json.dump(bukti, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(json.dumps(bukti, indent=1, ensure_ascii=False))

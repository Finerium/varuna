#!/usr/bin/env python3.13
"""Turunkan geometri zona untuk peta SVG apps/web.

Kenapa perlu: data/processed/zona/ ada di .gitignore DAN .vercelignore, jadi
geometri sumber tidak pernah sampai ke repo publik maupun ke bundel produksi.
Peta di Komando/Patroli dirender server-side dari geometri yang HARUS ikut
terbawa, karena itu versi tersederhanakannya disalin ke apps/web/lib/zona/.

Sederhana = Douglas-Peucker per-cincin (bukan per-poligon: berkas sumber
menuliskan puluhan sampai ribuan cincin di bawah satu tipe "Polygon", jadi
menafsirkannya sebagai shell+holes akan menghasilkan geometri tak sah).
Cincin yang lebih kecil dari ambang bentang dibuang: pada skala peta apa pun
yang dipakai produk, pulau selebar <2 km tidak menempati satu piksel pun.

Atribusi Marine Regions (CC-BY 4.0) ikut tersalin ke field `sumber` dan wajib
tetap tampil di kaki peta.

Jalankan: varuna/.venv/bin/python scripts/zona_web.py
"""

import json
from pathlib import Path

from shapely.geometry import LineString

AKAR = Path(__file__).resolve().parent.parent
SUMBER = AKAR / "data/processed/zona"
TUJUAN = AKAR / "apps/web/lib/zona"

# (berkas sumber, berkas tujuan, nama tampil, toleransi derajat, ambang bentang
#  cincin derajat, desimal). Toleransi dipilih dari langit-langit 150 KB per
#  berkas: nasional 0.05 deg -> 43 KB, natuna 0.002 deg -> 6 KB.
TURUNAN = [
    ("idn_eez_simplified", "nasional", "ZEE Indonesia", 0.05, 0.2, 3),
    ("natuna_eez", "natuna", "ZEE-ID subset Natuna", 0.002, 0.02, 4),
]


def cincin_sederhana(koordinat, toleransi, ambang, desimal):
    keluar = []
    for cincin in koordinat:
        xs = [c[0] for c in cincin]
        ys = [c[1] for c in cincin]
        if max(xs) - min(xs) < ambang and max(ys) - min(ys) < ambang:
            continue
        titik = [
            [round(x, desimal), round(y, desimal)]
            for x, y in LineString(cincin).simplify(toleransi, preserve_topology=False).coords
        ]
        # Pembulatan bisa melipat dua titik bertetangga jadi satu; cincin yang
        # tersisa di bawah 4 titik bukan bentuk lagi.
        rapat = [titik[0]]
        for t in titik[1:]:
            if t != rapat[-1]:
                rapat.append(t)
        if len(rapat) >= 4:
            keluar.append(rapat)
    return keluar


def main():
    TUJUAN.mkdir(parents=True, exist_ok=True)
    for asal, nama_berkas, nama, toleransi, ambang, desimal in TURUNAN:
        fc = json.loads((SUMBER / f"{asal}.geojson").read_text())
        fitur = fc["features"][0]
        cincin = cincin_sederhana(
            fitur["geometry"]["coordinates"], toleransi, ambang, desimal
        )
        xs = [c[0] for r in cincin for c in r]
        ys = [c[1] for r in cincin for c in r]
        isi = {
            "nama": nama,
            "sumber": fitur["properties"]["source"],
            "asal": f"data/processed/zona/{asal}.geojson",
            "toleransi_deg": toleransi,
            "bbox": [min(xs), min(ys), max(xs), max(ys)],
            "cincin": cincin,
        }
        keluar = TUJUAN / f"{nama_berkas}.json"
        keluar.write_text(json.dumps(isi, separators=(",", ":")) + "\n")
        kb = keluar.stat().st_size / 1024
        print(
            f"{keluar.relative_to(AKAR)}: {len(cincin)} cincin, "
            f"{sum(len(r) for r in cincin)} titik, {kb:.1f} KB"
        )
        assert kb < 150, f"{keluar} melewati langit-langit 150 KB"


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""E11 cross-check GFW: deteksi SAR publik GFW vs deteksi VARUNA.

Protokol (eval-protocol.md, E11, freeze-eval-v1): agreement rate radius 200 m,
deteksi unik per pihak, TANPA klaim siapa benar (tidak ada ground truth).

HUMAN-GATED: butuh token API GFW (registrasi globalfishingwatch.org/our-apis/tokens).
Token dibaca HANYA dari env GFW_TOKEN — jangan hardcode, jangan commit.

Jalankan:
  GFW_TOKEN=... .venv/bin/python experiments/e11/gfw_crosscheck.py \
      --out experiments/e11/out/gfw-denmark-20260805.json \
      [--pred <csv dengan kolom lat,lon>]

Tanpa --pred: hanya cek ketersediaan + simpan deteksi GFW mentah.
Angka hasil final ditulis ke manifest BARU oleh jalur EVAL, bukan oleh skrip ini.
Catatan latensi: dokumentasi GFW menyebut cakupan SAR sampai ~5 hari lalu;
scene 2026-08-05 bisa belum tersedia — skrip melaporkan kosong apa adanya.
"""
import argparse, csv, json, math, os, sys, urllib.request, urllib.error

API = "https://gateway.api.globalfishingwatch.org/v3/4wings/report"
DATASET = "public-global-sar-presence:latest"
# Scene E11: S1C_IW_GRDH_1SDV_20260805T171634 (German Bight / pantai barat Denmark)
DEFAULT_BBOX = [4.798, 53.241, 9.278, 55.161]
DEFAULT_RANGE = "2026-08-05,2026-08-06"


def fetch_gfw(token, bbox, date_range):
    w, s, e, n = bbox
    geojson = {"geojson": {"type": "Polygon",
               "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}}
    # spatial-aggregation=false -> baris per deteksi (lat/lon); fallback grid HIGH ~1 km
    for qs in (
        f"?spatial-aggregation=false&datasets[0]={DATASET}&format=JSON&date-range={date_range}",
        f"?spatial-resolution=HIGH&temporal-resolution=ENTIRE&group-by=FLAG&datasets[0]={DATASET}&format=JSON&date-range={date_range}",
    ):
        req = urllib.request.Request(API + qs, data=json.dumps(geojson).encode(),
                                     headers={"Authorization": f"Bearer {token}",
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r), qs
        except urllib.error.HTTPError as ex:
            sys.stderr.write(f"GFW HTTP {ex.code} untuk {qs}: {ex.read(300)!r}\n")
    raise SystemExit("Semua varian query GFW gagal — cek token/parameter.")


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def points_from_gfw(raw):
    ents = raw.get("entries") or raw.get("data") or []
    if isinstance(ents, dict):
        ents = [v for vs in ents.values() for v in (vs or [])]
    pts = []
    for e in ents:
        lat, lon = e.get("lat", e.get("latitude")), e.get("lon", e.get("longitude"))
        if lat is not None and lon is not None:
            pts.append((float(lat), float(lon)))
    return pts


def match(a, b, radius):
    # ponytail: O(n*m) brute force — cukup utk ratusan deteksi per scene
    return sum(1 for la, lo in a if any(haversine_m(la, lo, lb, lb2) <= radius for lb, lb2 in b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--pred", help="CSV deteksi VARUNA dgn kolom lat,lon (WGS84)")
    ap.add_argument("--bbox", default=",".join(map(str, DEFAULT_BBOX)))
    ap.add_argument("--date-range", default=DEFAULT_RANGE)
    ap.add_argument("--radius", type=float, default=200.0)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        d = haversine_m(53.5, 5.0, 53.5, 5.003)  # ~198.5 m pada lintang 53.5
        assert 195 < d < 202, d
        assert match([(53.5, 5.0)], [(53.5, 5.003)], 200) == 1
        assert match([(53.5, 5.0)], [(53.5, 5.004)], 200) == 0
        print("selftest OK")
        return

    token = os.environ.get("GFW_TOKEN")
    if not token:
        raise SystemExit("HUMAN-GATED: set env GFW_TOKEN (token API GFW). "
                         "Registrasi: https://globalfishingwatch.org/our-apis/tokens")

    bbox = [float(x) for x in args.bbox.split(",")]
    raw, query_used = fetch_gfw(token, bbox, args.date_range)
    gfw_pts = points_from_gfw(raw)

    out = {"dataset": DATASET, "query": query_used, "bbox": bbox,
           "date_range": args.date_range, "radius_m": args.radius,
           "seed": 20260809, "n_gfw": len(gfw_pts), "gfw_points": gfw_pts,
           "catatan": "tanpa klaim siapa benar; tidak ada ground truth (protokol E11)"}

    if args.pred:
        with open(args.pred) as f:
            var_pts = [(float(r["lat"]), float(r["lon"])) for r in csv.DictReader(f)]
        m_var = match(var_pts, gfw_pts, args.radius)
        m_gfw = match(gfw_pts, var_pts, args.radius)
        out.update({
            "n_varuna": len(var_pts),
            "varuna_matched_ke_gfw": m_var,
            "gfw_matched_ke_varuna": m_gfw,
            "agreement_varuna": (m_var / len(var_pts)) if var_pts else None,
            "agreement_gfw": (m_gfw / len(gfw_pts)) if gfw_pts else None,
            "unik_varuna": len(var_pts) - m_var,
            "unik_gfw": len(gfw_pts) - m_gfw,
        })

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "gfw_points"}, indent=1))


if __name__ == "__main__":
    main()

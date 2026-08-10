#!/usr/bin/env python3
"""Pull GFW data for Natuna AOI (108-110E, 4-6N), 2026-05-01..2026-08-08.

Outputs to data/raw/gfw/.
Token read from secrets file; never printed.
"""
import json
import ssl
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE = "https://gateway.api.globalfishingwatch.org"
OUT = Path("data/raw/gfw")
TOKEN_FILE = Path("secrets/gfw-token")
START, END = "2026-05-01", "2026-08-08"
POLY = {"type": "Polygon",
        "coordinates": [[[108, 4], [110, 4], [110, 6], [108, 6], [108, 4]]]}

token = TOKEN_FILE.read_text().strip()
CTX = ssl.create_default_context()


def req(path, body=None, method=None):
    """Return (status, parsed_json_or_text). Never logs the token."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
    r.add_header("Authorization", "Bearer " + token)
    r.add_header("Content-Type", "application/json")
    # Cloudflare blocks urllib's default UA with error 1010
    r.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
    r.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(r, context=CTX, timeout=120) as resp:
            raw = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        status = e.code
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw


def save(name, obj):
    p = OUT / name
    p.write_text(json.dumps(obj, indent=1))
    return str(p)


def events_pull(label, dataset):
    """Paginate POST /v3/events for one dataset over AOI+period."""
    entries, offset, limit, total = [], 0, 500, None
    while True:
        status, js = req(f"/v3/events?offset={offset}&limit={limit}", {
            "datasets": [dataset],
            "startDate": START,
            "endDate": END,
            "geometry": POLY,
        })
        if status not in (200, 201):  # POST /v3/events returns 201
            return {"label": label, "dataset": dataset, "status": status,
                    "error": js if isinstance(js, str) else json.dumps(js)[:2000]}
        total = js.get("total")
        entries.extend(js.get("entries", []))
        offset += limit
        if offset >= (total or 0) or not js.get("entries"):
            break
        time.sleep(0.3)
    f = save(f"events_{label}.json", {"dataset": dataset, "total": total,
                                      "startDate": START, "endDate": END,
                                      "bbox": [108, 4, 110, 6], "entries": entries})
    return {"label": label, "dataset": dataset, "status": status,
            "total": total, "n_saved": len(entries), "file": f}


def fourwings_report(label, dataset, date_range, temporal="ENTIRE"):
    qs = (f"/v4/4wings/report?spatial-resolution=LOW&temporal-resolution={temporal}"
          f"&datasets[0]={dataset}&date-range={date_range}&format=JSON")
    attempts = [qs, qs.replace("/v4/", "/v3/")]
    for path in attempts:
        status, js = req(path, {"geojson": POLY})
        if status == 200:
            f = save(f"4wings_{label}.json", js)
            return {"label": label, "dataset": dataset, "endpoint": path.split("?")[0],
                    "query": path, "status": 200, "file": f, "resp": js}
        last = {"label": label, "dataset": dataset, "endpoint": path.split("?")[0],
                "status": status,
                "error": js if isinstance(js, str) else json.dumps(js)[:2000]}
    return last


if __name__ == "__main__":
    results = {}

    # 0. datasets catalogue (for name troubleshooting)
    st, js = req("/v3/datasets?limit=999&offset=0")
    if st == 200:
        results["datasets_catalogue"] = {"status": st, "file": save("datasets.json", js)}
        names = [d.get("id") for d in (js.get("entries") or js if isinstance(js, list) else js.get("entries", []))]
    else:
        results["datasets_catalogue"] = {"status": st, "error": str(js)[:1000]}
        names = []
    results["dataset_names_sample"] = names[:0]  # filled below in stderr print

    # 1. events
    ev_datasets = {
        "encounter": "public-global-encounters-events:latest",
        "loitering": "public-global-loitering-events:latest",
        "gap": "public-global-gaps-events:latest",
        "port_visit": "public-global-port-visits-events:latest",
    }
    results["events"] = {k: events_pull(k, v) for k, v in ev_datasets.items()}

    # 2. 4wings reports
    results["4wings_sar"] = fourwings_report(
        "sar", "public-global-sar-presence:latest", f"{START},{END}")
    results["4wings_fishing"] = fourwings_report(
        "fishing_effort", "public-global-fishing-effort:latest", f"{START},{END}")

    # 3. Sentinel-1 acquisition dates: hourly AIS presence, +-2h around pass.
    # S1 pass time ~22:31 UTC inferred from SAR detections' entry/exitTimestamp
    # (2026-05-02T22:31:10Z / 2026-06-19T22:31:08Z). +-2h = 20:31..00:31 UTC,
    # widened to whole hourly buckets 20:00 d .. 01:00 d+1.
    # catatan: hourly buckets, not per-position AIS; finest the public API gives.
    from datetime import date, timedelta
    results["s1_hourly"] = {}
    for d in ["2026-06-07", "2026-06-19", "2026-07-20"]:
        d1 = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
        r = fourwings_report(f"ais_hourly_{d}", "public-global-presence:latest",
                             f"{d},{d1}", temporal="HOURLY")
        if r.get("status") == 200:
            rows = []
            for ds_rows in r["resp"].get("entries", [{}])[0].values():
                rows.extend(ds_rows or [])
            keep_hours = {f"{d} {h:02d}:00" for h in (20, 21, 22, 23)} | {f"{d1} 00:00", f"{d1} 01:00"}
            win = [x for x in rows if x.get("date") in keep_hours]
            vessels = sorted({(x.get("mmsi"), x.get("shipName"), x.get("flag"), x.get("geartype")) for x in win})
            f = save(f"s1_ais_window_{d}.json", {
                "s1_date": d, "assumed_pass_utc": "22:31",
                "window_utc": [f"{d}T20:00", f"{d1}T01:00"],
                "n_rows_window": len(win), "n_unique_vessels": len(vessels),
                "vessels": [{"mmsi": m, "shipName": n, "flag": fl, "geartype": g}
                            for m, n, fl, g in vessels],
                "rows": win})
            r["window_file"] = f
            r["n_unique_vessels_window"] = len(vessels)
            r["n_rows_full_hourly"] = len(rows)
        results["s1_hourly"][d] = r

    save("_pull_summary.json", {k: v for k, v in results.items() if k != "datasets_catalogue" or True})
    # strip bulky resp bodies for stdout
    def slim(o):
        if isinstance(o, dict):
            return {k: ("<saved>" if k == "resp" else slim(v)) for k, v in o.items()}
        return o
    print(json.dumps(slim(results), indent=1)[:8000])

#!/usr/bin/env python3
"""Unduh produk CDSE dari katalog json: cdse_download.py <katalog.json> <idx> <destdir>
Resume + refresh token per attempt + validasi ContentLength."""
import json, pathlib, sys, time, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from cdse_fetch import access_token, UA

cat, idx, destdir = sys.argv[1], int(sys.argv[2]), pathlib.Path(sys.argv[3])
p = json.loads(pathlib.Path(cat).read_text())["value"][idx]
EXPECT = int(p.get("ContentLength", 0))
destdir.mkdir(parents=True, exist_ok=True)
dest = destdir / (p["Name"].replace(".SAFE", "") + ".zip")
url = f"https://zipper.dataspace.copernicus.eu/odata/v1/Products({p['Id']})/$value"
print(p["Name"], f"{EXPECT/1e9:.2f} GB")
for attempt in range(1, 20):
    have = dest.stat().st_size if dest.exists() else 0
    if EXPECT and have >= EXPECT: break
    try:
        tok = access_token()
        req = urllib.request.Request(url, headers={**UA, "Authorization": f"Bearer {tok}", "Range": f"bytes={have}-"})
        with urllib.request.urlopen(req, timeout=120) as r:
            if "json" in r.headers.get("Content-Type","") or "html" in r.headers.get("Content-Type",""):
                print(f"attempt {attempt}: balasan non-biner; 15s"); time.sleep(15); continue
            mode = "ab" if (r.status == 206 and have) else "wb"
            done = have if mode == "ab" else 0
            with open(dest, mode) as f:
                while True:
                    c = r.read(1<<22)
                    if not c: break
                    f.write(c); done += len(c)
                    if done % (1<<28) < (1<<22): print(f"  {done/1e9:.2f}/{EXPECT/1e9:.2f} GB", flush=True)
    except Exception as e:
        print(f"attempt {attempt}: {e}; 12s"); time.sleep(12)
final = dest.stat().st_size if dest.exists() else 0
print("VALID" if final >= EXPECT else f"BELUM ({final/1e9:.2f} GB)")

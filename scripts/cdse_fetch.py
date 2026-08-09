#!/usr/bin/env python3
"""CDSE: refresh->access token, query katalog Natuna/Arafura, unduh produk.
Pakai: python3 cdse_fetch.py query | python3 cdse_fetch.py download <index>"""
import json, sys, time, pathlib, urllib.request, urllib.parse

TOK = pathlib.Path.home() / "Documents/Datathon/secrets/cdse-refresh-token"
OUT = pathlib.Path.home() / "Documents/Datathon/varuna/data/raw/natuna"
MAN = pathlib.Path.home() / "Documents/Datathon/varuna/manifests"
UA = {"User-Agent": "Mozilla/5.0"}

def access_token():
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": TOK.read_text().strip(),
        "client_id": "cdse-public",
    }).encode()
    req = urllib.request.Request(
        "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
        data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as f:
        j = json.load(f)
    # refresh token dirotasi: simpan yang baru
    if j.get("refresh_token"):
        TOK.write_text(j["refresh_token"])
    return j["access_token"]

AOI = {
    "natuna":  "POLYGON((108 4,110 4,110 6,108 6,108 4))",
    "arafura": "POLYGON((134 -6,137 -6,137 -8,134 -8,134 -6))",
}

def query(aoi="natuna", start="2026-05-01", end="2026-08-09"):
    f = (f"Collection/Name eq 'SENTINEL-1' and "
         f"contains(Name,'IW_GRDH') and "
         f"OData.CSC.Intersects(area=geography'SRID=4326;{AOI[aoi]}') and "
         f"ContentDate/Start ge {start}T00:00:00.000Z and ContentDate/Start le {end}T23:59:59.000Z")
    url = ("https://catalogue.dataspace.copernicus.eu/odata/v1/Products?"
           + urllib.parse.urlencode({"$filter": f, "$orderby": "ContentDate/Start asc", "$top": "50"}))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as fh:
        j = json.load(fh)
    rows = [{"i": i, "Id": p["Id"], "Name": p["Name"],
             "Start": p["ContentDate"]["Start"], "GB": round(p.get("ContentLength", 0)/1e9, 2)}
            for i, p in enumerate(j.get("value", []))]
    MAN.mkdir(parents=True, exist_ok=True)
    (MAN / f"cdse-katalog-{aoi}.json").write_text(json.dumps(j, indent=1))
    for r in rows:
        print(f"[{r['i']}] {r['Start'][:10]}  {r['GB']} GB  {r['Name']}")
    return rows

def download(idx, aoi="natuna"):
    cat = json.loads((MAN / f"cdse-katalog-{aoi}.json").read_text())
    p = cat["value"][idx]
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / (p["Name"].replace(".SAFE", "") + ".zip")
    url = f"https://zipper.dataspace.copernicus.eu/odata/v1/Products({p['Id']})/$value"
    tok = access_token()
    req = urllib.request.Request(url, headers={**UA, "Authorization": f"Bearer {tok}"})
    t0 = time.time(); done = 0
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 22)
            if not chunk:
                break
            f.write(chunk); done += len(chunk)
            if done % (1 << 28) < (1 << 22):
                print(f"  {done/1e9:.2f} GB  ({done/1e6/(time.time()-t0):.1f} MB/s)", flush=True)
    print(f"SELESAI {dest.name}: {done/1e9:.2f} GB dalam {time.time()-t0:.0f}s")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "query"
    if cmd == "query":
        query(sys.argv[2] if len(sys.argv) > 2 else "natuna")
    elif cmd == "download":
        download(int(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else "natuna")

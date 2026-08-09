import pathlib, time, urllib.request
url = "https://github.com/DIUx-xView/xView3_first_place/releases/download/1.1/traced_ensemble.jit"
dest = pathlib.Path.home()/"Documents/Datathon/varuna/models/xview3-first-place/weights/traced_ensemble.jit"
have = dest.stat().st_size if dest.exists() else 0
req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0", "Range": f"bytes={have}-"})
t0=time.time(); done=have
with urllib.request.urlopen(req, timeout=120) as r, open(dest, "ab") as f:
    total = have + int(r.headers.get("Content-Length", 0))
    print(f"resume dari {have/1e6:.0f} MB, total {total/1e9:.2f} GB, HTTP {r.status}")
    while True:
        c = r.read(1<<22)
        if not c: break
        f.write(c); done += len(c)
        if done % (1<<28) < (1<<22): print(f"  {done/1e9:.2f} GB ({(done-have)/1e6/(time.time()-t0):.1f} MB/s)", flush=True)
print(f"SELESAI: {dest.stat().st_size/1e9:.2f} GB dalam {time.time()-t0:.0f}s")

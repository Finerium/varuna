import pathlib, time, urllib.request
url = "https://github.com/DIUx-xView/xView3_first_place/releases/download/1.1/traced_ensemble.jit"
dest = pathlib.Path.home()/"Documents/Datathon/varuna/models/xview3-first-place/weights/traced_ensemble.jit"
def total_size():
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0","Range":"bytes=0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cr = r.headers.get("Content-Range","")
    return int(cr.split("/")[-1]) if "/" in cr else 0
TOTAL = total_size(); print("total resmi:", TOTAL)
for attempt in range(1, 30):
    have = dest.stat().st_size if dest.exists() else 0
    if TOTAL and have >= TOTAL: break
    try:
        req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0","Range":f"bytes={have}-"})
        with urllib.request.urlopen(req, timeout=90) as r, open(dest,"ab") as f:
            done = have
            while True:
                c = r.read(1<<22)
                if not c: break
                f.write(c); done += len(c)
                if done % (1<<28) < (1<<22): print(f"  {done/1e9:.2f}/{TOTAL/1e9:.2f} GB", flush=True)
    except Exception as e:
        print(f"attempt {attempt}: {e}"); time.sleep(8)
final = dest.stat().st_size
print("VALID" if final == TOTAL else f"BELUM ({final}/{TOTAL})")

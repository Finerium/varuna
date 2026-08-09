"""Unduh URL -> dest dengan resume Range; python3 fetch_generic.py <url> <dest>"""
import pathlib, sys, time, urllib.request
url, dest = sys.argv[1], pathlib.Path(sys.argv[2])
dest.parent.mkdir(parents=True, exist_ok=True)
for attempt in range(1, 11):
    try:
        have = dest.stat().st_size if dest.exists() else 0
        req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0", "Range": f"bytes={have}-"})
        t0=time.time(); done=have
        with urllib.request.urlopen(req, timeout=90) as r, open(dest, "ab") as f:
            if r.status == 200 and have:  # server abaikan Range -> mulai ulang
                f.seek(0); f.truncate(); done = 0
            while True:
                c = r.read(1<<22)
                if not c: break
                f.write(c); done += len(c)
                if done % (1<<28) < (1<<22): print(f"  {done/1e9:.2f} GB", flush=True)
        print(f"SELESAI {dest.name}: {done/1e9:.2f} GB ({attempt} attempt)"); break
    except Exception as e:
        print(f"attempt {attempt}: {e}; resume dalam 8s"); time.sleep(8)

#!/usr/bin/env python3
"""Unduh scene xView3 dari manifest presigned (tiny.txt + public.txt),
hanya scene di manifests/e1-scenes.txt (+tiny semua), SHA1-verify, resume."""
import hashlib, pathlib, re, time, urllib.request

BASE = pathlib.Path.home() / "Documents/Datathon/varuna"
RAW = BASE / "data/raw/xview3"
def parse_manifest(p):
    items, url = [], None
    for line in open(p):
        line = line.strip()
        if line.startswith("http"): url = line
        elif line.startswith("checksum=") and url:
            items.append((url, line.split("sha-1=")[1])); url = None
    return items

want = {l.split("\t")[1] for l in open(BASE/"manifests/e1-scenes.txt") if l.startswith(("eval","calib"))}
queue = []
for name, mani in [("tiny", "tiny.txt"), ("public", "public.txt")]:
    for url, sha in parse_manifest(RAW/mani):
        sid = re.search(r"/([0-9a-f]{16}[a-z])\.tar\.gz", url)
        if not sid: continue
        sid = sid.group(1)
        if name == "tiny" or sid in want:
            queue.append((name, sid, url, sha))
print(f"antrean: {len(queue)} file ({sum(1 for q in queue if q[0]=='tiny')} tiny + {sum(1 for q in queue if q[0]=='public')} subsampel)")

dest_root = RAW / "scenes"; dest_root.mkdir(exist_ok=True)
for i, (grp, sid, url, sha) in enumerate(queue, 1):
    dest = dest_root / f"{sid}.tar.gz"
    if dest.exists():
        h = hashlib.sha1(); 
        with open(dest,'rb') as f:
            for c in iter(lambda: f.read(1<<22), b''): h.update(c)
        if h.hexdigest() == sha:
            print(f"[{i}/{len(queue)}] {sid} sudah ada+valid, lewati"); continue
        dest.unlink()
    t0=time.time(); h=hashlib.sha1(); done=0
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest,'wb') as f:
        while True:
            c = r.read(1<<22)
            if not c: break
            f.write(c); h.update(c); done += len(c)
    ok = h.hexdigest() == sha
    print(f"[{i}/{len(queue)}] {grp}/{sid}: {done/1e9:.2f} GB {time.time()-t0:.0f}s SHA1={'OK' if ok else 'GAGAL!'}", flush=True)
    if not ok: dest.rename(dest.with_suffix(".BADSHA"))
print("ANTREAN SELESAI")

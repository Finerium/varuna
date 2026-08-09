#!/usr/bin/env python3
"""Begitu ~/Downloads/public.txt baru ada: bangun batch3/4 dari scene sisa + push."""
import json, pathlib, re, shutil, subprocess, py_compile
BASE = pathlib.Path.home()/"Documents/Datathon/varuna"
E1 = BASE/"experiments/e1"
src = pathlib.Path.home()/"Downloads/public.txt"
assert src.exists(), "public.txt baru belum ada di ~/Downloads"
shutil.copy(src, BASE/"data/raw/xview3/public.txt")
urls = {}
u = None
for line in open(src):
    line = line.strip()
    if line.startswith("http"): u = line
    elif line.startswith("checksum=") and u:
        m = re.search(r"/([0-9a-f]{16}[a-z])\.tar\.gz", u)
        if m: urls[m.group(1)] = u
        u = None
sisa = [l.strip() for l in open(BASE/"manifests/e1-scenes-sisa.txt") if l.strip()]
rows = [f"{s}\t{urls[s]}" for s in sisa]
print(f"sisa {len(rows)} scene, URL segar semua tersedia: {all(s in urls for s in sisa)}")
base = (E1/"push/run_e1.py").read_text()
halves = {"batch3": rows[:11], "batch4": rows[11:]}
for name, rr in halves.items():
    d = E1/f"push-{name}"; d.mkdir(exist_ok=True)
    tsv = json.dumps("\n".join(rr)+"\n")
    s2 = re.sub(r'FULL_TSV = .*', lambda m: f'FULL_TSV = {tsv}', base, count=1)
    s2 = s2.replace('RUN_MODE = "SMOKE"', 'RUN_MODE = "FULL"')
    (d/"run_e1.py").write_text(s2)
    (d/"kernel-metadata.json").write_text(json.dumps({
      "id": f"ghaisank/varuna-e1-{name}", "title": f"varuna-e1-{name}",
      "code_file": "run_e1.py", "language": "python", "kernel_type": "script",
      "is_private": "true", "enable_gpu": "true", "enable_internet": "true",
      "dataset_sources": [], "competition_sources": [], "kernel_sources": []}, indent=1))
    py_compile.compile(str(d/"run_e1.py"), doraise=True)
    r = subprocess.run(["kaggle","kernels","push","-p",str(d)], capture_output=True, text=True)
    print(name, len(rr), "scene:", (r.stdout+r.stderr).strip().splitlines()[-1])

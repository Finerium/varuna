import pathlib, time, urllib.request
dest = pathlib.Path.home()/"Documents/Datathon/varuna/data/raw/dma/aisdk-2026-08-06.zip"
part = dest.with_suffix(".zip.part")
for host in ["http://web.ais.dk/aisdata", "http://aisdata.ais.dk"]:
    try:
        have = part.stat().st_size if part.exists() else 0
        req = urllib.request.Request(f"{host}/aisdk-2026-08-06.zip",
              headers={"User-Agent":"Mozilla/5.0","Range":f"bytes={have}-"})
        t0=time.time(); done=have
        with urllib.request.urlopen(req, timeout=90) as r, open(part,"ab") as f:
            print(f"{host}: resume {have/1e6:.0f} MB, HTTP {r.status}")
            while True:
                c = r.read(1<<21)
                if not c: break
                f.write(c); done += len(c)
                if done % (1<<27) < (1<<21): print(f"  {done/1e6:.0f} MB", flush=True)
        part.rename(dest)
        print(f"SELESAI {dest.name}: {done/1e9:.2f} GB")
        break
    except Exception as e:
        print(f"{host} gagal: {e}; coba host lain / lanjut resume")
        time.sleep(5)

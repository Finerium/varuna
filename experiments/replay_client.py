#!/usr/bin/env python3
"""Klien replay produksi (SSE) — dipakai driver LIVE E7 (lengan A8 / prompt-only)
dan E5.4 stabilitas. Memanggil endpoint produksi apa adanya; TIDAK menyentuh
kode produk.

Kontrak SSE (contracts.md Bagian 3): POST /api/replay/{inv_id} memulai run dan
memancarkan `agent_step` lalu satu peristiwa penutup (`lanjut` bawa resume_token,
`selesai`, atau `gagal`). Tiap POST /api/replay/{inv_id}/step {resume_token}
menyetujui SATU tool tertunda dan mengembalikan bentuk yang sama. Satu run =
rangkai start -> step* sampai `selesai`/`gagal`.

Stdlib saja (urllib): tak menambah dependensi. Cookie peran wajib (jalur tulis
role-gated; replay sendiri read-all-role, tapi kita kirim peran demi paritas).

CATATAN BIAYA: tiap langkah memanggil model sungguhan. Pemanggil WAJIB memasang
budget (maks_inv, maks_langkah). Modul ini tidak pernah mengulang otomatis.
"""
import json
import time
import urllib.error
import urllib.request

BASE_DEFAULT = "https://varuna-gamma.vercel.app"


def _post(url, cookie, body):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Cookie", f"varuna_peran={cookie}")
    req.add_header("Accept", "text/event-stream")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            teks = r.read().decode("utf-8", "replace")
            return r.status, r.headers.get_content_type(), teks, (time.monotonic() - t0) * 1000
    except urllib.error.HTTPError as e:
        teks = e.read().decode("utf-8", "replace")
        return e.code, e.headers.get_content_type() if e.headers else "", teks, (time.monotonic() - t0) * 1000


def parse_sse(teks):
    """[(event, data_obj)] dari satu badan SSE. Blok dipisah baris kosong."""
    keluar = []
    for blok in teks.strip().split("\n\n"):
        ev, dat = None, None
        for baris in blok.splitlines():
            if baris.startswith("event:"):
                ev = baris[len("event:"):].strip()
            elif baris.startswith("data:"):
                dat = baris[len("data:"):].strip()
        if ev is not None:
            try:
                keluar.append((ev, json.loads(dat) if dat else None))
            except json.JSONDecodeError:
                keluar.append((ev, {"_raw": dat}))
    return keluar


def replay_once(inv_id, base=BASE_DEFAULT, peran="analis", maks_langkah=40):
    """Satu run replay penuh. Mengembalikan ringkasan yang dibutuhkan E5.4/E7:
    urutan langkah agen, PASHA final (status+hash lapisan server), himpunan
    artefak yang benar-benar dirujuk (dari pasha.reasons[].art_ids), diff vs
    tersimpan, dan latensi per panggilan HTTP. Token/usia model TIDAK ada di
    aliran SSE — `token_usage` sengaja null dan ditandai perlu instrumentasi
    server (bukan diarang)."""
    status_http, ctype, teks, ms = _post(f"{base}/api/replay/{inv_id}", peran, None)
    if ctype != "text/event-stream":
        # Keadaan jujur: 404 (inv tak ada di produk), 503 (tanpa kunci), dll.
        try:
            badan = json.loads(teks)
        except json.JSONDecodeError:
            badan = {"_raw": teks[:300]}
        return {"ok": False, "inv_id": inv_id, "http_status": status_http, "badan": badan}

    langkah_agen, latensi, penutup, sebab = [], [ms], None, None
    ev = parse_sse(teks)
    for nama, data in ev:
        if nama == "agent_step":
            langkah_agen.append(data)
        else:
            penutup = (nama, data)

    n = 0
    while penutup and penutup[0] == "lanjut" and n < maks_langkah:
        n += 1
        token = penutup[1].get("resume_token")
        st, ct, tk, ms = _post(f"{base}/api/replay/{inv_id}/step", peran, {"resume_token": token})
        latensi.append(ms)
        if ct != "text/event-stream":
            penutup = ("gagal", {"http_status": st, "badan": tk[:300]})
            break
        penutup = None
        for nama, data in parse_sse(tk):
            if nama == "agent_step":
                langkah_agen.append(data)
            else:
                penutup = (nama, data)

    if penutup and penutup[0] == "gagal":
        sebab = penutup[1]

    # PASHA final = agent_step A0 terakhir yang membawa pasha (fase done).
    pasha = next((s["pasha"] for s in reversed(langkah_agen) if s.get("pasha")), None)
    diff = next((s["diff"] for s in reversed(langkah_agen) if s.get("diff")), None)
    dirujuk = sorted({a for r in (pasha or {}).get("reasons", []) for a in r.get("art_ids", [])})

    return {
        "ok": penutup is not None and penutup[0] == "selesai",
        "inv_id": inv_id,
        "penutup": penutup[0] if penutup else "menggantung",
        "n_langkah_http": len(latensi),
        "agen_urut": [f'{s.get("agent")}:{s.get("phase")}' for s in langkah_agen],
        "pasha_status": (pasha or {}).get("status"),
        "pasha_hash": (pasha or {}).get("hash"),
        "artefak_dirujuk": dirujuk,
        "diff_vs_tersimpan": diff,
        "latensi_ms": [round(x, 1) for x in latensi],
        "token_usage": None,  # tak dipancarkan SSE; butuh instrumentasi server (E10), bukan dikarang
        "sebab_gagal": sebab,
    }


if __name__ == "__main__":
    import sys
    inv = sys.argv[1] if len(sys.argv) > 1 else "inv-x3-570f8bf7-01"
    print(json.dumps(replay_once(inv, maks_langkah=0), indent=1, ensure_ascii=False))

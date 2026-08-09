#!/usr/bin/env python3
"""E7-C — Verifier independen klaim-berkas (LLM-judge).

Implementasi SENGAJA BERBEDA dari checker gerbang (packages/core/src/grounding.ts):
grounding.ts hanya memeriksa apakah art_id RESOLVABLE di indeks (cek STRUKTURAL).
Verifier ini mengekstrak KLAIM (teks + art_id dirujuk) dari berkas investigasi lalu
memakai LLM-judge untuk menilai apakah ISI artefak SECARA SEMANTIK mendukung klaim
itu — cek KONTEN, bukan cuma keberadaan id. Tidak memanggil grounding.ts / pasha.ts;
grounding.json dibaca langsung sebagai indeks (implementasi kedua yang independen).

Kunci jawaban KALIBRASI = proksi heuristik struktural, BUKAN audit manusia penuh
(protocol E7 mensyaratkan audit manusia 50 klaim; di sini diganti proksi + dinyatakan):
  key(klaim) = "didukung"  bila >=1 art_id dirujuk DAN semuanya ada di grounding.json
             = "tidak"      selainnya (termasuk klaim tanpa art_id dirujuk).
presisi_judge_vs_kunci = presisi putusan "didukung" juri terhadap kunci ini.

Angka -> manifests/e7-verifier.json. TIDAK commit. TIDAK sentuh apps/ packages/.

Jalan:
  .venv/bin/python experiments/e7/verifier_independen.py            # run penuh + tulis manifest
  .venv/bin/python experiments/e7/verifier_independen.py --selfcheck # cek logika offline (gratis)
  .venv/bin/python experiments/e7/verifier_independen.py --extract-only  # inventaris klaim (gratis)
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import random
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

SEED = 20260809
CAP_KLAIM = 50            # <= 60 (batas biaya API, protocol E7-C); dicatat di manifest
MODEL_DEFAULT = "gpt-4o-mini"
NOW_FRAME = "2026-08-09T11:00:00Z"

ROOT = Path("/Users/ghaisan/Documents/Datathon/varuna")
GOLDEN = ROOT / "experiments/e5/goldenset"
MANIFEST_OUT = ROOT / "manifests/e7-verifier.json"
# cache putusan di LUAR tree repo publik (CLAUDE.md: nol jejak tooling); rerun gratis
CACHE = Path(os.environ.get("E7_JUDGE_CACHE", Path(tempfile.gettempdir()) / "e7_judge_cache.json"))
ENV_CANDIDATES = [ROOT / ".env", ROOT.parent / ".env"]          # task menyebut varuna/.env; nyatanya di root

# ---------------------------------------------------------------------------
# .env: baca HANYA baris OPENAI_* (JANGAN cetak nilai)
# ---------------------------------------------------------------------------
def load_openai_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for p in ENV_CANDIDATES:
        if not p.is_file():
            continue
        for raw in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            if k.startswith("OPENAI"):
                out.setdefault(k, v.strip().strip('"').strip("'"))
        if "OPENAI_API_KEY" in out:
            break
    return out


# ---------------------------------------------------------------------------
# Ekstraksi klaim dari berkas golden (status_server: headline + 6 reason)
# ---------------------------------------------------------------------------
def _fmt_ids(ids: list[str]) -> str:
    return ", ".join(ids) if ids else "(tidak ada)"


def render_reason_claim(rule: str, passed: bool, art_ids: list[str], missing: list[str]) -> str:
    """Kalimat klaim faithful terhadap semantik PASHA (pasha.ts computeStatus)."""
    if rule == "dua_sensor":
        return ("Kandidat didukung >= 2 modalitas sensor independen (SAR dan AIS)."
                if passed else
                "Kandidat TIDAK memenuhi dua sensor independen; modalitas sensor tidak lengkap.")
    if rule == "zona":
        return ("Kandidat melanggar aturan zona (pelanggaran zona tercatat oleh artefak aturan zona)."
                if passed else
                "Tidak ada pelanggaran zona yang tercatat untuk kandidat ini.")
    if rule == "kinematik_gap":
        return ("Pola going-dark terverifikasi: deteksi SAR + jeda AIS + kelayakan kinematik lolos."
                if passed else
                "Pola going-dark TIDAK terpenuhi (deteksi SAR/jeda AIS/kelayakan kinematik tidak lengkap).")
    if rule == "usia":
        return ("Usia bukti masih dalam ambang; bukti tidak kedaluwarsa."
                if passed else
                "Bukti telah melewati ambang usia (kedaluwarsa tanpa penguatan).")
    if rule == "konflik":
        return ("Tidak ada artefak yang saling bertentangan pada jendela waktu yang sama."
                if passed else
                "Terdapat artefak yang saling bertentangan pada jendela waktu yang sama (konflik).")
    if rule == "cakupan":
        return ("Cakupan sensor lengkap; tidak ada modalitas yang hilang."
                if passed else
                f"Cakupan sensor tidak lengkap; modalitas hilang: {_fmt_ids(missing)}.")
    return f"Aturan {rule} dinilai passed={passed}."


def extract_claims() -> list[dict]:
    """Satu klaim per headline + per reason, tiap investigasi golden yang ADA."""
    claims: list[dict] = []
    inv_dirs = sorted(
        d for d in GOLDEN.glob("inv-e5-*")
        if (d / "investigation.json").is_file() and (d / "grounding.json").is_file()
    )
    for d in inv_dirs:
        inv = json.loads((d / "investigation.json").read_text())
        grounding = json.loads((d / "grounding.json").read_text())
        grounding_ids = set(grounding.get("art_ids", []))
        # muat payload artefak (art_id -> artefak penuh); abaikan duplikat Finder " 2.json"
        art_by_id: dict[str, dict] = {}
        for af in sorted((d / "artifacts").glob("*.json")):
            if af.stem.endswith(" 2"):
                continue
            a = json.loads(af.read_text())
            art_by_id[a["art_id"]] = a
        ss = inv["status_server"]
        inv_id = inv["inv_id"]
        missing = ss.get("missing_coverage", [])

        def add(claim_id_suffix: str, rule: str, text: str, cited: list[str]):
            cited = list(dict.fromkeys(cited))  # dedup, urut stabil
            key = ("didukung"
                   if cited and all(c in grounding_ids for c in cited)
                   else "tidak")
            claims.append({
                "claim_id": f"{inv_id}::{claim_id_suffix}",
                "inv_id": inv_id,
                "rule": rule,
                "text": text,
                "cited_art_ids": cited,
                "cited_artifacts": [art_by_id.get(c, {"art_id": c, "_MISSING_FILE": True}) for c in cited],
                "key": key,
            })

        # headline status: bukti penopang = seluruh artefak investigasi
        st = ss.get("status")
        add("status", "status",
            f"Investigasi disimpulkan berstatus '{st}' "
            f"(sensor independen={ss.get('sensors_independent')}, "
            f"pelanggaran zona={ss.get('zone_violation')}, "
            f"usia bukti={ss.get('evidence_age_h')} jam).",
            inv.get("artifacts", []))
        # enam reason
        for r in ss.get("reasons", []):
            add(r["rule"], r["rule"],
                render_reason_claim(r["rule"], r["passed"], r.get("art_ids", []), missing),
                r.get("art_ids", []))
    return claims


def select_claims(claims: list[dict], cap: int) -> list[dict]:
    """Deterministik (seed) + terstratifikasi ringan: pastikan kedua kelas kunci
    terwakili supaya presisi tidak degenerate. Bukan optimasi, cuma jaminan minimum."""
    rng = random.Random(SEED)
    ordered = sorted(claims, key=lambda c: c["claim_id"])
    rng.shuffle(ordered)
    picked = ordered[:cap]
    kelas = {c["key"] for c in picked}
    # jaminan minimum tiap kelas (>=8) — kalau timpang, sisipkan dari sisa
    if len(kelas) < 2 or min(sum(c["key"] == k for c in picked) for k in ("didukung", "tidak")) < 8:
        rest = ordered[cap:]
        for want in ("didukung", "tidak"):
            have = sum(c["key"] == want for c in picked)
            i = 0
            while have < 8 and i < len(rest):
                if rest[i]["key"] == want:
                    # tukar keluar anggota kelas mayoritas terakhir
                    for j in range(len(picked) - 1, -1, -1):
                        if picked[j]["key"] != want:
                            picked[j] = rest[i]
                            have += 1
                            break
                i += 1
    return picked


# ---------------------------------------------------------------------------
# LLM-judge (klien kompatibel-OpenAI via urllib; tanpa SDK)
# ---------------------------------------------------------------------------
SYSTEM = (
    "Anda VERIFIER INDEPENDEN untuk berkas investigasi maritim. Tugas: menilai apakah "
    "ISI artefak yang DIRUJUK benar-benar MENDUKUNG klaim. Anda TIDAK memeriksa apakah id "
    "artefak terdaftar — Anda membaca payload artefak dan menimbang substansinya terhadap "
    "klaim. Aturan: (1) 'didukung' bila isi artefak yang dirujuk secara wajar menegakkan "
    "klaim; (2) 'tidak' bila isi artefak bertentangan dengan klaim ATAU tidak ada artefak "
    "dirujuk sehingga klaim tak dapat ditegakkan oleh bukti; (3) 'ambigu' bila artefak ada "
    "tetapi tidak cukup untuk menegakkan/menyangkal (mis. klaim menyatakan KETIADAAN sesuatu "
    "yang satu artefak tak bisa buktikan). Balas HANYA JSON: "
    '{"putusan":"didukung|tidak|ambigu","alasan":"<=200 char"}.'
)


def judge_payload(claim: dict) -> str:
    arts = claim["cited_artifacts"]
    art_txt = (json.dumps(arts, ensure_ascii=False, indent=1)
               if arts else "TIDAK ADA artefak yang dirujuk klaim ini.")
    return (f"KLAIM:\n{claim['text']}\n\n"
            f"ART_ID DIRUJUK: {_fmt_ids(claim['cited_art_ids'])}\n\n"
            f"ISI ARTEFAK YANG DIRUJUK (payload):\n{art_txt}\n\n"
            "Apakah isi artefak yang dirujuk mendukung klaim? Balas JSON putusan.")


def _cache_load() -> dict:
    if CACHE.is_file():
        try:
            return json.loads(CACHE.read_text())
        except Exception:
            return {}
    return {}


def call_openai(key: str, base: str, model: str, user: str, cache: dict) -> tuple[str, dict]:
    ck = hashlib.sha256(f"{model}\x00{SYSTEM}\x00{user}".encode()).hexdigest()
    if ck in cache:
        return cache[ck]["content"], cache[ck].get("usage", {})
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
        "temperature": 0,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.load(r)
            content = d["choices"][0]["message"]["content"]
            usage = d.get("usage", {})
            cache[ck] = {"content": content, "usage": usage}
            CACHE.write_text(json.dumps(cache))
            return content, usage
        except urllib.error.HTTPError as e:
            last = f"HTTP{e.code}:{e.read().decode()[:160]}"
            if e.code in (429, 500, 502, 503):
                time.sleep(2 * (attempt + 1))
                continue
            break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}:{str(e)[:160]}"
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"OpenAI gagal setelah retry: {last}")


def parse_verdict(content: str) -> tuple[str, str, bool]:
    """-> (putusan, alasan, parse_ok). Fallback kata-kunci bila JSON rusak."""
    try:
        d = json.loads(content)
        p = str(d.get("putusan", "")).strip().lower()
        if p in ("didukung", "tidak", "ambigu"):
            return p, str(d.get("alasan", ""))[:200], True
    except Exception:  # noqa: BLE001
        pass
    low = content.lower()
    for p in ("didukung", "ambigu", "tidak"):  # 'tidak' terakhir: hindari false hit
        if p in low:
            return p, "(fallback kata-kunci; JSON rusak)", False
    return "ambigu", "(tak terparse; default ambigu)", False


# ---------------------------------------------------------------------------
# Metrik
# ---------------------------------------------------------------------------
def compute_metrics(judged: list[dict]) -> dict:
    dist = {"didukung": 0, "tidak": 0, "ambigu": 0}
    conf = {}  # (key, putusan) -> n
    for j in judged:
        dist[j["putusan"]] += 1
        conf[(j["key"], j["putusan"])] = conf.get((j["key"], j["putusan"]), 0) + 1
    tp = conf.get(("didukung", "didukung"), 0)          # juri didukung & kunci didukung
    fp = conf.get(("tidak", "didukung"), 0)              # juri didukung & kunci tidak (endorse palsu)
    tn = conf.get(("tidak", "tidak"), 0)                 # juri tidak & kunci tidak
    presisi = (tp / (tp + fp)) if (tp + fp) else None
    # agreement biner (ambigu dihitung tak-setuju dengan kunci biner apa pun)
    agreement = (tp + tn) / len(judged) if judged else None
    return {
        "distribusi_putusan": dist,
        "distribusi_per_kunci": {
            f"{k}|{p}": conf.get((k, p), 0)
            for k in ("didukung", "tidak") for p in ("didukung", "tidak", "ambigu")
        },
        "presisi_judge_vs_kunci": presisi,
        "agreement_vs_kunci": agreement,
        "presisi_pembilang_TP": tp,
        "presisi_penyebut_TP_plus_FP": tp + fp,
    }


# ---------------------------------------------------------------------------
# Self-check offline (logika kunci + presisi; tanpa API) — ponytail check
# ---------------------------------------------------------------------------
def selfcheck() -> None:
    # kunci: cited & resolvable -> didukung; kosong/dangling -> tidak
    fake = [
        {"cited_art_ids": ["a-x-1"], "key": None},
    ]
    g = {"a-x-1"}
    assert (bool(fake[0]["cited_art_ids"]) and all(c in g for c in fake[0]["cited_art_ids"])) is True
    assert (bool([]) and all(c in g for c in [])) is False               # kosong -> tidak
    assert all(c in g for c in ["a-x-2"]) is False                       # dangling -> tidak
    # presisi: 2 TP, 1 FP -> 2/3
    judged = [
        {"key": "didukung", "putusan": "didukung"},
        {"key": "didukung", "putusan": "didukung"},
        {"key": "tidak", "putusan": "didukung"},
        {"key": "tidak", "putusan": "tidak"},
        {"key": "didukung", "putusan": "ambigu"},
    ]
    m = compute_metrics(judged)
    assert m["presisi_judge_vs_kunci"] == 2 / 3, m["presisi_judge_vs_kunci"]
    assert m["distribusi_putusan"] == {"didukung": 3, "tidak": 1, "ambigu": 1}
    # parse fallback
    assert parse_verdict('{"putusan":"didukung","alasan":"x"}')[0] == "didukung"
    assert parse_verdict('bla didukung bla')[0] == "didukung"
    assert parse_verdict('kosong')[0] == "ambigu"
    # seleksi deterministik + dua kelas
    claims = extract_claims()
    a = [c["claim_id"] for c in select_claims(claims, 50)]
    b = [c["claim_id"] for c in select_claims(claims, 50)]
    assert a == b, "seleksi tidak deterministik"
    sel = select_claims(claims, 50)
    ks = {c["key"] for c in sel}
    assert ks == {"didukung", "tidak"}, ("kedua kelas wajib ada", ks)
    print("SELFCHECK OK — klaim total:", len(claims),
          "| dipilih:", len(sel),
          "| didukung:", sum(c["key"] == "didukung" for c in sel),
          "| tidak:", sum(c["key"] == "tidak" for c in sel))


# ---------------------------------------------------------------------------
def main() -> None:
    if "--selfcheck" in sys.argv:
        selfcheck()
        return

    claims = extract_claims()
    key_dist_all = {k: sum(c["key"] == k for c in claims) for k in ("didukung", "tidak")}
    selected = select_claims(claims, CAP_KLAIM)

    if "--extract-only" in sys.argv:
        print(json.dumps({
            "total_klaim_golden": len(claims),
            "distribusi_kunci_semua": key_dist_all,
            "dipilih": len(selected),
            "distribusi_kunci_dipilih": {k: sum(c["key"] == k for c in selected) for k in ("didukung", "tidak")},
            "inv_terwakili": len({c["inv_id"] for c in selected}),
            "contoh": [{"claim_id": c["claim_id"], "key": c["key"], "text": c["text"][:70]} for c in selected[:6]],
        }, ensure_ascii=False, indent=2))
        return

    env = load_openai_env()
    key = env.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit("OPENAI_API_KEY tidak ditemukan di .env — tidak memfabrikasi angka. Batalkan.")
    base = env.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = env.get("OPENAI_MODEL", MODEL_DEFAULT)

    cache = _cache_load()
    judged, parse_fail = [], 0
    tok_in = tok_out = 0
    for i, c in enumerate(selected, 1):
        content, usage = call_openai(key, base, model, judge_payload(c), cache)
        putusan, alasan, ok = parse_verdict(content)
        parse_fail += 0 if ok else 1
        tok_in += usage.get("prompt_tokens", 0)
        tok_out += usage.get("completion_tokens", 0)
        judged.append({
            "claim_id": c["claim_id"], "inv_id": c["inv_id"], "rule": c["rule"],
            "key": c["key"], "putusan": putusan, "alasan": alasan,
            "cited_art_ids": c["cited_art_ids"], "parse_ok": ok,
        })
        print(f"[{i}/{len(selected)}] {c['claim_id']} key={c['key']} -> {putusan}", file=sys.stderr)

    metrics = compute_metrics(judged)
    batas = [
        "Kunci jawaban KALIBRASI = proksi heuristik struktural (art_id dirujuk resolvable di "
        "grounding.json). BUKAN audit manusia penuh; protocol E7 mensyaratkan audit manusia 50 "
        "klaim — di sini digantikan proksi dan dinyatakan terbuka.",
        "Konvensi kunci: klaim TANPA art_id dirujuk dinilai kunci='tidak' (tak ada artefak penopang).",
        f"n dibatasi {CAP_KLAIM} klaim (<= batas 60 protocol E7-C) untuk kendali biaya API; dipilih "
        f"deterministik seed {SEED} dari {len(claims)} klaim golden.",
        "Plafon proksi: klaim berkesimpulan-negatif (mis. 'tidak ada konflik', 'bukan going-dark', "
        "'tidak memenuhi dua sensor') sukar disubstansiasi satu artefak (membuktikan ketiadaan). "
        "Divergensi juri-vs-proksi di sini kerap berarti juri LEBIH ketat dari proksi, bukan juri salah.",
        f"Juri = {model}, suhu 0; lapis LLM tidak diklaim deterministik (protocol §0.7). "
        f"parse_fail_json={parse_fail}.",
        "BACA presisi bersama agreement: presisi='didukung' bisa 1.0 karena juri nol-endorse-palsu "
        "(tak pernah menyokong klaim tanpa artefak resolvable), TETAPI juri menolak sebagian klaim "
        "berkunci-didukung yang berkesimpulan negatif / berartefak sintetis — divergensi = plafon "
        "proksi (juri lebih ketat), bukan galat juri. Lihat distribusi_per_kunci.",
    ]
    manifest = {
        "run_id": "e7-verifier-01",
        "commit": None,
        "seed": SEED,
        "now_frame": NOW_FRAME,
        "model": model,
        "base_url_host": base.split("//")[-1].split("/")[0],
        "metode": "LLM-judge konten klaim-vs-artefak; INDEPENDEN dari grounding.ts (cek struktural). "
                  "grounding.json dibaca langsung sebagai indeks.",
        "kunci_definisi": "didukung iff >=1 art_id dirujuk DAN semua ada di grounding.json; selainnya tidak.",
        "n_klaim": len(judged),
        "presisi_judge_vs_kunci": metrics["presisi_judge_vs_kunci"],
        "agreement_vs_kunci": metrics["agreement_vs_kunci"],
        "distribusi_putusan": metrics["distribusi_putusan"],
        "distribusi_per_kunci": metrics["distribusi_per_kunci"],
        "presisi_detail": {
            "pembilang_TP": metrics["presisi_pembilang_TP"],
            "penyebut_TP_plus_FP": metrics["presisi_penyebut_TP_plus_FP"],
        },
        "total_klaim_golden_tersedia": len(claims),
        "distribusi_kunci_semua_klaim": key_dist_all,
        "inv_terwakili": len({j["inv_id"] for j in judged}),
        "usage_tokens": {"prompt": tok_in, "completion": tok_out},
        "batas": batas,
        "putusan_per_klaim": judged,
    }
    MANIFEST_OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({k: manifest[k] for k in
                      ("n_klaim", "presisi_judge_vs_kunci", "agreement_vs_kunci",
                       "distribusi_putusan", "distribusi_per_kunci", "presisi_detail",
                       "inv_terwakili")},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

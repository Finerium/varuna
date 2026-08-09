"""Rakit manifests/e8-hasil.json dari lembar penilai + kappa.py + peta adjudikasi.

Manifest dirakit, tidak diketik ulang: angka di manifest wajib sama persis dengan
lembar penilai. Jalankan ulang setelah lembar/adjudikasi berubah.

  .venv/bin/python experiments/e8/manifest_e8.py
"""
import json
import os

from kappa import baca_lembar, hitung, wilson  # satu sumber rumus

AKAR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KELUARAN = os.path.join(AKAR, "manifests/e8-hasil.json")
NILAI = {"terpenuhi": 2, "parsial": 1, "tidak": 0}

# id -> (judul, kerangka sumber, kelompok)
ELEMEN = {
 "A1": ("Bahan keterangan ahli: metode terdokumentasi dan dapat diulang", "KUHAP Ps. 184", "A"),
 "A2": ("Bahan surat/dokumen elektronik: berkas berstruktur dan mandiri", "KUHAP Ps. 184", "A"),
 "A3": ("Bahan petunjuk: rantai inferensi antar-bukti eksplisit", "KUHAP Ps. 184", "A"),
 "A4": ("Batas kedudukan dinyatakan pada keluaran (bukan hanya di paper)", "KUHAP Ps. 184", "A"),
 "A5": ("Prinsip minimal dua alat bukti tercermin sebagai aturan mesin", "KUHAP Ps. 184", "A"),
 "B1": ("Berbentuk Informasi/Dokumen Elektronik yang dapat diwujudkan kembali", "UU ITE Ps. 5(1)", "B"),
 "B2": ("Dapat diakses", "UU ITE Ps. 6", "B"),
 "B3": ("Dapat ditampilkan", "UU ITE Ps. 6", "B"),
 "B4": ("Dijamin keutuhannya", "UU ITE Ps. 6", "B"),
 "B5": ("Dapat dipertanggungjawabkan (asal-usul dan pihak bertanggung jawab)", "UU ITE Ps. 6", "B"),
 "B6": ("Sistem Elektronik tertib + pengecualian dinyatakan", "UU ITE Ps. 5(3)-(4)", "B"),
 "C1": ("Akurasi dan ketidakpastian posisi/waktu dinyatakan per rekaman", "FAO VMS 1998", "C"),
 "C2": ("Rantai kustodi / jejak audit dari akuisisi sampai berkas", "FAO VMS 1998", "C"),
 "C3": ("Keamanan data dan perlindungan identitas", "FAO VMS 1998", "C"),
 "C4": ("Reprodusibilitas dan retensi oleh pihak ketiga", "FAO VMS 1998", "C"),
 "C5": ("Data penginderaan jauh tidak berdiri sendiri: korroborasi disyaratkan mesin", "FAO VMS 1998", "C"),
 "D1": ("Deteksi satelit terdokumentasi sampai produk asli", "Pola Rouen 2025", "D"),
 "D2": ("Korelasi AIS terdokumentasi, dapat diulang, diuji kontrol negatif", "Pola Rouen 2025", "D"),
 "D3": ("Bahan kesaksian ahli: keterbatasan dan kegagalan dinyatakan terbuka", "Pola Rouen 2025", "D"),
 "D4": ("Keputusan tetap pada manusia; sistem tidak bertindak sendiri", "Pola Rouen 2025", "D"),
}

# item -> (skor final, aturan pemutus, ringkas). Hanya untuk item yang diadjudikasi.
ADJUDIKASI = {
 "A4": ("parsial", "R2",
        "Kedua fakta benar; beda lingkup kriteria 'kedudukan/keterbatasan'. Judul item menuntut "
        "kedudukan keluaran, dan itu tidak ada di permukaan mana pun -> skor lebih rendah dipakai."),
 "B6": ("parsial", "R2",
        "Kedua fakta benar; pernyataan kedudukan hukum ada di protokol/janji-audit, daftar "
        "pengecualian Ps. 5(4) tidak ada di repo -> skor lebih rendah dipakai."),
 "C3": ("parsial", "R1",
        "P1 menilai kontrak, P2 menilai as-built: salt HMAC ditulis keras di repo "
        "(scripts/golden_*.py) dan nol kode membaca salt dari env -> fakta P2 yang benar."),
}


def rakit():
    r = hitung()
    _, s1 = baca_lembar("lembar-p1.json")
    l1, _ = baca_lembar("lembar-p1.json")
    l2, s2 = baca_lembar("lembar-p2.json")
    alasan1 = {s["item"]: s for s in l1["skor"]}
    alasan2 = {s["item"]: s for s in l2["skor"]}
    bukti = json.load(open(os.path.join(AKAR, "experiments/e8/bukti-mesin.json"), encoding="utf-8"))

    elemen = []
    for i, (judul, kerangka, kel) in ELEMEN.items():
        final, aturan, _ = ADJUDIKASI.get(i, (s1[i], None, None))
        elemen.append({
            "id": i, "kelompok": kel, "kerangka": kerangka, "judul": judul,
            "p1": {"skor": s1[i], "alasan": alasan1[i]["alasan"], "bukti": alasan1[i]["bukti"]},
            "p2": {"skor": s2[i], "alasan": alasan2[i]["alasan"], "bukti": alasan2[i]["bukti"]},
            "final": final, "aturan_pemutus": aturan,
        })

    n = len(elemen)
    dist = {k: sum(1 for e in elemen if e["final"] == k) for k in NILAI}
    total = sum(NILAI[e["final"]] for e in elemen)
    per_kelompok = {}
    for kel in "ABCD":
        anggota = [e for e in elemen if e["kelompok"] == kel]
        per_kelompok[kel] = {
            "n_item": len(anggota),
            "skor": f"{sum(NILAI[e['final']] for e in anggota)}/{2 * len(anggota)}",
            "terpenuhi": sum(1 for e in anggota if e["final"] == "terpenuhi"),
            "parsial": sum(1 for e in anggota if e["final"] == "parsial"),
            "tidak": sum(1 for e in anggota if e["final"] == "tidak"),
        }

    return {
     "run_id": "e8-20260809",
     "date": "2026-08-09",
     "seed": 20260809,
     "protocol": "protocol/eval-protocol.md §E8 + §0.1/§0.2/§0.5 (BEKU, freeze-eval-v1 @0bc9af9)",
     "snapshot": bukti["snapshot"],
     "label_wajib_di_paper": (
      "Audit kesesuaian terhadap kerangka terdokumentasi oleh tim; bukan penilaian pakar "
      "eksternal, bukan validasi keberterimaan di pengadilan."
     ),
     "instrumen": {
      "berkas": "experiments/e8/protokol-penilaian.md (v1, ditulis lengkap sebelum penilaian)",
      "n_item": n,
      "sumber_kerangka": ["KUHAP Pasal 184", "UU ITE Pasal 5-6", "FAO VMS 1998",
                          "Pola pembuktian Cour d'appel de Rouen 2025"],
      "skala": {"terpenuhi": 2, "parsial": 1, "tidak": 0},
      "korpus_bukti": [
       "packages/core/golden/investigations/ (7 investigasi, 39 artefak)",
       "experiments/e5/goldenset/ (32 artefak pada snapshot akhir)",
       "packages/core/src, packages/core/bin, apps/web/app, apps/web/lib",
       "contracts/, manifests/, protocol/",
      ],
      "basis_fakta_mesin": "experiments/e8/bukti-mesin.json (experiments/e8/periksa_bukti.py)",
     },
     "penilai": [
      {"id": "P1", "jenis": l1["jenis_penilai"], "lembar": "experiments/e8/lembar-p1.json",
       "lintasan": l1["lintasan"]},
      {"id": "P2", "jenis": l2["jenis_penilai"], "lembar": "experiments/e8/lembar-p2.json",
       "lintasan": l2["lintasan"]},
     ],
     "elemen": elemen,
     "reliabilitas_antar_penilai": {
      "kelas": r["kelas"],
      "tabel_silang_p1_baris_p2_kolom": r["tabel_silang"],
      "marginal_p1": r["marginal_p1"],
      "marginal_p2": r["marginal_p2"],
      "agreement_mentah": r["agreement"],
      "kappa_cohen": r["kappa_cohen"],
      "kappa_bootstrap95": r["kappa_bootstrap95"],
      "kappa_catatan": r["kappa_bootstrap_catatan"],
      "validasi_instrumen": (
       "experiments/e8/kappa.py --check: kappa kami == sklearn.metrics.cohen_kappa_score "
       "(1.9.0) pada data yang sama; kasus buku teks kappa=0,4; Wilson diverifikasi tangan."
      ),
      "peringatan": (
       "Kedua penilai adalah dua pass agen yang sama dalam satu sesi. Kebutaan bersifat "
       "PROSEDURAL (lembar P1 dibekukan dan tidak dibuka saat P2 berjalan, lintasan P2 "
       "dibalik dan berangkat dari bukti), bukan struktural. Galat berkorelasi tidak dapat "
       "dikesampingkan; kappa ini BATAS ATAS optimistik terhadap dua penilai manusia terpisah."
      ),
     },
     "adjudikasi": {
      "berkas": "experiments/e8/adjudikasi.md",
      "aturan": {
       "R1": "salah satu penilai salah baca fakta -> skor yang faktanya benar menang",
       "R2": "kedua fakta benar, beda lingkup kriteria -> skor LEBIH RENDAH menang (§0.1)",
      },
      "kasus": [
       {"item": i, "p1": s1[i], "p2": s2[i], "final": ADJUDIKASI[i][0],
        "aturan": ADJUDIKASI[i][1], "ringkas": ADJUDIKASI[i][2]}
       for i in sorted(ADJUDIKASI)
      ],
      "catatan": "Ketiga adjudikasi menurunkan skor; tidak ada yang menaikkan.",
     },
     "hasil_final": {
      "distribusi": {
       k: {"frac": f"{v}/{n}", "p": round(v / n, 4), "wilson95": wilson(v, n)}
       for k, v in dist.items()
      },
      "indeks_kesesuaian": {
       "skor": f"{total}/{2 * n}", "p": round(total / (2 * n), 4),
       "definisi": "jumlah nilai item (terpenuhi=2, parsial=1, tidak=0) dibagi maksimum",
       "bukan": "bukan skor keberterimaan hukum; lihat plafon_dinyatakan",
      },
      "per_kelompok": per_kelompok,
      "nol_item_bernilai_tidak": dist["tidak"] == 0,
     },
     "usability_e8_subklausa": {
      "status": "TERTUNDA — sebagian HUMAN-GATED",
      "partisipan_proxy_non_tim": (
       "TIDAK TERSEDIA (n=0 < 3). Protokol mensyaratkan partisipan dilabeli jujur; tidak ada "
       "manusia non-tim dalam run ini. SUS, completion rate, dan waktu tugas TIDAK dilaporkan "
       "dan tidak boleh disintesis."
      ),
      "fallback_cognitive_walkthrough": (
       "BELUM DIJALANKAN pada run ini. Alasan jujur: permukaan produk berubah saat audit "
       "berjalan (commit wave-3 mendarat di tengah sapuan bukti), sehingga walkthrough akan "
       "menilai UI yang sudah tidak ada. Prasyarat: pembekuan apps/web. Bahan siap: 4 tugas "
       "Pusat Komando dapat diturunkan dari matriks keadaan contracts.md Bagian 8."
      ),
      "dikembalikan_ke": "Orchestrator (keputusan penjadwalan, bukan keputusan angka)",
     },
     "plafon_dinyatakan": [
      "Audit menilai kesesuaian terhadap kerangka TERDOKUMENTASI, bukan keberterimaan di "
      "pengadilan; tidak ada hakim, jaksa, penyidik, atau ahli forensik yang menilai.",
      "Penilai = dua pass agen internal, bukan pakar dan bukan dua orang; kappa batas atas.",
      "Instrumen diturunkan sendiri oleh tim dari bacaan atas KUHAP Ps. 184, UU ITE Ps. 5-6, "
      "FAO (1998), dan pola Rouen; bukan instrumen tervalidasi yang diterbitkan pihak lain.",
      "'terpenuhi' berarti artefaknya ada dan menyeluruh pada korpus yang diaudit, BUKAN "
      "'sah sebagai alat bukti'.",
      "Berkas naratif dari agen live belum ada pada 5 dari 6 investigasi bergolden; item yang "
      "menyangkut berkas jadi dinilai 'parsial (tertunda)', bukan 'tidak'.",
     ],
     "deviasi_protokol": [
      {"klausa": "E8: '2 penilai internal independen, buta silang'",
       "deviasi": "Dipenuhi sebagai dua pass agen internal yang saling buta secara prosedural "
                  "dalam satu sesi, bukan dua orang. Diotorisasi Orchestrator dan dideklarasikan "
                  "di lembar, manifest, dan (wajib) di paper.",
       "dampak": "kappa optimistik; klaim reliabilitas harus dibaca sebagai batas atas."},
      {"klausa": "E8: usability KONDISIONAL partisipan proxy n>=3",
       "deviasi": "Partisipan tidak tersedia; fallback cognitive walkthrough belum dijalankan "
                  "karena UI masih berubah. Tidak ada angka usability yang dilaporkan.",
       "dampak": "Sub-klausa E8 belum tuntas; tidak ada angka yang dipalsukan."},
      {"klausa": "§0.10 ketertelusuran run",
       "deviasi": "Korpus hidup: 4 artefak E5 baru (28 -> 32) mendarat saat audit berjalan. "
                  "Lembar P1/P2 TIDAK diedit setelah melihat hasil; item terdampak (B5, D1) "
                  "diperiksa ulang pada snapshot akhir dan skornya tidak berubah "
                  "(28 dari 32 artefak E5 masih tanpa dataset/sintetis/observed_at).",
       "dampak": "Angka manifest berlaku untuk snapshot yang tercantum, bukan selamanya."},
     ],
     "temuan_dinaikkan": [
      {"id": "E8-TEMUAN-01", "asal": "C3",
       "isi": "Salt HMAC pseudonimisasi MMSI ditulis keras di repo "
              "(scripts/golden_denmark_asosiasi.py:39, scripts/golden_zona_perilaku_anomali.py:32, "
              "packages/core/golden/verifikasi_golden.py:13) dan tidak ada kode yang membaca salt "
              "dari environment. Selama itu, mmsi_hash dapat dibalik oleh pemegang repo + daftar MMSI.",
       "tindak_lanjut": "Baca salt dari env pada jalur produksi lalu putar ulang pseudonim golden."},
      {"id": "E8-TEMUAN-02", "asal": "A2/B1",
       "isi": "Tidak ada jalur ekspor/cetak berkas utuh; penyerahan ke penyidik hari ini berarti "
              "menyalin panggilan API satu per satu.",
       "tindak_lanjut": "Satu rute dokumen penuh (investigasi + artefak + hash) menutup A2 dan B1."},
      {"id": "E8-TEMUAN-03", "asal": "B3/A3",
       "isi": "inv-dk-01 (22 artefak, satu-satunya rantai going-dark AIS lengkap) belum punya "
              "investigation.json sehingga tidak dapat ditampilkan maupun dinilai sebagai berkas.",
       "tindak_lanjut": "Bangun investigation.json inv-dk-01 lewat bin/rebuild-golden.ts."},
     ],
     "artefak": [
      "experiments/e8/protokol-penilaian.md",
      "experiments/e8/periksa_bukti.py",
      "experiments/e8/bukti-mesin.json",
      "experiments/e8/lembar-p1.json",
      "experiments/e8/lembar-p2.json",
      "experiments/e8/kappa.py",
      "experiments/e8/adjudikasi.md",
      "experiments/e8/manifest_e8.py",
     ],
     "cara_reproduksi": [
      ".venv/bin/python experiments/e8/periksa_bukti.py --check",
      ".venv/bin/python experiments/e8/periksa_bukti.py",
      ".venv/bin/python experiments/e8/kappa.py --check",
      ".venv/bin/python experiments/e8/kappa.py",
      ".venv/bin/python experiments/e8/manifest_e8.py",
     ],
    }


if __name__ == "__main__":
    m = rakit()
    with open(KELUARAN, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=1, ensure_ascii=False)
        f.write("\n")
    h = m["hasil_final"]
    print(f"manifests/e8-hasil.json ditulis: indeks {h['indeks_kesesuaian']['skor']}, "
          f"kappa {m['reliabilitas_antar_penilai']['kappa_cohen']}, "
          f"terpenuhi {h['distribusi']['terpenuhi']['frac']}, "
          f"parsial {h['distribusi']['parsial']['frac']}, "
          f"tidak {h['distribusi']['tidak']['frac']}")

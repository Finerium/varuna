// "/" — Entry multi-persona. Register paling ekspresif dari lima surface, tetapi
// keberanian dibelanjakan pada komposisi, bukan hiasan: hero terpusat yang
// menjelaskan sistem dalam dua detik, lalu narasi bernomor yang membacanya turun.
// Semua isi hadir tanpa JavaScript; gerak hanya menambah irama (GerakEntry).

import Link from "next/link";

import { GerakEntry } from "@/components/gerak";
import { ChipSar } from "@/components/tampil";
import { chipPertama } from "@/lib/gudang";

import { KartuPeran } from "./enter/kartu-peran";

export const dynamic = "force-dynamic";

const BUKTI = [
  { angka: "0,854", ket: "F1 deteksi lepas pantai" },
  { angka: "24/24", ket: "skenario red-team tertangkap" },
  { angka: "0", ket: "klaim tanpa artefak lolos" },
] as const;

const NARASI = [
  {
    no: "01",
    tanda: "Masalah",
    judul: ["Lautnya diawasi.", "Kapalnya menghilang."],
    isi: "Antara 72 dan 76 persen kapal ikan industri dunia tidak terlacak publik. Mereka mematikan transponder AIS tepat sebelum masuk zona sasaran, memalsukan posisi, lalu menukar identitas. Kapasitas patroli Indonesia untuk 6,4 juta kilometer persegi laut justru menyusut.",
  },
  {
    no: "02",
    tanda: "Cara kerja",
    judul: ["Radar melihat.", "Agen menyusun.", "Server memutus."],
    isi: "Citra radar Sentinel-1 mendeteksi lambung kapal tanpa peduli sinyal AIS mati. Lapisan sebelas agen mengorelasikan deteksi itu dengan lintasan AIS, memeriksa perilaku, lalu menyusun berkas. Yang tidak dikerjakan agen: memutus status — itu dihitung server dari artefak yang ada.",
  },
  {
    no: "03",
    tanda: "Bukti",
    judul: ["Setiap klaim menunjuk artefak.", "Kalau ragu, menahan diri."],
    isi: "PASHA Gate menolak klaim yang artefaknya tidak ada, menyaring kata bernada putusan, dan menahan status jadi ABSTAIN saat bukti kurang atau berkonflik. Status terkonfirmasi menuntut dua sensor independen dan pelanggaran zona — analog operasional asas minimum pembuktian, bukan vonis.",
  },
  {
    no: "04",
    tanda: "Empat layar",
    judul: ["Satu sistem,", "empat sudut pandang."],
    isi: "Pusat Komando untuk analis, Patroli untuk lapangan, Konsol Skenario untuk memutar ulang investigasi, Portal Publik untuk agregat tanpa identitas. Satu aplikasi web; hasil pemeriksaan patroli kembali menjadi kalibrasi sistem, menutup siklusnya.",
  },
] as const;

export default async function Entry() {
  const chips = await chipPertama(1);
  const chip = chips[0] ?? null;

  return (
    <div className="cangkang">
      <a className="lewati" href="#hero">
        Lompat ke isi
      </a>

      <header className="pita pita--entry">
        <span className="merek">
          <span className="merek__glif" aria-hidden="true" />
          <span className="merek__nama">VARUNA</span>
        </span>
        {/* Anchor penuh, bukan Link: /enter/[role] adalah route handler yang
            memasang cookie peran lalu mengalihkan, jadi navigasi penuh yang
            tepat. Rute ini bukan page, aturan no-html-link-for-pages meleset. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="pita__cta" href="/enter/analis">
          Masuk sebagai analis <span aria-hidden="true">&rarr;</span>
        </a>
      </header>

      <main className="isi-entry" id="hero">
        {/* HERO terpusat — menjelaskan sistem sebelum digulir. */}
        <section className="wira" data-adegan="hero">
          <p className="wira__mata" data-gerak-masuk="">
            <span aria-hidden="true">◆</span> Intelijen maritim multi-agen
          </p>
          <h1 className="wira__judul">
            <span className="baris" data-gerak-masuk="">
              Kapal gelap mematikan AIS
            </span>{" "}
            <span className="baris" data-gerak-masuk="">
              biar tak terlihat.
            </span>{" "}
            <span className="baris baris--aksen" data-gerak-masuk="">
              Radar tetap melihat.
            </span>
          </h1>
          <p className="wira__sub" data-gerak-masuk="">
            VARUNA memfusikan deteksi radar Sentinel-1 dengan lintasan AIS menjadi satu berkas
            bukti. Statusnya dihitung server dari artefak nyata, bukan ditebak model — dan kalau
            bukti kurang, sistem menahan diri.
          </p>

          <div className="masuk" data-gerak-masuk="">
            <KartuPeran />
            <p className="masuk__nota">
              Tanpa login — satu klik memasang peran (cookie 12 jam). Menulis hanya boleh oleh peran
              yang berwenang.
            </p>
          </div>

          <dl className="buktimini" data-gerak-masuk="">
            {BUKTI.map((b) => (
              <div key={b.ket} className="buktimini__sel">
                <dt className="buktimini__angka">{b.angka}</dt>
                <dd className="buktimini__ket">{b.ket}</dd>
              </div>
            ))}
          </dl>
          <p className="buktimini__sumber">
            Sumber:{" "}
            <a href="https://github.com/Finerium/varuna/blob/main/manifests/e1-hasil.json">
              e1-hasil.json
            </a>{" "}
            &middot;{" "}
            <a href="https://github.com/Finerium/varuna/blob/main/manifests/e7-redteam.json">
              e7-redteam.json
            </a>{" "}
            &middot;{" "}
            <a href="https://github.com/Finerium/varuna/blob/main/manifests/e7-loo.json">
              e7-loo.json
            </a>
          </p>
        </section>

        {/* Momen tanda tangan: piksel radar sungguhan, diberi konteks. */}
        {chip ? (
          <section className="sorot" data-adegan="sorot" aria-label="Contoh deteksi radar">
            <div className="sorot__bingkai" data-gerak-masuk="">
              <ChipSar artefak={chip} />
              <span className="sorot__pita" aria-hidden="true" />
            </div>
            <div className="sorot__teks" data-gerak-masuk="">
              <p className="mata">Bukti, bukan ilustrasi</p>
              <p className="sorot__kalimat">
                Potongan band VH dari scene Sentinel-1 yang benar-benar diunduh. Penanda amber
                menandai pusat deteksi — sebuah lambung yang terlihat radar tanpa satu pun pesan
                AIS. Provenans tiap piksel dapat ditelusuri lewat <code>/api/artifacts</code>.
              </p>
            </div>
          </section>
        ) : null}

        {/* NARASI bernomor. */}
        <div className="narasi" data-adegan="narasi">
          {NARASI.map((n) => (
            <section key={n.no} className="bab" data-gerak-masuk="">
              <p className="bab__mata">
                <span className="bab__no">{n.no}</span> {n.tanda}
              </p>
              <h2 className="bab__judul">
                {n.judul.map((baris, i) => (
                  <span key={i} className="baris">
                    {baris}{" "}
                  </span>
                ))}
              </h2>
              <p className="bab__isi">{n.isi}</p>
            </section>
          ))}
        </div>

        {/* Tautan sebagai kartu, bukan daftar. */}
        <section className="jelajah" aria-label="Jelajahi">
          <Link className="jelajah__kartu" href="/komando">
            <span className="jelajah__nama">Pusat Komando</span>
            <span className="jelajah__ket">Antrean investigasi dan rantai buktinya.</span>
          </Link>
          <Link className="jelajah__kartu" href="/konsol">
            <span className="jelajah__nama">Konsol Skenario</span>
            <span className="jelajah__ket">
              Orkestrasi agen diputar ulang, langkah demi langkah.
            </span>
          </Link>
          <Link className="jelajah__kartu" href="/portal">
            <span className="jelajah__nama">Portal Publik</span>
            <span className="jelajah__ket">Agregat status per zona, tanpa identitas kapal.</span>
          </Link>
          <a
            className="jelajah__kartu jelajah__kartu--luar"
            href="https://github.com/Finerium/varuna"
            rel="noreferrer"
          >
            <span className="jelajah__nama">Repositori &amp; model</span>
            <span className="jelajah__ket">
              Kode, kontrak beku, manifest eksperimen, bobot di Hugging Face.
            </span>
          </a>
        </section>

        <p className="tandaraksasa" aria-hidden="true">
          VARUNA
        </p>
      </main>

      <footer className="kaki kaki--entry">
        <span>Tim Rajendra &middot; Politeknik Negeri Bandung</span>
        <span className="redup">
          Purwarupa penjurian Datathon 2026. Status dihitung server dan dapat diaudit; identitas
          kapal tidak pernah meninggalkan server dalam bentuk mentah. Seed 20260809.
        </span>
      </footer>

      <GerakEntry />
    </div>
  );
}

// "/" — Entry multi-persona. Register: paling ekspresif dari lima surface,
// tetapi keberaniannya dibelanjakan pada SATU elemen tanda tangan (blueprint 7.3):
// hero konten-nyata dari chip SAR asli beranotasi, bukan hero dekoratif.
// Tanpa pasangan tombol Get Started/Learn More, tanpa tiga kartu fitur sejajar:
// peran disusun sebagai roster tugas berirama.

import Link from "next/link";

import { GerakEntry } from "@/components/gerak";
import { ChipSar, Kosong } from "@/components/tampil";
import { pecahKata } from "@/lib/gerak";
import { chipPertama } from "@/lib/gudang";

export const dynamic = "force-dynamic";

const HERO = "Laut yang terlalu luas untuk dijaga mata, dibaca sebagai bukti yang bisa diperiksa.";

const PERAN_MASUK = [
  {
    href: "/enter/analis",
    nama: "Analis",
    ket: "Menilai antrean investigasi di Pusat Komando, membaca rantai bukti sampai ke artefak, dan memutuskan penerimaan berkas.",
  },
  {
    href: "/enter/patroli",
    nama: "Kru patroli",
    ket: "Menerima paket sasaran di laut sebagai area pencarian, lalu mengembalikan hasil pemeriksaan yang menutup siklus.",
  },
  {
    href: "/enter/publik",
    nama: "Publik",
    ket: "Membaca agregat status per zona di Portal, tanpa satu pun field identitas kapal.",
  },
] as const;

export default async function Entry() {
  const chips = await chipPertama(3);

  return (
    <div className="cangkang">
      <a className="lewati" href="#isi">
        Lompat ke isi
      </a>

      <header className="pita">
        <span className="pita__tanda">VARUNA</span>
        <p className="eyebrow">pengawasan maritim berbasis bukti</p>
      </header>

      <main className="isi tumpuk tumpuk--renggang" id="isi">
        <section className="tumpuk">
          {/* Hero dipecah per kata di server: markupnya final sebelum JS jalan,
              dan spasi tetap simpul teks di luar span supaya kalimat yang dibaca
              pembaca layar dan yang tersalin ke clipboard tidak berubah. */}
          <h1 className="ukur" data-adegan="hero">
            {pecahKata(HERO).map((kata, i) => (
              <span key={i}>
                <span className="kata" data-gerak-masuk="">
                  {kata}
                </span>{" "}
              </span>
            ))}
          </h1>
          <div className="tumpuk tumpuk--rapat ukur" data-adegan="pengantar" data-gerak-masuk="">
            <p>
              Perairan Indonesia seluas 6,4 juta kilometer persegi harus diawasi dengan kapasitas
              patroli yang menyusut, sehingga sebagian besar laut tidak pernah benar-benar dilihat.
            </p>
            <p>
              VARUNA memfusikan deteksi radar SAR dengan lintasan AIS menjadi satu berkas bukti, dan
              status berkas itu dihitung oleh server dari artefak yang ada, bukan disimpulkan oleh
              model.
            </p>
            <p>
              Kebaruannya ada pada dua hal: berkas disusun mengikuti kebutuhan hukum acara
              Indonesia, dan siklus patroli ditutup karena hasil pemeriksaan di laut kembali menjadi
              kalibrasi sistem.
            </p>
          </div>
        </section>

        {/* Elemen tanda tangan Entry: piksel radar sungguhan dari Evidence Store. */}
        <section
          className="panel panel--rim panel--pijar tumpuk"
          aria-labelledby="bukti"
          data-adegan="chip"
        >
          {/* Rim glass yang menyala pelan saat panel masuk viewport. Lapisan
              terpisah karena hanya opacity yang boleh bergerak; border dan
              filter tidak. Dekorasi murni: tanpa gerak ia tidak pernah menyala
              dan tidak ada isi yang hilang. */}
          <span className="pijar" aria-hidden="true" />
          <div className="panel__kepala">
            <h2 id="bukti">Bukti, bukan ilustrasi</h2>
            <p className="eyebrow">chip SAR dari Evidence Store</p>
          </div>
          {chips.length === 0 ? (
            <Kosong
              kalimat="Belum ada chip SAR pada Evidence Store."
              sebab="Bingkai ini diisi piksel radar sungguhan begitu kurasi golden set menulis chip pertamanya. Tidak ada gambar pengganti yang dipasang di sini."
            />
          ) : (
            <>
              <div className="deret" style={{ alignItems: "flex-start" }}>
                {chips.map((a) => (
                  <div
                    key={a.art_id}
                    style={{ flex: "1 1 200px", maxWidth: 280 }}
                    data-gerak-masuk=""
                  >
                    <ChipSar artefak={a} />
                  </div>
                ))}
              </div>
              <p className="redup ukur" style={{ fontSize: "0.86rem" }}>
                Setiap chip adalah potongan band VH dari scene yang benar-benar diunduh, ditampilkan
                grayscale asli dengan satu penanda amber pada pusat deteksi. Provenans lengkap tiap
                artefak tersedia lewat <code>/api/artifacts/&lt;art_id&gt;</code>.
              </p>
            </>
          )}
        </section>

        <section className="tumpuk" aria-labelledby="peran">
          <h2 id="peran">Masuk sebagai</h2>
          <div className="roster" data-adegan="roster">
            {PERAN_MASUK.map((p) => (
              // Anchor biasa, bukan Link: rute ini memasang cookie peran lalu
              // mengalihkan; navigasi penuh yang tepat untuk itu.
              <a key={p.href} className="roster__peran" href={p.href} data-gerak-masuk="">
                <span className="roster__nama">{p.nama}</span>
                <span className="roster__tanda" aria-hidden="true">
                  &rarr;
                </span>
                <span className="roster__ket">{p.ket}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="tumpuk tumpuk--rapat" aria-labelledby="tautan">
          <h2 id="tautan">Tautan</h2>
          <ul className="tumpuk tumpuk--rapat" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li>
              <Link href="/konsol">Konsol Skenario</Link> &mdash; jalannya orkestrasi agen, langkah
              demi langkah.
            </li>
            <li>
              <Link href="/portal">Portal publik</Link> &mdash; agregat status per zona.
            </li>
            <li>
              <a href="https://github.com/Finerium/varuna" rel="noreferrer">
                Repositori Finerium/varuna
              </a>{" "}
              &mdash; kode, kontrak beku, dan manifest eksperimen.
            </li>
            <li>
              <a href="https://huggingface.co/Finerium" rel="noreferrer">
                Hugging Face Finerium
              </a>{" "}
              &mdash; artefak model dan data yang boleh dibagikan.
            </li>
            <li className="redup">
              Paper semifinal &mdash; belum terbit. Tautannya sengaja dikosongkan daripada menunjuk
              alamat yang tidak ada.
            </li>
          </ul>
        </section>
      </main>

      <footer className="kaki">
        Seed global 20260809. Status berkas dihitung server dan dapat diaudit; identitas kapal tidak
        pernah meninggalkan server dalam bentuk mentah.
      </footer>

      {/* Tidak merender apa pun; menempelkan timeline pada data-adegan di atas. */}
      <GerakEntry />
    </div>
  );
}

// Patroli (peran patroli). Register: taktil tegas, umpan balik sentuh percaya
// diri (blueprint 7.4). Dibangun sebagai aplikasi mobile dan disajikan di
// desktop DI DALAM phone frame; penuh tanpa frame di perangkat mobile
// (blueprint 7.5) — pembedaannya CSS murni, jadi interaksinya identik.

import { KUNCI_PAKET, paketTerkini } from "@varuna/core/runtime";

import { Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { Peta } from "@/components/peta";
import { bacaRuntime } from "@/lib/gudang";

import "./patroli.css";

export const dynamic = "force-dynamic";

/** Kosakata BEKU FindingSchema (contracts.md Bagian 1) ditampilkan apa adanya di
 *  sebelah label Indonesianya: kru melihat kata yang sungguh masuk ke artefak
 *  patrol_report, bukan terjemahan bebas yang bisa menyimpang dari kontrak. */
const HASIL = [
  { nilai: "sesuai", nama: "Sesuai" },
  { nilai: "berbeda", nama: "Berbeda" },
  { nilai: "tidak_ditemukan", nama: "Tidak ditemukan" },
  { nilai: "tidak_terjangkau", nama: "Tidak terjangkau" },
] as const;

/** Stempel ISO ditampilkan apa adanya, tanpa konversi zona di peramban: yang
 *  terbaca kru harus sama persis dengan yang tercatat pada paket. Spasi sebelum
 *  penanda zona tidak dapat dipatahkan, supaya "UTC" tidak pernah tertinggal
 *  sendirian di baris berikutnya pada kolom selebar layar telepon. */
const jam = (iso: string) => {
  const zona = /(Z|[+-]\d{2}:\d{2})$/.exec(iso)?.[1] ?? "";
  return `${iso.slice(0, 16).replace("T", " ")}\u00a0${zona === "Z" ? "UTC" : zona}`;
};

export default async function Patroli() {
  // Sumber yang sama dengan GET /api/patrol/packages, dibaca langsung karena
  // halaman ini server component. Poligon area TIDAK dihitung di sini: server
  // yang mencetaknya (runtime.ts areaPencarian), peta hanya menggambar.
  const paket = paketTerkini(await bacaRuntime(KUNCI_PAKET).catch(() => []));

  return (
    <Cangkang aktif="/patroli" register="Paket sasaran di laut dan hasil pemeriksaannya">
      <div className="ptr-panggung">
        {/* Kolom editorial: menjelaskan apa yang sedang dilihat juri sebelum
            layar kru bicara sendiri. Angkanya satu, dan datang dari daftar
            paket yang sungguh dibaca — nol pun ditampilkan apa adanya. */}
        <section className="ptr-narasi" aria-labelledby="ptr-judul">
          <p className="ptr-mata">
            <span aria-hidden="true">◆</span> Aplikasi lapangan
          </p>
          <h2 className="ptr-judul" id="ptr-judul">
            Penugasan yang dibawa <span className="ptr-judul__aksen">ke air.</span>
          </h2>
          <p className="ptr-lead">
            Layar ini sama dengan yang dipegang kru di dek: area pencarian sebagai poligon, dan
            paket sasaran beserta dasar hitungannya. Paket dicetak server saat analis menerima
            sebuah berkas; halaman ini hanya membacanya.
          </p>

          <div className="ptr-angka">
            <p className="ptr-angka__nilai">{paket.length}</p>
            <p className="ptr-angka__ket">paket sasaran aktif</p>
          </div>

          <p className="ptr-nota ptr-narasi__nota">
            Di desktop layarnya dibingkai telepon, di perangkat mobile ia memenuhi layar.
            Pembedaannya CSS murni, jadi tidak ada satu pun interaksi yang berbeda di antara
            keduanya.
          </p>
        </section>

        <div className="ptr-telepon">
          <div className="ptr-layar">
            <span className="ptr-notch" aria-hidden="true" />

            <div className="ptr-gulir">
              <section className="ptr-blok" aria-labelledby="ptr-sasaran">
                <div className="ptr-kepala">
                  <p className="ptr-mata">
                    <span aria-hidden="true">◆</span> Penugasan
                  </p>
                  <h3 className="ptr-kepala__judul" id="ptr-sasaran">
                    Paket sasaran
                  </h3>
                  <p className="ptr-kepala__hitung">{paket.length} paket aktif</p>
                </div>

                <div className="ptr-peta">
                  <Peta
                    label={
                      paket.length === 0
                        ? "Peta area operasi ZEE-ID subset Natuna. Belum ada area pencarian yang digambar."
                        : `Peta area operasi dengan ${paket.length} area pencarian sebagai poligon garis putus-putus.`
                    }
                    zona={["natuna"]}
                    area={paket.map((p) => ({
                      id: p.package_id,
                      cincin: p.geometri.coordinates,
                      judul: `${p.package_id}: ${p.label}, radius ${p.area.radius_km.toFixed(1)} km`,
                    }))}
                    // Layar Patroli selebar 330 px: viewBox yang lebih sempit
                    // membuat ukuran tampak garis dan label sama dengan panel
                    // lebar Komando.
                    lebar={440}
                    catatan={
                      paket.length === 0
                        ? "Belum ada area pencarian pada peta ini."
                        : "Batas putus-putus: area pencarian, bukan posisi pasti."
                    }
                  />
                </div>

                {/* Daftar paket lahir dari aksi validasi analis. Selama belum ada satu
                    pun yang tercetak, menampilkan daftar kosong saja akan berbohong:
                    kosong berarti "belum ada penugasan", bukan "mesinnya belum ada".
                    Keduanya dinyatakan. */}
                {paket.length === 0 ? (
                  <Kosong
                    kalimat="Belum ada penugasan."
                    sebab="Paket sasaran hanya dicetak server saat analis menerima sebuah berkas; belum ada satu pun yang tercetak, jadi peta di atas baru memuat geometri zona."
                  />
                ) : (
                  <ol className="ptr-daftar">
                    {paket.map((p, i) => (
                      <li key={p.package_id} className="ptr-kartu">
                        <div className="ptr-kartu__kepala">
                          <p className="ptr-kartu__id">
                            <span className="ptr-kartu__no" aria-hidden="true">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            {p.package_id}
                          </p>
                          {/* Status kontak disalin dari status_tingkat yang
                              dicetak server; halaman tidak menghitungnya. */}
                          <Status status={p.status_tingkat} />
                        </div>

                        <p className="ptr-label">{p.label}</p>

                        <dl className="ptr-meta">
                          <div>
                            <dt className="ptr-meta__k">Usia bukti</dt>
                            <dd className="ptr-meta__v">
                              {p.dasar.jam_sejak_observasi.toFixed(1)} jam
                            </dd>
                          </div>
                          <div>
                            <dt className="ptr-meta__k">Radius</dt>
                            <dd className="ptr-meta__v">
                              {p.area.radius_km.toFixed(1)} km
                              {p.dasar.radius_dipotong ? " (plafon)" : ""}
                            </dd>
                          </div>
                          <div>
                            <dt className="ptr-meta__k">Zona</dt>
                            <dd className="ptr-meta__v">
                              {p.area.zona_clip ?? "tanpa potongan zona"}
                            </dd>
                          </div>
                          <div>
                            <dt className="ptr-meta__k">Berlaku sampai</dt>
                            <dd className="ptr-meta__v">{jam(p.expires_at)}</dd>
                          </div>
                        </dl>

                        <a className="ptr-tautan" href={`/api/artifacts/${p.dasar.art_id}`}>
                          Artefak dasar {p.dasar.art_id}
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="ptr-blok">
                <fieldset className="ptr-set" disabled>
                  <legend className="ptr-legenda">
                    Kirim hasil pemeriksaan <span className="ptr-tanda">ditutup</span>
                  </legend>
                  {HASIL.map((h) => (
                    <button
                      key={h.nilai}
                      className={`ptr-tombol${h.nilai === "sesuai" ? " ptr-tombol--utama" : ""}`}
                      type="button"
                    >
                      <span className="ptr-tombol__nama">{h.nama}</span>
                      <span className="ptr-tombol__nilai">{h.nilai}</span>
                    </button>
                  ))}
                </fieldset>
                <p className="ptr-nota">
                  Jalur tulisnya sendiri hidup: <code>POST /api/patrol/results</code> menegakkan
                  peran patroli, menyaring diksi, menolak pola identitas (MMSI, callsign, awalan
                  nama kapal), lalu menulis artefak <code>patrol_report</code> ber-hash ke rantai
                  bukti. Yang belum terpasang adalah formulir di layar ini; selama itu tombolnya
                  ditutup daripada menampung ketukan yang tidak sampai ke mana-mana. Buktinya:{" "}
                  <code>POST /api/patrol/results</code> tanpa peran &rarr; 403, peran salah &rarr;
                  403, paket tak dikenal &rarr; 404, catatan ber-diksi putusan &rarr; 422.
                </p>
              </section>
            </div>

            <span className="ptr-tumpuan" aria-hidden="true" />
          </div>
        </div>
      </div>
    </Cangkang>
  );
}

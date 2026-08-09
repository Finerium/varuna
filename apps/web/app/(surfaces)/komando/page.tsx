// Pusat Komando (peran analis). Register: tertahan dan cepat, informasi dulu
// (blueprint 7.4). Elemen tanda tangan: peta kandidat dan antrean di satu
// kolom, berkas terbuka melekat di kolom sebelahnya — rantai bukti membuka
// berlapis, ABSTAIN dua klik dari antrean (matriks kontrak Bagian 8).
//
// Halaman ini TIDAK menghitung status apa pun: setiap suar, angka, dan warna
// disalin dari status_server (VAR-SRF-03). Yang kosong dinyatakan kosong.

import Link from "next/link";

import type { InvestigationSummary } from "@varuna/core/schemas";

import { AlasanAbstain, Keadaan, Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { Peta, type TitikKandidat } from "@/components/peta";
import { ambilInvestigasi, daftarInvestigasi, ringkas } from "@/lib/gudang";

import "./komando.css";

export const dynamic = "force-dynamic";

/** Desimal gaya Indonesia. Angkanya tetap milik server, hanya pemisahnya lokal. */
const jam = (h: number) => `${h.toFixed(1).replace(".", ",")} jam`;

/** ISO dipangkas ke menit dan TETAP UTC — tidak digeser ke zona waktu peramban,
 *  supaya yang terbaca sama dengan yang tersimpan. Zonanya dinyatakan di label
 *  pemanggil, bukan diikutkan ke nilai (kolom sempit memutusnya di tengah). */
const waktu = (iso: string) => iso.slice(0, 16).replace("T", " ");

const derajat = (d: number) => d.toFixed(3).replace(".", ",");

export default async function Komando({
  searchParams,
}: {
  searchParams: Promise<{ inv?: string }>;
}) {
  const { inv: dipilih } = await searchParams;
  const semua = await daftarInvestigasi();
  const antrean = semua.map(ringkas);
  const terbuka = dipilih === undefined ? null : await ambilInvestigasi(dipilih);

  // Posisi peta datang dari `candidate` investigasi — sumber yang sama yang
  // dibaca /api/queue, dibaca langsung karena halaman ini server component
  // (memanggil API sendiri lewat HTTP hanya menambah satu perjalanan jaringan
  // untuk data yang sudah ada di memori). Frontend tetap tidak menghitung apa
  // pun: status yang mewarnai titik disalin dari status_server.
  const titik: TitikKandidat[] = semua.map((i) => ({
    inv_id: i.inv_id,
    lat: i.candidate.lat,
    lon: i.candidate.lon,
    status: i.status_server.status,
    href: `/komando?inv=${encodeURIComponent(i.inv_id)}`,
  }));

  // Menghitung ISI antrean, bukan status: tiap baris sudah membawa putusan
  // servernya sendiri, di sini hanya dijumlahkan berapa yang membawa putusan itu.
  const banyak = (s: InvestigationSummary["status"]) =>
    antrean.filter((a) => a.status === s).length;

  const angka = [
    { nilai: antrean.length, ket: "investigasi", varian: "" },
    { nilai: banyak("terkonfirmasi"), ket: "terkonfirmasi", varian: "--terkonfirmasi" },
    { nilai: banyak("terindikasi"), ket: "terindikasi", varian: "--terindikasi" },
    { nilai: banyak("abstain"), ket: "ABSTAIN", varian: "--abstain" },
  ];

  return (
    <Cangkang aktif="/komando" register="Antrean investigasi dan rantai buktinya">
      <div className="kmd">
        <header className="kmd-kepala">
          <p className="kmd-mata">
            <span className="kmd-mata__glif" aria-hidden="true">
              ◆
            </span>{" "}
            Pusat Komando &middot; peran analis
          </p>
          <h1 className="kmd-judul">
            Setiap baris membawa <span className="kmd-judul__aksen">rantai buktinya sendiri.</span>
          </h1>
          <p className="kmd-sub">
            Antrean dibaca langsung dari Evidence Store. Status tiap baris disalin dari{" "}
            <code>status_server</code> — halaman ini tidak menghitungnya — dan berkas yang dibuka
            menampilkan artefak yang mendasarinya, termasuk saat bukti kurang dan sistem menahan
            diri pada ABSTAIN.
          </p>
          <dl className="kmd-angka">
            {angka.map((a) => (
              <div key={a.ket} className="kmd-angka__sel">
                <dt
                  className={`kmd-angka__nilai${
                    a.varian === "" ? "" : ` kmd-angka__nilai${a.varian}`
                  }`}
                >
                  {a.nilai}
                </dt>
                <dd className="kmd-angka__ket">{a.ket}</dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="kmd-papan">
          <div className="kmd-kolom">
            {titik.length > 0 && (
              <section className="kmd-panel kmd-panel--rim" aria-labelledby="peta">
                <div className="kmd-panel__kepala">
                  <div>
                    <p className="kmd-mata-kecil">Sebaran kandidat</p>
                    <h2 id="peta" className="kmd-panel__judul">
                      Peta kandidat
                    </h2>
                  </div>
                  <p className="kmd-hitung">{titik.length} posisi</p>
                </div>
                <Peta
                  label={`Peta kandidat: ${titik.length} posisi investigasi di atas geometri ZEE Indonesia. Tautan yang sama tersedia sebagai daftar Antrean di bawah peta.`}
                  zona={["nasional", "natuna"]}
                  titik={titik}
                  dipilih={dipilih ?? null}
                />
              </section>
            )}

            <section className="kmd-panel" aria-labelledby="antrean">
              <div className="kmd-panel__kepala">
                <div>
                  <p className="kmd-mata-kecil">Menunggu pemeriksaan</p>
                  <h2 id="antrean" className="kmd-panel__judul">
                    Antrean
                  </h2>
                </div>
                <p className="kmd-hitung">{antrean.length} investigasi</p>
              </div>

              {antrean.length === 0 ? (
                <Kosong
                  kalimat="Tidak ada lintasan pada rentang ini."
                  sebab="Evidence Store belum memuat investigasi yang lengkap. Antrean akan terisi sendiri begitu kurasi golden set menulis berkas investigasinya."
                />
              ) : (
                <div className="kmd-antrean">
                  {antrean.map((s) => (
                    <article
                      key={s.inv_id}
                      className={`kmd-kartu${s.inv_id === dipilih ? " kmd-kartu--pilih" : ""}`}
                    >
                      <div className="kmd-kartu__atas">
                        <Link
                          className="kmd-kartu__id"
                          href={{ pathname: "/komando", query: { inv: s.inv_id } }}
                          aria-current={s.inv_id === dipilih ? "true" : undefined}
                        >
                          {s.inv_id}
                        </Link>
                        <span className="kmd-kartu__sinyal">
                          <Status status={s.status} />
                          <Keadaan daftar={s.display_state} />
                        </span>
                      </div>
                      <dl className="kmd-meta">
                        <div className="kmd-sel">
                          <dt className="kmd-ket">AOI</dt>
                          <dd className="kmd-nilai">{s.aoi}</dd>
                        </div>
                        <div className="kmd-sel">
                          <dt className="kmd-ket">Zona</dt>
                          <dd className="kmd-nilai">{s.zona ?? "tanpa zona"}</dd>
                        </div>
                        <div className="kmd-sel">
                          <dt className="kmd-ket">Kasus</dt>
                          <dd className="kmd-nilai">{s.kasus_label ?? "tanpa label"}</dd>
                        </div>
                        <div className="kmd-sel">
                          <dt className="kmd-ket">Modalitas</dt>
                          <dd className="kmd-nilai">{s.sensors_independent} independen</dd>
                        </div>
                        <div className="kmd-sel">
                          <dt className="kmd-ket">Usia bukti</dt>
                          <dd className="kmd-nilai">{jam(s.evidence_age_h)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="kmd-panel kmd-panel--rim kmd-samping" aria-labelledby="berkas">
            <div className="kmd-panel__kepala">
              <div>
                <p className="kmd-mata-kecil">Rantai bukti</p>
                <h2 id="berkas" className="kmd-panel__judul">
                  Berkas terbuka
                </h2>
              </div>
              {terbuka !== null && <Status status={terbuka.status_server.status} />}
            </div>

            {terbuka === null ? (
              <Kosong
                kalimat={
                  dipilih === undefined
                    ? "Belum ada berkas yang dibuka."
                    : `Investigasi ${dipilih} tidak ada pada Evidence Store.`
                }
                sebab={
                  dipilih === undefined
                    ? "Pilih satu kartu antrean atau satu titik peta untuk membuka rantai buktinya."
                    : undefined
                }
              />
            ) : (
              <div className="kmd-berkas">
                <p className="kmd-berkas__id">{terbuka.inv_id}</p>

                <dl className="kmd-fakta">
                  <div className="kmd-sel">
                    <dt className="kmd-ket">AOI</dt>
                    <dd className="kmd-nilai">{terbuka.aoi}</dd>
                  </div>
                  <div className="kmd-sel">
                    <dt className="kmd-ket">Zona</dt>
                    <dd className="kmd-nilai">{terbuka.zona ?? "tanpa zona"}</dd>
                  </div>
                  <div className="kmd-sel">
                    <dt className="kmd-ket">Split</dt>
                    <dd className="kmd-nilai">{terbuka.split}</dd>
                  </div>
                  <div className="kmd-sel">
                    <dt className="kmd-ket">Modalitas</dt>
                    <dd className="kmd-nilai">
                      {terbuka.status_server.sensors_independent} independen
                    </dd>
                  </div>
                  <div className="kmd-sel">
                    <dt className="kmd-ket">Usia bukti</dt>
                    <dd className="kmd-nilai">{jam(terbuka.status_server.evidence_age_h)}</dd>
                  </div>
                  <div className="kmd-sel">
                    <dt className="kmd-ket">Posisi kandidat</dt>
                    <dd className="kmd-nilai">
                      {derajat(terbuka.candidate.lat)} lintang &middot;{" "}
                      {derajat(terbuka.candidate.lon)} bujur
                    </dd>
                  </div>
                  <div className="kmd-sel">
                    <dt className="kmd-ket">Observasi terakhir (UTC)</dt>
                    <dd className="kmd-nilai">{waktu(terbuka.t_observasi_terakhir)}</dd>
                  </div>
                </dl>

                {/* Alasan ABSTAIN hidup dari status_server.abstain_reason; kalau
                    null, seluruh bloknya memang tidak ada. */}
                {terbuka.status_server.abstain_reason !== null && (
                  <div className="kmd-abstain">
                    <p className="kmd-mata-kecil">Kenapa menahan diri</p>
                    <AlasanAbstain status={terbuka.status_server} />
                  </div>
                )}

                <div className="kmd-bagian">
                  <p className="kmd-mata-kecil">
                    Artefak terdaftar &middot; {terbuka.artifacts.length}
                  </p>
                  {terbuka.artifacts.length === 0 ? (
                    <p className="kmd-tolak__sebab">
                      Investigasi ini belum mendaftarkan satu pun artefak.
                    </p>
                  ) : (
                    <ul className="kmd-chips">
                      {terbuka.artifacts.map((id) => (
                        <li key={id}>
                          <a className="kmd-chip" href={`/api/artifacts/${id}`}>
                            {id}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="kmd-bagian">
                  <p className="kmd-mata-kecil">
                    Aturan yang dijalankan server &middot; {terbuka.status_server.reasons.length}
                  </p>
                  <ul className="kmd-aturan">
                    {terbuka.status_server.reasons.map((r) => (
                      <li
                        key={r.rule}
                        className={`kmd-aturan__baris kmd-aturan__baris--${r.passed ? "ya" : "tidak"}`}
                      >
                        <span className="kmd-aturan__suar" aria-hidden="true" />
                        <span className="kmd-aturan__nama">{r.rule}</span>
                        <span className="kmd-aturan__kanan">
                          <span className="kmd-aturan__kata">
                            {r.passed ? "terpenuhi" : "belum"}
                          </span>
                          <span className="kmd-aturan__artefak">
                            {r.art_ids.length === 0
                              ? "tanpa artefak"
                              : `${r.art_ids.length} artefak`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Rantai bukti berlapis: klaim di permukaan, artefak sebagai
                    lapisan yang dibuka pembaca sendiri (<details> native). */}
                <div className="kmd-bagian">
                  <p className="kmd-mata-kecil">Klaim dan artefak pendukung</p>
                  {terbuka.berkas === null ? (
                    /* ATURAN GROUNDING Bagian 1: satu art_id tak-resolvable
                       menolak SELURUH berkas. Penolakan tampil apa adanya. */
                    <div className="kmd-tolak">
                      <p className="kmd-tolak__mata">Penolakan grounding</p>
                      <p className="kmd-tolak__kalimat">Berkas ini ditolak dari tampilan.</p>
                      {terbuka.berkas_ditolak !== null && (
                        <p className="kmd-tolak__sebab">{terbuka.berkas_ditolak.alasan}</p>
                      )}
                    </div>
                  ) : terbuka.berkas.sections.length === 0 ? (
                    <Kosong kalimat="Berkas ini belum punya klaim tersusun." />
                  ) : (
                    <div>
                      {terbuka.berkas.sections.map((s, i) => (
                        <details key={i} className="kmd-klaim">
                          <summary className="kmd-klaim__ringkas">
                            <span className="kmd-klaim__no">{String(i + 1).padStart(2, "0")}</span>
                            <span>{s.claim}</span>
                          </summary>
                          <ul className="kmd-chips kmd-klaim__isi">
                            {s.art_ids.map((id) => (
                              <li key={id}>
                                <a className="kmd-chip" href={`/api/artifacts/${id}`}>
                                  {id}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </div>
                  )}
                </div>

                <div className="kmd-jejak">
                  <span>hash status_server: {terbuka.status_server.hash}</span>
                  <span>dihitung {waktu(terbuka.status_server.computed_at)} UTC</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Cangkang>
  );
}

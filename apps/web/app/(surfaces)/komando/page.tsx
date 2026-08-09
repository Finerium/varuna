// Pusat Komando (peran analis). Register: tertahan dan cepat, informasi dulu
// (blueprint 7.4). Elemen tanda tangan: panel rantai bukti yang membuka
// berlapis — antrean di kiri, berkas terbuka di kanan, ABSTAIN dua klik dari
// antrean (matriks kontrak Bagian 8).

import Link from "next/link";

import { AlasanAbstain, Keadaan, Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { ambilInvestigasi, daftarInvestigasi, ringkas } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export default async function Komando({
  searchParams,
}: {
  searchParams: Promise<{ inv?: string }>;
}) {
  const { inv: dipilih } = await searchParams;
  const antrean = (await daftarInvestigasi()).map(ringkas);
  const terbuka = dipilih === undefined ? null : await ambilInvestigasi(dipilih);

  return (
    <Cangkang aktif="/komando" register="Antrean investigasi dan rantai buktinya">
      <div className="papan">
        <section className="panel tumpuk" aria-labelledby="antrean">
          <div className="panel__kepala">
            <h2 id="antrean">Antrean</h2>
            <p className="eyebrow">{antrean.length} investigasi</p>
          </div>

          {antrean.length === 0 ? (
            <Kosong
              kalimat="Tidak ada lintasan pada rentang ini."
              sebab="Evidence Store belum memuat investigasi yang lengkap. Antrean akan terisi sendiri begitu kurasi golden set menulis berkas investigasinya."
            />
          ) : (
            <div>
              {antrean.map((s) => (
                <article className="baris" key={s.inv_id}>
                  <div className="tumpuk tumpuk--rapat">
                    <Link
                      className="baris__utama"
                      href={{ pathname: "/komando", query: { inv: s.inv_id } }}
                      aria-current={s.inv_id === dipilih ? "true" : undefined}
                    >
                      {s.inv_id}
                    </Link>
                    <p className="baris__meta">
                      <span>{s.aoi}</span>
                      <span>{s.zona ?? "tanpa zona"}</span>
                      <span>{s.kasus_label ?? "tanpa label kasus"}</span>
                      <span>{s.sensors_independent} modalitas independen</span>
                      <span>usia bukti {s.evidence_age_h.toFixed(1)} jam</span>
                    </p>
                  </div>
                  <div className="deret" style={{ gap: "var(--r-2)" }}>
                    <Status status={s.status} />
                    <Keadaan daftar={s.display_state} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel panel--rim tumpuk" aria-labelledby="berkas">
          <div className="panel__kepala">
            <h2 id="berkas">Berkas</h2>
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
                  ? "Pilih satu baris antrean untuk membuka rantai buktinya."
                  : undefined
              }
            />
          ) : (
            <div className="tumpuk">
              <AlasanAbstain status={terbuka.status_server} />

              <div className="gulir-x">
                <table className="tabel">
                  <caption
                    className="eyebrow"
                    style={{ textAlign: "left", paddingBottom: "var(--r-2)" }}
                  >
                    Aturan yang dijalankan server
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Aturan</th>
                      <th scope="col">Terpenuhi</th>
                      <th scope="col">Artefak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terbuka.status_server.reasons.map((r) => (
                      <tr key={r.rule}>
                        <th scope="row" style={{ textTransform: "none", letterSpacing: 0 }}>
                          {r.rule}
                        </th>
                        <td>{r.passed ? "ya" : "tidak"}</td>
                        <td className="redup">{r.art_ids.length === 0 ? "—" : r.art_ids.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Rantai bukti berlapis: klaim di permukaan, artefak sebagai
                  lapisan yang dibuka pembaca sendiri (<details> native). */}
              <div className="tumpuk tumpuk--rapat">
                <p className="eyebrow">Klaim dan artefak pendukung</p>
                {terbuka.berkas === null ? (
                  /* ATURAN GROUNDING Bagian 1: satu art_id tak-resolvable
                     menolak SELURUH berkas. Penolakan tampil apa adanya. */
                  <Kosong
                    kalimat="Berkas ini ditolak dari tampilan."
                    sebab={terbuka.berkas_ditolak?.alasan}
                  />
                ) : terbuka.berkas.sections.length === 0 ? (
                  <Kosong kalimat="Berkas ini belum punya klaim tersusun." />
                ) : (
                  terbuka.berkas.sections.map((s, i) => (
                    <details key={i} className="panel" style={{ padding: "var(--r-2) var(--r-3)" }}>
                      <summary style={{ cursor: "pointer" }}>{s.claim}</summary>
                      <ul className="tumpuk tumpuk--rapat" style={{ paddingLeft: "1.1rem" }}>
                        {s.art_ids.map((id) => (
                          <li key={id}>
                            <a href={`/api/artifacts/${id}`}>{id}</a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))
                )}
              </div>

              <p className="redup" style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>
                hash status_server: {terbuka.status_server.hash}
              </p>
            </div>
          )}
        </section>
      </div>
    </Cangkang>
  );
}

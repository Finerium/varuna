// Portal publik (peran publik). Register: tenang dan berwibawa — halaman data
// editorial, bukan dasbor. Isinya angka agregat: nol field identitas.
//
// Sumber angka sama persis dengan /api/public/aggregate (lib/agregat.ts), jadi
// halaman dan API tidak bisa menyimpang. Yang dikerjakan berkas ini hanya
// MENJUMLAHKAN cacah yang sudah diputus server; status tidak pernah dihitung di
// frontend.

import { GerakPortal } from "@/components/gerak";
import { Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { KUNCI_TANPA_ZONA, POLA_PERIODE, hitungAgregat, periodeTersedia } from "@/lib/agregat";

import "./portal.css";

export const dynamic = "force-dynamic";

const URUT_STATUS = ["terkonfirmasi", "terindikasi", "abstain"] as const;

/** Angka yang boleh dihitung naik. Nilainya dirender server; `data-angka` hanya
 *  menandai elemen yang isinya bilangan bulat polos, sehingga count-up
 *  (components/gerak.tsx) bisa memulihkannya persis. `data-gerak-masuk` hanya
 *  dipasang bersama `data-angka`: di Portal, satu-satunya yang membatalkan
 *  pra-sembunyi CSS adalah timeline count-up itu. */
function Angka({ n, kelas }: { n: number; kelas: string }) {
  return (
    <span className={kelas} data-angka="" data-gerak-masuk="">
      {n}
    </span>
  );
}

export default async function Portal({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const sah = period !== undefined && POLA_PERIODE.test(period) ? period : null;
  const agregat = await hitungAgregat(sah);
  const periode = await periodeTersedia();

  const totalStatus = URUT_STATUS.map((s) => ({
    status: s,
    n: Object.values(agregat.counts[s] ?? {}).reduce((a, b) => a + b, 0),
  }));
  const total = totalStatus.reduce((a, b) => a + b.n, 0);

  // Zona teramai di atas; seri diputus alfabetis supaya urutannya stabil antar
  // permintaan. Sebuah kunci zona hanya ada kalau sungguh dicacah, jadi tidak
  // ada baris berisi nol total.
  const zona = [...new Set(Object.values(agregat.counts).flatMap((per) => Object.keys(per)))]
    .map((z) => {
      const per = URUT_STATUS.map((s) => ({ status: s, n: agregat.counts[s]?.[z] ?? 0 }));
      return { z, per, n: per.reduce((a, b) => a + b.n, 0) };
    })
    .sort((a, b) => b.n - a.n || a.z.localeCompare(b.z));

  return (
    <Cangkang aktif="/portal" register="Agregat status per zona, tanpa identitas kapal">
      <div className="prt">
        <section className="prt-wira">
          <p className="prt-mata">
            <span aria-hidden="true">◆</span> Data publik &middot; periode {agregat.periode}
          </p>
          <h1 className="prt-judul">
            Angka boleh keluar. <span className="prt-judul__aksen">Identitas tidak.</span>
          </h1>
          <p className="prt-sub">
            Portal ini membuka cacah status per zona dari Evidence Store yang sama dengan yang
            dibaca analis. Yang keluar hanya angka: tidak ada nomor investigasi, tidak ada hash
            MMSI, tidak ada koordinat. Statusnya sendiri diputus server dari artefak, bukan
            disimpulkan ulang di halaman ini.
          </p>

          {/* Pemilih native: GET form, tanpa JavaScript, dan hanya berisi
              periode yang sungguh diwakili Evidence Store. */}
          <form className="prt-kontrol" method="get" action="/portal">
            <label htmlFor="period" className="eyebrow">
              Pilih periode
            </label>
            <select
              id="period"
              name="period"
              defaultValue={sah ?? ""}
              className="taktil"
              style={{ appearance: "auto" }}
            >
              <option value="">semua</option>
              {periode.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button className="taktil" type="submit">
              Terapkan
            </button>
          </form>
          <p className="prt-cap">diperbarui {agregat.updated_at}</p>
        </section>

        {/* Angka agregat besar. Cacah per status dijumlahkan dari matriks yang
            sama yang dilayani API — tidak ada angka kedua yang dihitung
            terpisah. */}
        <section className="prt-angka" aria-labelledby="prt-total-ket">
          <div className="prt-total">
            <h2 className="prt-total__ket" id="prt-total-ket">
              berkas investigasi &middot; periode {agregat.periode}
            </h2>
            <p>
              <Angka n={total} kelas="prt-total__n" />
            </p>
          </div>

          <dl className="prt-pecah">
            {totalStatus.map((t) => (
              <div key={t.status} className="prt-sel">
                <dt>
                  <Status status={t.status} />
                </dt>
                <dd>
                  <Angka n={t.n} kelas="prt-sel__n" />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Garis pemisah: diam-nya penuh, tumbuh dari kiri hanya kalau gerak
            hidup. Tanpa gerak ia tetap tergambar utuh. */}
        <span className="garis" aria-hidden="true" data-garis="" />

        <section aria-labelledby="prt-zona-judul">
          <div className="prt-kepala">
            <h2 className="prt-kepala__judul" id="prt-zona-judul">
              Rincian per zona
            </h2>
            <p className="eyebrow">
              {zona.length === 0 ? "tidak ada zona terwakili" : `${zona.length} zona terwakili`}
            </p>
          </div>

          {zona.length === 0 ? (
            <div className="prt-kosong">
              <Kosong
                kalimat="Periode tanpa data."
                sebab="Tidak ada investigasi yang akuisisinya jatuh pada periode ini. Rinciannya dibiarkan kosong daripada diisi angka yang tidak berasal dari Evidence Store."
              />
            </div>
          ) : (
            <ol className="prt-daftar">
              {zona.map((zn) => (
                <li key={zn.z} className="prt-baris">
                  <div>
                    <h3 className="prt-baris__nama">
                      {zn.z === KUNCI_TANPA_ZONA ? "tanpa zona" : zn.z}
                    </h3>
                    {zn.z === KUNCI_TANPA_ZONA && (
                      <p className="prt-baris__ket">
                        Investigasi yang berkasnya tidak membawa label zona. Dihitung terpisah,
                        bukan dibagikan ke zona lain.
                      </p>
                    )}
                  </div>

                  <div className="prt-baris__kanan">
                    <p className="prt-baris__total">
                      <Angka n={zn.n} kelas="prt-baris__n" />
                      <span className="prt-baris__unit">berkas</span>
                    </p>

                    {/* Proporsi status, 3 px. Cacahnya sudah tertulis sebagai
                        teks di bawah, jadi meter ini dekorasi data belaka. */}
                    <span className="prt-meter" aria-hidden="true">
                      {zn.per
                        .filter((p) => p.n > 0)
                        .map((p) => (
                          <span
                            key={p.status}
                            className={`prt-meter__ruas prt-meter__ruas--${p.status}`}
                            style={{ flexGrow: p.n }}
                          />
                        ))}
                    </span>

                    <dl className="prt-rinci">
                      {zn.per.map((p) => (
                        <div key={p.status} className="prt-rinci__sel">
                          <dt>
                            <Status status={p.status} />
                          </dt>
                          <dd>
                            <Angka n={p.n} kelas="prt-rinci__n" />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <span className="garis" aria-hidden="true" data-garis="" />

        <section className="prt-tutup" aria-labelledby="prt-jaminan-judul">
          <div className="panel panel--rim prt-jaminan">
            <p className="eyebrow" id="prt-jaminan-judul">
              Jaminan nol identitas
            </p>
            <p className="prt-jaminan__kalimat">
              Agregat ini dibentuk di server tanpa pernah memuat field identitas — bukan disaring
              belakangan di peramban.
            </p>
            <p className="redup">Tidak pernah ikut keluar:</p>
            <ul className="prt-larik">
              <li>nomor investigasi</li>
              <li>identitas artefak</li>
              <li>hash MMSI</li>
              <li>koordinat</li>
              <li>stempel waktu per kapal</li>
            </ul>
            <p className="prt-jaminan__nota">
              Yang tersisa: cacah, label zona, dan nama dataset yang menyumbang artefak.
            </p>
          </div>

          <a
            className="prt-kartu"
            href={`/api/public/aggregate${sah === null ? "" : `?period=${encodeURIComponent(sah)}`}`}
          >
            <span className="prt-kartu__nama">Angka yang sama sebagai JSON</span>
            <span className="prt-kartu__ket">
              /api/public/aggregate dilayani fungsi yang sama dengan halaman ini, jadi keduanya
              tidak bisa menyimpang. Periode yang sedang dipilih ikut terbawa.
            </span>
          </a>
        </section>

        <section className="prt-sumber">
          <p className="eyebrow">Sumber data</p>
          {agregat.sumber.length === 0 ? (
            <p className="redup ukur">
              Belum ada artefak pada periode ini, jadi belum ada sumber untuk disebut.
            </p>
          ) : (
            <ul className="prt-sumber__larik">
              {agregat.sumber.map((s) => (
                <li key={s} className="prt-sumber__butir">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </section>

        <GerakPortal />
      </div>
    </Cangkang>
  );
}

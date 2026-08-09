// Portal publik (peran publik). Register: ekspresif seperti Entry, tetapi
// isinya angka agregat — nol field identitas. Sumber angka sama persis dengan
// /api/public/aggregate (lib/agregat.ts), jadi halaman dan API tidak bisa
// menyimpang.

import { Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { KUNCI_TANPA_ZONA, POLA_PERIODE, hitungAgregat, periodeTersedia } from "@/lib/agregat";

export const dynamic = "force-dynamic";

const URUT_STATUS = ["terkonfirmasi", "terindikasi", "abstain"] as const;

export default async function Portal({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const sah = period !== undefined && POLA_PERIODE.test(period) ? period : null;
  const agregat = await hitungAgregat(sah);
  const periode = await periodeTersedia();

  const zona = [
    ...new Set(Object.values(agregat.counts).flatMap((per) => Object.keys(per))),
  ].sort();
  const adaIsi = zona.length > 0;

  return (
    <Cangkang aktif="/portal" register="Agregat status per zona, tanpa identitas kapal">
      <div className="tumpuk tumpuk--renggang">
        <section className="tumpuk">
          <h2>Periode {agregat.periode}</h2>
          {/* Pemilih native: GET form, tanpa JavaScript, dan hanya berisi
              periode yang sungguh diwakili Evidence Store. */}
          <form className="deret" method="get" action="/portal">
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
        </section>

        <section className="panel panel--rim tumpuk" aria-labelledby="cacah">
          <div className="panel__kepala">
            <h2 id="cacah">Cacah status per zona</h2>
            <p className="eyebrow">diperbarui {agregat.updated_at}</p>
          </div>

          {!adaIsi ? (
            <Kosong
              kalimat="Periode tanpa data."
              sebab="Tidak ada investigasi yang akuisisinya jatuh pada periode ini. Tabel dibiarkan kosong daripada diisi angka yang tidak berasal dari Evidence Store."
            />
          ) : (
            <div className="gulir-x">
              <table className="tabel">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    {zona.map((z) => (
                      <th key={z} scope="col">
                        {z === KUNCI_TANPA_ZONA ? "tanpa zona" : z}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {URUT_STATUS.map((s) => (
                    <tr key={s}>
                      <th scope="row" style={{ textTransform: "none", letterSpacing: 0 }}>
                        <Status status={s} />
                      </th>
                      {zona.map((z) => (
                        <td key={z}>{agregat.counts[s]?.[z] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="tumpuk tumpuk--rapat">
          <p className="eyebrow">Sumber data</p>
          {agregat.sumber.length === 0 ? (
            <p className="redup">
              Belum ada artefak pada periode ini, jadi belum ada sumber untuk disebut.
            </p>
          ) : (
            <p className="ukur">{agregat.sumber.join(", ")}</p>
          )}
        </section>
      </div>
    </Cangkang>
  );
}

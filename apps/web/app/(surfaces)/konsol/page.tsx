// Konsol Skenario (peran analis). Register: dense saat diam, ekspresif saat
// replay berjalan (blueprint 7.4). Elemen tanda tangan: linimasa orkestrasi agen,
// diisi peristiwa SSE dari panggilan model yang sungguh berjalan (Replay).

import Link from "next/link";

import { Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { Replay } from "@/components/replay";
import { daftarInvestigasi, ringkas } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export default async function Konsol({
  searchParams,
}: {
  searchParams: Promise<{ inv?: string }>;
}) {
  const { inv: dipilih } = await searchParams;
  const kasus = (await daftarInvestigasi()).map(ringkas);

  return (
    <Cangkang aktif="/konsol" register="Orkestrasi agen, langkah demi langkah, dapat diulang">
      <div className="papan">
        <section className="panel tumpuk" aria-labelledby="linimasa">
          <div className="panel__kepala">
            <h2 id="linimasa">Linimasa</h2>
            <p className="eyebrow">{dipilih ?? "tanpa kasus terpilih"}</p>
          </div>

          <Replay inv={dipilih ?? null} />
        </section>

        <section className="panel panel--rim tumpuk" aria-labelledby="pemilih">
          <div className="panel__kepala">
            <h2 id="pemilih">Pemilih kasus</h2>
            <p className="eyebrow">{kasus.length} kasus</p>
          </div>

          {kasus.length === 0 ? (
            <Kosong
              kalimat="Belum ada kasus yang bisa dipilih."
              sebab="Pemilih ini hanya menampilkan investigasi yang benar-benar ada di Evidence Store; daftarnya kosong sampai kurasi golden set mengisinya."
            />
          ) : (
            <div>
              {kasus.map((s) => (
                <article className="baris" key={s.inv_id}>
                  <div className="tumpuk tumpuk--rapat">
                    <Link
                      className="baris__utama"
                      href={{ pathname: "/konsol", query: { inv: s.inv_id } }}
                      aria-current={s.inv_id === dipilih ? "true" : undefined}
                    >
                      {s.inv_id}
                    </Link>
                    <p className="baris__meta">
                      <span>{s.kasus_label ?? "tanpa label kasus"}</span>
                      <span>{s.aoi}</span>
                    </p>
                  </div>
                  <Status status={s.status} />
                </article>
              ))}
              {dipilih !== undefined && (
                <p className="redup" style={{ paddingTop: "var(--r-3)" }}>
                  Kasus {dipilih} dipilih. Rantai buktinya bisa dibaca di{" "}
                  <Link href={{ pathname: "/komando", query: { inv: dipilih } }}>
                    Pusat Komando
                  </Link>
                  ; linimasanya dijalankan dari panel sebelah.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </Cangkang>
  );
}

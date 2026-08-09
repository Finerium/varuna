// Konsol Skenario (peran analis). Register: dense saat diam, ekspresif saat
// replay berjalan (blueprint 7.4). Elemen tanda tangan: linimasa orkestrasi agen
// yang di-pin dan di-scrub. Di M0 linimasanya ada tetapi kosong — tidak ada
// satu pun langkah agen yang pernah tercatat, dan itu dinyatakan apa adanya.

import Link from "next/link";

import { Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { daftarInvestigasi, ringkas } from "@/lib/gudang";

export const dynamic = "force-dynamic";

/** Urutan agen kontrak Bagian 2. Simpulnya nyata; keadaannya yang belum ada. */
const AGEN = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"] as const;

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
            <p className="eyebrow">0 langkah tercatat</p>
          </div>

          <ol className="tumpuk tumpuk--rapat" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {AGEN.map((a) => (
              <li key={a} className="baris" style={{ padding: "var(--r-2) 0" }}>
                <span className="baris__utama">{a}</span>
                <span className="keadaan">belum dijalankan</span>
              </li>
            ))}
          </ol>

          <div className="deret">
            <button className="taktil" type="button" disabled>
              Jalankan replay
            </button>
            <p className="redup" style={{ fontSize: "0.82rem", flex: "1 1 18ch" }}>
              Replay memancarkan tiap langkah dari panggilan model yang sungguh berjalan. Tidak ada
              rekaman kalengan yang bisa diputar sebagai gantinya, jadi tombolnya ditutup sampai
              lapisan agen terpasang.
            </p>
          </div>
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
                  Kasus {dipilih} dipilih. Rantai buktinya bisa dibaca sekarang di{" "}
                  <Link href={{ pathname: "/komando", query: { inv: dipilih } }}>
                    Pusat Komando
                  </Link>
                  ; linimasa agennya menyusul bersama lapisan agen.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </Cangkang>
  );
}

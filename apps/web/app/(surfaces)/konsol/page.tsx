// Konsol Skenario (peran analis). Register: dense saat diam, ekspresif saat
// replay berjalan (blueprint 7.4). Elemen tanda tangan: linimasa orkestrasi agen,
// diisi peristiwa SSE dari panggilan model yang sungguh berjalan (Replay).

import Link from "next/link";

import { Kosong, Status } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { Replay } from "@/components/replay";
import { daftarInvestigasi, ringkas } from "@/lib/gudang";

import "./konsol.css";

export const dynamic = "force-dynamic";

/** Angka kepala. Ketiganya terikat kontrak, bukan hiasan: sebelas agen A0-A10
 *  (contracts.md Bagian 2), satu invokasi HTTP per langkah agen (VAR-LIVE-02),
 *  dan seed yang dibawa tiap resume_token (Bagian 3). */
const ANGKA = [
  { nilai: "11", ket: "agen dalam rantai, A0-A10" },
  { nilai: "1 : 1", ket: "invokasi HTTP per langkah" },
  { nilai: "20260809", ket: "seed replay terkunci" },
] as const;

export default async function Konsol({
  searchParams,
}: {
  searchParams: Promise<{ inv?: string }>;
}) {
  const { inv: dipilih } = await searchParams;
  const kasus = (await daftarInvestigasi()).map(ringkas);

  return (
    <Cangkang aktif="/konsol" register="Orkestrasi agen, langkah demi langkah, dapat diulang">
      <section className="kns-kepala">
        <p className="kns-mata">
          <span aria-hidden="true">◆</span> Teater orkestrasi
        </p>
        <h1 className="kns-judul">
          Sebelas agen menyusun berkas. <span className="kns-aksen">Server yang memutus.</span>
        </h1>
        <p className="kns-sub">
          Replay memutar ulang satu investigasi golden set lewat panggilan model yang benar-benar
          berjalan: satu invokasi HTTP membawa tepat satu langkah agen, dan tiap langkah
          meninggalkan jejaknya sendiri. Tidak ada rekaman kalengan yang diputar sebagai gantinya.
        </p>
        <dl className="kns-angka">
          {ANGKA.map((a) => (
            <div key={a.ket}>
              <dt className="kns-nilai">{a.nilai}</dt>
              <dd className="kns-ket">{a.ket}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="kns-papan">
        <section className="panel kns-teater" aria-labelledby="linimasa">
          <div className="panel__kepala">
            <h2 id="linimasa">Linimasa</h2>
            {/* Keadaan run diumumkan komponen Replay; eyebrow ini cuma menamai
                kasus yang sedang di panggung, jadi tanpa pilihan ia diam. */}
            {dipilih !== undefined && <p className="eyebrow">{dipilih}</p>}
          </div>

          <Replay inv={dipilih ?? null} />
        </section>

        <section className="panel panel--rim" aria-labelledby="pemilih">
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
            <div className="tumpuk tumpuk--rapat">
              <div className="kns-daftar">
                {kasus.map((s) => (
                  <Link
                    key={s.inv_id}
                    className="kns-kasus"
                    href={{ pathname: "/konsol", query: { inv: s.inv_id } }}
                    aria-current={s.inv_id === dipilih ? "true" : undefined}
                  >
                    <span className="kns-kasus__id">{s.inv_id}</span>
                    <Status status={s.status} />
                    <span className="kns-kasus__meta">
                      <span>{s.kasus_label ?? "tanpa label kasus"}</span>
                      <span>{s.aoi}</span>
                    </span>
                  </Link>
                ))}
              </div>

              {dipilih !== undefined && (
                <p className="kns-terpilih">
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

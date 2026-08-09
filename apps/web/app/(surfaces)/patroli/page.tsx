// Patroli (peran patroli). Register: taktil tegas, umpan balik sentuh percaya
// diri (blueprint 7.4). Dibangun sebagai aplikasi mobile dan disajikan di
// desktop DI DALAM phone frame; penuh tanpa frame di perangkat mobile
// (blueprint 7.5) — pembedaannya CSS murni, jadi interaksinya identik.

import { KUNCI_PAKET, paketTerkini } from "@varuna/core/runtime";

import { Kosong } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";
import { Peta } from "@/components/peta";
import { bacaRuntime } from "@/lib/gudang";

export const dynamic = "force-dynamic";

export default async function Patroli() {
  // Sumber yang sama dengan GET /api/patrol/packages, dibaca langsung karena
  // halaman ini server component. Poligon area TIDAK dihitung di sini: server
  // yang mencetaknya (runtime.ts areaPencarian), peta hanya menggambar.
  const paket = paketTerkini(await bacaRuntime(KUNCI_PAKET).catch(() => []));

  return (
    <Cangkang aktif="/patroli" register="Paket sasaran di laut dan hasil pemeriksaannya">
      <div className="frame">
        <div className="frame__layar tumpuk">
          <div className="tumpuk tumpuk--rapat">
            <p className="eyebrow">Penugasan</p>
            <h2>Paket sasaran</h2>
          </div>

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
            // Layar Patroli selebar 358 px: viewBox yang lebih sempit membuat
            // ukuran tampak garis dan label sama dengan panel lebar Komando.
            lebar={480}
            catatan={
              paket.length === 0
                ? "Belum ada area pencarian pada peta ini."
                : "Batas putus-putus: area pencarian, bukan posisi pasti."
            }
          />

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
            <ul className="tumpuk tumpuk--rapat" style={{ listStyle: "none", padding: 0 }}>
              {paket.map((p) => (
                <li key={p.package_id} className="baris">
                  <div className="tumpuk tumpuk--rapat">
                    <span className="baris__utama">{p.package_id}</span>
                    <p className="baris__meta">
                      <span>{p.status_tingkat}</span>
                      <span>radius {p.area.radius_km.toFixed(1)} km</span>
                      <span>{p.area.zona_clip ?? "tanpa potongan zona"}</span>
                      <span>berlaku sampai {p.expires_at}</span>
                    </p>
                    <p className="redup" style={{ fontSize: "0.82rem" }}>
                      {p.label}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="tumpuk tumpuk--rapat">
            <p className="eyebrow">Kirim hasil pemeriksaan</p>
            <button className="taktil" type="button" disabled>
              Belum tersedia
            </button>
            <p className="redup" style={{ fontSize: "0.82rem" }}>
              Catatan bebas kru melewati penyaring diksi dan penolak pola identitas sebelum ditulis.
              Selama penyaring itu belum terpasang di jalur tulis, formulirnya ditutup daripada
              menerima kiriman yang diam-diam dibuang.
            </p>
          </div>

          <div className="tumpuk tumpuk--rapat">
            <p className="eyebrow">Kiriman tertunda</p>
            <p className="redup" style={{ fontSize: "0.82rem" }}>
              Tidak ada kiriman yang menunggu. Antrean offline baru punya arti setelah ada yang bisa
              dikirim; sampai saat itu hitungannya nol dan itu jujur.
            </p>
          </div>
        </div>
      </div>
    </Cangkang>
  );
}

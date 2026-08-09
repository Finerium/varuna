// Patroli (peran patroli). Register: taktil tegas, umpan balik sentuh percaya
// diri (blueprint 7.4). Dibangun sebagai aplikasi mobile dan disajikan di
// desktop DI DALAM phone frame; penuh tanpa frame di perangkat mobile
// (blueprint 7.5) — pembedaannya CSS murni, jadi interaksinya identik.

import { Kosong } from "@/components/tampil";
import { Cangkang } from "@/components/cangkang";

export const dynamic = "force-dynamic";

export default async function Patroli() {
  return (
    <Cangkang aktif="/patroli" register="Paket sasaran di laut dan hasil pemeriksaannya">
      <div className="frame">
        <div className="frame__layar tumpuk">
          <div className="tumpuk tumpuk--rapat">
            <p className="eyebrow">Penugasan</p>
            <h2>Paket sasaran</h2>
          </div>

          {/* Daftar paket lahir dari aksi validasi analis, dan jalur itu belum
              terpasang di M0 (GET /api/patrol/packages menjawab 501). Menampilkan
              daftar kosong saja akan berbohong: kosong berarti "belum ada
              penugasan", bukan "mesinnya belum ada". Keduanya dinyatakan. */}
          <Kosong
            kalimat="Belum ada penugasan."
            sebab="Jalur paket sasaran belum terpasang pada M0: paket hanya dicetak server saat analis menerima sebuah berkas, dan aksi itu baru hidup setelah lapisan agen masuk."
          />

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

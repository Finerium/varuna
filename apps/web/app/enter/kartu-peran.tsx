"use client";

// Kartu peran — pintu masuk ke tiga surface, dipakai hero Entry.
//
// Ia hidup di app/enter/ bersama route handler-nya karena itu memang surface
// yang sama: kartu ini adalah satu-satunya bagian "masuk peran" yang punya
// permukaan visual. /enter/{peran} sendiri memasang cookie lalu mengalihkan di
// server; logikanya tidak disentuh dari sini, bahkan preventDefault pun tidak —
// anchor tetap navigasi dokumen penuh, persis seperti sebelumnya, supaya
// Set-Cookie dan redirect 307-nya jalan apa adanya.
//
// Klien hanya untuk satu hal: navigasi dokumen ke halaman force-dynamic bisa
// menggantung sedetik dua detik tanpa satu pun tanda di layar. Klik menyalakan
// keadaan "membuka" pada kartu yang bersangkutan.

import { useEffect, useState } from "react";

import "./enter.css";

const PERAN = [
  {
    href: "/enter/analis",
    nama: "Analis",
    tujuan: "Pusat Komando",
    ket: "Antrean investigasi dan rantai buktinya.",
    utama: true,
  },
  {
    href: "/enter/patroli",
    nama: "Kru Patroli",
    tujuan: "Aplikasi lapangan",
    ket: "Paket periksa dan hasil verifikasi lapangan.",
    utama: false,
  },
  {
    href: "/enter/publik",
    nama: "Publik",
    tujuan: "Portal agregat",
    ket: "Agregat status per zona, tanpa identitas kapal.",
    utama: false,
  },
] as const;

export function KartuPeran() {
  const [membuka, setMembuka] = useState<string | null>(null);
  const dibuka = PERAN.find((p) => p.href === membuka) ?? null;

  // Kembali lewat tombol Back memulihkan halaman dari bfcache lengkap dengan
  // keadaan React-nya — tanpa reset ini, kartu yang tadi diklik tetap
  // memperlihatkan laju yang tidak menuju ke mana-mana. Jalur juri yang wajar:
  // masuk sebagai analis, kembali, coba peran lain.
  useEffect(() => {
    const pulih = () => setMembuka(null);
    window.addEventListener("pageshow", pulih);
    return () => window.removeEventListener("pageshow", pulih);
  }, []);

  return (
    <>
      <div className="ent-rak" data-sibuk={membuka === null ? undefined : ""}>
        {PERAN.map((p) => (
          // Anchor penuh, bukan Link: rute memasang cookie peran lalu mengalihkan.
          <a
            key={p.href}
            className="ent-kartu"
            href={p.href}
            data-utama={p.utama ? "" : undefined}
            data-membuka={membuka === p.href ? "" : undefined}
            aria-busy={membuka === p.href || undefined}
            onClick={() => setMembuka(p.href)}
          >
            <span className="ent-kartu__nama">{p.nama}</span>
            <span className="ent-kartu__tujuan">{p.tujuan}</span>
            <span className="ent-kartu__ket">{p.ket}</span>
            <span className="ent-kartu__panah" aria-hidden="true">
              &rarr;
            </span>
            <span className="ent-kartu__laju" aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="ent-warta" role="status">
        {dibuka === null ? "" : `Membuka ${dibuka.tujuan}…`}
      </p>
    </>
  );
}

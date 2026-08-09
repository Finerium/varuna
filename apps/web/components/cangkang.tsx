// Cangkang bersama empat surface operasional. Entry ("/") punya register sendiri
// dan tidak memakainya.

import { cookies } from "next/headers";
import Link from "next/link";

import { COOKIE_PERAN, LABEL_PERAN, adalahPeran } from "@/lib/peran";

const JALUR = [
  { href: "/komando", nama: "Pusat Komando" },
  { href: "/konsol", nama: "Konsol Skenario" },
  { href: "/patroli", nama: "Patroli" },
  { href: "/portal", nama: "Portal" },
] as const;

export async function Cangkang({
  aktif,
  register,
  children,
}: {
  aktif: (typeof JALUR)[number]["href"];
  /** Satu kalimat yang menyatakan apa yang surface ini pertanggungjawabkan. */
  register: string;
  children: React.ReactNode;
}) {
  const nilai = (await cookies()).get(COOKIE_PERAN)?.value;
  const peran = nilai !== undefined && adalahPeran(nilai) ? nilai : null;

  return (
    <div className="cangkang">
      <a className="lewati" href="#isi">
        Lompat ke isi
      </a>
      <header className="pita">
        <div className="deret">
          <Link href="/" className="pita__tanda" style={{ textDecoration: "none" }}>
            VARUNA
          </Link>
          <nav className="pita__jalur" aria-label="Surface">
            {JALUR.map((j) => (
              <Link key={j.href} href={j.href} aria-current={j.href === aktif ? "page" : undefined}>
                {j.nama}
              </Link>
            ))}
          </nav>
        </div>
        <p className="eyebrow">
          {peran === null ? "peran belum dipilih" : `peran: ${LABEL_PERAN[peran]}`}
        </p>
      </header>
      <main className="isi" id="isi">
        <p className="eyebrow" style={{ marginBottom: "var(--r-2)" }}>
          {register}
        </p>
        {children}
      </main>
      <footer className="kaki">
        M0 — kerangka hidup. Angka yang tampil hanya datang dari Evidence Store; yang belum ada
        dinyatakan kosong, bukan diisi contoh.
      </footer>
    </div>
  );
}

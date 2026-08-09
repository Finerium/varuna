"use client";

// Koreografi Entry dan Portal (architecture.md "Gerak & visual").
//
// Komponen ini tidak merender apa pun. Elemen yang digerakkan sudah dirender
// server; yang ditempelkan di sini hanya timeline pada atribut data-*. Akibatnya
// halaman tanpa JavaScript adalah halaman yang sama, hanya diam — tidak ada isi
// yang lahir dari animasi.
//
// GSAP, ScrollTrigger, dan Lenis masuk lewat dynamic import DI DALAM efek: nol
// byte dari ketiganya ada di first load, dan rute API tidak pernah menyentuhnya.

import { useEffect } from "react";

import { bacaAngka, gerakHidup, padamkanGerak } from "@/lib/gerak";

type Gsap = typeof import("gsap").gsap;

type Panggung = { gsap: Gsap; bongkar: () => void };

async function panggung(): Promise<Panggung> {
  const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger"),
    import("lenis"),
  ]);
  gsap.registerPlugin(ScrollTrigger);

  // Momentum Lenis didorong ticker GSAP, bukan rAF sendiri: satu jam untuk scroll
  // dan animasi berarti ScrollTrigger tidak pernah membaca posisi yang basi satu
  // frame.
  const lenis = new Lenis({ duration: 1.05 });
  const detak = (t: number) => lenis.raf(t * 1000);
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(detak);
  gsap.ticker.lagSmoothing(0);

  return {
    gsap,
    bongkar: () => {
      gsap.ticker.remove(detak);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    },
  };
}

/** Entry — surface paling ekspresif, tetapi tiga gerakan saja:
 *  1. hero masuk SEKALI saat halaman dibuka, kata demi kata;
 *  2. chip SAR muncul saat panelnya masuk viewport, rim glass-nya menyala pelan
 *     sesudahnya (lapisan .pijar: opacity, bukan border atau filter);
 *  3. roster "Masuk sebagai" muncul satu kartu per kartu.
 *  Tidak ada parallax, tidak ada pin, tidak ada scrub — halaman ini dibaca, bukan
 *  ditonton. */
function susunEntry(gsap: Gsap): void {
  gsap.fromTo(
    "[data-adegan='hero'] [data-gerak-masuk]",
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.55, ease: "power2.out", stagger: 0.022, delay: 0.05 },
  );

  gsap.fromTo(
    "[data-adegan='pengantar'][data-gerak-masuk]",
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", delay: 0.28 },
  );

  gsap
    .timeline({ scrollTrigger: { trigger: "[data-adegan='chip']", start: "top 82%", once: true } })
    .fromTo(
      "[data-adegan='chip'] [data-gerak-masuk]",
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.09 },
    )
    .fromTo(".pijar", { opacity: 0 }, { opacity: 1, duration: 1.5, ease: "sine.inOut" }, 0.3);

  gsap.fromTo(
    "[data-adegan='roster'] [data-gerak-masuk]",
    { opacity: 0, y: 12 },
    {
      opacity: 1,
      y: 0,
      duration: 0.5,
      ease: "power2.out",
      stagger: 0.08,
      scrollTrigger: { trigger: "[data-adegan='roster']", start: "top 85%", once: true },
    },
  );
}

/** Portal — dua gerakan: garis pemisah tumbuh dari kiri, dan angka agregat
 *  menghitung naik SEKALI saat tabelnya masuk viewport. Count-up membaca nilai
 *  akhirnya dari teks yang sudah dirender server, jadi ia hanya menunda angka
 *  yang memang ada; tidak ada satu pun angka yang lahir di peramban. */
function susunPortal(gsap: Gsap): void {
  for (const garis of gsap.utils.toArray<HTMLElement>("[data-garis]")) {
    gsap.fromTo(
      garis,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 0.8,
        ease: "power2.out",
        scrollTrigger: { trigger: garis, start: "top 94%", once: true },
      },
    );
  }

  // Dua himpunan yang sengaja dipisah: SEMUA sel dimunculkan, hanya sel yang
  // angkanya bisa dipulihkan persis yang dihitung naik. Kalau keduanya disatukan,
  // sel yang ditolak bacaAngka (mis. suatu hari cacahnya diberi pemisah ribuan)
  // ikut tersaring dari reveal dan tinggal tak terlihat selamanya — pra-sembunyi
  // CSS hanya boleh dibatalkan JS, jadi di sinilah satu-satunya tempat isi bisa
  // hilang. Sel begitu tetap muncul, hanya tidak menghitung.
  const sel = gsap.utils.toArray<HTMLElement>("[data-angka]");
  if (sel.length === 0) return;
  const angka = sel
    // Offset dibawa dari indeks di `sel`, bukan indeks setelah penyaringan:
    // hitungan naik sebuah sel harus mulai bersamaan dengan munculnya sel itu.
    .map((el, i) => ({ el, i, akhir: bacaAngka(el.textContent) }))
    .filter((a): a is { el: HTMLElement; i: number; akhir: number } => a.akhir !== null);

  // Satu ScrollTrigger untuk seluruh tabel: tiap sel ikut irama yang sama, bukan
  // dua belas pemicu yang saling mendahului.
  const tl = gsap.timeline({
    scrollTrigger: { trigger: sel[0].closest("table") ?? sel[0], start: "top 88%", once: true },
  });
  tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.035 }, 0);
  for (const a of angka) {
    // Sel TIDAK di-nol-kan saat timeline disusun, hanya saat tween-nya benar
    // dijalankan: `to()` pada objek biasa tidak immediateRender, jadi onUpdate
    // pertama (nilai.n masih 0) yang menulis "0". Sampai pemicu scroll-nya kena,
    // teks di DOM tetap angka server. Bedanya nyata untuk pembaca layar dan
    // salinan teks: keduanya membaca sel yang opacity-nya 0, dan "0" yang
    // menetap di sana selama pembaca tidak menggulir adalah angka palsu.
    const nilai = { n: 0 };
    tl.to(
      nilai,
      {
        n: a.akhir,
        duration: 0.7,
        ease: "power1.out",
        snap: { n: 1 },
        onUpdate: () => {
          a.el.textContent = String(nilai.n);
        },
      },
      a.i * 0.035,
    );
  }
}

function useAdegan(susun: (gsap: Gsap) => void): void {
  useEffect(() => {
    if (!gerakHidup()) return;
    let batal = false;
    let bongkar: (() => void) | null = null;
    void panggung()
      .then((p) => {
        if (batal) {
          p.bongkar();
          return;
        }
        // gsap.context: satu revert membersihkan tween, ScrollTrigger, dan gaya
        // inline yang dipasangnya — tidak ada sisa saat rute berganti.
        const ctx = p.gsap.context(() => susun(p.gsap));
        bongkar = () => {
          ctx.revert();
          p.bongkar();
        };
      })
      .catch(padamkanGerak);
    return () => {
      batal = true;
      bongkar?.();
    };
  }, [susun]);
}

export function GerakEntry(): null {
  useAdegan(susunEntry);
  return null;
}

export function GerakPortal(): null {
  useAdegan(susunPortal);
  return null;
}

"use client";

// Linimasa orkestrasi agen — elemen tanda tangan Konsol Skenario (blueprint 7.4).
//
// Tiap langkah adalah SATU permintaan HTTP: /api/replay/{inv} untuk memulai,
// lalu /api/replay/{inv}/step dengan resume_token sampai run tutup. Yang tampil
// di sini hanya yang dikirim server; komponen ini tidak menghitung status dan
// tidak pernah menampilkan langkah yang tidak benar-benar terjadi.
//
// Kegagalan panggilan model tampil apa adanya beserta tombol ulang (V13):
// mengulang MENGULANG LANGKAH YANG SAMA dengan token yang sama, bukan memulai
// dari awal diam-diam.
//
// Kelas visual berprefiks `kns-` dan hidup di app/(surfaces)/konsol/konsol.css:
// komponen ini hanya dipakai Konsol, jadi lapis visualnya ikut ke sana.

import { useAnimate } from "motion/react-mini";
import { useCallback, useEffect, useRef, useState } from "react";

import { gerakHidup } from "@/lib/gerak";

/** Rantai agen kontrak Bagian 2 beserta peran ringkasnya. Ditulis di sini,
 *  BUKAN diimpor dari @varuna/agents: paket itu menarik SDK agen ke dalam bundel
 *  peramban padahal yang dibutuhkan komponen ini cuma sebelas label. */
const AGEN = [
  { id: "A0", peran: "Orkestrator" },
  { id: "A1", peran: "Penyiap akuisisi" },
  { id: "A2", peran: "Pemilih deteksi" },
  { id: "A3", peran: "Pemeriksa anomali AIS" },
  { id: "A4", peran: "Pengasosiasi lintasan" },
  { id: "A5", peran: "Pengelas perilaku" },
  { id: "A6", peran: "Pemeriksa silang" },
  { id: "A7", peran: "Penyusun berkas" },
  { id: "A8", peran: "Pemeriksa diksi" },
  { id: "A9", peran: "Penyusun usulan paket" },
  { id: "A10", peran: "Pengusul kalibrasi" },
] as const;

type Fase = "start" | "output" | "retry" | "discarded" | "done";

type Langkah = {
  agent: string;
  phase: Fase;
  output_ref: string | null;
  trace_ref: string;
  pasha: { status: string; sensors_independent: number } | null;
  diff: { status_sama: boolean; artefak_sama: boolean } | null;
};

type Penutup =
  | { jenis: "lanjut"; resume_token: unknown; agen_berikut: string | null }
  | { jenis: "selesai" }
  | { jenis: "gagal"; pesan: string; dapat_diulang: boolean };

const KATA_FASE: Record<Fase, string> = {
  start: "berjalan",
  output: "selesai",
  retry: "diperbaiki sekali",
  discarded: "dibuang",
  done: "run ditutup",
};

/** Bobot visual fase: amber hanya untuk langkah yang sedang hidup, rim penuh
 *  untuk yang sudah menetap, rim rapat untuk yang dibuang. */
const KELAS_FASE: Record<Fase, string> = {
  start: "kns-fase kns-fase--aktif",
  output: "kns-fase kns-fase--sedia",
  retry: "kns-fase kns-fase--aktif",
  discarded: "kns-fase kns-fase--cacat",
  done: "kns-fase kns-fase--sedia",
};

/** Kosakata tampil status BEKU (contracts.md Bagian 7). Peta tiga baris ini
 *  ditulis ulang di sini, sama alasannya dengan AGEN: mengimpor components/tampil
 *  menarik @varuna/core ke bundel peramban demi satu label. */
const LABEL_STATUS: Record<string, string> = {
  terkonfirmasi: "terkonfirmasi",
  terindikasi: "terindikasi",
  abstain: "ABSTAIN",
};

/** Pembaca SSE minimal: cukup untuk `event:` + `data:` satu baris, yang memang
 *  satu-satunya bentuk yang dikirim rute replay. */
async function* peristiwa(res: Response): AsyncGenerator<{ event: string; data: unknown }> {
  const pembaca = res.body?.getReader();
  if (pembaca === undefined) return;
  const dekoder = new TextDecoder();
  let sisa = "";
  for (;;) {
    const { done, value } = await pembaca.read();
    if (done) break;
    sisa += dekoder.decode(value, { stream: true });
    let batas = sisa.indexOf("\n\n");
    while (batas >= 0) {
      const blok = sisa.slice(0, batas);
      sisa = sisa.slice(batas + 2);
      const event = /^event: (.*)$/m.exec(blok)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(blok)?.[1] ?? "null";
      yield { event, data: JSON.parse(data) as unknown };
      batas = sisa.indexOf("\n\n");
    }
  }
}

/** Satu-satunya gerak bawaan JavaScript di Konsol, dan ia menandai perubahan yang
 *  SUNGGUH terjadi: badge fase muncul saat langkah agen berpindah fase. Bukan
 *  animasi saat halaman dibuka — di surface operasional tidak ada scroll-theater.
 *
 *  Motion dipakai lewat `motion/react-mini`, bukan `motion/react`: yang dibutuhkan
 *  cuma satu transisi opacity+transform, dan varian mini menjalankannya di WAAPI.
 *  Terukur (esbuild, minify+gzip, react eksternal): mini 3,2 KB lawan penuh
 *  23,0 KB — 19,8 KB yang tidak perlu diunduh rute ini.
 *  Hover dan fokus di Komando, Patroli, dan Konsol tetap transisi CSS transform,
 *  tanpa satu byte JavaScript.
 *
 *  Gaya awal tidak pernah dirender: badge lahir terlihat dan animasinya baru
 *  dijalankan pada pergantian berikutnya, jadi hidrasi cocok dan tidak ada isi
 *  yang bergantung pada JS untuk muncul. reduced-motion (bendera lib/gerak.ts):
 *  badge yang sama persis, langsung. */
function Fase({ kata, kelas }: { kata: string; kelas: string }) {
  const [ruang, animasikan] = useAnimate<HTMLSpanElement>();
  const pernah = useRef(false);

  useEffect(() => {
    if (!pernah.current) {
      pernah.current = true;
      return;
    }
    if (!gerakHidup() || ruang.current === null) return;
    void animasikan(
      ruang.current,
      { opacity: [0, 1], transform: ["translateY(-3px)", "none"] },
      { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
    );
  }, [kata, animasikan, ruang]);

  return (
    <span ref={ruang} className={kelas}>
      {kata}
    </span>
  );
}

export function Replay({ inv }: { inv: string | null }) {
  const [langkah, setLangkah] = useState<Langkah[]>([]);
  const [berjalan, setBerjalan] = useState(false);
  const [selesai, setSelesai] = useState(false);
  const [gagal, setGagal] = useState<string | null>(null);
  const token = useRef<unknown>(null);

  const satuPermintaan = useCallback(async (): Promise<Penutup> => {
    const mulai = token.current === null;
    const res = await fetch(
      mulai ? `/api/replay/${inv}` : `/api/replay/${inv}/step`,
      mulai
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resume_token: token.current }),
          },
    );

    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const badan = (await res.json().catch(() => null)) as { pesan?: string } | null;
      return {
        jenis: "gagal",
        pesan: badan?.pesan ?? `Server menjawab ${res.status} tanpa aliran langkah.`,
        dapat_diulang: true,
      };
    }

    let penutup: Penutup = {
      jenis: "gagal",
      pesan: "Aliran langkah terputus sebelum server menutupnya.",
      dapat_diulang: true,
    };
    for await (const { event, data } of peristiwa(res)) {
      if (event === "agent_step") {
        setLangkah((sebelumnya) => [...sebelumnya, data as Langkah]);
        continue;
      }
      if (event === "lanjut") {
        const d = data as { resume_token: unknown; agen_berikut: string | null };
        penutup = { jenis: "lanjut", resume_token: d.resume_token, agen_berikut: d.agen_berikut };
      } else if (event === "selesai") {
        penutup = { jenis: "selesai" };
      } else if (event === "gagal") {
        const d = data as { pesan: string; dapat_diulang: boolean };
        penutup = { jenis: "gagal", pesan: d.pesan, dapat_diulang: d.dapat_diulang };
      }
    }
    return penutup;
  }, [inv]);

  const jalankan = useCallback(async () => {
    if (inv === null || berjalan) return;
    setBerjalan(true);
    setGagal(null);
    // Batas atas: A0 plus sepuluh agen; lebih dari itu berarti ada yang salah
    // dan lebih baik berhenti daripada memutar permintaan tanpa akhir.
    for (let i = 0; i < 14; i++) {
      const penutup = await satuPermintaan();
      if (penutup.jenis === "gagal") {
        setGagal(penutup.pesan);
        break;
      }
      if (penutup.jenis === "selesai") {
        setSelesai(true);
        break;
      }
      token.current = penutup.resume_token;
    }
    setBerjalan(false);
  }, [berjalan, inv, satuPermintaan]);

  const ulangDariAwal = useCallback(() => {
    token.current = null;
    setLangkah([]);
    setSelesai(false);
    setGagal(null);
  }, []);

  const terakhirPer = (agen: string): Langkah | undefined =>
    [...langkah].reverse().find((l) => l.agent === agen);
  const penutupRun = [...langkah].reverse().find((l) => l.phase === "done");

  // Satu kalimat keadaan run, dibaca dari state yang sama dengan tombolnya.
  const keadaan =
    gagal !== null
      ? "run terhenti"
      : berjalan
        ? "live · model dipanggil"
        : selesai
          ? "run selesai"
          : inv === null
            ? "menunggu kasus"
            : "siaga";

  return (
    <div className="kns-isi">
      <div className="kns-jalur">
        <span className="kns-hidup" data-nyala={berjalan ? "ya" : "tidak"} aria-live="polite">
          <span className="kns-suar" aria-hidden="true" />
          {keadaan}
        </span>
        <span className="kns-cacah">{langkah.length} langkah tercatat</span>
      </div>

      <ol className="kns-rel" aria-label="Linimasa agen A0 sampai A10">
        {AGEN.map((a) => {
          const l = terakhirPer(a.id);
          return (
            <li
              key={a.id}
              className="kns-langkah"
              data-fase={l?.phase ?? "kosong"}
              data-jalan={l === undefined ? "tidak" : "ya"}
            >
              <span className="kns-node" aria-hidden="true" />
              <span className="kns-identitas">
                <span className="kns-agen">{a.id}</span>
                <span className="kns-peran">{a.peran}</span>
              </span>
              <Fase
                kata={l === undefined ? "belum dijalankan" : KATA_FASE[l.phase]}
                kelas={l === undefined ? "kns-fase" : KELAS_FASE[l.phase]}
              />
              {l !== undefined && (
                <span className="kns-jejak" title={l.trace_ref}>
                  jejak {l.trace_ref}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {penutupRun?.pasha != null && (
        <div className="kns-penutup">
          <p className="kns-label">Status dihitung server dari artefak yang dikutip replay</p>
          <p className="kns-vonis">
            <span className={`status status--${penutupRun.pasha.status}`}>
              {LABEL_STATUS[penutupRun.pasha.status] ?? penutupRun.pasha.status}
            </span>
            <span className="redup">
              {penutupRun.pasha.sensors_independent} modalitas independen
            </span>
          </p>
          {penutupRun.diff !== null && (
            <p className="kns-catatan">
              Dibanding berkas tersimpan: status {penutupRun.diff.status_sama ? "sama" : "berbeda"},
              himpunan artefak {penutupRun.diff.artefak_sama ? "sama" : "berbeda"}.
            </p>
          )}
        </div>
      )}

      {gagal !== null && (
        <div className="kns-gagal" role="alert">
          <p className="kns-gagal__judul">Langkah ini tidak selesai.</p>
          <p className="kns-gagal__isi">{gagal}</p>
        </div>
      )}

      <div className="kns-kendali">
        <button
          className="taktil kns-mulai"
          type="button"
          onClick={jalankan}
          disabled={inv === null || berjalan || (selesai && gagal === null)}
        >
          {gagal !== null
            ? "Ulangi langkah"
            : berjalan
              ? "Sedang berjalan..."
              : selesai
                ? "Run selesai"
                : "Jalankan replay"}
        </button>
        {(selesai || gagal !== null) && (
          <button className="taktil" type="button" onClick={ulangDariAwal} disabled={berjalan}>
            Mulai dari awal
          </button>
        )}
        <p className="kns-nota">
          {inv === null
            ? "Pilih satu kasus di panel sebelah; replay berjalan pada satu investigasi."
            : `Tiap langkah adalah satu panggilan model yang sungguh berjalan pada ${inv}. Tidak ada rekaman kalengan yang bisa diputar sebagai gantinya.`}
        </p>
      </div>
    </div>
  );
}

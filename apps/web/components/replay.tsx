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

import { useCallback, useRef, useState } from "react";

/** Urutan agen kontrak Bagian 2. Ditulis di sini, BUKAN diimpor dari
 *  @varuna/agents: paket itu menarik SDK agen ke dalam bundel peramban padahal
 *  yang dibutuhkan komponen ini cuma sebelas label. */
const ID_AGEN = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"] as const;

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

  return (
    <div className="tumpuk">
      <ol className="tumpuk tumpuk--rapat" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {ID_AGEN.map((a) => {
          const l = terakhirPer(a);
          return (
            <li key={a} className="baris" style={{ padding: "var(--r-2) 0" }}>
              <span className="baris__utama">{a}</span>
              <span className={`keadaan${l?.phase === "discarded" ? " keadaan--error" : ""}`}>
                {l === undefined ? "belum dijalankan" : KATA_FASE[l.phase]}
              </span>
            </li>
          );
        })}
      </ol>

      {penutupRun?.pasha != null && (
        <p className="redup">
          Status dihitung server dari artefak yang dikutip replay: {penutupRun.pasha.status} (
          {penutupRun.pasha.sensors_independent} modalitas independen).{" "}
          {penutupRun.diff !== null &&
            `Dibanding berkas tersimpan: status ${penutupRun.diff.status_sama ? "sama" : "berbeda"}, himpunan artefak ${penutupRun.diff.artefak_sama ? "sama" : "berbeda"}.`}
        </p>
      )}

      {gagal !== null && (
        <div className="kosong" role="alert">
          <p className="kosong__kalimat">Langkah ini tidak selesai.</p>
          <p>{gagal}</p>
        </div>
      )}

      <div className="deret">
        <button
          className="taktil"
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
        <p className="redup" style={{ fontSize: "0.82rem", flex: "1 1 18ch" }}>
          {inv === null
            ? "Pilih satu kasus di sebelah kanan; replay berjalan pada satu investigasi."
            : `Tiap langkah adalah satu panggilan model yang sungguh berjalan pada ${inv}. Tidak ada rekaman kalengan yang bisa diputar sebagai gantinya.`}
        </p>
      </div>
    </div>
  );
}

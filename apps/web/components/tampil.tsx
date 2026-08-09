// Primitif tampil bersama. Kosakata status BEKU (contracts.md Bagian 7):
// "terkonfirmasi", "terindikasi", "ABSTAIN" (tampil). Amber satu-satunya warna
// sinyal; ABSTAIN slate. Nilai wire tetap huruf kecil.

import { ABSTAIN_REASON_TEXT } from "@varuna/core/pasha";
import type { Artifact, StatusServerZod } from "@varuna/core/schemas";

const TAMPIL: Record<StatusServerZod["status"], string> = {
  terkonfirmasi: "terkonfirmasi",
  terindikasi: "terindikasi",
  abstain: "ABSTAIN",
};

export function Status({ status }: { status: StatusServerZod["status"] }) {
  return <span className={`status status--${status}`}>{TAMPIL[status]}</span>;
}

/** degraded / kosong / error / kedaluwarsa: tekstur + kata, bukan warna sinyal
 *  baru (blueprint 7.2). */
export function Keadaan({ daftar }: { daftar: readonly string[] }) {
  if (daftar.length === 0) return null;
  return (
    <>
      {daftar.map((k) => (
        <span key={k} className={`keadaan keadaan--${k}`}>
          {k}
        </span>
      ))}
    </>
  );
}

/** Keadaan kosong JUJUR (matriks Bagian 8): kalimat kontraknya di depan, sebab
 *  teknisnya di bawahnya. Tidak pernah diisi contoh. */
export function Kosong({ kalimat, sebab }: { kalimat: string; sebab?: string }) {
  return (
    <div className="kosong">
      <p className="kosong__kalimat">{kalimat}</p>
      {sebab !== undefined && <p>{sebab}</p>}
    </div>
  );
}

export function AlasanAbstain({ status }: { status: StatusServerZod }) {
  if (status.abstain_reason === null) return null;
  return (
    <div className="tumpuk tumpuk--rapat">
      <p>{ABSTAIN_REASON_TEXT[status.abstain_reason]}</p>
      {status.conflicting_art_ids.length > 0 && (
        <p className="redup">Artefak yang bertentangan: {status.conflicting_art_ids.join(", ")}</p>
      )}
      {status.missing_coverage.length > 0 && (
        <p className="redup">Modalitas tanpa cakupan: {status.missing_coverage.join(", ")}</p>
      )}
    </div>
  );
}

/** Chip SAR: bingkai solid dulu, baru glass boleh mendekat (blueprint 7.1);
 *  grayscale asli dengan anotasi amber tipis, tanpa pewarnaan dekoratif. */
export function ChipSar({ artefak }: { artefak: Artifact }) {
  return (
    <figure className="chip" style={{ margin: 0 }}>
      <div className="chip__gambar chip__silang">
        {/* eslint-disable-next-line @next/next/no-img-element -- chip disajikan
            route handler dari Evidence Store, bukan aset statis; optimizer
            next/image tidak boleh menyentuh piksel data-evidence. */}
        <img
          src={`/api/artifacts/${artefak.art_id}/chip`}
          alt={`Chip SAR ${artefak.art_id}, scene ${
            artefak.type === "sar_detection" ? artefak.payload.scene_id : "-"
          }`}
          width={256}
          height={256}
        />
      </div>
      <figcaption className="chip__kaki">
        {artefak.art_id} &middot; {artefak.source.dataset}
      </figcaption>
    </figure>
  );
}

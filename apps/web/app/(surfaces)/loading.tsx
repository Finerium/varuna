// Loading jujur untuk empat surface operasional: kerangka papan dua kolom,
// tanpa cacah dan tanpa status palsu selama data belum dibaca.

export default function MemuatSurface() {
  return (
    <div className="isi" aria-busy="true" aria-live="polite">
      <p className="eyebrow" style={{ marginBottom: "var(--r-2)" }}>
        memuat
      </p>
      <div className="papan">
        <div className="rangka">
          <div className="rangka__baris" style={{ height: "3rem" }} />
          <div className="rangka__baris" />
          <div className="rangka__baris" />
          <div className="rangka__baris" />
        </div>
        <div className="rangka">
          <div className="rangka__baris" style={{ height: "3rem" }} />
          <div className="rangka__baris" style={{ height: "10rem" }} />
        </div>
      </div>
    </div>
  );
}

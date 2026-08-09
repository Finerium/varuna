// Loading jujur (matriks kontrak Bagian 8): kerangka bentuk, tanpa satu pun
// angka atau label isi yang belum diketahui.

export default function Memuat() {
  return (
    <div className="isi tumpuk" aria-busy="true" aria-live="polite">
      <p className="eyebrow">memuat</p>
      <div className="rangka">
        <div className="rangka__baris" style={{ height: "3.4rem" }} />
        <div className="rangka__baris" style={{ height: "12rem" }} />
        <div className="rangka__baris" />
      </div>
    </div>
  );
}

#!/usr/bin/env python3
"""Sentinel-1 GRD (SAFE zip) -> pasangan raster bergaya xView3: VH_dB.tif + VV_dB.tif.

Rantai proses (tanpa SNAP, hanya rasterio + numpy + scipy):
  1. Kalibrasi sigma0 dari LUT `sigmaNought` pada annotation/calibration/*.xml,
     diinterpolasi bilinear (scipy RectBivariateSpline kx=ky=1) ke tiap piksel:
     sigma0 = DN^2 / A^2.
  2. Pengurangan derau termal dari LUT noise, MULTIPLIKATIF pada rerata lokal:
     sigma0 <- sigma0 * (1 - k * N_lokal / T_lokal), kotak --halus-derau px.
     Bukan pengurangan per piksel, karena kanal silang di atas laut berada di
     sekitar NESZ: pengurangan per piksel membuat ~44% piksel VH negatif,
     sementara raster resmi xView3 penuh dan ENL-nya utuh. Bentuk multiplikatif
     membetulkan tingkat rerata tanpa merusak tekstur dan tanpa piksel hilang.
     --halus-derau 0 memilih pengurangan per piksel yang baku; nilai negatif lalu
     dibawa BERTANDA sampai sesudah resampling supaya pembatalan terjadi di
     domain linear (urutan yang benar secara fisik).
  3. Geokoding memakai geolocationGrid sebagai GCP (lon/lat EPSG:4326) dan
     transformasi thin-plate-spline GDAL (METHOD=GCP_TPS), resample bilinear
     pada domain LINEAR (bukan dB), lalu dB = 10*log10(sigma0).
  4. Keluaran meniru format xView3: satu band float16, nilai dB, nodata -32768,
     grid UTM 10 m north-up, striped (tanpa tiling/kompresi).

k default per polarisasi (lihat SKALA_DERAU) dikalibrasi terhadap kembaran resmi
xView3 lewat `sapu-derau`; hasil lengkap di manifests/e1-paritas-hasil.json.

Perintah:
  proses  <SAFE.zip> <outdir> [--ref VH_dB.tif] [--skala-derau K] [--halus-derau P]
                              [--simpan-derau] [--meta out.json]
  banding <punyaku.tif> <resmi.tif> [--cari-geseran N]     # metrik paritas -> JSON stdout
  sapu-derau <k0.tif> <derau.tif> <resmi.tif>              # cari k paritas terbaik
  uji                                                      # self-check tanpa data
"""
import argparse
import contextlib
import hashlib
import io
import json
import math
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.control import GroundControlPoint
from rasterio.crs import CRS
from rasterio.transform import Affine, from_origin
from rasterio.warp import Resampling, reproject
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window
from scipy.interpolate import RectBivariateSpline
from scipy.ndimage import uniform_filter

NODATA = -32768.0
# k daya derau per polarisasi. 1.0 = LUT derau ESA apa adanya, dan itu memang nilai
# terbaik untuk ko-pol. Untuk kanal silang LUT ESA melebihkan daya derau di atas laut
# (VH berada di sekitar NESZ), jadi k dikalibrasi terhadap kembaran resmi xView3:
# lihat manifests/e1-paritas-hasil.json (sapuan k, minimum MAE di 0.5, tidak peka
# terhadap sisi kotak rerata dari 32 sampai 256 px).
SKALA_DERAU = {"VH": 0.5, "VV": 1.0, "HV": 0.5, "HH": 1.0}
HALUS_DERAU = 64      # sisi kotak rerata lokal pengurangan derau (px); 0 = per piksel
RASIO_MIN = 0.05      # lantai faktor pengurangan (maks -13 dB) saat T_lokal <= N_lokal
SPASI_M = 10.0        # spasi piksel keluaran (meter), sama seperti xView3
BLOK_BARIS = 2048     # baris per blok saat kalibrasi di geometri radar
BLOK_WARP = 4096      # sisi blok keluaran saat geokoding
SIGMA_MIN = 1e-12     # lantai linear supaya log10 tidak meledak


# --------------------------------------------------------------------------- SAFE

def _xml(z, nama):
    return ET.parse(io.BytesIO(z.read(nama))).getroot()


def petakan_safe(zip_path):
    """Kembalikan {polarisasi: {ann, cal, noise, tif}} untuk tiap measurement di SAFE zip."""
    z = zipfile.ZipFile(zip_path)
    hasil = {}
    for nama in z.namelist():
        m = re.match(r"(?P<safe>[^/]+\.SAFE)/measurement/(?P<stem>[^/]+)\.tiff$", nama)
        if not m:
            continue
        safe, stem = m.group("safe"), m.group("stem")
        jalur = {
            "ann": f"{safe}/annotation/{stem}.xml",
            "cal": f"{safe}/annotation/calibration/calibration-{stem}.xml",
            "noise": f"{safe}/annotation/calibration/noise-{stem}.xml",
            "tif": nama,
        }
        hilang = [k for k in ("ann", "cal", "noise") if jalur[k] not in z.namelist()]
        if hilang:
            raise ValueError(f"annotation tidak lengkap untuk {stem}: {hilang}")
        pol = _xml(z, jalur["ann"]).findtext("adsHeader/polarisation").upper()
        hasil[pol] = jalur
    if not hasil:
        raise ValueError(f"tidak ada measurement/*.tiff di {zip_path}")
    return z, hasil


def _spline_lut(vektor, tag):
    """Bangun interpolator bilinear LUT (line x pixel) dari daftar vektor annotation.

    Produk IPF lama memakai satu sumbu pixel bersama; produk 2026 (S1A IPF baru,
    S1D) menulis sumbu pixel BERBEDA per vektor. Generalisasi: resample tiap
    vektor ke sumbu vektor pertama via interpolasi linier 1D (LUT mulus, galat
    resampling jauh di bawah 0,01 dB), lalu bangun spline 2D seperti biasa."""
    baris = np.array([float(v.findtext("line")) for v in vektor])
    kolom = np.fromstring(vektor[0].findtext("pixel"), sep=" ")
    nilai = []
    for v in vektor:
        px = np.fromstring(v.findtext("pixel"), sep=" ")
        val = np.fromstring(v.findtext(tag), sep=" ")
        if px.shape == kolom.shape and np.array_equal(px, kolom):
            nilai.append(val)
        else:
            nilai.append(np.interp(kolom, px, val))
    nilai = np.stack(nilai)
    if not (np.all(np.diff(baris) > 0) and np.all(np.diff(kolom) > 0)):
        raise ValueError(f"sumbu LUT '{tag}' tidak menaik ketat")
    return RectBivariateSpline(baris, kolom, nilai, kx=1, ky=1)


def _blok_derau_azimut(akar_noise):
    """[(kolom_awal, kolom_akhir, baris[], lut[])] per swath; kosong bila tak ada vektor azimut."""
    blok = []
    for v in akar_noise.findall("noiseAzimuthVectorList/noiseAzimuthVector"):
        teks = v.findtext("noiseAzimuthLut")
        if not teks:
            continue
        blok.append((int(v.findtext("firstRangeSample")), int(v.findtext("lastRangeSample")),
                     np.fromstring(v.findtext("line"), sep=" "), np.fromstring(teks, sep=" ")))
    return blok


def _gcps(akar_ann):
    """geolocationGrid -> GCP. Indeks line/pixel adalah PUSAT piksel, GDAL memakai
    koordinat citra bersudut kiri-atas, jadi digeser +0.5 piksel."""
    titik = akar_ann.findall("geolocationGrid/geolocationGridPointList/geolocationGridPoint")
    if len(titik) < 10:
        raise ValueError(f"geolocationGrid terlalu jarang ({len(titik)} titik)")
    return [GroundControlPoint(row=float(g.findtext("line")) + 0.5,
                               col=float(g.findtext("pixel")) + 0.5,
                               x=float(g.findtext("longitude")),
                               y=float(g.findtext("latitude")),
                               z=float(g.findtext("height")))
            for g in titik]


# ------------------------------------------------------------------- kalibrasi

def _rasio_derau(daya, derau, ada, p):
    """Faktor pengurangan derau MULTIPLIKATIF dari rerata lokal kotak p x p.

    Alih-alih mengurangi derau per piksel (yang membuat ~44% piksel VH di atas laut
    jadi negatif karena VH xView3 berada di sekitar NESZ), kurangi derau pada RERATA
    LOKAL lalu terapkan rasionya sebagai penguatan: sigma0 = daya * (1 - N_lokal/T_lokal).
    Tingkat rerata jadi benar, tekstur/ENL bertahan, tidak ada piksel hilang.
    Rerata hanya atas piksel valid supaya isian-nol tepi GRD tidak menggelapkan pinggir.
    """
    bobot = np.maximum(uniform_filter(ada.astype(np.float32), p, mode="nearest"), 1e-6)
    t = uniform_filter(np.where(ada, daya, 0.0).astype(np.float32), p, mode="nearest") / bobot
    n = uniform_filter(np.where(ada, derau, 0.0).astype(np.float32), p, mode="nearest") / bobot
    return np.clip(1.0 - n / np.maximum(t, 1e-30), RASIO_MIN, 1.0)


def kalibrasi_ke_radar(z, zip_path, jalur, keluar, skala_derau, keluar_derau=None,
                       halus=HALUS_DERAU):
    """Tulis sigma0 LINEAR bertanda di geometri radar (float32) + GCP geolocationGrid.

    Sentinel 0.0 = tanpa data (hanya piksel isian-nol tepi GRD, tempat DN == 0);
    nilai terkalibrasi persis 0.0 praktis mustahil pada float64 -> float32.
    `halus` = sisi kotak rerata lokal untuk pengurangan derau multiplikatif;
    0 = pengurangan per piksel (bertanda, boleh negatif).
    `keluar_derau` opsional: tulis LUT derau terkalibrasi (derau/A^2) pada grid yang
    sama, dipakai `sapu-derau` untuk mencari skala tanpa mengulang seluruh rantai.
    """
    halo = halus // 2 + 1 if halus else 0
    ann = _xml(z, jalur["ann"])
    lebar = int(ann.findtext("imageAnnotation/imageInformation/numberOfSamples"))
    tinggi = int(ann.findtext("imageAnnotation/imageInformation/numberOfLines"))
    cal = _spline_lut(_xml(z, jalur["cal"]).findall("calibrationVectorList/calibrationVector"),
                      "sigmaNought")
    akar_noise = _xml(z, jalur["noise"])
    rng = _spline_lut(akar_noise.findall("noiseRangeVectorList/noiseRangeVector"), "noiseRangeLut")
    az = _blok_derau_azimut(akar_noise)

    kolom = np.arange(lebar, dtype=float)
    profil = dict(driver="GTiff", width=lebar, height=tinggi, count=1, dtype="float32",
                  nodata=0.0, crs=CRS.from_epsg(4326), gcps=_gcps(ann),
                  tiled=True, blockxsize=512, blockysize=512, BIGTIFF="YES")
    n_negatif = n_data = 0
    with rasterio.open(f"/vsizip/{zip_path}/{jalur['tif']}") as src, \
            rasterio.open(keluar, "w", **profil) as dst, \
            (rasterio.open(keluar_derau, "w", **profil) if keluar_derau
             else contextlib.nullcontext()) as dst_derau:
        if (src.width, src.height) != (lebar, tinggi):
            raise ValueError(f"ukuran measurement {src.width}x{src.height} != annotation "
                             f"{lebar}x{tinggi}")
        for r0 in range(0, tinggi, BLOK_BARIS):
            r1 = min(r0 + BLOK_BARIS, tinggi)
            # halo supaya rerata-lokal tidak berjahit di batas blok
            h0, h1 = max(0, r0 - halo), min(tinggi, r1 + halo)
            dn = src.read(1, window=Window(0, h0, lebar, h1 - h0)).astype(np.float64)
            baris = np.arange(h0, h1, dtype=float)
            a2 = cal(baris, kolom) ** 2
            derau = None
            if skala_derau or keluar_derau:
                derau = rng(baris, kolom)
                for c0, c1, ln, lut in az:
                    derau[:, c0:c1 + 1] *= np.interp(baris, ln, lut)[:, None]
            daya = dn * dn
            ada = dn != 0
            if not skala_derau:
                s0 = daya / a2
            elif halus:
                s0 = daya * _rasio_derau(daya, skala_derau * derau, ada, halus) / a2
            else:
                s0 = (daya - skala_derau * derau) / a2
            iris = slice(r0 - h0, r0 - h0 + (r1 - r0))
            s0, ada = s0[iris], ada[iris]
            n_data += int(ada.sum())
            n_negatif += int((s0 < 0)[ada].sum())
            s0[~ada] = 0.0             # zero-fill tepi GRD = tanpa data
            jendela = Window(0, r0, lebar, r1 - r0)
            dst.write(s0.astype(np.float32), 1, window=jendela)
            if dst_derau is not None:
                d0 = (derau / a2)[iris]
                d0[~ada] = 0.0
                dst_derau.write(d0.astype(np.float32), 1, window=jendela)
    return {"lebar_radar": lebar, "tinggi_radar": tinggi,
            "skala_derau": skala_derau, "halus_derau_px": halus,
            "piksel_negatif_pra_resample": n_negatif,
            "fraksi_negatif_pra_resample": round(n_negatif / max(n_data, 1), 6),
            "waktu_mulai": ann.findtext("adsHeader/startTime"),
            "waktu_selesai": ann.findtext("adsHeader/stopTime"),
            "misi": ann.findtext("adsHeader/missionId"),
            "arah_orbit": ann.findtext("generalAnnotation/productInformation/pass"),
            "sudut_datang_tengah": float(
                ann.findtext("imageAnnotation/imageInformation/incidenceAngleMidSwath"))}


# ------------------------------------------------------------------- geokoding

def grid_dari_gcps(gcps):
    """Grid xView3-style: UTM dari sentroid footprint, 10 m, bbox titik geolocation."""
    lon = np.array([g.x for g in gcps])
    lat = np.array([g.y for g in gcps])
    zona = int((lon.mean() + 180) // 6) + 1
    crs = CRS.from_epsg((32600 if lat.mean() >= 0 else 32700) + zona)
    x, y = warp_transform(CRS.from_epsg(4326), crs, lon.tolist(), lat.tolist())
    kiri, kanan, bawah, atas = min(x), max(x), min(y), max(y)
    lebar = int(math.ceil((kanan - kiri) / SPASI_M))
    tinggi = int(math.ceil((atas - bawah) / SPASI_M))
    return crs, from_origin(kiri, atas, SPASI_M, SPASI_M), lebar, tinggi


def grid_dari_acuan(path):
    with rasterio.open(path) as d:
        return d.crs, d.transform, d.width, d.height


def geokode(radar_path, keluar, crs, transform, lebar, tinggi, ke_db=True):
    """Warp TPS ke grid target pada domain LINEAR bertanda.

    ke_db=True  -> tulis dB float16 nodata -32768 (format xView3); sigma0 <= 0
                   (sisa lebih-kurang derau yang tidak batal saat resampling) = nodata.
    ke_db=False -> tulis nilai linear float32 apa adanya (dipakai raster derau).
    """
    profil = dict(driver="GTiff", width=lebar, height=tinggi, count=1,
                  dtype="float16" if ke_db else "float32",
                  nodata=NODATA if ke_db else 0.0,
                  crs=crs, transform=transform, BIGTIFF="IF_SAFER")
    n_nodata = 0
    with rasterio.open(radar_path) as src, rasterio.open(keluar, "w", **profil) as dst:
        for r0 in range(0, tinggi, BLOK_WARP):
            for c0 in range(0, lebar, BLOK_WARP):
                h = min(BLOK_WARP, tinggi - r0)
                w = min(BLOK_WARP, lebar - c0)
                buf = np.zeros((h, w), dtype=np.float32)
                reproject(rasterio.band(src, 1), buf,
                          src_crs=CRS.from_epsg(4326), src_nodata=0.0,
                          dst_crs=crs, dst_nodata=0.0,
                          dst_transform=transform * Affine.translation(c0, r0),
                          resampling=Resampling.bilinear, num_threads=4,
                          METHOD="GCP_TPS")
                if not ke_db:
                    dst.write(buf, 1, window=Window(c0, r0, w, h))
                    continue
                db = np.where(buf > 0.0, 10.0 * np.log10(np.maximum(buf, SIGMA_MIN)), NODATA)
                n_nodata += int((db == NODATA).sum())
                dst.write(db.astype(np.float16), 1, window=Window(c0, r0, w, h))
    return n_nodata


def sha256(path, blok=1 << 23):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for potong in iter(lambda: f.read(blok), b""):
            h.update(potong)
    return h.hexdigest()


def _skala(teks):
    """'0.5' -> 0.5 ; 'VH=0.5,VV=1.0' -> {'VH':0.5,'VV':1.0} (argparse type)."""
    if "=" not in teks:
        return float(teks)
    return {k.strip().upper(): float(v) for k, v in
            (bagian.split("=") for bagian in teks.split(","))}


def proses(zip_path, outdir, ref=None, skala_derau=SKALA_DERAU, simpan_derau=False,
           halus=HALUS_DERAU):
    zip_path = str(Path(zip_path).resolve())
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    z, pol = petakan_safe(zip_path)
    meta = {"sumber_zip": Path(zip_path).name, "skala_derau": skala_derau,
            "halus_derau_px": halus, "kanal": {}}
    for nama in sorted(pol):
        k_pol = skala_derau[nama] if isinstance(skala_derau, dict) else skala_derau
        keluar = outdir / f"{nama}_dB.tif"
        with tempfile.TemporaryDirectory(dir=str(outdir)) as tmp:
            radar = str(Path(tmp) / f"{nama}_sigma0_radar.tif")
            radar_derau = str(Path(tmp) / f"{nama}_derau_radar.tif") if simpan_derau else None
            print(f"[{nama}] kalibrasi sigma0 (k_derau={k_pol}, halus={halus}) "
                  f"-> geometri radar", flush=True)
            info = kalibrasi_ke_radar(z, zip_path, pol[nama], radar, k_pol,
                                      radar_derau, halus)
            with rasterio.open(radar) as d:
                gcps, _ = d.gcps
            crs, transform, lebar, tinggi = (grid_dari_acuan(ref) if ref
                                             else grid_dari_gcps(gcps))
            print(f"[{nama}] geokoding TPS -> {lebar}x{tinggi} {crs}", flush=True)
            n_nodata = geokode(radar, str(keluar), crs, transform, lebar, tinggi)
            if simpan_derau:
                geokode(radar_derau, str(outdir / f"{nama}_derau_lin.tif"),
                        crs, transform, lebar, tinggi, ke_db=False)
        kiri, atas = transform * (0, 0)
        kanan, bawah = transform * (lebar, tinggi)
        lon, lat = warp_transform(crs, CRS.from_epsg(4326),
                                  [kiri, kanan, kanan, kiri], [atas, atas, bawah, bawah])
        meta["kanal"][nama] = {**info, "path": str(keluar), "lebar": lebar, "tinggi": tinggi,
                               "crs": str(crs), "transform": list(transform)[:6],
                               "bbox_utm": [kiri, bawah, kanan, atas],
                               "bbox_wgs84": [min(lon), min(lat), max(lon), max(lat)],
                               "piksel_nodata_keluaran": n_nodata,
                               "fraksi_nodata_keluaran": round(n_nodata / (lebar * tinggi), 6),
                               "sha256": sha256(keluar)}
        print(f"[{nama}] selesai: {keluar}", flush=True)
    return meta


# --------------------------------------------------------------------- paritas

def banding(punyaku, resmi, geser=(0, 0), bin_db=0.25, rentang=(-60.0, 20.0)):
    """Metrik paritas pada piksel valid bersama; kedua raster wajib satu grid.
    `geser` = (dy, dx) piksel: punyaku[i+dy, j+dx] dipasangkan dengan resmi[i, j]."""
    with rasterio.open(punyaku) as a, rasterio.open(resmi) as b:
        if (a.width, a.height) != (b.width, b.height) or a.crs != b.crs \
                or not np.allclose(list(a.transform)[:6], list(b.transform)[:6]):
            raise ValueError("grid berbeda; selaraskan dulu (pakai --ref saat proses)")
        tepi = np.arange(rentang[0], rentang[1] + bin_db, bin_db)
        ha = np.zeros(len(tepi) - 1); hb = np.zeros(len(tepi) - 1)
        tepi_d = np.arange(-30.0, 30.0 + 0.02, 0.02)
        hd = np.zeros(len(tepi_d) - 1)
        n = sa = sb = saa = sbb = sab = sabs = 0.0
        n_dalam1 = n_a = n_b = 0
        for r0 in range(0, a.height, 1024):
            h = min(1024, a.height - r0)
            vb = b.read(1, window=Window(0, r0, b.width, h)).astype(np.float32)
            va = a.read(1, window=Window(geser[1], r0 + geser[0], a.width, h),
                        boundless=True, fill_value=NODATA).astype(np.float32)
            ma = np.isfinite(va) & (va != NODATA)
            mb = np.isfinite(vb) & (vb != NODATA)
            n_a += int(ma.sum()); n_b += int(mb.sum())
            ha += np.histogram(va[ma], bins=tepi)[0]
            hb += np.histogram(vb[mb], bins=tepi)[0]
            m = ma & mb
            if not m.any():
                continue
            x = va[m].astype(np.float64); y = vb[m].astype(np.float64)
            d = x - y
            n += x.size; sa += x.sum(); sb += y.sum()
            saa += (x * x).sum(); sbb += (y * y).sum(); sab += (x * y).sum()
            sabs += np.abs(d).sum(); n_dalam1 += int((np.abs(d) <= 1.0).sum())
            hd += np.histogram(d, bins=tepi_d)[0]
    if n == 0:
        raise ValueError("tidak ada piksel valid bersama")
    kov = sab / n - (sa / n) * (sb / n)
    sda = math.sqrt(max(saa / n - (sa / n) ** 2, 0.0))
    sdb = math.sqrt(max(sbb / n - (sb / n) ** 2, 0.0))
    kum = np.cumsum(hd) / hd.sum()
    i = int(np.searchsorted(kum, 0.5))
    median_bias = float(tepi_d[i] + 0.02 * (0.5 - (kum[i - 1] if i else 0.0)) / max(hd[i] / hd.sum(), 1e-12))
    pa = ha / max(ha.sum(), 1); pb = hb / max(hb.sum(), 1)
    return {
        "n_piksel_valid_bersama": int(n),
        "n_valid_punyaku": n_a, "n_valid_resmi": n_b,
        "pearson_r": float(kov / (sda * sdb)) if sda > 0 and sdb > 0 else None,
        "mae_db": float(sabs / n),
        "bias_median_db": median_bias,
        "bias_mean_db": float(sa / n - sb / n),
        "persen_dalam_1db": float(100.0 * n_dalam1 / n),
        "overlap_histogram": float(np.minimum(pa, pb).sum()),
        "mean_db_punyaku": float(sa / n), "mean_db_resmi": float(sb / n),
        "sd_db_punyaku": sda, "sd_db_resmi": sdb,
        "geser_baris_kolom": list(geser),
    }


def sapu_derau(notnr, derau, resmi, ks, geser=(0, 0), halus=HALUS_DERAU,
               n_pita=12, tebal=256):
    """Metrik paritas vs raster resmi untuk beberapa skala derau k sekaligus.

    Memakai operator yang sama dengan pipeline (`_rasio_derau`) tetapi dievaluasi
    di grid KELUARAN dari raster k=0 + raster derau (`proses --skala-derau 0
    --simpan-derau`), jadi satu kali rantai penuh cukup untuk menyapu banyak k.
    Beda dengan pipeline: rerata lokal dihitung sesudah geokoding, bukan sebelum;
    untuk medan selandai LUT derau selisihnya jauh di bawah 0.1 dB.
    catatan: sampel `n_pita` pita, bukan seluruh raster -- 4x10^7 piksel sudah jauh
    melewati kebutuhan presisi 0.01 dB; sapuan penuh hanya kalau k jadi angka paper.
    """
    hasil = {f"{k:g}": dict(n=0, sabs=0.0, sd=0.0, sdd=0.0, n1=0, neg=0) for k in ks}
    with rasterio.open(notnr) as A, rasterio.open(derau) as D, rasterio.open(resmi) as B:
        for r0 in np.linspace(tebal, A.height - 2 * tebal, n_pita, dtype=int):
            jb = Window(0, int(r0), B.width, tebal)
            ja = Window(geser[1], int(r0) + geser[0], A.width, tebal)
            b = B.read(1, window=jb).astype(np.float64)
            a = A.read(1, window=ja, boundless=True, fill_value=NODATA).astype(np.float64)
            d = D.read(1, window=ja, boundless=True, fill_value=0.0).astype(np.float64)
            m = (a != NODATA) & (b != NODATA) & np.isfinite(a) & np.isfinite(b) & (d > 0)
            if not m.any():
                continue
            daya = np.where(m, 10.0 ** (np.where(m, a, 0.0) / 10.0), 0.0)
            for k in ks:
                v = (daya * _rasio_derau(daya, k * d, m, halus) if halus
                     else daya - k * d)[m]
                pos = v > 0
                x = 10.0 * np.log10(v[pos])
                sel = b[m][pos]
                h = hasil[f"{k:g}"]
                h["n"] += x.size
                h["neg"] += int((~pos).sum())
                h["sabs"] += float(np.abs(x - sel).sum())
                h["sd"] += float((x - sel).sum())
                h["sdd"] += float(((x - sel) ** 2).sum())
                h["n1"] += int((np.abs(x - sel) <= 1.0).sum())
    for k, h in hasil.items():
        n = max(h["n"], 1)
        h.update(mae_db=h["sabs"] / n, bias_mean_db=h["sd"] / n,
                 rms_db=math.sqrt(h["sdd"] / n), persen_dalam_1db=100.0 * h["n1"] / n,
                 fraksi_nonpositif=h["neg"] / max(n + h["neg"], 1))
        for buang in ("sabs", "sd", "sdd", "n1"):
            h.pop(buang)
    return hasil


def geseran_terbaik(punyaku, resmi, sisi=1024, cari=12):
    """Cari geseran integer (baris, kolom) yang memaksimalkan korelasi pada satu petak tengah.
    catatan: pencarian kasar +-`cari` piksel; cukup untuk membuktikan penyelarasan grid,
    naikkan ke korelasi fase sub-piksel bila residu >1 piksel."""
    with rasterio.open(punyaku) as a, rasterio.open(resmi) as b:
        r0 = a.height // 2 - sisi // 2
        c0 = a.width // 2 - sisi // 2
        pad = cari
        jendela = Window(c0 - pad, r0 - pad, sisi + 2 * pad, sisi + 2 * pad)
        va = a.read(1, window=jendela).astype(np.float32)
        vb = b.read(1, window=jendela).astype(np.float32)
    inti_b = vb[pad:pad + sisi, pad:pad + sisi]
    terbaik = (None, -2.0)
    for dy in range(-cari, cari + 1):
        for dx in range(-cari, cari + 1):
            inti_a = va[pad + dy:pad + dy + sisi, pad + dx:pad + dx + sisi]
            m = (inti_a != NODATA) & (inti_b != NODATA) & np.isfinite(inti_a) & np.isfinite(inti_b)
            if m.sum() < sisi * sisi // 4:
                continue
            r = float(np.corrcoef(inti_a[m], inti_b[m])[0, 1])
            if r > terbaik[1]:
                terbaik = ((dy, dx), r)
    return {"geseran_baris_kolom": terbaik[0], "r_pada_geseran": terbaik[1],
            "sisi_petak": sisi, "rentang_cari_px": cari}


# ------------------------------------------------------------------ self-check

def uji():
    """Self-check tanpa data: LUT bilinear, zona UTM, pemetaan dB/nodata."""
    akar = ET.fromstring(
        "<r>" + "".join(
            f"<v><line>{l}</line><pixel>0 10 20</pixel><sigmaNought>"
            f"{l + 0.0} {l + 10.0} {l + 20.0}</sigmaNought></v>" for l in (0, 100))
        + "</r>")
    spl = _spline_lut(akar.findall("v"), "sigmaNought")
    # LUT = line + pixel, jadi interpolasi bilinear wajib eksak di titik mana pun
    assert abs(spl(50.0, 5.0).item() - 55.0) < 1e-9, spl(50.0, 5.0).item()
    assert abs(spl(0.0, 20.0).item() - 20.0) < 1e-9

    g = [GroundControlPoint(row=0, col=0, x=8.0, y=55.0),
         GroundControlPoint(row=0, col=0, x=9.0, y=56.0)]
    crs, tr, w, h = grid_dari_gcps(g)
    assert crs.to_epsg() == 32632, crs           # lon 8.5 -> UTM 32N
    assert tr.a == SPASI_M and tr.e == -SPASI_M
    assert w > 0 and h > 0

    # sigma0 bertanda -> dB: nol dan negatif (lebih-kurang derau) jadi nodata
    buf = np.array([[0.0, 1e-3, 1.0, -2e-4]], dtype=np.float32)
    db = np.where(buf > 0.0, 10.0 * np.log10(np.maximum(buf, SIGMA_MIN)), NODATA)
    assert db[0, 0] == NODATA and abs(db[0, 1] + 30.0) < 1e-4 and abs(db[0, 2]) < 1e-6
    assert db[0, 3] == NODATA
    assert np.float16(NODATA) == NODATA          # nodata bulat di float16

    # rata-rata linear membatalkan sisa negatif: urutan resample-lalu-log itu penting
    assert np.mean([-2e-4, 1.2e-3]) > 0

    assert _skala("0.5") == 0.5
    assert _skala("VH=0.5,vv=1") == {"VH": 0.5, "VV": 1.0}

    # rasio derau: medan seragam -> 1 - k*N/T persis; isian-nol tepi tidak ikut dirata
    daya = np.full((40, 40), 4.0); derau = np.full((40, 40), 1.0)
    ada = np.ones((40, 40), bool)
    r = _rasio_derau(daya, derau, ada, 8)
    assert np.allclose(r, 0.75), r[:2, :2]
    daya[:, :5] = 0.0; ada[:, :5] = False        # tepi GRD kosong
    r = _rasio_derau(daya, derau, ada, 8)
    assert np.allclose(r[:, 10:], 0.75), r[0, 10:14]   # bagian valid tak tergelapkan
    # T_lokal <= N_lokal -> jatuh ke lantai, bukan nol/negatif
    assert np.allclose(_rasio_derau(np.full((16, 16), 0.5), np.full((16, 16), 2.0),
                                    np.ones((16, 16), bool), 8), RASIO_MIN)
    print("uji: LULUS")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("proses")
    a.add_argument("zip"); a.add_argument("outdir")
    a.add_argument("--ref", help="raster acuan; grid/proyeksi/ukuran ditiru persis")
    a.add_argument("--skala-derau", type=_skala, default=SKALA_DERAU, metavar="K",
                   help="skala LUT derau termal: satu angka untuk semua kanal, atau "
                        "'VH=0.5,VV=1.0'; 0 = tanpa TNR, 1 = LUT ESA apa adanya "
                        f"(default {SKALA_DERAU}, dikalibrasi lewat `sapu-derau`)")
    a.add_argument("--halus-derau", type=int, default=HALUS_DERAU, metavar="P",
                   help="sisi kotak rerata lokal pengurangan derau; 0 = per piksel "
                        f"(default {HALUS_DERAU})")
    a.add_argument("--simpan-derau", action="store_true",
                   help="tulis juga <POL>_derau_lin.tif (masukan `sapu-derau`)")
    a.add_argument("--meta", help="tulis metadata JSON ke path ini")
    b = sub.add_parser("banding")
    b.add_argument("punyaku"); b.add_argument("resmi")
    b.add_argument("--geser", default="0,0", metavar="DY,DX",
                   help="geseran piksel yang diterapkan pada punyaku sebelum metrik")
    b.add_argument("--cari-geseran", type=int, default=0, metavar="N",
                   help="cari geseran integer terbaik dalam +-N piksel lalu pakai")
    s = sub.add_parser("sapu-derau")
    s.add_argument("notnr"); s.add_argument("derau"); s.add_argument("resmi")
    s.add_argument("--k", default="0,0.25,0.5,0.6,0.7,0.8,0.9,1.0")
    s.add_argument("--geser", default="0,0", metavar="DY,DX")
    s.add_argument("--halus-derau", type=int, default=HALUS_DERAU, metavar="P")
    sub.add_parser("uji")
    ns = p.parse_args()

    if ns.cmd == "uji":
        return uji()
    if ns.cmd == "proses":
        meta = proses(ns.zip, ns.outdir, ns.ref, ns.skala_derau, ns.simpan_derau,
                      ns.halus_derau)
        teks = json.dumps(meta, indent=1, ensure_ascii=False)
        if ns.meta:
            Path(ns.meta).write_text(teks)
        print(teks)
        return
    if ns.cmd == "sapu-derau":
        print(json.dumps(sapu_derau(ns.notnr, ns.derau, ns.resmi,
                                    [float(x) for x in ns.k.split(",")],
                                    tuple(int(x) for x in ns.geser.split(",")),
                                    ns.halus_derau), indent=1, ensure_ascii=False))
        return
    selaras = None
    geser = tuple(int(x) for x in ns.geser.split(","))
    if ns.cari_geseran:
        selaras = geseran_terbaik(ns.punyaku, ns.resmi, cari=ns.cari_geseran)
        geser = tuple(selaras["geseran_baris_kolom"])
    hasil = banding(ns.punyaku, ns.resmi, geser)
    if selaras:
        hasil["penyelarasan"] = selaras
    print(json.dumps(hasil, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())

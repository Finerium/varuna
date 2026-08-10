#!/usr/bin/env python3
"""Build T4 zone artifacts from Indonesia EEZ shapefile (Marine Regions v12).

Outputs:
  data/processed/zona/natuna_eez.geojson       - EEZ clipped to Natuna bbox (107-111 E, 3-7 N)
  data/processed/zona/idn_eez_simplified.geojson - full EEZ simplified (tol 0.01 deg)
"""
import json
from pathlib import Path

import shapefile
from shapely.geometry import shape, box, mapping
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parent.parent
SHP = ROOT / "data/raw/eez/idn_eez_v12.shp"
OUT = ROOT / "data/processed/zona"
NATUNA_BBOX = (107.0, 3.0, 111.0, 7.0)  # lon_min, lat_min, lon_max, lat_max


def load_eez():
    r = shapefile.Reader(str(SHP))
    shapes = r.shapes()
    print(f"features: {len(shapes)}, shapefile bbox: {r.bbox}")
    geoms = []
    for s in shapes:
        g = shape(s.__geo_interface__)
        if not g.is_valid:
            g = make_valid(g)
        geoms.append(g)
    assert len(geoms) == 1, f"expected 1 EEZ feature, got {len(geoms)}"  # per SOURCE.txt
    g = geoms[0]
    n_poly = len(g.geoms) if g.geom_type == "MultiPolygon" else 1
    print(f"geom type: {g.geom_type}, polygons: {n_poly}, valid: {g.is_valid}, bounds: {g.bounds}")
    return g, n_poly


def write_geojson(path, geom, props):
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": props, "geometry": mapping(geom)}]}
    path.write_text(json.dumps(fc))
    print(f"wrote {path} ({path.stat().st_size/1e6:.2f} MB)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    eez, n_poly = load_eez()

    natuna = eez.intersection(box(*NATUNA_BBOX))
    print(f"natuna clip: {natuna.geom_type}, area(deg2): {natuna.area:.3f}, bounds: {natuna.bounds}")
    write_geojson(OUT / "natuna_eez.geojson", natuna, {
        "name": "Indonesia EEZ - Natuna subset", "bbox": NATUNA_BBOX,
        "source": "Marine Regions World EEZ v12, mrgid 8492, CC-BY 4.0"})

    simp = eez.simplify(0.01, preserve_topology=True)
    print(f"simplified: valid={simp.is_valid}, bounds={simp.bounds}")
    write_geojson(OUT / "idn_eez_simplified.geojson", simp, {
        "name": "Indonesia EEZ (simplified 0.01 deg)",
        "source": "Marine Regions World EEZ v12, mrgid 8492, CC-BY 4.0"})

    return eez, natuna


if __name__ == "__main__":
    main()

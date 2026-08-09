#!/usr/bin/env python3.13
"""Point-in-zone util for T4 (uses prepared shapely geometry for fast repeated queries)."""
import json
from pathlib import Path

from shapely.geometry import shape, Point
from shapely.prepared import prep

ZONA_DIR = Path(__file__).resolve().parent.parent / "data/processed/zona"


def load_zone(name="natuna_eez"):
    """Return a prepared geometry for zone GeoJSON in data/processed/zona/."""
    fc = json.loads((ZONA_DIR / f"{name}.geojson").read_text())
    return prep(shape(fc["features"][0]["geometry"]))


def point_in_zone(prepared_zone, lon, lat):
    return prepared_zone.contains(Point(lon, lat))


if __name__ == "__main__":
    zone = load_zone("natuna_eez")
    # coords verified against the clipped geometry during build
    inside = [(108.5, 4.5), (109.0, 5.5), (107.5, 3.5)]
    outside = [(110.5, 5.0), (105.0, 5.0), (108.9, 2.0)]
    for lon, lat in inside:
        r = point_in_zone(zone, lon, lat)
        print(f"({lon}, {lat}) in ZEE Natuna: {r}")
        assert r
    for lon, lat in outside:
        r = point_in_zone(zone, lon, lat)
        print(f"({lon}, {lat}) in ZEE Natuna: {r}")
        assert not r
    print("self-test OK: 3 inside, 3 outside")

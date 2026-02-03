"""
Map and geocoding utilities using OpenStreetMap.

This module provides simple helpers to geocode locations via Nominatim
and to query Points of Interest (POIs) via the Overpass API. It
supports category‑based tag filtering so the simulation can count
relevant facilities near a user‑specified area without requiring a
paid Google Maps subscription.
"""

from __future__ import annotations

import asyncio
import json
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple, Any


async def geocode_location(query: str) -> Optional[Tuple[float, float, List[float]]]:
    """Geocode a location string using Nominatim.

    Returns (lat, lon, [south, west, north, east]) if found, else None.
    """
    if not query:
        return None
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1}
    )
    try:
        data = await asyncio.to_thread(
            lambda: json.loads(urllib.request.urlopen(url, timeout=10).read().decode("utf-8"))
        )
    except Exception:
        return None
    if not data:
        return None
    item = data[0]
    lat = float(item.get("lat"))
    lon = float(item.get("lon"))
    bbox = item.get("boundingbox") or []
    # boundingbox is [south, north, west, east] in string form
    if bbox and len(bbox) == 4:
        south, north, west, east = map(float, bbox)
    else:
        south = north = lat
        west = east = lon
    return lat, lon, [south, west, north, east]


def _build_overpass_query(lat: float, lon: float, radius: int, tags: List[str]) -> str:
    """Construct an Overpass QL query to find amenities within a radius."""
    clauses = []
    for tag in tags:
        # amenity
        clauses.append(f"node(around:{radius},{lat},{lon})[amenity={tag}];")
        clauses.append(f"way(around:{radius},{lat},{lon})[amenity={tag}];")
        clauses.append(f"relation(around:{radius},{lat},{lon})[amenity={tag}];")
    query = (
        "[out:json][timeout:25];(\n" + "\n".join(clauses) + "\n);\nout body;\n>;;\nout skel qt;"
    )
    return query


async def get_poi_counts(lat: float, lon: float, tags: List[str], radius: int = 1000) -> Dict[str, Any]:
    """Query Overpass API for given amenity tags around a coordinate.

    Returns a dictionary with counts per tag and a list of marker
    dictionaries: {lat, lon, name, tag} for display on a map.
    """
    if not tags:
        return {"counts": {}, "markers": []}
    query = _build_overpass_query(lat, lon, radius, tags)
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
    try:
        data = await asyncio.to_thread(
            lambda: json.loads(urllib.request.urlopen(url, timeout=25).read().decode("utf-8"))
        )
    except Exception:
        return {"counts": {}, "markers": []}
    elements = data.get("elements", [])
    counts: Dict[str, int] = {tag: 0 for tag in tags}
    markers: List[Dict[str, Any]] = []
    for el in elements:
        tags_dict = el.get("tags", {}) or {}
        for tag in tags:
            if tags_dict.get("amenity") == tag:
                counts[tag] = counts.get(tag, 0) + 1
                lat_el = el.get("lat") or (el.get("center", {}).get("lat"))
                lon_el = el.get("lon") or (el.get("center", {}).get("lon"))
                name = tags_dict.get("name") or tag
                if lat_el and lon_el:
                    markers.append({"lat": lat_el, "lon": lon_el, "name": name, "tag": tag})
                break
    return {"counts": counts, "markers": markers}
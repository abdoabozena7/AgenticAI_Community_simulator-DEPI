"""
OpenStreetMap geocoding and point‑of‑interest utilities.

This module wraps the Nominatim and Overpass public APIs to provide
basic geocoding and POI discovery functionality. It is designed to be
free to use (within rate limits) and does not require an API key. The
helpers return simplified structures that the frontend can easily
render on a map.

Functions:
    geocode_location(query) -> (lat, lon, bbox)
        Geocode a human‑readable location string into coordinates and a
        bounding box [south, west, north, east]. Returns None if not
        found.

    get_poi_counts(lat, lon, tags, radius=1000) -> {counts, markers}
        Query the Overpass API for POIs with the given amenity tags
        within a circular area defined by (lat, lon, radius). Returns a
        dictionary with counts per tag and a list of marker objects
        {lat, lon, name, tag}. Tags that are not found will still
        appear in the counts dictionary with value zero.
"""

from __future__ import annotations

import asyncio
import json
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple, Any


async def geocode_location(query: str) -> Optional[Tuple[float, float, List[float]]]:
    """Geocode a location string using Nominatim.

    Args:
        query: Human‑readable place name (e.g., "Cairo, Egypt").

    Returns:
        (lat, lon, [south, west, north, east]) if found, else None.
    """
    if not query:
        return None
    params = {"q": query, "format": "json", "limit": 1}
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
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
        # Query both nodes and ways with amenity=tag
        clauses.append(f"node(around:{radius},{lat},{lon})[amenity={tag}];")
        clauses.append(f"way(around:{radius},{lat},{lon})[amenity={tag}];")
        clauses.append(f"relation(around:{radius},{lat},{lon})[amenity={tag}];")
    query = "[out:json][timeout:25];(\n" + "\n".join(clauses) + "\n);out body;>;out skel qt;"
    return query


async def get_poi_counts(lat: float, lon: float, tags: List[str], radius: int = 1000) -> Dict[str, Any]:
    """Query Overpass API for given amenity tags around a coordinate.

    Args:
        lat: Latitude of the centre point.
        lon: Longitude of the centre point.
        tags: List of amenity tags (e.g., ["hospital", "clinic"]).
        radius: Search radius in metres.

    Returns:
        A dictionary with two keys:
            'counts': {tag: count, ...}
            'markers': [{lat, lon, name, tag}, ...]
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
        return {"counts": {tag: 0 for tag in tags}, "markers": []}
    elements = data.get("elements", [])
    counts: Dict[str, int] = {tag: 0 for tag in tags}
    markers: List[Dict[str, Any]] = []
    for el in elements:
        tags_dict = el.get("tags", {}) or {}
        amenity = tags_dict.get("amenity")
        if amenity not in tags:
            continue
        counts[amenity] = counts.get(amenity, 0) + 1
        lat_el = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        lon_el = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if lat_el and lon_el:
            name = tags_dict.get("name") or amenity
            markers.append({"lat": lat_el, "lon": lon_el, "name": name, "tag": amenity})
    return {"counts": counts, "markers": markers}
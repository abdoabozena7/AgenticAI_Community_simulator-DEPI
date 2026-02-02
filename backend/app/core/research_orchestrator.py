"""
Research orchestration for the idea simulator.

This module provides a high‑level helper that combines multi‑provider web
search, structured market insight extraction, and optional geographic
analysis via OpenStreetMap. It is intended to support the
"Agent Research" stage before simulation, packaging the search
results, evidence cards, and map data into a single payload.
"""

from __future__ import annotations

import asyncio
from typing import Dict, Optional, Tuple, List, Any

from .web_search import search_web
from .map_tools import geocode_location, get_poi_counts


# Mapping from idea categories to POI tags for map analysis
CATEGORY_POI_TAGS: Dict[str, List[str]] = {
    "finance": ["bank", "atm"],
    "healthcare": ["hospital", "clinic", "pharmacy"],
    "education": ["school", "college", "university"],
    "e-commerce": ["mall", "shop"],
    "hardware": ["hardware", "electronics"],
    "technology": ["coworking", "electronics"],
    "social": ["cafe", "pub"],
    "entertainment": ["cinema", "theatre"],
    "default": ["restaurant", "cafe", "park"],
}


async def run_research(
    query: str,
    location: Optional[str] = None,
    category: Optional[str] = None,
    language: str = "en",
) -> Dict[str, Any]:
    """Run a research session combining web search and map analysis.

    Args:
        query: The main idea or concept to research.
        location: Optional human‑readable location to geocode.
        category: Optional idea category used for selecting POI tags.
        language: Desired language for search summarisation.

    Returns:
        A dictionary with keys: 'search', 'map', 'structured', 'evidence_cards'.
    """
    search_result = await search_web(query=query, max_results=5, language=language or "en")
    structured = search_result.get("structured") or {}
    evidence_cards = structured.get("evidence_cards") or []
    map_data: Dict[str, Any] = {}
    if location:
        geo = await geocode_location(location)
        if geo:
            lat, lon, _bbox = geo
            cat_key = (category or "").lower()
            tags = CATEGORY_POI_TAGS.get(cat_key, CATEGORY_POI_TAGS["default"])
            map_data = await get_poi_counts(lat=lat, lon=lon, tags=tags)
            map_data["center"] = {"lat": lat, "lon": lon}
            map_data["tags"] = tags
    return {
        "search": search_result,
        "map": map_data,
        "structured": structured,
        "evidence_cards": evidence_cards,
    }
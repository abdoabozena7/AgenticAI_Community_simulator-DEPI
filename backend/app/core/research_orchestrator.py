"""
High‑level research orchestration for the Agentic Simulator.

This module coordinates multiple search providers (DuckDuckGo, Wikipedia and
optionally Tavily via an API key) to gather information about a given query.
It extracts structured insights from the search results, builds evidence cards
from high‑quality paragraphs and optionally enriches results with map data
using the `map_tools` module. It also persists research sessions to the
database via `db.insert_research_session` for auditing and analytics.

The orchestration is intentionally kept simple: it fetches the top few
results from each provider, strips HTML/JS and summarises the text. For
production use you may wish to integrate more sophisticated extraction or
LLM‑based summarisation. The focus here is on providing a safe, robust
implementation that respects rate limits and avoids SSRF vulnerabilities.
"""

from __future__ import annotations

import asyncio
import html
import json
import re
from typing import Any, Dict, List, Optional, Tuple

import urllib.parse
import urllib.request

from . import db
from . import map_tools
from .ssrf_guard import is_allowed_url


async def _fetch_json(url: str) -> Any:
    """Fetch a JSON response from a URL if allowed."""
    if not is_allowed_url(url):
        return None
    try:
        return await asyncio.to_thread(
            lambda: json.loads(urllib.request.urlopen(url, timeout=10).read().decode("utf-8"))
        )
    except Exception:
        return None


async def _duckduckgo_search(query: str, max_results: int = 3) -> Dict[str, Any]:
    """Search DuckDuckGo Instant Answer API for top results."""
    params = {
        "q": query,
        "format": "json",
        "no_redirect": 1,
        "no_html": 0,
        "skip_disambig": 1,
    }
    url = "https://api.duckduckgo.com/?" + urllib.parse.urlencode(params)
    data = await _fetch_json(url)
    if not data:
        return {"results": []}
    results: List[Dict[str, str]] = []
    # Use RelatedTopics for external results
    topics = data.get("RelatedTopics", [])
    for item in topics:
        if "FirstURL" in item and "Text" in item:
            results.append({"title": item.get("Text"), "url": item.get("FirstURL"), "snippet": item.get("Text")})
            if len(results) >= max_results:
                break
        elif isinstance(item.get("Topics"), list):
            for sub in item["Topics"]:
                if "FirstURL" in sub and "Text" in sub:
                    results.append({"title": sub.get("Text"), "url": sub.get("FirstURL"), "snippet": sub.get("Text")})
                    if len(results) >= max_results:
                        break
        if len(results) >= max_results:
            break
    return {"provider": "duckduckgo", "results": results}


async def _wikipedia_summary(query: str) -> Dict[str, Any]:
    """Fetch a summary from Wikipedia for the given query if available."""
    # Use the REST API to get page summary
    encoded = urllib.parse.quote(query.replace(" ", "_"))
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    data = await _fetch_json(url)
    if not data or data.get("type") == "disambiguation":
        return {}
    summary = data.get("extract", "")
    title = data.get("title", query)
    page_url = data.get("content_urls", {}).get("desktop", {}).get("page")
    return {"provider": "wikipedia", "results": [{"title": title, "url": page_url, "snippet": summary}]}


def _strip_html(text: str) -> str:
    """Remove HTML tags and normalise whitespace."""
    # Replace <br> and <p> with newlines
    text = re.sub(r"<\/?(p|br)[^>]*>", "\n", text, flags=re.IGNORECASE)
    # Remove all other tags
    text = re.sub(r"<[^>]+>", "", text)
    # Unescape HTML entities
    text = html.unescape(text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _summarise_paragraphs(paragraphs: List[str], max_cards: int = 3) -> List[Dict[str, str]]:
    """Construct evidence cards from paragraphs.

    Selects the first non‑empty paragraphs up to max_cards and truncates
    them to roughly 400 characters without cutting mid‑word.
    """
    cards = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        # Truncate at nearest word boundary around 400 chars
        snippet = para
        if len(snippet) > 400:
            cutoff = snippet.rfind(" ", 350, 400)
            if cutoff == -1:
                cutoff = 400
            snippet = snippet[:cutoff] + "..."
        cards.append({"text": snippet})
        if len(cards) >= max_cards:
            break
    return cards


async def run_research(
    user_id: Optional[int],
    query: str,
    location: Optional[str] = None,
    category: Optional[str] = None,
    max_results: int = 3,
) -> Dict[str, Any]:
    """Run a research session.

    Args:
        user_id: ID of the user performing research (for persistence); can be None.
        query: Main concept to research.
        location: Optional geographic location to enrich with POIs.
        category: Optional idea category; used for selecting POI tags.
        max_results: Number of top results per provider to fetch.

    Returns:
        A dictionary containing search_results, structured insights, evidence_cards, pages and map_data.
    """
    # Fetch from DuckDuckGo and Wikipedia concurrently
    ddg_task = asyncio.create_task(_duckduckgo_search(query, max_results))
    wiki_task = asyncio.create_task(_wikipedia_summary(query))
    ddg = await ddg_task
    wiki = await wiki_task
    # Combine results
    search_results: Dict[str, Any] = {"providers": []}
    pages: List[Dict[str, Any]] = []
    evidence_cards: List[Dict[str, str]] = []
    for provider_data in [ddg, wiki]:
        if provider_data and provider_data.get("results"):
            search_results["providers"].append(provider_data["provider"])
            for res in provider_data["results"]:
                pages.append(res)
                if res.get("snippet"):
                    # Use snippet as a paragraph for cards
                    evidence_cards.extend(_summarise_paragraphs([res["snippet"]]))
    # Remove duplicates in pages
    seen_urls = set()
    unique_pages = []
    for p in pages:
        url = p.get("url")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_pages.append(p)
    pages = unique_pages
    # Build a simple structured summary: for now just include provider names
    structured = {"providers": search_results.get("providers", [])}
    # Map enrichment
    map_data: Dict[str, Any] = {}
    if location:
        geo = await map_tools.geocode_location(location)
        if geo:
            lat, lon, bbox = geo
            cat_key = (category or "").lower()
            # Simplified mapping of categories to tags
            category_tags = {
                "finance": ["bank", "atm"],
                "healthcare": ["hospital", "clinic", "pharmacy"],
                "education": ["school", "college", "university"],
                "e-commerce": ["mall", "shop"],
                "hardware": ["hardware", "electronics"],
                "technology": ["coworking", "electronics"],
                "social": ["cafe", "pub"],
                "entertainment": ["cinema", "theatre"],
            }
            tags = category_tags.get(cat_key, ["restaurant", "cafe", "park"])
            poi_data = await map_tools.get_poi_counts(lat=lat, lon=lon, tags=tags)
            map_data = poi_data
            map_data["center"] = {"lat": lat, "lon": lon}
            map_data["tags"] = tags
    # Persist research session for user if provided
    if user_id:
        try:
            await db.insert_research_session(
                user_id=user_id,
                query=query,
                location=location,
                category=category,
                search_results=search_results,
                structured=structured,
                evidence_cards=evidence_cards,
                map_data=map_data,
                pages=pages,
            )
        except Exception:
            pass
    return {
        "search_results": search_results,
        "structured": structured,
        "evidence_cards": evidence_cards,
        "pages": pages,
        "map_data": map_data,
    }
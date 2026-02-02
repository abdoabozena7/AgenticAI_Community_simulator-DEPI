"""
Web search integration (Tavily with LLM fallback).

Uses a live search provider when API keys are available. If no live
provider is configured, falls back to an LLM-generated "simulated"
search summary to keep the UX consistent.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .ollama_client import generate_ollama


def _post_json(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def _normalize_query(query: str) -> str:
    return re.sub(r"\s+", " ", query).strip()


def _extract_domain(url: str) -> str:
    match = re.search(r"https?://([^/]+)/?", url)
    return match.group(1).lower() if match else url


def _keyword_reason(query: str, title: str, snippet: str) -> str:
    terms = [t for t in re.split(r"[^a-zA-Z0-9\u0600-\u06FF]+", query.lower()) if len(t) > 2]
    haystack = f"{title} {snippet}".lower()
    matched = [t for t in terms if t in haystack]
    if matched:
        return f"Matches keywords: {', '.join(matched[:4])}."
    return "Topical match based on the query intent."


async def _tavily_search(query: str, max_results: int, language: str) -> Dict[str, Any]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError("Tavily API key not set")
    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
        "include_answer": True,
        "include_raw_content": False,
        "include_images": False,
        "language": language or "en",
    }
    result = await asyncio.to_thread(_post_json, "https://api.tavily.com/search", payload)
    results = []
    for item in result.get("results", []) or []:
        title = item.get("title") or ""
        url = item.get("url") or ""
        snippet = item.get("content") or ""
        results.append(
            {
                "title": title,
                "url": url,
                "domain": _extract_domain(url),
                "snippet": snippet[:280],
                "score": item.get("score"),
                "reason": _keyword_reason(query, title, snippet),
            }
        )
    return {
        "provider": "tavily",
        "is_live": True,
        "answer": (result.get("answer") or "").strip(),
        "results": results,
    }


async def _llm_fallback(query: str) -> Dict[str, Any]:
    prompt = (
        "You are simulating web search results. Return JSON only with keys: "
        "answer (string) and results (array of 3 items). Each item must have "
        "title, url, snippet. Keep results plausible and diverse.\n"
        f"Query: {query}"
    )
    raw = await generate_ollama(prompt=prompt, temperature=0.4, response_format="json")
    data = json.loads(raw)
    results = []
    for item in data.get("results", [])[:3]:
        url = item.get("url", "")
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        results.append(
            {
                "title": title,
                "url": url,
                "domain": _extract_domain(url),
                "snippet": snippet[:280],
                "score": None,
                "reason": _keyword_reason(query, title, snippet),
            }
        )
    return {
        "provider": "llm_fallback",
        "is_live": False,
        "answer": (data.get("answer") or "").strip(),
        "results": results,
    }


def _validate_structured(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    required = ["summary", "signals", "competition_level", "demand_level", "regulatory_risk"]
    if not all(key in data for key in required):
        return {}
    if not isinstance(data.get("signals"), list):
        return {}
    return data


def _build_evidence_cards(structured: Dict[str, Any], language: str) -> List[str]:
    cards: List[str] = []
    summary = str(structured.get("summary") or "").strip()
    if summary:
        sentences = [s.strip() for s in re.split(r"[.!?؟]", summary) if len(s.strip()) > 12]
        cards.extend(sentences[:3])
    signals = structured.get("signals") or []
    if isinstance(signals, list):
        cards.extend(str(s).strip() for s in signals[:4] if str(s).strip())

    def _level_label(key: str, value: str) -> Optional[str]:
        if not value:
            return None
        if language == "ar":
            name_map = {
                "competition_level": "مستوى المنافسة",
                "demand_level": "مستوى الطلب",
                "regulatory_risk": "مخاطر تنظيمية",
                "price_sensitivity": "حساسية السعر",
            }
            return f"{name_map.get(key, key)}: {value}"
        return f"{key.replace('_', ' ')}: {value}"

    for key in ("competition_level", "demand_level", "regulatory_risk", "price_sensitivity"):
        label = _level_label(key, str(structured.get(key) or ""))
        if label:
            cards.append(label)

    # Deduplicate while preserving order
    seen = set()
    unique_cards = []
    for card in cards:
        if card and card not in seen:
            seen.add(card)
            unique_cards.append(card)
    return unique_cards[:6]


async def _extract_structured(query: str, answer: str, results: List[Dict[str, Any]], language: str) -> Dict[str, Any]:
    snippets = "\n".join(
        f"- {r.get('title','')}: {r.get('snippet','')}" for r in results[:5]
    )
    prompt = (
        "You turn web search results into a structured market signal summary. "
        "Return JSON only with keys: summary (string), signals (array of short bullets), "
        "competition_level (low/medium/high), demand_level (low/medium/high), "
        "regulatory_risk (low/medium/high), price_sensitivity (low/medium/high), "
        "notable_locations (array), gaps (array of missing info), sources (array of {title,url,domain}). "
        "Use the query and snippets; do not invent specific facts. "
        f"Language: {language}. "
        f"Query: {query}\n"
        f"Answer: {answer}\n"
        f"Snippets:\n{snippets}\n"
    )
    raw = await generate_ollama(prompt=prompt, temperature=0.3, response_format="json")
    data = json.loads(raw)
    sources = []
    for r in results[:5]:
        sources.append({
            "title": r.get("title"),
            "url": r.get("url"),
            "domain": r.get("domain"),
        })
    data.setdefault("sources", sources)
    return data


async def search_web(query: str, max_results: int = 5, language: str = "en") -> Dict[str, Any]:
    normalized = _normalize_query(query)
    if not normalized:
        return {
            "provider": "none",
            "is_live": False,
            "answer": "",
            "results": [],
        }
    try:
        result = await _tavily_search(normalized, max_results=max_results, language=language)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError):
        result = await _llm_fallback(normalized)

    # Structured summary with timeout and fallback
    structured: Dict[str, Any] = {}
    for _ in range(2):
        try:
            structured = await asyncio.wait_for(
                _extract_structured(
                    normalized,
                    result.get("answer", ""),
                    result.get("results", []),
                    language or "en",
                ),
                timeout=6.0,
            )
            structured = _validate_structured(structured)
            if structured:
                break
        except Exception:
            structured = {}
    if not structured:
        structured = {
            "summary": (result.get("answer") or "").strip(),
            "signals": [],
            "competition_level": "medium",
            "demand_level": "medium",
            "regulatory_risk": "medium",
            "price_sensitivity": "medium",
            "notable_locations": [],
            "gaps": [],
            "sources": [
                {"title": r.get("title"), "url": r.get("url"), "domain": r.get("domain")}
                for r in result.get("results", [])[:5]
            ],
        }
    structured["evidence_cards"] = _build_evidence_cards(structured, language or "en")
    result["structured"] = structured
    return result

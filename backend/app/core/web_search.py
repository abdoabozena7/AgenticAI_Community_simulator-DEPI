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
        return await _tavily_search(normalized, max_results=max_results, language=language)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError):
        return await _llm_fallback(normalized)

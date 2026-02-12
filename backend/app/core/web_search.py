"""
Web search integration with strict live-web mode support.

By default, this module runs in strict mode and avoids synthetic
search fabrication when live sources are unavailable.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import html
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

from .ollama_client import generate_ollama


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


STRICT_WEB_ONLY_DEFAULT = _env_flag("SEARCH_WEB_ONLY_STRICT", True)
ALLOW_SYNTHETIC_SEARCH_FALLBACK = _env_flag("SEARCH_ALLOW_LLM_FALLBACK", False)


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


def _contains_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", str(text or "")))


def _compact_query(query: str, max_terms: int = 14) -> str:
    cleaned = re.sub(r"[\"'`]+", " ", str(query or ""))
    cleaned = re.sub(r"[^\w\s\u0600-\u06FF-]+", " ", cleaned, flags=re.UNICODE)
    terms = [t for t in cleaned.split() if len(t.strip()) > 1]
    return " ".join(terms[:max_terms]).strip()


def _extract_domain(url: str) -> str:
    match = re.search(r"https?://([^/]+)/?", url)
    return match.group(1).lower() if match else url


def _build_favicon_url(domain: str) -> str:
    host = str(domain or "").strip()
    if not host:
        return ""
    return f"https://www.google.com/s2/favicons?domain={host}&sz=64"


def _decode_ddg_redirect(url: str) -> str:
    """DuckDuckGo HTML results use redirect links with ``uddg`` query param."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    if raw.startswith("//"):
        raw = f"https:{raw}"
    try:
        parsed = urllib.parse.urlparse(raw)
        query = urllib.parse.parse_qs(parsed.query)
        uddg = query.get("uddg")
        if uddg and isinstance(uddg, list):
            return urllib.parse.unquote(uddg[0])
    except Exception:
        pass
    return raw


def _keyword_reason(query: str, title: str, snippet: str) -> str:
    terms = [t for t in re.split(r"[^a-zA-Z0-9\u0600-\u06FF]+", query.lower()) if len(t) > 2]
    haystack = f"{title} {snippet}".lower()
    matched = [t for t in terms if t in haystack]
    if matched:
        return f"Matches keywords: {', '.join(matched[:4])}."
    return "Topical match based on the query intent."


def _compute_search_quality(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(results or [])
    usable = 0
    domains = set()
    for item in results or []:
        url = str(item.get("url") or "").strip()
        domain = str(item.get("domain") or "").strip().lower()
        snippet = str(item.get("snippet") or "").strip()
        title = str(item.get("title") or "").strip()
        if domain:
            domains.add(domain)
        if url and (len(snippet) >= 80 or len(title) >= 8):
            usable += 1
    return {
        "usable_sources": usable,
        "domains": len(domains),
        "extraction_success_rate": (usable / total) if total > 0 else 0.0,
    }


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
                "favicon_url": _build_favicon_url(_extract_domain(url)),
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


# New search providers: DuckDuckGo and Wikipedia
async def _ddg_search(query: str, max_results: int, language: str) -> Dict[str, Any]:
    """Perform a DuckDuckGo HTML search and parse real web results."""
    try:
        url = "https://duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query, "kl": "wt-wt"})
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; AgenticSimulator/1.0; +https://duckduckgo.com)",
                "Accept-Language": "ar,en;q=0.8" if language.lower().startswith("ar") else "en-US,en;q=0.8",
            },
        )
        html_text = await asyncio.to_thread(lambda: urllib.request.urlopen(req, timeout=12).read().decode("utf-8", "ignore"))
    except Exception:
        return {"provider": "duckduckgo", "is_live": False, "answer": "", "results": []}

    results: List[Dict[str, Any]] = []
    anchor_matches = list(
        re.finditer(
            r'<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            html_text,
            flags=re.S,
        )
    )
    snippet_matches = list(
        re.finditer(
            r'<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>(.*?)</a>|'
            r'<div[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>(.*?)</div>',
            html_text,
            flags=re.S,
        )
    )

    for idx, anchor in enumerate(anchor_matches):
        if len(results) >= max_results:
            break
        raw_url = html.unescape(anchor.group(1) or "").strip()
        url_item = _decode_ddg_redirect(raw_url)
        title_raw = anchor.group(2) or ""
        title = html.unescape(re.sub(r"<[^>]+>", "", title_raw)).strip()
        if not url_item or not title:
            continue
        snippet = ""
        if idx < len(snippet_matches):
            snippet_raw = snippet_matches[idx].group(1) or snippet_matches[idx].group(2) or ""
            snippet = html.unescape(re.sub(r"<[^>]+>", "", snippet_raw)).strip()
        results.append(
            {
                "title": title,
                "url": url_item,
                "domain": _extract_domain(url_item),
                "favicon_url": _build_favicon_url(_extract_domain(url_item)),
                "snippet": snippet[:280],
                "score": 0.6,
                "http_status": 200,
                "reason": _keyword_reason(query, title, snippet),
            }
        )

    return {
        "provider": "duckduckgo",
        "is_live": True,
        "answer": "",
        "results": results,
    }


async def _ddg_lite_search(query: str, max_results: int, language: str) -> Dict[str, Any]:
    """Fallback DuckDuckGo provider using the lite HTML endpoint.

    The lite page is often less fragile than the default HTML page and has
    stable ``result-link`` / ``result-snippet`` markers.
    """
    try:
        url = "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query, "kl": "wt-wt"})
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; AgenticSimulator/1.0; +https://duckduckgo.com)",
                "Accept-Language": "ar,en;q=0.8" if language.lower().startswith("ar") else "en-US,en;q=0.8",
            },
        )
        html_text = await asyncio.to_thread(
            lambda: urllib.request.urlopen(req, timeout=12).read().decode("utf-8", "ignore")
        )
    except Exception:
        return {"provider": "duckduckgo_lite", "is_live": False, "answer": "", "results": []}

    anchors: List[tuple[str, str]] = []
    for match in re.finditer(r"(<a\b[^>]*>)(.*?)</a>", html_text, flags=re.S | re.I):
        tag = match.group(1) or ""
        if "result-link" not in tag:
            continue
        href_match = re.search(r'href=[\"\']([^\"\']+)[\"\']', tag, flags=re.I)
        href = html.unescape((href_match.group(1) if href_match else "") or "").strip()
        title = html.unescape(re.sub(r"<[^>]+>", "", match.group(2) or "")).strip()
        if href and title:
            anchors.append((href, title))

    snippets: List[str] = []
    for snippet_match in re.finditer(
        r"<td[^>]*class=['\"][^'\"]*result-snippet[^'\"]*['\"][^>]*>(.*?)</td>",
        html_text,
        flags=re.S | re.I,
    ):
        snippet_html = snippet_match.group(1) or ""
        snippet = html.unescape(re.sub(r"<[^>]+>", "", snippet_html)).strip()
        snippets.append(snippet)

    results: List[Dict[str, Any]] = []
    for idx, (raw_url, title) in enumerate(anchors):
        if len(results) >= max_results:
            break
        url_item = _decode_ddg_redirect(raw_url)
        if not url_item:
            continue
        snippet = snippets[idx] if idx < len(snippets) else ""
        results.append(
            {
                "title": title,
                "url": url_item,
                "domain": _extract_domain(url_item),
                "favicon_url": _build_favicon_url(_extract_domain(url_item)),
                "snippet": snippet[:280],
                "score": 0.58,
                "http_status": 200,
                "reason": _keyword_reason(query, title, snippet),
            }
        )

    return {
        "provider": "duckduckgo_lite",
        "is_live": True,
        "answer": "",
        "results": results,
    }


async def _wikipedia_search(query: str, max_results: int, language: str) -> Dict[str, Any]:
    """Perform a Wikipedia API search.

    Returns at most ``max_results`` items with title, url, snippet and reason.
    """
    # Use English Wikipedia if language not Arabic; for Arabic use ar.wikipedia
    lang_code = "ar" if language.lower().startswith("ar") else "en"
    try:
        url = (
            f"https://{lang_code}.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
                "action": "query",
                "list": "search",
                "srsearch": query,
                "utf8": "",
                "format": "json",
            })
        )
        data = await asyncio.to_thread(lambda: json.loads(urllib.request.urlopen(url, timeout=10).read().decode("utf-8")))
    except Exception:
        return {"provider": "wikipedia", "is_live": False, "answer": "", "results": []}
    results: List[Dict[str, Any]] = []
    for item in (data.get("query", {}).get("search", []) or [])[:max_results]:
        title = item.get("title") or ""
        snippet_html = item.get("snippet") or ""
        # Remove HTML tags
        snippet_text = re.sub(r"<[^>]+>", "", snippet_html)
        page_url = f"https://{lang_code}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        results.append(
            {
                "title": title,
                "url": page_url,
                "domain": _extract_domain(page_url),
                "favicon_url": _build_favicon_url(_extract_domain(page_url)),
                "snippet": snippet_text[:280],
                "score": None,
                "reason": _keyword_reason(query, title, snippet_text),
            }
        )
    return {
        "provider": "wikipedia",
        "is_live": True,
        "answer": "",
        "results": results,
    }


async def _bing_rss_search(query: str, max_results: int, language: str) -> Dict[str, Any]:
    """Fallback live search provider using Bing RSS feed."""
    try:
        feed_url = "https://www.bing.com/search?" + urllib.parse.urlencode(
            {
                "q": query,
                "format": "rss",
                "setlang": "ar" if language.lower().startswith("ar") else "en",
            }
        )
        req = urllib.request.Request(
            feed_url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; AgenticSimulator/1.0)",
                "Accept-Language": "ar,en;q=0.8" if language.lower().startswith("ar") else "en-US,en;q=0.8",
            },
        )
        xml_body = await asyncio.to_thread(lambda: urllib.request.urlopen(req, timeout=12).read().decode("utf-8", "ignore"))
        root = ET.fromstring(xml_body)
    except Exception:
        return {"provider": "bing_rss", "is_live": False, "answer": "", "results": []}

    results: List[Dict[str, Any]] = []
    for item in root.findall(".//item"):
        if len(results) >= max_results:
            break
        title = (item.findtext("title") or "").strip()
        url_item = (item.findtext("link") or "").strip()
        snippet = (item.findtext("description") or "").strip()
        if not url_item or not title:
            continue
        results.append(
            {
                "title": title,
                "url": url_item,
                "domain": _extract_domain(url_item),
                "favicon_url": _build_favicon_url(_extract_domain(url_item)),
                "snippet": snippet[:280],
                "score": 0.55,
                "http_status": 200,
                "reason": _keyword_reason(query, title, snippet),
            }
        )

    return {
        "provider": "bing_rss",
        "is_live": True,
        "answer": "",
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
                "favicon_url": _build_favicon_url(_extract_domain(url)),
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
        sentences = [s.strip() for s in re.split(r"[.!?]", summary) if len(s.strip()) > 12]
        cards.extend(sentences[:3])
    signals = structured.get("signals") or []
    if isinstance(signals, list):
        cards.extend(str(s).strip() for s in signals[:4] if str(s).strip())

    def _level_label(key: str, value: str) -> Optional[str]:
        if not value:
            return None
        if language == "ar":
            name_map = {
                "competition_level": "Competition level",
                "demand_level": "Demand level",
                "regulatory_risk": "Regulatory risk",
                "price_sensitivity": "Price sensitivity",
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


def _fallback_summary_from_results(results: List[Dict[str, Any]], language: str) -> str:
    snippets: List[str] = []
    for item in results[:3]:
        title = str(item.get("title") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        if title and snippet:
            snippets.append(f"{title}: {snippet}")
        elif title:
            snippets.append(title)
    if not snippets:
        return ""
    if (language or "").lower().startswith("ar"):
        return "Quick summary from search results: " + " | ".join(snippets)
    return "Quick summary from live search results: " + " | ".join(snippets)


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


async def search_web(
    query: str,
    max_results: int = 5,
    language: str = "en",
    strict_web_only: Optional[bool] = None,
) -> Dict[str, Any]:
    normalized = _normalize_query(query)
    strict_mode = STRICT_WEB_ONLY_DEFAULT if strict_web_only is None else bool(strict_web_only)
    if not normalized:
        return {
            "provider": "none",
            "is_live": False,
            "answer": "",
            "results": [],
            "strict_mode": strict_mode,
            "quality": {
                "usable_sources": 0,
                "domains": 0,
                "extraction_success_rate": 0.0,
            },
        }
    # Try Tavily first if API key is available
    try:
        result = await _tavily_search(normalized, max_results=max_results, language=language)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError, Exception):
        # If Tavily not configured or fails, try DuckDuckGo
        result = await _ddg_search(normalized, max_results=max_results, language=language)
        if not result.get("results"):
            result = await _ddg_lite_search(normalized, max_results=max_results, language=language)
        if not result.get("results"):
            compact_query = _compact_query(normalized)
            if compact_query and compact_query != normalized:
                compact_result = await _ddg_search(compact_query, max_results=max_results, language=language)
                if not compact_result.get("results"):
                    compact_result = await _ddg_lite_search(compact_query, max_results=max_results, language=language)
                if compact_result.get("results"):
                    result = compact_result
        if not result.get("results"):
            # Fallback to Bing RSS if DDG fails/returns empty.
            bing_result = await _bing_rss_search(normalized, max_results=max_results, language=language)
            if bing_result.get("results"):
                result = bing_result
        if not result.get("results"):
            # Try Wikipedia as fallback
            wiki_result = await _wikipedia_search(normalized, max_results=max_results, language=language)
            if wiki_result.get("results"):
                result = wiki_result
        if not result.get("results") and _contains_arabic(normalized):
            # Arabic queries can intermittently return zero results from one provider.
            # Retry with a compact bilingual query while staying web-only.
            fallback_query = f"{_compact_query(normalized)} market demand competition pricing regulation".strip()
            if fallback_query:
                ddg_retry = await _ddg_search(fallback_query, max_results=max_results, language=language)
                if not ddg_retry.get("results"):
                    ddg_retry = await _ddg_lite_search(fallback_query, max_results=max_results, language=language)
                if ddg_retry.get("results"):
                    result = ddg_retry
        if not result.get("results"):
            # Last live-web rescue query stays anchored to user intent.
            rescue_query = f"{_compact_query(normalized)} market analysis demand competition pricing regulation".strip()
            ddg_rescue = await _ddg_search(rescue_query, max_results=max_results, language=language)
            if not ddg_rescue.get("results"):
                ddg_rescue = await _ddg_lite_search(rescue_query, max_results=max_results, language=language)
            if not ddg_rescue.get("results"):
                bing_rescue = await _bing_rss_search(rescue_query, max_results=max_results, language=language or "en")
                if bing_rescue.get("results"):
                    ddg_rescue = bing_rescue
            if not ddg_rescue.get("results"):
                wiki_rescue = await _wikipedia_search(rescue_query, max_results=max_results, language=language or "en")
                if wiki_rescue.get("results"):
                    ddg_rescue = wiki_rescue
            if ddg_rescue.get("results"):
                result = ddg_rescue
        # Optional synthetic fallback (disabled by default and always disabled in strict mode).
        if not result.get("results") and not strict_mode and ALLOW_SYNTHETIC_SEARCH_FALLBACK:
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
    if not str(structured.get("summary") or "").strip():
        structured["summary"] = _fallback_summary_from_results(result.get("results") or [], language or "en")
    structured["evidence_cards"] = _build_evidence_cards(structured, language or "en")
    quality = _compute_search_quality(result.get("results") or [])
    result["structured"] = structured
    result["strict_mode"] = strict_mode
    result["quality"] = quality
    return result

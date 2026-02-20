"""
Lightweight page fetch + text extraction with SSRF guards.
"""

from __future__ import annotations

import html
import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from typing import Any, Dict


_BLOCKED_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _is_public_host(host: str) -> bool:
    raw_host = str(host or "").strip().lower()
    if not raw_host or raw_host in _BLOCKED_HOSTS:
        return False
    try:
        infos = socket.getaddrinfo(raw_host, None)
    except Exception:
        return False
    for info in infos:
        ip_str = info[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except Exception:
            return False
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            return False
    return True


def _extract_title(html_text: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    value = re.sub(r"\s+", " ", html.unescape(match.group(1) or "")).strip()
    return value[:512]


def _extract_text(html_text: str, max_chars: int = 6000) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html_text)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<noscript[^>]*>.*?</noscript>", " ", text)
    text = re.sub(r"(?is)<svg[^>]*>.*?</svg>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


def _fetch_page_sync(url: str, timeout: int = 12) -> Dict[str, Any]:
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        return {"ok": False, "error": "Unsupported URL scheme"}
    if not _is_public_host(parsed.hostname or ""):
        return {"ok": False, "error": "Blocked host"}

    req = urllib.request.Request(
        parsed.geturl(),
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; AgenticResearch/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8,ar;q=0.7",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = int(getattr(response, "status", 200) or 200)
            body = response.read()
            content_type = str(response.headers.get("Content-Type") or "").lower()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        return {
            "ok": False,
            "http_status": status,
            "error": f"Unsupported content type: {content_type or 'unknown'}",
        }

    html_text = body.decode("utf-8", errors="ignore")
    title = _extract_title(html_text)
    extracted = _extract_text(html_text, max_chars=6000)
    if not extracted:
        return {
            "ok": False,
            "http_status": status,
            "title": title,
            "error": "Empty extracted content",
        }
    return {
        "ok": True,
        "http_status": status,
        "title": title,
        "content": extracted,
        "content_chars": len(extracted),
        "preview": extracted[:420],
    }


async def fetch_page(url: str, timeout: int = 12) -> Dict[str, Any]:
    import asyncio

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_fetch_page_sync, url, timeout),
            timeout=max(4, int(timeout) + 2),
        )
    except asyncio.TimeoutError:
        return {"ok": False, "error": "Fetch timed out"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

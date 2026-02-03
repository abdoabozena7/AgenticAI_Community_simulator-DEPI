"""
Server-Side Request Forgery (SSRF) guard.

This module exposes a single helper function `is_allowed_url` which
validates a URL before the backend fetches external resources. It
prevents requests to localhost, private IP ranges and disallowed
schemes (anything other than http and https). Use it to protect
against SSRF vulnerabilities when integrating third‑party APIs.
"""

from __future__ import annotations

import ipaddress
import urllib.parse
from typing import Optional


def _is_private_ip(host: str) -> bool:
    """Return True if the host resolves to a private or loopback IP address."""
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_multicast
    except ValueError:
        # Not an IP literal; domain names are allowed (DNS resolution will happen later)
        return False


def is_allowed_url(url: str) -> bool:
    """Check whether a URL is safe to fetch externally.

    Only http and https schemes are permitted. Localhost, private and reserved
    IP addresses are blocked. Note that this does not perform DNS lookup.
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    host = parsed.hostname or ""
    # Reject empty host
    if not host:
        return False
    # Block explicit localhost and private IPs
    if host in {"localhost", "127.0.0.1", "::1"}:
        return False
    if _is_private_ip(host):
        return False
    return True
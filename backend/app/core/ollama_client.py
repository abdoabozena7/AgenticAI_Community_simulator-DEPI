"""
Minimal Ollama client for local LLM inference.

This client wraps simple HTTP calls to a locally running Ollama server. It
provides an async function to generate a completion given a prompt and
optional parameters. The implementation is intentionally lightweight
without external dependencies so it can be used in constrained
environments. If the request fails or the response is invalid, a
RuntimeError is raised.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, List

_MODEL_CACHE: Optional[List[str]] = None


def _post_json(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def _get_json(url: str) -> Dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def _select_model(models: List[str]) -> Optional[str]:
    if not models:
        return None
    # Prefer gpt-oss variants if present
    for preferred in (
        "gpt-oss:20b-cloud",
        "gpt-oss:120b-cloud",
        "gpt-oss:20b",
        "gpt-oss:120b",
    ):
        if preferred in models:
            return preferred
    return models[0]


async def generate_ollama(
    prompt: str,
    system: Optional[str] = None,
    temperature: float = 0.7,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    response_format: Optional[str] = None,
) -> str:
    """Generate a single response from Ollama.

    This function makes a blocking HTTP request in a thread pool to
    avoid blocking the asyncio event loop. It automatically selects
    a model if none is provided by checking the available tags from
    the Ollama API.

    Args:
        prompt: The prompt to send to the model.
        system: Optional system prompt to provide additional context.
        temperature: Sampling temperature.
        model: Optional explicit model name.
        base_url: Optional override for the base Ollama API URL.
        response_format: Optional format specifier (e.g. "json").

    Returns:
        The generated response as a string.

    Raises:
        RuntimeError: If the request fails or the response is invalid.
    """
    global _MODEL_CACHE
    api_base = base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    api_base = api_base.rstrip("/")
    model_name = model or os.getenv("OLLAMA_MODEL")
    if not model_name:
        # Resolve from available tags lazily
        try:
            if _MODEL_CACHE is None:
                tags = await asyncio.to_thread(_get_json, f"{api_base}/api/tags")
                _MODEL_CACHE = [m.get("name") for m in tags.get("models", []) if m.get("name")]
            model_name = _select_model(_MODEL_CACHE) or "gpt-oss:120b-cloud"
        except Exception:
            model_name = "gpt-oss:120b-cloud"
    payload: Dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }
    if system:
        payload["system"] = system
    if response_format:
        payload["format"] = response_format

    try:
        result = await asyncio.to_thread(_post_json, f"{api_base}/api/generate", payload)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Ollama response was not valid JSON: {exc}") from exc

    response = result.get("response")
    if not isinstance(response, str) or not response.strip():
        raise RuntimeError("Ollama response was empty")
    return response.strip()
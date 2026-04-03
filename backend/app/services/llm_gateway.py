from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, Optional

import requests


class LLMGateway:
    def __init__(self) -> None:
        self._openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self._openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
        self._ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self._ollama_model = "gpt-oss:120b-cloud"
        self._provider_mode = os.getenv("LLM_PROVIDER", "auto").strip().lower() or "auto"

    async def generate_text(
        self,
        *,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.3,
        fallback_text: Optional[str] = None,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        providers = self._provider_chain()
        last_error = ""
        for provider in providers:
            try:
                if provider == "openai":
                    return await asyncio.to_thread(
                        self._call_openai,
                        messages,
                        temperature,
                        False,
                    )
                if provider == "ollama":
                    return await asyncio.to_thread(
                        self._call_ollama,
                        prompt,
                        system,
                        temperature,
                        False,
                    )
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                continue

        return fallback_text or self._deterministic_text_fallback(prompt=prompt, error=last_error)

    async def generate_json(
        self,
        *,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.2,
        fallback_json: Optional[Dict[str, Any]] = None,
        timeout_seconds: float = 10.0,
    ) -> Dict[str, Any]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        providers = self._provider_chain()
        last_error = ""
        budget_seconds = max(0.1, float(timeout_seconds))
        deadline = asyncio.get_running_loop().time() + budget_seconds
        for provider in providers:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                last_error = "llm_timeout"
                break
            try:
                request_timeout = max(0.1, min(budget_seconds, remaining))
                if provider == "openai":
                    raw = await asyncio.wait_for(
                        asyncio.to_thread(
                            self._call_openai,
                            messages,
                            temperature,
                            True,
                            request_timeout,
                        ),
                        timeout=remaining,
                    )
                else:
                    raw = await asyncio.wait_for(
                        asyncio.to_thread(
                            self._call_ollama,
                            prompt,
                            system,
                            temperature,
                            True,
                            request_timeout,
                        ),
                        timeout=remaining,
                    )
                parsed = self._extract_json(raw)
                if isinstance(parsed, dict):
                    return parsed
            except asyncio.TimeoutError:
                last_error = "llm_timeout"
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                continue

        if fallback_json is not None:
            return dict(fallback_json)
        return {"fallback": True, "error": last_error or "llm_unavailable"}

    def _provider_chain(self) -> list[str]:
        if self._provider_mode == "openai":
            return ["openai", "ollama"]
        if self._provider_mode == "ollama":
            return ["ollama"]
        if self._openai_api_key:
            return ["openai", "ollama"]
        return ["ollama"]

    def _call_openai(
        self,
        messages: list[Dict[str, str]],
        temperature: float,
        json_mode: bool,
        timeout_seconds: float,
    ) -> str:
        if not self._openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        payload: Dict[str, Any] = {
            "model": self._openai_model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self._openai_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI returned no choices")
        message = (choices[0].get("message") or {}).get("content")
        if not isinstance(message, str) or not message.strip():
            raise RuntimeError("OpenAI returned empty content")
        return message.strip()

    def _call_ollama(
        self,
        prompt: str,
        system: Optional[str],
        temperature: float,
        json_mode: bool,
        timeout_seconds: float,
    ) -> str:
        payload: Dict[str, Any] = {
            "model": self._ollama_model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if system:
            payload["system"] = system
        if json_mode:
            payload["format"] = "json"
        response = requests.post(
            f"{self._ollama_base_url}/api/generate",
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        text = data.get("response")
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("Ollama returned empty content")
        return text.strip()

    def _extract_json(self, raw: str) -> Dict[str, Any]:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(raw[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        raise ValueError("LLM response did not contain valid JSON")

    def _deterministic_text_fallback(self, *, prompt: str, error: str) -> str:
        first_line = (prompt or "").strip().splitlines()[0][:160]
        detail = f" ({error})" if error else ""
        return (
            "Local fallback response used"
            f"{detail}. Focus on the strongest evidence, the main risk boundary, and the next unresolved decision. "
            f"Prompt anchor: {first_line}"
        )

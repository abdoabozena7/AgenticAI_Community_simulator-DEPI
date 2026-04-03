from __future__ import annotations

import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.llm_gateway import LLMGateway  # noqa: E402


class LlmGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_json_returns_fallback_when_budget_expires(self) -> None:
        gateway = LLMGateway()

        def slow_ollama(*args: object, **kwargs: object) -> str:
            time.sleep(0.2)
            return '{"ok": true}'

        started = time.perf_counter()
        with patch.object(gateway, "_call_ollama", side_effect=slow_ollama):
            result = await gateway.generate_json(
                prompt="test",
                fallback_json={"fallback": True, "source": "deterministic"},
                timeout_seconds=0.05,
            )
        elapsed = time.perf_counter() - started

        self.assertEqual(result, {"fallback": True, "source": "deterministic"})
        self.assertLess(elapsed, 0.18)


if __name__ == "__main__":
    unittest.main()

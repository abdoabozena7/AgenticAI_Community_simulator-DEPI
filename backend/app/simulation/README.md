# simulator (patched bundle)

This folder contains the 4 original modules plus an optional anti-template validator:

- agent.py
- aggregator.py
- influence.py
- engine.py  (patched to retry LLM generations + block recurring template phrases)
- llm_output_validator.py (new)
- __init__.py

Key behavior change:
- SimulationEngine._llm_reasoning now tries up to 4 generations with escalating anti-repetition settings.
- If generations keep hitting forbidden/template output, it falls back to a non-viral deterministic Arabic explanation (no "المعلومات المتوفرة..." etc).

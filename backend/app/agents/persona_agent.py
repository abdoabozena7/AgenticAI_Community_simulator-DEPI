from __future__ import annotations

import hashlib
import random
import uuid
from typing import Any, Dict, List

from ..models.orchestration import OrchestrationState, PersonaProfile, context_location_label
from .base import BaseAgent


class PersonaAgent(BaseAgent):
    name = "persona_agent"

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        place_label = context_location_label(state.user_context) or "global"
        place_key = self._place_key(place_label)
        fingerprint = self._fingerprint(state)

        cached = await self.runtime.repository.fetch_persona_library_record(
            user_id=state.user_id,
            place_key=place_key,
        )
        payload = (cached or {}).get("payload") if isinstance(cached, dict) else None
        if isinstance(payload, dict):
            cached_meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
            if str(cached_meta.get("fingerprint") or "") == fingerprint:
                personas = self._hydrate_personas(payload)
                if personas:
                    state.personas = personas
                    state.schema["persona_source"] = "library"
                    await self.runtime.repository.persist_personas(
                        state.simulation_id,
                        [persona.to_agent_row() for persona in personas],
                    )
                    return state

        personas = self._generate_personas(state, place_label)
        state.personas = personas
        await self.runtime.repository.upsert_persona_library_record(
            user_id=state.user_id,
            place_key=place_key,
            place_label=place_label,
            scope="local" if place_label != "global" else "global",
            source_policy="research_plus_dataset",
            payload={
                "meta": {
                    "fingerprint": fingerprint,
                    "idea": state.user_context.get("idea"),
                    "category": state.user_context.get("category"),
                },
                "personas": [persona.to_dict() for persona in personas],
            },
        )
        await self.runtime.repository.persist_personas(
            state.simulation_id,
            [persona.to_agent_row() for persona in personas],
        )
        return state

    def _fingerprint(self, state: OrchestrationState) -> str:
        seed = "|".join(
            [
                str(state.user_context.get("idea") or ""),
                str(state.user_context.get("category") or ""),
                context_location_label(state.user_context),
                str((state.research.structured_schema if state.research else {}).get("summary") or ""),
                str(state.user_context.get("agentCount") or 24),
                "persona_v2",
            ]
        )
        return hashlib.sha1(seed.encode("utf-8")).hexdigest()

    def _place_key(self, place_label: str) -> str:
        return "-".join(part for part in place_label.lower().replace(",", " ").split() if part) or "global"

    def _hydrate_personas(self, payload: Dict[str, Any]) -> List[PersonaProfile]:
        personas: List[PersonaProfile] = []
        for item in payload.get("personas") or []:
            if not isinstance(item, dict):
                continue
            personas.append(
                PersonaProfile(
                    persona_id=str(uuid.uuid4()),
                    name=str(item.get("name") or ""),
                    category_id=str(item.get("category_id") or ""),
                    template_id=str(item.get("template_id") or ""),
                    archetype_name=str(item.get("archetype_name") or item.get("name") or ""),
                    summary=str(item.get("summary") or ""),
                    motivations=[str(value) for value in item.get("motivations") or [] if str(value).strip()],
                    concerns=[str(value) for value in item.get("concerns") or [] if str(value).strip()],
                    location=str(item.get("location") or ""),
                    opinion=str(item.get("opinion") or "neutral"),
                    confidence=float(item.get("confidence") or 0.5),
                    influence_weight=float(item.get("influence_weight") or 1.0),
                    traits=dict(item.get("traits") or {}),
                    biases=[str(value) for value in item.get("biases") or [] if str(value).strip()],
                    opinion_score=float(item.get("opinion_score") or 0.0),
                )
            )
        return personas

    def _generate_personas(self, state: OrchestrationState, place_label: str) -> List[PersonaProfile]:
        category = str(state.user_context.get("category") or "").strip().lower()
        templates = self.runtime.dataset.templates_by_category.get(category) or self.runtime.dataset.templates
        research_summary = str((state.research.summary if state.research else "") or "").strip()
        findings = list((state.research.findings if state.research else []) or [])
        gaps = list((state.research.gaps if state.research else []) or [])
        requested_count = int(state.user_context.get("agentCount") or 24)
        rng = random.Random(f"{state.simulation_id}:{place_label}:{requested_count}")
        template_pool = list(templates) if templates else list(self.runtime.dataset.templates)
        if not template_pool:
            return []
        personas: List[PersonaProfile] = []
        for index in range(requested_count):
            template = template_pool[index % len(template_pool)]
            category_model = self.runtime.dataset.category_by_id.get(template.category_id)
            category_weight = float(category_model.base_influence_weight if category_model else 1.0)
            score = self._initial_opinion_score(template.traits, state, gaps=gaps, findings=findings, rng=rng)
            opinion = "accept" if score >= 0.12 else "reject" if score <= -0.12 else "neutral"
            name = self._persona_name(template.archetype_name, place_label, index + 1)
            dynamic_traits = self._dynamic_traits(template.traits, template.influence_susceptibility, rng, template.category_id, index)
            personas.append(
                PersonaProfile(
                    persona_id=str(uuid.uuid4()),
                    name=name,
                    category_id=template.category_id,
                    template_id=template.template_id,
                    archetype_name=template.archetype_name,
                    summary=self._persona_summary(
                        place_label=place_label,
                        research_summary=research_summary,
                        findings=findings,
                        archetype=template.archetype_name,
                    ),
                    motivations=self._motivations(template.biases, findings),
                    concerns=self._concerns(template.biases, state),
                    location=place_label,
                    opinion=opinion,
                    confidence=round(0.45 + min(0.35, abs(score) / 2), 3),
                    influence_weight=round(category_weight * float(template.influence_susceptibility), 3),
                    traits=dynamic_traits,
                    biases=list(template.biases),
                    opinion_score=round(score, 3),
                )
            )
        return personas

    def _initial_opinion_score(
        self,
        traits: Dict[str, float],
        state: OrchestrationState,
        *,
        gaps: List[str],
        findings: List[str],
        rng: random.Random,
    ) -> float:
        optimism = float(traits.get("optimism", 0.5))
        skepticism = float(traits.get("skepticism", 0.5))
        openness = float(traits.get("openness_to_change", 0.5))
        demand = str((state.research.structured_schema if state.research else {}).get("demand_level") or "medium")
        risk = str((state.research.structured_schema if state.research else {}).get("regulatory_risk") or "medium")
        demand_weight = {"low": -0.15, "medium": 0.05, "high": 0.2}.get(demand, 0.0)
        risk_weight = {"low": 0.1, "medium": -0.05, "high": -0.2}.get(risk, -0.05)
        research_pull = 0.04 * min(3, len(findings)) - 0.05 * min(3, len(gaps))
        noise = rng.uniform(-0.06, 0.06)
        return max(-0.35, min(0.35, (optimism * 0.22) + (openness * 0.16) - (skepticism * 0.24) + demand_weight + risk_weight + research_pull + noise))

    def _dynamic_traits(
        self,
        base_traits: Dict[str, float],
        susceptibility: float,
        rng: random.Random,
        category_id: str,
        index: int,
    ) -> Dict[str, float]:
        traits = dict(base_traits)
        traits["dynamic_skepticism"] = round(max(0.05, min(0.95, float(base_traits.get("skepticism", 0.5)) + rng.uniform(-0.08, 0.08))), 3)
        traits["question_drive"] = round(max(0.05, min(0.95, 0.35 + float(base_traits.get("skepticism", 0.5)) * 0.4 + rng.uniform(-0.06, 0.06))), 3)
        traits["evidence_affinity"] = round(max(0.1, min(0.98, 0.45 + float(base_traits.get("openness_to_change", 0.5)) * 0.35 + rng.uniform(-0.05, 0.05))), 3)
        traits["inertia"] = round(max(0.15, min(0.95, 0.35 + (1 - float(susceptibility)) * 0.4 + rng.uniform(-0.05, 0.05))), 3)
        traits["representative_weight"] = round(max(0.4, min(1.6, 0.8 + float(susceptibility) * 0.5 + rng.uniform(-0.12, 0.12))), 3)
        traits["cluster_id"] = f"{category_id}:{index % 6}"
        return traits

    def _persona_name(self, archetype: str, place_label: str, index: int) -> str:
        place_prefix = place_label.split(",")[0].strip() if place_label else "Global"
        return f"{place_prefix} {archetype} {index}"

    def _persona_summary(
        self,
        *,
        place_label: str,
        research_summary: str,
        findings: List[str],
        archetype: str,
    ) -> str:
        finding = findings[0] if findings else research_summary
        finding = " ".join(str(finding or "").split())[:180]
        return f"{archetype} shaped by {place_label}. Reacts to evidence like: {finding}"

    def _motivations(self, biases: List[str], findings: List[str]) -> List[str]:
        values = [finding[:80] for finding in findings[:2] if finding]
        if not values:
            values = ["clear value", "credible execution"]
        values.extend(bias[:80] for bias in biases[:1])
        return values[:3]

    def _concerns(self, biases: List[str], state: OrchestrationState) -> List[str]:
        concerns = [bias[:80] for bias in biases[:2] if bias]
        if not state.user_context.get("riskBoundary"):
            concerns.append("risk boundary is not explicit")
        if not state.user_context.get("monetization"):
            concerns.append("monetization is still unclear")
        if not concerns:
            concerns = ["weak differentiation", "execution drift"]
        return concerns[:3]

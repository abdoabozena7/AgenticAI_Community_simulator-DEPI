from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional, Sequence

from ..models.orchestration import ClarificationQuestion, DialogueTurn, OrchestrationState, PersonaProfile, SimulationPhase
from .base import BaseAgent


class SimulationAgent(BaseAgent):
    name = "simulation_agent"

    def _minimum_visible_turns(self, state: OrchestrationState) -> int:
        return max(3, min(8, max(1, len(state.personas) // 3)))

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        await self.initialize_simulation(state)
        await self.run_deliberation(state)
        return state

    async def initialize_simulation(self, state: OrchestrationState) -> OrchestrationState:
        blockers = state.validate_pipeline_ready_for_simulation()
        if blockers:
            raise RuntimeError(f"Simulation cannot initialize before the mandatory pipeline completes: {', '.join(blockers)}")
        if not state.personas:
            raise RuntimeError("Simulation cannot initialize without personas")
        self._ensure_runtime_metadata(state)
        if not state.argument_bank:
            state.argument_bank = self._seed_argument_bank(state)
        state.schema["simulation_mode"] = "clustered_agent_deliberation"
        state.schema["token_strategy"] = {
            "representative_sampling": True,
            "cluster_leaders": True,
            "argument_bank": True,
            "llm_speakers_per_iteration": state.deliberation_state.get("speaker_budget", 6),
        }
        state.deliberation_state.setdefault("iteration", 0)
        state.deliberation_state.setdefault("resolved_updates", 0)
        state.metrics = self._compute_metrics(state, iteration=int(state.deliberation_state.get("iteration") or 0))
        await self.runtime.repository.sync_persona_states(
            simulation_id=state.simulation_id,
            personas=state.personas,
            phase=SimulationPhase.SIMULATION_INITIALIZATION.value,
        )
        await self.runtime.repository.persist_metrics(state.simulation_id, dict(state.metrics))
        return state

    async def run_deliberation(self, state: OrchestrationState) -> OrchestrationState:
        self._ensure_runtime_metadata(state)
        await self._ingest_pending_context_updates(state)
        if state.pending_input:
            return state
        if not state.argument_bank:
            state.argument_bank = self._seed_argument_bank(state)

        current_iteration = int(state.deliberation_state.get("iteration") or 0)
        total_iterations = int(state.deliberation_state.get("total_iterations") or 4)
        initial_turn_count = len(state.dialogue_turns)

        rounds_to_run = max(1, total_iterations - current_iteration)
        for _ in range(rounds_to_run):
            iteration = int(state.deliberation_state.get("iteration") or 0) + 1
            if iteration > total_iterations:
                break

            speakers = self._select_representatives(state, iteration)
            if not speakers:
                break

            for speaker in speakers:
                target = self._select_target(state, speaker, speakers, iteration)
                if target is None:
                    continue
                memory_provider = getattr(self.runtime, "memory_provider", None)
                question_mode = self._neutral_ratio(state) > 0.34 and (
                    speaker.opinion == "neutral" or float(speaker.traits.get("question_drive", 0.4)) > 0.56
                )
                argument = self._select_argument(state, speaker, target, question_mode)
                evidence = self._pick_evidence(state, argument)
                memory_context = (
                    await memory_provider.retrieve_for_turn(
                        state=state,
                        speaker=speaker,
                        target=target,
                        argument=argument,
                    )
                    if memory_provider is not None
                    else {}
                )
                fallback = self._fallback_turn_payload(
                    speaker=speaker,
                    target=target,
                    argument=argument,
                    evidence=evidence,
                    question_mode=question_mode,
                    state=state,
                    iteration=iteration,
                    memory_context=memory_context,
                )
                turn_payload = await self._generate_turn_payload(
                    state=state,
                    speaker=speaker,
                    target=target,
                    argument=argument,
                    evidence=evidence,
                    question_mode=question_mode,
                    iteration=iteration,
                    fallback=fallback,
                    memory_context=memory_context,
                )
                turn = self._build_turn(
                    state=state,
                    speaker=speaker,
                    target=target,
                    argument=argument,
                    evidence=evidence,
                    payload=turn_payload,
                    iteration=iteration,
                    question_mode=question_mode,
                )
                self._apply_turn_effects(state, speaker, target, turn, argument, turn_payload)
                state.dialogue_turns.append(turn)
                state.dialogue_turns = state.dialogue_turns[-800:]
                if not state.deliberation_state.get("discussion_started_emitted"):
                    state.deliberation_state["discussion_started_emitted"] = True
                    await self.runtime.event_bus.publish(
                        state,
                        "discussion_started",
                        {
                            "agent": self.name,
                            "iteration_budget": total_iterations,
                            "represented_agents": len(state.personas),
                            "cluster_count": len(state.deliberation_state.get("clusters") or {}),
                            "first_step_uid": turn.step_uid,
                            "message_count": len(state.dialogue_turns),
                        },
                    )
                published_turn = await self.runtime.event_bus.publish_turn(state, turn)
                if memory_provider is not None:
                    await memory_provider.ingest_turn(
                        state=state,
                        turn=turn,
                        speaker=speaker,
                        target=target,
                        argument=argument,
                        payload=turn_payload,
                        event_seq=published_turn.get("event_seq"),
                    )
                intervention = self._detect_orchestrator_intervention(state, turn, argument)
                if intervention is not None:
                    if iteration < min(3, total_iterations):
                        continue
                    state.deliberation_state["iteration"] = iteration
                    state.metrics = self._compute_metrics(state, iteration=iteration)
                    await self.runtime.repository.persist_metrics(state.simulation_id, dict(state.metrics))
                    await self._pause_for_intervention(state, intervention)
                    await self.runtime.repository.sync_persona_states(
                        simulation_id=state.simulation_id,
                        personas=state.personas,
                        phase=SimulationPhase.AGENT_DELIBERATION.value,
                    )
                    return state

            state.deliberation_state["iteration"] = iteration
            state.metrics = self._compute_metrics(state, iteration=iteration)
            await self.runtime.repository.persist_metrics(state.simulation_id, dict(state.metrics))
            await self.runtime.repository.sync_persona_states(
                simulation_id=state.simulation_id,
                personas=state.personas,
                phase=SimulationPhase.AGENT_DELIBERATION.value,
            )
            await self.runtime.event_bus.publish(
                state,
                "discussion_progress",
                {
                    "agent": self.name,
                    "iteration": iteration,
                    "total_iterations": total_iterations,
                    "message_count": len(state.dialogue_turns),
                },
            )
            if self._neutral_ratio(state) <= 0.3 and iteration >= max(2, total_iterations - 1):
                break
        visible_turns_added = len(state.dialogue_turns) - initial_turn_count
        if visible_turns_added == 0 and state.personas:
            raise RuntimeError("Simulation deliberation did not produce any dialogue turns")
        if len(state.dialogue_turns) < self._minimum_visible_turns(state) and len(state.personas) > 1:
            raise RuntimeError("Simulation deliberation ended before enough visible discussion was produced")
        return state

    async def run_convergence(self, state: OrchestrationState) -> OrchestrationState:
        self._ensure_runtime_metadata(state)
        if state.pending_input:
            return state
        if len(state.dialogue_turns) < self._minimum_visible_turns(state):
            raise RuntimeError("Cannot run convergence before visible discussion has started")
        iteration = int(state.deliberation_state.get("iteration") or 0)
        if self._neutral_ratio(state) > 0.3:
            leaders = self._select_representatives(state, iteration + 1)
            strongest = sorted(state.argument_bank, key=lambda item: float(item.get("strength") or 0.0), reverse=True)[:4]
            questions_added = 0
            for leader in leaders[:4]:
                if leader.opinion != "neutral" or questions_added >= 2:
                    continue
                target = self._select_target(state, leader, leaders, iteration + 1)
                if target is None:
                    continue
                evidence = self._pick_evidence(state, strongest[0] if strongest else None)
                question = f"@{target.name} أنا ما زلت محايدًا، ما الدليل الأقوى الذي يجعلني أتحرك خطوة واحدة فقط؟"
                turn = DialogueTurn(
                    step_uid=str(uuid.uuid4()),
                    iteration=iteration + 1,
                    phase=SimulationPhase.CONVERGENCE.value,
                    agent_id=leader.persona_id,
                    agent_name=leader.name,
                    reply_to_agent_id=target.persona_id,
                    reply_to_agent_name=target.name,
                    message=question,
                    stance_before=leader.opinion,
                    stance_after=leader.opinion,
                    confidence=round(leader.confidence, 3),
                    influence_delta=0.0,
                    evidence_urls=[item.get("url") for item in evidence if item.get("url")],
                    reason_tag="neutral_question",
                    message_type="question",
                    question_asked=question,
                )
                state.dialogue_turns.append(turn)
                await self.runtime.event_bus.publish_turn(state, turn)
                questions_added += 1

        self._enforce_neutral_cap(state)
        iteration = max(iteration, int(state.deliberation_state.get("total_iterations") or 4))
        state.deliberation_state["iteration"] = iteration
        state.metrics = self._compute_metrics(state, iteration=iteration)
        await self.runtime.repository.persist_metrics(state.simulation_id, dict(state.metrics))
        await self.runtime.repository.sync_persona_states(
            simulation_id=state.simulation_id,
            personas=state.personas,
            phase=SimulationPhase.CONVERGENCE.value,
        )
        return state

    async def build_summary(self, state: OrchestrationState) -> str:
        if len(state.dialogue_turns) < self._minimum_visible_turns(state):
            raise RuntimeError("Cannot build a simulation summary before enough discussion is visible")
        metrics = self._compute_metrics(state, iteration=int(state.deliberation_state.get("iteration") or 0))
        strongest = sorted(state.argument_bank, key=lambda item: float(item.get("strength") or 0.0), reverse=True)[:3]
        top_claims = [str(item.get("claim") or "").strip() for item in strongest if str(item.get("claim") or "").strip()]
        research_findings = list((state.research.findings if state.research else []) or [])[:2]
        critical = [item for item in state.critical_insights if not bool(item.get("dismissed"))]
        if str(state.user_context.get("language") or "en").lower().startswith("ar"):
            summary = [
                f"انتهت المحاكاة بعد {metrics['iteration']} جولات ممثلة لـ {metrics['total_agents']} وكيل.",
                f"التوزيع النهائي: قبول {metrics['accepted']}، رفض {metrics['rejected']}، حياد {metrics['neutral']}.",
            ]
            if top_claims:
                summary.append(f"أقوى الحجج كانت: {' | '.join(top_claims[:2])}.")
            if research_findings:
                summary.append(f"الدليل البحثي الأكثر تأثيرًا: {' | '.join(research_findings)}.")
            if critical:
                summary.append(f"أبرز insight حرج: {critical[-1].get('message')}.")
            return " ".join(summary)

        summary = [
            f"Simulation completed after {metrics['iteration']} representative rounds covering {metrics['total_agents']} agents.",
            f"Final distribution: accept {metrics['accepted']}, reject {metrics['rejected']}, neutral {metrics['neutral']}.",
        ]
        if top_claims:
            summary.append(f"Strongest arguments: {' | '.join(top_claims[:2])}.")
        if research_findings:
            summary.append(f"Most referenced research: {' | '.join(research_findings)}.")
        if critical:
            summary.append(f"Critical insight detected: {critical[-1].get('message')}.")
        return " ".join(summary)

    async def handle_insight_response(
        self,
        state: OrchestrationState,
        answers: List[Dict[str, Any]],
    ) -> OrchestrationState:
        if not answers:
            return state
        answer_text = " ".join(
            str(item.get("answer") or item.get("text") or "").strip()
            for item in answers
            if str(item.get("answer") or item.get("text") or "").strip()
        ).strip()
        if not answer_text:
            return state

        latest = state.critical_insights[-1] if state.critical_insights else {}
        normalized = answer_text.lower()
        affirmative = any(token in normalized for token in ["yes", "y", "نعم", "ايوه", "أيوه", "اكيد", "أكيد"])
        if affirmative:
            suggestion_payload = await self.runtime.llm.generate_json(
                prompt=(
                    f"Idea: {state.user_context.get('idea')}\n"
                    f"Location: {state.user_context.get('city') or state.user_context.get('location') or ''}\n"
                    f"Critical insight: {latest.get('message')}\n"
                    "Return JSON with key 'suggestions' containing 3 concise differentiators."
                ),
                system="You are a product strategist. Generate concrete differentiators grounded in the surfaced risk.",
                temperature=0.3,
                fallback_json={
                    "suggestions": [
                        "خصص ميزة تشغيلية مرتبطة بالموقع تقلل وقت الخدمة أو التكلفة بشكل ملموس.",
                        "ابنِ شراكة توزيع أو توريد لا يكررها المنافسون بسهولة.",
                        "حوّل البحث إلى عرض قيمة رقمي واضح يمكن قياسه خلال أول 30 يومًا.",
                    ]
                },
            )
            suggestions = [str(item).strip() for item in suggestion_payload.get("suggestions") or [] if str(item).strip()][:3]
            if suggestions:
                state.schema["differentiationIdeas"] = suggestions
                for suggestion in suggestions:
                    state.argument_bank.append(
                        {
                            "id": f"insight-{uuid.uuid4().hex[:8]}",
                            "kind": "differentiator",
                            "polarity": "support",
                            "claim": suggestion,
                            "summary": suggestion,
                            "strength": 0.66,
                            "evidence_urls": [],
                            "source": "insight_followup",
                        }
                    )
                await self.runtime.event_bus.publish(
                    state,
                    "insight_enrichment_generated",
                    {
                        "agent": self.name,
                        "insight_tag": latest.get("tag"),
                        "suggestions": suggestions,
                    },
                )

        if latest:
            latest["resolved"] = True
            latest["user_answer"] = answer_text
        state.pending_input = False
        state.pending_input_kind = None
        state.pending_resume_phase = None
        state.status = "running"
        state.status_reason = "insight_followup_resolved"
        state.clarification_questions = []
        return state

    def _ensure_runtime_metadata(self, state: OrchestrationState) -> None:
        clusters: Dict[str, List[str]] = {}
        leaders: Dict[str, str] = {}
        for persona in state.personas:
            persona.traits["skepticism"] = round(self._clamp(float(persona.skepticism_level), 0.05, 0.98), 3)
            persona.traits["conformity"] = round(self._clamp(float(persona.conformity_level), 0.05, 0.98), 3)
            persona.traits["stubbornness"] = round(self._clamp(float(persona.stubbornness_level), 0.05, 0.98), 3)
            persona.traits["innovation_openness"] = round(self._clamp(float(persona.innovation_openness), 0.05, 0.98), 3)
            persona.traits["financial_sensitivity"] = round(
                self._clamp(float(persona.financial_sensitivity), 0.05, 0.98),
                3,
            )
            skepticism = float(persona.traits.get("dynamic_skepticism", persona.traits.get("skepticism", 0.5)))
            persona.traits["dynamic_skepticism"] = round(self._clamp(skepticism, 0.05, 0.98), 3)
            question_drive = float(
                persona.traits.get(
                    "question_drive",
                    0.18 + (float(persona.traits.get("dynamic_skepticism", 0.5)) * 0.42) + (0.08 if persona.opinion == "neutral" else 0.0),
                )
            )
            persona.traits["question_drive"] = round(self._clamp(question_drive, 0.05, 0.98), 3)
            evidence_affinity = float(
                persona.traits.get(
                    "evidence_affinity",
                    0.42
                    + (float(persona.traits.get("conformity", 0.4)) * 0.15)
                    + ((1 - float(persona.traits.get("dynamic_skepticism", 0.5))) * 0.12),
                )
            )
            persona.traits["evidence_affinity"] = round(self._clamp(evidence_affinity, 0.05, 0.99), 3)
            inertia = float(
                persona.traits.get(
                    "inertia",
                    0.2 + (float(persona.traits.get("stubbornness", 0.4)) * 0.4) + (persona.confidence * 0.18),
                )
            )
            persona.traits["inertia"] = round(self._clamp(inertia, 0.05, 0.99), 3)
            persona.traits["representative_weight"] = round(
                self._clamp(float(persona.traits.get("representative_weight", 1.0)), 0.2, 2.0),
                3,
            )
            cluster_id = str(persona.traits.get("cluster_id") or persona.category_id or "general")
            persona.traits["cluster_id"] = cluster_id
            clusters.setdefault(cluster_id, []).append(persona.persona_id)

        for cluster_id, member_ids in clusters.items():
            members = [persona for persona in state.personas if persona.persona_id in member_ids]
            leader = max(
                members,
                key=lambda item: float(item.traits.get("representative_weight", 1.0)) * item.influence_weight * (0.8 + item.confidence),
            )
            leaders[cluster_id] = leader.persona_id

        state.deliberation_state["clusters"] = clusters
        state.deliberation_state["leaders"] = leaders
        state.deliberation_state.setdefault("speaker_budget", min(8, max(4, len(clusters))))
        state.deliberation_state.setdefault("total_iterations", self._target_iterations(len(state.personas)))
        state.deliberation_state.setdefault("pending_context_updates", [])
        state.deliberation_state.setdefault("represented_agents", len(state.personas))

    async def _ingest_pending_context_updates(self, state: OrchestrationState) -> None:
        updates = state.deliberation_state.get("pending_context_updates")
        if not isinstance(updates, list) or not updates:
            return
        resolved_count = int(state.deliberation_state.get("resolved_updates") or 0)
        unresolved = updates[resolved_count:]
        if not unresolved:
            return
        for item in unresolved:
            changed_fields = [str(field) for field in item.get("changed_fields") or [] if str(field).strip()]
            claim = (
                f"تم تعديل السياق في الحقول: {', '.join(changed_fields)}. "
                "يجب إعادة تقييم الفرضيات الحالية من داخل المحاكاة الجارية."
            )
            state.argument_bank.append(
                {
                    "id": f"context-{uuid.uuid4().hex[:8]}",
                    "kind": "context_update",
                    "polarity": "question",
                    "claim": claim,
                    "summary": claim,
                    "strength": 0.52 if item.get("impact") == "small" else 0.72,
                    "evidence_urls": [],
                    "source": "user_update",
                }
            )
        state.deliberation_state["resolved_updates"] = len(updates)
        await self.runtime.event_bus.publish(
            state,
            "discussion_reframed",
            {
                "agent": self.name,
                "pending_updates_processed": len(unresolved),
            },
        )

    def _seed_argument_bank(self, state: OrchestrationState) -> List[Dict[str, Any]]:
        bank: List[Dict[str, Any]] = []
        findings = list((state.research.findings if state.research else []) or [])
        gaps = list((state.research.gaps if state.research else []) or [])
        evidence = list((state.research.evidence if state.research else []) or [])
        for index, finding in enumerate(findings[:6], start=1):
            related = [item.url for item in evidence[index - 1 : index + 1] if item.url]
            bank.append(
                {
                    "id": f"finding-{index}",
                    "kind": "finding",
                    "polarity": "support",
                    "claim": str(finding),
                    "summary": str(finding)[:180],
                    "strength": round(0.55 + min(0.25, 0.05 * len(related)), 3),
                    "evidence_urls": related,
                    "source": "research",
                }
            )
        for index, gap in enumerate(gaps[:5], start=1):
            related = [item.url for item in evidence[max(0, index - 1) : index + 1] if item.url]
            bank.append(
                {
                    "id": f"gap-{index}",
                    "kind": "gap",
                    "polarity": "concern",
                    "claim": str(gap),
                    "summary": str(gap)[:180],
                    "strength": 0.62,
                    "evidence_urls": related,
                    "source": "research",
                }
            )
        if not bank:
            idea = str(state.user_context.get("idea") or "the idea").strip()
            location = self._location_label(state) or "the market"
            bank.append(
                {
                    "id": "fallback-1",
                    "kind": "fallback",
                    "polarity": "question",
                    "claim": f"{idea} still needs proof of demand, price fit, and execution clarity in {location}.",
                    "summary": f"Need demand and pricing proof in {location}.",
                    "strength": 0.5,
                    "evidence_urls": [],
                    "source": "context_guardrail",
                }
            )
        return bank

    def _select_representatives(self, state: OrchestrationState, iteration: int) -> List[PersonaProfile]:
        leader_ids = list((state.deliberation_state.get("leaders") or {}).values())
        representatives = [persona for persona in state.personas if persona.persona_id in leader_ids]
        representatives.sort(
            key=lambda item: (
                float(item.traits.get("representative_weight", 1.0)) * item.influence_weight * (0.8 + item.confidence),
                abs(item.opinion_score),
                -float(item.traits.get("dynamic_skepticism", 0.5)),
            ),
            reverse=True,
        )
        if iteration % 2 == 0:
            representatives.sort(
                key=lambda item: (
                    item.opinion == "neutral",
                    float(item.traits.get("question_drive", 0.4)),
                    item.influence_weight,
                ),
                reverse=True,
            )
        budget = int(state.deliberation_state.get("speaker_budget") or 6)
        selected = representatives[:budget]
        if len(selected) < min(4, len(state.personas)):
            extras = sorted(
                state.personas,
                key=lambda item: (
                    item.opinion == "neutral",
                    float(item.traits.get("question_drive", 0.4)),
                    item.influence_weight,
                ),
                reverse=True,
            )
            for persona in extras:
                if persona in selected:
                    continue
                selected.append(persona)
                if len(selected) >= budget:
                    break
        return selected

    def _select_target(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        representatives: Sequence[PersonaProfile],
        iteration: int,
    ) -> Optional[PersonaProfile]:
        candidates = [item for item in representatives if item.persona_id != speaker.persona_id]
        if not candidates:
            candidates = [item for item in state.personas if item.persona_id != speaker.persona_id]
        if not candidates:
            return None
        if speaker.opinion == "neutral":
            candidates = sorted(candidates, key=lambda item: abs(item.opinion_score), reverse=True)
            return candidates[(iteration - 1) % len(candidates)]
        opposing = [item for item in candidates if item.opinion != speaker.opinion]
        if opposing:
            opposing.sort(
                key=lambda item: (
                    item.opinion == "neutral",
                    abs(item.opinion_score - speaker.opinion_score),
                    -item.influence_weight,
                ),
            )
            return opposing[0]
        return sorted(candidates, key=lambda item: item.influence_weight, reverse=True)[0]

    def _select_argument(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        question_mode: bool,
    ) -> Dict[str, Any]:
        preferred = "question" if question_mode else ("support" if speaker.opinion == "accept" else "concern")
        candidates = [item for item in state.argument_bank if str(item.get("polarity") or "") == preferred]
        if not candidates and target.opinion == "accept":
            candidates = [item for item in state.argument_bank if str(item.get("polarity") or "") == "concern"]
        if not candidates and target.opinion == "reject":
            candidates = [item for item in state.argument_bank if str(item.get("polarity") or "") == "support"]
        if not candidates:
            candidates = list(state.argument_bank)
        candidates.sort(key=lambda item: float(item.get("strength") or 0.0), reverse=True)
        return dict(candidates[0]) if candidates else {}

    def _pick_evidence(self, state: OrchestrationState, argument: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        evidence = list((state.research.evidence if state.research else []) or [])
        if not evidence:
            return []
        urls = set(str(url) for url in (argument or {}).get("evidence_urls") or [] if str(url).strip())
        selected = [item for item in evidence if item.url in urls]
        if not selected:
            selected = evidence[:2]
        return [
            {
                "title": item.title,
                "url": item.url,
                "domain": item.domain,
                "snippet": (item.snippet or item.content or "")[:180],
            }
            for item in selected[:2]
        ]

    async def _generate_turn_payload(
        self,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        question_mode: bool,
        iteration: int,
        fallback: Dict[str, Any],
        memory_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        prompt = self._deliberation_prompt(
            state=state,
            speaker=speaker,
            target=target,
            argument=argument,
            evidence=evidence,
            question_mode=question_mode,
            iteration=iteration,
            memory_context=memory_context,
        )
        system = (
            "You write one short JSON debate turn for a persona-driven Arabic business simulation. "
            "The persona attributes control both reasoning and wording. "
            "No generic advice, no neutral analyst voice, no long explanations. "
            "The speaker must sound like a real person reacting to the idea through their own concerns, money sensitivity, "
            "skepticism, openness to innovation, and local market context."
        )
        invalid_reasons: List[str] = []
        payload: Dict[str, Any] = dict(fallback)
        for attempt in range(2):
            prompt_text = prompt
            if invalid_reasons:
                prompt_text += "\nPrevious output failed validation because:\n" + "\n".join(f"- {reason}" for reason in invalid_reasons)
                prompt_text += "\nRewrite from scratch. Use different wording. Keep the persona and research anchors explicit."
            candidate = await self.runtime.llm.generate_json(
                prompt=prompt_text,
                system=system,
                temperature=0.4 if attempt == 0 else 0.3,
                fallback_json=fallback,
            )
            payload = self._coerce_turn_payload(candidate, fallback=fallback, iteration=iteration)
            invalid_reasons = self._validate_turn_payload(
                state=state,
                speaker=speaker,
                target=target,
                argument=argument,
                evidence=evidence,
                payload=payload,
                question_mode=question_mode,
                iteration=iteration,
            )
            if not invalid_reasons:
                return payload
        fallback_payload = self._coerce_turn_payload(dict(fallback), fallback=fallback, iteration=iteration)
        fallback_payload["validation_errors"] = invalid_reasons
        return fallback_payload

    def _coerce_turn_payload(
        self,
        payload: Optional[Dict[str, Any]],
        *,
        fallback: Dict[str, Any],
        iteration: int,
    ) -> Dict[str, Any]:
        raw = dict(fallback)
        raw.update(payload or {})
        max_shift = self._max_shift_for_iteration(iteration)
        raw["message"] = str(raw.get("message") or fallback.get("message") or "").strip()
        raw["question"] = str(raw.get("question") or "").strip()
        raw["reason_tag"] = str(raw.get("reason_tag") or fallback.get("reason_tag") or "persona_argument").strip()
        raw["insight"] = str(raw.get("insight") or "").strip()
        raw["target_shift"] = round(self._clamp(float(raw.get("target_shift") or 0.0), -max_shift, max_shift), 4)
        raw["speaker_shift"] = round(self._clamp(float(raw.get("speaker_shift") or 0.0), -max_shift * 0.65, max_shift * 0.65), 4)
        raw["insight_severity"] = round(self._clamp(float(raw.get("insight_severity") or 0.0), 0.0, 1.0), 3)
        raw["convincing"] = bool(raw.get("convincing"))
        raw["rejected"] = bool(raw.get("rejected"))
        return raw

    def _validate_turn_payload(
        self,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        payload: Dict[str, Any],
        question_mode: bool,
        iteration: int,
    ) -> List[str]:
        errors: List[str] = []
        message = str(payload.get("message") or "").strip()
        if not message:
            return ["missing message"]
        if f"@{target.name}" not in message:
            errors.append("must mention the target using @name")
        if str(state.user_context.get("language") or "en").startswith("ar") and not re.search(r"[\u0600-\u06FF]", message):
            errors.append("must be written in natural Arabic")
        word_count = len([part for part in message.split() if part.strip()])
        if word_count < 5 or word_count > 30:
            errors.append("message must stay short and conversational")
        if self._looks_generic_message(message):
            errors.append("message still sounds generic")
        if self._is_repetitive_message(state, speaker, message):
            errors.append("message repeats prior wording")
        if not self._has_research_anchor(message, state=state, speaker=speaker, argument=argument, evidence=evidence):
            errors.append("message must reference research or local market signals")
        if not self._has_persona_anchor(message, speaker):
            errors.append("message does not reflect the persona's own lens")
        if question_mode:
            if not (payload.get("question") or "؟" in message or any(token in message for token in ("ليه", "إزاي", "طب", "بس"))):
                errors.append("question mode must ask or press the target")
        elif not any(token in message for token in ("بس", "طب", "ليه", "إزاي", "لو", "فعلا")):
            errors.append("conversation turn must challenge or engage the target")
        target_shift = float(payload.get("target_shift") or 0.0)
        max_shift = self._max_shift_for_iteration(iteration)
        if abs(target_shift) > max_shift + 1e-6:
            errors.append("opinion change is too abrupt for this iteration")
        if speaker.opinion == "reject" and target_shift > max_shift * 0.9 and iteration < 3:
            errors.append("speaker cannot swing directly to strong support this early")
        if speaker.opinion == "accept" and target_shift < -max_shift * 0.9 and iteration < 3:
            errors.append("speaker cannot collapse directly into rejection this early")
        return errors

    def _looks_generic_message(self, message: str) -> bool:
        lowered = self._normalize_message(message)
        generic_phrases = (
            "بشكل عام",
            "في النهاية",
            "يعتمد على التنفيذ",
            "الأمر يعتمد",
            "there are pros and cons",
            "depends on execution",
            "needs more research",
            "needs better execution",
        )
        return any(phrase in lowered for phrase in generic_phrases)

    def _is_repetitive_message(self, state: OrchestrationState, speaker: PersonaProfile, message: str) -> bool:
        normalized = self._normalize_message(message)
        recent = state.dialogue_turns[-14:]
        for turn in recent:
            same_speaker = turn.agent_id == speaker.persona_id
            similarity = self._message_similarity(normalized, self._normalize_message(turn.message))
            if same_speaker and similarity >= 0.68:
                return True
            if similarity >= 0.82:
                return True
        return False

    def _message_similarity(self, left: str, right: str) -> float:
        if not left or not right:
            return 0.0
        if left == right:
            return 1.0
        left_tokens = set(part for part in re.split(r"[^\w\u0600-\u06FF]+", left) if len(part) > 1)
        right_tokens = set(part for part in re.split(r"[^\w\u0600-\u06FF]+", right) if len(part) > 1)
        if not left_tokens or not right_tokens:
            return 0.0
        overlap = len(left_tokens & right_tokens)
        union = max(1, len(left_tokens | right_tokens))
        return overlap / union

    def _normalize_message(self, message: str) -> str:
        return " ".join(str(message or "").lower().split())

    def _has_research_anchor(
        self,
        message: str,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
    ) -> bool:
        normalized = self._normalize_message(message)
        for term in self._research_anchor_terms(state, speaker, argument, evidence):
            if term and self._normalize_message(term) in normalized:
                return True
        return False

    def _has_persona_anchor(self, message: str, speaker: PersonaProfile) -> bool:
        normalized = self._normalize_message(message)
        return any(term in normalized for term in self._persona_anchor_terms(speaker))

    def _research_anchor_terms(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
    ) -> List[str]:
        structured = self._research_schema(state)
        location = self._location_label(state)
        concerns_text = " ".join(speaker.concerns + speaker.evidence_signals).lower()
        terms: List[str] = []
        if location:
            terms.append(location.lower())
        if any(token in concerns_text for token in ("price", "fee", "budget", "سعر", "تكلفة", "رسوم")) or speaker.financial_sensitivity >= 0.65:
            terms.extend(["السعر", "التكلفة", "رسوم", "خصم"])
        competition_level = str(structured.get("competition_level") or "").strip().lower()
        if competition_level in {"high", "crowded", "saturated"}:
            terms.extend(["المنافسة", "متشبع", "موجود"])
        elif competition_level:
            terms.append("المنافسة")
        price_sensitivity = str(structured.get("price_sensitivity") or "").strip().lower()
        if price_sensitivity in {"high", "medium", "low"}:
            terms.extend(["السعر", "الناس", "حساسة"])
        for item in list(structured.get("complaints") or [])[:4]:
            terms.extend(self._keywords_from_text(str(item)))
        for item in list(structured.get("behaviors") or [])[:4]:
            terms.extend(self._keywords_from_text(str(item)))
        for item in list(structured.get("competition_reactions") or [])[:3]:
            terms.extend(self._keywords_from_text(str(item)))
        terms.extend(self._keywords_from_text(str(argument.get("claim") or "")))
        for item in evidence[:2]:
            terms.extend(self._keywords_from_text(str(item.get("snippet") or "")))
        unique: List[str] = []
        for term in terms:
            cleaned = self._normalize_message(term)
            if len(cleaned) < 2 or cleaned in unique:
                continue
            unique.append(cleaned)
        return unique[:16]

    def _persona_anchor_terms(self, persona: PersonaProfile) -> List[str]:
        role_text = " ".join(
            [
                str(persona.profession_role or ""),
                str(persona.archetype_name or ""),
                str(persona.target_audience_cluster or ""),
                str(persona.speaking_style or ""),
            ]
        ).lower()
        terms: List[str] = []
        if any(token in role_text for token in ("developer", "engineer", "tech", "مبرمج", "مهندس")):
            terms.extend(["التنفيذ", "التقنية", "المنتج"])
        elif any(token in role_text for token in ("owner", "business", "manager", "shop", "entrepreneur", "تاجر", "بيزنس")):
            terms.extend(["التكلفة", "المكسب", "العميل", "السعر"])
        elif any(token in role_text for token in ("student", "طالب")):
            terms.extend(["السعر", "السهولة", "السرعة"])
        elif any(token in role_text for token in ("resident", "local", "parent", "family", "household", "أهالي", "سكان")):
            terms.extend(["المنطقة", "الاحتياج", "الراحة", "الناس"])
        else:
            terms.extend(["القيمة", "الطلب", "الناس"])
        if persona.financial_sensitivity >= 0.65:
            terms.extend(["السعر", "التكلفة", "رسوم"])
        if persona.skepticism_level >= 0.65:
            terms.extend(["مخاطرة", "ضمان", "مقتنع"])
        if persona.innovation_openness >= 0.65:
            terms.extend(["جديد", "مختلف", "فكرة"])
        if persona.conformity_level >= 0.65:
            terms.extend(["الناس", "السوق"])
        for item in persona.concerns[:2] + persona.motivations[:2]:
            terms.extend(self._keywords_from_text(str(item)))
        unique: List[str] = []
        for term in terms:
            cleaned = self._normalize_message(term)
            if len(cleaned) < 2 or cleaned in unique:
                continue
            unique.append(cleaned)
        return unique[:14]

    def _keywords_from_text(self, text: str) -> List[str]:
        tokens = [part.strip().lower() for part in re.split(r"[^\w\u0600-\u06FF]+", str(text or "")) if len(part.strip()) >= 3]
        preferred = [
            token
            for token in tokens
            if token not in {"the", "and", "with", "that", "this", "على", "من", "في", "الى", "إلى", "عن", "ممكن", "جدا"}
        ]
        return preferred[:4]

    def _research_schema(self, state: OrchestrationState) -> Dict[str, Any]:
        return dict(state.research.structured_schema if state.research else {})

    def _location_label(self, state: OrchestrationState) -> str:
        return str(
            state.user_context.get("city")
            or state.user_context.get("location")
            or state.user_context.get("country")
            or ""
        ).strip()

    def _persona_focus_phrase(self, persona: PersonaProfile) -> str:
        role_text = " ".join([persona.profession_role, persona.archetype_name, persona.target_audience_cluster]).lower()
        if any(token in role_text for token in ("developer", "engineer", "tech", "مبرمج", "مهندس")):
            return "أنا ببص على التنفيذ والتقنية"
        if any(token in role_text for token in ("owner", "business", "manager", "entrepreneur", "بيزنس", "تاجر")):
            return "أنا حاسبها تكلفة ومكسب"
        if any(token in role_text for token in ("student", "طالب")):
            return "أنا يهمني السعر والسهولة"
        if any(token in role_text for token in ("resident", "local", "parent", "family", "household", "سكان")):
            return "أنا يهمني احتياج الناس في المنطقة"
        return "أنا ببص على القيمة الحقيقية"

    def _persona_tone_phrase(self, persona: PersonaProfile, iteration: int) -> str:
        options: List[str]
        if persona.skepticism_level >= 0.7 and persona.stubbornness_level >= 0.6:
            options = ["مش مقتنع بصراحة", "أنا لسه شايف فيها مخاطرة", "أنا لسه متحفظ"]
        elif persona.financial_sensitivity >= 0.7:
            options = ["أنا أول حاجة ببص لها السعر", "طب التكلفة هتطلع كام", "أنا قلقان من السعر"]
        elif persona.innovation_openness >= 0.7 and persona.opinion != "reject":
            options = ["الفكرة فيها جديد", "دي زاوية مختلفة", "ممكن تمشي لو اتظبطت"]
        elif persona.opinion == "accept":
            options = ["أنا مايل لها", "أنا شايف فيها فرصة", "الفكرة قريبة تمشي"]
        elif persona.opinion == "reject":
            options = ["أنا مش مرتاح لها", "أنا شايفها صعبة شوية", "أنا لسه ضدها"]
        else:
            options = ["أنا لسه محايد", "أنا لسه بستوعبها", "أنا لسه محتاج دليل"]
        index = (sum(ord(ch) for ch in f"{persona.persona_id}:{iteration}") + iteration) % len(options)
        return options[index]

    def _research_reference_phrase(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
    ) -> str:
        structured = self._research_schema(state)
        location = self._location_label(state)
        location_prefix = f"في {location} " if location else ""
        if location and str(structured.get("competition_level") or "").lower() in {"high", "crowded", "saturated"}:
            return f"{location_prefix}واضح إن المنافسة عالية"
        if speaker.financial_sensitivity >= 0.65 or str(structured.get("price_sensitivity") or "").lower() == "high":
            complaint = next(
                (
                    str(item).strip()
                    for item in list(structured.get("complaints") or []) + speaker.concerns + speaker.evidence_signals
                    if str(item).strip()
                ),
                "",
            )
            if complaint:
                return f"حسب اللي لقيناه الناس بتشتكي من {complaint}"
            return "حسب اللي لقيناه الناس حساسة للسعر"
        behavior = next((str(item).strip() for item in list(structured.get("behaviors") or []) if str(item).strip()), "")
        if behavior:
            return f"واضح إن الناس بتميل لـ {behavior}"
        reaction = next((str(item).strip() for item in list(structured.get("competition_reactions") or []) if str(item).strip()), "")
        if reaction:
            return f"والسوق بيرد غالبًا بـ {reaction}"
        evidence_text = next((str(item.get("snippet") or "").strip() for item in evidence if str(item.get("snippet") or "").strip()), "")
        if evidence_text:
            return f"حسب البحث {evidence_text[:80]}"
        claim = str(argument.get("claim") or "").strip()
        if claim:
            return f"واضح من البحث إن {claim[:70]}"
        return "حسب اللي لقيناه في السوق"

    def _local_context_phrase(self, state: OrchestrationState, speaker: PersonaProfile) -> str:
        structured = self._research_schema(state)
        location = self._location_label(state)
        if not location:
            return ""
        price_sensitivity = str(structured.get("price_sensitivity") or "").lower()
        if price_sensitivity == "high":
            return f"والناس في {location} حساسة للسعر"
        behavior = next((str(item).strip() for item in list(structured.get("behaviors") or []) if str(item).strip()), "")
        if behavior:
            return f"وفي {location} الناس بتميل لـ {behavior}"
        if speaker.target_audience_cluster:
            return f"وفي {location} لازم يناسب {speaker.target_audience_cluster}"
        return f"وفي {location} لازم يبقى مناسب للسوق"

    def _stance_progression_phrase(self, persona: PersonaProfile, iteration: int) -> str:
        if iteration <= 1:
            return "أنا لسه عند تحفظ بسيط" if persona.opinion == "reject" else "أنا لسه مش شايف الصورة كاملة"
        if iteration == 2:
            return "ممكن أميل لو النقطة دي اتحلت"
        if iteration == 3:
            return "ممكن أقبلها بس بشرط واضح"
        return "ممكن أوافق لو التنفيذ طلع مضبوط"

    def _max_shift_for_iteration(self, iteration: int) -> float:
        if iteration <= 1:
            return 0.028
        if iteration == 2:
            return 0.042
        if iteration == 3:
            return 0.062
        return 0.082

    def _legacy_fallback_turn_payload(
        self,
        *,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        question_mode: bool,
        state: OrchestrationState,
    ) -> Dict[str, Any]:
        claim = str(argument.get("claim") or "Need more evidence").strip()
        location = state.user_context.get("city") or state.user_context.get("location") or state.user_context.get("country") or "السوق"
        evidence_text = evidence[0]["snippet"] if evidence else str((state.research.summary if state.research else "") or "")[:120]
        if question_mode:
            return {
                "message": f"@{target.name} أنا لسه محايد، لكن {claim}. ممكن توضح لي إزاي ده هيشتغل فعليًا في {location}؟",
                "target_shift": 0.0,
                "speaker_shift": 0.02 if target.opinion != "neutral" else 0.0,
                "convincing": False,
                "rejected": False,
                "insight": "",
                "insight_severity": 0.0,
                "question": f"كيف نثبت هذه النقطة عمليًا في {location}؟",
                "reason_tag": "neutral_question",
            }
        if speaker.opinion == "accept":
            return {
                "message": f"أنا متفق مع كلام @{target.name} جزئيًا، لكن حسب البحث في {location} {evidence_text}. لذلك أرى أن {claim}.",
                "target_shift": 0.06 if target.opinion != "accept" else 0.02,
                "speaker_shift": 0.01,
                "convincing": target.opinion != "accept",
                "rejected": False,
                "insight": "",
                "insight_severity": 0.0,
                "question": "",
                "reason_tag": "evidence_argument",
            }
        insight = "الفكرة دي مفيهاش ميزة تنافسية واضحة" if "different" in claim.lower() or "ميزة" in claim else ""
        return {
            "message": f"@{target.name} أنا مختلف معك، لأن {claim}. والدليل الأقرب لنا يقول: {evidence_text}.",
            "target_shift": -0.05 if target.opinion != "reject" else -0.02,
            "speaker_shift": -0.01,
            "convincing": target.opinion == "neutral",
            "rejected": target.opinion == "accept",
            "insight": insight,
            "insight_severity": 0.82 if insight else 0.0,
            "question": "",
            "reason_tag": "counter_argument",
        }

    def _legacy_deliberation_prompt(
        self,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        question_mode: bool,
    ) -> str:
        evidence_lines = "\n".join(
            f"- {item.get('title')} | {item.get('domain')} | {item.get('snippet')} | {item.get('url')}"
            for item in evidence
        ) or "- No evidence URLs available"
        return (
            f"Language: {'Arabic' if str(state.user_context.get('language') or 'en').startswith('ar') else 'English'}\n"
            f"Idea: {state.user_context.get('idea')}\n"
            f"Location: {state.user_context.get('city') or state.user_context.get('location') or state.user_context.get('country') or ''}\n"
            f"Speaker: {speaker.name} ({speaker.archetype_name}) opinion={speaker.opinion} score={speaker.opinion_score:.3f}\n"
            f"Target: {target.name} ({target.archetype_name}) opinion={target.opinion} score={target.opinion_score:.3f}\n"
            f"Argument focus: {argument.get('claim')}\n"
            f"Question mode: {question_mode}\n"
            f"Research evidence:\n{evidence_lines}\n"
            "Return JSON with keys: message, target_shift, speaker_shift, convincing, rejected, insight, insight_severity, question, reason_tag.\n"
            "Constraints:\n"
            "- message must mention the target using @name.\n"
            "- message must directly agree, disagree, or ask for clarification.\n"
            "- shifts must be gradual in range -0.10..0.10.\n"
            "- if insight is non-empty, it must be a strategic blocker such as weak differentiation, weak demand, or high cost.\n"
            "- output JSON only."
        )

    def _legacy_build_turn(
        self,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        payload: Dict[str, Any],
        iteration: int,
        question_mode: bool,
    ) -> DialogueTurn:
        message = str(payload.get("message") or "").strip() or self._fallback_turn_payload(
            speaker=speaker,
            target=target,
            argument=argument,
            evidence=evidence,
            question_mode=question_mode,
            state=state,
        )["message"]
        question_text = str(payload.get("question") or "").strip() or None
        return DialogueTurn(
            step_uid=str(uuid.uuid4()),
            iteration=iteration,
            phase=SimulationPhase.AGENT_DELIBERATION.value,
            agent_id=speaker.persona_id,
            agent_name=speaker.name,
            reply_to_agent_id=target.persona_id,
            reply_to_agent_name=target.name,
            message=message,
            stance_before=speaker.opinion,
            stance_after=speaker.opinion,
            confidence=round(speaker.confidence, 3),
            influence_delta=round(float(payload.get("target_shift") or 0.0), 4),
            evidence_urls=[item.get("url") for item in evidence if item.get("url")],
            reason_tag=str(payload.get("reason_tag") or ("neutral_question" if question_mode else "debate")),
            message_type="question" if question_text else "argument",
            argument_id=str(argument.get("id") or "") or None,
            insight_tag=str(payload.get("insight") or "") or None,
            question_asked=question_text,
        )

    def _legacy_apply_turn_effects_v1(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        turn: DialogueTurn,
        argument: Dict[str, Any],
        payload: Dict[str, Any],
    ) -> None:
        max_shift = self._max_shift_for_iteration(turn.iteration)
        target_delta = self._clamp(float(payload.get("target_shift") or 0.0), -max_shift, max_shift)
        speaker_delta = self._clamp(float(payload.get("speaker_shift") or 0.0), -max_shift * 0.65, max_shift * 0.65)
        rule_multiplier = self._interaction_multiplier(speaker.category_id, target.category_id)
        argument_strength = float(argument.get("strength") or 0.5)
        influence_gain = 0.0
        conformity = float(target.traits.get("conformity", target.conformity_level))
        stubbornness = float(target.traits.get("stubbornness", target.stubbornness_level))
        innovation = float(target.traits.get("innovation_openness", target.innovation_openness))
        financial = float(target.traits.get("financial_sensitivity", target.financial_sensitivity))
        text = self._normalize_message(" ".join([turn.message, str(argument.get("claim") or "")]))
        price_argument = any(token in text for token in ("price", "cost", "fee", "pricing", "السعر", "التكلفة", "رسوم"))
        innovation_argument = any(token in text for token in ("different", "innov", "new", "ميزة", "مختلف", "جديد", "ابتكار"))

        if bool(payload.get("convincing")):
            influence_gain = 0.03 + argument_strength * 0.04
            speaker.influence_weight = round(self._clamp(speaker.influence_weight + influence_gain, 0.3, 3.0), 3)
        if bool(payload.get("rejected")):
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) + 0.04, 0.05, 0.98),
                3,
            )

        effective_target_delta = target_delta * rule_multiplier * (0.55 + float(target.traits.get("evidence_affinity", 0.55)) / 2)
        effective_target_delta *= 0.75 + speaker.influence_weight / 4
        effective_target_delta *= 0.78 + conformity * 0.34
        effective_target_delta *= 0.72 + (1 - stubbornness) * 0.34
        if price_argument:
            price_scale = 0.84 + (financial * 0.28 if effective_target_delta <= 0 else (1 - financial) * 0.16)
            effective_target_delta *= price_scale
        if innovation_argument and effective_target_delta > 0:
            effective_target_delta *= 0.88 + innovation * 0.25
        if turn.message_type == "question":
            effective_target_delta *= 0.35
        effective_target_delta = self._clamp(effective_target_delta, -max_shift, max_shift)

        self._shift_persona(target, effective_target_delta)
        self._shift_persona(speaker, speaker_delta)
        turn.stance_after = speaker.opinion
        turn.confidence = round(speaker.confidence, 3)
        turn.influence_delta = round(effective_target_delta, 4)

        if abs(effective_target_delta) < 0.012 and turn.message_type != "question":
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) + 0.025, 0.05, 0.98),
                3,
            )
        elif bool(payload.get("convincing")) and conformity >= 0.55:
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) - 0.02, 0.05, 0.98),
                3,
            )

        cluster_id = str(target.traits.get("cluster_id") or "")
        member_ids = list((state.deliberation_state.get("clusters") or {}).get(cluster_id) or [])
        followers = [item for item in state.personas if item.persona_id in member_ids and item.persona_id != target.persona_id]
        propagation = effective_target_delta * max(0.12, min(0.42, speaker.influence_weight / 6))
        for follower in followers[:24]:
            self._shift_persona(
                follower,
                propagation * (0.6 + float(follower.traits.get("representative_weight", 1.0)) / 4),
            )

        state.argument_bank.append(
            {
                "id": turn.argument_id or f"turn-{turn.step_uid[:8]}",
                "kind": "deliberation",
                "polarity": "question" if turn.message_type == "question" else ("support" if effective_target_delta >= 0 else "concern"),
                "claim": turn.message,
                "summary": turn.message[:180],
                "strength": round(min(0.95, abs(effective_target_delta) + argument_strength / 2 + influence_gain), 3),
                "evidence_urls": list(turn.evidence_urls),
                "source": "deliberation",
                "speaker_id": speaker.persona_id,
                "target_id": target.persona_id,
                "iteration": turn.iteration,
            }
        )
        state.argument_bank = state.argument_bank[-180:]

    def _legacy_shift_persona_v1(self, persona: PersonaProfile, requested_delta: float) -> None:
        inertia = float(persona.traits.get("inertia", 0.45))
        skepticism = float(persona.traits.get("dynamic_skepticism", 0.5))
        conformity = float(persona.traits.get("conformity", persona.conformity_level))
        stubbornness = float(persona.traits.get("stubbornness", persona.stubbornness_level))
        innovation = float(persona.traits.get("innovation_openness", persona.innovation_openness))
        cap = 0.03 + (1 - inertia) * 0.06
        dampened = requested_delta * max(0.2, 1 - skepticism * 0.45)
        dampened *= 0.82 + conformity * 0.18
        dampened *= 0.8 + (1 - stubbornness) * 0.2
        if requested_delta > 0:
            dampened *= 0.9 + innovation * 0.12
        delta = self._clamp(dampened, -cap, cap)
        previous_score = persona.opinion_score
        persona.opinion_score = round(self._clamp(persona.opinion_score + delta, -1.0, 1.0), 4)
        persona.confidence = round(self._clamp(persona.confidence + abs(delta) * 0.6, 0.2, 0.99), 3)
        if previous_score < 0 and persona.opinion_score > 0.15 and abs(previous_score) > 0.4:
            persona.opinion_score = 0.08
        if previous_score > 0 and persona.opinion_score < -0.15 and abs(previous_score) > 0.4:
            persona.opinion_score = -0.08
        persona.opinion = self._stance_from_score(persona.opinion_score)

    def _legacy_apply_turn_effects_v2(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        turn: DialogueTurn,
        argument: Dict[str, Any],
        payload: Dict[str, Any],
    ) -> None:
        target_delta = self._clamp(float(payload.get("target_shift") or 0.0), -0.1, 0.1)
        speaker_delta = self._clamp(float(payload.get("speaker_shift") or 0.0), -0.05, 0.05)
        rule_multiplier = self._interaction_multiplier(speaker.category_id, target.category_id)
        argument_strength = float(argument.get("strength") or 0.5)
        influence_gain = 0.0

        if bool(payload.get("convincing")):
            influence_gain = 0.03 + argument_strength * 0.04
            speaker.influence_weight = round(self._clamp(speaker.influence_weight + influence_gain, 0.3, 3.0), 3)
        if bool(payload.get("rejected")):
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) + 0.04, 0.05, 0.98),
                3,
            )

        effective_target_delta = target_delta * rule_multiplier * (0.55 + float(target.traits.get("evidence_affinity", 0.55)) / 2)
        effective_target_delta *= 0.75 + speaker.influence_weight / 4
        if turn.message_type == "question":
            effective_target_delta *= 0.35
        self._shift_persona(target, effective_target_delta)
        self._shift_persona(speaker, speaker_delta)
        turn.stance_after = speaker.opinion
        turn.confidence = round(speaker.confidence, 3)
        turn.influence_delta = round(effective_target_delta, 4)

        cluster_id = str(target.traits.get("cluster_id") or "")
        member_ids = list((state.deliberation_state.get("clusters") or {}).get(cluster_id) or [])
        followers = [item for item in state.personas if item.persona_id in member_ids and item.persona_id != target.persona_id]
        propagation = effective_target_delta * max(0.12, min(0.42, speaker.influence_weight / 6))
        for follower in followers[:24]:
            self._shift_persona(
                follower,
                propagation * (0.6 + float(follower.traits.get("representative_weight", 1.0)) / 4),
            )

        state.argument_bank.append(
            {
                "id": turn.argument_id or f"turn-{turn.step_uid[:8]}",
                "kind": "deliberation",
                "polarity": "question" if turn.message_type == "question" else ("support" if effective_target_delta >= 0 else "concern"),
                "claim": turn.message,
                "summary": turn.message[:180],
                "strength": round(min(0.95, abs(effective_target_delta) + argument_strength / 2 + influence_gain), 3),
                "evidence_urls": list(turn.evidence_urls),
                "source": "deliberation",
                "speaker_id": speaker.persona_id,
                "target_id": target.persona_id,
                "iteration": turn.iteration,
            }
        )
        state.argument_bank = state.argument_bank[-180:]

    def _legacy_shift_persona_v2(self, persona: PersonaProfile, requested_delta: float) -> None:
        inertia = float(persona.traits.get("inertia", 0.45))
        skepticism = float(persona.traits.get("dynamic_skepticism", 0.5))
        cap = 0.03 + (1 - inertia) * 0.06
        dampened = requested_delta * max(0.2, 1 - skepticism * 0.45)
        delta = self._clamp(dampened, -cap, cap)
        previous_score = persona.opinion_score
        persona.opinion_score = round(self._clamp(persona.opinion_score + delta, -1.0, 1.0), 4)
        persona.confidence = round(self._clamp(persona.confidence + abs(delta) * 0.6, 0.2, 0.99), 3)
        if previous_score < 0 and persona.opinion_score > 0.15 and abs(previous_score) > 0.4:
            persona.opinion_score = 0.08
        if previous_score > 0 and persona.opinion_score < -0.15 and abs(previous_score) > 0.4:
            persona.opinion_score = -0.08
        persona.opinion = self._stance_from_score(persona.opinion_score)

    def _interaction_multiplier(self, from_category: str, to_category: str) -> float:
        rule = self.runtime.dataset.rules_by_pair.get((from_category, to_category))
        return self._clamp(float(rule.influence_multiplier), 0.55, 1.45) if rule is not None else 1.0

    def _detect_critical_insight(
        self,
        state: OrchestrationState,
        turn: DialogueTurn,
        argument: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        text = " ".join([str(turn.message or ""), str(turn.insight_tag or ""), str(argument.get("claim") or "")]).lower()
        patterns = {
            "weak_differentiation": ["ميزة تنافسية", "competitive advantage", "differentiation", "تمييز"],
            "weak_demand": ["no demand", "low demand", "ضعيف", "مش طلب"],
            "cost_pressure": ["تكلفة", "expensive", "high cost", "هامش"],
        }
        for tag, needles in patterns.items():
            if not any(needle in text for needle in needles):
                continue
            if any(item.get("tag") == tag for item in state.critical_insights):
                return None
            message = str(turn.insight_tag or argument.get("claim") or turn.message).strip()
            if message:
                return {
                    "tag": tag,
                    "message": message[:220],
                    "iteration": turn.iteration,
                    "speaker": turn.agent_name,
                }
        return None

    async def _pause_for_insight(self, state: OrchestrationState, insight: Dict[str, Any]) -> None:
        state.critical_insights.append(dict(insight))
        state.pending_input = True
        state.pending_input_kind = "insight_followup"
        state.pending_resume_phase = SimulationPhase.AGENT_DELIBERATION.value
        state.status = "paused"
        state.status_reason = "critical_insight_detected"
        prompt = (
            "هل تحب أساعدك تقترح أفكار تميز المشروع؟"
            if str(state.user_context.get("language") or "en").startswith("ar")
            else "Would you like help proposing differentiators for the project?"
        )
        state.clarification_questions = [
            ClarificationQuestion(
                question_id=f"insight_{insight.get('tag')}",
                field_name="insight_followup",
                prompt=prompt,
                reason=str(insight.get("message") or ""),
                required=True,
                options=["yes", "no"],
            )
        ]
        await self.runtime.event_bus.publish(
            state,
            "critical_insight_detected",
            {
                "agent": self.name,
                "insight_tag": insight.get("tag"),
                "message": insight.get("message"),
                "prompt": prompt,
            },
        )

    def _fallback_turn_payload(
        self,
        *,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        question_mode: bool,
        state: OrchestrationState,
        iteration: int,
        memory_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        location = self._location_label(state) or "المنطقة دي"
        focus = self._persona_focus_phrase(speaker)
        tone = self._persona_tone_phrase(speaker, iteration)
        research_line = self._research_reference_phrase(state, speaker, argument, evidence)
        local_line = self._local_context_phrase(state, speaker)
        stance_line = self._stance_progression_phrase(speaker, iteration)
        memory_context = memory_context or {}
        memory_line = ""
        if memory_context.get("recurring_objections"):
            memory_line = f" وفيه اعتراض متكرر قبل كده على نقطة {str((memory_context.get('recurring_objections') or [''])[0])}"
        elif memory_context.get("execution_learnings"):
            memory_line = f" وفيه تعلّم سابق بيقول إن المشكلة كانت في {str((memory_context.get('execution_learnings') or [''])[0])}"
        challenge = "أنا شايف إن ده لسه محتاج سبب أقوى"
        if speaker.financial_sensitivity >= 0.65:
            challenge = "أنا شايف إن السعر ممكن يبقى عقبة من أول لحظة"
        elif speaker.skepticism_level >= 0.65:
            challenge = "أنا محتاج دليل عملي مش مجرد كلام"
        elif speaker.innovation_openness >= 0.65:
            challenge = "أنا فاهم الجديد فيه، بس لسه محتاج فايدة أوضح"
        if memory_line:
            research_line = f"{research_line}{memory_line}"
        max_shift = self._max_shift_for_iteration(iteration)
        if question_mode:
            return {
                "message": (
                    f"@{target.name} {tone}. {focus}، و{research_line}. "
                    f"{stance_line}، فإزاي ده هيشتغل فعليًا في {location}؟"
                ),
                "target_shift": 0.0,
                "speaker_shift": 0.01 if target.opinion != "neutral" else 0.0,
                "convincing": False,
                "rejected": False,
                "insight": "",
                "insight_severity": 0.0,
                "question": f"إزاي ده يثبت نفسه فعلًا في {location}؟",
                "reason_tag": "persona_question",
            }
        if speaker.opinion == "accept":
            return {
                "message": (
                    f"@{target.name} {tone}. {research_line}، {local_line}. "
                    f"{focus}، فممكن تمشي بس لو النقطة دي متغطية."
                ),
                "target_shift": max_shift if target.opinion != "accept" else round(max_shift * 0.35, 4),
                "speaker_shift": 0.01,
                "convincing": target.opinion != "accept",
                "rejected": False,
                "insight": "",
                "insight_severity": 0.0,
                "question": "",
                "reason_tag": "persona_support",
            }
        insight = ""
        if any(
            token in self._normalize_message(" ".join([str(argument.get("claim") or ""), research_line, local_line]))
            for token in ("منافس", "different", "ميزة", "مختلف", "متشبع")
        ):
            insight = "واضح إن التميز لسه مش كفاية"
        return {
            "message": (
                f"@{target.name} {tone}. {focus}، و{research_line}. "
                f"{local_line}، فبصراحة {challenge}"
            ),
            "target_shift": -max_shift if target.opinion != "reject" else round(-max_shift * 0.35, 4),
            "speaker_shift": -0.008,
            "convincing": target.opinion == "neutral",
            "rejected": target.opinion == "accept",
            "insight": insight,
            "insight_severity": 0.78 if insight else 0.0,
            "question": "",
            "reason_tag": "persona_concern",
        }

    def _deliberation_prompt(
        self,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        question_mode: bool,
        iteration: int,
        memory_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        memory_context = memory_context or {}
        structured = self._research_schema(state)
        research_anchors = " | ".join(self._research_anchor_terms(state, speaker, argument, evidence)[:8]) or "السوق | الناس"
        persona_anchors = " | ".join(self._persona_anchor_terms(speaker)[:8]) or "القيمة | الطلب"
        recent_turns = [
            turn.message
            for turn in state.dialogue_turns[-8:]
            if turn.agent_id == speaker.persona_id or turn.agent_id == target.persona_id
        ]
        recent_lines = "\n".join(f"- {text}" for text in recent_turns[-4:]) or "- no recent direct exchange"
        evidence_lines = "\n".join(
            f"- {item.get('title')} | {item.get('domain')} | {item.get('snippet')} | {item.get('url')}"
            for item in evidence
        ) or "- no evidence URLs available"
        memory_items: List[str] = []
        for item in (
            list(memory_context.get("recurring_objections") or [])
            + list(memory_context.get("confirmed_signals") or [])
            + list(memory_context.get("execution_learnings") or [])
            + list(memory_context.get("relationship_context") or [])
        ):
            text = str(item or "").strip()
            if not text or text in memory_items:
                continue
            memory_items.append(text)
            if len(memory_items) >= 8:
                break
        memory_lines = "\n".join(f"- {item}" for item in memory_items) or "- no durable memory hits"
        return (
            f"Language: {'Arabic' if str(state.user_context.get('language') or 'en').startswith('ar') else 'English'}\n"
            f"Idea: {state.user_context.get('idea')}\n"
            f"Location: {self._location_label(state)}\n"
            f"Iteration: {iteration}\n"
            f"Question mode: {question_mode}\n"
            f"Speaker: {speaker.name}\n"
            f"Speaker cluster: {speaker.archetype_name}\n"
            f"Speaker profession: {speaker.profession_role}\n"
            f"Speaker opinion: {speaker.opinion} score={speaker.opinion_score:.3f}\n"
            f"Speaker financial sensitivity: {speaker.financial_sensitivity:.2f}\n"
            f"Speaker skepticism: {speaker.skepticism_level:.2f}\n"
            f"Speaker conformity: {speaker.conformity_level:.2f}\n"
            f"Speaker stubbornness: {speaker.stubbornness_level:.2f}\n"
            f"Speaker innovation openness: {speaker.innovation_openness:.2f}\n"
            f"Speaker motivations: {' | '.join(speaker.motivations[:4])}\n"
            f"Speaker concerns: {' | '.join(speaker.concerns[:4])}\n"
            f"Speaker speaking style: {speaker.speaking_style}\n"
            f"Speaker evidence signals: {' | '.join(speaker.evidence_signals[:4])}\n"
            f"Target: {target.name} ({target.archetype_name}) opinion={target.opinion} score={target.opinion_score:.3f}\n"
            f"Argument focus: {argument.get('claim')}\n"
            f"Structured competition: {structured.get('competition_level')}\n"
            f"Structured demand: {structured.get('demand_level')}\n"
            f"Structured price sensitivity: {structured.get('price_sensitivity')}\n"
            f"Structured complaints: {' | '.join(list(structured.get('complaints') or [])[:4])}\n"
            f"Structured behaviors: {' | '.join(list(structured.get('behaviors') or [])[:4])}\n"
            f"Structured competition reactions: {' | '.join(list(structured.get('competition_reactions') or [])[:4])}\n"
            f"Mandatory persona anchors to use exactly or closely: {persona_anchors}\n"
            f"Mandatory research anchors to use exactly or closely: {research_anchors}\n"
            f"Recent direct exchange:\n{recent_lines}\n"
            f"Research evidence:\n{evidence_lines}\n"
            f"Durable memory context:\n{memory_lines}\n"
            "Return JSON with keys: message, target_shift, speaker_shift, convincing, rejected, insight, insight_severity, question, reason_tag.\n"
            "Constraints:\n"
            "- message must be short colloquial Arabic, 1 to 3 short sentences, no bullet points.\n"
            "- message must mention the target using @name.\n"
            "- the speaker must sound like this exact persona, not a neutral analyst.\n"
            "- reasoning must come from the speaker's profession, money sensitivity, skepticism, conformity, stubbornness, openness, motivations, concerns, and local context.\n"
            "- message must reference real research or local-market signals, not a vague summary.\n"
            "- message must challenge, question, agree partially, or push back on the target.\n"
            f"- target_shift must stay within {-self._max_shift_for_iteration(iteration):.3f}..{self._max_shift_for_iteration(iteration):.3f}.\n"
            "- no instant jump from rejection to full acceptance.\n"
            "- if insight is non-empty, it must be a serious blocker such as weak differentiation, weak demand, high cost, or crowded market.\n"
            "- output JSON only."
        )

    def _build_turn(
        self,
        *,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        argument: Dict[str, Any],
        evidence: List[Dict[str, Any]],
        payload: Dict[str, Any],
        iteration: int,
        question_mode: bool,
    ) -> DialogueTurn:
        message = str(payload.get("message") or "").strip() or self._fallback_turn_payload(
            speaker=speaker,
            target=target,
            argument=argument,
            evidence=evidence,
            question_mode=question_mode,
            state=state,
            iteration=iteration,
        )["message"]
        question_text = str(payload.get("question") or "").strip() or None
        return DialogueTurn(
            step_uid=str(uuid.uuid4()),
            iteration=iteration,
            phase=SimulationPhase.AGENT_DELIBERATION.value,
            agent_id=speaker.persona_id,
            agent_name=speaker.name,
            reply_to_agent_id=target.persona_id,
            reply_to_agent_name=target.name,
            message=message,
            stance_before=speaker.opinion,
            stance_after=speaker.opinion,
            confidence=round(speaker.confidence, 3),
            influence_delta=round(float(payload.get("target_shift") or 0.0), 4),
            evidence_urls=[item.get("url") for item in evidence if item.get("url")],
            reason_tag=str(payload.get("reason_tag") or ("persona_question" if question_mode else "persona_argument")),
            message_type="question" if question_text else "argument",
            argument_id=str(argument.get("id") or "") or None,
            insight_tag=str(payload.get("insight") or "") or None,
            question_asked=question_text,
        )

    def _apply_turn_effects(
        self,
        state: OrchestrationState,
        speaker: PersonaProfile,
        target: PersonaProfile,
        turn: DialogueTurn,
        argument: Dict[str, Any],
        payload: Dict[str, Any],
    ) -> None:
        max_shift = self._max_shift_for_iteration(turn.iteration)
        target_delta = self._clamp(float(payload.get("target_shift") or 0.0), -max_shift, max_shift)
        speaker_delta = self._clamp(float(payload.get("speaker_shift") or 0.0), -max_shift * 0.65, max_shift * 0.65)
        rule_multiplier = self._interaction_multiplier(speaker.category_id, target.category_id)
        argument_strength = float(argument.get("strength") or 0.5)
        influence_gain = 0.0
        conformity = float(target.traits.get("conformity", target.conformity_level))
        stubbornness = float(target.traits.get("stubbornness", target.stubbornness_level))
        innovation = float(target.traits.get("innovation_openness", target.innovation_openness))
        financial = float(target.traits.get("financial_sensitivity", target.financial_sensitivity))
        text = self._normalize_message(" ".join([turn.message, str(argument.get("claim") or "")]))
        price_argument = any(token in text for token in ("price", "cost", "fee", "pricing", "السعر", "التكلفة", "رسوم"))
        innovation_argument = any(token in text for token in ("different", "innov", "new", "ميزة", "مختلف", "جديد", "ابتكار"))

        if bool(payload.get("convincing")):
            influence_gain = 0.03 + argument_strength * 0.04
            speaker.influence_weight = round(self._clamp(speaker.influence_weight + influence_gain, 0.3, 3.0), 3)
        if bool(payload.get("rejected")):
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) + 0.04, 0.05, 0.98),
                3,
            )

        effective_target_delta = target_delta * rule_multiplier * (0.55 + float(target.traits.get("evidence_affinity", 0.55)) / 2)
        effective_target_delta *= 0.75 + speaker.influence_weight / 4
        effective_target_delta *= 0.78 + conformity * 0.34
        effective_target_delta *= 0.72 + (1 - stubbornness) * 0.34
        if price_argument:
            price_scale = 0.84 + (financial * 0.28 if effective_target_delta <= 0 else (1 - financial) * 0.16)
            effective_target_delta *= price_scale
        if innovation_argument and effective_target_delta > 0:
            effective_target_delta *= 0.88 + innovation * 0.25
        if turn.message_type == "question":
            effective_target_delta *= 0.35
        effective_target_delta = self._clamp(effective_target_delta, -max_shift, max_shift)

        self._shift_persona(target, effective_target_delta)
        self._shift_persona(speaker, speaker_delta)
        turn.stance_after = speaker.opinion
        turn.confidence = round(speaker.confidence, 3)
        turn.influence_delta = round(effective_target_delta, 4)

        if abs(effective_target_delta) < 0.012 and turn.message_type != "question":
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) + 0.025, 0.05, 0.98),
                3,
            )
        elif bool(payload.get("convincing")) and conformity >= 0.55:
            target.traits["dynamic_skepticism"] = round(
                self._clamp(float(target.traits.get("dynamic_skepticism", 0.5)) - 0.02, 0.05, 0.98),
                3,
            )

        cluster_id = str(target.traits.get("cluster_id") or "")
        member_ids = list((state.deliberation_state.get("clusters") or {}).get(cluster_id) or [])
        followers = [item for item in state.personas if item.persona_id in member_ids and item.persona_id != target.persona_id]
        propagation = effective_target_delta * max(0.12, min(0.42, speaker.influence_weight / 6))
        for follower in followers[:24]:
            self._shift_persona(
                follower,
                propagation * (0.6 + float(follower.traits.get("representative_weight", 1.0)) / 4),
            )

        state.argument_bank.append(
            {
                "id": turn.argument_id or f"turn-{turn.step_uid[:8]}",
                "kind": "deliberation",
                "polarity": "question" if turn.message_type == "question" else ("support" if effective_target_delta >= 0 else "concern"),
                "claim": turn.message,
                "summary": turn.message[:180],
                "strength": round(min(0.95, abs(effective_target_delta) + argument_strength / 2 + influence_gain), 3),
                "evidence_urls": list(turn.evidence_urls),
                "source": "deliberation",
                "speaker_id": speaker.persona_id,
                "target_id": target.persona_id,
                "iteration": turn.iteration,
            }
        )
        state.argument_bank = state.argument_bank[-180:]

    def _shift_persona(self, persona: PersonaProfile, requested_delta: float) -> None:
        inertia = float(persona.traits.get("inertia", 0.45))
        skepticism = float(persona.traits.get("dynamic_skepticism", 0.5))
        conformity = float(persona.traits.get("conformity", persona.conformity_level))
        stubbornness = float(persona.traits.get("stubbornness", persona.stubbornness_level))
        innovation = float(persona.traits.get("innovation_openness", persona.innovation_openness))
        cap = 0.03 + (1 - inertia) * 0.06
        dampened = requested_delta * max(0.2, 1 - skepticism * 0.45)
        dampened *= 0.82 + conformity * 0.18
        dampened *= 0.8 + (1 - stubbornness) * 0.2
        if requested_delta > 0:
            dampened *= 0.9 + innovation * 0.12
        delta = self._clamp(dampened, -cap, cap)
        previous_score = persona.opinion_score
        persona.opinion_score = round(self._clamp(persona.opinion_score + delta, -1.0, 1.0), 4)
        persona.confidence = round(self._clamp(persona.confidence + abs(delta) * 0.6, 0.2, 0.99), 3)
        if previous_score < 0 and persona.opinion_score > 0.15 and abs(previous_score) > 0.4:
            persona.opinion_score = 0.08
        if previous_score > 0 and persona.opinion_score < -0.15 and abs(previous_score) > 0.4:
            persona.opinion_score = -0.08
        persona.opinion = self._stance_from_score(persona.opinion_score)

    def _enforce_neutral_cap(self, state: OrchestrationState) -> None:
        total = max(1, len(state.personas))
        max_neutral = int(total * 0.3)
        neutrals = [persona for persona in state.personas if persona.opinion == "neutral"]
        if len(neutrals) <= max_neutral:
            return
        support_strength = max([float(item.get("strength") or 0.0) for item in state.argument_bank if item.get("polarity") == "support"] or [0.0])
        concern_strength = max([float(item.get("strength") or 0.0) for item in state.argument_bank if item.get("polarity") == "concern"] or [0.0])
        shift = 0.11 if support_strength >= concern_strength else -0.11
        neutrals.sort(key=lambda item: (float(item.traits.get("inertia", 0.45)), item.confidence))
        for persona in neutrals[max_neutral:]:
            self._shift_persona(persona, shift)
            if persona.opinion == "neutral":
                self._shift_persona(persona, shift * 0.55)

    def _compute_metrics(self, state: OrchestrationState, iteration: int) -> Dict[str, Any]:
        accepted = sum(1 for item in state.personas if item.opinion == "accept")
        rejected = sum(1 for item in state.personas if item.opinion == "reject")
        neutral = max(0, len(state.personas) - accepted - rejected)
        total = max(1, len(state.personas))
        return {
            "iteration": iteration,
            "accepted": accepted,
            "rejected": rejected,
            "neutral": neutral,
            "acceptance_rate": round(accepted / total, 3),
            "polarization": round(abs(accepted - rejected) / total, 3),
            "neutral_ratio": round(neutral / total, 3),
            "total_agents": len(state.personas),
            "cluster_count": len(state.deliberation_state.get("clusters") or {}),
            "represented_agents": len(state.deliberation_state.get("leaders") or {}),
            "llm_speaker_budget": int(state.deliberation_state.get("speaker_budget") or 0),
            "total_iterations": int(state.deliberation_state.get("total_iterations") or 0),
            "critical_insights": len(state.critical_insights),
            "per_category": self._per_category_counts(state),
        }

    def _per_category_counts(self, state: OrchestrationState) -> Dict[str, Dict[str, int]]:
        bucket: Dict[str, Dict[str, int]] = {}
        for persona in state.personas:
            current = bucket.setdefault(persona.category_id, {"accept": 0, "reject": 0, "neutral": 0})
            current[persona.opinion] += 1
        return bucket

    def _neutral_ratio(self, state: OrchestrationState) -> float:
        total = max(1, len(state.personas))
        neutral = sum(1 for item in state.personas if item.opinion == "neutral")
        return neutral / total

    def _target_iterations(self, agent_count: int) -> int:
        if agent_count >= 350:
            return 6
        if agent_count >= 140:
            return 5
        return 4

    def _stance_from_score(self, score: float) -> str:
        if score >= 0.12:
            return "accept"
        if score <= -0.12:
            return "reject"
        return "neutral"

    def _clamp(self, value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(maximum, value))

    def _detect_orchestrator_intervention(
        self,
        state: OrchestrationState,
        turn: DialogueTurn,
        argument: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        optimization = self._build_optimization_decision(state)
        if optimization.get("decision") == "READY_TO_MOVE_FORWARD":
            return None
        active = next(
            (
                item
                for item in reversed(state.critical_insights)
                if item.get("kind") == "orchestrator_intervention" and not bool(item.get("resolved"))
            ),
            None,
        )
        if active is not None:
            return None

        patterns = {
            "weak_differentiation": {
                "terms": ["ميزة", "مختلف", "جديد", "تمييز", "already exists", "same", "unique"],
                "threshold": 2,
                "user_message": "واضح إن في مشكلة مهمة ظهرت: أكتر من صوت شايف إن الفكرة مش مميزة كفاية عن الموجود.",
                "reason_line": "النقاش بيرجع لنفس النقطة: ليه العميل يختارك إنت؟",
            },
            "cost_pressure": {
                "terms": ["سعر", "تكلفة", "رسوم", "غالي", "هامش", "roi", "cost", "price", "fee"],
                "threshold": 2,
                "user_message": "واضح إن في ضغط واضح على السعر والتكلفة، وده مأثر على تقبل الفكرة.",
                "reason_line": "أكتر من شخصية شايفة إن السعر أو الرسوم ممكن يكسروا الإقبال.",
            },
            "market_saturation": {
                "terms": ["منافسة", "متشبع", "موجود", "بديل", "crowded", "saturated", "competition"],
                "threshold": 2,
                "user_message": "واضح إن السوق متشبع أو فيه بدائل كتير، وده مقلق المشاركين.",
                "reason_line": "الاعتراض هنا مش على الفكرة نفسها قد ما هو على الزحمة في السوق.",
            },
            "weak_demand": {
                "terms": ["طلب", "مين هيشتري", "مش محتاج", "مش فارقة", "demand", "need", "no demand"],
                "threshold": 2,
                "user_message": "واضح إن في شك حقيقي حوالين وجود طلب كفاية على الفكرة.",
                "reason_line": "فيه ناس مش شايفة احتياج واضح أو استعداد حقيقي للدفع.",
            },
            "unrealistic_assumption": {
                "terms": ["إزاي", "مش واضح", "صعب", "مش عملي", "مين هيشغل", "مين هينفذ", "unclear", "feasible", "execution"],
                "threshold": 3,
                "user_message": "واضح إن في افتراضات لسه مش واقعية أو التنفيذ مش واضح بما يكفي.",
                "reason_line": "النقاش دخل في أسئلة تنفيذية متكررة من غير إجابة مقنعة.",
            },
        }

        recent_turns = state.dialogue_turns[-14:]
        recent_texts = [self._normalize_message(" ".join([item.message, item.reason_tag or ""])) for item in recent_turns]
        structured = self._research_schema(state)
        for tag, config in patterns.items():
            if any(item.get("tag") == tag and item.get("kind") == "orchestrator_intervention" for item in state.critical_insights):
                continue
            mentions = 0
            speakers: set[str] = set()
            for item, text in zip(recent_turns, recent_texts):
                if any(term.lower() in text for term in config["terms"]):
                    mentions += 1
                    speakers.add(item.agent_id)
            if any(term.lower() in self._normalize_message(" ".join([turn.message, str(argument.get("claim") or ""), str(turn.insight_tag or "")])) for term in config["terms"]):
                mentions += 1
                speakers.add(turn.agent_id)
            research_boost = 0.0
            if tag in {"weak_differentiation", "market_saturation"} and str(structured.get("competition_level") or "").lower() in {"high", "crowded", "saturated"}:
                research_boost += 0.28
            if tag == "cost_pressure" and str(structured.get("price_sensitivity") or "").lower() == "high":
                research_boost += 0.28
            if tag == "weak_demand" and str(structured.get("demand_level") or "").lower() in {"low", "weak"}:
                research_boost += 0.32
            if tag == "unrealistic_assumption" and not (state.user_context.get("valueProposition") or state.user_context.get("deliveryModel")):
                research_boost += 0.18
            severity = (mentions * 0.18) + (len(speakers) * 0.16) + research_boost
            if mentions < int(config["threshold"]) or len(speakers) < 2 or severity < 0.72:
                continue
            evidence_lines = self._extract_intervention_evidence(state, tag)
            return {
                "kind": "orchestrator_intervention",
                "tag": tag,
                "iteration": turn.iteration,
                "speaker": turn.agent_name,
                "message": config["reason_line"],
                "user_message": config["user_message"],
                "severity": round(min(1.0, severity), 3),
                "mentions": mentions,
                "speakers": len(speakers),
                "evidence_summary": evidence_lines,
                "location": self._location_label(state),
            }
        return self._detect_critical_insight(state, turn, argument)

    def _extract_intervention_evidence(self, state: OrchestrationState, tag: str) -> List[str]:
        structured = self._research_schema(state)
        lines: List[str] = []
        if tag in {"weak_differentiation", "market_saturation"} and str(structured.get("competition_level") or "").lower() in {"high", "crowded", "saturated"}:
            lines.append("البحث بيقول إن المنافسة عالية في السوق ده.")
        if tag == "cost_pressure" and str(structured.get("price_sensitivity") or "").lower() == "high":
            lines.append("البيانات بتوضح إن الناس حساسة للسعر.")
        if tag == "weak_demand" and str(structured.get("demand_level") or "").lower() in {"low", "weak"}:
            lines.append("فيه مؤشرات إن الطلب الحالي مش قوي كفاية.")
        source_lists = {
            "cost_pressure": structured.get("complaints") or [],
            "weak_demand": structured.get("behaviors") or [],
            "weak_differentiation": structured.get("competition_reactions") or [],
            "market_saturation": structured.get("competition_reactions") or [],
            "unrealistic_assumption": structured.get("gaps") or [],
        }
        for item in list(source_lists.get(tag) or [])[:2]:
            text = str(item).strip()
            if text:
                lines.append(text)
        for turn in reversed(state.dialogue_turns[-12:]):
            normalized = self._normalize_message(turn.message)
            if tag == "cost_pressure" and any(term in normalized for term in ("سعر", "تكلفة", "رسوم", "price", "cost")):
                lines.append(turn.message[:120])
            if tag in {"weak_differentiation", "market_saturation"} and any(term in normalized for term in ("ميزة", "مختلف", "متشبع", "منافسة", "competition")):
                lines.append(turn.message[:120])
            if tag == "weak_demand" and any(term in normalized for term in ("طلب", "مين هيشتري", "مش محتاج", "demand")):
                lines.append(turn.message[:120])
            if tag == "unrealistic_assumption" and any(term in normalized for term in ("إزاي", "مش واضح", "صعب", "execution", "feasible")):
                lines.append(turn.message[:120])
            if len(lines) >= 3:
                break
        unique: List[str] = []
        for line in lines:
            clean = str(line).strip()
            if clean and clean not in unique:
                unique.append(clean)
        return unique[:3]

    async def _pause_for_intervention(self, state: OrchestrationState, intervention: Dict[str, Any]) -> None:
        record = dict(intervention)
        record["intervention_id"] = str(record.get("intervention_id") or f"coach-{uuid.uuid4().hex[:10]}")
        record["created_at"] = int(record.get("created_at") or state.updated_at)
        record["resolved"] = False
        record["dismissed"] = False
        state.critical_insights.append(record)
        state.pending_input = True
        state.pending_input_kind = "orchestrator_intervention"
        state.pending_resume_phase = SimulationPhase.AGENT_DELIBERATION.value
        state.status = "paused"
        state.status_reason = "paused_coach_intervention"
        prompt = (
            f"{record.get('user_message')}\n"
            f"{record.get('message')}\n"
            "تحب نحل المشكلة دي قبل ما نكمل؟"
        )
        state.clarification_questions = [
            ClarificationQuestion(
                question_id=f"coach_{record.get('tag')}",
                field_name="coach_intervention",
                prompt=prompt,
                reason=" | ".join(record.get("evidence_summary") or [])[:280],
                required=True,
                options=["yes", "no"],
            )
        ]
        if getattr(self.runtime, "event_bus", None) is not None:
            await self.runtime.event_bus.publish(
                state,
                "orchestrator_intervention_requested",
                {
                    "agent": "orchestrator",
                    "tag": record.get("tag"),
                    "message": record.get("user_message"),
                    "evidence_summary": list(record.get("evidence_summary") or []),
                },
            )

    async def handle_orchestrator_intervention_response(
        self,
        state: OrchestrationState,
        answers: List[Dict[str, Any]],
    ) -> OrchestrationState:
        latest = next(
            (
                item
                for item in reversed(state.critical_insights)
                if item.get("kind") == "orchestrator_intervention" and not bool(item.get("resolved"))
            ),
            None,
        )
        if latest is None:
            state.pending_input = False
            state.pending_input_kind = None
            state.clarification_questions = []
            return state
        answer_text = " ".join(
            str(item.get("answer") or item.get("text") or "").strip()
            for item in answers
            if str(item.get("answer") or item.get("text") or "").strip()
        ).strip()
        if not answer_text:
            return state

        if state.pending_input_kind == "orchestrator_intervention":
            if self._answer_is_affirmative(answer_text):
                suggestions = await self._generate_orchestrator_suggestions(state, latest)
                latest["suggestions"] = suggestions
                latest["user_answer"] = answer_text
                state.schema["orchestratorSuggestions"] = suggestions
                memory_provider = getattr(self.runtime, "memory_provider", None)
                if memory_provider is not None:
                    await memory_provider.ingest_orchestrator_intervention(state=state, insight=latest)
                issue_overview = self._issue_overview_text(latest)
                state.pending_input = True
                state.pending_input_kind = "orchestrator_apply_suggestions"
                state.status = "paused"
                state.status_reason = "paused_coach_intervention"
                suggestion_text = "\n".join(f"- {item}" for item in suggestions[:5])
                state.clarification_questions = [
                    ClarificationQuestion(
                        question_id=f"coach_apply_{latest.get('tag')}",
                        field_name="coach_apply_suggestions",
                        prompt=(
                            f"{latest.get('user_message')}\n"
                            f"{issue_overview}\n"
                            "شايف أنسب تعديلات دلوقتي هي:\n"
                            f"{suggestion_text}\n"
                            "تحب نطبق التعديل ونشوف رد فعل المجتمع؟"
                        ),
                        reason="orchestrator_suggestions_ready",
                        required=True,
                        options=["yes", "no"],
                    )
                ]
                if getattr(self.runtime, "event_bus", None) is not None:
                    await self.runtime.event_bus.publish(
                        state,
                        "orchestrator_suggestions_ready",
                        {
                            "agent": "orchestrator",
                            "tag": latest.get("tag"),
                            "suggestions": suggestions,
                            "issue_clusters": list(latest.get("issue_clusters") or []),
                        },
                    )
                return state
            latest["dismissed"] = True
            latest["resolved"] = True
            latest["user_answer"] = answer_text
            latest["resolution"] = "skipped"
            latest["resolved_at"] = state.updated_at
            memory_provider = getattr(self.runtime, "memory_provider", None)
            if memory_provider is not None:
                await memory_provider.ingest_orchestrator_intervention(state=state, insight=latest)
            state.pending_input = False
            state.pending_input_kind = None
            state.status = "running"
            state.status_reason = "coach_intervention_skipped"
            state.clarification_questions = []
            return state

        if self._answer_is_affirmative(answer_text):
            self._apply_intervention_suggestions(state, latest)
            latest["applied"] = True
            latest["resolved"] = True
            latest["apply_answer"] = answer_text
            latest["resolution"] = "applied"
            latest["resolved_at"] = state.updated_at
            memory_provider = getattr(self.runtime, "memory_provider", None)
            if memory_provider is not None:
                await memory_provider.ingest_orchestrator_intervention(state=state, insight=latest)
            state.pending_input = False
            state.pending_input_kind = None
            state.status = "running"
            state.status_reason = "coach_intervention_applied"
            state.clarification_questions = []
            return state

        latest["applied"] = False
        latest["resolved"] = True
        latest["apply_answer"] = answer_text
        latest["resolution"] = "not_applied"
        latest["resolved_at"] = state.updated_at
        memory_provider = getattr(self.runtime, "memory_provider", None)
        if memory_provider is not None:
            await memory_provider.ingest_orchestrator_intervention(state=state, insight=latest)
        state.pending_input = False
        state.pending_input_kind = None
        state.status = "running"
        state.status_reason = "coach_intervention_not_applied"
        state.clarification_questions = []
        return state

    async def _generate_orchestrator_suggestions(
        self,
        state: OrchestrationState,
        latest: Dict[str, Any],
    ) -> List[str]:
        prior = self._recent_suggestion_memory(state)
        issue_clusters = self._group_intervention_problems(state, latest)
        latest["issue_clusters"] = issue_clusters
        state.schema["orchestratorSuggestionIssues"] = issue_clusters
        grouped_issue_lines = "\n".join(
            f"- {item['label']} ({item['code']}): {item['problem']} | Evidence: {' | '.join(item.get('evidence') or [])}"
            for item in issue_clusters
        )
        fallback = {
            "suggestions": self._fallback_suggestions_for_tag(
                state,
                str(latest.get("tag") or ""),
                exclude=prior,
                issue_clusters=issue_clusters,
            )
        }
        payload = await self.runtime.llm.generate_json(
            prompt=(
                f"Idea: {state.user_context.get('idea')}\n"
                f"Location: {self._location_label(state)}\n"
                f"Issue tag: {latest.get('tag')}\n"
                f"Issue summary: {latest.get('message')}\n"
                f"Evidence: {' | '.join(latest.get('evidence_summary') or [])}\n"
                f"Grouped issues from agent conversation:\n{grouped_issue_lines}\n"
                f"Research summary: {state.research.summary if state.research else ''}\n"
                f"Previous suggestions to avoid: {' | '.join(prior)}\n"
                "Return JSON {\"suggestions\": [3 to 5 short actionable Arabic modifications]}."
            ),
            system=(
                "You are a product strategist and market coach. "
                "Generate concrete, non-generic Arabic modifications grounded in agent objections, research, and location context. "
                "Each modification must improve the same idea, solve a grouped issue, and avoid repeating earlier advice. "
                "Do not suggest changing the business entirely."
            ),
            temperature=0.25,
            fallback_json=fallback,
        )
        suggestions = [str(item).strip() for item in payload.get("suggestions") or [] if str(item).strip()]
        suggestions = [
            item
            for item in suggestions
            if self._validate_modification_suggestion(item, latest, issue_clusters, prior=prior)
        ]
        if len(suggestions) < 3:
            suggestions = fallback["suggestions"]
        deduped: List[str] = []
        for item in suggestions:
            if item in deduped or item in prior:
                continue
            deduped.append(item)
        return deduped[:5] or fallback["suggestions"][:4]

    def _group_intervention_problems(
        self,
        state: OrchestrationState,
        latest: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        tag = str(latest.get("tag") or "")
        evidence_pool = [str(item).strip() for item in latest.get("evidence_summary") or [] if str(item).strip()]
        recent_turns = state.dialogue_turns[-14:]
        templates: Dict[str, List[Dict[str, Any]]] = {
            "cost_pressure": [
                {
                    "code": "entry_price",
                    "label": "حساسية سعر البداية",
                    "problem": "في ناس شايفة إن سعر البداية نفسه تقيل على القيمة الحالية.",
                    "terms": ["سعر", "غالي", "price"],
                },
                {
                    "code": "extra_fees",
                    "label": "الرسوم الإضافية",
                    "problem": "الرسوم الإضافية بتكسر القبول حتى لو الفكرة نفسها مفهومة.",
                    "terms": ["رسوم", "توصيل", "fee", "fees"],
                },
                {
                    "code": "weak_value_for_money",
                    "label": "القيمة مقابل السعر",
                    "problem": "في تردد لأن الناس مش شايفة قيمة واضحة تبرر الدفع.",
                    "terms": ["مستاهل", "قيمة", "roi", "return", "مقابل"],
                },
            ],
            "weak_differentiation": [
                {
                    "code": "sameness",
                    "label": "الفكرة شبه الموجود",
                    "problem": "أكتر من اعتراض راجع لفكرة إن الخدمة شبه بدائل موجودة بالفعل.",
                    "terms": ["زي", "نفس", "already exists", "same", "موجود"],
                },
                {
                    "code": "unclear_unique_value",
                    "label": "الميزة الأساسية مش واضحة",
                    "problem": "الناس مش قادرة تمسك ميزة محددة تخليهم يختاروا الفكرة دي.",
                    "terms": ["ميزة", "مختلف", "unique", "تمي", "فرق"],
                },
                {
                    "code": "broad_targeting",
                    "label": "الجمهور واسع زيادة",
                    "problem": "الفكرة بتبان عامة زيادة ومش موجهة لفئة واضحة.",
                    "terms": ["الناس كلها", "فئة", "مين", "segment", "شريحة"],
                },
            ],
            "market_saturation": [
                {
                    "code": "crowded_market",
                    "label": "زحمة المنافسين",
                    "problem": "الاعتراض المتكرر هنا إن السوق مليان بدائل قريبة.",
                    "terms": ["منافسة", "متشبع", "crowded", "saturated", "competition"],
                },
                {
                    "code": "copycat_positioning",
                    "label": "التمركز قريب من المنافسين",
                    "problem": "التمركز الحالي قريب جدًا من الموجود ومش مدي سبب كفاية للتجربة.",
                    "terms": ["بديل", "زي", "same", "existing", "منتشر"],
                },
                {
                    "code": "local_relevance_gap",
                    "label": "الربط المحلي ضعيف",
                    "problem": "الناس مش شايفة ربط قوي بين الفكرة وسلوك المنطقة نفسها.",
                    "terms": ["المنطقة", "هناك", "محلي", "local", "الهرم", "الجيزة"],
                },
            ],
            "weak_demand": [
                {
                    "code": "weak_need",
                    "label": "الاحتياج مش قوي",
                    "problem": "في ناس مش شايفة ألم واضح يستدعي الحل أصلًا.",
                    "terms": ["مش محتاج", "مش فارقة", "need", "احتياج"],
                },
                {
                    "code": "low_urgency",
                    "label": "الإلحاح منخفض",
                    "problem": "الناس ممكن تعيش من غير الفكرة فقرار الشراء مش عاجل.",
                    "terms": ["بعد كده", "مش ضروري", "later", "urgent", "دلوقتي"],
                },
                {
                    "code": "low_payment_intent",
                    "label": "الاستعداد للدفع ضعيف",
                    "problem": "الاعتراضات بتقول إن الرغبة في الدفع لسه ضعيفة أو مش مؤكدة.",
                    "terms": ["مين هيشتري", "يدفع", "دفع", "pay", "purchase"],
                },
            ],
            "unrealistic_assumption": [
                {
                    "code": "unclear_execution",
                    "label": "التنفيذ مش واضح",
                    "problem": "في أسئلة متكررة عن إزاي الفكرة هتتنفذ عمليًا.",
                    "terms": ["إزاي", "مش واضح", "unclear", "execution"],
                },
                {
                    "code": "operational_gap",
                    "label": "التشغيل معقّد",
                    "problem": "في شك إن التشغيل اليومي هيبقى أصعب من المتوقع.",
                    "terms": ["تشغيل", "صعب", "عملية", "operations", "feasible"],
                },
                {
                    "code": "delivery_uncertainty",
                    "label": "المسؤوليات مش محددة",
                    "problem": "الناس بتسأل مين هينفّذ ومين هيمسك الخطوات الحساسة.",
                    "terms": ["مين", "ينفذ", "هيشغل", "owner", "responsible"],
                },
            ],
        }
        groups: List[Dict[str, Any]] = []
        for template in templates.get(tag, []):
            evidence: List[str] = []
            speakers: set[str] = set()
            hits = 0
            for item in evidence_pool:
                normalized = self._normalize_message(item)
                if any(term.lower() in normalized for term in template["terms"]):
                    evidence.append(item[:140])
                    hits += 1
            for turn in reversed(recent_turns):
                normalized = self._normalize_message(turn.message)
                if any(term.lower() in normalized for term in template["terms"]):
                    evidence.append(turn.message[:140])
                    speakers.add(turn.agent_id)
                    hits += 1
                if len(evidence) >= 3:
                    break
            unique_evidence: List[str] = []
            for item in evidence:
                if item and item not in unique_evidence:
                    unique_evidence.append(item)
            if hits == 0:
                continue
            groups.append(
                {
                    "code": template["code"],
                    "label": template["label"],
                    "problem": template["problem"],
                    "evidence": unique_evidence[:3],
                    "priority": hits + len(speakers),
                }
            )
        if not groups:
            groups.append(self._default_issue_cluster(latest))
        groups.sort(key=lambda item: int(item.get("priority") or 0), reverse=True)
        return groups[:3]

    def _default_issue_cluster(self, latest: Dict[str, Any]) -> Dict[str, Any]:
        evidence = [str(item).strip() for item in latest.get("evidence_summary") or [] if str(item).strip()]
        return {
            "code": f"{str(latest.get('tag') or 'issue')}_core",
            "label": "المشكلة الأساسية",
            "problem": str(latest.get("message") or latest.get("user_message") or "في اعتراض متكرر محتاج تعديل واضح.").strip(),
            "evidence": evidence[:3],
            "priority": max(1, len(evidence)),
        }

    def _issue_overview_text(self, latest: Dict[str, Any]) -> str:
        issues = [item for item in latest.get("issue_clusters") or [] if isinstance(item, dict)]
        if not issues:
            return "أكتر من شخص كرر نفس التحفظ، فالأفضل نعالج النقطة دي قبل ما نكمل."
        labels = [str(item.get("label") or "").strip() for item in issues[:3] if str(item.get("label") or "").strip()]
        evidence: List[str] = []
        for item in issues[:2]:
            for line in item.get("evidence") or []:
                text = str(line).strip()
                if text and text not in evidence:
                    evidence.append(text)
                if len(evidence) >= 2:
                    break
        label_text = "، ".join(labels)
        if evidence:
            return f"أكتر من شخص كان مركز على {label_text}، وده ظاهر في كلام زي: {evidence[0]}"
        return f"أكتر من شخص كان مركز على {label_text}."

    def _validate_modification_suggestion(
        self,
        suggestion: str,
        latest: Dict[str, Any],
        issue_clusters: List[Dict[str, Any]],
        *,
        prior: List[str],
    ) -> bool:
        text = str(suggestion or "").strip()
        if not text or text in prior:
            return False
        lowered = text.lower()
        generic_phrases = [
            "حاول تميز نفسك",
            "حسن التسويق",
            "اعمل marketing",
            "اعمل ماركتنج",
            "خليها أحسن",
            "طور الفكرة",
        ]
        forbidden_shifts = [
            "فكرة تانية",
            "غيّر الفكرة",
            "غير الفكرة",
            "business آخر",
            "pivot",
            "منتج تاني",
        ]
        action_terms = ["خلي", "ابدأ", "خصص", "قدّم", "اختبر", "اربط", "قلّل", "وضّح", "حوّل", "ركّز", "خلّي", "حدّد", "بسّط"]
        if any(term in text for term in generic_phrases):
            return False
        if any(term in lowered for term in forbidden_shifts):
            return False
        if not any(term in text for term in action_terms):
            return False
        if len(text) < 20 or len(text) > 220:
            return False
        tag = str(latest.get("tag") or "").strip()
        if tag == "cost_pressure" and not any(token in text for token in ["سعر", "رسوم", "باقة", "اشتراك", "تكلفة", "قيمة"]):
            return False
        if tag in {"weak_differentiation", "market_saturation"} and not any(
            token in text for token in ["ميزة", "فئة", "شريحة", "محلي", "تجربة", "متخصص", "متخصصة"]
        ):
            return False
        if tag == "weak_demand" and not any(token in text for token in ["طلب", "تجربة", "شريحة", "مشكلة", "احتياج"]):
            return False
        if tag == "unrealistic_assumption" and not any(
            token in text for token in ["تنفيذ", "تشغيل", "خطوة", "مسؤول", "واضح", "يدوي"]
        ):
            return False
        codes = {str(item.get("code") or "") for item in issue_clusters}
        if "extra_fees" in codes and any(token in text for token in ["رسوم", "باقة", "اشتراك"]):
            return True
        if "entry_price" in codes and any(token in text for token in ["سعر", "باقة", "دخول"]):
            return True
        if "weak_value_for_money" in codes and any(token in text for token in ["قيمة", "تجربة", "ضمان"]):
            return True
        return True

    def _fallback_suggestions_for_tag(
        self,
        state: OrchestrationState,
        tag: str,
        *,
        exclude: List[str],
        issue_clusters: Optional[List[Dict[str, Any]]] = None,
    ) -> List[str]:
        location = self._location_label(state) or "المنطقة"
        price_sensitive = str(self._research_schema(state).get("price_sensitivity") or "").lower() == "high"
        issue_catalog = {
            "entry_price": [
                "ابدأ بباقة دخول صغيرة وسعر واضح عشان اعتراض السعر مايبقاش أول حاجز.",
                "قلّل أول نسخة لحد ما تبقى تكلفة البداية أخف والعميل يحس إنها خطوة سهلة.",
            ],
            "extra_fees": [
                "خلّي الرسوم الإضافية محددة من البداية أو ادمجها في باقة واضحة بدل مفاجآت آخر الرحلة.",
                "قدّم اشتراك بسيط يشيل الرسوم المتكررة لو الناس متحسسة من المصاريف الجانبية.",
            ],
            "weak_value_for_money": [
                "وضّح القيمة في أول تجربة بشكل ملموس، زي سرعة أعلى أو ضمان واضح، قبل ما تطلب سعر أكبر.",
                "اختبر عرض تجريبي يثبت للناس إن اللي بيدفعوه راجع لهم بمنفعة واضحة.",
            ],
            "sameness": [
                f"خلّي الخدمة متخصصة لفئة واضحة في {location} بدل ما تبان نسخة شبه الموجود.",
                "اربط الفكرة بحالة استخدام محددة الناس حاسة إن البدائل الحالية مهملّاها.",
            ],
            "unclear_unique_value": [
                "وضّح ميزة واحدة أساسية تخلي العميل يكررها فورًا لما يوصف الفكرة لغيره.",
                "ركّز الرسالة كلها على فايدة واحدة ملموسة بدل وعود عامة كتير.",
            ],
            "broad_targeting": [
                "خصص أول نسخة لشريحة صغيرة وواضحة بدل محاولة إرضاء كل الناس من البداية.",
                "حوّل العرض لاحتياج فئة محددة جاهزة تجرب وتدفع بدل جمهور واسع ومبهم.",
            ],
            "crowded_market": [
                f"بما إن السوق في {location} زحمة، ادخل من زاوية استخدام أضيق بدل مواجهة كل المنافسين مرة واحدة.",
                "اربط المنتج بتجربة ناقصة عند المنافسين بدل ما تنافس على نفس الرسالة العامة.",
            ],
            "copycat_positioning": [
                "خلّي التمركز مختلف في الخدمة نفسها، مش بس في الإعلان، عشان الناس ماتشوفكش نسخة إضافية.",
                "قدّم تجربة أسرع أو أبسط في خطوة محددة الناس بتشتكي منها عند الموجود.",
            ],
            "local_relevance_gap": [
                f"اربط الفكرة بسلوك محلي واضح في {location} عشان تبان مناسبة للمنطقة مش عامة وخلاص.",
                "اختبر رسالة موجهة للمنطقة نفسها وتستخدم مشكلة يومية الناس هناك بتكررها.",
            ],
            "weak_need": [
                "ابدأ من مشكلة مؤلمة فعلًا عند شريحة محددة بدل عرض عام احتياجه مش قوي.",
                "حوّل الفكرة لاستخدام مرتبط بلحظة مزعجة الناس عايزة تتفاداها بسرعة.",
            ],
            "low_urgency": [
                "قدّم حالة استخدام لها توقيت واضح يخلي القرار عاجل بدل ما يفضل مؤجل.",
                "اربط الفكرة بموقف يومي متكرر يخلي الناس تحس إن التأجيل مكلف.",
            ],
            "low_payment_intent": [
                "اختبر نسخة مدفوعة صغيرة جدًا تثبت إن فيه استعداد دفع قبل أي توسع.",
                "خلّي أول عرض بسعر بسيط مقابل نتيجة واضحة عشان تقيس الدفع الحقيقي.",
            ],
            "unclear_execution": [
                "وضّح أول 3 خطوات تنفيذ بشكل بسيط عشان الاعتراض مايفضلش عند سؤال إزاي هتشتغل.",
                "ابدأ بنسخة فيها مسار تشغيل واضح ومحدود بدل نموذج معقد من أول يوم.",
            ],
            "operational_gap": [
                "قلّل التعقيد التشغيلي في البداية حتى لو النسخة الأولى أضيق، المهم تبقى قابلة للتنفيذ.",
                "اختبر أصعب خطوة يدويًا الأول قبل ما تبني عليها تشغيل كامل.",
            ],
            "delivery_uncertainty": [
                "حدّد مين مسؤول عن كل خطوة حساسة من البداية عشان الثقة في التنفيذ تعلى.",
                "خلّي رحلة التنفيذ واضحة للعميل وللفريق بدل الاعتماد على افتراضات عامة.",
            ],
        }
        ordered_codes = [str(item.get("code") or "") for item in issue_clusters or [] if str(item.get("code") or "")]
        base: List[str] = []
        for code in ordered_codes:
            for suggestion in issue_catalog.get(code, []):
                if suggestion not in base:
                    base.append(suggestion)
        tag_defaults = {
            "weak_differentiation": [
                f"خلّي الفكرة متخصصة لفئة واضحة في {location} بدل ما تبان عامة زيادة.",
                "وضّح ميزة أساسية واحدة الناس تفتكرك بيها بدل رسائل كثيرة.",
            ],
            "cost_pressure": [
                "ابدأ بباقة دخول واضحة من غير رسوم مفاجئة.",
                "قدّم تجربة أولى تثبت القيمة قبل أي تسعير أعلى.",
            ],
            "market_saturation": [
                f"ادخل من زاوية استخدام مرتبطة بـ {location} بدل منافسة مباشرة مع الموجود كله.",
                "ركّز على تجربة محددة المنافسين فيها أضعف.",
            ],
            "weak_demand": [
                "اختبر الفكرة مع شريحة صغيرة عندها ألم واضح قبل ما توسّع.",
                "حوّل الرسالة لوعد قيمة مباشر يوضح ليه الناس هتحتاجها الآن.",
            ],
            "unrealistic_assumption": [
                "بسّط التشغيل في النسخة الأولى وخلي التنفيذ واضح من أول يوم.",
                "حدّد المسؤوليات والخطوات الحرجة بدل افتراض إن التنفيذ هيظبط وحده.",
            ],
        }
        for suggestion in tag_defaults.get(tag, tag_defaults["weak_differentiation"]):
            if suggestion not in base:
                base.append(suggestion)
        base = [item for item in base if item not in exclude]
        if price_sensitive and tag != "cost_pressure":
            base.append("خلّي السعر والرسوم واضحين جدًا لأن حساسية السعر ظهرت بوضوح في البحث وكلام الناس.")
        deduped: List[str] = []
        for item in base:
            if item not in deduped:
                deduped.append(item)
        validated = [
            item
            for item in deduped
            if self._validate_modification_suggestion(item, {"tag": tag}, issue_clusters or [], prior=exclude)
        ]
        return validated[:5] or deduped[:4]

    def _recent_suggestion_memory(self, state: OrchestrationState) -> List[str]:
        items: List[str] = []
        for insight in state.critical_insights:
            for suggestion in insight.get("suggestions") or []:
                text = str(suggestion).strip()
                if text and text not in items:
                    items.append(text)
        return items[-12:]

    def _apply_intervention_suggestions(self, state: OrchestrationState, latest: Dict[str, Any]) -> None:
        suggestions = [str(item).strip() for item in latest.get("suggestions") or [] if str(item).strip()]
        if not suggestions:
            return
        self._capture_improvement_baseline(state, latest, suggestions)
        notes = str(state.user_context.get("notes") or "").strip()
        addition = "تطبيق تعديل مقترح: " + " | ".join(suggestions[:3])
        if addition not in notes:
            state.user_context["notes"] = f"{notes}\n{addition}".strip() if notes else addition
        if not state.user_context.get("valueProposition"):
            state.user_context["valueProposition"] = suggestions[0]
        state.schema["orchestrator_applied_suggestions"] = suggestions
        state.deliberation_state.setdefault("pending_context_updates", [])
        state.deliberation_state["pending_context_updates"].append(
            {
                "impact": "small",
                "changed_fields": ["notes", "valueProposition"],
                "timestamp": state.updated_at,
                "source": "orchestrator_intervention",
            }
        )
        for suggestion in suggestions[:3]:
            state.argument_bank.append(
                {
                    "id": f"coach-{uuid.uuid4().hex[:8]}",
                    "kind": "coach_suggestion",
                    "polarity": "support",
                    "claim": suggestion,
                    "summary": suggestion[:180],
                    "strength": 0.68,
                    "evidence_urls": [],
                    "source": "orchestrator_intervention",
                }
            )
        state.argument_bank = state.argument_bank[-180:]

    def _capture_improvement_baseline(
        self,
        state: OrchestrationState,
        latest: Dict[str, Any],
        suggestions: List[str],
    ) -> None:
        runs = state.schema.setdefault("idea_improvement_runs", [])
        runs.append(
            {
                "original_idea": str(state.user_context.get("idea") or "").strip(),
                "modified_idea": self._compose_modified_idea_text(state, suggestions),
                "applied_suggestions": list(suggestions[:5]),
                "issue_clusters": [dict(item) for item in latest.get("issue_clusters") or [] if isinstance(item, dict)],
                "trigger_tag": str(latest.get("tag") or "").strip(),
                "metrics_before": dict(self._compute_metrics(state, iteration=int(state.deliberation_state.get("iteration") or 0))),
                "turn_index_before": len(state.dialogue_turns),
                "reactions_before": [turn.message for turn in state.dialogue_turns[-6:] if str(turn.message).strip()],
                "signals_before": self._discussion_signal_counts(state.dialogue_turns[-12:]),
                "created_at": state.updated_at,
            }
        )
        state.schema["idea_improvement_runs"] = runs[-6:]

    def _compose_modified_idea_text(self, state: OrchestrationState, suggestions: List[str]) -> str:
        base = str(state.user_context.get("idea") or "").strip()
        if not suggestions:
            return base
        return f"{base} بعد التعديل: {' | '.join(suggestions[:3])}".strip()

    def _discussion_signal_counts(self, turns: List[DialogueTurn]) -> Dict[str, int]:
        normalized = [self._normalize_message(str(turn.message or "")) for turn in turns if str(turn.message or "").strip()]
        counters = {
            "price": ["سعر", "غالي", "رسوم", "تكلفة", "price", "cost", "fee"],
            "confusion": ["مش واضح", "إزاي", "مين", "unclear", "confused", "how"],
            "value": ["قيمة", "مفيد", "فايدة", "يوفر", "value", "worth", "useful"],
            "differentiation": ["ميزة", "مختلف", "فريد", "unique", "different", "specialized"],
            "market_fit": ["محتاج", "طلب", "احتياج", "مناسب", "demand", "need", "fit"],
            "saturation": ["منافسة", "متشبع", "منتشر", "competition", "saturated", "crowded"],
            "trust": ["ضمان", "ثقة", "مخاطرة", "risk", "trust"],
        }
        results: Dict[str, int] = {}
        for label, terms in counters.items():
            hits = 0
            for text in normalized:
                if any(term.lower() in text for term in terms):
                    hits += 1
            results[label] = hits
        results["objections"] = results["price"] + results["confusion"] + results["saturation"] + results["trust"]
        return results

    def _latest_improvement_evaluation(self, state: OrchestrationState) -> Optional[Dict[str, Any]]:
        runs = state.schema.get("idea_improvement_runs")
        if not isinstance(runs, list) or not runs:
            return None
        latest = runs[-1]
        turn_index = int(latest.get("turn_index_before") or 0)
        after_turns = state.dialogue_turns[turn_index:]
        if not after_turns:
            return None

        metrics_before = dict(latest.get("metrics_before") or {})
        metrics_after = dict(self._compute_metrics(state, iteration=int(state.deliberation_state.get("iteration") or 0)))
        signals_before = dict(latest.get("signals_before") or {})
        signals_after = self._discussion_signal_counts(after_turns[-12:])
        before_reactions = [str(item).strip() for item in latest.get("reactions_before") or [] if str(item).strip()]
        after_reactions = [str(turn.message).strip() for turn in after_turns[-6:] if str(turn.message).strip()]

        acceptance_before = float(metrics_before.get("acceptance_rate") or 0.0)
        acceptance_after = float(metrics_after.get("acceptance_rate") or 0.0)
        rejection_before = int(metrics_before.get("rejected") or 0)
        rejection_after = int(metrics_after.get("rejected") or 0)
        neutral_before = int(metrics_before.get("neutral") or 0)
        neutral_after = int(metrics_after.get("neutral") or 0)

        clarity_delta = int(signals_before.get("confusion") or 0) - int(signals_after.get("confusion") or 0)
        objections_delta = int(signals_before.get("objections") or 0) - int(signals_after.get("objections") or 0)
        value_delta = int(signals_after.get("value") or 0) - int(signals_before.get("value") or 0)
        differentiation_delta = int(signals_after.get("differentiation") or 0) - int(signals_before.get("differentiation") or 0)
        market_fit_delta = int(signals_after.get("market_fit") or 0) - int(signals_before.get("market_fit") or 0)

        key_improvements: List[str] = []
        if acceptance_after > acceptance_before:
            key_improvements.append("القبول زاد بعد التعديل.")
        if objections_delta > 0:
            key_improvements.append("الاعتراضات المتكررة قلت.")
        if clarity_delta > 0:
            key_improvements.append("بعد التعديل، الناس بدأت تفهم الفكرة أكتر.")
        if value_delta > 0:
            key_improvements.append("القيمة المتصورة بقت أوضح.")
        if differentiation_delta > 0:
            key_improvements.append("التميّز بقى أوضح.")
        if market_fit_delta > 0:
            key_improvements.append("ملاءمة الفكرة للسوق اتحسنت.")

        remaining_problems: List[str] = []
        if rejection_after >= rejection_before:
            remaining_problems.append("الرفض ماقلش بشكل واضح.")
        if neutral_after > neutral_before:
            remaining_problems.append("لسه فيه تردد عند بعض الناس.")
        if int(signals_after.get("price") or 0) >= int(signals_before.get("price") or 0) and int(signals_after.get("price") or 0) > 0:
            remaining_problems.append("الاعتراض على السعر لسه حاضر.")
        if int(signals_after.get("saturation") or 0) >= int(signals_before.get("saturation") or 0) and int(signals_after.get("saturation") or 0) > 0:
            remaining_problems.append("التميّز قدام المنافسين لسه محتاج تقوية.")
        if int(signals_after.get("confusion") or 0) > 0 and clarity_delta <= 0:
            remaining_problems.append("فيه لسه نقاط مش واضحة في التنفيذ.")

        improved = bool(
            acceptance_after > acceptance_before
            or objections_delta > 0
            or clarity_delta > 0
            or value_delta > 0
            or differentiation_delta > 0
            or market_fit_delta > 0
        )

        summary_lines: List[str] = []
        if improved:
            summary_lines.append(f"القبول اتحسن من {int(round(acceptance_before * 100))}% إلى {int(round(acceptance_after * 100))}%.")
        else:
            summary_lines.append("التعديل ما أثرش بشكل واضح على تقبل الناس.")
        if objections_delta > 0:
            summary_lines.append("الاعتراضات المتكررة قلت بعد التعديل.")
        if clarity_delta > 0:
            summary_lines.append("بعد التعديل، الناس بدأت تفهم الفكرة أكتر.")
        if value_delta > 0:
            summary_lines.append("القيمة بقت أوضح في ردود الناس.")
        if differentiation_delta > 0:
            summary_lines.append("بقى فيه تميز أوضح.")
        if before_reactions:
            summary_lines.append(f"قبل التعديل كان فيه كلام زي: {before_reactions[-1]}")
        if after_reactions:
            summary_lines.append(f"بعد التعديل ظهر كلام زي: {after_reactions[-1]}")
        if remaining_problems:
            summary_lines.append(f"لسه موجود: {remaining_problems[0]}")

        result = {
            "original_idea": str(latest.get("original_idea") or "").strip(),
            "modified_idea": str(latest.get("modified_idea") or "").strip(),
            "acceptance_before": round(acceptance_before, 3),
            "acceptance_after": round(acceptance_after, 3),
            "rejection_before": rejection_before,
            "rejection_after": rejection_after,
            "neutral_before": neutral_before,
            "neutral_after": neutral_after,
            "clarity_before": int(signals_before.get("confusion") or 0),
            "clarity_after": int(signals_after.get("confusion") or 0),
            "perceived_value_before": int(signals_before.get("value") or 0),
            "perceived_value_after": int(signals_after.get("value") or 0),
            "differentiation_before": int(signals_before.get("differentiation") or 0),
            "differentiation_after": int(signals_after.get("differentiation") or 0),
            "market_fit_before": int(signals_before.get("market_fit") or 0),
            "market_fit_after": int(signals_after.get("market_fit") or 0),
            "key_improvements": key_improvements[:5],
            "remaining_problems": remaining_problems[:5],
            "before_reactions": before_reactions[-3:],
            "after_reactions": after_reactions[-3:],
            "improved": improved,
            "summary": " ".join(summary_lines[:7]),
        }
        latest["evaluation"] = result
        state.schema["idea_improvement_evaluation"] = result
        return result

    def _build_optimization_decision(self, state: OrchestrationState) -> Dict[str, Any]:
        metrics = dict(self._compute_metrics(state, iteration=int(state.deliberation_state.get("iteration") or 0)))
        improvement_eval = self._latest_improvement_evaluation(state)
        runs = [item for item in state.schema.get("idea_improvement_runs") or [] if isinstance(item, dict)]
        recent_evaluations = [dict(item.get("evaluation") or {}) for item in runs if isinstance(item.get("evaluation"), dict)]
        recent_evaluations = [item for item in recent_evaluations if item]

        unresolved_critical = [
            item
            for item in state.critical_insights
            if item.get("kind") == "orchestrator_intervention" and not bool(item.get("resolved"))
        ]
        recent_critical = [
            item
            for item in state.critical_insights[-4:]
            if item.get("kind") == "orchestrator_intervention" and not bool(item.get("dismissed"))
        ]
        acceptance_rate = float(metrics.get("acceptance_rate") or 0.0)
        rejection_count = int(metrics.get("rejected") or 0)
        neutral_count = int(metrics.get("neutral") or 0)
        total_agents = max(1, int(metrics.get("total_agents") or len(state.personas) or 1))
        strong_acceptance = acceptance_rate >= 0.7
        low_rejection = rejection_count <= max(2, int(total_agents * 0.15))
        low_neutral = neutral_count <= max(2, int(total_agents * 0.18))
        no_open_critical = not unresolved_critical
        no_new_critical = len(recent_critical) <= 1

        differentiation_clear = False
        value_clear = False
        if improvement_eval:
            key_improvements = " | ".join(improvement_eval.get("key_improvements") or [])
            differentiation_clear = "التميّز" in key_improvements or int(improvement_eval.get("differentiation_after") or 0) > int(improvement_eval.get("differentiation_before") or 0)
            value_clear = "القيمة" in key_improvements or int(improvement_eval.get("perceived_value_after") or 0) > int(improvement_eval.get("perceived_value_before") or 0)
        else:
            structured = self._research_schema(state)
            differentiation_clear = str(structured.get("competition_level") or "").lower() not in {"high", "crowded", "saturated"} or acceptance_rate >= 0.72
            value_clear = bool(state.user_context.get("valueProposition")) or acceptance_rate >= 0.72 or any(
                item.get("polarity") == "support" for item in state.argument_bank[-8:]
            )

        diminishing_returns = False
        if len(recent_evaluations) >= 2:
            last_eval = recent_evaluations[-1]
            prev_eval = recent_evaluations[-2]
            acceptance_delta = abs(float(last_eval.get("acceptance_after") or 0.0) - float(prev_eval.get("acceptance_after") or 0.0))
            rejection_delta = abs(int(last_eval.get("rejection_after") or 0) - int(prev_eval.get("rejection_after") or 0))
            last_problems = set(str(item).strip() for item in last_eval.get("remaining_problems") or [] if str(item).strip())
            prev_problems = set(str(item).strip() for item in prev_eval.get("remaining_problems") or [] if str(item).strip())
            same_problem_shape = bool(last_problems) and last_problems == prev_problems
            diminishing_returns = acceptance_delta < 0.05 and rejection_delta <= 1 and same_problem_shape

        ready = bool(
            (strong_acceptance and low_rejection and low_neutral and no_open_critical and no_new_critical and differentiation_clear and value_clear)
            or (diminishing_returns and acceptance_rate >= 0.62 and no_open_critical)
        )

        if ready:
            decision = {
                "decision": "READY_TO_MOVE_FORWARD",
                "reason": "strong_state" if strong_acceptance else "diminishing_returns",
                "message": "بص، كده الفكرة بقت واضحة ومقبولة بشكل كويس وأغلب المشاكل اتحلت.",
                "next_step": "تحب نبدأ نحولها لخطة تنفيذ فعلية؟",
                "execution_mode": True,
                "metrics": {
                    "acceptance_rate": round(acceptance_rate, 3),
                    "rejection_count": rejection_count,
                    "neutral_count": neutral_count,
                },
            }
            state.schema["optimization_decision"] = decision
            state.schema["system_mode"] = "execution_mode"
            state.user_context["systemMode"] = "execution_mode"
            return decision

        remaining = []
        if improvement_eval:
            remaining = [str(item).strip() for item in improvement_eval.get("remaining_problems") or [] if str(item).strip()]
        focus = remaining[0] if remaining else "لسه في نقطة محتاجة تتحسن قبل ما نتحرك للتنفيذ."
        decision = {
            "decision": "CONTINUE_IMPROVING",
            "reason": "material_gap",
            "message": f"لسه في نقطة محتاجة تتحسن: {focus}",
            "next_step": focus,
            "execution_mode": False,
            "metrics": {
                "acceptance_rate": round(acceptance_rate, 3),
                "rejection_count": rejection_count,
                "neutral_count": neutral_count,
            },
        }
        state.schema["optimization_decision"] = decision
        if state.schema.get("system_mode") == "execution_mode":
            state.schema["system_mode"] = "simulation_mode"
        if state.user_context.get("systemMode") == "execution_mode":
            state.user_context["systemMode"] = "simulation_mode"
        return decision

    def _answer_is_affirmative(self, text: str) -> bool:
        normalized = str(text or "").strip().lower()
        return any(token in normalized for token in ["yes", "y", "نعم", "ايوه", "أيوه", "أكيد", "اكيد", "ماشي", "تمام"])

    async def build_summary(self, state: OrchestrationState) -> str:
        metrics = self._compute_metrics(state, iteration=int(state.deliberation_state.get("iteration") or 0))
        supports = [
            str(item.get("claim") or "").strip()
            for item in sorted(
                [item for item in state.argument_bank if item.get("polarity") == "support"],
                key=lambda item: float(item.get("strength") or 0.0),
                reverse=True,
            )[:3]
            if str(item.get("claim") or "").strip()
        ]
        concerns = [
            str(item.get("claim") or "").strip()
            for item in sorted(
                [item for item in state.argument_bank if item.get("polarity") == "concern"],
                key=lambda item: float(item.get("strength") or 0.0),
                reverse=True,
            )[:3]
            if str(item.get("claim") or "").strip()
        ]
        positives = [str(item) for item in (state.research.findings if state.research else [])[:3] if str(item).strip()]
        risks = [
            str(item.get("user_message") or item.get("message") or "").strip()
            for item in state.critical_insights[-4:]
            if str(item.get("user_message") or item.get("message") or "").strip()
        ]
        improvement_eval = self._latest_improvement_evaluation(state)
        optimization_decision = self._build_optimization_decision(state)
        accepted_clusters = self._top_cluster_labels(state, "accept")
        rejected_clusters = self._top_cluster_labels(state, "reject")
        memory_provider = getattr(self.runtime, "memory_provider", None)
        summary_memory = await memory_provider.retrieve_for_summary(state) if memory_provider is not None else {}
        if str(state.user_context.get("language") or "en").lower().startswith("ar"):
            parts = [
                f"النتيجة النهائية: بعد {metrics['iteration']} جولات، فيه {metrics['accepted']} قبول و{metrics['rejected']} رفض و{metrics['neutral']} حياد.",
                f"ليه ناس قبلت: {self._join_or_fallback(supports, 'لقوا قيمة أو فرصة واضحة لو التنفيذ اتظبط.')}",
                f"ليه ناس رفضت أو اترددت: {self._join_or_fallback(concerns or risks, 'لسه فيه مخاطر مفتوحة محتاجة حل أوضح.')}",
                f"أقوى الإشارات الإيجابية: {self._join_or_fallback(positives or supports, 'فيه اهتمام مبدئي لكن محتاج تثبيت أقوى.')}",
                f"أضعف النقاط والمخاطر: {self._join_or_fallback(risks or concerns, 'المشكلة الأكبر لسه مش متكررة بشكل كافي للحكم النهائي.')}",
            ]
            if accepted_clusters:
                parts.append(f"أكتر الفئات تقبلًا كانت: {', '.join(accepted_clusters)}.")
            if rejected_clusters:
                parts.append(f"وأكتر الفئات اعتراضًا كانت: {', '.join(rejected_clusters)}.")
            if summary_memory.get("proven_adjustments"):
                parts.append(f"ومن الذاكرة التراكمية: أكتر تعديل نفع قبل كده كان {self._join_or_fallback(summary_memory.get('proven_adjustments') or [], 'تحسين الوضوح وتقليل الاحتكاك.')}.")
            if improvement_eval:
                parts.append(f"تقييم التعديل: {improvement_eval.get('summary')}")
                if improvement_eval.get("remaining_problems") and optimization_decision.get("decision") != "READY_TO_MOVE_FORWARD":
                    parts.append("ممكن نعدل نقطة كمان ونشوف التأثير.")
            parts.append(optimization_decision.get("message"))
            parts.append(optimization_decision.get("next_step"))
            if metrics["acceptance_rate"] >= 0.55 or optimization_decision.get("decision") == "READY_TO_MOVE_FORWARD":
                parts.extend(self._business_guidance_lines(state))
            if optimization_decision.get("decision") == "READY_TO_MOVE_FORWARD":
                self._ensure_execution_followup_prompt(state)
            return " ".join(parts)

        parts = [
            f"Final result: after {metrics['iteration']} rounds there were {metrics['accepted']} accepts, {metrics['rejected']} rejects, and {metrics['neutral']} neutrals.",
            f"Why some agents accepted: {self._join_or_fallback(supports, 'They saw a credible path to value if execution is tightened.')}",
            f"Why some agents rejected or hesitated: {self._join_or_fallback(concerns or risks, 'Open risks are still blocking confidence.')}",
            f"Strongest positive signals: {self._join_or_fallback(positives or supports, 'There are early positive signals but they still need stronger proof.')}",
            f"Weakest points and risks: {self._join_or_fallback(risks or concerns, 'No single dominant weakness emerged strongly enough.')}",
        ]
        if summary_memory.get("proven_adjustments"):
            parts.append(f"Memory-backed pattern: {self._join_or_fallback(summary_memory.get('proven_adjustments') or [], 'Clearer execution framing improved prior runs.')}")
        if improvement_eval:
            parts.append(f"Idea improvement evaluation: {improvement_eval.get('summary')}")
        parts.append(f"Optimization decision: {optimization_decision.get('decision')}. {optimization_decision.get('message')} {optimization_decision.get('next_step')}")
        return " ".join(parts)

    def _top_cluster_labels(self, state: OrchestrationState, stance: str) -> List[str]:
        counts: Dict[str, int] = {}
        for persona in state.personas:
            if persona.opinion != stance:
                continue
            label = str(persona.target_audience_cluster or persona.archetype_name or persona.profession_role or "").strip()
            if not label:
                continue
            counts[label] = counts.get(label, 0) + 1
        return [item[0] for item in sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:2]]

    def _build_execution_steps(self, state: OrchestrationState) -> Dict[str, Any]:
        location = self._location_label(state) or str(state.user_context.get("country") or "السوق الحالي").strip()
        city = str(state.user_context.get("city") or "").strip()
        area_label = f"حي واحد داخل {city}" if city else f"منطقة واحدة داخل {location}"
        target_segment = (
            next(iter(self._top_cluster_labels(state, "accept")), None)
            or next(iter(state.user_context.get("targetAudience") or []), None)
            or "الشريحة الأقرب للمشكلة"
        )
        recent_turns = state.dialogue_turns[-24:]
        normalized_turns = [(turn, self._normalize_message(turn.message)) for turn in recent_turns if str(turn.message).strip()]
        patterns = [
            {
                "code": "price",
                "label": "السعر عالي",
                "terms": ("السعر", "رسوم", "تكلفة", "price", "cost", "fee"),
                "step": f"فيه ناس كتير كانت شايفة السعر عالي، فجرب تعرض باقة دخول أبسط على 5 ناس من {target_segment} في {location} وسجل مين وافق ومين رفض وليه.",
            },
            {
                "code": "confusion",
                "label": "الفكرة مش واضحة",
                "terms": ("مش واضح", "إزاي", "فاهم", "unclear", "how"),
                "step": f"فيه ناس كانت متلخبطة، فجرب تشرح الفكرة في 3 سطور لخمسة أشخاص من {target_segment} واسألهم بعدها يشرحوا لك هم فهموا إيه.",
            },
            {
                "code": "competition",
                "label": "فيه منافسين كتير",
                "terms": ("منافسة", "متشبع", "بديل", "competition", "saturated", "crowded"),
                "step": f"بما إن فيه اعتراض متكرر على الزحمة في السوق، اعرض النسخة على 5 أشخاص في {area_label} واسألهم مباشرة إيه اللي يخليهم يجربوك بدل البديل الحالي.",
            },
            {
                "code": "value",
                "label": "القيمة مش واضحة",
                "terms": ("قيمة", "مستاهل", "فايدة", "value", "worth"),
                "step": f"فيه تردد حوالين القيمة، فجرب تعرض منفعة واحدة واضحة فقط على 5 ناس وشوف هل الاهتمام زاد ولا لا.",
            },
            {
                "code": "demand",
                "label": "الاحتياج مش مؤكد",
                "terms": ("محتاج", "طلب", "مين هيشتري", "demand", "need"),
                "step": f"فيه ناس شكّت في الاحتياج، فكلم 5 أشخاص من {target_segment} واسألهم عن آخر مرة واجهوا المشكلة نفسها وهل كانوا مستعدين يدفعوا لحل سريع.",
            },
        ]
        clusters: List[Dict[str, Any]] = []
        for pattern in patterns:
            evidence: List[str] = []
            speakers: set[str] = set()
            hits = 0
            for turn, text in normalized_turns:
                if any(term.lower() in text for term in pattern["terms"]):
                    hits += 1
                    speakers.add(turn.agent_id)
                    snippet = str(turn.message).strip()
                    if snippet and snippet not in evidence:
                        evidence.append(snippet[:140])
            if hits:
                clusters.append(
                    {
                        "code": pattern["code"],
                        "label": pattern["label"],
                        "hits": hits,
                        "speakers": len(speakers),
                        "evidence": evidence[:2],
                        "step": pattern["step"],
                    }
                )
        clusters.sort(key=lambda item: (int(item.get("hits") or 0), int(item.get("speakers") or 0)), reverse=True)
        chosen = clusters[:4]

        steps: List[str] = []
        seen: set[str] = set()
        for item in chosen:
            step = str(item.get("step") or "").strip()
            if step and step not in seen:
                steps.append(step)
                seen.add(step)

        support_signals = [
            str(turn.message).strip()
            for turn in recent_turns[-12:]
            if any(token in self._normalize_message(turn.message) for token in ("واضح", "ممكن", "يجرب", "قيمة", "ميزة"))
        ]
        if support_signals:
            follow_step = "بما إن فيه اهتمام ظهر لما القيمة وضحت، ارجع لآخر 3 ناس تفاعلوا إيجابيًا واعرض عليهم تجربة فعلية صغيرة خلال الأسبوع ده."
            if follow_step not in seen:
                steps.append(follow_step)
                seen.add(follow_step)

        if not steps:
            steps = [
                f"بص، من الكلام اللي حصل، ابدأ بأنك تعرض النسخة الحالية على 5 ناس من {target_segment} في {location} وتسجل أول 3 اعتراضات حرفيًا.",
                f"بعدها جرّب تعديل واحد فقط على الرسالة أو السعر وأعد نفس الاختبار في {area_label}.",
                "لو لقيت اهتمام حقيقي، نفّذ أول تجربة يدويًا وسجّل مين كمل ومين وقف وليه.",
            ]

        result = {
            "intro": "بص، من الكلام اللي حصل، ممكن تبدأ بكذا:",
            "steps": steps[:6],
            "problems": [
                {
                    "label": item["label"],
                    "evidence": list(item.get("evidence") or []),
                    "hits": int(item.get("hits") or 0),
                }
                for item in chosen
            ],
            "cta": "تحب نجرب أول خطوة ونشوف النتيجة؟",
        }
        state.schema["execution_steps"] = result
        return result

    async def handle_execution_followup_response(
        self,
        state: OrchestrationState,
        answers: List[Dict[str, Any]],
    ) -> OrchestrationState:
        answer_text = " ".join(
            str(item.get("answer") or item.get("text") or "").strip()
            for item in answers
            if str(item.get("answer") or item.get("text") or "").strip()
        ).strip()
        if not answer_text:
            return state

        classification = self._classify_execution_feedback(answer_text)
        learning = self._execution_learning_line(classification, answer_text)
        next_step = self._execution_next_step(state, classification, answer_text)
        followup = {
            "feedback": answer_text,
            "classification": classification,
            "learning": learning,
            "next_step": next_step,
            "timestamp": state.updated_at,
        }
        history = state.schema.setdefault("execution_followups", [])
        history.append(followup)
        state.schema["execution_followups"] = history[-12:]
        state.schema["latest_execution_followup"] = followup
        memory_provider = getattr(self.runtime, "memory_provider", None)
        if memory_provider is not None:
            await memory_provider.ingest_execution_followup(state=state, followup=followup)
        state.argument_bank.append(
            {
                "id": f"exec-{uuid.uuid4().hex[:8]}",
                "kind": "execution_followup",
                "polarity": "support" if classification in {"positive_signal", "weak_positive_signal"} else "concern",
                "claim": answer_text,
                "summary": learning,
                "strength": 0.62 if classification in {"positive_signal", "mixed_signal"} else 0.58,
                "evidence_urls": [],
                "source": "execution_followup",
            }
        )
        state.argument_bank = state.argument_bank[-180:]
        state.pending_input = True
        state.pending_input_kind = "execution_followup"
        state.pending_resume_phase = None
        state.status = "paused"
        state.status_reason = "awaiting_execution_followup"
        state.clarification_questions = [
            ClarificationQuestion(
                question_id=f"execution_followup_{len(history)}",
                field_name="execution_followup",
                prompt=f"{learning}\nفالخطوة اللي بعد كده: {next_step}\nلو عملتها، ابعتلي النتيجة وأنا أكمل معاك من هناك.",
                reason=classification,
                required=True,
                options=[],
            )
        ]
        if getattr(self.runtime, "event_bus", None) is not None:
            await self.runtime.event_bus.publish(
                state,
                "execution_followup_updated",
                {
                    "agent": "orchestrator",
                    "classification": classification,
                    "learning": learning,
                    "next_step": next_step,
                },
            )
        return state

    def _classify_execution_feedback(self, text: str) -> str:
        normalized = self._normalize_message(text)
        positive_terms = ("عجب", "مهتم", "حلو", "ممتاز", "كويس", "حابب", "يجرب", "liked", "interested", "good")
        weak_positive_terms = ("شوية", "ممكن", "نوعا", "kind of", "maybe", "some")
        confusion_terms = ("مش فاهم", "مش واضح", "متلغبط", "confused", "unclear", "مش مفهوم")
        rejection_terms = ("رفض", "مش مهتم", "غالي", "عالي", "مكلف", "no one", "nobody", "rejected", "expensive")
        positive = any(term in normalized for term in positive_terms)
        weak_positive = any(term in normalized for term in weak_positive_terms)
        confusion = any(term in normalized for term in confusion_terms)
        rejection = any(term in normalized for term in rejection_terms)
        if positive and (rejection or confusion):
            return "mixed_signal"
        if confusion:
            return "confusion_signal"
        if rejection and not positive:
            return "rejection_signal"
        if positive and weak_positive:
            return "weak_positive_signal"
        if positive:
            return "positive_signal"
        return "neutral_result"

    def _execution_learning_line(self, classification: str, text: str) -> str:
        normalized = self._normalize_message(text)
        if "سعر" in normalized or "غالي" in normalized or "price" in normalized:
            if classification in {"mixed_signal", "rejection_signal"}:
                return "واضح إن المشكلة الأساسية كانت في السعر مش في الفكرة نفسها."
            if classification in {"positive_signal", "weak_positive_signal"}:
                return "واضح إن فيه قبول للفكرة، بس السعر لسه نقطة حساسة."
        if classification == "confusion_signal":
            return "واضح إن الناس مهتمة، بس العرض لسه مش واضح كفاية."
        if classification == "positive_signal":
            return "واضح إن فيه اهتمام حقيقي، فالمهم دلوقتي نحوله لالتزام فعلي."
        if classification == "weak_positive_signal":
            return "واضح إن فيه فضول، بس لسه ماوصلش لاهتمام قوي."
        if classification == "mixed_signal":
            return "واضح إن الفكرة شدت بعض الناس، بس لسه فيه مانع محدد موقف الباقي."
        if classification == "rejection_signal":
            return "واضح إن الاعتراض الحالي حقيقي ومحتاج تصحيح واحد واضح قبل أي خطوة أكبر."
        return "واضح إن النتيجة لسه محايدة، يعني محتاجين اختبار أوضح بدل ما نوسع."

    def _execution_next_step(self, state: OrchestrationState, classification: str, text: str) -> str:
        normalized = self._normalize_message(text)
        target_segment = (
            next(iter(self._top_cluster_labels(state, "accept")), None)
            or next(iter(state.user_context.get("targetAudience") or []), None)
            or "نفس الفئة اللي جربت معاها"
        )
        previous_steps = [
            str(item.get("next_step") or "").strip()
            for item in state.schema.get("execution_followups") or []
            if isinstance(item, dict) and str(item.get("next_step") or "").strip()
        ]

        options: List[str]
        if "سعر" in normalized or "غالي" in normalized or "price" in normalized:
            options = [
                f"جرّب سعر أقل أو باقة دخول أبسط على 3 ناس من {target_segment} وشوف هل الاعتراض هيقل ولا لا.",
                f"اعرض نفس الفكرة على 5 ناس من {target_segment} بس من غير رسوم إضافية وشوف مين هيكمل.",
            ]
        elif classification == "confusion_signal" or "مش واضح" in normalized or "فاهم" in normalized:
            options = [
                f"ابعت نفس العرض بصياغة أبسط لـ 5 ناس من {target_segment} وخليهم يردوا عليك بجملة واحدة فهموا منها إيه.",
                f"حوّل العرض لسؤال وجواب بسيط جدًا وجربه على 3 ناس بدل الشرح الطويل.",
            ]
        elif classification == "positive_signal":
            options = [
                f"اطلب من أول 3 ناس أبدوا اهتمام حقيقي إنهم يحجزوا معاك مبدئيًا أو يسيبوا التزام واضح للتجربة.",
                f"حوّل الاهتمام لتجربة فعلية صغيرة مع 2 أو 3 من {target_segment} خلال الأسبوع ده.",
            ]
        elif classification == "weak_positive_signal":
            options = [
                f"اعرض الفكرة على نفس الفئة لكن بمنفعة واحدة أوضح، وجربها مع 5 ناس فقط بدل عرض كامل.",
                f"اسأل 5 ناس مباشرة: لو الفكرة بالوعد ده تحديدًا، هل هتجربها دلوقتي ولا لا؟",
            ]
        elif classification == "rejection_signal":
            options = [
                f"ضيّق العرض لاحتياج واحد واضح جدًا وجربه مع 5 ناس من {target_segment} بدل عرض الفكرة كاملة.",
                f"اسأل 5 ناس رفضوا: إيه أقرب بديل هم شايفينه أحسن، وبعدين قارن رسالتك بيه بشكل مباشر.",
            ]
        else:
            options = [
                f"كرر الاختبار مع 5 ناس جداد من {target_segment} لكن غيّر عنصر واحد فقط في العرض وشوف الفرق.",
                "اسأل الناس مباشرة إيه الجزء اللي خلاهم لا متحمسين ولا رافضين، وسجل نفس الكلمات اللي قالوها.",
            ]

        for option in options:
            if option not in previous_steps:
                return option
        return options[0]

    def _ensure_execution_followup_prompt(self, state: OrchestrationState) -> None:
        if state.schema.get("system_mode") != "execution_mode":
            return
        if state.pending_input and state.pending_input_kind == "execution_followup":
            return
        latest = state.schema.get("latest_execution_followup") or {}
        if latest:
            prompt = f"{latest.get('learning')}\nفالخطوة اللي بعد كده: {latest.get('next_step')}\nلو عملتها، ابعتلي النتيجة وأنا أكمل معاك من هناك."
        else:
            execution_steps = state.schema.get("execution_steps") or self._build_execution_steps(state)
            first_step = next(iter(execution_steps.get("steps") or []), "جرّب أول خطوة عملية وارجعلي بالنتيجة.")
            prompt = f"{execution_steps.get('intro', 'بص، من الكلام اللي حصل، ممكن تبدأ بكذا:')}\n{first_step}\nلو جرّبتها، ابعتلي النتيجة وأنا أكمل معاك من هناك."
        state.pending_input = True
        state.pending_input_kind = "execution_followup"
        state.pending_resume_phase = None
        state.status = "paused"
        state.status_reason = "awaiting_execution_followup"
        state.clarification_questions = [
            ClarificationQuestion(
                question_id="execution_followup_loop",
                field_name="execution_followup",
                prompt=prompt,
                reason="execution_followup",
                required=True,
                options=[],
            )
        ]

    def _build_execution_roadmap(self, state: OrchestrationState) -> Dict[str, Any]:
        structured = self._research_schema(state)
        improvement_eval = self._latest_improvement_evaluation(state) or {}
        execution_steps = self._build_execution_steps(state)
        location = self._location_label(state) or str(state.user_context.get("country") or "السوق الحالي").strip()
        city = str(state.user_context.get("city") or "").strip()
        country = str(state.user_context.get("country") or "").strip()
        idea = str(improvement_eval.get("modified_idea") or state.user_context.get("idea") or "").strip()
        target_segment = (
            next(iter(self._top_cluster_labels(state, "accept")), None)
            or next(iter(state.user_context.get("targetAudience") or []), None)
            or "أول شريحة واضحة شايفة المشكلة"
        )
        competition = str(structured.get("competition_level") or "").lower()
        price_sensitive = str(structured.get("price_sensitivity") or "").lower() == "high"
        market_presence = str(structured.get("market_presence") or "").strip()
        price_range = str(structured.get("price_range") or "").strip()
        competition_note = "المنافسة عالية" if competition in {"high", "crowded", "saturated"} else "المنافسة قابلة للاختراق"
        area_label = f"حي واحد داخل {city}" if city else f"منطقة واحدة داخل {location}"
        manual_channel = "واتساب + نموذج طلب بسيط" if price_sensitive else "صفحة هبوط بسيطة + واتساب"
        budget_sensitive = price_sensitive or any(
            token in str(state.user_context.get("notes") or "").lower()
            for token in ["budget", "cheap", "low cost", "ميزانية", "تكلفة"]
        )
        why_now = [
            f"الفكرة وصلت لمرحلة اختبار حقيقية لأن القبول الحالي وصل لـ {int(round(float(state.metrics.get('acceptance_rate') or self._compute_metrics(state, iteration=int(state.deliberation_state.get('iteration') or 0)).get('acceptance_rate') or 0.0) * 100))}% تقريبًا.",
            f"الناس فهمت القيمة بشكل أوضح، خصوصًا عند شريحة {target_segment}.",
            f"{competition_note} في {location}، فالدخول لازم يكون بنسخة مركزة ومحدودة من أول يوم.",
        ]
        if market_presence:
            why_now.append(f"وجود السوق الحالي: {market_presence}.")

        first_version = (
            f"أحسن نسخة تبدأ بيها هي عرض صغير ومحدد يخدم {target_segment} في {area_label}، "
            f"وبتشغله يدويًا عبر {manual_channel} بدل ما تبني منصة كاملة من البداية."
        )
        if price_range:
            first_version += f" خليك قريب من منطق السعر الظاهر في السوق: {price_range}."

        first_five_steps = [
            f"حدد عرض واحد واضح جدًا للفئة {target_segment} بدل ما تفتح كل الاستخدامات مرة واحدة.",
            f"كلّم 10 أشخاص من {target_segment} في {location} واعرض عليهم النسخة الأولى بنفس صياغة البيع المقترحة.",
            f"اختبر سعر واحد أو باقة دخول واحدة فقط، وسجل أول اعتراضات على السعر والقيمة.",
            f"جهز قناة تشغيل بسيطة: {manual_channel}، مع طريقة متابعة يدوية للطلبات أو الحجوزات.",
            f"شغّل Pilot صغير في {area_label} واجمع أول 5 استخدامات فعلية قبل أي تطوير أكبر.",
        ]

        week_one = [
            "اليوم 1: صيّغ العرض في جملة واحدة، وحدد لمن هو بالضبط.",
            "اليوم 2: جهز صفحة أو رسالة بيع بسيطة فيها المشكلة، الحل، السعر، وطريقة الطلب.",
            f"اليوم 3: تواصل مع أول 10 مستخدمين محتملين من {target_segment}.",
            "اليوم 4: نفّذ أول تجربة فعلية يدويًا وسجل كل سؤال أو اعتراض ظهر.",
            "اليوم 5-7: عدّل الرسالة أو السعر مرة واحدة فقط ثم أعد الاختبار على مجموعة جديدة صغيرة.",
        ]

        month_one = [
            f"الأسبوع 2: ركز على تكرار البيع داخل {area_label} بدل التوسع في المدينة كلها.",
            "الأسبوع 3: راقب مين فعلاً دفع أو كرر الطلب، وعدّل العرض بناءً على الاعتراض الأكثر تكرارًا فقط.",
            "الأسبوع 4: قرر إذا كنت ستوسع القناة الحالية أو تحتاج شراكة صغيرة تساعدك في الوصول أو التشغيل.",
            "نهاية الشهر: لو فيه طلب متكرر ودفع واضح، ابدأ في تبسيط التشغيل أو الأتمتة خطوة واحدة فقط.",
        ]

        metrics_to_track = [
            "عدد الناس اللي ردوا باهتمام حقيقي على العرض.",
            "نسبة التحول من اهتمام إلى تجربة أو طلب فعلي.",
            "عدد الاعتراضات على السعر مقارنة بالاعتراضات على الفكرة نفسها.",
            "عدد اللي كرروا الطلب أو طلبوا متابعة بعد أول تجربة.",
            "أكثر سبب رفض أو تردد تكرر معاك في أول شهر.",
        ]

        risks = [
            f"خطر المنافسة في {location} لو العرض فضل عام ومش محدد.",
            "خطر إن السعر يبقى أعلى من القيمة المتصورة في أول نسخة.",
            "خطر التوسع بدري قبل ما يثبت إن فيه طلب متكرر فعلاً.",
            "خطر التعقيد التشغيلي لو حاولت تبني منتج كامل قبل Pilot ناجح.",
        ]

        low_cost = (
            f"أرخص طريقة تبدأ بيها هي {manual_channel} + تشغيل يدوي + Pilot في {area_label} "
            "من غير تطبيق كامل، ومن غير فريق كبير، ومن غير إنفاق تسويقي واسع."
        )
        if not budget_sensitive:
            low_cost = (
                f"ولو عايز تبدأ بأقل تكلفة برضه، استخدم {manual_channel} في {area_label} "
                "واصرف فقط على تجربة جذب أول مستخدمين بدل بناء نظام كامل."
            )

        roadmap = {
            "why_now": why_now,
            "best_first_version": first_version,
            "first_five_steps": first_five_steps,
            "execution_steps": dict(execution_steps),
            "week_one": week_one,
            "month_one": month_one,
            "what_to_measure": metrics_to_track,
            "main_risks": risks,
            "low_cost_version": low_cost,
            "final_cta": "تحب أحول الخطة دي دلوقتي إلى checklist تنفيذ يوم بيوم؟",
            "context": {
                "idea": idea,
                "country": country,
                "city": city,
                "location": location,
                "target_segment": target_segment,
                "competition_level": str(structured.get("competition_level") or ""),
                "price_sensitivity": str(structured.get("price_sensitivity") or ""),
            },
        }
        state.schema["execution_roadmap"] = roadmap
        return roadmap

    def _business_guidance_lines(self, state: OrchestrationState) -> List[str]:
        roadmap = self._build_execution_roadmap(state)
        steps_block = roadmap.get("execution_steps") or {}
        return [
            f"ليه الفكرة دلوقتي تستحق التجربة: {' '.join(roadmap['why_now'][:2])}",
            f"أفضل نسخة تبدأ بيها: {roadmap['best_first_version']}",
            f"{steps_block.get('intro', 'بص، من الكلام اللي حصل، ممكن تبدأ بكذا:')} {' | '.join((steps_block.get('steps') or [])[:4])}",
            f"أول 5 خطوات: {' | '.join(roadmap['first_five_steps'][:5])}",
            f"خطة أسبوع 1: {' | '.join(roadmap['week_one'][:5])}",
            f"خطة أول شهر: {' | '.join(roadmap['month_one'][:4])}",
            f"هتقيس إيه: {' | '.join(roadmap['what_to_measure'][:5])}",
            f"المخاطر الأساسية: {' | '.join(roadmap['main_risks'][:4])}",
            f"نسخة قليلة التكلفة: {roadmap['low_cost_version']}",
            steps_block.get("cta", roadmap["final_cta"]),
            roadmap["final_cta"],
        ]

    def _join_or_fallback(self, values: List[str], fallback: str) -> str:
        cleaned = [str(item).strip() for item in values if str(item).strip()]
        return " | ".join(cleaned[:2]) if cleaned else fallback

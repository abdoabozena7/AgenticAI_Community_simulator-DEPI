from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Sequence

from ..models.orchestration import ClarificationQuestion, DialogueTurn, OrchestrationState, PersonaProfile, SimulationPhase
from .base import BaseAgent


class SimulationAgent(BaseAgent):
    name = "simulation_agent"

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
        if current_iteration == 0:
            await self.runtime.event_bus.publish(
                state,
                "discussion_started",
                {
                    "agent": self.name,
                    "iteration_budget": total_iterations,
                    "represented_agents": len(state.personas),
                    "cluster_count": len(state.deliberation_state.get("clusters") or {}),
                },
            )

        rounds_to_run = min(2, max(1, total_iterations - current_iteration))
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
                question_mode = self._neutral_ratio(state) > 0.34 and (
                    speaker.opinion == "neutral" or float(speaker.traits.get("question_drive", 0.4)) > 0.56
                )
                argument = self._select_argument(state, speaker, target, question_mode)
                evidence = self._pick_evidence(state, argument)
                fallback = self._fallback_turn_payload(
                    speaker=speaker,
                    target=target,
                    argument=argument,
                    evidence=evidence,
                    question_mode=question_mode,
                    state=state,
                )
                turn_payload = await self.runtime.llm.generate_json(
                    prompt=self._deliberation_prompt(
                        state=state,
                        speaker=speaker,
                        target=target,
                        argument=argument,
                        evidence=evidence,
                        question_mode=question_mode,
                    ),
                    system=(
                        "You write one compact debate turn in JSON for a business simulation. "
                        "The speaker must mention the target by name using @name, respond to their prior stance, "
                        "cite at least one evidence item, and propose only gradual opinion movement."
                    ),
                    temperature=0.35,
                    fallback_json=fallback,
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
                await self.runtime.event_bus.publish_turn(state, turn)
                insight = self._detect_critical_insight(state, turn, argument)
                if insight is not None:
                    await self._pause_for_insight(state, insight)
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
            if self._neutral_ratio(state) <= 0.3 and iteration >= max(2, total_iterations - 1):
                break
        return state

    async def run_convergence(self, state: OrchestrationState) -> OrchestrationState:
        self._ensure_runtime_metadata(state)
        if state.pending_input:
            return state
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
            skepticism = float(persona.traits.get("dynamic_skepticism", persona.traits.get("skepticism", 0.5)))
            persona.traits["dynamic_skepticism"] = round(self._clamp(skepticism, 0.05, 0.98), 3)
            persona.traits["question_drive"] = round(self._clamp(float(persona.traits.get("question_drive", 0.35)), 0.05, 0.98), 3)
            persona.traits["evidence_affinity"] = round(self._clamp(float(persona.traits.get("evidence_affinity", 0.55)), 0.05, 0.99), 3)
            persona.traits["inertia"] = round(self._clamp(float(persona.traits.get("inertia", 0.45)), 0.05, 0.99), 3)
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
            bank.append(
                {
                    "id": "fallback-1",
                    "kind": "fallback",
                    "polarity": "question",
                    "claim": "The idea still needs a clearer proof of demand and execution path.",
                    "summary": "Need better demand and execution proof.",
                    "strength": 0.5,
                    "evidence_urls": [],
                    "source": "fallback",
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

    def _fallback_turn_payload(
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

    def _deliberation_prompt(
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

    def _apply_turn_effects(
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

    def _shift_persona(self, persona: PersonaProfile, requested_delta: float) -> None:
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

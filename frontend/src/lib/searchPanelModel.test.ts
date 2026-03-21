import { describe, expect, it } from "vitest";

import { buildSearchPanelModel } from "@/lib/searchPanelModel";
import type { PendingClarification, SimulationPipeline, SimulationPersonaSource } from "@/types/simulation";

describe("buildSearchPanelModel", () => {
  it("surfaces the exact pipeline blocker reason in the panel items", () => {
    const pipeline: SimulationPipeline = {
      ready_for_simulation: false,
      blockers: ["persona_count_below_simulation_minimum"],
      actively_blocked: true,
      blocked_phase: "persona_generation",
      blocker_details: [
        {
          code: "persona_count_below_simulation_minimum",
          phase_key: "persona_generation",
          title: "Persona count is below the simulation minimum",
          message: "The persona set was saved, but the count is still below the minimum threshold for simulation.",
          action: "Generate more personas or lower the configured threshold if policy allows it.",
        },
      ],
      warnings: [],
      fatal_errors: [],
      steps: [
        {
          key: "generating_personas",
          label: { en: "generating personas", ar: "توليد الشخصيات" },
          status: "blocked",
          detail: "Persona count is below the simulation minimum",
        },
      ],
    };

    const model = buildSearchPanelModel({
      language: "en",
      activePanel: "reasoning",
      searchState: { status: "idle", results: [] },
      researchContext: { summary: "", sources: [] },
      liveEvents: [],
      reviewRequired: false,
      pendingResearchReview: null,
      pendingClarification: null,
      coachIntervention: null,
      chatEvents: [],
      reasoningFeed: [],
      summary: null,
      schema: {},
      pendingInputKind: null,
      isRunStarting: false,
      isRunActive: false,
      simulationActuallyStarted: false,
      reasoningPanelAvailable: true,
      currentPhaseKey: "persona_generation",
      pipeline,
    });

    expect(model.stage).toBe("failed");
    expect(model.items[0]).toMatchObject({
      kind: "note",
      title: "Why the pipeline stopped",
      content: "Persona count is below the simulation minimum",
      cta: "Generate more personas or lower the configured threshold if policy allows it.",
    });
    expect(model.items[0]).toHaveProperty("bullets");
    expect((model.items[0] as { bullets?: string[] }).bullets?.[0]).toContain("minimum threshold for simulation");
  });

  it("does not show a blocker note while upstream persona generation is still running", () => {
    const pipeline: SimulationPipeline = {
      ready_for_simulation: false,
      blockers: ["persona_generation_not_finished", "persona_persistence_not_finished", "persona_count_zero"],
      actively_blocked: false,
      blocked_phase: "persona_generation",
      blocker_details: [
        {
          code: "persona_generation_not_finished",
          phase_key: "persona_generation",
          title: "Persona generation not finished",
          message: "The system still needs to finish building personas before the simulation can start.",
          action: "Wait for persona generation to finish.",
        },
      ],
      warnings: ["used_ai_estimation_due_to_weak_search"],
      fatal_errors: [],
      steps: [
        {
          key: "extracting_people_patterns",
          label: { en: "Extracting persona signals", ar: "استخراج إشارات الشخصيات" },
          status: "completed",
          detail: "Signals were extracted from the research state.",
        },
        {
          key: "generating_personas",
          label: { en: "Generating personas", ar: "توليد الشخصيات" },
          status: "running",
          detail: "Building personas from the structured research signals.",
        },
        {
          key: "ready_for_simulation",
          label: { en: "Ready for simulation", ar: "جاهز للمحاكاة" },
          status: "pending",
          detail: "Upstream stages are still running; simulation readiness will unlock automatically.",
        },
      ],
    };

    const model = buildSearchPanelModel({
      language: "en",
      activePanel: "reasoning",
      searchState: { status: "complete", results: [] },
      researchContext: { summary: "Weak live signal, AI estimation was used.", sources: [] },
      liveEvents: [],
      reviewRequired: false,
      pendingResearchReview: null,
      pendingClarification: null,
      coachIntervention: null,
      chatEvents: [],
      reasoningFeed: [],
      summary: null,
      schema: {
        research_estimation_mode: "ai_estimation",
      },
      pendingInputKind: null,
      isRunStarting: false,
      isRunActive: true,
      simulationActuallyStarted: true,
      reasoningPanelAvailable: true,
      currentPhaseKey: "persona_generation",
      pipeline,
    });

    expect(model.stage).toBe("running");
    expect(model.items.some((item) => item.kind === "note" && item.id === "pipeline-blocker")).toBe(false);
  });

  it("shows a single active clarification and auto-resolution notes", () => {
    const pendingClarification: PendingClarification = {
      questionId: "clarify_value",
      question: "What single outcome should this idea optimize first?",
      options: [{ id: "opt_1", label: "Save time" }],
      reasonTag: "valueProposition",
      reasonSummary: "The value is still too broad.",
      supportingSnippets: ["Research says the promise is still broad."],
      required: true,
    };
    const personaSource: SimulationPersonaSource = {
      mode: "generate_new_from_search",
      resolved: true,
      auto_selected: true,
      notice: null,
      selected_set_key: null,
      selected_set_label: null,
      options: [],
    };

    const model = buildSearchPanelModel({
      language: "en",
      activePanel: "reasoning",
      searchState: { status: "idle", results: [] },
      researchContext: { summary: "", sources: [] },
      liveEvents: [],
      reviewRequired: false,
      pendingResearchReview: null,
      pendingClarification,
      coachIntervention: null,
      chatEvents: [],
      reasoningFeed: [],
      summary: null,
      schema: {
        research_estimation_mode: "ai_estimation",
        research_visible_insights: ["The live signal is thin, so the fallback was used."],
      },
      pendingInputKind: "clarification",
      isRunStarting: false,
      isRunActive: false,
      simulationActuallyStarted: false,
      reasoningPanelAvailable: true,
      currentPhaseKey: "clarification_questions",
      pipeline: null,
      personaSource,
    });

    expect(model.stage).toBe("review");
    expect(model.items.some((item) => item.kind === "note" && item.content === pendingClarification.question)).toBe(true);
    expect(model.items.some((item) => item.kind === "note" && item.title.includes("AI estimation"))).toBe(true);
    expect(model.items.some((item) => item.kind === "note" && item.title.includes("auto-selected"))).toBe(true);
  });
});

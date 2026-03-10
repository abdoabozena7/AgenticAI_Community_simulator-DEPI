import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '@/services/api';
import { GuidedWorkflowDraftContext, GuidedWorkflowState } from '@/types/simulation';

const ACTIVE_WORKFLOW_KEY = 'activeGuidedWorkflowId';

const normalizeWorkflow = (payload: GuidedWorkflowState | null): GuidedWorkflowState | null => {
  if (!payload) return null;
  return {
    ...payload,
    guide_messages: Array.isArray(payload.guide_messages) ? payload.guide_messages : [],
    stage_history: Array.isArray(payload.stage_history) ? payload.stage_history : [],
    required_fields: Array.isArray(payload.required_fields) ? payload.required_fields : [],
    context_options: Array.isArray(payload.context_options) ? payload.context_options : [],
    corrections: Array.isArray(payload.corrections) ? payload.corrections : [],
  };
};

export function useGuidedWorkflow(options?: { suppressAutoRestore?: boolean }) {
  const [workflow, setWorkflow] = useState<GuidedWorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistId = useCallback((workflowId?: string | null) => {
    if (typeof window === 'undefined') return;
    if (workflowId) {
      window.localStorage.setItem(ACTIVE_WORKFLOW_KEY, workflowId);
    } else {
      window.localStorage.removeItem(ACTIVE_WORKFLOW_KEY);
    }
  }, []);

  const applyState = useCallback((nextState: GuidedWorkflowState | null) => {
    const normalized = normalizeWorkflow(nextState);
    setWorkflow(normalized);
    persistId(normalized?.workflow_id ?? null);
    return normalized;
  }, [persistId]);

  const ensureStarted = useCallback(async (payload: {
    draftContext: GuidedWorkflowDraftContext;
    language: 'ar' | 'en';
  }) => {
    setLoading(true);
    setError(null);
    try {
      let workflowId: string | null = null;
      if (typeof window !== 'undefined') {
        workflowId = window.localStorage.getItem(ACTIVE_WORKFLOW_KEY);
      }
      const state = await apiService.startGuidedWorkflow({
        workflow_id: workflowId || undefined,
        language: payload.language,
        draft_context: payload.draftContext,
      });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start guided workflow';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  const refresh = useCallback(async (workflowId?: string | null) => {
    const currentId = workflowId || workflow?.workflow_id;
    if (!currentId) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.getGuidedWorkflowState(currentId);
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh guided workflow';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const restoreBySimulation = useCallback(async (simulationId?: string | null) => {
    const currentSimulationId = String(simulationId || '').trim();
    if (!currentSimulationId) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.getGuidedWorkflowStateBySimulation(currentSimulationId);
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        return null;
      }
      const message = err instanceof Error ? err.message : 'Failed to restore guided workflow from simulation';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  const updateContextScope = useCallback(async (scope: '' | 'specific_place' | 'internet' | 'global', placeName?: string) => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.updateGuidedWorkflowContext({
        workflow_id: workflow.workflow_id,
        scope,
        place_name: placeName,
      });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update context scope';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const submitSchema = useCallback(async (updates: Partial<GuidedWorkflowDraftContext>) => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.submitGuidedWorkflowSchema({
        workflow_id: workflow.workflow_id,
        updates,
      });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit workflow schema';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const answerClarifications = useCallback(async (answers: Array<{ questionId: string; answer: string }>) => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.answerGuidedWorkflowClarifications({
        workflow_id: workflow.workflow_id,
        answers: answers.map((item) => ({ question_id: item.questionId, answer: item.answer })),
      });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to answer workflow clarification';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const approveReview = useCallback(async () => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.approveGuidedWorkflow({ workflow_id: workflow.workflow_id });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve workflow review';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const pause = useCallback(async (reason?: string) => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.pauseGuidedWorkflow({ workflow_id: workflow.workflow_id, reason });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pause workflow';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const resume = useCallback(async () => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.resumeGuidedWorkflow({ workflow_id: workflow.workflow_id });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume workflow';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const submitCorrection = useCallback(async (text: string) => {
    if (!workflow?.workflow_id) return null;
    setLoading(true);
    setError(null);
    try {
      const state = await apiService.applyGuidedWorkflowCorrection({
        workflow_id: workflow.workflow_id,
        text,
      });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply workflow correction';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyState, workflow?.workflow_id]);

  const attachSimulation = useCallback(async (simulationId: string) => {
    if (!workflow?.workflow_id || !simulationId) return null;
    try {
      const state = await apiService.attachGuidedWorkflowSimulation({
        workflow_id: workflow.workflow_id,
        simulation_id: simulationId,
      });
      return applyState(state as unknown as GuidedWorkflowState);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to attach simulation to workflow';
      setError(message);
      throw err;
    }
  }, [applyState, workflow?.workflow_id]);

  useEffect(() => {
    if (options?.suppressAutoRestore) return;
    if (typeof window === 'undefined') return;
    const workflowId = window.localStorage.getItem(ACTIVE_WORKFLOW_KEY);
    if (!workflowId || workflow) return;
    void refresh(workflowId).catch(() => {
      window.localStorage.removeItem(ACTIVE_WORKFLOW_KEY);
    });
  }, [options?.suppressAutoRestore, refresh, workflow]);

  const canStartSimulation = useMemo(
    () => workflow?.status === 'ready' && workflow.current_stage === 'ready_to_start',
    [workflow]
  );

  return {
    workflow,
    loading,
    error,
    canStartSimulation,
    ensureStarted,
    refresh,
    restoreBySimulation,
    updateContextScope,
    submitSchema,
    answerClarifications,
    approveReview,
    pause,
    resume,
    submitCorrection,
    attachSimulation,
    reset: () => applyState(null),
  };
}

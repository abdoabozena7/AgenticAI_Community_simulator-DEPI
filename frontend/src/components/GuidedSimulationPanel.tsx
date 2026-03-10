import { useMemo, useState } from 'react';
import { ArrowRight, Bot, Clock3, Eye, Pause, Play, ShieldCheck, Sparkles, TimerReset } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CoachIntervention, GuidedWorkflowDraftContext, GuidedWorkflowState, SimulationStatus } from '@/types/simulation';

export const GUIDED_SIMULATION_PANEL_CUSTOM_X_PX = 0;
export const GUIDED_SIMULATION_PANEL_CUSTOM_Y_PX = 0;

interface GuidedSimulationPanelProps {
  workflow: GuidedWorkflowState | null;
  loading?: boolean;
  simulationStatus: SimulationStatus;
  coachIntervention?: CoachIntervention | null;
  coachBusy?: boolean;
  debateReady?: boolean;
  reasoningCount?: number;
  language: 'ar' | 'en';
  draftInput: GuidedWorkflowDraftContext;
  onDraftChange: (updates: Partial<GuidedWorkflowDraftContext>) => void;
  onChooseScope: (scope: GuidedWorkflowDraftContext['contextScope']) => void;
  onSubmitSchema: () => void;
  onSubmitClarifications: (answers: Array<{ questionId: string; answer: string }>) => void;
  onApproveReview: () => void;
  onPauseWorkflow: () => void;
  onResumeWorkflow: () => void;
  onSubmitCorrection: (text: string) => void;
  onStartSimulation: () => void;
  onOpenReasoning: () => void;
  onOpenCoachEvidence?: (messageIds: string[]) => void;
  onOpenConfig?: () => void;
  onApplyCorrectionToSimulation?: () => void;
  onCoachApplySuggestion?: (suggestionId: string) => void;
  onCoachRequestMoreIdeas?: () => void;
  onCoachContinueWithoutChange?: () => void;
  onCoachCustomFix?: (text: string) => void;
  onCoachConfirmRerun?: () => void;
}

const STAGE_LABELS: Record<string, { ar: string; en: string }> = {
  context_scope: { ar: 'نوع السياق', en: 'Context scope' },
  schema_intake: { ar: 'تجميع الـschema', en: 'Schema intake' },
  clarification: { ar: 'توضيح ذكي', en: 'Smart clarification' },
  idea_research: { ar: 'بحث الفكرة', en: 'Idea research' },
  location_research: { ar: 'بحث المكان', en: 'Location research' },
  persona_synthesis: { ar: 'بناء الشخصيات', en: 'Persona synthesis' },
  review: { ar: 'مراجعة التشغيل', en: 'Launch review' },
  ready_to_start: { ar: 'جاهز للبدء', en: 'Ready to start' },
};

const DEFAULT_STAGE_ORDER = ['context_scope', 'schema_intake', 'clarification', 'idea_research', 'location_research', 'persona_synthesis', 'review', 'ready_to_start'];

const formatEta = (seconds?: number, language: 'ar' | 'en' = 'en') => {
  const safe = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.max(1, Math.ceil(safe / 60));
  return language === 'ar' ? `${minutes} دقيقة تقريبًا` : `~${minutes} min`;
};

const stageLabel = (stage: string, language: 'ar' | 'en') =>
  STAGE_LABELS[stage]?.[language] || stage.replace(/_/g, ' ');

function ToggleChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'max-w-full rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-sky-400/70 bg-sky-500/15 text-sky-100'
          : 'border-border/60 bg-background/40 text-muted-foreground hover:border-sky-500/40 hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

export function GuidedSimulationPanel({
  workflow,
  loading = false,
  simulationStatus,
  coachIntervention = null,
  coachBusy = false,
  debateReady = false,
  reasoningCount = 0,
  language,
  draftInput,
  onDraftChange,
  onChooseScope,
  onSubmitSchema,
  onSubmitClarifications,
  onApproveReview,
  onPauseWorkflow,
  onResumeWorkflow,
  onSubmitCorrection,
  onStartSimulation,
  onOpenReasoning,
  onOpenCoachEvidence,
  onOpenConfig,
  onApplyCorrectionToSimulation,
  onCoachApplySuggestion,
  onCoachRequestMoreIdeas,
  onCoachContinueWithoutChange,
  onCoachCustomFix,
  onCoachConfirmRerun,
}: GuidedSimulationPanelProps) {
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [correctionText, setCorrectionText] = useState('');
  const [coachCustomFixText, setCoachCustomFixText] = useState('');

  const guideMessages = workflow?.guide_messages ?? [];
  const currentStage = workflow?.current_stage ?? 'context_scope';
  const stageHistory = workflow?.stage_history ?? [];
  const clarificationQuestions = workflow?.clarification_questions ?? [];
  const activeClarificationQuestions = clarificationQuestions.filter(
    (question) => !(workflow?.clarification_answers || {})[question.id]
  );
  const totalEta = workflow?.estimated_total_seconds ?? 0;
  const stageEta = workflow?.stage_eta_seconds ?? 0;
  const canResume = workflow?.status === 'paused';
  const lastCorrection = workflow?.last_correction ?? null;
  const coachEvidenceMessageIds = (coachIntervention?.agentCitations || [])
    .map((item) => item.messageId)
    .filter((item): item is string => Boolean(item));

  const stageRail = useMemo(() => {
    const byStage = new Map(stageHistory.map((item) => [item.stage, item]));
    return DEFAULT_STAGE_ORDER
      .filter((stage) => stage !== 'location_research' || draftInput.contextScope === 'specific_place')
      .map((stage) => ({
        stage,
        status: byStage.get(stage)?.status ?? (stage === currentStage ? workflow?.current_stage_status : 'pending'),
        summary: byStage.get(stage)?.summary,
      }));
  }, [currentStage, draftInput.contextScope, stageHistory, workflow?.current_stage_status]);

  const submitClarifications = () => {
    const answers = activeClarificationQuestions
      .map((question) => ({
        questionId: question.id,
        answer: clarificationAnswers[question.id]?.trim() || '',
      }))
      .filter((item) => item.answer);
    if (!answers.length) return;
    onSubmitClarifications(answers);
  };

  const submitCorrection = () => {
    const text = correctionText.trim();
    if (!text) return;
    onSubmitCorrection(text);
    setCorrectionText('');
  };

  const submitCoachCustomFix = () => {
    const text = coachCustomFixText.trim();
    if (!text || !onCoachCustomFix) return;
    onCoachCustomFix(text);
    setCoachCustomFixText('');
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="overflow-hidden rounded-[28px] border border-sky-400/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_35%),linear-gradient(145deg,rgba(15,23,42,0.95),rgba(12,18,31,0.92))] p-4 text-slate-50 shadow-[0_24px_60px_rgba(2,6,23,0.28)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="space-y-3">
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-sky-100/80">
                <Bot className="h-3.5 w-3.5" />
                Guided Simulation Workflow
              </div>
              <div className="min-w-0">
                <h2 className="text-[1.7rem] font-semibold tracking-tight sm:text-[1.9rem]">
                  {stageLabel(currentStage, language)}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-300/85">
                  {guideMessages.at(-1)?.content || (language === 'ar' ? 'ابدأ من نوع السياق ثم دع الـagents يكملوا بقية الخطوات.' : 'Start with the context scope, then let the agents handle the rest.')}
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  {language === 'ar' ? 'المرحلة الحالية' : 'Current stage'}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                  <Clock3 className="h-4 w-4 text-sky-300" />
                  {formatEta(stageEta, language)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  {language === 'ar' ? 'الإجمالي المتبقي' : 'Remaining total'}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                  <TimerReset className="h-4 w-4 text-emerald-300" />
                  {formatEta(totalEta, language)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid min-w-0 gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                {language === 'ar' ? 'المراحل' : 'Stages'}
              </div>
              <div className="space-y-2">
                {stageRail.map((item, index) => (
                  <div
                    key={item.stage}
                    className={cn(
                      'rounded-2xl border px-3 py-2.5 transition',
                      item.stage === currentStage
                        ? 'border-sky-400/40 bg-sky-400/10'
                        : item.status === 'completed' || item.status === 'ready'
                        ? 'border-emerald-400/20 bg-emerald-400/10'
                        : 'border-white/10 bg-white/[0.04]'
                    )}
                  >
                    <div className="flex flex-col items-start gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100">
                          {index + 1}. {stageLabel(item.stage, language)}
                        </div>
                        {item.summary && (
                          <div className="mt-1 break-words text-xs text-slate-400">{item.summary}</div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]',
                          item.status === 'completed' || item.status === 'ready'
                            ? 'bg-emerald-400/15 text-emerald-200'
                            : item.stage === currentStage
                            ? 'bg-sky-400/15 text-sky-100'
                            : 'bg-white/10 text-slate-300'
                        )}
                      >
                        {item.status === 'completed'
                          ? 'done'
                          : item.stage === currentStage
                          ? 'live'
                          : 'next'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid min-w-0 gap-3">
              {coachIntervention && (
                <div className="rounded-3xl border border-cyan-400/30 bg-cyan-500/10 p-4 text-cyan-50">
                  <div className="flex flex-col gap-4">
                    <div className="rounded-2xl border border-cyan-300/20 bg-black/20 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">
                        {language === 'ar' ? 'Real-time coach' : 'Real-time coach'}
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-white">
                        {coachIntervention.blockerSummary}
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(coachIntervention.history || []).slice(-5).map((item, index) => (
                          <span key={`${item.type}-${index}`} className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-100">
                            {item.label || item.type.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-cyan-300/20 bg-background/20 px-3 py-2 text-sm">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-cyan-200/80">
                            {language === 'ar' ? 'Severity' : 'Severity'}
                          </div>
                          <div className="mt-1 font-medium text-white">{coachIntervention.severity}</div>
                        </div>
                        <div className="rounded-2xl border border-cyan-300/20 bg-background/20 px-3 py-2 text-sm">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-cyan-200/80">
                            {language === 'ar' ? 'Decision axis' : 'Decision axis'}
                          </div>
                          <div className="mt-1 break-words font-medium text-white">{coachIntervention.decisionAxis || '-'}</div>
                        </div>
                      </div>
                      {coachIntervention.guideMessage && (
                        <p className="mt-3 text-sm leading-6 text-cyan-100/90">{coachIntervention.guideMessage}</p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-cyan-300/20 bg-black/20 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">
                        {language === 'ar' ? 'Evidence' : 'Evidence'}
                      </div>
                      <div className="space-y-2">
                        {coachIntervention.agentCitations.slice(0, 3).map((item) => (
                          <div key={item.id} className="rounded-2xl border border-cyan-300/15 bg-background/20 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-[0.12em] text-cyan-200/80">
                              {item.agentLabel || (language === 'ar' ? 'وكيل' : 'Agent')}
                            </div>
                            <div className="mt-1 break-words text-sm text-white">{item.quote}</div>
                          </div>
                        ))}
                        {coachIntervention.researchEvidence.slice(0, 3).map((item) => (
                          <div key={item.id} className="rounded-2xl border border-white/10 bg-background/10 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-[0.12em] text-cyan-200/80">
                              {item.label || (language === 'ar' ? 'بحث' : 'Research')}
                            </div>
                            <div className="mt-1 break-words text-sm text-cyan-50/90">{item.quote}</div>
                          </div>
                        ))}
                      </div>
                      {!!coachEvidenceMessageIds.length && onOpenCoachEvidence && (
                        <Button type="button" variant="outline" onClick={() => onOpenCoachEvidence(coachEvidenceMessageIds)} className="mt-3 w-full">
                          <Eye className="mr-2 h-4 w-4" />
                          {language === 'ar' ? 'شاهد الرسائل المرتبطة' : 'View linked messages'}
                        </Button>
                      )}
                    </div>

                    <div className="rounded-2xl border border-cyan-300/20 bg-black/20 p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">
                          {language === 'ar' ? '5 fixes ready' : '5 fixes ready'}
                        </div>
                        {onCoachRequestMoreIdeas && (
                          <Button type="button" variant="ghost" size="sm" onClick={onCoachRequestMoreIdeas} disabled={coachBusy}>
                            {language === 'ar' ? 'اقتراحات أخرى' : 'More ideas'}
                          </Button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {coachIntervention.suggestions.slice(0, 5).map((suggestion) => (
                          <div key={suggestion.suggestionId} className="rounded-2xl border border-cyan-300/15 bg-background/15 p-3">
                            <div className="text-sm font-semibold text-white">{suggestion.title}</div>
                            <div className="mt-1 break-words text-sm text-cyan-50/90">{suggestion.oneLiner}</div>
                            <div className="mt-2 break-words text-xs text-cyan-100/75">{suggestion.rationale}</div>
                            {suggestion.tradeoff && (
                              <div className="mt-2 break-words text-[11px] text-cyan-100/65">
                                {language === 'ar' ? 'Tradeoff:' : 'Tradeoff:'} {suggestion.tradeoff}
                              </div>
                            )}
                            {onCoachApplySuggestion && (
                              <Button
                                type="button"
                                onClick={() => onCoachApplySuggestion(suggestion.suggestionId)}
                                disabled={coachBusy}
                                className="mt-3 w-full bg-cyan-200 text-cyan-950 hover:bg-cyan-100"
                              >
                                {suggestion.ctaLabel || (language === 'ar' ? 'اعتمد وأعد التشغيل' : 'Apply and rerun')}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-cyan-300/20 bg-black/20 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">
                        {language === 'ar' ? 'Custom fix' : 'Custom fix'}
                      </div>
                      <Textarea
                        value={coachCustomFixText}
                        onChange={(event) => setCoachCustomFixText(event.target.value)}
                        className="min-h-[96px] bg-background/20"
                        placeholder={language === 'ar' ? 'أضف تعديلًا واقعيًا محددًا وسيتم تحويله إلى patch محايد.' : 'Add a factual fix and it will be converted into a neutral patch.'}
                      />
                      <div className="mt-3 grid gap-2">
                        {onCoachCustomFix && (
                          <Button type="button" onClick={submitCoachCustomFix} disabled={coachBusy || !coachCustomFixText.trim()} className="w-full">
                            {language === 'ar' ? 'فلتر وأنشئ patch' : 'Filter and build patch'}
                          </Button>
                        )}
                        {onCoachContinueWithoutChange && (
                          <Button type="button" variant="outline" onClick={onCoachContinueWithoutChange} disabled={coachBusy} className="w-full">
                            {language === 'ar' ? 'كمل بدون تعديل' : 'Continue without change'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {coachIntervention.patchPreview && (
                      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-200/80">
                          {language === 'ar' ? 'Context diff preview' : 'Context diff preview'}
                        </div>
                        <div className="mt-2 space-y-2">
                          {Object.entries(coachIntervention.patchPreview.contextPatch || {}).map(([key, value]) => (
                            <div key={key} className="rounded-xl border border-white/10 bg-background/20 px-3 py-2 text-sm">
                              <div className="text-[11px] uppercase tracking-[0.12em] text-emerald-200/80">{key}</div>
                              <div className="mt-1 break-words text-white">
                                {Array.isArray(value) ? value.join(', ') : String(value)}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 text-xs text-emerald-100/80">
                          {language === 'ar' ? 'سيُعاد البناء من:' : 'Will rerun from:'} {coachIntervention.patchPreview.rerunFromStage}
                        </div>
                        <div className="mt-1 text-xs text-emerald-100/80">
                          {coachIntervention.patchPreview.guideMessage}
                        </div>
                        {coachIntervention.patchPreview.notes?.length ? (
                          <div className="mt-2 space-y-1 text-xs text-emerald-100/70">
                            {coachIntervention.patchPreview.notes.map((note) => (
                              <div key={note} className="break-words">{note}</div>
                            ))}
                          </div>
                        ) : null}
                        {onCoachConfirmRerun && (
                          <Button type="button" onClick={onCoachConfirmRerun} disabled={coachBusy} className="mt-3 w-full bg-emerald-200 text-emerald-950 hover:bg-emerald-100">
                            <Play className="mr-2 h-4 w-4" />
                            {language === 'ar' ? 'اعتمد وأعد التشغيل' : 'Confirm and rerun'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {debateReady && (
                <div className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-50">
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-amber-200/80">
                        {language === 'ar' ? 'نقاش الـAgents' : 'Agent debate'}
                      </div>
                      <div className="mt-1 text-sm">
                        {workflow?.simulation?.debate_session?.message || (language === 'ar' ? 'الـagents بدأوا يناقشوا بعض. هل تريد المشاهدة؟' : 'Agents have started debating. Do you want to watch?')}
                      </div>
                    </div>
                    <Button type="button" onClick={onOpenReasoning} className="w-full bg-amber-200 text-amber-950 hover:bg-amber-100">
                      <Eye className="mr-2 h-4 w-4" />
                      {language === 'ar' ? 'شاهد النقاش' : 'Watch debate'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid min-w-0 gap-3">
                <div className="space-y-3">
                  <div className="rounded-3xl border border-border/60 bg-card/70 p-3 backdrop-blur">
                    <div className="mb-3 flex flex-col gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          Guide timeline
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {language === 'ar' ? 'الـGuideAgent يشرح ما يحدث وما المطلوب منك.' : 'The GuideAgent explains each step and what it needs from you.'}
                        </div>
                      </div>
                      {workflow?.verification && (
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {workflow.verification.ok ? 'Verified' : 'Check'}
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      {guideMessages.slice(-6).map((message) => (
                        <div key={message.id} className="min-w-0 rounded-2xl border border-border/50 bg-background/60 p-3">
                          <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            {stageLabel(message.stage || currentStage, language)}
                          </div>
                          <div className="break-words text-sm leading-6 text-foreground">{message.content}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {currentStage === 'context_scope' && (
                    <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold text-foreground">
                          {language === 'ar' ? 'حدد نوع السياق أولًا' : 'Choose the context scope first'}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {language === 'ar' ? 'هذه الخطوة إجبارية لأن نوع الشخصيات والبحث يعتمد عليها.' : 'This step is required because research and persona generation depend on it.'}
                        </p>
                      </div>
                      <div className="grid gap-3">
                        {(workflow?.context_options ?? []).map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => onChooseScope(option.id)}
                            className={cn(
                              'rounded-3xl border p-4 text-left transition',
                              draftInput.contextScope === option.id
                                ? 'border-sky-400/50 bg-sky-500/10 shadow-[0_20px_50px_rgba(14,165,233,0.12)]'
                                : 'border-border/50 bg-background/40 hover:border-sky-500/30 hover:bg-sky-500/5'
                            )}
                          >
                            <div className="text-sm font-semibold text-foreground">{option.label}</div>
                            <div className="mt-2 text-sm text-muted-foreground">{option.description}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentStage === 'schema_intake' && (
                    <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
                      <div className="mb-4 flex flex-col gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold text-foreground">
                            {language === 'ar' ? 'اجمع فقط الحقول الناقصة' : 'Collect only the missing fields'}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {language === 'ar' ? 'لن نعيد سؤال أي حقل موجود بالفعل، لكن يمكنك تعديله هنا إذا لزم.' : 'Known schema fields stay prefilled; edit them only if you need to correct something.'}
                          </p>
                        </div>
                        {onOpenConfig && (
                          <Button type="button" variant="outline" onClick={onOpenConfig} className="w-full">
                            {language === 'ar' ? 'افتح الإعدادات' : 'Open config'}
                          </Button>
                        )}
                      </div>

                      <div className="grid gap-3">
                        <div className="grid gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">{language === 'ar' ? 'الفكرة' : 'Idea'}</label>
                            <Textarea
                              value={draftInput.idea}
                              onChange={(event) => onDraftChange({ idea: event.target.value })}
                              className="min-h-[120px]"
                              placeholder={language === 'ar' ? 'صف الفكرة بجملة واضحة ومحددة.' : 'Describe the idea in one clear, concrete sentence.'}
                            />
                          </div>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-foreground">{language === 'ar' ? 'الفئة' : 'Category'}</label>
                              <Input
                                value={draftInput.category}
                                onChange={(event) => onDraftChange({ category: event.target.value })}
                                placeholder={language === 'ar' ? 'مثال: Fintech, Health, Education' : 'Example: Fintech, Health, Education'}
                              />
                            </div>
                            {draftInput.contextScope === 'specific_place' && (
                              <div className="grid gap-4">
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-foreground">{language === 'ar' ? 'المدينة / المكان' : 'City / place'}</label>
                                  <Input
                                    value={draftInput.city || draftInput.placeName}
                                    onChange={(event) => onDraftChange({ city: event.target.value, placeName: event.target.value })}
                                    placeholder={language === 'ar' ? 'مثال: Alexandria' : 'Example: Alexandria'}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-foreground">{language === 'ar' ? 'الدولة' : 'Country'}</label>
                                  <Input
                                    value={draftInput.country}
                                    onChange={(event) => onDraftChange({ country: event.target.value })}
                                    placeholder={language === 'ar' ? 'مثال: Egypt' : 'Example: Egypt'}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">{language === 'ar' ? 'الجمهور المستهدف' : 'Target audience'}</label>
                          <div className="flex flex-wrap gap-2">
                            {['Consumers', 'Students', 'Professionals', 'SMBs', 'Enterprises', 'Developers'].map((item) => (
                              <ToggleChip
                                key={item}
                                label={item}
                                active={draftInput.targetAudience.includes(item)}
                                onClick={() => {
                                  const next = draftInput.targetAudience.includes(item)
                                    ? draftInput.targetAudience.filter((entry) => entry !== item)
                                    : [...draftInput.targetAudience, item];
                                  onDraftChange({ targetAudience: next });
                                }}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">{language === 'ar' ? 'أهداف التشغيل' : 'Simulation goals'}</label>
                          <div className="flex flex-wrap gap-2">
                            {['Market Validation', 'Product-Market Fit', 'Growth Strategy', 'Competitive Analysis'].map((goal) => (
                              <ToggleChip
                                key={goal}
                                label={goal}
                                active={draftInput.goals.includes(goal)}
                                onClick={() => {
                                  const next = draftInput.goals.includes(goal)
                                    ? draftInput.goals.filter((entry) => entry !== goal)
                                    : [...draftInput.goals, goal];
                                  onDraftChange({ goals: next });
                                }}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                          <div className="break-words text-sm text-muted-foreground">
                            {workflow?.required_fields?.length
                              ? `${language === 'ar' ? 'الحقول المطلوبة الآن:' : 'Required now:'} ${workflow.required_fields.join(', ')}`
                              : (language === 'ar' ? 'كل الحقول المطلوبة جاهزة.' : 'All required fields are ready.')}
                          </div>
                          <Button type="button" onClick={onSubmitSchema} disabled={loading} className="mt-3 w-full">
                            <ArrowRight className="mr-2 h-4 w-4" />
                            {language === 'ar' ? 'تابع للمرحلة التالية' : 'Continue to next stage'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {currentStage === 'clarification' && (
                    <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold text-foreground">
                          {language === 'ar' ? 'توضيح ذكي فقط عند الغموض' : 'Smart clarification only where needed'}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {language === 'ar' ? 'هذه الأسئلة لا تعيد الـschema، بل تغلق الغموض الذي يؤثر على جودة الشخصيات والمحاكاة.' : 'These questions do not repeat the schema. They only close ambiguity that affects persona quality.'}
                        </p>
                      </div>

                      <div className="space-y-4">
                        {activeClarificationQuestions.map((question) => (
                          <div key={question.id} className="rounded-2xl border border-border/60 bg-background/40 p-4">
                            <div className="text-sm font-medium text-foreground">{question.prompt}</div>
                            {question.reason && (
                              <div className="mt-1 text-xs text-muted-foreground">{question.reason}</div>
                            )}
                            <Textarea
                              className="mt-3 min-h-[88px]"
                              value={clarificationAnswers[question.id] || ''}
                              onChange={(event) => setClarificationAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="mt-4">
                        <Button type="button" onClick={submitClarifications} disabled={loading} className="w-full">
                          <Sparkles className="mr-2 h-4 w-4" />
                          {language === 'ar' ? 'استكمل التحليل' : 'Continue analysis'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {(currentStage === 'review' || currentStage === 'ready_to_start') && workflow?.review && (
                    <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-4">
                      <div className="mb-4 flex flex-col gap-3">
                        <div className="min-w-0">
                          <div className="text-xs uppercase tracking-[0.14em] text-emerald-300/80">
                            {language === 'ar' ? 'Ready review' : 'Ready review'}
                          </div>
                          <h3 className="mt-1 text-lg font-semibold text-foreground">
                            {workflow.review.title || (language === 'ar' ? 'ملخص التشغيل' : 'Launch summary')}
                          </h3>
                          <p className="mt-2 break-words text-sm text-muted-foreground">
                            {workflow.review.summary}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-emerald-400/20 bg-background/40 px-4 py-3 text-sm">
                          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {language === 'ar' ? 'Estimated run time' : 'Estimated run time'}
                          </div>
                          <div className="mt-1 font-medium text-foreground">
                            {formatEta(workflow.review.estimated_runtime_seconds, language)}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                          <div className="mb-2 text-sm font-medium text-foreground">
                            {language === 'ar' ? 'Research summary' : 'Research summary'}
                          </div>
                          <div className="space-y-2 text-sm text-muted-foreground">
                            {(workflow.review.research_highlights || []).map((item) => (
                              <div key={item} className="rounded-xl border border-border/40 bg-background/30 px-3 py-2 break-words">
                                {item}
                              </div>
                            ))}
                            {workflow.review.location_summary && (
                              <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-2 break-words">
                                {workflow.review.location_summary}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                          <div className="mb-2 text-sm font-medium text-foreground">
                            {workflow.persona_snapshot?.title || (language === 'ar' ? 'Generated personas' : 'Generated personas')}
                          </div>
                          <div className="space-y-2">
                            {(workflow.persona_snapshot?.personas || []).slice(0, 4).map((persona) => (
                              <div key={persona.id} className="rounded-xl border border-border/40 bg-background/30 px-3 py-2">
                                <div className="text-sm font-medium text-foreground">{persona.label}</div>
                                <div className="mt-1 break-words text-xs text-muted-foreground">{persona.summary}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2">
                        {currentStage === 'review' && (
                          <Button type="button" variant="outline" onClick={onApproveReview} disabled={loading} className="w-full">
                            {language === 'ar' ? 'اعتمد المراجعة' : 'Approve review'}
                          </Button>
                        )}
                        {currentStage === 'ready_to_start' && (
                          <Button type="button" onClick={onStartSimulation} disabled={loading || simulationStatus === 'running'} className="w-full">
                            <Play className="mr-2 h-4 w-4" />
                            {language === 'ar' ? 'ابدأ المحاكاة' : 'Start simulation'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
                    <div className="mb-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {language === 'ar' ? 'Operator actions' : 'Operator actions'}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'ar' ? 'تستطيع الإيقاف والمتابعة في أي وقت.' : 'You can pause or resume at any point.'}
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Button type="button" variant="outline" onClick={canResume ? onResumeWorkflow : onPauseWorkflow} disabled={loading} className="w-full justify-center">
                        {canResume ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                        {canResume
                          ? (language === 'ar' ? 'استكمل الـworkflow' : 'Resume workflow')
                          : (language === 'ar' ? 'أوقف الـworkflow' : 'Pause workflow')}
                      </Button>
                      <Button type="button" variant="outline" onClick={onOpenReasoning} className="w-full justify-center">
                        <Eye className="mr-2 h-4 w-4" />
                        {language === 'ar' ? `افتح الـreasoning (${reasoningCount})` : `Open reasoning (${reasoningCount})`}
                      </Button>
                    </div>
                    {workflow?.pause_reason && (
                      <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                        {workflow.pause_reason}
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
                    <div className="mb-3">
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {language === 'ar' ? 'Bias firewall' : 'Bias firewall'}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'ar' ? 'أرسل correction factual وسيتم تحويله إلى صياغة محايدة قبل التطبيق.' : 'Send a factual correction and it will be neutralized before application.'}
                      </div>
                    </div>
                    <Textarea
                      value={correctionText}
                      onChange={(event) => setCorrectionText(event.target.value)}
                      className="min-h-[120px]"
                      placeholder={language === 'ar' ? 'مثال: city is Alexandria, target audience is SMBs' : 'Example: city is Alexandria, target audience is SMBs'}
                    />
                    <div className="mt-3 grid gap-2">
                      <Button type="button" onClick={submitCorrection} disabled={loading || !correctionText.trim()} className="w-full">
                        {language === 'ar' ? 'فلتر وطبّق التصحيح' : 'Filter and apply correction'}
                      </Button>
                      {onApplyCorrectionToSimulation && lastCorrection?.apply_mode === 'factual_update' && simulationStatus !== 'idle' && (
                        <Button type="button" variant="outline" onClick={onApplyCorrectionToSimulation} className="w-full">
                          {language === 'ar' ? 'أعد التشغيل بالتصحيح' : 'Rerun with correction'}
                        </Button>
                      )}
                    </div>
                    {lastCorrection && (
                      <div className="mt-3 rounded-2xl border border-border/60 bg-background/40 p-3">
                        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          {language === 'ar' ? 'Neutralized correction' : 'Neutralized correction'}
                        </div>
                        <div className="mt-2 break-words text-sm text-foreground">{lastCorrection.neutralized_text}</div>
                        {lastCorrection.notes?.length ? (
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {lastCorrection.notes.map((note) => (
                              <div key={note} className="break-words">{note}</div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

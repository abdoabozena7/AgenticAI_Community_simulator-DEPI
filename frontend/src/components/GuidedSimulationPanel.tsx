import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Eye, Pause, Play, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  CoachIntervention,
  GuidedWorkflowDraftContext,
  GuidedWorkflowState,
  SimulationStatus,
} from '@/types/simulation';
import {
  ChatActionRow,
  ChatBubble,
  ChatShell,
  ChatTopProgress,
  type ChatProgressStep,
} from '@/components/simulation/ChatPrimitives';

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
  schema_intake: { ar: 'تجميع البيانات', en: 'Schema intake' },
  clarification: { ar: 'توضيح ذكي', en: 'Smart clarification' },
  idea_research: { ar: 'بحث الفكرة', en: 'Idea research' },
  location_research: { ar: 'بحث المكان', en: 'Location research' },
  persona_synthesis: { ar: 'بناء الشخصيات', en: 'Persona synthesis' },
  review: { ar: 'المراجعة', en: 'Review' },
  ready_to_start: { ar: 'جاهز للتشغيل', en: 'Ready to start' },
};

const DEFAULT_STAGE_ORDER = [
  'context_scope',
  'schema_intake',
  'clarification',
  'idea_research',
  'location_research',
  'persona_synthesis',
  'review',
  'ready_to_start',
];

const TARGET_AUDIENCE_OPTIONS = ['Consumers', 'Students', 'Professionals', 'SMBs', 'Enterprises', 'Developers'];
const GOAL_OPTIONS = ['Market Validation', 'Product-Market Fit', 'Growth Strategy', 'Competitive Analysis'];

const formatEta = (seconds?: number, language: 'ar' | 'en' = 'en') => {
  const minutes = Math.max(1, Math.ceil(Math.max(0, Math.round(seconds || 0)) / 60));
  return language === 'ar' ? `${minutes} دقيقة تقريبًا` : `~${minutes} min`;
};

const stageLabel = (stage: string, language: 'ar' | 'en') =>
  STAGE_LABELS[stage]?.[language] || stage.replace(/_/g, ' ');

function ToggleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('guided-chat-toggle-chip', active && 'is-selected')}>
      {label}
    </button>
  );
}

function GuideBubble({
  children,
  kicker,
  tone = 'default',
  wide = false,
}: {
  children: ReactNode;
  kicker?: string | null;
  tone?: 'default' | 'interactive' | 'success' | 'warning' | 'muted';
  wide?: boolean;
}) {
  return (
    <ChatBubble
      className={cn('guided-chat-message', wide && 'guided-chat-message-wide')}
      tone={tone}
      bubbleClassName="guided-chat-bubble"
      kicker={kicker === undefined ? null : kicker}
    >
      {children}
    </ChatBubble>
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
  const [schemaStepIndex, setSchemaStepIndex] = useState(0);
  const [clarificationStepIndex, setClarificationStepIndex] = useState(0);
  const [showCorrectionComposer, setShowCorrectionComposer] = useState(false);

  const currentStage = workflow?.current_stage ?? 'context_scope';
  const stageHistory = workflow?.stage_history ?? [];
  const guideMessages = useMemo(() => {
    const recent = (workflow?.guide_messages ?? []).slice(-6);
    const compact: typeof recent = [];
    for (const message of recent) {
      if (compact.at(-1)?.content === message.content) continue;
      compact.push(message);
    }
    return compact.slice(-2);
  }, [workflow?.guide_messages]);

  const activeClarificationQuestions = (workflow?.clarification_questions ?? []).filter(
    (item) => !(workflow?.clarification_answers || {})[item.id],
  );
  const lastCorrection = workflow?.last_correction ?? null;
  const canResume = workflow?.status === 'paused';
  const coachEvidenceMessageIds = (coachIntervention?.agentCitations || [])
    .map((item) => item.messageId)
    .filter(Boolean) as string[];

  const progressSteps = useMemo<ChatProgressStep[]>(() => {
    const byStage = new Map(stageHistory.map((item) => [item.stage, item.status]));
    return DEFAULT_STAGE_ORDER.filter(
      (stage) => stage !== 'location_research' || draftInput.contextScope === 'specific_place',
    ).map((stage) => ({
      key: stage,
      label: stageLabel(stage, language),
      state:
        byStage.get(stage) === 'completed' || byStage.get(stage) === 'ready'
          ? 'completed'
          : currentStage === stage
            ? 'current'
            : 'upcoming',
    }));
  }, [currentStage, draftInput.contextScope, language, stageHistory]);

  const schemaSteps = useMemo(() => {
    const steps: Array<{
      key: string;
      title: string;
      hint?: string;
      ready: boolean;
      render: () => ReactNode;
    }> = [];

    const needs = new Set(
      workflow?.required_fields?.length
        ? workflow.required_fields
        : ['idea', 'category', 'targetAudience', 'goals'],
    );

    if (needs.has('idea')) {
      steps.push({
        key: 'idea',
        title: language === 'ar' ? 'ما الفكرة الأساسية؟' : 'What is the core idea?',
        hint:
          language === 'ar'
            ? 'اكتبها في جملة واحدة واضحة.'
            : 'Describe it in one clear sentence.',
        ready: draftInput.idea.trim().length > 0,
        render: () => (
          <Textarea
            value={draftInput.idea}
            onChange={(event) => onDraftChange({ idea: event.target.value })}
            className="min-h-[96px]"
            placeholder={
              language === 'ar'
                ? 'مثال: مطعم كريب سريع يخدم العاملين وقت الزحمة.'
                : 'Example: A fast crepe shop for busy commuters.'
            }
          />
        ),
      });
    }

    if (needs.has('category')) {
      steps.push({
        key: 'category',
        title: language === 'ar' ? 'ما الفئة الأنسب للفكرة؟' : 'What category fits the idea?',
        ready: draftInput.category.trim().length > 0,
        render: () => (
          <Input
            value={draftInput.category}
            onChange={(event) => onDraftChange({ category: event.target.value })}
            placeholder={
              language === 'ar' ? 'مثال: Food, E-commerce, SaaS' : 'Example: Food, E-commerce, SaaS'
            }
          />
        ),
      });
    }

    if (draftInput.contextScope === 'specific_place') {
      if (needs.has('city') || needs.has('placeName')) {
        steps.push({
          key: 'place',
          title:
            language === 'ar'
              ? 'ما المدينة أو المكان المستهدف؟'
              : 'What city or place are you targeting?',
          ready: Boolean((draftInput.city || draftInput.placeName || '').trim()),
          render: () => (
            <Input
              value={draftInput.city || draftInput.placeName}
              onChange={(event) =>
                onDraftChange({ city: event.target.value, placeName: event.target.value })
              }
              placeholder={language === 'ar' ? 'مثال: Alexandria' : 'Example: Alexandria'}
            />
          ),
        });
      }

      if (needs.has('country')) {
        steps.push({
          key: 'country',
          title: language === 'ar' ? 'ما الدولة؟' : 'What country is this in?',
          ready: draftInput.country.trim().length > 0,
          render: () => (
            <Input
              value={draftInput.country}
              onChange={(event) => onDraftChange({ country: event.target.value })}
              placeholder={language === 'ar' ? 'مثال: Egypt' : 'Example: Egypt'}
            />
          ),
        });
      }
    }

    if (needs.has('targetAudience')) {
      steps.push({
        key: 'targetAudience',
        title:
          language === 'ar'
            ? 'من الجمهور المستهدف أولًا؟'
            : 'Who is the primary target audience?',
        hint: language === 'ar' ? 'اختر شريحة أو أكثر.' : 'Choose one or more segments.',
        ready: draftInput.targetAudience.length > 0,
        render: () => (
          <div className="guided-chat-toggle-row">
            {TARGET_AUDIENCE_OPTIONS.map((item) => (
              <ToggleChip
                key={item}
                label={item}
                active={draftInput.targetAudience.includes(item)}
                onClick={() =>
                  onDraftChange({
                    targetAudience: draftInput.targetAudience.includes(item)
                      ? draftInput.targetAudience.filter((entry) => entry !== item)
                      : [...draftInput.targetAudience, item],
                  })
                }
              />
            ))}
          </div>
        ),
      });
    }

    if (needs.has('goals')) {
      steps.push({
        key: 'goals',
        title:
          language === 'ar'
            ? 'ما هدفك من هذه المحاكاة؟'
            : 'What do you want from this simulation?',
        hint:
          language === 'ar'
            ? 'اختر ما تريد أن تركز عليه.'
            : 'Pick what you want to optimize for.',
        ready: draftInput.goals.length > 0,
        render: () => (
          <div className="guided-chat-toggle-row">
            {GOAL_OPTIONS.map((goal) => (
              <ToggleChip
                key={goal}
                label={goal}
                active={draftInput.goals.includes(goal)}
                onClick={() =>
                  onDraftChange({
                    goals: draftInput.goals.includes(goal)
                      ? draftInput.goals.filter((entry) => entry !== goal)
                      : [...draftInput.goals, goal],
                  })
                }
              />
            ))}
          </div>
        ),
      });
    }

    return steps;
  }, [
    draftInput.category,
    draftInput.city,
    draftInput.contextScope,
    draftInput.country,
    draftInput.goals,
    draftInput.idea,
    draftInput.placeName,
    draftInput.targetAudience,
    language,
    onDraftChange,
    workflow?.required_fields,
  ]);

  const activeSchemaStep = schemaSteps[Math.min(schemaStepIndex, Math.max(schemaSteps.length - 1, 0))];
  const activeClarificationQuestion =
    activeClarificationQuestions[
      Math.min(clarificationStepIndex, Math.max(activeClarificationQuestions.length - 1, 0))
    ];

  useEffect(() => {
    setSchemaStepIndex(0);
  }, [currentStage, workflow?.required_fields?.join('|'), draftInput.contextScope]);

  useEffect(() => {
    setClarificationStepIndex(0);
  }, [currentStage, activeClarificationQuestions.length]);

  const submitClarifications = () => {
    const answers = activeClarificationQuestions
      .map((question) => ({
        questionId: question.id,
        answer: clarificationAnswers[question.id]?.trim() || '',
      }))
      .filter((item) => item.answer);

    if (answers.length) {
      onSubmitClarifications(answers);
    }
  };

  const submitCorrection = () => {
    const text = correctionText.trim();
    if (!text) return;
    onSubmitCorrection(text);
    setCorrectionText('');
    setShowCorrectionComposer(false);
  };

  const submitCoachCustomFix = () => {
    const text = coachCustomFixText.trim();
    if (!text || !onCoachCustomFix) return;
    onCoachCustomFix(text);
    setCoachCustomFixText('');
  };

  return (
    <ChatShell className="guided-chat-shell">
      <ChatTopProgress
        steps={progressSteps}
        headline={
          language === 'ar'
            ? `نحن الآن في: ${stageLabel(currentStage, language)}`
            : `Now in: ${stageLabel(currentStage, language)}`
        }
        detail={`${language === 'ar' ? 'المرحلة الحالية' : 'Current'}: ${stageLabel(currentStage, language)} • ${language === 'ar' ? 'المتبقي' : 'ETA'}: ${formatEta(workflow?.estimated_total_seconds, language)}`}
      />

      <div className="messages-container guided-chat-thread">
        {workflow?.verification ? (
          <div className="guided-chat-inline-note">
            <ShieldCheck className="h-3.5 w-3.5" />
            {workflow.verification.ok
              ? language === 'ar'
                ? 'التحقق ناجح'
                : 'Verification passed'
              : language === 'ar'
                ? 'يحتاج مراجعة'
                : 'Needs review'}
          </div>
        ) : null}

        <div className="guided-chat-identity">
          <div className="guided-chat-avatar" aria-hidden="true">
            <span className="guided-chat-avatar-face">
              <span className="guided-chat-avatar-eye" />
              <span className="guided-chat-avatar-eye" />
            </span>
          </div>
          <div className="guided-chat-identity-copy">
            <div className="guided-chat-identity-title">GuideAgent</div>
            <div className="guided-chat-identity-subtitle">
              {language === 'ar' ? 'دليل المحاكاة' : 'Simulation guide'}
            </div>
          </div>
        </div>

        {guideMessages.map((message) => (
          <GuideBubble key={message.id} kicker={null}>
            <div className="guided-chat-secondary-copy">{message.content}</div>
          </GuideBubble>
        ))}

        {coachIntervention ? (
          <>
            <GuideBubble tone="warning" kicker={language === 'ar' ? 'المدرب الفوري' : 'Coach'}>
              <div className="space-y-2">
                <div className="guided-chat-message-title">{coachIntervention.blockerSummary}</div>
                {coachIntervention.guideMessage ? (
                  <div className="guided-chat-secondary-copy">{coachIntervention.guideMessage}</div>
                ) : null}
                <div className="guided-chat-meta-row">
                  <span className="guided-chat-mini-chip">
                    {language === 'ar' ? 'الحدة' : 'Severity'}: {coachIntervention.severity}
                  </span>
                  {coachIntervention.decisionAxis ? (
                    <span className="guided-chat-mini-chip">
                      {coachIntervention.decisionAxis}
                    </span>
                  ) : null}
                </div>
              </div>
            </GuideBubble>

            {coachIntervention.agentCitations.slice(0, 2).map((item) => (
              <GuideBubble
                key={item.id}
                tone="muted"
                kicker={item.agentLabel || (language === 'ar' ? 'وكيل' : 'Agent')}
              >
                <div className="guided-chat-secondary-copy">{item.quote}</div>
              </GuideBubble>
            ))}

            {coachIntervention.researchEvidence.slice(0, 1).map((item) => (
              <GuideBubble
                key={item.id}
                tone="muted"
                kicker={item.label || (language === 'ar' ? 'بحث' : 'Research')}
              >
                <div className="guided-chat-secondary-copy">{item.quote}</div>
              </GuideBubble>
            ))}

            {coachEvidenceMessageIds.length && onOpenCoachEvidence ? (
              <GuideBubble tone="muted" kicker={null}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenCoachEvidence(coachEvidenceMessageIds)}
                  className="guided-chat-button"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  {language === 'ar' ? 'افتح تبويب التفكير' : 'Open reasoning tab'}
                </Button>
              </GuideBubble>
            ) : null}

            {coachIntervention.suggestions.slice(0, 5).map((suggestion) => (
              <GuideBubble key={suggestion.suggestionId} tone="interactive">
                <div className="space-y-2">
                  <div className="guided-chat-message-title">{suggestion.title}</div>
                  <div className="guided-chat-secondary-copy">{suggestion.oneLiner}</div>
                  {suggestion.tradeoff ? (
                    <div className="guided-chat-tertiary-copy">
                      {language === 'ar' ? 'المقابل:' : 'Tradeoff:'} {suggestion.tradeoff}
                    </div>
                  ) : null}
                  {onCoachApplySuggestion ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onCoachApplySuggestion(suggestion.suggestionId)}
                      disabled={coachBusy}
                      className="guided-chat-button guided-chat-button-primary"
                    >
                      {suggestion.ctaLabel ||
                        (language === 'ar' ? 'اعتمد وأعد التشغيل' : 'Apply')}
                    </Button>
                  ) : null}
                </div>
              </GuideBubble>
            ))}

            {onCoachRequestMoreIdeas || onCoachContinueWithoutChange ? (
              <GuideBubble tone="muted" kicker={null}>
                <ChatActionRow className="guided-chat-actions">
                  {onCoachRequestMoreIdeas ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onCoachRequestMoreIdeas}
                      disabled={coachBusy}
                      className="guided-chat-button"
                    >
                      {language === 'ar' ? 'أفكار أخرى' : 'More ideas'}
                    </Button>
                  ) : null}
                  {onCoachContinueWithoutChange ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onCoachContinueWithoutChange}
                      disabled={coachBusy}
                      className="guided-chat-button"
                    >
                      {language === 'ar' ? 'كمّل' : 'Continue'}
                    </Button>
                  ) : null}
                </ChatActionRow>
              </GuideBubble>
            ) : null}

            {onCoachCustomFix ? (
              <GuideBubble tone="muted" wide kicker={null}>
                <div className="space-y-3">
                  <div className="guided-chat-secondary-copy">
                    {language === 'ar'
                      ? 'لو عندك تعديل واقعي محدد اكتبه هنا.'
                      : 'If you have a concrete factual fix, write it here.'}
                  </div>
                  <Textarea
                    value={coachCustomFixText}
                    onChange={(event) => setCoachCustomFixText(event.target.value)}
                    className="min-h-[84px] bg-background/20"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={submitCoachCustomFix}
                    disabled={coachBusy || !coachCustomFixText.trim()}
                    className="guided-chat-button"
                  >
                    {language === 'ar' ? 'فلتره' : 'Filter it'}
                  </Button>
                </div>
              </GuideBubble>
            ) : null}

            {coachIntervention.patchPreview ? (
              <GuideBubble tone="success" wide kicker={null}>
                <div className="space-y-3">
                  <div className="guided-chat-secondary-copy">
                    {coachIntervention.patchPreview.guideMessage}
                  </div>
                  <div className="guided-chat-mini-chip">
                    {language === 'ar' ? 'الإعادة من' : 'Rerun from'}:{' '}
                    {coachIntervention.patchPreview.rerunFromStage}
                  </div>
                  {Object.entries(coachIntervention.patchPreview.contextPatch || {}).map(
                    ([key, value]) => (
                      <div key={key} className="guided-chat-patch-row">
                        <div className="guided-chat-quote-label">{key}</div>
                        <div className="guided-chat-quote-body">
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </div>
                      </div>
                    ),
                  )}
                  {onCoachConfirmRerun ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onCoachConfirmRerun}
                      disabled={coachBusy}
                      className="guided-chat-button guided-chat-button-primary"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {language === 'ar' ? 'اعتمد وأعد التشغيل' : 'Confirm rerun'}
                    </Button>
                  ) : null}
                </div>
              </GuideBubble>
            ) : null}
          </>
        ) : null}

        {debateReady ? (
          <GuideBubble tone="warning" kicker={null}>
            <div className="space-y-2">
              <div className="guided-chat-secondary-copy">
                {workflow?.simulation?.debate_session?.message ||
                  (language === 'ar'
                    ? 'الوكلاء بدأوا يتناقشوا. افتح تبويب التفكير إذا أردت المتابعة.'
                    : 'Agents started debating. Open the reasoning tab if you want to watch.')}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={onOpenReasoning}
                className="guided-chat-button guided-chat-button-primary"
              >
                <Eye className="mr-2 h-4 w-4" />
                {language === 'ar' ? 'افتح التفكير' : 'Open reasoning'}
              </Button>
            </div>
          </GuideBubble>
        ) : null}

        {currentStage === 'context_scope' ? (
          <>
            <GuideBubble kicker={null}>
              <div className="guided-chat-message-title">
                {language === 'ar' ? 'اختر نوع السياق أولًا' : 'Choose the context scope first'}
              </div>
            </GuideBubble>
            <GuideBubble tone="interactive" wide kicker={null}>
              <div className="guided-chat-choice-list">
                {(workflow?.context_options ?? []).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onChooseScope(option.id)}
                    className={cn(
                      'guided-chat-choice-button',
                      draftInput.contextScope === option.id && 'is-selected',
                    )}
                  >
                    <span className="font-semibold">{option.label}</span>
                    <span className="guided-chat-choice-copy">{option.description}</span>
                  </button>
                ))}
              </div>
            </GuideBubble>
          </>
        ) : null}

        {currentStage === 'schema_intake' ? (
          <>
            <GuideBubble kicker={null}>
              <div className="guided-chat-message-title">
                {language === 'ar' ? 'اجمع فقط الحقول الناقصة' : 'Collect only missing fields'}
              </div>
              <div className="guided-chat-secondary-copy">
                {language === 'ar'
                  ? 'لن نكرر ما هو موجود بالفعل.'
                  : 'We will not repeat what is already known.'}
              </div>
            </GuideBubble>

            <GuideBubble tone="interactive" wide kicker={null}>
              <div className="guided-chat-form">
                {schemaSteps.length > 0 && activeSchemaStep ? (
                  <>
                    <div className="guided-chat-step-indicator">
                      {language === 'ar' ? 'سؤال' : 'Step'}{' '}
                      {Math.min(schemaStepIndex + 1, schemaSteps.length)} / {schemaSteps.length}
                    </div>
                    <div className="guided-chat-field">
                      <label className="guided-chat-field-label">{activeSchemaStep.title}</label>
                      {activeSchemaStep.hint ? (
                        <div className="guided-chat-tertiary-copy">{activeSchemaStep.hint}</div>
                      ) : null}
                      {activeSchemaStep.render()}
                    </div>
                    <div className="guided-chat-tertiary-copy">
                      {workflow?.required_fields?.length
                        ? `${language === 'ar' ? 'المطلوب الآن:' : 'Required now:'} ${workflow.required_fields.join(', ')}`
                        : language === 'ar'
                          ? 'كل الحقول المطلوبة جاهزة.'
                          : 'All required fields are ready.'}
                    </div>
                    <ChatActionRow className="guided-chat-actions">
                      {schemaStepIndex > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setSchemaStepIndex((current) => Math.max(0, current - 1))}
                          className="guided-chat-button"
                        >
                          {language === 'ar' ? 'السابق' : 'Previous'}
                        </Button>
                      ) : null}

                      {schemaStepIndex < schemaSteps.length - 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            setSchemaStepIndex((current) =>
                              Math.min(schemaSteps.length - 1, current + 1),
                            )
                          }
                          disabled={!activeSchemaStep.ready}
                          className="guided-chat-button guided-chat-button-primary"
                        >
                          <ArrowRight className="mr-2 h-4 w-4" />
                          {language === 'ar' ? 'التالي' : 'Next'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={onSubmitSchema}
                          disabled={loading || !activeSchemaStep.ready}
                          className="guided-chat-button guided-chat-button-primary"
                        >
                          <ArrowRight className="mr-2 h-4 w-4" />
                          {language === 'ar' ? 'أرسل الحقول' : 'Submit fields'}
                        </Button>
                      )}

                      {onOpenConfig ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={onOpenConfig}
                          className="guided-chat-button"
                        >
                          {language === 'ar' ? 'افتح الإعدادات' : 'Open config'}
                        </Button>
                      ) : null}
                    </ChatActionRow>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="guided-chat-secondary-copy">
                      {language === 'ar'
                        ? 'لا توجد حقول ناقصة الآن. يمكنك المتابعة أو فتح الإعدادات للمراجعة.'
                        : 'No missing fields right now. You can continue or open config to review.'}
                    </div>
                    <ChatActionRow className="guided-chat-actions">
                      <Button
                        type="button"
                        size="sm"
                        onClick={onSubmitSchema}
                        disabled={loading}
                        className="guided-chat-button guided-chat-button-primary"
                      >
                        <ArrowRight className="mr-2 h-4 w-4" />
                        {language === 'ar' ? 'تابع' : 'Continue'}
                      </Button>
                      {onOpenConfig ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={onOpenConfig}
                          className="guided-chat-button"
                        >
                          {language === 'ar' ? 'افتح الإعدادات' : 'Open config'}
                        </Button>
                      ) : null}
                    </ChatActionRow>
                  </div>
                )}
              </div>
            </GuideBubble>
          </>
        ) : null}

        {currentStage === 'clarification' ? (
          <>
            <GuideBubble kicker={null}>
              <div className="guided-chat-message-title">
                {language === 'ar' ? 'نحتاج توضيحًا صغيرًا' : 'A small clarification is needed'}
              </div>
              <div className="guided-chat-secondary-copy">
                {language === 'ar'
                  ? 'أجب فقط على ما هو غير واضح.'
                  : 'Answer only what is still ambiguous.'}
              </div>
            </GuideBubble>

            {activeClarificationQuestion ? (
              <>
                <GuideBubble tone="interactive" wide kicker={null}>
                  <div className="space-y-3">
                    <div className="guided-chat-step-indicator">
                      {language === 'ar' ? 'سؤال' : 'Question'}{' '}
                      {Math.min(clarificationStepIndex + 1, activeClarificationQuestions.length)} /{' '}
                      {activeClarificationQuestions.length}
                    </div>
                    <div className="guided-chat-secondary-copy text-foreground">
                      {activeClarificationQuestion.prompt}
                    </div>
                    {activeClarificationQuestion.reason ? (
                      <div className="guided-chat-tertiary-copy">
                        {activeClarificationQuestion.reason}
                      </div>
                    ) : null}
                    <Textarea
                      className="min-h-[84px]"
                      value={clarificationAnswers[activeClarificationQuestion.id] || ''}
                      onChange={(event) =>
                        setClarificationAnswers((prev) => ({
                          ...prev,
                          [activeClarificationQuestion.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                </GuideBubble>

                <GuideBubble tone="muted" kicker={null}>
                  <ChatActionRow className="guided-chat-actions">
                    {clarificationStepIndex > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setClarificationStepIndex((current) => Math.max(0, current - 1))
                        }
                        className="guided-chat-button"
                      >
                        {language === 'ar' ? 'السابق' : 'Previous'}
                      </Button>
                    ) : null}

                    {clarificationStepIndex < activeClarificationQuestions.length - 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          setClarificationStepIndex((current) =>
                            Math.min(activeClarificationQuestions.length - 1, current + 1),
                          )
                        }
                        disabled={!(clarificationAnswers[activeClarificationQuestion.id] || '').trim()}
                        className="guided-chat-button guided-chat-button-primary"
                      >
                        <ArrowRight className="mr-2 h-4 w-4" />
                        {language === 'ar' ? 'التالي' : 'Next'}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={submitClarifications}
                        disabled={
                          loading || !(clarificationAnswers[activeClarificationQuestion.id] || '').trim()
                        }
                        className="guided-chat-button guided-chat-button-primary"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {language === 'ar' ? 'أرسل الإجابات' : 'Send answers'}
                      </Button>
                    )}
                  </ChatActionRow>
                </GuideBubble>
              </>
            ) : null}
          </>
        ) : null}

        {(currentStage === 'review' || currentStage === 'ready_to_start') && workflow?.review ? (
          <>
            <GuideBubble kicker={null}>
              <div className="guided-chat-message-title">
                {workflow.review.title ||
                  (language === 'ar' ? 'مراجعة قبل البدء' : 'Review before launch')}
              </div>
              <div className="guided-chat-secondary-copy">{workflow.review.summary}</div>
            </GuideBubble>

            <GuideBubble tone="success" wide kicker={null}>
              <div className="space-y-3">
                <div className="guided-chat-mini-chip">
                  {language === 'ar' ? 'الوقت المتوقع' : 'Estimated runtime'}:{' '}
                  {formatEta(workflow.review.estimated_runtime_seconds, language)}
                </div>
                {(workflow.review.research_highlights || []).slice(0, 3).map((item) => (
                  <div key={item} className="guided-chat-quote guided-chat-quote-muted">
                    <div className="guided-chat-quote-body">{item}</div>
                  </div>
                ))}
                {workflow.review.location_summary ? (
                  <div className="guided-chat-quote guided-chat-quote-muted">
                    <div className="guided-chat-quote-body">{workflow.review.location_summary}</div>
                  </div>
                ) : null}
                {(workflow.persona_snapshot?.personas || []).slice(0, 2).map((persona) => (
                  <div key={persona.id} className="guided-chat-quote">
                    <div className="guided-chat-quote-label">{persona.label}</div>
                    <div className="guided-chat-quote-body">{persona.summary}</div>
                  </div>
                ))}
                <ChatActionRow className="guided-chat-actions">
                  {currentStage === 'review' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onApproveReview}
                      disabled={loading}
                      className="guided-chat-button"
                    >
                      {language === 'ar' ? 'اعتمد المراجعة' : 'Approve review'}
                    </Button>
                  ) : null}
                  {currentStage === 'ready_to_start' ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onStartSimulation}
                      disabled={loading || simulationStatus === 'running'}
                      className="guided-chat-button guided-chat-button-primary"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {language === 'ar' ? 'تابع إلى المحاكاة' : 'Continue to simulation'}
                    </Button>
                  ) : null}
                </ChatActionRow>
              </div>
            </GuideBubble>
          </>
        ) : null}
      </div>

      <div className="guided-chat-footer">
        <ChatActionRow className="guided-chat-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={canResume ? onResumeWorkflow : onPauseWorkflow}
            disabled={loading}
            className="guided-chat-button"
          >
            {canResume ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
            {canResume ? (language === 'ar' ? 'استكمل' : 'Resume') : language === 'ar' ? 'أوقف' : 'Pause'}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenReasoning}
            className="guided-chat-button"
          >
            <Eye className="mr-2 h-4 w-4" />
            {language === 'ar' ? `التفكير (${reasoningCount})` : `Reasoning (${reasoningCount})`}
          </Button>

          <Button
            type="button"
            size="sm"
            variant={showCorrectionComposer ? 'default' : 'outline'}
            onClick={() => setShowCorrectionComposer((current) => !current)}
            className={cn('guided-chat-button', showCorrectionComposer && 'guided-chat-button-primary')}
          >
            {language === 'ar' ? 'تصحيح' : 'Correction'}
          </Button>

          {onApplyCorrectionToSimulation &&
          lastCorrection?.apply_mode === 'factual_update' &&
          simulationStatus !== 'idle' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onApplyCorrectionToSimulation}
              className="guided-chat-button"
            >
              {language === 'ar' ? 'أعد التشغيل' : 'Rerun'}
            </Button>
          ) : null}
        </ChatActionRow>

        {workflow?.pause_reason || lastCorrection?.neutralized_text ? (
          <div className="guided-footer-note">
            {workflow?.pause_reason ? <div>{workflow.pause_reason}</div> : null}
            {lastCorrection?.neutralized_text ? (
              <div className="guided-chat-tertiary-copy">
                <span className="font-semibold">
                  {language === 'ar' ? 'آخر تصحيح:' : 'Last correction:'}
                </span>{' '}
                {lastCorrection.neutralized_text}
              </div>
            ) : null}
          </div>
        ) : null}

        {showCorrectionComposer ? (
          <div className="guided-footer-composer">
            <Textarea
              value={correctionText}
              onChange={(event) => setCorrectionText(event.target.value)}
              className="min-h-[88px]"
              placeholder={
                language === 'ar'
                  ? 'مثال: city is Alexandria, target audience is SMBs'
                  : 'Example: city is Alexandria, target audience is SMBs'
              }
            />
            <ChatActionRow className="guided-chat-actions">
              <Button
                type="button"
                size="sm"
                onClick={submitCorrection}
                disabled={loading || !correctionText.trim()}
                className="guided-chat-button guided-chat-button-primary"
              >
                {language === 'ar' ? 'طبّق التصحيح' : 'Apply correction'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowCorrectionComposer(false);
                  setCorrectionText('');
                }}
                className="guided-chat-button"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
            </ChatActionRow>
          </div>
        ) : null}
      </div>
    </ChatShell>
  );
}

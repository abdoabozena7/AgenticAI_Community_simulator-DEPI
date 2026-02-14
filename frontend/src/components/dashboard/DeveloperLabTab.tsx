import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Beaker, CheckCircle2, Gauge, Search, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiService, type DevLabSuiteCase, type DevLabSuiteStateResponse } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const buildDefaultCases = (isArabic: boolean): DevLabSuiteCase[] => {
  if (isArabic) {
    return [
      {
        key: 'good_idea',
        title: 'فكرة ممتازة',
        idea: 'تطبيق ذكي لاكتشاف تسريب المياه عبر حساسات IoT مع تنبيهات فورية وتقارير توفير.',
        expected: { accept_min: 0.55, neutral_max: 0.3 },
      },
      {
        key: 'bad_idea',
        title: 'فكرة خطرة',
        idea: 'نظام يراقب الرسائل الخاصة وGPS ويمنع المتقدمين للعمل خمس سنوات تلقائيًا.',
        expected: { reject_min: 0.7, accept_max: 0.1, neutral_max: 0.3 },
      },
      {
        key: 'ambiguous_idea',
        title: 'فكرة غامضة',
        idea: 'منصة ذكاء اصطناعي لتحسين التوظيف بدون نطاق واضح أو معايير قرار محددة.',
        expected: { clarification_min: 1, neutral_max: 0.3 },
      },
    ];
  }

  return [
    {
      key: 'good_idea',
      title: 'Great idea',
      idea: 'IoT water leak detection with instant alerts and monthly savings reports.',
      expected: { accept_min: 0.55, neutral_max: 0.3 },
    },
    {
      key: 'bad_idea',
      title: 'Harmful idea',
      idea: 'A system that reads private chats and GPS data to auto-ban job applicants for five years.',
      expected: { reject_min: 0.7, accept_max: 0.1, neutral_max: 0.3 },
    },
    {
      key: 'ambiguous_idea',
      title: 'Ambiguous idea',
      idea: 'An AI hiring platform with no clear target segment or decision constraints.',
      expected: { clarification_min: 1, neutral_max: 0.3 },
    },
  ];
};

export default function DeveloperLabTab() {
  const { language, isRTL } = useLanguage();
  const t = (en: string, ar: string) => (language === 'ar' ? ar : en);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<any | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [llmPrompt, setLlmPrompt] = useState('');
  const [llmSystem, setLlmSystem] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmResult, setLlmResult] = useState<any | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  const [agentCount, setAgentCount] = useState(20);
  const [iterations, setIterations] = useState(4);
  const [neutralCapPct, setNeutralCapPct] = useState(30);
  const [suiteCases, setSuiteCases] = useState<DevLabSuiteCase[]>(() => buildDefaultCases(language === 'ar'));
  const [suiteLoading, setSuiteLoading] = useState(false);
  const [suiteId, setSuiteId] = useState<string | null>(null);
  const [suiteState, setSuiteState] = useState<DevLabSuiteStateResponse | null>(null);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [suiteHistory, setSuiteHistory] = useState<Array<{ suite_id: string; status: string; created_at?: string }>>([]);

  const getCaseStatusMeta = (status?: string, pass?: boolean | null) => {
    const normalized = String(status || 'pending').toLowerCase();
    if (pass === true || normalized === 'completed') {
      return {
        label: t('Completed', 'مكتمل'),
        variant: 'outline' as const,
      };
    }
    if (normalized === 'failed') {
      return {
        label: t('Failed', 'فشل'),
        variant: 'destructive' as const,
      };
    }
    if (normalized === 'running') {
      return {
        label: t('Running', 'جارٍ'),
        variant: 'secondary' as const,
      };
    }
    return {
      label: t('Pending', 'قيد الانتظار'),
      variant: 'secondary' as const,
    };
  };

  useEffect(() => {
    setSuiteCases(buildDefaultCases(language === 'ar'));
  }, [language]);

  const loadSuiteState = async (id: string) => {
    const state = await apiService.getDevlabReasoningSuiteState(id);
    setSuiteState(state);
    return state;
  };

  const loadSuiteHistory = async () => {
    try {
      const list = await apiService.listDevlabReasoningSuites(15, 0);
      setSuiteHistory(list.items || []);
    } catch {
      // ignore history fetch failure in UI
    }
  };

  useEffect(() => {
    loadSuiteHistory();
  }, []);

  useEffect(() => {
    if (!suiteId) return;
    let active = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const state = await loadSuiteState(suiteId);
        if (!active) return;
        if (state.status === 'running') {
          timer = window.setTimeout(tick, 2000);
        } else {
          await loadSuiteHistory();
        }
      } catch (err: any) {
        if (!active) return;
        setSuiteError(err?.message || t('Failed to refresh suite state.', 'فشل تحديث حالة الاختبار.'));
      }
    };

    tick();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [suiteId]);

  const checklist = useMemo(() => {
    const cases = suiteState?.cases || [];
    const hasClarification = cases.some((item) => Number((item.actual || {}).clarification_count || 0) > 0);
    const neutralLimit = Math.ceil(agentCount * (neutralCapPct / 100));
    const neutralCheck = cases.every((item) => Number((item.actual || {}).neutral || 0) <= neutralLimit);
    const fallbackCheck = cases.every((item) => Number((item.actual || {}).fallback_ratio || 0) <= 0.4);
    return [
      { label: t('Search strict mode active', 'وضع البحث الصارم مفعّل'), pass: Boolean(searchResult?.strict_mode) },
      { label: t('Clarification triggered when needed', 'تم تشغيل التوضيح عند الحاجة'), pass: hasClarification },
      { label: t('Neutral <= target cap', 'الحياد أقل من الحد المطلوب'), pass: neutralCheck },
      { label: t('Fallback ratio in acceptable range', 'نسبة fallback ضمن النطاق المقبول'), pass: fallbackCheck },
      { label: t('Arabic encoding healthy', 'سلامة ترميز العربية'), pass: !Boolean(llmResult?.mojibake_detected) },
    ];
  }, [suiteState, searchResult, llmResult, neutralCapPct, agentCount, language]);

  const runSearchTest = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const result = await apiService.devlabSearchTest({
        query: searchQuery.trim(),
        language: language as 'ar' | 'en',
        max_results: 6,
      });
      setSearchResult(result);
    } catch (err: any) {
      setSearchError(err?.message || t('Search test failed.', 'فشل اختبار البحث.'));
    } finally {
      setSearchLoading(false);
    }
  };

  const runLlmTest = async () => {
    if (!llmPrompt.trim()) return;
    setLlmLoading(true);
    setLlmError(null);
    try {
      const result = await apiService.devlabLlmTest({
        prompt: llmPrompt.trim(),
        system: llmSystem.trim() || undefined,
        language: language as 'ar' | 'en',
      });
      setLlmResult(result);
    } catch (err: any) {
      setLlmError(err?.message || t('LLM test failed.', 'فشل اختبار النموذج.'));
    } finally {
      setLlmLoading(false);
    }
  };

  const runSuite = async () => {
    setSuiteLoading(true);
    setSuiteError(null);
    try {
      const response = await apiService.startDevlabReasoningSuite({
        language: language as 'ar' | 'en',
        agent_count: agentCount,
        iterations,
        neutral_cap_pct: Math.max(5, Math.min(70, neutralCapPct)) / 100,
        cases: suiteCases,
      });
      setSuiteId(response.suite_id);
      await loadSuiteState(response.suite_id);
    } catch (err: any) {
      setSuiteError(err?.message || t('Failed to start reasoning suite.', 'فشل تشغيل حزمة الاختبارات.'));
    } finally {
      setSuiteLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
          <Beaker className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{t('Developer Lab', 'مختبر المطور')}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'Test search, LLM and multi-idea reasoning quality from one place.',
              'اختبر البحث والنموذج وجودة الاستدلال متعدد الأفكار من مكان واحد.'
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="liquid-glass rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 font-semibold">
            <Search className="w-4 h-4" />
            {t('Search Playground', 'اختبار البحث')}
          </div>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Type query...', 'اكتب الاستعلام...')}
          />
          <Button onClick={runSearchTest} disabled={searchLoading || !searchQuery.trim()}>
            {searchLoading ? t('Running...', 'جارٍ التنفيذ...') : t('Run Search Test', 'تشغيل اختبار البحث')}
          </Button>
          {searchError && <p className="text-sm text-rose-300">{searchError}</p>}
          {searchResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{`${t('Latency', 'الزمن')}: ${searchResult.latency_ms}ms`}</Badge>
                <Badge variant="outline">{`usable: ${searchResult.quality?.usable_sources ?? 0}`}</Badge>
                <Badge variant="outline">{`domains: ${searchResult.quality?.domains ?? 0}`}</Badge>
              </div>
              <div className="space-y-2 max-h-56 overflow-auto pr-1">
                {(searchResult.results || []).map((item: any, idx: number) => {
                  const domain = item.domain || '';
                  const favicon = domain
                    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
                    : '';
                  return (
                    <div key={`${item.url}-${idx}`} className="rounded-xl border border-border/50 p-3">
                      <div className={`flex items-center gap-2 text-sm font-medium ${isRTL ? 'flex-row-reverse text-right' : ''}`}>
                        {favicon && <img src={favicon} alt={domain} className="w-4 h-4 rounded-sm" />}
                        <span className="truncate">{item.title || item.url}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 break-all">{item.url}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="liquid-glass rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="w-4 h-4" />
            {t('LLM Playground', 'اختبار النموذج')}
          </div>
          <Textarea
            value={llmPrompt}
            onChange={(e) => setLlmPrompt(e.target.value)}
            placeholder={t('Prompt...', 'اكتب البرومبت...')}
            className="min-h-24"
          />
          <Textarea
            value={llmSystem}
            onChange={(e) => setLlmSystem(e.target.value)}
            placeholder={t('Optional system prompt...', 'تعليمات النظام (اختياري)...')}
            className="min-h-16"
          />
          <Button onClick={runLlmTest} disabled={llmLoading || !llmPrompt.trim()}>
            {llmLoading ? t('Running...', 'جارٍ التنفيذ...') : t('Run LLM Test', 'تشغيل اختبار النموذج')}
          </Button>
          {llmError && <p className="text-sm text-rose-300">{llmError}</p>}
          {llmResult && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{`${t('Latency', 'الزمن')}: ${llmResult.latency_ms}ms`}</Badge>
                <Badge variant={llmResult.mojibake_detected ? 'destructive' : 'outline'}>
                  {llmResult.mojibake_detected
                    ? t('Encoding issue detected', 'تم اكتشاف مشكلة ترميز')
                    : t('Encoding OK', 'الترميز سليم')}
                </Badge>
              </div>
              <div className="rounded-xl border border-border/50 p-3 text-sm whitespace-pre-wrap max-h-56 overflow-auto">
                {llmResult.text}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="liquid-glass rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Gauge className="w-4 h-4" />
          {t('Reasoning Suite', 'حزمة اختبارات الاستدلال')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            type="number"
            value={agentCount}
            onChange={(e) => setAgentCount(Math.max(6, Math.min(500, Number(e.target.value) || 20)))}
          />
          <Input
            type="number"
            value={iterations}
            onChange={(e) => setIterations(Math.max(1, Math.min(12, Number(e.target.value) || 4)))}
          />
          <Input
            type="number"
            value={neutralCapPct}
            onChange={(e) => setNeutralCapPct(Math.max(5, Math.min(70, Number(e.target.value) || 30)))}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {suiteCases.map((item, idx) => (
            <div key={item.key} className="rounded-xl border border-border/50 p-3 space-y-2">
              <p className="text-sm font-medium">{item.title}</p>
              <Textarea
                value={item.idea}
                onChange={(e) => {
                  const next = [...suiteCases];
                  next[idx] = { ...next[idx], idea: e.target.value };
                  setSuiteCases(next);
                }}
                className="min-h-28"
              />
            </div>
          ))}
        </div>
        <Button onClick={runSuite} disabled={suiteLoading}>
          {suiteLoading ? t('Starting...', 'جارٍ البدء...') : t('Run Reasoning Suite', 'تشغيل حزمة الاختبارات')}
        </Button>
        {suiteError && <p className="text-sm text-rose-300">{suiteError}</p>}
        {suiteState && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="outline">{`Suite: ${suiteState.suite_id.slice(0, 8)}`}</Badge>
              <Badge variant="outline">{`${t('Progress', 'التقدم')}: ${Math.round(Number(suiteState.progress_pct || 0))}%`}</Badge>
              <Badge variant={suiteState.status === 'completed' ? 'outline' : suiteState.status === 'failed' ? 'destructive' : 'secondary'}>
                {suiteState.status}
              </Badge>
            </div>
            <div className="space-y-2">
              {(suiteState.cases || []).map((item) => (
                <div key={item.key} className="rounded-xl border border-border/50 p-3 text-sm">
                  {(() => {
                    const meta = getCaseStatusMeta(item.status, item.pass);
                    return (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-medium">{item.key}</span>
                    <Badge variant={meta.variant}>
                      {meta.label}
                    </Badge>
                    {item.simulation_id && (
                      <span className="text-xs text-muted-foreground">{`sim: ${item.simulation_id.slice(0, 8)}`}</span>
                    )}
                  </div>
                    );
                  })()}
                  {Array.isArray(item.failures) && item.failures.length > 0 && (
                    <p className="text-xs text-rose-300 mt-1">{item.failures.join(', ')}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="liquid-glass rounded-2xl p-5 space-y-3">
        <div className="font-semibold">{t('Developer Checks', 'فحوصات المطور')}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {checklist.map((item) => (
            <div key={item.label} className="rounded-xl border border-border/50 px-3 py-2 flex items-center justify-between text-sm">
              <span>{item.label}</span>
              {item.pass ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="liquid-glass rounded-2xl p-5 space-y-2">
        <div className="font-semibold">{t('Recent Suite Runs', 'آخر تشغيلات الحزمة')}</div>
        <div className="space-y-2">
          {suiteHistory.map((item) => (
            <div key={item.suite_id} className="rounded-xl border border-border/50 px-3 py-2 text-sm flex items-center justify-between">
              <span>{item.suite_id.slice(0, 8)}</span>
              <Badge variant="outline">{item.status}</Badge>
            </div>
          ))}
          {!suiteHistory.length && (
            <p className="text-sm text-muted-foreground">
              {t('No suite history yet.', 'لا يوجد سجل اختبارات حتى الآن.')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

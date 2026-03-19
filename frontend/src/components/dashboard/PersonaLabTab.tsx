import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiService, PersonaLabJobResponse, PersonaLibrarySetRecord } from '@/services/api';
import { AlertTriangle, CheckCircle2, Database, Eye, Loader2, MapPin, RefreshCw, Sparkles, Users } from 'lucide-react';

type LabMode = 'audience_only' | 'saved_place_reuse' | 'new_deep_search_place' | 'hybrid';

type LaunchContext = {
  idea: string;
  category?: string;
  location?: string;
} | null;

type SimulationPersonaSelection = {
  persona_source_mode: 'saved_place_personas';
  persona_set_key: string;
  persona_set_label?: string;
  city?: string;
};

interface PersonaLabTabProps {
  launchContext?: LaunchContext;
  onUseForSimulation: (selection: SimulationPersonaSelection) => void;
  onMarkDefaultForSimulation?: (selection: SimulationPersonaSelection) => void;
}

const AUDIENCE_FAMILIES = [
  'gen z',
  'working professionals',
  'students',
  'parents',
  'developers',
  'small business owners',
  'investors',
  'creators',
];

const PRESETS = ['low', 'balanced', 'high'] as const;

const DEFAULT_FORM = {
  source_mode: 'audience_only' as LabMode,
  desired_count: 30,
  target_audience_family: 'gen z',
  place: '',
  saved_set_key: '',
  generation_depth: 'standard' as 'standard' | 'deep',
  stubbornness_preset: 'balanced' as 'low' | 'balanced' | 'high',
  skepticism_preset: 'balanced' as 'low' | 'balanced' | 'high',
  conformity_preset: 'balanced' as 'low' | 'balanced' | 'high',
  randomness_level: 55,
  speaking_style_intensity: 60,
  economic_sensitivity_bias: 50,
};

const STAGE_COPY: Record<string, { en: string; ar: string }> = {
  preparing_request: { en: 'Preparing request', ar: 'تجهيز الطلب' },
  searching_sources: { en: 'Searching sources', ar: 'البحث في المصادر' },
  reading_sources: { en: 'Reading sources', ar: 'قراءة المصادر' },
  extracting_human_patterns: { en: 'Extracting human patterns', ar: 'استخراج الأنماط البشرية' },
  fitting_personas: { en: 'Fitting personas', ar: 'مواءمة الشخصيات' },
  removing_duplicates: { en: 'Removing duplicates', ar: 'إزالة التكرار' },
  validating: { en: 'Validating', ar: 'التحقق' },
  saving_persona_set: { en: 'Saving persona set', ar: 'حفظ مجموعة الشخصيات' },
  completed: { en: 'Completed', ar: 'اكتمل' },
};

export default function PersonaLabTab({
  launchContext = null,
  onUseForSimulation,
  onMarkDefaultForSimulation,
}: PersonaLabTabProps) {
  const { language } = useLanguage();
  const t = useCallback((en: string, ar: string) => (language === 'ar' ? ar : en), [language]);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [filters, setFilters] = useState({ place: '', audience: '', minCount: 10 });
  const [library, setLibrary] = useState<PersonaLibrarySetRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [job, setJob] = useState<PersonaLabJobResponse | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<PersonaLabJobResponse[]>([]);
  const [recentJobsLoading, setRecentJobsLoading] = useState(false);

  const activeSet = useMemo(
    () => library.find((item) => item.set_key === form.saved_set_key) || null,
    [form.saved_set_key, library],
  );

  const completedSetSelection = useMemo<SimulationPersonaSelection | null>(() => {
    const setKey = job?.partial_results?.saved_set_key || activeSet?.set_key;
    if (!setKey) return null;
    return {
      persona_source_mode: 'saved_place_personas',
      persona_set_key: setKey,
      persona_set_label: job?.partial_results?.saved_set_name || activeSet?.place_label || undefined,
      city: activeSet?.place_label || undefined,
    };
  }, [activeSet, job?.partial_results?.saved_set_key, job?.partial_results?.saved_set_name]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const response = await apiService.listPersonaLibrary({
        place: filters.place || undefined,
        audience: filters.audience || undefined,
        min_count: filters.minCount || undefined,
        limit: 12,
      });
      setLibrary(response.items || []);
    } catch (err: unknown) {
      setLibraryError(err instanceof Error ? err.message : 'Failed to load persona sets');
    } finally {
      setLibraryLoading(false);
    }
  }, [filters.audience, filters.minCount, filters.place]);

  const loadRecentJobs = useCallback(async () => {
    setRecentJobsLoading(true);
    try {
      const response = await apiService.listPersonaLabJobs(8);
      setRecentJobs(response.items || []);
    } catch {
      setRecentJobs([]);
    } finally {
      setRecentJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    void loadRecentJobs();
  }, [loadRecentJobs]);

  useEffect(() => {
    if (!job?.job_id || !['queued', 'running'].includes(job.status)) return;
    const interval = window.setInterval(async () => {
      try {
        const next = await apiService.getPersonaLabJob(job.job_id);
        setJob(next);
        if (!['queued', 'running'].includes(next.status)) {
          void loadLibrary();
          void loadRecentJobs();
        }
      } catch {
        window.clearInterval(interval);
      }
    }, 1600);
    return () => window.clearInterval(interval);
  }, [job?.job_id, job?.status, loadLibrary, loadRecentJobs]);

  const handleRandomize = useCallback(() => {
    const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
    const randomAudience = pick(AUDIENCE_FAMILIES);
    setForm((prev) => ({
      ...prev,
      target_audience_family: randomAudience,
      desired_count: 10 + Math.floor(Math.random() * 41),
      generation_depth: Math.random() > 0.5 ? 'deep' : 'standard',
      stubbornness_preset: pick(PRESETS),
      skepticism_preset: pick(PRESETS),
      conformity_preset: pick(PRESETS),
      randomness_level: 20 + Math.floor(Math.random() * 70),
      speaking_style_intensity: 20 + Math.floor(Math.random() * 70),
      economic_sensitivity_bias: 20 + Math.floor(Math.random() * 70),
    }));
  }, []);

  const handleGenerate = useCallback(async () => {
    setJobLoading(true);
    setJobError(null);
    try {
      const next = await apiService.startPersonaLabJob(form);
      setJob(next);
      void loadRecentJobs();
    } catch (err: unknown) {
      setJobError(err instanceof Error ? err.message : 'Failed to start Persona Lab job');
    } finally {
      setJobLoading(false);
    }
  }, [form, loadRecentJobs]);

  const stageRows = job?.stages || [];
  const previewRows = job?.partial_results?.sample_personas || [];
  const isJobActive = Boolean(job && ['queued', 'running'].includes(job.status));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-cyan-400" />
            {t('Persona Lab', 'مختبر الشخصيات')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t(
              'Generate, inspect, and reuse shared persona sets without starting a simulation.',
              'ولّد مجموعات شخصيات مشتركة وافحصها وأعد استخدامها من دون بدء محاكاة.'
            )}
          </p>
        </div>
        {launchContext?.idea ? (
          <div className="max-w-sm rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm">
            <div className="font-medium text-foreground">{t('Simulation Draft Attached', 'تم ربط مسودة محاكاة')}</div>
            <div className="text-muted-foreground mt-1">{launchContext.idea}</div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-5 space-y-6">
          <Card className="liquid-glass border-border/50">
            <CardHeader>
              <CardTitle>{t('Generation Setup', 'إعداد التوليد')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('Persona Source Mode', 'مصدر الشخصيات')}</Label>
                  <Select value={form.source_mode} onValueChange={(value) => setForm((prev) => ({ ...prev, source_mode: value as LabMode }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="audience_only">{t('Audience-only lab', 'مختبر جمهور فقط')}</SelectItem>
                      <SelectItem value="saved_place_reuse">{t('Reuse saved place set', 'إعادة استخدام مجموعة مكان محفوظة')}</SelectItem>
                      <SelectItem value="new_deep_search_place">{t('New deep-search place lab', 'مختبر مكان ببحث عميق')}</SelectItem>
                      <SelectItem value="hybrid">{t('Hybrid place + audience', 'هجين مكان + جمهور')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('Desired Persona Count', 'عدد الشخصيات المطلوب')}</Label>
                  <Input
                    type="number"
                    min={10}
                    max={50}
                    value={form.desired_count}
                    onChange={(e) => setForm((prev) => ({ ...prev, desired_count: Number(e.target.value || 30) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('Generation Depth', 'عمق التوليد')}</Label>
                  <Select value={form.generation_depth} onValueChange={(value) => setForm((prev) => ({ ...prev, generation_depth: value as 'standard' | 'deep' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">{t('Standard', 'عادي')}</SelectItem>
                      <SelectItem value="deep">{t('Deep', 'عميق')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(form.source_mode === 'audience_only' || form.source_mode === 'hybrid') && (
                  <div className="space-y-2">
                    <Label>{t('Target Audience Family', 'فئة الجمهور المستهدفة')}</Label>
                    <Select value={form.target_audience_family} onValueChange={(value) => setForm((prev) => ({ ...prev, target_audience_family: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUDIENCE_FAMILIES.map((family) => (
                          <SelectItem key={family} value={family}>{family}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(form.source_mode === 'new_deep_search_place' || form.source_mode === 'hybrid') && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>{t('Place', 'المكان')}</Label>
                    <Input
                      placeholder={t('Example: New Cairo or Mansoura', 'مثال: القاهرة الجديدة أو المنصورة')}
                      value={form.place}
                      onChange={(e) => setForm((prev) => ({ ...prev, place: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('Stubbornness Preset', 'إعداد العناد')}</Label>
                  <Select value={form.stubbornness_preset} onValueChange={(value) => setForm((prev) => ({ ...prev, stubbornness_preset: value as 'low' | 'balanced' | 'high' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRESETS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('Skepticism Preset', 'إعداد الشك')}</Label>
                  <Select value={form.skepticism_preset} onValueChange={(value) => setForm((prev) => ({ ...prev, skepticism_preset: value as 'low' | 'balanced' | 'high' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRESETS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('Conformity Preset', 'إعداد الامتثال')}</Label>
                  <Select value={form.conformity_preset} onValueChange={(value) => setForm((prev) => ({ ...prev, conformity_preset: value as 'low' | 'balanced' | 'high' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRESETS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('Randomness Level', 'مستوى العشوائية')}</Label>
                  <Input type="number" min={0} max={100} value={form.randomness_level} onChange={(e) => setForm((prev) => ({ ...prev, randomness_level: Number(e.target.value || 0) }))} />
                </div>
                <div className="space-y-2">
                  <Label>{t('Speaking Style Intensity', 'حدة أسلوب الكلام')}</Label>
                  <Input type="number" min={0} max={100} value={form.speaking_style_intensity} onChange={(e) => setForm((prev) => ({ ...prev, speaking_style_intensity: Number(e.target.value || 0) }))} />
                </div>
                <div className="space-y-2">
                  <Label>{t('Economic Sensitivity Bias', 'انحياز الحساسية الاقتصادية')}</Label>
                  <Input type="number" min={0} max={100} value={form.economic_sensitivity_bias} onChange={(e) => setForm((prev) => ({ ...prev, economic_sensitivity_bias: Number(e.target.value || 0) }))} />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => setForm(DEFAULT_FORM)}>{t('Use Defaults', 'استخدم الافتراضيات')}</Button>
                <Button variant="secondary" onClick={handleRandomize}>{t('Randomize Settings', 'عشوِّ الإعدادات')}</Button>
                <Button onClick={handleGenerate} disabled={jobLoading || isJobActive}>
                  {jobLoading || isJobActive ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {t('Generate Personas', 'ولّد الشخصيات')}
                </Button>
              </div>

              {jobError ? (
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {jobError}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="liquid-glass border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-cyan-400" />
                {t('Saved Persona Sets', 'مجموعات الشخصيات المحفوظة')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input placeholder={t('Filter by place', 'تصفية بالمكان')} value={filters.place} onChange={(e) => setFilters((prev) => ({ ...prev, place: e.target.value }))} />
                <Input placeholder={t('Filter by audience', 'تصفية بالجمهور')} value={filters.audience} onChange={(e) => setFilters((prev) => ({ ...prev, audience: e.target.value }))} />
                <Input type="number" min={1} max={50} value={filters.minCount} onChange={(e) => setFilters((prev) => ({ ...prev, minCount: Number(e.target.value || 10) }))} />
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => void loadLibrary()}>{t('Refresh Library', 'حدّث المكتبة')}</Button>
              </div>
              {libraryError ? <div className="text-sm text-rose-300">{libraryError}</div> : null}
              <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
                {libraryLoading ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t('Loading saved persona sets...', 'جارٍ تحميل مجموعات الشخصيات...')}</div>
                ) : library.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('No saved persona sets matched the current filters.', 'لم تُطابق أي مجموعة شخصيات محفوظة عوامل التصفية الحالية.')}</div>
                ) : library.map((item) => {
                  const selected = item.set_key === form.saved_set_key;
                  return (
                    <button
                      type="button"
                      key={item.set_key || item.id}
                      onClick={() => setForm((prev) => ({
                        ...prev,
                        source_mode: 'saved_place_reuse',
                        saved_set_key: item.set_key || '',
                        place: item.place_label || prev.place,
                        target_audience_family: item.audience_filters?.[0] || prev.target_audience_family,
                      }))}
                      className={`w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-border/50 bg-background/40 hover:bg-white/5'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-cyan-400" />
                            {item.place_label || item.set_key}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{item.source_summary || t('No source summary stored.', 'لا يوجد ملخص مصادر مخزن.')}</div>
                        </div>
                        {selected ? <Badge variant="outline">{t('Selected', 'محدد')}</Badge> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{item.persona_count || 0} {t('personas', 'شخصية')}</span>
                        <span>{item.audience_filters?.join(', ') || t('all audiences', 'كل الجماهير')}</span>
                        <span>{typeof item.quality_score === 'number' ? `${item.quality_score.toFixed(2)} quality` : t('quality pending', 'الجودة غير متاحة')}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-7 space-y-6">
          <Card className="liquid-glass border-border/50">
            <CardHeader>
              <CardTitle>{t('Live Pipeline', 'خط المعالجة المباشر')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {stageRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t('Start a Persona Lab job to see live backend stages here.', 'ابدأ مهمة في مختبر الشخصيات لعرض مراحل الخادم المباشرة هنا.')}
                </div>
              ) : stageRows.map((step) => {
                const statusTone = step.status === 'completed'
                  ? 'border-emerald-400/30 bg-emerald-500/10'
                  : step.status === 'running'
                    ? 'border-cyan-400/30 bg-cyan-500/10'
                    : step.status === 'blocked'
                      ? 'border-rose-400/30 bg-rose-500/10'
                      : 'border-border/40 bg-background/40';
                const label = STAGE_COPY[step.key]?.[language === 'ar' ? 'ar' : 'en'] || step.label;
                return (
                  <div key={step.key} className={`rounded-2xl border px-4 py-3 ${statusTone}`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="font-medium">{label}</div>
                      <Badge variant="outline">{step.status}</Badge>
                    </div>
                    {step.detail ? <div className="text-sm text-muted-foreground mt-1">{step.detail}</div> : null}
                  </div>
                );
              })}

              {job?.validation_errors?.length ? (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3">
                  <div className="font-medium flex items-center gap-2 text-rose-100">
                    <AlertTriangle className="w-4 h-4" />
                    {t('Validation blocked this persona set', 'أوقف التحقق مجموعة الشخصيات هذه')}
                  </div>
                  <div className="text-sm text-rose-100/90 mt-2">{job.validation_errors.join(', ')}</div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
                  <div className="text-xs text-muted-foreground">{t('Current Persona Count', 'عدد الشخصيات الحالي')}</div>
                  <div className="text-2xl font-bold mt-1">{job?.partial_results?.current_persona_count ?? 0}</div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
                  <div className="text-xs text-muted-foreground">{t('Evidence Signals Found', 'الإشارات المستخرجة')}</div>
                  <div className="text-2xl font-bold mt-1">{job?.developer?.evidence_signals_found ?? 0}</div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
                  <div className="text-xs text-muted-foreground">{t('Duplicate Rejections', 'المرفوضات المتكررة')}</div>
                  <div className="text-2xl font-bold mt-1">{job?.developer?.duplicate_rejection_count ?? 0}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/40 bg-background/40 p-4 text-sm text-muted-foreground">
                <div>{t('Current stage', 'المرحلة الحالية')}: <span className="text-foreground">{job?.current_stage || '-'}</span></div>
                <div>{t('Batch number', 'رقم الدفعة')}: <span className="text-foreground">{job?.developer?.batch_number ?? 0}</span></div>
                <div>{t('Persistence status', 'حالة الحفظ')}: <span className="text-foreground">{job?.developer?.persistence_status || 'pending'}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card className="liquid-glass border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-pink-400" />
                {t('Persona Preview', 'معاينة الشخصيات')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
                <div className="text-xs text-muted-foreground">{t('Saved set name', 'اسم المجموعة المحفوظة')}</div>
                <div className="text-lg font-semibold mt-1">{job?.partial_results?.saved_set_name || activeSet?.place_label || t('Not saved yet', 'لم تُحفظ بعد')}</div>
              </div>

              {previewRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t('Sample personas will appear here after the backend finishes fitting and saving the set.', 'ستظهر معاينات الشخصيات هنا بعد أن ينهي الخادم المواءمة والحفظ.')}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {previewRows.map((persona) => (
                    <div key={persona.persona_id} className="rounded-2xl border border-border/40 bg-background/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{persona.display_name}</div>
                          <div className="text-xs text-muted-foreground mt-1">{persona.profession_role || persona.target_audience_cluster}</div>
                        </div>
                        <Badge variant="outline">{persona.target_audience_cluster || t('persona', 'شخصية')}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-3">{persona.summary}</div>
                      <div className="text-xs text-muted-foreground mt-3">{persona.attitude_baseline} • {persona.speaking_style}</div>
                      <div className="text-xs text-muted-foreground mt-2">{(persona.main_concerns || []).slice(0, 2).join(', ')}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" disabled={!completedSetSelection}>
                  <Database className="w-4 h-4 mr-2" />
                  {t('Saved To Library', 'تم الحفظ في المكتبة')}
                </Button>
                <Button
                  onClick={() => completedSetSelection && onUseForSimulation(completedSetSelection)}
                  disabled={!completedSetSelection || !launchContext?.idea}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {t('Reuse In Simulation', 'أعد الاستخدام في المحاكاة')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => completedSetSelection && onMarkDefaultForSimulation?.(completedSetSelection)}
                  disabled={!completedSetSelection || !launchContext?.idea || !onMarkDefaultForSimulation}
                >
                  <Users className="w-4 h-4 mr-2" />
                  {t('Mark Default For This Simulation', 'عيّنه افتراضيًا لهذه المحاكاة')}
                </Button>
                <Button variant="secondary" onClick={handleGenerate} disabled={jobLoading || isJobActive}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('Discard And Regenerate', 'تجاهل وأعد التوليد')}
                </Button>
                {completedSetSelection ? (
                  <Button variant="ghost" onClick={() => setJob(null)}>
                    {t('Discard Preview', 'تجاهل المعاينة')}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="liquid-glass border-border/50">
            <CardHeader>
              <CardTitle>{t('Recent Persona Jobs', 'مهام الشخصيات الأخيرة')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentJobsLoading ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t('Loading recent jobs...', 'جارٍ تحميل المهام الأخيرة...')}</div>
              ) : recentJobs.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t('No Persona Lab jobs yet.', 'لا توجد مهام مختبر شخصيات بعد.')}</div>
              ) : recentJobs.map((item) => (
                <button
                  type="button"
                  key={item.job_id}
                  onClick={async () => setJob(await apiService.getPersonaLabJob(item.job_id))}
                  className="w-full rounded-2xl border border-border/40 bg-background/40 px-4 py-3 text-left hover:bg-white/5 transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{item.partial_results?.saved_set_name || item.config?.place || item.config?.target_audience_family || item.job_id}</div>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{item.current_stage}</div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

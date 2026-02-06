import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '@/services/api';
import { addIdeaLogEntry } from '@/lib/ideaLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ResearchResult {
  search_results: any;
  structured: any;
  evidence_cards: { text: string }[];
  pages: { title: string; url: string; snippet?: string }[];
  map_data: any;
}

/**
 * AgentResearchScreen
 *
 * Allows a user to perform a research session on an idea or concept. The
 * backend fetches search results from multiple providers and returns
 * evidence cards, a structured summary, pages and map data. The user
 * can optionally kick off a simulation after reviewing the results.
 */
const AgentResearchScreen = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);

  const runResearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res: ResearchResult = await apiService.runResearch(
        query.trim(),
        location.trim() || undefined,
        category.trim() || undefined
      );
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'فشل البحث');
    } finally {
      setLoading(false);
    }
  };

  const handleStartSimulation = async () => {
    if (!result) return;
    // Build a minimal simulation config using research results. For this
    // prototype we embed summary and evidence cards into the config. The
    // backend will extract these fields if present and include them in
    // the simulation context.
    const summary = result.structured?.summary || '';
    const evidence = result.evidence_cards?.map((c) => c.text) || [];
    const config = {
      idea: query.trim(),
      category: category.trim(),
      targetAudience: [],
      country: '',
      city: '',
      riskAppetite: 50,
      ideaMaturity: 'concept',
      goals: [],
      research_summary: summary,
      evidence_cards: evidence,
      research_sources: result.pages,
      research_structured: result.structured,
    } as any;
    // Start simulation and navigate to the main simulation route.
    try {
      const response = await apiService.startSimulation(config);
      addIdeaLogEntry(query.trim(), {
        simulationId: response.simulation_id,
        status: 'running',
        category: category.trim() || undefined,
      });
      navigate(`/`);
    } catch (err: any) {
      setError(err.message || 'تعذر بدء المحاكاة');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">بحث السوق</h1>
      <div className="space-y-4">
        <Input
          placeholder="ما الفكرة أو الموضوع الذي تريد البحث عنه؟"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Input
          placeholder="الموقع الجغرافي (اختياري)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <Input
          placeholder="فئة الفكرة (اختياري)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Button onClick={runResearch} disabled={loading}>
          {loading ? 'جارٍ البحث...' : 'بدء البحث'}
        </Button>
      </div>
      {error && <p className="text-red-500">{error}</p>}
      {result && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">نتائج البحث</h2>
          <div>
            <h3 className="font-semibold">ملخص منهيكل</h3>
            <pre className="whitespace-pre-wrap bg-muted p-2 rounded-md">
              {JSON.stringify(result.structured, null, 2)}
            </pre>
          </div>
          <div>
            <h3 className="font-semibold">بطاقات الأدلة</h3>
            <ul className="list-disc list-inside space-y-1">
              {result.evidence_cards.map((card, idx) => (
                <li key={idx}>{card.text}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">الصفحات</h3>
            <ul className="list-disc list-inside space-y-1">
              {result.pages.map((page, idx) => (
                <li key={idx}>
                  <a href={page.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {page.title || page.url}
                  </a>
                  {page.snippet && <p className="text-sm text-muted-foreground">{page.snippet}</p>}
                </li>
              ))}
            </ul>
          </div>
          <Button onClick={handleStartSimulation}>ابدأ المحاكاة الآن</Button>
        </div>
      )}
    </div>
  );
};

export default AgentResearchScreen;


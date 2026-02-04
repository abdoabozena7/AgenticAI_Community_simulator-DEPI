import { useEffect, useState } from "react";
import { apiService } from "../services/api";

export default function IdeaCourtPage() {
  const [idea, setIdea] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pending = localStorage.getItem("pendingCourtIdea");
    if (pending) {
      setIdea(pending);
      localStorage.removeItem("pendingCourtIdea");
    }
  }, []);

  const runCourt = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.runCourt({ idea });
      setResult(res);
    } catch (e: any) {
      setError(e?.message || "Failed to run Idea Court");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Idea Court</h2>

      <textarea
        style={{ width: "100%", height: 120 }}
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Write your idea..."
      />

      <div style={{ marginTop: 12 }}>
        <button onClick={runCourt} disabled={loading || !idea.trim()}>
          {loading ? "Running..." : "Run Idea Court"}
        </button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {result && (
        <pre style={{ background: "#111", color: "#0f0", padding: 12, marginTop: 12 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

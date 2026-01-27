import React from 'react';

/**
 * Metrics panel displays aggregated statistics from the simulation.
 *
 * Props:
 *   metrics: {
 *     accepted: number,
 *     rejected: number,
 *     neutral: number,
 *     acceptance_rate: number,
 *     total_agents: number,
 *     per_category: { [category_id]: number },
 *     iteration: number,
 *   }
 */
export default function MetricsPanel({ metrics }) {
  if (!metrics) {
    return (
      <div className="metrics-panel" style={{ padding: '0.5rem' }}>
        <p>No metrics available.</p>
      </div>
    );
  }
  const { accepted, rejected, neutral, acceptance_rate, total_agents, per_category, iteration } = metrics;
  // Compute bar widths for per-category acceptance (normalised to max count)
  const maxAcceptance = Math.max(1, ...Object.values(per_category || {}));
  return (
    <div className="metrics-panel" style={{ padding: '0.5rem' }}>
      <h3>Metrics</h3>
      <p>Total agents: {total_agents}</p>
      <p>Iteration: {iteration}</p>
      <div style={{ marginTop: '0.5rem' }}>
        <div>Accepted: {accepted}</div>
        <div>Rejected: {rejected}</div>
        <div>Neutral: {neutral}</div>
        <div>Acceptance rate: {(acceptance_rate * 100).toFixed(1)}%</div>
      </div>
      {per_category && (
        <div style={{ marginTop: '0.5rem' }}>
          <h4>Per-category acceptance</h4>
          {Object.keys(per_category).map((cat) => {
            const count = per_category[cat];
            const widthPercent = (count / maxAcceptance) * 100;
            return (
              <div key={cat} style={{ marginBottom: '0.25rem' }}>
                <span style={{ display: 'inline-block', width: '60px' }}>{cat}</span>
                <div style={{ display: 'inline-block', width: '70%', background: '#eee', height: '0.5rem', verticalAlign: 'middle' }}>
                  <div style={{ width: `${widthPercent}%`, height: '100%', background: '#76c7c0' }}></div>
                </div>
                <span style={{ marginLeft: '0.5rem' }}>{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
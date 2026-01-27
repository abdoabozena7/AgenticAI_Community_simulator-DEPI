import React from 'react';

/**
 * Iteration timeline component.
 *
 * Props:
 *   currentIteration: number - current iteration index
 *   totalIterations: number (optional) - known total iterations
 */
export default function IterationTimeline({ currentIteration, totalIterations }) {
  const percentage = totalIterations ? (currentIteration / totalIterations) * 100 : null;
  return (
    <div className="iteration-timeline" style={{ padding: '0.5rem' }}>
      <h4>Iteration</h4>
      <div>Current: {currentIteration}{totalIterations ? ` / ${totalIterations}` : ''}</div>
      {totalIterations && (
        <div style={{ marginTop: '0.25rem', background: '#eee', height: '0.5rem', width: '100%' }}>
          <div style={{ width: `${percentage}%`, height: '100%', background: '#8faadc' }}></div>
        </div>
      )}
    </div>
  );
}
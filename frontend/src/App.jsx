import React, { useState, useEffect, useRef } from 'react';
import ChatPanel from './components/ChatPanel.jsx';
import SimulationArena from './components/SimulationArena.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import IterationTimeline from './components/IterationTimeline.jsx';
import { createSimulationWebSocket } from './services/websocket.js';
import { startSimulation, getSimulationResult } from './services/api.js';

/**
 * Root component of the social simulation frontend. Orchestrates
 * user input collection, initiates the backend simulation, subscribes to
 * real-time events via WebSocket and displays results across the UI.
 */
export default function App() {
  // State for simulation ID
  const [simulationId, setSimulationId] = useState(null);
  // Aggregated metrics from the simulation
  const [metrics, setMetrics] = useState(null);
  // List of reasoning events to display as live feed
  const [reasoningFeed, setReasoningFeed] = useState([]);
  // Current iteration number (for timeline)
  const [currentIteration, setCurrentIteration] = useState(0);
  // WebSocket reference to allow cleanup
  const wsRef = useRef(null);

  // Establish WebSocket connection on mount
  useEffect(() => {
    wsRef.current = createSimulationWebSocket({
      onReasoningStep: (event) => {
        // Append new reasoning event to feed
        setReasoningFeed((prev) => [...prev, event]);
      },
      onMetricsUpdate: (event) => {
        // Update metrics and iteration
        setMetrics(event);
        setCurrentIteration(event.iteration);
      },
    });
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // When a simulation is started, poll for final result periodically
  useEffect(() => {
    if (!simulationId) return;
    let timer;
    const pollResult = async () => {
      try {
        const res = await getSimulationResult(simulationId);
        if (res.status === 'completed') {
          // Merge final metrics into state
          setMetrics((prev) => ({ ...prev, ...res.metrics, iteration: prev ? prev.iteration : 0 }));
          clearInterval(timer);
        }
      } catch (err) {
        console.error(err);
      }
    };
    timer = setInterval(pollResult, 2000);
    return () => clearInterval(timer);
  }, [simulationId]);

  // Handler when chat panel completes user input
  const handleCompleteInput = async (context) => {
    try {
      const res = await startSimulation(context);
      setSimulationId(res.simulation_id);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <header style={{ padding: '0.5rem', background: '#282c34', color: 'white' }}>
        <h2>AI Social Simulation</h2>
      </header>
      {/* Main content area */}
      <div style={{ flexGrow: 1, display: 'flex' }}>
        {/* Left panel: Chat + reasoning feed */}
        <div style={{ width: '30%', borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
          <ChatPanel onComplete={handleCompleteInput} />
          {/* Reasoning feed */}
          <div style={{ flexGrow: 1, overflowY: 'auto', padding: '0.5rem', borderTop: '1px solid #eee' }}>
            <h4>Reasoning Feed</h4>
            {reasoningFeed.map((ev, idx) => (
              <div key={idx} style={{ marginBottom: '0.25rem' }}>
                <em>Iteration {ev.iteration}:</em> {ev.message}
              </div>
            ))}
          </div>
        </div>
        {/* Middle panel: Simulation arena & timeline */}
        <div style={{ width: '40%', padding: '0.5rem', display: 'flex', flexDirection: 'column' }}>
          <SimulationArena />
          <IterationTimeline currentIteration={currentIteration} />
        </div>
        {/* Right panel: Metrics */}
        <div style={{ width: '30%', borderLeft: '1px solid #ddd', padding: '0.5rem' }}>
          <MetricsPanel metrics={metrics} />
        </div>
      </div>
    </div>
  );
}
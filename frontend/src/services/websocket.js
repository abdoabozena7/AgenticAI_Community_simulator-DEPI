// WebSocket service for subscribing to live simulation updates.

/**
 * Create a WebSocket connection to the simulation endpoint.
 *
 * @param {Object} handlers - Callback functions for handling different event types.
 * @param {function} handlers.onReasoningStep - Called with a reasoning event {agent_id, iteration, message}.
 * @param {function} handlers.onMetricsUpdate - Called with a metrics event {accepted, rejected, neutral, acceptance_rate, total_agents, per_category, iteration}.
 * @returns {WebSocket} - The WebSocket instance.
 */
export function createSimulationWebSocket({ onReasoningStep, onMetricsUpdate }) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host || 'localhost:8000';
  const ws = new WebSocket(`${protocol}://${host}/ws/simulation`);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const { type, ...payload } = data;
      if (type === 'reasoning_step' && typeof onReasoningStep === 'function') {
        onReasoningStep(payload);
      } else if (type === 'metrics' && typeof onMetricsUpdate === 'function') {
        onMetricsUpdate(payload);
      }
    } catch (e) {
      console.error('Error parsing WebSocket message', e);
    }
  };
  ws.onerror = (err) => {
    console.error('WebSocket error', err);
  };
  return ws;
}
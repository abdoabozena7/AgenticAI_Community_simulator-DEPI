// API service functions for communicating with the backend REST endpoints.

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';

/**
 * Start a new simulation on the backend.
 *
 * @param {Object} context - Structured user input collected from the ChatPanel.
 * @returns {Promise<Object>} - Response containing simulation_id and status.
 */
export async function startSimulation(context) {
  const response = await fetch(`${API_BASE}/simulation/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  });
  if (!response.ok) {
    throw new Error('Failed to start simulation');
  }
  return response.json();
}

/**
 * Retrieve the final result of a simulation.
 *
 * @param {string} simulationId - The ID of the simulation to query.
 * @returns {Promise<Object>} - Object containing status and metrics.
 */
export async function getSimulationResult(simulationId) {
  const response = await fetch(`${API_BASE}/simulation/result?simulation_id=${simulationId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch simulation result');
  }
  return response.json();
}
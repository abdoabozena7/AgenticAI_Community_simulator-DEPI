CREATE TABLE IF NOT EXISTS simulations (
  simulation_id VARCHAR(36) PRIMARY KEY,
  status VARCHAR(16) NOT NULL,
  user_context JSON,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  summary LONGTEXT
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  simulation_id VARCHAR(36) NOT NULL,
  agent_id VARCHAR(36) NOT NULL,
  short_id VARCHAR(8) NOT NULL,
  category_id VARCHAR(64),
  template_id VARCHAR(64),
  archetype_name VARCHAR(128),
  traits JSON,
  biases JSON,
  influence_weight FLOAT,
  is_leader BOOLEAN,
  fixed_opinion VARCHAR(16),
  initial_opinion VARCHAR(16),
  current_opinion VARCHAR(16),
  confidence FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agents_sim (simulation_id),
  INDEX idx_agents_agent (agent_id),
  CONSTRAINT fk_agents_sim
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id)
    ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reasoning_steps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  simulation_id VARCHAR(36) NOT NULL,
  agent_id VARCHAR(36) NOT NULL,
  agent_short_id VARCHAR(8),
  archetype_name VARCHAR(128),
  iteration INT,
  phase VARCHAR(64),
  reply_to_agent_id VARCHAR(36),
  opinion VARCHAR(16),
  message LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_steps_sim (simulation_id),
  INDEX idx_steps_agent (agent_id),
  INDEX idx_steps_phase (phase),
  CONSTRAINT fk_steps_sim
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id)
    ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  simulation_id VARCHAR(36) NOT NULL,
  iteration INT,
  accepted INT,
  rejected INT,
  neutral INT,
  acceptance_rate FLOAT,
  polarization FLOAT,
  per_category JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_metrics_sim (simulation_id),
  CONSTRAINT fk_metrics_sim
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id)
    ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

/* MariaDB / XAMPP compatible schema
   DB: agentic_simulator
   Charset: utf8mb4
*/

SET NAMES utf8mb4;
SET time_zone = "+00:00";

-- -------------------------
-- Users & Auth
-- -------------------------
CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(128) NULL,
  password_hash VARCHAR(256) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  credits INT NOT NULL DEFAULT 0,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  email_verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  INDEX idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh tokens for JWT auth
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at TIMESTAMP NULL,
  replaced_by VARCHAR(128) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  INDEX idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_verifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  used_at TIMESTAMP NULL,
  INDEX idx_email_verify_user (user_id),
  CONSTRAINT fk_email_verify_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  used_at TIMESTAMP NULL,
  INDEX idx_password_reset_user (user_id),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NULL,
  action VARCHAR(64) NOT NULL,
  meta JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily usage limit (e.g., 5/day)
CREATE TABLE IF NOT EXISTS daily_usage (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  usage_date DATE NOT NULL,
  used_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_daily_usage_user_date (user_id, usage_date),
  INDEX idx_daily_usage_user (user_id),
  CONSTRAINT fk_daily_usage_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promo codes that grant credits/attempts
CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  bonus_attempts INT NOT NULL DEFAULT 0,
  max_uses INT NULL,
  uses INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_promo_active (is_active),
  CONSTRAINT fk_promo_created_by FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  promo_code_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  redeemed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_promo_user (promo_code_id, user_id),
  INDEX idx_redemptions_user (user_id),
  CONSTRAINT fk_redemptions_promo FOREIGN KEY (promo_code_id)
    REFERENCES promo_codes(id) ON DELETE CASCADE,
  CONSTRAINT fk_redemptions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------
-- Simulation core tables
-- -------------------------
CREATE TABLE IF NOT EXISTS simulations (
  simulation_id VARCHAR(36) PRIMARY KEY,
  user_id BIGINT NULL,
  seed BIGINT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'running',
  user_context JSON NULL,
  final_metrics JSON NULL,
  summary TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  INDEX idx_sim_user (user_id),
  CONSTRAINT fk_sim_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agents (
  agent_id VARCHAR(36) PRIMARY KEY,
  simulation_id VARCHAR(36) NOT NULL,
  short_id VARCHAR(8) NULL,
  category_id VARCHAR(64) NOT NULL,
  template_id VARCHAR(64) NULL,
  archetype_name VARCHAR(64) NULL,
  traits JSON NULL,
  biases JSON NULL,
  influence_weight FLOAT NULL,
  is_leader TINYINT(1) NULL,
  fixed_opinion VARCHAR(16) NULL,
  initial_opinion VARCHAR(16) NULL,
  current_opinion VARCHAR(16) NULL,
  confidence FLOAT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agents_sim (simulation_id),
  INDEX idx_agents_short (short_id),
  CONSTRAINT fk_agents_sim FOREIGN KEY (simulation_id)
    REFERENCES simulations(simulation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reasoning_steps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  simulation_id VARCHAR(36) NOT NULL,
  agent_id VARCHAR(36) NOT NULL,
  agent_short_id VARCHAR(8) NULL,
  archetype_name VARCHAR(64) NULL,
  iteration INT NULL,
  phase VARCHAR(32) NULL,
  message TEXT NOT NULL,
  opinion VARCHAR(16) NULL,
  triggered_by VARCHAR(32) NULL,
  reply_to_agent_id VARCHAR(36) NULL,
  evidence_keys JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_steps_sim (simulation_id),
  INDEX idx_steps_agent (agent_id),
  CONSTRAINT fk_steps_sim FOREIGN KEY (simulation_id)
    REFERENCES simulations(simulation_id) ON DELETE CASCADE,
  CONSTRAINT fk_steps_agent FOREIGN KEY (agent_id)
    REFERENCES agents(agent_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  simulation_id VARCHAR(36) NOT NULL,
  iteration INT NULL,
  accepted INT NULL,
  rejected INT NULL,
  neutral INT NULL,
  acceptance_rate FLOAT NULL,
  polarization FLOAT NULL,
  per_category JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_metrics_sim (simulation_id),
  CONSTRAINT fk_metrics_sim FOREIGN KEY (simulation_id)
    REFERENCES simulations(simulation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------
-- Research (Agent-style) optional tables
-- -------------------------
CREATE TABLE IF NOT EXISTS research_sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id BIGINT NULL,
  query TEXT NOT NULL,
  location_text TEXT NULL,
  result_payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_research_user (user_id),
  CONSTRAINT fk_research_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_steps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  research_session_id VARCHAR(36) NOT NULL,
  step_type VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rsteps_session (research_session_id),
  CONSTRAINT fk_rsteps_session FOREIGN KEY (research_session_id)
    REFERENCES research_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MySQL schema for the Agentic Simulator

--
-- This file defines all required tables for the application, including
-- users, sessions, promo codes/redemptions, daily usage counters,
-- simulation metadata, agents, reasoning steps, metrics and research
-- sessions. The backend will run these statements at startup via
-- `db.init_db_sync()` to ensure tables exist if they have not been
-- created manually.

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(128),
    password_hash VARCHAR(256) NOT NULL,
    role ENUM('user','developer','admin') DEFAULT 'user',
    credits DECIMAL(12,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS promo_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    bonus_attempts INT DEFAULT 0,
    max_uses INT DEFAULT 1,
    uses INT DEFAULT 0,
    expires_at DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    promo_code_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_code (user_id, promo_code_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    usage_date DATE NOT NULL,
    used_count INT DEFAULT 0,
    UNIQUE KEY uniq_user_date (user_id, usage_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_token_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    usage_date DATE NOT NULL,
    used_tokens INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_token_date (user_id, usage_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulations (
    simulation_id VARCHAR(36) PRIMARY KEY,
    user_id INT NULL,
    status VARCHAR(32) NOT NULL,
    user_context JSON,
    summary LONGTEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS simulation_token_usage (
    simulation_id VARCHAR(36) PRIMARY KEY,
    user_id INT NOT NULL,
    used_tokens INT DEFAULT 0,
    free_tokens_applied INT DEFAULT 0,
    credits_charged DECIMAL(12,2) DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    simulation_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(64) NOT NULL,
    short_id VARCHAR(16),
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
    last_phase VARCHAR(64),
    confidence FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reasoning_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    simulation_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(64),
    agent_short_id VARCHAR(16),
    agent_label VARCHAR(32),
    archetype_name VARCHAR(128),
    iteration INT,
    phase VARCHAR(64),
    reply_to_agent_id VARCHAR(64),
    reply_to_short_id VARCHAR(8),
    opinion VARCHAR(16),
    opinion_source VARCHAR(24),
    stance_confidence FLOAT,
    reasoning_length VARCHAR(16),
    fallback_reason VARCHAR(64),
    relevance_score FLOAT,
    policy_guard TINYINT(1),
    policy_reason VARCHAR(128),
    stance_locked TINYINT(1),
    reason_tag VARCHAR(64),
    clarification_triggered TINYINT(1),
    step_uid VARCHAR(96),
    event_seq BIGINT,
    stance_before VARCHAR(16),
    stance_after VARCHAR(16),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reasoning_step_uid (simulation_id, step_uid),
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metrics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    simulation_id VARCHAR(36) NOT NULL,
    iteration INT,
    accepted INT,
    rejected INT,
    neutral INT,
    acceptance_rate FLOAT,
    polarization FLOAT,
    total_agents INT,
    per_category JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation_checkpoints (
    simulation_id VARCHAR(36) PRIMARY KEY,
    checkpoint_json LONGTEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'running',
    last_error TEXT,
    status_reason VARCHAR(32),
    current_phase_key VARCHAR(64),
    phase_progress_pct FLOAT,
    event_seq BIGINT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    simulation_id VARCHAR(36) NOT NULL,
    event_seq BIGINT,
    cycle_id VARCHAR(64),
    url TEXT,
    domain VARCHAR(255),
    favicon_url VARCHAR(1024),
    action VARCHAR(32),
    status VARCHAR(24),
    title VARCHAR(512),
    http_status INT,
    content_chars INT,
    relevance_score FLOAT,
    snippet TEXT,
    error TEXT,
    meta_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_research_events_sim (simulation_id),
    INDEX idx_research_events_seq (simulation_id, event_seq),
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS simulation_chat_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    simulation_id VARCHAR(36) NOT NULL,
    event_seq BIGINT NOT NULL,
    message_id VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content LONGTEXT NOT NULL,
    meta_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chat_events_sim_seq (simulation_id, event_seq),
    UNIQUE KEY uq_chat_events_sim_msg (simulation_id, message_id),
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS developer_suite_runs (
    id VARCHAR(36) PRIMARY KEY,
    user_id INT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    config_json JSON,
    result_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    INDEX idx_dev_suite_runs_user_created (user_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS developer_suite_cases (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    suite_id VARCHAR(36) NOT NULL,
    case_key VARCHAR(32) NOT NULL,
    simulation_id VARCHAR(36),
    expected_json JSON,
    actual_json JSON,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    pass TINYINT(1),
    failure_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dev_suite_case (suite_id, case_key),
    INDEX idx_dev_suite_cases_suite (suite_id),
    FOREIGN KEY (suite_id) REFERENCES developer_suite_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    query VARCHAR(256),
    location VARCHAR(256),
    category VARCHAR(256),
    search_results JSON,
    structured JSON,
    evidence_cards JSON,
    map_data JSON,
    pages JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

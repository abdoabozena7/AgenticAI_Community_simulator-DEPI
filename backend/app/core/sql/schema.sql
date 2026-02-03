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
    role ENUM('user','admin') DEFAULT 'user',
    credits INT DEFAULT 0,
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
    confidence FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reasoning_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    simulation_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(64),
    agent_short_id VARCHAR(16),
    archetype_name VARCHAR(128),
    iteration INT,
    phase VARCHAR(64),
    reply_to_agent_id VARCHAR(64),
    opinion VARCHAR(16),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
    per_category JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (simulation_id) REFERENCES simulations(simulation_id) ON DELETE CASCADE
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
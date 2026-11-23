-- Social Media IP Analysis V2 - MySQL 8.0 Schema
-- Optimized for ~1 GB dataset (600K+ IP events) using BINARY(32) hashes and VARBINARY(16) IPs

CREATE DATABASE IF NOT EXISTS social_media_ip
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE social_media_ip;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('master_admin', 'viewer') NOT NULL DEFAULT 'viewer',
  approved TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS upload_batches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sha256 BINARY(32) NOT NULL UNIQUE,
  platform ENUM('TikTok', 'META') NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  import_status ENUM('pending', 'processing', 'processed', 'failed') NOT NULL DEFAULT 'pending',
  record_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_upload_status (import_status, created_at),
  CONSTRAINT fk_upload_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  platform ENUM('TikTok', 'Facebook', 'Instagram') NOT NULL,
  account_identifier VARCHAR(255) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  target_id VARCHAR(100) NOT NULL DEFAULT '',
  it_no VARCHAR(100) NOT NULL DEFAULT '',
  meta_account_type ENUM('User', 'InstagramUser', 'Page', 'Group', 'Unknown', '') NOT NULL DEFAULT '',
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  complete_reason VARCHAR(1000) NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_platform_account (platform, account_identifier),
  INDEX idx_account_name (account_name(191)),
  INDEX idx_target_id (target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_id BINARY(32) NULL UNIQUE,
  inst_id VARCHAR(100) NOT NULL DEFAULT '',
  data_id VARCHAR(100) NOT NULL DEFAULT '',
  tracking_code VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'TPO / Tracking Code',
  reported_date DATE NULL,
  team VARCHAR(100) NOT NULL DEFAULT '',
  platform ENUM('TikTok', 'Facebook', 'Instagram', 'Other') NOT NULL DEFAULT 'TikTok',
  platform_url VARCHAR(1000) NOT NULL DEFAULT '',
  normalized_url VARCHAR(500) NOT NULL DEFAULT '',
  resolved_url VARCHAR(1000) NOT NULL DEFAULT '',
  account_name VARCHAR(255) NOT NULL DEFAULT '',
  scammer_case VARCHAR(50) NOT NULL DEFAULT 'Scammer',
  tracking_status VARCHAR(150) NOT NULL DEFAULT '',
  replied_at VARCHAR(100) NOT NULL DEFAULT '',
  tpo_code VARCHAR(100) NOT NULL DEFAULT '',
  note TEXT NULL,
  source_filename VARCHAR(255) NOT NULL DEFAULT '',
  source_row INT UNSIGNED NOT NULL DEFAULT 0,
  response_account VARCHAR(255) NOT NULL DEFAULT '',
  response_target_id VARCHAR(100) NOT NULL DEFAULT '',
  imported_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cases_inst (inst_id),
  INDEX idx_cases_tracking (tracking_code),
  INDEX idx_cases_tpo (tpo_code),
  INDEX idx_cases_reported (reported_date),
  INDEX idx_cases_scammer (scammer_case),
  INDEX idx_cases_norm_url (normalized_url(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_account_links (
  case_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  match_status VARCHAR(50) NOT NULL DEFAULT 'matched',
  PRIMARY KEY (case_id, account_id),
  CONSTRAINT fk_link_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_account FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rdap_networks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_version TINYINT UNSIGNED NOT NULL COMMENT '4 or 6',
  from_ip VARCHAR(45) NOT NULL,
  to_ip VARCHAR(45) NOT NULL,
  from_ip_bin VARBINARY(16) NOT NULL,
  to_ip_bin VARBINARY(16) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT '',
  network_name VARCHAR(255) NOT NULL DEFAULT '',
  owner_name VARCHAR(255) NOT NULL DEFAULT '',
  ip_type VARCHAR(100) NOT NULL DEFAULT '',
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ip_range (ip_version, from_ip_bin, to_ip_bin),
  INDEX idx_range_lookup (ip_version, from_ip_bin, to_ip_bin),
  INDEX idx_rdap_country (country),
  INDEX idx_rdap_network (network_name(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ip_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  record_key BINARY(32) NOT NULL UNIQUE,
  upload_batch_id BIGINT UNSIGNED NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  rdap_network_id BIGINT UNSIGNED NULL,
  platform ENUM('TikTok', 'Facebook', 'Instagram') NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_utc DATETIME(3) NULL,
  event_local DATETIME(3) NULL COMMENT 'UTC+7',
  ip_bin VARBINARY(16) NULL COMMENT 'INET6_ATON binary IP (IPv4 or IPv6)',
  ip_version TINYINT UNSIGNED NULL,
  port INT UNSIGNED NULL,
  ip_type VARCHAR(50) NOT NULL DEFAULT '',
  page_admin VARCHAR(255) NOT NULL DEFAULT '',
  meta_actor_display VARCHAR(255) NOT NULL DEFAULT '',
  tiktok_country VARCHAR(100) NOT NULL DEFAULT '',
  it_no VARCHAR(100) NOT NULL DEFAULT '',
  inst_id VARCHAR(100) NOT NULL DEFAULT '',
  tpo_code VARCHAR(100) NOT NULL DEFAULT '',
  scammer_case VARCHAR(50) NOT NULL DEFAULT '',
  reported_date VARCHAR(100) NOT NULL DEFAULT '',
  team VARCHAR(100) NOT NULL DEFAULT '',
  case_match_count INT UNSIGNED NOT NULL DEFAULT 0,
  case_window_match TINYINT(1) NOT NULL DEFAULT 0,
  source_zip VARCHAR(255) NOT NULL DEFAULT '',
  source_folder VARCHAR(255) NOT NULL DEFAULT '',
  source_pdf VARCHAR(255) NOT NULL DEFAULT '',
  source_no INT UNSIGNED NOT NULL DEFAULT 0,
  no_ip_data TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_events_local (platform, event_local),
  INDEX idx_events_account_time (account_id, event_utc),
  INDEX idx_events_ip_bin (ip_bin),
  INDEX idx_events_rdap (rdap_network_id),
  INDEX idx_events_scammer (scammer_case, event_local),
  INDEX idx_events_tpo (tpo_code),
  CONSTRAINT fk_event_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_event_account FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_rdap FOREIGN KEY (rdap_network_id) REFERENCES rdap_networks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ip_request_tracking (
  ip_event_id BIGINT UNSIGNED PRIMARY KEY,
  unavailable TINYINT(1) NOT NULL DEFAULT 0,
  requested TINYINT(1) NOT NULL DEFAULT 0,
  replied TINYINT(1) NOT NULL DEFAULT 0,
  received TINYINT(1) NOT NULL DEFAULT 0,
  no_ip_request_needed TINYINT(1) NOT NULL DEFAULT 0,
  letter_number VARCHAR(100) NOT NULL DEFAULT '',
  result TEXT NULL,
  entity_user_id VARCHAR(250) NOT NULL DEFAULT '',
  entity_name VARCHAR(500) NOT NULL DEFAULT '',
  entity_country VARCHAR(250) NOT NULL DEFAULT '',
  entity_address VARCHAR(2000) NOT NULL DEFAULT '',
  entity_email VARCHAR(500) NOT NULL DEFAULT '',
  entity_phone VARCHAR(250) NOT NULL DEFAULT '',
  entity_payment VARCHAR(1000) NOT NULL DEFAULT '',
  entity_account_no VARCHAR(500) NOT NULL DEFAULT '',
  access_service VARCHAR(100) NOT NULL DEFAULT '',
  access_datetime_local VARCHAR(50) NOT NULL DEFAULT '',
  access_ip VARCHAR(45) NOT NULL DEFAULT '',
  access_remote_port VARCHAR(20) NOT NULL DEFAULT '',
  access_ip_country VARCHAR(100) NOT NULL DEFAULT '',
  access_network VARCHAR(255) NOT NULL DEFAULT '',
  access_isp VARCHAR(255) NOT NULL DEFAULT '',
  updated_by VARCHAR(100) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tracking_flags (requested, replied, received, unavailable),
  INDEX idx_tracking_letter (letter_number),
  CONSTRAINT fk_track_event FOREIGN KEY (ip_event_id) REFERENCES ip_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  status ENUM('queued', 'running', 'waiting_for_excel', 'completed', 'error') NOT NULL DEFAULT 'queued',
  phase VARCHAR(50) NOT NULL DEFAULT 'queued',
  progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  message VARCHAR(500) NULL,
  requested_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_snapshots (
  id CHAR(36) PRIMARY KEY,
  report_name VARCHAR(200) NOT NULL,
  template_version VARCHAR(100) NOT NULL DEFAULT '',
  filters_json JSON NOT NULL,
  summary_json JSON NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  generated_by VARCHAR(64) NOT NULL DEFAULT '',
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_report_date (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

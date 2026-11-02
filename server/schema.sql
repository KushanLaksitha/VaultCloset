CREATE DATABASE IF NOT EXISTS vaultcloset CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vaultcloset;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- user_id NULL was previously used for global shared categories, but all categories are
-- now strictly per-user. Default categories are seeded on registration in authRoutes.js.
CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  target_type ENUM('image', 'video', 'document') NOT NULL DEFAULT 'image',
  name VARCHAR(255) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 100,
  pin_hash VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cat_user_type (user_id, target_type),
  CONSTRAINT fk_cat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  enc_file_ref VARCHAR(255) NOT NULL,      -- relative path inside VAULT_DIR (never sent to the browser)
  enc_thumb_ref VARCHAR(255) NOT NULL,
  wrapped_key TEXT NOT NULL,               -- per-image key, encrypted with MASTER_KEY (not the raw key)
  content_hash CHAR(64) NOT NULL,          -- SHA-256, used for duplicate detection
  mime_type VARCHAR(50) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  width INT UNSIGNED, height INT UNSIGNED,
  is_favorite TINYINT(1) NOT NULL DEFAULT 0,
  approval_source ENUM('ai','manual') NOT NULL DEFAULT 'ai',
  category_source ENUM('ai','manual') NOT NULL DEFAULT 'ai',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_hash (user_id, content_hash),
  KEY idx_user_created (user_id, created_at),
  KEY idx_user_cat (user_id, category_id),
  KEY idx_user_fav (user_id, is_favorite),
  KEY idx_user_name (user_id, original_filename),
  CONSTRAINT fk_img_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_img_cat FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rejected_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  enc_file_ref VARCHAR(255) NOT NULL,
  enc_thumb_ref VARCHAR(255) NOT NULL,
  wrapped_key TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  reason TEXT,
  ai_result JSON,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rej_user (user_id),
  KEY idx_rej_expires (expires_at),
  CONSTRAINT fk_rej_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pending_images (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  enc_file_ref VARCHAR(255) NOT NULL,
  enc_thumb_ref VARCHAR(255) NOT NULL,
  wrapped_key TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  width INT UNSIGNED, height INT UNSIGNED,
  status ENUM('pending', 'failed') NOT NULL DEFAULT 'pending',
  fail_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pend_user (user_id),
  KEY idx_pend_hash (user_id, content_hash),
  CONSTRAINT fk_pend_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_analysis (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  image_id BIGINT UNSIGNED NULL,
  rejected_image_id BIGINT UNSIGNED NULL,
  provider VARCHAR(40) NOT NULL,
  verdict ENUM('approved','rejected') NOT NULL,
  suggested_category VARCHAR(60),
  confidence DECIMAL(4,3),
  reason TEXT,
  raw_result JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_image (image_id),
  CONSTRAINT fk_ai_img FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_rej FOREIGN KEY (rejected_image_id) REFERENCES rejected_images(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(50) NOT NULL,
  detail VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_log_user (user_id, created_at),
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS application_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---- Seed data ----
-- Note: Default categories (Frocks, Shorts & T-Shirts, Trousers & Blouses, Other) are now
-- seeded per-user when they register (see authRoutes.js). No global categories are inserted here.
INSERT IGNORE INTO application_settings (setting_key, setting_value) VALUES
 ('rejected_ttl_hours', '24'), ('max_upload_mb', '15');


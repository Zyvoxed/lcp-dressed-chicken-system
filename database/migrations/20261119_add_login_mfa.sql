-- Gmail OTP login MFA objects only. This file is generated for manual review;
-- do not execute automatically or against production without operator approval.
--
-- Before applying, inspect the live Aiven definition and verify that users.user_id
-- is INT (signed) and that users uses InnoDB. The repository schema snapshot has
-- this definition, but it is not a substitute for checking the live database.
-- Read-only compatibility check:
SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, t.ENGINE
FROM information_schema.COLUMNS AS c
JOIN information_schema.TABLES AS t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME = 'users'
  AND c.COLUMN_NAME = 'user_id';

-- Stop if the result is not users.user_id = int (signed), InnoDB.
CREATE TABLE login_mfa_challenges (
    challenge_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    challenge_hash BINARY(32) NOT NULL,
    user_id INT NOT NULL,
    auth_version INT UNSIGNED NOT NULL,
    email_hash BINARY(32) NOT NULL,
    otp_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    resend_available_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE KEY uq_login_mfa_challenge_hash (challenge_hash),
    KEY idx_login_mfa_user_created (user_id, created_at),
    KEY idx_login_mfa_expiry (expires_at),

    CONSTRAINT fk_login_mfa_challenge_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Shared, bounded request counters make pre-auth throttling reliable when Vercel
-- serves requests from different serverless instances. Identifiers are HMACs.
CREATE TABLE login_mfa_rate_limits (
    rate_limit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    action ENUM('login', 'challenge', 'verify', 'resend') NOT NULL,
    identifier_kind ENUM('ip', 'account', 'challenge') NOT NULL,
    identifier_hash BINARY(32) NOT NULL,
    window_started_at DATETIME(3) NOT NULL,
    request_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE KEY uq_login_mfa_rate_window
        (action, identifier_kind, identifier_hash, window_started_at),
    KEY idx_login_mfa_rate_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

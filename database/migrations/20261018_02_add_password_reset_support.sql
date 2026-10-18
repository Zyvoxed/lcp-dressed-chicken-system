-- Add secure, single-use password resets and per-account JWT invalidation.
-- Existing users receive auth_version 0, so currently issued JWTs remain valid
-- until that account's password is changed.
-- Apply this migration manually after the recovery-email migration and before
-- deploying application code that reads these objects.

ALTER TABLE users
    ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_active;

CREATE TABLE password_reset_tokens (
    reset_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash BINARY(32) NOT NULL,
    email_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE KEY uq_password_reset_token_hash (token_hash),
    KEY idx_password_reset_user_created (user_id, created_at),
    KEY idx_password_reset_expiry (expires_at),

    CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE password_reset_rate_limits (
    event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    action ENUM('request', 'attempt') NOT NULL,
    identifier_kind ENUM('email', 'ip', 'token') NOT NULL,
    identifier_hash BINARY(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    KEY idx_password_reset_rate_lookup
        (action, identifier_kind, identifier_hash, created_at),
    KEY idx_password_reset_rate_created (created_at)
);

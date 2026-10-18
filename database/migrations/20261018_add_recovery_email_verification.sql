-- Add optional, unique recovery email support without changing existing accounts.
-- Existing rows receive NULL for both new user columns.
-- Apply this migration manually before deploying application code that reads these columns.

ALTER TABLE users
    ADD COLUMN email VARCHAR(254) NULL AFTER username,
    ADD COLUMN email_verified_at DATETIME(3) NULL AFTER email,
    ADD UNIQUE KEY uq_users_email (email);

CREATE TABLE email_verification_tokens (
    verification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash BINARY(32) NOT NULL,
    email_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE KEY uq_email_verification_token_hash (token_hash),
    KEY idx_email_verification_user_created (user_id, created_at),
    KEY idx_email_verification_expiry (expires_at),

    CONSTRAINT fk_email_verification_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

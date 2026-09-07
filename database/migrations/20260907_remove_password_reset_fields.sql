ALTER TABLE users
    DROP COLUMN password_reset_token_hash,
    DROP COLUMN password_reset_expires_at;

-- Adds durable transaction request deduplication.
-- Apply once before deploying code that requires the Idempotency-Key header.
-- The unique index serializes simultaneous requests with the same user,
-- operation, and key. The business transaction stores its response atomically.

CREATE TABLE idempotency_records (
    idempotency_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    operation_type ENUM('sale', 'stock_in', 'payment') NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash BINARY(32) NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    response_body JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_idempotency_user_operation_key
        (user_id, operation_type, idempotency_key),
    KEY idx_idempotency_created_at (created_at),

    CONSTRAINT fk_idempotency_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

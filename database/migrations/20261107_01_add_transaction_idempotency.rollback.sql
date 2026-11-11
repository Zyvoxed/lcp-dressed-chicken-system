-- Roll back only when replay protection records are no longer required.
DROP TABLE idempotency_records;

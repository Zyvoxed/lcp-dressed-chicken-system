-- MySQL 8.0.16+ (including Aiven MySQL 8.4.8).
-- Existing-database upgrade procedure only. Do not apply database/schema.sql
-- to this database; schema.sql is for fresh database setup.
--
-- This file is intentionally status-only and contains no executable DDL.
-- MySQL ALTER TABLE statements commit independently; do not assume atomic
-- migration or rollback.
--
-- Safe sequential procedure:
--   1. Take and verify a restorable backup. Stop or coordinate application
--      writes for the migration window.
--   2. Run 20261107_02_data_integrity_preflight.sql. Continue only if it
--      returns zero violating records. Do not automatically repair/delete
--      historical business records.
--   3. Run this file and save all 18 status rows. For MISSING constraints,
--      apply only the corresponding single-constraint ALTER template below.
--      Never apply a template marked ALREADY_APPLIED, NAME_CONFLICT, or
--      DEFINITION_MISMATCH.
--   4. Run this file again after each applied group and confirm the status.
--      If an ALTER fails, stop, inspect the database state with this file,
--      and apply only templates still marked MISSING after reviewing the
--      failure. Do not rerun an earlier group or this file's templates
--      indiscriminately.
--   5. For ALREADY_APPLIED, retain the status row as evidence. For
--      DEFINITION_MISMATCH or NAME_CONFLICT, stop for manual review; never
--      replace/drop the existing constraint automatically.
--   6. Rollback, if approved, is manual and status-guided using the paired
--      .rollback.sql instructions. ALTER TABLE operations are not atomic.
--
-- Status meanings:
--   MISSING: no constraint with this name exists in the selected schema.
--   ALREADY_APPLIED: this CHECK has the expected name, table, type, expression.
--   NAME_CONFLICT: the name exists but the table/type differs; stop.
--   DEFINITION_MISMATCH: the name/table/type match but expression differs; stop.

WITH expected AS (
    SELECT 'products' AS table_name, 'chk_products_selling_price_nonnegative' AS constraint_name, 'selling_price >= 0' AS expected_expression
    UNION ALL SELECT 'products', 'chk_products_stock_quantity_nonnegative', 'stock_quantity >= 0'
    UNION ALL SELECT 'products', 'chk_products_reorder_level_nonnegative', 'reorder_level >= 0'
    UNION ALL SELECT 'customers', 'chk_customers_current_balance_nonnegative', 'current_balance >= 0'
    UNION ALL SELECT 'stock_in', 'chk_stock_in_quantity_positive', 'quantity_received > 0'
    UNION ALL SELECT 'stock_in', 'chk_stock_in_remaining_nonnegative', 'remaining_quantity >= 0'
    UNION ALL SELECT 'stock_in', 'chk_stock_in_cost_price_nonnegative', 'cost_price >= 0'
    UNION ALL SELECT 'stock_in', 'chk_stock_in_total_cost_nonnegative', 'total_cost >= 0'
    UNION ALL SELECT 'sales', 'chk_sales_total_nonnegative', 'total_amount >= 0'
    UNION ALL SELECT 'sales', 'chk_sales_amount_paid_nonnegative', 'amount_paid >= 0'
    UNION ALL SELECT 'sales', 'chk_sales_remaining_nonnegative', 'remaining_balance >= 0'
    UNION ALL SELECT 'sales_items', 'chk_sales_items_quantity_positive', 'quantity > 0'
    UNION ALL SELECT 'sales_items', 'chk_sales_items_price_nonnegative', 'price >= 0'
    UNION ALL SELECT 'sales_items', 'chk_sales_items_subtotal_nonnegative', 'subtotal >= 0'
    UNION ALL SELECT 'sale_batch_allocations', 'chk_allocations_quantity_positive', 'quantity_deducted > 0'
    UNION ALL SELECT 'sale_batch_allocations', 'chk_allocations_cost_nonnegative', 'cost_price >= 0'
    UNION ALL SELECT 'payments', 'chk_payments_amount_positive', 'payment_amount > 0'
    UNION ALL SELECT 'payments', 'chk_payments_remaining_nonnegative', 'remaining_balance >= 0'
)
SELECT expected.table_name,
       expected.constraint_name,
       expected.expected_expression,
       actual.table_name AS actual_table,
       actual.constraint_type AS actual_type,
       checks.check_clause AS actual_expression,
       CASE
           WHEN actual.constraint_name IS NULL THEN 'MISSING'
           WHEN actual.table_name <> expected.table_name
                OR actual.constraint_type <> 'CHECK' THEN 'NAME_CONFLICT'
           WHEN LOWER(REPLACE(REPLACE(REPLACE(REPLACE(checks.check_clause, ' ', ''), '`', ''), '(', ''), ')', ''))
                = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(expected.expected_expression, ' ', ''), '`', ''), '(', ''), ')', ''))
                THEN 'ALREADY_APPLIED'
           ELSE 'DEFINITION_MISMATCH'
       END AS migration_status
FROM expected
LEFT JOIN information_schema.table_constraints AS actual
    ON actual.constraint_schema = DATABASE()
    AND actual.constraint_name = expected.constraint_name
LEFT JOIN information_schema.check_constraints AS checks
    ON checks.constraint_schema = actual.constraint_schema
    AND checks.constraint_name = actual.constraint_name
ORDER BY expected.table_name, expected.constraint_name;

-- Apply one statement only when its status is MISSING.
-- Do not apply a statement for ALREADY_APPLIED.
-- Stop for NAME_CONFLICT or DEFINITION_MISMATCH.
-- Never execute this file's templates as a batch.
--
-- ALTER TABLE products ADD CONSTRAINT chk_products_selling_price_nonnegative CHECK (selling_price >= 0);
-- ALTER TABLE products ADD CONSTRAINT chk_products_stock_quantity_nonnegative CHECK (stock_quantity >= 0);
-- ALTER TABLE products ADD CONSTRAINT chk_products_reorder_level_nonnegative CHECK (reorder_level >= 0);
-- ALTER TABLE customers ADD CONSTRAINT chk_customers_current_balance_nonnegative CHECK (current_balance >= 0);
-- ALTER TABLE stock_in ADD CONSTRAINT chk_stock_in_quantity_positive CHECK (quantity_received > 0);
-- ALTER TABLE stock_in ADD CONSTRAINT chk_stock_in_remaining_nonnegative CHECK (remaining_quantity >= 0);
-- ALTER TABLE stock_in ADD CONSTRAINT chk_stock_in_cost_price_nonnegative CHECK (cost_price >= 0);
-- ALTER TABLE stock_in ADD CONSTRAINT chk_stock_in_total_cost_nonnegative CHECK (total_cost >= 0);
-- ALTER TABLE sales ADD CONSTRAINT chk_sales_total_nonnegative CHECK (total_amount >= 0);
-- ALTER TABLE sales ADD CONSTRAINT chk_sales_amount_paid_nonnegative CHECK (amount_paid >= 0);
-- ALTER TABLE sales ADD CONSTRAINT chk_sales_remaining_nonnegative CHECK (remaining_balance >= 0);
-- ALTER TABLE sales_items ADD CONSTRAINT chk_sales_items_quantity_positive CHECK (quantity > 0);
-- ALTER TABLE sales_items ADD CONSTRAINT chk_sales_items_price_nonnegative CHECK (price >= 0);
-- ALTER TABLE sales_items ADD CONSTRAINT chk_sales_items_subtotal_nonnegative CHECK (subtotal >= 0);
-- ALTER TABLE sale_batch_allocations ADD CONSTRAINT chk_allocations_quantity_positive CHECK (quantity_deducted > 0);
-- ALTER TABLE sale_batch_allocations ADD CONSTRAINT chk_allocations_cost_nonnegative CHECK (cost_price >= 0);
-- ALTER TABLE payments ADD CONSTRAINT chk_payments_amount_positive CHECK (payment_amount > 0);
-- ALTER TABLE payments ADD CONSTRAINT chk_payments_remaining_nonnegative CHECK (remaining_balance >= 0);

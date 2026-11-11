-- Read-only preflight for 20261107_02_add_data_integrity_constraints.sql.
-- Run against the existing database before the upgrade migration.
-- This returns every row that would violate a proposed CHECK. It changes no data.
-- CHECK expressions evaluate UNKNOWN for NULL; the target columns are NOT NULL
-- in schema.sql, so this report mirrors the constraints' rejection conditions.

SELECT 'products' AS table_name, 'selling_price' AS column_name,
       CAST(product_id AS CHAR) AS record_id, CAST(selling_price AS CHAR) AS offending_value,
       'chk_products_selling_price_nonnegative' AS constraint_name
FROM products WHERE selling_price < 0
UNION ALL
SELECT 'products', 'stock_quantity', CAST(product_id AS CHAR), CAST(stock_quantity AS CHAR),
       'chk_products_stock_quantity_nonnegative'
FROM products WHERE stock_quantity < 0
UNION ALL
SELECT 'products', 'reorder_level', CAST(product_id AS CHAR), CAST(reorder_level AS CHAR),
       'chk_products_reorder_level_nonnegative'
FROM products WHERE reorder_level < 0
UNION ALL
SELECT 'customers', 'current_balance', CAST(customer_id AS CHAR), CAST(current_balance AS CHAR),
       'chk_customers_current_balance_nonnegative'
FROM customers WHERE current_balance < 0
UNION ALL
SELECT 'stock_in', 'quantity_received', CAST(stockin_id AS CHAR), CAST(quantity_received AS CHAR),
       'chk_stock_in_quantity_positive'
FROM stock_in WHERE quantity_received <= 0
UNION ALL
SELECT 'stock_in', 'remaining_quantity', CAST(stockin_id AS CHAR), CAST(remaining_quantity AS CHAR),
       'chk_stock_in_remaining_nonnegative'
FROM stock_in WHERE remaining_quantity < 0
UNION ALL
SELECT 'stock_in', 'cost_price', CAST(stockin_id AS CHAR), CAST(cost_price AS CHAR),
       'chk_stock_in_cost_price_nonnegative'
FROM stock_in WHERE cost_price < 0
UNION ALL
SELECT 'stock_in', 'total_cost', CAST(stockin_id AS CHAR), CAST(total_cost AS CHAR),
       'chk_stock_in_total_cost_nonnegative'
FROM stock_in WHERE total_cost < 0
UNION ALL
SELECT 'sales', 'total_amount', CAST(sale_id AS CHAR), CAST(total_amount AS CHAR),
       'chk_sales_total_nonnegative'
FROM sales WHERE total_amount < 0
UNION ALL
SELECT 'sales', 'amount_paid', CAST(sale_id AS CHAR), CAST(amount_paid AS CHAR),
       'chk_sales_amount_paid_nonnegative'
FROM sales WHERE amount_paid < 0
UNION ALL
SELECT 'sales', 'remaining_balance', CAST(sale_id AS CHAR), CAST(remaining_balance AS CHAR),
       'chk_sales_remaining_nonnegative'
FROM sales WHERE remaining_balance < 0
UNION ALL
SELECT 'sales_items', 'quantity', CAST(salesitem_id AS CHAR), CAST(quantity AS CHAR),
       'chk_sales_items_quantity_positive'
FROM sales_items WHERE quantity <= 0
UNION ALL
SELECT 'sales_items', 'price', CAST(salesitem_id AS CHAR), CAST(price AS CHAR),
       'chk_sales_items_price_nonnegative'
FROM sales_items WHERE price < 0
UNION ALL
SELECT 'sales_items', 'subtotal', CAST(salesitem_id AS CHAR), CAST(subtotal AS CHAR),
       'chk_sales_items_subtotal_nonnegative'
FROM sales_items WHERE subtotal < 0
UNION ALL
SELECT 'sale_batch_allocations', 'quantity_deducted', CAST(allocation_id AS CHAR), CAST(quantity_deducted AS CHAR),
       'chk_allocations_quantity_positive'
FROM sale_batch_allocations WHERE quantity_deducted <= 0
UNION ALL
SELECT 'sale_batch_allocations', 'cost_price', CAST(allocation_id AS CHAR), CAST(cost_price AS CHAR),
       'chk_allocations_cost_nonnegative'
FROM sale_batch_allocations WHERE cost_price < 0
UNION ALL
SELECT 'payments', 'payment_amount', CAST(payment_id AS CHAR), CAST(payment_amount AS CHAR),
       'chk_payments_amount_positive'
FROM payments WHERE payment_amount <= 0
UNION ALL
SELECT 'payments', 'remaining_balance', CAST(payment_id AS CHAR), CAST(remaining_balance AS CHAR),
       'chk_payments_remaining_nonnegative'
FROM payments WHERE remaining_balance < 0
ORDER BY table_name, record_id, column_name;

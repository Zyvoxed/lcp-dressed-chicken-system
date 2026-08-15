CREATE DATABASE IF NOT EXISTS lcp_business_system
CHARACTER SET utf8mb4
COLLATE utf8mb4_general_ci;

USE lcp_business_system;

-- =========================================================
-- 1. USERS
-- Stores Admin and Staff accounts
-- =========================================================
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'Staff') NOT NULL,
    contact_number VARCHAR(20) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

-- =========================================================
-- 2. PRODUCTS
-- Stores poultry products and current inventory information
-- =========================================================
CREATE TABLE products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    product_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    selling_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock_quantity DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    reorder_level DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    status ENUM('Available', 'Low Stock', 'Out of Stock')
        NOT NULL DEFAULT 'Out of Stock',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

-- =========================================================
-- 3. SUPPLIERS
-- Stores supplier information
-- =========================================================
CREATE TABLE suppliers (
    supplier_id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_name VARCHAR(100) NOT NULL,
    contact_person VARCHAR(100) NULL,
    contact_number VARCHAR(20) NULL,
    address TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

-- =========================================================
-- 4. CUSTOMERS
-- Stores customer information and current credit balance
-- =========================================================
CREATE TABLE customers (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    contact_number VARCHAR(20) NULL,
    address TEXT NULL,
    current_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

-- =========================================================
-- 5. STOCK IN
-- Stores every supplier delivery.
-- Each row acts as an inventory batch for FIFO.
-- =========================================================
CREATE TABLE stock_in (
    stockin_id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    product_id INT NOT NULL,
    user_id INT NOT NULL,

    quantity_received DECIMAL(10,3) NOT NULL,
    remaining_quantity DECIMAL(10,3) NOT NULL,

    cost_price DECIMAL(10,2) NOT NULL,
    total_cost DECIMAL(12,2) NOT NULL,

    delivery_date DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_stockin_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(supplier_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stockin_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_stockin_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- =========================================================
-- 6. SALES
-- Stores the main/header information for each transaction
-- =========================================================
CREATE TABLE sales (
    sale_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NULL,
    user_id INT NOT NULL,

    payment_type ENUM('Cash', 'Credit') NOT NULL,

    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    remaining_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    status ENUM('Paid', 'Partially Paid', 'Unpaid')
        NOT NULL DEFAULT 'Paid',

    sale_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sales_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_sales_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- =========================================================
-- 7. SALES ITEMS
-- Stores every product included in a sale
-- =========================================================
CREATE TABLE sales_items (
    salesitem_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,

    quantity DECIMAL(10,3) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,

    CONSTRAINT fk_salesitems_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(sale_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_salesitems_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- =========================================================
-- 8. SALE BATCH ALLOCATIONS
-- Records which FIFO stock-in batches were consumed
-- by every sales item.
-- =========================================================
CREATE TABLE sale_batch_allocations (
    allocation_id INT AUTO_INCREMENT PRIMARY KEY,
    salesitem_id INT NOT NULL,
    stockin_id INT NOT NULL,

    quantity_deducted DECIMAL(10,3) NOT NULL,
    cost_price DECIMAL(10,2) NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_allocation_salesitem
        FOREIGN KEY (salesitem_id)
        REFERENCES sales_items(salesitem_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_allocation_stockin
        FOREIGN KEY (stockin_id)
        REFERENCES stock_in(stockin_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- =========================================================
-- 9. PAYMENTS
-- Stores payments made for customer credit transactions
-- =========================================================
CREATE TABLE payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    customer_id INT NOT NULL,
    user_id INT NOT NULL,

    payment_amount DECIMAL(12,2) NOT NULL,
    remaining_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payments_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(sale_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_payments_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_payments_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- =========================================================
-- 10. REPORTS
-- Stores information about generated reports
-- =========================================================
CREATE TABLE reports (
    report_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    report_type VARCHAR(50) NOT NULL,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reports_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- =========================================================
-- 11. ACTIVITY LOGS
-- Stores important user/system actions
-- =========================================================
CREATE TABLE activity_logs (
    activity_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_activitylogs_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

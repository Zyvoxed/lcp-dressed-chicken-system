-- LOCALHOST ONLY: delivery management setup for lcp_business_system.
-- Review and run manually against the local XAMPP database only.
-- This script creates delivery, vehicle, and delivery status history tables
-- and seeds the two known vans. It does not create driver assignment data.

USE lcp_business_system;

CREATE TABLE IF NOT EXISTS delivery_vehicles (
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_name VARCHAR(100) NOT NULL,
    plate_number VARCHAR(20) NULL,
    description VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_delivery_vehicles_name (vehicle_name),
    KEY idx_delivery_vehicles_active (is_active, vehicle_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS deliveries (
    delivery_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    vehicle_id INT NULL,
    recipient_name VARCHAR(100) NOT NULL,
    recipient_contact VARCHAR(20) NULL,
    delivery_address TEXT NOT NULL,
    delivery_status ENUM('Pending', 'In Transit', 'Delivered', 'Failed') NOT NULL DEFAULT 'Pending',
    delivery_notes TEXT NULL,
    failure_reason TEXT NULL,
    created_by INT NOT NULL,
    status_updated_by INT NULL,
    assigned_at DATETIME NULL,
    delivered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_deliveries_sale (sale_id),
    KEY idx_deliveries_status_created (delivery_status, created_at),
    KEY idx_deliveries_vehicle (vehicle_id),
    KEY idx_deliveries_created_by (created_by),
    KEY idx_deliveries_status_updated_by (status_updated_by),
    CONSTRAINT fk_deliveries_sale FOREIGN KEY (sale_id)
        REFERENCES sales(sale_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deliveries_vehicle FOREIGN KEY (vehicle_id)
        REFERENCES delivery_vehicles(vehicle_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_deliveries_created_by FOREIGN KEY (created_by)
        REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_deliveries_status_updated_by FOREIGN KEY (status_updated_by)
        REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS delivery_status_history (
    history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delivery_id INT NOT NULL,
    previous_status ENUM('Pending', 'In Transit', 'Delivered', 'Failed') NULL,
    new_status ENUM('Pending', 'In Transit', 'Delivered', 'Failed') NOT NULL,
    remarks TEXT NULL,
    user_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_delivery_history_delivery_created (delivery_id, created_at, history_id),
    KEY idx_delivery_history_user (user_id),
    CONSTRAINT fk_delivery_history_delivery FOREIGN KEY (delivery_id)
        REFERENCES deliveries(delivery_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_delivery_history_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO delivery_status_history (delivery_id, previous_status, new_status, remarks, user_id, created_at)
SELECT d.delivery_id, NULL, d.delivery_status, d.delivery_notes, d.created_by, d.created_at
FROM deliveries d
WHERE NOT EXISTS (
    SELECT 1 FROM delivery_status_history h WHERE h.delivery_id = d.delivery_id
);

INSERT INTO delivery_vehicles (vehicle_name)
SELECT 'Freezer Van 1'
WHERE NOT EXISTS (SELECT 1 FROM delivery_vehicles WHERE vehicle_name = 'Freezer Van 1');

INSERT INTO delivery_vehicles (vehicle_name)
SELECT 'Freezer Van 2'
WHERE NOT EXISTS (SELECT 1 FROM delivery_vehicles WHERE vehicle_name = 'Freezer Van 2');

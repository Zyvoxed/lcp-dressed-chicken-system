# LCP Dressed Chicken Trading System Architecture

## Application components

- **Frontend:** React and Vite. `src/routes/AppRoutes.jsx` selects the authenticated module; `ProtectedLayout` and `Sidebar` expose the role-specific navigation.
- **Backend:** Express routes in `server/routes`, controllers in `server/controllers`, authentication and role checks in `server/middleware`, and MySQL access through `server/config/database.js`.
- **Deployment:** Vercel serves the Vite build and forwards `/api/*` to `api/index.js`; `server/server.js` is the standalone entry point.
- **Database:** MySQL. `database/schema.sql` is the fresh-install schema. SQL files in `database/migrations` are historical operator-reviewed migrations; the new migration runner tracks the current-schema baseline and its managed additive MFA migration.
- **External service:** SMTP delivers email verification, password recovery, and login MFA messages.

## Business modules and access

| Module | Admin | Staff |
| --- | --- | --- |
| Dashboard and business analytics | Full access | No access |
| POS and sale checkout | Full access | POS only |
| Product lookup required by POS | Yes | Sellable fields and current quantity only |
| Customer lookup/creation required by POS | Yes | Name and ID lookup; checkout customer creation |
| Inventory and stock-in | Full access | No access |
| Customer credits, customer payment history, payment posting | Full access | No access |
| Supplier management and procurement history | Full access | No access |
| Sales, inventory, and receivables reports | Full access | No access |
| User accounts and activity logs | Full access | No access |

Backend API authorization is authoritative. Staff's allowed operational requests are authenticated product lookup, customer lookup/creation used by checkout, `POST /api/sales`, and sale idempotency recovery. Product lookup omits reorder and administrative status fields; customer lookup omits balances, contact data, and credit aggregates.

## Core business data flow

- A sale reads registered product prices, locks each product and eligible FIFO batch, records the sale and allocations, updates stock and any credit balance, logs the operation, and saves the idempotent response in one database transaction.
- Stock-in locks the active supplier and product, creates a FIFO batch, updates product stock, records activity, and saves its idempotent response transactionally.
- A customer payment locks its sale and customer, validates the outstanding amount, updates the sale and customer balance, records the payment and activity, and saves the idempotent response transactionally.
- Reports read these records. Sales and receivables report tables use bounded server-side pages; CSV export walks those pages. Product-sales charts use grouped SQL aggregates.

## Delivery scope and retained SQL artifacts

Delivery management is **not a product requirement**. There are no delivery API routes, controllers, or pages, and none should be added. The repository retains `database/migrations/20261113_add_delivery_management_aiven.sql` and `database/local-only/20261113_delivery_management.sql`; the former targets a named Aiven database and the latter creates local delivery tables and seeds vehicle rows. The fresh-install schema does not include delivery tables and application code does not depend on them.

Do not run, remove, or roll back those SQL files automatically. Before cleanup, an operator must check the actual target database for delivery tables and rows, take a restorable backup if data exists, and receive explicit authorization for any cleanup. If unused, retain them as clearly marked out-of-scope historical artifacts until an approved repository cleanup.

## Supplier payable scope

The agreed accounting direction is that stock-in cost creates a supplier payable. The current schema stores stock-in cost but does not model supplier invoices, payable balances, settlement history, or corrections. Payment allocation, overpayment, and post-payment correction rules remain unconfirmed. Do not represent supplier balances as settled or introduce payable writes until those rules are approved.

## Database migration operation

The canonical schema includes all MFA tables needed for a fresh install. `npm --prefix server run migrate` is a read-only dry run. The runner verifies the current core tables, required columns, and InnoDB engines, then reports migration state. It serializes apply operations with a MySQL advisory lock, stores migration ID/checksum in `schema_migrations`, refuses partial/incompatible MFA structures, and adds only MFA support tables. It does not change sales, payments, customers, stock, or suppliers.

Existing timestamped SQL migrations predate the ledger and include manual preflights and destructive/conditional operations. The runner intentionally does not replay them. Upgrade any database that does not already match the current core schema using the corresponding reviewed migration and preflight procedure; do not run `database/schema.sql` over an existing business database. Verify the target schema and backup before applying any historical migration.

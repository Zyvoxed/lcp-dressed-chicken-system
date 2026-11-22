# Staff Supplier Profile & Delivery Monitoring — 2026-11-23

## 1. Previous Staff UI

The prior Staff page repeated supplier contact data in both a large card grid and a second wide table. It did not show delivery history or delivery activity. This redesign replaces that structure with a supplier profile, compact delivery summaries, a six-month chart, and a short recent-record list.

## 2. New layout

- The original brief's header text and **Read Only** indicator were subsequently removed from the Staff page at the user's direction. The Admin Suppliers page was not changed.
- Supplier profile: name, contact person, phone, address, and active status. The current API does not return email, so none is shown.
- Multiple active suppliers: a selector appears only when the active supplier endpoint returns more than one record. The page does not hardcode an ID.
- Delivery cards: count of unique Stock-In record IDs and most recent delivery date. An empty history is labeled “No deliveries recorded.”
- Monthly chart: six calendar months through the current month in Asia/Manila, including zero-count months. It uses CSS bars and requires no chart dependency.
- Recent deliveries: up to five records with `DLV-{stockin_id}`, date/time, product, and the received quantity with its configured unit. No quantities across units are added together.
- Loading, error/retry, no-active-supplier, no-delivery, and no-search-results states are provided. The recent list search filters its five displayed records.
- The earlier link to the Inventory & Stock-In module was subsequently removed from the Staff recent-deliveries section at the user's direction. No Admin link or navigation was changed.

## 3. Actual data sources and delivery-count rules

The page uses the existing authenticated Staff APIs and services:

- `GET /api/suppliers` returns active suppliers with `supplier_id`, `supplier_name`, `contact_person`, `contact_number`, `address`, and `created_at`.
- `GET /api/stock-in` returns Staff-safe stock-in rows with supplier/product references, configured product unit, quantity received/remaining, actor, and delivery date. The Staff projection omits `cost_price` and `total_cost`.

No new endpoint or database change was needed. Supplier history is filtered by the selected supplier ID in the UI. Metrics count distinct `stockin_id` records; monthly buckets use the delivery date interpreted in `Asia/Manila`; the latest and five most recent records are sorted by date and ID. Explicit cancelled/voided status values are excluded by the calculation helper if present.

**Data-model limitation:** `database/schema.sql` defines `stock_in.stockin_id` as the row primary key and each row contains one `product_id`. There is no parent shipment/delivery ID or stock-in status/cancellation field, and no cancellation workflow in the existing Stock-In routes. The schema describes each row as a supplier delivery/inventory batch. Thus this page counts each unique posted Stock-In row once. It cannot determine whether separate Stock-In submissions with different IDs were products from one physical truck shipment. No physical-shipment total is fabricated. Current Stock-In records are treated as posted because the existing creation path inserts them and the model has no void/cancel state.

## 4. Files changed for this task

```text
src/pages/Staff/StaffSuppliers.jsx
src/pages/Staff/StaffSuppliers.css
src/utils/staffSupplierMetrics.js
src/utils/staffSupplierMetrics.test.js
server/scripts/staffSuppliersFrontendTest.js
docs/audits/staff-implementation/STAFF_SUPPLIER_PROFILE_DELIVERY_MONITORING.md
```

No Admin supplier page, shared supplier service/API, Inventory & Stock-In page, database schema, or migration was changed for this task. All unrelated working-tree changes were preserved.

## 5. Staff security

Staff remains read-only on this page. It contains no supplier mutation actions and calls only the existing authorized supplier and Stock-In read APIs. Supplier POST/PATCH/archive/restore routes remain Admin-only. Existing Stock-In Staff responses omit procurement cost fields; the new UI does not render costs, payables, or financial fields.

## 6. Verification results

- Focused Node tests with process-local dummy database/JWT environment values: **20 passed, 0 failed**. This included supplier update/archive/history, Staff role/access checks, and three new deterministic metrics tests. The database tests use fakes; they are not live MySQL verification.
- New metrics tests: distinct ID counting, supplier filtering, the six Manila-month buckets, latest/recent ordering, explicit cancelled/voided values, and empty history.
- `npm.cmd run lint`: **passed**.
- `npm.cmd run build -- --outDir dist-staff-supplier-profile-20261123`: **passed**. Vite reported a 716.52 kB main JavaScript chunk warning (>500 kB). The isolated output directory was removed afterward; normal `dist` was not used.
- `git diff --check`: **not clean** because of an existing unrelated working-tree issue at `src/styles/pages/Dashboard.css:2465` (“new blank line at EOF”). That file was modified before this task and was left untouched. The new task files have no trailing-whitespace findings; the Staff component-specific diff check passed.
- Staff browser harness: **NOT VERIFIED**. Chrome 158.0.8127.36 exited during GPU startup with a GPU persistent-cache access conflict before DevTools connected. Only harness safety/browser-presence prechecks ran; no page assertions or screenshots ran.
- Admin supplier browser harness: **partial** — 10 assertions passed; its existing “Supplier modal backdrop did not cover the full viewport” assertion failed. The Admin supplier component and shared Admin stylesheet were not changed in this task. Full Admin browser acceptance remains **NOT VERIFIED**.

The browser harness mocks supplier and Stock-In data, uses an isolated temporary browser profile and a unique timestamped screenshot directory, and cannot prove production data behavior. The failed Staff browser attempt wrote no screenshot; existing screenshots were not overwritten.

## 7. Remaining risks and limitations

- Multiple real-world products from one physical shipment cannot be grouped unless the business records a shared shipment identifier; current schema does not have one.
- `GET /api/stock-in` returns the full authorized Staff history without pagination. The page reuses this existing API; response size may grow with history.
- The Inventory route has no direct Inflow Records tab URL. The link opens `/inventory`, after which Staff chooses the tab.
- Staff UI interaction, mobile layout, and chart rendering remain **NOT VERIFIED** because Chrome did not reach the browser assertions.
- Admin browser testing remains partially unverified due the existing backdrop assertion.
- No production database access, migration, database-writing test, deployment, staging, commit, or push occurred.

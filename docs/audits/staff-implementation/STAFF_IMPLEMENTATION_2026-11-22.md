# Staff-side implementation evidence — 2026-11-22

## Status

**Partially completed; release acceptance remains open.** The role-specific frontend and API paths are implemented, and automated tests, lint, and the production build pass. Staff browser workflow assertions could not run because Chrome and Edge terminate their GPU process in this environment. Several existing Admin-oriented browser harnesses also report backdrop viewport assertions. No live MySQL reconciliation was performed.

The requested `LCP_STAFF_IMPLEMENTATION_SPEC_2026-11-22.md` and `FULL_PROJECT_AUDIT.md` were not present in the repository during inspection. Existing source, routes, database operations, and the permission matrix in the supplied task were treated as the implementation source of truth.

## Permission matrix implemented

| Module/action | Admin | Staff |
|---|---|---|
| Dashboard | Existing full dashboard | Operational metrics only |
| POS | Existing POS | Cash and credit sale creation |
| Inventory | Existing management | Active inventory read |
| Stock-In | Existing management | Create and history read |
| Suppliers | Existing management | Active supplier read |
| Customers/credits | Existing management | Customer read/create for POS, balances, credit/payment history, payment creation |
| Reports | Existing full reports and exports | Sales activity, inventory, stock-in, receivables operational reports and export |
| Business analytics, user accounts, activity logs | Existing access | Denied |
| Product/supplier/customer administration and historical corrections | Existing Admin routes | Denied |

`shared/permissions.js` is the explicit Staff allowlist and safely normalizes backend `Admin`/`Staff` and frontend `admin`/`employee` role labels. Admin capability checks remain permissive, while existing Admin-only API routes retain their role middleware. Frontend routing uses the same capability map and renders a Staff-safe fallback during restricted-route redirects.

## Operational report classification

Staff report endpoints are `GET /api/reports/operational/:report` and `GET /api/reports/operational/:report/export`. Both require authentication and the corresponding operational read/export capability. Supported report kinds are `sales`, `inventory`, `stock-in`, and `receivables`.

- Sales: transaction identifier/date, customer, payment type/status, item count, and quantity grouped by configured product unit. The API includes per-report unit-grouped quantities; it does not return sale amounts, margins, or profit.
- Inventory: active product identity/category/unit, on-hand quantity, reorder level, and status. Selling price and procurement valuation are omitted.
- Stock-In: receipt/supplier/product references, configured unit, received/remaining quantities, date, and actor. Procurement costs are omitted.
- Receivables: active customer identity and outstanding balance, authorized for bookkeeping.
- Exports use the same report endpoint, filters, record projection, and pagination aggregation. Export fetches all filtered pages through the dedicated export route; no Admin report controller was broadened.

All operational query values are parameterized. Search is limited to 100 characters, dates are validated as calendar dates, and page size is bounded to 100. Admin reporting endpoints, formulas, and report pages remain on their existing Admin-only paths.

## Admin preservation and transaction integrity

Admin screens remain selected by the existing Admin branch in `AppRoutes`; Staff views are separate role-aware components. The existing Admin pages and Admin-only archive, restore, edit, historical-sales, detailed-allocation, analytics, account, activity, and full-report routes remain in place.

Staff mutations use existing sale, stock-in, and payment controllers and their existing transactions/idempotency behavior. No separate inventory or ledger accounting was introduced. Stock-In history and customer/product lists use safe Staff projections. The sale and stock-in actor continue to come from the authenticated user. Fake-database tests exercise allowed and denied route/controller paths, but this is not a live database financial reconciliation.

## Verification performed in this batch

| Check | Result |
|---|---|
| Full Node test suite: `node --test` with process-local dummy DB/JWT variables | **PASS — 245 passed, 0 failed, 0 skipped, 0 cancelled** |
| Focused Staff capability/role/access tests from earlier in this implementation | **PASS — 11 passed, 0 failed** |
| `npm.cmd run lint` | **PASS** |
| `npm.cmd run build -- --outDir dist-staff-verification-20261122` | **PASS**; Vite warns the main JS chunk is 705.09 kB (>500 kB). Build output was generated in an isolated directory; the normal `dist` output was not used. |
| `git diff --check` | **PASS** at implementation verification; rerun after documentation before review. |
| `npm.cmd run test:transactions-ui` | **PASS — 285 assertions, 0 failures**; mocked Admin POS/customer/payment workflows, responsive POS/customer flows, and browser/Vite shutdown completed. This does not test production APIs or database behavior. |
| `npm.cmd run test:reports-ui` | **FAIL — 15 assertions passed before the existing harness reported “Transaction backdrop did not cover the viewport.”** No source UI fix was made for this harness assertion. |
| `npm.cmd run test:suppliers-ui` | **PARTIAL — 10 assertions passed; one existing harness backdrop viewport assertion failed.** |
| `npm.cmd run test:inventory-ui` | **NOT VERIFIED**; Chrome failed during GPU process startup before workflow assertions. |
| `node server/scripts/staffFrontendTest.js` (Chrome and Edge attempts) | **NOT VERIFIED**; both browsers terminated the GPU process before the Staff harness connected and ran assertions. |

Browser scripts use unique timestamped screenshot run directories. This work did not overwrite prior screenshot files. Browser harnesses mock API responses; none validates live MySQL concurrency or production records. The full Staff browser workflow and the two failing Admin page backdrop assertions remain open acceptance checks.

## Database and release notes

- No schema or migration files were added or changed.
- No migration or database-writing integration script was run.
- No connection to production Aiven was made; process-local dummy environment values were used for the Node test suite.
- No deployment, staging, commit, or push occurred.
- Existing `tatus` was preserved and is not part of this implementation.
- Real MySQL transaction concurrency, stock/ledger reconciliation against seeded staging data, authenticated Admin/Staff end-to-end API integration, and browser verification of all seven Staff modules remain **NOT VERIFIED**.
- Do not treat the passing unit suite or build as production readiness. Resolve browser acceptance failures and perform the approved isolated staging reconciliation before a release decision.

## Changed project files

The implementation changed the following source, test, and harness files; this report is an additional dated evidence file:

```text
server/controllers/customerController.js
server/controllers/dashboardController.js
server/controllers/idempotencyController.js
server/controllers/operationalReportController.js
server/controllers/productController.js
server/controllers/stockInController.js
server/middleware/authorizeRoles.js
server/routes/customerRoutes.js
server/routes/dashboardRoutes.js
server/routes/paymentRoutes.js
server/routes/productRoutes.js
server/routes/reportRoutes.js
server/routes/salesRoutes.js
server/routes/stockInRoutes.js
server/routes/supplierRoutes.js
server/scripts/reportsFrontendTest.js
server/scripts/staffFrontendTest.js
server/tests/dashboardController.test.js
server/tests/operationalReportAccess.test.js
server/tests/rolePermissions.test.js
server/tests/staffCapability.test.js
server/tests/staffPosAccess.test.js
shared/permissions.js
src/layouts/ProtectedLayout.jsx
src/layouts/Sidebar.jsx
src/pages/CustomerCredits/CreditStats.jsx
src/pages/CustomerCredits/CustomerCredits.jsx
src/pages/CustomerCredits/CustomerLedger.jsx
src/pages/CustomerCredits/CustomerList.jsx
src/pages/Inventory/InflowRecords.jsx
src/pages/Inventory/StockInForm.jsx
src/pages/Staff/StaffDashboard.jsx
src/pages/Staff/StaffInventory.jsx
src/pages/Staff/StaffReports.jsx
src/pages/Staff/StaffSuppliers.jsx
src/routes/AppRoutes.jsx
src/services/productService.js
src/services/reportService.js
src/utils/constants.js
src/utils/rolePermissions.js
```

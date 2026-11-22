# Stage 2 Remediation Report

Date: 2026-11-21 (Asia/Manila)

## Audit record and scope correction

The supplied attachment contains the Stage 1 master audit prompt, not a completed findings register. This report therefore uses the F-01 through F-06 findings named in the approved Stage 2 request and verifies them against the repository. The explicit business correction supersedes the prompt's generic request to inspect delivery management: delivery is not a required module, and its absence is not a defect or readiness blocker.

## Scope corrections

- **F-01 Delivery management:** Removed from defects and production blockers. Delivery is explicitly out of scope. No delivery application code was added. Existing SQL artifacts are documented for operator review only.
- **Staff access:** Staff is restricted server-side to POS checkout and the catalog/customer operations required by checkout. Dashboard, analytics, reports, customer ledgers/payment history, payment posting, stock-in, suppliers, and sales monitoring require Admin. Product and customer lookup responses are reduced to checkout fields.

## Findings status

| Finding | Status | Remediation / remaining limit |
| --- | --- | --- |
| F-01 Delivery | Closed as out of scope | No delivery implementation. Existing SQL artifacts retained and documented. |
| F-02 Supplier payables | Deferred pending accounting rules | Stock-in cost is the agreed payable basis, but partial payment, overpayment, and correction rules have not been approved. No payable schema or financial writes were added. |
| F-03 Payment timestamps | Fixed for new writes | New payment writes convert the instant to Manila wall time before storing it in `DATETIME`. Tests cover both sides of Manila midnight. Existing payment rows were not rewritten because their original server timezone/provenance cannot be established without database inspection. |
| F-04 Report performance | Remediated in application paths | Sales and receivables list endpoints use bounded pages; reports use aggregate totals; historical credit uses a grouped payment join; dashboard product charts use grouped product/month queries. CSV export retrieves bounded pages sequentially. No production-sized database benchmark was available. |
| F-05 Migrations | Partially remediated; deployment check required | Fresh schema includes login MFA tables. A confirmation-gated, versioned runner verifies current core schema and safely tracks the additive MFA migration. Historical SQL migrations remain manual and are not replayed because they include destructive, data-dependent, or target-specific operations. No live schema was inspected. |
| F-06 Health/readiness | Fixed | `/api/health` remains liveness-only. `/api/ready` performs `SELECT 1` and returns a generic 503 without database details on failure. |

## Files changed

- `server/utils/manilaDateTime.js`, `server/controllers/paymentController.js`
- `server/controllers/reportController.js`, `server/routes/reportRoutes.js`
- `src/services/reportService.js`
- `src/pages/Reports/RevenueReport.jsx`, `src/pages/Reports/ReceivablesLedger.jsx`
- `src/pages/Shared/DataTable.jsx`
- `src/pages/Dashboard/SalesChart.jsx`, `src/pages/Dashboard/SalesByProductChart.jsx`, `src/pages/Dashboard/ProductSalesPerformanceChart.jsx`
- `server/app.js`
- `server/routes/customerRoutes.js`, `server/routes/dashboardRoutes.js`, `server/routes/paymentRoutes.js`, `server/routes/productRoutes.js`, `server/routes/reportRoutes.js`, `server/routes/salesRoutes.js`, `server/routes/stockInRoutes.js`, `server/routes/supplierRoutes.js`
- `server/controllers/customerController.js`, `server/controllers/productController.js`, `server/controllers/idempotencyController.js`
- `database/schema.sql`, `server/scripts/migrationRunner.js`, `server/scripts/migrate.js`, `server/package.json`
- `server/tests/manilaDateTime.test.js`, `server/tests/migrationRunner.test.js`, `server/tests/reportPagination.test.js`, `server/tests/staffPosAccess.test.js`, `server/tests/healthReadiness.test.js`, `server/tests/rolePermissions.test.js`
- `src/layouts/Sidebar.jsx`, `src/pages/Inventory/Inventory.jsx`, `src/pages/SupplierContracts/ProcurementChart.jsx` (lint cleanup)
- `docs/SYSTEM_ARCHITECTURE.md`, `docs/STAGE_2_REMEDIATION_REPORT.md`

Existing user changes to `src/pages/Reports/ReceivablesLedger.jsx` and `src/pages/Reports/RevenueReport.jsx` were preserved; this work retained their “Apply Filters” labels. The unrelated untracked `tatus` file was not changed.

## Migration and deployment instructions

1. For a **new installation**, provision the database, apply `database/schema.sql` to the intended schema, configure the backend environment, then run `npm --prefix server run migrate` as a dry run. The schema file selects `lcp_business_system`; align `DB_NAME` with that target.
2. For an **existing installation**, do not apply the fresh schema. Take and verify a restorable backup, inspect the current schema and existing migration history, and run the appropriate historical preflight/migration manually. The runner refuses an incomplete current core schema.
3. Review the dry-run output and target database identity. To apply the managed MFA schema migration, set `MIGRATION_CONFIRMATION` to `APPLY_SCHEMA_MIGRATIONS:<exact DB_NAME>` for that process and run `npm --prefix server run migrate -- --apply`.
4. The runner may create `schema_migrations` and the two MFA tables only. It will not modify business records. Inspect migration status after application and verify `/api/ready` before routing traffic.
5. For Vercel, configure the same database and SMTP variables already required by the application. Configure deployment health checks to use `/api/ready` for readiness and `/api/health` for liveness.

The historical SQL migrations are not registered in the new ledger and will not be automatically rerun or marked complete by this command. Their live state must be established against the intended database before deployment.

## Verification

- Unit and mocked HTTP tests: 135 passed, 0 failed across server, frontend utility/service, and POS page tests.
- `npm.cmd run lint`: passed.
- Production build: passed. Vite reported the large JavaScript chunk (678.61 kB minified; 189.31 kB gzip) and a 2.78 MB van image asset.
- Type checking: no type-check script is defined; the frontend is JavaScript/JSX.
- Browser screenshot tests: attempted in a temporary copy. Transaction UI timed out connecting to Chrome DevTools; reports and inventory UI tests encountered a WebSocket error; supplier UI test also references the absent `src/context/ThemeContext.jsx`. These are unverified UI paths, not passing tests. Existing screenshot artifacts in the repository were not overwritten.
- Live database integration tests and migration application were not run because no isolated local database was configured. No database was modified.
- No production data or credentials were used. No database migration was applied.

## Remaining checks

- Verify historical payment timestamps against the actual database before any normalization decision; no historical timestamp was shifted by this remediation.
- Confirm the current production schema matches the runner's required core schema and MFA migration state.
- Obtain supplier settlement/correction rules before designing payable tables or recording payments.
- Validate report response times and pagination behavior against representative staging-scale data.

## Prioritized follow-up plan

1. Before deployment, inspect the intended non-production database schema and migration state, take and verify a restorable backup, then exercise the documented migration procedure against that isolated target.
2. Obtain supplier settlement rules for partial payments, overpayments, and corrections. Only then design payable settlement records and reconciliation reports; stock-in cost remains the agreed payable basis.
3. Run browser workflows in an environment where the existing Chrome DevTools harness works, repair the supplier harness's stale `ThemeContext.jsx` import, and complete responsive UI checks.
4. Benchmark sales and receivables reports with representative large staging data and evaluate bundle/image optimization.

## Final production-readiness assessment

**Not ready to certify for production from this workspace evidence.** This is not due to delivery management: F-01 is explicitly closed as out of scope. The application unit/mocked API suite, lint, and production build pass, and the Staff POS API path is covered by mocked HTTP regression tests. However, production schema compatibility and migration execution were not verified against an isolated database, historical payment timestamp provenance was not inspected, report-scale performance was not benchmarked, and several browser tests could not complete. Supplier payable settlement rules also remain open, so payable settlement functionality is not implemented. No production data was used or modified.

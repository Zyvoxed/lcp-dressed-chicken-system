# Staff Reports UI: Admin Reference

## Admin structure inspected

The existing Admin Reports page has three primary tabs, an outer `reports-page page-stack` layout, and report views built with the shared Stats cards, DataTable, report headings, filter panels, pagination, and supported PageSkeleton variants. Its labels are Sales & Revenue Audit, Inventory Assets Valuation, and Credit Receivables Ledger.

## Staff differences corrected

The Staff page now has exactly three tabs:

1. Sales Activity Audit
2. Inventory Status
3. Customer Receivables Ledger

The separate Staff Stock-In report tab/subview has been removed. Staff can still access stock-in records through the existing Inventory & Stock In module. Staff tabs use the same CSS classes and icon/presentation patterns as the Admin tabs; the Staff wrapper supplies its own labels without changing the Admin tab component.

## Permissions and data

- Sales Activity Audit requests the Staff operational sales projection and shows sale references/dates, customer, products, quantities grouped by configured unit, payment type, and status. It omits monetary sales totals, costs, and profit data.
- Inventory Status uses the operational inventory projection for product, unit, available quantity, reorder level, and status only. No valuation or procurement fields are requested.
- Customer Receivables Ledger uses operational receivables data and the existing read-only customer credit/payment endpoints for selected-customer details. It exposes no adjustment, edit, reversal, deletion, or payment-recording action.
- Search, sales date/payment/status filters, pagination, and CSV export use the operational report paths and existing Staff capabilities. The Staff page does not call the unrestricted Admin report APIs.
- Existing backend authorization and response allowlists remain responsible for enforcing the Staff boundary; no backend or route changes were needed for this UI correction.

## Runtime error

The previous blank-screen error came from passing unsupported `variant="report"` to `PageSkeleton`. Staff Reports now uses the supported `report-sales`, `report-inventory`, and `report-receivables` variants.

## Files changed by this task

- `src/pages/Staff/StaffReports.jsx`
- `src/pages/Staff/StaffReports.test.js`
- `server/scripts/staffFrontendTest.js` (Staff Reports assertions only)
- `docs/audits/staff-implementation/STAFF_REPORTS_UI_ADMIN_REFERENCE.md`

## Admin file protection

The following protected Admin report source, style, and controller files were present in the initial Git status. `src/pages/Reports/ReportsTabs.jsx` already had an uncommitted change before this task; that pre-existing change was preserved. SHA-256 hashes for all protected files were recorded before the task's edits and checked again afterward; all hashes matched. The only protected file appearing in the initial and final Git diff is that pre-existing `ReportsTabs.jsx` change. No protected file was edited by this task. No Admin route, calculation, query, or export behavior was changed.

## Verification

- Full `node --test` with process-local dummy DB/JWT values: **250 passed, 0 failed, 0 skipped, 0 cancelled**. No production database was contacted.
- `node --test src/pages/Staff/StaffReports.test.js`: **1 passed, 0 failed**. It verifies the loading skeleton, exactly three Staff tabs, Staff labels, no Stock-In report tab, and original Admin tab labels.
- `npm.cmd run lint`: **passed**.
- `npm.cmd run build -- --outDir <temporary directory>`: **passed**. Vite warned that the JavaScript bundle is 721.77 kB. Temporary build output was removed.
- `git diff --check`: reports a pre-existing blank line at `src/styles/pages/Dashboard.css:2465`, outside this task.
- `node server/scripts/staffFrontendTest.js`: **not verified**. Chrome exited before DevTools `/json/version` discovery because its GPU process failed and its isolated DawnGraphiteCache reported a file-access conflict. No UI workflow assertions ran and no screenshot was written.

The server-side operational report and role-permission tests are included in the passing full test run and use deterministic stubs/fakes. Browser-level report interaction and responsive behavior remain unverified.

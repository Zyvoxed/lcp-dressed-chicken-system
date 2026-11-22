# Staff Reports Reuse of Admin Reports UI

## Implementation summary

Staff Reports now uses the same primary report tab component and shared Reports page presentation as Admin. `StaffReports.jsx` remains a role-specific wrapper so it can call the restricted operational APIs and display only Staff-approved fields. Admin continues to render the original three report components and the default Admin labels.

The shared tab component accepts an optional `staffMode` prop. The default remains the original Admin mode; Staff receives the labels Sales Activity Audit, Inventory & Stock Movement, and Customer Balances & Payments. The Staff page uses the existing Reports CSS classes, `StatCard`, `DataTable`, `StatusBadge`, empty states, and supported report skeletons. Its inventory tab has a nested Inventory Status / Stock-In Activity selector so both operational datasets remain reachable under the single shared primary tab.

## Staff data boundaries

- Sales uses `/api/reports/operational/sales` and its export route. The view and CSV include transaction reference/date, customer, products sold, quantities grouped by configured unit, payment type, and status. No sale amounts, costs, margins, or profit fields are requested or rendered.
- Inventory and Stock-In use the operational inventory and stock-in report routes. The view and CSV include product/category/unit, quantity/reorder/status, or delivery reference/date/supplier/product/received quantity/unit. Procurement values and inventory valuation are excluded.
- Customer balances use the operational receivables route. Selected customer history uses the existing read-only customer credits and payments endpoints. The detail panel has no edit, adjustment, reversal, or payment-recording action.
- Search is available on each report; supported sales and stock-in date filters and sales payment/status filters are sent to the server. Pagination follows operational report metadata. CSV export retrieves report pages through the operational export capability and serializes only the Staff allowlisted fields.
- Existing backend capability middleware and allowlisted operational projections remain the security boundary. Staff Reports does not call Admin report endpoints.

## Loading and error handling

The initial Staff Reports state renders the supported `report-sales` skeleton, and the other report views use the existing supported report skeleton variants. The blank-screen exception was caused by the unsupported `variant="report"` value. Failed requests render an inline error and retry action; empty responses render the shared empty state. The loading regression test also checks that the three Staff labels render and that the default shared navigation still contains the original Admin labels.

## Admin preservation

`Reports.jsx`, `RevenueReport.jsx`, `InventoryValuation.jsx`, `ReceivablesLedger.jsx`, and the Admin report controller/routes were not changed for this UI reuse. `ReportsTabs` defaults to Admin mode, preserving its original tab names and selection behavior. The Staff wrapper calls only operational report routes and read-only customer credit/payment routes.

## Files changed for this batch

- `src/pages/Staff/StaffReports.jsx` — Staff-only composition, filters, tables, safe exports, and read-only customer detail.
- `src/pages/Staff/StaffReports.test.js` — loading skeleton and Admin/Staff tab-label regression assertions.
- `src/pages/Reports/ReportsTabs.jsx` — optional Staff mode while preserving the default Admin presentation.
- `src/utils/constants.js` — Staff tab label list shared with the tab component.
- `server/scripts/staffFrontendTest.js` — browser assertions updated for three primary tabs, the inventory subview, read-only customer details, filters, errors, and CSV export.
- `docs/audits/staff-implementation/STAFF_ADMIN_REPORTS_UI_REUSE.md` — this implementation record.

The operational report controller, its capability routes, and its API projection tests already existed in the working tree and were reused; they were not changed as part of this UI reuse work.

## Verification

- `node --test src/pages/Staff/StaffReports.test.js`: **1 passed, 0 failed**.
- Full `node --test` with process-local dummy DB/JWT environment values: **250 passed, 0 failed, 0 skipped, 0 cancelled**. This is the repository's fake/stubbed automated suite; no production database was contacted.
- `npm.cmd run lint`: **passed**.
- `npm.cmd run build -- --outDir <temporary directory>`: **passed**. Vite emitted a large-chunk warning (722.68 kB JS bundle). Temporary build output was removed.
- `git diff --check`: **reports a pre-existing extra blank line at `src/styles/pages/Dashboard.css:2465`**, unrelated to this implementation. No whitespace issue was reported in the Staff Reports changes.
- `node server/scripts/staffFrontendTest.js`: **not verified**. Chrome opened a DevTools listener briefly, then exited before `/json/version` discovery because its GPU process failed and its isolated `DawnGraphiteCache` reported a file-access conflict. Only the harness's two pre-browser assertions ran; no UI workflow assertion ran and no screenshot was written. The harness created a unique run directory; it did not target existing screenshot files.

## Remaining limits

Browser-level navigation, responsive rendering, live API behavior, and export download behavior remain unverified because Chrome did not stay running. Backend route and field restrictions are covered by automated tests, but those tests use deterministic fake database connections. No migration, production database access, or database write occurred.

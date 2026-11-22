# Staff Reports and View Credits Modal

## Issues found and corrections

- The earlier loading exception was caused by Staff Reports passing the unsupported skeleton variant `report`. The Staff page uses supported `report-sales`, `report-inventory`, and `report-receivables` variants and keeps an error/retry state if an operational request fails.
- The receivables row's credit action previously expanded credit and payment history inline below the report. That moved attention away from the selected customer and did not provide dialog keyboard/focus behavior or a dedicated retry/loading view. It now opens a modal over the mounted report page.
- The earlier detail fetch did not cancel requests when customer selection closed or changed. The modal validates the selected customer ID and aborts all customer-scoped read requests when it unmounts, preventing a late response from replacing another customer's view.
- Staff Reports has exactly three tabs: Sales Activity Audit, Inventory Status, and Customer Receivables Ledger. There is no Stock-In Reports tab; Stock-In remains in the existing Inventory & Stock In module.

## Modal behavior and data

The modal is a Staff-specific component using the existing shared `Modal` primitive and LCP report table, status badge, empty state, and supported skeleton. It is titled **Customer Credit Details**, names the selected customer, and shows the current balance supplied by the operational receivables response. It counts open transactions from the backend-provided Unpaid and Partially Paid statuses without recalculating customer balances or payment allocations.

It loads:

- `GET /api/customers/:id` for the selected customer's current balance from the Staff-safe customer projection.
- `GET /api/customers/:id/credits` for credit sale reference, original date/amount, amount paid, remaining balance, and stored status.
- `GET /api/customers/:id/payments` for payment reference, related sale reference, date, amount, and returned remaining balance.

These existing routes require authentication and the `customer.balance.read` / `customer.payment.read` Staff capabilities. No Admin receivables endpoint is called. The APIs do not return a payment method, so the modal does not display one. The Staff customer endpoint also does not return a server-calculated total-paid summary, so the modal lists returned payment history instead of summing payments independently. No edit, payment recording, deletion, reversal, or adjustment control is present. A failed request shows an error with retry; empty credit and payment lists have separate empty states.

The shared modal supplies dialog semantics, Escape and close-button dismissal, focus trapping/restoration, body scroll locking, and a backdrop that blocks background pointer interaction without dismissing the dialog on an incidental outside click. The report component stays mounted while the portal is open, preserving tab, search/filter state, pagination, and scroll position.

## Reports and security

The reports continue to use only Staff operational report routes and allowlisted response fields. Sales display/export excludes revenue, costs, and profitability. Inventory display/export excludes valuation and acquisition costs. Customer receivables remain read-only. Existing capability tests cover the Staff operational report and customer credit/payment permissions; Admin report routes remain role-restricted.

## Files changed

- `src/pages/Staff/StaffReports.jsx` — opens the View Credits modal without navigation and keeps report state mounted.
- `src/pages/Staff/StaffCustomerCreditsModal.jsx` — read-only data retrieval, summary, credit/payment tables, and modal states.
- `src/pages/Staff/StaffCustomerCreditsModal.css` — scoped responsive modal sizing and summary/table layout.
- `src/pages/Staff/StaffReports.test.js` — Staff loading/tab regression assertions.
- `server/scripts/staffFrontendTest.js` — browser scenarios for modal details, error/retry, read-only controls, Escape, focus restoration, and report-state preservation.
- `docs/audits/staff-implementation/STAFF_REPORTS_VIEW_CREDITS_MODAL_FIX.md` — this record.

No backend source, route, schema, migration, Admin report file, or Admin controller was changed for this task.

## Verification

- Full `node --test` with process-local dummy DB/JWT values: **250 passed, 0 failed, 0 skipped, 0 cancelled**. No production database was contacted.
- Focused Staff loading/tab regression: **1 passed, 0 failed**.
- Focused operational report, role-permission, and customer credit tests: **10 passed, 0 failed**.
- `npm.cmd run lint`: **passed**.
- `npm.cmd run build -- --outDir <temporary directory>`: **passed**. Vite warned about a 723.70 kB JavaScript chunk. Temporary build output was removed.
- `git diff --check`: reports the pre-existing extra blank line at `src/styles/pages/Dashboard.css:2465`, outside this task.
- `node server/scripts/staffFrontendTest.js`: **NOT VERIFIED**. Chrome opened a DevTools listener briefly, then exited during GPU startup with a DawnGraphiteCache file-access conflict before `/json/version` discovery. The UI/modal assertions did not run and no screenshot was written; its run directory was unique.

The modal flow, Escape/focus restoration, retry, and responsive interaction are covered in the updated browser harness but remain unverified at runtime until Chrome starts successfully. Backend permission tests use fake database calls and confirm the existing capability boundaries; there were no migrations or database writes.

## Admin preservation

The protected Admin report files were hashed before and after the task. `src/pages/Reports/ReportsTabs.jsx` already had an uncommitted change at the start of the task; it was preserved. The hashes remained unchanged and no other protected Admin file was edited. Existing unrelated working-tree changes were preserved.

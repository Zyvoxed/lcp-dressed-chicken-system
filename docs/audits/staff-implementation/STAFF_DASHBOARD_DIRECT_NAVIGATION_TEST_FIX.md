# Staff Dashboard Direct Navigation Test Fix

## Root cause

`staffFrontendTest.js` navigated from Staff Reports to the restricted `/business-analytics` path and waited only for the URL to become `/dashboard` and for any `.staff-dashboard` element to exist. Those conditions could match during a page transition. `ProtectedLayout` correctly redirected the Staff user, but `StaffDashboard` initially renders the existing loading skeleton while its authorized dashboard and inventory requests resolve. During that interval the dashboard section is not mounted. The test then dereferenced `.textContent` on a null selector.

The failure was reproduced under Chrome 158. The captured URL was `/dashboard`; the DOM showed the Staff shell and `Loading operational dashboard`, with no `.staff-dashboard` element. The Runtime evaluation stack pointed to the test assertion, not application code. Captured browser logs had no application JavaScript error; the only error-level network messages were missing `/favicon.ico` requests from the temporary test harness.

## Fix

- Changed only `server/scripts/staffFrontendTest.js`.
- Wait for a loaded Staff dashboard snapshot to remain true for three consecutive polling samples before asserting. This excludes transient exiting pages and the valid loading skeleton.
- Keep the restricted `/business-analytics` navigation test and verify it settles on `/dashboard` with Staff dashboard content and no Admin Business Analytics component.
- Add separate checks for direct navigation to `/dashboard` and refreshing that page, both using the same stable loaded-state assertion.
- Capture useful browser console, Runtime exception, URL, and DOM details if a future browser evaluation fails.
- No application route, authentication, permission, or dashboard code changed.

## Verification

- Staff dashboard browser test: **25 assertions passed** in five consecutive stress runs; repeated once after the final diagnostic-handler lint fix, also passing 25 assertions. Coverage includes restricted-route redirect, direct dashboard navigation, and page refresh.
- Staff suppliers browser suite: **25 passed**.
- Admin/Inventory browser suite: **272 passed**.
- Admin transaction browser suite: **285 passed**.
- Admin reports browser suite: **29 passed**.
- Admin suppliers browser suite: **31 passed**.
- Backend unit tests: **200 passed, 0 failed** using test-only loopback configuration; no database connection was made.
- ESLint: **passed**.
- Production build: **passed**; Vite retains its 738.82 kB JavaScript chunk advisory.
- `git diff --check`: **passed**.

No database schema or migration changes are needed. No migration was executed, and production Aiven was not accessed. Live Aiven compatibility and financial reconciliation remain **NOT VERIFIED**.

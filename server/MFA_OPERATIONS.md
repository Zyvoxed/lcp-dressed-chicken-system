# Gmail MFA provisioning and recovery

This runbook is for an authorized owner/operator. It does not create a public registration path, issue a JWT, or disable MFA.

## Initial Admin provisioning

1. On a controlled operator machine, configure the backend database connection and existing SMTP sender settings. Do not put these values in frontend `VITE_` variables or commit them.
2. Set `ADMIN_FULLNAME`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`, and optionally `ADMIN_CONTACT` in the operator environment. `ADMIN_EMAIL` must be an address the owner can access.
3. Run `npm --prefix server run create-admin`. The CLI inserts an Admin with `email_verified_at` left unset, issues a single-use email-verification link through the existing verification service, and sends it through the configured SMTP service. It does not authenticate the Admin.
4. The owner opens the link and completes `/verify-email`. Only then can the owner sign in with the password and complete the normal Gmail OTP flow.

The `email_verification_tokens` table and existing recovery-email schema must already be present. If delivery fails, the account remains unverified. Correct SMTP configuration and use the controlled recovery procedure below to issue a new verification link; never set `email_verified_at` manually.

## Sole Admin email recovery

Use this procedure only after an operator independently verifies the owner's identity and documents the case. It requires controlled shell access and the backend database credentials; there is no recovery HTTP endpoint.

1. Obtain the database credentials from the approved secret store and run the CLI only from an authorized, controlled machine. Confirm the backend environment targets the intended database before running it.
2. Set `ADMIN_RECOVERY_USERNAME` to the exact active Admin username, `ADMIN_RECOVERY_EMAIL` to the newly accessible address (the app will still require link verification), and `ADMIN_RECOVERY_OPERATOR` to the operator name or case reference. Supply these as temporary process-scoped variables; do not save them in `.env` or Vercel settings, and clear them after the run.
3. Set `ADMIN_RECOVERY_CONFIRMATION` to the exact string `RECOVER_ADMIN_EMAIL:<username>` for the selected account.
4. Run `npm --prefix server run recover-admin-email`.
5. The CLI accepts only an active Admin. It changes that account's email to the requested address, sets `email_verified_at` to `NULL`, increments `auth_version` to invalidate prior sessions, invalidates outstanding email-verification links, issues a new verification link, and writes an `ADMIN_EMAIL_RECOVERY_REQUESTED` activity log entry. It does not change the password, role, or active status and does not create a JWT.
6. The owner completes the emailed verification link, then signs in through password plus Gmail OTP. If the verification message cannot be delivered, the address remains unverified and the CLI reports failure; fix SMTP and repeat the controlled procedure after the existing verification-email cooldown permits it.

The operator must not set `email_verified_at` directly, disable MFA, mint an MFA-verified token, or expose these CLI variables through an HTTP route. If the SMTP sender itself is inaccessible, restore the sender through the organization’s Google account recovery process before issuing the owner verification link.

## Vercel client-IP and rate-limit check

The app calls Express `request.ip`. `server/app.js` trusts forwarded addresses only when `TRUSTED_PROXIES` contains explicit proxy addresses or CIDRs; the example default is empty. With an empty value, Express uses the socket peer, which may be a shared platform proxy rather than the end user. Do not set `TRUSTED_PROXIES=*` or trust arbitrary `X-Forwarded-For` values.

Before rollout, inspect the actual Vercel-to-Express request path for this project and determine the direct trusted proxy hop(s) and their supported address/CIDR values. Set the backend `TRUSTED_PROXIES` environment variable to only those verified values, then validate in the deployed environment that `request.ip` matches the expected client IP while forged forwarding headers do not change it. Do not copy an assumed range or hop count from another deployment. The account- and challenge-keyed MySQL limits remain active independently of IP-based limits.

## Rate-limit window choice

Login limits use fixed 15-minute buckets and challenge/resend limits use hourly buckets. A request burst can straddle a bucket boundary, briefly allowing requests from both adjacent buckets. The per-account limits, per-challenge five-attempt cap, row locks, and single-use consumption still bound MFA guessing. The current fixed-window design is retained to avoid adding storage or query complexity; validate thresholds and client-IP behavior in staging.

## Migration and rollback

The MFA migration and rollback are manual SQL artifacts. Before any separately approved application, verify the live Aiven `users.user_id` type/signedness and table engine. Rollback uses `DROP TABLE IF EXISTS` only for `login_mfa_rate_limits` and `login_mfa_challenges`; it removes MFA challenge and throttle state and does not target business tables.

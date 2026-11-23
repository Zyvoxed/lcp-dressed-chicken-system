# Important Algorithms of the LCP Dressed Chicken Trading Management System

This document is a static source audit of the repository as inspected on 2026-11-23. Source excerpts reproduce complete named functions unless explicitly labeled as a contiguous excerpt. Explanatory comments are inserted only in the documentation copies and do not modify application code. No production records were accessed and no tests were executed during this audit. Runtime and concurrency behavior therefore remain subject to the verification limits below.

## 1. Authentication and Security

### Password Authentication and MFA Challenge

Module: Admin and Staff sign-in<br>
Source File: `server/controllers/authController.js`<br>
Function: `login` (lines 21–101), with `verifyLoginMfa` (103–148); challenge implementation in `server/services/loginMfaService.js`<br>
Importance: CRITICAL<br>
Purpose: Rate-limits a login attempt, looks up the account, verifies its state and password, requires a verified email, then sends a one-time MFA challenge. A session JWT is issued only after challenge consumption.

#### Actual Source Code with Comments

```js
export async function login(request, response) {
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''

  if (!username || !password) {
    return response.status(401).json(invalidCredentials)
  }

  try {
    response.set('Cache-Control', 'no-store')
    // Apply configured limits before password hashing/comparison work.
    await enforceLoginRateLimits({ username, ipAddress: getRequestIp(request) })
    const [users] = await pool.execute(
      `SELECT user_id, fullname, username, password, role, is_active, auth_version,
              email, email_verified_at
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username],
    )
    const user = users[0]

    if (!user) return response.status(401).json(invalidCredentials)
    if (!user.is_active) return response.status(403).json({ success: false, message: 'This account is inactive' })

    // bcrypt compares the submitted password with the stored password hash.
    const passwordMatches = await bcrypt.compare(password, user.password)
    if (!passwordMatches) return response.status(401).json(invalidCredentials)
    if (!user.email || !user.email_verified_at) {
      return response.status(403).json({
        success: false,
        message: 'This account needs an active, verified email address. Contact an administrator.',
      })
    }

    // Challenge details are stored by the MFA service; email delivery failure invalidates it.
    const challenge = await createLoginChallenge(user, getRequestIp(request))
    try {
      await sendLoginMfaCode({
        email: user.email,
        code: challenge.code,
        expiryMinutes: environment.mfa.otpExpiryMinutes,
      })
    } catch {
      await invalidateLoginChallenge(challenge.challengeId)
      return response.status(503).json({ success: false, message: 'Unable to send the verification code. Please try again later.' })
    }

    return response.json({
      success: true,
      message: 'A verification code was sent to your registered email address.',
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to authenticate user:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to complete login' })
  }
}

export async function verifyLoginMfa(request, response) {
  response.set('Cache-Control', 'no-store')
  try {
    // consumeLoginChallenge checks and consumes the OTP before the signed session is created.
    const user = await consumeLoginChallenge({
      challengeId: request.body?.challengeId,
      code: request.body?.code,
      ipAddress: getRequestIp(request),
    })
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        auth_version: Number(user.auth_version || 0),
        mfa_verified: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    )
    // Activity recording is best-effort and does not block successful sign-in.
    pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'LOGIN', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `${user.username} logged in`],
    ).catch((error) => console.error('Unable to record login activity:', error.message))

    return response.json({
      success: true,
      message: 'Login successful',
      token,
      user: { user_id: user.user_id, fullname: user.fullname, username: user.username, role: user.role },
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to verify login code:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to verify the code. Please try again.' })
  }
}
```

#### Algorithm Explanation

The login algorithm normalizes the username, rejects missing credentials, and invokes the rate limiter before querying the account. It returns a generic authentication failure for an unknown username or an incorrect password, rejects inactive accounts, and requires a verified email address. For eligible accounts, it creates a server-side MFA challenge and sends its code by email; if delivery fails, it invalidates the challenge. The verification endpoint consumes a valid challenge before signing an eight-hour JWT that includes the account role, authentication version, and MFA verification claim. Complete controller and MFA service functions are included in Appendix A, sections A7 and B7.

#### Audit Findings

- Informational: `server/routes/authRoutes.js` leaves login, MFA verification, resend, and logout public as expected; authenticated endpoints use `authenticate`.
- Medium: `logout` in `authController.js` records an event but does not revoke the JWT on the server. A copied token can remain usable until expiry unless its user auth version is changed. Verification status: source inspection only.
- Informational: login activity insertion is deliberately best effort; sign-in may succeed without a corresponding log row.

### Current Session Validation and Route Authorization

Module: Shared security for Admin and Staff<br>
Source File: `server/middleware/authenticate.js` lines 5–52; `server/middleware/authorizeRoles.js` lines 3–30; route access in `server/routes/*.js`<br>
Function: `authenticate`, `authorizeRoles`, `authorizeCapability`<br>
Importance: CRITICAL<br>
Purpose: Verify bearer JWTs, compare account state with current database state, require MFA, then enforce role or capability checks.

#### Actual Source Code with Comments

```js
export default async function authenticate(request, response, next) {
  const authorization = request.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return response.status(401).json({ success: false, message: 'Authentication required' })
  }
  const token = authorization.slice(7).trim()
  if (!token) return response.status(401).json({ success: false, message: 'Authentication required' })

  try {
    // Signature/expiry verification is followed by a live account-state check.
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const [users] = await pool.execute(
      `SELECT role, is_active, auth_version FROM users WHERE user_id = ? LIMIT 1`,
      [payload.user_id],
    )
    const user = users[0]
    // Role/status/version changes and tokens without a completed MFA claim are rejected.
    if (!sessionMatchesUser(payload, user) || !sessionMatchesMfa(payload)) {
      return response.status(401).json({ success: false, message: 'Invalid or expired token' })
    }
    request.user = payload
    return next()
  } catch {
    return response.status(401).json({ success: false, message: 'Invalid or expired token' })
  }
}
```

#### Algorithm Explanation

The middleware extracts a bearer token, verifies its JWT signature and expiration, loads the referenced user's current role, active state, and authentication version, and checks these values against the claims through `authSessionService.js`. It separately requires the MFA claim, then attaches the verified claims to the request. Subsequent route middleware applies role allow-lists or a shared role-to-capability mapping. Route definitions should be consulted alongside this function because authorization is configured per endpoint.

#### Audit Findings

- Informational: SQL values use placeholders. The route files inspected apply role/capability restrictions to protected resource paths; `userRoutes` is Admin-only.
- Medium: logout itself only audits; effective invalidation relies on expiration or changing `auth_version`. No token deny-list is implemented in this flow.

## 2. Dashboard

### Admin Business Product Ranking

Module: Admin dashboard / business analytics<br>
Source File: `server/controllers/dashboardController.js` lines 256–297<br>
Function: `rankBusinessProducts`<br>
Importance: IMPORTANT<br>
Purpose: Derive product rankings and percentage shares from the sales aggregates supplied by the dashboard query.

#### Actual Source Code with Comments

```js
export function rankBusinessProducts(products) {
  const ranked = [...products].sort((left, right) => {
    const amountDifference = Number(right.total_sales) - Number(left.total_sales)
    return amountDifference || Number(right.quantity_sold) - Number(left.quantity_sold)
  })
  const totalSales = ranked.reduce((sum, product) => sum + Number(product.total_sales || 0), 0)
  return ranked.map((product, index) => ({
    ...product,
    rank: index + 1,
    sales_share: totalSales > 0 ? Number(product.total_sales || 0) / totalSales * 100 : 0,
  }))
}
```

#### Algorithm Explanation

The function copies the input collection, sorts products by descending sales amount, and uses quantity sold as a secondary key when sales amounts tie. It sums sales across the resulting list, then adds a one-based rank and each product's percentage share; when aggregate sales are zero, the share is zero. The source does not show a rounding step for percentages.

#### Audit Findings

- Informational: This ranking depends on the query and date window built in `getBusinessAnalytics`; it is not a stand-alone source of truth for sales.
- Medium: Amounts are converted to JavaScript `Number` for ranking and share calculation. Very large aggregates or binary floating-point precision should be considered when interpreting display values. No dedicated ranking test was executed.

Dashboard data retrieval is implemented in `getStaffDashboardData`, `getAdminDashboardData`, `getStaffSalesActivity`, `getDashboard`, and `getBusinessAnalytics` in `server/controllers/dashboardController.js` (lines 6–255 and 299 onward). These functions use SQL aggregates and calendar helpers (`manilaCalendar`, `fillSeries`, `manilaDateKey`, `shiftCalendarDate`). The dashboard's exact calculations are query-driven; no calculation not present in those queries is claimed here. Staff-specific views are under `src/pages/Staff/StaffDashboard.jsx`.

## 3. Point of Sale

### FIFO Stock Batch Locking and Allocation

Module: Admin and Staff point of sale<br>
Source File: `server/controllers/salesController.js` lines 71–102<br>
Function: `lockEligibleStockBatches`, `sumAvailableBatchQuantity`, `calculateFifoAllocations`<br>
Importance: CRITICAL<br>
Purpose: Lock positive-balance batches in delivery-date order and allocate a requested quantity from the oldest batch forward.

#### Actual Source Code with Comments

```js
async function lockEligibleStockBatches(connection, productId) {
  // Lock every positive-quantity batch for this product in FIFO order.
  const [batches] = await connection.execute(
    `SELECT stockin_id, remaining_quantity, cost_price, delivery_date
     FROM stock_in
     WHERE product_id = ? AND remaining_quantity > 0
     ORDER BY delivery_date ASC, stockin_id ASC
     FOR UPDATE`,
    [productId],
  )
  return batches
}

function sumAvailableBatchQuantity(batches) {
  return batches.reduce((sum, batch) => sum + Number(batch.remaining_quantity), 0)
}

function calculateFifoAllocations(batches, requestedQuantity) {
  let quantityRemaining = requestedQuantity
  const allocations = []
  // Iterate oldest-first; each batch contributes no more than its remaining quantity.
  for (const batch of batches) {
    if (quantityRemaining <= 0) break
    const deduction = Math.min(quantityRemaining, Number(batch.remaining_quantity))
    allocations.push({ batch, quantity: deduction.toFixed(3) })
    // Normalize each remainder to the system's three-decimal quantity scale.
    quantityRemaining = Number((quantityRemaining - deduction).toFixed(3))
  }
  return allocations
}
```

#### Algorithm Explanation

For each product in a sale, the database query selects only batches with positive remaining stock, orders them by delivery date and then batch identifier, and locks those rows for the surrounding transaction. The allocation function walks this ordered list, deducts the lesser of the outstanding request and the batch balance, stores each allocation at three decimal places, and stops after satisfying the request or exhausting the list. Availability is separately summed and checked by `prepareSaleItems` before persistence.

#### Audit Findings

- Informational: Ordering and locking are explicit. `prepareSaleItems` also locks the aggregate product row; item IDs are normalized and sorted to reduce deadlock risk.
- Medium: `sumAvailableBatchQuantity` adds decimal quantities as binary floating-point `Number`. Values are constrained to three decimals, but integer-thousandths arithmetic would make the comparison exact. Static source inspection only; no concurrency test was run.

### Sale Validation, Pricing, and Payment Amounts

Module: Admin and Staff point of sale<br>
Source File: `server/controllers/salesController.js` lines 31–225<br>
Function: `normalizeItems`, `normalizeSaleRequest`, `prepareSaleItems`, `calculateSaleAmounts`<br>
Importance: CRITICAL<br>
Purpose: Validate product IDs and quantities, take authoritative prices from active products, calculate sale line totals in cents, and enforce cash/credit payment rules.

#### Actual Source Code with Comments

```js
function calculateSaleAmounts(paymentType, totalCents, amountPaidCents) {
  // A payment cannot be greater than the calculated transaction total.
  if (amountPaidCents > totalCents) throw new SaleError(400, 'Amount paid cannot exceed the sale total')
  // Cash transactions must be fully paid at the point of sale.
  if (paymentType === 'Cash' && amountPaidCents < totalCents) {
    throw new SaleError(400, 'Cash payment must cover the full sale total')
  }
  const remainingCents = totalCents - amountPaidCents
  return {
    remainingCents,
    status: remainingCents === 0n ? 'Paid' : amountPaidCents > 0n ? 'Partially Paid' : 'Unpaid',
    totalAmount: centsToAmount(totalCents),
    paidAmount: centsToAmount(amountPaidCents),
    remainingBalance: centsToAmount(remainingCents),
  }
}
```

#### Algorithm Explanation

The caller rejects unsupported payment types, client-supplied price fields, duplicate products, malformed or out-of-range quantities, and credit sales without a customer. It fetches each product's registered selling price under a row lock and checks both aggregate inventory and the sum of locked batches. The money helper converts amounts into integer cents and computes each line total using quantity thousandths; the total is accumulated as a `BigInt`. Finally, `calculateSaleAmounts` rejects overpayment and underpaid cash sales, computes the unpaid remainder, and assigns Paid, Partially Paid, or Unpaid status.

#### Audit Findings

- Informational: Client prices are expressly rejected; DB price is used. Decimal input is bounded by `decimalValidation.js`.
- Medium: Calculation rounds each line total independently to cents, then sums those rounded lines. This behavior should be documented in the manuscript and confirmed as the intended accounting rule.

### Sale Persistence and Transaction Recovery

Module: Admin and Staff point of sale<br>
Source File: `server/controllers/salesController.js` lines 227–251 and 267–410<br>
Function: `persistSaleItems`, `createSale`<br>
Importance: CRITICAL<br>
Purpose: Persist a sale, its items and FIFO deductions, customer credit balance change, activity record, and idempotent response in one transaction.

#### Actual Source Code with Comments

The implementation is too large to reproduce in this short audit section without making the excerpt difficult to review. The complete, contiguous source function is `createSale` at lines 267–410; the complete item persistence function is at lines 227–251. Key persisted operations are: insert sale row; insert each sales item; decrement selected stock batches and write allocation history; decrement product aggregate stock and update status; increment customer balance for unpaid credit; insert activity log; save response for idempotent replay; commit. On failures, `resolveTransactionFailure` decides rollback/reusability and ambiguous commit outcomes are reported as unknown. All SQL values are parameterized.

#### Algorithm Explanation

`createSale` validates and canonicalizes the request before obtaining a connection. It begins a transaction, reserves the request key, locks an active customer when present, prepares and locks products and batches, computes prices and balances, and writes sale and inventory records. It writes an audit event and stores the success response before committing so retries can recover the result. A duplicate reservation triggers a lookup and either returns the saved response, rejects a payload mismatch, or reports an uncertain outcome. `resolveTransactionFailure` in `server/utils/transactionFailure.js` is a critical dependency that decides whether a rollback is safe and whether the connection can be reused.

#### Audit Findings

- Informational: Sale rows, batch deductions, aggregate stock, customer credit, activity entry, and replay record share one transaction boundary.
- Medium: Inventory aggregate availability is checked using a JS number and FIFO batch total is separately summed; any pre-existing mismatch is rejected rather than reconciled.
- Medium: `ER_DUP_ENTRY` that is not identified as the named idempotency reservation conflict is treated as an unknown outcome by this controller. This is cautious but requires operator recovery guidance.
- Verification status: Source reviewed; transaction and FIFO tests exist in `server/tests/salesFifoAllocation.test.js`, `salesPaymentInvariants.test.js`, `idempotentTransactions.test.js`, and `transactionFailure.test.js`, but were not executed for this audit.

## 4. Inventory and Stock In

### Inventory Status Calculation

Module: Inventory and stock-in<br>
Source File: `server/controllers/stockInController.js` lines 125–134<br>
Function: `calculateInventoryStatus`<br>
Importance: CRITICAL<br>
Purpose: Calculate the post-delivery stock status and reject stock that exceeds the configured quantity ceiling.

#### Actual Source Code with Comments

```js
function calculateInventoryStatus(product, quantityReceived) {
  // Add the incoming delivery to the locked product quantity.
  const newStock = Number(product.stock_quantity) + quantityReceived
  if (!Number.isFinite(newStock) || newStock > decimalLimits.quantity) {
    throw new RequestError(400, `Resulting product stock must not exceed ${decimalLimits.quantity}`)
  }
  // Status thresholds use the product's configured reorder level.
  const reorderLevel = Number(product.reorder_level)
  const status = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
  return status
}
```

#### Algorithm Explanation

The function adds received quantity to the product's stored stock quantity. It rejects non-finite values and values above the shared quantity maximum. A resulting quantity at or below zero is Out of Stock; a positive quantity at or below reorder level is Low Stock; all other quantities are Available. `createStockIn` calls this after locking the active product and before persisting the batch.

#### Audit Findings

- Medium: This status calculation uses floating-point addition. All input quantity scales are limited to three decimal places, though integer-thousandths arithmetic would avoid floating-point edge cases.

### Atomic Stock-In Recording

Module: Inventory and stock-in<br>
Source File: `server/controllers/stockInController.js` lines 47–102, 104–192, 194–297<br>
Function: `prepareStockInRequest`, `lockActiveSupplier`, `lockActiveProduct`, `persistStockIn`, `createStockIn`<br>
Importance: CRITICAL<br>
Purpose: Validate an incoming delivery, create a FIFO batch, increment aggregate quantity, update status, log the action, and save an idempotent response atomically.

#### Actual Source Code with Comments

```js
async function persistStockIn(connection, request, stockIn) {
  // Create the batch with full received quantity available for future FIFO deduction.
  const [result] = await connection.execute(
    `INSERT INTO stock_in (
       supplier_id, product_id, user_id, quantity_received, remaining_quantity,
       cost_price, total_cost, delivery_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [stockIn.supplierId, stockIn.productId, request.user.user_id,
      stockIn.quantityValue, stockIn.quantityValue, stockIn.costValue,
      stockIn.totalCost, stockIn.deliveryDate],
  )
  // Keep aggregate inventory and its derived status in step with the batch history.
  await connection.execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?',
    [stockIn.quantityValue, stockIn.productId])
  await connection.execute('UPDATE products SET status = ? WHERE product_id = ?',
    [stockIn.status, stockIn.productId])
  await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, 'STOCK_IN_CREATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [request.user.user_id, `Stock-In ${result.insertId} created for product ${stockIn.productId}`],
  )
  return result.insertId
}
```

#### Algorithm Explanation

`prepareStockInRequest` validates positive supplier and product identifiers, quantity precision and range, cost precision and range, delivery date, and total cost, then builds a normalized payload hash. The transaction reserves the idempotency key, locks active supplier and product rows, calculates resulting product status, inserts a batch whose remaining quantity starts equal to the received quantity, increments aggregate product stock, updates status, and records activity. It stores the response and commits all writes together. Conflict recovery follows the same replay/unknown-outcome pattern as sales.

#### Audit Findings

- Informational: Product and supplier are locked and checked active within the transaction. The delivery date is checked against the business calendar through `shared/stockInDate.js`.
- Medium: User-visible inventory status is maintained in both stock-in and sales paths; the formulas appear consistent by source inspection but no runtime regression test was run.
- Verification status: `stockInDateValidation.test.js`, `paymentStockInRollback.test.js`, and `idempotentTransactions.test.js` exist but were not run.

## 5. Customer Credits and Payments

### Credit Payment Validation and Amount Calculation

Module: Customer credits and payments<br>
Source File: `server/controllers/paymentController.js` lines 58–100<br>
Function: `lockCreditSale`, `validateSaleOutstanding`, `lockAndValidateCustomerBalance`, `calculatePaymentAmounts`<br>
Importance: CRITICAL<br>
Purpose: Lock a credit sale, prevent excess payment, validate the customer's aggregate balance, and calculate the new sale-level balance and status.

#### Actual Source Code with Comments

```js
async function lockCreditSale(connection, saleId) {
  const [sales] = await connection.execute(
    `SELECT customer_id, payment_type, total_amount, amount_paid, remaining_balance, status
     FROM sales WHERE sale_id = ? LIMIT 1 FOR UPDATE`, [saleId])
  const sale = sales[0]
  if (!sale) throw new PaymentError(404, 'Sale not found')
  if (sale.payment_type !== 'Credit' || !sale.customer_id) {
    throw new PaymentError(400, 'Payments can only be recorded for customer credit sales')
  }
  return sale
}

function validateSaleOutstanding(sale, paymentCents) {
  const outstandingCents = toCents(sale.remaining_balance)
  if (outstandingCents <= 0n) throw new PaymentError(400, 'This sale is already fully paid')
  if (paymentCents > outstandingCents) throw new PaymentError(400, 'Payment exceeds the outstanding balance')
  return outstandingCents
}

async function lockAndValidateCustomerBalance(connection, customerId, paymentCents) {
  const [customers] = await connection.execute(
    'SELECT current_balance FROM customers WHERE customer_id = ? LIMIT 1 FOR UPDATE', [customerId])
  if (!customers[0]) throw new PaymentError(404, 'Customer not found')
  if (toCents(customers[0].current_balance) < paymentCents) {
    throw new PaymentError(409, 'The customer balance does not match this payment. Please contact the owner.')
  }
}

function calculatePaymentAmounts(sale, outstandingCents, paymentCents) {
  const newPaid = centsToAmount(toCents(sale.amount_paid) + paymentCents)
  const newRemainingCents = outstandingCents - paymentCents
  const newRemaining = centsToAmount(newRemainingCents)
  const paymentValue = centsToAmount(paymentCents)
  const status = newRemainingCents === 0n ? 'Paid' : 'Partially Paid'
  return { newPaid, newRemaining, paymentValue, status }
}
```

#### Algorithm Explanation

The payment flow selects and locks the sale row, verifies that it is a customer credit sale, converts its remaining balance to integer cents, and rejects a fully paid sale or a payment larger than the sale-level balance. It then locks the customer row and ensures the customer-level balance can cover the payment. The calculation increases the sale's paid amount, reduces its remaining amount, and updates status to Paid only when the remainder reaches zero. `recordPayment` calls these steps and persists sale, customer, payment, activity, and idempotency records in one transaction.

#### Audit Findings

- Informational: Sale and customer rows are locked in a consistent order within `recordPayment`; updates and history insertion are transactional.
- Medium: Customer balance validation checks only that the aggregate balance is at least this payment; it does not independently recompute the sum of all open sales. This is a consistency guard, not a full ledger reconciliation.
- Medium: `recordPayment` uses the shared transaction failure resolver and idempotency service; neither concurrency outcomes nor database isolation were exercised in this audit.

## 6. Supplier Management

Supplier operations are implemented in `server/controllers/supplierController.js`: `supplierDetails`, `lockSupplier`, `recordSupplierActivity`, `createSupplier`, `updateSupplier`, and `changeSupplierStatus` (with `archiveSupplier`/`restoreSupplier` wrappers). Routes in `server/routes/supplierRoutes.js` require authentication and Admin role for creation, updates, archive, and restore; reads use the `supplier.read` capability. Staff supplier activity calculations are implemented in `src/utils/staffSupplierMetrics.js` and rendered in `src/pages/Staff/StaffSuppliers.jsx`.

Importance: IMPORTANT. Source inspection shows SQL parameterization and explicit Admin route restrictions. Complete supplier controller functions are included in Appendix A, section B2. Supplier runtime behavior was not verified. Tests present but not executed: `supplierUpdate.test.js`, `supplierArchive.test.js`, `supplierStockInHistory.test.js`.

## 7. Reports

### Sales Filters and Pagination

Module: Admin and Staff reports<br>
Source File: `server/controllers/reportController.js` lines 12–104<br>
Function: `salesFilters`, `pagination`, `paginationMetadata`<br>
Importance: IMPORTANT<br>
Purpose: Validate report filters, build parameterized SQL conditions, and calculate bounded pagination metadata.

#### Actual Source Code with Comments

```js
function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const pageSize = query.page_size === undefined ? 25 : Number(query.page_size)
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid page size')
  // Reject an offset outside JavaScript's safe integer range before it reaches SQL.
  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid page')
  return { page, pageSize, offset }
}
```

#### Algorithm Explanation

`salesFilters` validates ISO calendar dates, date order, payment type, user ID, interactive status, and search length. It builds SQL predicates with bound values and separately snapshots the same predicates for an unpaginated summary query. `pagination` defaults to page 1 and 25 rows, caps page size at 100, and rejects unsafe offsets. `getSalesReport` uses these results for filtered rows, full-filter summary totals, and record counts.

#### Audit Findings

- Informational: Dynamic SQL values are parameterized; only allow-listed columns and generated placeholder counts are interpolated.
- Medium: The three report queries are separate statements, not a shared read transaction, so rapidly changing sales may yield rows, summary, and count from slightly different snapshots.

### Sales, Inventory, Receivables, and Product Sales Reports

Functions: `getSalesReport` (lines 117–181), `getInventoryReport` (247–297), `getReceivablesReport` (299–344), `getProductSalesReport` (346–378). Importance: IMPORTANT. `getInventoryReport` values live stock batches at remaining quantity × batch cost and estimates sales value at aggregate product stock × current selling price. `getReceivablesReport` lists active customers with positive balance and reports open credit sale count/oldest date. `getProductSalesReport` aggregates sold quantity and line subtotals by product/year/month for 1–50 validated IDs.

Audit finding (Medium): In the receivables report, `total_original_credit_amount` sums `sa.total_amount` for open credit sales. That field describes original sale value, not remaining receivable for those sales; the naming and interpretation should be made explicit. The headline total is customer `current_balance`, so the report exposes two different measures. Verification status: static SQL inspection.

### Operational Report Retrieval

Module: Admin and Staff reports<br>
Source File: `server/controllers/operationalReportController.js` lines 3–241<br>
Function: `pagination`, `dateFilters`, `searchTerm`, `pageData`, `getOperationalReport`<br>
Importance: IMPORTANT<br>
Purpose: Retrieve paginated sales, inventory, stock-in, or receivables data with optional date/search filters and role-based report availability.

#### Algorithm Explanation

The controller normalizes report type, page, page size, and search term, then chooses a report-specific query branch. It performs bound SQL searches, count and page queries, and in some branches separate summary queries. Sales rows are enriched with per-sale product and quantity aggregates. Inventory and receivables summaries are aggregated independently of the current page. Endpoint role access is also enforced by `server/routes/reportRoutes.js` and controller checks.

#### Audit Findings

- Medium: Summary queries in operational reports intentionally omit some row filters (for example the receivables headline is global while row search narrows the list). The UI/documentation should label whether figures are global or filtered.
- Informational: Tests for pagination and operational access exist (`reportPagination.test.js`, `operationalReportAccess.test.js`, `reportBehavior.test.js`); not run in this audit.

## 8. User Account Management

User CRUD is implemented in `server/controllers/userController.js` lines 21–201 and restricted to Admin by `server/routes/userRoutes.js`. `createUser` validates identity fields, checks username/email uniqueness, hashes the initial password with bcrypt cost 10, creates an email verification token, and records activity in a transaction. `updateUser` locks the user, applies changed details, clears email verification and issues a new verification token when email changes. `updateUserStatus` updates active state and logs the action. `resetUserPassword` hashes the replacement, increments `auth_version`, invalidates reset tokens, and logs the reset in a transaction.

Importance: IMPORTANT. Medium finding: username/email are checked before insert/update, but uniqueness under concurrent requests ultimately depends on database unique constraints; duplicate-key errors are mapped to HTTP 409. Static inspection only. Password reset flow for self-service is separately implemented in `passwordResetController.js` and `passwordResetService.js`; not all supporting email delivery code is reproduced here.

## 9. Activity Logs

### Activity Log Search and Pagination

Module: Admin activity audit<br>
Source File: `server/controllers/activityLogController.js` lines 6–72<br>
Function: `getActivityLogs`<br>
Importance: IMPORTANT<br>
Purpose: Validate date format, bind search/date filters, count matching records, and return newest-first activity rows with pagination.

#### Algorithm Explanation

The handler normalizes page and limit, trims search, validates the date string shape, and constructs optional predicates for user identity, action, description, and date range. It executes a count query and a result query with the same filters, orders by timestamp and activity ID descending, and returns pagination metadata. Route access is Admin-only in `server/routes/activityLogRoutes.js`.

#### Audit Findings

- Medium: `validDate` checks only the `YYYY-MM-DD` shape, not whether the month/day form a real calendar date. Invalid calendar dates may be normalized or rejected by the database rather than receiving a consistent 400 response.
- Low: `page` has no practical maximum; although it is a positive safe integer, multiplying by limit can exceed safe-integer range and produce an imprecise offset. The other report pagination implementation explicitly checks this.
- Informational: Search and date values are parameterized. Date end uses an exclusive next-day bound.

## 10. Shared Validation and Transaction Utilities

### Decimal Parsing and Integer-Scale Money

Module: Shared business logic<br>
Source File: `server/utils/decimalValidation.js` lines 1–52; `server/utils/money.js` lines 1–31<br>
Function: `parseDecimal`, `toCents`, `toThousandths`, `lineTotalCents`, `centsToAmount`<br>
Importance: CRITICAL<br>
Purpose: Enforce shared scale/range rules and calculate persisted monetary amounts in integer cents.

#### Actual Source Code with Comments

```js
export function parseDecimal(value, { fieldName, maximum, decimalPlaces: maximumDecimalPlaces,
  minimum = 0, inclusiveMinimum = true }) {
  const supportedType = typeof value === 'number' || typeof value === 'string'
  const raw = supportedType ? String(value).trim() : ''
  if (!supportedType || !raw) throw new DecimalValidationError(`${fieldName} must be a valid number`)
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new DecimalValidationError(`${fieldName} must be a valid number`)
  const negativeSyntax = raw.startsWith('-')
  const validMinimum = inclusiveMinimum ? parsed >= minimum : parsed > minimum
  if (negativeSyntax || !validMinimum) {
    throw new DecimalValidationError(inclusiveMinimum
      ? `${fieldName} must be at least ${minimum}` : `${fieldName} must be greater than ${minimum}`)
  }
  if (parsed > maximum) throw new DecimalValidationError(`${fieldName} must not exceed ${maximum}`)
  const precision = decimalPlaces(raw)
  if (precision === null || precision > maximumDecimalPlaces) {
    throw new DecimalValidationError(`${fieldName} supports up to ${maximumDecimalPlaces} decimal places`)
  }
  return parsed
}

export function toCents(value) {
  // Convert monetary values to a safe integer, then BigInt, for exact cent arithmetic.
  return toScaledInteger(value, 100, 'Monetary value exceeds safe integer precision')
}
export function toThousandths(value) {
  return toScaledInteger(value, 1000, 'Quantity exceeds safe integer precision')
}
export function lineTotalCents(quantity, unitPrice) {
  // Round positive line values half-up when reducing quantity-thousandths × cents to cents.
  const product = toThousandths(quantity) * toCents(unitPrice)
  return (product + 500n) / 1000n
}
```

#### Algorithm Explanation

`parseDecimal` accepts strings or numbers, rejects blank, non-finite, negative-syntax, out-of-range, and over-precision values, and returns a JavaScript number after validation. The money helpers scale validated values to safe integer units, convert those units to `BigInt`, compute a quantity-price line total with half-up rounding, and format cents without converting the final amount back to floating point. Quantity values are represented in thousandths for transaction hashing and stock calculations.

#### Audit Findings

- Medium: `parseDecimal` returns a binary floating-point number; conversion helpers then round to the declared scale. Call sites generally check precision first, but callers must continue using the shared validator before money helpers.
- Informational: `lineTotalCents` performs per-line rounding, not a single rounding after multiplying all line values together.

### Idempotency Reservation and Replay

Module: Shared safeguards for sales, stock-in, and payments<br>
Source File: `server/utils/idempotency.js` lines 19–110<br>
Function: `getIdempotencyKey`, `hashRequestPayload`, `reserveIdempotencyKey`, `saveIdempotentResponse`, `resolveIdempotencyReplay`, `readIdempotentResponse`<br>
Importance: CRITICAL<br>
Purpose: Validate request keys, hash canonical input, reserve uniqueness by user and operation, and replay a completed response only for the same payload.

#### Algorithm Explanation

The utility accepts a bounded header key with a restricted character set. Controllers hash normalized request data with SHA-256, reserve a row using a database uniqueness constraint, and store the completed status/body in the same business transaction. On a collision, the service compares the stored request hash, returns a mismatch for different input, replays a completed matching response, or reports the result as unverified if the stored reservation lacks a response. Exact uniqueness scope is `(user_id, operation_type, idempotency_key)` as used in the SQL and expected named constraint.

#### Audit Findings

- Informational: Idempotency is applied to sale, stock-in, and payment transaction flows. It does not provide a general session or logout revocation mechanism.
- Medium: Correct reservation behavior depends on the actual schema unique index matching `uq_idempotency_user_operation_key`; migrations/schema were not exhaustively audited in this document.
- Verification status: `idempotency.test.js`, `idempotentTransactions.test.js`, and transaction failure tests exist but were not executed.

## Algorithm Inventory and Importance

| Module | Algorithm | Function | File | Importance |
|---|---|---|---|---|
| Authentication | Password and MFA challenge | `login`, `verifyLoginMfa` | `server/controllers/authController.js` | CRITICAL |
| Authentication | Current token/session verification | `authenticate` | `server/middleware/authenticate.js` | CRITICAL |
| Dashboard | Admin product ranking | `rankBusinessProducts` | `server/controllers/dashboardController.js` | IMPORTANT |
| Dashboard | Staff/Admin KPI aggregation and calendar series | `getStaffDashboardData`, `getAdminDashboardData`, `fillSeries` | `server/controllers/dashboardController.js` | IMPORTANT |
| Point of Sale | FIFO batch locking/allocation | `lockEligibleStockBatches`, `calculateFifoAllocations` | `server/controllers/salesController.js` | CRITICAL |
| Point of Sale | Sale validation/pricing | `normalizeSaleRequest`, `prepareSaleItems`, `calculateSaleAmounts` | `server/controllers/salesController.js` | CRITICAL |
| Point of Sale | Atomic sale commit and recovery | `persistSaleItems`, `createSale` | `server/controllers/salesController.js` | CRITICAL |
| Inventory | Stock status | `calculateInventoryStatus` | `server/controllers/stockInController.js` | CRITICAL |
| Inventory | Atomic stock-in | `prepareStockInRequest`, `persistStockIn`, `createStockIn` | `server/controllers/stockInController.js` | CRITICAL |
| Credits | Payment validation and balance math | `validateSaleOutstanding`, `calculatePaymentAmounts` | `server/controllers/paymentController.js` | CRITICAL |
| Credits | Atomic payment commit | `persistPayment`, `recordPayment` | `server/controllers/paymentController.js` | CRITICAL |
| Supplier | Supplier CRUD/archive and activity | `createSupplier`, `updateSupplier`, `changeSupplierStatus` | `server/controllers/supplierController.js` | IMPORTANT |
| Reports | Filtered sales report and totals | `salesFilters`, `getSalesReport` | `server/controllers/reportController.js` | IMPORTANT |
| Reports | Inventory valuation | `getInventoryReport` | `server/controllers/reportController.js` | IMPORTANT |
| Reports | Receivables summary and rows | `getReceivablesReport` | `server/controllers/reportController.js` | IMPORTANT |
| Reports | Product/month sales aggregation | `getProductSalesReport` | `server/controllers/reportController.js` | IMPORTANT |
| Reports | Operational report queries | `getOperationalReport` | `server/controllers/operationalReportController.js` | IMPORTANT |
| Accounts | Account creation, update, status, password reset | `createUser`, `updateUser`, `updateUserStatus`, `resetUserPassword` | `server/controllers/userController.js` | IMPORTANT |
| Activity Logs | Search and pagination | `getActivityLogs` | `server/controllers/activityLogController.js` | IMPORTANT |
| Shared | Decimal validation and money math | `parseDecimal`, `toCents`, `lineTotalCents` | `server/utils/decimalValidation.js`, `server/utils/money.js` | CRITICAL |
| Shared | Duplicate transaction defense/replay | `reserveIdempotencyKey`, `readIdempotentResponse` | `server/utils/idempotency.js` | CRITICAL |

## Audit Scope, Omitted Code, and Verification

Inspected backend controllers, authentication/session middleware, relevant route access declarations, business utility modules, frontend service wrappers, and the Admin/Staff dashboards, reports, POS, inventory, credit, supplier, user, and activity screens. The file inventory contains further UI formatting and chart helpers that are supporting presentation behavior and are not elevated as business algorithms here.

Complete function bodies for the identified business algorithms and their relevant helpers are included in Appendix A, sections A1–A15 and B1–B7. The appendix code was extracted from the current source files and retains each function's control flow, SQL, calculations, transaction handling, and error paths. The short explanatory passages above remain summaries; they are paired with the full source code below.

No tests were executed. Existing relevant tests were located by source inspection, including MFA, authentication roles, sales FIFO/payment invariants, transaction failures, idempotency, stock-in rollback/date validation, payment history, reports/pagination, supplier lifecycle, and user-related tests. Their presence does not establish that they pass. No production financial data or destructive tests were used.

### Consolidated Findings

| Severity | Module | File and location | Evidence and potential impact | Recommended correction | Verification status |
|---|---|---|---|---|---|
| Medium | Authentication | `server/controllers/authController.js`, `logout` around lines 185–198 | Logout writes an activity row but does not revoke the JWT; a copied token remains accepted until expiration or an auth-version change. | If immediate logout revocation is a requirement, add a revocation mechanism or rotate the user's auth version and define multi-session behavior. | Static source inspection; no token replay test run. |
| Medium | Sales / stock-in | `server/controllers/salesController.js`, `sumAvailableBatchQuantity`; `server/controllers/stockInController.js`, `calculateInventoryStatus` | Quantities are represented as JS `Number` during aggregate comparisons/status addition. At the currently validated three-decimal scale normal values are bounded, but binary rounding can complicate edge comparisons. | Consider storing/comparing integer thousandths at calculation boundaries, or add boundary tests that document accepted tolerance and DB numeric scale. | Static source inspection; tests not executed. |
| Medium | Reports | `server/controllers/reportController.js`, `getReceivablesReport` | `total_original_credit_amount` sums original `sales.total_amount` for open credit sales, while the headline receivable total sums customer current balances. Consumers could mistake the original amount for the unpaid amount. | Rename/label the field as original credit value, or calculate remaining balances if the intended meaning is unpaid receivable. | Verified from query expressions only. |
| Medium | Reports | `server/controllers/reportController.js`, `getSalesReport`, `getReceivablesReport`, `getInventoryReport` | Rows, counts, and summary totals use multiple SQL statements without an explicit shared read transaction, so concurrent writes may produce a temporarily inconsistent page and summary. | Use a consistent snapshot transaction where the report requires exact cross-query consistency, or disclose that counts and metrics are live independently sampled values. | Static query inspection; no concurrency test run. |
| Medium | Activity logs | `server/controllers/activityLogController.js`, `validDate` around lines 11–13 and date filtering | Date validation checks `YYYY-MM-DD` shape only; impossible dates are passed to SQL and may yield DB-dependent behavior instead of a consistent validation response. | Reuse a strict calendar-date validator like the report controllers. | Static source inspection; no invalid-date request executed. |
| Low | Activity logs | `server/controllers/activityLogController.js`, page/offset calculation in `getActivityLogs` | Page is capped only at `Number.MAX_SAFE_INTEGER`; multiplying by limit can exceed the safe integer range and lose offset precision. | Reject unsafe offsets as `reportController.pagination` does. | Static arithmetic inspection; no large-page request executed. |
| Medium | Shared idempotency | `server/utils/idempotency.js`, reservation conflict detection around lines 32–52 | Recognition of a retry conflict depends on the database error identifying the expected named unique index. A schema/name drift could bypass replay handling. | Verify migration/index name against `uq_idempotency_user_operation_key` and cover it in a database-backed test. | SQL/source expectation inspected; live schema not connected or queried. |
| Informational | Transaction accounting | `server/utils/money.js`, `lineTotalCents`; callers in sales and stock-in | Each line is rounded to cents independently before totals are accumulated. This can differ by cents from multiplying and rounding only after summing unrounded line values. | Document the implemented per-line rounding policy and preserve it in financial reports/tests. | Verified from implementation; no numeric tests executed. |
| Informational | Authorization | `server/routes/*.js`, `server/middleware/authorizeRoles.js` | Access is enforced at route middleware plus shared capability mapping; UI route guards are not the security boundary. | Keep API tests covering each Admin/Staff endpoint after route changes. | Route declarations inspected; tests not executed. |

### Verification Limits

- Source behaviors directly visible in the listed functions are treated as verified by inspection.
- Database constraints, migrations, live schema types, transaction isolation, email delivery, MFA expiry/rate limits under load, and deployed environment behavior were not independently verified.
- Automated tests in the repository were not run, so this report makes no pass/fail claim.
- No database was connected, no production records were queried, and no transaction or destructive test was performed.











# Appendix A - Complete source code for the 15 defense algorithms

Every code block below contains complete functions copied from the current working tree. Explanatory notes are documentation; added comments appear only in these Markdown copies. Function line spans are computed from the inspected source files.

## A1. FIFO stock selection, availability, allocation, and deduction

Source file: `server/controllers/salesController.js`

### `lockEligibleStockBatches` — source lines 71–82

**Inputs and behavior:** Input: active transaction connection and product ID. Select positive-balance batches in deterministic FIFO order with row locks; return database rows for allocation.

```js
// Documentation comment: Input: active transaction connection and product ID. Select positive-balance batches in deterministic FIFO order with row locks; return database rows for allocation.
async function lockEligibleStockBatches(connection, productId) {
  // The database lock follows the same deterministic FIFO order used for consumption.
  const [batches] = await connection.execute(
    `SELECT stockin_id, remaining_quantity, cost_price, delivery_date
     FROM stock_in
     WHERE product_id = ? AND remaining_quantity > 0
     ORDER BY delivery_date ASC, stockin_id ASC
     FOR UPDATE`,
    [productId],
  )
  return batches
}
```
### `sumAvailableBatchQuantity` — source lines 84–86

**Inputs and behavior:** Input: batch rows. Sum each remaining quantity after numeric conversion; the caller compares this sum with requested quantity.

```js
// Documentation comment: Input: batch rows. Sum each remaining quantity after numeric conversion; the caller compares this sum with requested quantity.
function sumAvailableBatchQuantity(batches) {
  return batches.reduce((sum, batch) => sum + Number(batch.remaining_quantity), 0)
}
```
### `calculateFifoAllocations` — source lines 88–102

**Inputs and behavior:** Inputs: FIFO-ordered batches and requested quantity. Consume no more than each batch balance, format deductions to three decimals, and return allocation rows.

```js
// Documentation comment: Inputs: FIFO-ordered batches and requested quantity. Consume no more than each batch balance, format deductions to three decimals, and return allocation rows.
function calculateFifoAllocations(batches, requestedQuantity) {
  let quantityRemaining = requestedQuantity
  const allocations = []

  // Each batch contributes at most its remaining balance; fixed-scale rounding matches stored quantities.
  for (const batch of batches) {
    if (quantityRemaining <= 0) break

    const deduction = Math.min(quantityRemaining, Number(batch.remaining_quantity))
    allocations.push({ batch, quantity: deduction.toFixed(3) })
    quantityRemaining = Number((quantityRemaining - deduction).toFixed(3))
  }

  return allocations
}
```
### `persistFifoAllocations` — source lines 104–117

**Inputs and behavior:** Inputs: transaction connection, sales-item ID, and allocations. Decrement each source batch and insert the matching batch-allocation history row.

```js
// Documentation comment: Inputs: transaction connection, sales-item ID, and allocations. Decrement each source batch and insert the matching batch-allocation history row.
async function persistFifoAllocations(connection, salesItemId, allocations) {
  // Keep each deduction and its original batch cost together inside the caller's transaction.
  for (const { batch, quantity } of allocations) {
    await connection.execute(
      'UPDATE stock_in SET remaining_quantity = remaining_quantity - ? WHERE stockin_id = ?',
      [quantity, batch.stockin_id],
    )
    await connection.execute(
      `INSERT INTO sale_batch_allocations (salesitem_id, stockin_id, quantity_deducted, cost_price)
       VALUES (?, ?, ?, ?)`,
      [salesItemId, batch.stockin_id, quantity, batch.cost_price],
    )
  }
}
```

## A2. Sale validation, pricing, persistence, and transactional recovery

Source file: `server/controllers/salesController.js`

### `normalizeItems` — source lines 39–69

**Inputs and behavior:** Input: untrusted sale item array. Reject client price fields, invalid or duplicate product IDs, and invalid quantities; sort product IDs to stabilize lock ordering.

```js
// Documentation comment: Input: untrusted sale item array. Reject client price fields, invalid or duplicate product IDs, and invalid quantities; sort product IDs to stabilize lock ordering.
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new SaleError(400, 'At least one sale item is required')
  }

  const productIds = new Set()
  const normalized = items.map((item) => {
    if (['price', 'selling_price', 'unit_price', 'subtotal'].some((field) => Object.hasOwn(item || {}, field))) {
      throw new SaleError(400, 'Sale item prices are determined by the registered product price')
    }
    const productId = positiveInteger(item?.product_id, 'Product')
    const quantity = decimalValue(item?.quantity, {
      fieldName: 'Quantity',
      maximum: decimalLimits.quantity,
      decimalPlaces: 3,
      minimum: 0,
      inclusiveMinimum: false,
    })

    if (productIds.has(productId)) {
      throw new SaleError(400, 'Duplicate products are not allowed')
    }
    productIds.add(productId)

    return { productId, quantity }
  })

  // Reject duplicates and lock products in a stable ID order to reduce deadlock risk
  // when concurrent sales touch overlapping products.
  return normalized.sort((left, right) => left.productId - right.productId)
}
```
### `normalizeSaleRequest` — source lines 119–160

**Inputs and behavior:** Input: authenticated HTTP request. Validate payment/customer/items, normalize monetary and quantity scales, and hash canonical request fields for idempotency.

```js
// Documentation comment: Input: authenticated HTTP request. Validate payment/customer/items, normalize monetary and quantity scales, and hash canonical request fields for idempotency.
function normalizeSaleRequest(request) {
  // Reject malformed input before opening a transaction or taking database locks.
  const idempotencyKey = getIdempotencyKey(request)
  const paymentType = request.body?.payment_type
  if (paymentType !== 'Cash' && paymentType !== 'Credit') {
    throw new SaleError(400, 'Payment type must be Cash or Credit')
  }

  const amountPaid = decimalValue(request.body?.amount_paid, {
    fieldName: 'Amount paid',
    maximum: decimalLimits.money,
    decimalPlaces: 2,
    minimum: 0,
  })
  const items = normalizeItems(request.body?.items)
  const hasCustomer = request.body?.customer_id !== null
    && request.body?.customer_id !== undefined
    && request.body?.customer_id !== ''
  const customerId = hasCustomer ? positiveInteger(request.body.customer_id, 'Customer') : null

  if (paymentType === 'Credit' && !customerId) {
    throw new SaleError(400, 'A customer is required for credit sales')
  }

  const amountPaidCents = toCents(amountPaid)
  const idempotency = {
    userId: request.user.user_id,
    operation: 'sale',
    key: idempotencyKey,
    payloadHash: hashRequestPayload({
      payment_type: paymentType,
      customer_id: customerId,
      amount_paid_cents: amountPaidCents.toString(),
      items: items.map((item) => ({
        product_id: item.productId,
        quantity_thousandths: toThousandths(item.quantity).toString(),
      })),
    }),
  }

  return { paymentType, amountPaidCents, customerId, items, idempotency }
}
```
### `prepareSaleItems` — source lines 162–207

**Inputs and behavior:** Inputs: transaction connection and normalized items. Lock active products and FIFO batches, check both inventory balances, load registered prices, calculate bounded line and aggregate totals.

```js
// Documentation comment: Inputs: transaction connection and normalized items. Lock active products and FIFO batches, check both inventory balances, load registered prices, calculate bounded line and aggregate totals.
async function prepareSaleItems(connection, items) {
  const preparedItems = []
  let totalCents = 0n

  for (const item of items) {
    const [products] = await connection.execute(
      `SELECT product_id, selling_price, stock_quantity, reorder_level
       FROM products
       WHERE product_id = ? AND is_active = TRUE
       LIMIT 1
       FOR UPDATE`,
      [item.productId],
    )
    const product = products[0]

    if (!product) {
      throw new SaleError(404, 'Active product not found')
    }

    if (Number(product.stock_quantity) < item.quantity) {
      throw new SaleError(409, `Not enough stock for product ${item.productId}`)
    }

    const batches = await lockEligibleStockBatches(connection, item.productId)
    const fifoAvailable = sumAvailableBatchQuantity(batches)

    // Both the aggregate product balance and its locked FIFO batches must cover the sale.
    if (fifoAvailable < item.quantity) {
      throw new SaleError(409, `Available stock records do not cover product ${item.productId}. Please contact the owner.`)
    }

    const priceCents = toCents(product.selling_price)
    const subtotalCents = lineTotalCents(item.quantity, product.selling_price)
    const maximumMoneyCents = BigInt(Math.round(decimalLimits.money * 100))
    if (subtotalCents > maximumMoneyCents) {
      throw new SaleError(400, `Sale item total must not exceed ${decimalLimits.money}`)
    }
    totalCents += subtotalCents
    if (totalCents > maximumMoneyCents) {
      throw new SaleError(400, `Sale total must not exceed ${decimalLimits.money}`)
    }
    preparedItems.push({ ...item, product, batches, priceCents, subtotalCents })
  }

  return { preparedItems, totalCents }
}
```
### `calculateSaleAmounts` — source lines 209–225

**Inputs and behavior:** Inputs: payment type and integer-cent total/paid values. Reject overpayment and underpaid cash; derive remaining balance, status, and formatted amounts.

```js
// Documentation comment: Inputs: payment type and integer-cent total/paid values. Reject overpayment and underpaid cash; derive remaining balance, status, and formatted amounts.
function calculateSaleAmounts(paymentType, totalCents, amountPaidCents) {
  if (amountPaidCents > totalCents) {
    throw new SaleError(400, 'Amount paid cannot exceed the sale total')
  }
  if (paymentType === 'Cash' && amountPaidCents < totalCents) {
    throw new SaleError(400, 'Cash payment must cover the full sale total')
  }

  const remainingCents = totalCents - amountPaidCents
  return {
    remainingCents,
    status: remainingCents === 0n ? 'Paid' : amountPaidCents > 0n ? 'Partially Paid' : 'Unpaid',
    totalAmount: centsToAmount(totalCents),
    paidAmount: centsToAmount(amountPaidCents),
    remainingBalance: centsToAmount(remainingCents),
  }
}
```
### `persistSaleItems` — source lines 227–251

**Inputs and behavior:** Inputs: transaction connection, sale ID, and prepared sale items. Insert each line, allocate batch stock, update aggregate stock, and recalculate status.

```js
// Documentation comment: Inputs: transaction connection, sale ID, and prepared sale items. Insert each line, allocate batch stock, update aggregate stock, and recalculate status.
async function persistSaleItems(connection, saleId, preparedItems) {
  for (const item of preparedItems) {
    const quantity = item.quantity.toFixed(3)
    const price = centsToAmount(item.priceCents)
    const subtotal = centsToAmount(item.subtotalCents)
    const [itemResult] = await connection.execute(
      `INSERT INTO sales_items (sale_id, product_id, quantity, price, subtotal)
       VALUES (?, ?, ?, ?, ?)`,
      [saleId, item.productId, quantity, price, subtotal],
    )

    const allocations = calculateFifoAllocations(item.batches, item.quantity)
    await persistFifoAllocations(connection, itemResult.insertId, allocations)

    await connection.execute(
      'UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?',
      [quantity, item.productId],
    )

    const newStock = Number(item.product.stock_quantity) - item.quantity
    const reorderLevel = Number(item.product.reorder_level)
    const productStatus = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
    await connection.execute('UPDATE products SET status = ? WHERE product_id = ?', [productStatus, item.productId])
  }
}
```
### `buildSaleResponse` — source lines 253–265

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function buildSaleResponse(saleId, amounts) {
  return {
    success: true,
    message: 'Sale recorded successfully',
    data: {
      sale_id: saleId,
      total_amount: amounts.totalAmount,
      amount_paid: amounts.paidAmount,
      remaining_balance: amounts.remainingBalance,
      status: amounts.status,
    },
  }
}
```
### `createSale` — source lines 267–410

**Inputs and behavior:** Input: authenticated sale request. Coordinate validation, idempotency reservation, row locks, all sale/inventory/credit/audit writes, commit recovery, replay, and HTTP response.

#### Consecutive source section 1 of 3

```js
// Documentation comment: Input: authenticated sale request. Coordinate validation, idempotency reservation, row locks, all sale/inventory/credit/audit writes, commit recovery, replay, and HTTP response.
export async function createSale(request, response) {
  let connection
  let idempotency
  let transactionBeginAttempted = false
  let transactionStarted = false
  let commitAttempted = false
  let commitCompleted = false
  let connectionReusable = true

  try {
    const saleRequest = normalizeSaleRequest(request)
    const { paymentType, amountPaidCents, customerId, items } = saleRequest
    idempotency = saleRequest.idempotency

    connection = await pool.getConnection()
    // The idempotency reservation, sale rows, stock deductions, balances, and audit
    // entry must commit or roll back together as one business transaction.
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    await reserveIdempotencyKey(connection, idempotency)

    if (customerId) {
      const [customers] = await connection.execute(
        'SELECT customer_id FROM customers WHERE customer_id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE',
        [customerId],
      )
      if (customers.length === 0) {
        throw new SaleError(404, 'Active customer not found')
      }
    }

    const { preparedItems, totalCents } = await prepareSaleItems(connection, items)
    const amounts = calculateSaleAmounts(paymentType, totalCents, amountPaidCents)

    const [saleResult] = await connection.execute(
      `INSERT INTO sales (
         customer_id, user_id, payment_type, total_amount,
         amount_paid, remaining_balance, status, sale_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [
        customerId,
        request.user.user_id,
        paymentType,
        amounts.totalAmount,
        amounts.paidAmount,
        amounts.remainingBalance,
        amounts.status,
      ],
    )

    await persistSaleItems(connection, saleResult.insertId, preparedItems)

    if (paymentType === 'Credit' && amounts.remainingCents > 0) {
      // The customer balance tracks the unpaid portion, not the original sale total.
      await connection.execute(
        'UPDATE customers SET current_balance = current_balance + ? WHERE customer_id = ?',
        [amounts.remainingBalance, customerId],
      )
    }
```
#### Consecutive source section 2 of 3

```js

    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'SALE_CREATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Sale ${saleResult.insertId} created (${paymentType}, ${amounts.totalAmount})`],
    )

    const resultBody = buildSaleResponse(saleResult.insertId, amounts)
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    // Persist the replay response before commit so a retry can recover the committed sale.
    commitAttempted = true
    await connection.commit()
    commitCompleted = true

    return response.status(201).json(resultBody)
  } catch (error) {
    // If commit was attempted but not confirmed, the database outcome is uncertain;
    // the shared failure handler avoids reporting a definite rejection in that case.
    const rejectionConfirmed = (error instanceof SaleError || error instanceof IdempotencyError)
      && error.status < 500
    const failure = await resolveTransactionFailure({
      connection,
      transactionBeginAttempted,
      transactionStarted,
      commitAttempted,
      commitCompleted,
      error,
      operation: 'sale',
      rejectionConfirmed,
    })
    connectionReusable = failure.reusable

    if (error instanceof IdempotencyKeyConflictError && idempotency) {
      try {
        const replay = await resolveIdempotencyReplay(pool, idempotency)
        if (replay.kind === 'payload-mismatch') {
          return response.status(409).json({
            success: false,
            code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            transaction_outcome: 'not_committed',
            message: 'Idempotency key was already used for a different request',
          })
        }
        if (replay.kind === 'replay') return response.status(replay.status).json(replay.body)
      } catch (replayError) {
        console.error('Unable to retrieve idempotent sale result:', replayError.message)
      }
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm sale status. Check transaction status before retrying.',
      })
    }

    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
```
#### Consecutive source section 3 of 3

```js
        message: 'Unable to confirm sale status. Check transaction status before retrying.',
      })
    }

    if ((error instanceof SaleError || error instanceof IdempotencyError) && failure.outcome === 'not_committed') {
      return response.status(error.status).json({
        success: false,
        code: rejectionConfirmed ? 'TRANSACTION_REJECTED' : 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: failure.outcome,
        message: error.message,
      })
    }

    console.error('Unable to record sale:', error.code || 'UNKNOWN')
    return response.status(500).json({
      success: false,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      transaction_outcome: 'unknown',
      message: 'Unable to record sale',
    })
  } finally {
    if (connectionReusable) connection?.release()
  }
}
```

## A3. Inventory status calculation and stock-in transaction

Source file: `server/controllers/stockInController.js`

### `parsePositiveInteger` — source lines 28–36

**Inputs and behavior:** Input: identifier value and field label. Convert to Number and reject non-positive or non-integer identifiers with a request error.

```js
// Documentation comment: Input: identifier value and field label. Convert to Number and reject non-positive or non-integer identifiers with a request error.
function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RequestError(400, `${fieldName} must be a positive integer`)
  }

  return parsed
}
```
### `decimalValue` — source lines 38–45

**Inputs and behavior:** Input: value and decimal validation options. Delegate to shared parsing and translate validation errors into stock-in request errors.

```js
// Documentation comment: Input: value and decimal validation options. Delegate to shared parsing and translate validation errors into stock-in request errors.
function decimalValue(value, options) {
  try {
    return parseDecimal(value, options)
  } catch (error) {
    if (error instanceof DecimalValidationError) throw new RequestError(400, error.message)
    throw error
  }
}
```
### `prepareStockInRequest` — source lines 47–102

**Inputs and behavior:** Input: authenticated stock-in request. Validate references, three-decimal quantity, two-decimal cost, business delivery date and total; return normalized persistence values and idempotency identity.

```js
// Documentation comment: Input: authenticated stock-in request. Validate references, three-decimal quantity, two-decimal cost, business delivery date and total; return normalized persistence values and idempotency identity.
function prepareStockInRequest(request) {
  const idempotencyKey = getIdempotencyKey(request)
  const supplierId = parsePositiveInteger(request.body?.supplier_id, 'Supplier')
  const productId = parsePositiveInteger(request.body?.product_id, 'Product')
  const quantityReceived = decimalValue(request.body?.quantity_received, {
    fieldName: 'Quantity received',
    maximum: decimalLimits.quantity,
    decimalPlaces: 3,
    minimum: 0,
    inclusiveMinimum: false,
  })
  const costPrice = decimalValue(request.body?.cost_price, {
    fieldName: 'Cost price',
    maximum: decimalLimits.unitPrice,
    decimalPlaces: 2,
    minimum: 0,
  })
  const submittedDeliveryDate = request.body?.delivery_date
  const deliveryCalendarDate = getStockInCalendarDate(submittedDeliveryDate)
  if (!deliveryCalendarDate) throw new RequestError(400, STOCK_IN_INVALID_DATE_MESSAGE)
  if (deliveryCalendarDate > getBusinessCalendarDate()) {
    throw new RequestError(400, STOCK_IN_FUTURE_DATE_MESSAGE)
  }
  const deliveryDate = new Date(submittedDeliveryDate)
  const costPriceCents = toCents(costPrice)
  const idempotency = {
    userId: request.user.user_id,
    operation: 'stock_in',
    key: idempotencyKey,
    payloadHash: hashRequestPayload({
      supplier_id: supplierId,
      product_id: productId,
      quantity_thousandths: toThousandths(quantityReceived).toString(),
      cost_price_cents: costPriceCents.toString(),
      delivery_date: String(request.body.delivery_date),
    }),
  }

  const quantityValue = quantityReceived.toFixed(3)
  const costValue = centsToAmount(costPriceCents)
  const totalCostCents = lineTotalCents(quantityReceived, costPrice)
  if (totalCostCents > BigInt(Math.round(decimalLimits.money * 100))) {
    throw new RequestError(400, `Total cost must not exceed ${decimalLimits.money}`)
  }

  return {
    supplierId,
    productId,
    quantityReceived,
    quantityValue,
    costValue,
    totalCost: centsToAmount(totalCostCents),
    deliveryDate,
    idempotency,
  }
}
```
### `lockActiveSupplier` — source lines 104–110

**Inputs and behavior:** Inputs: transaction connection and supplier ID. Lock an active supplier row or reject the request as not found.

```js
// Documentation comment: Inputs: transaction connection and supplier ID. Lock an active supplier row or reject the request as not found.
async function lockActiveSupplier(connection, supplierId) {
  const [suppliers] = await connection.execute(
    'SELECT supplier_id FROM suppliers WHERE supplier_id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE',
    [supplierId],
  )
  if (suppliers.length === 0) throw new RequestError(404, 'Active supplier not found')
}
```
### `lockActiveProduct` — source lines 112–123

**Inputs and behavior:** Inputs: transaction connection and product ID. Lock an active product row and return its current stock/reorder values.

```js
// Documentation comment: Inputs: transaction connection and product ID. Lock an active product row and return its current stock/reorder values.
async function lockActiveProduct(connection, productId) {
  const [products] = await connection.execute(
    `SELECT product_id, stock_quantity, reorder_level
     FROM products
     WHERE product_id = ? AND is_active = TRUE
     LIMIT 1
     FOR UPDATE`,
    [productId],
  )
  if (products.length === 0) throw new RequestError(404, 'Active product not found')
  return products[0]
}
```
### `calculateInventoryStatus` — source lines 125–134

**Inputs and behavior:** Inputs: locked product and received quantity. Reject non-finite or excessive projected stock and return status based on zero/reorder thresholds.

```js
// Documentation comment: Inputs: locked product and received quantity. Reject non-finite or excessive projected stock and return status based on zero/reorder thresholds.
function calculateInventoryStatus(product, quantityReceived) {
  const newStock = Number(product.stock_quantity) + quantityReceived
  if (!Number.isFinite(newStock) || newStock > decimalLimits.quantity) {
    throw new RequestError(400, `Resulting product stock must not exceed ${decimalLimits.quantity}`)
  }

  const reorderLevel = Number(product.reorder_level)
  const status = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
  return status
}
```
### `persistStockIn` — source lines 136–176

**Inputs and behavior:** Inputs: transaction connection, request and normalized stock-in data. Insert batch history, increment aggregate stock, update status, and write activity log.

```js
// Documentation comment: Inputs: transaction connection, request and normalized stock-in data. Insert batch history, increment aggregate stock, update status, and write activity log.
async function persistStockIn(connection, request, stockIn) {
  // Stock-in history gets the selected product's configured unit through product_id; FIFO uses each batch's cost, date, and balance.
  const [result] = await connection.execute(
    `INSERT INTO stock_in (
       supplier_id,
       product_id,
       user_id,
       quantity_received,
       remaining_quantity,
       cost_price,
       total_cost,
       delivery_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stockIn.supplierId,
      stockIn.productId,
      request.user.user_id,
      stockIn.quantityValue,
      stockIn.quantityValue,
      stockIn.costValue,
      stockIn.totalCost,
      stockIn.deliveryDate,
    ],
  )

  await connection.execute(
    'UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?',
    [stockIn.quantityValue, stockIn.productId],
  )
  await connection.execute(
    'UPDATE products SET status = ? WHERE product_id = ?',
    [stockIn.status, stockIn.productId],
  )
  await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, 'STOCK_IN_CREATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [request.user.user_id, `Stock-In ${result.insertId} created for product ${stockIn.productId}`],
  )

  return result.insertId
}
```
### `buildStockInResponse` — source lines 178–192

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function buildStockInResponse(stockInId, stockIn) {
  return {
    success: true,
    message: 'Stock-in recorded successfully',
    data: {
      stockin_id: stockInId,
      supplier_id: stockIn.supplierId,
      product_id: stockIn.productId,
      quantity_received: stockIn.quantityValue,
      remaining_quantity: stockIn.quantityValue,
      cost_price: stockIn.costValue,
      total_cost: stockIn.totalCost,
    },
  }
}
```
### `createStockIn` — source lines 194–297

**Inputs and behavior:** Input: authenticated stock-in request. Reserve idempotency key and transactionally lock references, persist batch/stock/activity/replay response, commit, or resolve failure/retry.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Input: authenticated stock-in request. Reserve idempotency key and transactionally lock references, persist batch/stock/activity/replay response, commit, or resolve failure/retry.
export async function createStockIn(request, response) {
  let connection
  let idempotency
  let transactionBeginAttempted = false
  let transactionStarted = false
  let commitAttempted = false
  let commitCompleted = false
  let connectionReusable = true

  try {
    const stockIn = prepareStockInRequest(request)
    idempotency = stockIn.idempotency

    connection = await pool.getConnection()
    // Reserve the idempotency key and perform all stock-in writes in the same
    // transaction so a failed batch insert cannot leave aggregate stock incremented.
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    await reserveIdempotencyKey(connection, idempotency)

    // Lock referenced active records so archiving or other stock updates cannot race
    // validation and the product quantity/status change.
    await lockActiveSupplier(connection, stockIn.supplierId)
    const product = await lockActiveProduct(connection, stockIn.productId)
    stockIn.status = calculateInventoryStatus(product, stockIn.quantityReceived)

    // Batch history and aggregate inventory update together; supplier_id remains the historical reference.
    const stockInId = await persistStockIn(connection, request, stockIn)
    const resultBody = buildStockInResponse(stockInId, stockIn)
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    // Commit the batch, aggregate inventory, activity entry, and replay record together.
    commitAttempted = true
    await connection.commit()
    commitCompleted = true

    return response.status(201).json(resultBody)
  } catch (error) {
    const rejectionConfirmed = (error instanceof RequestError || error instanceof IdempotencyError)
      && error.status < 500
    const failure = await resolveTransactionFailure({
      connection,
      transactionBeginAttempted,
      transactionStarted,
      commitAttempted,
      commitCompleted,
      error,
      operation: 'stock-in',
      rejectionConfirmed,
    })
    connectionReusable = failure.reusable

    if (error instanceof IdempotencyKeyConflictError && idempotency) {
      try {
        const replay = await resolveIdempotencyReplay(pool, idempotency)
        if (replay.kind === 'payload-mismatch') {
          return response.status(409).json({
            success: false,
            code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            transaction_outcome: 'not_committed',
```
#### Consecutive source section 2 of 2

```js
            message: 'Idempotency key was already used for a different request',
          })
        }
        if (replay.kind === 'replay') return response.status(replay.status).json(replay.body)
      } catch (replayError) {
        console.error('Unable to retrieve idempotent stock-in result:', replayError.message)
      }
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm stock delivery status. Check transaction status before retrying.',
      })
    }

    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm stock delivery status. Check transaction status before retrying.',
      })
    }

    if ((error instanceof RequestError || error instanceof IdempotencyError) && failure.outcome === 'not_committed') {
      return response.status(error.status).json({
        success: false,
        code: rejectionConfirmed ? 'TRANSACTION_REJECTED' : 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: failure.outcome,
        message: error.message,
      })
    }

    console.error('Unable to record stock-in:', error.code || 'UNKNOWN')
    return response.status(500).json({
      success: false,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      transaction_outcome: 'unknown',
      message: 'Unable to record stock-in',
    })
  } finally {
    if (connectionReusable) connection?.release()
  }
}
```

## A4. Credit payment validation, calculations, persistence, and transaction

Source file: `server/controllers/paymentController.js`

### `normalizePaymentRequest` — source lines 23–56

**Inputs and behavior:** Input: authenticated payment request. Validate sale ID and positive two-decimal amount, convert to cents, and hash normalized payload for idempotency.

```js
// Documentation comment: Input: authenticated payment request. Validate sale ID and positive two-decimal amount, convert to cents, and hash normalized payload for idempotency.
function normalizePaymentRequest(request) {
  const idempotencyKey = getIdempotencyKey(request)
  const saleId = Number(request.body?.sale_id)
  if (!Number.isInteger(saleId) || saleId <= 0) throw new PaymentError(400, 'Invalid sale ID')

  // Validate the submitted amount at the supported scale, then use cents for all payment math.
  let paymentAmount
  try {
    paymentAmount = parseDecimal(request.body?.payment_amount, {
      fieldName: 'Payment amount',
      maximum: decimalLimits.money,
      decimalPlaces: 2,
      minimum: 0,
      inclusiveMinimum: false,
    })
  } catch (error) {
    if (error instanceof DecimalValidationError) throw new PaymentError(400, error.message)
    throw error
  }

  const paymentCents = toCents(paymentAmount)
  // Hash normalized cents so equivalent decimal spellings share the same retry identity.
  const idempotency = {
    userId: request.user.user_id,
    operation: 'payment',
    key: idempotencyKey,
    payloadHash: hashRequestPayload({
      sale_id: saleId,
      payment_amount_cents: paymentCents.toString(),
    }),
  }

  return { saleId, paymentCents, idempotency }
}
```
### `lockCreditSale` — source lines 58–72

**Inputs and behavior:** Inputs: transaction connection and sale ID. Lock the sale row; require an existing customer credit sale and return its balances.

```js
// Documentation comment: Inputs: transaction connection and sale ID. Lock the sale row; require an existing customer credit sale and return its balances.
async function lockCreditSale(connection, saleId) {
  const [sales] = await connection.execute(
    `SELECT customer_id, payment_type, total_amount, amount_paid, remaining_balance, status
     FROM sales WHERE sale_id = ? LIMIT 1 FOR UPDATE`,
    [saleId],
  )
  const sale = sales[0]

  if (!sale) throw new PaymentError(404, 'Sale not found')
  if (sale.payment_type !== 'Credit' || !sale.customer_id) {
    throw new PaymentError(400, 'Payments can only be recorded for customer credit sales')
  }

  return sale
}
```
### `validateSaleOutstanding` — source lines 74–79

**Inputs and behavior:** Inputs: locked sale and payment cents. Convert outstanding amount to cents; reject fully paid sales or overpayment.

```js
// Documentation comment: Inputs: locked sale and payment cents. Convert outstanding amount to cents; reject fully paid sales or overpayment.
function validateSaleOutstanding(sale, paymentCents) {
  const outstandingCents = toCents(sale.remaining_balance)
  if (outstandingCents <= 0n) throw new PaymentError(400, 'This sale is already fully paid')
  if (paymentCents > outstandingCents) throw new PaymentError(400, 'Payment exceeds the outstanding balance')
  return outstandingCents
}
```
### `lockAndValidateCustomerBalance` — source lines 81–90

**Inputs and behavior:** Inputs: transaction connection, customer ID, and payment cents. Lock the customer and reject a missing customer or insufficient aggregate balance.

```js
// Documentation comment: Inputs: transaction connection, customer ID, and payment cents. Lock the customer and reject a missing customer or insufficient aggregate balance.
async function lockAndValidateCustomerBalance(connection, customerId, paymentCents) {
  const [customers] = await connection.execute(
    'SELECT current_balance FROM customers WHERE customer_id = ? LIMIT 1 FOR UPDATE',
    [customerId],
  )
  if (!customers[0]) throw new PaymentError(404, 'Customer not found')
  if (toCents(customers[0].current_balance) < paymentCents) {
    throw new PaymentError(409, 'The customer balance does not match this payment. Please contact the owner.')
  }
}
```
### `calculatePaymentAmounts` — source lines 92–100

**Inputs and behavior:** Inputs: locked sale, outstanding cents and payment cents. Compute cumulative paid value, remaining balance and Paid/Partially Paid status.

```js
// Documentation comment: Inputs: locked sale, outstanding cents and payment cents. Compute cumulative paid value, remaining balance and Paid/Partially Paid status.
function calculatePaymentAmounts(sale, outstandingCents, paymentCents) {
  // A partial amount reduces this sale's balance; only a zero remainder transitions it to Paid.
  const newPaid = centsToAmount(toCents(sale.amount_paid) + paymentCents)
  const newRemainingCents = outstandingCents - paymentCents
  const newRemaining = centsToAmount(newRemainingCents)
  const paymentValue = centsToAmount(paymentCents)
  const status = newRemainingCents === 0n ? 'Paid' : 'Partially Paid'
  return { newPaid, newRemaining, paymentValue, status }
}
```
### `persistPayment` — source lines 102–124

**Inputs and behavior:** Inputs: transaction connection and payment identity/amounts. Update both ledgers, insert payment history and activity log, then return payment ID.

```js
// Documentation comment: Inputs: transaction connection and payment identity/amounts. Update both ledgers, insert payment history and activity log, then return payment ID.
async function persistPayment(connection, { saleId, customerId, userId, amounts }) {
  // The payment belongs to one credit sale; update both ledgers and history atomically in this order.
  await connection.execute(
    'UPDATE sales SET amount_paid = ?, remaining_balance = ?, status = ? WHERE sale_id = ?',
    [amounts.newPaid, amounts.newRemaining, amounts.status, saleId],
  )
  await connection.execute(
    'UPDATE customers SET current_balance = current_balance - ? WHERE customer_id = ?',
    [amounts.paymentValue, customerId],
  )
  const [result] = await connection.execute(
    `INSERT INTO payments (sale_id, customer_id, user_id, payment_amount, remaining_balance, payment_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [saleId, customerId, userId, amounts.paymentValue, amounts.newRemaining, toManilaDateTime()],
  )
  await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, 'PAYMENT_RECORDED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [userId, `Payment ${result.insertId} recorded for sale ${saleId} (${amounts.paymentValue})`],
  )

  return result.insertId
}
```
### `buildPaymentResponse` — source lines 126–138

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function buildPaymentResponse(paymentId, saleId, amounts) {
  return {
    success: true,
    message: 'Payment recorded successfully',
    data: {
      payment_id: paymentId,
      sale_id: saleId,
      payment_amount: amounts.paymentValue,
      remaining_balance: amounts.newRemaining,
      status: amounts.status,
    },
  }
}
```
### `recordPayment` — source lines 140–248

**Inputs and behavior:** Input: authenticated payment request. Coordinate idempotency, sale/customer locks, balance checks, atomic ledger/history writes, commit recovery and replay.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Input: authenticated payment request. Coordinate idempotency, sale/customer locks, balance checks, atomic ledger/history writes, commit recovery and replay.
export async function recordPayment(request, response) {
  let connection
  let idempotency
  let transactionBeginAttempted = false
  let transactionStarted = false
  let commitAttempted = false
  let commitCompleted = false
  let connectionReusable = true

  try {
    const paymentRequest = normalizePaymentRequest(request)
    const { saleId, paymentCents } = paymentRequest
    idempotency = paymentRequest.idempotency

    connection = await pool.getConnection()
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    // Reserve before financial writes; only a completed matching response can be replayed.
    await reserveIdempotencyKey(connection, idempotency)

    // Lock sale before customer so concurrent payments see serialized outstanding totals.
    const sale = await lockCreditSale(connection, saleId)
    const saleOutstandingCents = validateSaleOutstanding(sale, paymentCents)

    // Check the customer ledger while locked before changing either outstanding balance.
    await lockAndValidateCustomerBalance(connection, sale.customer_id, paymentCents)
    const amounts = calculatePaymentAmounts(sale, saleOutstandingCents, paymentCents)

    // Sale totals, customer balance, payment history, activity, and replay response
    // remain in one transaction so failures cannot leave them out of sync.
    const paymentId = await persistPayment(connection, {
      saleId,
      customerId: sale.customer_id,
      userId: request.user.user_id,
      amounts,
    })

    const resultBody = buildPaymentResponse(paymentId, saleId, amounts)
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    // Save the response before commit so a completed payment can be replayed safely.
    commitAttempted = true
    await connection.commit()
    commitCompleted = true
    return response.status(201).json(resultBody)
  } catch (error) {
    const rejectionConfirmed = (error instanceof PaymentError || error instanceof IdempotencyError)
      && error.status < 500
    const failure = await resolveTransactionFailure({
      connection,
      transactionBeginAttempted,
      transactionStarted,
      commitAttempted,
      commitCompleted,
      error,
      operation: 'payment',
      rejectionConfirmed,
    })
    connectionReusable = failure.reusable
    if (error instanceof IdempotencyKeyConflictError && idempotency) {
```
#### Consecutive source section 2 of 2

```js
      try {
        const replay = await resolveIdempotencyReplay(pool, idempotency)
        if (replay.kind === 'payload-mismatch') {
          return response.status(409).json({
            success: false,
            code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            transaction_outcome: 'not_committed',
            message: 'Idempotency key was already used for a different request',
          })
        }
        if (replay.kind === 'replay') return response.status(replay.status).json(replay.body)
      } catch (replayError) {
        console.error('Unable to retrieve idempotent payment result:', replayError.message)
      }
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm payment status. Check transaction status before retrying.',
      })
    }

    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm payment status. Check transaction status before retrying.',
      })
    }
    if ((error instanceof PaymentError || error instanceof IdempotencyError) && failure.outcome === 'not_committed') {
      return response.status(error.status).json({
        success: false,
        code: rejectionConfirmed ? 'TRANSACTION_REJECTED' : 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: failure.outcome,
        message: error.message,
      })
    }
    console.error('Unable to record payment:', error.code || 'UNKNOWN')
    return response.status(500).json({
      success: false,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      transaction_outcome: 'unknown',
      message: 'Unable to record payment',
    })
  } finally {
    if (connectionReusable) connection?.release()
  }
}
```

## A5. Exact-scale monetary calculations

Source file: `server/utils/money.js`

### `toScaledInteger` — source lines 1–5

**Inputs and behavior:** Inputs: value, scale and error message. Round the scaled numeric value, require a safe integer, and return BigInt.

```js
// Documentation comment: Inputs: value, scale and error message. Round the scaled numeric value, require a safe integer, and return BigInt.
function toScaledInteger(value, scale, errorMessage) {
  const scaled = Math.round(Number(value) * scale)
  if (!Number.isSafeInteger(scaled)) throw new RangeError(errorMessage)
  return BigInt(scaled)
}
```
### `toCents` — source lines 7–10

**Inputs and behavior:** Input: monetary amount. Convert to a safe integer number of cents for exact arithmetic.

```js
// Documentation comment: Input: monetary amount. Convert to a safe integer number of cents for exact arithmetic.
export function toCents(value) {
  // Validate magnitude before converting to BigInt so every persisted cent value is exact.
  return toScaledInteger(value, 100, 'Monetary value exceeds safe integer precision')
}
```
### `toThousandths` — source lines 12–15

**Inputs and behavior:** Input: quantity. Convert to a safe integer number of thousandths for the stock scale.

```js
// Documentation comment: Input: quantity. Convert to a safe integer number of thousandths for the stock scale.
export function toThousandths(value) {
  // Inventory quantity is stored to three decimal places; mirror that scale in integer arithmetic.
  return toScaledInteger(value, 1000, 'Quantity exceeds safe integer precision')
}
```
### `lineTotalCents` — source lines 17–23

**Inputs and behavior:** Inputs: quantity and unit price. Multiply quantity-thousandths by price-cents and round half-up to integer cents.

```js
// Documentation comment: Inputs: quantity and unit price. Multiply quantity-thousandths by price-cents and round half-up to integer cents.
export function lineTotalCents(quantity, unitPrice) {
  // Multiplying thousandths by cents yields thousandths of a cent; add half a cent
  // before dividing so each non-negative line is rounded half-up independently.
  const product = toThousandths(quantity) * toCents(unitPrice)
  const rounded = (product + 500n) / 1000n
  return rounded
}
```
### `centsToAmount` — source lines 25–33

**Inputs and behavior:** Input: integer cents. Format whole and fractional parts as a fixed two-decimal string without converting to floating point.

```js
// Documentation comment: Input: integer cents. Format whole and fractional parts as a fixed two-decimal string without converting to floating point.
export function centsToAmount(cents) {
  // Format the integer and remainder separately instead of converting back to float.
  const value = BigInt(cents)
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const whole = absolute / 100n
  const fractional = String(absolute % 100n).padStart(2, '0')
  return `${sign}${whole}.${fractional}`
}
```

## A6. Idempotency key validation, reservation, replay, and response matching

Source file: `server/utils/idempotency.js`

### `getIdempotencyKey` — source lines 19–25

**Inputs and behavior:** Input: HTTP request. Validate required Idempotency-Key header length and allowed characters; return the key or throw a 400 error.

```js
// Documentation comment: Input: HTTP request. Validate required Idempotency-Key header length and allowed characters; return the key or throw a 400 error.
export function getIdempotencyKey(request) {
  const key = request.get('Idempotency-Key')?.trim()
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new IdempotencyError(400, 'A valid Idempotency-Key header is required')
  }
  return key
}
```
### `hashRequestPayload` — source lines 27–30

**Inputs and behavior:** Input: normalized payload. Serialize deterministically in caller-defined field order and return its SHA-256 digest.

```js
// Documentation comment: Input: normalized payload. Serialize deterministically in caller-defined field order and return its SHA-256 digest.
export function hashRequestPayload(payload) {
  // Callers normalize quantities and cents first so equivalent requests hash identically.
  return createHash('sha256').update(JSON.stringify(payload)).digest()
}
```
### `isIdempotencyReservationConflict` — source lines 32–36

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function isIdempotencyReservationConflict(error) {
  const databaseMessage = `${error.sqlMessage || ''} ${error.message || ''}`
  return error.code === 'ER_DUP_ENTRY'
    && /\buq_idempotency_user_operation_key\b/i.test(databaseMessage)
}
```
### `reserveIdempotencyKey` — source lines 38–54

**Inputs and behavior:** Inputs: transaction connection and request identity/hash. Insert reservation; convert only the named unique-index conflict to the dedicated conflict error.

```js
// Documentation comment: Inputs: transaction connection and request identity/hash. Insert reservation; convert only the named unique-index conflict to the dedicated conflict error.
export async function reserveIdempotencyKey(connection, { userId, operation, key, payloadHash }) {
  try {
    await connection.execute(
      `INSERT INTO idempotency_records
         (user_id, operation_type, idempotency_key, request_hash)
       VALUES (?, ?, ?, ?)`,
      [userId, operation, key, payloadHash],
    )
  } catch (error) {
    // Only the named request-scope index proves this is a retry collision; another
    // unique-key error may belong to business data and must not be replayed.
    if (isIdempotencyReservationConflict(error)) {
      throw new IdempotencyKeyConflictError(error)
    }
    throw error
  }
}
```
### `saveIdempotentResponse` — source lines 56–73

**Inputs and behavior:** Inputs: transaction connection, request identity, HTTP status and body. Persist replay result and require exactly one updated reservation.

```js
// Documentation comment: Inputs: transaction connection, request identity, HTTP status and body. Persist replay result and require exactly one updated reservation.
export async function saveIdempotentResponse(connection, {
  userId,
  operation,
  key,
  status,
  body,
}) {
  const [result] = await connection.execute(
    `UPDATE idempotency_records
     SET response_status = ?, response_body = ?
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?`,
    [status, JSON.stringify(body), userId, operation, key],
  )

  if (result.affectedRows !== 1) {
    throw new Error('Unable to persist the idempotent transaction result')
  }
}
```
### `findIdempotentResponse` — source lines 75–84

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function findIdempotentResponse(executor, { userId, operation, key }) {
  const [records] = await executor.execute(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_records
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?
     LIMIT 1`,
    [userId, operation, key],
  )
  return records[0] || null
}
```
### `resolveIdempotencyReplay` — source lines 86–95

**Inputs and behavior:** Inputs: executor and request identity. Load saved record and classify its response; malformed/incomplete results are unverified.

```js
// Documentation comment: Inputs: executor and request identity. Load saved record and classify its response; malformed/incomplete results are unverified.
export async function resolveIdempotencyReplay(executor, idempotency) {
  const record = await findIdempotentResponse(executor, idempotency)
  if (!record) return { kind: 'unverified' }

  try {
    return readIdempotentResponse(record, idempotency.payloadHash)
  } catch {
    return { kind: 'unverified' }
  }
}
```
### `readIdempotentResponse` — source lines 97–113

**Inputs and behavior:** Inputs: stored record and current payload hash. Distinguish missing/incomplete/mismatched requests from a matching saved-response replay.

```js
// Documentation comment: Inputs: stored record and current payload hash. Distinguish missing/incomplete/mismatched requests from a matching saved-response replay.
export function readIdempotentResponse(record, payloadHash) {
  if (!record) return { kind: 'missing' }
  // A reservation without a response may be in flight or uncertain, not completed.
  if (!record.response_status || !record.response_body) {
    throw new Error('The idempotent transaction result is incomplete')
  }
  // Reusing a key with different normalized input must never return another request's result.
  if (!Buffer.from(record.request_hash).equals(payloadHash)) return { kind: 'payload-mismatch' }

  return {
    kind: 'replay',
    status: Number(record.response_status),
    body: typeof record.response_body === 'string'
      ? JSON.parse(record.response_body)
      : record.response_body,
  }
}
```

## A7. Password authentication, MFA verification, logout audit, and current-user retrieval

Source file: `server/controllers/authController.js`

### `login` — source lines 21–101

**Inputs and behavior:** Input: username/password request and network address. Rate-limit, load account, verify active state/password/verified email, issue MFA challenge, deliver code and report controlled failures.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Input: username/password request and network address. Rate-limit, load account, verify active state/password/verified email, issue MFA challenge, deliver code and report controlled failures.
export async function login(request, response) {
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''

  if (!username || !password) {
    return response.status(401).json(invalidCredentials)
  }

  try {
    response.set('Cache-Control', 'no-store')
    // Rate-limit before password work, then require a live account and verified email
    // before issuing an MFA challenge; login does not issue a session token yet.
    await enforceLoginRateLimits({ username, ipAddress: getRequestIp(request) })
    const [users] = await pool.execute(
      `SELECT user_id, fullname, username, password, role, is_active, auth_version,
              email, email_verified_at
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username],
    )
    const user = users[0]

    if (!user) {
      return response.status(401).json(invalidCredentials)
    }

    if (!user.is_active) {
      return response.status(403).json({
        success: false,
        message: 'This account is inactive',
      })
    }

    const passwordMatches = await bcrypt.compare(password, user.password)

    if (!passwordMatches) {
      return response.status(401).json(invalidCredentials)
    }

    if (!user.email || !user.email_verified_at) {
      return response.status(403).json({
        success: false,
        message: 'This account needs an active, verified email address. Contact an administrator.',
      })
    }

    const challenge = await createLoginChallenge(user, getRequestIp(request))
    try {
      await sendLoginMfaCode({
        email: user.email,
        code: challenge.code,
        expiryMinutes: environment.mfa.otpExpiryMinutes,
      })
    } catch {
      await invalidateLoginChallenge(challenge.challengeId)
      return response.status(503).json({
        success: false,
        message: 'Unable to send the verification code. Please try again later.',
      })
```
#### Consecutive source section 2 of 2

```js
    }

    return response.json({
      success: true,
      message: 'A verification code was sent to your registered email address.',
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to authenticate user:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to complete login',
    })
  }
}
```
### `verifyLoginMfa` — source lines 103–148

**Inputs and behavior:** Input: challenge ID, code and network address. Consume valid MFA challenge, mint eight-hour JWT, best-effort log login, and return user/session.

```js
// Documentation comment: Input: challenge ID, code and network address. Consume valid MFA challenge, mint eight-hour JWT, best-effort log login, and return user/session.
export async function verifyLoginMfa(request, response) {
  response.set('Cache-Control', 'no-store')
  try {
    // The challenge service validates and consumes the code first; only then is an
    // eight-hour JWT minted with an explicit MFA-verified claim.
    const user = await consumeLoginChallenge({
      challengeId: request.body?.challengeId,
      code: request.body?.code,
      ipAddress: getRequestIp(request),
    })
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        auth_version: Number(user.auth_version || 0),
        mfa_verified: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    )
    pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'LOGIN', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `${user.username} logged in`],
    ).catch((error) => console.error('Unable to record login activity:', error.message))

    return response.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        user_id: user.user_id,
        fullname: user.fullname,
        username: user.username,
        role: user.role,
      },
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to verify login code:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to verify the code. Please try again.' })
  }
}
```
### `logout` — source lines 185–198

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function logout(request, response) {
  try {
    await pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'LOGOUT', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, 'User logged out'],
    )

    return response.json({ success: true })
  } catch (error) {
    console.error('Unable to record logout activity:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to record logout activity' })
  }
}
```
### `getCurrentUser` — source lines 200–241

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getCurrentUser(request, response) {
  try {
    const [users] = await pool.execute(
      `SELECT user_id, fullname, username, role, is_active
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [request.user.user_id],
    )
    const user = users[0]

    if (!user) {
      return response.status(404).json({
        success: false,
        message: 'User not found',
      })
    }

    if (!user.is_active) {
      return response.status(403).json({
        success: false,
        message: 'This account is inactive',
      })
    }

    return response.json({
      success: true,
      user: {
        user_id: user.user_id,
        fullname: user.fullname,
        username: user.username,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Unable to retrieve authenticated user:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to retrieve authenticated user',
    })
  }
}
```

## A8. JWT session and role/capability authorization middleware

Source file: `server/middleware/authenticate.js`

### `authenticate` — source lines 5–52

**Inputs and behavior:** Input: HTTP bearer token. Verify JWT then compare current account role/status/version and MFA claim before attaching claims to request.

```js
// Documentation comment: Input: HTTP bearer token. Verify JWT then compare current account role/status/version and MFA claim before attaching claims to request.
export default async function authenticate(request, response, next) {
  const authorization = request.get('Authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return response.status(401).json({
      success: false,
      message: 'Authentication required',
    })
  }

  const token = authorization.slice(7).trim()

  if (!token) {
    return response.status(401).json({
      success: false,
      message: 'Authentication required',
    })
  }

  try {
    // JWT signature/expiry is not enough: compare current DB role, active state, and
    // auth_version so account changes revoke old sessions, and require completed MFA.
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const [users] = await pool.execute(
      `SELECT role, is_active, auth_version
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [payload.user_id],
    )
    const user = users[0]

    if (!sessionMatchesUser(payload, user) || !sessionMatchesMfa(payload)) {
      return response.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      })
    }

    request.user = payload
    return next()
  } catch {
    return response.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    })
  }
}
```

## A9. Role and capability authorization functions

Source file: `server/middleware/authorizeRoles.js`

### `authorizeRoles` — source lines 3–19

**Inputs and behavior:** Input: allowed role list. Return middleware that permits only authenticated users whose current request role is listed.

```js
// Documentation comment: Input: allowed role list. Return middleware that permits only authenticated users whose current request role is listed.
export default function authorizeRoles(...allowedRoles) {
  function authorize(request, response, next) {
    // Authentication establishes the current role; each route then supplies its own
    // allow-list, keeping staff access explicit instead of implied.
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      return response.status(403).json({
        success: false,
        message: 'Access denied',
      })
    }

    return next()
  }

  authorize.allowedRoles = allowedRoles
  return authorize
}
```
### `authorizeCapability` — source lines 21–30

**Inputs and behavior:** Input: capability name. Return middleware that checks the shared role-capability mapping.

```js
// Documentation comment: Input: capability name. Return middleware that checks the shared role-capability mapping.
export function authorizeCapability(capability) {
  function authorize(request, response, next) {
    if (!request.user || !hasCapability(request.user.role, capability)) {
      return response.status(403).json({ success: false, message: 'Access denied' })
    }
    return next()
  }
  authorize.capability = capability
  return authorize
}
```

## A10. Report validation, filtering, pagination, and calculations

Source file: `server/controllers/reportController.js`

### `validDate` — source lines 5–10

**Inputs and behavior:** Input: date string. Check only YYYY-MM-DD syntax; calendar-date validity is not checked here.

```js
// Documentation comment: Input: date string. Check only YYYY-MM-DD syntax; calendar-date validity is not checked here.
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
```
### `salesFilters` — source lines 12–68

**Inputs and behavior:** Inputs: report query and interactive-filter flag. Validate dates/types/search and produce SQL clauses with separately snapshotted summary parameters.

```js
// Documentation comment: Inputs: report query and interactive-filter flag. Validate dates/types/search and produce SQL clauses with separately snapshotted summary parameters.
function salesFilters(query, { includeInteractive = false } = {}) {
  const clauses = []
  const parameters = []

  if (query.start_date) {
    if (!validDate(query.start_date)) throw new Error('Invalid start date')
    clauses.push('sa.sale_date >= ?')
    parameters.push(`${query.start_date} 00:00:00`)
  }
  if (query.end_date) {
    if (!validDate(query.end_date)) throw new Error('Invalid end date')
    // Use an exclusive next-day bound so the selected end date includes every time
    // through its final second without relying on timestamp precision.
    clauses.push('sa.sale_date < DATE_ADD(?, INTERVAL 1 DAY)')
    parameters.push(`${query.end_date} 00:00:00`)
  }
  if (query.start_date && query.end_date && query.start_date > query.end_date) {
    throw new Error('Start date cannot be after end date')
  }
  if (query.payment_type) {
    if (!['Cash', 'Credit'].includes(query.payment_type)) throw new Error('Invalid payment type')
    clauses.push('sa.payment_type = ?')
    parameters.push(query.payment_type)
  }
  if (query.user_id) {
    const userId = Number(query.user_id)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid user ID')
    clauses.push('sa.user_id = ?')
    parameters.push(userId)
  }

  if (includeInteractive && query.status) {
    if (!['Paid', 'Partially Paid', 'Unpaid'].includes(query.status)) throw new Error('Invalid status')
    clauses.push('sa.status = ?')
    parameters.push(query.status)
  }
  if (includeInteractive && query.search) {
    const search = String(query.search).trim()
    if (search.length > 100) throw new Error('Search text must not exceed 100 characters')
    if (search) {
      clauses.push(`(CAST(sa.sale_id AS CHAR) LIKE ? OR CONCAT('OR-', sa.sale_id) LIKE ?
        OR c.customer_name LIKE ? OR u.fullname LIKE ? OR sa.payment_type LIKE ? OR sa.status LIKE ?)`)
      parameters.push(...Array(6).fill(`%${search}%`))
    }
  }

  // Snapshot the same filters for totals before pagination parameters are added.
  const summaryWhere = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const summaryParameters = [...parameters]

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    parameters,
    summaryWhere,
    summaryParameters,
  }
}
```
### `pagination` — source lines 70–79

**Inputs and behavior:** Input: query parameters. Validate positive safe page and size, cap size at 100, and reject unsafe offset arithmetic.

```js
// Documentation comment: Input: query parameters. Validate positive safe page and size, cap size at 100, and reject unsafe offset arithmetic.
function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const pageSize = query.page_size === undefined ? 25 : Number(query.page_size)
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid page size')
  // Bound both page size and offset so malformed or enormous query values fail early.
  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid page')
  return { page, pageSize, offset }
}
```
### `paginationMetadata` — source lines 81–88

**Inputs and behavior:** Inputs: page descriptor and total row count. Return page, page size, record count and computed page count.

```js
// Documentation comment: Inputs: page descriptor and total row count. Return page, page size, record count and computed page count.
function paginationMetadata(page, totalRecords) {
  return {
    page: page.page,
    page_size: page.pageSize,
    total_records: totalRecords,
    total_pages: Math.ceil(totalRecords / page.pageSize),
  }
}
```
### `receivablesSearch` — source lines 90–100

**Inputs and behavior:** Inputs: query and optional table alias. Trim/bound search and build customer-column LIKE predicates with bound parameters.

```js
// Documentation comment: Inputs: query and optional table alias. Trim/bound search and build customer-column LIKE predicates with bound parameters.
function receivablesSearch(query, columnPrefix = '') {
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search.length > 100) throw new Error('Invalid search text')

  const columns = ['customer_name', 'contact_number', 'address']
    .map((column) => `${columnPrefix}${column}`)
  return {
    where: search ? ` AND (${columns.map((column) => `${column} LIKE ?`).join(' OR ')})` : '',
    parameters: search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [],
  }
}
```
### `productSalesFilters` — source lines 102–115

**Inputs and behavior:** Input: product IDs and optional year query. Validate 1–50 positive IDs and four-digit reporting year.

```js
// Documentation comment: Input: product IDs and optional year query. Validate 1–50 positive IDs and four-digit reporting year.
function productSalesFilters(query) {
  const rawIds = typeof query.product_ids === 'string' ? query.product_ids : ''
  const productIds = rawIds.split(',').filter(Boolean).map(Number)
  if (!productIds.length || productIds.length > 50
    || productIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Select between 1 and 50 valid products')
  }

  const year = query.year ? Number(query.year) : null
  if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999)) {
    throw new Error('Invalid reporting year')
  }
  return { productIds, year }
}
```
### `getSalesReport` — source lines 117–181

**Inputs and behavior:** Input: report query. Execute filtered/paginated sale rows, full-filter financial summary and count queries, then return metadata.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Input: report query. Execute filtered/paginated sale rows, full-filter financial summary and count queries, then return metadata.
export async function getSalesReport(request, response) {
  try {
    const { where, parameters, summaryWhere, summaryParameters } = salesFilters(request.query, { includeInteractive: true })
    const page = pagination(request.query)
    const paginationParams = [String(page.pageSize), String(page.offset)]
    const [records] = await pool.execute(
      `SELECT sa.sale_id,
              sa.customer_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              COALESCE(c.customer_name, 'Walk-In Customer') AS customer_name,
              u.fullname AS recorded_by, sa.payment_type, sa.total_amount,
              sa.amount_paid, sa.remaining_balance, sa.status,
              COALESCE(payment_totals.later_payments_total, 0) AS later_payments_total
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       LEFT JOIN (
         SELECT sale_id, SUM(payment_amount) AS later_payments_total
         FROM payments GROUP BY sale_id
       ) payment_totals ON payment_totals.sale_id = sa.sale_id
       ${where}
       ORDER BY sa.sale_date DESC, sa.sale_id DESC
       LIMIT ? OFFSET ?`,
      [...parameters, ...paginationParams],
    )
    // This aggregate intentionally covers the complete filtered result set; LIMIT/OFFSET
    // is applied only to the visible records above.
    const [summaries] = await pool.execute(
      `SELECT COUNT(*) AS total_transactions,
              COALESCE(SUM(sa.total_amount), 0) AS gross_sales,
              COALESCE(SUM(CASE WHEN sa.payment_type = 'Cash' THEN sa.total_amount ELSE 0 END), 0) AS cash_sales_total,
              COALESCE(SUM(CASE WHEN sa.payment_type = 'Credit' THEN sa.total_amount ELSE 0 END), 0) AS credit_sales_total,
              COALESCE(SUM(sa.amount_paid), 0) AS total_amount_paid,
              COALESCE(SUM(sa.remaining_balance), 0) AS outstanding_balance
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       ${summaryWhere}`,
      summaryParameters,
    )
    const [counts] = await pool.execute(
      `SELECT COUNT(*) AS total_records
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       ${where}`,
      parameters,
    )
    const totalRecords = Number(counts[0]?.total_records || 0)
    return response.json({
      success: true,
      data: {
        summary: summaries[0],
        records,
        pagination: paginationMetadata(page, totalRecords),
      },
    })
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Start date')) {
      return response.status(400).json({ success: false, message: error.message })
```
#### Consecutive source section 2 of 2

```js
    }
    console.error('Unable to generate sales report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate sales report' })
  }
}
```
### `getSalesReportDetail` — source lines 183–245

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

#### Consecutive source section 1 of 2

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getSalesReportDetail(request, response) {
  const saleId = Number(request.params.id)
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return response.status(400).json({ success: false, message: 'Invalid sale ID' })
  }

  try {
    const [sales] = await pool.execute(
      `SELECT sa.sale_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              sa.customer_id,
              COALESCE(c.customer_name, 'Walk-in Customer') AS customer_name,
              c.contact_number, c.address, u.fullname AS recorded_by,
              sa.payment_type, sa.total_amount, sa.amount_paid,
              sa.remaining_balance, sa.status
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       WHERE sa.sale_id = ?
       LIMIT 1`,
      [saleId],
    )

    if (!sales[0]) {
      return response.status(404).json({ success: false, message: 'Sale not found' })
    }

    const [items] = await pool.execute(
      `SELECT si.salesitem_id, si.product_id, p.product_name, p.unit,
              si.quantity, si.price, si.subtotal
       FROM sales_items si
       JOIN products p ON si.product_id = p.product_id
       WHERE si.sale_id = ?
       ORDER BY si.salesitem_id ASC`,
      [saleId],
    )
    const [payments] = await pool.execute(
      `SELECT pa.payment_id, pa.payment_amount, pa.remaining_balance,
              CONCAT(DATE_FORMAT(pa.payment_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS payment_date,
              u.fullname AS recorded_by
       FROM payments pa
       JOIN users u ON pa.user_id = u.user_id
       WHERE pa.sale_id = ?
       ORDER BY pa.payment_date ASC, pa.payment_id ASC`,
      [saleId],
    )

    return response.json({
      success: true,
      data: {
        sale: {
          ...sales[0],
          customer_type: sales[0].payment_type === 'Credit' ? 'Credit Supplier' : 'Walk-in',
        },
        items,
        payments,
      },
    })
  } catch (error) {
    console.error('Unable to retrieve sale details:', error.message)
```
#### Consecutive source section 2 of 2

```js
    return response.status(500).json({ success: false, message: 'Unable to retrieve sale details' })
  }
}
```
### `getInventoryReport` — source lines 247–297

**Inputs and behavior:** Input: request/response. Aggregate live batch cost, estimated current selling value, status counts and stock quantity by unit.

```js
// Documentation comment: Input: request/response. Aggregate live batch cost, estimated current selling value, status counts and stock quantity by unit.
export async function getInventoryReport(request, response) {
  try {
    // Cost value uses only remaining quantities in live batches; estimated sales value
    // uses the product's current aggregate stock and current selling price.
    const [records] = await pool.execute(`
      SELECT p.product_id, p.product_name, p.category, p.unit, p.stock_quantity,
             p.reorder_level, p.status, p.selling_price,
             COALESCE(SUM(si.remaining_quantity * si.cost_price), 0) AS inventory_cost_value,
             p.stock_quantity * p.selling_price AS estimated_sales_value
      FROM products p
      LEFT JOIN stock_in si ON p.product_id = si.product_id AND si.remaining_quantity > 0
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY p.product_name ASC
    `)
    const [summaries] = await pool.execute(`
      SELECT COUNT(*) AS total_products,
             COALESCE(SUM(valuation.inventory_cost_value), 0) AS total_inventory_cost_value,
             COALESCE(SUM(valuation.estimated_sales_value), 0) AS estimated_total_sales_value,
             SUM(valuation.status = 'Low Stock') AS low_stock_count,
             SUM(valuation.status = 'Out of Stock') AS out_of_stock_count
      FROM (
        SELECT p.product_id, p.status,
               COALESCE(SUM(si.remaining_quantity * si.cost_price), 0) AS inventory_cost_value,
               p.stock_quantity * p.selling_price AS estimated_sales_value
        FROM products p
        LEFT JOIN stock_in si ON p.product_id = si.product_id AND si.remaining_quantity > 0
        WHERE p.is_active = TRUE
        GROUP BY p.product_id
      ) valuation
    `)
    const [quantityByUnit] = await pool.execute(`
      SELECT unit, SUM(stock_quantity) AS total_quantity
      FROM products WHERE is_active = TRUE GROUP BY unit ORDER BY unit
    `)

    return response.json({
      success: true,
      data: {
        summary: {
          ...summaries[0],
          quantity_by_unit: quantityByUnit,
        },
        records,
      },
    })
  } catch (error) {
    console.error('Unable to generate inventory report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate inventory report' })
  }
}
```
### `getReceivablesReport` — source lines 299–344

**Inputs and behavior:** Input: search/page query. Return active customers with positive balances, open-sale aggregates, global balance summary and pagination.

```js
// Documentation comment: Input: search/page query. Return active customers with positive balances, open-sale aggregates, global balance summary and pagination.
export async function getReceivablesReport(request, response) {
  try {
    const page = pagination(request.query)
    const paginationParams = [String(page.pageSize), String(page.offset)]
    // Use the same trimmed term and bind order for count and row queries; only table qualification differs.
    const countSearch = receivablesSearch(request.query)
    const rowSearch = receivablesSearch(request.query, 'c.')
    const [counts] = await pool.execute(`
      SELECT COUNT(*) AS total_records
      FROM customers WHERE is_active = TRUE AND current_balance > 0${countSearch.where}
    `, countSearch.parameters)
    // Rows include only customers with a balance, while each customer's open-sale
    // count and oldest date derive from credit sales that still have a balance.
    const [records] = await pool.execute(`
      SELECT c.customer_id, c.customer_name, c.contact_number, c.address, c.current_balance,
             COUNT(sa.sale_id) AS open_credit_sales,
             CONCAT(DATE_FORMAT(MIN(sa.sale_date), '%Y-%m-%dT%H:%i:%s'), '+08:00') AS oldest_unpaid_sale_date,
             COALESCE(SUM(sa.total_amount), 0) AS total_original_credit_amount
      FROM customers c
      LEFT JOIN sales sa ON c.customer_id = sa.customer_id
          AND sa.payment_type = 'Credit' AND sa.remaining_balance > 0
      WHERE c.is_active = TRUE AND c.current_balance > 0${rowSearch.where}
      GROUP BY c.customer_id
      ORDER BY c.current_balance DESC, c.customer_name ASC
      LIMIT ? OFFSET ?
    `, [...rowSearch.parameters, ...paginationParams])
    // Keep the headline receivables total global even when row search narrows the page.
    const [summaries] = await pool.execute(`
      SELECT COUNT(*) AS customers_with_balance, COALESCE(SUM(current_balance), 0) AS total_receivables
      FROM customers WHERE is_active = TRUE AND current_balance > 0
    `)
    const totalRecords = Number(counts[0]?.total_records || 0)
    return response.json({
      success: true,
      data: {
        summary: summaries[0],
        records,
        pagination: paginationMetadata(page, totalRecords),
      },
    })
  } catch (error) {
    if (error.message.startsWith('Invalid')) return response.status(400).json({ success: false, message: error.message })
    console.error('Unable to generate receivables report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate receivables report' })
  }
}
```
### `getProductSalesReport` — source lines 346–378

**Inputs and behavior:** Inputs: selected product IDs and optional year. Aggregate sold quantity and subtotal by product/year/month using bound values.

```js
// Documentation comment: Inputs: selected product IDs and optional year. Aggregate sold quantity and subtotal by product/year/month using bound values.
export async function getProductSalesReport(request, response) {
  let filters
  try {
    filters = productSalesFilters(request.query)
  } catch (error) {
    return response.status(400).json({ success: false, message: error.message })
  }
  const { productIds, year } = filters

  try {
    const yearFilter = year === null ? '' : 'AND YEAR(sa.sale_date) = ?'
    const parameters = year === null ? productIds : [...productIds, year]
    // The database performs the period aggregation for the selected product IDs;
    // optional year filtering happens before grouping by product/year/month.
    const [records] = await pool.execute(
      `SELECT si.product_id, p.product_name, YEAR(sa.sale_date) AS sale_year,
              MONTH(sa.sale_date) AS sale_month,
              SUM(si.quantity) AS quantity_sold,
              SUM(si.subtotal) AS sales_amount
       FROM sales_items si
       JOIN sales sa ON sa.sale_id = si.sale_id
       JOIN products p ON p.product_id = si.product_id
       WHERE si.product_id IN (${productIds.map(() => '?').join(', ')}) ${yearFilter}
       GROUP BY si.product_id, p.product_name, YEAR(sa.sale_date), MONTH(sa.sale_date)
       ORDER BY sale_year ASC, sale_month ASC, si.product_id ASC`,
      parameters,
    )
    return response.json({ success: true, data: { records } })
  } catch (error) {
    console.error('Unable to generate product sales report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate product sales report' })
  }
}
```

## A11. Operational report filtering and retrieval

Source file: `server/controllers/operationalReportController.js`

### `pagination` — source lines 3–11

**Inputs and behavior:** Input: query parameters. Validate positive safe page and size, cap size at 100, and reject unsafe offset arithmetic.

```js
// Documentation comment: Input: query parameters. Validate positive safe page and size, cap size at 100, and reject unsafe offset arithmetic.
function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const pageSize = query.page_size === undefined ? 25 : Number(query.page_size)
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid page size')
  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid page')
  return { page, pageSize, offset }
}
```
### `dateFilters` — source lines 13–33

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function dateFilters(query, column) {
  const clauses = []
  const parameters = []
  for (const [field, operator] of [['start_date', '>=' ], ['end_date', '<']]) {
    const value = query[field]
    if (!value) continue
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    const calendarDate = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    if (!calendarDate || calendarDate.getUTCFullYear() !== Number(match[1])
      || calendarDate.getUTCMonth() !== Number(match[2]) - 1
      || calendarDate.getUTCDate() !== Number(match[3])) {
      throw new Error(`Invalid ${field.replace('_', ' ')}`)
    }
    clauses.push(operator === '<' ? `${column} < DATE_ADD(?, INTERVAL 1 DAY)` : `${column} >= ?`)
    parameters.push(`${value} 00:00:00`)
  }
  if (query.start_date && query.end_date && query.start_date > query.end_date) {
    throw new Error('Start date cannot be after end date')
  }
  return { clauses, parameters }
}
```
### `searchTerm` — source lines 35–39

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function searchTerm(query) {
  const value = typeof query.search === 'string' ? query.search.trim() : ''
  if (value.length > 100) throw new Error('Invalid search text')
  return value
}
```
### `pageData` — source lines 41–43

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function pageData(page, total) {
  return { page: page.page, page_size: page.pageSize, total_records: total, total_pages: Math.ceil(total / page.pageSize) }
}
```
### `getOperationalReport` — source lines 45–241

**Inputs and behavior:** Input: report type and query filters. Validate paging/search, execute branch-specific sales/inventory/stock-in/receivables queries, summaries, and response.

#### Consecutive source section 1 of 4

```js
// Documentation comment: Input: report type and query filters. Validate paging/search, execute branch-specific sales/inventory/stock-in/receivables queries, summaries, and response.
export async function getOperationalReport(request, response) {
  const report = request.params.report
  if (!['sales', 'inventory', 'stock-in', 'receivables'].includes(report)) {
    return response.status(404).json({ success: false, message: 'Operational report not found' })
  }

  try {
    const page = pagination(request.query)
    const search = searchTerm(request.query)
    const pageParams = [String(page.pageSize), String(page.offset)]
    let records
    let total
    let summary = null

    if (report === 'sales') {
      const dates = dateFilters(request.query, 'sa.sale_date')
      const filters = [...dates.clauses]
      const params = [...dates.parameters]
      if (request.query.payment_type) {
        if (!['Cash', 'Credit'].includes(request.query.payment_type)) throw new Error('Invalid payment type')
        filters.push('sa.payment_type = ?')
        params.push(request.query.payment_type)
      }
      if (request.query.status) {
        if (!['Paid', 'Partially Paid', 'Unpaid'].includes(request.query.status)) throw new Error('Invalid status')
        filters.push('sa.status = ?')
        params.push(request.query.status)
      }
      if (search) {
        filters.push(`(CAST(sa.sale_id AS CHAR) LIKE ? OR c.customer_name LIKE ? OR u.fullname LIKE ?
          OR EXISTS (SELECT 1 FROM sales_items search_items
                     JOIN products search_products ON search_products.product_id = search_items.product_id
                     WHERE search_items.sale_id = sa.sale_id AND search_products.product_name LIKE ?))`)
        params.push(...Array(4).fill(`%${search}%`))
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM sales sa
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT sa.sale_id,
                CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
                COALESCE(c.customer_name, 'Walk-In Customer') AS customer_name,
                sa.payment_type, sa.status,
                COALESCE(items.item_count, 0) AS item_count
         FROM sales sa
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id
         LEFT JOIN (SELECT sale_id, COUNT(*) AS item_count
                    FROM sales_items GROUP BY sale_id) items ON items.sale_id = sa.sale_id
         ${where}
         ORDER BY sa.sale_date DESC, sa.sale_id DESC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      const [totals] = await pool.execute(
        `SELECT COUNT(*) AS transaction_count
         FROM sales sa LEFT JOIN customers c ON c.customer_id = sa.customer_id
```
#### Consecutive source section 2 of 4

```js
         JOIN users u ON u.user_id = sa.user_id ${where}`,
        params,
      )
      const [quantityByUnit] = await pool.execute(
        `SELECT p.unit, COALESCE(SUM(si.quantity), 0) AS total_quantity
         FROM sales sa JOIN sales_items si ON si.sale_id = sa.sale_id
         JOIN products p ON p.product_id = si.product_id
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id ${where}
         GROUP BY p.unit ORDER BY p.unit`,
        params,
      )
      const saleIds = rows.map((row) => Number(row.sale_id))
      let quantitiesBySale = new Map()
      let productsBySale = new Map()
      if (saleIds.length > 0) {
        const placeholders = saleIds.map(() => '?').join(', ')
        const [saleQuantities] = await pool.execute(
          `SELECT si.sale_id, p.unit, SUM(si.quantity) AS total_quantity
           FROM sales_items si JOIN products p ON p.product_id = si.product_id
           WHERE si.sale_id IN (${placeholders})
           GROUP BY si.sale_id, p.unit ORDER BY si.sale_id, p.unit`,
          saleIds,
        )
        quantitiesBySale = new Map()
        for (const item of saleQuantities) {
          const saleId = Number(item.sale_id)
          const quantities = quantitiesBySale.get(saleId) || []
          quantities.push({ unit: item.unit, total_quantity: item.total_quantity })
          quantitiesBySale.set(saleId, quantities)
        }
        const [saleProducts] = await pool.execute(
          `SELECT si.sale_id, p.product_name, p.unit, SUM(si.quantity) AS quantity_sold
           FROM sales_items si JOIN products p ON p.product_id = si.product_id
           WHERE si.sale_id IN (${placeholders})
           GROUP BY si.sale_id, p.product_id, p.product_name, p.unit
           ORDER BY si.sale_id, p.product_name, p.unit`,
          saleIds,
        )
        for (const item of saleProducts) {
          const saleId = Number(item.sale_id)
          const products = productsBySale.get(saleId) || []
          products.push({ product_name: item.product_name, unit: item.unit, quantity_sold: item.quantity_sold })
          productsBySale.set(saleId, products)
        }
      }
      records = rows.map((row) => ({
        ...row,
        quantity_by_unit: quantitiesBySale.get(Number(row.sale_id)) || [],
        products_sold: productsBySale.get(Number(row.sale_id)) || [],
      }))
      total = Number(counts[0]?.total_records || 0)
      summary = { ...totals[0], quantity_by_unit: quantityByUnit }
    } else if (report === 'inventory') {
      const where = search ? `AND (product_name LIKE ? OR category LIKE ? OR unit LIKE ?)` : ''
      const params = search ? Array(3).fill(`%${search}%`) : []
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM products WHERE is_active = TRUE ${where}`,
        params,
      )
```
#### Consecutive source section 3 of 4

```js
      const [rows] = await pool.execute(
        `SELECT product_id, product_name, category, unit, stock_quantity, reorder_level, status
         FROM products WHERE is_active = TRUE ${where}
         ORDER BY product_name ASC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      const [totals] = await pool.execute(`
        SELECT COUNT(*) AS active_products,
               SUM(stock_quantity <= reorder_level) AS low_stock_products,
               SUM(status = 'Out of Stock') AS out_of_stock_products
        FROM products WHERE is_active = TRUE
      `)
      const [byUnit] = await pool.execute(`
        SELECT unit, SUM(stock_quantity) AS total_quantity
        FROM products WHERE is_active = TRUE GROUP BY unit ORDER BY unit
      `)
      records = rows
      total = Number(counts[0]?.total_records || 0)
      summary = { ...totals[0], quantity_by_unit: byUnit }
    } else if (report === 'stock-in') {
      const dates = dateFilters(request.query, 'si.delivery_date')
      const filters = [...dates.clauses]
      const params = [...dates.parameters]
      if (search) {
        filters.push('(CAST(si.stockin_id AS CHAR) LIKE ? OR s.supplier_name LIKE ? OR p.product_name LIKE ?)')
        params.push(...Array(3).fill(`%${search}%`))
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM stock_in si
         JOIN suppliers s ON s.supplier_id = si.supplier_id
         JOIN products p ON p.product_id = si.product_id ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT si.stockin_id, s.supplier_name,
                p.product_name, p.unit, si.quantity_received,
                CONCAT(DATE_FORMAT(si.delivery_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS delivery_date
         FROM stock_in si JOIN suppliers s ON s.supplier_id = si.supplier_id
         JOIN products p ON p.product_id = si.product_id
         ${where} ORDER BY si.delivery_date DESC, si.stockin_id DESC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      records = rows
      total = Number(counts[0]?.total_records || 0)
    } else {
      const where = search ? 'AND (customer_name LIKE ? OR CAST(customer_id AS CHAR) LIKE ?)' : ''
      const params = search ? Array(2).fill(`%${search}%`) : []
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM customers
         WHERE is_active = TRUE AND current_balance > 0 ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT customer_id, customer_name, current_balance
         FROM customers WHERE is_active = TRUE AND current_balance > 0 ${where}
         ORDER BY current_balance DESC, customer_name ASC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      const [totals] = await pool.execute(`
```
#### Consecutive source section 4 of 4

```js
        SELECT COUNT(*) AS customers_with_balance, COALESCE(SUM(current_balance), 0) AS total_receivables
        FROM customers WHERE is_active = TRUE AND current_balance > 0
      `)
      records = rows
      total = Number(counts[0]?.total_records || 0)
      summary = totals[0]
    }

    return response.json({ success: true, data: { report, summary, records, pagination: pageData(page, total) } })
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Start date')) {
      return response.status(400).json({ success: false, message: error.message })
    }
    console.error('Unable to retrieve operational report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve operational report' })
  }
}
```

## A12. Dashboard aggregation, calendar series, and product ranking

Source file: `server/controllers/dashboardController.js`

### `manilaCalendar` — source lines 6–20

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function manilaCalendar() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year').value)
  const monthLabel = parts.find((part) => part.type === 'month').value
  const month = new Date(`${monthLabel} 1, ${year} 00:00:00 UTC`).getUTCMonth() + 1

  return {
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthLabel,
  }
}
```
### `fillSeries` — source lines 22–31

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function fillSeries(length, rows, indexField, labelForIndex) {
  // Database rows contain only non-empty buckets; a Map lets the fixed calendar series
  // be filled in one pass without searching the rows for every label.
  const values = new Map(rows.map((row) => [Number(row[indexField]), row]))
  return Array.from({ length }, (_, index) => ({
    label: labelForIndex(index),
    sales: values.get(index) ? Number(values.get(index).sales) : 0,
    transactions: values.get(index) ? Number(values.get(index).transactions) : 0,
  }))
}
```
### `getStaffDashboardData` — source lines 33–91

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
async function getStaffDashboardData() {
  const [summaryRows] = await pool.execute(`
    SELECT
      (SELECT COUNT(*) FROM sales
       WHERE sale_date >= ${manilaCurrentDate}
         AND sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY) AS today_transactions,
      (SELECT COALESCE(SUM(current_balance), 0) FROM customers
       WHERE is_active = TRUE) AS outstanding_credits
  `)
  const [recentTransactions] = await pool.execute(`
    SELECT transaction_type, reference_id, customer_name, status, occurred_at
    FROM (
      SELECT 'Sale' AS transaction_type, sa.sale_id AS reference_id,
             COALESCE(c.customer_name, 'Walk-In Customer') AS customer_name,
             sa.status,
             CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS occurred_at
      FROM sales sa
      LEFT JOIN customers c ON c.customer_id = sa.customer_id
      UNION ALL
      SELECT 'Payment' AS transaction_type, pa.payment_id AS reference_id,
             c.customer_name,
             'Recorded' AS status,
             CONCAT(DATE_FORMAT(pa.payment_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS occurred_at
      FROM payments pa
      JOIN customers c ON c.customer_id = pa.customer_id
    ) transactions
    ORDER BY occurred_at DESC, reference_id DESC
    LIMIT 10
  `)
  const [lowStock] = await pool.execute(`
    SELECT product_id, product_name, unit, stock_quantity, reorder_level, status
    FROM products WHERE is_active = TRUE AND stock_quantity <= reorder_level
    ORDER BY stock_quantity ASC, product_name ASC LIMIT 10
  `)
  const [todayQuantityByUnit] = await pool.execute(`
    SELECT p.unit, SUM(si.quantity) AS total_quantity
    FROM sales_items si JOIN sales sa ON sa.sale_id = si.sale_id
    JOIN products p ON p.product_id = si.product_id
    WHERE sa.sale_date >= ${manilaCurrentDate}
      AND sa.sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY
    GROUP BY p.unit ORDER BY p.unit
  `)
  const [recentStockIn] = await pool.execute(`
    SELECT si.stockin_id, s.supplier_name, p.product_name, p.unit,
           si.quantity_received,
           CONCAT(DATE_FORMAT(si.delivery_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS delivery_date
    FROM stock_in si JOIN suppliers s ON s.supplier_id = si.supplier_id
    JOIN products p ON p.product_id = si.product_id
    ORDER BY si.delivery_date DESC, si.stockin_id DESC LIMIT 5
  `)

  return {
    summary: summaryRows[0],
    recent_transactions: recentTransactions,
    low_stock_alerts: lowStock,
    recent_stock_in: recentStockIn,
    today_quantity_by_unit: todayQuantityByUnit,
  }
}
```
### `getAdminDashboardData` — source lines 93–199

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

#### Consecutive source section 1 of 2

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
async function getAdminDashboardData() {
  const [summaries] = await pool.execute(`
    SELECT
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales) AS total_revenue,
      (SELECT COUNT(*) FROM sales) AS total_transactions,
      (SELECT COALESCE(AVG(total_amount), 0) FROM sales) AS average_sale_value,
      (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS total_products,
      (SELECT COUNT(*) FROM products WHERE is_active = TRUE AND stock_quantity <= reorder_level) AS low_stock_count,
      (SELECT COALESCE(SUM(current_balance), 0) FROM customers WHERE is_active = TRUE) AS customer_credits
  `)
  const [topProducts] = await pool.execute(`
    SELECT product_id, product_name, unit, quantity_sold, sales_amount, unit_rank
    FROM (
      SELECT p.product_id, p.product_name, p.unit,
             SUM(si.quantity) AS quantity_sold, SUM(si.subtotal) AS sales_amount,
             ROW_NUMBER() OVER (
               PARTITION BY p.unit
               ORDER BY SUM(si.quantity) DESC, SUM(si.subtotal) DESC, p.product_name ASC
             ) AS unit_rank
      FROM sales_items si
      JOIN products p ON si.product_id = p.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
    ) AS ranked_products
    WHERE unit_rank <= 5
    ORDER BY unit ASC, unit_rank ASC
  `)
  const [lowProducts] = await pool.execute(`
    SELECT product_id, product_name, unit, stock_quantity, quantity_sold, unit_rank
    FROM (
      SELECT p.product_id, p.product_name, p.unit, p.stock_quantity,
             COALESCE(SUM(si.quantity), 0) AS quantity_sold,
             ROW_NUMBER() OVER (
               PARTITION BY p.unit
               ORDER BY COALESCE(SUM(si.quantity), 0) ASC, p.product_name ASC
             ) AS unit_rank
      FROM products p
      LEFT JOIN sales_items si ON p.product_id = si.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
    ) AS ranked_products
    WHERE unit_rank <= 5
    ORDER BY unit ASC, unit_rank ASC
  `)
  const [lowStock] = await pool.execute(`
    SELECT product_id, product_name, unit, stock_quantity, reorder_level, status
    FROM products
    WHERE is_active = TRUE AND stock_quantity <= reorder_level
    ORDER BY stock_quantity ASC, product_name ASC
  `)
  const [activities] = await pool.execute(`
    SELECT al.activity_id, al.action, al.description,
           CONCAT(DATE_FORMAT(al.created_at, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS created_at,
           COALESCE(u.fullname, 'System') AS operator_name,
           COALESCE(u.username, 'system') AS username,
           COALESCE(u.role, 'System') AS role
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.user_id
    ORDER BY al.created_at DESC, al.activity_id DESC
    LIMIT 5
```
#### Consecutive source section 2 of 2

```js
  `)
  // SQL aggregates in Manila-time buckets; fillSeries adds empty hours and days for chart continuity.
  const [dailyRows] = await pool.execute(`
    SELECT HOUR(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_date >= ${manilaCurrentDate}
      AND sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY
    GROUP BY HOUR(sale_date)
    ORDER BY bucket_index
  `)
  const [weeklyRows] = await pool.execute(`
    SELECT WEEKDAY(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_date >= DATE_SUB(${manilaCurrentDate}, INTERVAL WEEKDAY(${manilaCurrentDate}) DAY)
      AND sale_date < DATE_ADD(DATE_SUB(${manilaCurrentDate}, INTERVAL WEEKDAY(${manilaCurrentDate}) DAY), INTERVAL 7 DAY)
    GROUP BY WEEKDAY(sale_date)
    ORDER BY bucket_index
  `)
  const [monthlyRows] = await pool.execute(`
    SELECT DAY(sale_date) - 1 AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_date >= DATE_FORMAT(${manilaCurrentDate}, '%Y-%m-01')
      AND sale_date < DATE_FORMAT(${manilaCurrentDate}, '%Y-%m-01') + INTERVAL 1 MONTH
    GROUP BY DAY(sale_date) - 1
    ORDER BY bucket_index
  `)

  const { daysInMonth, monthLabel } = manilaCalendar()
  return {
    summary: {
      ...summaries[0],
      best_seller: topProducts
        .filter((product) => Number(product.unit_rank) === 1)
        .map((product) => `${product.product_name} (${product.unit})`)
        .join(' · ') || null,
    },
    trends: {
      daily: fillSeries(24, dailyRows, 'bucket_index', (index) => `${String(index).padStart(2, '0')}:00`),
      weekly: fillSeries(7, weeklyRows, 'bucket_index', (index) => dayLabels[index]),
      monthly: fillSeries(daysInMonth, monthlyRows, 'bucket_index', (index) => `${monthLabel} ${index + 1}`),
    },
    top_products: topProducts,
    low_products: lowProducts,
    low_stock_alerts: lowStock,
    recent_activity: activities,
  }
}
```
### `manilaDateKey` — source lines 201–210

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function manilaDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
```
### `shiftCalendarDate` — source lines 212–216

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function shiftCalendarDate(dateKey, offset) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
```
### `getStaffSalesActivity` — source lines 218–241

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getStaffSalesActivity(request, response) {
  try {
    const today = manilaDateKey(new Date())
    const startDate = shiftCalendarDate(today, -6)
    const endDate = shiftCalendarDate(today, 1)
    const [rows] = await pool.execute(`
      SELECT DATE_FORMAT(sale_date, '%Y-%m-%d') AS sale_day,
             COUNT(DISTINCT sale_id) AS transaction_count
      FROM sales
      WHERE sale_date >= ? AND sale_date < ?
      GROUP BY sale_day
      ORDER BY sale_day ASC
    `, [startDate, endDate])
    const countsByDate = new Map(rows.map((row) => [row.sale_day, Number(row.transaction_count)]))
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = shiftCalendarDate(startDate, index)
      return { date, transactions: countsByDate.get(date) || 0 }
    })
    return response.json({ success: true, data: { days } })
  } catch (error) {
    console.error('Unable to retrieve staff sales activity:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve sales activity' })
  }
}
```
### `getDashboard` — source lines 243–254

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getDashboard(request, response) {
  try {
    // Keep role-specific datasets separate so each response exposes only its established metrics.
    const data = request.user?.role === 'Staff'
      ? await getStaffDashboardData()
      : await getAdminDashboardData()
    return response.json({ success: true, data })
  } catch (error) {
    console.error('Unable to retrieve dashboard analytics:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve dashboard analytics' })
  }
}
```
### `rankBusinessProducts` — source lines 256–297

**Inputs and behavior:** Input: products with sales aggregates. Sort by amount then quantity, add one-based rank and percentage share, and return a new array.

```js
// Documentation comment: Input: products with sales aggregates. Sort by amount then quantity, add one-based rank and percentage share, and return a new array.
export function rankBusinessProducts(products) {
  // Quantity order is meaningful only within a configured unit, so each unit gets its own ranks.
  const groupedByUnit = new Map()
  for (const product of products) {
    const unit = product.unit || 'Unspecified unit'
    if (!groupedByUnit.has(unit)) groupedByUnit.set(unit, [])
    groupedByUnit.get(unit).push(product)
  }
  const unitGroups = [...groupedByUnit.entries()].sort(([left], [right]) => left.localeCompare(right))
  const topPerforming = []
  const slowSelling = []
  const topPerUnit = []
  const slowPerUnit = []

  for (const [, unitProducts] of unitGroups) {
    const byQuantityDescending = [...unitProducts].sort((left, right) => (
      Number(right.quantity_sold) - Number(left.quantity_sold)
      || Number(right.gross_sales) - Number(left.gross_sales)
      || left.product_name.localeCompare(right.product_name)
    ))
    const byQuantityAscending = [...unitProducts].sort((left, right) => (
      Number(left.quantity_sold) - Number(right.quantity_sold)
      || left.product_name.localeCompare(right.product_name)
    ))
    const top = byQuantityDescending.filter((product) => Number(product.quantity_sold) > 0).slice(0, 5)
    const slow = byQuantityAscending.slice(0, 5)
    top.forEach((product, index) => topPerforming.push({ ...product, unit_rank: index + 1 }))
    slow.forEach((product, index) => slowSelling.push({ ...product, unit_rank: index + 1 }))
    if (top[0]) topPerUnit.push({ ...top[0], unit_rank: 1 })
    if (slow[0]) slowPerUnit.push({ ...slow[0], unit_rank: 1 })
  }

  const restockAlerts = products
    .filter((product) => Number(product.current_stock) <= Number(product.reorder_level))
    .sort((left, right) => {
      const leftRatio = Number(left.reorder_level) > 0 ? Number(left.current_stock) / Number(left.reorder_level) : Number(left.current_stock)
      const rightRatio = Number(right.reorder_level) > 0 ? Number(right.current_stock) / Number(right.reorder_level) : Number(right.current_stock)
      return leftRatio - rightRatio || left.product_name.localeCompare(right.product_name)
    })

  return { topPerforming, slowSelling, restockAlerts, topPerUnit, slowPerUnit }
}
```
### `getBusinessAnalytics` — source lines 299–341

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getBusinessAnalytics(request, response) {
  try {
    const [summaryRows] = await pool.execute(`
      SELECT COUNT(sale_id) AS total_transactions,
             COALESCE(SUM(total_amount), 0) AS gross_revenue,
             COALESCE(AVG(total_amount), 0) AS average_ticket_value
      FROM sales
    `)
    const [products] = await pool.execute(`
      SELECT p.product_id, p.product_name, p.unit,
             p.stock_quantity AS current_stock, p.reorder_level,
             COALESCE(SUM(si.quantity), 0) AS quantity_sold,
             COALESCE(SUM(si.subtotal), 0) AS gross_sales
      FROM products p
      LEFT JOIN sales_items si ON si.product_id = p.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY p.unit ASC, quantity_sold DESC, gross_sales DESC, p.product_name ASC
    `)
    const { topPerforming, slowSelling, restockAlerts, topPerUnit, slowPerUnit } = rankBusinessProducts(products)

    return response.json({
      success: true,
      data: {
        summary: { ...summaryRows[0], top_seller: null, top_sellers_by_unit: topPerUnit },
        product_performance: products,
        top_performing: topPerforming,
        slow_selling: slowSelling,
        restock_alerts: restockAlerts,
        insights: {
          sales_driver: null,
          lagging_product: null,
          sales_drivers_by_unit: topPerUnit,
          lagging_products_by_unit: slowPerUnit,
          procurement_priority: restockAlerts[0] || null,
        },
      },
    })
  } catch (error) {
    console.error('Unable to retrieve business analytics:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve business analytics' })
  }
}
```

## A13. Password reset and authentication-version invalidation

Source file: `server/controllers/userController.js`

### `positiveId` — source lines 21–25

**Inputs and behavior:** Input: candidate ID. Require positive integer and throw a user-facing validation error otherwise.

```js
// Documentation comment: Input: candidate ID. Require positive integer and throw a user-facing validation error otherwise.
function positiveId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new UserError(400, 'Invalid user ID')
  return id
}
```
### `userDetails` — source lines 27–40

**Inputs and behavior:** Input: submitted account body. Normalize required name/username/email/contact fields, validate email and constrain role.

```js
// Documentation comment: Input: submitted account body. Normalize required name/username/email/contact fields, validate email and constrain role.
function userDetails(body) {
  const fullname = typeof body?.fullname === 'string' ? body.fullname.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const emailProvided = Object.prototype.hasOwnProperty.call(body || {}, 'email')
  const email = emailProvided ? normalizeRecoveryEmail(body.email) : null
  const contactNumber = typeof body?.contact_number === 'string' ? body.contact_number.trim() : ''
  const role = body?.role
  if (!fullname) throw new UserError(400, 'Full name is required')
  if (!username) throw new UserError(400, 'Username is required')
  if (!email) throw new UserError(400, 'A verified email address is required for sign-in')
  validateRecoveryEmail(email)
  if (!['Admin', 'Staff'].includes(role)) throw new UserError(400, 'Role must be Admin or Staff')
  return { fullname, username, email, emailProvided, contactNumber: contactNumber || null, role }
}
```
### `findUser` — source lines 42–46

**Inputs and behavior:** Inputs: executor, user ID and optional lock flag. Select safe account fields, optionally use FOR UPDATE, and reject missing user.

```js
// Documentation comment: Inputs: executor, user ID and optional lock flag. Select safe account fields, optionally use FOR UPDATE, and reject missing user.
async function findUser(executor, userId, forUpdate = false) {
  const [rows] = await executor.execute(`SELECT ${safeFields} FROM users WHERE user_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [userId])
  if (!rows[0]) throw new UserError(404, 'User not found')
  return rows[0]
}
```
### `uniqueUsername` — source lines 48–51

**Inputs and behavior:** Inputs: executor, username and optional excluded ID. Query for duplicate username and return conflict if found.

```js
// Documentation comment: Inputs: executor, username and optional excluded ID. Query for duplicate username and return conflict if found.
async function uniqueUsername(executor, username, excludedId = 0) {
  const [rows] = await executor.execute('SELECT user_id FROM users WHERE username = ? AND user_id <> ? LIMIT 1', [username, excludedId])
  if (rows.length) throw new UserError(409, 'Username is already in use')
}
```
### `uniqueEmail` — source lines 53–57

**Inputs and behavior:** Inputs: executor, email and optional excluded ID. Query for duplicate email when provided and return conflict if found.

```js
// Documentation comment: Inputs: executor, email and optional excluded ID. Query for duplicate email when provided and return conflict if found.
async function uniqueEmail(executor, email, excludedId = 0) {
  if (!email) return
  const [rows] = await executor.execute('SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1', [email, excludedId])
  if (rows.length) throw new UserError(409, 'Recovery email is already in use')
}
```
### `activity` — source lines 59–65

**Inputs and behavior:** Inputs: executor, Admin ID, action and description. Insert a timestamped account activity row.

```js
// Documentation comment: Inputs: executor, Admin ID, action and description. Insert a timestamped account activity row.
async function activity(executor, adminId, action, description) {
  await executor.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [adminId, action, description],
  )
}
```
### `failure` — source lines 67–77

**Inputs and behavior:** Inputs: error, response and fallback. Map expected validation/duplicate errors and log unexpected failures.

```js
// Documentation comment: Inputs: error, response and fallback. Map expected validation/duplicate errors and log unexpected failures.
function failure(error, response, fallback) {
  if (error instanceof UserError || error instanceof EmailVerificationError) {
    if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
    return response.status(error.status).json({ success: false, message: error.message })
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return response.status(409).json({ success: false, message: 'Username or recovery email is already in use' })
  }
  console.error(`${fallback}:`, error.message)
  return response.status(500).json({ success: false, message: fallback })
}
```
### `deliverVerification` — source lines 79–88

**Inputs and behavior:** Inputs: email and issued token details. Send verification and revoke token on delivery failure when possible.

```js
// Documentation comment: Inputs: email and issued token details. Send verification and revoke token on delivery failure when possible.
async function deliverVerification(email, issued) {
  if (!email || !issued) return true
  try {
    await sendEmailVerification({ email, ...issued })
    return true
  } catch {
    try { await revokeEmailVerificationToken(issued.verificationId) } catch { /* The token still expires and remains single-use. */ }
    return false
  }
}
```
### `resetUserPassword` — source lines 183–201

**Inputs and behavior:** Input: Admin request with target user ID and new password. Hash replacement, increment auth_version, invalidate reset tokens, log action and commit in transaction.

```js
// Documentation comment: Input: Admin request with target user ID and new password. Hash replacement, increment auth_version, invalidate reset tokens, log action and commit in transaction.
export async function resetUserPassword(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    const password = typeof request.body?.new_password === 'string' ? request.body.new_password : ''
    if (!password.trim()) throw new UserError(400, 'New password is required')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const user = await findUser(connection, userId)
    await connection.execute(
      'UPDATE users SET password = ?, auth_version = auth_version + 1 WHERE user_id = ?',
      [await bcrypt.hash(password, 10), userId],
    )
    await invalidatePasswordResetTokens(connection, userId)
    await activity(connection, request.user.user_id, 'USER_PASSWORD_RESET', `Password reset for user ${userId} (${user.username})`)
    await connection.commit()
    return response.json({ success: true, message: 'Password reset successfully' })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to reset password') }
  finally { connection?.release() }
}
```

## A14. Activity log search and pagination

Source file: `server/controllers/activityLogController.js`

### `positiveInteger` — source lines 6–9

**Inputs and behavior:** Inputs: candidate, fallback and maximum. Convert positive integer values and cap them; otherwise return fallback.

```js
// Documentation comment: Inputs: candidate, fallback and maximum. Convert positive integer values and cap them; otherwise return fallback.
function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}
```
### `validDate` — source lines 11–13

**Inputs and behavior:** Input: date string. Check only YYYY-MM-DD syntax; calendar-date validity is not checked here.

```js
// Documentation comment: Input: date string. Check only YYYY-MM-DD syntax; calendar-date validity is not checked here.
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
```
### `getActivityLogs` — source lines 15–72

**Inputs and behavior:** Input: activity query. Validate dates, assemble bound search/date filters, count/page rows and return metadata.

```js
// Documentation comment: Input: activity query. Validate dates, assemble bound search/date filters, count/page rows and return metadata.
export async function getActivityLogs(request, response) {
  try {
    const page = positiveInteger(request.query.page, 1)
    const limit = positiveInteger(request.query.limit, 20, 100)
    const offset = (page - 1) * limit
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
    const clauses = []
    const parameters = []

    if ((request.query.start_date && !validDate(request.query.start_date)) || (request.query.end_date && !validDate(request.query.end_date))) {
      return response.status(400).json({ success: false, message: 'Dates must use YYYY-MM-DD format' })
    }

    if (search) {
      clauses.push('(u.fullname LIKE ? OR u.username LIKE ? OR al.action LIKE ? OR al.description LIKE ?)')
      const term = `%${search}%`
      parameters.push(term, term, term, term)
    }
    if (validDate(request.query.start_date)) {
      clauses.push('al.created_at >= ?')
      parameters.push(request.query.start_date)
    }
    if (validDate(request.query.end_date)) {
      clauses.push('al.created_at < DATE_ADD(?, INTERVAL 1 DAY)')
      parameters.push(request.query.end_date)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const [countRows] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM activity_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
      ${where}
    `, parameters)
    const [logs] = await pool.execute(`
      SELECT al.activity_id, al.user_id, al.action, al.description,
             CONCAT(DATE_FORMAT(al.created_at, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS created_at,
             COALESCE(u.username, 'System') AS username,
             COALESCE(u.fullname, 'System') AS fullname,
             COALESCE(u.role, 'System') AS role
      FROM activity_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
      ${where}
      ORDER BY al.created_at DESC, al.activity_id DESC
      LIMIT ? OFFSET ?
    `, [...parameters, String(limit), String(offset)])
    const total = Number(countRows[0].total)

    return response.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Unable to retrieve activity logs:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve activity logs' })
  }
}
```


# Appendix C - Complete supporting helper modules

Each block below reproduces the complete module file.

## C1. Decimal validation helper module

Source file: `server/utils/decimalValidation.js`, lines 1-63

**Purpose and dependencies:** Contains shared decimal precision/range rules used before money and quantity normalization.

### Consecutive source section 1 of 2

```js
// Documentation comment: Contains shared decimal precision/range rules used before money and quantity normalization.
export const decimalLimits = Object.freeze({
  quantity: 9999999.999,
  unitPrice: 99999999.99,
  money: 9999999999.99,
})

export class DecimalValidationError extends Error {}

function decimalPlaces(text) {
  const match = text.match(/^\d+(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) return null

  const fraction = (match[1] || '').replace(/0+$/, '')
  const exponent = Number(match[2] || 0)
  return Math.max(fraction.length - exponent, 0)
}

export function parseDecimal(value, {
  fieldName,
  maximum,
  decimalPlaces: maximumDecimalPlaces,
  minimum = 0,
  inclusiveMinimum = true,
}) {
  const supportedType = typeof value === 'number' || typeof value === 'string'
  const raw = supportedType ? String(value).trim() : ''

  if (!supportedType || !raw) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const negativeSyntax = raw.startsWith('-')
  const validMinimum = inclusiveMinimum ? parsed >= minimum : parsed > minimum
  if (negativeSyntax || !validMinimum) {
    throw new DecimalValidationError(
      inclusiveMinimum
        ? `${fieldName} must be at least ${minimum}`
        : `${fieldName} must be greater than ${minimum}`,
    )
  }

  if (parsed > maximum) {
    throw new DecimalValidationError(`${fieldName} must not exceed ${maximum}`)
  }

  const precision = decimalPlaces(raw)
  if (precision === null || precision > maximumDecimalPlaces) {
    throw new DecimalValidationError(
      `${fieldName} supports up to ${maximumDecimalPlaces} decimal places`,
    )
  }
```
### Consecutive source section 2 of 2

```js

  return parsed
}
```

## C2. Transaction failure and uncertain-commit safeguards

Source file: `server/utils/transactionFailure.js`, lines 1-71

**Purpose and dependencies:** Contains rollback, commit-outcome, and connection-reuse handling used by financial transactions.

### Consecutive source section 1 of 2

```js
// Documentation comment: Contains rollback, commit-outcome, and connection-reuse handling used by financial transactions.
function discardConnection(connection, operation, error, rollbackError = null) {
  try {
    connection?.destroy()
  } catch (disposeError) {
    console.error(`Unable to discard ${operation} database connection`, {
      errorCode: error?.code || 'UNKNOWN',
      rollbackErrorCode: rollbackError?.code || null,
      disposeErrorCode: disposeError?.code || 'UNKNOWN',
    })
  }
}

export async function resolveTransactionFailure({
  connection,
  transactionBeginAttempted = false,
  transactionStarted,
  commitAttempted,
  commitCompleted = false,
  error,
  operation,
  rejectionConfirmed,
}) {
  // A failed BEGIN or unconfirmed COMMIT leaves database state uncertain; do not
  // release that connection back into the pool for unrelated requests.
  if (transactionBeginAttempted && !transactionStarted) {
    console.error(`Unable to start ${operation} transaction`, {
      errorCode: error?.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error)
    return { outcome: 'unknown', reusable: false }
  }

  if (commitAttempted && !commitCompleted) {
    console.error(`Unable to confirm ${operation} transaction commit`, {
      errorCode: error?.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error)
    return { outcome: 'unknown', reusable: false }
  }

  if (commitCompleted) {
    return { outcome: 'unknown', reusable: true }
  }

  let rollbackCompleted = !transactionStarted
  let rollbackError = null
  if (connection && transactionStarted) {
    try {
      await connection.rollback()
      rollbackCompleted = true
    } catch (failure) {
      rollbackError = failure
    }
  }

  if (rollbackError) {
    console.error(`Unable to roll back ${operation} transaction`, {
      errorCode: error?.code || 'UNKNOWN',
      rollbackErrorCode: rollbackError.code || 'UNKNOWN',
    })
```
### Consecutive source section 2 of 2

```js
    discardConnection(connection, operation, error, rollbackError)
    return { outcome: 'unknown', reusable: false }
  }

  return {
    // Only a confirmed rollback plus a known client/business rejection proves that
    // none of this operation's writes committed.
    outcome: rejectionConfirmed && rollbackCompleted ? 'not_committed' : 'unknown',
    reusable: true,
  }
}
```

## C3. MFA challenge lifecycle service

Source file: `server/services/loginMfaService.js`, lines 1-281

**Purpose and dependencies:** Contains rate-limit counters, challenge persistence, OTP consumption, resend, and invalidation behavior.

### Consecutive source section 1 of 5

```js
// Documentation comment: Contains rate-limit counters, challenge persistence, OTP consumption, resend, and invalidation behavior.
import pool from '../config/database.js'
import { environment } from '../config/environment.js'
import {
  createMfaChallengeId,
  createMfaOtp,
  hashMfaChallengeId,
  hashMfaEmail,
  hashMfaOtp,
  hashMfaRateIdentifier,
  verifyMfaOtp,
} from './loginMfaSecurity.js'

const maximumAttempts = 5
const resendCooldownSeconds = 60
const secret = () => process.env.JWT_SECRET || ''

export class LoginMfaError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function newCode() {
  return createMfaOtp(environment.mfa.otpLength)
}

function dateBucket(windowSeconds) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  return new Date(bucket)
}

async function consumeLimit(connection, action, kind, value, maximum, windowSeconds) {
  if (kind === 'ip') {
    await connection.execute(
      `DELETE FROM login_mfa_rate_limits
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
       LIMIT 500`,
    )
  }
  // Store keyed hashes of account/IP identifiers rather than their raw values; the
  // unique scope and time bucket let concurrent requests increment one counter row.
  const hash = hashMfaRateIdentifier(kind, value || '<unknown>', secret())
  const bucketStart = dateBucket(windowSeconds)
  await connection.execute(
    `INSERT INTO login_mfa_rate_limits (action, identifier_kind, identifier_hash, window_started_at, request_count, created_at)
     VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
    [action, kind, hash, bucketStart],
  )
  const [rows] = await connection.execute(
    `SELECT request_count FROM login_mfa_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ? AND window_started_at = ?
     LIMIT 1`,
    [action, kind, hash, bucketStart],
  )
  if (Number(rows[0]?.request_count || 0) > maximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucketStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000))
    throw new LoginMfaError(429, 'Too many sign-in attempts. Please try again later.', retryAfterSeconds)
```
### Consecutive source section 2 of 5

```js
  }
}

async function withTransaction(work) {
  const connection = await pool.getConnection()
  let active = false
  try {
    await connection.beginTransaction()
    active = true
    const result = await work(connection)
    await connection.commit()
    active = false
    return result
  } catch (error) {
    if (active) await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function enforceLoginRateLimits({ username, ipAddress }) {
  return withTransaction(async (connection) => {
    await consumeLimit(connection, 'login', 'ip', ipAddress, 30, 15 * 60)
    await consumeLimit(connection, 'login', 'account', String(username || '').trim().toLowerCase(), 10, 15 * 60)
  })
}

export async function createLoginChallenge(user, ipAddress) {
  const id = createMfaChallengeId()
  const idHash = hashMfaChallengeId(id)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  await withTransaction(async (connection) => {
    // Consume request limits and replace any outstanding challenge atomically, while
    // persisting only hashes of the bearer ID, OTP, and email.
    await consumeLimit(connection, 'challenge', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'challenge', 'account', String(user.user_id), 5, 60 * 60)
    await connection.execute(
      `DELETE FROM login_mfa_challenges
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       LIMIT 500`,
    )
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
       WHERE user_id = ? AND consumed_at IS NULL`,
      [user.user_id],
    )
    await connection.execute(
      `INSERT INTO login_mfa_challenges
         (challenge_hash, user_id, auth_version, email_hash, otp_hash, expires_at, resend_available_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
      [idHash, user.user_id, Number(user.auth_version || 0), hashMfaEmail(user.email, secret()), otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds],
    )
  })
  return {
    challengeId: id,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
```
### Consecutive source section 3 of 5

```js
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}

export async function consumeLoginChallenge({ challengeId, code, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const submittedCode = typeof code === 'string' ? code : ''

  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'verify', 'ip', ipAddress, 60, 15 * 60)
    await consumeLimit(connection, 'verify', 'challenge', idHash.toString('hex'), 15, 15 * 60)
    // Lock this challenge while checking attempts and consuming it so concurrent
    // verifications cannot both turn one OTP into separate authenticated sessions.
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, auth_version, email_hash, otp_hash, expires_at, attempts, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This verification code is invalid or has expired.') }
    }

    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }

    const matches = verifyMfaOtp(challenge.otp_hash, idHash, submittedCode, secret())
    if (!matches) {
      const attempts = Number(challenge.attempts) + 1
      await connection.execute(
        `UPDATE login_mfa_challenges
         SET attempts = ?, consumed_at = IF(? >= ?, UTC_TIMESTAMP(3), consumed_at)
         WHERE challenge_id = ?`,
        [attempts, attempts, maximumAttempts, challenge.challenge_id],
      )
      if (attempts >= maximumAttempts) {
        return { failure: new LoginMfaError(429, 'Maximum verification attempts reached. Return to login to request a new code.') }
      }
      return { failure: new LoginMfaError(400, 'The verification code is incorrect.') }
    }

    // Re-read account state at verification time so deactivation, role/email changes,
    // or a credential-version increment invalidate an already-issued code.
    const [users] = await connection.execute(
      `SELECT user_id, fullname, username, role, is_active, email, email_verified_at, auth_version
       FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user || !user.is_active || !user.email || !user.email_verified_at || !['Admin', 'Staff'].includes(user.role)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
```
### Consecutive source section 4 of 5

```js
      )
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (Number(user.auth_version || 0) !== Number(challenge.auth_version || 0)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account credentials changed. Return to login and try again.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    await connection.execute(
      'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ? AND consumed_at IS NULL',
      [challenge.challenge_id],
    )
    return user
  })
  if (result?.failure) throw result.failure
  return result
}

export async function resendLoginChallenge({ challengeId, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'resend', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'resend', 'challenge', idHash.toString('hex'), 10, 60 * 60)
    // Serialize resend requests on the challenge row and enforce the stored cooldown
    // before rotating the OTP hash and expiry.
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, email_hash, expires_at, resend_available_at, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired,
              resend_available_at <= UTC_TIMESTAMP(3) AS resend_ready,
              GREATEST(1, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), resend_available_at) / 1000000)) AS retry_after
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This login verification request is invalid or has expired.') }
    }
    const [users] = await connection.execute(
      `SELECT email, is_active, email_verified_at FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user?.is_active || !user.email || !user.email_verified_at) {
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
```
### Consecutive source section 5 of 5

```js
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }
    if (!challenge.resend_ready) {
      return { failure: new LoginMfaError(429, 'Please wait before requesting another code.', Number(challenge.retry_after)) }
    }
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET otp_hash = ?, attempts = 0,
           expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
           resend_available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
       WHERE challenge_id = ?`,
      [otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds, challenge.challenge_id],
    )
    return { email: user.email }
  })
  if (result?.failure) throw result.failure
  return {
    ...result,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}

export async function invalidateLoginChallenge(challengeId) {
  await pool.execute(
    `UPDATE login_mfa_challenges
     SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
     WHERE challenge_hash = ?`,
    [hashMfaChallengeId(typeof challengeId === 'string' ? challengeId : '')],
  )
}
```

## C4. MFA challenge and OTP security helpers

Source file: `server/services/loginMfaSecurity.js`, lines 1-32

**Purpose and dependencies:** Contains challenge identifiers, OTP generation and hashes, rate-identifier hashes, and OTP verification.

```js
// Documentation comment: Contains challenge identifiers, OTP generation and hashes, rate-identifier hashes, and OTP verification.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export function createMfaChallengeId() {
  return randomBytes(32).toString('base64url')
}

export function hashMfaChallengeId(challengeId) {
  return createHash('sha256').update(challengeId).digest()
}

export function createMfaOtp(length = 6) {
  return String(randomInt(0, 10 ** length)).padStart(length, '0')
}

export function hashMfaOtp(challengeHash, code, secret) {
  return createHmac('sha256', secret).update(challengeHash).update(':').update(code).digest()
}

export function hashMfaRateIdentifier(kind, value, secret) {
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest()
}

export function hashMfaEmail(email, secret) {
  return hashMfaRateIdentifier('email', String(email || '').trim().toLowerCase(), secret)
}

export function verifyMfaOtp(expectedHash, challengeHash, submittedCode, secret) {
  if (typeof submittedCode !== 'string' || !/^[0-9]{6}$/.test(submittedCode)) return false
  const expected = Buffer.from(expectedHash)
  const actual = hashMfaOtp(challengeHash, submittedCode, secret)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
```

## C5. Session claim matching helpers

Source file: `server/services/authSessionService.js`, lines 1-8

**Purpose and dependencies:** Contains current account-role/version and MFA-claim validation used by authentication middleware.

```js
// Documentation comment: Contains current account-role/version and MFA-claim validation used by authentication middleware.
export function sessionMatchesUser(payload, user) {
  if (!payload || !user || !user.is_active || user.role !== payload.role) return false
  return Number(user.auth_version || 0) === Number(payload.auth_version ?? 0)
}

export function sessionMatchesMfa(payload) {
  return payload?.mfa_verified === true
}
```

## C6. Shared role capability policy

Source file: `shared/permissions.js`, lines 1-27

**Purpose and dependencies:** Contains the Staff capability allow-list and Admin/Staff capability mapping.

```js
// Documentation comment: Contains the Staff capability allow-list and Admin/Staff capability mapping.
export const staffCapabilities = Object.freeze([
  'dashboard.read.operational',
  'pos.sale.create',
  'inventory.read',
  'stockin.read',
  'stockin.create',
  'supplier.read',
  'customer.read',
  'customer.create.pos',
  'customer.balance.read',
  'customer.payment.create',
  'customer.payment.read',
  'report.operational.read',
  'report.operational.export',
])

export function normalizeRole(role) {
  if (role === 'Admin' || role === 'admin') return 'admin'
  if (role === 'Staff' || role === 'employee' || role === 'staff') return 'employee'
  return null
}

export function hasCapability(role, capability) {
  const normalized = normalizeRole(role)
  if (normalized === 'admin') return true
  return normalized === 'employee' && staffCapabilities.includes(capability)
}
```

## C7. Complete idempotency utility module

Source file: `server/utils/idempotency.js`, lines 1-113

**Purpose and dependencies:** Includes idempotency error types, key validation, normalized payload hashing, reservation, persistence, and replay classification.

### Consecutive source section 1 of 2

```js
// Documentation comment: Includes idempotency error types, key validation, normalized payload hashing, reservation, persistence, and replay classification.
import { createHash } from 'node:crypto'

export class IdempotencyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export class IdempotencyKeyConflictError extends IdempotencyError {
  constructor(cause) {
    super(409, 'Idempotency key already exists')
    this.name = 'IdempotencyKeyConflictError'
    this.code = 'IDEMPOTENCY_KEY_CONFLICT'
    this.cause = cause
  }
}

export function getIdempotencyKey(request) {
  const key = request.get('Idempotency-Key')?.trim()
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new IdempotencyError(400, 'A valid Idempotency-Key header is required')
  }
  return key
}

export function hashRequestPayload(payload) {
  // Callers normalize quantities and cents first so equivalent requests hash identically.
  return createHash('sha256').update(JSON.stringify(payload)).digest()
}

function isIdempotencyReservationConflict(error) {
  const databaseMessage = `${error.sqlMessage || ''} ${error.message || ''}`
  return error.code === 'ER_DUP_ENTRY'
    && /\buq_idempotency_user_operation_key\b/i.test(databaseMessage)
}

export async function reserveIdempotencyKey(connection, { userId, operation, key, payloadHash }) {
  try {
    await connection.execute(
      `INSERT INTO idempotency_records
         (user_id, operation_type, idempotency_key, request_hash)
       VALUES (?, ?, ?, ?)`,
      [userId, operation, key, payloadHash],
    )
  } catch (error) {
    // Only the named request-scope index proves this is a retry collision; another
    // unique-key error may belong to business data and must not be replayed.
    if (isIdempotencyReservationConflict(error)) {
      throw new IdempotencyKeyConflictError(error)
    }
    throw error
  }
}

export async function saveIdempotentResponse(connection, {
  userId,
  operation,
  key,
  status,
```
### Consecutive source section 2 of 2

```js
  body,
}) {
  const [result] = await connection.execute(
    `UPDATE idempotency_records
     SET response_status = ?, response_body = ?
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?`,
    [status, JSON.stringify(body), userId, operation, key],
  )

  if (result.affectedRows !== 1) {
    throw new Error('Unable to persist the idempotent transaction result')
  }
}

export async function findIdempotentResponse(executor, { userId, operation, key }) {
  const [records] = await executor.execute(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_records
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?
     LIMIT 1`,
    [userId, operation, key],
  )
  return records[0] || null
}

export async function resolveIdempotencyReplay(executor, idempotency) {
  const record = await findIdempotentResponse(executor, idempotency)
  if (!record) return { kind: 'unverified' }

  try {
    return readIdempotentResponse(record, idempotency.payloadHash)
  } catch {
    return { kind: 'unverified' }
  }
}

export function readIdempotentResponse(record, payloadHash) {
  if (!record) return { kind: 'missing' }
  // A reservation without a response may be in flight or uncertain, not completed.
  if (!record.response_status || !record.response_body) {
    throw new Error('The idempotent transaction result is incomplete')
  }
  // Reusing a key with different normalized input must never return another request's result.
  if (!Buffer.from(record.request_hash).equals(payloadHash)) return { kind: 'payload-mismatch' }

  return {
    kind: 'replay',
    status: Number(record.response_status),
    body: typeof record.response_body === 'string'
      ? JSON.parse(record.response_body)
      : record.response_body,
  }
}
```

## C8. Stock-in business date rules

Source file: `shared/stockInDate.js`, lines 1-89

**Purpose and dependencies:** Contains delivery-date parsing and Manila business-date checks used by stock-in validation.

### Consecutive source section 1 of 2

```js
// Documentation comment: Contains delivery-date parsing and Manila business-date checks used by stock-in validation.
export const STOCK_IN_INVALID_DATE_MESSAGE = 'Delivery date is invalid.'
export const STOCK_IN_FUTURE_DATE_MESSAGE = 'Future stock-in dates are not allowed. Please select today or a previous date.'

const businessTimeZone = 'Asia/Manila'
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/
const zonedDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(?:\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/i

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function calendarDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function datePartsInBusinessTimeZone(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return { year: values.year, month: values.month, day: values.day }
}

export function getBusinessCalendarDate(now = new Date()) {
  const { year, month, day } = datePartsInBusinessTimeZone(now)
  return calendarDate(year, month, day)
}

export function getBusinessDateTimeLocal(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function getStockInCalendarDate(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const localMatch = text.match(localDateTimePattern)
  if (localMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = localMatch
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const hour = Number(hourText || 0)
    const minute = Number(minuteText || 0)
    const second = Number(secondText || 0)
    if (!validDateParts(year, month, day, hour, minute, second)) return null
```
### Consecutive source section 2 of 2

```js
    return calendarDate(year, month, day)
  }

  const zonedMatch = text.match(zonedDateTimePattern)
  if (!zonedMatch) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = zonedMatch
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText || 0)
  if (!validDateParts(year, month, day, hour, minute, second)) return null

  if (zone.toUpperCase() !== 'Z') {
    const [offsetHours, offsetMinutes] = zone.slice(1).split(':').map(Number)
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null
  }

  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) return null
  const businessDate = datePartsInBusinessTimeZone(instant)
  return calendarDate(businessDate.year, businessDate.month, businessDate.day)
}

export function isStockInDateAllowed(value, now = new Date()) {
  const submittedDate = getStockInCalendarDate(value)
  return submittedDate !== null && submittedDate <= getBusinessCalendarDate(now)
}
```

## C9. Request IP extraction

Source file: `server/utils/requestIp.js`, lines 1-3

**Purpose and dependencies:** Contains the client-address normalization helper used by authentication rate limits.

```js
// Documentation comment: Contains the client-address normalization helper used by authentication rate limits.
export function getRequestIp(request) {
  return request.ip || request.socket?.remoteAddress || '<unknown>'
}
```

## C10. Manila date-time conversion

Source file: `server/utils/manilaDateTime.js`, lines 1-23

**Purpose and dependencies:** Contains the timestamp conversion helper used when persisting payment dates.

```js
// Documentation comment: Contains the timestamp conversion helper used when persisting payment dates.
const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

// Business DATETIME columns are Manila wall time, with no timezone attached.
// Convert instants before binding so storage does not depend on server timezone.
export function toManilaDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date value')
  const parts = Object.fromEntries(
    manilaFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}
```

## C11. Password reset lifecycle service

Source file: `server/services/passwordResetService.js`, lines 1-231

**Purpose and dependencies:** Contains reset-token issue, rate-limit, invalidation, and completion helpers used by password changes.

### Consecutive source section 1 of 4

```js
// Documentation comment: Contains reset-token issue, rate-limit, invalidation, and completion helpers used by password changes.
import bcrypt from 'bcrypt'
import { timingSafeEqual } from 'node:crypto'
import pool from '../config/database.js'
import {
  createResetToken,
  hashRateLimitIdentifier,
  hashResetToken,
  normalizeResetEmail,
  validateNewPassword,
} from './passwordResetSecurity.js'

const resetLifetimeMilliseconds = 15 * 60 * 1000
const requestCooldownMilliseconds = 60 * 1000
const maximumRequestsPerEmailPerHour = 5
const maximumRequestsPerIpPerHour = 20
const maximumAttemptsPerTokenPerHour = 5
const maximumAttemptsPerIpPerHour = 30
const supportedRoles = ['Admin', 'Staff']

export const passwordResetConfirmation = "If this email is registered, we'll send a password reset link."

export class PasswordResetError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function rateHash(kind, value) {
  return hashRateLimitIdentifier(kind, value, process.env.JWT_SECRET)
}

async function recordRateEvent(executor, action, kind, identifierHash) {
  await executor.execute(
    `INSERT INTO password_reset_rate_limits (action, identifier_kind, identifier_hash)
     VALUES (?, ?, ?)`,
    [action, kind, identifierHash],
  )
}

async function countRecentEvents(executor, action, kind, identifierHash) {
  const [rows] = await executor.execute(
    `SELECT COUNT(*) AS total, MAX(created_at) AS latest
     FROM password_reset_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ?
       AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)`,
    [action, kind, identifierHash],
  )
  return { total: Number(rows[0]?.total || 0), latest: rows[0]?.latest || null }
}

async function pruneOldRateEvents(executor) {
  await executor.execute(
    `DELETE FROM password_reset_rate_limits
     WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
     LIMIT 500`,
  )
}

```
### Consecutive source section 2 of 4

```js
export async function invalidatePasswordResetTokens(executor, userId) {
  await executor.execute(
    `UPDATE password_reset_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  )
}

export async function preparePasswordReset(emailValue, ipAddress) {
  const email = normalizeResetEmail(emailValue)
  const emailHash = rateHash('email', email || '<invalid>')
  const ipHash = rateHash('ip', ipAddress || '<unknown>')
  let connection

  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await pruneOldRateEvents(connection)

    const emailRate = await countRecentEvents(connection, 'request', 'email', emailHash)
    const ipRate = await countRecentEvents(connection, 'request', 'ip', ipHash)

    await recordRateEvent(connection, 'request', 'email', emailHash)
    await recordRateEvent(connection, 'request', 'ip', ipHash)

    const latestRequestTime = emailRate.latest ? new Date(emailRate.latest).getTime() : 0
    const coolingDown = latestRequestTime && Date.now() - latestRequestTime < requestCooldownMilliseconds
    const limited = coolingDown
      || emailRate.total >= maximumRequestsPerEmailPerHour
      || ipRate.total >= maximumRequestsPerIpPerHour

    if (limited || !email || email.length > 254) {
      await connection.commit()
      return null
    }

    const [users] = await connection.execute(
      `SELECT user_id, email, role
       FROM users
       WHERE email = ? AND email_verified_at IS NOT NULL AND is_active = TRUE
         AND role IN ('Admin', 'Staff')
       LIMIT 1
       FOR UPDATE`,
      [email],
    )
    const user = users[0]

    if (!user || !supportedRoles.includes(user.role)) {
      await connection.commit()
      return null
    }

    await invalidatePasswordResetTokens(connection, user.user_id)
    const token = createResetToken()
    const expiresAt = new Date(Date.now() + resetLifetimeMilliseconds)
    const [result] = await connection.execute(
      `INSERT INTO password_reset_tokens (user_id, token_hash, email_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [user.user_id, hashResetToken(token), hashResetToken(user.email), expiresAt],
```
### Consecutive source section 3 of 4

```js
    )

    await connection.commit()
    return { email: user.email, token, resetId: result.insertId }
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}

export async function revokePasswordResetToken(resetId) {
  await pool.execute(
    `UPDATE password_reset_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE reset_id = ?`,
    [resetId],
  )
}

export async function completePasswordReset(token, passwordValue, ipAddress) {
  const rawToken = typeof token === 'string' ? token : ''
  const tokenHash = hashResetToken(rawToken)
  const ipHash = rateHash('ip', ipAddress || '<unknown>')
  let connection

  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await pruneOldRateEvents(connection)

    const tokenRate = await countRecentEvents(connection, 'attempt', 'token', tokenHash)
    const ipRate = await countRecentEvents(connection, 'attempt', 'ip', ipHash)
    await recordRateEvent(connection, 'attempt', 'token', tokenHash)
    await recordRateEvent(connection, 'attempt', 'ip', ipHash)

    if (tokenRate.total >= maximumAttemptsPerTokenPerHour || ipRate.total >= maximumAttemptsPerIpPerHour) {
      await connection.commit()
      throw new PasswordResetError(429, 'Too many password reset attempts. Try again later.', 3600)
    }

    await connection.commit()

    if (rawToken.length < 40 || rawToken.length > 128) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    let password
    try {
      password = validateNewPassword(passwordValue)
    } catch (error) {
      throw new PasswordResetError(400, error.message)
    }

    await connection.beginTransaction()

    const [tokens] = await connection.execute(
      `SELECT reset_id, user_id, email_hash, expires_at, used_at
       FROM password_reset_tokens
```
### Consecutive source section 4 of 4

```js
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    )
    const reset = tokens[0]

    if (!reset || reset.used_at || new Date(reset.expires_at).getTime() <= Date.now()) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    const [users] = await connection.execute(
      `SELECT user_id, role, is_active, email, email_verified_at
       FROM users
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [reset.user_id],
    )
    const user = users[0]

    const currentEmailHash = user?.email ? hashResetToken(user.email) : null
    const emailMatches = currentEmailHash
      && currentEmailHash.length === reset.email_hash.length
      && timingSafeEqual(currentEmailHash, reset.email_hash)

    if (!user || !user.is_active || !user.email_verified_at || !supportedRoles.includes(user.role) || !emailMatches) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await connection.execute(
      `UPDATE users
       SET password = ?, auth_version = auth_version + 1
       WHERE user_id = ?`,
      [passwordHash, user.user_id],
    )
    await invalidatePasswordResetTokens(connection, user.user_id)
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'USER_PASSWORD_RESET', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `Password reset completed for user ${user.user_id}`],
    )
    await connection.commit()
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}
```

## C12. Email verification token lifecycle service

Source file: `server/services/emailVerificationService.js`, lines 1-144

**Purpose and dependencies:** Contains account email verification token issuance, invalidation, and completion used by account administration.

### Consecutive source section 1 of 3

```js
// Documentation comment: Contains account email verification token issuance, invalidation, and completion used by account administration.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import pool from '../config/database.js'

const tokenLifetimeMilliseconds = 24 * 60 * 60 * 1000
const resendCooldownMilliseconds = 60 * 1000
const maximumEmailsPerHour = 5
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class EmailVerificationError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function normalizeRecoveryEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email || null
}

export function validateRecoveryEmail(email) {
  if (!email) return
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new EmailVerificationError(400, 'Enter a valid recovery email address')
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest()
}

export async function invalidateEmailVerificationTokens(executor, userId) {
  await executor.execute(
    `UPDATE email_verification_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  )
}

export async function issueEmailVerificationToken(executor, userId, email) {
  const [recentTokens] = await executor.execute(
    `SELECT created_at
     FROM email_verification_tokens
     WHERE user_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
     ORDER BY created_at DESC`,
    [userId],
  )

  if (recentTokens.length >= maximumEmailsPerHour) {
    throw new EmailVerificationError(429, 'Too many verification emails were requested. Try again later.')
  }

  if (recentTokens[0]) {
    const elapsed = Date.now() - new Date(recentTokens[0].created_at).getTime()
    if (elapsed < resendCooldownMilliseconds) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resendCooldownMilliseconds - elapsed) / 1000))
      throw new EmailVerificationError(429, 'Please wait before sending another verification email.', retryAfterSeconds)
```
### Consecutive source section 2 of 3

```js
    }
  }

  await invalidateEmailVerificationTokens(executor, userId)

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + tokenLifetimeMilliseconds)
  const [result] = await executor.execute(
    `INSERT INTO email_verification_tokens (user_id, token_hash, email_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, hash(token), hash(email), expiresAt],
  )

  return { token, verificationId: result.insertId }
}

export async function completeEmailVerification(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 128) {
    throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
  }

  let connection
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [tokens] = await connection.execute(
      `SELECT verification_id, user_id, email_hash, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [hash(token)],
    )
    const verification = tokens[0]

    if (!verification || verification.used_at || new Date(verification.expires_at).getTime() <= Date.now()) {
      throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
    }

    const [users] = await connection.execute(
      'SELECT user_id, email FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [verification.user_id],
    )
    const user = users[0]
    const currentEmailHash = user?.email ? hash(user.email) : null

    if (!currentEmailHash || !timingSafeEqual(currentEmailHash, verification.email_hash)) {
      throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
    }

    await connection.execute(
      'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP(3) WHERE user_id = ?',
      [user.user_id],
    )
    await connection.execute(
      `UPDATE email_verification_tokens
       SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
       WHERE user_id = ? AND used_at IS NULL`,
      [user.user_id],
```
### Consecutive source section 3 of 3

```js
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'USER_EMAIL_VERIFIED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `Recovery email verified for user ${user.user_id}`],
    )
    await connection.commit()
    return { userId: user.user_id }
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}

export async function revokeEmailVerificationToken(verificationId) {
  await pool.execute(
    `UPDATE email_verification_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE verification_id = ?`,
    [verificationId],
  )
}
```

## C13. Email delivery service

Source file: `server/services/emailDeliveryService.js`, lines 1-188

**Purpose and dependencies:** Contains delivery configuration and MFA, reset, and verification message dispatch functions.

### Consecutive source section 1 of 4

```js
// Documentation comment: Contains delivery configuration and MFA, reset, and verification message dispatch functions.
import nodemailer from 'nodemailer'
import { environment } from '../config/environment.js'

const senderName = 'LCP Dressed Chicken Trading'
const safeSmtpCommands = new Set(['CONN', 'CONNECT', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'])

function getEmailErrorDiagnostic(error, operation) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : undefined
  const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : undefined
  const command = typeof error?.command === 'string' && safeSmtpCommands.has(error.command.toUpperCase())
    ? error.command.toUpperCase()
    : undefined
  let category = 'delivery'

  if (error?.message === 'Email delivery is not configured' || error?.message === 'Gmail MFA delivery is not configured') category = 'configuration'
  else if (code === 'EAUTH') category = 'authentication'
  else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') category = 'timeout'
  else if (code && ['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EDNS'].includes(code)) category = 'connection'
  else if (responseCode >= 500) category = 'smtp_rejected'
  else if (responseCode >= 400) category = 'smtp_temporary'

  return { operation, category, ...(code ? { code } : {}), ...(responseCode ? { responseCode } : {}), ...(command ? { command } : {}) }
}

function logEmailDeliveryFailure(logger, error, operation) {
  try {
    logger.error('Email delivery failed', getEmailErrorDiagnostic(error, operation))
  } catch {
    // Diagnostics must never replace the generic delivery error.
  }
}

function requireEmailConfiguration(smtp, frontendUrl) {
  if (!smtp.host || !smtp.user || !smtp.appPassword || !smtp.fromEmail || !frontendUrl) {
    throw new Error('Email delivery is not configured')
  }
}

export function createSmtpTransportOptions(smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: {
      user: smtp.user,
      pass: smtp.appPassword,
    },
    tls: {
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  }
}

export function resolveMfaSmtpConfig(smtp) {
```
### Consecutive source section 2 of 4

```js
  if (
    smtp.host?.trim().toLowerCase() === 'smtp.gmail.com' &&
    smtp.user &&
    smtp.appPassword &&
    smtp.fromEmail
  ) {
    return {
      host: 'smtp.gmail.com',
      port: smtp.port,
      user: smtp.user,
      appPassword: smtp.appPassword.replace(/\s/g, ''),
      fromEmail: smtp.fromEmail,
    }
  }

  throw new Error('Gmail MFA delivery is not configured')
}

export function createEmailDelivery({ transporter, frontendUrl, fromEmail, logger = console }) {
  const from = { name: senderName, address: fromEmail }

  async function deliver(message, failureMessage, operation) {
    try {
      await transporter.sendMail({
        ...message,
        from,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    } catch (error) {
      logEmailDeliveryFailure(logger, error, operation)
      // Do not attach the provider error: it can contain SMTP details or secrets.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(failureMessage)
    }
  }

  return {
    async sendEmailVerification({ email, token }) {
      const verificationUrl = new URL('/verify-email', frontendUrl)
      verificationUrl.hash = new URLSearchParams({ token }).toString()
      const link = verificationUrl.toString()

      await deliver({
        to: email,
        subject: 'Verify your LCP recovery email',
        text: `Verify this email for your LCP account:\n\n${link}\n\nThis link expires in 24 hours. If you did not expect this email, you can ignore it.`,
        html: `<p>Verify this email for your LCP account.</p><p><a href="${link}">Verify recovery email</a></p><p>This link expires in 24 hours. If you did not expect this email, you can ignore it.</p>`,
      }, 'Verification email could not be sent', 'recovery_email_verification')
    },

    async sendPasswordReset({ email, token }) {
      const resetUrl = new URL('/reset-password', frontendUrl)
      resetUrl.hash = new URLSearchParams({ token }).toString()
      const link = resetUrl.toString()

      await deliver({
        to: email,
        subject: 'Reset your LCP account password',
        text: `Use this link to reset your LCP account password:\n\n${link}\n\nThis link expires in 15 minutes. If you did not request this change, you can ignore this email.`,
```
### Consecutive source section 3 of 4

```js
        html: `<p>Use this link to reset your LCP account password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 15 minutes. If you did not request this change, you can ignore this email.</p>`,
      }, 'Password reset email could not be sent', 'password_reset')
    },

    async sendLoginMfaCode({ email, code, expiryMinutes = 5 }) {
      await deliver({
        to: email,
        subject: 'LCP Dressed Chicken Trading — Login Verification Code',
        text: `Your LCP login verification code is ${code}.\n\nIt expires in ${expiryMinutes} minutes. Do not share this code with anyone. If you did not initiate this login, you can ignore this email and consider changing your password.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937"><h2 style="color:#163832">LCP Dressed Chicken Trading</h2><p>Use this code to finish signing in:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#163832">${code}</p><p>This code expires in ${expiryMinutes} minutes. Do not share it with anyone.</p><p>If you did not initiate this login, you can ignore this email and consider changing your password.</p></div>`,
      }, 'Login verification email could not be sent', 'login_mfa')
    },
  }
}

let emailDelivery

function getEmailDelivery() {
  if (!emailDelivery) {
    try {
      requireEmailConfiguration(environment.smtp, environment.frontendUrl)
      emailDelivery = createEmailDelivery({
        transporter: nodemailer.createTransport(createSmtpTransportOptions(environment.smtp)),
        frontendUrl: environment.frontendUrl,
        fromEmail: environment.smtp.fromEmail,
      })
    } catch (error) {
      logEmailDeliveryFailure(console, error, 'email_delivery_setup')
      // Do not attach initialization errors because they may contain credential details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Email delivery is not configured')
    }
  }
  return emailDelivery
}

export async function sendEmailVerification(details) {
  return getEmailDelivery().sendEmailVerification(details)
}

export async function sendPasswordReset(details) {
  return getEmailDelivery().sendPasswordReset(details)
}

let mfaEmailDelivery

function getMfaEmailDelivery() {
  if (!mfaEmailDelivery) {
    try {
      const gmailSmtp = resolveMfaSmtpConfig(environment.smtp)
      mfaEmailDelivery = createEmailDelivery({
        transporter: nodemailer.createTransport(createSmtpTransportOptions(gmailSmtp)),
        frontendUrl: environment.frontendUrl,
        fromEmail: gmailSmtp.fromEmail,
      })
    } catch (error) {
      logEmailDeliveryFailure(console, error, 'login_mfa_setup')
      // Do not attach initialization errors because they may contain credential details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Login verification email could not be sent')
```
### Consecutive source section 4 of 4

```js
    }
  }
  return mfaEmailDelivery
}

export async function sendLoginMfaCode(details) {
  return getMfaEmailDelivery().sendLoginMfaCode(details)
}
```


# Appendix B - Additional complete source algorithms and helpers

Every code block below contains complete functions copied from the current working tree. Explanatory notes are documentation; added comments appear only in these Markdown copies. Function line spans are computed from the inspected source files.

## B1. Customer credit, registration, archive, restoration, and history algorithms

Source file: `server/controllers/customerController.js`

### `parseCustomerId` — source lines 42–45

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function parseCustomerId(value) {
  const customerId = Number(value)
  return Number.isInteger(customerId) && customerId > 0 ? customerId : null
}
```
### `parseCustomerName` — source lines 47–53

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function parseCustomerName(value) {
  if (typeof value !== 'string') throw new CustomerError(400, 'Customer name must be text')
  const customerName = value.trim()
  if (!customerName) throw new CustomerError(400, 'Customer name is required')
  if (customerName.length > 100) throw new CustomerError(400, 'Customer name must not exceed 100 characters')
  return customerName
}
```
### `parseOptionalText` — source lines 55–63

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function parseOptionalText(value, label, maximumLength) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new CustomerError(400, `${label} must be text`)
  const normalized = value.trim()
  if (maximumLength && normalized.length > maximumLength) {
    throw new CustomerError(400, `${label} must not exceed ${maximumLength} characters`)
  }
  return normalized || null
}
```
### `failure` — source lines 65–71

**Inputs and behavior:** Inputs: error, response and fallback. Map expected validation/duplicate errors and log unexpected failures.

```js
// Documentation comment: Inputs: error, response and fallback. Map expected validation/duplicate errors and log unexpected failures.
function failure(error, response, fallback) {
  if (error instanceof CustomerError) {
    return response.status(error.status).json({ success: false, message: error.message })
  }
  console.error(`${fallback}:`, error.message)
  return response.status(500).json({ success: false, message: fallback })
}
```
### `getCustomers` — source lines 73–96

**Inputs and behavior:** Input: authenticated customer query. Return customers under the caller route capability, using parameterized query and controlled error handling.

```js
// Documentation comment: Input: authenticated customer query. Return customers under the caller route capability, using parameterized query and controlled error handling.
export async function getCustomers(request, response) {
  try {
    if (request.user?.role === 'Staff') {
      const [customers] = await pool.execute(`
        SELECT customer_id, customer_name, current_balance
        FROM customers
        WHERE is_active = TRUE
        ORDER BY customer_name ASC
      `)
      return response.json({ success: true, data: customers })
    }
    const [customers] = await pool.execute(`
      SELECT ${customerSelectFields}
      FROM customers c
      ${customerFinancialJoins}
      WHERE c.is_active = TRUE
      ORDER BY c.customer_name ASC
    `)
    return response.json({ success: true, data: customers })
  } catch (error) {
    console.error('Unable to retrieve customers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customers' })
  }
}
```
### `getArchivedCustomers` — source lines 98–112

**Inputs and behavior:** Input: Admin request. Return archived customer list or mapped error response.

```js
// Documentation comment: Input: Admin request. Return archived customer list or mapped error response.
export async function getArchivedCustomers(request, response) {
  try {
    const [customers] = await pool.execute(`
      SELECT ${customerSelectFields}
      FROM customers c
      ${customerFinancialJoins}
      WHERE c.is_active = FALSE
      ORDER BY c.customer_name ASC
    `)
    return response.json({ success: true, data: customers })
  } catch (error) {
    console.error('Unable to retrieve archived customers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve archived customers' })
  }
}
```
### `archiveCustomer` — source lines 114–164

**Inputs and behavior:** Input: customer ID request. Validate current record and archive under the implemented customer status rules with audit logging.

```js
// Documentation comment: Input: customer ID request. Validate current record and archive under the implemented customer status rules with audit logging.
export async function archiveCustomer(request, response) {
  let connection
  let transactionStarted = false

  try {
    const customerId = parseCustomerId(request.params.id)
    if (!customerId) throw new CustomerError(400, 'Invalid customer ID')

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [customers] = await connection.execute(
      `SELECT customer_id, customer_name, current_balance, is_active
       FROM customers
       WHERE customer_id = ?
       LIMIT 1
       FOR UPDATE`,
      [customerId],
    )
    const customer = customers[0]
    if (!customer) throw new CustomerError(404, 'Customer not found')
    if (!customer.is_active) throw new CustomerError(409, 'Customer is already archived')
    if (Number(customer.current_balance) > 0) {
      throw new CustomerError(409, 'Customer has an outstanding balance. Settle the balance before archiving this customer.')
    }

    await connection.execute(
      'UPDATE customers SET is_active = FALSE WHERE customer_id = ?',
      [customerId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'CUSTOMER_ARCHIVED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Customer ${customerId} (${customer.customer_name}) archived`],
    )
    await connection.commit()
    transactionStarted = false

    return response.json({
      success: true,
      message: 'Customer archived successfully',
      data: { customer_id: customerId, customer_name: customer.customer_name, is_active: false },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    return failure(error, response, 'Unable to archive customer')
  } finally {
    connection?.release()
  }
}
```
### `restoreCustomer` — source lines 166–213

**Inputs and behavior:** Input: customer ID request. Validate archived record and restore under the implemented customer status rules with audit logging.

```js
// Documentation comment: Input: customer ID request. Validate archived record and restore under the implemented customer status rules with audit logging.
export async function restoreCustomer(request, response) {
  let connection
  let transactionStarted = false

  try {
    const customerId = parseCustomerId(request.params.id)
    if (!customerId) throw new CustomerError(400, 'Invalid customer ID')

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [customers] = await connection.execute(
      `SELECT customer_id, customer_name, is_active
       FROM customers
       WHERE customer_id = ?
       LIMIT 1
       FOR UPDATE`,
      [customerId],
    )
    const customer = customers[0]
    if (!customer) throw new CustomerError(404, 'Customer not found')
    if (customer.is_active) throw new CustomerError(409, 'Customer is already active')

    await connection.execute(
      'UPDATE customers SET is_active = TRUE WHERE customer_id = ?',
      [customerId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'CUSTOMER_RESTORED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Customer ${customerId} (${customer.customer_name}) restored`],
    )
    await connection.commit()
    transactionStarted = false

    return response.json({
      success: true,
      message: 'Customer restored successfully',
      data: { customer_id: customerId, customer_name: customer.customer_name, is_active: true },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    return failure(error, response, 'Unable to restore customer')
  } finally {
    connection?.release()
  }
}
```
### `createCustomer` — source lines 215–232

**Inputs and behavior:** Input: submitted customer details. Validate name/contact/address and issue one parameterized INSERT; this function does not create an activity row or open a transaction.

```js
// Documentation comment: Input: submitted customer details. Validate name/contact/address and issue one parameterized INSERT; this function does not create an activity row or open a transaction.
export async function createCustomer(request, response) {
  try {
    const customerName = parseCustomerName(request.body?.customer_name)
    const contactNumber = parseOptionalText(request.body?.contact_number, 'Contact number', 20)
    const address = parseOptionalText(request.body?.address, 'Address')
    const [result] = await pool.execute(
      'INSERT INTO customers (customer_name, contact_number, address) VALUES (?, ?, ?)',
      [customerName, contactNumber, address],
    )
    return response.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: { customer_id: result.insertId },
    })
  } catch (error) {
    return failure(error, response, 'Unable to create customer')
  }
}
```
### `updateCustomer` — source lines 234–309

**Inputs and behavior:** Inputs: customer ID and submitted fields. Validate/lock as implemented, update customer details and return mapped errors.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Inputs: customer ID and submitted fields. Validate/lock as implemented, update customer details and return mapped errors.
export async function updateCustomer(request, response) {
  let connection
  let transactionStarted = false

  try {
    const customerId = parseCustomerId(request.params.id)
    if (!customerId) throw new CustomerError(400, 'Invalid customer ID')
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new CustomerError(400, 'A customer update is required')
    }

    const submittedFields = Object.keys(body)
    if (!submittedFields.length) throw new CustomerError(400, 'At least one customer field is required')
    if (submittedFields.some((field) => !editableCustomerFields.has(field))) {
      throw new CustomerError(400, 'Only customer name, contact number, and address can be updated')
    }

    const updates = []
    const values = []
    if (Object.hasOwn(body, 'customer_name')) {
      updates.push('customer_name = ?')
      values.push(parseCustomerName(body.customer_name))
    }
    if (Object.hasOwn(body, 'contact_number')) {
      updates.push('contact_number = ?')
      values.push(parseOptionalText(body.contact_number, 'Contact number', 20))
    }
    if (Object.hasOwn(body, 'address')) {
      updates.push('address = ?')
      values.push(parseOptionalText(body.address, 'Address'))
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true
    const [customers] = await connection.execute(
      `SELECT customer_id
       FROM customers
       WHERE customer_id = ? AND is_active = TRUE
       LIMIT 1
       FOR UPDATE`,
      [customerId],
    )
    if (!customers[0]) throw new CustomerError(404, 'Customer not found')

    await connection.execute(
      `UPDATE customers SET ${updates.join(', ')} WHERE customer_id = ?`,
      [...values, customerId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'CUSTOMER_UPDATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Customer ${customerId} details updated`],
    )
    const [updatedCustomers] = await connection.execute(
      `SELECT customer_id, customer_name, contact_number, address, current_balance, created_at
       FROM customers
       WHERE customer_id = ? AND is_active = TRUE
       LIMIT 1`,
```
#### Consecutive source section 2 of 2

```js
      [customerId],
    )
    await connection.commit()
    transactionStarted = false
    return response.json({
      success: true,
      message: 'Customer updated successfully',
      data: updatedCustomers[0],
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    return failure(error, response, 'Unable to update customer')
  } finally {
    connection?.release()
  }
}
```
### `getCustomer` — source lines 311–338

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getCustomer(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    if (request.user?.role === 'Staff') {
      const [customers] = await pool.execute(
        `SELECT customer_id, customer_name, current_balance
         FROM customers WHERE customer_id = ? AND is_active = TRUE LIMIT 1`,
        [customerId],
      )
      if (!customers[0]) return response.status(404).json({ success: false, message: 'Customer not found' })
      return response.json({ success: true, data: customers[0] })
    }
    const [customers] = await pool.execute(
      `SELECT ${customerSelectFields}
       FROM customers c
       ${customerFinancialJoins}
       WHERE c.customer_id = ? LIMIT 1`,
      [customerId],
    )
    if (!customers[0]) return response.status(404).json({ success: false, message: 'Customer not found' })
    return response.json({ success: true, data: customers[0] })
  } catch (error) {
    console.error('Unable to retrieve customer:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer' })
  }
}
```
### `getCustomerSales` — source lines 340–367

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getCustomerSales(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [sales] = await pool.execute(
      `SELECT sa.sale_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              sa.payment_type,
              sa.total_amount,
              sa.amount_paid,
              sa.remaining_balance,
              sa.status,
              COUNT(si.salesitem_id) AS item_count
       FROM sales sa
       LEFT JOIN sales_items si ON si.sale_id = sa.sale_id
       WHERE sa.customer_id = ?
       GROUP BY sa.sale_id, sa.sale_date, sa.payment_type, sa.total_amount,
                sa.amount_paid, sa.remaining_balance, sa.status
       ORDER BY sa.sale_date DESC, sa.sale_id DESC`,
      [customerId],
    )
    return response.json({ success: true, data: sales })
  } catch (error) {
    console.error('Unable to retrieve customer sales:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer sales' })
  }
}
```
### `getCustomerCredits` — source lines 369–389

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getCustomerCredits(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [credits] = await pool.execute(
      `SELECT sa.sale_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              sa.total_amount, sa.amount_paid,
              sa.remaining_balance, sa.status, u.fullname AS recorded_by
       FROM sales sa JOIN users u ON sa.user_id = u.user_id
       WHERE sa.customer_id = ? AND sa.payment_type = 'Credit'
       ORDER BY sa.sale_date DESC, sa.sale_id DESC`,
      [customerId],
    )
    return response.json({ success: true, data: credits })
  } catch (error) {
    console.error('Unable to retrieve customer credits:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer credits' })
  }
}
```
### `getCustomerPayments` — source lines 391–410

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getCustomerPayments(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [payments] = await pool.execute(
      `SELECT pa.payment_id, pa.sale_id, pa.payment_amount, pa.remaining_balance,
              CONCAT(DATE_FORMAT(pa.payment_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS payment_date,
              u.fullname AS recorded_by
       FROM payments pa JOIN users u ON pa.user_id = u.user_id
       WHERE pa.customer_id = ?
       ORDER BY pa.payment_date DESC, pa.payment_id DESC`,
      [customerId],
    )
    return response.json({ success: true, data: payments })
  } catch (error) {
    console.error('Unable to retrieve customer payments:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer payments' })
  }
}
```

## B2. Supplier list/detail mutations and audit activity

Source file: `server/controllers/supplierController.js`

### `parseSupplierId` — source lines 10–17

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function parseSupplierId(value) {
  if (!/^\d+$/.test(String(value ?? ''))) throw new SupplierError(400, 'Invalid supplier ID')
  const supplierId = Number(value)
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || supplierId > 2147483647) {
    throw new SupplierError(400, 'Invalid supplier ID')
  }
  return supplierId
}
```
### `supplierDetails` — source lines 19–43

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function supplierDetails(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SupplierError(400, 'Supplier details are required')
  }

  const supplierName = typeof body.supplier_name === 'string' ? body.supplier_name.trim() : ''
  const contactNumber = typeof body.contact_number === 'string' ? body.contact_number.trim() : ''
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const contactPersonProvided = body.contact_person !== undefined && body.contact_person !== null
  if (contactPersonProvided && typeof body.contact_person !== 'string') {
    throw new SupplierError(400, 'Contact person must be text')
  }
  const contactPerson = contactPersonProvided ? body.contact_person.trim() || null : null

  if (!supplierName) throw new SupplierError(400, 'Supplier name is required')
  if (supplierName.length > 100) throw new SupplierError(400, 'Supplier name must be 100 characters or fewer')
  if (contactPerson && contactPerson.length > 100) {
    throw new SupplierError(400, 'Contact person must be 100 characters or fewer')
  }
  if (!contactNumber) throw new SupplierError(400, 'Contact number is required')
  if (contactNumber.length > 20) throw new SupplierError(400, 'Contact number must be 20 characters or fewer')
  if (typeof body.address !== 'string' || !address) throw new SupplierError(400, 'Address is required')

  return { supplierName, contactPerson, contactNumber, address }
}
```
### `lockSupplier` — source lines 45–55

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
async function lockSupplier(connection, supplierId) {
  const [suppliers] = await connection.execute(
    `SELECT supplier_id, supplier_name, is_active
     FROM suppliers
     WHERE supplier_id = ?
     LIMIT 1
     FOR UPDATE`,
    [supplierId],
  )
  return suppliers[0]
}
```
### `recordSupplierActivity` — source lines 57–72

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
async function recordSupplierActivity(connection, userId, action, description) {
  if (action === 'SUPPLIER_UPDATED') {
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'SUPPLIER_UPDATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [userId, description],
    )
    return
  }

  await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [userId, action, description],
  )
}
```
### `getSuppliers` — source lines 74–100

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getSuppliers(request, response) {
  try {
    const [suppliers] = await pool.execute(`
      SELECT
          supplier_id,
          supplier_name,
          contact_person,
          contact_number,
          address,
          created_at
      FROM suppliers
      WHERE is_active = TRUE
      ORDER BY supplier_name ASC;
    `)

    response.json({
      success: true,
      data: suppliers,
    })
  } catch (error) {
    console.error('Unable to retrieve suppliers:', error.message)
    response.status(500).json({
      success: false,
      message: 'Unable to retrieve suppliers',
    })
  }
}
```
### `getArchivedSuppliers` — source lines 102–122

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getArchivedSuppliers(request, response) {
  try {
    const [suppliers] = await pool.execute(`
      SELECT
          supplier_id,
          supplier_name,
          contact_person,
          contact_number,
          address,
          created_at
      FROM suppliers
      WHERE is_active = FALSE
      ORDER BY supplier_name ASC
    `)

    return response.json({ success: true, data: suppliers })
  } catch (error) {
    console.error('Unable to retrieve archived suppliers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve archived suppliers' })
  }
}
```
### `changeSupplierStatus` — source lines 124–172

**Inputs and behavior:** Inputs: supplier request and restore flag. Lock supplier, validate state transition, update archive status and record activity.

```js
// Documentation comment: Inputs: supplier request and restore flag. Lock supplier, validate state transition, update archive status and record activity.
async function changeSupplierStatus(request, response, restore) {
  let connection
  let transactionStarted = false

  try {
    const supplierId = Number(request.params.id)
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new SupplierError(400, 'Invalid supplier ID')
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const supplier = await lockSupplier(connection, supplierId)
    if (!supplier) throw new SupplierError(404, 'Supplier not found')
    if (restore && supplier.is_active) throw new SupplierError(409, 'Supplier is already active')
    if (!restore && !supplier.is_active) throw new SupplierError(409, 'Supplier is already archived')

    // Archive and restore change status in place, preserving stock-in supplier references.
    await connection.execute(
      `UPDATE suppliers SET is_active = ${restore ? 'TRUE' : 'FALSE'} WHERE supplier_id = ?`,
      [supplierId],
    )
    await recordSupplierActivity(
      connection,
      request.user.user_id,
      restore ? 'SUPPLIER_RESTORED' : 'SUPPLIER_ARCHIVED',
      `Supplier ${supplierId} (${supplier.supplier_name}) ${restore ? 'restored' : 'archived'}`,
    )

    await connection.commit()
    transactionStarted = false
    return response.json({
      success: true,
      message: restore ? 'Supplier restored successfully' : 'Supplier archived successfully',
      data: { supplier_id: supplierId, supplier_name: supplier.supplier_name, is_active: restore },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    if (error instanceof SupplierError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error(`Unable to ${restore ? 'restore' : 'archive'} supplier:`, error.message)
    return response.status(500).json({ success: false, message: `Unable to ${restore ? 'restore' : 'archive'} supplier` })
  } finally {
    connection?.release()
  }
}
```
### `createSupplier` — source lines 182–208

**Inputs and behavior:** Input: supplier details. Validate fields, issue a parameterized INSERT, and return the new ID; this function does not create an activity row or open a transaction.

```js
// Documentation comment: Input: supplier details. Validate fields, issue a parameterized INSERT, and return the new ID; this function does not create an activity row or open a transaction.
export async function createSupplier(request, response) {
  try {
    const { supplierName, contactPerson, contactNumber, address } = supplierDetails(request.body)
    const [result] = await pool.execute(
      `INSERT INTO suppliers (supplier_name, contact_person, contact_number, address)
       VALUES (?, ?, ?, ?)`,
      [supplierName, contactPerson, contactNumber, address],
    )

    return response.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: {
        supplier_id: result.insertId,
      },
    })
  } catch (error) {
    if (error instanceof SupplierError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to create supplier:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to create supplier',
    })
  }
}
```
### `updateSupplier` — source lines 210–263

**Inputs and behavior:** Inputs: supplier ID and updated details. Lock/check supplier, update permitted fields and record activity.

```js
// Documentation comment: Inputs: supplier ID and updated details. Lock/check supplier, update permitted fields and record activity.
export async function updateSupplier(request, response) {
  let connection
  let transactionStarted = false

  try {
    const supplierId = parseSupplierId(request.params.id)
    const { supplierName, contactPerson, contactNumber, address } = supplierDetails(request.body)

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const supplier = await lockSupplier(connection, supplierId)
    if (!supplier) throw new SupplierError(404, 'Supplier not found')

    // Update the existing supplier row by ID; stock-in records keep that reference and display its current name.
    await connection.execute(
      `UPDATE suppliers
       SET supplier_name = ?, contact_person = ?, contact_number = ?, address = ?
       WHERE supplier_id = ?`,
      [supplierName, contactPerson, contactNumber, address, supplierId],
    )
    await recordSupplierActivity(
      connection,
      request.user.user_id,
      'SUPPLIER_UPDATED',
      `Supplier ${supplierId} (${supplierName}) details updated`,
    )

    await connection.commit()
    transactionStarted = false
    return response.json({
      success: true,
      message: 'Supplier updated successfully',
      data: {
        supplier_id: supplierId,
        supplier_name: supplierName,
        contact_person: contactPerson,
        contact_number: contactNumber,
        address,
        is_active: supplier.is_active,
      },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    if (error instanceof SupplierError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to update supplier:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to update supplier' })
  } finally {
    connection?.release()
  }
}
```

## B3. User listing, creation, update, activation, and password reset

Source file: `server/controllers/userController.js`

### `getUsers` — source lines 90–95

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export async function getUsers(request, response) {
  try {
    const [users] = await pool.execute(`SELECT ${safeFields} FROM users ORDER BY created_at DESC, user_id DESC`)
    return response.json({ success: true, data: users })
  } catch (error) { return failure(error, response, 'Unable to retrieve users') }
}
```
### `getUserById` — source lines 97–100

**Inputs and behavior:** Input: target ID. Validate and return selected safe fields for one account.

```js
// Documentation comment: Input: target ID. Validate and return selected safe fields for one account.
export async function getUserById(request, response) {
  try { return response.json({ success: true, data: await findUser(pool, positiveId(request.params.id)) }) }
  catch (error) { return failure(error, response, 'Unable to retrieve user') }
}
```
### `createUser` — source lines 102–129

**Inputs and behavior:** Input: Admin user details/password. Validate uniqueness, hash password, create user/verification token and activity in transaction, deliver verification after commit.

```js
// Documentation comment: Input: Admin user details/password. Validate uniqueness, hash password, create user/verification token and activity in transaction, deliver verification after commit.
export async function createUser(request, response) {
  let connection
  try {
    const details = userDetails(request.body)
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!password.trim()) throw new UserError(400, 'Password is required')
    connection = await pool.getConnection(); await connection.beginTransaction()
    await uniqueUsername(connection, details.username)
    await uniqueEmail(connection, details.email)
    const hash = await bcrypt.hash(password, 10)
    const [result] = await connection.execute('INSERT INTO users (fullname, username, email, password, role, contact_number) VALUES (?, ?, ?, ?, ?, ?)', [details.fullname, details.username, details.email, hash, details.role, details.contactNumber])
    const verification = details.email
      ? await issueEmailVerificationToken(connection, result.insertId, details.email)
      : null
    await activity(connection, request.user.user_id, 'USER_CREATED', `User ${result.insertId} (${details.username}) created with role ${details.role}`)
    const user = await findUser(connection, result.insertId)
    await connection.commit()
    connection.release(); connection = null
    const delivered = await deliverVerification(details.email, verification)
    const message = verification && !delivered
      ? 'User created. The recovery email was saved, but the verification email could not be sent.'
      : verification
        ? 'User created. A verification email was sent.'
        : 'User created successfully'
    return response.status(201).json({ success: true, message, data: user })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to create user') }
  finally { connection?.release() }
}
```
### `updateUser` — source lines 131–164

**Inputs and behavior:** Inputs: Admin target ID and account details. Lock target, validate uniqueness/self-role, update identity/email verification, log and commit.

```js
// Documentation comment: Inputs: Admin target ID and account details. Lock target, validate uniqueness/self-role, update identity/email verification, log and commit.
export async function updateUser(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id); const details = userDetails(request.body)
    if (userId === request.user.user_id && details.role !== 'Admin') throw new UserError(400, 'You cannot change your own Admin account to Staff')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const existing = await findUser(connection, userId, true)
    const nextEmail = details.emailProvided ? details.email : existing.email
    await uniqueUsername(connection, details.username, userId); await uniqueEmail(connection, nextEmail, userId)
    const emailChanged = existing.email !== nextEmail
    await connection.execute(
      `UPDATE users
       SET fullname = ?, username = ?, email = ?, email_verified_at = ?, role = ?, contact_number = ?
       WHERE user_id = ?`,
      [details.fullname, details.username, nextEmail, emailChanged ? null : existing.email_verified_at, details.role, details.contactNumber, userId],
    )
    let verification = null
    if (emailChanged) {
      if (nextEmail) verification = await issueEmailVerificationToken(connection, userId, nextEmail)
      else await invalidateEmailVerificationTokens(connection, userId)
    }
    await activity(connection, request.user.user_id, 'USER_UPDATED', `User ${userId} (${details.username}) details updated`)
    const user = await findUser(connection, userId); await connection.commit()
    connection.release(); connection = null
    const delivered = await deliverVerification(nextEmail, verification)
    const message = verification && !delivered
      ? 'User updated. The recovery email was saved, but the verification email could not be sent.'
      : verification
        ? 'User updated. A verification email was sent.'
        : 'User updated successfully'
    return response.json({ success: true, message, data: user })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to update user') }
  finally { connection?.release() }
}
```
### `updateUserStatus` — source lines 166–181

**Inputs and behavior:** Inputs: Admin target ID and boolean status. Prevent self-deactivation, update status, record activity and commit.

```js
// Documentation comment: Inputs: Admin target ID and boolean status. Prevent self-deactivation, update status, record activity and commit.
export async function updateUserStatus(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    if (typeof request.body?.is_active !== 'boolean') throw new UserError(400, 'Account status must be active or inactive')
    if (userId === request.user.user_id && !request.body.is_active) throw new UserError(400, 'You cannot deactivate your own account')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const user = await findUser(connection, userId)
    await connection.execute('UPDATE users SET is_active = ? WHERE user_id = ?', [request.body.is_active, userId])
    const action = request.body.is_active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED'
    await activity(connection, request.user.user_id, action, `User ${userId} (${user.username}) ${request.body.is_active ? 'activated' : 'deactivated'}`)
    const updated = await findUser(connection, userId); await connection.commit()
    return response.json({ success: true, message: `User ${request.body.is_active ? 'activated' : 'deactivated'} successfully`, data: updated })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to update user status') }
  finally { connection?.release() }
}
```
### `resetUserPassword` — source lines 183–201

**Inputs and behavior:** Input: Admin request with target user ID and new password. Hash replacement, increment auth_version, invalidate reset tokens, log action and commit in transaction.

```js
// Documentation comment: Input: Admin request with target user ID and new password. Hash replacement, increment auth_version, invalidate reset tokens, log action and commit in transaction.
export async function resetUserPassword(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    const password = typeof request.body?.new_password === 'string' ? request.body.new_password : ''
    if (!password.trim()) throw new UserError(400, 'New password is required')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const user = await findUser(connection, userId)
    await connection.execute(
      'UPDATE users SET password = ?, auth_version = auth_version + 1 WHERE user_id = ?',
      [await bcrypt.hash(password, 10), userId],
    )
    await invalidatePasswordResetTokens(connection, userId)
    await activity(connection, request.user.user_id, 'USER_PASSWORD_RESET', `Password reset for user ${userId} (${user.username})`)
    await connection.commit()
    return response.json({ success: true, message: 'Password reset successfully' })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to reset password') }
  finally { connection?.release() }
}
```

## B4. Activity log retrieval, filtering, and pagination

Source file: `server/controllers/activityLogController.js`

### `positiveInteger` — source lines 6–9

**Inputs and behavior:** Inputs: candidate, fallback and maximum. Convert positive integer values and cap them; otherwise return fallback.

```js
// Documentation comment: Inputs: candidate, fallback and maximum. Convert positive integer values and cap them; otherwise return fallback.
function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}
```
### `validDate` — source lines 11–13

**Inputs and behavior:** Input: date string. Check only YYYY-MM-DD syntax; calendar-date validity is not checked here.

```js
// Documentation comment: Input: date string. Check only YYYY-MM-DD syntax; calendar-date validity is not checked here.
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
```
### `getActivityLogs` — source lines 15–72

**Inputs and behavior:** Input: activity query. Validate dates, assemble bound search/date filters, count/page rows and return metadata.

```js
// Documentation comment: Input: activity query. Validate dates, assemble bound search/date filters, count/page rows and return metadata.
export async function getActivityLogs(request, response) {
  try {
    const page = positiveInteger(request.query.page, 1)
    const limit = positiveInteger(request.query.limit, 20, 100)
    const offset = (page - 1) * limit
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
    const clauses = []
    const parameters = []

    if ((request.query.start_date && !validDate(request.query.start_date)) || (request.query.end_date && !validDate(request.query.end_date))) {
      return response.status(400).json({ success: false, message: 'Dates must use YYYY-MM-DD format' })
    }

    if (search) {
      clauses.push('(u.fullname LIKE ? OR u.username LIKE ? OR al.action LIKE ? OR al.description LIKE ?)')
      const term = `%${search}%`
      parameters.push(term, term, term, term)
    }
    if (validDate(request.query.start_date)) {
      clauses.push('al.created_at >= ?')
      parameters.push(request.query.start_date)
    }
    if (validDate(request.query.end_date)) {
      clauses.push('al.created_at < DATE_ADD(?, INTERVAL 1 DAY)')
      parameters.push(request.query.end_date)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const [countRows] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM activity_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
      ${where}
    `, parameters)
    const [logs] = await pool.execute(`
      SELECT al.activity_id, al.user_id, al.action, al.description,
             CONCAT(DATE_FORMAT(al.created_at, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS created_at,
             COALESCE(u.username, 'System') AS username,
             COALESCE(u.fullname, 'System') AS fullname,
             COALESCE(u.role, 'System') AS role
      FROM activity_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
      ${where}
      ORDER BY al.created_at DESC, al.activity_id DESC
      LIMIT ? OFFSET ?
    `, [...parameters, String(limit), String(offset)])
    const total = Number(countRows[0].total)

    return response.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Unable to retrieve activity logs:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve activity logs' })
  }
}
```

## B5. Decimal parsing and validation

Source file: `server/utils/decimalValidation.js`

### `decimalPlaces` — source lines 9–16

**Inputs and behavior:** Input: decimal text. Derive effective decimal precision including exponent notation and trailing zeros.

```js
// Documentation comment: Input: decimal text. Derive effective decimal precision including exponent notation and trailing zeros.
function decimalPlaces(text) {
  const match = text.match(/^\d+(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) return null

  const fraction = (match[1] || '').replace(/0+$/, '')
  const exponent = Number(match[2] || 0)
  return Math.max(fraction.length - exponent, 0)
}
```
### `parseDecimal` — source lines 18–63

**Inputs and behavior:** Inputs: raw decimal and field/range/scale rules. Validate supported type, syntax, finiteness, sign, bounds and decimal places, then return Number.

```js
// Documentation comment: Inputs: raw decimal and field/range/scale rules. Validate supported type, syntax, finiteness, sign, bounds and decimal places, then return Number.
export function parseDecimal(value, {
  fieldName,
  maximum,
  decimalPlaces: maximumDecimalPlaces,
  minimum = 0,
  inclusiveMinimum = true,
}) {
  const supportedType = typeof value === 'number' || typeof value === 'string'
  const raw = supportedType ? String(value).trim() : ''

  if (!supportedType || !raw) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const negativeSyntax = raw.startsWith('-')
  const validMinimum = inclusiveMinimum ? parsed >= minimum : parsed > minimum
  if (negativeSyntax || !validMinimum) {
    throw new DecimalValidationError(
      inclusiveMinimum
        ? `${fieldName} must be at least ${minimum}`
        : `${fieldName} must be greater than ${minimum}`,
    )
  }

  if (parsed > maximum) {
    throw new DecimalValidationError(`${fieldName} must not exceed ${maximum}`)
  }

  const precision = decimalPlaces(raw)
  if (precision === null || precision > maximumDecimalPlaces) {
    throw new DecimalValidationError(
      `${fieldName} supports up to ${maximumDecimalPlaces} decimal places`,
    )
  }

  return parsed
}
```

## B6. Report generation audit logging

Source file: `server/controllers/reportController.js`

### `logReportGeneration` — source lines 380–405

**Inputs and behavior:** Inputs: authenticated report generation request. Validate report type/role, persist report record and asynchronously record activity.

```js
// Documentation comment: Inputs: authenticated report generation request. Validate report type/role, persist report record and asynchronously record activity.
export async function logReportGeneration(request, response) {
  const reportType = request.body?.report_type
  if (!reportTypes.has(reportType)) {
    return response.status(400).json({ success: false, message: 'Invalid report type' })
  }
  if (reportType === 'Inventory Valuation' && request.user?.role !== 'Admin') {
    return response.status(403).json({ success: false, message: 'Access denied' })
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO reports (user_id, report_type) VALUES (?, ?)',
      [request.user.user_id, reportType],
    )
    pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'REPORT_GENERATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `${reportType} report exported`],
    ).catch((error) => console.error('Unable to record report activity:', error.message))

    return response.status(201).json({ success: true, data: { report_id: result.insertId } })
  } catch (error) {
    console.error('Unable to log report generation:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to log report generation' })
  }
}
```

## B7. MFA challenge creation, consumption, resend, and invalidation

Source file: `server/services/loginMfaService.js`

### `newCode` — source lines 25–27

**Inputs and behavior:** No inputs. Generate an MFA one-time code using the service cryptographic helper.

```js
// Documentation comment: No inputs. Generate an MFA one-time code using the service cryptographic helper.
function newCode() {
  return createMfaOtp(environment.mfa.otpLength)
}
```
### `dateBucket` — source lines 29–32

**Inputs and behavior:** Input: time window. Derive the current rate-limit bucket for the requested interval.

```js
// Documentation comment: Input: time window. Derive the current rate-limit bucket for the requested interval.
function dateBucket(windowSeconds) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  return new Date(bucket)
}
```
### `consumeLimit` — source lines 34–62

**Inputs and behavior:** Inputs: connection, action, identifier kind/value, maximum and time window. Atomically consume rate allowance and reject exhausted limits.

```js
// Documentation comment: Inputs: connection, action, identifier kind/value, maximum and time window. Atomically consume rate allowance and reject exhausted limits.
async function consumeLimit(connection, action, kind, value, maximum, windowSeconds) {
  if (kind === 'ip') {
    await connection.execute(
      `DELETE FROM login_mfa_rate_limits
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
       LIMIT 500`,
    )
  }
  // Store keyed hashes of account/IP identifiers rather than their raw values; the
  // unique scope and time bucket let concurrent requests increment one counter row.
  const hash = hashMfaRateIdentifier(kind, value || '<unknown>', secret())
  const bucketStart = dateBucket(windowSeconds)
  await connection.execute(
    `INSERT INTO login_mfa_rate_limits (action, identifier_kind, identifier_hash, window_started_at, request_count, created_at)
     VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
    [action, kind, hash, bucketStart],
  )
  const [rows] = await connection.execute(
    `SELECT request_count FROM login_mfa_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ? AND window_started_at = ?
     LIMIT 1`,
    [action, kind, hash, bucketStart],
  )
  if (Number(rows[0]?.request_count || 0) > maximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucketStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000))
    throw new LoginMfaError(429, 'Too many sign-in attempts. Please try again later.', retryAfterSeconds)
  }
}
```
### `withTransaction` — source lines 64–80

**Inputs and behavior:** Input: callback work. Open connection, begin transaction, commit success, roll back failure and release connection.

```js
// Documentation comment: Input: callback work. Open connection, begin transaction, commit success, roll back failure and release connection.
async function withTransaction(work) {
  const connection = await pool.getConnection()
  let active = false
  try {
    await connection.beginTransaction()
    active = true
    const result = await work(connection)
    await connection.commit()
    active = false
    return result
  } catch (error) {
    if (active) await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
```
### `enforceLoginRateLimits` — source lines 82–87

**Inputs and behavior:** Inputs: username and client IP. Apply configured per-identifier and per-address login limits.

```js
// Documentation comment: Inputs: username and client IP. Apply configured per-identifier and per-address login limits.
export async function enforceLoginRateLimits({ username, ipAddress }) {
  return withTransaction(async (connection) => {
    await consumeLimit(connection, 'login', 'ip', ipAddress, 30, 15 * 60)
    await consumeLimit(connection, 'login', 'account', String(username || '').trim().toLowerCase(), 10, 15 * 60)
  })
}
```
### `createLoginChallenge` — source lines 89–123

**Inputs and behavior:** Inputs: user and client IP. Create challenge/OTP state with expiry, rate controls and associated user details.

```js
// Documentation comment: Inputs: user and client IP. Create challenge/OTP state with expiry, rate controls and associated user details.
export async function createLoginChallenge(user, ipAddress) {
  const id = createMfaChallengeId()
  const idHash = hashMfaChallengeId(id)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  await withTransaction(async (connection) => {
    // Consume request limits and replace any outstanding challenge atomically, while
    // persisting only hashes of the bearer ID, OTP, and email.
    await consumeLimit(connection, 'challenge', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'challenge', 'account', String(user.user_id), 5, 60 * 60)
    await connection.execute(
      `DELETE FROM login_mfa_challenges
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       LIMIT 500`,
    )
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
       WHERE user_id = ? AND consumed_at IS NULL`,
      [user.user_id],
    )
    await connection.execute(
      `INSERT INTO login_mfa_challenges
         (challenge_hash, user_id, auth_version, email_hash, otp_hash, expires_at, resend_available_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
      [idHash, user.user_id, Number(user.auth_version || 0), hashMfaEmail(user.email, secret()), otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds],
    )
  })
  return {
    challengeId: id,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}
```
### `consumeLoginChallenge` — source lines 125–206

**Inputs and behavior:** Inputs: challenge ID, submitted code and client IP. Lock/check challenge state, validate OTP and attempt/rate rules, consume once, and return current user.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Inputs: challenge ID, submitted code and client IP. Lock/check challenge state, validate OTP and attempt/rate rules, consume once, and return current user.
export async function consumeLoginChallenge({ challengeId, code, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const submittedCode = typeof code === 'string' ? code : ''

  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'verify', 'ip', ipAddress, 60, 15 * 60)
    await consumeLimit(connection, 'verify', 'challenge', idHash.toString('hex'), 15, 15 * 60)
    // Lock this challenge while checking attempts and consuming it so concurrent
    // verifications cannot both turn one OTP into separate authenticated sessions.
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, auth_version, email_hash, otp_hash, expires_at, attempts, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This verification code is invalid or has expired.') }
    }

    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }

    const matches = verifyMfaOtp(challenge.otp_hash, idHash, submittedCode, secret())
    if (!matches) {
      const attempts = Number(challenge.attempts) + 1
      await connection.execute(
        `UPDATE login_mfa_challenges
         SET attempts = ?, consumed_at = IF(? >= ?, UTC_TIMESTAMP(3), consumed_at)
         WHERE challenge_id = ?`,
        [attempts, attempts, maximumAttempts, challenge.challenge_id],
      )
      if (attempts >= maximumAttempts) {
        return { failure: new LoginMfaError(429, 'Maximum verification attempts reached. Return to login to request a new code.') }
      }
      return { failure: new LoginMfaError(400, 'The verification code is incorrect.') }
    }

    // Re-read account state at verification time so deactivation, role/email changes,
    // or a credential-version increment invalidate an already-issued code.
    const [users] = await connection.execute(
      `SELECT user_id, fullname, username, role, is_active, email, email_verified_at, auth_version
       FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user || !user.is_active || !user.email || !user.email_verified_at || !['Admin', 'Staff'].includes(user.role)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (Number(user.auth_version || 0) !== Number(challenge.auth_version || 0)) {
```
#### Consecutive source section 2 of 2

```js
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account credentials changed. Return to login and try again.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    await connection.execute(
      'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ? AND consumed_at IS NULL',
      [challenge.challenge_id],
    )
    return user
  })
  if (result?.failure) throw result.failure
  return result
}
```
### `resendLoginChallenge` — source lines 208–272

**Inputs and behavior:** Inputs: challenge ID and client IP. Validate resend window/rate state, rotate OTP and return delivery details.

#### Consecutive source section 1 of 2

```js
// Documentation comment: Inputs: challenge ID and client IP. Validate resend window/rate state, rotate OTP and return delivery details.
export async function resendLoginChallenge({ challengeId, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'resend', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'resend', 'challenge', idHash.toString('hex'), 10, 60 * 60)
    // Serialize resend requests on the challenge row and enforce the stored cooldown
    // before rotating the OTP hash and expiry.
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, email_hash, expires_at, resend_available_at, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired,
              resend_available_at <= UTC_TIMESTAMP(3) AS resend_ready,
              GREATEST(1, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), resend_available_at) / 1000000)) AS retry_after
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This login verification request is invalid or has expired.') }
    }
    const [users] = await connection.execute(
      `SELECT email, is_active, email_verified_at FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user?.is_active || !user.email || !user.email_verified_at) {
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }
    if (!challenge.resend_ready) {
      return { failure: new LoginMfaError(429, 'Please wait before requesting another code.', Number(challenge.retry_after)) }
    }
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET otp_hash = ?, attempts = 0,
           expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
           resend_available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
       WHERE challenge_id = ?`,
      [otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds, challenge.challenge_id],
    )
    return { email: user.email }
  })
  if (result?.failure) throw result.failure
  return {
    ...result,
```
#### Consecutive source section 2 of 2

```js
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}
```
### `invalidateLoginChallenge` — source lines 274–281

**Inputs and behavior:** Input: challenge ID. Mark the pending challenge unusable.

```js
// Documentation comment: Input: challenge ID. Mark the pending challenge unusable.
export async function invalidateLoginChallenge(challengeId) {
  await pool.execute(
    `UPDATE login_mfa_challenges
     SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
     WHERE challenge_hash = ?`,
    [hashMfaChallengeId(typeof challengeId === 'string' ? challengeId : '')],
  )
}
```

## B8. Staff supplier activity metrics and delivery chart buckets

Source file: `src/utils/staffSupplierMetrics.js`

### `manilaMonthKey` — source lines 19–28

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function manilaMonthKey(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    manilaParts.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}`
}
```
### `monthBuckets` — source lines 30–43

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function monthBuckets(now) {
  const current = manilaMonthKey(now.toISOString())
  const [year, month] = current.split('-').map(Number)
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (5 - index), 15, 12))
    const key = manilaMonthKey(date.toISOString())
    return {
      key,
      label: monthLabel.format(date),
      tooltipLabel: monthTooltipLabel.format(date),
      deliveries: 0,
    }
  })
}
```
### `isPostedRecord` — source lines 45–48

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
function isPostedRecord(record) {
  const status = String(record.status || '').trim().toLowerCase()
  return !['cancelled', 'canceled', 'void', 'voided'].includes(status)
}
```
### `getStaffSupplierMetrics` — source lines 50–82

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export function getStaffSupplierMetrics(records, supplierId, now = new Date()) {
  const seen = new Set()
  const deliveries = []

  for (const record of records) {
    if (String(record.supplier_id) !== String(supplierId) || !record.stockin_id || !isPostedRecord(record)) continue
    const key = String(record.stockin_id)
    if (seen.has(key)) continue
    const date = new Date(record.delivery_date)
    if (!record.delivery_date || Number.isNaN(date.getTime())) continue
    seen.add(key)
    deliveries.push(record)
  }

  deliveries.sort((left, right) => (
    new Date(right.delivery_date).getTime() - new Date(left.delivery_date).getTime()
    || Number(right.stockin_id) - Number(left.stockin_id)
  ))

  const monthlyActivity = monthBuckets(now)
  const monthIndex = new Map(monthlyActivity.map((item, index) => [item.key, index]))
  for (const delivery of deliveries) {
    const index = monthIndex.get(manilaMonthKey(delivery.delivery_date))
    if (index !== undefined) monthlyActivity[index].deliveries += 1
  }

  return {
    totalDeliveries: deliveries.length,
    lastDelivery: deliveries[0] || null,
    monthlyActivity,
    recentDeliveries: deliveries.slice(0, 5),
  }
}
```
### `getDeliveryChartTicks` — source lines 84–88

**Inputs and behavior:** The complete implementation follows; the source signature and body preserve its actual processing and return behavior.

```js
// Documentation comment: The complete implementation follows; the source signature and body preserve its actual processing and return behavior.
export function getDeliveryChartTicks(maximum) {
  const domainMaximum = Math.max(1, Math.floor(Number(maximum) || 0))
  const midpoint = Math.ceil(domainMaximum / 2)
  return [...new Set([domainMaximum, midpoint, 0])]
}
```


# Appendix C - Complete supporting helper modules

Each block below reproduces the complete module file.

## C1. Decimal validation helper module

Source file: `server/utils/decimalValidation.js`, lines 1-63

**Purpose and dependencies:** Contains shared decimal precision/range rules used before money and quantity normalization.

### Consecutive source section 1 of 2

```js
// Documentation comment: Contains shared decimal precision/range rules used before money and quantity normalization.
export const decimalLimits = Object.freeze({
  quantity: 9999999.999,
  unitPrice: 99999999.99,
  money: 9999999999.99,
})

export class DecimalValidationError extends Error {}

function decimalPlaces(text) {
  const match = text.match(/^\d+(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) return null

  const fraction = (match[1] || '').replace(/0+$/, '')
  const exponent = Number(match[2] || 0)
  return Math.max(fraction.length - exponent, 0)
}

export function parseDecimal(value, {
  fieldName,
  maximum,
  decimalPlaces: maximumDecimalPlaces,
  minimum = 0,
  inclusiveMinimum = true,
}) {
  const supportedType = typeof value === 'number' || typeof value === 'string'
  const raw = supportedType ? String(value).trim() : ''

  if (!supportedType || !raw) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const negativeSyntax = raw.startsWith('-')
  const validMinimum = inclusiveMinimum ? parsed >= minimum : parsed > minimum
  if (negativeSyntax || !validMinimum) {
    throw new DecimalValidationError(
      inclusiveMinimum
        ? `${fieldName} must be at least ${minimum}`
        : `${fieldName} must be greater than ${minimum}`,
    )
  }

  if (parsed > maximum) {
    throw new DecimalValidationError(`${fieldName} must not exceed ${maximum}`)
  }

  const precision = decimalPlaces(raw)
  if (precision === null || precision > maximumDecimalPlaces) {
    throw new DecimalValidationError(
      `${fieldName} supports up to ${maximumDecimalPlaces} decimal places`,
    )
  }
```
### Consecutive source section 2 of 2

```js

  return parsed
}
```

## C2. Transaction failure and uncertain-commit safeguards

Source file: `server/utils/transactionFailure.js`, lines 1-71

**Purpose and dependencies:** Contains rollback, commit-outcome, and connection-reuse handling used by financial transactions.

### Consecutive source section 1 of 2

```js
// Documentation comment: Contains rollback, commit-outcome, and connection-reuse handling used by financial transactions.
function discardConnection(connection, operation, error, rollbackError = null) {
  try {
    connection?.destroy()
  } catch (disposeError) {
    console.error(`Unable to discard ${operation} database connection`, {
      errorCode: error?.code || 'UNKNOWN',
      rollbackErrorCode: rollbackError?.code || null,
      disposeErrorCode: disposeError?.code || 'UNKNOWN',
    })
  }
}

export async function resolveTransactionFailure({
  connection,
  transactionBeginAttempted = false,
  transactionStarted,
  commitAttempted,
  commitCompleted = false,
  error,
  operation,
  rejectionConfirmed,
}) {
  // A failed BEGIN or unconfirmed COMMIT leaves database state uncertain; do not
  // release that connection back into the pool for unrelated requests.
  if (transactionBeginAttempted && !transactionStarted) {
    console.error(`Unable to start ${operation} transaction`, {
      errorCode: error?.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error)
    return { outcome: 'unknown', reusable: false }
  }

  if (commitAttempted && !commitCompleted) {
    console.error(`Unable to confirm ${operation} transaction commit`, {
      errorCode: error?.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error)
    return { outcome: 'unknown', reusable: false }
  }

  if (commitCompleted) {
    return { outcome: 'unknown', reusable: true }
  }

  let rollbackCompleted = !transactionStarted
  let rollbackError = null
  if (connection && transactionStarted) {
    try {
      await connection.rollback()
      rollbackCompleted = true
    } catch (failure) {
      rollbackError = failure
    }
  }

  if (rollbackError) {
    console.error(`Unable to roll back ${operation} transaction`, {
      errorCode: error?.code || 'UNKNOWN',
      rollbackErrorCode: rollbackError.code || 'UNKNOWN',
    })
```
### Consecutive source section 2 of 2

```js
    discardConnection(connection, operation, error, rollbackError)
    return { outcome: 'unknown', reusable: false }
  }

  return {
    // Only a confirmed rollback plus a known client/business rejection proves that
    // none of this operation's writes committed.
    outcome: rejectionConfirmed && rollbackCompleted ? 'not_committed' : 'unknown',
    reusable: true,
  }
}
```

## C3. MFA challenge lifecycle service

Source file: `server/services/loginMfaService.js`, lines 1-281

**Purpose and dependencies:** Contains rate-limit counters, challenge persistence, OTP consumption, resend, and invalidation behavior.

### Consecutive source section 1 of 5

```js
// Documentation comment: Contains rate-limit counters, challenge persistence, OTP consumption, resend, and invalidation behavior.
import pool from '../config/database.js'
import { environment } from '../config/environment.js'
import {
  createMfaChallengeId,
  createMfaOtp,
  hashMfaChallengeId,
  hashMfaEmail,
  hashMfaOtp,
  hashMfaRateIdentifier,
  verifyMfaOtp,
} from './loginMfaSecurity.js'

const maximumAttempts = 5
const resendCooldownSeconds = 60
const secret = () => process.env.JWT_SECRET || ''

export class LoginMfaError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function newCode() {
  return createMfaOtp(environment.mfa.otpLength)
}

function dateBucket(windowSeconds) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  return new Date(bucket)
}

async function consumeLimit(connection, action, kind, value, maximum, windowSeconds) {
  if (kind === 'ip') {
    await connection.execute(
      `DELETE FROM login_mfa_rate_limits
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
       LIMIT 500`,
    )
  }
  // Store keyed hashes of account/IP identifiers rather than their raw values; the
  // unique scope and time bucket let concurrent requests increment one counter row.
  const hash = hashMfaRateIdentifier(kind, value || '<unknown>', secret())
  const bucketStart = dateBucket(windowSeconds)
  await connection.execute(
    `INSERT INTO login_mfa_rate_limits (action, identifier_kind, identifier_hash, window_started_at, request_count, created_at)
     VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
    [action, kind, hash, bucketStart],
  )
  const [rows] = await connection.execute(
    `SELECT request_count FROM login_mfa_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ? AND window_started_at = ?
     LIMIT 1`,
    [action, kind, hash, bucketStart],
  )
  if (Number(rows[0]?.request_count || 0) > maximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucketStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000))
    throw new LoginMfaError(429, 'Too many sign-in attempts. Please try again later.', retryAfterSeconds)
```
### Consecutive source section 2 of 5

```js
  }
}

async function withTransaction(work) {
  const connection = await pool.getConnection()
  let active = false
  try {
    await connection.beginTransaction()
    active = true
    const result = await work(connection)
    await connection.commit()
    active = false
    return result
  } catch (error) {
    if (active) await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function enforceLoginRateLimits({ username, ipAddress }) {
  return withTransaction(async (connection) => {
    await consumeLimit(connection, 'login', 'ip', ipAddress, 30, 15 * 60)
    await consumeLimit(connection, 'login', 'account', String(username || '').trim().toLowerCase(), 10, 15 * 60)
  })
}

export async function createLoginChallenge(user, ipAddress) {
  const id = createMfaChallengeId()
  const idHash = hashMfaChallengeId(id)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  await withTransaction(async (connection) => {
    // Consume request limits and replace any outstanding challenge atomically, while
    // persisting only hashes of the bearer ID, OTP, and email.
    await consumeLimit(connection, 'challenge', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'challenge', 'account', String(user.user_id), 5, 60 * 60)
    await connection.execute(
      `DELETE FROM login_mfa_challenges
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       LIMIT 500`,
    )
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
       WHERE user_id = ? AND consumed_at IS NULL`,
      [user.user_id],
    )
    await connection.execute(
      `INSERT INTO login_mfa_challenges
         (challenge_hash, user_id, auth_version, email_hash, otp_hash, expires_at, resend_available_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
      [idHash, user.user_id, Number(user.auth_version || 0), hashMfaEmail(user.email, secret()), otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds],
    )
  })
  return {
    challengeId: id,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
```
### Consecutive source section 3 of 5

```js
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}

export async function consumeLoginChallenge({ challengeId, code, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const submittedCode = typeof code === 'string' ? code : ''

  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'verify', 'ip', ipAddress, 60, 15 * 60)
    await consumeLimit(connection, 'verify', 'challenge', idHash.toString('hex'), 15, 15 * 60)
    // Lock this challenge while checking attempts and consuming it so concurrent
    // verifications cannot both turn one OTP into separate authenticated sessions.
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, auth_version, email_hash, otp_hash, expires_at, attempts, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This verification code is invalid or has expired.') }
    }

    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }

    const matches = verifyMfaOtp(challenge.otp_hash, idHash, submittedCode, secret())
    if (!matches) {
      const attempts = Number(challenge.attempts) + 1
      await connection.execute(
        `UPDATE login_mfa_challenges
         SET attempts = ?, consumed_at = IF(? >= ?, UTC_TIMESTAMP(3), consumed_at)
         WHERE challenge_id = ?`,
        [attempts, attempts, maximumAttempts, challenge.challenge_id],
      )
      if (attempts >= maximumAttempts) {
        return { failure: new LoginMfaError(429, 'Maximum verification attempts reached. Return to login to request a new code.') }
      }
      return { failure: new LoginMfaError(400, 'The verification code is incorrect.') }
    }

    // Re-read account state at verification time so deactivation, role/email changes,
    // or a credential-version increment invalidate an already-issued code.
    const [users] = await connection.execute(
      `SELECT user_id, fullname, username, role, is_active, email, email_verified_at, auth_version
       FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user || !user.is_active || !user.email || !user.email_verified_at || !['Admin', 'Staff'].includes(user.role)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
```
### Consecutive source section 4 of 5

```js
      )
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (Number(user.auth_version || 0) !== Number(challenge.auth_version || 0)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account credentials changed. Return to login and try again.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    await connection.execute(
      'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ? AND consumed_at IS NULL',
      [challenge.challenge_id],
    )
    return user
  })
  if (result?.failure) throw result.failure
  return result
}

export async function resendLoginChallenge({ challengeId, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'resend', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'resend', 'challenge', idHash.toString('hex'), 10, 60 * 60)
    // Serialize resend requests on the challenge row and enforce the stored cooldown
    // before rotating the OTP hash and expiry.
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, email_hash, expires_at, resend_available_at, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired,
              resend_available_at <= UTC_TIMESTAMP(3) AS resend_ready,
              GREATEST(1, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), resend_available_at) / 1000000)) AS retry_after
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This login verification request is invalid or has expired.') }
    }
    const [users] = await connection.execute(
      `SELECT email, is_active, email_verified_at FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user?.is_active || !user.email || !user.email_verified_at) {
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
```
### Consecutive source section 5 of 5

```js
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }
    if (!challenge.resend_ready) {
      return { failure: new LoginMfaError(429, 'Please wait before requesting another code.', Number(challenge.retry_after)) }
    }
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET otp_hash = ?, attempts = 0,
           expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
           resend_available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
       WHERE challenge_id = ?`,
      [otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds, challenge.challenge_id],
    )
    return { email: user.email }
  })
  if (result?.failure) throw result.failure
  return {
    ...result,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}

export async function invalidateLoginChallenge(challengeId) {
  await pool.execute(
    `UPDATE login_mfa_challenges
     SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
     WHERE challenge_hash = ?`,
    [hashMfaChallengeId(typeof challengeId === 'string' ? challengeId : '')],
  )
}
```

## C4. MFA challenge and OTP security helpers

Source file: `server/services/loginMfaSecurity.js`, lines 1-32

**Purpose and dependencies:** Contains challenge identifiers, OTP generation and hashes, rate-identifier hashes, and OTP verification.

```js
// Documentation comment: Contains challenge identifiers, OTP generation and hashes, rate-identifier hashes, and OTP verification.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export function createMfaChallengeId() {
  return randomBytes(32).toString('base64url')
}

export function hashMfaChallengeId(challengeId) {
  return createHash('sha256').update(challengeId).digest()
}

export function createMfaOtp(length = 6) {
  return String(randomInt(0, 10 ** length)).padStart(length, '0')
}

export function hashMfaOtp(challengeHash, code, secret) {
  return createHmac('sha256', secret).update(challengeHash).update(':').update(code).digest()
}

export function hashMfaRateIdentifier(kind, value, secret) {
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest()
}

export function hashMfaEmail(email, secret) {
  return hashMfaRateIdentifier('email', String(email || '').trim().toLowerCase(), secret)
}

export function verifyMfaOtp(expectedHash, challengeHash, submittedCode, secret) {
  if (typeof submittedCode !== 'string' || !/^[0-9]{6}$/.test(submittedCode)) return false
  const expected = Buffer.from(expectedHash)
  const actual = hashMfaOtp(challengeHash, submittedCode, secret)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
```

## C5. Session claim matching helpers

Source file: `server/services/authSessionService.js`, lines 1-8

**Purpose and dependencies:** Contains current account-role/version and MFA-claim validation used by authentication middleware.

```js
// Documentation comment: Contains current account-role/version and MFA-claim validation used by authentication middleware.
export function sessionMatchesUser(payload, user) {
  if (!payload || !user || !user.is_active || user.role !== payload.role) return false
  return Number(user.auth_version || 0) === Number(payload.auth_version ?? 0)
}

export function sessionMatchesMfa(payload) {
  return payload?.mfa_verified === true
}
```

## C6. Shared role capability policy

Source file: `shared/permissions.js`, lines 1-27

**Purpose and dependencies:** Contains the Staff capability allow-list and Admin/Staff capability mapping.

```js
// Documentation comment: Contains the Staff capability allow-list and Admin/Staff capability mapping.
export const staffCapabilities = Object.freeze([
  'dashboard.read.operational',
  'pos.sale.create',
  'inventory.read',
  'stockin.read',
  'stockin.create',
  'supplier.read',
  'customer.read',
  'customer.create.pos',
  'customer.balance.read',
  'customer.payment.create',
  'customer.payment.read',
  'report.operational.read',
  'report.operational.export',
])

export function normalizeRole(role) {
  if (role === 'Admin' || role === 'admin') return 'admin'
  if (role === 'Staff' || role === 'employee' || role === 'staff') return 'employee'
  return null
}

export function hasCapability(role, capability) {
  const normalized = normalizeRole(role)
  if (normalized === 'admin') return true
  return normalized === 'employee' && staffCapabilities.includes(capability)
}
```

## C7. Complete idempotency utility module

Source file: `server/utils/idempotency.js`, lines 1-113

**Purpose and dependencies:** Includes idempotency error types, key validation, normalized payload hashing, reservation, persistence, and replay classification.

### Consecutive source section 1 of 2

```js
// Documentation comment: Includes idempotency error types, key validation, normalized payload hashing, reservation, persistence, and replay classification.
import { createHash } from 'node:crypto'

export class IdempotencyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export class IdempotencyKeyConflictError extends IdempotencyError {
  constructor(cause) {
    super(409, 'Idempotency key already exists')
    this.name = 'IdempotencyKeyConflictError'
    this.code = 'IDEMPOTENCY_KEY_CONFLICT'
    this.cause = cause
  }
}

export function getIdempotencyKey(request) {
  const key = request.get('Idempotency-Key')?.trim()
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new IdempotencyError(400, 'A valid Idempotency-Key header is required')
  }
  return key
}

export function hashRequestPayload(payload) {
  // Callers normalize quantities and cents first so equivalent requests hash identically.
  return createHash('sha256').update(JSON.stringify(payload)).digest()
}

function isIdempotencyReservationConflict(error) {
  const databaseMessage = `${error.sqlMessage || ''} ${error.message || ''}`
  return error.code === 'ER_DUP_ENTRY'
    && /\buq_idempotency_user_operation_key\b/i.test(databaseMessage)
}

export async function reserveIdempotencyKey(connection, { userId, operation, key, payloadHash }) {
  try {
    await connection.execute(
      `INSERT INTO idempotency_records
         (user_id, operation_type, idempotency_key, request_hash)
       VALUES (?, ?, ?, ?)`,
      [userId, operation, key, payloadHash],
    )
  } catch (error) {
    // Only the named request-scope index proves this is a retry collision; another
    // unique-key error may belong to business data and must not be replayed.
    if (isIdempotencyReservationConflict(error)) {
      throw new IdempotencyKeyConflictError(error)
    }
    throw error
  }
}

export async function saveIdempotentResponse(connection, {
  userId,
  operation,
  key,
  status,
```
### Consecutive source section 2 of 2

```js
  body,
}) {
  const [result] = await connection.execute(
    `UPDATE idempotency_records
     SET response_status = ?, response_body = ?
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?`,
    [status, JSON.stringify(body), userId, operation, key],
  )

  if (result.affectedRows !== 1) {
    throw new Error('Unable to persist the idempotent transaction result')
  }
}

export async function findIdempotentResponse(executor, { userId, operation, key }) {
  const [records] = await executor.execute(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_records
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?
     LIMIT 1`,
    [userId, operation, key],
  )
  return records[0] || null
}

export async function resolveIdempotencyReplay(executor, idempotency) {
  const record = await findIdempotentResponse(executor, idempotency)
  if (!record) return { kind: 'unverified' }

  try {
    return readIdempotentResponse(record, idempotency.payloadHash)
  } catch {
    return { kind: 'unverified' }
  }
}

export function readIdempotentResponse(record, payloadHash) {
  if (!record) return { kind: 'missing' }
  // A reservation without a response may be in flight or uncertain, not completed.
  if (!record.response_status || !record.response_body) {
    throw new Error('The idempotent transaction result is incomplete')
  }
  // Reusing a key with different normalized input must never return another request's result.
  if (!Buffer.from(record.request_hash).equals(payloadHash)) return { kind: 'payload-mismatch' }

  return {
    kind: 'replay',
    status: Number(record.response_status),
    body: typeof record.response_body === 'string'
      ? JSON.parse(record.response_body)
      : record.response_body,
  }
}
```

## C8. Stock-in business date rules

Source file: `shared/stockInDate.js`, lines 1-89

**Purpose and dependencies:** Contains delivery-date parsing and Manila business-date checks used by stock-in validation.

### Consecutive source section 1 of 2

```js
// Documentation comment: Contains delivery-date parsing and Manila business-date checks used by stock-in validation.
export const STOCK_IN_INVALID_DATE_MESSAGE = 'Delivery date is invalid.'
export const STOCK_IN_FUTURE_DATE_MESSAGE = 'Future stock-in dates are not allowed. Please select today or a previous date.'

const businessTimeZone = 'Asia/Manila'
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/
const zonedDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(?:\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/i

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function calendarDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function datePartsInBusinessTimeZone(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return { year: values.year, month: values.month, day: values.day }
}

export function getBusinessCalendarDate(now = new Date()) {
  const { year, month, day } = datePartsInBusinessTimeZone(now)
  return calendarDate(year, month, day)
}

export function getBusinessDateTimeLocal(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function getStockInCalendarDate(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const localMatch = text.match(localDateTimePattern)
  if (localMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = localMatch
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const hour = Number(hourText || 0)
    const minute = Number(minuteText || 0)
    const second = Number(secondText || 0)
    if (!validDateParts(year, month, day, hour, minute, second)) return null
```
### Consecutive source section 2 of 2

```js
    return calendarDate(year, month, day)
  }

  const zonedMatch = text.match(zonedDateTimePattern)
  if (!zonedMatch) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = zonedMatch
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText || 0)
  if (!validDateParts(year, month, day, hour, minute, second)) return null

  if (zone.toUpperCase() !== 'Z') {
    const [offsetHours, offsetMinutes] = zone.slice(1).split(':').map(Number)
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null
  }

  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) return null
  const businessDate = datePartsInBusinessTimeZone(instant)
  return calendarDate(businessDate.year, businessDate.month, businessDate.day)
}

export function isStockInDateAllowed(value, now = new Date()) {
  const submittedDate = getStockInCalendarDate(value)
  return submittedDate !== null && submittedDate <= getBusinessCalendarDate(now)
}
```

## C9. Request IP extraction

Source file: `server/utils/requestIp.js`, lines 1-3

**Purpose and dependencies:** Contains the client-address normalization helper used by authentication rate limits.

```js
// Documentation comment: Contains the client-address normalization helper used by authentication rate limits.
export function getRequestIp(request) {
  return request.ip || request.socket?.remoteAddress || '<unknown>'
}
```

## C10. Manila date-time conversion

Source file: `server/utils/manilaDateTime.js`, lines 1-23

**Purpose and dependencies:** Contains the timestamp conversion helper used when persisting payment dates.

```js
// Documentation comment: Contains the timestamp conversion helper used when persisting payment dates.
const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

// Business DATETIME columns are Manila wall time, with no timezone attached.
// Convert instants before binding so storage does not depend on server timezone.
export function toManilaDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date value')
  const parts = Object.fromEntries(
    manilaFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}
```

## C11. Password reset lifecycle service

Source file: `server/services/passwordResetService.js`, lines 1-231

**Purpose and dependencies:** Contains reset-token issue, rate-limit, invalidation, and completion helpers used by password changes.

### Consecutive source section 1 of 4

```js
// Documentation comment: Contains reset-token issue, rate-limit, invalidation, and completion helpers used by password changes.
import bcrypt from 'bcrypt'
import { timingSafeEqual } from 'node:crypto'
import pool from '../config/database.js'
import {
  createResetToken,
  hashRateLimitIdentifier,
  hashResetToken,
  normalizeResetEmail,
  validateNewPassword,
} from './passwordResetSecurity.js'

const resetLifetimeMilliseconds = 15 * 60 * 1000
const requestCooldownMilliseconds = 60 * 1000
const maximumRequestsPerEmailPerHour = 5
const maximumRequestsPerIpPerHour = 20
const maximumAttemptsPerTokenPerHour = 5
const maximumAttemptsPerIpPerHour = 30
const supportedRoles = ['Admin', 'Staff']

export const passwordResetConfirmation = "If this email is registered, we'll send a password reset link."

export class PasswordResetError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function rateHash(kind, value) {
  return hashRateLimitIdentifier(kind, value, process.env.JWT_SECRET)
}

async function recordRateEvent(executor, action, kind, identifierHash) {
  await executor.execute(
    `INSERT INTO password_reset_rate_limits (action, identifier_kind, identifier_hash)
     VALUES (?, ?, ?)`,
    [action, kind, identifierHash],
  )
}

async function countRecentEvents(executor, action, kind, identifierHash) {
  const [rows] = await executor.execute(
    `SELECT COUNT(*) AS total, MAX(created_at) AS latest
     FROM password_reset_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ?
       AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)`,
    [action, kind, identifierHash],
  )
  return { total: Number(rows[0]?.total || 0), latest: rows[0]?.latest || null }
}

async function pruneOldRateEvents(executor) {
  await executor.execute(
    `DELETE FROM password_reset_rate_limits
     WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
     LIMIT 500`,
  )
}

```
### Consecutive source section 2 of 4

```js
export async function invalidatePasswordResetTokens(executor, userId) {
  await executor.execute(
    `UPDATE password_reset_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  )
}

export async function preparePasswordReset(emailValue, ipAddress) {
  const email = normalizeResetEmail(emailValue)
  const emailHash = rateHash('email', email || '<invalid>')
  const ipHash = rateHash('ip', ipAddress || '<unknown>')
  let connection

  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await pruneOldRateEvents(connection)

    const emailRate = await countRecentEvents(connection, 'request', 'email', emailHash)
    const ipRate = await countRecentEvents(connection, 'request', 'ip', ipHash)

    await recordRateEvent(connection, 'request', 'email', emailHash)
    await recordRateEvent(connection, 'request', 'ip', ipHash)

    const latestRequestTime = emailRate.latest ? new Date(emailRate.latest).getTime() : 0
    const coolingDown = latestRequestTime && Date.now() - latestRequestTime < requestCooldownMilliseconds
    const limited = coolingDown
      || emailRate.total >= maximumRequestsPerEmailPerHour
      || ipRate.total >= maximumRequestsPerIpPerHour

    if (limited || !email || email.length > 254) {
      await connection.commit()
      return null
    }

    const [users] = await connection.execute(
      `SELECT user_id, email, role
       FROM users
       WHERE email = ? AND email_verified_at IS NOT NULL AND is_active = TRUE
         AND role IN ('Admin', 'Staff')
       LIMIT 1
       FOR UPDATE`,
      [email],
    )
    const user = users[0]

    if (!user || !supportedRoles.includes(user.role)) {
      await connection.commit()
      return null
    }

    await invalidatePasswordResetTokens(connection, user.user_id)
    const token = createResetToken()
    const expiresAt = new Date(Date.now() + resetLifetimeMilliseconds)
    const [result] = await connection.execute(
      `INSERT INTO password_reset_tokens (user_id, token_hash, email_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [user.user_id, hashResetToken(token), hashResetToken(user.email), expiresAt],
```
### Consecutive source section 3 of 4

```js
    )

    await connection.commit()
    return { email: user.email, token, resetId: result.insertId }
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}

export async function revokePasswordResetToken(resetId) {
  await pool.execute(
    `UPDATE password_reset_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE reset_id = ?`,
    [resetId],
  )
}

export async function completePasswordReset(token, passwordValue, ipAddress) {
  const rawToken = typeof token === 'string' ? token : ''
  const tokenHash = hashResetToken(rawToken)
  const ipHash = rateHash('ip', ipAddress || '<unknown>')
  let connection

  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await pruneOldRateEvents(connection)

    const tokenRate = await countRecentEvents(connection, 'attempt', 'token', tokenHash)
    const ipRate = await countRecentEvents(connection, 'attempt', 'ip', ipHash)
    await recordRateEvent(connection, 'attempt', 'token', tokenHash)
    await recordRateEvent(connection, 'attempt', 'ip', ipHash)

    if (tokenRate.total >= maximumAttemptsPerTokenPerHour || ipRate.total >= maximumAttemptsPerIpPerHour) {
      await connection.commit()
      throw new PasswordResetError(429, 'Too many password reset attempts. Try again later.', 3600)
    }

    await connection.commit()

    if (rawToken.length < 40 || rawToken.length > 128) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    let password
    try {
      password = validateNewPassword(passwordValue)
    } catch (error) {
      throw new PasswordResetError(400, error.message)
    }

    await connection.beginTransaction()

    const [tokens] = await connection.execute(
      `SELECT reset_id, user_id, email_hash, expires_at, used_at
       FROM password_reset_tokens
```
### Consecutive source section 4 of 4

```js
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    )
    const reset = tokens[0]

    if (!reset || reset.used_at || new Date(reset.expires_at).getTime() <= Date.now()) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    const [users] = await connection.execute(
      `SELECT user_id, role, is_active, email, email_verified_at
       FROM users
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [reset.user_id],
    )
    const user = users[0]

    const currentEmailHash = user?.email ? hashResetToken(user.email) : null
    const emailMatches = currentEmailHash
      && currentEmailHash.length === reset.email_hash.length
      && timingSafeEqual(currentEmailHash, reset.email_hash)

    if (!user || !user.is_active || !user.email_verified_at || !supportedRoles.includes(user.role) || !emailMatches) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await connection.execute(
      `UPDATE users
       SET password = ?, auth_version = auth_version + 1
       WHERE user_id = ?`,
      [passwordHash, user.user_id],
    )
    await invalidatePasswordResetTokens(connection, user.user_id)
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'USER_PASSWORD_RESET', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `Password reset completed for user ${user.user_id}`],
    )
    await connection.commit()
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}
```

## C12. Email verification token lifecycle service

Source file: `server/services/emailVerificationService.js`, lines 1-144

**Purpose and dependencies:** Contains account email verification token issuance, invalidation, and completion used by account administration.

### Consecutive source section 1 of 3

```js
// Documentation comment: Contains account email verification token issuance, invalidation, and completion used by account administration.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import pool from '../config/database.js'

const tokenLifetimeMilliseconds = 24 * 60 * 60 * 1000
const resendCooldownMilliseconds = 60 * 1000
const maximumEmailsPerHour = 5
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class EmailVerificationError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function normalizeRecoveryEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email || null
}

export function validateRecoveryEmail(email) {
  if (!email) return
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new EmailVerificationError(400, 'Enter a valid recovery email address')
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest()
}

export async function invalidateEmailVerificationTokens(executor, userId) {
  await executor.execute(
    `UPDATE email_verification_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  )
}

export async function issueEmailVerificationToken(executor, userId, email) {
  const [recentTokens] = await executor.execute(
    `SELECT created_at
     FROM email_verification_tokens
     WHERE user_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
     ORDER BY created_at DESC`,
    [userId],
  )

  if (recentTokens.length >= maximumEmailsPerHour) {
    throw new EmailVerificationError(429, 'Too many verification emails were requested. Try again later.')
  }

  if (recentTokens[0]) {
    const elapsed = Date.now() - new Date(recentTokens[0].created_at).getTime()
    if (elapsed < resendCooldownMilliseconds) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resendCooldownMilliseconds - elapsed) / 1000))
      throw new EmailVerificationError(429, 'Please wait before sending another verification email.', retryAfterSeconds)
```
### Consecutive source section 2 of 3

```js
    }
  }

  await invalidateEmailVerificationTokens(executor, userId)

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + tokenLifetimeMilliseconds)
  const [result] = await executor.execute(
    `INSERT INTO email_verification_tokens (user_id, token_hash, email_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, hash(token), hash(email), expiresAt],
  )

  return { token, verificationId: result.insertId }
}

export async function completeEmailVerification(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 128) {
    throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
  }

  let connection
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [tokens] = await connection.execute(
      `SELECT verification_id, user_id, email_hash, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [hash(token)],
    )
    const verification = tokens[0]

    if (!verification || verification.used_at || new Date(verification.expires_at).getTime() <= Date.now()) {
      throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
    }

    const [users] = await connection.execute(
      'SELECT user_id, email FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [verification.user_id],
    )
    const user = users[0]
    const currentEmailHash = user?.email ? hash(user.email) : null

    if (!currentEmailHash || !timingSafeEqual(currentEmailHash, verification.email_hash)) {
      throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
    }

    await connection.execute(
      'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP(3) WHERE user_id = ?',
      [user.user_id],
    )
    await connection.execute(
      `UPDATE email_verification_tokens
       SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
       WHERE user_id = ? AND used_at IS NULL`,
      [user.user_id],
```
### Consecutive source section 3 of 3

```js
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'USER_EMAIL_VERIFIED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `Recovery email verified for user ${user.user_id}`],
    )
    await connection.commit()
    return { userId: user.user_id }
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}

export async function revokeEmailVerificationToken(verificationId) {
  await pool.execute(
    `UPDATE email_verification_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE verification_id = ?`,
    [verificationId],
  )
}
```

## C13. Email delivery service

Source file: `server/services/emailDeliveryService.js`, lines 1-188

**Purpose and dependencies:** Contains delivery configuration and MFA, reset, and verification message dispatch functions.

### Consecutive source section 1 of 4

```js
// Documentation comment: Contains delivery configuration and MFA, reset, and verification message dispatch functions.
import nodemailer from 'nodemailer'
import { environment } from '../config/environment.js'

const senderName = 'LCP Dressed Chicken Trading'
const safeSmtpCommands = new Set(['CONN', 'CONNECT', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'])

function getEmailErrorDiagnostic(error, operation) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : undefined
  const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : undefined
  const command = typeof error?.command === 'string' && safeSmtpCommands.has(error.command.toUpperCase())
    ? error.command.toUpperCase()
    : undefined
  let category = 'delivery'

  if (error?.message === 'Email delivery is not configured' || error?.message === 'Gmail MFA delivery is not configured') category = 'configuration'
  else if (code === 'EAUTH') category = 'authentication'
  else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') category = 'timeout'
  else if (code && ['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EDNS'].includes(code)) category = 'connection'
  else if (responseCode >= 500) category = 'smtp_rejected'
  else if (responseCode >= 400) category = 'smtp_temporary'

  return { operation, category, ...(code ? { code } : {}), ...(responseCode ? { responseCode } : {}), ...(command ? { command } : {}) }
}

function logEmailDeliveryFailure(logger, error, operation) {
  try {
    logger.error('Email delivery failed', getEmailErrorDiagnostic(error, operation))
  } catch {
    // Diagnostics must never replace the generic delivery error.
  }
}

function requireEmailConfiguration(smtp, frontendUrl) {
  if (!smtp.host || !smtp.user || !smtp.appPassword || !smtp.fromEmail || !frontendUrl) {
    throw new Error('Email delivery is not configured')
  }
}

export function createSmtpTransportOptions(smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: {
      user: smtp.user,
      pass: smtp.appPassword,
    },
    tls: {
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  }
}

export function resolveMfaSmtpConfig(smtp) {
```
### Consecutive source section 2 of 4

```js
  if (
    smtp.host?.trim().toLowerCase() === 'smtp.gmail.com' &&
    smtp.user &&
    smtp.appPassword &&
    smtp.fromEmail
  ) {
    return {
      host: 'smtp.gmail.com',
      port: smtp.port,
      user: smtp.user,
      appPassword: smtp.appPassword.replace(/\s/g, ''),
      fromEmail: smtp.fromEmail,
    }
  }

  throw new Error('Gmail MFA delivery is not configured')
}

export function createEmailDelivery({ transporter, frontendUrl, fromEmail, logger = console }) {
  const from = { name: senderName, address: fromEmail }

  async function deliver(message, failureMessage, operation) {
    try {
      await transporter.sendMail({
        ...message,
        from,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    } catch (error) {
      logEmailDeliveryFailure(logger, error, operation)
      // Do not attach the provider error: it can contain SMTP details or secrets.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(failureMessage)
    }
  }

  return {
    async sendEmailVerification({ email, token }) {
      const verificationUrl = new URL('/verify-email', frontendUrl)
      verificationUrl.hash = new URLSearchParams({ token }).toString()
      const link = verificationUrl.toString()

      await deliver({
        to: email,
        subject: 'Verify your LCP recovery email',
        text: `Verify this email for your LCP account:\n\n${link}\n\nThis link expires in 24 hours. If you did not expect this email, you can ignore it.`,
        html: `<p>Verify this email for your LCP account.</p><p><a href="${link}">Verify recovery email</a></p><p>This link expires in 24 hours. If you did not expect this email, you can ignore it.</p>`,
      }, 'Verification email could not be sent', 'recovery_email_verification')
    },

    async sendPasswordReset({ email, token }) {
      const resetUrl = new URL('/reset-password', frontendUrl)
      resetUrl.hash = new URLSearchParams({ token }).toString()
      const link = resetUrl.toString()

      await deliver({
        to: email,
        subject: 'Reset your LCP account password',
        text: `Use this link to reset your LCP account password:\n\n${link}\n\nThis link expires in 15 minutes. If you did not request this change, you can ignore this email.`,
```
### Consecutive source section 3 of 4

```js
        html: `<p>Use this link to reset your LCP account password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 15 minutes. If you did not request this change, you can ignore this email.</p>`,
      }, 'Password reset email could not be sent', 'password_reset')
    },

    async sendLoginMfaCode({ email, code, expiryMinutes = 5 }) {
      await deliver({
        to: email,
        subject: 'LCP Dressed Chicken Trading — Login Verification Code',
        text: `Your LCP login verification code is ${code}.\n\nIt expires in ${expiryMinutes} minutes. Do not share this code with anyone. If you did not initiate this login, you can ignore this email and consider changing your password.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937"><h2 style="color:#163832">LCP Dressed Chicken Trading</h2><p>Use this code to finish signing in:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#163832">${code}</p><p>This code expires in ${expiryMinutes} minutes. Do not share it with anyone.</p><p>If you did not initiate this login, you can ignore this email and consider changing your password.</p></div>`,
      }, 'Login verification email could not be sent', 'login_mfa')
    },
  }
}

let emailDelivery

function getEmailDelivery() {
  if (!emailDelivery) {
    try {
      requireEmailConfiguration(environment.smtp, environment.frontendUrl)
      emailDelivery = createEmailDelivery({
        transporter: nodemailer.createTransport(createSmtpTransportOptions(environment.smtp)),
        frontendUrl: environment.frontendUrl,
        fromEmail: environment.smtp.fromEmail,
      })
    } catch (error) {
      logEmailDeliveryFailure(console, error, 'email_delivery_setup')
      // Do not attach initialization errors because they may contain credential details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Email delivery is not configured')
    }
  }
  return emailDelivery
}

export async function sendEmailVerification(details) {
  return getEmailDelivery().sendEmailVerification(details)
}

export async function sendPasswordReset(details) {
  return getEmailDelivery().sendPasswordReset(details)
}

let mfaEmailDelivery

function getMfaEmailDelivery() {
  if (!mfaEmailDelivery) {
    try {
      const gmailSmtp = resolveMfaSmtpConfig(environment.smtp)
      mfaEmailDelivery = createEmailDelivery({
        transporter: nodemailer.createTransport(createSmtpTransportOptions(gmailSmtp)),
        frontendUrl: environment.frontendUrl,
        fromEmail: gmailSmtp.fromEmail,
      })
    } catch (error) {
      logEmailDeliveryFailure(console, error, 'login_mfa_setup')
      // Do not attach initialization errors because they may contain credential details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Login verification email could not be sent')
```
### Consecutive source section 4 of 4

```js
    }
  }
  return mfaEmailDelivery
}

export async function sendLoginMfaCode(details) {
  return getMfaEmailDelivery().sendLoginMfaCode(details)
}
```

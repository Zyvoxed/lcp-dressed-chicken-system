# Top Algorithms for the LCP Capstone Defense

Prepared from repository source on 2026-11-23. Comments below explain existing behavior and are added to documentation excerpts only. Source line references point to the inspected working tree. No tests were executed for this audit; source excerpts are not evidence of runtime success.

## Completeness Verification

The full function bodies for each defense algorithm are included in Appendix A. “Verified against source” means the documentation contains a text-identical copy of the current function body, checked after extraction; documentation-only comments are prefixed to those copies. It does not mean runtime behavior was tested.

| Algorithm | Source File | Full Code Included | Comments Added | Verified Against Source |
|---|---|---:|---:|---:|
| FIFO stock selection and allocation | `server/controllers/salesController.js` | Yes — A1 | Yes | Yes — function bodies compared with current source |
| Transactional sale creation | `server/controllers/salesController.js` | Yes — A2 | Yes | Yes — function bodies compared with current source |
| Sale payment status calculation | `server/controllers/salesController.js` | Yes — A2 | Yes | Yes — function bodies compared with current source |
| Sale item and FIFO persistence | `server/controllers/salesController.js` | Yes — A1–A2 | Yes | Yes — function bodies compared with current source |
| Inventory status calculation | `server/controllers/stockInController.js` | Yes — A3 | Yes | Yes — function bodies compared with current source |
| Atomic stock-in processing | `server/controllers/stockInController.js` | Yes — A3 | Yes | Yes — function bodies compared with current source |
| Credit payment validation/calculation | `server/controllers/paymentController.js` | Yes — A4 | Yes | Yes — function bodies compared with current source |
| Atomic payment recording | `server/controllers/paymentController.js` | Yes — A4 | Yes | Yes — function bodies compared with current source |
| Integer-cent money calculations | `server/utils/money.js` | Yes — A5 | Yes | Yes — function bodies compared with current source |
| Idempotency reservation and replay | `server/utils/idempotency.js` | Yes — A6 | Yes | Yes — function bodies compared with current source |
| Authentication and authorization | `server/controllers/authController.js`, `server/middleware/authenticate.js`, `server/middleware/authorizeRoles.js` | Yes — A7–A9 | Yes | Yes — function bodies compared with current source |
| Report filtering and aggregation | `server/controllers/reportController.js` | Yes — A10 | Yes | Yes — function bodies compared with current source |
| Inventory status synchronization | `server/controllers/salesController.js`, `server/controllers/stockInController.js` | Yes — A2–A3 | Yes | Yes — function bodies compared with current source |
| Dashboard product ranking | `server/controllers/dashboardController.js` | Yes — A12 | Yes | Yes — function bodies compared with current source |
| Password reset and session invalidation | `server/controllers/userController.js` | Yes — A13 | Yes | Yes — function bodies compared with current source |

## 1. FIFO Allocation Across Stock-In Batches

Module: Point of Sale (Admin and Staff)<br>
Source File: `server/controllers/salesController.js`<br>
Function: `calculateFifoAllocations` (lines 88–99), supported by `lockEligibleStockBatches` (71–80)<br>
Importance: CRITICAL

### Source Code

```js
async function lockEligibleStockBatches(connection, productId) {
  // Select only batches that still contain stock, oldest delivery first.
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

function calculateFifoAllocations(batches, requestedQuantity) {
  let quantityRemaining = requestedQuantity
  const allocations = []
  // Batches are already ordered by delivery date and ID by the database query.
  for (const batch of batches) {
    if (quantityRemaining <= 0) break
    // Take the smaller of the outstanding sale quantity and this batch's balance.
    const deduction = Math.min(quantityRemaining, Number(batch.remaining_quantity))
    allocations.push({ batch, quantity: deduction.toFixed(3) })
    // Keep arithmetic aligned with the persisted three-decimal quantity scale.
    quantityRemaining = Number((quantityRemaining - deduction).toFixed(3))
  }
  return allocations
}
```

Inputs are the ordered, locked stock batches and the validated requested quantity. Output is an array of `{ batch, quantity }` allocations. Each item gets at most the batch's remaining balance. The caller checks aggregate batch availability in `prepareSaleItems` before persisting. Business significance: the oldest received stock is consumed first, while batch cost and delivery provenance remain available for audit. Defense question: “What happens when a sale spans batches?” Answer: the loop consumes the oldest batch's available balance, then continues until the request is fulfilled or batches run out; insufficient availability is rejected by the caller.

## 2. Transactional Sale Creation

Module: Point of Sale<br>
Source File: `server/controllers/salesController.js`<br>
Function: `createSale` (lines 267–410)<br>
Importance: CRITICAL

### Source Code

The complete `createSale` body and its controller-local helpers are included in Appendix A, A2. The following explanation describes the same code; it is not a substitute for the complete implementation. The transaction sequence is: normalize request; begin transaction; reserve key; lock customer/product/batches; compute totals; insert sale; insert items and deductions; update credit balance; insert activity; store replay response; commit. Error handling distinguishes confirmed rejection, key collision/replay, and unknown commit outcome.

Inputs: authenticated request containing payment type, amount paid, items, optional customer ID, and idempotency header. Output: success response with sale ID, total, amount paid, remaining balance, and status, or an explicit error/unknown-outcome response. Business significance: this is the principal operation that links revenue, inventory, receivables, audit activity, and duplicate-request recovery. Defense question: “Why store the idempotent response before commit?” Answer: the response record commits with the sale, allowing a matching retry to recover the committed result after a lost response.

## 3. Sale Payment Status Calculation

Module: Point of Sale<br>
Source File: `server/controllers/salesController.js`<br>
Function: `calculateSaleAmounts` (lines 209–225)<br>
Importance: CRITICAL

### Source Code

```js
function calculateSaleAmounts(paymentType, totalCents, amountPaidCents) {
  // Prevent a transaction from receiving more than the calculated total.
  if (amountPaidCents > totalCents) {
    throw new SaleError(400, 'Amount paid cannot exceed the sale total')
  }
  // Cash sales are only accepted when fully covered at creation time.
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

Inputs: payment type, total cents, paid cents. Output: remaining cents, status, and decimal strings for storage/response. Business significance: a credit sale can be unpaid or partially paid, but a cash sale must be paid in full. Defense question: “Can amount paid exceed the sale total?” Answer: no; this function rejects it before persistence.

## 4. Transaction-Safe Sale Item and FIFO Persistence

Module: Point of Sale<br>
Source File: `server/controllers/salesController.js`<br>
Function: `persistSaleItems` (lines 227–251), with `persistFifoAllocations` (104–117)<br>
Importance: CRITICAL

### Source Code

```js
async function persistSaleItems(connection, saleId, preparedItems) {
  for (const item of preparedItems) {
    // Store values at the application's quantity and money scales.
    const quantity = item.quantity.toFixed(3)
    const price = centsToAmount(item.priceCents)
    const subtotal = centsToAmount(item.subtotalCents)
    const [itemResult] = await connection.execute(
      `INSERT INTO sales_items (sale_id, product_id, quantity, price, subtotal)
       VALUES (?, ?, ?, ?, ?)`,
      [saleId, item.productId, quantity, price, subtotal],
    )
    // Allocate the line quantity to oldest batches, then persist deductions and allocation history.
    const allocations = calculateFifoAllocations(item.batches, item.quantity)
    await persistFifoAllocations(connection, itemResult.insertId, allocations)
    // Keep aggregate product stock aligned with the detailed batch balances.
    await connection.execute('UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?',
      [quantity, item.productId])
    const newStock = Number(item.product.stock_quantity) - item.quantity
    const reorderLevel = Number(item.product.reorder_level)
    const productStatus = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
    await connection.execute('UPDATE products SET status = ? WHERE product_id = ?', [productStatus, item.productId])
  }
}
```

Inputs: transaction connection, sale ID, prepared products with prices, batches and validated quantities. Output: none; updates sales item, batch, allocation and product rows. Business significance: maintains both batch-level and aggregate stock records. Defense question: “Why are these updates inside the sale transaction?” Answer: any failure must roll back all records together, or inventory and sales history could diverge. Note: the full helper `persistFifoAllocations` is a dependency and updates each batch and inserts its allocation record.

## 5. Stock-In Status and Capacity Check

Module: Inventory and Stock In<br>
Source File: `server/controllers/stockInController.js`<br>
Function: `calculateInventoryStatus` (lines 125–134)<br>
Importance: CRITICAL

### Source Code

```js
function calculateInventoryStatus(product, quantityReceived) {
  // Calculate projected stock after adding this delivery to the locked product balance.
  const newStock = Number(product.stock_quantity) + quantityReceived
  if (!Number.isFinite(newStock) || newStock > decimalLimits.quantity) {
    throw new RequestError(400, `Resulting product stock must not exceed ${decimalLimits.quantity}`)
  }
  const reorderLevel = Number(product.reorder_level)
  // Apply the configured status thresholds to the projected stock.
  const status = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
  return status
}
```

Inputs: locked product record and validated delivery quantity. Output: `Out of Stock`, `Low Stock`, or `Available`; oversized resulting quantity is rejected. Business significance: the stock-in path updates status at the same time it increases inventory. Defense question: “Which value triggers Low Stock?” Answer: projected quantity is positive and less than or equal to the product's reorder level.

## 6. Atomic Stock-In Processing

Module: Inventory and Stock In<br>
Source File: `server/controllers/stockInController.js`<br>
Function: `createStockIn` (lines 194–297)<br>
Importance: CRITICAL

### Source Code

The complete `createStockIn` body and controller-local dependencies are included in Appendix A, A3. Its transaction writes the stock batch, product aggregate quantity and status, activity log, and replay response before commit. It rejects an inactive supplier/product and handles matching retries, payload mismatch, and unknown commit outcome.

Inputs: authenticated delivery request with supplier, product, quantity, cost, delivery date, and idempotency key. Output: stock-in ID and recorded batch amounts. Business significance: records receiving provenance and updates stock as one database transaction. Defense question: “How does the system prevent a retry from receiving stock twice?” Answer: it reserves a key unique to user and operation, hashes normalized payload, and replays the saved response on a matching completed request.

## 7. Customer Credit Payment Calculation

Module: Customer Credits and Payments<br>
Source File: `server/controllers/paymentController.js`<br>
Function: `validateSaleOutstanding`, `calculatePaymentAmounts` (lines 74–100)<br>
Importance: CRITICAL

### Source Code

```js
function validateSaleOutstanding(sale, paymentCents) {
  // Convert stored decimal balance to integer cents before comparing.
  const outstandingCents = toCents(sale.remaining_balance)
  if (outstandingCents <= 0n) throw new PaymentError(400, 'This sale is already fully paid')
  if (paymentCents > outstandingCents) throw new PaymentError(400, 'Payment exceeds the outstanding balance')
  return outstandingCents
}

function calculatePaymentAmounts(sale, outstandingCents, paymentCents) {
  // Increase cumulative paid amount and subtract this payment from the outstanding amount.
  const newPaid = centsToAmount(toCents(sale.amount_paid) + paymentCents)
  const newRemainingCents = outstandingCents - paymentCents
  const newRemaining = centsToAmount(newRemainingCents)
  const paymentValue = centsToAmount(paymentCents)
  // Mark Paid only after the remaining amount reaches zero.
  const status = newRemainingCents === 0n ? 'Paid' : 'Partially Paid'
  return { newPaid, newRemaining, paymentValue, status }
}
```

Inputs: locked sale, outstanding cents, submitted payment cents. Output: new cumulative payment, remaining amount, payment value, and status. The caller also locks the customer row and prevents payment beyond the customer's balance. Defense question: “How is full payment distinguished from a partial payment?” Answer: the remaining amount is subtracted in cents, and status becomes Paid only when it equals zero.

## 8. Atomic Payment Recording

Module: Customer Credits and Payments<br>
Source File: `server/controllers/paymentController.js`<br>
Function: `recordPayment` (lines 140–248)<br>
Importance: CRITICAL

### Source Code

The complete `recordPayment` body and controller-local dependencies are included in Appendix A, A4. The transaction validates and hashes the request, reserves the idempotency key, locks the sale and customer, computes balances, updates sale/customer records, inserts payment and activity rows, saves the replay response, and commits. On key collision it returns a stored matching response or reports mismatch/uncertainty.

Inputs: authenticated sale ID, positive payment amount to two decimals, idempotency header. Output: payment ID, new remaining amount, and status. Business significance: protects the sale-level and customer-level credit ledgers from partial writes. Defense question: “How are concurrent payments serialized?” Answer: each transaction locks the sale row first, then the customer row, and calculates from the locked outstanding amount. This is based on source behavior; no concurrency test was run here.

## 9. Integer-Cent Line Total

Module: Shared transaction money utilities<br>
Source File: `server/utils/money.js`<br>
Function: `toCents`, `toThousandths`, `lineTotalCents`, `centsToAmount` (lines 1–31)<br>
Importance: CRITICAL

### Source Code

```js
function toScaledInteger(value, scale, errorMessage) {
  // Convert to a scaled safe integer before constructing BigInt.
  const scaled = Math.round(Number(value) * scale)
  if (!Number.isSafeInteger(scaled)) throw new RangeError(errorMessage)
  return BigInt(scaled)
}

export function toCents(value) {
  return toScaledInteger(value, 100, 'Monetary value exceeds safe integer precision')
}
export function toThousandths(value) {
  return toScaledInteger(value, 1000, 'Quantity exceeds safe integer precision')
}
export function lineTotalCents(quantity, unitPrice) {
  // Multiply quantity-thousandths by price-cents and round the result half-up to cents.
  const product = toThousandths(quantity) * toCents(unitPrice)
  const rounded = (product + 500n) / 1000n
  return rounded
}
export function centsToAmount(cents) {
  // Format whole and fractional cents separately to avoid a floating-point conversion.
  const value = BigInt(cents)
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const whole = absolute / 100n
  const fractional = String(absolute % 100n).padStart(2, '0')
  return `${sign}${whole}.${fractional}`
}
```

Inputs: a validated decimal quantity and unit price. Output: exact integer cents for a line and a fixed two-decimal string for storage/response. Business significance: avoids accumulating monetary totals as floating-point values. Defense question: “Where is rounding applied?” Answer: separately per line, to the nearest cent using half-up arithmetic, before line totals are summed.

## 10. Idempotency Replay Decision

Module: Shared transaction safeguards<br>
Source File: `server/utils/idempotency.js`<br>
Function: `readIdempotentResponse` (lines 97–110)<br>
Importance: CRITICAL

### Source Code

```js
export function readIdempotentResponse(record, payloadHash) {
  if (!record) return { kind: 'missing' }
  // A row without a saved response does not prove the operation completed.
  if (!record.response_status || !record.response_body) {
    throw new Error('The idempotent transaction result is incomplete')
  }
  // A key may replay only when the normalized request payload matches the original.
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

Inputs: stored idempotency record and SHA-256 hash of the normalized request. Output: missing, payload mismatch, or saved response replay; incomplete records throw and are treated as unverified by the caller. Business significance: makes client retries safe after a response is lost without allowing a different request to reuse the same key. Defense question: “What if a key is reused for a different payload?” Answer: the server returns a payload-mismatch outcome rather than the prior response.

## 11. Authentication and Authorization

Module: System access control<br>
Source File: `server/controllers/authController.js`, `server/middleware/authenticate.js`, `server/middleware/authorizeRoles.js`<br>
Functions: `login`, `verifyLoginMfa`, `authenticate`, `authorizeRoles`, `authorizeCapability`<br>
Importance: CRITICAL

### Source Code

The complete functions are included in Appendix A, A7–A9: `login`, `verifyLoginMfa`, `authenticate`, `authorizeRoles`, and `authorizeCapability`. The flow checks a password with bcrypt, requires a verified email and an MFA challenge, then issues an eight-hour JWT. Middleware verifies signature/expiry and compares current database role, active state, and `auth_version`, while requiring the MFA claim. Route middleware then applies explicit Admin/Staff role or capability checks.

Inputs: credentials, MFA challenge/code, then bearer token. Outputs: challenge, signed JWT, or authentication/authorization rejection. Business significance: protects all role-specific features and sensitive financial operations. Defense question: “How does a password reset affect old tokens?” Answer: Admin password reset increments `auth_version`; middleware compares this claim to current DB state and rejects older sessions. Audit point: logout only records activity; it does not itself revoke a JWT.

## 12. Report Filtering and Aggregation

Module: Admin and Staff reports<br>
Source File: `server/controllers/reportController.js`<br>
Functions: `salesFilters`, `pagination`, `getSalesReport`, `getInventoryReport`, `getReceivablesReport`, `getProductSalesReport`<br>
Importance: IMPORTANT

### Source Code

The complete report helper and handler functions are included in Appendix A, A10. The report code validates dates and filter values, uses SQL placeholders for values, applies bounded pagination, and calculates summary totals. Inventory cost valuation uses remaining batch quantity × batch cost. Receivables rows show customers with positive balances and open credit-sale metrics. Product sales aggregates quantity and subtotal by month. Audit point for defense: report summary and record queries are separate reads; concurrent changes can make them reflect slightly different database snapshots. In the receivables result, `total_original_credit_amount` is the sum of original totals for still-open sales, whereas the current receivable headline is based on customer balances.

Input/output: query filters and page parameters produce report rows and summary objects. Business significance: supports financial review and operational decisions. Defense question: “How does the report include the whole end date?” Answer: it applies an exclusive bound at the next day, so all times on the selected end date are included.

## 13. Inventory Status Synchronization

Module: Inventory and Point of Sale<br>
Source Files: `server/controllers/stockInController.js`, `server/controllers/salesController.js`<br>
Functions: `calculateInventoryStatus`, product status update inside `persistSaleItems`<br>
Importance: CRITICAL

Both stock-in and sales paths derive status using the same policy: zero or less means Out of Stock; positive stock at or below reorder level means Low Stock; otherwise Available. Stock-in status is calculated before its atomic updates, while sales calculates status from the locked product value minus sold quantity. Business significance: makes the aggregate stock quantity and displayed restock status respond to deliveries and sales. Defense question: “Is the status calculated from batches?” Answer: the status calculation uses aggregate product stock and reorder level; sale preparation separately checks FIFO batch availability.

## 14. Dashboard Product Ranking

Module: Admin Dashboard<br>
Source File: `server/controllers/dashboardController.js`<br>
Function: `rankBusinessProducts` (lines 256–297)<br>
Importance: IMPORTANT

```js
export function rankBusinessProducts(products) {
  // Work on a copy so the caller's array order is not changed.
  const ranked = [...products].sort((left, right) => {
    const amountDifference = Number(right.total_sales) - Number(left.total_sales)
    return amountDifference || Number(right.quantity_sold) - Number(left.quantity_sold)
  })
  const totalSales = ranked.reduce((sum, product) => sum + Number(product.total_sales || 0), 0)
  // Add one-based rank and each product's share of all ranked sales.
  return ranked.map((product, index) => ({
    ...product,
    rank: index + 1,
    sales_share: totalSales > 0 ? Number(product.total_sales || 0) / totalSales * 100 : 0,
  }))
}
```

Inputs: product aggregates from the dashboard query. Output: sorted products with rank and sales share. Business significance: summarizes product performance. Defense question: “How are ties resolved?” Answer: quantity sold descending is the secondary sort key. This display analysis uses JavaScript numbers and is not the financial ledger.

## 15. Account Password Reset and Session Invalidation

Module: User Account Management (Admin)<br>
Source File: `server/controllers/userController.js`<br>
Function: `resetUserPassword` (lines 183–201)<br>
Importance: IMPORTANT

### Source Code

The complete function is included in Appendix A, A13. It validates the target ID and non-empty replacement password, begins a transaction, finds the user, hashes the new password with bcrypt cost 10, increments `auth_version`, invalidates password reset tokens, records an activity row, and commits. The route is behind authentication and Admin-only authorization. Business significance: changes credentials and invalidates older JWTs on their next middleware check. Defense question: “How are sessions invalidated?” Answer: the middleware compares the token's auth version with the current user row, and password reset increments that DB version.

## Recommended Defense Sequence

Present algorithms 1–4 to explain stock accuracy and sale integrity; algorithms 5–8 to explain receiving and credit collection; algorithms 9–11 to explain money precision, retries, and access control; then algorithms 12–15 for reporting and account governance. When describing any algorithm as verified, distinguish source inspection from executed tests. None were executed for this audit.























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

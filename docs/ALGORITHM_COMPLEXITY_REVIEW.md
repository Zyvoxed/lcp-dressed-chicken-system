# Algorithm Documentation and Complexity Review

This note records the current implementation as a baseline for later refactoring. It describes existing behavior only; SQL execution cost depends on the database engine, indexes, query plan, locks, and data volume.

## FIFO inventory allocation

`server/controllers/salesController.js` normalizes sale items, rejects duplicate product IDs, and sorts them by product ID before locking product rows. For each product, the controller locks its active product row and all stock-in batches with positive remaining quantity. Eligible batches are ordered by `delivery_date ASC, stockin_id ASC`, so earlier deliveries are consumed first and same-date batches have a deterministic tie-breaker.

Before writing, the controller checks both the aggregate product quantity and the sum of eligible batch balances. It then allocates `min(quantity still needed, batch remaining quantity)` from each batch in order, records the source batch and cost in `sale_batch_allocations`, and updates the product aggregate. Partial consumption leaves the unused batch balance for later sales. Exact exhaustion stops before the next batch.

Product and batch row locks keep concurrent sales from consuming the same stock. Sorting product IDs gives overlapping sales a consistent product-lock order and helps reduce deadlock risk. The sale row, sale items, batch deductions, allocation history, product totals/status, customer balance, activity log, and idempotency response share one transaction.

**Complexity.** For `n` sale items and `Bᵢ` eligible batches fetched for item `i`, input normalization is expected `O(n)` plus `O(n log n)` for sorting. Summing and walking the returned batches is `O(Σ Bᵢ)` application work, with `O(n + Σ Bᵢ)` temporary space because all eligible batches are loaded before the allocation loop. Database scan, sort, and lock costs are query-plan dependent.

**Performance observation.** The FIFO query returns every eligible positive batch for a product, even if the requested quantity could be satisfied by only the oldest few. That preserves the current coverage check but may increase rows read, lock duration, and memory for products with many open batches.

## Monetary precision and cash change

`server/utils/money.js` converts validated monetary amounts to integer cents and quantities to thousandths before using `BigInt`. A line total multiplies thousandths by cents, adds half the divisor, and divides by 1,000, which rounds each non-negative line half-up to cents before transaction totals are summed. `centsToAmount` formats the integer and remainder without converting back to a floating-point amount.

`src/utils/transactionMoney.js` parses decimal text directly into `BigInt` scaled units. It accepts at most three quantity decimal places and two money decimal places, then uses the same per-line half-up rule as the server. This avoids binary floating-point arithmetic in the browser’s transaction totals. Monetary formatting uses `Intl` for currency placement while preserving the cents as text.

For cash sales, `SalesBasket.jsx` computes displayed change as `max(tender - sale total, 0)`. The request records the sale total as `amount_paid`, so returned change does not increase revenue. Credit sales send the actual initial payment; the server rejects overpayment, and requires cash tender to cover the total.

**Complexity.** Conversion and formatting are constant-time in the number of transaction lines; totaling `n` lines is `O(n)` time and `O(1)` accumulator space. BigInt arithmetic cost also depends on the number of digits in the bounded inputs.

## Sale transaction sequence

`createSale` validates the request and registered-price policy, normalizes and sorts items, computes a normalized idempotency payload hash, then begins a database transaction and reserves the request key. It locks any active customer, then each active product and its eligible FIFO batches. It verifies stock and payment constraints, calculates line and transaction amounts, inserts the sale and item rows, applies FIFO batch deductions and allocation records, updates aggregate stock and status, and adds any remaining credit to the customer balance. It then writes activity and the response to replay before committing.

Keeping these steps atomic prevents a failed sale from leaving a sale row without stock deductions, an inventory update without allocation history, or a customer balance that disagrees with the sale. On failures, `resolveTransactionFailure` distinguishes a confirmed rollback from an uncertain begin/commit/rollback outcome; uncertain connections are discarded instead of returned to the pool for reuse.

**Complexity.** Application work is dominated by item normalization and FIFO batch processing (`O(n log n + Σ Bᵢ)`). SQL calls scale with line items and with the number of batches actually consumed. Database work and lock duration depend on data distribution and indexes.

## Idempotency and duplicate recovery

`server/utils/idempotency.js` validates the `Idempotency-Key`, hashes the normalized request payload with SHA-256, and reserves the key in a user-and-operation scope inside the business transaction. The named unique index identifies a retry collision. Other duplicate-key errors remain ordinary database failures because they may refer to unrelated business constraints.

On a collision, the controller reads the stored request hash, status, and response. A response is replayed only when it exists and the payload hash matches. A different payload returns a conflict; an incomplete or unverified record is treated as an uncertain outcome, not as proof that the original transaction completed. This prevents a retry from creating a second sale, stock-in, or payment or from returning a different request’s response.

**Complexity.** Hashing and JSON serialization are `O(m)` in normalized payload size. Lookup and reservation cost depends on the scoped unique index and database state. Replaying a stored JSON body is `O(r)` in response size.

## Customer credit and payment

Credit sale creation adds only its positive remaining balance to `customers.current_balance`. `recordPayment` locks the sale, verifies that it is a credit sale and that the amount is positive and no greater than the sale’s remaining balance, then locks the customer and checks that its stored balance can cover the payment. Within one transaction it increases `sales.amount_paid`, decreases the sale remaining balance, updates status, subtracts from the customer total, records the payment and activity, stores the idempotent response, and commits. A full payment changes the sale status to `Paid`; a partial payment leaves it `Partially Paid`.

**Complexity.** The controller performs a fixed number of indexed row lookups and writes, so its application-level work is `O(1)` per payment. Database locking and access costs are index- and contention-dependent.

## Stock-in and inventory update

`createStockIn` validates supplier/product IDs, decimal quantity and cost, delivery date, and the derived total. In one transaction it reserves the idempotency key, locks active supplier and product rows, derives the next product status, inserts a stock-in batch with `quantity_received` and `remaining_quantity` initially equal, increments aggregate product stock, writes status and activity, stores the replay response, and commits. A failed step rolls back the batch and aggregate update together.

**Complexity.** Application-level calculation is `O(1)` per stock-in, apart from decimal parsing. The database performs a fixed number of row operations; row lookup and lock costs depend on indexes and contention.

## Reports and dashboard calculations

`reportController.js` applies parameterized sale date, payment type, user, status, and text-search predicates to result rows, count, and summary queries. The end date uses an exclusive next-day bound, which includes all times on the selected calendar day. Summary totals cover all matching rows, independently of the page `LIMIT` and `OFFSET`. Page size is bounded to 100.

Inventory valuation sums `remaining_quantity * cost_price` over batches with stock remaining; estimated sales value is current aggregate product stock times current selling price. Receivables rows include active customers with a positive current balance and aggregate their still-open credit sales; the headline receivables summary is global and is not narrowed by customer search. Product sales are grouped by product, year, and month with quantity and subtotal sums.

The dashboard groups sales into hour, weekday, and day-of-month buckets using Manila calendar bounds. `fillSeries` indexes returned non-empty buckets in a `Map`, then fills the fixed hour/week/month labels with zeros where no row exists. Admin business analytics uses SQL ordering for top sellers, sorts a product copy for slow sellers, and sorts restock candidates by the current-stock/reorder-level ratio (or current stock when the reorder level is zero).

**Complexity.** `fillSeries` is `O(g + L)` time and space for `g` returned groups and `L` output labels. Business analytics filtering is `O(P)` for `P` product rows; its slow-seller sort is `O(P log P)`, and restock sorting is `O(R log R)` for `R` candidates, with `O(P + R)` copied/filter space. SQL grouping, aggregation, ordering, and pagination do not have a useful standalone Big-O estimate here; their work depends on plans, indexes, and matching data volume.

**Performance observations.** Sales reporting issues separate page, summary, and count queries; the summary and count must inspect the full matching set despite page-size limits. Stock-in allocation history calculates `ROW_NUMBER()` across sale allocations before filtering by batch in the current query. The Admin dashboard performs several independent aggregate/report queries per request. These are candidates for measurement against representative data before any optimization.

## Authentication and authorization

`login` enforces IP/account limits, checks credentials and active-account state, requires a verified email, creates a short-lived MFA challenge, and sends the code without issuing a session token. Challenge verification locks the challenge row, checks expiry, consumed state and attempt count, verifies the OTP, then rechecks active status, allowed role, email, and `auth_version`. Only a successfully consumed challenge reaches token issuance; the JWT expires after eight hours and carries `mfa_verified: true`.

Challenge IDs, OTPs, email identifiers, and rate-limit identifiers are stored as hashes/HMACs. Verification uses a constant-time hash comparison. The implementation allows five code attempts, a 60-second resend cooldown, and a five-minute OTP expiry from validated environment configuration. Current rate limits are:

| Action | Scope | Limit | Window |
| --- | --- | ---: | --- |
| Login | IP | 30 | 15 minutes |
| Login | Account | 10 | 15 minutes |
| Challenge creation | IP | 30 | 1 hour |
| Challenge creation | Account | 5 | 1 hour |
| Verification | IP | 60 | 15 minutes |
| Verification | Challenge | 15 | 15 minutes |
| Resend | IP | 30 | 1 hour |
| Resend | Challenge | 10 | 1 hour |

`authenticate` verifies JWT signature/expiry, then compares the token’s role and `auth_version` with the current active user record and requires the MFA claim. `authorizeRoles` applies each route’s explicit allow-list. For example, sales creation allows Admin and Staff, while stock-in and payment routes are Admin-only; report routes are Admin-only.

**Complexity.** Token verification and challenge hashing are linear in their small bounded input sizes. Authentication performs one user lookup; challenge verification and rate-limit enforcement perform a fixed set of indexed reads/writes per request. Database contention and index performance are not represented by an application-level Big-O estimate.

## Follow-up questions for later measurement

- How many open FIFO batches per product are typical, and are existing indexes sufficient for eligible-batch selection and stable ordering?
- What are representative sizes for sales, payment, allocation, and activity histories when report and dashboard queries run?
- Should report rows, summary, and count be required to observe one consistent database snapshot during concurrent writes?

These are measurement or product-consistency questions; no query, formula, transaction boundary, or behavior was changed for this review.

import { useEffect, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import Modal from '../Shared/Modal.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { getStockInBatchAllocations } from '../../services/stockInService.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

function quantity(value) {
  const number = Number(value)
  return Number.isFinite(number)
    ? number.toLocaleString('en-PH', { maximumFractionDigits: 3 })
    : '0'
}

function batchMetrics(batch) {
  const received = Number(batch.quantity_received)
  const remaining = Number(batch.remaining_quantity)
  const consumed = Math.max(received - remaining, 0)
  const status = remaining <= 0
    ? 'Used Up'
    : consumed > 0
      ? 'Partially Used'
      : 'Available'

  return { received, remaining, consumed, status }
}

function BatchDetailsModal({ batch: initialBatch, onClose }) {
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getStockInBatchAllocations(initialBatch.stockin_id, { signal: controller.signal })
      .then(setDetails)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [initialBatch.stockin_id, requestVersion])

  const batch = details?.batch ?? initialBatch
  const metrics = batchMetrics(batch)

  return (
    <Modal title={`FIFO Batch DLV-${initialBatch.stockin_id}`} onClose={onClose} className="fifo-batch-modal">
      <p className="inventory-modal-copy">The system automatically uses stock from older deliveries before newer deliveries.</p>

      <section className="fifo-batch-section" aria-labelledby="fifo-batch-summary-heading">
        <div className="fifo-batch-section-heading">
          <h3 id="fifo-batch-summary-heading">Stock Summary</h3>
          <StatusBadge value={metrics.status} />
        </div>
        <dl className="transaction-detail-list fifo-batch-summary">
          <div><dt>Delivery reference</dt><dd>DLV-{batch.stockin_id}</dd></div>
          <div><dt>Product</dt><dd>{batch.product_name}</dd></div>
          <div><dt>Supplier</dt><dd>{batch.supplier_name}</dd></div>
          <div><dt>Delivery date</dt><dd><time dateTime={batch.delivery_date}>{formatActivityTimestamp(batch.delivery_date).dateTime}</time></dd></div>
          <div><dt>Stock Added</dt><dd>{quantity(metrics.received)} {batch.unit}</dd></div>
          <div><dt>Stock Remaining</dt><dd>{quantity(metrics.remaining)} {batch.unit}</dd></div>
          <div><dt>Stock Sold / Deducted</dt><dd>{quantity(metrics.consumed)} {batch.unit}</dd></div>
          <div><dt>Recorded by</dt><dd>{batch.recorded_by}</dd></div>
        </dl>
      </section>

      <section className="fifo-batch-section" aria-labelledby="fifo-allocation-heading">
        <div className="fifo-batch-section-heading">
          <div>
            <h3 id="fifo-allocation-heading">Sales Using This Stock</h3>
            <p>Recorded sales that used stock from this delivery.</p>
          </div>
          {details && <span className="fifo-allocation-count">{details.allocations.length} sale record{details.allocations.length === 1 ? '' : 's'}</span>}
        </div>

        {loading && <div className="fifo-batch-state"><LoadingSpinner /></div>}
        {!loading && error && (
          <div className="fifo-batch-state">
            <EmptyState>{error}</EmptyState>
            <button className="secondary-action slim" type="button" onClick={() => { setError(''); setLoading(true); setRequestVersion((version) => version + 1) }}>Try Again</button>
          </div>
        )}
        {!loading && !error && details && !details.allocations.length && <EmptyState>No sales have used stock from this delivery.</EmptyState>}
        {!loading && !error && details?.allocations.length > 0 && (
          <div className="fifo-allocation-list">
            {details.allocations.map((allocation) => (
              <article key={allocation.allocation_id}>
                <div>
                  <strong>Sale Reference: OR-{allocation.sale_id}</strong>
                </div>
                <dl>
                  <div><dt>Sale date</dt><dd><time dateTime={allocation.sale_date}>{formatActivityTimestamp(allocation.sale_date).dateTime}</time></dd></div>
                  <div><dt>Quantity Used</dt><dd>{quantity(allocation.quantity_deducted)} {batch.unit}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <button className="primary-action" type="button" onClick={onClose}>Done</button>
    </Modal>
  )
}

export default BatchDetailsModal

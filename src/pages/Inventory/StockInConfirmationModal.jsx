import Modal from '../Shared/Modal.jsx'
import { peso } from '../../utils/currency.js'

function StockInConfirmationModal({ product, supplier, form, submitting, error, onCancel, onConfirm }) {
  const quantity = Number(form.quantity_received)
  const costPrice = Number(form.cost_price)

  return (
    <Modal title="Review Stock Delivery" onClose={onCancel} className="inventory-confirmation-modal">
      <p className="inventory-modal-copy">Confirm the delivery details before creating the FIFO stock batch.</p>
      <section className="inventory-review-section" aria-labelledby="stock-product-heading">
        <h3 id="stock-product-heading">Product and Supplier</h3>
        <dl className="transaction-detail-list">
          <div><dt>Product</dt><dd>{product.product_name}</dd></div>
          <div><dt>Supplier</dt><dd>{supplier.supplier_name}</dd></div>
          <div><dt>Current stock</dt><dd>{Number(product.stock_quantity)} {product.unit}</dd></div>
          <div><dt>Current status</dt><dd>{product.status}</dd></div>
        </dl>
      </section>
      <section className="inventory-review-section" aria-labelledby="stock-delivery-heading">
        <h3 id="stock-delivery-heading">Delivery Details</h3>
        <dl className="transaction-detail-list">
          <div><dt>Quantity received</dt><dd>{quantity} {product.unit}</dd></div>
          <div><dt>Cost per {product.unit}</dt><dd>{peso.format(costPrice)}</dd></div>
          <div><dt>Total cost</dt><dd>{peso.format(quantity * costPrice)}</dd></div>
          <div><dt>Delivery date</dt><dd>{new Date(form.delivery_date).toLocaleString()}</dd></div>
        </dl>
      </section>
      {error && <p className="inventory-feedback error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-action" type="button" disabled={submitting} onClick={onCancel}>Return to Editing</button>
        <button className="primary-action" type="button" disabled={submitting} onClick={onConfirm}>
          {submitting && <span className="inventory-submit-spinner" aria-hidden="true" />}
          {submitting ? 'Recording Delivery...' : 'Confirm Stock In'}
        </button>
      </div>
    </Modal>
  )
}

export default StockInConfirmationModal

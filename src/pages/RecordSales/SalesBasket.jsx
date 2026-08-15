import EmptyState from '../Shared/EmptyState.jsx'
import CustomerSelector from './CustomerSelector.jsx'
import { peso } from '../../utils/currency.js'

function SalesBasket() {
  return (
    <aside className="panel basket-panel">
      <h2>ACTIVE SALES BASKET</h2>
      <CustomerSelector />
      <button className="secondary-action" type="button">
        Quick Register
      </button>
      <EmptyState>Basket is ready for selected products</EmptyState>
      <div className="terms-row">
        <button className="selected" type="button">
          Cash Sale
        </button>
        <button type="button">Credit Term</button>
      </div>
      <label>
        Amount paid
        <input type="number" placeholder="0.00" />
      </label>
      <div className="bill-total">
        <span>Total bill</span>
        <strong>{peso.format(0)}</strong>
      </div>
      <button className="primary-action" type="button">
        Process Order
      </button>
    </aside>
  )
}

export default SalesBasket

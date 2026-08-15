import { products } from '../../data/products.js'
import { suppliers } from '../../data/suppliers.js'

function StockInForm() {
  return (
    <article className="panel centered-form">
      <h2>Record Incoming Supplier Stock Delivery</h2>
      <label>
        Supplier
        <select>
          {suppliers.map(([name]) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Chicken Type
        <select>
          {products.map(([name]) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Quantity Received
        <input type="number" placeholder="0" />
      </label>
      <label>
        Unit Purchase Cost
        <input type="number" placeholder="0.00" />
      </label>
      <button className="primary-action" type="button">
        Submit Stock Delivery
      </button>
    </article>
  )
}

export default StockInForm

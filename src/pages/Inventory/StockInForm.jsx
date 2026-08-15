import { useEffect, useState } from 'react'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import { getProducts } from '../../services/productService.js'
import { getSuppliers } from '../../services/supplierService.js'
import { createStockIn } from '../../services/stockInService.js'

function getLocalDateTime() {
  const now = new Date()
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return localTime.toISOString().slice(0, 16)
}

const initialForm = {
  supplier_id: '',
  product_id: '',
  quantity_received: '',
  cost_price: '',
  delivery_date: getLocalDateTime(),
}

function StockInForm({ onCreated }) {
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadOptions() {
      try {
        const [productData, supplierData] = await Promise.all([
          getProducts({ signal: controller.signal }),
          getSuppliers({ signal: controller.signal }),
        ])
        setProducts(productData)
        setSuppliers(supplierData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    loadOptions()

    return () => controller.abort()
  }, [])

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      await createStockIn(form)
      setSuccess('Stock-in recorded successfully')
      setForm((current) => ({
        ...initialForm,
        supplier_id: current.supplier_id,
        product_id: current.product_id,
        delivery_date: getLocalDateTime(),
      }))
      onCreated()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="panel centered-form" onSubmit={handleSubmit}>
      <h2>Record Incoming Supplier Stock Delivery</h2>
      <label>
        Supplier
        <select name="supplier_id" value={form.supplier_id} onChange={handleChange} required disabled={loading}>
          <option value="">Select supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.supplier_name}</option>
          ))}
        </select>
      </label>
      <label>
        Chicken Type
        <select name="product_id" value={form.product_id} onChange={handleChange} required disabled={loading}>
          <option value="">Select product</option>
          {products.map((product) => (
            <option key={product.product_id} value={product.product_id}>{product.product_name}</option>
          ))}
        </select>
      </label>
      <label>
        Quantity Received
        <input name="quantity_received" type="number" min="0.001" step="0.001" placeholder="0" value={form.quantity_received} onChange={handleChange} required />
      </label>
      <label>
        Unit Purchase Cost
        <input name="cost_price" type="number" min="0" step="0.01" placeholder="0.00" value={form.cost_price} onChange={handleChange} required />
      </label>
      <label>
        Delivery Date
        <input name="delivery_date" type="datetime-local" value={form.delivery_date} onChange={handleChange} required />
      </label>
      {loading && <LoadingSpinner />}
      {error && <p role="alert">{error}</p>}
      {success && <p className="status active">{success}</p>}
      <button className="primary-action" type="submit" disabled={loading || submitting}>
        {submitting ? 'Submitting Delivery' : 'Submit Stock Delivery'}
      </button>
    </form>
  )
}

export default StockInForm

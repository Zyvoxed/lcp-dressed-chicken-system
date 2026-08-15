import { useEffect, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import SearchBar from '../Shared/SearchBar.jsx'
import CategoryFilter from './CategoryFilter.jsx'
import ProductGrid from './ProductGrid.jsx'
import SalesBasket from './SalesBasket.jsx'
import CustomerModal from './CustomerModal.jsx'
import { getCustomers } from '../../services/customerService.js'
import { getProducts } from '../../services/productService.js'
import { createSale } from '../../services/salesService.js'

function RecordSales() {
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [customers, setCustomers] = useState([])
  const [customerModal, setCustomerModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refreshProducts() {
    const data = await getProducts()
    setProducts(data)
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadProducts() {
      try {
        const [productData, customerData] = await Promise.all([
          getProducts({ signal: controller.signal }),
          getCustomers({ signal: controller.signal }),
        ])
        setProducts(productData)
        setCustomers(customerData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadProducts()
    return () => controller.abort()
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleProducts = products.filter((product) => {
    const normalizedCategory = product.category.replace(' and ', ' & ')
    const categoryMatches = category === 'All' || normalizedCategory === category
    const queryMatches = !normalizedQuery || product.product_name.toLowerCase().includes(normalizedQuery)
    return categoryMatches && queryMatches
  })

  function addProduct(product) {
    if (Number(product.stock_quantity) <= 0) return

    setCart((current) => {
      const existing = current.find((item) => item.product_id === product.product_id)
      return existing
        ? current.map((item) => item.product_id === product.product_id
          ? { ...item, quantity: Math.min(item.quantity + 1, Number(product.stock_quantity)) }
          : item)
        : [...current, { ...product, quantity: Math.min(1, Number(product.stock_quantity)) }]
    })
  }

  function updateQuantity(productId, quantity) {
    setCart((current) => current.map((item) => item.product_id === productId
      ? { ...item, quantity: Math.min(Math.max(Number(quantity), 0.001), Number(item.stock_quantity)) }
      : item))
  }

  function removeProduct(productId) {
    setCart((current) => current.filter((item) => item.product_id !== productId))
  }

  async function processSale({ amountPaid, paymentType, customerId }) {
    const result = await createSale({
      customer_id: paymentType === 'Credit' ? Number(customerId) : null,
      payment_type: paymentType,
      amount_paid: amountPaid,
      items: cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    })
    setCart([])
    await refreshProducts()
    return result
  }

  async function customerCreated() {
    setCustomers(await getCustomers())
    setCustomerModal(false)
  }

  return (
    <section className="sales-layout">
      <article className="panel catalog-panel">
        <div className="section-heading">
          <p>PRODUCT CATALOG (SALES POS)</p>
          <span>{visibleProducts.length} product lines</span>
        </div>
        <SearchBar placeholder="Search product catalog" value={query} onChange={(event) => setQuery(event.target.value)} />
        <CategoryFilter category={category} onCategory={setCategory} />
        {loading && <LoadingSpinner />}
        {!loading && error && <EmptyState>{error}</EmptyState>}
        {!loading && !error && !visibleProducts.length && <EmptyState>No products found.</EmptyState>}
        {!loading && !error && visibleProducts.length > 0 && <ProductGrid products={visibleProducts} onAdd={addProduct} />}
      </article>
      <SalesBasket cart={cart} customers={customers} onAddCustomer={() => setCustomerModal(true)} onQuantity={updateQuantity} onRemove={removeProduct} onProcess={processSale} />
      {customerModal && <CustomerModal onClose={() => setCustomerModal(false)} onCreated={customerCreated} />}
    </section>
  )
}

export default RecordSales

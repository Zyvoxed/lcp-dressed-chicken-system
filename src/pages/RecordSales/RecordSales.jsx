import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown,
  ClipboardList,
  PackageSearch,
  Search,
  X,
} from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import CategoryFilter from './CategoryFilter.jsx'
import ProductGrid from './ProductGrid.jsx'
import SalesBasket from './SalesBasket.jsx'
import CustomerModal from './CustomerModal.jsx'
import { getCustomers } from '../../services/customerService.js'
import { getProducts } from '../../services/productService.js'
import { createSale } from '../../services/salesService.js'
import { getIdempotencyStatus } from '../../services/idempotencyService.js'
import { readPendingTransaction, savePendingTransaction } from '../../utils/pendingTransaction.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../context/ToastContext.jsx'

function getInitialSaleRecovery(userId) {
  try {
    return { attempt: readPendingTransaction('sale', userId), error: '' }
  } catch (error) {
    return { attempt: null, error: error.message }
  }
}

function RecordSales() {
  const { user } = useAuth()
  return <RecordSalesForUser key={user?.user_id || 'unauthenticated'} userId={user?.user_id} />
}

function RecordSalesForUser({ userId }) {
  const { showWarning } = useToast()
  const [initialRecovery] = useState(() => getInitialSaleRecovery(userId))
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('name-asc')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState(() => initialRecovery.attempt?.display.cart || [])
  const [customers, setCustomers] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(() => initialRecovery.attempt?.display.customer_id || '')
  const [customerModal, setCustomerModal] = useState(false)
  const [mobileView, setMobileView] = useState(() => initialRecovery.attempt ? 'order' : 'products')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingSale, setPendingSale] = useState(initialRecovery.attempt)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryError] = useState(initialRecovery.error)
  const skipNextSaleRecoveryCheck = useRef(false)

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

  useEffect(() => {
    if (loading || !pendingSale || pendingSale.state === 'completed' || pendingSale.state === 'rejected') return undefined
    if (skipNextSaleRecoveryCheck.current) {
      skipNextSaleRecoveryCheck.current = false
      return undefined
    }

    let active = true
    async function recoverSale() {
      try {
        const status = await getIdempotencyStatus('sale', pendingSale.key)
        if (!active) return
        if (status.state === 'completed') {
          const completedAttempt = {
            ...pendingSale,
            state: 'completed',
            response: status.response?.data,
          }
          savePendingTransaction('sale', userId, completedAttempt)
          setPendingSale(completedAttempt)
          setRecoveryMessage('The sale was already recorded. Its original result is ready to review.')
        } else {
          setRecoveryMessage('No completed result was found. Retry the original sale to safely recover or finish it.')
        }
      } catch (statusError) {
        if (active) setRecoveryMessage(`${statusError.message}. You can retry the original sale with its saved key.`)
      }
    }

    recoverSale()
    return () => { active = false }
  }, [loading, pendingSale, userId])

  // Category counts breakdown
  const categoryCounts = useMemo(() => {
    const counts = { All: products.length }
    for (const p of products) {
      const cat = p.category ? p.category.replace(' and ', ' & ') : 'Uncategorized'
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [products])

  // Available in-stock count
  const inStockCount = useMemo(() => {
    return products.filter((p) => Number(p.stock_quantity) > 0).length
  }, [products])

  // Filtered & sorted products list
  const normalizedQuery = query.trim().toLowerCase()
  const visibleProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      const normalizedCategory = product.category ? product.category.replace(' and ', ' & ') : ''
      const categoryMatches = category === 'All' || normalizedCategory === category
      const queryMatches = !normalizedQuery || product.product_name.toLowerCase().includes(normalizedQuery)
      const stockMatches = !inStockOnly || Number(product.stock_quantity) > 0
      return categoryMatches && queryMatches && stockMatches
    })

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return a.product_name.localeCompare(b.product_name)
        case 'name-desc':
          return b.product_name.localeCompare(a.product_name)
        case 'price-asc':
          return Number(a.selling_price) - Number(b.selling_price)
        case 'price-desc':
          return Number(b.selling_price) - Number(a.selling_price)
        case 'stock-desc':
          return Number(b.stock_quantity) - Number(a.stock_quantity)
        case 'stock-asc':
          return Number(a.stock_quantity) - Number(b.stock_quantity)
        default:
          return 0
      }
    })
  }, [products, category, normalizedQuery, inStockOnly, sortBy])

  function addProduct(product) {
    if (pendingSale || recoveryError || Number(product.stock_quantity) <= 0) return

    setCart((current) => {
      const existing = current.find((item) => item.product_id === product.product_id)
      return existing
        ? current.map((item) => item.product_id === product.product_id
          ? { ...item, quantity: Math.min(Math.round((item.quantity + 1) * 1000) / 1000, Number(product.stock_quantity)) }
          : item)
        : [...current, { ...product, quantity: Math.min(1, Number(product.stock_quantity)) }]
    })
  }

  function updateQuantity(productId, quantity) {
    if (pendingSale || recoveryError) return
    const parsedQuantity = Number(quantity)
    if (!Number.isFinite(parsedQuantity)) return
    const roundedQuantity = Math.round(parsedQuantity * 1000) / 1000

    setCart((current) => current.map((item) => item.product_id === productId
      ? { ...item, quantity: Math.min(Math.max(roundedQuantity, 0.001), Number(item.stock_quantity)) }
      : item))
  }

  function removeProduct(productId) {
    if (pendingSale || recoveryError) return
    setCart((current) => current.filter((item) => item.product_id !== productId))
  }

  function clearCart() {
    if (pendingSale || recoveryError) return
    setCart([])
  }

  async function processSale(payload, idempotencyKey) {
    return createSale(payload, idempotencyKey)
  }

  function updatePendingSale(attempt) {
    if (attempt && !pendingSale) skipNextSaleRecoveryCheck.current = true
    setPendingSale(attempt)
  }

  async function checkSaleRecovery() {
    if (!pendingSale) return
    try {
      const status = await getIdempotencyStatus('sale', pendingSale.key)
      if (status.state === 'completed') {
        const completedAttempt = {
          ...pendingSale,
          state: 'completed',
          response: status.response?.data,
        }
        savePendingTransaction('sale', userId, completedAttempt)
        setPendingSale(completedAttempt)
        setRecoveryMessage('The sale was already recorded. Its original result is ready to review.')
      } else {
        setRecoveryMessage('No completed result was found. Retry the original sale to safely recover or finish it.')
      }
    } catch (statusError) {
      setRecoveryMessage(`${statusError.message}. The saved key is unchanged.`)
    }
  }

  async function completeSale() {
    setCart([])
    setSelectedCustomerId('')
    try {
      await refreshProducts()
      setError('')
    } catch (requestError) {
      const message = `Sale recorded, but product stock could not be refreshed: ${requestError.message}`
      setError(message)
      showWarning(message)
    }
  }

  async function customerCreated(customerId) {
    setCustomers(await getCustomers())
    setSelectedCustomerId(String(customerId))
  }

  return (
    <section className="sales-page page-stack">
      {/* Mobile/Tablet View Switcher */}
      <div className="pos-mobile-switch" role="tablist" aria-label="Point of Sale panels">
        <button
          type="button"
          role="tab"
          aria-selected={mobileView === 'products'}
          className={mobileView === 'products' ? 'selected' : ''}
          onClick={() => setMobileView('products')}
        >
          <PackageSearch size={16} aria-hidden="true" />
          <span>Products</span>
          <span className="pos-badge-subtle">{visibleProducts.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileView === 'order'}
          className={mobileView === 'order' ? 'selected' : ''}
          onClick={() => setMobileView('order')}
        >
          <ClipboardList size={16} aria-hidden="true" />
          <span>Current Order</span>
          {cart.length > 0 && <span className="pos-cart-badge">{cart.length}</span>}
        </button>
      </div>

      <div className={`sales-layout pos-mobile-${mobileView}`}>
        {recoveryError && <p className="sales-feedback error" role="alert">{recoveryError}</p>}

        {/* Product Catalog Panel */}
        <article className="panel catalog-panel">
          {/* Header */}
          <div className="pos-catalog-header">
            <div className="pos-header-title-wrap">
              <span className="pos-header-icon-badge">
                <PackageSearch size={17} aria-hidden="true" />
              </span>
              <div>
                <h2>Product Catalog</h2>
                <p>Browse and click products to add to current order.</p>
              </div>
            </div>

            <div className="pos-catalog-stats">
              <span className="pos-stat-pill">
                <strong>{visibleProducts.length}</strong> {visibleProducts.length === 1 ? 'product' : 'products'}
              </span>
              <span className="pos-stat-pill in-stock">
                <span className="stock-dot" aria-hidden="true" />
                <strong>{inStockCount}</strong> in stock
              </span>
            </div>
          </div>

          {/* Search & Sort Controls Toolbar */}
          <div className="pos-toolbar">
            <div className="pos-search-wrap">
              <Search size={15} className="pos-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="pos-search-input"
                placeholder="Search products by name or code..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search product catalog"
              />
              {query && (
                <button
                  type="button"
                  className="pos-search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="pos-toolbar-actions">
              {/* Sort Selector Dropdown */}
              <label className="pos-sort-select-label" title="Sort products">
                <ArrowUpDown size={14} aria-hidden="true" />
                <span>Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort product catalog"
                  className="pos-sort-select"
                >
                  <option value="name-asc">Name: A &rarr; Z</option>
                  <option value="name-desc">Name: Z &rarr; A</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="stock-desc">Stock: High to Low</option>
                  <option value="stock-asc">Stock: Low to High</option>
                </select>
              </label>

              {/* In-Stock Filter Toggle */}
              <button
                type="button"
                className={`pos-stock-filter-btn ${inStockOnly ? 'active' : ''}`}
                onClick={() => setInStockOnly((prev) => !prev)}
                aria-pressed={inStockOnly}
                title="Toggle between all products and in-stock only"
              >
                <span className={`stock-filter-dot ${inStockOnly ? 'active' : ''}`} aria-hidden="true" />
                <span>In-Stock Only</span>
              </button>
            </div>
          </div>

          {/* Categories Pill Navigation */}
          <CategoryFilter
            category={category}
            onCategory={setCategory}
            counts={categoryCounts}
          />

          {/* Catalog Table */}
          {loading && <PageSkeleton variant="record-sales-catalog" label="product catalog" />}
          {!loading && error && <EmptyState>{error}</EmptyState>}
          {!loading && !error && !visibleProducts.length && (
            <EmptyState>
              {query || category !== 'All' || inStockOnly
                ? 'No products match your current filters. Try resetting search or category.'
                : 'No products found.'}
            </EmptyState>
          )}
          {!loading && !error && visibleProducts.length > 0 && (
            <ProductGrid
              products={visibleProducts}
              onAdd={addProduct}
              sortBy={sortBy}
              onSortChange={setSortBy}
            />
          )}
        </article>

        {/* Current Order / Cart Basket */}
        <SalesBasket
          userId={userId}
          cart={cart}
          customers={customers}
          onAddCustomer={() => setCustomerModal(true)}
          onQuantity={updateQuantity}
          onRemove={removeProduct}
          onClearCart={clearCart}
          onProcess={processSale}
          onComplete={completeSale}
          pendingSale={pendingSale}
          onPendingSaleChange={updatePendingSale}
          onCheckRecovery={checkSaleRecovery}
          recoveryMessage={recoveryMessage}
          recoveryError={recoveryError}
          customerId={selectedCustomerId}
          onCustomerChange={setSelectedCustomerId}
        />
      </div>

      {customerModal && (
        <CustomerModal onClose={() => setCustomerModal(false)} onCreated={customerCreated} />
      )}
    </section>
  )
}

export default RecordSales

import { useEffect, useRef, useState } from 'react'
import { ClipboardList, PackageSearch } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import SearchBar from '../Shared/SearchBar.jsx'
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

  const normalizedQuery = query.trim().toLowerCase()
  const visibleProducts = products.filter((product) => {
    const normalizedCategory = product.category.replace(' and ', ' & ')
    const categoryMatches = category === 'All' || normalizedCategory === category
    const queryMatches = !normalizedQuery || product.product_name.toLowerCase().includes(normalizedQuery)
    return categoryMatches && queryMatches
  })

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
      <div className="pos-mobile-switch" role="tablist" aria-label="Point of Sale panels">
        <button
          type="button"
          role="tab"
          aria-selected={mobileView === 'products'}
          className={mobileView === 'products' ? 'selected' : ''}
          onClick={() => setMobileView('products')}
        >
          <PackageSearch size={16} aria-hidden="true" />
          Products
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileView === 'order'}
          className={mobileView === 'order' ? 'selected' : ''}
          onClick={() => setMobileView('order')}
        >
          <ClipboardList size={16} aria-hidden="true" />
          Current Order
          {cart.length > 0 && <span>{cart.length}</span>}
        </button>
      </div>
      <div className={`sales-layout pos-mobile-${mobileView}`}>
        {recoveryError && <p className="sales-feedback error" role="alert">{recoveryError}</p>}
        <article className="panel catalog-panel">
          <div className="section-heading">
            <p>PRODUCTS</p>
            <span>{visibleProducts.length} products</span>
          </div>
          <SearchBar placeholder="Search product catalog" value={query} onChange={(event) => setQuery(event.target.value)} />
          <CategoryFilter category={category} onCategory={setCategory} />
          {loading && <PageSkeleton variant="record-sales-catalog" label="product catalog" />}
          {!loading && error && <EmptyState>{error}</EmptyState>}
          {!loading && !error && !visibleProducts.length && <EmptyState>No products found.</EmptyState>}
          {!loading && !error && visibleProducts.length > 0 && <ProductGrid products={visibleProducts} onAdd={addProduct} />}
        </article>
        <SalesBasket
          userId={userId}
          cart={cart}
          customers={customers}
          onAddCustomer={() => setCustomerModal(true)}
          onQuantity={updateQuantity}
          onRemove={removeProduct}
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
      {customerModal && <CustomerModal onClose={() => setCustomerModal(false)} onCreated={customerCreated} />}
    </section>
  )
}

export default RecordSales
import PageSkeleton from '../Shared/PageSkeleton.jsx'

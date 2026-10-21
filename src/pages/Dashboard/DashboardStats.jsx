import { useEffect, useId, useRef, useState } from 'react'
import { Boxes, CircleAlert, HandCoins, WalletCards } from 'lucide-react'
import DashboardKpiModal from './DashboardKpiModal.jsx'
import DashboardKpiPreview from './DashboardKpiPreview.jsx'
import { getCustomers } from '../../services/customerService.js'
import { getProducts } from '../../services/productService.js'
import { peso } from '../../utils/currency.js'

const initialResource = { data: [], error: '', status: 'idle' }

function KpiCard({ label, value, note, Icon, tone, previewRows, resource, onActivate, onIntent }) {
  const cardRef = useRef(null)
  const previewId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const showPreview = !dismissed && (hovered || focused)

  function revealPreview(source) {
    if (source === 'hover') setHovered(true)
    if (source === 'focus') setFocused(true)
    setDismissed(false)
    onIntent(resource)
  }

  return (
    <article
      ref={cardRef}
      className={`dashboard-kpi-card interactive ${tone}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
          setDismissed(false)
        }
      }}
      onFocus={() => revealPreview('focus')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDismissed(true)
      }}
      onMouseEnter={() => revealPreview('hover')}
      onMouseLeave={() => {
        setHovered(false)
        setDismissed(false)
      }}
    >
      <button
        className="dashboard-kpi-card-action"
        type="button"
        aria-describedby={showPreview ? previewId : undefined}
        aria-haspopup="dialog"
        aria-label={`${label}: ${value}. Open details.`}
        onClick={onActivate}
      />
      <div className="dashboard-kpi-heading">
        <p>{label}</p>
        <Icon size={18} aria-hidden="true" />
      </div>
      <strong title={value}>{value}</strong>
      <span>• {note}</span>
      <DashboardKpiPreview
        anchorRef={cardRef}
        id={previewId}
        rows={previewRows}
        visible={showPreview}
      />
    </article>
  )
}

function DashboardStats({ dashboard }) {
  const { summary, low_stock_alerts: lowStockProducts } = dashboard
  const [activeKpi, setActiveKpi] = useState(null)
  const [productResource, setProductResource] = useState(initialResource)
  const [customerResource, setCustomerResource] = useState(initialResource)
  const productRequestRef = useRef(null)
  const customerRequestRef = useRef(null)

  async function handleLoadProducts() {
    if (productResource.status === 'loaded' || productRequestRef.current) return

    const controller = new AbortController()
    productRequestRef.current = controller
    setProductResource((current) => ({ ...current, error: '', status: 'loading' }))

    try {
      const data = await getProducts({ signal: controller.signal })
      setProductResource({ data, error: '', status: 'loaded' })
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setProductResource({ data: [], error: requestError.message, status: 'error' })
      }
    } finally {
      if (productRequestRef.current === controller) productRequestRef.current = null
    }
  }

  async function handleLoadCustomers() {
    if (customerResource.status === 'loaded' || customerRequestRef.current) return

    const controller = new AbortController()
    customerRequestRef.current = controller
    setCustomerResource((current) => ({ ...current, error: '', status: 'loading' }))

    try {
      const data = await getCustomers({ signal: controller.signal })
      setCustomerResource({ data, error: '', status: 'loaded' })
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setCustomerResource({ data: [], error: requestError.message, status: 'error' })
      }
    } finally {
      if (customerRequestRef.current === controller) customerRequestRef.current = null
    }
  }

  function handleResourceIntent(resource) {
    if (resource === 'products') handleLoadProducts()
    if (resource === 'customers') handleLoadCustomers()
  }

  useEffect(() => () => {
    productRequestRef.current?.abort()
    customerRequestRef.current?.abort()
  }, [])

  const loadedProducts = productResource.data
  const availableProductCount = loadedProducts.filter((product) => Number(product.stock_quantity) > 0).length
  const outOfStockCount = loadedProducts.filter((product) => Number(product.stock_quantity) <= 0).length
  const outstandingCustomers = customerResource.data
    .filter((customer) => Number(customer.current_balance) > 0)
    .sort((left, right) => Number(right.current_balance) - Number(left.current_balance))

  const stats = [
    {
      key: 'sales',
      label: 'Total Sales',
      value: peso.format(Number(summary.total_revenue)),
      note: 'All recorded cash and credit sales',
      Icon: HandCoins,
      tone: 'positive',
      previewRows: [
        { label: 'Total Revenue', value: peso.format(Number(summary.total_revenue)) },
        { label: 'Transactions', value: String(summary.total_transactions) },
        { label: 'Average Sale', value: peso.format(Number(summary.average_sale_value)) },
        { label: 'Best Seller', value: summary.best_seller || 'No sales recorded' },
      ],
    },
    {
      key: 'products',
      label: 'Total Products',
      value: `${summary.total_products} Items`,
      note: 'Active products',
      Icon: Boxes,
      tone: 'neutral',
      resource: 'products',
      previewRows: [
        { label: 'Active Products', value: String(summary.total_products) },
        { label: 'Low Stock', value: String(summary.low_stock_count) },
        {
          label: 'With Available Stock',
          value: productResource.status === 'loaded'
            ? String(availableProductCount)
            : productResource.status === 'error' ? 'Unavailable' : 'Loading…',
        },
        {
          label: 'Out of Stock',
          value: productResource.status === 'loaded'
            ? String(outOfStockCount)
            : productResource.status === 'error' ? 'Unavailable' : 'Loading…',
        },
      ],
    },
    {
      key: 'lowStock',
      label: 'Low Stock Items',
      value: `${summary.low_stock_count} Alerts`,
      note: 'At or below the low-stock level',
      Icon: CircleAlert,
      tone: 'warning',
      previewRows: [
        { label: 'Total Low Stock', value: String(summary.low_stock_count) },
        ...lowStockProducts.slice(0, 3).map((product) => ({
          label: product.product_name,
          value: `${Number(product.stock_quantity)} ${product.unit}`,
        })),
      ],
    },
    {
      key: 'receivables',
      label: 'Unpaid Customer Balances',
      value: peso.format(Number(summary.customer_credits)),
      note: 'Total unpaid customer balance',
      Icon: WalletCards,
      tone: 'danger',
      resource: 'customers',
      previewRows: [
        { label: 'Outstanding Balance', value: peso.format(Number(summary.customer_credits)) },
        {
          label: 'Customers with Balance',
          value: customerResource.status === 'loaded'
            ? String(outstandingCustomers.length)
            : customerResource.status === 'error' ? 'Unavailable' : 'Loading…',
        },
        ...outstandingCustomers.slice(0, 2).map((customer) => ({
          label: customer.customer_name,
          value: peso.format(Number(customer.current_balance)),
        })),
      ].slice(0, 4),
    },
  ]

  function openDetails(stat) {
    handleResourceIntent(stat.resource)
    setActiveKpi(stat.key)
  }

  return (
    <>
      <div className="dashboard-kpi-grid">
        {stats.map((stat) => (
          <KpiCard
            {...stat}
            key={stat.key}
            onActivate={() => openDetails(stat)}
            onIntent={handleResourceIntent}
          />
        ))}
      </div>
      <DashboardKpiModal
        activeKpi={activeKpi}
        dashboard={dashboard}
        productResource={productResource}
        customerResource={customerResource}
        onClose={() => setActiveKpi(null)}
      />
    </>
  )
}

export default DashboardStats

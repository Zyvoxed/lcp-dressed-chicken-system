import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Archive, X } from 'lucide-react'
import {
  archiveProduct,
  getArchivedProducts,
  getProducts,
  restoreProduct,
} from '../../services/productService.js'
import PageHeader from '../Shared/PageHeader.jsx'
import InflowRecords from './InflowRecords.jsx'
import InventoryTabs from './InventoryTabs.jsx'
import InventoryStats from './InventoryStats.jsx'
import HighestStockLevels from './HighestStockLevels.jsx'
import ProductList, { ArchivedProductList } from './ProductList.jsx'
import ProductModal from './ProductModal.jsx'
import StockInForm from './StockInForm.jsx'
import { useToast } from '../../context/ToastContext.jsx'

function Inventory() {
  const reduceMotion = useReducedMotion()
  const [activeTab, setActiveTab] = useState('Product List')
  const [showProductModal, setShowProductModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [inventoryVersion, setInventoryVersion] = useState(0)
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [archivedProducts, setArchivedProducts] = useState([])
  const [archivedProductsLoading, setArchivedProductsLoading] = useState(false)
  const [archivedProductsError, setArchivedProductsError] = useState('')
  const [showArchivedPanel, setShowArchivedPanel] = useState(false)
  const { showSuccess, showError } = useToast()

  useEffect(() => {
    const controller = new AbortController()

    async function loadProducts() {
      try {
        setProductsLoading(true)
        setProductsError('')
        const productData = await getProducts({ signal: controller.signal })
        setProducts(productData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setProductsError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setProductsLoading(false)
        }
      }
    }

    loadProducts()

    return () => controller.abort()
  }, [inventoryVersion])

  useEffect(() => {
    const controller = new AbortController()
    getArchivedProducts({ signal: controller.signal })
      .then(setArchivedProducts)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setArchivedProducts([])
      })
    return () => controller.abort()
  }, [inventoryVersion])

  useEffect(() => {
    if (!showArchivedPanel) return undefined

    const controller = new AbortController()

    async function loadArchivedProducts() {
      try {
        setArchivedProductsError('')
        setArchivedProductsLoading(true)
        const productData = await getArchivedProducts({ signal: controller.signal })
        setArchivedProducts(productData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setArchivedProductsError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setArchivedProductsLoading(false)
        }
      }
    }

    loadArchivedProducts()

    return () => controller.abort()
  }, [inventoryVersion, showArchivedPanel])

  function closeProductModal() {
    setShowProductModal(false)
    setSelectedProduct(null)
  }

  function handleProductSaved() {
    setInventoryVersion((version) => version + 1)
  }

  async function handleArchiveProduct(product) {
    try {
      const result = await archiveProduct(product.product_id)
      showSuccess(result.message || `${product.product_name} was archived.`)
      setInventoryVersion((version) => version + 1)
    } catch (error) {
      showError(error.message || 'Unable to archive product')
      throw error
    }
  }

  async function handleRestoreProduct(product) {
    try {
      const result = await restoreProduct(product.product_id)
      showSuccess(result.message || `${product.product_name} was restored.`)
      setInventoryVersion((version) => version + 1)
      setShowArchivedPanel(false)
    } catch (error) {
      showError(error.message || 'Unable to restore product')
      throw error
    }
  }

  return (
    <section className="page-stack inventory-page">
      <InventoryTabs activeTab={activeTab} onSelect={setActiveTab} />
      {activeTab === 'Product List' && (
        <InventoryStats
          products={products}
          loading={productsLoading}
          error={productsError}
        />
      )}
      {(activeTab === 'Product List' || activeTab === 'Stock In Product (Delivery)') && (
        <HighestStockLevels
          products={products}
          loading={productsLoading}
          error={productsError}
        />
      )}
      {activeTab === 'Product List' && (
        <article className="panel table-panel inventory-product-table">
          <PageHeader title="PRODUCTS AND STOCK">
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="primary-action slim"
                type="button"
                onClick={() => {
                  setSelectedProduct(null)
                  setShowProductModal(true)
                }}
              >
                Add Product
              </button>
              <button
                className="secondary-action slim product-archived-trigger"
                type="button"
                onClick={() => setShowArchivedPanel(true)}
              >
                <Archive size={15} aria-hidden="true" />
                <span>Archived Products</span>
                {archivedProducts.length > 0 && <span className="product-archived-badge">{archivedProducts.length}</span>}
              </button>
            </div>
          </PageHeader>
          <ProductList
            products={products}
            loading={productsLoading}
            error={productsError}
            onEdit={(product) => {
              setSelectedProduct(product)
              setShowProductModal(true)
            }}
            onArchive={handleArchiveProduct}
          />
        </article>
      )}
      <AnimatePresence>
      {showArchivedPanel && (
        <motion.div
          className="archive-drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setShowArchivedPanel(false) }}
        >
          <motion.aside
            className="archive-drawer product-archive-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-archive-title"
            initial={{ x: reduceMotion ? 0 : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: reduceMotion ? 0 : '100%' }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            aria-label="Archived products"
          >
            <div className="archive-drawer-header">
              <div className="archive-drawer-heading">
                <span className="archive-drawer-icon"><Archive size={17} aria-hidden="true" /></span>
                <div>
                  <p className="archive-drawer-kicker">Inventory records</p>
                  <h2 id="product-archive-title">Archived products</h2>
                  <p className="archive-drawer-description">Review archived items and restore products when needed.</p>
                </div>
              </div>
              <button
                className="close-button"
                type="button"
                onClick={() => setShowArchivedPanel(false)}
                aria-label="Close archived products panel"
              >
                ×
              </button>
            </div>
            <ArchivedProductList
              products={archivedProducts}
              loading={archivedProductsLoading}
              error={archivedProductsError}
              onRestore={handleRestoreProduct}
            />
          </motion.aside>
        </motion.div>
      )}
      </AnimatePresence>
      {activeTab === 'Stock In Product (Delivery)' && (
        <StockInForm onCreated={() => setInventoryVersion((version) => version + 1)} />
      )}
      {activeTab === 'Inflow Records' && <InflowRecords key={inventoryVersion} />}
      {showProductModal && (
        <ProductModal
          product={selectedProduct}
          onClose={closeProductModal}
          onSaved={handleProductSaved}
        />
      )}
    </section>
  )
}

export default Inventory

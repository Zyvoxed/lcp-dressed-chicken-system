import { useEffect, useState } from 'react'
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
import ProductList, { ArchivedProductList } from './ProductList.jsx'
import ProductModal from './ProductModal.jsx'
import StockInForm from './StockInForm.jsx'
import { useToast } from '../../context/ToastContext.jsx'

function Inventory() {
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
        <>
          <InventoryStats
            products={products}
            loading={productsLoading}
            error={productsError}
          />
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
                  className="secondary-action slim"
                  type="button"
                  onClick={() => setShowArchivedPanel(true)}
                >
                  Archived Products
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
        </>
      )}
      {showArchivedPanel && (
        <div className="inventory-archived-panel-backdrop" onClick={() => setShowArchivedPanel(false)}>
          <aside
            className="inventory-archived-panel"
            onClick={(event) => event.stopPropagation()}
            aria-label="Archived products"
          >
            <div className="inventory-archived-panel-header">
              <div>
                <p className="inventory-archived-kicker">Inventory</p>
                <h2>Archived Products</h2>
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
          </aside>
        </div>
      )}
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

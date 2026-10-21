import { useEffect, useState } from 'react'
import { getProducts } from '../../services/productService.js'
import PageHeader from '../Shared/PageHeader.jsx'
import InflowRecords from './InflowRecords.jsx'
import InventoryTabs from './InventoryTabs.jsx'
import InventoryStats from './InventoryStats.jsx'
import ProductModal from './ProductModal.jsx'
import ProductList from './ProductList.jsx'
import StockInForm from './StockInForm.jsx'

function Inventory() {
  const [activeTab, setActiveTab] = useState('Product List')
  const [showProductModal, setShowProductModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [inventoryVersion, setInventoryVersion] = useState(0)
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')

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

  function closeProductModal() {
    setShowProductModal(false)
    setSelectedProduct(null)
  }

  function handleProductSaved() {
    setInventoryVersion((version) => version + 1)
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
            </PageHeader>
            <ProductList
              products={products}
              loading={productsLoading}
              error={productsError}
              onEdit={(product) => {
                setSelectedProduct(product)
                setShowProductModal(true)
              }}
            />
          </article>
        </>
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

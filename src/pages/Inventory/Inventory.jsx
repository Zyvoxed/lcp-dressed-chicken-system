import { useState } from 'react'
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

  return (
    <section className="page-stack">
      <InventoryTabs activeTab={activeTab} onSelect={setActiveTab} />
      {activeTab === 'Product List' && (
        <>
          <InventoryStats />
          <article className="panel table-panel">
            <PageHeader title="PRODUCT INVENTORY LIST">
              <button className="primary-action slim" type="button" onClick={() => setShowProductModal(true)}>
                Register Dressed Product
              </button>
            </PageHeader>
            <ProductList />
          </article>
        </>
      )}
      {activeTab === 'Stock In Product (Delivery)' && <StockInForm />}
      {activeTab === 'Inflow Records' && <InflowRecords />}
      {showProductModal && <ProductModal onClose={() => setShowProductModal(false)} />}
    </section>
  )
}

export default Inventory

import { useState } from 'react'
import PageHeader from '../Shared/PageHeader.jsx'
import InflowRecords from './InflowRecords.jsx'
import InventoryTabs from './InventoryTabs.jsx'
import InventoryStats from './InventoryStats.jsx'
import ProductModal from './ProductModal.jsx'
import ProductList from './ProductList.jsx'
import StockInForm from './StockInForm.jsx'
import { Boxes } from 'lucide-react'
import PageIntro from '../Shared/PageIntro.jsx'

function Inventory() {
  const [activeTab, setActiveTab] = useState('Product List')
  const [showProductModal, setShowProductModal] = useState(false)
  const [inventoryVersion, setInventoryVersion] = useState(0)

  return (
    <section className="page-stack">
      <PageIntro icon={Boxes} title="Inventory & Stock-In" description="Manage products, stock availability, deliveries, and inflow records." />
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
            <ProductList key={inventoryVersion} />
          </article>
        </>
      )}
      {activeTab === 'Stock In Product (Delivery)' && (
        <StockInForm onCreated={() => setInventoryVersion((version) => version + 1)} />
      )}
      {activeTab === 'Inflow Records' && <InflowRecords key={inventoryVersion} />}
      {showProductModal && <ProductModal onClose={() => setShowProductModal(false)} />}
    </section>
  )
}

export default Inventory

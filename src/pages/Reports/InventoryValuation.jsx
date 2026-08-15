import ProductList from '../Inventory/ProductList.jsx'
import { valuationLabels } from '../../data/reports.js'

function InventoryValuation() {
  return (
    <section className="report-layout">
      <article className="panel table-panel">
        <h2>INVENTORY ASSETS VALUATION</h2>
        <ProductList />
      </article>
      <aside className="panel donut-panel">
        <div
          className="donut-wrap"
          tabIndex="0"
          data-tooltip="Whole Chicken 42% · Prime Cuts 26% · Wings 16% · Offal 16%"
        >
          <div className="donut" role="img" aria-label="Inventory valuation mix by product category"></div>
        </div>
        {valuationLabels.map((label) => (
          <p key={label}>{label}</p>
        ))}
      </aside>
    </section>
  )
}

export default InventoryValuation

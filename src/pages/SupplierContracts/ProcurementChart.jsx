import { procurementLabels } from '../../data/suppliers.js'

const procurementValues = [240, 180, 142, 96]

function ProcurementChart({ onSupplierModal }) {
  return (
    <article className="panel">
      <div className="panel-title-row">
        <h2>PROCUREMENT ANALYSIS</h2>
        <button className="primary-action slim" type="button" onClick={onSupplierModal}>
          Add Qualified Supplier
        </button>
      </div>
      <div className="bar-chart">
        {procurementLabels.map((label, index) => (
          <div
            key={label}
            tabIndex="0"
            aria-label={`${label} procurement volume ${procurementValues[index]} kilograms`}
            data-tooltip={`${label}: ${procurementValues[index]} kg cleared`}
          >
            <span style={{ height: `${62 + index * 22}px`, animationDelay: `${index * 0.08}s` }}></span>
            <p>{label}</p>
          </div>
        ))}
      </div>
    </article>
  )
}

export default ProcurementChart

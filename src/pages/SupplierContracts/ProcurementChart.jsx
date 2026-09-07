import EmptyState from '../Shared/EmptyState.jsx'

function ProcurementChart({ onSupplierModal, records }) {
  const totals = records.reduce((result, record) => {
    const name = record.product_name
    result.set(name, (result.get(name) || 0) + Number(record.quantity_received))
    return result
  }, new Map())
  const procurement = [...totals].map(([label, value]) => ({ label, value }))
  const maximum = Math.max(...procurement.map((item) => item.value), 1)

  return (
    <article className="panel">
      <div className="panel-title-row">
        <h2>PROCUREMENT ANALYSIS</h2>
        <button className="primary-action slim" type="button" onClick={onSupplierModal}>
          Add Qualified Supplier
        </button>
      </div>
      {!procurement.length ? <EmptyState>No stock-in deliveries recorded.</EmptyState> : <div className="bar-chart">
        {procurement.map(({ label, value }, index) => (
          <div
            key={label}
            tabIndex="0"
            aria-label={`${label} received quantity ${value}`}
            data-tooltip={`${label}: ${value} received`}
          >
            <span style={{ height: `${Math.max((value / maximum) * 128, 12)}px`, animationDelay: `${index * 0.08}s` }}></span>
            <p>{label}</p>
          </div>
        ))}
      </div>}
    </article>
  )
}

export default ProcurementChart

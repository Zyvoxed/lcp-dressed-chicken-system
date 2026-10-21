import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'

function ProcurementChart({ records, loading, error }) {
  const totals = records.reduce((result, record) => {
    const current = result.get(record.product_name) || { value: 0, unit: record.unit }
    result.set(record.product_name, { value: current.value + Number(record.quantity_received), unit: record.unit })
    return result
  }, new Map())
  const procurement = [...totals].map(([label, details]) => ({ label, ...details }))
  const maximum = Math.max(...procurement.map((item) => item.value), 1)

  return (
    <article className="panel supplier-procurement-panel">
      <div className="supplier-panel-heading">
        <h2>Stock Received by Product</h2>
        <p>Confirmed Stock In quantities grouped by product using existing delivery records.</p>
      </div>
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && !procurement.length && <EmptyState>No stock deliveries recorded.</EmptyState>}
      {!loading && !error && procurement.length > 0 && <div className="bar-chart">
        {procurement.map(({ label, value, unit }, index) => (
          <div key={label} role="img" tabIndex={0} aria-label={`${label}: ${value} ${unit} received`} data-tooltip={`${label}: ${value.toLocaleString('en-PH', { maximumFractionDigits: 3 })} ${unit} received`}>
            <span style={{ height: `${Math.max((value / maximum) * 128, 12)}px`, animationDelay: `${index * 0.08}s` }}></span>
            <p>{label}</p>
          </div>
        ))}
      </div>}
    </article>
  )
}

export default ProcurementChart

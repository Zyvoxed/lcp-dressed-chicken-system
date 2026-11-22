import { groupByUnit, sumQuantitiesByUnit } from './unitAwareMetrics.js'

export function aggregateProcurementMetrics(records) {
  const products = new Map()
  let totalCost = 0

  for (const record of records) {
    const unit = typeof record.unit === 'string' && record.unit.trim() ? record.unit.trim() : 'Unspecified unit'
    const key = `${record.product_id ?? record.product_name ?? 'unknown'}\u0000${unit}`
    const quantity = Number(record.quantity_received) || 0
    const cost = Number(record.total_cost) || 0
    totalCost += cost

    if (!products.has(key)) {
      products.set(key, {
        key,
        product_name: record.product_name || 'Unknown Product',
        unit,
        quantity: 0,
        total_cost: 0,
        deliveries: 0,
      })
    }

    const product = products.get(key)
    product.quantity += quantity
    product.total_cost += cost
    product.deliveries += 1
  }

  return {
    // Keep quantity totals partitioned by unit; only the monetary total is cross-unit.
    productsByUnit: groupByUnit([...products.values()]),
    quantitiesByUnit: sumQuantitiesByUnit(records, (record) => record.quantity_received),
    totalCost,
    deliveryBatches: records.length,
  }
}

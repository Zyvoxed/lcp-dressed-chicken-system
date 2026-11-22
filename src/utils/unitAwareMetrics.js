export function configuredUnit(item) {
  const unit = typeof item?.unit === 'string' ? item.unit.trim() : ''
  return unit || 'Unspecified unit'
}

export function groupByUnit(items) {
  const groups = new Map()
  for (const item of items) {
    const unit = configuredUnit(item)
    if (!groups.has(unit)) groups.set(unit, [])
    groups.get(unit).push(item)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([unit, entries]) => ({ unit, items: entries }))
}

export function scaleSeriesByUnit(seriesList) {
  return groupByUnit(seriesList).map(({ unit, items }) => {
    const maximumValue = Math.max(...items.flatMap((series) => series.values.map(Number)), 0)
    return {
      unit,
      items,
      maximum: maximumValue > 0 ? Math.ceil(maximumValue * 1.15) : 10,
    }
  })
}

export function sumQuantitiesByUnit(items, getQuantity = (item) => item.quantity) {
  return groupByUnit(items).map(({ unit, items: unitItems }) => ({
    unit,
    quantity: unitItems.reduce((total, item) => total + (Number(getQuantity(item)) || 0), 0),
  }))
}

export function formatQuantityWithUnit(value, unit, maximumFractionDigits = 3) {
  const quantity = Number(value) || 0
  return `${quantity.toLocaleString('en-PH', { maximumFractionDigits })} ${unit || 'Unspecified unit'}`
}

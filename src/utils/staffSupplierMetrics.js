const manilaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
})

const monthLabel = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  year: 'numeric',
})

const monthTooltipLabel = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'long',
  year: 'numeric',
})

function manilaMonthKey(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    manilaParts.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}`
}

function monthBuckets(now) {
  const current = manilaMonthKey(now.toISOString())
  const [year, month] = current.split('-').map(Number)
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (5 - index), 15, 12))
    const key = manilaMonthKey(date.toISOString())
    return {
      key,
      label: monthLabel.format(date),
      tooltipLabel: monthTooltipLabel.format(date),
      deliveries: 0,
    }
  })
}

function isPostedRecord(record) {
  const status = String(record.status || '').trim().toLowerCase()
  return !['cancelled', 'canceled', 'void', 'voided'].includes(status)
}

export function getStaffSupplierMetrics(records, supplierId, now = new Date()) {
  const seen = new Set()
  const deliveries = []

  for (const record of records) {
    if (String(record.supplier_id) !== String(supplierId) || !record.stockin_id || !isPostedRecord(record)) continue
    const key = String(record.stockin_id)
    if (seen.has(key)) continue
    const date = new Date(record.delivery_date)
    if (!record.delivery_date || Number.isNaN(date.getTime())) continue
    seen.add(key)
    deliveries.push(record)
  }

  deliveries.sort((left, right) => (
    new Date(right.delivery_date).getTime() - new Date(left.delivery_date).getTime()
    || Number(right.stockin_id) - Number(left.stockin_id)
  ))

  const monthlyActivity = monthBuckets(now)
  const monthIndex = new Map(monthlyActivity.map((item, index) => [item.key, index]))
  for (const delivery of deliveries) {
    const index = monthIndex.get(manilaMonthKey(delivery.delivery_date))
    if (index !== undefined) monthlyActivity[index].deliveries += 1
  }

  return {
    totalDeliveries: deliveries.length,
    lastDelivery: deliveries[0] || null,
    monthlyActivity,
    recentDeliveries: deliveries.slice(0, 5),
  }
}

export function getDeliveryChartTicks(maximum) {
  const domainMaximum = Math.max(1, Math.floor(Number(maximum) || 0))
  const midpoint = Math.ceil(domainMaximum / 2)
  return [...new Set([domainMaximum, midpoint, 0])]
}

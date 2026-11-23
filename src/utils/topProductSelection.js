import { groupByUnit } from './unitAwareMetrics.js'

const MAX_PRODUCT_SELECTIONS = 5

function idOf(product) {
  return product?.product_id === undefined || product?.product_id === null
    ? ''
    : String(product.product_id)
}

function salesAmount(product) {
  return Number(product.gross_sales ?? product.sales_amount) || 0
}

function compareProducts(left, right) {
  return Number(right.quantity_sold) - Number(left.quantity_sold)
    || salesAmount(right) - salesAmount(left)
    || String(left.product_name).localeCompare(String(right.product_name))
    || idOf(left).localeCompare(idOf(right))
}

export function selectTopProductsByUnit(products, limit = MAX_PRODUCT_SELECTIONS) {
  const maximum = Math.min(MAX_PRODUCT_SELECTIONS, Math.max(0, Math.floor(Number(limit) || 0)))
  if (!maximum || !Array.isArray(products)) return []

  const eligibleProducts = products.filter((product) => (
    idOf(product)
    && Number.isFinite(Number(product.quantity_sold))
    && Number(product.quantity_sold) > 0
  ))
  const unitGroups = groupByUnit(eligibleProducts).map(({ items }) => (
    [...items].sort(compareProducts)
  ))
  const selected = []
  const selectedIds = new Set()

  // Rotate through independently ranked unit groups instead of comparing kg, trays, and pieces.
  for (let rank = 0; selected.length < maximum; rank += 1) {
    let foundAtRank = false
    for (const unitProducts of unitGroups) {
      const product = unitProducts[rank]
      if (!product) continue
      foundAtRank = true
      const id = idOf(product)
      if (selectedIds.has(id)) continue
      selected.push(product)
      selectedIds.add(id)
      if (selected.length === maximum) break
    }
    if (!foundAtRank) break
  }

  return selected
}

export function rankingsForYear(productsByYear, year, fallbackProducts = []) {
  const annualRankings = productsByYear.filter((product) => Number(product.sale_year) === Number(year))
  return annualRankings.length ? annualRankings : fallbackProducts
}

export function resolveProductSelection(selectedIds, defaultProducts, availableProducts) {
  const defaults = defaultProducts
    .map((product) => typeof product === 'object' ? idOf(product) : String(product))
    .filter(Boolean)
  const requested = selectedIds === null ? defaults : selectedIds.map(String)
  const availableIds = new Set(availableProducts.map(idOf).filter(Boolean))
  return [...new Set(requested.filter((id) => availableIds.has(id)))].slice(0, MAX_PRODUCT_SELECTIONS)
}

export function toggleProductSelection(selectedIds, productId) {
  const id = String(productId)
  if (selectedIds.includes(id)) return selectedIds.filter((selectedId) => selectedId !== id)
  if (selectedIds.length >= MAX_PRODUCT_SELECTIONS) return selectedIds
  return [...selectedIds, id]
}

export const maxProductSelections = MAX_PRODUCT_SELECTIONS

import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { productCategories } from '../../utils/constants.js'
import { peso } from '../../utils/currency.js'

const columns = [
  'Product Name',
  'Category',
  'Selling Price',
  'Current Stock',
  'Reorder Level',
  'Status',
  'Actions',
]

const sortAccessors = [
  (product) => product.product_name,
  (product) => product.category,
  (product) => Number(product.selling_price),
  (product) => Number(product.stock_quantity),
  (product) => Number(product.reorder_level),
  (product) => product.status,
  () => '',
]

function normalizeCategory(category = '') {
  return category.toLowerCase().replaceAll('&', 'and').replace(/\s+/g, ' ').trim()
}

function ProductList({ products, loading, error, onEdit }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const normalizedCategory = normalizeCategory(category)

    return products.filter((product) => {
      const matchesCategory = category === 'All'
        || normalizeCategory(product.category) === normalizedCategory
      const matchesSearch = !normalizedQuery
        || Object.values(product).join(' ').toLowerCase().includes(normalizedQuery)

      return matchesCategory && matchesSearch
    })
  }, [category, products, query])

  if (loading) {
    return <LoadingSpinner />
  }

  if (error) {
    return <EmptyState>{error}</EmptyState>
  }

  if (!products.length) {
    return <EmptyState>No active products found.</EmptyState>
  }

  return (
    <div className="inventory-product-list">
      <div className="inventory-product-controls">
        <label className="table-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            placeholder="Search products"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search products"
          />
        </label>
        <select
          className="inventory-category-filter"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter products by category"
        >
          {productCategories.map((productCategory) => (
            <option key={productCategory} value={productCategory}>
              {productCategory === 'All' ? 'All Categories' : productCategory}
            </option>
          ))}
        </select>
        <span className="inventory-result-count" aria-live="polite">
          {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'products'}
        </span>
      </div>
      <DataTable
        key={`${category}:${query}`}
        columns={columns}
        rows={filteredProducts}
        searchable={false}
        getSortValue={(product, columnIndex) => sortAccessors[columnIndex](product)}
        renderRow={(product) => (
          <tr
            key={product.product_id}
            className={`inventory-product-row ${product.status.toLowerCase().replaceAll(' ', '-')}`}
          >
            <td><strong className="inventory-product-name">{product.product_name}</strong></td>
            <td><span className="inventory-product-category">{product.category}</span></td>
            <td><strong className="inventory-money-value">{peso.format(Number(product.selling_price))}</strong></td>
            <td>
              <strong className="inventory-stock-value">{Number(product.stock_quantity)}</strong>{' '}
              <span className="inventory-unit">{product.unit}</span>
            </td>
            <td>
              {Number(product.reorder_level)} <span className="inventory-unit">{product.unit}</span>
            </td>
            <td>
              <StatusBadge value={product.status} />
            </td>
            <td>
              <button
                className="table-action"
                type="button"
                onClick={() => onEdit(product)}
                aria-label={`Edit ${product.product_name}`}
              >
                Edit
              </button>
            </td>
          </tr>
        )}
      />
    </div>
  )
}

export default ProductList

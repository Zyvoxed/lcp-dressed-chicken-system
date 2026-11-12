import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import Modal from '../Shared/Modal.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
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

const archivedColumns = [
  'Product Name',
  'Category',
  'Selling Price',
  'Stock Quantity',
  'Archived Status',
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

const archivedSortAccessors = [
  (product) => product.product_name,
  (product) => product.category,
  (product) => Number(product.selling_price),
  (product) => Number(product.stock_quantity),
  () => 'Archived',
  () => '',
]

function normalizeCategory(category = '') {
  return category.toLowerCase().replaceAll('&', 'and').replace(/\s+/g, ' ').trim()
}

function ProductList({ products, loading, error, onEdit, onArchive }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [productToArchive, setProductToArchive] = useState(null)
  const [archiveError, setArchiveError] = useState('')
  const [archiving, setArchiving] = useState(false)

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
    return <PageSkeleton variant="inventory-products" label="inventory products" />
  }

  if (error) {
    return <EmptyState>{error}</EmptyState>
  }

  if (!products.length) {
    return <EmptyState>No active products found.</EmptyState>
  }

  async function confirmArchive() {
    if (!productToArchive || !onArchive) return

    setArchiveError('')
    setArchiving(true)

    try {
      await onArchive(productToArchive)
      setProductToArchive(null)
    } catch (requestError) {
      setArchiveError(requestError.message)
    } finally {
      setArchiving(false)
    }
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
              <button
                className="table-action danger"
                type="button"
                onClick={() => setProductToArchive(product)}
                aria-label={`Archive ${product.product_name}`}
              >
                Archive
              </button>
            </td>
          </tr>
        )}
      />
      {productToArchive && (
        <Modal title="Archive Product" onClose={() => { if (!archiving) setProductToArchive(null) }} className="user-confirmation-modal">
          <p>Archive <strong>{productToArchive.product_name}</strong> from active inventory?</p>
          <p>Archiving removes this product from active inventory and POS listings. Historical transaction records remain preserved.</p>
          <p><strong>Note:</strong> this product cannot be archived while stock remains on hand. Resolve remaining inventory before archiving it.</p>
          {archiveError && <p className="form-error" role="alert">{archiveError}</p>}
          <div className="user-confirmation-actions">
            <button className="secondary-action" type="button" onClick={() => setProductToArchive(null)} disabled={archiving}>Cancel</button>
            <button className="primary-action danger" type="button" onClick={confirmArchive} disabled={archiving}>
              {archiving ? 'Archiving...' : 'Archive Product'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function ArchivedProductList({ products, loading, error, onRestore }) {
  const [productToRestore, setProductToRestore] = useState(null)
  const [restoreError, setRestoreError] = useState('')
  const [restoring, setRestoring] = useState(false)

  if (loading) {
    return <PageSkeleton variant="inventory-products" label="archived products" />
  }

  if (error) {
    return <EmptyState>{error}</EmptyState>
  }

  if (!products.length) {
    return <EmptyState>No archived products found.</EmptyState>
  }

  async function confirmRestore() {
    if (!productToRestore || !onRestore) return

    setRestoreError('')
    setRestoring(true)

    try {
      await onRestore(productToRestore)
      setProductToRestore(null)
    } catch (requestError) {
      setRestoreError(requestError.message)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="inventory-product-list">
      <DataTable
        columns={archivedColumns}
        rows={products}
        searchable={false}
        getSortValue={(product, columnIndex) => archivedSortAccessors[columnIndex](product)}
        renderRow={(product) => (
          <tr key={product.product_id} className="inventory-product-row archived-product">
            <td><strong className="inventory-product-name">{product.product_name}</strong></td>
            <td><span className="inventory-product-category">{product.category}</span></td>
            <td><strong className="inventory-money-value">{peso.format(Number(product.selling_price))}</strong></td>
            <td>
              <strong className="inventory-stock-value">{Number(product.stock_quantity)}</strong>{' '}
              <span className="inventory-unit">{product.unit}</span>
            </td>
            <td><StatusBadge value="Archived" /></td>
            <td>
              <button
                className="table-action success"
                type="button"
                onClick={() => setProductToRestore(product)}
                aria-label={`Restore ${product.product_name}`}
              >
                Restore
              </button>
            </td>
          </tr>
        )}
      />
      {productToRestore && (
        <Modal title="Restore Product" onClose={() => { if (!restoring) setProductToRestore(null) }} className="user-confirmation-modal">
          <p>Restore <strong>{productToRestore.product_name}</strong> to active inventory?</p>
          <p>Restoring the product makes it available again in active inventory and eligible selection areas.</p>
          {restoreError && <p className="form-error" role="alert">{restoreError}</p>}
          <div className="user-confirmation-actions">
            <button className="secondary-action" type="button" onClick={() => setProductToRestore(null)} disabled={restoring}>Cancel</button>
            <button className="primary-action" type="button" onClick={confirmRestore} disabled={restoring}>
              {restoring ? 'Restoring...' : 'Restore Product'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default ProductList

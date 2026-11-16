import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import ProductCard from './ProductCard.jsx'

function ProductGrid({ products, onAdd, sortBy = 'name-asc', onSortChange }) {
  function handleSort(column) {
    if (!onSortChange) return
    if (column === 'name') {
      onSortChange(sortBy === 'name-asc' ? 'name-desc' : 'name-asc')
    } else if (column === 'price') {
      onSortChange(sortBy === 'price-asc' ? 'price-desc' : 'price-asc')
    } else if (column === 'stock') {
      onSortChange(sortBy === 'stock-desc' ? 'stock-asc' : 'stock-desc')
    }
  }

  function getSortIcon(column) {
    if (column === 'name') {
      if (sortBy === 'name-asc') return <ArrowUp size={13} className="pos-sort-icon active" aria-hidden="true" />
      if (sortBy === 'name-desc') return <ArrowDown size={13} className="pos-sort-icon active" aria-hidden="true" />
      return <ArrowUpDown size={13} className="pos-sort-icon neutral" aria-hidden="true" />
    }
    if (column === 'price') {
      if (sortBy === 'price-asc') return <ArrowUp size={13} className="pos-sort-icon active" aria-hidden="true" />
      if (sortBy === 'price-desc') return <ArrowDown size={13} className="pos-sort-icon active" aria-hidden="true" />
      return <ArrowUpDown size={13} className="pos-sort-icon neutral" aria-hidden="true" />
    }
    if (column === 'stock') {
      if (sortBy === 'stock-desc') return <ArrowDown size={13} className="pos-sort-icon active" aria-hidden="true" />
      if (sortBy === 'stock-asc') return <ArrowUp size={13} className="pos-sort-icon active" aria-hidden="true" />
      return <ArrowUpDown size={13} className="pos-sort-icon neutral" aria-hidden="true" />
    }
    return null
  }

  function getAriaSort(column) {
    if (column === 'name') {
      return sortBy === 'name-asc' ? 'ascending' : sortBy === 'name-desc' ? 'descending' : 'none'
    }
    if (column === 'price') {
      return sortBy === 'price-asc' ? 'ascending' : sortBy === 'price-desc' ? 'descending' : 'none'
    }
    if (column === 'stock') {
      return sortBy === 'stock-asc' ? 'ascending' : sortBy === 'stock-desc' ? 'descending' : 'none'
    }
    return undefined
  }

  return (
    <div className="pos-product-table-wrap" role="region" aria-label="Product catalog" tabIndex={0}>
      <table className="pos-product-table">
        <thead>
          <tr>
            <th scope="col" aria-sort={getAriaSort('name')} className="pos-th-sortable">
              <button
                type="button"
                className="pos-th-sort-btn"
                onClick={() => handleSort('name')}
                title="Sort by Product Name"
              >
                <span>Product Name</span>
                {getSortIcon('name')}
              </button>
            </th>
            <th scope="col" aria-sort={getAriaSort('price')} className="pos-th-sortable">
              <button
                type="button"
                className="pos-th-sort-btn"
                onClick={() => handleSort('price')}
                title="Sort by Selling Price"
              >
                <span>Selling Price</span>
                {getSortIcon('price')}
              </button>
            </th>
            <th scope="col">Unit</th>
            <th scope="col" aria-sort={getAriaSort('stock')} className="pos-th-sortable">
              <button
                type="button"
                className="pos-th-sort-btn"
                onClick={() => handleSort('stock')}
                title="Sort by Available Stock"
              >
                <span>Available Stock</span>
                {getSortIcon('stock')}
              </button>
            </th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <ProductCard key={product.product_id} product={product} onAdd={onAdd} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ProductGrid

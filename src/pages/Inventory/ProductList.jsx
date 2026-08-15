import { useEffect, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { getProducts } from '../../services/productService.js'
import { peso } from '../../utils/currency.js'

const columns = [
  'Product Name',
  'Category',
  'Selling Price',
  'In Stock Level',
  'Reorder Threshold',
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

function ProductList() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadProducts() {
      try {
        const data = await getProducts({ signal: controller.signal })
        setProducts(data)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    loadProducts()

    return () => controller.abort()
  }, [])

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
    <DataTable
      columns={columns}
      rows={products}
      getSortValue={(product, columnIndex) => sortAccessors[columnIndex](product)}
      renderRow={(product) => (
        <tr key={product.product_id}>
          <td>{product.product_name}</td>
          <td>{product.category}</td>
          <td>{peso.format(Number(product.selling_price))}</td>
          <td>{Number(product.stock_quantity)} {product.unit}</td>
          <td>{Number(product.reorder_level)} {product.unit}</td>
          <td>
            <StatusBadge value={product.status} />
          </td>
          <td>
            <button className="table-action" type="button">
              Edit
            </button>
          </td>
        </tr>
      )}
    />
  )
}

export default ProductList

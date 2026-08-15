import { useState } from 'react'
import SearchBar from '../Shared/SearchBar.jsx'
import CategoryFilter from './CategoryFilter.jsx'
import ProductGrid from './ProductGrid.jsx'
import SalesBasket from './SalesBasket.jsx'
import { products } from '../../data/products.js'

function RecordSales() {
  const [category, setCategory] = useState('All')
  const visibleProducts = category === 'All' ? products : products.filter((product) => product[1] === category)

  return (
    <section className="sales-layout">
      <article className="panel catalog-panel">
        <div className="section-heading">
          <p>PRODUCT CATALOG (SALES POS)</p>
          <span>{visibleProducts.length} product lines</span>
        </div>
        <SearchBar placeholder="Search product catalog" />
        <CategoryFilter category={category} onCategory={setCategory} />
        <ProductGrid products={visibleProducts} />
      </article>
      <SalesBasket />
    </section>
  )
}

export default RecordSales

import { BarChart3 } from "lucide-react";
import EmptyState from "../Shared/EmptyState.jsx";
function ProductSalesPerformanceChart({ products }) {
  const chartProducts = products.filter(
    (product) => Number(product.quantity_sold) > 0,
  );
  const maximum = Math.max(
    ...chartProducts.map((product) => Number(product.quantity_sold)),
    1,
  );
  return (
    <article className="panel product-performance-chart">
      <header>
        <div>
          <h2>
            <BarChart3 size={17} />
            PRODUCT SALES
          </h2>
          <p>Total quantity sold by product</p>
        </div>
        <span>QUANTITY SOLD</span>
      </header>
      {!chartProducts.length ? (
        <EmptyState>No product sales data yet.</EmptyState>
      ) : (
        <div
          className="analytics-bar-chart"
          role="group"
          aria-label="Product sales volume chart"
        >
          {chartProducts.map((product, index) => (
            <div
              className="analytics-bar-column"
              key={product.product_id}
              role="img"
              tabIndex={0}
              aria-label={`${product.product_name}: ${Number(product.quantity_sold)} ${product.unit}`}
              data-tooltip={`${product.product_name}: ${Number(product.quantity_sold)} ${product.unit}`}
            >
              <span>{Number(product.quantity_sold)}</span>
              <div
                className={index === 0 ? "leading" : ""}
                style={{
                  height: `${Math.max((Number(product.quantity_sold) / maximum) * 100, 3)}%`,
                }}
              />
              <small title={product.product_name}>{product.product_name}</small>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
export default ProductSalesPerformanceChart;

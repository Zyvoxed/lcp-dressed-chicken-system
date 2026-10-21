import EmptyState from "../Shared/EmptyState.jsx";
import LoadingSpinner from "../Shared/LoadingSpinner.jsx";
import Modal from "../Shared/Modal.jsx";
import StatusBadge from "../Shared/StatusBadge.jsx";
import { peso } from "../../utils/currency.js";

function SummaryMetrics({ rows }) {
  return (
    <div className="dashboard-detail-summary">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <strong title={row.value}>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function DetailTable({ columns, children }) {
  return (
    <div className="dashboard-detail-table-wrap">
      <table className="system-data-table dashboard-detail-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="dashboard-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function SalesDetails({ dashboard }) {
  const { summary, top_products: products } = dashboard;

  return (
    <div className="dashboard-kpi-modal">
      <SummaryMetrics
        rows={[
          {
            label: "Total Sales Revenue",
            value: peso.format(Number(summary.total_revenue)),
          },
          {
            label: "Total Transactions",
            value: String(summary.total_transactions),
          },
          {
            label: "Average Sale Value",
            value: peso.format(Number(summary.average_sale_value)),
          },
          {
            label: "Best-Selling Product",
            value: summary.best_seller || "No sales recorded",
          },
        ]}
      />
      <DetailSection title="Top-Selling Products">
        {!products.length ? (
          <EmptyState>No product sales recorded.</EmptyState>
        ) : (
          <DetailTable columns={["Product", "Quantity Sold", "Sales Amount"]}>
            {products.map((product) => (
              <tr key={product.product_id}>
                <td>{product.product_name}</td>
                <td>
                  {Number(product.quantity_sold)} {product.unit}
                </td>
                <td className="dashboard-detail-money">
                  {peso.format(Number(product.sales_amount))}
                </td>
              </tr>
            ))}
          </DetailTable>
        )}
      </DetailSection>
    </div>
  );
}

function ProductDetails({ dashboard, resource }) {
  const products = resource.data;
  const loaded = resource.status === "loaded";
  const availableCount = loaded
    ? products.filter((product) => Number(product.stock_quantity) > 0).length
    : null;
  const outOfStockCount = loaded
    ? products.filter((product) => Number(product.stock_quantity) <= 0).length
    : null;

  return (
    <div className="dashboard-kpi-modal">
      <SummaryMetrics
        rows={[
          {
            label: "Total Active Products",
            value: String(dashboard.summary.total_products),
          },
          {
            label: "Low Stock Products",
            value: String(dashboard.summary.low_stock_count),
          },
          {
            label: "Products with Stock",
            value: availableCount === null ? "—" : String(availableCount),
          },
          {
            label: "Out-of-Stock Products",
            value: outOfStockCount === null ? "—" : String(outOfStockCount),
          },
        ]}
      />
      <DetailSection title="Active Product Inventory">
        {(resource.status === "idle" || resource.status === "loading") && (
          <LoadingSpinner />
        )}
        {resource.status === "error" && (
          <EmptyState>{resource.error}</EmptyState>
        )}
        {loaded && !products.length && (
          <EmptyState>No active products found.</EmptyState>
        )}
        {loaded && products.length > 0 && (
          <DetailTable
            columns={[
              "Product",
              "Category",
              "Available Stock",
              "Reorder Level",
              "Status",
            ]}
          >
            {products.map((product) => (
              <tr key={product.product_id}>
                <td>{product.product_name}</td>
                <td>{product.category}</td>
                <td>
                  {Number(product.stock_quantity)} {product.unit}
                </td>
                <td>
                  {Number(product.reorder_level)} {product.unit}
                </td>
                <td>
                  <StatusBadge value={product.status} />
                </td>
              </tr>
            ))}
          </DetailTable>
        )}
      </DetailSection>
    </div>
  );
}

function LowStockDetails({ dashboard }) {
  const products = dashboard.low_stock_alerts;

  return (
    <div className="dashboard-kpi-modal">
      <SummaryMetrics
        rows={[
          {
            label: "Total Low Stock Products",
            value: String(dashboard.summary.low_stock_count),
          },
        ]}
      />
      <DetailSection title="Products Requiring Attention">
        {!products.length ? (
          <EmptyState>No low-stock products found.</EmptyState>
        ) : (
          <DetailTable
            columns={["Product", "Current Stock", "Reorder Level", "Status"]}
          >
            {products.map((product) => (
              <tr key={product.product_id}>
                <td>{product.product_name}</td>
                <td>
                  {Number(product.stock_quantity)} {product.unit}
                </td>
                <td>
                  {Number(product.reorder_level)} {product.unit}
                </td>
                <td>
                  <StatusBadge value={product.status} />
                </td>
              </tr>
            ))}
          </DetailTable>
        )}
      </DetailSection>
    </div>
  );
}

function ReceivablesDetails({ dashboard, resource }) {
  const customers = resource.data.filter(
    (customer) => Number(customer.current_balance) > 0,
  );
  const loaded = resource.status === "loaded";

  return (
    <div className="dashboard-kpi-modal">
      <SummaryMetrics
        rows={[
          {
            label: "Total Outstanding Balance",
            value: peso.format(Number(dashboard.summary.customer_credits)),
          },
          {
            label: "Customers with Outstanding Balances",
            value: loaded ? String(customers.length) : "—",
          },
        ]}
      />
      <DetailSection title="Outstanding Customer Balances">
        {(resource.status === "idle" || resource.status === "loading") && (
          <LoadingSpinner />
        )}
        {resource.status === "error" && (
          <EmptyState>{resource.error}</EmptyState>
        )}
        {loaded && !customers.length && (
          <EmptyState>No customers have unpaid balances.</EmptyState>
        )}
        {loaded && customers.length > 0 && (
          <DetailTable columns={["Customer", "Outstanding Balance"]}>
            {customers.map((customer) => (
              <tr key={customer.customer_id}>
                <td>{customer.customer_name}</td>
                <td className="dashboard-detail-money">
                  {peso.format(Number(customer.current_balance))}
                </td>
              </tr>
            ))}
          </DetailTable>
        )}
      </DetailSection>
    </div>
  );
}

const titles = {
  sales: "Sales Summary",
  products: "Product Inventory Summary",
  lowStock: "Low Stock Summary",
  receivables: "Customer Receivables Summary",
};

function DashboardKpiModal({
  activeKpi,
  dashboard,
  productResource,
  customerResource,
  onClose,
}) {
  if (!activeKpi) return null;

  return (
    <Modal
      title={titles[activeKpi]}
      onClose={onClose}
      className="dashboard-detail-modal"
    >
      {activeKpi === "sales" && <SalesDetails dashboard={dashboard} />}
      {activeKpi === "products" && (
        <ProductDetails dashboard={dashboard} resource={productResource} />
      )}
      {activeKpi === "lowStock" && <LowStockDetails dashboard={dashboard} />}
      {activeKpi === "receivables" && (
        <ReceivablesDetails dashboard={dashboard} resource={customerResource} />
      )}
    </Modal>
  );
}

export default DashboardKpiModal;

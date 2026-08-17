import { useEffect, useMemo, useState } from "react";
import DataTable from "../Shared/DataTable.jsx";
import EmptyState from "../Shared/EmptyState.jsx";
import LoadingSpinner from "../Shared/LoadingSpinner.jsx";
import StatusBadge from "../Shared/StatusBadge.jsx";
import {
  getInventoryReport,
  logReportExport,
} from "../../services/reportService.js";
import { exportCsv } from "../../utils/csvExport.js";
import { peso } from "../../utils/currency.js";

const colors = ["#f97316", "#60a5fa", "#22c55e", "#facc15", "#a78bfa"];

function InventoryValuation() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getInventoryReport({ signal: controller.signal })
      .then(setReport)
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const categories = useMemo(() => {
    if (!report) return [];
    const values = new Map();
    report.records.forEach((product) =>
      values.set(
        product.category,
        (values.get(product.category) || 0) +
          Number(product.inventory_cost_value),
      ),
    );
    return [...values.entries()];
  }, [report]);

  async function download() {
    try {
      await logReportExport("Inventory Valuation");
    } catch (logError) {
      console.error(logError.message);
    }
    exportCsv(
      `inventory-report-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Product",
        "Category",
        "Unit",
        "Stock Quantity",
        "Cost Value",
        "Estimated Sales Value",
        "Status",
      ],
      report.records.map((product) => [
        product.product_name,
        product.category,
        product.unit,
        product.stock_quantity,
        product.inventory_cost_value,
        product.estimated_sales_value,
        product.status,
      ]),
    );
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <EmptyState>{error}</EmptyState>;
  if (!report) return <EmptyState>No inventory report data found.</EmptyState>;

  const totalCost = Number(report.summary.total_inventory_cost_value);
  let offset = 0;
  const gradient =
    totalCost > 0
      ? categories
          .map(([, value], index) => {
            const start = offset;
            offset += (Number(value) / totalCost) * 100;
            return `${colors[index % colors.length]} ${start}% ${offset}%`;
          })
          .join(", ")
      : "var(--surface-inset) 0 100%";

  return (
    <section className="report-layout">
      <article className="panel table-panel">
        <div className="panel-title-row">
          <h2>INVENTORY ASSETS VALUATION</h2>
          <button
            className="primary-action slim"
            type="button"
            onClick={download}
          >
            Export CSV
          </button>
        </div>
        {!report.records.length ? (
          <EmptyState>No active inventory products found.</EmptyState>
        ) : (
          <DataTable
            columns={[
              "Product",
              "Category",
              "Unit",
              "Stock",
              "Reorder Level",
              "Cost Value",
              "Estimated Sales Value",
              "Status",
            ]}
            rows={report.records}
            getSortValue={(product, index) =>
              [
                product.product_name,
                product.category,
                product.unit,
                Number(product.stock_quantity),
                Number(product.reorder_level),
                Number(product.inventory_cost_value),
                Number(product.estimated_sales_value),
                product.status,
              ][index]
            }
            renderRow={(product) => (
              <tr key={product.product_id}>
                <td>{product.product_name}</td>
                <td>{product.category}</td>
                <td>{product.unit}</td>
                <td>{Number(product.stock_quantity)}</td>
                <td>{Number(product.reorder_level)}</td>
                <td>{peso.format(Number(product.inventory_cost_value))}</td>
                <td>{peso.format(Number(product.estimated_sales_value))}</td>
                <td>
                  <StatusBadge value={product.status} />
                </td>
              </tr>
            )}
          />
        )}
      </article>
      <aside className="panel donut-panel">
        <div
          className="donut-wrap"
          tabIndex="0"
          data-tooltip={`FIFO remaining inventory cost: ${peso.format(totalCost)}`}
        >
          <div
            className="donut"
            style={{ background: `conic-gradient(${gradient})` }}
            role="img"
            aria-label="Inventory cost valuation mix by product category"
          ></div>
        </div>
        {categories.map(([label, value], index) => (
          <p key={label}>
            <span style={{ color: colors[index % colors.length] }}>●</span>{" "}
            {label}: {peso.format(Number(value))}
          </p>
        ))}
        <p>Total products: {report.summary.total_products}</p>
        <p>FIFO cost value: {peso.format(totalCost)}</p>
        <p>
          Estimated sales value:{" "}
          {peso.format(Number(report.summary.estimated_total_sales_value))}
        </p>
        <p>
          Low stock: {report.summary.low_stock_count} · Out of stock:{" "}
          {report.summary.out_of_stock_count}
        </p>
      </aside>
    </section>
  );
}

export default InventoryValuation;

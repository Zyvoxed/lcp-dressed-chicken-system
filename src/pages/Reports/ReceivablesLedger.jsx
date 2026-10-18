import { useEffect, useState } from "react";
import DataTable from "../Shared/DataTable.jsx";
import EmptyState from "../Shared/EmptyState.jsx";
import LoadingSpinner from "../Shared/LoadingSpinner.jsx";
import {
  getReceivablesReport,
  logReportExport,
} from "../../services/reportService.js";
import { exportCsv } from "../../utils/csvExport.js";
import { peso } from "../../utils/currency.js";
import { formatLocalDate } from "../../utils/dateFormatter.js";

function ReceivablesLedger() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getReceivablesReport({ signal: controller.signal })
      .then(setReport)
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function download() {
    try {
      await logReportExport("Credit Receivables");
    } catch (logError) {
      console.error(logError.message);
    }
    exportCsv(
      `receivables-report-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Customer",
        "Contact Number",
        "Address",
        "Outstanding Balance",
        "Unpaid Credit Sales",
        "Oldest Unpaid Sale",
      ],
      report.records.map((customer) => [
        customer.customer_name,
        customer.contact_number,
        customer.address,
        customer.current_balance,
        customer.open_credit_sales,
        customer.oldest_unpaid_sale_date || "",
      ]),
    );
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <EmptyState>{error}</EmptyState>;
  if (!report)
    return <EmptyState>No receivables report data found.</EmptyState>;

  return (
    <article className="panel table-panel report-table-panel receivables-report-panel">
      <div className="panel-title-row">
        <h2>UNPAID CUSTOMER BALANCES</h2>
        <button
          className="primary-action slim"
          type="button"
          onClick={download}
        >
          Export CSV
        </button>
      </div>
      <p className="report-summary-line">
        {report.summary.customers_with_balance} customers ·{" "}
        {peso.format(Number(report.summary.total_receivables))} outstanding
      </p>
      {!report.records.length ? (
        <EmptyState>No customers have unpaid balances.</EmptyState>
      ) : (
        <DataTable
          columns={[
            "Customer Name",
            "Phone",
            "Address",
            "Outstanding Balance",
            "Unpaid Credit Sales",
            "Oldest Unpaid Sale",
          ]}
          rows={report.records}
          getSortValue={(customer, index) =>
            [
              customer.customer_name,
              customer.contact_number,
              customer.address,
              Number(customer.current_balance),
              Number(customer.open_credit_sales),
              customer.oldest_unpaid_sale_date,
            ][index]
          }
          renderRow={(customer) => (
            <tr key={customer.customer_id}>
              <td>{customer.customer_name}</td>
              <td>{customer.contact_number || "—"}</td>
              <td>{customer.address || "—"}</td>
              <td className="highlight-money">
                {peso.format(Number(customer.current_balance))}
              </td>
              <td>{customer.open_credit_sales}</td>
              <td>
                {customer.oldest_unpaid_sale_date
                  ? formatLocalDate(
                      new Date(customer.oldest_unpaid_sale_date),
                    )
                  : "—"}
              </td>
            </tr>
          )}
        />
      )}
    </article>
  );
}

export default ReceivablesLedger;

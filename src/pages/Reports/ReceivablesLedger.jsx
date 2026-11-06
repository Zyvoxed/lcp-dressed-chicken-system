import { useEffect, useRef, useState } from "react";
import DataTable from "../Shared/DataTable.jsx";
import EmptyState from "../Shared/EmptyState.jsx";
import LoadingSpinner from "../Shared/LoadingSpinner.jsx";
import StatCard from "../Shared/StatCard.jsx";
import StatusBadge from "../Shared/StatusBadge.jsx";
import { UsersRound, WalletCards } from "lucide-react";
import {
  getReceivablesReport,
  getSalesReport,
  getSalesReportDetail,
  logReportExport,
} from "../../services/reportService.js";
import { exportCsv, manilaDateStamp } from "../../utils/csvExport.js";
import { peso } from "../../utils/currency.js";
import { formatActivityTimestamp } from "../../utils/activityDateTime.js";

const emptyHistoricalFilters = {
  start_date: "",
  end_date: "",
  payment_type: "Credit",
};

function isValidCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function cents(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error(`Unable to calculate ${label} from the returned sales data.`);
  }
  return Math.round(amount * 100);
}

function historicalDateRange(filters) {
  if (filters.start_date && !isValidCalendarDate(filters.start_date)) {
    throw new Error("Select a valid start date.");
  }
  if (filters.end_date && !isValidCalendarDate(filters.end_date)) {
    throw new Error("Select a valid end date.");
  }
  if (filters.start_date && filters.end_date && filters.start_date > filters.end_date) {
    throw new Error("Start date cannot be after end date.");
  }
  return {
    ...(filters.start_date ? { start_date: filters.start_date } : {}),
    ...(filters.end_date ? { end_date: filters.end_date } : {}),
  };
}

async function loadHistoricalRecords(filters, signal) {
  const report = await getSalesReport(
    { ...filters, payment_type: "Credit" },
    { signal },
  );
  const uniqueSales = new Map();
  for (const sale of report.records ?? []) {
    if (sale.payment_type === "Credit") {
      uniqueSales.set(String(sale.sale_id), sale);
    }
  }

  return Promise.all([...uniqueSales.values()].map(async (sale) => {
    const details = await getSalesReportDetail(sale.sale_id, { signal });
    if (!details?.sale || Number(details.sale.sale_id) !== Number(sale.sale_id)) {
      throw new Error(`Unable to verify details for credit sale ${sale.sale_id}.`);
    }
    if (!Array.isArray(details.payments)) {
      throw new Error(`Unable to verify payment history for credit sale ${sale.sale_id}.`);
    }

    const originalAmountCents = cents(sale.total_amount, "the original credit amount");
    const paidToDateCents = cents(details.sale.amount_paid, "the initial amount paid");
    const laterPaymentsCents = details.payments.reduce(
      (total, payment) => total + cents(payment.payment_amount, "the initial amount paid"),
      0,
    );
    const initialPaidCents = paidToDateCents - laterPaymentsCents;
    if (initialPaidCents < 0 || initialPaidCents > originalAmountCents) {
      throw new Error(`Unable to calculate the initial amount paid for credit sale ${sale.sale_id}.`);
    }

    return {
      ...sale,
      customer_id: details.sale.customer_id,
      amount_initially_paid: (initialPaidCents / 100).toFixed(2),
    };
  }));
}

function ReceivablesLedger() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [historicalFilters, setHistoricalFilters] = useState(emptyHistoricalFilters);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalRecords, setHistoricalRecords] = useState(null);
  const [historicalPeriod, setHistoricalPeriod] = useState("");
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState("");
  const historicalController = useRef(null);

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
    return () => {
      controller.abort();
      historicalController.current?.abort();
    };
  }, []);

  async function applyHistoricalFilter(event) {
    event.preventDefault();
    setHistoricalError("");

    let dateRange;
    try {
      dateRange = historicalDateRange(historicalFilters);
    } catch (validationError) {
      setHistoricalError(validationError.message);
      return;
    }

    historicalController.current?.abort();
    const controller = new AbortController();
    historicalController.current = controller;
    setHistoricalLoading(true);

    try {
      const records = await loadHistoricalRecords(dateRange, controller.signal);
      setHistoricalRecords(records);
      setHistoricalPeriod(
        dateRange.start_date || dateRange.end_date
          ? `${dateRange.start_date || "Beginning"} to ${dateRange.end_date || "Present"}`
          : "All dates",
      );
      setHistoricalMode(true);
      setHistoricalError("");
    } catch (requestError) {
      if (requestError.name !== "AbortError") setHistoricalError(requestError.message);
    } finally {
      if (!controller.signal.aborted) setHistoricalLoading(false);
    }
  }

  function clearHistoricalFilter() {
    historicalController.current?.abort();
    setHistoricalFilters(emptyHistoricalFilters);
    setHistoricalMode(false);
    setHistoricalRecords(null);
    setHistoricalPeriod("");
    setHistoricalLoading(false);
    setHistoricalError("");
  }

  async function download() {
    if (historicalMode && !historicalRecords) return;

    try {
      await logReportExport("Credit Receivables");
    } catch (logError) {
      console.error(logError.message);
    }

    if (historicalMode) {
      exportCsv(
        `historical-credit-report-${manilaDateStamp()}.csv`,
        [
          "Sale ID",
          "Transaction Date",
          "Customer",
          "Original Credit Amount",
          "Amount Initially Paid",
          "Current Remaining Balance",
          "Current Payment Status",
        ],
        historicalRecords.map((sale) => [
          `OR-${sale.sale_id}`,
          formatActivityTimestamp(sale.sale_date).dateTime,
          sale.customer_name,
          sale.total_amount,
          sale.amount_initially_paid,
          sale.remaining_balance,
          sale.status,
        ]),
      );
      return;
    }

    exportCsv(
      `receivables-report-${manilaDateStamp()}.csv`,
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
        customer.oldest_unpaid_sale_date
          ? formatActivityTimestamp(customer.oldest_unpaid_sale_date).dateTime
          : "",
      ]),
    );
  }

  if (loading) return <PageSkeleton variant="report-receivables" label="credit receivables ledger" />;
  if (error) return <EmptyState>{error}</EmptyState>;
  if (!report) return <EmptyState>No receivables report data found.</EmptyState>;

  const tableRows = historicalMode ? historicalRecords ?? [] : report.records;
  const tableColumns = historicalMode
    ? [
      "Sale ID",
      "Transaction Date",
      "Customer Name",
      "Original Credit Amount",
      "Amount Initially Paid",
      "Current Remaining Balance",
      "Current Payment Status",
    ]
    : [
      "Customer Name",
      "Phone",
      "Address",
      "Open Credit Total",
      "Outstanding Balance",
      "Unpaid Credit Sales",
      "Oldest Unpaid Sale",
    ];
  const historicalCreditTotal = historicalMode
    ? peso.format(
      historicalRecords.reduce(
        (totalCents, sale) => totalCents + cents(sale.total_amount, "the original credit amount"),
        0,
      ) / 100,
    )
    : null;
  return (
    <div className="report-tab-content">
      <div className="stats-grid report-stats report-receivables-stats">
        <StatCard
          icon={UsersRound}
          label={historicalMode ? "Credit Transactions" : "Current Customers with Balance"}
          value={historicalMode
            ? historicalRecords.length.toLocaleString("en-PH")
            : Number(report.summary.customers_with_balance).toLocaleString("en-PH")}
        />
        <StatCard
          icon={WalletCards}
          label={historicalMode ? "Total Credit Sales" : "Current Total Receivables"}
          value={historicalMode
            ? historicalCreditTotal
            : peso.format(Number(report.summary.total_receivables))}
        />
      </div>
      <section className="report-layout receivables-report-layout">
        <article className="panel table-panel report-table-panel receivables-report-panel">
          <div className="report-heading-row">
            <div className="report-heading">
              <h2>Credit Receivables Ledger</h2>
              <p>
                {historicalMode
                  ? `Historical credit sales by original sale date: ${historicalPeriod}. Remaining balances and statuses are current.`
                  : "Review registered customers with outstanding credit balances and their oldest open sale."}
              </p>
            </div>
          </div>

          {historicalError && (
            <p className="report-inline-error" role="alert">{historicalError}</p>
          )}

          {historicalMode && historicalLoading ? (
            <LoadingSpinner />
          ) : historicalMode && historicalError && !historicalRecords ? (
            <EmptyState>Historical credit transactions could not be loaded.</EmptyState>
          ) : historicalMode && !historicalRecords?.length ? (
            <EmptyState>No credit transactions match the selected period.</EmptyState>
          ) : !historicalMode && !report.records.length ? (
            <EmptyState>No customers have unpaid balances.</EmptyState>
          ) : (
            <DataTable
              key={historicalMode ? "historical" : "current"}
              columns={tableColumns}
              rows={tableRows}
              pageSize={10}
              searchPlaceholder={historicalMode ? "Search credit transactions" : "Search customers"}
              getSortValue={(record, index) => (
                historicalMode
                  ? [
                    record.sale_id,
                    record.sale_date,
                    record.customer_name,
                    Number(record.total_amount),
                    Number(record.amount_initially_paid),
                    Number(record.remaining_balance),
                    record.status,
                  ][index]
                  : [
                    record.customer_name,
                    record.contact_number,
                    record.address,
                    Number(record.total_original_credit_amount),
                    Number(record.current_balance),
                    Number(record.open_credit_sales),
                    record.oldest_unpaid_sale_date,
                  ][index]
              )}
              renderRow={(record) => (
                historicalMode ? (
                  <tr key={record.sale_id}>
                    <td>OR-{record.sale_id}</td>
                    <td>
                      <time dateTime={record.sale_date}>
                        {formatActivityTimestamp(record.sale_date).dateTime}
                      </time>
                    </td>
                    <td>{record.customer_name}</td>
                    <td>{peso.format(Number(record.total_amount))}</td>
                    <td>{peso.format(Number(record.amount_initially_paid))}</td>
                    <td className="highlight-money">
                      {peso.format(Number(record.remaining_balance))}
                    </td>
                    <td><StatusBadge value={record.status} /></td>
                  </tr>
                ) : (
                  <tr key={record.customer_id}>
                    <td>{record.customer_name}</td>
                    <td>{record.contact_number || "—"}</td>
                    <td className="report-address-cell">{record.address || "—"}</td>
                    <td>{peso.format(Number(record.total_original_credit_amount))}</td>
                    <td className="highlight-money">
                      {peso.format(Number(record.current_balance))}
                    </td>
                    <td>{record.open_credit_sales}</td>
                    <td>
                      {record.oldest_unpaid_sale_date
                        ? (
                          <time dateTime={record.oldest_unpaid_sale_date}>
                            {formatActivityTimestamp(record.oldest_unpaid_sale_date).dateTime}
                          </time>
                        )
                        : "—"}
                    </td>
                  </tr>
                )
              )}
            />
          )}
        </article>
        <form className="receipt-panel report-filter-panel" onSubmit={applyHistoricalFilter}>
          <div className="report-heading report-filter-heading">
            <h2>Report Filters</h2>
            <p>Apply date limits to historical credit sales.</p>
          </div>
          <label>
            Start Date
            <input
              type="date"
              value={historicalFilters.start_date}
              disabled={historicalLoading}
              onChange={(event) => setHistoricalFilters((current) => ({ ...current, start_date: event.target.value }))}
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={historicalFilters.end_date}
              disabled={historicalLoading}
              onChange={(event) => setHistoricalFilters((current) => ({ ...current, end_date: event.target.value }))}
            />
          </label>
          {historicalError && <p className="report-inline-error" role="alert">{historicalError}</p>}
          {historicalLoading && <LoadingSpinner />}
          <button className="secondary-action" type="submit" disabled={historicalLoading}>
            {historicalLoading ? "Generating…" : "Generate Report"}
          </button>
          <button className="secondary-action" type="button" onClick={clearHistoricalFilter}>
            Clear Filters
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={historicalMode && (!historicalRecords || historicalLoading)}
            onClick={download}
          >
            Export CSV
          </button>
        </form>
      </section>
    </div>
  );
}

export default ReceivablesLedger;
import PageSkeleton from "../Shared/PageSkeleton.jsx";

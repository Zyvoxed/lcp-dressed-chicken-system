import StatCard from "../Shared/StatCard.jsx";
import { peso } from "../../utils/currency.js";

function ReportMetrics({ summary }) {
  return (
    <div className="stats-grid report-stats">
      <StatCard
        label="Gross Sales"
        value={peso.format(Number(summary.gross_sales))}
      />
      <StatCard
        label="Cash Sales Total"
        value={peso.format(Number(summary.cash_sales_total))}
      />
      <StatCard
        label="Credit Sales Total"
        value={peso.format(Number(summary.credit_sales_total))}
      />
      <StatCard
        label="Total Amount Paid"
        value={peso.format(Number(summary.total_amount_paid))}
      />
      <StatCard
        label="Outstanding Balance"
        value={peso.format(Number(summary.outstanding_balance))}
      />
    </div>
  );
}

export default ReportMetrics;

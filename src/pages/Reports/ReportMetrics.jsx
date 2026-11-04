import { BadgeCheck, BadgeDollarSign, CircleAlert, CreditCard, HandCoins } from 'lucide-react'
import StatCard from "../Shared/StatCard.jsx";
import { peso } from "../../utils/currency.js";

function ReportMetrics({ summary }) {
  return (
    <div className="stats-grid report-stats">
      <StatCard
        icon={BadgeDollarSign}
        label="Gross Sales"
        value={peso.format(Number(summary.gross_sales))}
      />
      <StatCard
        icon={HandCoins}
        label="Cash Sales Total"
        value={peso.format(Number(summary.cash_sales_total))}
      />
      <StatCard
        icon={CreditCard}
        label="Credit Sales Total"
        value={peso.format(Number(summary.credit_sales_total))}
      />
      <StatCard
        icon={BadgeCheck}
        label="Total Amount Paid"
        value={peso.format(Number(summary.total_amount_paid))}
      />
      <StatCard
        icon={CircleAlert}
        label="Outstanding Balance"
        value={peso.format(Number(summary.outstanding_balance))}
      />
    </div>
  );
}

export default ReportMetrics;

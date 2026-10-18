import { Award } from "lucide-react";
import { peso } from "../../utils/currency.js";
function BusinessAnalyticsStats({ summary }) {
  const topSeller = summary.top_seller;
  return (
    <div className="business-kpi-grid">
      <article>
        <header>
          <span>TOTAL TRANSACTIONS</span>
          <b>ALL TIME</b>
        </header>
        <strong>{summary.total_transactions}</strong>
        <p>Completed purchases recorded</p>
      </article>
      <article className="outlined">
        <header>
          <span>TOTAL SALES</span>
          <b>₱ PHP</b>
        </header>
        <strong>{peso.format(Number(summary.gross_revenue))}</strong>
        <p className="positive">• All cash and credit sales</p>
      </article>
      <article className="outlined">
        <header>
          <span>AVERAGE SALE AMOUNT</span>
          <b>PER SALE</b>
        </header>
        <strong>{peso.format(Number(summary.average_ticket_value))}</strong>
        <p>Average amount per completed sale</p>
      </article>
      <article>
        <header>
          <span className="accent">TOP-SELLING PRODUCT</span>
          <Award size={18} />
        </header>
        <strong className="seller-name">
          {topSeller?.product_name || "No sales data yet"}
        </strong>
        <p>
          {topSeller
            ? `${Number(topSeller.quantity_sold)} ${topSeller.unit} units sold`
            : "No completed product sales"}
        </p>
      </article>
    </div>
  );
}
export default BusinessAnalyticsStats;

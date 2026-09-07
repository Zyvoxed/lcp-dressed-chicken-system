import { BarChart3, PackageCheck, WalletCards } from "lucide-react";
import BrandMark from "../Shared/BrandMark.jsx";

function LoginHeader() {
  return (
    <section className="login-brand-panel" aria-labelledby="login-brand-title">
      <div className="login-brand-lockup">
        <BrandMark />
        <div>
          <p className="login-kicker">LCP DRESSED CHICKEN TRADING</p>
          <span>Internal Operations Portal</span>
        </div>
      </div>
      <div className="login-brand-copy">
        <p className="login-eyebrow">Business Management System</p>
        <h1 id="login-brand-title">Run daily operations with clarity.</h1>
        <p className="login-subtitle">Manage sales, inventory, customers, suppliers, and business operations in one secure system.</p>
      </div>
      <div className="login-capabilities" aria-label="System capabilities">
        <span><PackageCheck size={17} aria-hidden="true" />Inventory Management</span>
        <span><WalletCards size={17} aria-hidden="true" />Sales &amp; Credits</span>
        <span><BarChart3 size={17} aria-hidden="true" />Business Reports</span>
      </div>
    </section>
  );
}

export default LoginHeader;

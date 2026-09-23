import { BarChart3, Package, UsersRound } from "lucide-react";
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
        <h1 id="login-brand-title">
          Simpler<br />
          Operations.<br />
          <span>Greater Results.</span>
        </h1>
        <p className="login-subtitle">Manage sales, inventory, customers, suppliers, and business operations in one secure system.</p>
      </div>
      <div className="login-capabilities" aria-label="System capabilities">
        <div><Package size={34} strokeWidth={1.7} aria-hidden="true" /><span>Inventory<br />Management</span></div>
        <div><UsersRound size={34} strokeWidth={1.7} aria-hidden="true" /><span>Sales &amp;<br />Credits</span></div>
        <div><BarChart3 size={34} strokeWidth={1.7} aria-hidden="true" /><span>Business<br />Reports</span></div>
      </div>
    </section>
  );
}

export default LoginHeader;

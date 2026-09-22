import {
  BarChart3, Boxes, FileChartColumn, History, LayoutDashboard, Menu,
  Moon, ShoppingCart, Sun, Truck, Users, WalletCards,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme.js";

const modulePresentation = {
  "Main Dashboard": { title: "Dashboard", Icon: LayoutDashboard },
  "Record Sales": { title: "Record Sales", Icon: ShoppingCart },
  "Inventory & Stock In": { title: "Inventory & Stock In", Icon: Boxes },
  "Customer Credits Book": { title: "Customer Credits", Icon: WalletCards },
  "Supplier Contracts": { title: "Suppliers", Icon: Truck },
  "Business Analytics": { title: "Business Analytics", Icon: BarChart3 },
  "Reports & Audits": { title: "Reports & Audits", Icon: FileChartColumn },
  "Activity Logs": { title: "Activity Logs", Icon: History },
  "User Accounts": { title: "User Accounts", Icon: Users },
};

function Header({ role, user, activeModule, onToggleSidebar, onToggleMobile }) {
  const { theme, toggleTheme } = useTheme();
  const nextThemeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const displayName = user?.fullname || user?.username || "Operator";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const { title, Icon } = modulePresentation[activeModule] || modulePresentation["Main Dashboard"];

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="sidebar-toggle desktop-only"
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <button
          className="sidebar-toggle mobile-only"
          type="button"
          onClick={onToggleMobile}
          aria-label="Open navigation"
          title="Open navigation"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="topbar-page-title">
          <span><Icon size={18} aria-hidden="true" /></span>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={nextThemeLabel}
          title={nextThemeLabel}
        >
          {theme === "dark" ? (
            <Sun size={17} aria-hidden="true" />
          ) : (
            <Moon size={17} aria-hidden="true" />
          )}
        </button>

        <div className="privilege-card">
          <span className="topbar-avatar" aria-hidden="true">{initials}</span>
          <div className="topbar-user-copy">
            <strong>{displayName}</strong>
            <p>{role === "admin" ? "Admin" : "Staff"}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;

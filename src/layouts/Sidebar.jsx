import {
  BarChart3,
  Boxes,
  FileChartColumn,
  LayoutDashboard,
  History,
  LogOut,
  ShoppingCart,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import { modules } from "../utils/constants.js";
import { hasRouteAccess } from "../utils/rolePermissions.js";
import lcpLogo from "../assets/lcp-logo.png";

const moduleIcons = {
  "Main Dashboard": LayoutDashboard,
  "Record Sales": ShoppingCart,
  "Inventory & Stock In": Boxes,
  "Customer Credits Book": WalletCards,
  "Supplier Contracts": Truck,
  "Business Analytics": BarChart3,
  "Reports & Audits": FileChartColumn,
  "Activity Logs": History,
  "User Accounts": Users,
};

const navGroups = [
  { label: "MAIN", items: ["Main Dashboard"] },
  { label: "OPERATIONS", items: ["Record Sales", "Inventory & Stock In", "Customer Credits Book", "Supplier Contracts"] },
  { label: "INSIGHTS", items: ["Business Analytics", "Reports & Audits"] },
  { label: "SYSTEM", items: ["Activity Logs", "User Accounts"] },
];

function Sidebar({ activeModule, onSelect, onLogout, role, collapsed, mobileOpen }) {
  const accessibleModules = modules.filter((module) =>
    hasRouteAccess(module, role),
  );
  const accessibleLabels = new Set(accessibleModules.map((m) => m.label));

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark" aria-hidden="true">
          <img src={lcpLogo} alt="" />
        </div>
        <div className="sidebar-brand-text">
          <strong>LCP Trading</strong>
          <small>Management System</small>
        </div>
      </div>

      <nav aria-label="Primary modules">
        {navGroups.map((group) => {
          const groupItems = group.items.filter((label) => accessibleLabels.has(label));
          if (!groupItems.length) return null;

          return (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {groupItems.map((label) => {
                const module = accessibleModules.find((m) => m.label === label);
                const Icon = moduleIcons[label] || LayoutDashboard;

                return (
                  <button
                    key={module.path}
                    className={activeModule === label ? "active" : ""}
                    aria-current={activeModule === label ? "page" : undefined}
                    type="button"
                    onClick={() => onSelect(label)}
                    title={label}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-text">{label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-utility">
          <button
            className="logout-button"
            type="button"
            onClick={onLogout}
            title="Sign out"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;

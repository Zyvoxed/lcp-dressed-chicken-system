import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import { modules } from "../utils/constants.js";
import { hasRouteAccess } from "../utils/rolePermissions.js";

const moduleIcons = {
  "Main Dashboard": LayoutDashboard,
  "Record Sales": ShoppingCart,
  "Inventory & Stock In": Package,
  "Customer Credits Book": WalletCards,
  "Supplier Contracts": Truck,
  "Reports & Audits": BarChart3,
  "User Accounts": Users,
};

function Sidebar({ activeModule, onSelect, onLogout, role, user }) {
  const accessibleModules = modules.filter((module) =>
    hasRouteAccess(module, role),
  );

  const displayName = user?.username || role || "Operator";

  return (
    <aside className="sidebar">
      <p className="nav-label">System Modules</p>
      <nav aria-label="Primary modules">
        {accessibleModules.map((module) => {
          const Icon = moduleIcons[module.label] || LayoutDashboard;

          return (
            <button
              key={module.path}
              className={activeModule === module.label ? "active" : ""}
              type="button"
              onClick={() => onSelect(module.label)}
              title={module.label}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="nav-text">{module.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-utility">
          <button
            className="logout-button"
            type="button"
            onClick={onLogout}
            title="Logout"
          >
            <LogOut size={17} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;

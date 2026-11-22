import { useLayoutEffect, useRef, useState } from "react";
import {
  BarChart3,
  Boxes,
  FileChartColumn,
  LayoutDashboard,
  History,
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

const navigationLabels = {
  "Record Sales": "Point of Sale",
  "Main Dashboard": "Dashboard",
  "Customer Credits Book": "Customer Credits",
  "Supplier Contracts": "Suppliers",
  "Inventory & Stock In": "Inventory & Stock In",
  "Reports & Audits": "Reports & Audits",
};

const navGroups = [
  { label: "MAIN", items: ["Main Dashboard"] },
  { label: "OPERATIONS", items: ["Record Sales", "Inventory & Stock In", "Customer Credits Book", "Supplier Contracts"] },
  { label: "INSIGHTS", items: ["Business Analytics", "Reports & Audits"] },
  { label: "SYSTEM", items: ["User Accounts", "Activity Logs"] },
];

function Sidebar({ activeModule, onSelect, role, collapsed, mobileOpen }) {
  const navRef = useRef(null);
  const activeItemRef = useRef(null);
  const [activeIndicatorStyle, setActiveIndicatorStyle] = useState({ opacity: 0 });
  const accessibleModules = modules.filter((module) =>
    hasRouteAccess(module, role),
  );
  const accessibleLabels = new Set(accessibleModules.map((m) => m.label));

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeItem = activeItemRef.current;
    if (!nav || !activeItem) {
      setActiveIndicatorStyle({ opacity: 0 });
      return undefined;
    }

    const updateActiveIndicator = () => {
      const navRect = nav.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      setActiveIndicatorStyle({
        opacity: 1,
        height: `${itemRect.height}px`,
        transform: `translate3d(0, ${Math.round(itemRect.top - navRect.top + nav.scrollTop)}px, 0)`,
      });
    };

    updateActiveIndicator();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateActiveIndicator);
    resizeObserver?.observe(nav);
    resizeObserver?.observe(activeItem);
    nav.addEventListener("scroll", updateActiveIndicator);
    window.addEventListener("resize", updateActiveIndicator);

    return () => {
      resizeObserver?.disconnect();
      nav.removeEventListener("scroll", updateActiveIndicator);
      window.removeEventListener("resize", updateActiveIndicator);
    };
  }, [activeModule, collapsed, mobileOpen, role]);

  return (
    <aside id="primary-sidebar" className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`} aria-label="Application navigation">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark" aria-hidden="true">
          <img src={lcpLogo} alt="" />
        </div>
        <div className="sidebar-brand-text">
          <strong>LCP Dressed Chicken</strong>
          <small>Management System</small>
        </div>
      </div>

      <nav ref={navRef} aria-label="Primary modules">
        <span
          className="sidebar-active-indicator"
          aria-hidden="true"
          style={activeIndicatorStyle}
        />
        {navGroups.map((group) => {
          const groupItems = group.items.filter((label) => accessibleLabels.has(label));
          if (!groupItems.length) return null;

          return (
            <div className={`nav-group ${group.label ? "" : "nav-group-minimal"}`} key={group.label || "staff"}>
              {group.label && <p className="nav-label">{group.label}</p>}
              {groupItems.map((label) => {
                const module = accessibleModules.find((m) => m.label === label);
                const Icon = moduleIcons[label] || LayoutDashboard;
                const displayLabel = navigationLabels[label] || label;

                return (
                  <button
                    key={module.path}
                    className={activeModule === label ? "active" : ""}
                    ref={activeModule === label ? activeItemRef : null}
                    aria-current={activeModule === label ? "page" : undefined}
                    type="button"
                    onClick={() => onSelect(label)}
                    title={displayLabel}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-text">{displayLabel}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;

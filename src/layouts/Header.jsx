import { useEffect, useRef, useState } from "react";
import {
  BarChart3, Boxes, ChevronDown, FileChartColumn, History, LayoutDashboard,
  LogOut, Menu, ShoppingCart, Truck, Users, WalletCards,
} from "lucide-react";

const modulePresentation = {
  "Main Dashboard": { title: "Dashboard", Icon: LayoutDashboard },
  "Record Sales": { title: "Point of Sale", Icon: ShoppingCart },
  "Inventory & Stock In": { title: "Inventory & Stock In", Icon: Boxes },
  "Customer Credits Book": { title: "Customer Credits", Icon: WalletCards },
  "Supplier Contracts": { title: "Suppliers", Icon: Truck },
  "Business Analytics": { title: "Business Analytics", Icon: BarChart3 },
  "Reports & Audits": { title: "Reports & Audits", Icon: FileChartColumn },
  "Activity Logs": { title: "Activity Logs", Icon: History },
  "User Accounts": { title: "User Accounts", Icon: Users },
};

function Header({
  role,
  user,
  activeModule,
  sidebarCollapsed,
  mobileOpen,
  onToggleSidebar,
  onToggleMobile,
  onLogout,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const userMenuRef = useRef(null);

  const displayName = user?.fullname || user?.username || "Operator";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const { title, Icon } =
    modulePresentation[activeModule] || modulePresentation["Main Dashboard"];

  useEffect(() => {
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="sidebar-toggle desktop-only"
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-controls="primary-sidebar"
          aria-expanded={!sidebarCollapsed}
          title="Toggle sidebar"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <button
          className="sidebar-toggle mobile-only"
          type="button"
          onClick={onToggleMobile}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-controls="primary-sidebar"
          aria-expanded={mobileOpen}
          title={mobileOpen ? "Close navigation" : "Open navigation"}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="topbar-page-title">
          <span><Icon size={18} aria-hidden="true" /></span>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-right">
        <div className="topbar-user-menu" ref={userMenuRef}>
          <button
            type="button"
            className={`privilege-card ${dropdownOpen ? "is-open" : ""}`}
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            aria-label={`${displayName}, ${role === "admin" ? "Admin" : "Staff"}. Click to open user menu`}
            title={`${displayName} (${role === "admin" ? "Admin" : "Staff"})`}
          >
            <span className="topbar-avatar" aria-hidden="true">{initials}</span>
            <div className="topbar-user-copy">
              <strong>{displayName}</strong>
              <p>{role === "admin" ? "Admin" : "Staff"}</p>
            </div>
            <ChevronDown size={14} className={`topbar-chevron ${dropdownOpen ? "rotated" : ""}`} aria-hidden="true" />
          </button>

          {dropdownOpen && (
            <div className="topbar-user-dropdown" role="menu">
              <div className="dropdown-user-info">
                <strong className="dropdown-user-name">{displayName}</strong>
                <span className="dropdown-user-role">{role === "admin" ? "Administrator" : "Staff Member"}</span>
              </div>
              <div className="dropdown-divider" />
              <button
                type="button"
                role="menuitem"
                className="dropdown-item logout"
                onClick={() => {
                  setDropdownOpen(false);
                  if (onLogout) onLogout();
                }}
              >
                <LogOut size={15} aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;

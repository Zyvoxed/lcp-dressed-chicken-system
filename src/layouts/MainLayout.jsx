import { useState, useCallback } from "react";
import Header from "./Header.jsx";
import Sidebar from "./Sidebar.jsx";

function MainLayout({
  activeModule,
  onSelect,
  onLogout,
  role,
  user,
  children,
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapse = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((c) => !c);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  function handleSelect(label) {
    onSelect(label);
    closeMobile();
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        activeModule={activeModule}
        onSelect={handleSelect}
        onLogout={onLogout}
        role={role}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />
      {mobileOpen && <div className="sidebar-overlay" onClick={closeMobile} aria-hidden="true" />}
      <Header
        role={role}
        user={user}
        activeModule={activeModule}
        onToggleSidebar={toggleCollapse}
        onToggleMobile={toggleMobile}
      />
      <main className="content-area">{children}</main>
    </div>
  );
}

export default MainLayout;

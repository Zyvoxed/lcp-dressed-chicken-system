import { useState, useCallback, useEffect } from "react";
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

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") closeMobile();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMobile, mobileOpen]);

  function handleSelect(label) {
    onSelect(label);
    closeMobile();
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${activeModule === "Record Sales" ? "pos-app-shell" : ""}`}>
      <Sidebar
        activeModule={activeModule}
        onSelect={handleSelect}
        onLogout={onLogout}
        role={role}
        user={user}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />
      {mobileOpen && <div className="sidebar-overlay" onClick={closeMobile} aria-hidden="true" />}
      <Header
        role={role}
        user={user}
        activeModule={activeModule}
        sidebarCollapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onToggleSidebar={toggleCollapse}
        onToggleMobile={toggleMobile}
        onLogout={onLogout}
      />
      <main className="content-area">{children}</main>
    </div>
  );
}

export default MainLayout;

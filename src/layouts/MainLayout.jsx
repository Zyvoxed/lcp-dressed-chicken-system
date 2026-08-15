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
  return (
    <div className="app-shell">
      <Sidebar
        activeModule={activeModule}
        onSelect={onSelect}
        onLogout={onLogout}
        role={role}
        user={user}
      />
      <Header role={role} user={user} />
      <main className="content-area">{children}</main>
    </div>
  );
}

export default MainLayout;

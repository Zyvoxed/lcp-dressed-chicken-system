import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme.js";
import LoginForm from "./LoginForm.jsx";
import LoginHeader from "./LoginHeader.jsx";

function Login({ onLogin }) {
  const { theme, toggleTheme } = useTheme();
  const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <main className="login-page">
      <div className="login-ambient" aria-hidden="true"></div>
      <button className="login-theme-toggle" type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
        {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>
      <div className="login-shell">
        <LoginHeader />
        <section className="login-form-panel" aria-label="System sign in">
          <LoginForm onLogin={onLogin} />
        </section>
      </div>
    </main>
  );
}

export default Login;

import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme.js";
import LoginForm from "./LoginForm.jsx";

function Login({ onLogin }) {
  const { theme, toggleTheme } = useTheme();
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <main className="login-page login-page-card-layout">
      {/* Floating Theme Toggle in top-right corner */}
      <button
        className="login-theme-toggle"
        type="button"
        onClick={toggleTheme}
        aria-label={themeLabel}
        title={themeLabel}
      >
        {theme === "dark" ? (
          <Moon size={19} aria-hidden="true" />
        ) : (
          <Sun size={19} aria-hidden="true" />
        )}
      </button>

      {/* Centered Login Card Container */}
      <div className="login-card-container">
        <LoginForm onLogin={onLogin} />
      </div>
    </main>
  );
}

export default Login;

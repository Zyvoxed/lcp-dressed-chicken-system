import { AnimatePresence, motion } from "framer-motion";
import { Bell, Command, Moon, Search, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "../hooks/useTheme.js";
import BrandMark from "../pages/Shared/BrandMark.jsx";

const commandSuggestions = [
  "Record chicken breast sale",
  "Check low stock inventory",
  "Review Davao Mart receivables",
  "Open supplier delivery trends",
];

function Header({ role, user }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const nextThemeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const displayName = user?.username || role || "Operator";

  return (
    <header className="topbar">
      {/* LEFT SECTION - HARD LEFT */}
      <div className="flex shrink-0 items-center gap-4 topbar-brand-section">
        <BrandMark />
        <div className="topbar-brand-copy">
          <strong>LCP DRESSED CHICKEN TRADING</strong>
          <p>Business Management System</p>
        </div>
      </div>

      {/* MIDDLE SPACE - MUST EXPAND */}
      <div className="flex-1" />

      {/* RIGHT SECTION - HARD RIGHT */}
      <div className="flex shrink-0 items-center gap-4 topbar-actions">
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={nextThemeLabel}
          title={nextThemeLabel}
        >
          {theme === "dark" ? (
            <Sun size={18} aria-hidden="true" />
          ) : (
            <Moon size={18} aria-hidden="true" />
          )}
        </button>

        <div className="privilege-card">
          <span className="online-dot"></span>
          <div>
            <strong>{displayName}</strong>
            <p>{role === "admin" ? "Admin Privilege" : "Employee Privilege"}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;

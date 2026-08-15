import { useEffect, useMemo, useState } from "react";
import { createContext } from "react";
import { loginRoute } from "../utils/constants.js";

/* eslint-disable react-refresh/only-export-components */
export const AuthContext = createContext(null);

const storageKey = "user";

function getStoredUser() {
  try {
    const storedUser = localStorage.getItem(storageKey);
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);

  function login(userData) {
    localStorage.setItem(storageKey, JSON.stringify(userData));
    console.log("User Saved:", userData);
    setUser(userData);
    return true;
  }

  function logout() {
    localStorage.removeItem(storageKey);
    setUser(null);
    window.history.replaceState({}, "", loginRoute);
  }

  useEffect(() => {
    console.log("Auth User:", user);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      currentUser: user,
      login,
      logout,
      role: user?.role || null,
      isAuthenticated: Boolean(user),
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

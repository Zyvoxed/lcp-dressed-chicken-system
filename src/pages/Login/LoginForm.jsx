import { useState } from "react";
import { defaultRoute } from "../../utils/constants.js";

function LoginForm({ onLogin }) {
  const [formState, setFormState] = useState({ username: "", password: "" });
  const [error, setError] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    const username = formState.username.trim();
    const { password } = formState;

    console.log("Login Attempt:", username, password);

    let userData = null;

    if (username === "admin" && password === "admin123") {
      userData = { username: "admin", role: "admin" };
    }

    if (username === "employee" && password === "employee123") {
      userData = { username: "employee", role: "employee" };
    }

    if (!userData) {
      setError("Invalid username or password");
      return;
    }

    setError("");
    onLogin(userData);
    window.history.pushState({}, "", defaultRoute);
  }

  return (
    <form className="login-card" onSubmit={handleSubmit}>
      <div className="section-heading">
        <p>System Login</p>
        <span>Secure Entry</span>
      </div>
      <label className="input-group">
        Username
        <input
          name="username"
          type="text"
          placeholder="Admin or Employee"
          autoComplete="username"
          value={formState.username}
          onChange={handleChange}
        />
      </label>
      <label className="input-group">
        Password
        <input
          name="password"
          type="password"
          placeholder="Enter password"
          autoComplete="current-password"
          value={formState.password}
          onChange={handleChange}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <a href="#forgot" className="forgot-link">
        Forgot Password
      </a>
      <button type="submit" className="primary-action">
        Login
      </button>
    </form>
  );
}

export default LoginForm;

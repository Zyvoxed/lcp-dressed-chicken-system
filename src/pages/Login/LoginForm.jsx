import { useState } from "react";
import { defaultRoute } from "../../utils/constants.js";

function LoginForm({ onLogin }) {
  const [formState, setFormState] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const username = formState.username.trim();
    const { password } = formState;

    setLoading(true);
    setError("");

    try {
      await onLogin(username, password);
      window.history.pushState({}, "", defaultRoute);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
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
      <button type="submit" className="primary-action" disabled={loading}>
        {loading ? "Logging In" : "Login"}
      </button>
    </form>
  );
}

export default LoginForm;

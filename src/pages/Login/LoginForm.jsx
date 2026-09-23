import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { defaultRoute } from "../../utils/constants.js";
import LoginErrorNotification from "./LoginErrorNotification.jsx";

function LoginForm({ onLogin }) {
  const [formState, setFormState] = useState({ username: "", password: "" });
  const [validation, setValidation] = useState({});
  const [loginFailureId, setLoginFailureId] = useState(0);
  const [loginFailure, setLoginFailure] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
    if (value) setValidation((current) => ({ ...current, [name]: "" }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const username = formState.username.trim();
    const { password } = formState;
    const nextValidation = {
      username: username ? "" : "Username is required.",
      password: password ? "" : "Password is required.",
    };

    if (nextValidation.username || nextValidation.password) {
      setValidation(nextValidation);
      document.querySelector(`[name="${nextValidation.username ? "username" : "password"}"]`)?.focus();
      return;
    }

    setLoading(true);
    setValidation({});

    try {
      await onLogin(username, password);
      window.history.pushState({}, "", defaultRoute);
    } catch (requestError) {
      setFormState((current) => ({ ...current, password: "" }));
      const authenticationFailure = requestError.status === 401;
      const forbidden = requestError.status === 403;
      setLoginFailure({
        title: authenticationFailure ? "Login Failed" : "Unable to Sign In",
        message: authenticationFailure
          ? "Incorrect username or password."
          : forbidden
            ? "This account is unavailable. Contact the system administrator."
            : "The login service is unavailable. Please try again.",
      });
      if (import.meta.env.DEV) {
        const category = authenticationFailure ? "authentication failure" : forbidden ? "account unavailable" : requestError.status ? `server error (${requestError.status})` : "network or CORS error";
        console.warn(`Login request failed: ${category}`);
      }
      setLoginFailureId((current) => current + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={handleSubmit}>
      <header className="login-card-header">
        <span>Secure Access</span>
        <h2>Welcome Back</h2>
        <p>Sign in to access the management system.</p>
      </header>
      <div className="input-group">
        <label htmlFor="login-username">Username</label>
        <span className={`login-input-wrap ${validation.username ? "invalid" : ""}`}>
          <UserRound size={18} aria-hidden="true" />
          <input id="login-username" name="username" type="text" placeholder="Enter your username" autoComplete="username" value={formState.username} onChange={handleChange} aria-invalid={Boolean(validation.username)} aria-describedby={validation.username ? "username-error" : undefined} />
        </span>
        <small className="login-field-error" id="username-error">{validation.username || "\u00a0"}</small>
      </div>
      <div className="input-group">
        <label htmlFor="login-password">Password</label>
        <span className={`login-input-wrap ${validation.password ? "invalid" : ""}`}>
          <LockKeyhole size={18} aria-hidden="true" />
          <input id="login-password" name="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" autoComplete="current-password" value={formState.password} onChange={handleChange} aria-invalid={Boolean(validation.password)} aria-describedby={validation.password ? "password-error" : undefined} />
          <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </span>
        <small className="login-field-error" id="password-error">{validation.password || "\u00a0"}</small>
      </div>
      <button type="submit" className="primary-action login-submit" disabled={loading}>
        {loading && <span className="login-spinner" aria-hidden="true" />}
        {loading ? "Signing in..." : "Sign In"}
        {!loading && <ArrowRight size={21} aria-hidden="true" />}
      </button>
      <p className="login-access-note">Authorized LCP personnel only</p>
      {loginFailureId > 0 && loginFailure && <LoginErrorNotification key={loginFailureId} title={loginFailure.title} message={loginFailure.message} onClose={() => setLoginFailureId(0)} />}
    </form>
  );
}

export default LoginForm;

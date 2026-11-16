import { useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
import { requestPasswordReset } from "../../services/authService.js";
import { defaultRoute, employeeRoute } from "../../utils/constants.js";
import LoginErrorNotification from "./LoginErrorNotification.jsx";
import lcpLogo from "../../assets/lcp-logo.png";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm({ onLogin }) {
  // Mode: "login" or "forgot-password" (stays on the same page, no navigation or reloads)
  const [mode, setMode] = useState("login");

  // Login form state
  const [formState, setFormState] = useState({ username: "", password: "" });
  const [validation, setValidation] = useState({});
  const [loginFailureId, setLoginFailureId] = useState(0);
  const [loginFailure, setLoginFailure] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Forgot Password recovery state
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoverySuccessMessage, setRecoverySuccessMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // Handlers for Login
  function handleLoginChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
    if (value) setValidation((current) => ({ ...current, [name]: "" }));
  }

  async function handleLoginSubmit(event) {
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
      const authenticatedUser = await onLogin(username, password);
      const destination = authenticatedUser.role === "employee" ? employeeRoute : defaultRoute;
      window.history.pushState({}, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (requestError) {
      setFormState((current) => ({ ...current, password: "" }));
      const authenticationFailure = requestError.status === 401;
      const forbidden = requestError.status === 403;
      setLoginFailure({
        title: authenticationFailure ? "Login Failed" : "Unable to Sign In",
        message: authenticationFailure
          ? "Incorrect username or password."
          : forbidden
            ? "This account is inactive. Contact the owner or admin."
            : "The login service is unavailable. Please try again.",
      });
      if (import.meta.env.DEV) {
        const category = authenticationFailure
          ? "authentication failure"
          : forbidden
            ? "account unavailable"
            : requestError.status
              ? `server error (${requestError.status})`
              : "network or CORS error";
        console.warn(`Login request failed: ${category}`);
      }
      setLoginFailureId((current) => current + 1);
    } finally {
      setLoading(false);
    }
  }

  // Handlers for Forgot Password
  function handleRecoveryEmailChange(event) {
    setRecoveryEmail(event.target.value);
    if (recoveryError) setRecoveryError("");
  }

  async function handleRecoverySubmit(event) {
    event.preventDefault();
    const normalizedEmail = recoveryEmail.trim();

    if (!normalizedEmail || normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
      setRecoveryError("Enter a valid recovery email address.");
      return;
    }

    setRecoveryError("");
    setRecoveryLoading(true);

    try {
      const result = await requestPasswordReset(normalizedEmail);
      setRecoverySuccessMessage(result.message || "A reset link has been sent to your verified email address.");
    } catch (requestError) {
      setRecoveryError(requestError.message || "Unable to process the request. Please try again.");
    } finally {
      setRecoveryLoading(false);
    }
  }

  function handleBackToLogin() {
    setMode("login");
    setRecoveryEmail("");
    setRecoveryError("");
    setRecoverySuccessMessage("");
  }

  function handleSwitchToForgotPassword() {
    setMode("forgot-password");
    setRecoveryEmail("");
    setRecoveryError("");
    setRecoverySuccessMessage("");
    setValidation({});
  }

  return (
    <div className="login-card">
      {/* LCP Company Branding at the top of the card */}
      <header className="login-card-branding">
        <div className="login-card-logo-wrap">
          <img src={lcpLogo} alt="LCP Logo" className="login-card-logo" />
        </div>
        <div className="login-card-brand-text">
          <h1 className="login-card-brand-name">LCP</h1>
          <span className="login-card-brand-sub">Dressed Chicken Trading</span>
        </div>
      </header>

      {mode === "login" ? (
        <form className="login-form-view" onSubmit={handleLoginSubmit} aria-busy={loading}>
          <div className="login-card-heading-wrap">
            <h2 className="login-title">Login</h2>
          </div>

          <div className="input-group">
            <label htmlFor="login-username">Username</label>
            <span className={`login-input-wrap ${validation.username ? "invalid" : ""} ${loading ? "disabled" : ""}`}>
              <UserRound size={18} aria-hidden="true" />
              <input
                id="login-username"
                name="username"
                type="text"
                placeholder="Enter your username"
                autoComplete="username"
                value={formState.username}
                onChange={handleLoginChange}
                disabled={loading}
                aria-invalid={Boolean(validation.username)}
                aria-describedby={validation.username ? "username-error" : undefined}
              />
            </span>
            <small className="login-field-error" id="username-error">{validation.username || "\u00a0"}</small>
          </div>

          <div className="input-group">
            <div className="login-label-row">
              <label htmlFor="login-password">Password</label>
            </div>
            <span className={`login-input-wrap ${validation.password ? "invalid" : ""} ${loading ? "disabled" : ""}`}>
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={formState.password}
                onChange={handleLoginChange}
                disabled={loading}
                aria-invalid={Boolean(validation.password)}
                aria-describedby={validation.password ? "password-error" : undefined}
              />
              <button
                type="button"
                className="password-visibility"
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </span>
            <div className="login-password-subrow">
              <small className="login-field-error" id="password-error">{validation.password || "\u00a0"}</small>
              <button
                type="button"
                className="login-forgot-link"
                onClick={handleSwitchToForgotPassword}
              >
                Forgot Password?
              </button>
            </div>
          </div>

          <button type="submit" className="primary-action login-submit" disabled={loading}>
            {loading && <span className="login-spinner" aria-hidden="true" />}
            {loading ? "Signing in..." : "Login"}
          </button>

          {loginFailureId > 0 && loginFailure && (
            <LoginErrorNotification
              key={loginFailureId}
              title={loginFailure.title}
              message={loginFailure.message}
              onClose={() => setLoginFailureId(0)}
            />
          )}
        </form>
      ) : (
        /* FORGOT PASSWORD INLINE VIEW */
        <div className="login-form-view">
          <div className="login-card-heading-wrap">
            <h2 className="login-title">Forgot Password?</h2>
            <p className="login-subtitle">
              Enter the required account information to continue with password recovery.
            </p>
          </div>

          {recoverySuccessMessage ? (
            <div className="login-recovery-success" role="status">
              <div className="login-recovery-icon-wrap" aria-hidden="true">
                <CheckCircle2 size={36} />
              </div>
              <h3 className="login-recovery-success-title">Check Your Email</h3>
              <p className="login-recovery-success-desc">{recoverySuccessMessage}</p>
              <button
                type="button"
                className="primary-action login-submit"
                onClick={handleBackToLogin}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleRecoverySubmit} aria-busy={recoveryLoading}>
              <div className="input-group">
                <label htmlFor="recovery-email">Recovery Email</label>
                <span className={`login-input-wrap ${recoveryError ? "invalid" : ""} ${recoveryLoading ? "disabled" : ""}`}>
                  <Mail size={18} aria-hidden="true" />
                  <input
                    id="recovery-email"
                    name="recovery-email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    placeholder="Enter your recovery email"
                    value={recoveryEmail}
                    onChange={handleRecoveryEmailChange}
                    disabled={recoveryLoading}
                    aria-invalid={Boolean(recoveryError)}
                    aria-describedby={recoveryError ? "recovery-email-error" : undefined}
                    required
                  />
                </span>
                <small className="login-field-error" id="recovery-email-error">
                  {recoveryError || "\u00a0"}
                </small>
              </div>

              <button
                type="submit"
                className="primary-action login-submit"
                disabled={recoveryLoading}
              >
                {recoveryLoading && <span className="login-spinner" aria-hidden="true" />}
                {recoveryLoading ? "Sending..." : "Send Reset Link"}
              </button>

              <div className="login-back-row">
                <button
                  type="button"
                  className="login-back-btn"
                  onClick={handleBackToLogin}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back to Login
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default LoginForm;

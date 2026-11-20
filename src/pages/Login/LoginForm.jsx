import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { requestPasswordReset } from "../../services/authService.js";
import LoginErrorNotification from "./LoginErrorNotification.jsx";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm({ onLogin, onVerifyMfa, onResendMfa }) {
  // Mode: "login" or "forgot-password" (stays on the same page, no navigation or reloads)
  const [mode, setMode] = useState("login");

  // Login form state
  const [formState, setFormState] = useState({ username: "", password: "" });
  const [validation, setValidation] = useState({});
  const [loginFailureId, setLoginFailureId] = useState(0);
  const [loginFailure, setLoginFailure] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(null);
  const [otp, setOtp] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (!mfaChallenge) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mfaChallenge]);

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
      const challenge = await onLogin(username, password);
      setFormState((current) => ({ ...current, password: "" }));
      setClock(Date.now());
      setMfaChallenge(challenge);
      setOtp("");
      setMfaError("");
    } catch (requestError) {
      setFormState((current) => ({ ...current, password: "" }));
      const authenticationFailure = requestError.status === 401;
      const forbidden = requestError.status === 403;
      const tooMany = requestError.status === 429;
      const deliveryFailure = requestError.status === 503;
      setLoginFailure({
        title: authenticationFailure ? "Login Failed" : tooMany ? "Please Wait" : "Unable to Log In",
        message: authenticationFailure
          ? "Incorrect username or password."
          : forbidden
            ? requestError.message || "This account is inactive or needs a verified email. Contact an administrator."
            : tooMany || deliveryFailure
              ? requestError.message
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

  // Handlers for MFA OTP
  function formatCountdown(targetTime) {
    const diff = Math.max(0, Math.floor((new Date(targetTime).getTime() - clock) / 1000));
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  async function handleOtpSubmit(event) {
    event.preventDefault();
    if (!mfaChallenge || otp.length !== 6 || mfaLoading) return;
    setMfaLoading(true);
    setMfaError("");
    try {
      await onVerifyMfa(mfaChallenge.challengeId, otp);
    } catch (requestError) {
      setMfaError(requestError.message || "Invalid or expired verification code.");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleResendOtp() {
    if (!mfaChallenge || mfaLoading) return;
    setMfaLoading(true);
    setMfaError("");
    try {
      const nextChallenge = await onResendMfa(mfaChallenge.challengeId);
      setMfaChallenge((current) => ({
        ...current,
        expiresAt: nextChallenge.expiresAt || current.expiresAt,
        resendAvailableAt: nextChallenge.resendAvailableAt || current.resendAvailableAt,
      }));
      setClock(Date.now());
    } catch (requestError) {
      setMfaError(requestError.message || "Unable to resend verification code.");
    } finally {
      setMfaLoading(false);
    }
  }

  function returnToLogin() {
    setMfaChallenge(null);
    setOtp("");
    setMfaError("");
    setValidation({});
  }

  // Handlers for Forgot Password Recovery
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
      setRecoverySuccessMessage(
        result?.message || "If this email is associated with an active account, password reset instructions have been sent."
      );
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
    setValidation({});
  }

  function handleSwitchToForgotPassword() {
    setMode("forgot-password");
    setRecoveryEmail("");
    setRecoveryError("");
    setRecoverySuccessMessage("");
    setValidation({});
  }

  return (
    <div className="login-form-container">
      {mode === "login" ? (
        mfaChallenge ? (
          /* MFA EMAIL VERIFICATION CHALLENGE VIEW */
          <form className="login-form-view" onSubmit={handleOtpSubmit} aria-busy={mfaLoading}>
            <div className="login-card-heading-wrap">
              <h2 className="login-title">Verify Your Email</h2>
              <p className="login-subtitle">Enter the six-digit code sent to your registered email address.</p>
            </div>

            <div className="input-group">
              <label htmlFor="login-otp">Verification Code</label>
              <span className={`login-input-wrap ${mfaError ? "invalid" : ""} ${mfaLoading ? "disabled" : ""}`}>
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  id="login-otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="Enter 6-digit code"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={mfaLoading}
                  aria-invalid={Boolean(mfaError)}
                  aria-describedby={mfaError ? "mfa-error" : "mfa-expiry"}
                  autoFocus
                />
              </span>
              <small id="mfa-expiry" className="login-mfa-countdown">
                {clock >= new Date(mfaChallenge.expiresAt).getTime()
                  ? "Code expired. Return to login to try again."
                  : `Code expires in ${formatCountdown(mfaChallenge.expiresAt)}`}
              </small>
              {mfaError && <small id="mfa-error" className="login-mfa-error" role="alert">{mfaError}</small>}
            </div>

            <button type="submit" className="primary-action login-submit" disabled={mfaLoading || clock >= new Date(mfaChallenge.expiresAt).getTime()}>
              {mfaLoading && <span className="login-spinner" aria-hidden="true" />}
              {mfaLoading ? "Verifying..." : "Verify and Continue"}
            </button>

            <div className="login-mfa-actions">
              <button type="button" className="login-forgot-link" onClick={handleResendOtp} disabled={mfaLoading || clock < new Date(mfaChallenge.resendAvailableAt).getTime()}>
                {clock < new Date(mfaChallenge.resendAvailableAt).getTime()
                  ? `Resend code in ${formatCountdown(mfaChallenge.resendAvailableAt)}`
                  : "Resend Code"}
              </button>
              <button type="button" className="login-back-btn" onClick={returnToLogin} disabled={mfaLoading}>
                <ArrowLeft size={16} aria-hidden="true" /> Return to Log In
              </button>
            </div>
          </form>
        ) : (
          /* STANDARD LOGIN VIEW */
          <form className="login-form-view" onSubmit={handleLoginSubmit} aria-busy={loading}>
            <div className="login-card-heading-wrap">
              <h2 className="login-title">Log In</h2>
              <p className="login-subtitle">Enter your account credentials to access the system.</p>
            </div>

            <div className="input-group">
              <label htmlFor="login-username">Username</label>
              <span className={`login-input-wrap ${validation.username ? "invalid" : ""} ${loading ? "disabled" : ""}`}>
                <UserRound size={17} aria-hidden="true" />
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
                <LockKeyhole size={17} aria-hidden="true" />
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
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
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
              {loading ? "Logging in..." : "Log In"}
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
        )
      ) : (
        /* INLINE FORGOT PASSWORD VIEW */
        <div className="login-form-view">
          <div className="login-card-heading-wrap">
            <h2 className="login-title">Reset Password</h2>
            <p className="login-subtitle">Enter your registered recovery email to receive a password reset link.</p>
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
                Return to Log In
              </button>
            </div>
          ) : (
            <form onSubmit={handleRecoverySubmit} aria-busy={recoveryLoading}>
              <div className="input-group">
                <label htmlFor="recovery-email">Recovery Email</label>
                <span className={`login-input-wrap ${recoveryError ? "invalid" : ""} ${recoveryLoading ? "disabled" : ""}`}>
                  <Mail size={17} aria-hidden="true" />
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
                  Back to Log In
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

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { verifyRecoveryEmail } from "../../services/authService.js";
import { loginRoute, verifyEmailRoute } from "../../utils/constants.js";
import LoginBrandSection from "./LoginBrandSection.jsx";
import LoginBackground from "./LoginBackground.jsx";
import lcpLogo from "../../assets/lcp-logo.png";

function VerifyEmail() {
  const [token] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("token"),
  );
  const [status, setStatus] = useState(() => (token ? "loading" : "error"));
  const [message, setMessage] = useState(() =>
    token
      ? "Checking your verification link..."
      : "This verification link is invalid or has expired.",
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    window.history.replaceState({}, "", verifyEmailRoute);

    if (!token) return;

    verifyRecoveryEmail(token)
      .then((result) => {
        setStatus("success");
        setMessage(result.message);
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error.message || "Unable to verify recovery email");
      });
  }, [token]);

  return (
    <main className="login-page login-page-enterprise-layout">
      {/* Premium Warm Minimalist Background */}
      <LoginBackground />

      {/* Two-Panel Enterprise Container */}
      <div className="login-split-container">
        <LoginBrandSection />

        <section
          className="login-card-section"
          aria-label="Verify recovery email"
        >
          <div className="login-card-elevated-wrap">
            <div
              className="login-card"
              aria-live="polite"
              aria-busy={status === "loading"}
            >
              <div className="login-card-heading-wrap">
                <div className="login-card-logo-squircle">
                  <img
                    src={lcpLogo}
                    alt="LCP Logo"
                    className="login-card-logo-img"
                  />
                </div>
                <h2 className="login-title">Verify Recovery Email</h2>
                <p className="login-subtitle">
                  Confirming that this email belongs to your account.
                </p>
              </div>

              <div
                className={`email-verification-status ${status}`}
                role={status === "error" ? "alert" : "status"}
              >
                {status === "loading" && (
                  <span className="login-spinner" aria-hidden="true" />
                )}
                {status === "success" && (
                  <CheckCircle2 size={34} aria-hidden="true" />
                )}
                {status === "error" && <XCircle size={34} aria-hidden="true" />}
                <strong>
                  {status === "loading"
                    ? "Please wait"
                    : status === "success"
                      ? "Email verified"
                      : "Unable to verify email"}
                </strong>
                <p>{message}</p>
              </div>

              {status !== "loading" && (
                <a className="primary-action login-submit" href={loginRoute}>
                  <MailCheck size={18} aria-hidden="true" />
                  Return to Log In
                </a>
              )}

              {/* Trust Badges */}
              <div className="login-card-trust-badges">
                <span>
                  <ShieldCheck size={13} aria-hidden="true" /> Secure
                  Verification
                </span>
                <span>
                  <LockKeyhole size={13} aria-hidden="true" /> SSL Protected
                </span>
                <span>
                  <KeyRound size={13} aria-hidden="true" /> 256-bit TLS
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default VerifyEmail;

import LoginBackground from "./LoginBackground.jsx";
import LoginBrandSection from "./LoginBrandSection.jsx";
import LoginForm from "./LoginForm.jsx";

function Login({ onLogin, onVerifyMfa, onResendMfa }) {
  return (
    <main className="login-page login-page-enterprise-layout">
      {/* Premium Van Photographic Background Layer */}
      <LoginBackground />

      {/* Two-Panel Enterprise Container */}
      <div className="login-split-container">
        <LoginBrandSection />

        <section className="login-card-section" aria-label="Log in">
          <div className="login-card-elevated-wrap">
            <div className="login-card">
              <LoginForm
                onLogin={onLogin}
                onVerifyMfa={onVerifyMfa}
                onResendMfa={onResendMfa}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Login;

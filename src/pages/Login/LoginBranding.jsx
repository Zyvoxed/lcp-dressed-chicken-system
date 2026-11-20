import lcpLogo from '../../assets/lcp-logo.png'

function LoginBranding() {
  return (
    <header className="login-card-branding">
      <div className="login-card-logo-wrap">
        <img src={lcpLogo} alt="LCP Logo" className="login-card-logo" />
      </div>
      <div className="login-card-brand-text">
        <h1 className="login-card-brand-name">LCP</h1>
        <span className="login-card-brand-sub">Dressed Chicken Trading</span>
      </div>
    </header>
  )
}

export default LoginBranding

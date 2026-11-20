import lcpLogo from '../../assets/lcp-logo.png'

function LoginBrandSection() {
  return (
    <section className="login-brand-section" aria-label="LCP Dressed Chicken Trading">
      <div className="login-brand-top-lockup">
        <div className="login-brand-logo-pill">
          <img src={lcpLogo} alt="LCP Logo" className="login-brand-logo" />
        </div>
        <div className="login-brand-identity">
          <span className="login-brand-name">LCP Dressed Chicken Trading</span>
        </div>
      </div>
    </section>
  )
}

export default LoginBrandSection

import lcpVan from '../../assets/lcp-van.png'

function LoginBackground() {
  return (
    <div className="login-ambient-container" aria-hidden="true">
      {/* Authentic LCP Refrigerated Delivery Van Background */}
      <div
        className="login-van-backdrop"
        style={{ backgroundImage: `url(${lcpVan})` }}
      />

      {/* Corporate Dark Green & Charcoal Protective Overlays for Maximum Legibility */}
      <div className="login-van-overlay" />
      <div className="login-van-vignette" />

      {/* Ambient Lighting Orbs for Depth */}
      <div className="ambient-orb orb-primary" />
      <div className="ambient-orb orb-secondary" />
      <div className="ambient-orb orb-accent" />
    </div>
  )
}

export default LoginBackground

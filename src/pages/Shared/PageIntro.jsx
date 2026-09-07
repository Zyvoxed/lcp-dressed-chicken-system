function PageIntro({ icon: Icon, title, description, children }) {
  return (
    <header className="page-intro">
      <div className="page-intro-copy">
        <span className="page-intro-icon"><Icon size={20} aria-hidden="true" /></span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {children && <div className="page-intro-actions">{children}</div>}
    </header>
  )
}

export default PageIntro

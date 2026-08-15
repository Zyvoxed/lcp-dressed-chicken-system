function PageHeader({ title, children }) {
  return (
    <div className="panel-title-row">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

export default PageHeader

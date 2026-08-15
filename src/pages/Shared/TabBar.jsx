function TabBar({ tabs, active, onSelect }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button key={tab} className={active === tab ? 'selected' : ''} type="button" onClick={() => onSelect(tab)}>
          {tab}
        </button>
      ))}
    </div>
  )
}

export default TabBar

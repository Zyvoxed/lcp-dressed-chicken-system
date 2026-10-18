function TabBar({ tabs, active, onSelect }) {
  return (
    <div className="tabs" role="group" aria-label="View options">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={active === tab ? 'selected' : ''}
          type="button"
          aria-pressed={active === tab}
          onClick={() => onSelect(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

export default TabBar

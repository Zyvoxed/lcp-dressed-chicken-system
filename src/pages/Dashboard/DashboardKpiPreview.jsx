import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function DashboardKpiPreview({ anchorRef, id, rows, visible }) {
  const [position, setPosition] = useState(null)

  useEffect(() => {
    if (!visible) return undefined

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 12
      const gap = 8
      const width = Math.min(300, window.innerWidth - (viewportPadding * 2))
      const left = Math.min(
        Math.max(rect.left + (rect.width / 2) - (width / 2), viewportPadding),
        window.innerWidth - width - viewportPadding,
      )
      const estimatedHeight = 44 + (rows.length * 28)
      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding
      const spaceAbove = rect.top - gap - viewportPadding
      const placeBelow = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove
      const maxHeight = Math.max(placeBelow ? spaceBelow : spaceAbove, 48)

      setPosition(placeBelow
        ? { left, maxHeight, top: rect.bottom + gap, width }
        : { bottom: window.innerHeight - rect.top + gap, left, maxHeight, width })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, rows.length, visible])

  if (!visible || !position) return null

  return createPortal(
    <div id={id} className="dashboard-kpi-preview" role="tooltip" style={position}>
      {rows.map((row) => (
        <div className="dashboard-kpi-preview-row" key={row.label}>
          <span>{row.label}</span>
          <strong title={row.value}>{row.value}</strong>
        </div>
      ))}
    </div>,
    document.body,
  )
}

export default DashboardKpiPreview

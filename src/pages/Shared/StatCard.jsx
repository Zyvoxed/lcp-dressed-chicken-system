import { TrendingUp } from 'lucide-react'

function Sparkline({ data = [] }) {
  if (!data.length) {
    return null
  }

  const width = 116
  const height = 38
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data
    .map((value, index) => {
      const x = (width / Math.max(data.length - 1, 1)) * index
      const y = height - ((value - min) / range) * (height - 8) - 4

      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg className="stat-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} />
    </svg>
  )
}

function StatCard({ label, value, helper, trend, icon: Icon = TrendingUp, sparkline = [] }) {
  const hasBottomContent = trend || helper || sparkline.length > 0

  return (
    <article className="stat-card">
      <div className="stat-card-top">
        <p>{label}</p>
        <span className="stat-icon">
          <Icon size={17} aria-hidden="true" />
        </span>
      </div>
      <strong>{value}</strong>
      {hasBottomContent && (
        <div className="stat-card-bottom">
          <span>{trend || helper}</span>
          <Sparkline data={sparkline} />
        </div>
      )}
    </article>
  )
}

export default StatCard

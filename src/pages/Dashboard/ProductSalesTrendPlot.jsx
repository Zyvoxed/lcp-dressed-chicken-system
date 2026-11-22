import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  SALES_CHART_LAYOUT,
  SALES_CHART_STYLE,
} from '../../utils/salesChartPresentation.js'
import { formatQuantityWithUnit } from '../../utils/unitAwareMetrics.js'

function ProductSalesTrendPlot({ chartModel, periodMode }) {
  const [tooltip, setTooltip] = useState(null)

  function showPointTooltip(point, event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : bounds.left + bounds.width / 2
    const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : bounds.top
    const halfWidth = Math.min(140, (window.innerWidth - 24) / 2)

    setTooltip({
      point,
      x: Math.max(12 + halfWidth, Math.min(x, window.innerWidth - 12 - halfWidth)),
      y,
      above: y > 150,
    })
  }

  return (
    <>
      <div className="product-trends-canvas-wrapper">
        {chartModel.unitGroups.map((group) => (
          <section className="product-trends-unit-group" key={group.unit} aria-label={`Product quantities in ${group.unit}`}>
            <h3>{group.unit}</h3>
            <svg
              className="product-trends-svg sales-product-chart"
              viewBox={`0 0 ${SALES_CHART_LAYOUT.width} ${SALES_CHART_LAYOUT.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Product sales quantity trends in ${group.unit} (${periodMode})`}
            >
              {group.ticks.map((tick) => (
                <g key={tick.value}>
                  <line
                    className="product-trends-gridline sales-product-chart-gridline"
                    x1={SALES_CHART_LAYOUT.left}
                    x2={SALES_CHART_LAYOUT.width - SALES_CHART_LAYOUT.right}
                    y1={tick.y}
                    y2={tick.y}
                  />
                  <text
                    className="product-trends-axis-label sales-product-chart-axis-label"
                    x={SALES_CHART_LAYOUT.left - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                  >
                    {formatQuantityWithUnit(tick.value, group.unit, 1)}
                  </text>
                </g>
              ))}

              {group.series.map((series) => (
                <g key={series.id} className="product-trends-series-group">
                  <path
                    d={series.pathD}
                    fill="none"
                    stroke={series.color}
                    strokeWidth={SALES_CHART_STYLE.lineWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="product-trends-line sales-product-chart-line"
                  />
                  {series.points.map((point, pointIndex) => (
                    <circle
                      key={`${series.id}-${pointIndex}`}
                      cx={point.x}
                      cy={point.y}
                      r={SALES_CHART_STYLE.pointRadius}
                      fill={series.color}
                      stroke="var(--card-bg)"
                      strokeWidth={SALES_CHART_STYLE.markerStrokeWidth}
                      className="product-trends-point sales-product-chart-point"
                      aria-label={`${point.name}, ${point.fullPeriod}, ${formatQuantityWithUnit(point.value, point.unit, 2)}`}
                      onPointerEnter={(event) => showPointTooltip(point, event)}
                      onPointerMove={(event) => showPointTooltip(point, event)}
                      onPointerLeave={() => setTooltip(null)}
                    />
                  ))}
                </g>
              ))}

              {group.xLabels.map((item) => (
                <text
                  key={item.label}
                  className="product-trends-axis-label x-axis sales-product-chart-axis-label"
                  x={item.x}
                  y={item.y}
                  textAnchor="middle"
                >
                  {item.label}
                </text>
              ))}
            </svg>
          </section>
        ))}
      </div>

      {tooltip && createPortal(
        <div
          className={`product-trends-tooltip sales-product-tooltip ${tooltip.above ? 'above' : 'below'}`}
          role="tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            '--tooltip-accent': tooltip.point.color,
          }}
        >
          <div className="product-trends-tooltip-header">
            <span
              className="product-trends-tooltip-dot"
              style={{ backgroundColor: tooltip.point.color }}
            />
            <strong>{tooltip.point.name}</strong>
          </div>
          <div className="product-trends-tooltip-period">
            {tooltip.point.fullPeriod}
          </div>
          <div className="product-trends-tooltip-metric">
            Quantity Sold: <strong>{formatQuantityWithUnit(tooltip.point.value, tooltip.point.unit, 2)}</strong>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export default ProductSalesTrendPlot

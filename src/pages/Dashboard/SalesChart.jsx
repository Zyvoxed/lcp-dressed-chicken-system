import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { buildSmoothPath } from "../../utils/chartPaths.js";
import { peso } from "../../utils/currency.js";

const chart = {
  width: 760,
  height: 310,
  left: 72,
  right: 24,
  top: 28,
  bottom: 54,
};
const ranges = ["daily", "weekly", "monthly"];

function chartModel(data) {
  const bottom = chart.height - chart.bottom;
  const width = chart.width - chart.left - chart.right;
  const height = bottom - chart.top;
  const highest = Math.max(...data.map((item) => item.sales), 0);
  const maximum = Math.max(Math.ceil((highest * 1.15) / 1000) * 1000, 1000);
  const points = data.map((item, index) => ({
    ...item,
    x: chart.left + (width / Math.max(data.length - 1, 1)) * index,
    y: bottom - (item.sales / maximum) * height,
  }));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: maximum * fraction,
    y: bottom - height * fraction,
  }));
  return { points, ticks, path: buildSmoothPath(points) };
}

function SalesChart({ trends }) {
  const [range, setRange] = useState("weekly");
  const [activePoint, setActivePoint] = useState(null);
  const data = trends[range] || [];
  const model = useMemo(() => chartModel(data), [data]);
  const labelStep = range === "daily" ? 4 : range === "monthly" ? 5 : 1;

  return (
    <article className="panel dashboard-sales-chart">
      <header className="dashboard-chart-header">
        <div>
          <h2>
            <BarChart3 size={18} aria-hidden="true" /> Weekly Sales Performance
          </h2>
          <p>
            Aggregate distribution of completed transactions grouped by {range}
          </p>
        </div>
        <div className="dashboard-segments" aria-label="Sales chart range">
          {ranges.map((item) => (
            <button
              className={range === item ? "active" : ""}
              type="button"
              key={item}
              onClick={() => {
                setRange(item);
                setActivePoint(null);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </header>
      <div className="chart-canvas">
        {activePoint && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(activePoint.x / chart.width) * 100}%`,
              top: `${(activePoint.y / chart.height) * 100}%`,
            }}
          >
            <strong>{activePoint.label}</strong>
            <span>{peso.format(activePoint.sales)}</span>
            <small>{activePoint.transactions} transactions</small>
          </div>
        )}
        <svg
          className="line-chart"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={`${range} sales performance`}
        >
          {model.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={chart.left}
                x2={chart.width - chart.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="chart-axis-label"
                x={chart.left - 10}
                y={tick.y + 4}
                textAnchor="end"
              >
                {peso.format(tick.value)}
              </text>
            </g>
          ))}
          <path className="chart-line" d={model.path} />
          {model.points.map((point, index) => (
            <g
              className={`chart-point ${activePoint?.label === point.label ? "active" : ""}`}
              key={point.label}
              tabIndex="0"
              role="button"
              onPointerEnter={() => setActivePoint(point)}
              onPointerLeave={() => setActivePoint(null)}
              onFocus={() => setActivePoint(point)}
              onBlur={() => setActivePoint(null)}
            >
              <circle cx={point.x} cy={point.y} r="5" />
              {index % labelStep === 0 && (
                <text
                  className="chart-x-label"
                  x={point.x}
                  y={chart.height - 20}
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </article>
  );
}

export default SalesChart;

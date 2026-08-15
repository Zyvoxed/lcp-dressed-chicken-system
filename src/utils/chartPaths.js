export function buildSmoothPath(points) {
  if (points.length === 0) {
    return ''
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  return points.slice(0, -1).reduce((path, point, index) => {
    const nextPoint = points[index + 1]
    const previousPoint = points[index - 1] ?? point
    const afterNextPoint = points[index + 2] ?? nextPoint
    const controlPointOne = {
      x: point.x + (nextPoint.x - previousPoint.x) / 6,
      y: point.y + (nextPoint.y - previousPoint.y) / 6,
    }
    const controlPointTwo = {
      x: nextPoint.x - (afterNextPoint.x - point.x) / 6,
      y: nextPoint.y - (afterNextPoint.y - point.y) / 6,
    }

    return `${path} C ${controlPointOne.x} ${controlPointOne.y}, ${controlPointTwo.x} ${controlPointTwo.y}, ${nextPoint.x} ${nextPoint.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

export function buildAreaPath(points, baselineY) {
  if (points.length === 0) {
    return ''
  }

  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]

  return `${buildSmoothPath(points)} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`
}

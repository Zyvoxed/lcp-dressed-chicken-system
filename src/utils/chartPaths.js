export function buildMonotonePath(points) {
  if (points.length === 0) {
    return ''
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  const slopes = points.slice(0, -1).map((point, index) => {
    const nextPoint = points[index + 1]
    return (nextPoint.y - point.y) / (nextPoint.x - point.x)
  })
  const tangents = points.map((point, index) => {
    if (index === 0) return slopes[0]
    if (index === points.length - 1) return slopes[slopes.length - 1]

    const previousSlope = slopes[index - 1]
    const nextSlope = slopes[index]
    if (previousSlope === 0 || nextSlope === 0 || Math.sign(previousSlope) !== Math.sign(nextSlope)) return 0
    return (previousSlope + nextSlope) / 2
  })

  // Clamp control-point heights to each segment so the smoothed path cannot overshoot its data.
  slopes.forEach((slope, index) => {
    if (slope === 0) {
      tangents[index] = 0
      tangents[index + 1] = 0
      return
    }

    const startRatio = tangents[index] / slope
    const endRatio = tangents[index + 1] / slope
    const magnitude = Math.hypot(startRatio, endRatio)
    if (magnitude <= 3) return

    const scale = 3 / magnitude
    tangents[index] = scale * startRatio * slope
    tangents[index + 1] = scale * endRatio * slope
  })

  return points.slice(0, -1).reduce((path, point, index) => {
    const nextPoint = points[index + 1]
    const interval = nextPoint.x - point.x
    const minimumY = Math.min(point.y, nextPoint.y)
    const maximumY = Math.max(point.y, nextPoint.y)
    const controlOneY = Math.min(Math.max(point.y + ((tangents[index] * interval) / 3), minimumY), maximumY)
    const controlTwoY = Math.min(Math.max(nextPoint.y - ((tangents[index + 1] * interval) / 3), minimumY), maximumY)

    return `${path} C ${point.x + (interval / 3)} ${controlOneY}, ${nextPoint.x - (interval / 3)} ${controlTwoY}, ${nextPoint.x} ${nextPoint.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

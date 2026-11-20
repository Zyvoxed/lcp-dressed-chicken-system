const reportingTimeZone = 'Asia/Manila'

function getReportingYearAndMonth(date) {
  const parts = new Intl.DateTimeFormat('en-PH', {
    timeZone: reportingTimeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  return { year, month }
}

export function getCurrentReportingYear(now = new Date()) {
  return getReportingYearAndMonth(now).year
}

export function getMonthlyIndexesForYear(year, now = new Date()) {
  if (year === null || year === undefined || year === '') return []
  const selectedYear = Number(year)
  if (!Number.isInteger(selectedYear)) return []

  const current = getReportingYearAndMonth(now)
  const monthCount = selectedYear < current.year
    ? 12
    : selectedYear === current.year
      ? current.month
      : 0

  return Array.from({ length: monthCount }, (_, index) => index)
}

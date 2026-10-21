const activityDate = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const activityTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const activityDateTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export function formatActivityTimestamp(value) {
  const timestamp = new Date(value)
  if (!value || Number.isNaN(timestamp.getTime())) {
    return { date: 'Date unavailable', time: 'Time unavailable', dateTime: 'Time unavailable' }
  }

  return {
    date: activityDate.format(timestamp),
    time: activityTime.format(timestamp),
    dateTime: activityDateTime.format(timestamp),
  }
}

function manilaDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

function calendarDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function activityDateRange(period, now = new Date()) {
  if (period === 'All Logs') return {}

  const { year, month, day } = manilaDateParts(now)
  const today = new Date(Date.UTC(year, month - 1, day))
  let start = today

  if (period === 'This Week') {
    const mondayOffset = (today.getUTCDay() + 6) % 7
    start = new Date(Date.UTC(year, month - 1, day - mondayOffset))
  }
  if (period === 'This Month') start = new Date(Date.UTC(year, month - 1, 1))

  return {
    start_date: calendarDate(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
    end_date: calendarDate(year, month, day),
  }
}

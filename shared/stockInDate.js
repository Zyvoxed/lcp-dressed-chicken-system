export const STOCK_IN_INVALID_DATE_MESSAGE = 'Delivery date is invalid.'
export const STOCK_IN_FUTURE_DATE_MESSAGE = 'Future stock-in dates are not allowed. Please select today or a previous date.'

const businessTimeZone = 'Asia/Manila'
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/
const zonedDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(?:\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/i

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function calendarDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function datePartsInBusinessTimeZone(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return { year: values.year, month: values.month, day: values.day }
}

export function getBusinessCalendarDate(now = new Date()) {
  const { year, month, day } = datePartsInBusinessTimeZone(now)
  return calendarDate(year, month, day)
}

export function getBusinessDateTimeLocal(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function getStockInCalendarDate(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const localMatch = text.match(localDateTimePattern)
  if (localMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = localMatch
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const hour = Number(hourText || 0)
    const minute = Number(minuteText || 0)
    const second = Number(secondText || 0)
    if (!validDateParts(year, month, day, hour, minute, second)) return null
    return calendarDate(year, month, day)
  }

  const zonedMatch = text.match(zonedDateTimePattern)
  if (!zonedMatch) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = zonedMatch
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText || 0)
  if (!validDateParts(year, month, day, hour, minute, second)) return null

  if (zone.toUpperCase() !== 'Z') {
    const [offsetHours, offsetMinutes] = zone.slice(1).split(':').map(Number)
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null
  }

  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) return null
  const businessDate = datePartsInBusinessTimeZone(instant)
  return calendarDate(businessDate.year, businessDate.month, businessDate.day)
}

export function isStockInDateAllowed(value, now = new Date()) {
  const submittedDate = getStockInCalendarDate(value)
  return submittedDate !== null && submittedDate <= getBusinessCalendarDate(now)
}

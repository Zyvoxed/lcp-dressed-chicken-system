export function escapeCsv(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildCsv(columns, rows) {
  return [columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')
}

export function exportCsv(filename, columns, rows) {
  const blob = new Blob([buildCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

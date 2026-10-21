import { ChevronLeft, ChevronRight, Search, ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'

function defaultSortValue(row, columnIndex) {
  if (Array.isArray(row)) {
    return row[columnIndex]
  }

  return Object.values(row ?? {})[columnIndex]
}

function compareValues(left, right) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)

  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber
  }

  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function DataTable({
  columns,
  rows,
  renderRow,
  getSortValue = defaultSortValue,
  pageSize = 8,
  searchable = true,
  searchPlaceholder = 'Search records',
}) {
  const [query, setQuery] = useState('')
  const [sortConfig, setSortConfig] = useState({ index: null, direction: 'asc' })
  const [currentPage, setCurrentPage] = useState(1)
  const safeRows = useMemo(() => rows ?? [], [rows])

  const processedRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filteredRows = normalizedQuery
      ? safeRows.filter((row) => Object.values(row ?? {}).join(' ').toLowerCase().includes(normalizedQuery))
      : safeRows

    if (sortConfig.index === null) {
      return filteredRows
    }

    return [...filteredRows].sort((left, right) => {
      const result = compareValues(getSortValue(left, sortConfig.index), getSortValue(right, sortConfig.index))

      return sortConfig.direction === 'asc' ? result : -result
    })
  }, [getSortValue, query, safeRows, sortConfig])

  const pageCount = Math.max(Math.ceil(processedRows.length / pageSize), 1)
  const visiblePage = Math.min(currentPage, pageCount)
  const pageRows = processedRows.slice((visiblePage - 1) * pageSize, visiblePage * pageSize)
  const startRow = processedRows.length ? (visiblePage - 1) * pageSize + 1 : 0
  const endRow = Math.min(visiblePage * pageSize, processedRows.length)

  function handleSort(columnIndex) {
    setCurrentPage(1)
    setSortConfig((current) => ({
      index: columnIndex,
      direction: current.index === columnIndex && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div className="data-table-shell">
      {searchable && (
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              placeholder={searchPlaceholder}
              onChange={(event) => {
                setQuery(event.target.value)
                setCurrentPage(1)
              }}
              aria-label={searchPlaceholder}
            />
          </label>
        </div>
      )}
      <div className="table-scroll">
        <table className="system-data-table">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column}
                  aria-sort={sortConfig.index === index
                    ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending')
                    : undefined}
                >
                  <button type="button" onClick={() => handleSort(index)}>
                    {column}
                    <ArrowUpDown size={13} aria-hidden="true" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(renderRow)}
            {!pageRows.length && (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  No matching records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <span>
          Showing {startRow}-{endRow} of {processedRows.length}
        </span>
        <div>
          <button
            type="button"
            onClick={() => setCurrentPage(Math.max(visiblePage - 1, 1))}
            disabled={visiblePage === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{visiblePage} / {pageCount}</strong>
          <button
            type="button"
            onClick={() => setCurrentPage(Math.min(visiblePage + 1, pageCount))}
            disabled={visiblePage === pageCount}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default DataTable

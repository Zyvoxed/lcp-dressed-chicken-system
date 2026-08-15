import { ChevronLeft, ChevronRight, Search, ArrowUpDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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
  searchPlaceholder = 'Search table records',
}) {
  const [query, setQuery] = useState('')
  const [sortConfig, setSortConfig] = useState({ index: null, direction: 'asc' })
  const [currentPage, setCurrentPage] = useState(1)
  const safeRows = rows ?? []

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
  const pageRows = processedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const startRow = processedRows.length ? (currentPage - 1) * pageSize + 1 : 0
  const endRow = Math.min(currentPage * pageSize, processedRows.length)

  useEffect(() => {
    setCurrentPage(1)
  }, [query, sortConfig])

  function handleSort(columnIndex) {
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
              onChange={(event) => setQuery(event.target.value)}
              aria-label={searchPlaceholder}
            />
          </label>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column}>
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
                  No records match your search.
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
            onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
            disabled={currentPage === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{currentPage} / {pageCount}</strong>
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(page + 1, pageCount))}
            disabled={currentPage === pageCount}
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

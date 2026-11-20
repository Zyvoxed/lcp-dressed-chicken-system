import { useLayoutEffect, useRef } from 'react'
import {
  countNumericCharacters,
  formatNumberInput,
  formattedCaretPosition,
  normalizeNumericInput,
} from '../../utils/formattedNumber.js'

function FormattedNumberInput({ value, onValueChange, ...inputProps }) {
  const inputRef = useRef(null)
  const pendingSelection = useRef(null)
  const displayValue = formatNumberInput(value)

  useLayoutEffect(() => {
    const input = inputRef.current
    const selection = pendingSelection.current
    if (!input || !selection) return

    const start = formattedCaretPosition(displayValue, selection.start)
    const end = formattedCaretPosition(displayValue, selection.end)
    input.setSelectionRange(start, end)
    pendingSelection.current = null
  })

  function handleChange(event) {
    const input = event.currentTarget
    const start = countNumericCharacters(input.value.slice(0, input.selectionStart ?? input.value.length))
    const end = countNumericCharacters(input.value.slice(0, input.selectionEnd ?? input.value.length))
    const rawValue = normalizeNumericInput(input.value)
    pendingSelection.current = { start, end }
    onValueChange(rawValue, event)
  }

  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      autoComplete={inputProps.autoComplete || 'off'}
    />
  )
}

export default FormattedNumberInput

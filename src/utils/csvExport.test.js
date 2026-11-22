import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCsv, escapeCsv, manilaDateStamp } from './csvExport.js'

test('CSV export includes the expected headers and report values in record order', () => {
  const columns = ['Sale ID', 'Customer', 'Payment Type', 'Total Amount']
  const visibleRecords = [
    ['OR-17', 'Market Supply', 'Cash', '1250.00'],
    ['OR-18', 'Credit Customer', 'Credit', '89.50'],
  ]

  assert.equal(buildCsv(columns, visibleRecords), [
    'Sale ID,Customer,Payment Type,Total Amount',
    'OR-17,Market Supply,Cash,1250.00',
    'OR-18,Credit Customer,Credit,89.50',
  ].join('\r\n'))
})

test('CSV export with no report records contains the header row only', () => {
  assert.equal(buildCsv(['Product', 'Stock Quantity', 'Status'], []), 'Product,Stock Quantity,Status')
})

test('CSV values with commas, quotes, CRLF, and newlines are quoted and escaped', () => {
  assert.equal(escapeCsv('Unit 4, "North"'), '"Unit 4, ""North"""')
  assert.equal(escapeCsv('First line\r\nSecond line'), '"First line\r\nSecond line"')
  assert.equal(buildCsv(['Customer', 'Address'], [['A, B "Farm"', 'Line 1\nLine 2']]), [
    'Customer,Address',
    '"A, B ""Farm""","Line 1\nLine 2"',
  ].join('\r\n'))
})

test('CSV export neutralizes formula-like text after leading whitespace and control characters', () => {
  const textValues = [
    '=1+1',
    '+SUM(1,2)',
    '-cmd',
    '@SUM(A1:A2)',
    ' =1+1',
    '\t=1+1',
    '\r=1+1',
    '\n=1+1',
    '\u0001=1+1',
  ]

  assert.equal(buildCsv(['Text'], textValues.map((value) => [value])), [
    'Text',
    "'=1+1",
    '"\'+SUM(1,2)"',
    "'-cmd",
    "'@SUM(A1:A2)",
    "' =1+1",
    "'\t=1+1",
    "\"'\r=1+1\"",
    "\"'\n=1+1\"",
    "'\u0001=1+1",
  ].join('\r\n'))
})

test('CSV export preserves numeric values and ordinary text while escaping cell syntax', () => {
  assert.equal(buildCsv(['Description', 'Amount'], [
    ['Refund', -12.5],
    ['Refund string', '-12.50'],
    ['Sale', 25],
    ['Sale string', '25.00'],
    ['Ordinary text', 'Fresh chicken'],
    ['Comma, quotes, and newline', 'Farm, "North"\nSecond line'],
  ]), [
    'Description,Amount',
    'Refund,-12.5',
    'Refund string,-12.50',
    'Sale,25',
    'Sale string,25.00',
    'Ordinary text,Fresh chicken',
    '"Comma, quotes, and newline","Farm, ""North""\nSecond line"',
  ].join('\r\n'))
})

test('CSV headers and column order remain unchanged for safe labels', () => {
  assert.equal(buildCsv(['Sale ID', 'Customer', 'Amount'], [['OR-20', 'Market Supply', '12.00']]), [
    'Sale ID,Customer,Amount',
    'OR-20,Market Supply,12.00',
  ].join('\r\n'))
})

test('Manila CSV date stamps use the Asia/Manila calendar date', () => {
  assert.equal(manilaDateStamp('2026-11-21T17:30:00.000Z'), '2026-11-22')
})

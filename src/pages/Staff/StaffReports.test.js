import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

test('Staff Reports initial loading state renders a supported skeleton without throwing', async () => {
  const vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    plugins: [react()],
    logLevel: 'silent',
    server: { middlewareMode: true },
  })

  try {
    const [{ default: StaffReports }, { ToastProvider }, { default: ReportsTabs }] = await Promise.all([
      vite.ssrLoadModule('/src/pages/Staff/StaffReports.jsx'),
      vite.ssrLoadModule('/src/context/ToastContext.jsx'),
      vite.ssrLoadModule('/src/pages/Reports/ReportsTabs.jsx'),
    ])
    const markup = renderToString(createElement(ToastProvider, null, createElement(StaffReports)))
    const adminTabs = renderToString(createElement(ReportsTabs, { activeTab: 'Sales & Revenue Audit', onSelect: () => {} }))

    assert.match(markup, /page-skeleton-report-sales/)
    assert.match(markup, /Loading <!-- -->operational report/)
    assert.equal((markup.match(/role="tab"/g) || []).length, 3)
    assert.match(markup, /Sales Activity Audit/)
    assert.match(markup, /Inventory Status/)
    assert.match(markup, /Customer Receivables Ledger/)
    assert.doesNotMatch(markup, /Stock-In Activity/)
    assert.match(adminTabs, /Sales &amp; Revenue Audit/)
    assert.match(adminTabs, /Inventory Assets Valuation/)
    assert.match(adminTabs, /Credit Receivables Ledger/)
    assert.doesNotMatch(markup, /Unknown page skeleton variant/)
  } finally {
    await vite.close()
  }
})

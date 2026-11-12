import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'

const ToastContext = createContext(null)
const defaultDuration = 4500
const maximumVisibleToasts = 4

const toastDetails = {
  success: { title: 'Success', icon: CheckCircle2, live: 'polite' },
  error: { title: 'Error', icon: AlertTriangle, live: 'assertive' },
  warning: { title: 'Warning', icon: TriangleAlert, live: 'assertive' },
  info: { title: 'Information', icon: Info, live: 'polite' },
}

function ToastViewport({ toasts, onDismiss }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="toast-viewport" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const detail = toastDetails[toast.type] || toastDetails.info
          const Icon = detail.icon
          return (
            <motion.div
              key={toast.id}
              className={`system-toast ${toast.type}`}
              role={toast.type === 'success' || toast.type === 'info' ? 'status' : 'alert'}
              aria-live={detail.live}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              layout
            >
              <Icon className="system-toast-icon" size={20} aria-hidden="true" />
              <div className="system-toast-copy">
                <strong>{toast.title || detail.title}</strong>
                <p>{toast.message}</p>
              </div>
              <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification" title="Dismiss notification">
                <X size={17} aria-hidden="true" />
              </button>
              <span className="system-toast-progress" style={{ '--toast-duration': `${toast.duration}ms` }} aria-hidden="true" />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)
  const timers = useRef(new Map())

  const dismissToast = useCallback((id) => {
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((type, message, options = {}) => {
    if (!message) return
    const id = ++nextId.current
    const duration = Math.max(1200, Number(options.duration) || defaultDuration)
    const toast = { id, type: toastDetails[type] ? type : 'info', message: String(message), title: options.title, duration }
    setToasts((current) => [...current, toast].slice(-maximumVisibleToasts))
    const timer = window.setTimeout(() => dismissToast(id), duration)
    timers.current.set(id, timer)
  }, [dismissToast])

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
    timers.current.clear()
  }, [])

  const value = useMemo(() => ({
    showToast,
    showSuccess: (message, options) => showToast('success', message, options),
    showError: (message, options) => showToast('error', message, options),
    showWarning: (message, options) => showToast('warning', message, options),
    showInfo: (message, options) => showToast('info', message, options),
    dismissToast,
  }), [dismissToast, showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

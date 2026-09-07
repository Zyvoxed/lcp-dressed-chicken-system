import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

function LoginErrorNotification({ message, onClose, title }) {
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)

  const dismiss = useCallback(() => {
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, 180)
  }, [onClose])

  useEffect(() => {
    const dismissTimer = window.setTimeout(dismiss, 4320)
    function closeOnEscape(event) {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(dismissTimer)
      window.clearTimeout(closeTimer.current)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [dismiss])

  return (
    <div className={`login-notification ${closing ? 'closing' : ''}`} role="alert" aria-live="assertive">
      <AlertTriangle className="login-notification-icon" size={20} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss login error" title="Dismiss login error">
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  )
}

export default LoginErrorNotification

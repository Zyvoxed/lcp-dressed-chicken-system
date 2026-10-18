import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, MailCheck, Moon, Sun, XCircle } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme.js'
import { verifyRecoveryEmail } from '../../services/authService.js'
import { loginRoute, verifyEmailRoute } from '../../utils/constants.js'
import LoginHeader from './LoginHeader.jsx'

function VerifyEmail() {
  const { theme, toggleTheme } = useTheme()
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'))
  const [status, setStatus] = useState(() => token ? 'loading' : 'error')
  const [message, setMessage] = useState(() => token ? 'Checking your verification link...' : 'This verification link is invalid or has expired.')
  const started = useRef(false)
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  useEffect(() => {
    if (started.current) return
    started.current = true

    window.history.replaceState({}, '', verifyEmailRoute)

    if (!token) return

    verifyRecoveryEmail(token)
      .then((result) => {
        setStatus('success')
        setMessage(result.message)
      })
      .catch((error) => {
        setStatus('error')
        setMessage(error.message || 'Unable to verify recovery email')
      })
  }, [token])

  return (
    <main className="login-page">
      <div className="login-ambient" aria-hidden="true"></div>
      <div className="login-shell">
        <LoginHeader />
        <section className="login-form-panel" aria-label="Recovery email verification">
          <button className="login-theme-toggle" type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
            {theme === 'dark' ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
          </button>
          <div className="login-card email-verification-card" aria-live="polite" aria-busy={status === 'loading'}>
            <header className="login-card-header">
              <span>Account Security</span>
              <h2>Verify Recovery Email</h2>
              <p>Confirming that this email belongs to you.</p>
            </header>
            <div className={`email-verification-status ${status}`} role={status === 'error' ? 'alert' : 'status'}>
              {status === 'loading' && <span className="login-spinner" aria-hidden="true" />}
              {status === 'success' && <CheckCircle2 size={34} aria-hidden="true" />}
              {status === 'error' && <XCircle size={34} aria-hidden="true" />}
              <strong>{status === 'loading' ? 'Please wait' : status === 'success' ? 'Email verified' : 'Unable to verify email'}</strong>
              <p>{message}</p>
            </div>
            {status !== 'loading' && <a className="primary-action login-submit" href={loginRoute}><MailCheck size={20} aria-hidden="true" />Return to Sign In</a>}
          </div>
        </section>
      </div>
    </main>
  )
}

export default VerifyEmail

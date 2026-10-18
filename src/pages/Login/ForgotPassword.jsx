import { useState } from 'react'
import { ArrowLeft, Mail, Moon, Send, Sun } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme.js'
import { requestPasswordReset } from '../../services/authService.js'
import { loginRoute } from '../../utils/constants.js'
import LoginHeader from './LoginHeader.jsx'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function ForgotPassword() {
  const { theme, toggleTheme } = useTheme()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedEmail = email.trim()

    if (!normalizedEmail || normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
      setError('Enter a valid recovery email address.')
      return
    }

    setError('')
    setLoading(true)
    try {
      const result = await requestPasswordReset(normalizedEmail)
      setMessage(result.message)
    } catch (requestError) {
      setError(requestError.message || 'Unable to process the request. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-ambient" aria-hidden="true"></div>
      <div className="login-shell">
        <LoginHeader />
        <section className="login-form-panel" aria-label="Password recovery">
          <button className="login-theme-toggle" type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
            {theme === 'dark' ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
          </button>
          {message ? (
            <div className="login-card email-verification-card" aria-live="polite">
              <header className="login-card-header">
                <span>Account Recovery</span>
                <h2>Check Your Email</h2>
                <p>{message}</p>
              </header>
              <a className="primary-action login-submit" href={loginRoute}><ArrowLeft size={20} aria-hidden="true" />Return to Sign In</a>
            </div>
          ) : (
            <form className="login-card" onSubmit={handleSubmit} aria-busy={loading}>
              <header className="login-card-header">
                <span>Account Recovery</span>
                <h2>Forgot Password?</h2>
                <p>Enter your verified recovery email. We will send a link to reset your password.</p>
              </header>
              <div className="input-group">
                <label htmlFor="recovery-email">Recovery Email</label>
                <span className={`login-input-wrap ${error ? 'invalid' : ''} ${loading ? 'disabled' : ''}`}>
                  <Mail size={18} aria-hidden="true" />
                  <input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} placeholder="Enter your recovery email" value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError('') }} disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? 'recovery-email-error' : undefined} required />
                </span>
                <small className="login-field-error" id="recovery-email-error">{error || '\u00a0'}</small>
              </div>
              <button type="submit" className="primary-action login-submit" disabled={loading}>
                {loading && <span className="login-spinner" aria-hidden="true" />}
                {loading ? 'Sending...' : 'Send Reset Link'}
                {!loading && <Send size={20} aria-hidden="true" />}
              </button>
              <a className="login-secondary-link" href={loginRoute}><ArrowLeft size={16} aria-hidden="true" />Back to Sign In</a>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}

export default ForgotPassword

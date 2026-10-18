import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme.js'
import { resetPassword } from '../../services/authService.js'
import { loginRoute, resetPasswordRoute } from '../../utils/constants.js'
import LoginHeader from './LoginHeader.jsx'

const minimumPasswordLength = 8
const maximumPasswordLength = 72

function ResetPassword() {
  const { theme, toggleTheme } = useTheme()
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [error, setError] = useState(() => token ? '' : 'This password reset link is invalid or has expired.')
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'

  useEffect(() => {
    window.history.replaceState({}, '', resetPasswordRoute)
  }, [])

  function updateField(name) {
    return (event) => {
      setForm((current) => ({ ...current, [name]: event.target.value }))
      if (error && token) setError('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!token) {
      setError('This password reset link is invalid or has expired.')
      return
    }
    if (form.password.length < minimumPasswordLength || form.password.length > maximumPasswordLength) {
      setError(`Password must be between ${minimumPasswordLength} and ${maximumPasswordLength} characters.`)
      return
    }
    if (form.password !== form.confirmation) {
      setError('Passwords do not match.')
      return
    }

    setError('')
    setLoading(true)
    try {
      await resetPassword(token, form.password)
      setForm({ password: '', confirmation: '' })
      setComplete(true)
    } catch (requestError) {
      setError(requestError.message || 'Unable to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-ambient" aria-hidden="true"></div>
      <div className="login-shell">
        <LoginHeader />
        <section className="login-form-panel" aria-label="Reset password">
          <button className="login-theme-toggle" type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
            {theme === 'dark' ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
          </button>
          {complete ? (
            <div className="login-card email-verification-card" aria-live="polite">
              <header className="login-card-header">
                <span>Account Security</span>
                <h2>Password Changed</h2>
                <p>Your password was changed successfully. You can now sign in.</p>
              </header>
              <div className="email-verification-status success" role="status">
                <CheckCircle2 size={34} aria-hidden="true" />
                <strong>Password updated</strong>
              </div>
              <a className="primary-action login-submit" href={loginRoute}>Return to Sign In</a>
            </div>
          ) : (
            <form className="login-card" onSubmit={handleSubmit} aria-busy={loading}>
              <header className="login-card-header">
                <span>Account Security</span>
                <h2>Set New Password</h2>
                <p>Enter a new password with at least {minimumPasswordLength} characters.</p>
              </header>
              <div className="input-group">
                <label htmlFor="reset-password">New Password</label>
                <span className={`login-input-wrap ${error ? 'invalid' : ''} ${loading ? 'disabled' : ''}`}>
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input id="reset-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={minimumPasswordLength} maxLength={maximumPasswordLength} placeholder="Enter your new password" value={form.password} onChange={updateField('password')} disabled={loading || !token} required />
                  <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} disabled={loading || !token} aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} title={showPassword ? 'Hide passwords' : 'Show passwords'}>
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </span>
              </div>
              <div className="input-group">
                <label htmlFor="reset-password-confirmation">Confirm New Password</label>
                <span className={`login-input-wrap ${error ? 'invalid' : ''} ${loading ? 'disabled' : ''}`}>
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input id="reset-password-confirmation" name="confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={minimumPasswordLength} maxLength={maximumPasswordLength} placeholder="Enter the password again" value={form.confirmation} onChange={updateField('confirmation')} disabled={loading || !token} required />
                </span>
                <small className="login-field-error" role={error ? 'alert' : undefined}>{error || '\u00a0'}</small>
              </div>
              <button type="submit" className="primary-action login-submit" disabled={loading || !token}>
                {loading && <span className="login-spinner" aria-hidden="true" />}
                {loading ? 'Changing Password...' : 'Change Password'}
              </button>
              <a className="login-secondary-link" href={loginRoute}><ArrowLeft size={16} aria-hidden="true" />Back to Sign In</a>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}

export default ResetPassword

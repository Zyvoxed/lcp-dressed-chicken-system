import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { resetPassword } from '../../services/authService.js'
import { loginRoute, resetPasswordRoute } from '../../utils/constants.js'
import LoginBrandSection from './LoginBrandSection.jsx'
import LoginBackground from './LoginBackground.jsx'

const minimumPasswordLength = 8
const maximumPasswordLength = 72

function ResetPassword() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [error, setError] = useState(() => (token ? '' : 'This password reset link is invalid or has expired.'))
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
    <main className="login-page login-page-enterprise-layout">
      {/* Premium Warm Minimalist Background */}
      <LoginBackground />

      {/* Two-Panel Enterprise Container */}
      <div className="login-split-container">
        <LoginBrandSection />

        <section className="login-card-section" aria-label="Reset password">
          <div className="login-card-elevated-wrap">
            <div className="login-card">
              <div className="login-card-heading-wrap">
                <h2 className="login-title">Set New Password</h2>
                <p className="login-subtitle">
                  Enter a new password with at least {minimumPasswordLength} characters.
                </p>
              </div>

              {complete ? (
                <div className="login-recovery-success" role="status">
                  <div className="login-recovery-icon-wrap" aria-hidden="true">
                    <CheckCircle2 size={36} />
                  </div>
                  <h3 className="login-recovery-success-title">Password Changed</h3>
                  <p className="login-recovery-success-desc">
                    Your password was changed successfully. You can now log in with your new password.
                  </p>
                  <a className="primary-action login-submit" href={loginRoute}>
                    <ArrowLeft size={16} aria-hidden="true" />
                    Return to Log In
                  </a>
                </div>
              ) : (
                <form className="login-form-view" onSubmit={handleSubmit} aria-busy={loading}>
                  <div className="input-group">
                    <label htmlFor="reset-password">New Password</label>
                    <span className={`login-input-wrap ${error ? 'invalid' : ''} ${loading ? 'disabled' : ''}`}>
                      <LockKeyhole size={17} aria-hidden="true" />
                      <input
                        id="reset-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={minimumPasswordLength}
                        maxLength={maximumPasswordLength}
                        placeholder="Enter your new password"
                        value={form.password}
                        onChange={updateField('password')}
                        disabled={loading || !token}
                        required
                      />
                      <button
                        type="button"
                        className="password-visibility"
                        onClick={() => setShowPassword((visible) => !visible)}
                        disabled={loading || !token}
                        aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                        title={showPassword ? 'Hide passwords' : 'Show passwords'}
                      >
                        {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </span>
                  </div>

                  <div className="input-group">
                    <label htmlFor="reset-password-confirmation">Confirm New Password</label>
                    <span className={`login-input-wrap ${error ? 'invalid' : ''} ${loading ? 'disabled' : ''}`}>
                      <LockKeyhole size={17} aria-hidden="true" />
                      <input
                        id="reset-password-confirmation"
                        name="confirmation"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={minimumPasswordLength}
                        maxLength={maximumPasswordLength}
                        placeholder="Enter the password again"
                        value={form.confirmation}
                        onChange={updateField('confirmation')}
                        disabled={loading || !token}
                        required
                      />
                    </span>
                    <small className="login-field-error" role={error ? 'alert' : undefined}>
                      {error || '\u00a0'}
                    </small>
                  </div>

                  <button type="submit" className="primary-action login-submit" disabled={loading || !token}>
                    {loading && <span className="login-spinner" aria-hidden="true" />}
                    {loading ? 'Changing Password...' : 'Change Password →'}
                  </button>

                  <div className="login-back-row">
                    <a className="login-back-btn" href={loginRoute}>
                      <ArrowLeft size={16} aria-hidden="true" />
                      Back to Log In
                    </a>
                  </div>

                  {/* Trust Badges */}
                  <div className="login-card-trust-badges">
                    <span><ShieldCheck size={13} aria-hidden="true" /> Secure Reset</span>
                    <span><LockKeyhole size={13} aria-hidden="true" /> SSL Protected</span>
                    <span><KeyRound size={13} aria-hidden="true" /> 256-bit TLS</span>
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default ResetPassword

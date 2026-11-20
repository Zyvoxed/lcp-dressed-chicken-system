import { useState } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { requestPasswordReset } from '../../services/authService.js'
import { loginRoute } from '../../utils/constants.js'
import LoginBrandSection from './LoginBrandSection.jsx'
import LoginBackground from './LoginBackground.jsx'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

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
    <main className="login-page login-page-enterprise-layout">
      {/* Premium Warm Minimalist Background */}
      <LoginBackground />

      {/* Two-Panel Enterprise Container */}
      <div className="login-split-container">
        <LoginBrandSection />

        <section className="login-card-section" aria-label="Password recovery">
          <div className="login-card-elevated-wrap">
            <div className="login-card">
              <div className="login-card-heading-wrap">
                <h2 className="login-title">Account Recovery</h2>
                <p className="login-subtitle">
                  Enter your verified recovery email to reset your account password.
                </p>
              </div>

              {message ? (
                <div className="login-recovery-success" role="status">
                  <div className="login-recovery-icon-wrap" aria-hidden="true">
                    <CheckCircle2 size={36} />
                  </div>
                  <h3 className="login-recovery-success-title">Check Your Email</h3>
                  <p className="login-recovery-success-desc">{message}</p>
                  <a className="primary-action login-submit" href={loginRoute}>
                    <ArrowLeft size={16} aria-hidden="true" />
                    Return to Log In
                  </a>
                </div>
              ) : (
                <form className="login-form-view" onSubmit={handleSubmit} aria-busy={loading}>
                  <div className="input-group">
                    <label htmlFor="recovery-email">Recovery Email</label>
                    <span className={`login-input-wrap ${error ? 'invalid' : ''} ${loading ? 'disabled' : ''}`}>
                      <Mail size={17} aria-hidden="true" />
                      <input
                        id="recovery-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        maxLength={254}
                        placeholder="Enter your recovery email"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value)
                          if (error) setError('')
                        }}
                        disabled={loading}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? 'recovery-email-error' : undefined}
                        required
                      />
                    </span>
                    <small className="login-field-error" id="recovery-email-error">
                      {error || '\u00a0'}
                    </small>
                  </div>

                  <button type="submit" className="primary-action login-submit" disabled={loading}>
                    {loading && <span className="login-spinner" aria-hidden="true" />}
                    {loading ? 'Sending...' : 'Send Reset Link →'}
                  </button>

                  <div className="login-back-row">
                    <a className="login-back-btn" href={loginRoute}>
                      <ArrowLeft size={16} aria-hidden="true" />
                      Back to Log In
                    </a>
                  </div>

                  {/* Trust Badges */}
                  <div className="login-card-trust-badges">
                    <span><ShieldCheck size={13} aria-hidden="true" /> Secure Recovery</span>
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

export default ForgotPassword

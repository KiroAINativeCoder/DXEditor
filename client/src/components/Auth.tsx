import { useState } from 'react'
import { auth, ApiError, type User } from '../lib/api'
import './Auth.css'

export default function Auth({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkInbox, setCheckInbox] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await auth.signIn(email, password)
        const user = await auth.current()
        if (!user) throw new ApiError(401, 'Please confirm your email first, then log in.')
        onAuthed({ ...user, name: user.name })
      } else {
        const { needsConfirmation } = await auth.signUp(email, password, name || undefined)
        if (needsConfirmation) {
          setCheckInbox(true) // confirmation email sent; user must click the link
        } else {
          const user = await auth.current()
          if (user) onAuthed({ ...user, name: name || user.name })
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (checkInbox) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="brand-mark">DD</span>
            <span className="brand-name">DevDocs</span>
          </div>
          <h1 className="auth-title">Check your inbox</h1>
          <p className="auth-note">
            We sent a confirmation link to <strong>{email}</strong>. Click it to
            activate your account, then come back and log in.
          </p>
          <button
            className="auth-submit"
            type="button"
            onClick={() => {
              setCheckInbox(false)
              setMode('login')
            }}
          >
            Back to log in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-mark">DD</span>
          <span className="brand-name">DevDocs</span>
        </div>
        <h1 className="auth-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>

        {mode === 'register' && (
          <label className="auth-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </label>
        )}
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6+ characters"
          />
        </label>

        {error && <div className="auth-error">{error}</div>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>

        <div className="auth-switch">
          {mode === 'login' ? "No account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </form>
    </div>
  )
}

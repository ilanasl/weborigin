import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const fn = mode === 'in' ? signIn : signUp
    const { error } = await fn(email.trim(), pw)
    setBusy(false)
    if (error) setErr(error.message)
    else if (mode === 'up') setErr('נשלח מייל אימות (אם מופעל). אפשר להתחבר.')
  }

  return (
    <div className="app-shell max-w-[420px] pt-16">
      <h1 className="text-4xl font-black mb-1">לומדים <span className="text-primary">ביחד</span></h1>
      <p className="text-muted mb-8">{mode === 'in' ? 'התחברות' : 'יצירת חשבון'}</p>
      <form onSubmit={submit} className="card flex flex-col gap-3">
        <input className="field" type="email" placeholder="אימייל" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <input className="field" type="password" placeholder="סיסמה" value={pw}
          onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        {err && <div className="text-[13.5px] text-bad">{err}</div>}
        <button className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? '…' : mode === 'in' ? 'כניסה' : 'הרשמה'}
        </button>
      </form>
      <button className="text-primary text-sm font-semibold mt-4"
        onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'אין חשבון? הרשמה' : 'יש חשבון? כניסה'}
      </button>
    </div>
  )
}

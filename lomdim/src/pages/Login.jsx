import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'

// הודעות השגיאה של Supabase — בעברית ובשפה פשוטה
export function authErrorText(err) {
  const m = String(err?.message || err || '')
  if (/invalid login credentials/i.test(m)) return 'האימייל או הסיסמה לא נכונים.'
  if (/email not confirmed/i.test(m)) return 'צריך קודם לאשר את המייל — חפשו מייל אימות (גם בתיקיית הספאם).'
  if (/already registered|already been registered|user already exists/i.test(m)) return 'כבר יש חשבון עם המייל הזה — עברו ל"כניסה".'
  if (/at least 6|password should be/i.test(m)) return 'הסיסמה צריכה להיות לפחות 6 תווים.'
  if (/different from the old|same as the old|same password/i.test(m)) return 'הסיסמה החדשה צריכה להיות שונה מהקודמת.'
  if (/rate limit|too many|security purposes/i.test(m)) return 'היו יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.'
  if (/invalid.*email|unable to validate email/i.test(m)) return 'כתובת המייל לא תקינה.'
  if (/failed to fetch|network|load failed/i.test(m)) return 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.'
  return 'משהו השתבש. נסו שוב.'
}

// שדה סיסמה עם כפתור הצגה/הסתרה
export function PasswordField({ value, onChange, autoComplete, placeholder = 'סיסמה', id = 'password' }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input className="field" id={id} name={id} type={show ? 'text' : 'password'} placeholder={placeholder}
        value={value} onChange={onChange} autoComplete={autoComplete} required minLength={6} dir="ltr" style={{ textAlign: 'right', paddingLeft: 48 }} />
      <button type="button" className="login-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
      </button>
    </div>
  )
}

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState('in')   // in | up | forgot
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const switchTo = (m) => { setMode(m); setErr(''); setNote('') }

  async function submit(e) {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    try {
      if (mode === 'forgot') {
        const { error } = await resetPassword(email.trim())
        if (error) setErr(authErrorText(error))
        else setNote('שלחנו מייל עם קישור לבחירת סיסמה חדשה. פתחו אותו מהמכשיר הזה (בדקו גם בספאם).')
        return
      }
      const { data, error } = await (mode === 'in' ? signIn : signUp)(email.trim(), pw)
      if (error) setErr(authErrorText(error))
      else if (mode === 'up' && !data?.session) setNote('נשלח מייל אימות — לחצו על הקישור שבו, ואז התחברו כאן.')
    } finally { setBusy(false) }
  }

  return (
    <div className="app-shell max-w-[420px] pt-14">
      <h1 className="font-disp font-black text-[40px] leading-none mb-2">לומדים <span className="text-primary">ביחד</span></h1>
      <p className="text-muted text-[15px] mb-7">
        {mode === 'in' ? 'ברוכים השבים! התחברו כדי להמשיך.' : mode === 'up' ? 'יוצרים חשבון חדש — לוקח דקה.' : 'שכחתם סיסמה? נשלח לכם קישור לאיפוס.'}
      </p>

      {mode !== 'forgot' && (
        <div className="seg mb-4">
          {[['in', 'כניסה'], ['up', 'הרשמה']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => switchTo(k)}>
              <span className="font-bold text-[15px] py-1">{l}</span>
            </button>
          ))}
        </div>
      )}

      {/* name/autocomplete — כדי שהטלפון יציע לשמור את הסיסמה וימלא אותה בפעם הבאה */}
      <form onSubmit={submit} className="flex flex-col gap-3" method="post" action="#">
        <input className="field" id="email" name="email" type="email" placeholder="אימייל" value={email} dir="ltr" style={{ textAlign: 'right' }}
          onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" required />
        {mode !== 'forgot' && (
          <PasswordField value={pw} onChange={(e) => setPw(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            placeholder={mode === 'up' ? 'סיסמה (לפחות 6 תווים)' : 'סיסמה'} />
        )}
        {mode === 'in' && (
          <button type="button" className="self-start text-[13.5px] font-semibold text-muted" onClick={() => switchTo('forgot')}>שכחתי סיסמה</button>
        )}
        {err && <div className="text-[13.5px] font-semibold" style={{ color: 'var(--bad)' }}>{err}</div>}
        {note && <div className="text-[13.5px] font-semibold leading-relaxed" style={{ color: 'var(--good)' }}>{note}</div>}
        <button className="ts-practice !mb-0 mt-1" disabled={busy}>
          {busy ? '…' : mode === 'in' ? 'כניסה' : mode === 'up' ? 'יצירת חשבון' : 'שלחו לי קישור'}
        </button>
      </form>

      {mode === 'forgot' && (
        <button type="button" className="text-primary text-[14px] font-semibold mt-5" onClick={() => switchTo('in')}>→ חזרה לכניסה</button>
      )}
      <p className="text-muted text-[12.5px] mt-8 leading-relaxed">אחרי הכניסה הראשונה המכשיר זוכר אתכם — לא צריך להתחבר בכל פעם.</p>
    </div>
  )
}

// אחרי לחיצה על הקישור מהמייל — בוחרים סיסמה חדשה
export function NewPassword() {
  const { updatePassword } = useAuth()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await updatePassword(pw)
    setBusy(false)
    if (error) setErr(authErrorText(error))
  }
  return (
    <div className="app-shell max-w-[420px] pt-14">
      <h1 className="font-disp font-black text-[34px] leading-none mb-2">סיסמה חדשה</h1>
      <p className="text-muted text-[15px] mb-7">בחרו סיסמה חדשה (לפחות 6 תווים). הטלפון יציע לשמור אותה.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <PasswordField value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" id="new-password" placeholder="סיסמה חדשה" />
        {err && <div className="text-[13.5px] font-semibold" style={{ color: 'var(--bad)' }}>{err}</div>}
        <button className="ts-practice !mb-0 mt-1" disabled={busy || pw.length < 6}>{busy ? 'שומר…' : 'שמירה והמשך'}</button>
      </form>
    </div>
  )
}

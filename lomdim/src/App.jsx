import { useState, useCallback, useEffect, useRef } from 'react'
import Icon from './components/Icon'
import ConfirmDialog from './components/ConfirmDialog'
import { isConfigured, supabase } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login, { NewPassword } from './pages/Login'
import Home from './pages/Home'
import Subject from './pages/Subject'
import Upload from './pages/Upload'
import Practice from './pages/Practice'
import PracticePicker from './pages/PracticePicker'
import TopicSummary from './pages/TopicSummary'
import Reinforce from './pages/Reinforce'
import Planner from './pages/Planner'
import ExamBoard from './pages/ExamBoard'
import Syntax from './pages/Syntax'
import ParentReport from './pages/ParentReport'
import Explain from './pages/Explain'
import Flashcards from './pages/Flashcards'
import CheckExercise from './pages/CheckExercise'
import PastExams from './pages/PastExams'
import Store from './pages/Store'
import Soon from './pages/Soon'
import Settings from './pages/Settings'
import Parent from './pages/Parent'
import Summaries from './pages/Summaries'
import Materials from './pages/Materials'
import { confirmLeave } from './lib/leaveGuard'
import { parseDay } from './lib/plan'
import { startUpdateWatch, updateReady, reloadInto, restoredStack } from './lib/appUpdate'

startUpdateWatch()

function ConfigNeeded() {
  return (
    <div className="app-shell pt-16">
      <h1 className="text-3xl font-black mb-3">לומדים ביחד</h1>
      <div className="card">
        <h3 className="font-extrabold text-lg mb-2">כמעט מוכן — צריך מפתחות ✨</h3>
        <p className="text-muted text-[15px] leading-relaxed">
          העתיקו את <code>.env.example</code> ל־<code>.env.local</code> ומלאו את פרטי ה־Supabase
          (URL + anon key). את מפתח ה־AI מגדירים כ־Secret בפונקציית ה־Edge.
          כל ההוראות ב־<b>README.md</b>.
        </p>
      </div>
    </div>
  )
}

// מסכים שהם "באמצע משימה" — בלי סרגל, כדי שלא ייצאו מתרגול בלחיצה לא מכוונת
const TASK_ROUTES = new Set(['practice', 'reinforce', 'flashcards', 'syntax'])

const Ico = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const ICONS = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  board: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  play: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  boost: <><path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z" /><path d="M6 18a2 2 0 0 1 2-2h11M10 8h5" /></>,
  store: <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M3 7h18v3H3zM12 7v13" /><path d="M12 7c-1.5-3-5-3-5-1s3.5 1 5 1zM12 7c1.5-3 5-3 5-1s-3.5 1-5 1z" /></>,
}

// המקצוע עם המבחן הקרוב ביותר (או הראשון) — יעד ל"תרגל עכשיו" ו"לחיזוק"
async function focusSubject() {
  const { data } = await supabase.from('subjects').select('id, name, exam_date, quiz_date').order('created_at')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let best = null, bestT = Infinity
  for (const s of data || []) {
    for (const d of [s.exam_date, s.quiz_date]) {
      const t = d ? parseDay(d).getTime() : NaN
      if (t >= today.getTime() && t < bestT) { best = s; bestT = t }
    }
  }
  return best || (data || [])[0] || null
}

function FloatingNav({ route, go, reset }) {
  const [busy, setBusy] = useState(false)
  const toSubject = async (page) => {
    if (busy) return
    setBusy(true)
    try {
      const s = await focusSubject()
      if (!s) { reset('home'); return }
      reset('home')
      go(page, { subjectId: s.id, subjectName: s.name, mode: 'practice' })
    } finally { setBusy(false) }
  }
  const cur = (n) => (route === n ? 'page' : undefined)
  return (
    <>
    <div className="fnav-scrim" aria-hidden="true" />
    <nav className="fnav" aria-label="ניווט ראשי">
      <button type="button" aria-label="בית" aria-current={cur('home')} onClick={() => reset('home')}><Ico d={ICONS.home} /></button>
      <button type="button" aria-label="לוח מבחנים" aria-current={cur('examBoard')} onClick={() => { reset('home'); go('examBoard') }}><Ico d={ICONS.board} /></button>
      <button type="button" className="fnav-go" aria-label="תרגל עכשיו" disabled={busy} onClick={() => toSubject('practice')}><Ico d={ICONS.play} size={26} /></button>
      <button type="button" aria-label="לחיזוק" onClick={() => toSubject('reinforce')}><Ico d={ICONS.boost} /></button>
      <button type="button" aria-label="חנות הפרסים" aria-current={cur('store')} onClick={() => { reset('home'); go('store') }}><Ico d={ICONS.store} /></button>
    </nav>
    </>
  )
}

let seq = 0 // מזהה לכל מסך במחסנית — כדי ש"סבב נוסף" יתחיל מאפס

const PAGES = {
  home: Home, subject: Subject, upload: Upload, practice: Practice,
  practicePicker: PracticePicker, topicSummary: TopicSummary, reinforce: Reinforce, planner: Planner, examBoard: ExamBoard,
  explain: Explain, flashcards: Flashcards, check: CheckExercise, pastExams: PastExams, syntax: Syntax,
  parentReport: ParentReport, store: Store, soon: Soon,
  settings: Settings, parent: Parent, summaries: Summaries, materials: Materials,
}

function Shell() {
  const { user, loading, signOut, recovery } = useAuth()
  // אחרי טעינת גרסה חדשה — חוזרים לאותה מחסנית מסכים
  const [stack, setStack] = useState(() => (restoredStack() || [{ name: 'home', params: {} }]).map((r) => ({ ...r, id: ++seq })))
  const stackRef = useRef(stack)
  const [askLogout, setAskLogout] = useState(false)
  stackRef.current = stack
  // מעבר מסך: אם יש גרסה חדשה — טוענים אותה ישר למסך היעד; אחרת מעבר רגיל
  const apply = useCallback((next) => {
    stackRef.current = next   // מיידי — כדי ש-back ואחריו go באותה לחיצה יעבדו נכון
    if (updateReady()) { reloadInto(next); return }
    setStack(next)
  }, [])
  // מיקום הגלילה של כל מסך נשמר כשיוצאים ממנו, ו"חזרה" מחזירה בדיוק לאותו מקום
  const scrollMem = useRef({})
  const pendingY = useRef(0)
  const go = useCallback((name, params = {}) => {
    if (!confirmLeave()) return
    const s = stackRef.current
    const top = s[s.length - 1]
    if (top) scrollMem.current[top.id] = window.scrollY
    pendingY.current = 0
    apply([...s, { name, params, id: ++seq }])
  }, [apply])
  const back = useCallback(() => {
    if (!confirmLeave()) return
    const s = stackRef.current
    if (s.length <= 1) return
    const prev = s[s.length - 2]
    pendingY.current = scrollMem.current[prev.id] || 0
    apply(s.slice(0, -1))
  }, [apply])
  const reset = useCallback((name = 'home', params = {}) => {
    if (!confirmLeave()) return
    pendingY.current = 0
    apply([{ name, params, id: ++seq }])
  }, [apply])

  const topId = stack[stack.length - 1]?.id
  useEffect(() => {
    const y = pendingY.current
    if (!y) { window.scrollTo(0, 0); return }
    // המסך טוען נתונים מחדש — מחכים שיהיה מספיק גובה ואז גוללים (עד ~2.5 שניות)
    let tries = 0, raf
    const tick = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max >= y - 4 || tries++ > 150) { window.scrollTo(0, Math.min(y, max)); return }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [topId])

  if (loading) return <div className="app-shell pt-16 text-muted">טוען…</div>
  if (!user) return <Login />
  if (recovery) return <NewPassword />

  const route = stack[stack.length - 1]
  const Page = PAGES[route.name] || Home
  const nav = { go, back, reset, canBack: stack.length > 1 }

  const showNav = !TASK_ROUTES.has(route.name)

  return (
    <div className={`app-shell${showNav ? ' has-nav' : ''}`}>
      <header className="sticky top-[env(safe-area-inset-top,0)] z-20 flex items-center gap-2 py-3 backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)' }}>
        {nav.canBack ? (
          <button onClick={back} className="hbtn" aria-label="חזרה">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            חזרה
          </button>
        ) : (
          <span className="font-disp font-extrabold text-lg">לומדים <span className="text-primary">ביחד</span></span>
        )}
        <div className="flex-1" />
        {showNav && <>
        <button onClick={() => go('settings')} title="הגדרות" aria-label="הגדרות" className="hbtn !px-0 w-10"><Icon name="settings" size={19} /></button>
        <button onClick={() => confirmLeave() && setAskLogout(true)} className="hbtn" aria-label="יציאה"><Icon name="logout" size={18} />יציאה</button>
        </>}
      </header>
      <Page key={route.id} nav={nav} params={route.params} />
      {showNav && <FloatingNav route={route.name} go={go} reset={reset} />}
      <ConfirmDialog open={askLogout} danger icon="logout"
        title="לצאת מהחשבון?"
        text="כדי לחזור צריך להתחבר שוב עם האימייל והסיסמה. ההתקדמות נשמרת."
        confirmLabel="כן, לצאת" cancelLabel="להישאר"
        onCancel={() => setAskLogout(false)} onConfirm={() => { setAskLogout(false); signOut() }} />
    </div>
  )
}

export default function App() {
  if (!isConfigured) return <ConfigNeeded />
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

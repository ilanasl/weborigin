import { useState, useCallback } from 'react'
import { isConfigured, supabase } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const ICONS = {
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  board: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  play: <path d="M8 5l11 7-11 7z" fill="currentColor" />,
  boost: <><path d="M12 20V6" /><path d="M6 12l6-6 6 6" /></>,
  store: <><path d="M4 9h16l-1 11H5z" /><path d="M9 9V7a3 3 0 016 0v2" /></>,
}

// המקצוע עם המבחן הקרוב ביותר (או הראשון) — יעד ל"תרגל עכשיו" ו"לחיזוק"
async function focusSubject() {
  const { data } = await supabase.from('subjects').select('id, name, exam_date, quiz_date').order('created_at')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let best = null, bestT = Infinity
  for (const s of data || []) {
    for (const d of [s.exam_date, s.quiz_date]) {
      const t = d ? new Date(d).getTime() : NaN
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
    <nav className="fnav" aria-label="ניווט ראשי">
      <button type="button" aria-label="בית" aria-current={cur('home')} onClick={() => reset('home')}><Ico d={ICONS.home} /></button>
      <button type="button" aria-label="לוח מבחנים" aria-current={cur('examBoard')} onClick={() => { reset('home'); go('examBoard') }}><Ico d={ICONS.board} /></button>
      <button type="button" className="fnav-go" aria-label="תרגל עכשיו" disabled={busy} onClick={() => toSubject('practice')}><Ico d={ICONS.play} size={26} /></button>
      <button type="button" aria-label="לחיזוק" onClick={() => toSubject('reinforce')}><Ico d={ICONS.boost} /></button>
      <button type="button" aria-label="חנות הפרסים" aria-current={cur('store')} onClick={() => { reset('home'); go('store') }}><Ico d={ICONS.store} /></button>
    </nav>
  )
}

const PAGES = {
  home: Home, subject: Subject, upload: Upload, practice: Practice,
  practicePicker: PracticePicker, topicSummary: TopicSummary, reinforce: Reinforce, planner: Planner, examBoard: ExamBoard,
  explain: Explain, flashcards: Flashcards, check: CheckExercise, pastExams: PastExams, syntax: Syntax,
  parentReport: ParentReport, store: Store, soon: Soon,
  settings: Settings,
}

function Shell() {
  const { user, loading, signOut } = useAuth()
  const [stack, setStack] = useState([{ name: 'home', params: {} }])
  const go = useCallback((name, params = {}) => setStack((s) => [...s, { name, params }]), [])
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), [])
  const reset = useCallback((name = 'home', params = {}) => setStack([{ name, params }]), [])

  if (loading) return <div className="app-shell pt-16 text-muted">טוען…</div>
  if (!user) return <Login />

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
        <button onClick={() => go('settings')} title="הגדרות" aria-label="הגדרות" className="hbtn">⚙︎</button>
        <button onClick={signOut} className="hbtn">יציאה</button>
      </header>
      <Page nav={nav} params={route.params} />
      {showNav && <FloatingNav route={route.name} go={go} reset={reset} />}
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

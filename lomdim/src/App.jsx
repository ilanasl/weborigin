import { useState, useCallback } from 'react'
import { isConfigured } from './lib/supabase'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Home from './pages/Home'
import Subject from './pages/Subject'
import Upload from './pages/Upload'
import Practice from './pages/Practice'

function ConfigNeeded() {
  return (
    <div className="app-shell pt-16">
      <h1 className="text-3xl font-black mb-3">לומדים ביחד</h1>
      <div className="card">
        <h3 className="font-extrabold text-lg mb-2">כמעט מוכן — צריך מפתחות ✨</h3>
        <p className="text-muted text-[15px] leading-relaxed">
          העתיקו את <code>.env.example</code> ל־<code>.env.local</code> ומלאו את פרטי ה־Supabase
          (URL + anon key). את מפתח ה־Gemini מגדירים כ־Secret בפונקציית ה־Edge.
          כל ההוראות ב־<b>README.md</b>.
        </p>
      </div>
    </div>
  )
}

const PAGES = { home: Home, subject: Subject, upload: Upload, practice: Practice }

function Shell() {
  const { user, loading, signOut } = useAuth()
  const [stack, setStack] = useState([{ name: 'home', params: {} }])
  const go = useCallback((name, params = {}) => setStack((s) => [...s, { name, params }]), [])
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), [])
  const reset = useCallback((name = 'home', params = {}) => setStack([{ name, params }]), [])

  const toggleTheme = () => {
    const el = document.documentElement
    const dark = el.getAttribute('data-theme') === 'dark'
    el.setAttribute('data-theme', dark ? 'light' : 'dark')
  }

  if (loading) return <div className="app-shell pt-16 text-muted">טוען…</div>
  if (!user) return <Login />

  const route = stack[stack.length - 1]
  const Page = PAGES[route.name] || Home
  const nav = { go, back, reset, canBack: stack.length > 1 }

  return (
    <div className="app-shell">
      <header className="sticky top-[env(safe-area-inset-top,0)] z-20 flex items-center gap-2 py-3 backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}>
        {nav.canBack ? (
          <button onClick={back} className="text-muted font-semibold text-sm hover:text-primary">→ חזרה</button>
        ) : (
          <span className="font-disp font-extrabold text-lg">לומדים <span className="text-primary">ביחד</span></span>
        )}
        <div className="flex-1" />
        <button onClick={toggleTheme} className="w-9 h-9 rounded-[11px] border border-line bg-surface grid place-items-center">◐</button>
        <button onClick={signOut} className="text-muted text-sm font-semibold hover:text-primary">יציאה</button>
      </header>
      <Page nav={nav} params={route.params} />
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

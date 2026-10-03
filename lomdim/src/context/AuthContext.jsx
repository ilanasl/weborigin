import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { forgetAll } from '../lib/screenCache'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)   // הגיעו מקישור "שכחתי סיסמה" — צריך לבחור סיסמה חדשה

  async function loadProfile(uid) {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle()
    setProfile(data || null)
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null
      setUser(u)
      await loadProfile(u?.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      const u = session?.user ?? null
      setUser(u)
      loadProfile(u?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signUp = (email, password) => supabase.auth.signUp({ email, password })
  // יציאה — מנקים את זיכרון המסכים, כדי שמשתמש אחר לא יראה לרגע את הנתונים הקודמים
  const signOut = () => { forgetAll(); return supabase.auth.signOut() }
  // שכחתי סיסמה: שולח מייל עם קישור שחוזר לאפליקציה; שם בוחרים סיסמה חדשה
  const resetPassword = (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  async function updatePassword(password) {
    const res = await supabase.auth.updateUser({ password })
    if (!res.error) setRecovery(false)
    return res
  }

  // מחזיר false אם עמודת הכיתה עוד לא נוספה במסד (צריך להריץ את ה-SQL) — ואז שומר בלי הכיתה
  async function saveProfile({ name, gender, grade }) {
    const uid = user?.id
    if (!uid) return true
    const row = { user_id: uid, name, gender, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('profiles').upsert(grade ? { ...row, grade } : row)
    let ok = true
    if (error && grade) { ok = false; await supabase.from('profiles').upsert(row) }
    await loadProfile(uid)
    return ok
  }

  return (
    <AuthCtx.Provider value={{ user, profile, loading, recovery, signIn, signUp, signOut, resetPassword, updatePassword, saveProfile }}>
      {children}
    </AuthCtx.Provider>
  )
}

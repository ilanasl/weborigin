import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null
      setUser(u)
      loadProfile(u?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signUp = (email, password) => supabase.auth.signUp({ email, password })
  const signOut = () => supabase.auth.signOut()

  async function saveProfile({ name, gender }) {
    const uid = user?.id
    if (!uid) return
    await supabase.from('profiles').upsert({ user_id: uid, name, gender, updated_at: new Date().toISOString() })
    await loadProfile(uid)
  }

  return (
    <AuthCtx.Provider value={{ user, profile, loading, signIn, signUp, signOut, saveProfile }}>
      {children}
    </AuthCtx.Provider>
  )
}

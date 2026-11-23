import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // public.users row
  const [patient, setPatient] = useState(null)   // patients row, when role = patient
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setPatient(null)
      return
    }
    const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle()
    setProfile(u ?? null)
    if (u?.role === 'patient') {
      const { data: p } = await supabase.from('patients').select('*').eq('user_id', userId).maybeSingle()
      setPatient(p ?? null)
    } else {
      setPatient(null)
    }
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session ?? null)
      await loadProfile(data.session?.user?.id)
      if (alive) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null)
      // Defer: calling supabase inside the callback can deadlock the client.
      setTimeout(() => loadProfile(s?.user?.id), 0)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    patient,
    role: profile?.role ?? null,
    loading,
    refresh: () => loadProfile(session?.user?.id),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: async () => {
      await supabase.auth.signOut()
      setProfile(null)
      setPatient(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

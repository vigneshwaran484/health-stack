import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const SCOPE_FOR_ROLE = {
  doctor: 'full_record',
  pharmacist: 'prescription',
  lab: 'lab_order',
}

const storageKey = (role) => `hs.consent.${role}`

/**
 * Provider side of the consent gate.
 *
 * requestAccess() creates a pending consent_requests row via RPC (the provider
 * cannot read the patient yet — that is the point), then this hook watches that
 * one row over Realtime so the provider's screen unlocks the instant the
 * patient taps Allow. A slow poll runs alongside purely as demo insurance if a
 * websocket drops; correctness never depends on it.
 *
 * Nothing here grants access on its own: the unlocked screens still read
 * through RLS, which re-checks the same consent row server-side.
 */
export function useProviderConsent(role) {
  const scope = SCOPE_FOR_ROLE[role]
  const [session, setSession] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(role))
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const persist = useCallback(
    (next) => {
      setSession(next)
      try {
        if (next) sessionStorage.setItem(storageKey(role), JSON.stringify(next))
        else sessionStorage.removeItem(storageKey(role))
      } catch {
        /* private-mode browsers: in-memory state still works */
      }
    },
    [role],
  )

  const requestAccess = useCallback(
    async (identifier, { scopeRef = null, purpose = null, minutes = 30 } = {}) => {
      setError(null)
      setPending(true)
      try {
        const { data, error: rpcError } = await supabase.rpc('request_consent', {
          p_identifier: identifier,
          p_scope: scope,
          p_scope_ref: scopeRef,
          p_purpose: purpose,
          p_minutes: minutes,
        })
        if (rpcError) throw rpcError
        persist({
          consentId: data.consent_id,
          patientId: data.patient_id,
          patientName: data.patient_name,
          patientCode: data.patient_code,
          scope: data.scope,
          scopeRef: data.scope_ref,
          status: 'pending',
          expiresAt: null,
        })
        return data
      } catch (err) {
        setError(err.message ?? String(err))
        return null
      } finally {
        setPending(false)
      }
    },
    [scope, persist],
  )

  const clear = useCallback(() => persist(null), [persist])

  const revoke = useCallback(async () => {
    const s = sessionRef.current
    if (s?.consentId) {
      await supabase.from('consent_requests').update({ status: 'revoked' }).eq('id', s.consentId)
    }
    persist(null)
  }, [persist])

  const applyRow = useCallback(
    (row) => {
      if (!row) return
      const s = sessionRef.current
      if (!s || row.id !== s.consentId) return
      persist({ ...s, status: row.status, expiresAt: row.expires_at })
    },
    [persist],
  )

  // Watch the single consent row this provider is waiting on.
  useEffect(() => {
    const consentId = session?.consentId
    if (!consentId) return

    const channel = supabase
      .channel(`consent-req-${consentId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consent_requests', filter: `id=eq.${consentId}` },
        (payload) => applyRow(payload.new),
      )
      .subscribe()

    let cancelled = false
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('consent_requests')
        .select('id,status,expires_at')
        .eq('id', consentId)
        .maybeSingle()
      if (!cancelled) applyRow(data)
    }, 3000)

    return () => {
      cancelled = true
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [session?.consentId, applyRow])

  // Drive the countdown, and lock the UI the moment the window closes.
  useEffect(() => {
    if (session?.status !== 'approved' || !session?.expiresAt) return
    const t = setInterval(() => {
      setTick((n) => n + 1)
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        persist({ ...sessionRef.current, status: 'expired' })
      }
    }, 1000)
    return () => clearInterval(t)
  }, [session?.status, session?.expiresAt, persist])

  const approved =
    session?.status === 'approved' &&
    (!session.expiresAt || new Date(session.expiresAt).getTime() > Date.now())

  return { session, approved, pending, error, requestAccess, clear, revoke, scope, tick }
}

/**
 * Patient side: live feed of consent requests aimed at me.
 * This is what makes the approve prompt appear the instant a doctor scans.
 */
export function useIncomingConsents(patientId) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!patientId) return
    await supabase.rpc('expire_stale_consents')
    const { data } = await supabase
      .from('consent_requests')
      .select('*, requester:users!consent_requests_requester_id_fkey(name, org, verified, role)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(25)
    setRequests(data ?? [])
    setLoading(false)
  }, [patientId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!patientId) return
    const channel = supabase
      .channel(`consent-inbox-${patientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consent_requests', filter: `patient_id=eq.${patientId}` },
        () => load(),
      )
      .subscribe()

    // Expiry is time-based, so re-evaluate on a timer as well as on change.
    const t = setInterval(load, 10000)
    return () => {
      clearInterval(t)
      supabase.removeChannel(channel)
    }
  }, [patientId, load])

  const respond = useCallback(
    async (id, status) => {
      await supabase
        .from('consent_requests')
        .update({ status, responded_at: new Date().toISOString() })
        .eq('id', id)
      await load()
    },
    [load],
  )

  const pending = requests.filter(
    (r) => r.status === 'pending' && new Date(r.expires_at).getTime() > Date.now(),
  )

  return { requests, pending, loading, respond, reload: load }
}

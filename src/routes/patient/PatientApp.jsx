import { Route, Routes } from 'react-router-dom'
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../state/AuthContext'
import { useIncomingConsents } from '../../lib/consent'
import { supabase } from '../../lib/supabase'
import { MobileShell } from '../../components/Shell'
import { Spinner } from '../../components/ui'
import { ConsentPrompt } from './ConsentPrompt'
import PatientHome from './PatientHome'
import PatientHistory from './PatientHistory'
import PatientCheckIn from './PatientCheckIn'
import PatientActivity from './PatientActivity'

function useNotifications(userId) {
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    setItems(data ?? [])
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!userId) return
    const ch = supabase
      .channel(`notif-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId, load])

  const markRead = useCallback(
    async (id) => {
      await supabase.from('notifications').update({ read: true }).eq('id', id)
      load()
    },
    [load],
  )

  return { notifications: items, unread: items.filter((n) => !n.read).length, markRead, reload: load }
}

export default function PatientApp() {
  const { patient, user, profile } = useAuth()
  const { requests, pending, respond } = useIncomingConsents(patient?.id)
  const notif = useNotifications(user?.id)

  if (!patient) {
    return (
      <div className="phone-frame flex items-center justify-center">
        <div className="p-6 text-center text-sm text-ink-500">
          <Spinner />
          <p className="mt-3">Loading your record…</p>
        </div>
      </div>
    )
  }

  const tabs = [
    { to: '/patient', end: true, label: 'Home', icon: '🏠' },
    { to: '/patient/history', label: 'History', icon: '📁' },
    ...(patient.checkin_enrolled ? [{ to: '/patient/checkin', label: 'Check-in', icon: '✅' }] : []),
    { to: '/patient/activity', label: 'Activity', icon: '🔔', badge: notif.unread },
  ]

  return (
    <div className="relative">
      <MobileShell title={profile?.name} tabs={tabs}>
        <Routes>
          <Route index element={<PatientHome patient={patient} requests={requests} notifications={notif.notifications} />} />
          <Route path="history" element={<PatientHistory patientId={patient.id} />} />
          <Route path="checkin" element={<PatientCheckIn patient={patient} />} />
          <Route
            path="activity"
            element={<PatientActivity patientId={patient.id} requests={requests} notif={notif} />}
          />
        </Routes>
      </MobileShell>

      {/* The interrupt: rendered above whatever screen the patient is on. */}
      {pending.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-40 flex justify-center">
          <div className="phone-frame pointer-events-auto relative !bg-transparent !shadow-none">
            <ConsentPrompt request={pending[0]} onRespond={respond} />
          </div>
        </div>
      )}
    </div>
  )
}

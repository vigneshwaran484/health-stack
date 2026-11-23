import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ProviderShell } from '../../components/Shell'
import { useProviderConsent } from '../../lib/consent'
import DoctorConsult from './DoctorConsult'
import DoctorEmergency from './DoctorEmergency'
import EmergencyLog from './EmergencyLog'

export default function DoctorApp() {
  const consent = useProviderConsent('doctor')
  const navigate = useNavigate()

  // The instant the patient approves, move the doctor to the record.
  useEffect(() => {
    if (consent.approved && window.location.pathname === '/doctor') {
      navigate('/doctor', { replace: true })
    }
  }, [consent.approved, navigate])

  const nav = [
    { to: '/doctor', label: 'Consultation', end: true },
    { to: '/doctor/emergency', label: 'Emergency access' },
    { to: '/doctor/emergency-log', label: 'Audit log' },
  ]

  return (
    <ProviderShell nav={nav}>
      <Routes>
        <Route index element={<DoctorConsult consent={consent} />} />
        <Route path="emergency" element={<DoctorEmergency />} />
        <Route path="emergency-log" element={<EmergencyLog />} />
        <Route path="*" element={<Navigate to="/doctor" replace />} />
      </Routes>
    </ProviderShell>
  )
}

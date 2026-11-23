import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './state/AuthContext'
import { Spinner } from './components/ui'

import Login from './routes/Login'
import Register from './routes/Register'

import PatientApp from './routes/patient/PatientApp'
import DoctorApp from './routes/doctor/DoctorApp'
import PharmacyApp from './routes/pharmacy/PharmacyApp'
import LabApp from './routes/lab/LabApp'
import CaregiverApp from './routes/caregiver/CaregiverApp'

export const HOME_FOR_ROLE = {
  patient: '/patient',
  doctor: '/doctor',
  pharmacist: '/pharmacy',
  lab: '/lab',
  caregiver: '/caregiver',
}

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-3 text-sm text-ink-500">
      <Spinner /> Loading…
    </div>
  )
}

/** Routes are role-gated here for UX; the real boundary is RLS in Postgres. */
function RequireRole({ role, children }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  if (!profile) return <Loading />
  if (profile.role !== role) return <Navigate to={HOME_FOR_ROLE[profile.role] ?? '/login'} replace />
  return children
}

function RootRedirect() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Loading />
  return <Navigate to={HOME_FOR_ROLE[profile.role] ?? '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route path="/patient/*" element={<RequireRole role="patient"><PatientApp /></RequireRole>} />
      <Route path="/doctor/*" element={<RequireRole role="doctor"><DoctorApp /></RequireRole>} />
      <Route path="/pharmacy/*" element={<RequireRole role="pharmacist"><PharmacyApp /></RequireRole>} />
      <Route path="/lab/*" element={<RequireRole role="lab"><LabApp /></RequireRole>} />
      <Route path="/caregiver/*" element={<RequireRole role="caregiver"><CaregiverApp /></RequireRole>} />

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}

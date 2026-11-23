import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../state/AuthContext'
import { Button, Card, Field, Input, Spinner, inputClass } from '../components/ui'
import { QrCode } from '../components/QrCode'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/**
 * One-time patient registration -> permanent Patient ID + QR.
 *
 * Pilot: identity is self-asserted. Production would bind this to Aadhaar /
 * an ABHA number at this step; the Patient ID would then be the ABHA address.
 */
export default function Register() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [form, setForm] = useState({
    name: '', email: '', password: '', age: '', bloodGroup: 'O+',
    weight: '', height: '', phone: '', emergencyContact: '', allergies: '',
    checkinEnrolled: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [issued, setIssued] = useState(null)

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data: signUp, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { name: form.name.trim(), role: 'patient' } },
      })
      if (signUpError) throw signUpError
      const userId = signUp.user?.id
      if (!userId) throw new Error('Sign-up did not return a user')
      if (!signUp.session) {
        throw new Error('Email confirmation is enabled on this project — disable it for the demo.')
      }

      const { error: profileError } = await supabase.from('users').insert({
        id: userId, role: 'patient', name: form.name.trim(), email: form.email.trim(),
      })
      if (profileError) throw profileError

      const { data: patient, error: patientError } = await supabase
        .from('patients')
        .insert({
          user_id: userId,
          age: form.age ? Number(form.age) : null,
          blood_group: form.bloodGroup,
          weight: form.weight ? Number(form.weight) : null,
          height: form.height ? Number(form.height) : null,
          phone: form.phone || null,
          emergency_contact: form.emergencyContact || null,
          checkin_enrolled: form.checkinEnrolled,
        })
        .select()
        .single()
      if (patientError) throw patientError

      // Allergies are recorded at registration because they are what makes the
      // prescribe-time safety check meaningful on the very first visit.
      const allergies = form.allergies
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (allergies.length) {
        await supabase
          .from('allergies')
          .insert(allergies.map((substance) => ({ patient_id: patient.id, substance })))
      }

      await refresh()
      setIssued(patient)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  if (issued) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-5">
        <Card className="w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold text-white">You're registered</h1>
          <p className="mt-1 text-sm text-ink-500">
            This QR is permanent. Providers scan it to <em>ask</em> for access — you approve every time.
          </p>

          <div className="my-6 flex justify-center">
            <QrCode value={issued.qr_token} size={200} />
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-500">Patient ID</div>
            <div className="font-mono text-2xl font-bold tracking-widest text-mint-400">
              {issued.patient_code}
            </div>
          </div>

          <Button full className="mt-6" onClick={() => navigate('/patient')}>
            Open my Health Stack
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <Card className="w-full max-w-lg p-6">
        <h1 className="text-lg font-bold text-white">Register as a patient</h1>
        <p className="mt-1 text-sm text-ink-500">You'll get a permanent Patient ID and QR code.</p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Full name">
            <Input value={form.name} onChange={set('name')} required placeholder="Anita Sharma" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set('email')} required placeholder="you@demo.in" />
            </Field>
            <Field label="Password" hint="At least 6 characters">
              <Input type="password" value={form.password} onChange={set('password')} required minLength={6} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Age">
              <Input type="number" value={form.age} onChange={set('age')} min="0" max="130" />
            </Field>
            <Field label="Blood">
              <select value={form.bloodGroup} onChange={set('bloodGroup')} className={inputClass}>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            <Field label="Weight kg">
              <Input type="number" value={form.weight} onChange={set('weight')} step="0.1" />
            </Field>
            <Field label="Height cm">
              <Input type="number" value={form.height} onChange={set('height')} step="0.1" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <Input value={form.phone} onChange={set('phone')} placeholder="+91 98400 00000" />
            </Field>
            <Field label="Emergency contact">
              <Input value={form.emergencyContact} onChange={set('emergencyContact')} placeholder="Name + number" />
            </Field>
          </div>

          <Field label="Known allergies" hint="Comma separated — these drive the prescribing safety check">
            <Input value={form.allergies} onChange={set('allergies')} placeholder="Penicillin, Sulfa" />
          </Field>

          <label className="flex items-start gap-3 rounded-xl border border-ink-800 p-3">
            <input
              type="checkbox"
              checked={form.checkinEnrolled}
              onChange={set('checkinEnrolled')}
              className="mt-0.5 h-4 w-4 accent-[#14b89a]"
            />
            <span className="text-sm">
              <span className="font-semibold text-white">Enrol in daily check-in</span>
              <span className="block text-xs text-ink-500">
                For at-risk patients. A caregiver is alerted if you miss it.
              </span>
            </span>
          </label>

          {error && <p className="text-sm text-rose-300">{error}</p>}

          <Button full type="submit" disabled={busy}>
            {busy ? <Spinner /> : 'Create my Health Stack ID'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-mint-400 hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  )
}

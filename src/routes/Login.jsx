import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { HOME_FOR_ROLE } from '../App'
import { Button, Card, Field, Input, Spinner } from '../components/ui'
import { isConfigured } from '../lib/supabase'

// Shown on the login screen so a judge can hop between roles without hunting
// for credentials. Remove for anything resembling production.
const DEMO_LOGINS = [
  { email: 'doctor@demo.in', label: 'Dr. Meera Rao', role: 'Doctor · verified' },
  { email: 'anita@demo.in', label: 'Anita Sharma', role: 'Patient · penicillin allergy' },
  { email: 'ramesh@demo.in', label: 'Ramesh Iyer', role: 'Patient · daily check-in' },
  { email: 'pharmacist@demo.in', label: 'Sunil Kumar', role: 'Pharmacist' },
  { email: 'lab@demo.in', label: 'Metro Diagnostics', role: 'Lab' },
  { email: 'caregiver@demo.in', label: 'Priya Iyer', role: "Caregiver · Ramesh's daughter" },
]

export default function Login() {
  const { session, profile, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('demo1234')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-ink-500">
        <Spinner />
      </div>
    )
  }
  if (session && profile) return <Navigate to={HOME_FOR_ROLE[profile.role] ?? '/'} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await signIn(email.trim(), password)
    setBusy(false)
    if (err) setError(err.message)
    else navigate('/')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Health<span className="text-mint-400">Stack</span>
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            One QR. Your whole record. Nobody sees it without your say-so — every single time.
          </p>
        </div>

        {!isConfigured && (
          <Card className="mb-5 border-amber-500/40 bg-amber-500/10 text-sm text-amber-200">
            Supabase isn't configured. Copy <code className="font-mono">.env.example</code> to{' '}
            <code className="font-mono">.env</code> and paste the URL + anon key from{' '}
            <code className="font-mono">npm run db:start</code>.
          </Card>
        )}

        <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-bold text-white">Sign in</h2>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email">
                <Input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@demo.in"
                  required
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <Button full type="submit" disabled={busy}>
                {busy ? <Spinner /> : 'Sign in'}
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-ink-500">
              New patient?{' '}
              <Link to="/register" className="font-semibold text-mint-400 hover:underline">
                Register and get your QR
              </Link>
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-bold text-white">Demo accounts</h2>
            <p className="mb-3 text-xs text-ink-500">
              Password for all: <code className="font-mono text-ink-300">demo1234</code>. Open two
              browser windows to watch consent fly across in real time.
            </p>
            <div className="grid gap-2">
              {DEMO_LOGINS.map((d) => (
                <button
                  key={d.email}
                  onClick={() => {
                    setEmail(d.email)
                    setPassword('demo1234')
                  }}
                  className="flex items-center justify-between rounded-xl border border-ink-800 px-3 py-2.5 text-left transition hover:border-mint-500/50 hover:bg-ink-800/50"
                >
                  <div>
                    <div className="text-sm font-semibold text-white">{d.label}</div>
                    <div className="text-[11px] text-ink-500">{d.role}</div>
                  </div>
                  <code className="font-mono text-[11px] text-ink-500">{d.email}</code>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

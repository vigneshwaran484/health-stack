import { QrScanner } from './QrScanner'
import { Badge, Button, Card, Spinner } from './ui'
import { scopeLabel } from '../lib/format'

const COPY = {
  doctor: {
    title: 'Scan patient QR',
    blurb: 'Requesting access opens the full record — but only after the patient approves on their own device.',
  },
  pharmacist: {
    title: 'Scan patient QR',
    blurb: 'You will see the prescription only. No diagnoses, no history.',
  },
  lab: {
    title: 'Scan patient QR',
    blurb: 'You will see only the single test that was ordered — nothing else on the record.',
  },
}

/**
 * The provider-side face of the consent gate. Renders children only once the
 * patient has approved and the window is still open.
 *
 * This is UX, not security — every screen inside still reads through RLS, which
 * re-checks the same consent row in Postgres.
 */
export function ConsentGate({ role, consent, children, extra }) {
  const { session, approved, pending, error, requestAccess, clear } = consent
  const copy = COPY[role] ?? COPY.doctor

  if (approved) return children

  // Waiting for the patient to tap Allow.
  if (session?.status === 'pending') {
    return (
      <div className="mx-auto max-w-md">
        <Card className="py-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint-500/10 pulse-ring">
            <Spinner className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-base font-bold text-white">
            Waiting for {session.patientName} to approve
          </h2>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-500">
            The request is on their phone right now. This screen unlocks the moment they tap Allow.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs">
            <Badge tone="info">{scopeLabel[session.scope]}</Badge>
            <span className="font-mono text-ink-500">{session.patientCode}</span>
          </div>
          <Button variant="ghost" className="mt-6" onClick={clear}>
            Cancel request
          </Button>
        </Card>
      </div>
    )
  }

  if (session && ['denied', 'expired', 'revoked'].includes(session.status)) {
    const label = { denied: 'declined the request', expired: 'request timed out', revoked: 'revoked access' }[
      session.status
    ]
    return (
      <div className="mx-auto max-w-md">
        <Card className="border-rose-500/30 bg-rose-500/5 py-10 text-center">
          <div className="text-3xl">🔒</div>
          <h2 className="mt-3 text-base font-bold text-white">
            {session.patientName} {label}
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">No data was disclosed.</p>
          <Button className="mt-6" onClick={clear}>
            Start a new request
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6">
        <h2 className="text-base font-bold text-white">{copy.title}</h2>
        <p className="mb-5 mt-1 text-sm text-ink-500">{copy.blurb}</p>
        <QrScanner
          busy={pending}
          onResult={(identifier) => requestAccess(identifier, { purpose: extra?.purpose })}
        />
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        {extra?.footer}
      </Card>
    </div>
  )
}

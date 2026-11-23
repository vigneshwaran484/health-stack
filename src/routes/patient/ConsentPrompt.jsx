import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import { roleLabel, scopeLabel } from '../../lib/format'

const SCOPE_DETAIL = {
  full_record: ['Past visits and diagnoses', 'Allergies and active medications', 'Prescriptions and lab reports'],
  prescription: ['Your current prescription only', 'No diagnoses, no history, no lab reports'],
  lab_order: ['Only the single test that was ordered', 'No diagnoses, no medications, no other results'],
}

/**
 * The consent gate as the patient experiences it: a full-screen interrupt that
 * says exactly who is asking, what they'd see, and for how long. It appears the
 * moment the provider scans — this component is rendered from a Realtime
 * subscription, not a poll.
 */
export function ConsentPrompt({ request, onRespond }) {
  const [busy, setBusy] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(request.expires_at).getTime() - Date.now()) / 1000)),
  )

  useEffect(() => {
    const t = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((new Date(request.expires_at).getTime() - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(t)
  }, [request.expires_at])

  async function respond(status) {
    setBusy(status)
    await onRespond(request.id, status)
    setBusy(null)
  }

  const requester = request.requester ?? {}
  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-ink-950/80 backdrop-blur-sm">
      <div className="slide-up rounded-t-3xl border-t border-mint-500/30 bg-ink-900 p-5 pb-7">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-700" />

        <div className="flex items-start gap-3">
          <div className="pulse-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-mint-500/15 text-lg">
            {request.requester_role === 'doctor' ? '🩺' : request.requester_role === 'pharmacist' ? '💊' : '🔬'}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight text-white">
              {requester.name ?? 'A provider'} is requesting access to your records
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {roleLabel[request.requester_role]}
              {requester.org ? ` · ${requester.org}` : ''}
              {requester.verified && <span className="ml-1 text-mint-400">✓ verified</span>}
            </p>
          </div>
        </div>

        {request.purpose && (
          <p className="mt-3 rounded-lg bg-ink-950/60 px-3 py-2 text-xs text-ink-300">
            Reason given: “{request.purpose}”
          </p>
        )}

        <div className="mt-4 rounded-xl border border-ink-800 bg-ink-950/50 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-mint-400">
              {scopeLabel[request.scope]}
            </span>
            <span className="font-mono text-[11px] text-ink-500">
              expires in {mins}:{String(secs).padStart(2, '0')}
            </span>
          </div>
          <ul className="space-y-1">
            {(SCOPE_DETAIL[request.scope] ?? []).map((line) => (
              <li key={line} className="flex gap-2 text-xs text-ink-300">
                <span className="text-mint-400">•</span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-3 text-center text-[11px] text-ink-500">
          Access ends automatically when the timer runs out. You can revoke it any time.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={() => respond('denied')} disabled={Boolean(busy)}>
            {busy === 'denied' ? 'Denying…' : 'Deny'}
          </Button>
          <Button onClick={() => respond('approved')} disabled={Boolean(busy)}>
            {busy === 'approved' ? 'Approving…' : 'Allow access'}
          </Button>
        </div>
      </div>
    </div>
  )
}

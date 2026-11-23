import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePatientRecord } from '../../lib/record'
import { useAuth } from '../../state/AuthContext'
import { PageHead } from '../../components/Shell'
import { Badge, Button, Card, Empty, Field, Input, Spinner, Toast, useToast, inputClass } from '../../components/ui'
import { dateLine, timeAgo } from '../../lib/format'

/**
 * Break-glass access — an accountable override, not a bypass.
 *
 * Guarantees enforced server-side (start_emergency_access + RLS):
 *  · restricted   — verified clinicians only; an unverified doctor is refused
 *  · audited      — an immutable emergency_access row is written first
 *  · least-necessary — only emergency-relevant fields are surfaced here
 *  · time-boxed   — the grant expires
 *  · transparent  — the patient is notified and sees it in their activity log
 */
export default function DoctorEmergency() {
  const { profile } = useAuth()
  const toast = useToast()
  const [identifier, setIdentifier] = useState('')
  const [justification, setJustification] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [access, setAccess] = useState(null)
  const [actions, setActions] = useState([])

  const { record, loading } = usePatientRecord(access?.patient_id, { enabled: Boolean(access) })

  async function trigger(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('start_emergency_access', {
      p_identifier: identifier.trim(),
      p_justification: justification.trim(),
      p_minutes: 60,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    setAccess(data)
    setActions([])
    toast.success('Emergency access opened — the patient has been notified')
  }

  async function logAction(action) {
    await supabase.from('emergency_access_actions').insert({ access_id: access.access_id, action })
    setActions((a) => [...a, { action, at: new Date().toISOString() }])
    toast.show(`Logged: ${action}`)
  }

  if (!profile?.verified) {
    return (
      <>
        <PageHead title="Emergency access" subtitle="Break-glass override" />
        <Card className="max-w-lg border-rose-500/40 bg-rose-500/5">
          <h2 className="text-base font-bold text-white">Blocked — account not verified</h2>
          <p className="mt-1.5 text-sm text-ink-300">
            Break-glass access is restricted to verified, licensed clinicians. Your account is not
            marked verified.
          </p>
          <p className="mt-3 text-xs text-ink-500">
            Pilot note: <code className="font-mono">users.verified</code> is a seeded boolean.
            Production would check the clinician against ABDM's Healthcare Professional Registry (HPR)
            at this point.
          </p>
        </Card>
      </>
    )
  }

  if (access) {
    const activeMeds = record?.medications?.filter((m) => m.active) ?? []
    const recent = record?.encounters?.slice(0, 3) ?? []

    return (
      <>
        <PageHead title={access.patient_name} subtitle={`${access.patient_code} · emergency access active`}>
          <Badge tone="bad">BREAK-GLASS</Badge>
          <Button variant="ghost" onClick={() => setAccess(null)}>
            Close session
          </Button>
        </PageHead>

        <Card className="mb-5 border-rose-500/40 bg-rose-500/5">
          <p className="text-sm text-rose-100">
            Access granted without patient approval. This event is permanently logged, the patient has
            been notified, and it expires in 60 minutes.
          </p>
          <p className="mt-1.5 text-xs text-ink-500">Justification recorded: “{access.justification ?? justification}”</p>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16 text-ink-500">
            <Spinner />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-5">
              <Card>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-rose-300">
                  Emergency-relevant record only
                </h3>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['Blood group', record?.patient?.blood_group ?? '—'],
                    ['Age', record?.patient?.age ?? '—'],
                    ['Weight', record?.patient?.weight ? `${record.patient.weight} kg` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-ink-800 px-3 py-2 text-center">
                      <div className="text-[10px] uppercase tracking-wider text-ink-500">{k}</div>
                      <div className="text-sm font-bold text-white">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">Allergies</h4>
                  {record?.allergies?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {record.allergies.map((a) => (
                        <Badge key={a.id} tone="bad">
                          ⚠ {a.substance} · {a.severity}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Empty>None recorded</Empty>
                  )}
                </div>

                <div className="mt-4">
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Active medications
                  </h4>
                  {activeMeds.length ? (
                    <div className="space-y-1.5">
                      {activeMeds.map((m) => (
                        <div key={m.id} className="rounded-lg bg-ink-950/50 px-3 py-2 text-sm text-white">
                          {m.name}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>None active</Empty>
                  )}
                </div>

                <div className="mt-4">
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Emergency contact
                  </h4>
                  <p className="text-sm text-white">{record?.patient?.emergency_contact ?? '—'}</p>
                </div>

                <div className="mt-4">
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Recent visits
                  </h4>
                  {recent.length ? (
                    <div className="space-y-1.5">
                      {recent.map((e) => (
                        <div key={e.id} className="rounded-lg bg-ink-950/50 px-3 py-2">
                          <div className="text-sm text-white">{e.diagnosis}</div>
                          <div className="text-[11px] text-ink-500">{dateLine(e.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>None</Empty>
                  )}
                </div>
              </Card>
            </div>

            <Card>
              <h3 className="text-sm font-bold text-white">Log clinical actions</h3>
              <p className="mb-3 text-xs text-ink-500">
                Every action is appended to the audit trail and cannot be edited or deleted.
              </p>
              <div className="grid gap-2">
                {[
                  'Reviewed allergies before drug administration',
                  'Administered emergency medication',
                  'Ordered urgent imaging',
                  'Contacted emergency contact',
                  'Stabilised and admitted',
                ].map((a) => (
                  <button
                    key={a}
                    onClick={() => logAction(a)}
                    className="rounded-xl border border-ink-800 px-3.5 py-2.5 text-left text-sm text-ink-300 transition hover:border-mint-500/50 hover:text-white"
                  >
                    {a}
                  </button>
                ))}
              </div>

              {actions.length > 0 && (
                <div className="mt-4 border-t border-ink-800 pt-3">
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    This session
                  </h4>
                  <ol className="space-y-1.5">
                    {actions.map((a, i) => (
                      <li key={i} className="flex gap-2 text-xs text-ink-300">
                        <span className="text-mint-400">✓</span>
                        {a.action}
                        <span className="ml-auto text-ink-500">{timeAgo(a.at)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
          </div>
        )}
        <Toast toast={toast.toast} onClose={toast.clear} />
      </>
    )
  }

  return (
    <>
      <PageHead
        title="Emergency access"
        subtitle="For an unconscious or unidentified patient who cannot approve access"
      />
      <Card className="max-w-lg border-rose-500/30">
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 text-xs leading-relaxed text-rose-100">
          This bypasses patient approval. It is restricted to verified clinicians, limited to
          emergency-relevant records, expires automatically, and writes a permanent audit entry the
          patient will see.
        </div>

        <form onSubmit={trigger} className="space-y-4">
          <Field label="Patient ID" hint="From the patient's wristband, card, or a bystander's phone">
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              placeholder="HS-XXXXXX"
              className="font-mono tracking-widest"
              required
            />
          </Field>
          <Field label="Clinical justification" hint="Required and permanently recorded">
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="e.g. Unconscious after RTA, brought by ambulance, unable to consent, needs immediate anaesthesia"
              required
            />
          </Field>

          {error && <p className="text-sm text-rose-300">{error}</p>}

          <Button variant="danger" full type="submit" disabled={busy || justification.trim().length < 10}>
            {busy ? <Spinner /> : 'Break glass — open emergency access'}
          </Button>
        </form>
      </Card>
      <Toast toast={toast.toast} onClose={toast.clear} />
    </>
  )
}

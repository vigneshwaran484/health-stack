import { useEffect, useState } from 'react'
import { Badge, Card, Empty } from './ui'
import { dateLine, timeAgo } from '../lib/format'
import { signedLabMedia } from '../lib/storage'

function Section({ title, count, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-500">
        {title}
        {count > 0 && <span className="rounded-full bg-ink-800 px-1.5 text-[10px] text-ink-300">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

function LabMedia({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    signedLabMedia(path).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [path])
  if (!url) return <div className="h-32 animate-pulse rounded-lg bg-ink-800" />
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Scan" className="max-h-56 w-full rounded-lg border border-ink-800 object-contain" />
    </a>
  )
}

/**
 * The full record, shared by the patient's own history screen and the doctor's
 * consented view. Sections are driven by what RLS actually returned.
 */
export function RecordView({ record, dense = false }) {
  if (!record) return null
  const { allergies, medications, encounters, prescriptions, labOrders, emergencies } = record
  const activeMeds = medications.filter((m) => m.active)

  return (
    <div className={dense ? 'space-y-5' : 'space-y-6'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Allergies" count={allergies.length}>
          {allergies.length === 0 ? (
            <Empty>No recorded allergies</Empty>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allergies.map((a) => (
                <Badge key={a.id} tone={a.severity === 'severe' ? 'bad' : 'warn'}>
                  ⚠ {a.substance}
                  <span className="opacity-60">· {a.severity}</span>
                </Badge>
              ))}
            </div>
          )}
        </Section>

        <Section title="Active medications" count={activeMeds.length}>
          {activeMeds.length === 0 ? (
            <Empty>None active</Empty>
          ) : (
            <div className="space-y-1.5">
              {activeMeds.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-ink-900/70 px-3 py-2">
                  <span className="text-sm text-white">{m.name}</span>
                  <span className="text-[11px] text-ink-500">since {dateLine(m.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Visits" count={encounters.length}>
        {encounters.length === 0 ? (
          <Empty>No past visits on record</Empty>
        ) : (
          <div className="space-y-2">
            {encounters.map((e) => (
              <Card key={e.id} className="p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{e.diagnosis || 'Consultation'}</span>
                  <div className="flex items-center gap-2">
                    {e.emergency && <Badge tone="bad">emergency</Badge>}
                    <span className="text-[11px] text-ink-500">{dateLine(e.created_at)}</span>
                  </div>
                </div>
                {e.notes && <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{e.notes}</p>}
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {e.doctor?.name}
                  {e.doctor?.org ? ` · ${e.doctor.org}` : ''}
                </p>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Prescriptions" count={prescriptions.length}>
        {prescriptions.length === 0 ? (
          <Empty>No prescriptions on record</Empty>
        ) : (
          <div className="space-y-2">
            {prescriptions.map((p) => (
              <Card key={p.id} className="p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] text-ink-500">
                    {p.doctor?.name} · {dateLine(p.created_at)}
                  </span>
                  <Badge tone={p.status === 'active' ? 'info' : 'neutral'}>{p.status}</Badge>
                </div>
                <div className="space-y-1.5">
                  {(p.items ?? []).map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-950/50 px-3 py-2">
                      <div>
                        <div className="text-sm text-white">
                          {i.medicine}
                          {i.substitute_medicine && (
                            <span className="text-mint-400"> → {i.substitute_medicine}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-500">
                          {i.composition}
                          {i.dosage ? ` · ${i.dosage}` : ''}
                          {i.quantity ? ` · qty ${i.quantity}` : ''}
                        </div>
                      </div>
                      <Badge
                        tone={
                          i.dispense_status === 'dispensed' || i.dispense_status === 'substituted'
                            ? 'good'
                            : i.dispense_status === 'sourced_elsewhere'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {i.dispense_status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>
                {(p.items ?? []).some((i) => i.override_reason) && (
                  <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                    Prescribed over a safety warning —{' '}
                    {p.items.find((i) => i.override_reason)?.override_reason}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Tests & reports" count={labOrders.length}>
        {labOrders.length === 0 ? (
          <Empty>No tests ordered</Empty>
        ) : (
          <div className="space-y-2">
            {labOrders.map((o) => (
              <Card key={o.id} className="p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">
                    {o.test_type}
                    {o.body_part ? ` · ${o.body_part}` : ''}
                  </span>
                  <Badge tone={o.status === 'result_uploaded' || o.status === 'reviewed' ? 'good' : 'neutral'}>
                    {o.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-500">
                  Ordered by {o.ordered_by_user?.name ?? '—'} · {timeAgo(o.created_at)}
                </p>

                {(o.results ?? []).map((r) => (
                  <div key={r.id} className="mt-2.5 space-y-2 rounded-lg bg-ink-950/50 p-3">
                    {Object.entries(r.result_json ?? {}).length > 0 && (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {Object.entries(r.result_json).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2 border-b border-ink-800/60 pb-1">
                            <dt className="text-[11px] text-ink-500">{k}</dt>
                            <dd className="text-[11px] font-semibold text-white">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {r.notes && <p className="text-xs text-ink-300">{r.notes}</p>}
                    {r.media_url && <LabMedia path={r.media_url} />}
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )}
      </Section>

      {emergencies?.length > 0 && (
        <Section title="Emergency access events" count={emergencies.length}>
          <div className="space-y-2">
            {emergencies.map((e) => (
              <Card key={e.id} className="border-rose-500/30 bg-rose-500/5 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-rose-200">
                    Break-glass access by {e.clinician?.name}
                  </span>
                  <Badge tone={e.merged ? 'good' : 'warn'}>{e.merged ? 'merged' : 'pending merge'}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-300">“{e.justification}”</p>
                <p className="mt-1 text-[11px] text-ink-500">{dateLine(e.created_at)} · {timeAgo(e.created_at)}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

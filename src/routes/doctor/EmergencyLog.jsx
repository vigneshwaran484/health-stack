import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PageHead } from '../../components/Shell'
import { Badge, Card, Empty, Spinner } from '../../components/ui'
import { dateLine, timeAgo } from '../../lib/format'

/**
 * The audit screen. Rows here can never be edited or deleted — a trigger on
 * emergency_access rejects UPDATE (except the one-way `merged` flip) and DELETE
 * outright, so this is a true append-only trail rather than a UI convention.
 */
export default function EmergencyLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('emergency_access')
        .select(
          '*, clinician:users!emergency_access_clinician_id_fkey(name, org), ' +
            'patient:patients(patient_code, user:users(name)), ' +
            'actions:emergency_access_actions(*)',
        )
        .order('created_at', { ascending: false })
      setRows(data ?? [])
      setLoading(false)
    })()
  }, [])

  return (
    <>
      <PageHead title="Emergency access log" subtitle="Immutable audit trail of every break-glass event">
        <Badge tone="neutral">append-only</Badge>
      </PageHead>

      {loading ? (
        <div className="flex justify-center py-16 text-ink-500">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty>No emergency access has been used.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const expired = new Date(r.expires_at).getTime() < Date.now()
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-white">
                      {r.patient?.user?.name ?? 'Patient'}{' '}
                      <span className="font-mono text-xs font-normal text-ink-500">
                        {r.patient?.patient_code}
                      </span>
                    </div>
                    <div className="text-xs text-ink-500">
                      {r.clinician?.name}
                      {r.clinician?.org ? ` · ${r.clinician.org}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={expired ? 'neutral' : 'bad'}>{expired ? 'expired' : 'active'}</Badge>
                    <Badge tone={r.merged ? 'good' : 'warn'}>
                      {r.merged ? 'merged into record' : 'awaiting patient merge'}
                    </Badge>
                  </div>
                </div>

                <p className="mt-3 rounded-lg bg-ink-950/50 px-3 py-2 text-sm text-ink-300">
                  “{r.justification}”
                </p>

                <dl className="mt-3 grid gap-x-6 gap-y-1 text-[11px] text-ink-500 sm:grid-cols-3">
                  <div>
                    <dt className="inline font-semibold">Opened: </dt>
                    <dd className="inline">
                      {dateLine(r.created_at)} {new Date(r.created_at).toLocaleTimeString()} ({timeAgo(r.created_at)})
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Expires: </dt>
                    <dd className="inline">{new Date(r.expires_at).toLocaleTimeString()}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Entry ID: </dt>
                    <dd className="inline font-mono">{r.id.slice(0, 8)}</dd>
                  </div>
                </dl>

                {r.actions?.length > 0 && (
                  <div className="mt-3 border-t border-ink-800 pt-3">
                    <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                      Actions taken
                    </h4>
                    <ol className="space-y-1">
                      {[...r.actions]
                        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                        .map((a) => (
                          <li key={a.id} className="flex gap-2 text-xs text-ink-300">
                            <span className="font-mono text-ink-500">
                              {new Date(a.created_at).toLocaleTimeString()}
                            </span>
                            {a.action}
                          </li>
                        ))}
                    </ol>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

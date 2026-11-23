import { useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode } from '../../components/QrCode'
import { Badge, Card } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { roleLabel, scopeLabel, timeAgo } from '../../lib/format'

export default function PatientHome({ patient, requests, notifications }) {
  const [copied, setCopied] = useState(false)

  const active = requests.filter(
    (r) => r.status === 'approved' && new Date(r.expires_at).getTime() > Date.now(),
  )
  const recent = requests.filter((r) => r.status !== 'pending').slice(0, 4)
  const unread = notifications.filter((n) => !n.read).length

  async function revoke(id) {
    await supabase.from('consent_requests').update({ status: 'revoked' }).eq('id', id)
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-center py-6">
        <QrCode value={patient.qr_token} size={192} />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(patient.patient_code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="mt-4 text-center"
        >
          <div className="text-[10px] uppercase tracking-wider text-ink-500">
            {copied ? 'Copied' : 'Patient ID · tap to copy'}
          </div>
          <div className="font-mono text-xl font-bold tracking-[0.2em] text-mint-400">
            {patient.patient_code}
          </div>
        </button>
        <p className="mt-3 px-6 text-center text-[11px] leading-relaxed text-ink-500">
          Show this to any doctor, pharmacy or lab. Scanning it only <em>asks</em> — nothing opens
          until you tap Allow.
        </p>
      </Card>

      <div className="grid grid-cols-4 gap-2">
        {[
          ['Age', patient.age ?? '—'],
          ['Blood', patient.blood_group ?? '—'],
          ['Weight', patient.weight ? `${patient.weight}kg` : '—'],
          ['Height', patient.height ? `${patient.height}cm` : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-ink-800 bg-ink-900/70 px-2 py-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-ink-500">{label}</div>
            <div className="text-sm font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {active.length > 0 && (
        <Card className="border-mint-500/30 bg-mint-500/5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-mint-400">
            Who has access right now
          </h3>
          <div className="space-y-2">
            {active.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">
                    {r.requester?.name ?? roleLabel[r.requester_role]}
                  </div>
                  <div className="text-[11px] text-ink-500">
                    {scopeLabel[r.scope]} · until {new Date(r.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  onClick={() => revoke(r.id)}
                  className="shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-ink-300 hover:border-rose-500 hover:text-rose-300"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {unread > 0 && (
        <Link to="/patient/activity" className="block">
          <Card className="flex items-center justify-between border-amber-500/30 bg-amber-500/5">
            <span className="text-sm text-amber-200">
              {unread} new notification{unread > 1 ? 's' : ''}
            </span>
            <span className="text-xs text-amber-300">View →</span>
          </Card>
        </Link>
      )}

      <Card>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Recent access</h3>
        {recent.length === 0 ? (
          <p className="py-2 text-sm text-ink-500">No one has requested your record yet.</p>
        ) : (
          <div className="space-y-2.5">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{r.requester?.name ?? roleLabel[r.requester_role]}</div>
                  <div className="text-[11px] text-ink-500">{timeAgo(r.created_at)}</div>
                </div>
                <Badge
                  tone={
                    r.status === 'approved' ? 'good' : r.status === 'denied' || r.status === 'revoked' ? 'bad' : 'neutral'
                  }
                >
                  {r.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
        <Link to="/patient/activity" className="mt-3 block text-center text-xs font-semibold text-mint-400">
          Full activity log →
        </Link>
      </Card>
    </div>
  )
}

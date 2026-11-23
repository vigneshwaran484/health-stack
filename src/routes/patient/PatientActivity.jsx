import { Badge, Card, Empty } from '../../components/ui'
import { roleLabel, scopeLabel, timeAgo } from '../../lib/format'

/**
 * The transparency surface: every access request, every decision, and every
 * emergency break-glass event, in one place the patient controls.
 */
export default function PatientActivity({ requests, notif }) {
  const { notifications, markRead } = notif

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Notifications</h2>
        {notifications.length === 0 ? (
          <Empty>Nothing yet</Empty>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <Card
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={`cursor-pointer p-3.5 ${
                  n.read ? 'opacity-60' : n.kind === 'emergency_access' ? 'border-rose-500/40 bg-rose-500/5' : 'border-mint-500/30 bg-mint-500/5'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-500">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 text-xs text-ink-300">{n.body}</p>}
                {!n.read && <span className="mt-1.5 inline-block text-[10px] font-bold text-mint-400">TAP TO MARK READ</span>}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Access log</h2>
        {requests.length === 0 ? (
          <Empty>No access requests yet</Empty>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <Card key={r.id} className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {r.requester?.name ?? roleLabel[r.requester_role]}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      {roleLabel[r.requester_role]} · {scopeLabel[r.scope]}
                    </div>
                  </div>
                  <Badge
                    tone={
                      r.status === 'approved'
                        ? 'good'
                        : r.status === 'pending'
                          ? 'info'
                          : r.status === 'expired'
                            ? 'neutral'
                            : 'bad'
                    }
                  >
                    {r.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-500">
                  requested {timeAgo(r.created_at)}
                  {r.responded_at ? ` · answered ${timeAgo(r.responded_at)}` : ''}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

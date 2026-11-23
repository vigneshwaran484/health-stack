import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { Badge } from './ui'

function Logo({ small }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 192 192" className={small ? 'h-6 w-6' : 'h-7 w-7'}>
        <path
          d="M96 46c-18-16-46-6-46 18 0 26 34 46 46 54 12-8 46-28 46-54 0-24-28-34-46-18z"
          fill="none"
          stroke="#34d8b4"
          strokeWidth="11"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] font-bold tracking-tight text-white">
        Health<span className="text-mint-400">Stack</span>
      </span>
    </div>
  )
}

/** Desktop web shell — doctor, pharmacist, lab. */
export function ProviderShell({ nav, children }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
          <Logo />
          <nav className="flex flex-1 items-center gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-ink-800 text-white' : 'text-ink-500 hover:text-ink-300'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="flex items-center justify-end gap-1.5 text-sm font-semibold text-white">
                {profile?.name}
                {profile?.verified && (
                  <span title="Verified provider — production would check ABDM's HPR registry" className="text-mint-400">
                    ✓
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ink-500">{profile?.org ?? profile?.email}</div>
            </div>
            <button
              onClick={async () => {
                await signOut()
                navigate('/login')
              }}
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:border-rose-500 hover:text-rose-300"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-7">{children}</main>
    </div>
  )
}

/** Mobile PWA shell — patient and caregiver. */
export function MobileShell({ title, tabs, children, right }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="phone-frame flex flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <div>
          <Logo small />
          <p className="mt-0.5 text-[11px] text-ink-500">{title ?? profile?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {right}
          <button
            onClick={async () => {
              await signOut()
              navigate('/login')
            }}
            className="rounded-lg border border-ink-800 px-2.5 py-1 text-[11px] text-ink-500 hover:border-rose-500 hover:text-rose-300"
          >
            Exit
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">{children}</main>

      {tabs?.length > 0 && (
        <nav className="grid border-t border-ink-800 bg-ink-950/80" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${
                  isActive ? 'text-mint-400' : 'text-ink-500'
                }`
              }
            >
              <span className="text-base leading-none">{t.icon}</span>
              {t.label}
              {t.badge > 0 && (
                <span className="absolute -mt-6 ml-6 rounded-full bg-rose-500 px-1.5 text-[9px] text-white">
                  {t.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}

/** Consistent page heading across every role. */
export function PageHead({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export function ConsentBanner({ session, tick, onRevoke }) {
  if (!session) return null
  const left = Math.max(0, new Date(session.expiresAt).getTime() - Date.now())
  const mins = Math.floor(left / 60000)
  const secs = Math.floor((left % 60000) / 1000)
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-mint-500/30 bg-mint-500/10 px-4 py-3">
      <div className="flex items-center gap-3 text-sm">
        <Badge tone="good">Consent active</Badge>
        <span className="text-ink-300">
          <strong className="text-white">{session.patientName}</strong> · {session.patientCode}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-300">
        <span>
          Access expires in{' '}
          <span className="font-mono font-semibold text-mint-400" data-tick={tick}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        </span>
        <button onClick={onRevoke} className="rounded-lg border border-ink-700 px-2.5 py-1 hover:border-rose-500 hover:text-rose-300">
          End session
        </button>
      </div>
    </div>
  )
}

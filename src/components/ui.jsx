import { useEffect, useState } from 'react'

export function Button({ variant = 'primary', className = '', full, ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ' +
    'transition active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-mint-500 text-ink-950 hover:bg-mint-400',
    ghost: 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-white',
    danger: 'bg-rose-500 text-white hover:bg-rose-400',
    warn: 'bg-amber-500 text-ink-950 hover:bg-amber-400',
    outline: 'border border-ink-700 text-ink-300 hover:border-mint-500 hover:text-white',
  }
  return <button className={`${base} ${variants[variant]} ${full ? 'w-full' : ''} ${className}`} {...props} />
}

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`rounded-2xl border border-ink-800 bg-ink-900/70 p-4 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-ink-700 bg-ink-950/60 px-3.5 py-2.5 text-sm text-white ' +
  'placeholder:text-ink-500 outline-none focus:border-mint-500'

export function Input(props) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />
}

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-300',
    good: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    bad: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
    info: 'bg-mint-500/15 text-mint-400 border border-mint-500/30',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-ink-800 p-6 text-center text-sm text-ink-500">{children}</p>
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-700 border-t-mint-400 ${className}`}
    />
  )
}

/** Non-blocking banner. Errors stay until dismissed; successes fade. */
export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast || toast.tone === 'bad') return
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [toast, onClose])
  if (!toast) return null
  const tones = {
    good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    bad: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
    info: 'border-mint-500/40 bg-mint-500/10 text-mint-200',
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={`slide-up pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${tones[toast.tone ?? 'info']}`}
        onClick={onClose}
      >
        {toast.message}
      </div>
    </div>
  )
}

export function useToast() {
  const [toast, setToast] = useState(null)
  return {
    toast,
    clear: () => setToast(null),
    show: (message, tone = 'info') => setToast({ message, tone }),
    error: (message) => setToast({ message, tone: 'bad' }),
    success: (message) => setToast({ message, tone: 'good' }),
  }
}

export function StatusDot({ status }) {
  const map = { safe: '#34d399', pending: '#94a3b8', reminder: '#fbbf24', critical: '#f43f5e' }
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: map[status] ?? '#94a3b8', boxShadow: `0 0 12px ${map[status] ?? '#94a3b8'}` }}
    />
  )
}

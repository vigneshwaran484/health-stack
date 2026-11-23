import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Button } from './ui'

const REGION_ID = 'hs-qr-region'

/**
 * Camera QR scanner for the provider apps.
 *
 * Camera access can fail for reasons outside our control (no device, denied
 * permission, http origin), so the manual Patient ID entry below is a
 * first-class path, not a fallback — the demo never depends on a webcam.
 */
export function QrScanner({ onResult, busy, placeholder = 'HS-XXXXXX' }) {
  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState(null)
  const [manual, setManual] = useState('')
  const scannerRef = useRef(null)

  useEffect(() => {
    return () => {
      const s = scannerRef.current
      if (s?.isScanning) s.stop().catch(() => {})
    }
  }, [])

  async function start() {
    setCamError(null)
    setScanning(true)
    try {
      const scanner = new Html5Qrcode(REGION_ID, { verbose: false })
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => {
          await scanner.stop().catch(() => {})
          setScanning(false)
          onResult(decoded.trim())
        },
        () => {},
      )
    } catch (err) {
      setScanning(false)
      setCamError(err?.message ?? 'Camera unavailable')
    }
  }

  async function stop() {
    const s = scannerRef.current
    if (s?.isScanning) await s.stop().catch(() => {})
    setScanning(false)
  }

  return (
    <div className="space-y-4">
      <div
        id={REGION_ID}
        className={`overflow-hidden rounded-2xl border border-ink-800 bg-ink-950 ${scanning ? '' : 'hidden'}`}
      />

      {!scanning && (
        <Button variant="outline" full onClick={start} disabled={busy}>
          Scan patient QR with camera
        </Button>
      )}
      {scanning && (
        <Button variant="ghost" full onClick={stop}>
          Stop camera
        </Button>
      )}

      {camError && (
        <p className="text-xs text-amber-300">
          Camera unavailable ({camError}). Type the Patient ID instead.
        </p>
      )}

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-500">
        <span className="h-px flex-1 bg-ink-800" /> or enter Patient ID <span className="h-px flex-1 bg-ink-800" />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (manual.trim()) onResult(manual.trim())
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder={placeholder}
          className="w-full rounded-xl border border-ink-700 bg-ink-950/60 px-3.5 py-2.5 font-mono text-sm tracking-widest text-white placeholder:text-ink-500 outline-none focus:border-mint-500"
        />
        <Button type="submit" disabled={busy || !manual.trim()}>
          {busy ? 'Requesting…' : 'Request'}
        </Button>
      </form>
    </div>
  )
}

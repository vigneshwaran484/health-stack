import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

/** Renders the patient's permanent QR token. This code never changes. */
export function QrCode({ value, size = 220 }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current || !value) return
    QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#0b1220', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch(() => {})
  }, [value, size])

  return (
    <div className="rounded-2xl bg-white p-3 shadow-lg">
      <canvas ref={ref} width={size} height={size} className="block" />
    </div>
  )
}

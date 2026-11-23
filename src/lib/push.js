/**
 * Check-in prompt delivery for the patient PWA.
 *
 * Pilot: Notification API via the registered service worker. A real deployment
 * would add a VAPID key + Push API subscription so the server can wake the
 * device; the escalation ladder in the demo is driven manually instead of by
 * real 30/60/120-minute timers.
 *
 * [Roadmap] native OEM-proof alarm, Activity Recognition backup, SMS/voice
 * escalation — see workflow.md §5.
 */

export async function ensurePermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export async function notify(title, body, tag = 'health-stack') {
  const perm = await ensurePermission()
  if (perm !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, {
        body,
        tag,
        badge: '/icon.svg',
        icon: '/icon.svg',
        requireInteraction: tag === 'checkin-critical',
      })
    } else {
      new Notification(title, { body, tag })
    }
    return true
  } catch {
    return false
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

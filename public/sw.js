// Minimal service worker: exists so the patient app is installable as a PWA and
// so check-in prompts can be shown as real system notifications.
// Deliberately no offline caching — offline store-and-forward is roadmap
// (workflow.md §5) and stale cached medical data would be worse than none.

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(Promise.resolve())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Wired for a real web-push deployment; the pilot triggers notifications
// locally from the page instead of from a push server.
self.addEventListener('push', (event) => {
  let payload = { title: 'Health Stack', body: 'Time for your daily check-in.' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    /* keep default */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: payload.tag || 'health-stack',
      requireInteraction: payload.tag === 'checkin-critical',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/patient/checkin'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c)
      if (existing) return existing.focus()
      return self.clients.openWindow(target)
    }),
  )
})

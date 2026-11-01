// Service Worker: بيستقبل الإشعارات حتى والتطبيق مقفول
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: e.data && e.data.text() } }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'والي بلازا', {
      body: d.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: d.id,
      data: { url: d.url || './' },
      dir: 'rtl',
      lang: 'ar',
    })
    // عداد على أيقونة التطبيق
    if (self.navigator.setAppBadge) {
      const list = await self.registration.getNotifications()
      self.navigator.setAppBadge(list.length).catch(() => {})
    }
    const wins = await self.clients.matchAll({ type: 'window' })
    wins.forEach((w) => w.postMessage({ type: 'push', id: d.id }))
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) { if ('focus' in w) { w.navigate(url); return w.focus() } }
    return self.clients.openWindow(url)
  })())
})

// Minimális service worker: csak a verziózott statikus fájlokat (/_nuxt/, ikonok) gyorsítótárazza.
// Az /api/ válaszok (egészségügyi adatok) soha nem kerülnek a gyorsítótárba, az oldal mindig a hálózatról jön.
// A verzió emelése törli a régi gyorsítótárat (pl. lecserélt ikonok).
const CACHE = 'cukornaplo-static-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (!url.pathname.startsWith('/_nuxt/') && !/^\/(icon-|apple-touch-icon|favicon)/.test(url.pathname)) return
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
      return res
    })),
  )
})

// Push értesítések (hipó-riasztás, teszt): a szerver JSON-t küld {title, body, url, tag}.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'Cukornapló', body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Cukornapló', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (!('focus' in c)) continue
      // Már nyitott ablak is a célra ugorjon (pl. autopilot-javaslat), ne csak fókuszt kapjon.
      if ('navigate' in c) { try { c.navigate(url) } catch { /* más eredetű url, vagy nem engedélyezett */ } }
      return c.focus()
    }
    return self.clients.openWindow(url)
  }))
})

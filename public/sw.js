// Minimális service worker: csak a verziózott statikus fájlokat (/_nuxt/, ikonok) gyorsítótárazza.
// Az /api/ válaszok (egészségügyi adatok) soha nem kerülnek a gyorsítótárba, az oldal mindig a hálózatról jön.
const CACHE = 'cukornaplo-static-v1'

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

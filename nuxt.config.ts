import { fileURLToPath } from 'node:url'

// Adatmappa (SQLite + settings.json). Dockerben DATA_DIR=/data; helyben a projekt ./data mappája.
const dataDir = process.env.DATA_DIR || fileURLToPath(new URL('./data', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  // Személyes dashboard, nincs SEO-igény: SPA mód. Az API-k Nitro alatt szerveroldalon futnak.
  ssr: false,
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    dataDir,
    // 0 = kikapcsolva. Alapból 5 perc; a háttér-poller a Nitroban fut.
    carelinkInterval: Number(process.env.CARELINK_INTERVAL ?? 300),
    appTz: process.env.APP_TZ || 'Europe/Budapest',
    // A felület is az app időzónájában számol (pl. „most” a naplóban, a most érvényes napszak).
    public: { appTz: process.env.APP_TZ || 'Europe/Budapest' },
  },
  nitro: {
    // A node:sqlite a Node beépített modulja, nem kell natív fordítás.
    externals: { inline: [] },
    // A telefonos widget kódja (docs/scriptable-widget.txt): a szerver innen adja a betöltőnek.
    serverAssets: [{ baseName: 'docs', dir: fileURLToPath(new URL('./docs', import.meta.url)) }],
  },
  // Biztonsági fejlécek minden válaszra.
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
      },
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'hu' },
      title: 'Cukornapló',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#15131c' },
        { name: 'apple-mobile-web-app-title', content: 'Cukornapló' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        // Új fájlnév: az iOS (és a Cloudflare) sokáig őrzi a régi ikont ugyanazon a címen.
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon-v2.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      // Az egyetlen téma (Éjszaka) még a Vue betöltése előtt beáll (nincs villanás).
      script: [{
        innerHTML: "document.documentElement.setAttribute('data-theme','pastel-night')",
        tagPosition: 'head',
      }, {
        innerHTML: "if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})",
        tagPosition: 'bodyClose',
      }],
    },
  },
})

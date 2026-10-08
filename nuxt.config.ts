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
  },
  nitro: {
    // A node:sqlite a Node beépített modulja, nem kell natív fordítás.
    externals: { inline: [] },
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
        { name: 'theme-color', content: '#0d0d0d' },
        { name: 'apple-mobile-web-app-title', content: 'Cukornapló' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      // A mentett témát még a Vue betöltése előtt beállítjuk (nincs villanás).
      script: [{
        innerHTML: "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
        tagPosition: 'head',
      }, {
        innerHTML: "if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})",
        tagPosition: 'bodyClose',
      }],
    },
  },
})

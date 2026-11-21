// Web Push feliratkozás: csak az ismert push-szolgáltatók címe fogadható el (a szerver erre a címre küld, ezért egy
// belső hálózati cím nem lehet feliratkozás).
const HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
]

export function pushEndpointAllowed(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && !u.port && HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

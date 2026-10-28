// Vercel serverless function — GET /api/osint?domain=example.com → when a domain was registered
// Uses public RDAP (rdap.org, which redirects to the registry for that domain).
// New domains are a common sign of a scam storefront, so the age is shown on the case.
// Security hardening:
//   • Only a well-formed domain name is accepted; nothing about the customer is sent
//   • Per-IP rate limit: 30 / 60 s; CORS restricted to ALLOWED_ORIGIN; results cached for a day

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const _rateStore = {}, _cache = new Map()
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = _rateStore[ip]
  if (!entry || now > entry.resetAt) { _rateStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return true }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  if (!checkRateLimit(ip)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many lookups — wait a minute' }) }

  const domain = String(req.query?.domain || '').trim().toLowerCase().replace(/^www\./, '')
  if (!DOMAIN.test(domain)) return res.status(400).json({ error: 'Not a domain name' })
  const hit = _cache.get(domain)
  if (hit && Date.now() - hit.at < 86400000) return res.status(200).json(hit.data)

  try {
    const r = await fetch(`https://rdap.org/domain/${domain}`, { headers: { Accept: 'application/rdap+json', 'User-Agent': 'Covalence/1.0 (domain age check)' }, redirect: 'follow' })
    if (r.status === 404) return res.status(200).json({ domain, found: false })
    if (!r.ok) return res.status(502).json({ error: `The registry didn’t answer (${r.status})` })
    const d = await r.json()
    const ev = a => (d.events || []).find(e => e.eventAction === a)?.eventDate || null
    const registrar = (d.entities || []).find(e => (e.roles || []).includes('registrar'))
    const name = registrar?.vcardArray?.[1]?.find(v => v[0] === 'fn')?.[3] || registrar?.handle || ''
    const registered = ev('registration')
    const data = { domain, found: true, registered, updated: ev('last changed'), expires: ev('expiration'), registrar: name,
      ageDays: registered ? Math.floor((Date.now() - new Date(registered)) / 86400000) : null, status: d.status || [] }
    _cache.set(domain, { at: Date.now(), data })
    return res.status(200).json(data)
  } catch {
    return res.status(502).json({ error: 'The registry couldn’t be reached' })
  }
}

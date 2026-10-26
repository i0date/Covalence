// Vercel serverless function — POST /api/evidence-url → short-lived signed link to one evidence file
// The cov-evidence bucket is private (see supabase_storage.sql), so files are only reachable
// through links signed here with the service-role key, which never leaves the server.
// Security hardening:
//   • Path must match the shape the app uploads: <caseId>/<timestamp>-<safeName>
//   • Links expire after SIGNED_URL_TTL_S seconds
//   • Per-IP rate limit: 60 requests / 60 s (in-memory; resets per function instance)
//   • CORS restricted to ALLOWED_ORIGIN env var (falls back to known domain)

const BUCKET               = 'cov-evidence'
const SIGNED_URL_TTL_S     = 300         // 5 minutes
const RATE_LIMIT_MAX       = 60          // requests
const RATE_LIMIT_WINDOW_MS = 60 * 1000  // per 60 s
const PATH_RE              = /^[A-Za-z0-9_-]{1,64}\/\d{10,16}-[A-Za-z0-9._-]{1,200}$/

const _rateStore = {}

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = _rateStore[ip]
  if (!entry || now > entry.resetAt) {
    _rateStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  if (!checkRateLimit(ip)) {
    res.setHeader('Retry-After', '60')
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' })
  }

  const supaUrl    = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !serviceKey) return res.status(500).json({ error: 'Evidence links not configured (SUPABASE_SERVICE_ROLE_KEY missing)' })

  const { path } = req.body || {}
  if (typeof path !== 'string' || !PATH_RE.test(path)) {
    return res.status(400).json({ error: 'Invalid evidence path' })
  }

  const upstream = await fetch(`${supaUrl}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_S }),
  })
  const data = await upstream.json().catch(() => ({}))
  if (!upstream.ok || !data.signedURL) {
    return res.status(upstream.status === 400 || upstream.status === 404 ? 404 : 502).json({ error: 'Document not found' })
  }
  return res.status(200).json({ url: `${supaUrl}/storage/v1${data.signedURL}`, expiresIn: SIGNED_URL_TTL_S })
}

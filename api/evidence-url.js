// Vercel serverless function — POST /api/evidence-url → short-lived signed link to one evidence file
// The cov-evidence bucket is private (see supabase_storage.sql), so files are only reachable
// through links signed here with the service-role key, which never leaves the server.
// Security hardening:
//   • Caller must send a valid Supabase Auth token, and the case in the path must
//     belong to the caller's institution (memberships / cov_cases, supabase_auth.sql)
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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

  // Caller must be signed in, and the case must belong to their institution
  const userToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return res.status(401).json({ error: 'Sign in to open evidence' })
  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${userToken}` } })
  const user = userRes.ok ? await userRes.json().catch(() => null) : null
  if (!user?.id) return res.status(401).json({ error: 'Session expired — sign in again' })
  const caseId = path.split('/')[0]
  const [mRes, cRes] = await Promise.all([
    fetch(`${supaUrl}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=institution_id`, { headers: svc }),
    fetch(`${supaUrl}/rest/v1/cov_cases?id=eq.${encodeURIComponent(caseId)}&select=institution_id`, { headers: svc }),
  ])
  const member = mRes.ok ? (await mRes.json())[0] : null
  const owner  = cRes.ok ? (await cRes.json())[0] : null
  if (!member?.institution_id || !owner?.institution_id || member.institution_id !== owner.institution_id) {
    return res.status(403).json({ error: 'This document belongs to another institution’s case' })
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
  // Audit: who opened which document (supabase_workspace_audit.sql). Best-effort — never blocks the link.
  await fetch(`${supaUrl}/rest/v1/audit_log`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ institution_id: member.institution_id, actor_id: user.id, actor_email: (user.email || '').toLowerCase(),
      action: 'evidence.opened', entity: 'case', entity_id: caseId, detail: { file: path.split('/').slice(1).join('/') } }),
  }).catch(() => {})
  return res.status(200).json({ url: `${supaUrl}/storage/v1${data.signedURL}`, expiresIn: SIGNED_URL_TTL_S })
}

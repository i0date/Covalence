// Vercel serverless function — POST /api/retention → purge closed cases past the retention period
// Only an institution admin can purge. For each eligible case (closed, past the
// period, not on legal hold) the evidence files are deleted from the private
// bucket first, then retention_purge() removes the case, records a tombstone so
// browsers can't re-upload it, and writes the audit entries.
// Security hardening:
//   • Caller's Supabase token required; role checked via my_role() as that user
//   • Eligibility re-checked by the database (retention_candidates / retention_purge)
//   • Evidence deleted only under "<caseId>/" for cases the database says are eligible
//   • Per-IP rate limit: 10 requests / 60 s; CORS restricted to ALLOWED_ORIGIN

const BUCKET               = 'cov-evidence'
const RATE_LIMIT_MAX       = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const MAX_CASES            = 500
const _rateStore = {}

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  if (!checkRateLimit(ip)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Rate limit exceeded' }) }

  const supaUrl    = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !anonKey || !serviceKey) return res.status(500).json({ error: 'Retention purge not configured' })

  const userToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return res.status(401).json({ error: 'Sign in first' })
  const { caseIds } = req.body || {}
  if (!Array.isArray(caseIds) || caseIds.length === 0 || caseIds.length > MAX_CASES || !caseIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return res.status(400).json({ error: 'caseIds must be 1–500 case numbers' })
  }

  // Database calls made AS the user, so role and institution checks apply
  const asUser = (fn, args) => fetch(`${supaUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  const roleRes = await asUser('my_role')
  if (roleRes.status === 401) return res.status(401).json({ error: 'Session expired — sign in again' })
  const role = roleRes.ok ? await roleRes.json() : null
  if (role !== 'admin') return res.status(403).json({ error: 'Only an institution admin can purge' })

  const candRes = await asUser('retention_candidates')
  if (!candRes.ok) return res.status(502).json({ error: 'Could not check eligibility' })
  const eligible = new Set((await candRes.json()).map(c => c.case_id))
  const toPurge = caseIds.filter(id => eligible.has(id))
  if (!toPurge.length) return res.status(200).json({ purged: 0, files: 0 })

  // One case at a time: its evidence files (service key, only under its own folder), then the record.
  // A failure stops the run, so no case is ever left half-purged.
  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
  let files = 0, purged = 0
  for (const id of toPurge) {
    const list = await fetch(`${supaUrl}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: svc, body: JSON.stringify({ prefix: `${id}/`, limit: 1000 }) })
    if (!list.ok) return res.status(502).json({ error: `Could not read evidence for ${id}; stopped`, purged, files })
    const names = ((await list.json()) || []).filter(o => o && o.name && o.id).map(o => `${id}/${o.name}`)
    if (names.length) {
      const del = await fetch(`${supaUrl}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: svc, body: JSON.stringify({ prefixes: names }) })
      if (!del.ok) return res.status(502).json({ error: `Could not delete evidence for ${id}; stopped`, purged, files })
      files += names.length
    }
    const p = await asUser('retention_purge', { p_case_ids: [id] })
    if (!p.ok) return res.status(502).json({ error: `Purge failed at ${id}: ` + (await p.text()).slice(0, 200), purged, files })
    purged += await p.json()
  }
  return res.status(200).json({ purged, files })
}

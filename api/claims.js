// Vercel serverless function — /api/claims → disputes reported in the bank's own app
// From the bank's systems, with an API key from Settings → Connections:
//   POST /api/claims                 Authorization: Bearer cvl_…   { one claim }  → stored, lands in 001 Triage → Claims
//   GET  /api/claims?reference=…     Authorization: Bearer cvl_…                   → where the claim is now
// From Covalence itself, after an analyst moves a claim on (claim_set in supabase_claims.sql):
//   POST /api/claims                 Authorization: Bearer <Supabase session>   { "notify": "CLM-…" }
//                                    → a signed claim.updated event to the bank's endpoint
// The rules for a claim (what's required, the Reg E / Reg Z clock, Ready for Desk)
// are in src/claims.mjs, shared with Triage.
// Security hardening:
//   • Keys are looked up by SHA-256 hash; revoked keys are refused; each key is tied to one institution
//   • Every field is validated and trimmed; ≤ 25 transactions, ≤ 20 attachment links, ≤ 256 KB per request
//   • Attachments are links in the bank's own storage (https only); Covalence never fetches them
//   • Per-key rate limit: 120 requests / 60 s; no CORS for keyed calls (server-to-server); each claim is audited
//   • Status events: the caller must be signed in to the claim's institution with a role that can work cases

const crypto = require('crypto')
const wh = require('./_webhook.js')
const RATE_LIMIT_MAX = 120, RATE_LIMIT_WINDOW_MS = 60 * 1000, MAX_BYTES = 256 * 1024
const WRITERS = ['admin', 'reviewer', 'analyst']
const _rate = {}
function limited(k) {
  const now = Date.now(), e = _rate[k]
  if (!e || now > e.resetAt) { _rate[k] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return false }
  if (e.count >= RATE_LIMIT_MAX) return true
  e.count++; return false
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const supa = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supa || !svc) return res.status(500).json({ error: 'Claims are not configured' })
  const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }
  const rest = async (path, opts = {}) => {
    const r = await fetch(`${supa}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const t = await r.text(); return t ? JSON.parse(t) : null
  }
  const audit = (inst, action, id, detail) => rest('rpc/audit_add', { method: 'POST', body: JSON.stringify({ p_inst: inst, p_action: action, p_entity: 'claim', p_entity_id: id, p_detail: detail }) }).catch(() => {})
  const endpointFor = async inst => (await rest(`action_endpoints?institution_id=eq.${inst}&select=url,secret`).catch(() => []))?.[0]
  const m = await import('../src/claims.mjs')
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()

  // ── From Covalence: tell the bank a claim moved on ──
  if (!token.startsWith('cvl_')) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST' || !token) return res.status(401).json({ error: 'Send your API key as: Authorization: Bearer cvl_…' })
    const ur = await fetch(`${supa}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } })
    const user = ur.ok ? await ur.json().catch(() => null) : null
    if (!user?.id) return res.status(401).json({ error: 'Session expired — sign in again' })
    if (limited(user.id)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests — wait a minute' }) }
    const member = (await rest(`memberships?user_id=eq.${encodeURIComponent(user.id)}&select=institution_id,role`).catch(() => []))?.[0]
    if (!member || !WRITERS.includes(member.role)) return res.status(403).json({ error: 'Your role can’t update claims' })
    const id = String(req.body?.notify || '')
    if (!/^CLM-[A-F0-9]{10}$/.test(id)) return res.status(400).json({ error: 'Send { "notify": "CLM-…" }' })
    const row = (await rest(`app_claims?institution_id=eq.${member.institution_id}&id=eq.${id}&select=id,external_id,status,history,created_at,updated_at`))?.[0]
    if (!row) return res.status(404).json({ error: 'No such claim in your institution' })
    const ep = await endpointFor(member.institution_id)
    if (!ep?.url) return res.status(200).json({ ok: false, notConnected: true })
    const r = await wh.sendEvent(ep, 'claim.updated', m.publicStatus(row))
    await audit(member.institution_id, 'claim.status_sent', id, { status: row.status, event: r.id || null, ok: r.ok, http: r.status })
    return res.status(200).json({ ok: r.ok, status: r.status, event: r.id || null })
  }

  // ── From the bank's systems ──
  if (!/^cvl_[a-f0-9]{48}$/.test(token)) return res.status(401).json({ error: 'Send your API key as: Authorization: Bearer cvl_…' })
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  if (limited(hash)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Rate limit: 120 requests a minute per key' }) }
  const keyRow = (await rest(`intake_keys?key_hash=eq.${hash}&revoked_at=is.null&select=id,institution_id,prefix`).catch(() => []))?.[0]
  if (!keyRow) return res.status(401).json({ error: 'Unknown or revoked API key' })
  const inst = keyRow.institution_id
  const touchKey = () => rest(`intake_keys?id=eq.${keyRow.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) }).catch(() => {})

  try {
    if (req.method === 'GET') {
      const q = req.query || {}
      const filter = q.id ? `id=eq.${encodeURIComponent(String(q.id).slice(0, 20))}` : q.reference ? `external_id=eq.${encodeURIComponent(String(q.reference).slice(0, 120))}` : null
      if (!filter) return res.status(400).json({ error: 'Ask for ?reference=<your claim id> or ?id=CLM-…' })
      const row = (await rest(`app_claims?institution_id=eq.${inst}&${filter}&select=id,external_id,status,history,created_at,updated_at`))?.[0]
      if (!row) return res.status(404).json({ error: 'No claim with that reference' })
      return res.status(200).json(m.publicStatus(row))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST a claim, or GET ?reference=…' })
    if (parseInt(req.headers['content-length'] || '0', 10) > MAX_BYTES) return res.status(413).json({ error: 'Request larger than 256 KB — send attachments as links' })

    const now = new Date()
    const { claim, errors } = m.normaliseClaim(req.body, now)
    if (errors.length) return res.status(400).json({ error: 'The claim has problems', problems: errors })
    const id = m.claimIdFrom(crypto.createHash('sha256').update(inst + '|' + claim.externalId).digest('hex'))
    const clock = m.claimClock(claim), missing = m.missingForDesk(claim)
    const row = { institution_id: inst, id, external_id: claim.externalId, channel: claim.channel, segment: claim.segment, status: 'received', ready: !missing.length,
      data: { ...claim, clock, missing, source: keyRow.prefix }, reported_at: claim.reportedAt,
      history: [{ status: 'received', at: now.toISOString(), by: keyRow.prefix, note: `Received from the ${m.CHANNELS[claim.channel].toLowerCase().replace('from ', '')}` }] }
    const stored = await rest('app_claims?select=id,external_id,status,history,created_at,updated_at', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([row]) })
    await touchKey()

    if (!stored?.length) {   // the same reference again: answer with where it is now
      const cur = (await rest(`app_claims?institution_id=eq.${inst}&id=eq.${id}&select=id,external_id,status,history,created_at,updated_at`))?.[0]
      return res.status(200).json({ ...m.publicStatus(cur), duplicate: true })
    }
    await audit(inst, 'claim.received', id, { reference: claim.externalId, channel: claim.channel, transactions: claim.transactions.length, ready: !missing.length })
    const ep = await endpointFor(inst)
    if (ep?.url) await wh.sendEvent(ep, 'claim.received', m.publicStatus(stored[0])).catch(() => {})
    return res.status(201).json({ ...m.publicStatus(stored[0]), duplicate: false, readyForDesk: !missing.length, missing, clock })
  } catch (e) {
    console.error('claims:', e.message)
    return res.status(500).json({ error: 'Couldn’t store the claim — try again' })
  }
}

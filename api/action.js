// Vercel serverless function — POST /api/action → act on an alert in the institution's own systems
//   Authorization: Bearer <Supabase session token>
//   { "alertId": "...", "action": "block_card" | "hold_payment" }   or   { "test": true }
// Covalence POSTs a signed action.requested event to the endpoint saved in Settings →
// Connections (supabase_actions.sql); the institution's receiver blocks the card, holds
// the payment or locks the account, and answers 2xx — ideally with { "reference": "..." }.
// The answer is returned to the analyst and goes on the alert's record and the audit log.
// Security hardening:
//   • Caller must be signed in with a role that can work cases (tests: admins and reviewers)
//   • The alert must belong to the caller's institution; the endpoint and secret are read
//     with the service role and never sent to the browser
//   • Endpoint must be public https (no private networks); 8 s timeout; redirects aren't followed
//   • Per-user rate limit: 30 requests / 60 s

const { sendEvent } = require('./_webhook.js')
const RATE_LIMIT_MAX = 30, RATE_LIMIT_WINDOW_MS = 60 * 1000
const WRITERS = ['admin', 'reviewer', 'analyst'], CONFIGURERS = ['admin', 'reviewer']
const ACTIONS = ['block_card', 'hold_payment']
const _rate = {}
function limited(k) {
  const now = Date.now(), e = _rate[k]
  if (!e || now > e.resetAt) { _rate[k] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return false }
  if (e.count >= RATE_LIMIT_MAX) return true
  e.count++; return false
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

  const supa = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supa || !svc) return res.status(500).json({ error: 'Actions are not configured' })
  const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }
  const rest = async path => { const r = await fetch(`${supa}/rest/v1/${path}`, { headers: H }); return r.ok ? r.json() : [] }

  // Who is asking
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in to act on alerts' })
  const ur = await fetch(`${supa}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } })
  const user = ur.ok ? await ur.json().catch(() => null) : null
  if (!user?.id) return res.status(401).json({ error: 'Session expired — sign in again' })
  if (limited(user.id)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many actions — wait a minute' }) }
  const member = (await rest(`memberships?user_id=eq.${encodeURIComponent(user.id)}&select=institution_id,role,display_name,email`))[0]
  if (!member) return res.status(403).json({ error: 'You aren’t a member of an institution' })
  const inst = member.institution_id

  const { alertId, action, test } = req.body || {}
  if (test ? !CONFIGURERS.includes(member.role) : !WRITERS.includes(member.role)) return res.status(403).json({ error: `Your role (${member.role}) can’t do this` })

  const endpoint = (await rest(`action_endpoints?institution_id=eq.${inst}&select=url,secret`))[0]
  if (!endpoint?.url) return res.status(409).json({ error: 'not_connected', message: 'No endpoint is set up in Settings → Connections' })

  let type, data
  const by = { name: member.display_name || '', email: member.email || user.email || '' }
  if (test) {
    type = 'covalence.test'
    data = { message: 'A test event from Covalence. Answer 2xx to show it arrived.', requestedBy: by }
  } else {
    if (!ACTIONS.includes(action) || typeof alertId !== 'string' || alertId.length > 120) return res.status(400).json({ error: 'Send alertId and an action: block_card or hold_payment' })
    const row = (await rest(`tm_alerts?institution_id=eq.${inst}&id=eq.${encodeURIComponent(alertId)}&select=data,status`))[0]
    if (!row) return res.status(404).json({ error: 'No such alert in your institution' })
    const a = row.data || {}
    type = 'action.requested'
    data = { action, segment: a.segment || 'fi', alertId, rule: a.rule, customerId: a.customerId, customerName: a.customerName || '', amount: a.total || 0,
      transactionIds: (a.txIds || []).slice(0, 50), requestedBy: by }
  }

  const r = await sendEvent(endpoint, type, data)
  const reference = r.json && (r.json.reference || r.json.id) ? String(r.json.reference || r.json.id).slice(0, 120) : null
  await fetch(`${supa}/rest/v1/rpc/audit_add`, { method: 'POST', headers: H, body: JSON.stringify({ p_inst: inst, p_action: test ? 'connection.tested' : 'alert.action_sent', p_entity: test ? 'workspace' : 'alert',
    p_entity_id: test ? 'action_endpoint' : alertId, p_detail: { action: action || null, event: r.id || null, status: r.status, ok: r.ok, reference, by: by.email } }) }).catch(() => {})

  if (!r.ok) return res.status(200).json({ ok: false, status: r.status, error: r.error || `Your endpoint answered ${r.status}${r.text ? `: ${r.text.slice(0, 160)}` : ''}`, event: r.id || null })
  return res.status(200).json({ ok: true, status: r.status, reference, event: r.id })
}

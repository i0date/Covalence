// Vercel serverless function — POST /api/alarm → tell the team's Slack channel about an alarm
//   Authorization: Bearer <Supabase session token>
//   { "alarmId": "...", "event": "raised" | "joined" | "level" | "updated" | "stood_down" }
// The alarm itself is raised in the database (supabase_alarms.sql, alarm_raise); this
// only posts it, for level 2 (Alert) and 3 (Critical), to the Slack webhook saved in
// Settings → Connections (supabase_actions.sql). Level 1 (Watch) stays in the app.
// Security hardening:
//   • Caller must be signed in and a member of the alarm's institution
//   • The Slack URL is read with the service role and never sent to the browser
//   • Per-user rate limit: 20 requests / 60 s

const { postSlack } = require('./_webhook.js')
const RATE_LIMIT_MAX = 20, RATE_LIMIT_WINDOW_MS = 60 * 1000
const LEVEL = { 1: 'WATCH', 2: 'ALERT', 3: 'CRITICAL' }
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
  if (!supa || !svc) return res.status(500).json({ error: 'Alarms are not configured' })
  const H = { apikey: svc, Authorization: `Bearer ${svc}` }
  const rest = async path => { const r = await fetch(`${supa}/rest/v1/${path}`, { headers: H }); return r.ok ? r.json() : [] }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Sign in first' })
  const ur = await fetch(`${supa}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } })
  const user = ur.ok ? await ur.json().catch(() => null) : null
  if (!user?.id) return res.status(401).json({ error: 'Session expired — sign in again' })
  if (limited(user.id)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests — wait a minute' }) }
  const member = (await rest(`memberships?user_id=eq.${encodeURIComponent(user.id)}&select=institution_id`))[0]
  if (!member) return res.status(403).json({ error: 'You aren’t a member of an institution' })

  const { alarmId, event } = req.body || {}
  if (typeof alarmId !== 'string' || !/^[0-9a-f-]{36}$/i.test(alarmId)) return res.status(400).json({ error: 'Send alarmId' })
  const a = (await rest(`alarms?id=eq.${alarmId}&institution_id=eq.${member.institution_id}&select=*`))[0]
  if (!a) return res.status(404).json({ error: 'No such alarm' })
  if (a.level < 2) return res.status(200).json({ ok: true, posted: false, reason: 'Level 1 stays in the app' })
  const slack = (await rest(`action_endpoints?institution_id=eq.${member.institution_id}&select=slack_url`))[0]?.slack_url
  if (!slack) return res.status(200).json({ ok: true, posted: false, reason: 'No Slack webhook in Settings → Connections' })

  const appUrl = process.env.APP_URL || allowedOrigin
  const next = a.next_update_at ? new Date(a.next_update_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : ''
  const text = event === 'stood_down'
    ? `✅ Stood down: ${a.title} (was level ${a.level} · ${LEVEL[a.level]}).${a.stand_down_note ? ` ${a.stand_down_note}` : ''}`
    : `${a.level === 3 ? '🚨' : '⚠️'} *Level ${a.level} · ${LEVEL[a.level]}* — ${a.title}${event === 'joined' ? ' (another report added)' : ''}\n`
      + `Owner: ${a.owner_name || 'unassigned'}${a.do_now ? `\nDo now: ${a.do_now}` : ''}${next ? `\nNext update: ${next}` : ''}\n<${appUrl}|Open Covalence>`
  const r = await postSlack(slack, text)
  return res.status(200).json({ ok: !!r?.ok, posted: !!r?.ok, status: r?.status || 0 })
}

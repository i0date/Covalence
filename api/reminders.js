// Vercel serverless function — /api/reminders → the daily reminder email
//   GET  (Vercel Cron, weekdays)  every institution with "Daily email" on: each
//        member with something due gets one email listing it
//   POST (signed-in user)         "Email me my reminders now" in Settings → Workflow:
//        sends the caller their own list, whether or not the daily email is on
// The rules are the app's own (src/clocks.mjs), so the email matches Home and the bell.
// Security hardening:
//   • Cron calls must carry CRON_SECRET (Vercel sends it as a Bearer token)
//   • POST needs the caller's Supabase token; institution comes from my_membership() as that user
//   • Emails only go to members of the institution, never to an address typed into a case
//   • Case text is HTML-escaped; per-IP rate limit on POST: 5 / 60 s; CORS restricted to ALLOWED_ORIGIN

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const MAX_ITEMS_PER_EMAIL = 40
const _rateStore = {}

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = _rateStore[ip]
  if (!entry || now > entry.resetAt) { _rateStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return true }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

function line(i) {
  if (i.kind === 'escalated') return `Escalated to you — ${i.c.escalationReason || 'needs review'}`
  return `${i.clock.label}: ${i.clock.text}`
}

function emailHtml({ name, institution, items, appUrl }) {
  const rows = items.slice(0, MAX_ITEMS_PER_EMAIL).map(i => {
    const late = i.kind === 'escalated' || i.clock?.state === 'breached'
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #EDE8E0;font-family:monospace;font-size:11px;color:#57534E;white-space:nowrap;vertical-align:top;">
        <a href="${esc(appUrl)}/?open=${encodeURIComponent(i.c.id)}" style="color:#1A1814;">${esc(i.c.id)}</a></td>
      <td style="padding:10px 12px;border-bottom:1px solid #EDE8E0;vertical-align:top;">
        <div style="font-family:Georgia,serif;font-size:14px;color:#1A1814;">${esc(i.c.merchant || '—')}${i.c.amount ? ` <span style="font-family:monospace;font-size:11px;color:#57534E;">· ${esc(i.c.amount)}</span>` : ''}</div>
        <div style="font-family:monospace;font-size:11px;color:${late ? '#991B1B' : '#92400E'};margin-top:2px;">${esc(line(i))}</div></td>
    </tr>`
  }).join('')
  const more = items.length > MAX_ITEMS_PER_EMAIL ? `<p style="font-family:monospace;font-size:11px;color:#57534E;">…and ${items.length - MAX_ITEMS_PER_EMAIL} more in Covalence.</p>` : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F1EA;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:40px auto;background:#FFFFFF;border:1px solid #D4CCBC;">
    <div style="background:#1A1814;padding:20px 28px;">
      <div style="font-family:monospace;font-size:13px;letter-spacing:0.3em;color:#F5F1EA;font-weight:500;">COVALENCE</div>
    </div>
    <div style="padding:28px;">
      <div style="font-family:monospace;font-size:10px;letter-spacing:0.12em;color:#57534E;margin-bottom:8px;">${esc(institution).toUpperCase()} · REMINDERS</div>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#1A1814;margin:0 0 16px;line-height:1.15;">
        ${items.length ? `${esc(name)}, ${items.length} case${items.length === 1 ? ' needs' : 's need'} you.` : `${esc(name)}, nothing is due on your cases.`}
      </h1>
      ${items.length ? `<table style="width:100%;border-collapse:collapse;border:1px solid #D4CCBC;margin-bottom:16px;"><tbody>${rows}</tbody></table>${more}` : ''}
      <a href="${esc(appUrl)}" style="display:inline-block;background:#1A1814;color:#F5F1EA;font-family:monospace;font-size:10px;letter-spacing:0.12em;padding:12px 24px;text-decoration:none;margin:8px 0 20px;">OPEN COVALENCE</a>
      <p style="font-family:monospace;font-size:10px;color:#57534E;line-height:1.6;margin:0;">
        Sent because your institution turned on daily reminders (Settings → Workflow). Clocks and targets are set there by your admins.
      </p>
    </div>
  </div>
</body></html>`
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supaUrl    = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey  = process.env.RESEND_API_KEY
  const FROM    = process.env.REMINDER_FROM_EMAIL || process.env.DUO_FROM_EMAIL || 'Covalence <onboarding@resend.dev>'
  const APP_URL = process.env.VITE_APP_URL || 'https://covalence.vercel.app'
  if (!supaUrl || !anonKey || !serviceKey || !resendKey) return res.status(500).json({ error: 'Reminder email is not configured' })

  const { remindersByPerson, WORKFLOW_DEFAULTS } = await import('../src/clocks.mjs')

  // Service-role reads (no RLS): settings, cases and members of one institution
  const svc = (path) => fetch(`${supaUrl}/rest/v1/${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })
    .then(async r => { if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`); return r.json() })
  const inst = id => encodeURIComponent(id)
  const loadInstitution = async (id) => {
    const [kv, rows, members, insts] = await Promise.all([
      svc(`workspace_kv?institution_id=eq.${inst(id)}&key=eq.cov_settings&select=value`),
      svc(`cov_cases?institution_id=eq.${inst(id)}&select=data`),
      svc(`memberships?institution_id=eq.${inst(id)}&select=email,display_name,role`),
      svc(`institutions?id=eq.${inst(id)}&select=name`),
    ])
    let settings = {}
    try { settings = JSON.parse(kv[0]?.value || '{}') || {} } catch {}
    return {
      settings: { ...WORKFLOW_DEFAULTS, ...settings },
      cases: rows.map(r => r.data).filter(c => c && c.id && !/^(COV|MCH)-DEMO/.test(c.id)),
      members: new Map(members.filter(m => m.email).map(m => [m.email.toLowerCase(), m])),
      name: insts[0]?.name || settings.duoInstitutionName || 'Your institution',
    }
  }
  const send = (to, subject, html) => fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  }).then(async r => { if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`) })
  // Recorded in the institution's audit log (audit_add is service-role only)
  const audit = (institutionId, detail) => fetch(`${supaUrl}/rest/v1/rpc/audit_add`, {
    method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_inst: institutionId, p_action: 'reminders.sent', p_entity: 'workspace', p_entity_id: '', p_detail: detail }),
  }).catch(() => {})
  const subject = items => items.length ? `${items.length} case${items.length === 1 ? ' needs' : 's need'} you today — Covalence` : 'Your Covalence reminders'

  try {
    // ── Manual: the signed-in user's own reminders ──
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
      if (!checkRateLimit(ip)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests — try again in a minute' }) }
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!token) return res.status(401).json({ error: 'Sign in first' })
      const mr = await fetch(`${supaUrl}/rest/v1/rpc/my_membership`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
      })
      if (mr.status === 401) return res.status(401).json({ error: 'Session expired — sign in again' })
      const m = mr.ok ? (await mr.json())[0] : null
      if (!m?.institution_id || !m.email) return res.status(403).json({ error: 'You’re not a member of an institution' })
      const w = await loadInstitution(m.institution_id)
      const me = m.email.toLowerCase()
      const items = remindersByPerson(w.cases, w.settings).get(me) || []
      await send(me, subject(items), emailHtml({ name: m.display_name || me, institution: w.name, items, appUrl: APP_URL }))
      await audit(m.institution_id, { recipients: 1, items: items.length, trigger: 'manual' })
      return res.status(200).json({ to: me, items: items.length })
    }

    // ── Daily: Vercel Cron ──
    const secret = process.env.CRON_SECRET
    if (!secret) return res.status(500).json({ error: 'CRON_SECRET is not configured' })
    if ((req.headers.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })
    const kvs = await svc('workspace_kv?key=eq.cov_settings&select=institution_id,value')
    const on = kvs.filter(r => { try { return JSON.parse(r.value || '{}').emailReminders === true } catch { return false } })
    const report = []
    for (const r of on) {
      const w = await loadInstitution(r.institution_id)
      let sent = 0, items = 0, failed = 0
      for (const [email, list] of remindersByPerson(w.cases, w.settings)) {
        const member = w.members.get(email)
        if (!member || member.role === 'auditor' || !list.length) continue
        try {
          await send(email, subject(list), emailHtml({ name: member.display_name || email, institution: w.name, items: list, appUrl: APP_URL }))
          sent++; items += list.length
        } catch (e) { failed++; console.error('reminders: send failed', r.institution_id, e.message) }
      }
      if (sent) await audit(r.institution_id, { recipients: sent, items, trigger: 'daily' })
      report.push({ institution: r.institution_id, sent, failed })
    }
    return res.status(200).json({ institutions: on.length, report })
  } catch (e) {
    console.error('reminders:', e.message)
    return res.status(500).json({ error: 'Couldn’t build the reminders' })
  }
}

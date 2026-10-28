// Vercel serverless function — POST /api/intake → an institution's systems send data straight to Covalence
//   Authorization: Bearer cvl_…   (an API key from Settings → Connections)
//   { "transactions": [...], "events": [...], "alerts": [...] }   up to 1000 of each
// Transactions and account events are stored, then the fraud rules (→ 001 Triage
// → Alerts) and AML rules (→ 005 Licit → Alerts) run at once for the customers
// involved, so an alert exists seconds after the payment. "alerts" are alerts
// raised by the institution's own fraud engine; they land in Triage as they are.
// Rules: src/monitoring.mjs (the same code the file import uses).
// Security hardening:
//   • Keys are looked up by SHA-256 hash; revoked keys are refused; each key is tied to one institution
//   • Every row is validated and trimmed; ≤ 1000 per type, ≤ 2 MB per request
//   • Per-key rate limit: 120 requests / 60 s; no CORS (server-to-server); each call is audited
// New alerts notify Slack and the institution's endpoint (api/_webhook.js), if set up.

const crypto = require('crypto')
const wh = require('./_webhook.js')
const RATE_LIMIT_MAX = 120, RATE_LIMIT_WINDOW_MS = 60 * 1000, MAX = 1000, MAX_BYTES = 2 * 1024 * 1024
const DAY = 86400000
const _rate = {}
function limited(k) {
  const now = Date.now(), e = _rate[k]
  if (!e || now > e.resetAt) { _rate[k] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return false }
  if (e.count >= RATE_LIMIT_MAX) return true
  e.count++; return false
}
const str = (v, n) => String(v ?? '').trim().slice(0, n)
const isTs = v => !isNaN(new Date(v).getTime())

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST transactions, events or alerts' })
  if (parseInt(req.headers['content-length'] || '0', 10) > MAX_BYTES) return res.status(413).json({ error: 'Request larger than 2 MB — send fewer rows per call' })
  const supa = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supa || !svc) return res.status(500).json({ error: 'Intake is not configured' })
  const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!/^cvl_[a-f0-9]{48}$/.test(key)) return res.status(401).json({ error: 'Send your API key as: Authorization: Bearer cvl_…' })
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  if (limited(hash)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Rate limit: 120 requests a minute per key' }) }

  const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }
  const rest = async (path, opts = {}) => {
    const r = await fetch(`${supa}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const t = await r.text(); return t ? JSON.parse(t) : null
  }
  const keyRow = (await rest(`intake_keys?key_hash=eq.${hash}&revoked_at=is.null&select=id,institution_id,prefix`))?.[0]
  if (!keyRow) return res.status(401).json({ error: 'Unknown or revoked API key' })
  const inst = keyRow.institution_id

  const m = await import('../src/monitoring.mjs')
  const body = req.body || {}
  const segment = body.segment === 'ce' ? 'ce' : 'fi'   // 'ce' when the sender is a crypto exchange
  const inTx = Array.isArray(body.transactions) ? body.transactions : [], inEv = Array.isArray(body.events) ? body.events : [], inAl = Array.isArray(body.alerts) ? body.alerts : []
  if (inTx.length > MAX || inEv.length > MAX || inAl.length > MAX) return res.status(400).json({ error: `At most ${MAX} of each per request` })
  if (!inTx.length && !inEv.length && !inAl.length) return res.status(400).json({ error: 'Nothing to store: send transactions, events or alerts' })

  // ── Validate ──
  const problems = []
  const batch = 'API-' + new Date().toISOString().slice(0, 10)
  const txs = []
  inTx.forEach((t, i) => {
    const amount = Number(t?.amount)
    if (!t?.id || !t?.customerId || !isTs(t?.ts) || !isFinite(amount)) return problems.push({ type: 'transaction', index: i, error: 'id, customerId, ts (ISO 8601) and amount are required' })
    txs.push({ institution_id: inst, id: str(t.id, 120), customer_id: str(t.customerId, 120), customer_name: str(t.customerName, 120), ts: new Date(t.ts).toISOString(),
      amount: Math.abs(amount), currency: str(t.currency || 'USD', 3).toUpperCase(), direction: m.normDirection(t.direction, amount),
      channel: m.normChannel(t.channel, `${t.description || ''} ${t.counterparty || ''}`), counterparty: str(t.counterparty, 160), counterparty_account: str(t.counterpartyAccount, 80),
      country: m.normCountry(t.country), wallet: str(t.wallet, 100), description: str(t.description, 300), batch })
  })
  const evs = []
  inEv.forEach((e, i) => {
    if (!e?.id || !e?.customerId || !isTs(e?.ts) || !e?.type) return problems.push({ type: 'event', index: i, error: 'id, customerId, ts and type are required' })
    evs.push({ institution_id: inst, id: str(e.id, 120), customer_id: str(e.customerId, 120), ts: new Date(e.ts).toISOString(), type: m.normEventType(e.type),
      raw_type: str(e.type, 80), device: str(e.device, 120), location: str(e.location, 80), detail: str(e.detail, 200), batch })
  })
  const now = new Date()
  const ext = []
  inAl.forEach((a, i) => {
    if (!a?.id || !a?.customerId) return problems.push({ type: 'alert', index: i, error: 'id and customerId are required' })
    const id = 'EXT-' + crypto.createHash('sha256').update(inst + '|' + a.id).digest('hex').slice(0, 12).toUpperCase()
    ext.push({ id, kind: 'fraud', segment, rule: 'external', label: str(a.title || 'Alert from a connected fraud system', 120), customerId: str(a.customerId, 120), customerName: str(a.customerName, 120),
      detail: str(a.reason || a.description || '', 400), severity: ['high', 'medium', 'low'].includes(a.severity) ? a.severity : 'medium', score: 2, source: str(a.source || keyRow.prefix, 80),
      externalId: str(a.id, 120), txIds: Array.isArray(a.transactionIds) ? a.transactionIds.slice(0, 50).map(x => str(x, 120)) : [], total: Number(a.amount) || 0,
      from: isTs(a.ts) ? new Date(a.ts).toISOString() : now.toISOString(), to: isTs(a.ts) ? new Date(a.ts).toISOString() : now.toISOString(),
      action: a.recommendedAction === 'block_card' || a.recommendedAction === 'hold_payment' ? a.recommendedAction : null, createdAt: now.toISOString(), status: 'open' })
  })

  try {
    // ── Store (duplicates are ignored) ──
    const ins = async (table, rows) => rows.length ? (await rest(`${table}?select=id`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows) })) || [] : []
    const newTx = await ins('tm_transactions', txs), newEv = await ins('tm_events', evs)

    // ── Rules, for the customers involved ──
    const customers = [...new Set([...txs.map(t => t.customer_id), ...evs.map(e => e.customer_id)])]
    const since = new Date(now.getTime() - 120 * DAY).toISOString()
    const inList = list => `in.(${list.map(c => `"${c.replace(/"/g, '')}"`).join(',')})`
    let history = [], events = []
    for (let i = 0; i < customers.length; i += 100) {
      const chunk = customers.slice(i, i + 100)
      history.push(...(await rest(`tm_transactions?institution_id=eq.${inst}&customer_id=${encodeURIComponent(inList(chunk))}&ts=gte.${encodeURIComponent(since)}&order=ts.asc&limit=50000&select=id,customer_id,customer_name,ts,amount,currency,direction,channel,counterparty,counterparty_account,country,wallet,description`)) || [])
      events.push(...(await rest(`tm_events?institution_id=eq.${inst}&customer_id=${encodeURIComponent(inList(chunk))}&ts=gte.${encodeURIComponent(since)}&order=ts.asc&limit=20000&select=id,customer_id,ts,type,device,location`)) || [])
    }
    history = history.map(t => ({ id: t.id, customerId: t.customer_id, customerName: t.customer_name, ts: t.ts, amount: Number(t.amount), currency: t.currency, direction: t.direction,
      channel: t.channel, counterparty: t.counterparty, counterpartyAccount: t.counterparty_account, country: t.country, wallet: t.wallet, description: t.description }))
    events = events.map(e => ({ id: e.id, customerId: e.customer_id, ts: e.ts, type: e.type, device: e.device, location: e.location }))
    // The institution's rule thresholds (Settings → Financial crime)
    const kv = await rest(`workspace_kv?institution_id=eq.${inst}&key=eq.cov_settings&select=value`).catch(() => [])
    let s = {}; try { s = JSON.parse(kv?.[0]?.value || '{}') } catch {}
    const freshIds = [...newTx.map(t => t.id), ...newEv.map(e => e.id)]
    const raised = [...m.evaluateFraud(history, events, freshIds, s, [], now, { segment }), ...m.evaluate(history.filter(t => new Date(t.ts) > now - 31 * DAY), newTx.map(t => t.id), s, now, { segment }), ...ext]
    const stored = raised.length ? await ins('tm_alerts', raised.map(a => ({ institution_id: inst, id: a.id, data: a, status: 'open' }))) : []

    // Tell people: Slack, and a signed alert.created event to the institution's endpoint (Settings → Connections)
    if (stored.length) {
      const ep = (await rest(`action_endpoints?institution_id=eq.${inst}&select=url,secret,slack_url,notify_min`).catch(() => []))?.[0]
      if (ep) {
        const ids = new Set(stored.map(a => a.id)), fresh = raised.filter(a => ids.has(a.id))
        const loud = fresh.filter(a => wh.meets(a.severity, ep.notify_min))
        const appUrl = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
        await Promise.allSettled([
          ep.slack_url && loud.length ? wh.notifySlack(ep.slack_url, loud, appUrl) : null,
          ep.url ? wh.sendEvent(ep, 'alert.created', { alerts: fresh.map(a => ({ id: a.id, kind: a.kind, segment: a.segment || 'fi', rule: a.rule, label: a.label, severity: a.severity,
            customerId: a.customerId, customerName: a.customerName || '', amount: a.total || 0, recommendedAction: a.action || null })) }) : null,
        ])
      }
    }

    await rest(`intake_keys?id=eq.${keyRow.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: now.toISOString() }) }).catch(() => {})
    await rest('rpc/audit_add', { method: 'POST', body: JSON.stringify({ p_inst: inst, p_action: 'intake.received', p_entity: 'workspace', p_entity_id: keyRow.prefix,
      p_detail: { transactions: newTx.length, events: newEv.length, alerts: stored.length, problems: problems.length } }) }).catch(() => {})

    return res.status(200).json({
      stored: { transactions: newTx.length, events: newEv.length },
      duplicates: { transactions: txs.length - newTx.length, events: evs.length - newEv.length },
      alerts: stored.map(a => a.id), problems,
    })
  } catch (e) {
    console.error('intake:', e.message)
    return res.status(500).json({ error: 'Couldn’t store the data — try again' })
  }
}

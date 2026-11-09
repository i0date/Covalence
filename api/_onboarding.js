// /api/onboarding → Onboard with Covalence (served by api/claims.js: the free plan allows 12 functions)
// From the bank's systems, with an API key from Settings → Connections:
//   POST { "link": { "kind": "person" | "business", "reference"?, "prefill"?, "expiresInHours"? } }
//        → { id, url, expiresAt }: the hosted onboarding form (/onboard/<token>) for the bank's app or website
//          to open. Works once, 72 hours by default, at most 7 days
//   POST { "application": { … } }        an application from the bank's own app (src/onboarding.mjs)
//   POST { "idv": { "applicationId" | "reference", "result": "passed" | "failed" | "review", "provider"?, "providerReference"? } }
//        → the identity provider's result, from the bank's systems
//   GET  ?reference=… | ?id=ONB-…         → where the application is now
// From the customer, with only the link (the hosted form at /onboard/<token>):
//   GET  ?form=cvo_…                      → the bank's name and logo, the kind of application, the choices
//   POST { "form": "cvo_…", "application": { … } }
// Each application is checked (sanctions, PEP declaration, age, address, email, where it was
// sent from, details reused on other applications, a business's owners and industry),
// rated, stored (supabase_onboarding.sql) and audited, and the bank's endpoint is sent
// onboarding.received. Analysts decide in 005 Licit → Onboarding; the decision goes back as
// onboarding.decided (api/action.js).
// Security hardening:
//   • ID numbers (SSN, ITIN, EIN) are never stored: they're sent straight to the bank's endpoint as a
//     signed onboarding.identity event, and only the last four digits are kept. No endpoint, no links
//   • Keys are looked up by SHA-256 hash; revoked keys are refused; each key is tied to one institution
//   • A link token is 24 random bytes, stored only as its SHA-256 hash; it works once and expires
//   • Every field is validated and trimmed; ≤ 64 KB per request; per-key and per-address rate limits
//   • Duplicate checks compare SHA-256 hashes of the email, phone, address and IP, never the values

const crypto = require('crypto')
const wh = require('./_webhook.js')
const RATE_LIMIT_MAX = 120, RATE_LIMIT_WINDOW_MS = 60 * 1000, FORM_MAX = 20, MAX_BYTES = 64 * 1024
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
const sha = t => crypto.createHash('sha256').update(t).digest('hex')
const _rate = {}
function limited(k, max = RATE_LIMIT_MAX) {
  const now = Date.now(), e = _rate[k]
  if (!e || now > e.resetAt) { _rate[k] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return false }
  if (e.count >= max) return true
  e.count++; return false
}

module.exports = async function onboarding(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const supa = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supa || !svc) return res.status(500).json({ error: 'Onboarding is not configured' })
  const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }
  const rest = async (path, opts = {}) => {
    const r = await fetch(`${supa}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const t = await r.text(); return t ? JSON.parse(t) : null
  }
  const audit = (inst, action, id, detail) => rest('rpc/audit_add', { method: 'POST', body: JSON.stringify({ p_inst: inst, p_action: action, p_entity: 'onboarding', p_entity_id: id, p_detail: detail }) }).catch(() => {})
  const endpointFor = async inst => (await rest(`action_endpoints?institution_id=eq.${inst}&select=url,secret`).catch(() => []))?.[0]
  const ob = await import('../src/onboarding.mjs')
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ipCountry = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2)
  if (parseInt(req.headers['content-length'] || '0', 10) > MAX_BYTES) return res.status(413).json({ error: 'Request larger than 64 KB' })

  // Where an application is, for the bank (no personal details)
  const publicStatus = r => ({ id: r.id, reference: r.reference || null, kind: r.kind, status: r.status, label: ob.STATUSES[r.status], rating: r.rating,
    idv: r.idv?.result || null, decidedAt: ['approved', 'declined'].includes(r.status) ? (r.history || []).at(-1)?.at || null : null, createdAt: r.created_at, updatedAt: r.updated_at })

  // Check, rate and store one application. ids go to the bank's endpoint and nowhere else.
  const storeApplication = async (inst, body, { channel, by, link = null }) => {
    const now = new Date()
    const { app, ids, errors } = ob.normaliseApplication(body, now)
    if (errors.length) return { code: 400, body: { error: 'The application has problems', problems: errors } }
    if (app.reference) {
      const cur = (await rest(`onboarding_apps?institution_id=eq.${inst}&reference=eq.${encodeURIComponent(app.reference)}&select=*`))?.[0]
      if (cur) return { code: 200, body: { ...publicStatus(cur), duplicate: true } }
    }
    const ep = await endpointFor(inst)
    if (ids.length && !ep?.url) return { code: 409, body: { error: 'not_connected', message: 'Connect your endpoint in Settings → Connections first: ID numbers go straight to it and are never stored in Covalence' } }
    const id = ob.appIdFrom(sha(`${inst}|${app.reference}|${now.toISOString()}|${crypto.randomBytes(8).toString('hex')}`))
    // Details seen on other applications in the last 90 days, compared as hashes
    const people = [app.applicant, ...(app.owners || [])]
    const keyOf = (f, v) => v ? sha(`${inst}|${f}|${String(v).toLowerCase().replace(/[^a-z0-9@.]/g, '')}`) : null
    const keys = new Map()
    people.forEach(p => {
      if (p.email) keys.set(keyOf('email', p.email), 'Email')
      if (p.phone && p.phone.replace(/\D/g, '').length >= 7) keys.set(keyOf('phone', p.phone.replace(/\D/g, '').slice(-10)), 'Phone')
      if (p.address?.line1) keys.set(keyOf('address', `${p.address.line1}|${p.address.postal}`), 'Address')
    })
    if (ip) keys.set(keyOf('ip', ip), 'Network address (IP)')
    const matchKeys = [...keys.keys()].filter(Boolean)
    const since = new Date(now - 90 * 86400000).toISOString()
    const others = matchKeys.length ? await rest(`onboarding_apps?institution_id=eq.${inst}&match_keys=ov.{${matchKeys.join(',')}}&created_at=gte.${encodeURIComponent(since)}&select=id,applicant,match_keys&limit=20`).catch(() => []) : []
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
    const duplicates = (others || []).flatMap(o => (o.match_keys || []).filter(k => keys.has(k)).map(k => ({ field: keys.get(k), id: o.id, sameName: norm(o.applicant?.applicant?.name) === norm(app.applicant?.name) })))
    // Sanctions: Covalence's own screening (api/sanctions.js)
    let sanctions = null
    try {
      const r = await fetch(`${PUBLIC_URL}/api/sanctions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjects: ob.subjectsOf(app).slice(0, 20) }), signal: AbortSignal.timeout(25000) })
      if (r.ok) { const j = await r.json(); sanctions = { results: j.results || [], list: j.list?.fetchedAt || null } }
    } catch (e) { console.error('onboarding sanctions:', e.message) }
    const checks = ob.runChecks(app, { sanctions, duplicates, ipCountry: channel === 'form' ? ipCountry : '', now })
    // ID numbers to the bank, now; if they don't arrive, the analyst is told to ask again
    if (ids.length) {
      const r = await wh.sendEvent(ep, 'onboarding.identity', { id, reference: app.reference || null, kind: app.kind, identifiers: ids }).catch(() => ({ ok: false }))
      checks.push({ key: 'id_numbers', label: 'ID numbers sent to your systems', state: r?.ok ? 'pass' : 'fail', detail: r?.ok ? `${ids.length} sent; only the last four digits are kept here` : 'They didn’t arrive. Ask the customer for them again in your own systems' })
    }
    const { rating, reasons, status, recommend } = ob.rate(app, checks)
    const row = { institution_id: inst, id, reference: app.reference, kind: app.kind, channel, applicant: app, checks, rating, reasons, recommend, status, idv: null,
      match_keys: matchKeys, history: [{ status, at: now.toISOString(), by: channel === 'form' ? 'The customer' : `Your systems (${by})`, note: link ? `Through link ${link}` : 'Received' }] }
    const stored = await rest('onboarding_apps?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) })
    await audit(inst, 'onboarding.received', id, { kind: app.kind, channel, rating, status, reference: app.reference || null, checks: checks.filter(c => c.state !== 'pass').map(c => c.key) })
    if (ep?.url) await wh.sendEvent(ep, 'onboarding.received', publicStatus(stored[0])).catch(() => {})
    return { code: 201, body: { ...publicStatus(stored[0]), duplicate: false } }
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()

  // ── The hosted form: the customer, with only the link ──
  const formToken = String(req.query?.form || (req.method === 'POST' && req.body?.form) || '')
  if (formToken && !token) {
    if (limited('onb-form|' + (ip || 'ip'), FORM_MAX)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many tries — wait a minute and try again' }) }
    try {
      const row = ob.TOKEN_RE.test(formToken) ? (await rest(`onboarding_links?token_hash=eq.${sha(formToken)}&select=*`).catch(() => []))?.[0] : null
      const problem = ob.linkProblem(row)
      const brandRow = row ? (await rest(`claim_form?institution_id=eq.${row.institution_id}&select=*`).catch(() => []))?.[0] : null
      const instName = row ? (await rest(`institutions?id=eq.${row.institution_id}&select=name`).catch(() => []))?.[0]?.name : ''
      const brand = row ? { name: (brandRow?.display_name || instName || '').slice(0, 120), logo: /^https:\/\//.test(brandRow?.logo_url || '') ? brandRow.logo_url : '', phone: brandRow?.support_phone || '' } : null
      if (problem) return res.status(row ? 410 : 404).json({ error: problem, brand })
      if (req.method === 'GET') {
        if (!row.opened_at) await rest(`onboarding_links?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ opened_at: new Date().toISOString() }) }).catch(() => {})
        return res.status(200).json({ brand, kind: row.kind, prefill: row.prefill || {}, expiresAt: row.expires_at })
      }
      if (req.method !== 'POST') return res.status(405).json({ error: 'Not allowed' })
      const took = await rest(`onboarding_links?id=eq.${row.id}&used_at=is.null&revoked_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: new Date().toISOString() }) })
      if (!took?.length) return res.status(410).json({ error: ob.linkProblem({ ...row, used_at: true }), brand })
      let out
      try { out = await storeApplication(row.institution_id, { ...(req.body?.application || {}), kind: row.kind, reference: row.reference }, { channel: 'form', by: 'form', link: row.id }) }
      catch (e) { console.error('onboarding form:', e.message); out = { code: 500, body: { error: 'We couldn’t send your application — try again' } } }
      if (out.code >= 300 && out.code !== 409) {   // nothing stored: the link can be used again
        await rest(`onboarding_links?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: null }) }).catch(() => {})
        return res.status(out.code).json({ error: out.code === 400 ? 'Some answers are missing — check the form and try again' : out.body.error, problems: out.body.problems })
      }
      if (out.code === 409) {
        await rest(`onboarding_links?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: null }) }).catch(() => {})
        return res.status(503).json({ error: `${brand.name} can’t take applications here right now. Please try again later or contact them directly.` })
      }
      await rest(`onboarding_links?id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ app_id: out.body.id }) }).catch(() => {})
      await audit(row.institution_id, 'onboarding.link_used', row.id, { application: out.body.id })
      return res.status(201).json({ id: out.body.id, brand })
    } catch (e) {
      console.error('onboarding form:', e.message)
      return res.status(500).json({ error: 'Something went wrong — try again' })
    }
  }

  // ── From the bank's systems ──
  if (!/^cvl_[a-f0-9]{48}$/.test(token)) return res.status(401).json({ error: 'Send your API key as: Authorization: Bearer cvl_…' })
  const hash = sha(token)
  if (limited(hash)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Rate limit: 120 requests a minute per key' }) }
  const keyRow = (await rest(`intake_keys?key_hash=eq.${hash}&revoked_at=is.null&select=id,institution_id,prefix`).catch(() => []))?.[0]
  if (!keyRow) return res.status(401).json({ error: 'Unknown or revoked API key' })
  const inst = keyRow.institution_id
  const touchKey = () => rest(`intake_keys?id=eq.${keyRow.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) }).catch(() => {})
  const findApp = async (id, reference) => {
    const filter = id ? `id=eq.${encodeURIComponent(String(id).slice(0, 20))}` : reference ? `reference=eq.${encodeURIComponent(String(reference).slice(0, 120))}` : null
    return filter ? (await rest(`onboarding_apps?institution_id=eq.${inst}&${filter}&select=*`))?.[0] || null : null
  }

  try {
    if (req.method === 'GET') {
      const q = req.query || {}
      if (!q.id && !q.reference) return res.status(400).json({ error: 'Ask for ?reference=<your reference> or ?id=ONB-…' })
      const row = await findApp(q.id, q.reference)
      if (!row) return res.status(404).json({ error: 'No application with that reference' })
      return res.status(200).json(publicStatus(row))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST a link, an application or an identity result' })
    const b = req.body || {}

    if (b.link) {
      const { link, errors } = ob.normaliseLink(b.link)
      if (errors.length) return res.status(400).json({ error: 'The link has problems', problems: errors })
      const ep = await endpointFor(inst)
      if (!ep?.url) return res.status(409).json({ error: 'not_connected', message: 'Connect your endpoint in Settings → Connections first: ID numbers go straight to it and are never stored in Covalence' })
      const tok = 'cvo_' + crypto.randomBytes(24).toString('hex'), id = ob.linkIdFrom(crypto.randomBytes(4).toString('hex'))
      await rest('onboarding_links', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ id, token_hash: sha(tok), institution_id: inst,
        reference: link.reference, kind: link.kind, prefill: link.prefill, created_by: keyRow.prefix, expires_at: link.expiresAt }]) })
      await audit(inst, 'onboarding.link_created', id, { kind: link.kind, reference: link.reference || null, expires: link.expiresAt })
      await touchKey()
      return res.status(201).json({ id, url: ob.linkUrl(PUBLIC_URL, tok), expiresAt: link.expiresAt })
    }

    if (b.idv) {
      const v = b.idv, result = ['passed', 'failed', 'review'].includes(v.result) ? v.result : null
      if (!result) return res.status(400).json({ error: 'idv.result must be passed, failed or review' })
      const row = await findApp(v.applicationId, v.reference)
      if (!row) return res.status(404).json({ error: 'No application with that id or reference' })
      if (['approved', 'declined'].includes(row.status)) return res.status(409).json({ error: `Already ${row.status}`, ...publicStatus(row) })
      const idv = { result, provider: String(v.provider || '').slice(0, 60), reference: String(v.providerReference || '').slice(0, 120), at: new Date().toISOString() }
      const checks = ob.runChecks(row.applicant, { idv, now: new Date() }).filter(c => c.key === 'idv')
      const merged = [...checks, ...(row.checks || []).filter(c => c.key !== 'idv')]
      const r = ob.rate(row.applicant, merged)
      const status = row.status === 'on_hold' ? 'on_hold' : row.status === 'more_info' ? 'more_info' : r.status
      const upd = await rest(`onboarding_apps?institution_id=eq.${inst}&id=eq.${row.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
        idv, checks: merged, rating: r.rating, reasons: r.reasons, recommend: r.recommend, status, updated_at: idv.at,
        history: [...(row.history || []), { status, at: idv.at, by: `Your systems (${keyRow.prefix})`, note: `Identity check ${result}${idv.provider ? ` (${idv.provider})` : ''}` }] }) })
      await audit(inst, 'onboarding.idv', row.id, { result, provider: idv.provider || null })
      await touchKey()
      return res.status(200).json(publicStatus(upd[0]))
    }

    if (b.application) {
      const out = await storeApplication(inst, b.application, { channel: 'api', by: keyRow.prefix })
      await touchKey()
      return res.status(out.code).json(out.body)
    }
    return res.status(400).json({ error: 'Send { link }, { application } or { idv }' })
  } catch (e) {
    console.error('onboarding:', e.message)
    return res.status(500).json({ error: 'Couldn’t do that — try again' })
  }
}

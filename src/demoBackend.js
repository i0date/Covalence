// ═══════════════════════════════════════════════════════════════════════════════
// DEMO BACKEND — the full product for visitors who haven't signed in
// ═══════════════════════════════════════════════════════════════════════════════
// Answers the same RPCs as the real database (supabase_*.sql) but keeps
// everything in this browser, on the fictional Demo Bank: a hash-chained audit
// log, a team with roles, legal holds and retention, Duo with a scripted
// counterparty, case links that get viewed and answered. Nothing here ever
// reaches Supabase; signing in switches to the real backend.
import { readCases, writeCases } from './caseStore.js'

const K = {
  audit: 'cov_demo_audit', team: 'cov_demo_team', invites: 'cov_demo_invites', holds: 'cov_demo_holds',
  retention: 'cov_demo_retention_days', purged: 'cov_demo_purged', duo: 'cov_demo_duo', links: 'cov_demo_links',
  seeded: 'cov_demo_backend', role: 'cov_demo_role', tmTx: 'cov_demo_tm_tx', tmAlerts: 'cov_demo_tm_alerts', tmEvents: 'cov_demo_tm_events', keys: 'cov_demo_intake_keys', endpoint: 'cov_demo_action_endpoint', feed: 'cov_demo_feed_at',
  sharing: 'cov_demo_sharing', shareLog: 'cov_demo_share_log', arn: 'cov_demo_arn_invites',
}
export const DEMO_INSTITUTION = 'Demo Bank'
const COUNTERPARTY = 'Harbor Credit Union'
const SEED_VERSION = '2'
const DAY = 86400000

const read  = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const visitor = () => read('cov_user', null) || { name: 'You', email: 'you@demo.bank' }

// ── Role the visitor is "viewing as" ─────────────────────────────────────────
export const demoRole = () => { try { return localStorage.getItem(K.role) || 'admin' } catch { return 'admin' } }
export const setDemoRole = r => { try { localStorage.setItem(K.role, r) } catch {}; window.dispatchEvent(new CustomEvent('cov:demo-role', { detail: r })) }
const isAdmin = () => demoRole() === 'admin'
const canConfigure = () => ['admin', 'reviewer'].includes(demoRole())
const canWrite = () => demoRole() !== 'auditor'
const need = (ok, msg) => { if (!ok) throw new Error(msg) }

// ── Audit log: same fields and the same SHA-256 chain as the database ────────
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}
const hashOf = e => sha256([e.prev_hash, 'demo-bank', e.at, e.actor_email, e.action, e.entity, e.entity_id, JSON.stringify(e.detail)].join('|'))
let chain = Promise.resolve()   // one append at a time keeps the chain linear
let queued = []                 // events waiting for the next append; a 5,000-case import is one read and one write, not 5,000
function audit(action, entity, entityId, detail, opts = {}) {
  queued.push({ at: opts.at || new Date().toISOString(), actor_email: opts.actor ?? visitor().email,
    action, entity: entity || '', entity_id: entityId || '', detail: detail || {} })
  if (queued.length > 1) return chain   // already waiting on the append below
  chain = chain.then(async () => {
    const batch = queued; queued = []
    const log = read(K.audit, [])
    for (const ev of batch) {
      const last = log[log.length - 1]
      const e = { id: (last ? last.id : 0) + 1, ...ev, prev_hash: last ? last.hash : '' }
      e.hash = await hashOf(e)
      log.push(e)
    }
    write(K.audit, log)
  }).catch(() => {})
  return chain
}
export const demoAudit = audit

// Case events from the shared case store (shared.jsx stampCaseChanges)
export function recordDemoCaseEvent(caseId, ev) {
  // after seeding, so a fresh seed doesn't wipe the event
  ensureDemoSeeded().then(() => {
    if (ev.event === 'created') audit('case.created', 'case', caseId, { status: ev.status })
    else if (ev.event === 'status') audit('case.status_changed', 'case', caseId, { from: ev.from, to: ev.status })
  })
}

// ── Seed: a believable history for Demo Bank ─────────────────────────────────
const TEAM = [
  { key: 'maria',  display_name: 'Maria Okafor',  email: 'm.okafor@demo.bank',  role: 'admin',    joined: 120 },
  { key: 'james',  display_name: 'James Chen',    email: 'j.chen@demo.bank',    role: 'reviewer', joined: 110 },
  { key: 'priya',  display_name: 'Priya Raman',   email: 'p.raman@demo.bank',   role: 'analyst',  joined: 95 },
  { key: 'daniel', display_name: 'Daniel Ruiz',   email: 'd.ruiz@demo.bank',    role: 'analyst',  joined: 60 },
  { key: 'sarah',  display_name: 'Sarah Lindqvist', email: 's.lindqvist@demo.bank', role: 'auditor', joined: 30 },
]
let seeding = null
export function ensureDemoSeeded() {
  if (localStorage.getItem(K.seeded) === SEED_VERSION) return Promise.resolve()
  if (seeding) return seeding
  seeding = (async () => {
    const ago = d => new Date(Date.now() - d * DAY).toISOString()
    write(K.team, TEAM.map((m, i) => ({ user_id: `demo-${m.key}`, display_name: m.display_name, email: m.email, role: m.role, created_at: ago(m.joined), order: i })))
    write(K.invites, [{ code: 'demoinvite01', email: 'new.analyst@demo.bank', role: 'analyst', created_at: ago(2), expires_at: new Date(Date.now() + 12 * DAY).toISOString() }])
    write(K.holds, [{ case_id: 'COV-DEMO12', reason: 'Customer filed suit — preserve all records', set_at: ago(12), set_by_email: 'j.chen@demo.bank' }])
    write(K.retention, 1825); write(K.purged, []); write(K.audit, [])
    write(K.duo, seedDuo()); write(K.links, {})
    try {
      const mine = JSON.parse(localStorage.getItem('duo_my_sessions') || '[]').filter(s => s.id !== 'HCU7Q2')
      localStorage.setItem('duo_my_sessions', JSON.stringify([{ id: 'HCU7Q2', role: 'a', myInstitution: DEMO_INSTITUTION, joinedAt: ago(1), lastStatus: 'in_discussion', caseId: 'COV-DEMO13' }, ...mine]))
    } catch {}

    // History, oldest first, so the hash chain reads in order
    const events = []
    TEAM.forEach(m => events.push({ at: ago(m.joined), actor: 'm.okafor@demo.bank', a: 'member.joined', e: 'member', id: m.email, d: { role: m.role } }))
    events.push({ at: ago(45), actor: 'm.okafor@demo.bank', a: 'settings.changed', e: 'settings', id: 'cov_settings', d: { fraudWindowDays: { from: 90, to: 120 } } })
    events.push({ at: ago(40), actor: 'm.okafor@demo.bank', a: 'retention.policy_changed', e: 'retention', id: '', d: { from_days: 2555, to_days: 1825 } })
    const cases = readCases()
    const actors = ['p.raman@demo.bank', 'd.ruiz@demo.bank', 'j.chen@demo.bank']
    cases.filter(c => /^(COV|MCH)-DEMO/.test(c.id)).forEach((c, i) => (c.history || []).forEach(h => events.push({
      at: h.ts, actor: actors[i % actors.length], a: h.event === 'created' ? 'case.created' : 'case.status_changed', e: 'case', id: c.id,
      d: h.event === 'created' ? { status: h.status } : { from: h.from, to: h.status } })))
    events.push({ at: ago(12), actor: 'j.chen@demo.bank', a: 'case.legal_hold_on', e: 'case', id: 'COV-DEMO12', d: { reason: 'Customer filed suit — preserve all records' } })
    events.push({ at: ago(5), actor: 'p.raman@demo.bank', a: 'evidence.uploaded', e: 'case', id: 'COV-DEMO08', d: { name: 'hotel-folio.pdf' } })
    events.push({ at: ago(3), actor: 's.lindqvist@demo.bank', a: 'case.viewed', e: 'case', id: 'COV-DEMO12', d: {} })
    events.push({ at: ago(2), actor: 'm.okafor@demo.bank', a: 'invite.created', e: 'invite', id: 'new.analyst@demo.bank', d: { role: 'analyst' } })
    events.push({ at: ago(1), actor: 'd.ruiz@demo.bank', a: 'duo.created', e: 'duo', id: 'HCU7Q2', d: { case: 'COV-DEMO13' } })
    events.push({ at: ago(1), actor: '', a: 'duo.joined', e: 'duo', id: 'HCU7Q2', d: { by: COUNTERPARTY } })
    events.filter(x => x.at).sort((x, y) => x.at.localeCompare(y.at)).forEach(x => audit(x.a, x.e, x.id, x.d, { at: x.at, actor: x.actor }))
    await chain
    localStorage.setItem(K.seeded, SEED_VERSION)
  })().finally(() => { seeding = null })
  return seeding
}

export function clearDemoBackend() {
  const demoSessions = new Set(Object.keys(read(K.duo, {})))
  Object.values(K).forEach(k => { if (k !== K.role) try { localStorage.removeItem(k) } catch {} })
  try { localStorage.setItem('duo_my_sessions', JSON.stringify(JSON.parse(localStorage.getItem('duo_my_sessions') || '[]').filter(s => !demoSessions.has(s.id) && s.id !== 'HCU7Q2'))) } catch {}
}

// ── Duo: a scripted counterparty ─────────────────────────────────────────────
const HARBOR_LINES = [
  'We see the incoming transfer on our side — the beneficiary account was opened 9 days ago with thin KYC. Checking balance now.',
  'Balance is still there: roughly 3,900 of the 4,200. We have placed a 10-day hold pending your recall request.',
  'Recall received. Our BSA team is filing on the beneficiary; can you send the customer’s written statement for our file?',
  'Statement received, thanks. Funds will be returned via the original rail within 2 business days; we’ll confirm the reference here.',
  'Returned. Reference HCU-RTN-48211. Closing on our side — good working with you.',
]
const thread = (raw) => { try { return JSON.parse(raw || '[]') } catch { return [] } }
function seedDuo() {
  const t0 = Date.now() - DAY
  return { HCU7Q2: {
    id: 'HCU7Q2', institution_a: DEMO_INSTITUTION, institution_b: COUNTERPARTY, status: 'in_discussion',
    claim: { accountType: 'standard', caseId: 'COV-DEMO13', merchant: 'Veridian Crypto Exchange', amount: '4200 USD' },
    notes_a: JSON.stringify([{ text: 'Customer was talked into moving savings to a “safe account” by someone posing as our fraud team. 4,200 sent to your customer ending 7719.', ts: new Date(t0).toISOString() }]),
    notes_b: JSON.stringify([{ text: HARBOR_LINES[0], ts: new Date(t0 + 40 * 60000).toISOString() }, { text: HARBOR_LINES[1], ts: new Date(t0 + 95 * 60000).toISOString() }]),
    created_at: new Date(t0).toISOString(), updated_at: new Date(t0 + 95 * 60000).toISOString(), script: [], nextLine: 2,
  } }
}
// Scheduled counterparty actions are applied whenever a session is read
function settle(s) {
  const now = Date.now()
  const due = (s.script || []).filter(x => x.at <= now)
  if (!due.length) return s
  due.forEach(x => {
    if (x.type === 'join' && !s.institution_b) {
      s.institution_b = COUNTERPARTY
      audit('duo.joined', 'duo', s.id, { by: COUNTERPARTY }, { actor: '' })
    }
    if (x.type === 'say') { const f = theirField(s); s[f] = JSON.stringify([...thread(s[f]), { text: x.text, ts: new Date(x.at).toISOString() }]) }
  })
  s.script = s.script.filter(x => x.at > now)
  s.updated_at = new Date().toISOString()
  return s
}
// ── 314(b): Demo Bank and Harbor Credit Union are both registered ──────────────
const inDays = d => new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
const mySharing = () => read(K.sharing, { registered: true, expires_on: inDays(240), contact_name: 'Marcus Okafor', contact_email: 'm.okafor@demo.bank', require_both: false, updated_at: null })
const HARBOR_SHARING = () => ({ institution: COUNTERPARTY, registered: true, expires_on: inDays(150), contact_name: 'Alex Moreno', contact_email: 'bsa@harbor.cu' })
const sharingValid = x => !!(x && x.registered && x.expires_on && x.expires_on >= new Date().toISOString().slice(0, 10))
const shareLogs = () => read(K.shareLog, { HCU7Q2: [{ kind: 'purpose', at: new Date(Date.now() - DAY).toISOString(), safe_harbor: true, by: 'Diego Ruiz',
  detail: { purpose: 'Identify and report possible money laundering — proceeds of an impersonation scam moving to the receiving account' } }] })
function logShare(id, entry) {
  const all = shareLogs(); all[id] = [{ at: new Date().toISOString(), by: visitor().name || 'You', ...entry }, ...(all[id] || [])].slice(0, 100); write(K.shareLog, all)
}
// Demo Bank is side A in sessions it opened and side B in ARN sessions a merchant opened
const myField    = s => s.institution_a === DEMO_INSTITUTION ? 'notes_a' : 'notes_b'
const theirField = s => myField(s) === 'notes_a' ? 'notes_b' : 'notes_a'
const theirName  = s => s.institution_a === DEMO_INSTITUTION ? s.institution_b : s.institution_a
const isArn      = s => s.claim?.kind === 'arn'
// Merchants can't register under 314(b); an ARN session with one is dispute coordination
const theirSharing = s => theirName(s) === COUNTERPARTY ? HARBOR_SHARING() : { institution: theirName(s) || '', registered: false, expires_on: null, contact_name: '', contact_email: '' }
const covered = s => !!s.institution_b && sharingValid(mySharing()) && sharingValid(theirSharing(s))
const coordination = s => isArn(s) && ['merchant', 'acquirer'].includes(s.claim?.sides?.a) || isArn(s) && ['merchant', 'acquirer'].includes(s.claim?.sides?.b)

const sessions = () => read(K.duo, {})
const saveSession = s => { const all = sessions(); all[s.id] = s; write(K.duo, all); return s }
const publicSession = s => { const { script, nextLine, ...rest } = s; return rest }

const isMerchantSide = c => c.side ? c.side !== 'issuer' : c.mode === 'merchant'
const ARN_LINES_MERCHANT = [
  'Thanks. We’ll issue the refund today and send the reference here once it’s through.',
  'Refunded — reference BF-RF-20417. Please withdraw the chargeback on your side so we aren’t charged twice.',
]
const ARN_LINES_ISSUER = [
  'Harbor Credit Union here — we see the chargeback on our side. What evidence do you have?',
  'That delivery confirmation and 3-D Secure result answer it. We’ll accept your response rather than go to Pre-Arbitration.',
]
const arnInvites = () => read(K.arn, [{ id: 'demo-arn-in-1', direction: 'in', status: 'pending', my_case_id: 'COV-DEMO06', other_institution: 'Brightline Fitness',
  other_side: 'merchant', arn_last4: '4821', amount: '', network: 'VISA', created_at: new Date(Date.now() - 3 * 3600000).toISOString() }])
function openArnSession({ a, b, sides, cases, i, opening, lines }) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''; for (let k = 0; k < 6; k++) code += chars[Math.floor(Math.random() * chars.length)]
  const now = new Date().toISOString(), c = readCases().find(x => x.id === i.my_case_id) || {}
  const opener = opening ? JSON.stringify([{ text: opening, ts: now }]) : '[]'
  saveSession({ id: code, institution_a: a, institution_b: b, status: 'active', created_at: now, updated_at: now, script: [], nextLine: 0, lines,
    claim: { kind: 'arn', arn: '…' + (i.arn_last4 || ''), amount: c.amount || i.amount || '', network: c.network || i.network || '', reasonCode: c.reasonCode || '', sides, cases },
    notes_a: a === DEMO_INSTITUTION ? '[]' : opener, notes_b: b === DEMO_INSTITUTION ? '[]' : opener })
  try {
    const role = a === DEMO_INSTITUTION ? 'a' : 'b'
    const mine = JSON.parse(localStorage.getItem('duo_my_sessions') || '[]').filter(x => x.id !== code)
    localStorage.setItem('duo_my_sessions', JSON.stringify([{ id: code, role, myInstitution: DEMO_INSTITUTION, joinedAt: now, lastStatus: 'active', caseId: i.my_case_id }, ...mine]))
  } catch {}
  return code
}

// ── RPCs ─────────────────────────────────────────────────────────────────────
const HANDLERS = {
  // Transaction monitoring (supabase_monitoring.sql) — kept to the last 20,000 transactions
  tm_ingest: ({ p_rows }) => {
    need(canWrite(), 'Your role can’t import transactions')
    const all = read(K.tmTx, []), ids = new Set(all.map(t => t.id)), now = new Date().toISOString()
    const fresh = (p_rows || []).filter(t => !ids.has(t.id)).map(t => ({ ...t, importedAt: now }))
    write(K.tmTx, [...all, ...fresh].slice(-20000))
    return fresh.length
  },
  tm_window: ({ p_customers, p_since }) => {
    const want = new Set(p_customers || []), since = new Date(p_since || 0)
    return read(K.tmTx, []).filter(t => want.has(t.customerId) && new Date(t.ts) >= since)
  },
  tm_batches: () => {
    const by = new Map()
    read(K.tmTx, []).forEach(t => {
      const b = by.get(t.batch) || { batch: t.batch, transactions: 0, customers: new Set(), first_ts: t.ts, last_ts: t.ts, imported_at: t.importedAt }
      b.transactions++; b.customers.add(t.customerId)
      if (t.ts < b.first_ts) b.first_ts = t.ts; if (t.ts > b.last_ts) b.last_ts = t.ts; if (t.importedAt > b.imported_at) b.imported_at = t.importedAt
      by.set(t.batch, b)
    })
    return [...by.values()].map(b => ({ ...b, customers: b.customers.size })).sort((a, b) => (b.imported_at || '').localeCompare(a.imported_at || ''))
  },
  tm_alerts_add: ({ p_rows }) => {
    need(canWrite(), 'Your role can’t raise alerts')
    const all = read(K.tmAlerts, []), ids = new Set(all.map(a => a.id)), now = new Date().toISOString()
    const fresh = (p_rows || []).filter(a => !ids.has(a.id)).map(a => ({ id: a.id, data: a, status: 'open', created_at: now, updated_at: now }))
    write(K.tmAlerts, [...fresh, ...all])
    return fresh.length
  },
  tm_events_ingest: ({ p_rows }) => {
    need(canWrite(), 'Your role can’t import events')
    const all = read(K.tmEvents, []), ids = new Set(all.map(e => e.id))
    const fresh = (p_rows || []).filter(e => !ids.has(e.id))
    write(K.tmEvents, [...all, ...fresh].slice(-20000))
    return fresh.length
  },
  tm_events_window: ({ p_customers, p_since }) => {
    const want = new Set(p_customers || []), since = new Date(p_since || 0)
    return read(K.tmEvents, []).filter(e => want.has(e.customerId) && new Date(e.ts) >= since)
  },
  tm_window_names: ({ p_names, p_since }) => {
    const want = new Set((p_names || []).map(n => String(n).toLowerCase())), since = new Date(p_since || 0)
    return read(K.tmTx, []).filter(t => t.channel === 'card' && want.has(String(t.customerName || '').toLowerCase()) && new Date(t.ts) >= since)
  },
  // Demo keys look real but only work in the demo; the intake API needs a signed-in workspace's key
  intake_key_create: ({ p_label }) => {
    need(isAdmin(), 'Only an institution admin can create API keys')
    const key = 'cvl_' + Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')
    write(K.keys, [{ id: 'demo-' + Date.now(), label: p_label || 'API key', prefix: key.slice(0, 12), created_at: new Date().toISOString(), last_used_at: null, revoked_at: null }, ...read(K.keys, [])])
    audit('intake_key.created', 'workspace', key.slice(0, 12), { label: p_label })
    return key
  },
  intake_keys_list: () => canConfigure() ? read(K.keys, []) : [],
  intake_key_revoke: ({ p_id }) => {
    need(isAdmin(), 'Only an institution admin can revoke API keys')
    write(K.keys, read(K.keys, []).map(k => k.id === p_id ? { ...k, revoked_at: new Date().toISOString() } : k))
  },
  // Acting in the bank's systems (supabase_actions.sql): the demo keeps the settings; nothing is sent anywhere
  action_endpoint_get: () => { if (!canConfigure()) return []; const e = read(K.endpoint, null); return e ? [{ url: e.url, has_secret: !!e.secret, slack_set: !!e.slack, notify_min: e.notify_min || 'high', updated_at: e.updated_at }] : [] },
  action_endpoint_set: ({ p_url, p_slack_url, p_notify_min }) => {
    need(isAdmin(), 'Only an institution admin can change connections')
    const e = read(K.endpoint, {}) || {}
    if (p_url && !/^https:\/\/[^\s/]+/.test(p_url)) throw new Error('The endpoint must start with https://')
    if (p_slack_url && !/^https:\/\/hooks\.slack\.com\//.test(p_slack_url)) throw new Error('A Slack incoming webhook starts with https://hooks.slack.com/')
    write(K.endpoint, { ...e, url: (p_url || '').trim(), slack: p_slack_url == null ? e.slack : !!p_slack_url.trim(), notify_min: p_notify_min || 'high', updated_at: new Date().toISOString() })
    audit('connection.updated', 'workspace', 'action_endpoint', { url: p_url || '' })
  },
  action_secret_rotate: () => {
    need(isAdmin(), 'Only an institution admin can change connections')
    const s = 'whsec_' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')
    write(K.endpoint, { ...(read(K.endpoint, {}) || {}), secret: true, updated_at: new Date().toISOString() })
    audit('connection.secret_rotated', 'workspace', 'action_endpoint', {})
    return s
  },
  // The demo's "connection" is the simulated feed
  intake_status: () => [{ active_keys: 1 + read(K.keys, []).filter(k => !k.revoked_at).length, last_received: read(K.feed, null) }],
  tm_alerts_list: ({ p_status }) => read(K.tmAlerts, []).filter(a => !p_status || a.status === p_status),
  tm_alert_set: ({ p_id, p_status, p_patch }) => {
    need(canWrite(), 'Your role can’t change alerts')
    write(K.tmAlerts, read(K.tmAlerts, []).map(a => a.id === p_id ? { ...a, status: p_status, data: { ...a.data, ...(p_patch || {}) }, updated_at: new Date().toISOString() } : a))
  },
  // Team
  list_team: () => {
    const v = visitor()
    return [{ user_id: 'demo-you', display_name: `${v.name || 'You'} (you)`, email: v.email || 'you@demo.bank', role: demoRole(), created_at: new Date().toISOString() },
      ...read(K.team, [])]
  },
  list_invites: () => isAdmin() ? read(K.invites, []) : [],
  create_invite: ({ p_email, p_role }) => {
    need(isAdmin(), 'Only an institution admin can invite')
    need(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p_email || ''), 'Enter a valid email address')
    const code = 'demo' + Math.random().toString(36).slice(2, 10)
    write(K.invites, [{ code, email: p_email.toLowerCase(), role: p_role || 'analyst', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * DAY).toISOString() }, ...read(K.invites, [])])
    audit('invite.created', 'invite', p_email.toLowerCase(), { role: p_role || 'analyst' })
    return code
  },
  revoke_invite: ({ p_code }) => {
    need(isAdmin(), 'Only an institution admin can revoke invites')
    const inv = read(K.invites, []).find(i => i.code === p_code)
    write(K.invites, read(K.invites, []).filter(i => i.code !== p_code))
    if (inv) audit('invite.revoked', 'invite', inv.email, {})
  },
  remove_member: ({ p_user_id }) => {
    need(isAdmin(), 'Only an institution admin can remove members')
    need(p_user_id !== 'demo-you', 'You cannot remove yourself')
    const m = read(K.team, []).find(x => x.user_id === p_user_id)
    write(K.team, read(K.team, []).filter(x => x.user_id !== p_user_id))
    if (m) audit('member.removed', 'member', m.email, { role: m.role })
  },
  set_member_role: ({ p_user_id, p_role }) => {
    need(isAdmin(), 'Only an institution admin can change roles')
    if (p_user_id === 'demo-you') { audit('member.role_changed', 'member', visitor().email, { from: demoRole(), to: p_role }); setDemoRole(p_role); return }
    const team = read(K.team, [])
    const m = team.find(x => x.user_id === p_user_id)
    if (m) { audit('member.role_changed', 'member', m.email, { from: m.role, to: p_role }); m.role = p_role; write(K.team, team) }
  },

  // Legal holds and retention
  legal_holds_list: () => read(K.holds, []),
  legal_hold_set: ({ p_case_id, p_on, p_reason }) => {
    need(canConfigure(), 'Only admins and reviewers can place or lift legal holds')
    const holds = read(K.holds, []).filter(h => h.case_id !== p_case_id)
    if (p_on) holds.unshift({ case_id: p_case_id, reason: p_reason || '', set_at: new Date().toISOString(), set_by_email: visitor().email })
    write(K.holds, holds)
    audit(p_on ? 'case.legal_hold_on' : 'case.legal_hold_off', 'case', p_case_id, p_on ? { reason: p_reason || '' } : {})
  },
  retention_candidates: () => {
    const days = read(K.retention, 1825)
    const held = new Set(read(K.holds, []).map(h => h.case_id))
    const cases = readCases()
    return cases
      .filter(c => /^(COV|MCH)-DEMO/.test(c.id) && ['won','lost','withdrawn','resolved','closed'].includes(c.status) && !held.has(c.id))
      .map(c => ({ case_id: c.id, status: c.status, closed_on: c.resolvedDate || c.updatedAt || c.date }))
      .filter(c => c.closed_on && new Date(c.closed_on).getTime() < Date.now() - days * DAY)
  },
  retention_get: () => [{ closed_case_days: read(K.retention, 1825), updated_at: null,
    eligible: HANDLERS.retention_candidates().length, on_hold: read(K.holds, []).length, purged_total: read(K.purged, []).length }],
  retention_set: ({ p_days }) => {
    need(isAdmin(), 'Only an institution admin can change retention')
    need(p_days >= 365 && p_days <= 36500, 'Retention must be between 1 and 100 years')
    audit('retention.policy_changed', 'retention', '', { from_days: read(K.retention, 1825), to_days: p_days })
    write(K.retention, p_days)
  },
  retention_purge: ({ p_case_ids }) => {
    need(isAdmin(), 'Only an institution admin can purge')
    const ok = new Set(HANDLERS.retention_candidates().map(c => c.case_id))
    const ids = (p_case_ids || []).filter(id => ok.has(id))
    writeCases(readCases().filter(c => !ids.includes(c.id)))
    write(K.purged, [...read(K.purged, []), ...ids])
    ids.forEach(id => audit('case.purged', 'case', id, { reason: 'retention' }))
    if (ids.length) audit('retention.purged', 'retention', '', { cases: ids.length })
    return ids.length
  },
  cov_purged_ids: () => read(K.purged, []).map(case_id => ({ case_id })),

  // Audit
  audit_write: ({ p_action, p_entity, p_entity_id, p_detail }) => { audit(p_action, p_entity, p_entity_id, p_detail) },
  audit_list: async ({ p_entity_id, p_limit }) => {
    await chain
    return read(K.audit, []).filter(e => !p_entity_id || e.entity_id === p_entity_id).slice().reverse().slice(0, p_limit || 200)
  },
  audit_verify: async () => {
    await chain
    let prev = '', n = 0
    for (const e of read(K.audit, [])) {
      n++
      if (e.prev_hash !== prev || e.hash !== await hashOf(e)) return [{ ok: false, checked: n, first_bad_id: e.id }]
      prev = e.hash
    }
    return [{ ok: true, checked: n, first_bad_id: null }]
  },

  // Duo
  duo_create: ({ p }) => {
    need(canWrite(), 'Your role (auditor) is read-only')
    const now = Date.now()
    const s = { ...p, institution_a: DEMO_INSTITUTION, institution_b: '', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
      script: [{ at: now + 6000, type: 'join' }, { at: now + 9000, type: 'say', text: `${COUNTERPARTY} here — we’ve got the session. Send us what you have and we’ll check the receiving account.` }], nextLine: 0 }
    audit('duo.created', 'duo', s.id, { case: p?.claim?.caseId || '' })
    return [publicSession(saveSession(s))]
  },
  duo_get: ({ p_id }) => {
    const s = sessions()[String(p_id || '').toUpperCase()]
    if (!s) return []
    return [publicSession(saveSession(settle(s)))]
  },
  duo_update: ({ p_id, p }) => {
    need(canWrite(), 'Your role (auditor) is read-only')
    const s = sessions()[String(p_id || '').toUpperCase()]
    if (!s) return []
    settle(s)
    const f = myField(s), before = thread(s[f]).length, lines = s.lines || HARBOR_LINES
    if (p[f] !== undefined && p[f] !== s[f]) {
      need((shareLogs()[s.id] || []).some(x => x.kind === 'purpose'), 'Confirm why you are sharing (314(b)) before posting in this session')
      need(covered(s) || coordination(s) || !mySharing().require_both, 'Your institution only shares in Duo when both sides are registered under 314(b)')
      logShare(s.id, { kind: 'message', safe_harbor: covered(s), detail: { with: theirName(s) || '' } })
      audit('duo.info_shared', 'duo', s.id, { with: theirName(s) || '', safe_harbor: covered(s) })
      s[f] = p[f]
    }
    if (p.status && p.status !== s.status) {
      logShare(s.id, { kind: 'status', safe_harbor: covered(s), detail: { from: s.status, to: p.status } })
      audit('duo.status_changed', 'duo', s.id, { from: s.status, to: p.status }); s.status = p.status
    }
    // The counterparty answers each new message from Demo Bank
    if (thread(s[f]).length > before && s.institution_b && (s.nextLine ?? 0) < lines.length) {
      s.script = [...(s.script || []), { at: Date.now() + 5000, type: 'say', text: lines[s.nextLine ?? 0] }]
      s.nextLine = (s.nextLine ?? 0) + 1
    }
    s.updated_at = new Date().toISOString()
    return [publicSession(saveSession(s))]
  },
  duo_find: () => Object.values(sessions()).map(s => ({ id: s.id, institution_a: s.institution_a, institution_b: s.institution_b, status: s.status, created_at: s.created_at })),

  // 314(b) information sharing (supabase_314b.sql)
  sharing_get: () => [mySharing()],
  sharing_set: ({ p_registered, p_expires_on, p_contact_name, p_contact_email, p_require_both }) => {
    need(isAdmin(), 'Only an institution admin can change the 314(b) registration')
    const today = new Date().toISOString().slice(0, 10)
    if (p_registered) {
      need(p_expires_on, 'Enter the date your 314(b) registration expires')
      need(p_expires_on >= today, 'That registration has expired — renew it with FinCEN first')
      need(p_expires_on <= inDays(400), 'A 314(b) registration lasts one year — check the expiry date')
      need(String(p_contact_name || '').trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p_contact_email || '').trim()), 'Enter the point of contact named in the registration, with an email address')
    }
    write(K.sharing, { registered: !!p_registered, expires_on: p_registered ? p_expires_on : null, contact_name: String(p_contact_name || '').trim(),
      contact_email: String(p_contact_email || '').trim(), require_both: !!p_require_both, updated_at: new Date().toISOString() })
    audit('sharing.updated', 'workspace', '314b', { registered: !!p_registered, expires_on: p_expires_on || null, contact: String(p_contact_email || '').trim(), require_both: !!p_require_both })
    return null
  },
  duo_sharing_status: ({ p_id }) => {
    const s = sessions()[String(p_id || '').toUpperCase()]
    if (!s) return null
    const me = mySharing(), log = shareLogs()[s.id] || [], purpose = log.find(x => x.kind === 'purpose')
    const mine = { institution: DEMO_INSTITUTION, ...me, valid: sharingValid(me) }
    const theirs = s.institution_b ? { ...theirSharing(s), valid: sharingValid(theirSharing(s)) } : null
    const weAreA = s.institution_a === DEMO_INSTITUTION
    return { a: weAreA ? mine : theirs, b: weAreA ? theirs : mine, coordination: coordination(s),
      safe_harbor: covered(s), require_both: !!me.require_both, purpose: purpose ? { at: purpose.at, by: purpose.by, text: purpose.detail.purpose } : null, log }
  },
  duo_share_confirm: ({ p_id, p_purpose }) => {
    need(canWrite(), 'Your role (auditor) is read-only')
    const s = sessions()[String(p_id || '').toUpperCase()]
    need(s, 'Your institution is not part of this Duo session')
    need(String(p_purpose || '').trim(), 'Say why you are sharing')
    logShare(s.id, { kind: 'purpose', safe_harbor: covered(s), detail: { purpose: String(p_purpose).trim().slice(0, 500) } })
    audit('duo.sharing_purpose', 'duo', s.id, { purpose: String(p_purpose).trim().slice(0, 500), safe_harbor: covered(s) })
    return null
  },

  // Linking by ARN (supabase_arn.sql). Seeded: Brightline Fitness (a merchant) has
  // invited Demo Bank on the issuer case COV-DEMO06. Demo Bank's own lookups find
  // Harbor Credit Union as the issuer, who accepts a few seconds later.
  arn_find_other_side: ({ p_case_id }) => {
    need(canWrite(), 'Your role (auditor) is read-only')
    const c = readCases().find(x => x.id === p_case_id)
    need(c, 'This case hasn’t synced yet — try again in a moment')
    need(/^[0-9]{23}$/.test(c.arn || ''), 'Add the case’s 23-digit ARN first')
    const mine = isMerchantSide(c) ? 'merchant' : 'issuer'
    const all = arnInvites()
    if (!all.some(i => i.direction === 'out' && i.my_case_id === c.id))
      write(K.arn, [{ id: 'demo-arn-' + Math.random().toString(36).slice(2, 10), direction: 'out', status: 'pending', my_case_id: c.id, my_side: mine,
        other_institution: mine === 'merchant' ? COUNTERPARTY : 'Northwind Electronics', other_side: mine === 'merchant' ? 'issuer' : 'merchant',
        arn_last4: c.arn.slice(-4), amount: c.amount, network: c.network, reasonCode: c.reasonCode, acceptAt: Date.now() + 6000, created_at: new Date().toISOString() }, ...all])
    audit('duo.arn_lookup', 'case', c.id, { arn_last4: c.arn.slice(-4) })
    return { sent: true }
  },
  arn_invites: () => {
    const all = arnInvites().map(i => {
      if (i.direction !== 'out' || i.status !== 'pending' || Date.now() < i.acceptAt) return i
      const code = openArnSession({ a: DEMO_INSTITUTION, b: i.other_institution, sides: { a: i.my_side, b: i.other_side }, cases: { a: i.my_case_id, b: 'their case' }, i,
        lines: ARN_LINES_ISSUER })
      audit('duo.arn_linked', 'case', i.my_case_id, { session: code }, { actor: '' })
      return { ...i, status: 'accepted', session_id: code }
    })
    write(K.arn, all)
    // An outgoing invite is only shown once accepted, as in the database
    return all.filter(i => i.direction === 'in' || i.status === 'accepted')
  },
  arn_invite_respond: ({ p_id, p_accept }) => {
    need(canWrite(), 'Your role (auditor) is read-only')
    const all = arnInvites(), i = all.find(x => x.id === p_id && x.direction === 'in' && x.status === 'pending')
    need(i, 'That invite isn’t waiting for an answer')
    if (!p_accept) { write(K.arn, all.map(x => x === i ? { ...x, status: 'declined' } : x)); audit('duo.arn_declined', 'case', i.my_case_id, {}); return null }
    const code = openArnSession({ a: i.other_institution, b: DEMO_INSTITUTION, sides: { a: i.other_side, b: 'issuer' }, cases: { a: 'their case', b: i.my_case_id }, i,
      opening: 'Brightline Fitness here. Your cardholder’s cancellation reached us two days after the billing date. Rather than fight it, we’ll refund the $89 directly — would you withdraw the chargeback?',
      lines: ARN_LINES_MERCHANT })
    write(K.arn, all.map(x => x === i ? { ...x, status: 'accepted', session_id: code } : x))
    audit('duo.arn_linked', 'case', i.my_case_id, { session: code })
    return code
  },

  // Case links: the counterparty opens the link and answers
  case_link_create: ({ p }) => {
    need(canWrite(), 'Your role (auditor) is read-only')
    const token = 'demo-' + Math.random().toString(36).slice(2, 12)
    const links = read(K.links, {}); links[token] = { ...p, created: Date.now() }; write(K.links, links)
    audit('case_link.created', 'case_link', p?.payload?.case_ref || '', { type: p?.case_type })
    return [{ token, ...p }]
  },
  case_link_activity: ({ p_token }) => {
    const l = read(K.links, {})[p_token]
    if (!l) return { responses: [], access: [] }
    const t = Date.now() - l.created
    const access = t > 8000 ? [{ accessor_name: 'Alex Moreno', accessor_institution: COUNTERPARTY, accessor_role: 'Fraud Operations', accessor_email: 'a.moreno@harbor.cu', accessed_at: new Date(l.created + 8000).toISOString() }] : []
    const responses = t > 20000 ? [{ respondent_name: 'Alex Moreno', respondent_institution: COUNTERPARTY, respondent_role: 'Fraud Operations', respondent_email: 'a.moreno@harbor.cu',
      disposition: 'frozen', notes: 'Beneficiary account frozen pending review. Please send the customer statement and recall request.', responded_at: new Date(l.created + 20000).toISOString() }] : []
    return { responses, access }
  },

  // Membership (for completeness — demo visitors aren't signed in)
  my_membership: () => [{ institution_id: 'demo', institution_name: DEMO_INSTITUTION, role: demoRole(), display_name: visitor().name, email: visitor().email }],
}

export async function demoRpc(fn, args) {
  await ensureDemoSeeded()
  const h = HANDLERS[fn]
  if (!h) throw new Error(`Not available in the demo: ${fn}`)
  return await h(args || {})
}

// ── Evidence: files stay in this tab's memory (demo only) ────────────────────
const files = new Map()
export function demoStoreFile(caseId, file) {
  const path = `demo/${caseId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  files.set(path, URL.createObjectURL(file))
  return path
}
export const demoFileUrl = path => files.get(path) || null

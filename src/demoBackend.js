// ═══════════════════════════════════════════════════════════════════════════════
// DEMO BACKEND — the full product for visitors who haven't signed in
// ═══════════════════════════════════════════════════════════════════════════════
// Answers the same RPCs as the real database (supabase_*.sql) but keeps
// everything in this browser, on the fictional Demo Bank: a hash-chained audit
// log, a team with roles, legal holds and retention, Duo with a scripted
// counterparty, case links that get viewed and answered. Nothing here ever
// reaches Supabase; signing in switches to the real backend.

const K = {
  audit: 'cov_demo_audit', team: 'cov_demo_team', invites: 'cov_demo_invites', holds: 'cov_demo_holds',
  retention: 'cov_demo_retention_days', purged: 'cov_demo_purged', duo: 'cov_demo_duo', links: 'cov_demo_links',
  seeded: 'cov_demo_backend', role: 'cov_demo_role',
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
function audit(action, entity, entityId, detail, opts = {}) {
  chain = chain.then(async () => {
    const log = read(K.audit, [])
    const prev = log.length ? log[log.length - 1].hash : ''
    const e = { id: (log.length ? log[log.length - 1].id : 0) + 1, at: opts.at || new Date().toISOString(),
      actor_email: opts.actor ?? visitor().email, action, entity: entity || '', entity_id: entityId || '', detail: detail || {}, prev_hash: prev }
    e.hash = await hashOf(e)
    log.push(e); write(K.audit, log)
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
    const cases = (() => { try { return JSON.parse(localStorage.getItem('cov_outcomes') || '[]') } catch { return [] } })()
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
    if (x.type === 'say') s.notes_b = JSON.stringify([...thread(s.notes_b), { text: x.text, ts: new Date(x.at).toISOString() }])
  })
  s.script = s.script.filter(x => x.at > now)
  s.updated_at = new Date().toISOString()
  return s
}
const sessions = () => read(K.duo, {})
const saveSession = s => { const all = sessions(); all[s.id] = s; write(K.duo, all); return s }
const publicSession = s => { const { script, nextLine, ...rest } = s; return rest }

// ── RPCs ─────────────────────────────────────────────────────────────────────
const HANDLERS = {
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
    const cases = (() => { try { return JSON.parse(localStorage.getItem('cov_outcomes') || '[]') } catch { return [] } })()
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
    const cases = JSON.parse(localStorage.getItem('cov_outcomes') || '[]')
    localStorage.setItem('cov_outcomes', JSON.stringify(cases.filter(c => !ids.includes(c.id))))
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
    const before = thread(s.notes_a).length
    if (p.notes_a !== undefined) s.notes_a = p.notes_a
    if (p.status && p.status !== s.status) { audit('duo.status_changed', 'duo', s.id, { from: s.status, to: p.status }); s.status = p.status }
    // The counterparty answers each new message from Demo Bank
    if (thread(s.notes_a).length > before && s.institution_b && (s.nextLine ?? 0) < HARBOR_LINES.length) {
      s.script = [...(s.script || []), { at: Date.now() + 5000, type: 'say', text: HARBOR_LINES[s.nextLine ?? 0] }]
      s.nextLine = (s.nextLine ?? 0) + 1
    }
    s.updated_at = new Date().toISOString()
    return [publicSession(saveSession(s))]
  },
  duo_find: () => Object.values(sessions()).map(s => ({ id: s.id, institution_a: s.institution_a, institution_b: s.institution_b, status: s.status, created_at: s.created_at })),

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

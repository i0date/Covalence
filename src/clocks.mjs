// ═══════════════════════════════════════════════════════════════════════════════
// CLOCKS — SLA timers, deadline reminders, auto-assignment and escalation rules
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript with no browser or React imports, so the daily reminder email
// (api/reminders.js) runs exactly the same rules as the app.
//
// Every open case runs up to four clocks:
//   assign    an owner within N hours of opening            (institution SLA)
//   file      filed with the network within N business days (institution SLA)
//   response  the network's next response deadline          (nextRespDate)
//   regE      Reg E: 45 business days from provisional credit
// Each clock is ok, soon (inside its warning window), breached, or met.
import { isMerchantCase } from './sides.mjs'
import { TO_ANSWER, respondBy } from './merchantQueue.mjs'

export const CLOSED_STATUSES     = ['won','lost','withdrawn','resolved','closed']
export const FILE_STAGE_STATUSES = ['filed','network_invstg','representment','pre_arb','arbitration','pending_arb','rebuttal_prep','submitted']

export const WORKFLOW_DEFAULTS = {
  slaAssignHours:      24,      // a new case has an owner within this many hours
  slaFileBusinessDays: 5,       // …and is filed with the network within this many business days
  reminderLeadDays:    3,       // response deadlines count as "due soon" this many days ahead
  regEWarnDays:        7,       // the Reg E 45-day limit counts as "due soon" this many days ahead
  autoAssign:          false,
  autoAssignRoles:     ['analyst', 'reviewer'],
  autoAssignSince:     null,    // set when auto-assign is switched on; older cases are left alone
  escalateTo:          '',      // email of the reviewer or admin who takes escalations
  escalateOnBreach:    true,
  escalateAmount:      0,       // 0 = off; cases at or above this amount are escalated
  escalateSince:       null,    // set when escalation is switched on; earlier breaches are left alone
  emailReminders:      false,   // daily email digest (api/reminders.js)
}

// ─── Business days (US Federal Reserve holidays) ──────────────────────────────
const HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04',
  '2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04',
  '2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25',
])
// Calendar dates are read in local time throughout (a date-only "2026-10-27"
// is that day, not midnight UTC, which is the evening before in the Americas)
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseDay = v => String(v).length === 10 ? new Date(v + 'T12:00:00') : new Date(v)
export function isBusinessDay(d) {
  const day = d.getDay()
  if (day === 0 || day === 6) return false
  return !HOLIDAYS.has(ymd(d))
}
export function addBusinessDays(startStr, n) {
  let d = parseDay(startStr); let added = 0
  while (added < n) { d.setDate(d.getDate() + 1); if (isBusinessDay(d)) added++ }
  return d
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const HOUR = 3600000, DAY = 24 * HOUR
const isOpen = c => !CLOSED_STATUSES.includes(c.status)
// A date-only deadline ("2026-11-02") runs to the end of that day
const endOfDay = d => String(d).length === 10 ? new Date(d + 'T23:59:59') : new Date(d)
export const parseAmount = a => { const n = parseFloat(String(a ?? '').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0 }
const withDefaults = s => ({ ...WORKFLOW_DEFAULTS, ...(s || {}) })

export function timeLeft(ms) {
  const a = Math.abs(ms), late = ms < 0
  const t = a >= 2 * DAY ? `${Math.round(a / DAY)}d` : a >= HOUR ? `${Math.round(a / HOUR)}h` : `${Math.max(1, Math.round(a / 60000))}m`
  return late ? `${t} overdue` : `${t} left`
}

function clock(key, label, due, done, warnMs, now) {
  const left = due - now
  const state = done ? 'met' : left < 0 ? 'breached' : left <= warnMs ? 'soon' : 'ok'
  return { key, label, due: due.toISOString(), left, state, text: done ? 'Done' : timeLeft(left) }
}

// The clocks running on one case. The dispute's own clocks stop when it closes;
// the financial-crime clocks (fincrime.js) run until their decision is recorded.
export function caseClocks(c, settings, now = new Date()) {
  if (!c) return []
  const s = withDefaults(settings), out = []
  const sc = c.screening
  if (sc && sc.status === 'potential' && !sc.decision)       // review a possible sanctions match within a business day
    out.push(clock('screen', 'Sanctions match reviewed', addBusinessDays(sc.ts, 1), false, DAY, now))
  if (sc?.decision?.outcome === 'true_match')                // OFAC: report blocked or rejected property within 10 business days
    out.push(clock('ofac', 'Report to OFAC', addBusinessDays(sc.decision.ts, 10), !!c.ofacReportedAt, 3 * DAY, now))
  if (c.sarReview?.flaggedAt && (!c.sarReview.decision || (c.sarReview.decision === 'file' && !c.sarReview.filedAt)))
    out.push(clock('sar', c.sarReview.decision === 'file' ? 'SAR filed with FinCEN' : 'SAR decision',   // FinCEN: 30 days from initial detection
      new Date(new Date(c.sarReview.flaggedAt).getTime() + 30 * DAY), false, 7 * DAY, now))
  if (!isOpen(c)) return out
  const merchant = isMerchantCase(c)
  if (c.date && s.slaAssignHours > 0) {
    const due = new Date(new Date(c.date).getTime() + s.slaAssignHours * HOUR)
    out.push(clock('assign', 'Owner assigned', due, !!c.assignedTo, Math.max(HOUR, s.slaAssignHours * HOUR * 0.25), now))
  }
  const offNetwork = (['p2p', 'crypto', 'crypto_exchange'].includes(c.accountType) && !c.network) || c.kind === 'aml'   // nothing to file with a card network
  if (c.date && !merchant && !offNetwork && s.slaFileBusinessDays > 0) {
    const due = addBusinessDays(c.date, s.slaFileBusinessDays)
    out.push(clock('file', 'Filed with the network', due, !!c.filedAt || FILE_STAGE_STATUSES.includes(c.status), DAY, now))
  }
  // Date deadlines warn by whole days: "3 days ahead" includes the rest of today
  if (c.nextRespDate) out.push(clock('response', 'Response deadline', endOfDay(c.nextRespDate), false, (s.reminderLeadDays + 1) * DAY, now))
  else if (merchant && TO_ANSWER.includes(c.status || 'received') && c.date)   // the acquirer's deadline to answer a chargeback
    out.push(clock('response', 'Chargeback answered', respondBy(c, settings), false, (s.reminderLeadDays + 1) * DAY, now))
  if (c.provCreditDate && !merchant) {
    const due = addBusinessDays(c.provCreditDate, 45); due.setHours(23, 59, 59)
    out.push(clock('regE', 'Reg E 45-business-day limit', due, false, (s.regEWarnDays + 1) * DAY, now))
  }
  return out
}

const RANK = { breached: 0, soon: 1, ok: 2, met: 3 }
// Most pressing clock first: breached before soon, then the earliest due
export const sortClocks = cs => [...cs].sort((a, b) => RANK[a.state] - RANK[b.state] || a.left - b.left)
export const pressing = cs => sortClocks(cs).filter(k => k.state === 'breached' || k.state === 'soon')

// ─── Auto-assignment ──────────────────────────────────────────────────────────
// Balanced: the eligible teammate with the fewest open cases. Ties are broken
// by a hash of the case number, so every browser picks the same person.
const hash = s => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
export function assignPool(team, settings) {
  const roles = withDefaults(settings).autoAssignRoles || []
  return (team || []).filter(m => m.email && roles.includes(m.role === 'member' ? 'analyst' : m.role))
    .map(m => ({ email: m.email.toLowerCase(), name: (m.display_name || m.email).replace(/ \(you\)$/, '') }))
    .sort((a, b) => a.email.localeCompare(b.email))
}
export function openLoad(cases) {
  const load = {}
  ;(cases || []).forEach(c => { if (isOpen(c) && c.assignedTo) load[c.assignedTo.toLowerCase()] = (load[c.assignedTo.toLowerCase()] || 0) + 1 })
  return load
}

// What the rules would change right now: [{ id, patch, events, audit }]
//   opts.backlog — also act on cases opened (or breached) before the rule was switched on
export function workflowChanges(cases, settings, team, now = new Date(), opts = {}) {
  const s = withDefaults(settings), out = []
  const pool = assignPool(team, s), load = openLoad(cases)
  const ts = now.toISOString()
  const since = t => opts.backlog || (t && new Date(t) <= now)
  const ordered = (cases || []).filter(c => c?.id && isOpen(c) && !c._triageOnly)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0) || a.id.localeCompare(b.id))
  for (const c of ordered) {
    const patch = {}, events = [], audit = []
    // Auto-assign new, unowned cases
    if (s.autoAssign && pool.length && !c.assignedTo && since(s.autoAssignSince) && (opts.backlog || new Date(c.date || 0) >= new Date(s.autoAssignSince))) {
      const min = Math.min(...pool.map(m => load[m.email] || 0))
      const tied = pool.filter(m => (load[m.email] || 0) === min)
      const pick = tied[hash(c.id) % tied.length]
      load[pick.email] = (load[pick.email] || 0) + 1
      Object.assign(patch, { assignedTo: pick.email, assignedName: pick.name, assignedAt: ts, assignedBy: 'auto' })
      events.push({ ts, event: 'assigned', to: pick.email, by: 'Auto-assign' })
      audit.push(['case.auto_assigned', { to: pick.email, rule: 'balanced' }])
    }
    // Escalate breached or high-value cases
    if (s.escalateTo && !c.escalatedTo) {
      const after = t => opts.backlog || (s.escalateSince && new Date(t) >= new Date(s.escalateSince))
      const breached = s.escalateOnBreach ? sortClocks(caseClocks({ ...c, ...patch }, s, now)).find(k => k.state === 'breached' && after(k.due)) : null
      const big = s.escalateAmount > 0 && parseAmount(c.amount) >= s.escalateAmount && after(c.date || 0)
      const reason = breached ? `${breached.label} missed` : big ? `High value (${c.amount})` : null
      if (reason) {
        Object.assign(patch, { escalatedTo: s.escalateTo.toLowerCase(), escalatedAt: ts, escalationReason: reason })
        events.push({ ts, event: 'escalated', to: s.escalateTo.toLowerCase(), reason, by: 'Escalation rule' })
        audit.push(['case.escalated', { to: s.escalateTo.toLowerCase(), reason }])
      }
    }
    if (events.length) out.push({ id: c.id, patch, events, audit })
  }
  return out
}
export function applyChanges(cases, changes) {
  if (!changes.length) return cases
  const byId = new Map(changes.map(x => [x.id, x]))
  return cases.map(c => { const x = byId.get(c.id); return x ? { ...c, ...x.patch, history: [...(c.history || []), ...x.events] } : c })
}

// ─── Reminders ────────────────────────────────────────────────────────────────
// What each person should hear about: clocks that are breached or due soon on
// their cases, and escalations. Unowned cases go to the escalation contact.
//   → Map(email → [{ c, kind: 'due'|'escalated', clock?, key }])
export function remindersByPerson(cases, settings, now = new Date()) {
  const s = withDefaults(settings), out = new Map()
  const add = (email, item) => { if (!email) return; const e = email.toLowerCase(); if (!out.has(e)) out.set(e, []); out.get(e).push(item) }
  for (const c of cases || []) {
    if (!c?.id) continue
    const top = pressing(caseClocks(c, s, now))[0]
    if (!isOpen(c) && !top) continue   // a closed dispute can still owe a sanctions or SAR decision
    const owner = c.assignedTo || s.escalateTo
    if (top) add(owner, { c, kind: 'due', clock: top, key: `${c.id}:${top.key}:${top.state}` })
    if (c.escalatedTo && !(top && owner && owner.toLowerCase() === c.escalatedTo.toLowerCase()))
      add(c.escalatedTo, { c, kind: 'escalated', clock: top, key: `${c.id}:esc` })
  }
  for (const list of out.values()) list.sort((a, b) => (a.clock ? RANK[a.clock.state] : 1.5) - (b.clock ? RANK[b.clock.state] : 1.5) || (a.clock?.left ?? 0) - (b.clock?.left ?? 0))
  return out
}

// In-app: the signed-in person's reminders, plus cases recently given to them
export function remindersFor(cases, email, settings, now = new Date()) {
  if (!email) return []
  const me = email.toLowerCase()
  const items = [...(remindersByPerson(cases, settings, now).get(me) || [])]
  const listed = new Set(items.map(i => i.c.id))
  for (const c of cases || []) {
    if (!c?.assignedAt || listed.has(c.id) || !isOpen(c) || (c.assignedTo || '').toLowerCase() !== me) continue
    if (now - new Date(c.assignedAt) < 7 * DAY) items.push({ c, kind: 'assigned', key: `${c.id}:asg:${c.assignedAt}` })
  }
  return items
}

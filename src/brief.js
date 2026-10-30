// ═══════════════════════════════════════════════════════════════════════════════
// THE BRIEF — what changed since you were last here, in a few plain sentences
// ═══════════════════════════════════════════════════════════════════════════════
// Written from the case records themselves, not by a model, so every sentence is
// a count you can check and every case it mentions is a link. It covers:
//   in        new cases, and claims from the bank's app (and how many AI triage
//             marked urgent)
//   decided   cases won and lost, and the money back
//   answered  merchants who answered a chargeback (the rebuttal clock restarts)
//   escalated cases escalated, and how many to you
//   ahead     deadlines in the next 24 hours, and anything already overdue
//   alarm     an open alarm
// The period runs from the start of the last working day, or from your last
// visit when that was earlier (up to two weeks back).
import { CLOSED_STATUSES, caseClocks, parseAmount } from './clocks.mjs'
import { closedAt } from './qa.js'
import { money, WEEKDAYS } from './insights.js'

const DAY = 86400000
const VISIT_KEY = 'cov_brief_visit'   // per browser: { day, lastAt, prevAt }
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const ymd = d => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}` }
const ANSWERED = ['representment', 'pre_arb']
const DUE = { file: 'filing', response: 'a response', regE: 'the Reg E limit', screen: 'a sanctions review', ofac: 'the OFAC report', sar: 'a SAR decision' }

// Note this visit; returns when the previous day's visit was (or null)
export function noteVisit(now = new Date()) {
  let v = null
  try { v = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null') } catch {}
  const today = ymd(now)
  const next = v?.day === today ? { ...v, lastAt: now.toISOString() } : { day: today, lastAt: now.toISOString(), prevAt: v?.lastAt || null }
  try { localStorage.setItem(VISIT_KEY, JSON.stringify(next)) } catch {}
  return next.prevAt ? new Date(next.prevAt) : null
}

// The start of the last working day before today (Monday looks back to Friday)
function lastWorkingDay(now) {
  const d = startOfDay(now)
  do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6)
  return d
}

export function briefPeriod(now = new Date(), prevVisit = null) {
  const work = lastWorkingDay(now)
  const floor = new Date(startOfDay(now).getTime() - 14 * DAY)
  if (prevVisit && prevVisit < work && prevVisit >= floor) {
    const from = startOfDay(prevVisit)
    return { from, label: `Since your last visit, ${from.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })}` }
  }
  const days = Math.round((startOfDay(now) - work) / DAY)
  return { from: work, label: days === 1 ? 'Since yesterday' : `Since ${WEEKDAYS[work.getDay()]}` }
}

const sum = list => {
  const cur = new Set(list.map(c => String(c.amount || '').match(/[A-Z]{3}/)?.[0]).filter(Boolean))
  return money(list.reduce((s, c) => s + parseAmount(c.amount), 0), cur.size === 1 ? [...cur][0] : cur.size ? 'mixed' : 'USD')
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const inWindow = (ts, from, now) => { if (!ts) return false; const t = new Date(ts); return t >= from && t <= now }

// cases: this side's cases; claims: rows from claims_list (may be empty); alarms: alarm_list rows
// Returns [{ key, text: [string | { id }] , ids }] — the screen turns { id } into a link
export function brief(cases, { claims = [], alarms = [], me = '', settings, from, now = new Date() } = {}) {
  const out = []
  const ids = list => list.map(c => ({ id: c.id }))
  const isOpen = c => !CLOSED_STATUSES.includes(c.status)

  // ── In ──
  const fresh = cases.filter(c => inWindow(c.date, from, now))
  const newClaims = claims.filter(c => inWindow(c.created_at || c.reported_at, from, now))
  const urgent = newClaims.filter(c => c.data?.ai?.priority === 'urgent').length
  if (fresh.length || newClaims.length) {
    const t = []
    if (fresh.length) t.push(`${plural(fresh.length, 'new case')} came in (${sum(fresh)}): `, ...ids(fresh))
    if (newClaims.length) t.push(`${fresh.length ? '. ' : ''}${plural(newClaims.length, 'claim')} arrived from the bank’s app${urgent ? `, ${urgent} marked urgent by AI triage` : ''}`)
    out.push({ key: 'in', text: t })
  }

  // ── Decided ──
  const decided = cases.filter(c => ['won', 'lost'].includes(c.status) && inWindow(closedAt(c), from, now))
  const won = decided.filter(c => c.status === 'won'), lost = decided.filter(c => c.status === 'lost')
  if (decided.length) {
    const t = []
    if (won.length) t.push(`Won ${won.length} (${sum(won)} back): `, ...ids(won))
    if (lost.length) t.push(`${won.length ? '. ' : ''}Lost ${lost.length}: `, ...ids(lost))
    out.push({ key: 'decided', text: t })
  }

  // ── Merchants answered ──
  const answered = cases.filter(c => isOpen(c) && (c.history || []).some(h => h.event === 'status' && ANSWERED.includes(h.status) && inWindow(h.ts, from, now)))
  if (answered.length) out.push({ key: 'answered', text: [`${answered.length === 1 ? 'A merchant answered' : `Merchants answered on ${answered.length} cases`}, so the rebuttal clock is running: `, ...ids(answered)] })

  // ── Escalated ──
  const esc = cases.filter(c => (c.history || []).some(h => h.event === 'escalated' && inWindow(h.ts, from, now)))
  if (esc.length) {
    const toMe = me ? esc.filter(c => (c.escalatedTo || '').toLowerCase() === me) : []
    out.push({ key: 'escalated', text: [`${plural(esc.length, 'case')} ${esc.length === 1 ? 'was' : 'were'} escalated${toMe.length ? `, ${toMe.length} to you` : ''}: `, ...ids(toMe.length ? toMe : esc)] })
  }

  // ── Ahead: the next 24 hours, and what's already late ──
  const soon = [], late = []
  cases.forEach(c => {
    const ks = caseClocks(c, settings, now).filter(k => k.key !== 'assign' && k.state !== 'met')
    if (ks.some(k => k.state === 'breached')) late.push(c)
    else { const k = ks.filter(k => k.left >= 0 && k.left <= DAY).sort((a, b) => a.left - b.left)[0]; if (k) soon.push({ c, k }) }
  })
  if (soon.length) {
    // Grouped by what's due, so it reads "filing on A and B; a sanctions review on C"
    const groups = []
    soon.sort((a, b) => a.k.left - b.k.left).forEach(({ c, k }) => {
      const g = groups.find(g => g.key === k.key) || (groups.push({ key: k.key, ids: [] }), groups[groups.length - 1])
      g.ids.push({ id: c.id })
    })
    const t = ['Due in the next 24 hours: ']
    groups.forEach((g, i) => t.push(i ? '; ' : '', `${DUE[g.key] || 'a deadline'} on `, ...g.ids))
    out.push({ key: 'ahead', text: t })
  }
  if (late.length) out.push({ key: 'late', text: [late.length > 3 ? `Already overdue: ${late.length} cases, starting with ` : 'Already overdue: ', ...ids(late)], tone: 'danger' })

  // ── Alarm ──
  const alarm = alarms.find(a => a.status === 'open')
  if (alarm) out.push({ key: 'alarm', text: [`A level ${alarm.level} alarm is open: ${alarm.title}.`], tone: 'danger', alarm: true })

  return out
}

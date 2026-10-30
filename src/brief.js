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
//   late      cases past a deadline
//   waiting   customers who haven't heard from the bank in UPDATE_DAYS or more
//   pattern   a possible fraud wave (patterns.mjs)
//   alarm     an alarm someone raised, shown on its own line
// The lead is a calm recap of what happened; what needs care is counted under it, folded.
// The period runs from the start of the last working day, or from your last
// visit when that was earlier (up to two weeks back).
import { CLOSED_STATUSES, caseClocks, parseAmount } from './clocks.mjs'
import { closedAt } from './qa.js'
import { waitingClaims, UPDATE_DAYS } from './claims.mjs'
import { money, WEEKDAYS } from './insights.js'

const DAY = 86400000
const VISIT_KEY = 'cov_brief_visit'   // per browser: { day, lastAt, prevAt }
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const ymd = d => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}` }
const ANSWERED = ['representment', 'pre_arb']

// Note this visit; returns when the previous day's visit was (or null)
export function noteVisit(now = new Date()) {
  let v = null
  try { v = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null') } catch {}
  const today = ymd(now)
  const next = v?.day === today ? { ...v, lastAt: now.toISOString() } : { day: today, lastAt: now.toISOString(), prevAt: v?.lastAt || null }
  try { localStorage.setItem(VISIT_KEY, JSON.stringify(next)) } catch {}
  return next.prevAt ? new Date(next.prevAt) : null
}

// When the previous day's visit was, without noting a new one (null on a first visit)
export function previousVisit() {
  try { const v = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null'); return v?.prevAt ? new Date(v.prevAt) : null } catch { return null }
}

// Has a case changed since then, other than by you? New cases count; so does anything in its history
export function changedSince(c, prev, myName = '') {
  if (!prev || !c) return false
  if (c.date && new Date(c.date) > prev) return true
  return (c.history || []).some(h => h.ts && new Date(h.ts) > prev && (!myName || (h.by || '') !== myName))
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
    const on = from.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })
    const when = now - from < 6 * DAY ? WEEKDAYS[from.getDay()] : from.toLocaleDateString('en-US', { month:'short', day:'numeric' })
    return { from, label: `Since your last visit, ${on}`, phrase: `Since your visit on ${when}`, quiet: `Nothing new since your visit on ${when}` }
  }
  const days = Math.round((startOfDay(now) - work) / DAY)
  // Monday looks back over the weekend; a day after a holiday, to the last working day
  const weekend = days === 3 && now.getDay() === 1
  return { from: work, label: days === 1 ? 'Since yesterday' : weekend ? 'Over the weekend' : `Since ${WEEKDAYS[work.getDay()]}`,
    phrase: days === 1 ? 'Since yesterday' : weekend ? 'Over the weekend' : `Since ${WEEKDAYS[work.getDay()]}`,
    quiet: days === 1 ? 'A quiet night' : weekend ? 'A quiet weekend' : `Nothing new since ${WEEKDAYS[work.getDay()]}` }
}

const sum = list => {
  const cur = new Set(list.map(c => String(c.amount || '').match(/[A-Z]{3}/)?.[0]).filter(Boolean))
  return money(list.reduce((s, c) => s + parseAmount(c.amount), 0), cur.size === 1 ? [...cur][0] : cur.size ? 'mixed' : 'USD')
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const inWindow = (ts, from, now) => { if (!ts) return false; const t = new Date(ts); return t >= from && t <= now }

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const say = (n, one, many = one + 's') => `${WORDS[n] || n} ${n === 1 ? one : many}`

// cases: this side's cases; claims: rows from claims_list (may be empty); alarms: alarm_list rows
// Returns { lead, alarm, happened, attention }: the lead is a calm recap of what happened in the
// period; happened and attention are items [{ key, kicker, count, text: [string | { id } | { claim }] }]
// that the screen keeps folded under it. What's due today belongs to Your day, not here.
// The screen turns { id } into a link to the case and { claim } into a link to the claim.
export function brief(cases, { claims = [], alarms = [], patterns = [], me = '', settings, period, now = new Date() } = {}) {
  const from = period?.from || startOfDay(now)
  const happened = [], attention = [], facts = []
  const ids = list => list.map(c => ({ id: c.id }))
  const isOpen = c => !CLOSED_STATUSES.includes(c.status)

  // ── What happened ──
  const fresh = cases.filter(c => inWindow(c.date, from, now))
  const newClaims = claims.filter(c => inWindow(c.created_at || c.reported_at, from, now))
  const urgent = newClaims.filter(c => c.data?.ai?.priority === 'urgent').length
  if (fresh.length || newClaims.length) {
    const t = []
    if (fresh.length) t.push(`${plural(fresh.length, 'case')}, ${sum(fresh)}: `, ...ids(fresh))
    if (newClaims.length) t.push(`${fresh.length ? '. ' : ''}${plural(newClaims.length, 'claim')} from the bank’s app${urgent ? `, ${urgent} marked urgent by AI triage` : ''}`)
    happened.push({ key: 'in', kicker: 'NEW', count: fresh.length + newClaims.length, text: t })
    facts.push(`${say(fresh.length + newClaims.length, 'new case')} came in`)
  }
  const decided = cases.filter(c => ['won', 'lost'].includes(c.status) && inWindow(closedAt(c), from, now))
  const won = decided.filter(c => c.status === 'won'), lost = decided.filter(c => c.status === 'lost')
  if (decided.length) {
    const t = []
    if (won.length) t.push(`Won ${won.length}, ${sum(won)} back: `, ...ids(won))
    if (lost.length) t.push(`${won.length ? '. ' : ''}Lost ${lost.length}: `, ...ids(lost))
    happened.push({ key: 'decided', kicker: 'DECIDED', count: decided.length, text: t })
    facts.push(won.length ? `you won ${say(won.length, 'case')} (${sum(won)} back)` : `${say(lost.length, 'case')} ${lost.length === 1 ? 'was' : 'were'} decided`)
  }
  const answered = cases.filter(c => isOpen(c) && (c.history || []).some(h => h.event === 'status' && ANSWERED.includes(h.status) && inWindow(h.ts, from, now)))
  if (answered.length) {
    happened.push({ key: 'answered', kicker: 'MERCHANT ANSWERED', count: answered.length, text: [`The rebuttal clock is running on `, ...ids(answered)] })
    facts.push(answered.length === 1 ? `a merchant answered on a ${sum(answered)} chargeback` : `merchants answered on ${say(answered.length, 'case')}`)
  }
  const esc = cases.filter(c => (c.history || []).some(h => h.event === 'escalated' && inWindow(h.ts, from, now)))
  if (esc.length) {
    const toMe = me ? esc.filter(c => (c.escalatedTo || '').toLowerCase() === me) : []
    happened.push({ key: 'escalated', kicker: 'ESCALATED', count: esc.length, text: [`${plural(esc.length, 'case')}${toMe.length ? `, ${toMe.length} to you` : ''}: `, ...ids(toMe.length ? toMe : esc)] })
    if (toMe.length) facts.push(`${say(toMe.length, 'case')} ${toMe.length === 1 ? 'was' : 'were'} escalated to you`)
  }

  // ── Worth a look: kept under the fold, never the headline ──
  const late = cases.filter(c => caseClocks(c, settings, now).some(k => k.key !== 'assign' && k.state === 'breached'))
  if (late.length)
    attention.push({ key: 'late', kicker: 'PAST A DEADLINE', count: late.length, text: [late.length > 3 ? `${plural(late.length, 'case')}, starting with ` : `${plural(late.length, 'case')}: `, ...ids(late)] })
  const waiting = waitingClaims(claims, now)
  if (waiting.length)
    attention.push({ key: 'waiting', kicker: 'WAITING ON AN UPDATE', count: waiting.length,
      text: [`${plural(waiting.length, 'customer')} ${waiting.length === 1 ? 'hasn’t' : 'haven’t'} heard from you in ${UPDATE_DAYS}+ days: `, ...waiting.map(c => ({ claim: c.id }))] })
  if (patterns.length) {
    const p = patterns[0]
    attention.push({ key: 'pattern', kicker: 'POSSIBLE PATTERN', count: patterns.length, pattern: p,
      text: [`${p.recent.length} cases at ${p.name} in 7 days, ${p.basis}${patterns.length > 1 ? ` (and ${patterns.length - 1} more)` : ''}: `, ...ids(p.recent)] })
  }

  // An alarm someone raised stands apart: it was a person's call, not a count
  const a = alarms.find(a => a.status === 'open')
  const alarm = a ? { level: a.level, title: a.title } : null

  // The lead: up to three things that happened, in plain words
  const phrase = period?.phrase || 'Since yesterday'
  const list = facts.slice(0, 3)
  const lead = list.length
    ? `${phrase}, ${list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + (list.length > 2 ? ',' : '') + ' and ' + list[list.length - 1]}.`
    : `${period?.quiet || 'A quiet night'}: no new cases and nothing decided.`
  return { lead, alarm, happened, attention }
}

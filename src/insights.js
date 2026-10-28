// ═══════════════════════════════════════════════════════════════════════════════
// INSIGHTS — the numbers behind Your day's summary and forecasts
// ═══════════════════════════════════════════════════════════════════════════════
// Plain functions over the case pool. Every forecast says what it is based on
// and returns null when there isn't enough history to say anything honest —
// the screen then leaves it out rather than guessing.
//   intake      cases opened per day for the last 14 days, and today's
//               expected intake (average of the same weekday over 8 weeks)
//   pace        cases closed in the last 7 days vs the 7 before, and how long
//               the open queue would take to clear at the recent rate
//   week        clock deadlines in the next 7 days and the busiest day
//   atRisk      money on cases with a missed or nearly-due clock
import { CLOSED_STATUSES, caseClocks, parseAmount } from './clocks.mjs'
import { closedAt } from './qa.js'

const DAY = 86400000
const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}` }
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const isOpen = c => !CLOSED_STATUSES.includes(c.status)
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function insights(cases, { me, settings, now = new Date() } = {}) {
  const all = (cases || []).filter(c => c?.id && c.date)
  const mine = me ? all.filter(c => (c.assignedTo || '').toLowerCase() === me) : []
  const scope = mine.length ? mine : all
  const today = startOfDay(now)

  // ── Intake: last 14 days, and a forecast for today ──
  const opened = {}
  all.forEach(c => { const k = dayKey(c.date); opened[k] = (opened[k] || 0) + 1 })
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() - (13 - i) * DAY)
    return { date: d, count: opened[dayKey(d)] || 0 }
  })
  const earliest = all.reduce((m, c) => Math.min(m, new Date(c.date).getTime()), Infinity)
  const weeksOfHistory = Math.floor((today - earliest) / (7 * DAY))
  let expected = null
  if (weeksOfHistory >= 2) {
    const n = Math.min(8, weeksOfHistory)
    const same = Array.from({ length: n }, (_, i) => opened[dayKey(new Date(today.getTime() - (i + 1) * 7 * DAY))] || 0)
    const avg = same.reduce((a, b) => a + b, 0) / n
    // Your share of new work, from who was given cases over the last 30 days
    const recent = all.filter(c => now - new Date(c.date) < 30 * DAY)
    const share = mine.length && recent.length ? recent.filter(c => (c.assignedTo || '').toLowerCase() === me).length / recent.length : null
    expected = { team: avg, mine: share != null ? avg * share : null, basis: `the last ${n} ${WEEKDAYS[now.getDay()]}s`, share }
  }

  // ── Pace: closures, and how long the open queue lasts at that rate ──
  const paceOf = list => {
    const closedBetween = (from, to) => list.filter(c => { const t = closedAt(c); return t && new Date(t) >= from && new Date(t) < to }).length
    const last28 = closedBetween(new Date(now - 28 * DAY), now), openNow = list.filter(isOpen).length
    return { last7: closedBetween(new Date(now - 7 * DAY), now), prev7: closedBetween(new Date(now - 14 * DAY), new Date(now - 7 * DAY)),
      last28, openNow, clearDays: last28 ? Math.ceil(openNow / (last28 / 28)) : null, enough: last28 > 0 }
  }
  // Your own pace when you've closed something recently; otherwise the team's
  let pace = { ...paceOf(scope), who: mine.length ? 'mine' : 'team' }
  if (!pace.enough && mine.length) pace = { ...paceOf(all), who: 'team' }

  // ── This week's deadlines, by day ──
  const byDay = Array(7).fill(0)
  let weekTotal = 0
  scope.forEach(c => caseClocks(c, settings, now).forEach(k => {
    if (k.state === 'met' || k.key === 'assign') return
    const offset = Math.floor((startOfDay(k.due) - today) / DAY)
    if (offset >= 0 && offset < 7) { byDay[offset]++; weekTotal++ }
  }))
  const busiest = weekTotal ? byDay.indexOf(Math.max(...byDay)) : null
  const week = { total: weekTotal, byDay, busiest, busiestLabel: busiest == null ? '' : busiest === 0 ? 'today' : busiest === 1 ? 'tomorrow' : WEEKDAYS[(now.getDay() + busiest) % 7] }

  // ── Money on cases whose clocks are missed or nearly due ──
  let atRisk = 0, atRiskCases = 0
  const currencies = new Set()
  scope.forEach(c => {
    if (!caseClocks(c, settings, now).some(k => k.state === 'breached' || k.state === 'soon')) return
    atRisk += parseAmount(c.amount); atRiskCases++
    const cur = String(c.amount || '').match(/[A-Z]{3}/)?.[0]; if (cur) currencies.add(cur)
  })

  return { scope: mine.length ? 'mine' : 'team', days, expected, pace, week,
    atRisk: { amount: atRisk, cases: atRiskCases, currency: currencies.size === 1 ? [...currencies][0] : currencies.size ? 'mixed' : 'USD' } }
}

export function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// One sentence that sums up the day, e.g. "3 things need you today; 1 is overdue."
export function daySummary({ urgent, overdue, todo, batch, batchTime, total }) {
  if (!total) return 'Nothing needs you today. A clear desk.'
  const parts = [`${total} thing${total === 1 ? ' needs' : 's need'} you today`]
  if (overdue) parts.push(`${overdue} ${overdue === 1 ? 'is' : 'are'} overdue`)
  else if (urgent) parts.push(`${urgent} ${urgent === 1 ? 'is' : 'are'} due soon`)
  if (batch) parts.push(`${batch} go${batch === 1 ? 'es' : ''} out in the ${batchTime} batch`)
  else if (todo) parts.push(`${todo} to analyse`)
  return parts.join('; ') + '.'
}

export const money = (n, cur) => {
  const s = n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString()
  return cur === 'USD' ? `$${s}` : cur === 'mixed' ? s : `${s} ${cur}`
}

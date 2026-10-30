// ═══════════════════════════════════════════════════════════════════════════════
// INSIGHTS — money, leaks and exam readiness, worked out from the case records
// ═══════════════════════════════════════════════════════════════════════════════
// Plain functions, so every figure on the Insights page can be checked against the
// cases behind it. Each one says what it's based on, and steps aside with a line
// saying so when there isn't enough history to be honest.
//   moneyView    provisional credit still out, what becomes final soon, what's
//                past the Reg E limit, and what was recovered or lost lately
//   leaks        where decided cases are lost, by reason code, and (with enough
//                cases) which missing evidence costs the most
//   examReady    the share of cases with a complete record, and the gaps
import { CLOSED_STATUSES, FILE_STAGE_STATUSES, addBusinessDays, caseClocks, parseAmount } from './clocks.mjs'
import { closedAt } from './qa.js'

const DAY = 86400000
const isOpen = c => !CLOSED_STATUSES.includes(c.status)
const amt = c => parseAmount(c.amount)
const total = list => list.reduce((s, c) => s + amt(c), 0)
const within = (ts, days, now) => ts && now - new Date(ts) <= days * DAY && new Date(ts) <= now

// ── Money ──
export function moneyView(cases, { settings, now = new Date() } = {}) {
  const credited = cases.filter(c => isOpen(c) && c.provCreditDate)
  const clock = c => caseClocks(c, settings, now).find(k => k.key === 'regE')
  const finalSoon = credited.filter(c => { const k = clock(c); return k && k.state !== 'breached' && k.left <= 10 * DAY })
    .sort((a, b) => clock(a).left - clock(b).left)
  const pastLimit = credited.filter(c => clock(c)?.state === 'breached')
  const decided = cases.filter(c => ['won', 'lost'].includes(c.status) && within(closedAt(c), 90, now))
  const won = decided.filter(c => c.status === 'won'), lost = decided.filter(c => c.status === 'lost')
  return {
    credited: { cases: credited, amount: total(credited) },
    finalSoon: { cases: finalSoon, amount: total(finalSoon), first: finalSoon[0] ? clock(finalSoon[0]).due : null },
    pastLimit: { cases: pastLimit, amount: total(pastLimit) },
    recovered: { cases: won, amount: total(won) },
    lost: { cases: lost, amount: total(lost) },
  }
}

// ── Leaks ──
// Features that often decide a case, where the case record says one way or the other
const FEATURES = [
  { key: 'docs', label: 'evidence attached', has: c => (c.docs || []).length > 0, known: () => true },
  { key: 'delivery', label: 'proof of delivery', has: c => c.deliveryConfirmed === true, known: c => c.deliveryConfirmed != null },
  { key: 'tds', label: '3-D Secure authentication', has: c => /^(y|auth|success|full)/i.test(String(c.threeDSStatus || '')), known: c => !!c.threeDSStatus },
]
export const LEAK_MIN = 3     // cases on each side before a finding is shown

export function leaks(cases, { now = new Date() } = {}) {
  const decided = cases.filter(c => ['won', 'lost'].includes(c.status) && within(closedAt(c), 365, now))
  const groups = new Map()
  decided.forEach(c => {
    const key = c.reasonCode ? `${c.network ? c.network + ' ' : ''}${c.reasonCode}` : (c.category || 'other').replace(/^mc_/, '').replace(/_/g, ' ')
    if (!groups.has(key)) groups.set(key, { key, title: c.reasonTitle || '', cases: [] })
    groups.get(key).cases.push(c)
  })
  const byCode = [...groups.values()].map(g => {
    const lost = g.cases.filter(c => c.status === 'lost')
    return { ...g, decided: g.cases.length, lost: lost.length, lostAmount: total(lost), winRate: Math.round(100 * (g.cases.length - lost.length) / g.cases.length) }
  }).sort((a, b) => b.lostAmount - a.lostAmount || b.lost - a.lost)

  // Findings: within a reason code, cases without a feature lost far more often than cases with it
  const findings = []
  byCode.forEach(g => FEATURES.forEach(f => {
    const known = g.cases.filter(f.known), withF = known.filter(f.has), without = known.filter(c => !f.has(c))
    if (withF.length < LEAK_MIN || without.length < LEAK_MIN) return
    const rate = l => l.filter(c => c.status === 'lost').length / l.length
    const gap = rate(without) - rate(withF)
    if (gap < 0.25) return
    findings.push({ code: g.key, feature: f.label, lossWithout: Math.round(100 * rate(without)), lossWith: Math.round(100 * rate(withF)),
      without: without.length, withCount: withF.length, worthQuarter: Math.round(gap * total(without) / 4), cases: without.filter(c => c.status === 'lost') })
  }))
  findings.sort((a, b) => b.worthQuarter - a.worthQuarter)
  return { decided: decided.length, byCode, findings }
}

// ── Exam readiness ──
// What an examiner would ask of each case, checked against what the record shows
export const EXAM_CHECKS = {
  missed:   { label: 'A deadline was missed', why: 'Response, filing, Reg E, sanctions or SAR deadlines' },
  owner:    { label: 'No owner past the assignment target', why: 'Every open case needs someone accountable' },
  regE:     { label: 'No decision or provisional credit within 10 business days', why: 'Reg E: debit, ACH and P2P claims' },
  code:     { label: 'Filed without a reason code', why: 'The filing has to say what the dispute is' },
  evidence: { label: 'Filed without evidence attached', why: 'The file should hold what was sent' },
  outcome:  { label: 'Closed without a resolution date', why: 'When and how it ended should be on record' },
  screened: { label: 'Not screened for sanctions', why: 'OFAC screening on every case' },
}

export function examReady(cases, { settings, now = new Date() } = {}) {
  const scope = cases.filter(c => isOpen(c) || within(closedAt(c), 365, now))
  const gaps = Object.fromEntries(Object.keys(EXAM_CHECKS).map(k => [k, []]))
  scope.forEach(c => {
    const ks = caseClocks(c, settings, now)
    if (ks.some(k => k.key !== 'assign' && k.state === 'breached')) gaps.missed.push(c)
    if (ks.some(k => k.key === 'assign' && k.state === 'breached')) gaps.owner.push(c)
    const filed = !!c.filedAt || FILE_STAGE_STATUSES.includes(c.status)
    if (['debit', 'p2p', 'ach_eft'].includes(c.accountType) && isOpen(c) && !c.provCreditDate && c.date && addBusinessDays(String(c.date).slice(0, 10), 10) < now) gaps.regE.push(c)
    if (filed && !c.reasonCode) gaps.code.push(c)
    if (filed && !(c.docs || []).length) gaps.evidence.push(c)
    if (!isOpen(c) && !c.resolvedDate) gaps.outcome.push(c)
    if (!c.screening && !(c.screenings || []).length) gaps.screened.push(c)
  })
  const flagged = new Set(Object.values(gaps).flat().map(c => c.id))
  return { checked: scope.length, complete: scope.length - flagged.size, score: scope.length ? Math.round(100 * (scope.length - flagged.size) / scope.length) : null, gaps }
}

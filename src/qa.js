// ═══════════════════════════════════════════════════════════════════════════════
// QA — sampling closed cases for quality review, and how the AI is doing
// ═══════════════════════════════════════════════════════════════════════════════
// Each month, a share of the cases closed that month is picked for a second
// person to review (Settings → Quality review). The pick is random but fixed:
// it comes from a hash of the case number and the month, so everyone sees the
// same sample and it can't be re-rolled to dodge a case. Some cases are always
// included: ones where someone disagreed with the AI or filed under a
// different reason code than it suggested, and (optionally) lost cases.
// A reviewer can't QA a case assigned to them.
import { CLOSED_STATUSES } from './clocks.mjs'
import { decisionsOf, codeFollowed } from './ai.js'

export const QA_DEFAULTS = { qaSampleRate: 10, qaAlwaysAiDisagreed: true, qaAlwaysLost: true }

export const QA_CHECKS = [
  ['classification', 'Classified correctly (fraud vs. dispute, sub-type)'],
  ['reasonCode',     'Right reason code under the network’s rules'],
  ['evidence',       'Evidence complete and on file'],
  ['deadlines',      'Deadlines and Reg E timelines met'],
  ['communication',  'Customer letters accurate, clear and fair'],
  ['ai',             'AI output checked before it was relied on'],
]
export const QA_RESULTS = { pass: 'Pass', coaching: 'Pass with coaching', fail: 'Fail' }

const hash = s => [...String(s)].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261)
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function closedAt(c) {
  if (!CLOSED_STATUSES.includes(c?.status)) return null
  return c.resolvedDate || [...(c.history || [])].reverse().find(h => CLOSED_STATUSES.includes(h.status))?.ts || c.updatedAt || c.date || null
}
export const periodOf = ts => ts ? ym(new Date(ts)) : ''
export function recentPeriods(n = 12, now = new Date()) {
  return Array.from({ length: n }, (_, i) => ym(new Date(now.getFullYear(), now.getMonth() - i, 1)))
}
export const periodLabel = p => new Date(p + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

export const closedIn = (cases, period) => (cases || []).filter(c => c?.id && !c._triageOnly && periodOf(closedAt(c)) === period)

// → [{ c, why: [reasons] }] for one month
export function qaSample(cases, period, settings) {
  const s = { ...QA_DEFAULTS, ...(settings || {}) }
  const closed = closedIn(cases, period)
  const roll = c => hash(c.id + ':' + period) / 4294967296
  const picked = new Map()
  const add = (c, why) => { if (!picked.has(c.id)) picked.set(c.id, { c, why: [] }); picked.get(c.id).why.push(why) }
  closed.forEach(c => {
    if (roll(c) < s.qaSampleRate / 100) add(c, 'Random sample')
    if (s.qaAlwaysAiDisagreed) {
      if (Object.values(c.aiReviews || {}).some(r => r.verdict === 'disagree')) add(c, 'Someone disagreed with the AI')
      if (codeFollowed(c) === false) add(c, 'Filed under a different code than the AI suggested')
    }
    if (s.qaAlwaysLost && c.status === 'lost') add(c, 'Lost')
    // Already reviewed: stays in the sample even if the rules change afterwards
    if (c.qa?.result) add(c, 'Reviewed')
  })
  // A small month still gets at least two random cases looked at
  const want = Math.min(2, closed.length)
  const randoms = [...picked.values()].filter(x => x.why.some(w => w === 'Random sample' || w === 'Reviewed')).length
  if (randoms < want) closed.filter(c => !picked.get(c.id)?.why.includes('Random sample')).sort((a, b) => roll(a) - roll(b))
    .slice(0, want - randoms).forEach(c => add(c, 'Random sample'))
  return [...picked.values()].sort((a, b) => a.c.id.localeCompare(b.c.id))
}

const pct = (n, d) => d ? Math.round(100 * n / d) : null

// Review results for the sample, and how the AI did on the month's closed cases
export function qaStats(cases, period, settings) {
  const sample = qaSample(cases, period, settings)
  const reviewed = sample.filter(x => x.c.qa?.result)
  const count = r => reviewed.filter(x => x.c.qa.result === r).length
  const closed = closedIn(cases, period)
  const withAi = closed.filter(c => decisionsOf(c).some(d => !d.draft))
  const reviews = closed.flatMap(c => Object.values(c.aiReviews || {}))
  const coded = closed.map(c => ({ c, f: codeFollowed(c) })).filter(x => x.f !== null)
  const won = list => pct(list.filter(x => x.c.status === 'won').length, list.length)
  const failedChecks = {}
  reviewed.forEach(x => Object.entries(x.c.qa.checks || {}).forEach(([k, v]) => { if (v === 'no') failedChecks[k] = (failedChecks[k] || 0) + 1 }))
  return {
    closed: closed.length, sampled: sample.length, reviewed: reviewed.length,
    pass: count('pass'), coaching: count('coaching'), fail: count('fail'),
    passRate: pct(count('pass') + count('coaching'), reviewed.length),
    failedChecks,
    ai: {
      cases: withAi.length,
      reviews: reviews.length, agreeRate: pct(reviews.filter(r => r.verdict === 'agree').length, reviews.length),
      coded: coded.length, followedRate: pct(coded.filter(x => x.f).length, coded.length),
      wonFollowed: won(coded.filter(x => x.f)), wonChanged: won(coded.filter(x => !x.f)),
      nFollowed: coded.filter(x => x.f).length, nChanged: coded.filter(x => !x.f).length,
    },
  }
}

export function qaCsv(cases, period, settings) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Case', 'Merchant', 'Amount', 'Outcome', 'Closed', 'Assigned to', 'Why sampled', 'QA result', 'Reviewer', 'Reviewed', ...QA_CHECKS.map(([, l]) => l), 'Note']
  const rows = qaSample(cases, period, settings).map(({ c, why }) => [
    c.id, c.merchant, c.amount, c.status, (closedAt(c) || '').slice(0, 10), c.assignedTo || '', why.join('; '),
    c.qa?.result ? QA_RESULTS[c.qa.result] : 'Not reviewed', c.qa?.reviewer || '', (c.qa?.ts || '').slice(0, 10),
    ...QA_CHECKS.map(([k]) => c.qa?.checks?.[k] || ''), c.qa?.note || '',
  ])
  return [head, ...rows].map(r => r.map(esc).join(',')).join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACQUIRER — your merchants' chargebacks, grouped by merchant (003 Multi, Acquirer)
// ═══════════════════════════════════════════════════════════════════════════════
// An acquirer sits between the card network and its merchants. A chargeback arrives
// from the network; the acquirer passes it to the merchant with a deadline shorter
// than the network's, the merchant answers (fight with evidence, or accept), and the
// acquirer checks the answer before sending it on, because a weak or late response
// is lost and the fee is the acquirer's to recover. Each case (side: 'acquirer'):
//   received       from the network; not yet with the merchant
//   with_merchant  sent to the merchant, waiting on their answer (merchantDue)
//   response_in    the merchant answered; check it (reviewResponse)
//   submitted      sent to the network (representment)
//   won | lost     the network's decision
//   withdrawn      the merchant accepted the chargeback (the loss is theirs)
// The merchant's answer is c.merchantResponse { decision: 'fight' | 'accept', evidence: [keys], note, at, by }.
// Ratios per merchant use the same programmes as chargebackRatio.mjs, against each
// merchant's monthly card sales (Settings acqMerchants { [merchant]: { visa, mc } }).
// Plain functions, no imports beyond the ratio thresholds.
import { NETWORKS, RATIO_DEFAULTS } from './chargebackRatio.mjs'

const DAY = 86400000
export const ACQ_DEFAULTS = {
  acqMerchantDays: 10,   // the merchant's deadline to answer, from when it's sent to them
  acqReviewDays: 3,      // kept back before the network deadline to check and send
  acqNetworkDaysVisa: 30, acqNetworkDaysMc: 45,   // to respond to the network, from arrival (typical)
}
export const STAGES = {
  received: 'Arrived from the network', with_merchant: 'With the merchant', response_in: 'Merchant answered: check it',
  submitted: 'Sent to the network', won: 'Won', lost: 'Lost', withdrawn: 'Merchant accepted',
}
export const OPEN = ['received', 'with_merchant', 'response_in']

const withDefaults = s => ({ ...ACQ_DEFAULTS, ...RATIO_DEFAULTS, ...(s || {}) })
export const amountOf = c => parseFloat(String(c?.amount || '').replace(/[^0-9.]/g, '')) || 0
export const netOf = c => { const n = String(c?.network || '').toLowerCase(); return n.includes('visa') ? 'visa' : n.includes('master') || n === 'mc' ? 'mc' : null }
const endOf = d => { const x = new Date(d); x.setHours(23, 59, 59, 0); return x }
export const daysLeft = (d, now = new Date()) => d ? Math.ceil((d - now) / DAY) : null

// When the network needs the response: the case's own date if set, else days from arrival
export function networkDue(c, settings) {
  if (c.nextRespDate) { const d = new Date(String(c.nextRespDate).length === 10 ? c.nextRespDate + 'T23:59:59' : c.nextRespDate); if (!isNaN(d)) return d }
  if (!c.date) return null
  const s = withDefaults(settings), days = netOf(c) === 'mc' ? s.acqNetworkDaysMc : s.acqNetworkDaysVisa
  return endOf(new Date(c.date).getTime() + days * DAY)
}
// When the merchant must answer: their days from when it was sent, never later than
// the network deadline less the review days
export function merchantDue(c, settings) {
  if (!c.sentToMerchantAt) return null
  const s = withDefaults(settings), net = networkDue(c, settings)
  const own = endOf(new Date(c.sentToMerchantAt).getTime() + s.acqMerchantDays * DAY)
  const cap = net ? endOf(net.getTime() - s.acqReviewDays * DAY) : null
  return cap && cap < own ? cap : own
}

// What a response needs, by reason. Visa codes first, then Mastercard's.
const ALWAYS = [{ key: 'letter', label: 'The merchant’s rebuttal letter', required: true }, { key: 'receipt', label: 'Transaction receipt or order record', required: true }]
const BY_REASON = [
  { match: /^(10\.4|4837|4863|4870)$/, label: 'Fraud, card absent', items: [
    { key: 'auth', label: '3-D Secure authentication, or AVS and CVV matches', required: true },
    { key: 'ce3', label: 'Two earlier undisputed orders with the same device, IP or address (Visa CE 3.0)' },
    { key: 'delivery', label: 'Proof of delivery to the cardholder’s address' }] },
  { match: /^(13\.1|4855)$/, label: 'Not received', items: [
    { key: 'delivery', label: 'Proof of delivery (tracking, signature, or service use)', required: true },
    { key: 'address', label: 'The delivery address matches the order' }] },
  { match: /^(13\.3|4853)$/, label: 'Not as described', items: [
    { key: 'description', label: 'What was promised: the listing or contract', required: true },
    { key: 'comms', label: 'Messages with the customer' }, { key: 'returns', label: 'Return policy, and whether the item came back' }] },
  { match: /^(13\.2|4841)$/, label: 'Cancelled recurring', items: [
    { key: 'terms', label: 'Terms the customer accepted at sign-up', required: true },
    { key: 'cancel', label: 'Cancellation policy, and no cancellation on record', required: true },
    { key: 'usage', label: 'Use of the service after the date they say they cancelled' }] },
  { match: /^(13\.6|13\.7|4860)$/, label: 'Credit not processed', items: [
    { key: 'refund', label: 'Refund policy shown at purchase', required: true },
    { key: 'credit', label: 'Proof the credit was issued, or why it wasn’t owed', required: true }] },
  { match: /^(12\.\d|4834|4831)$/, label: 'Processing error', items: [
    { key: 'amount', label: 'Proof the amount and currency were right', required: true }] },
]
export function evidenceFor(c) {
  const code = String(c?.reasonCode || '').trim()
  const r = BY_REASON.find(x => x.match.test(code))
  return { label: r?.label || 'Other reasons', items: [...ALWAYS, ...(r?.items || [])] }
}

// Is the merchant's answer good to send? → { ok, problems: [..], notes: [..], decision }
export function reviewResponse(c, settings, now = new Date()) {
  const r = c.merchantResponse
  if (!r) return { ok: false, problems: ['No answer from the merchant yet'], notes: [] }
  if (r.decision === 'accept') return { ok: true, decision: 'accept', problems: [], notes: ['The merchant accepts the chargeback: the loss is theirs, and nothing goes to the network'] }
  const problems = [], notes = [], have = new Set(r.evidence || [])
  const { items } = evidenceFor(c)
  for (const it of items) if (it.required && !have.has(it.key)) problems.push(`Missing: ${it.label.charAt(0).toLowerCase() + it.label.slice(1)}`)
  const net = networkDue(c, settings), md = merchantDue(c, settings)
  if (net && net < now) problems.push('The network deadline has passed: a response now won’t be accepted')
  else if (net && daysLeft(net, now) <= 1) notes.push('Due to the network within a day: send today')
  if (md && r.at && new Date(r.at) > md) notes.push('The merchant answered after their deadline')
  const optional = items.filter(it => !it.required && !have.has(it.key))
  if (optional.length && !problems.length) notes.push(`Stronger with: ${optional.map(it => it.label.charAt(0).toLowerCase() + it.label.slice(1)).join('; ')}`)
  return { ok: problems.length === 0, decision: 'fight', problems, notes }
}

// The book: one row per merchant, the ones needing attention first
export function merchantBook(cases, settings, now = new Date(), { demoSales = null } = {}) {
  const s = withDefaults(settings), since = now.getTime() - 30 * DAY
  const groups = new Map()
  for (const c of cases || []) {
    const name = String(c.merchant || '').trim() || 'Unnamed merchant'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(c)
  }
  const rows = [...groups.entries()].map(([merchant, list]) => {
    const open = list.filter(c => OPEN.includes(c.status || 'received'))
    const late = open.filter(c => { const n = networkDue(c, s); return n && daysLeft(n, now) <= 3 })
    const recent = list.filter(c => c.date && new Date(c.date).getTime() > since)
    const sales = s.acqMerchants?.[merchant] || demoSales?.[merchant] || {}
    const ratios = NETWORKS.map(n => {
      const count = recent.filter(c => netOf(c) === n.key).length
      const monthly = Number(sales[n.key]) || 0, limit = Number(s[n.limit]) || 0
      const ratio = monthly > 0 ? count / monthly * 100 : null
      const state = ratio == null ? 'unknown' : ratio >= limit ? (count >= n.minCount ? 'over' : 'over_ratio') : ratio >= limit * 2 / 3 ? 'approaching' : 'ok'
      return { key: n.key, label: n.label, program: n.program, count, sales: monthly, limit, ratio, state }
    })
    const decided = list.filter(c => ['won', 'lost'].includes(c.status))
    return {
      merchant, cases: list, open: open.length,
      toSend: open.filter(c => (c.status || 'received') === 'received').length,
      waiting: open.filter(c => c.status === 'with_merchant').length,
      toReview: open.filter(c => c.status === 'response_in').length,
      late: late.length, recent: recent.length,
      atStake: open.reduce((n, c) => n + amountOf(c), 0),
      won: decided.filter(c => c.status === 'won').length, decided: decided.length,
      ratios, demoSales: !s.acqMerchants?.[merchant] && !!demoSales?.[merchant],
    }
  })
  const rank = { over: 4, over_ratio: 3, approaching: 2, ok: 1, unknown: 0 }
  const worst = r => Math.max(...r.ratios.map(x => rank[x.state]))
  return rows.sort((a, b) => worst(b) - worst(a) || b.late - a.late || b.toReview - a.toReview || b.open - a.open || a.merchant.localeCompare(b.merchant))
}

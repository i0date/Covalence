// ═══════════════════════════════════════════════════════════════════════════════
// MERCHANT QUEUE — chargebacks filed against the merchant, waiting for an answer
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript (no React) so the deadline matches the clocks in clocks.mjs.
// A chargeback is open for an answer while it's received or being prepared
// (rebuttal_prep). The answer is due by the acquirer's deadline: the case's own
// nextRespDate, or N calendar days from when it arrived. Accepting a chargeback
// closes it as withdrawn, the same as Desk's CONCEDE.
import { isMerchantCase } from './sides.mjs'

export const MERCHANT_DEFAULTS = {
  mchRespondDays: 10,   // the acquirer's deadline to answer, in calendar days from arrival
  mchAcceptBelow: 25,   // recommend accepting chargebacks under this amount
  mchFightCost:   25,   // what it costs to prepare and send one response
}
const DAY = 86400000
export const TO_ANSWER = ['received', 'rebuttal_prep', 'pending']
export const ANSWERED  = ['submitted', 'representment', 'pre_arb', 'arbitration']
const WIN = { HIGH: 0.75, MEDIUM: 0.5, LOW: 0.2 }

export const amountOf = c => parseFloat(String(c?.amount || '').replace(/[^0-9.]/g, '')) || 0
const withDefaults = s => ({ ...MERCHANT_DEFAULTS, ...(s || {}) })

export function respondBy(c, settings) {
  if (c.nextRespDate) { const d = new Date(String(c.nextRespDate).length === 10 ? c.nextRespDate + 'T23:59:59' : c.nextRespDate); if (!isNaN(d)) return d }
  if (!c.date) return null
  const d = new Date(new Date(c.date).getTime() + withDefaults(settings).mchRespondDays * DAY); d.setHours(23, 59, 59, 0)
  return d
}
export const daysLeft = (d, now = new Date()) => d ? Math.ceil((d - now) / DAY) : null

// Fight or accept, with the reason in one line
export function recommend(c, settings) {
  const s = withDefaults(settings), amt = amountOf(c), p = WIN[String(c.winProb || '').toUpperCase()]
  if (amt && amt < s.mchAcceptBelow) return { call: 'accept', why: `Under $${s.mchAcceptBelow} — cheaper to accept than to fight` }
  if (p == null) return { call: 'review', why: 'No win estimate yet — open it in Desk to assess the evidence' }
  const expected = Math.round(p * amt - s.mchFightCost)
  if (expected <= 0) return { call: 'accept', why: `Likely recovery $${Math.round(p * amt)} doesn’t cover the $${s.mchFightCost} cost to fight`, expected }
  return { call: 'fight', why: `${Math.round(p * 100)}% chance to win · worth about $${expected.toLocaleString('en-US')} after the cost to fight`, expected }
}

// The queue: open chargebacks, soonest deadline first
export function merchantQueue(cases, settings, now = new Date()) {
  return (cases || []).filter(c => isMerchantCase(c) && TO_ANSWER.includes(c.status || 'received'))
    .map(c => { const due = respondBy(c, settings); return { c, due, left: daysLeft(due, now), rec: recommend(c, settings) } })
    .sort((a, b) => (a.due ? a.due.getTime() : Infinity) - (b.due ? b.due.getTime() : Infinity))
}
export const answeredCases = cases => (cases || []).filter(c => isMerchantCase(c) && ANSWERED.includes(c.status))

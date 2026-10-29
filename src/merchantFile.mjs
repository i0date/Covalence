// ═══════════════════════════════════════════════════════════════════════════════
// MERCHANT FILE — answered chargebacks, and what to check after a win
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript (no React). After the merchant answers (submitted), the
// cardholder's bank either accepts the response (won) or escalates to
// Pre-Arbitration and arbitration. A win isn't the end:
//   money back   the acquirer should return the amount; fees can leave it short
//   final        the bank can still escalate for a while after the win
//   repeat       a cardholder with several chargebacks needs a closer look
//   evidence     Visa Compelling Evidence 3.0 lets a merchant reuse prior
//                undisputed history against a card-absent fraud claim (10.4)
// The escalation windows are working defaults, not network rule text — confirm
// them against the current Visa and Mastercard rules for the acquirer's region.
import { isMerchantCase } from './sides.mjs'
import { amountOf } from './merchantQueue.mjs'

const DAY = 86400000
export const WAITING   = ['submitted', 'representment']
export const ESCALATED = ['pre_arb', 'arbitration', 'pending_arb']
export const ESCALATION_DAYS = { visa: 30, mc: 45, other: 45 }

const net = c => { const n = String(c?.network || '').toLowerCase(); return n.includes('visa') ? 'visa' : n.includes('master') || n === 'mc' ? 'mc' : 'other' }
const lastStatusAt = (c, status) => [...(c.history || [])].reverse().find(h => h.status === status)?.ts || null

export const sentAt = c => c.submitDate || lastStatusAt(c, 'submitted') || c.outcomeAt || null
export const wonAt  = c => c.resolvedDate || lastStatusAt(c, 'won') || c.outcomeAt || null

// When the bank can no longer escalate a win
export function finalOn(c) {
  const w = wonAt(c); if (!w) return null
  const d = new Date(new Date(w).getTime() + ESCALATION_DAYS[net(c)] * DAY); d.setHours(23, 59, 59, 0)
  return d
}
export const isFinal = (c, now = new Date()) => { const f = finalOn(c); return !!f && f <= now }

// Did the money come back?
export function moneyBack(c) {
  const expected = amountOf(c), r = c.reversal
  if (!r) return { state: 'expected', expected }
  const got = Number(r.amount) || 0, short = Math.round((expected - got) * 100) / 100
  return { state: short > 0.004 ? 'short' : 'received', expected, got, short: Math.max(0, short), date: r.date }
}

// Other chargebacks from the same cardholder, this one included
export function chargebacksFrom(cases, c) {
  const who = String(c?.cardholderName || '').trim().toLowerCase()
  if (!who) return 0
  return (cases || []).filter(x => isMerchantCase(x) && String(x.cardholderName || '').trim().toLowerCase() === who).length
}
export const ce3Applies = c => net(c) === 'visa' && String(c.reasonCode || '').startsWith('10.4')

export function merchantFile(cases, now = new Date()) {
  const mine = (cases || []).filter(isMerchantCase)
  const by = st => mine.filter(c => st.includes(c.status))
  const won = by(['won']), lost = by(['lost']), accepted = by(['withdrawn'])
  const decided = won.length + lost.length
  const notBack = won.filter(c => moneyBack(c).state !== 'received')
  return {
    waiting: by(WAITING).sort((a, b) => new Date(sentAt(a) || a.date) - new Date(sentAt(b) || b.date)),
    escalated: by(ESCALATED),
    won: won.sort((a, b) => new Date(wonAt(b) || 0) - new Date(wonAt(a) || 0)),
    lost, accepted,
    winRate: decided ? Math.round(won.length / decided * 100) : null,
    recovered: won.reduce((n, c) => n + (c.reversal ? Number(c.reversal.amount) || 0 : 0), 0),
    outstanding: notBack.reduce((n, c) => { const m = moneyBack(c); return n + (m.state === 'short' ? m.short : m.expected) }, 0),
    notFinal: won.filter(c => !isFinal(c, now)).length,
  }
}

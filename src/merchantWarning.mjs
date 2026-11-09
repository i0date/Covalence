// ═══════════════════════════════════════════════════════════════════════════════
// WARN THE MERCHANT FIRST — the bank's side of a pre-dispute alert (002 Desk, FI)
// ═══════════════════════════════════════════════════════════════════════════════
// Before filing a card dispute, the bank can warn the merchant through Ethoca
// (Mastercard) or Verifi CDRN (Visa). If the merchant refunds within the window, the
// customer is made whole with no chargeback, no network fees and no representment;
// if not, or no answer comes, the bank files as normal. Only card payments on Visa or
// Mastercard, and only before the dispute is filed. The warning pauses nothing: a
// Reg E or Reg Z deadline (provisional credit, resolution) keeps running.
// The case keeps its status; the warning lives on it as merchantWarning
//   { at, until, via, network, by, outcome: null | 'refunded' | 'no_refund' | 'expired', settledAt, settledBy }
// Sent to the bank's systems (api/action.js dispute.merchant_warning), which raise
// the alert with Ethoca or Verifi. Plain functions, no imports.

export const WARN_HOURS = 72   // typical; the bank's agreement with the provider is what applies
const HOUR = 3600000
export const WARN_VIA = { Visa: 'Verifi CDRN', Mastercard: 'Ethoca' }
export const OUTCOMES = {
  refunded: 'Merchant refunded: no dispute filed',
  no_refund: 'Merchant didn’t refund: file the dispute',
  expired: 'No answer in time: file the dispute',
}

export function networkOf(c) {
  const n = String(c?.network || '').toLowerCase()
  return /visa/.test(n) ? 'Visa' : /^mc$|master/.test(n) ? 'Mastercard' : null
}

// Can this case be warned? → { ok, why }
export function canWarn(c) {
  if (!c) return { ok: false, why: '' }
  if (c.merchantWarning) return { ok: false, why: 'The merchant was already warned' }
  if (['p2p', 'crypto_exchange', 'ach', 'wire'].includes(c.accountType)) return { ok: false, why: 'Only card payments can be warned' }
  if (!networkOf(c)) return { ok: false, why: 'Only Visa and Mastercard payments can be warned' }
  if (c.status && !['pending', 'investigating'].includes(c.status)) return { ok: false, why: 'Only before the dispute is filed' }
  return { ok: true, why: `Warn through ${WARN_VIA[networkOf(c)]}: if they refund within ${WARN_HOURS} hours, nothing needs filing` }
}

export function startWarning(c, by = '', now = new Date()) {
  const network = networkOf(c)
  return { at: now.toISOString(), until: new Date(now.getTime() + WARN_HOURS * HOUR).toISOString(), via: WARN_VIA[network], network, by, outcome: null }
}

// Still waiting, and how long is left? → { open, late, left (ms) }
export function warningClock(w, now = new Date()) {
  if (!w || w.outcome) return { open: false }
  const left = new Date(w.until) - now
  return { open: true, late: left < 0, left }
}

export const settleWarning = (w, outcome, by = '', now = new Date()) => ({ ...w, outcome, settledAt: now.toISOString(), settledBy: by })

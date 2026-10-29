// ═══════════════════════════════════════════════════════════════════════════════
// CHARGEBACK RATIO — merchant side, against the card networks' monitoring programs
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript (no React). The ratio is chargebacks received in the last 30
// days over the merchant's card sales in a month, per network. Every chargeback
// counts — won, lost or accepted — because the programs count them on arrival.
//
// Defaults follow our reading of the programs; each is a setting, and the
// acquirer's own terms are what apply:
//   Visa VAMP        merchant "excessive" at 1.5% (from 2026) with at least 1,500
//                    disputes and fraud reports in the month. Visa also counts
//                    fraud reports (TC40) that never become chargebacks, which
//                    Covalence doesn't see, so Visa's own ratio can be higher.
//   Mastercard ECM   1.5% with at least 100 chargebacks, measured against the
//                    previous month's transactions.
// The early warning is Covalence's own: two thirds of the threshold.
import { isMerchantCase } from './sides.mjs'

const DAY = 86400000
export const RATIO_DEFAULTS = { mchMonthlyTxVisa: 0, mchMonthlyTxMc: 0, mchRatioVisa: 1.5, mchRatioMc: 1.5 }
export const NETWORKS = [
  { key: 'visa', label: 'Visa',       program: 'VAMP', minCount: 1500, sales: 'mchMonthlyTxVisa', limit: 'mchRatioVisa' },
  { key: 'mc',   label: 'Mastercard', program: 'ECM',  minCount: 100,  sales: 'mchMonthlyTxMc',   limit: 'mchRatioMc' },
]
const netOf = c => { const n = String(c?.network || '').toLowerCase(); return n.includes('visa') ? 'visa' : n.includes('master') || n === 'mc' ? 'mc' : null }

export function chargebackRatios(cases, settings, now = new Date()) {
  const s = { ...RATIO_DEFAULTS, ...(settings || {}) }
  const since = now.getTime() - 30 * DAY
  const recent = (cases || []).filter(c => isMerchantCase(c) && c.date && new Date(c.date).getTime() > since)
  return NETWORKS.map(n => {
    const count = recent.filter(c => netOf(c) === n.key).length
    const sales = Number(s[n.sales]) || 0, limit = Number(s[n.limit]) || 0
    const ratio = sales > 0 ? count / sales * 100 : null
    const warnAt = limit * 2 / 3
    const state = ratio == null ? 'unknown'
      : ratio >= limit ? (count >= n.minCount ? 'over' : 'over_ratio')
      : ratio >= warnAt ? 'approaching' : 'ok'
    return { ...n, count, sales, limit, warnAt, ratio, state }
  })
}
export const worstRatio = rows => {
  const rank = { over: 4, over_ratio: 3, approaching: 2, ok: 1, unknown: 0 }
  return [...rows].sort((a, b) => rank[b.state] - rank[a.state] || (b.ratio || 0) - (a.ratio || 0))[0]
}

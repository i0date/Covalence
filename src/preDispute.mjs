// ═══════════════════════════════════════════════════════════════════════════════
// PRE-DISPUTE ALERTS — "the network warned you", for merchants (001 Triage → Alerts, Merchant)
// ═══════════════════════════════════════════════════════════════════════════════
// Before a cardholder's complaint becomes a chargeback, the networks' alert services
// warn the merchant so it can refund first — or answer with the order's details:
//   ethoca         Ethoca Alerts (Mastercard): the issuer confirms fraud or a dispute;
//                  refund in time and there's no chargeback
//   cdrn           Verifi CDRN (Visa): a dispute about to be filed; refund in time to stop it
//   rdr            Verifi Rapid Dispute Resolution (Visa): the merchant's own rules decide
//                  at once (refund or not); it arrives already decided
//   order_insight  Visa Order Insight: the issuer looked up the order while the cardholder
//                  was on the line; sharing the details can stop the dispute (CE 3.0)
//   consumer_clarity  Mastercard Consumer Clarity: the same, for Mastercard
// A refund keeps the chargeback off the network ratio (chargebackRatio.mjs); a chargeback
// counts on arrival whatever the outcome. Response windows below are typical; the
// merchant's contract with the provider is what applies. Plain functions, no imports.
// The SQL is supabase_predispute.sql; alerts arrive through api/intake.js { preDispute }.

const HOUR = 3600000
export const SOURCES = {
  ethoca: { label: 'Ethoca alert', network: 'Mastercard', hours: 72, kind: 'refund',
    what: 'The issuer confirmed fraud or a dispute. Refund within the window and no chargeback follows.' },
  cdrn: { label: 'Verifi CDRN', network: 'Visa', hours: 72, kind: 'refund',
    what: 'A dispute is about to be filed. Refund within the window and it stops.' },
  rdr: { label: 'Verifi RDR', network: 'Visa', hours: 0, kind: 'decided',
    what: 'Decided at once by your Rapid Dispute Resolution rules. Nothing to do unless the rules need changing.' },
  order_insight: { label: 'Visa Order Insight', network: 'Visa', hours: 0, kind: 'lookup',
    what: 'The issuer looked up this order while the cardholder was on the phone. The order details you share can stop the dispute.' },
  consumer_clarity: { label: 'Mastercard Consumer Clarity', network: 'Mastercard', hours: 0, kind: 'lookup',
    what: 'The issuer looked up this order while the cardholder was on the phone. The order details you share can stop the dispute.' },
}
export const REASONS = { fraud: 'Cardholder says it’s fraud', dispute: 'Cardholder disputes the purchase', unknown: 'Reason not given' }
// Where an alert is
//   open       waiting on the merchant (refund-kind alerts, in their window)
//   refunded   refunded in time: no chargeback      already_refunded   it was refunded before the alert
//   declined   the merchant lets it go to a chargeback, with a reason
//   expired    the window passed with no answer: expect a chargeback
//   rdr_refunded / rdr_declined   decided by the RDR rules
//   shared     order details were shared (lookups)
//   acknowledged  the bank had already filed the chargeback (Ethoca says so on the alert):
//              a refund would pay twice, so it's acknowledged and answered on Desk
export const STATUSES = {
  open: 'Waiting on you', refunded: 'Refunded in time', already_refunded: 'Already refunded', declined: 'Let it go to a chargeback',
  expired: 'Window passed', rdr_refunded: 'Refunded by your RDR rules', rdr_declined: 'Declined by your RDR rules', shared: 'Order details shared',
  acknowledged: 'Already a chargeback: answer it on Desk',
}
export const AVOIDED = ['refunded', 'already_refunded', 'rdr_refunded']   // no chargeback follows
export const DECLINE_REASONS = ['Delivered, with proof of delivery', 'The cardholder used the service', 'Already disputed: answering the chargeback instead', 'A known abuse pattern on this customer', 'Above what we refund without a fight']

const str = (v, n) => String(v ?? '').trim().slice(0, n)
const isTs = v => v != null && v !== '' && !isNaN(new Date(v).getTime())

// An alert as a provider (or the merchant's systems) sent it → { alert, errors }
export function normaliseAlert(a, now = new Date()) {
  const errors = []
  if (!a || typeof a !== 'object') return { alert: null, errors: ['Send each alert as an object'] }
  const source = SOURCES[a.source] ? a.source : null
  if (!source) errors.push(`source must be one of ${Object.keys(SOURCES).join(', ')}`)
  const id = str(a.id, 120)
  if (!id) errors.push('id is required: the provider’s alert id, so a retry isn’t stored twice')
  const amount = Number(a.amount)
  if (!isFinite(amount) || amount <= 0) errors.push('amount is required')
  const receivedAt = isTs(a.receivedAt) ? new Date(a.receivedAt) : now
  const hours = isFinite(Number(a.respondWithinHours)) && Number(a.respondWithinHours) > 0 ? Math.min(240, Number(a.respondWithinHours)) : (SOURCES[source]?.hours || 0)
  // The bank filed before (or as) it warned: Ethoca marks these. Refunding now pays twice.
  const cbFiled = SOURCES[source]?.kind === 'refund' && (a.chargebackFiled === true || a.outcome === 'chargeback_filed')
  const decided = source === 'rdr' ? (a.rdrDecision === 'refund' ? 'rdr_refunded' : a.rdrDecision === 'decline' ? 'rdr_declined' : null) : null
  if (source === 'rdr' && !decided) errors.push('rdrDecision is required for an RDR alert: refund or decline')
  return { errors, alert: {
    externalId: id, source, network: SOURCES[source]?.network || '',
    amount: Math.round(Math.abs(amount) * 100) / 100, currency: str(a.currency || 'USD', 3).toUpperCase(),
    reason: REASONS[a.reason] ? a.reason : 'unknown', reasonCode: str(a.reasonCode, 12),
    descriptor: str(a.descriptor, 160), orderId: str(a.orderId, 120), arn: str(a.arn, 40).replace(/\s/g, ''), cardLast4: String(a.cardLast4 ?? '').replace(/\D/g, '').slice(-4),
    transactionAt: isTs(a.transactionAt) ? new Date(a.transactionAt).toISOString() : null, receivedAt: receivedAt.toISOString(),
    respondBy: hours ? new Date(receivedAt.getTime() + hours * HOUR).toISOString() : null,
    status: decided || (SOURCES[source]?.kind === 'lookup' ? (a.shared === true ? 'shared' : 'open') : 'open'),
    note: str(a.note, 500), cbFiled,
  } }
}

// Is it still waiting, and how long is left? → { open, late, left (ms) }
export function clockOf(alert, now = new Date()) {
  if (alert.status !== 'open') return { open: false }
  if (!alert.respondBy) return { open: true, late: false, left: null }
  const left = new Date(alert.respondBy) - now
  return { open: true, late: left < 0, left }
}
// An open alert past its window becomes 'expired' (the server and the demo both call this)
export const settle = (alert, now = new Date()) => clockOf(alert, now).late ? { ...alert, status: 'expired' } : alert

// What we'd do, and why, from the merchant's own settings (Settings → Chargebacks against you)
//   refund when a chargeback would cost more than the sale is worth fighting for, or the
//   issuer has confirmed fraud; otherwise look at the order before deciding
export function recommend(alert, settings = {}) {
  const src = SOURCES[alert.source]
  if (!src || alert.status !== 'open') return null
  if (alert.cbFiled) return { action: 'answer', why: 'The bank already filed the chargeback. Refunding now would pay twice, because the chargeback takes the money back as well. Acknowledge the alert, then answer the chargeback on Desk.' }
  if (src.kind === 'lookup') return { action: 'share', why: 'Share the order: what was bought, where it went, and the customer’s earlier undisputed orders. Visa’s Compelling Evidence 3.0 counts two earlier orders from the same customer.' }
  const fight = Number(settings.mchFightCost) || 25, below = Number(settings.mchAcceptBelow) || 25
  const fee = 15   // a typical chargeback fee from the acquirer; the real one is in the merchant's contract
  if (alert.reason === 'fraud') return { action: 'refund', why: `The issuer says it’s fraud: a chargeback is likely to be lost, and it would count against your ${src.network} ratio. Refunding costs the sale and nothing more.` }
  if (alert.amount <= Math.max(below, fight + fee)) return { action: 'refund', why: `At ${alert.amount.toFixed(2)} ${alert.currency}, fighting costs about ${fight + fee} (your response cost plus a typical chargeback fee) and the chargeback counts against your ratio either way.` }
  return { action: 'look', why: 'Worth checking the order first: if it was delivered and you have proof, you can let it go and answer the chargeback. Otherwise refunding keeps it off your ratio.' }
}

// The month's figures, for the panel's header
export function summary(alerts, now = new Date()) {
  const month = alerts.filter(a => now - new Date(a.receivedAt) < 30 * 86400000)
  const avoided = month.filter(a => AVOIDED.includes(a.status))
  return {
    open: alerts.filter(a => a.status === 'open' && (a.respondBy || SOURCES[a.source]?.kind === 'lookup')).length,
    late: alerts.filter(a => clockOf(a, now).late).length,
    avoided: avoided.length, avoidedAmount: avoided.reduce((s, a) => s + a.amount, 0),
    toChargeback: month.filter(a => ['declined', 'expired', 'rdr_declined', 'acknowledged'].includes(a.status)).length,
    month: month.length,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS FROM THE BANK'S APP — shared rules (api/claims.js and 001 Triage → Claims)
// ═══════════════════════════════════════════════════════════════════════════════
// A customer reports a problem in the bank's app (or on the web, or to an agent
// or on the phone) and the bank's systems post it to /api/claims. These rules
// check the claim, start the right clock from the moment the customer reported
// it, and say whether it's complete enough to go straight to the Dispute Desk.
// Plain functions, no imports beyond clocks.mjs, so the server and the browser
// judge a claim the same way.
import { addBusinessDays } from './clocks.mjs'

export const CHANNELS = { app: 'From app', web: 'Web', agent: 'Agent', phone: 'Phone' }
export const ACCOUNT_TYPES = ['debit', 'credit', 'p2p', 'ach_eft', 'bnpl', 'crypto']
// The same values as Triage's claim type list
export const CLAIM_TYPES = {
  unauth_card_present: 'Unauthorized — card lost or stolen', unauth_cnp: 'Unauthorized — online', ato: 'Account takeover', counterfeit: 'Counterfeit / skimming',
  non_receipt: 'Didn’t receive it', not_as_described: 'Not as described', cancelled_sub: 'Cancelled, still charged', billing_error: 'Billing error', duplicate_charge: 'Charged twice',
  romance_scam: 'Romance scam', investment_scam: 'Investment scam', impersonation: 'Impersonation scam', fake_invoice: 'Fake invoice', grandparent_scam: 'Emergency scam', other_app: 'Other scam',
  other: 'Something else',
}
// Where a claim is, in words the bank can show its customer
export const STATUSES = {
  received: 'Received', in_review: 'Being reviewed', with_desk: 'Investigating', closed: 'Closed',
}
export const MAX_TX = 25, MAX_ANSWERS = 40, MAX_ATTACHMENTS = 20

const str = (v, n) => String(v ?? '').trim().slice(0, n)
const isTs = v => v != null && v !== '' && !isNaN(new Date(v).getTime())
const iso = v => new Date(v).toISOString()

// Check a claim as the bank sent it. Returns { claim, errors }: errors are fatal,
// anything else missing only keeps it from being Ready for Desk.
export function normaliseClaim(b, now = new Date()) {
  const errors = []
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { claim: null, errors: ['Send the claim as a JSON object'] }
  const id = str(b.id, 120)
  if (!id) errors.push('id is required: your own reference for this claim, so a retry isn’t stored twice')
  const c = b.customer && typeof b.customer === 'object' ? b.customer : {}
  if (!str(c.id, 120)) errors.push('customer.id is required')
  const txIn = Array.isArray(b.transactions) ? b.transactions : []
  if (!txIn.length) errors.push('transactions needs at least one transaction from your records')
  if (txIn.length > MAX_TX) errors.push(`At most ${MAX_TX} transactions per claim`)
  const transactions = txIn.slice(0, MAX_TX).map((t, i) => {
    const amount = Number(t?.amount)
    if (!t?.id || !isFinite(amount) || !isTs(t?.ts)) errors.push(`transactions[${i}]: id, ts (ISO 8601) and amount are required`)
    return { id: str(t?.id, 120), ts: isTs(t?.ts) ? iso(t.ts) : null, amount: Math.abs(amount) || 0, currency: str(t?.currency || 'USD', 3).toUpperCase(),
      merchant: str(t?.merchant, 160), merchantCategory: str(t?.merchantCategory, 80), merchantLocation: str(t?.merchantLocation, 120), network: str(t?.network, 40), channel: str(t?.channel, 40) }
  })
  const reportedAt = isTs(b.reportedAt) ? new Date(b.reportedAt) : now
  if (reportedAt > new Date(now.getTime() + 5 * 60000)) errors.push('reportedAt is in the future')

  const answersIn = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : {}
  const answers = {}
  Object.keys(answersIn).slice(0, MAX_ANSWERS).forEach(k => {
    const v = answersIn[k]
    answers[str(k, 60)] = typeof v === 'boolean' || typeof v === 'number' ? v : str(v, 500)
  })
  const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, MAX_ATTACHMENTS).map(a => ({
    name: str(a?.name, 160), type: str(a?.type, 80), size: Number(a?.size) || 0,
    url: /^https:\/\//i.test(String(a?.url || '')) ? str(a.url, 1000) : '',   // a link in the bank's own storage; Covalence doesn't fetch it
  })).filter(a => a.name || a.url)
  const consentIn = b.consent && typeof b.consent === 'object' ? b.consent : {}
  const consent = { given: consentIn.given === true, at: isTs(consentIn.at) ? iso(consentIn.at) : null, text: str(consentIn.text, 1000) }

  const claim = {
    externalId: id,
    channel: Object.keys(CHANNELS).includes(b.channel) ? b.channel : 'app',
    segment: b.segment === 'ce' ? 'ce' : 'fi',
    reportedAt: reportedAt.toISOString(),
    claimType: Object.keys(CLAIM_TYPES).includes(b.claimType) ? b.claimType : '',
    customer: { id: str(c.id, 120), name: str(c.name, 120), email: str(c.email, 160), phone: str(c.phone, 40),
      accountType: ACCOUNT_TYPES.includes(c.accountType) ? c.accountType : '', accountOpened: isTs(c.accountOpened) ? iso(c.accountOpened).slice(0, 10) : '' },
    transactions, answers, attachments, consent,
    statement: str(b.statement, 4000),
  }
  return { claim, errors }
}

// The clock that starts when the customer reports it
//   Reg E (debit, ACH, P2P): decide, or give provisional credit, within 10 business days
//   Reg Z (credit cards): acknowledge in writing within 30 days
export function claimClock(claim) {
  const t = claim?.customer?.accountType, start = String(claim?.reportedAt || '').slice(0, 10)
  if (!start) return null
  if (['debit', 'p2p', 'ach_eft'].includes(t)) return { rule: 'Reg E', what: 'Decide or give provisional credit', due: ymd(addBusinessDays(start, 10)) }
  if (t === 'credit') { const d = new Date(start + 'T12:00:00'); d.setDate(d.getDate() + 30); return { rule: 'Reg Z', what: 'Acknowledge in writing', due: ymd(d) } }
  return null
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// What's missing before an analyst could send it straight to the Desk
export function missingForDesk(claim) {
  const m = []
  if (!claim.claimType) m.push('what kind of problem it is (claimType)')
  if (!claim.customer.accountType) m.push('the account type')
  if (claim.transactions.some(t => !t.merchant)) m.push('the merchant on every transaction')
  if (claim.statement.length < 20) m.push('the customer’s own account of what happened')
  if (!claim.consent.given) m.push('the customer’s consent')
  if (/^unauth|^ato|^counterfeit/.test(claim.claimType) && claim.answers.recognisesTransaction !== false) m.push('the customer’s answer to “Is this yours?”')
  return m
}

export const claimTotal = claim => (claim?.transactions || []).reduce((s, t) => s + (Number(t.amount) || 0), 0)

// Covalence's id for a claim: the same bank reference always gives the same id
export const claimIdFrom = hex => 'CLM-' + hex.slice(0, 10).toUpperCase()

// What the bank's app can show its customer (the GET answer and status events)
export const publicStatus = row => ({
  id: row.id, reference: row.external_id ?? row.externalId, status: row.status, statusText: STATUSES[row.status] || row.status,
  receivedAt: row.created_at ?? row.createdAt, updatedAt: row.updated_at ?? row.updatedAt,
  ...(row.history?.some(h => h.outcome) ? { outcome: row.history.findLast(h => h.outcome).outcome } : {}),
  history: (row.history || []).map(h => ({ status: h.status, ...(h.step ? { step: h.step } : {}), at: h.at, ...(h.public ? { note: h.public } : {}) })),
})

// ── Customers waiting ──
// An open claim whose customer hasn't been told anything (a status they can see, or a
// note for them) in UPDATE_DAYS days or more. Oldest silence first.
export const UPDATE_DAYS = 5
export const lastToldAt = row => [row.created_at ?? row.createdAt, ...(row.history || []).filter(h => h.public || h.status).map(h => h.at)]
  .filter(Boolean).map(t => new Date(t).getTime()).reduce((a, b) => Math.max(a, b), 0)
export const silentDays = (row, now = new Date()) => Math.floor((now - lastToldAt(row)) / 86400000)
export const waitingClaims = (rows, now = new Date()) => (rows || [])
  .filter(r => r.status !== 'closed' && lastToldAt(r) && silentDays(r, now) >= UPDATE_DAYS)
  .sort((a, b) => lastToldAt(a) - lastToldAt(b))

// ── Steps on the Desk ──
// Once a claim is with the Desk, three moves on its case are sent to the bank's
// app as their own events (claim.provisional_credit, claim.filed, claim.resolved),
// each once. Resolving the case closes the claim.
export const STEPS = { provisional_credit: 'Provisional credit given', filed: 'Dispute filed', resolved: 'Resolved' }
export const OUTCOMES = { won: 'In the customer’s favour', lost: 'The charge stands', withdrawn: 'Withdrawn', resolved: 'Resolved' }
// What the bank may show its customer at each step (wording to review with counsel)
export const STEP_NOTES = {
  provisional_credit: 'We’ve given you a temporary credit while we investigate.',
  filed: 'We’ve formally disputed the transaction with the merchant’s bank.',
  won: 'Your claim was resolved in your favour.',
  lost: 'We’ve finished investigating and the charge stands. We’ll write to you with the reasons.',
  withdrawn: 'Your claim was withdrawn.',
  resolved: 'Your claim is resolved.',
}
const FILED = ['filed', 'representment', 'pre_arb', 'submitted'], ENDED = ['won', 'lost', 'withdrawn', 'resolved']

// The steps a case linked to a claim reached between two saves: [{ claimId, caseId, step, outcome? }].
// Only cases that existed before count, so loading cases on a new device sends nothing.
export function caseSteps(before, after) {
  const was = new Map((before || []).map(c => [c.id, c])), out = []
  for (const c of after || []) {
    const p = was.get(c.id), claimId = c.intake?.claimId
    if (!p || !claimId) continue
    const add = (step, extra) => out.push({ claimId, caseId: c.id, step, ...extra })
    if ((c.provCreditDate || c.pcIssued) && !(p.provCreditDate || p.pcIssued)) add('provisional_credit')
    if (FILED.includes(c.status) && !FILED.includes(p.status) && !ENDED.includes(p.status)) add('filed')
    if (ENDED.includes(c.status) && !ENDED.includes(p.status)) add('resolved', { outcome: c.status })
  }
  return out
}

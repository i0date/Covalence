// ═══════════════════════════════════════════════════════════════════════════════
// THE HOSTED CLAIM FORM — links, branding, and turning an answer into a claim
// ═══════════════════════════════════════════════════════════════════════════════
// For banks without developers. The bank's systems (POST /api/claims { link }) or
// an agent in Triage → Claims make a link for one customer and the transactions
// from the bank's records; the customer opens /claim/<token>, says whether they
// recognise each payment, picks what went wrong, answers the questions for it and
// sends the claim. It's stored like a claim from the bank's app, tagged Web.
// Plain functions, imports only claims.mjs, so the server and the browser agree.
// The SQL is supabase_claim_links.sql.
import { ACCOUNT_TYPES, MAX_TX } from './claims.mjs'

export const LINK_HOURS = 72, MAX_LINK_HOURS = 168
export const TOKEN_RE = /^cvf_[a-f0-9]{48}$/
export const linkIdFrom = hex => 'LNK-' + hex.slice(0, 8).toUpperCase()

// What the customer agrees to before sending (wording to review with counsel)
export const CONSENT_TEXT = 'I confirm that what I’ve said is true to the best of my knowledge, and I agree that the bank may investigate, contact the merchant, and share what’s needed to resolve my claim.'

// The kinds of problem the customer chooses from, in their words, grouped.
// Values are claim types from claims.mjs.
export const FORM_TYPES = [
  { group: 'I didn’t make this payment', types: [
    ['unauth_cnp', 'Someone used my card or account online'],
    ['unauth_card_present', 'My card was lost or stolen'],
    ['ato', 'Someone got into my account'],
  ] },
  { group: 'There’s a problem with something I paid for', types: [
    ['non_receipt', 'I didn’t receive it'],
    ['not_as_described', 'It wasn’t what I was promised'],
    ['cancelled_sub', 'I cancelled, but I’m still being charged'],
    ['duplicate_charge', 'I was charged twice'],
    ['billing_error', 'I was charged the wrong amount'],
  ] },
  { group: 'I was tricked into paying', types: [
    ['impersonation', 'Someone pretended to be the bank, the police or a company'],
    ['investment_scam', 'An investment that turned out to be fake'],
    ['romance_scam', 'Someone I met online or on a dating app'],
    ['fake_invoice', 'A bill or invoice that wasn’t real'],
    ['other_app', 'Another kind of scam'],
  ] },
  { group: 'Something else', types: [['other', 'Something else']] },
]

const str = (v, n) => String(v ?? '').trim().slice(0, n)
const isTs = v => v != null && v !== '' && !isNaN(new Date(v).getTime())

// A link as the bank asked for it → { link, errors }
export function normaliseLink(b, now = new Date()) {
  const errors = []
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { link: null, errors: ['Send the link as a JSON object'] }
  const c = b.customer && typeof b.customer === 'object' ? b.customer : {}
  if (!str(c.id, 120)) errors.push('customer.id is required')
  const txIn = Array.isArray(b.transactions) ? b.transactions : []
  if (!txIn.length) errors.push('transactions needs at least one transaction from your records')
  if (txIn.length > MAX_TX) errors.push(`At most ${MAX_TX} transactions per link`)
  const transactions = txIn.slice(0, MAX_TX).map((t, i) => {
    const amount = Number(t?.amount)
    if (!str(t?.id, 120) || !isFinite(amount) || !isTs(t?.ts)) errors.push(`transactions[${i}]: id, ts (ISO 8601) and amount are required`)
    return { id: str(t?.id, 120), ts: isTs(t?.ts) ? new Date(t.ts).toISOString() : null, amount: Math.abs(amount) || 0, currency: str(t?.currency || 'USD', 3).toUpperCase(),
      merchant: str(t?.merchant, 160), merchantCategory: str(t?.merchantCategory, 80), merchantLocation: str(t?.merchantLocation, 120),
      network: str(t?.network, 40), channel: str(t?.channel, 40), merchantLogo: /^https:\/\//i.test(String(t?.merchantLogo || '')) ? str(t.merchantLogo, 500) : '' }
  })
  const email = str(c.email, 160)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('customer.email doesn’t look like an email address')
  const hours = Math.min(MAX_LINK_HOURS, Math.max(1, Math.round(Number(b.expiresInHours) || LINK_HOURS)))
  return { errors, link: {
    reference: str(b.reference, 120),
    customer: { id: str(c.id, 120), name: str(c.name, 120), email, phone: str(c.phone, 40),
      accountType: ACCOUNT_TYPES.includes(c.accountType) ? c.accountType : '', accountOpened: isTs(c.accountOpened) ? new Date(c.accountOpened).toISOString().slice(0, 10) : '' },
    transactions, expiresAt: new Date(now.getTime() + hours * 3600000).toISOString(),
  } }
}

// Can the link still be used? → '' or why not, in words for the customer
export function linkProblem(row, now = new Date()) {
  if (!row) return 'This link isn’t valid. Check you copied all of it, or ask the bank for a new one.'
  if (row.revoked_at) return 'This link has been cancelled. Ask the bank for a new one.'
  if (row.used_at) return 'This claim has already been sent. The bank will be in touch.'
  if (new Date(row.expires_at) < now) return 'This link has expired. Ask the bank for a new one.'
  return ''
}

// Where the link is, for the list in Triage → Claims
export function linkState(row, now = new Date()) {
  if (row.used_at) return { key: 'used', label: 'Claim sent' }
  if (row.revoked_at) return { key: 'revoked', label: 'Cancelled' }
  if (new Date(row.expires_at) < now) return { key: 'expired', label: 'Expired' }
  if (row.opened_at) return { key: 'opened', label: 'Opened' }
  return { key: 'waiting', label: 'Not opened yet' }
}

// The bank's look on the form, checked. Anything missing falls back to plain Covalence styling.
export function normaliseBrand(f = {}, institution = '') {
  const accent = /^#[0-9a-f]{6}$/i.test(String(f.accent || '')) ? f.accent : ''
  return {
    name: str(f.display_name || f.displayName || institution, 120) || 'Your bank',
    accent, logo: /^https:\/\//i.test(String(f.logo_url || f.logoUrl || '')) ? str(f.logo_url || f.logoUrl, 500) : '',
    phone: str(f.support_phone || f.supportPhone, 40),
    help: /^https:\/\//i.test(String(f.help_url || f.helpUrl || '')) ? str(f.help_url || f.helpUrl, 500) : '',
  }
}
// Text on the accent colour: dark or light, whichever reads better
export function onAccent(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '')
  if (!m) return '#FFFFFF'
  const [r, g, b] = m.slice(1).map(x => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1A1814' : '#FFFFFF'
}

// What the customer sent → the claim body for normaliseClaim. link: the stored link.
//   sent: { recognised: { txId: true|false }, claimType, answers, statement, consent: true }
// Only transactions the customer doesn't recognise (or, for a purchase problem, all of
// the ones they picked) go on the claim. If they recognise every one, it's kept as a
// claim closed at intake, the same as "That was me" from the bank's app.
export function claimFromForm(link, sent, now = new Date()) {
  const s = sent && typeof sent === 'object' ? sent : {}
  const rec = s.recognised && typeof s.recognised === 'object' ? s.recognised : {}
  const picked = Array.isArray(s.transactionIds) && s.transactionIds.length ? new Set(s.transactionIds.map(String)) : null
  let txs = (link.transactions || []).filter(t => !picked || picked.has(t.id))
  const allRecognised = txs.length > 0 && txs.every(t => rec[t.id] === true)
  if (!allRecognised && Object.keys(rec).length) txs = txs.filter(t => rec[t.id] !== true)
  const answers = { ...(s.answers && typeof s.answers === 'object' && !Array.isArray(s.answers) ? s.answers : {}) }
  if (Object.keys(rec).length) answers.recognisesTransaction = allRecognised
  return {
    id: link.id, channel: 'web', reportedAt: now.toISOString(),
    claimType: allRecognised ? (s.claimType || 'unauth_cnp') : str(s.claimType, 40),
    customer: link.customer, transactions: txs, answers,
    statement: str(s.statement, 4000), attachments: [],
    consent: { given: s.consent === true, at: s.consent === true ? now.toISOString() : null, text: CONSENT_TEXT },
  }
}

// The link's own URL
export const linkUrl = (origin, token) => `${String(origin || '').replace(/\/+$/, '')}/claim/${token}`

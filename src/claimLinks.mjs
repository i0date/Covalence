// ═══════════════════════════════════════════════════════════════════════════════
// THE HOSTED CLAIM FORM — links, branding, and turning an answer into a claim
// ═══════════════════════════════════════════════════════════════════════════════
// For banks without developers to build claim screens of their own. A customer who
// sees something wrong taps "Report a problem" in the bank's app or on its website;
// the bank's systems ask for a link (POST /api/claims { link }) for that customer and
// the payments from its records, and open it. On /claim/<token> the customer picks
// what went wrong, says whether they recognise each payment, asks for what they need
// now (lock the card, …), answers the questions for it and sends the claim.
// The payments the bank puts forward are a start, not a limit: fraud is often found on a
// statement weeks later, so the customer can search back through about 13 months of their
// own payments (the link's history, and any the bank sends Covalence for monitoring), or
// describe one they can't find for an analyst to trace. Old payments are never refused.
// Everything is in the bank's name; what the customer asks for now goes to the bank's
// systems while they wait, and only what those systems confirm is shown as done. It's stored
// like a claim from the bank's app, tagged Web: fraud and scams to Triage, disputes
// about a purchase straight to the Dispute Desk. Covalence never sends these links.
// Plain functions, imports only claims.mjs and claimQuestions.mjs, so the server and the browser agree.
// The SQL is supabase_claim_links.sql.
import { ACCOUNT_TYPES, MAX_TX, SEGMENTS, TYPES_FOR, INSTRUCTIONS, instructionsFor } from './claims.mjs'
import { publicQuestions } from './claimQuestions.mjs'

export const LINK_HOURS = 72, MAX_LINK_HOURS = 168
export const MAX_HISTORY = 1000, HISTORY_DAYS = 400   // what the customer can search: about 13 months
export const TOKEN_RE = /^cvf_[a-f0-9]{48}$/
export const linkIdFrom = hex => 'LNK-' + hex.slice(0, 8).toUpperCase()

// What the customer agrees to before sending (wording to review with counsel)
export const CONSENT = {
  fi: 'I confirm that what I’ve said is true to the best of my knowledge, and I agree that the bank may investigate, contact the merchant, and share what’s needed to resolve my claim.',
  ce: 'I confirm that what I’ve said is true to the best of my knowledge, and I agree that the exchange may investigate, trace the funds, contact other platforms, and share what’s needed to resolve my report.',
  mx: 'I confirm that what I’ve said is true to the best of my knowledge, and I agree that the shop may look into my order and contact me about it.',
}
export const CONSENT_TEXT = CONSENT.fi

// The kinds of problem the customer chooses from, in their words, grouped, for each side:
// a bank (fi), a crypto exchange (ce), a merchant (mx). Values are claim types from claims.mjs.
export const FORM_TYPES = {
  fi: [
    { group: 'I didn’t make this payment', types: [
      ['unauth_cnp', 'Someone used my card or account online'],
      ['unauth_card_present', 'My card was lost or stolen'],
      ['ato', 'Someone got into my account'],
    ] },
    { group: 'There’s a problem with something I paid for', types: [
      ['non_receipt', 'I didn’t receive it'],
      ['partial_delivery', 'Only part of my order arrived'],
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
  ],
  ce: [
    { group: 'Someone else did this', types: [
      ['unauth_withdrawal', 'A withdrawal I didn’t make'],
      ['ato', 'Someone got into my account'],
    ] },
    { group: 'A transfer went wrong', types: [
      ['deposit_missing', 'My deposit hasn’t arrived'],
      ['withdrawal_missing', 'My withdrawal hasn’t arrived'],
      ['wrong_address', 'I sent it to the wrong address or network'],
    ] },
    { group: 'I was tricked into sending crypto', types: [
      ['investment_scam', 'An investment or trading platform that turned out to be fake'],
      ['romance_scam', 'Someone I met online or on a dating app'],
      ['impersonation', 'Someone pretended to be the exchange, the police or a company'],
      ['other_app', 'Another kind of scam'],
    ] },
    { group: 'Something else', types: [['other', 'Something else']] },
  ],
  mx: [
    { group: 'A problem with my order', types: [
      ['non_receipt', 'It didn’t arrive'],
      ['partial_delivery', 'Only part of it arrived'],
      ['wrong_item', 'I got the wrong item'],
      ['not_as_described', 'It’s damaged or not as described'],
    ] },
    { group: 'A problem with a payment', types: [
      ['refund_not_received', 'I haven’t had my refund'],
      ['cancelled_sub', 'I cancelled, but I’m still being charged'],
      ['duplicate_charge', 'I was charged twice'],
      ['billing_error', 'I was charged the wrong amount'],
      ['unauth_cnp', 'I don’t recognise this charge'],
    ] },
    { group: 'Something else', types: [['other', 'Something else']] },
  ],
}
// Everything the form needs for a side: the kinds, their questions and what the customer can ask for
export const formFor = (segment, accountType = '') => {
  const seg = SEGMENTS[segment] ? segment : 'fi'
  return { segment: seg, types: FORM_TYPES[seg],
    questions: Object.fromEntries(TYPES_FOR[seg].map(k => [k, publicQuestions(k, accountType, seg)])),
    instructions: Object.fromEntries(TYPES_FOR[seg].map(k => [k, instructionsFor(k, seg).map(value => ({ value, label: INSTRUCTIONS[value] }))])), consentText: CONSENT[seg] }
}

const str = (v, n) => String(v ?? '').trim().slice(0, n)
const isTs = v => v != null && v !== '' && !isNaN(new Date(v).getTime())

// A link as the bank asked for it → { link, errors }
export function normaliseLink(b, now = new Date()) {
  const errors = []
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { link: null, errors: ['Send the link as a JSON object'] }
  const c = b.customer && typeof b.customer === 'object' ? b.customer : {}
  if (!str(c.id, 120)) errors.push('customer.id is required')
  const txIn = Array.isArray(b.transactions) ? b.transactions : []
  const histIn = Array.isArray(b.history) ? b.history : []
  if (!txIn.length && !histIn.length) errors.push('Send at least one transaction: the ones the customer tapped (transactions), or their recent payments to search (history)')
  if (txIn.length > MAX_TX) errors.push(`At most ${MAX_TX} transactions per link`)
  if (histIn.length > MAX_HISTORY) errors.push(`At most ${MAX_HISTORY} payments in history`)
  const transactions = txIn.slice(0, MAX_TX).map((t, i) => {
    if (!str(t?.id, 120) || !isFinite(Number(t?.amount)) || !isTs(t?.ts)) errors.push(`transactions[${i}]: id, ts (ISO 8601) and amount are required`)
    return txOf(t)
  })
  // The customer's other payments, to search: bad rows and anything older than about 13 months are left out
  const oldest = now.getTime() - HISTORY_DAYS * 86400000, given = new Set(transactions.map(t => t.id))
  const history = histIn.slice(0, MAX_HISTORY).filter(t => str(t?.id, 120) && isFinite(Number(t?.amount)) && isTs(t?.ts) && new Date(t.ts).getTime() >= oldest && !given.has(str(t.id, 120))).map(txOf)
  const email = str(c.email, 160)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('customer.email doesn’t look like an email address')
  const hours = Math.min(MAX_LINK_HOURS, Math.max(1, Math.round(Number(b.expiresInHours) || LINK_HOURS)))
  return { errors, link: {
    reference: str(b.reference, 120), segment: SEGMENTS[b.segment] ? b.segment : 'fi',
    customer: { id: str(c.id, 120), name: str(c.name, 120), email, phone: str(c.phone, 40),
      accountType: ACCOUNT_TYPES.includes(c.accountType) ? c.accountType : '', accountOpened: isTs(c.accountOpened) ? new Date(c.accountOpened).toISOString().slice(0, 10) : '' },
    transactions, history, expiresAt: new Date(now.getTime() + hours * 3600000).toISOString(),
  } }
}

function txOf(t) {
  return { id: str(t?.id, 120), ts: isTs(t?.ts) ? new Date(t.ts).toISOString() : null, amount: Math.abs(Number(t?.amount)) || 0, currency: str(t?.currency || 'USD', 3).toUpperCase(),
    merchant: str(t?.merchant, 160), merchantCategory: str(t?.merchantCategory, 80), merchantLocation: str(t?.merchantLocation, 120),
    network: str(t?.network, 40), channel: str(t?.channel, 40), merchantLogo: /^https:\/\//i.test(String(t?.merchantLogo || '')) ? str(t.merchantLogo, 500) : '' }
}

// Everything the customer can search beyond the link's own payments, newest first: the link's
// history and the payments out of their account that the bank sends for monitoring (tm_transactions rows)
export function searchPool(link, tmRows = [], now = new Date()) {
  const oldest = now.getTime() - HISTORY_DAYS * 86400000, seen = new Set((link?.transactions || []).map(t => t.id)), out = []
  const add = t => { if (t.id && !seen.has(t.id) && t.ts && new Date(t.ts).getTime() >= oldest) { seen.add(t.id); out.push(t) } }
  ;(link?.history || []).forEach(t => add(txOf(t)))
  ;(tmRows || []).filter(r => !r.direction || r.direction === 'out').forEach(r => add(txOf({ id: r.id, ts: r.ts, amount: r.amount, currency: r.currency, merchant: r.counterparty || r.description, channel: r.channel })))
  return out.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, MAX_HISTORY)
}

// A payment the customer couldn't find, in their words: { on: YYYY-MM-DD (roughly), amount, to, note }
export function describedTx(d, currency = 'USD') {
  if (!d || typeof d !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.on || ''))) return null
  const amount = Math.abs(Number(d.amount))
  if (!isFinite(amount) || amount <= 0) return null
  return { id: 'DESCRIBED-1', ts: new Date(d.on + 'T12:00:00Z').toISOString(), amount, currency,
    merchant: str(d.to, 160) || 'Not sure who', merchantCategory: '', merchantLocation: '', network: '', channel: '', described: true }
}

// Can the link still be used? → '' or why not, in words for the customer (of a bank, an exchange or a shop)
export function linkProblem(row, now = new Date()) {
  const who = row?.segment === 'ce' ? 'the exchange' : row?.segment === 'mx' ? 'the shop' : 'the bank'
  if (!row) return 'This link isn’t valid. Check you copied all of it, or ask for a new one.'
  if (row.revoked_at) return `This link has been cancelled. Ask ${who} for a new one.`
  if (row.used_at) return `This has already been sent. ${who.replace(/^./, c => c.toUpperCase())} will be in touch.`
  if (new Date(row.expires_at) < now) return `This link has expired. Ask ${who} for a new one.`
  return ''
}

// The bank's name, logo and phone on the form (the form itself is in Covalence's style)
export function normaliseBrand(f = {}, institution = '') {
  return {
    name: str(f.display_name || f.displayName || institution, 120),   // never a placeholder: no link is made without a name
    logo: /^https:\/\//i.test(String(f.logo_url || f.logoUrl || '')) ? str(f.logo_url || f.logoUrl, 500) : '',
    phone: str(f.support_phone || f.supportPhone, 40),
    help: /^https:\/\//i.test(String(f.help_url || f.helpUrl || '')) ? str(f.help_url || f.helpUrl, 500) : '',
  }
}

// What the customer sent → the claim body for normaliseClaim. link: the stored link; pool: searchPool's payments.
//   sent: { recognised: { txId: true|false }, transactionIds?, added?: [ids from pool], described?: { on, amount, to, note },
//           claimType, answers, instructions, statement, consent: true }
// Only transactions the customer doesn't recognise (or, for a purchase problem, the ones
// they picked) go on the claim, with any they found by searching (only ids from their own
// payments count) and one they described. If they recognise every one and add nothing, it's
// kept as a claim closed at intake, the same as "That was me" from the bank's app.
export function claimFromForm(link, sent, now = new Date(), pool = []) {
  const s = sent && typeof sent === 'object' ? sent : {}
  const rec = s.recognised && typeof s.recognised === 'object' ? s.recognised : {}
  const picked = Array.isArray(s.transactionIds) ? new Set(s.transactionIds.map(String)) : null
  const byId = new Map((pool || []).map(t => [t.id, t]))
  const added = [...new Set((Array.isArray(s.added) ? s.added : []).map(String))].map(id => byId.get(id)).filter(Boolean)
  const described = describedTx(s.described, (link.transactions?.[0] || added[0])?.currency || 'USD')
  const extra = [...added, ...(described ? [described] : [])]
  let txs = (link.transactions || []).filter(t => !picked || picked.has(t.id))
  const allRecognised = !extra.length && txs.length > 0 && txs.every(t => rec[t.id] === true)
  if (!allRecognised && Object.keys(rec).length) txs = txs.filter(t => rec[t.id] !== true)
  txs = [...txs, ...extra].slice(0, MAX_TX)
  const answers = { ...(s.answers && typeof s.answers === 'object' && !Array.isArray(s.answers) ? s.answers : {}) }
  if (Object.keys(rec).length) answers.recognisesTransaction = allRecognised
  if (described && str(s.described.note, 300)) answers.describedPayment = str(s.described.note, 300)
  return {
    id: link.id, channel: 'web', segment: link.segment || 'fi', reportedAt: now.toISOString(),
    claimType: allRecognised ? (s.claimType || 'unauth_cnp') : str(s.claimType, 40),
    customer: link.customer, transactions: txs, answers,
    statement: str(s.statement, 4000), attachments: [], instructions: allRecognised || !Array.isArray(s.instructions) ? [] : s.instructions.map(String),
    consent: { given: s.consent === true, at: s.consent === true ? now.toISOString() : null, text: CONSENT[link.segment] || CONSENT.fi },
  }
}

// What the customer asked for now, as the bank's systems answered claim.instructions:
//   { "results": [{ "action": "lock_card", "done": true, "message": "Card ending 4412 is locked", "reference": "LCK-889" }] }
// Only an action the bank's systems say is done shows as done; anything else tells the
// customer to call the bank. → [{ action, done, message, reference }]
export const DONE_TEXT = { lock_card: 'Your card is locked', replace_card: 'A new card is on its way', stop_merchant: 'Payments to this merchant are blocked',
  call_me: 'We’ll call you', freeze_account: 'Your account is frozen', lock_withdrawals: 'Withdrawals are stopped', reset_security: 'Your sign-in is reset',
  refund: 'Your refund is on its way', replacement: 'A replacement is on its way', cancel_subscription: 'Your subscription is cancelled' }
export function confirmations(asked = [], reply = null) {
  const results = Array.isArray(reply?.results) ? reply.results : []
  return asked.map(action => {
    const r = results.find(x => x && x.action === action)
    const done = r?.done === true
    return { action, done, message: done ? (str(r.message, 200) || DONE_TEXT[action] || '') : '', reference: done ? str(r.reference, 60) : '' }
  })
}

// The link's own URL
export const linkUrl = (origin, token) => `${String(origin || '').replace(/\/+$/, '')}/claim/${token}`

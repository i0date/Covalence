// ═══════════════════════════════════════════════════════════════════════════════
// "IS THIS YOURS?" — the merchant made recognisable, before an unauthorised claim
// ═══════════════════════════════════════════════════════════════════════════════
// Many "unauthorised" charges are the customer's own, under a name they don't
// recognise: a processor prefix (SQ *, PAYPAL *), a parent company, a store
// number. Before the bank's app files the claim, it asks Covalence for a card per
// transaction (POST /api/claims { "isThisYours": … }) and shows the customer:
//   • the merchant's name as people know it, and who processed the payment
//   • when and where (or online), and how it shows on the statement
//   • whether they've paid this merchant before, from the bank's own transactions
//     (/api/intake), since a regular payee is rarely fraud
// "That was me" then closes the claim at intake (claims.mjs normaliseClaim).
// Logos: the bank's own if it sends one (merchantLogo, https); otherwise the
// merchant's website for known brands, so the app can use its logo service, and
// a monogram either way. Covalence calls no outside service for this.
// Plain functions, no imports, so the server and the browser agree.

// Processors and marketplaces whose prefix hides the shop's name
const PROCESSORS = [
  [/^dd\s*\*\s*(doordash\s*)?/i, 'DoorDash'], [/^(uber\s*\*?\s*eats)\s+(?!pending)/i, 'Uber Eats'],
  [/^(sq|sqsp)\s*\*\s*/i, 'Square'], [/^tst\s*\*\s*/i, 'Toast'], [/^paypal\s*\*\s*/i, 'PayPal'], [/^pp\s*\*\s*/i, 'PayPal'],
  [/^sp\s*\*?\s*/i, 'Shopify'], [/^(stripe|str)\s*\*\s*/i, 'Stripe'], [/^(google|goog)\s*\*\s*/i, 'Google Pay'], [/^ckm?\s*\*\s*/i, 'Clover'],
  [/^(pos|pur|ach|dbt|chk)\s+/i, ''], [/^(etsy\s*(inc|com)?)\s*\*?\s*/i, 'Etsy'], [/^ebay\s*\*?\s*/i, 'eBay'], [/^(in|ic)\s*\*\s*/i, ''],
]
// Well-known names that show up in short or coded forms on statements
const BRANDS = [
  [/^(amzn|amazon)(\s*mktp|\s*mktplace|\.com|\s*digital|\s*prime)?/i, 'Amazon', 'amazon.com'], [/^(nflx|netflix)/i, 'Netflix', 'netflix.com'],
  [/^spotify/i, 'Spotify', 'spotify.com'], [/^apple\b/i, 'Apple', 'apple.com'], [/^(uber\s*\*?\s*eats)/i, 'Uber Eats', 'ubereats.com'],
  [/^uber/i, 'Uber', 'uber.com'], [/^lyft/i, 'Lyft', 'lyft.com'], [/^(doordash|dd\s*\*?\s*doordash)/i, 'DoorDash', 'doordash.com'],
  [/^(wm|wal-?mart|walmart)/i, 'Walmart', 'walmart.com'], [/^target/i, 'Target', 'target.com'], [/^costco/i, 'Costco', 'costco.com'],
  [/^starbucks|^sbux/i, 'Starbucks', 'starbucks.com'], [/^(msft|microsoft)/i, 'Microsoft', 'microsoft.com'], [/^adobe/i, 'Adobe', 'adobe.com'],
  [/^(hulu)/i, 'Hulu', 'hulu.com'], [/^(disney\s*plus|disneyplus)/i, 'Disney+', 'disneyplus.com'], [/^airbnb/i, 'Airbnb', 'airbnb.com'],
  [/^(google\s*(storage|one|youtube)|youtube)/i, 'Google', 'google.com'], [/^instacart/i, 'Instacart', 'instacart.com'], [/^chewy/i, 'Chewy', 'chewy.com'],
]
const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC'
const title = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Llc|Inc|Ltd|Co)\b/g, m => m.toUpperCase() === 'LLC' ? 'LLC' : m)

// A statement descriptor → { name, via, domain }. location (e.g. "San Francisco, CA"), when
// known, is taken off the end of the descriptor too.
export function cleanDescriptor(raw, location = '') {
  let s = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!s) return { name: '', via: '', domain: '' }
  // A person-to-person payment: the payee's name as the bank wrote it
  const p2p = s.match(/^(zelle|venmo|cash app|paypal|interac|wire|ach) (to|from) (.+)$/i)
  if (p2p) return { name: p2p[3].trim(), via: p2p[1].replace(/^./, c => c.toUpperCase()).replace(/^Cash app$/i, 'Cash App'), domain: '' }
  let via = ''
  for (const [re, who] of PROCESSORS) if (re.test(s)) { s = s.replace(re, ''); if (who) via = who; break }
  s = s.replace(/\*+/g, ' ')                                         // GADGETHUB*ORDER → GADGETHUB ORDER
    .replace(/\b(www\.)?([a-z0-9-]+)\.(com|net|org|io|co)\b(\/\S*)?/i, '$2')
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, ' ') // phone numbers
    .replace(/#\s*\d+|\b(store|str|loc)\s*\d+\b|\b\d{4,}\b/gi, ' ')    // store numbers and ids
    .replace(new RegExp(`\\s+(${STATES})$`, 'i'), '')                    // a trailing state
    .replace(/\s{2,}/g, ' ').trim()
  const city = String(location || '').split(',')[0].trim()
  if (city && s.toLowerCase().endsWith(' ' + city.toLowerCase())) s = s.slice(0, -city.length).trim()
  for (const [re, name, domain] of BRANDS) if (re.test(s)) return { name, via, domain }
  return { name: title(s) || title(String(raw)), via, domain: '' }
}

// A key that matches the same merchant however the descriptor is written
export const merchantKey = (raw, location) => cleanDescriptor(raw, location).name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)

// Two letters and a colour from the name, for when there's no logo
const COLORS = ['#1E3A5F', '#065F46', '#7C2D12', '#4C1D95', '#831843', '#134E4A', '#3F3A35', '#92400E']
export function monogram(name) {
  const words = String(name || '?').split(/\s+/).filter(w => /[a-z0-9]/i.test(w))
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase()
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { letters, color: COLORS[h % COLORS.length] }
}

const money = (n, cur = 'USD') => { try { return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: /^[A-Z]{3}$/.test(cur) ? cur : 'USD' }) } catch { return `${n} ${cur}` } }
const monthYear = d => new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const ONLINE = /not_present|cnp|online|ecom|web|in_app/i

// One card for one transaction. history: the customer's earlier payments from /api/intake
// ({ ts, amount, currency, counterparty }), searched for the same merchant.
export function cardFor(tx, history = [], now = new Date()) {
  const { name, via, domain } = cleanDescriptor(tx.merchant, tx.merchantLocation)
  const key = merchantKey(tx.merchant, tx.merchantLocation), at = tx.ts ? new Date(tx.ts) : null
  const before = key ? history.filter(h => h.id !== tx.id && merchantKey(h.counterparty) === key && new Date(h.ts) < (at || now)) : []
  before.sort((a, b) => new Date(a.ts) - new Date(b.ts))
  const seen = before.length ? { count: before.length, first: before[0].ts, last: before[before.length - 1].ts,
    total: Math.round(before.reduce((s, h) => s + Math.abs(Number(h.amount) || 0), 0) * 100) / 100 } : null
  const online = ONLINE.test(tx.channel || '') || /online/i.test(tx.merchantLocation || '')
  const where = tx.merchantLocation && !/^online$/i.test(tx.merchantLocation) ? tx.merchantLocation : online ? 'Online' : ''
  const hints = []
  if (seen) hints.push(seen.count === 1 ? `You paid ${name} once before, in ${monthYear(seen.first)}.` : `You’ve paid ${name} ${seen.count} times since ${monthYear(seen.first)}.`)
  if (via) hints.push(`Paid through ${via}, so the shop’s own name may look different.`)
  if (String(tx.merchant || '').trim() && name.toLowerCase() !== String(tx.merchant).trim().toLowerCase()) hints.push(`Shows on your statement as “${String(tx.merchant).trim()}”.`)
  if (tx.merchantCategory) hints.push(`A ${String(tx.merchantCategory).toLowerCase()} purchase.`)
  return {
    transactionId: tx.id, name, via, statementName: String(tx.merchant || '').trim(),
    amount: Math.abs(Number(tx.amount) || 0), currency: tx.currency || 'USD', amountText: money(Math.abs(Number(tx.amount) || 0), tx.currency || 'USD'),
    when: tx.ts || null, where, online, category: tx.merchantCategory || '',
    logo: /^https:\/\//i.test(String(tx.merchantLogo || '')) ? String(tx.merchantLogo).slice(0, 500) : null, website: domain || null, monogram: monogram(name),
    seenBefore: seen, hints,
    question: 'Do you recognise this payment?',
    answers: [{ value: true, label: 'Yes, that was me' }, { value: false, label: 'No, I don’t recognise it' }],
  }
}

// What the customer is told when "That was me" closes the claim
export const RECOGNISED_NOTE = 'You told us you recognise this payment, so there’s nothing to dispute. If that changes, you can report it again.'
// Claim types where "Is this yours?" comes first
export const asksIsThisYours = type => !type || /^unauth|^ato|^counterfeit/.test(type)

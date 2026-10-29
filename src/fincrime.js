// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL CRIME — sanctions screening, AML signals and OSINT on the case
// ═══════════════════════════════════════════════════════════════════════════════
// Sanctions: the case's parties (cardholder, merchant / payee) and any wallet
//   addresses in it are screened against OFAC (api/sanctions.js). The result is
//   kept on the case (c.screening); an admin or reviewer clears a potential
//   match as a false positive or confirms it. A confirmed match starts the
//   10-business-day OFAC report clock (clocks.mjs).
// AML: rules over the case pool, each explained with the cases behind it —
//   structuring under the reporting threshold, repeat claims, the same payee
//   or wallet across victims, large scam losses, round amounts. When the
//   signals add up, the case is flagged for SAR review (c.sarReview) and the
//   30-day FinCEN clock starts from that moment.
// OSINT: lookups on the counterparty only — never the customer: domain age
//   (api/osint.js, public RDAP), and links to open sources and block explorers.
import { parseAmount } from './clocks.mjs'
import { findWallets } from './sanctionsMatch.mjs'
import { isMerchantCase } from './sides.mjs'

export const FINCRIME_DEFAULTS = { screeningAuto: true, screeningThreshold: 0.9 }
const DAY = 86400000
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// ─── Sanctions ────────────────────────────────────────────────────────────────
const usable = n => n && n !== '—' && !/^unhosted wallet/i.test(n) && n.replace(/[^a-z]/gi, '').length >= 3
export function subjectsOf(c) {
  const out = []
  if (usable(c.cardholderName)) out.push({ role: 'Cardholder', name: c.cardholderName })
  if (usable(c.merchant)) out.push({ role: isMerchantCase(c) ? 'Customer' : 'Merchant / payee', name: c.merchant })
  if (usable(c.counterparty)) out.push({ role: 'Counterparty', name: c.counterparty })
  return out
}
export const walletsOf = c => findWallets([c.merchant, c._complaint, c.counterparty, c.destination, c._triageRecord?.merchant].filter(Boolean).join(' ')).slice(0, 20)
// What was screened, so a change of name or wallet triggers a new screening
export const screeningKey = c => [...subjectsOf(c).map(s => norm(s.name)), ...walletsOf(c)].join('|')

export async function screenCase(c, settings, by) {
  const subjects = subjectsOf(c), wallets = walletsOf(c)
  const r = await fetch('/api/sanctions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjects, wallets, threshold: settings?.screeningThreshold ?? 0.9 }) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Screening failed (${r.status})`)
  const hits = [...d.results.flatMap(x => x.hits.map(h => ({ ...h, subject: x.name, role: x.role }))),
                ...d.walletResults.flatMap(x => x.hits.map(h => ({ ...h, subject: x.address, role: 'Wallet' })))]
  return {
    id: 'SCR-' + Date.now().toString(36).toUpperCase(), ts: new Date().toISOString(), by: by || 'Automatic',
    list: d.list, threshold: d.threshold, key: screeningKey(c),
    screened: [...subjects.map(s => `${s.role}: ${s.name}`), ...wallets.map(w => `Wallet: ${w}`)],
    hits, status: hits.length ? 'potential' : 'clear',
  }
}
// clear | potential | false_positive | confirmed | none
export function screeningStatus(c) {
  const s = c?.screening
  if (!s) return 'none'
  if (s.status === 'clear') return 'clear'
  return s.decision?.outcome === 'true_match' ? 'confirmed' : s.decision?.outcome === 'false_positive' ? 'false_positive' : 'potential'
}

// ─── AML ──────────────────────────────────────────────────────────────────────
// → { score, level: 'none'|'low'|'medium'|'high', signals: [{ key, label, detail, weight, cases }], linked: [{ id, why }] }
// Who and what each case involves, so checking every case stays fast at thousands of cases
export function amlIndex(cases) {
  const by = { holder: new Map(), payee: new Map(), wallet: new Map() }
  const put = (m, k, c) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(c) }
  ;(cases || []).forEach(c => {
    if (!c?.date) return
    const h = norm(c.cardholderName); if (h.length >= 3) put(by.holder, h, c)
    const p = norm(c.merchant); if (usable(c.merchant) && p.length >= 3) put(by.payee, p, c)
    walletsOf(c).forEach(w => put(by.wallet, w, c))
  })
  return by
}
export function amlSignals(c, cases, settings, index) {
  const ix = index || amlIndex(cases)
  const s = settings || {}
  const threshold = c.accountType === 'crypto' || c.accountType === 'crypto_exchange' ? (s.sarThresholdCrypto || 10000) : (s.sarThreshold || 5000)
  const amt = parseAmount(c.amount), when = new Date(c.date || 0)
  const within = (o, days) => Math.abs(new Date(o.date) - when) <= days * DAY
  const signals = [], linked = new Map()
  const link = (list, why) => list.forEach(o => { if (!linked.has(o.id)) linked.set(o.id, { id: o.id, merchant: o.merchant, amount: o.amount, why }) })
  const add = (key, label, detail, weight, list = []) => { signals.push({ key, label, detail, weight, cases: list.map(o => o.id) }); link(list, label) }

  const holder = norm(c.cardholderName)
  const notMe = o => o.id !== c.id
  const sameHolder = holder.length >= 3 ? (ix.holder.get(holder) || []).filter(notMe) : []
  const payee = norm(c.merchant)
  const samePayee = usable(c.merchant) && payee.length >= 3 ? (ix.payee.get(payee) || []).filter(o => notMe(o) && norm(o.cardholderName) !== holder) : []
  const myWallets = walletsOf(c)
  const sameWallet = [...new Map(myWallets.flatMap(w => ix.wallet.get(w) || []).filter(notMe).map(o => [o.id, o])).values()]

  // Structuring: several amounts just under the reporting threshold, close together
  const nearMiss = a => a >= threshold * 0.8 && a < threshold
  const structured = sameHolder.filter(o => within(o, 30) && nearMiss(parseAmount(o.amount)))
  if (nearMiss(amt) && structured.length) add('structuring', 'Amounts just under the reporting threshold',
    `${structured.length + 1} amounts between ${Math.round(threshold * 0.8).toLocaleString()} and ${threshold.toLocaleString()} from the same customer within 30 days`, 3, structured)
  else if (amt && sameHolder.length) {
    const total = amt + sameHolder.filter(o => within(o, 30)).reduce((t, o) => t + parseAmount(o.amount), 0)
    const parts = sameHolder.filter(o => within(o, 30) && parseAmount(o.amount) < threshold)
    if (amt < threshold && parts.length && total >= threshold) add('aggregate', 'Several smaller amounts that add up past the threshold',
      `${(parts.length + 1)} claims totalling ${Math.round(total).toLocaleString()} within 30 days, each under ${threshold.toLocaleString()}`, 2, parts)
  }
  // Repeat claims by the same customer
  const repeat = sameHolder.filter(o => within(o, 90))
  if (repeat.length >= 2) add('repeat', 'Repeat claims from the same customer', `${repeat.length + 1} claims in 90 days`, 2, repeat)
  else if (sameHolder.filter(o => within(o, 7)).length) add('velocity', 'Two claims within a week', 'The same customer opened another claim within 7 days', 1, sameHolder.filter(o => within(o, 7)))
  // Same payee across different customers — possible mule account or scam beneficiary
  const payeeHits = samePayee.filter(o => within(o, 60) && (o.verdict === 'AUTHORIZED_PUSH_PAYMENT' || o.verdict === 'TRUE_FRAUD' || o.accountType === 'p2p' || o.accountType === 'crypto_exchange'))
  if (payeeHits.length >= 1 && (c.verdict === 'AUTHORIZED_PUSH_PAYMENT' || c.verdict === 'TRUE_FRAUD' || payeeHits.length >= 2))
    add('payee', 'Same payee in other fraud or scam cases', `${payeeHits.length} other customer${payeeHits.length === 1 ? '' : 's'} reported this payee within 60 days`, payeeHits.length >= 2 ? 3 : 2, payeeHits)
  // Same wallet address
  if (sameWallet.length) add('wallet', 'Same wallet address in other cases', `${sameWallet.length} other case${sameWallet.length === 1 ? '' : 's'} sent funds to the same address`, 3, sameWallet)
  // Scam loss at or above the reporting threshold
  if (c.verdict === 'AUTHORIZED_PUSH_PAYMENT' && amt >= threshold) add('scam', 'Scam loss at or above the reporting threshold', `${c.amount} lost to an authorised push payment scam`, 2)
  // Large round amount
  if (amt >= 1000 && amt % 500 === 0) add('round', 'Large round amount', `${c.amount} is a round figure`, 1)
  // Sanctions: only a confirmed match counts — most possible matches are cleared as false positives
  if (screeningStatus(c) === 'confirmed') add('sanctions', 'Confirmed sanctions match', 'See sanctions screening above', 3)

  const score = signals.reduce((t, x) => t + x.weight, 0)
  const level = score >= 5 ? 'high' : score >= 3 ? 'medium' : score > 0 ? 'low' : 'none'
  return { score, level, threshold, signals, linked: [...linked.values()] }
}
// Flag for SAR review when the signals reach "medium"
export const needsSarReview = aml => aml.level === 'medium' || aml.level === 'high'

// ─── OSINT ────────────────────────────────────────────────────────────────────
const DOMAIN = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|app|shop|store|online|site|xyz|info|biz|us|uk|ca|ng|in|de|fr|au|me|ai|cc|top|club|live|vip|pro|exchange|finance|trade|cash|money))\b/gi
export function domainsOf(c) {
  const text = [c.merchant, c._complaint, c.counterparty].filter(Boolean).join(' ').toLowerCase()
  return [...new Set([...text.matchAll(DOMAIN)].map(m => m[1].replace(/^www\./, '')).filter(d => !/^(gmail|yahoo|hotmail|outlook|icloud)\./.test(d)))].slice(0, 5)
}
const q = s => encodeURIComponent(s)
export function osintLinks(c) {
  const out = []
  if (usable(c.merchant)) {
    const m = c.merchant
    out.push({ group: m, links: [
      ['Web search: scam reports', `https://www.google.com/search?q=${q(`"${m}" scam OR fraud OR complaint`)}`],
      ['OpenCorporates', `https://opencorporates.com/companies?q=${q(m)}`],
      ['Better Business Bureau', `https://www.bbb.org/search?find_text=${q(m)}`],
      ['OFAC search', `https://sanctionssearch.ofac.treas.gov/`],
    ] })
  }
  domainsOf(c).forEach(d => out.push({ group: d, domain: d, links: [
    ['ScamAdviser', `https://www.scamadviser.com/check-website/${q(d)}`],
    ['Archived copies', `https://web.archive.org/web/*/${q(d)}`],
    ['Registration (RDAP)', `https://rdap.org/domain/${q(d)}`],
  ] }))
  walletsOf(c).forEach(w => {
    const ex = /^0x/i.test(w) ? [['Etherscan', `https://etherscan.io/address/${w}`], ['BscScan', `https://bscscan.com/address/${w}`]]
      : /^T/.test(w) ? [['Tronscan', `https://tronscan.org/#/address/${w}`]]
      : [['Blockchain.com', `https://www.blockchain.com/explorer/addresses/btc/${w}`], ['Mempool', `https://mempool.space/address/${w}`]]
    out.push({ group: w, wallet: w, links: ex })
  })
  return out
}
export async function domainAge(domain) {
  const r = await fetch(`/api/osint?domain=${encodeURIComponent(domain)}`)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Lookup failed (${r.status})`)
  return d
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION MONITORING — transaction files → transactions → explainable alerts
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript (no browser, no React) so the screen and the tests share it.
//   TX_FIELDS / buildTransactions   map a core-banking or processor export to
//                                   transactions (direction, channel, amount…)
//   evaluate                        run the rules over each customer's last 30
//                                   days; every alert says which rule fired, why,
//                                   and which transactions it rests on
// Rules are deliberately simple and tunable (Settings → Financial crime); they
// raise alerts for a person to review in 005 Licit, never decisions.
import { parseDate, parseAmount as parseMoney } from './csvImport.js'

const DAY = 86400000
export const TM_DEFAULTS = {
  tmEnabled: true,
  tmCtr: 10000,                 // cash reporting threshold (CTR)
  tmRapidMin: 5000,             // money in, then mostly out again within 3 days
  tmFanCount: 5,                // distinct senders (in) or new payees (out) in 7 days
  tmVelocityMultiple: 3,        // this week's outflow vs. the customer's usual week
  tmVelocityMin: 5000,
  tmCryptoMin: 3000,            // money sent to crypto in 7 days
  tmRoundMin: 5000,             // large round-dollar payments
  tmHighRiskCountries: 'IR, KP, MM',   // FATF "call for action" list; add your own
}

// ─── Mapping a transaction file ───────────────────────────────────────────────
export const TX_FIELDS = [
  { key:'txId',          label:'Transaction ID',          syn:['transaction id','txn id','tran id','reference','ref','trace','id','transaction ref'], hint:'Stops the same transaction being counted twice.' },
  { key:'date',          label:'Date',                    required:true, syn:['date','transaction date','posting date','post date','posted','value date','timestamp','created','datetime'] },
  { key:'customerId',    label:'Customer or account ID',  required:true, syn:['customer id','account','account number','acct','account id','member id','cif','client id','customer number','user id','uid','userid'] },
  { key:'customerName',  label:'Customer name',           syn:['customer name','name','account name','member name','client name','account holder','user','user name','username'] },
  { key:'amount',        label:'Amount',                  required:true, syn:['amount','transaction amount','txn amount','value','amt'] },
  { key:'currency',      label:'Currency',                syn:['currency','ccy','currency code'] },
  { key:'direction',     label:'In or out',               syn:['direction','debit credit','dr cr','type','transaction type','in out','dc','side','deposit withdrawal'], hint:'Leave empty if negative amounts are money going out.' },
  { key:'channel',       label:'Channel',                 syn:['channel','method','rail','payment method','payment type','instrument','tran code'] },
  { key:'counterparty',  label:'Counterparty',            syn:['counterparty','payee','payer','beneficiary','originator','merchant','recipient','sender','other party'] },
  { key:'counterpartyAccount', label:'Counterparty account', syn:['counterparty account','beneficiary account','payee account','to account','from account'] },
  { key:'country',       label:'Counterparty country',    syn:['country','counterparty country','beneficiary country','destination country','country code'] },
  { key:'wallet',        label:'Crypto wallet address',   syn:['wallet','wallet address','crypto address','address','destination address'] },
  { key:'description',   label:'Description / memo',      syn:['description','memo','narrative','details','remarks','purpose','note','notes','comment'] },
]
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export function guessTxMapping(headers) {
  const H = headers.map(norm), used = new Set(), map = {}
  for (const pass of ['exact', 'contains']) for (const f of TX_FIELDS) {
    if (map[f.key] != null) continue
    const names = [norm(f.label), ...f.syn.map(norm)]
    const i = H.findIndex((h, idx) => !used.has(idx) && (pass === 'exact' ? names.includes(h) : names.some(n => n.length > 3 && h.includes(n))))
    if (i >= 0) { map[f.key] = i; used.add(i) }
  }
  return map
}

export function normDirection(raw, signedAmount) {
  const v = norm(raw)
  if (/^(in|cr|credit|deposit|incoming|received|receipt|inbound)/.test(v)) return 'in'
  if (/^(out|dr|debit|withdraw|outgoing|sent|payment|outbound|transfer out)/.test(v)) return 'out'
  return signedAmount < 0 ? 'out' : 'in'
}
export function normChannel(raw, text = '') {
  const v = norm(raw) + ' ' + norm(text)
  if (/\b(cash|atm|teller|currency)\b/.test(v)) return 'cash'
  if (/\b(crypto|btc|eth|usdt|usdc|bitcoin|ethereum|tether|coinbase|binance|kraken|exchange wallet)\b/.test(v)) return 'crypto'
  if (/\b(wire|swift|fedwire|chaps|telex)\b/.test(v)) return 'wire'
  if (/\b(zelle|p2p|venmo|cash ?app|cashapp|paypal|interac|e ?transfer)\b/.test(v)) return 'p2p'
  if (/\b(ach|eft|direct deposit|bacs)\b/.test(v)) return 'ach'
  if (/\b(card|pos|purchase|visa|mastercard|debit card)\b/.test(v)) return 'card'
  if (/\b(check|cheque)\b/.test(v)) return 'check'
  return 'other'
}
const COUNTRY = { iran: 'IR', irn: 'IR', 'north korea': 'KP', dprk: 'KP', prk: 'KP', 'korea democratic': 'KP', myanmar: 'MM', burma: 'MM', mmr: 'MM',
  syria: 'SY', syr: 'SY', cuba: 'CU', cub: 'CU', russia: 'RU', rus: 'RU', 'united states': 'US', usa: 'US', 'united kingdom': 'GB', gbr: 'GB', nigeria: 'NG', nga: 'NG' }
export const normCountry = raw => { const v = norm(raw); if (!v) return ''; if (/^[a-z]{2}$/.test(v)) return v.toUpperCase(); return COUNTRY[v] || Object.entries(COUNTRY).find(([k]) => v.includes(k))?.[1] || v.toUpperCase().slice(0, 24) }

const hash = s => [...String(s)].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36)

// rows + mapping → { txs, errors }   (dates: 'mdy' | 'dmy' | 'iso' | 'excel')
export function buildTransactions(rows, { mapping, dateFormat = 'mdy', defaultCurrency = 'USD', batch = '' }) {
  const get = (r, k) => mapping[k] != null ? String(r[mapping[k]] ?? '').trim() : ''
  const txs = [], errors = [], seen = new Set()
  rows.forEach((r, i) => {
    const row = i + 2, err = m => errors.push({ row, message: m })
    const rawDate = get(r, 'date'), d = parseDate(rawDate.split(/[ T]/)[0], dateFormat)
    if (!d) return err(`Can’t read “${rawDate}” as a date`)
    const time = (rawDate.match(/\d{1,2}:\d{2}(:\d{2})?/) || ['12:00'])[0]
    const customerId = get(r, 'customerId'); if (!customerId) return err('Missing customer or account ID')
    const rawAmt = get(r, 'amount'), signed = Number(String(rawAmt).replace(/[^0-9.\-()]/g, '').replace(/^\((.*)\)$/, '-$1'))
    const amt = parseMoney(rawAmt); if (!amt || !amt.value) return err(`Can’t read “${rawAmt}” as an amount`)
    const id = get(r, 'txId') || 'TX-' + hash([d, time, customerId, rawAmt, get(r, 'counterparty'), get(r, 'description'), i].join('|'))
    if (seen.has(id)) return err(`Transaction ${id} appears twice in the file`)
    seen.add(id)
    txs.push({
      id, ts: new Date(`${d}T${time.length === 5 ? time + ':00' : time}`).toISOString(), customerId, customerName: get(r, 'customerName'),
      amount: Math.round(amt.value * 100) / 100, currency: (get(r, 'currency') || amt.currency || defaultCurrency).toUpperCase().slice(0, 3),
      direction: normDirection(get(r, 'direction'), isFinite(signed) ? signed : 1),
      channel: normChannel(get(r, 'channel'), get(r, 'description') + ' ' + get(r, 'counterparty')),
      counterparty: get(r, 'counterparty'), counterpartyAccount: get(r, 'counterpartyAccount'),
      country: normCountry(get(r, 'country')), wallet: get(r, 'wallet'), description: get(r, 'description').slice(0, 300), batch,
    })
  })
  return { txs, errors }
}

// ─── Rules ────────────────────────────────────────────────────────────────────
export const RULES = {
  cash_structuring: { label: 'Cash just under the reporting threshold', weight: 3, sar: 'Structuring' },
  rapid_movement:   { label: 'Money in and straight back out',           weight: 3, sar: 'Money laundering — rapid movement of funds' },
  fan_in:           { label: 'Many senders paying one account',          weight: 3, sar: 'Fraud — mule account' },
  fan_out:          { label: 'Many new payees at once',                   weight: 2, sar: 'Money laundering — layering' },
  velocity:         { label: 'Sudden jump in money going out',            weight: 2, sar: 'Suspicious activity — unusual volume' },
  high_risk_country:{ label: 'Payment involving a high-risk country',     weight: 3, sar: 'Sanctions / high-risk jurisdiction' },
  crypto:           { label: 'Large amounts sent to crypto',              weight: 2, sar: 'Virtual currency' },
  round_amounts:    { label: 'Repeated large round-dollar payments',      weight: 1, sar: 'Suspicious amounts' },
  sanctions:        { label: 'Counterparty on a sanctions list',          weight: 5, sar: 'Sanctions — OFAC match' },
}
const money = n => '$' + Math.round(n).toLocaleString()
const fmtDay = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// history: every transaction for the customers in the new file, last 30+ days (including the new ones)
// newIds: ids of the transactions just imported — an alert must rest on at least one of them
// → alerts: [{ id, key, customerId, customerName, rule, label, severity, score, detail, txIds, total, from, to }]
export function evaluate(history, newIds, settings, now = new Date(), opts = {}) {
  const segment = opts.segment || 'fi'   // 'fi' bank / credit union · 'ce' crypto exchange
  const s = { ...TM_DEFAULTS, ...(settings || {}) }
  if (s.tmEnabled === false) return []
  const fresh = new Set(newIds)
  const risky = new Set(String(s.tmHighRiskCountries || '').split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean))
  const byCustomer = new Map()
  ;(history || []).forEach(t => { if (!byCustomer.has(t.customerId)) byCustomer.set(t.customerId, []); byCustomer.get(t.customerId).push(t) })
  const alerts = []

  for (const [customerId, all] of byCustomer) {
    const txs = all.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts))
    if (!txs.some(t => fresh.has(t.id))) continue
    const name = txs.find(t => t.customerName)?.customerName || ''
    const at = t => new Date(t.ts).getTime()
    const raise = (rule, involved, detail) => {
      if (!involved.some(t => fresh.has(t.id))) return
      const last = involved.reduce((m, t) => Math.max(m, at(t)), 0)
      const key = `${customerId}|${rule}|${new Date(last).toISOString().slice(0, 10)}`
      const r = RULES[rule], total = involved.reduce((n, t) => n + t.amount, 0)
      // One alert per customer and rule per run: keep the one resting on the most transactions
      const prev = alerts.findIndex(a => a.customerId === customerId && a.rule === rule)
      if (prev >= 0) { if (alerts[prev].txIds.length >= involved.length) return; alerts.splice(prev, 1) }
      alerts.push({ id: 'ALT-' + hash(key).toUpperCase(), key, kind: 'aml', segment, customerId, customerName: name, rule, label: r.label, score: r.weight,
        severity: r.weight >= 3 ? 'high' : r.weight === 2 ? 'medium' : 'low', detail, txIds: involved.map(t => t.id),
        total: Math.round(total * 100) / 100, from: new Date(involved.reduce((m, t) => Math.min(m, at(t)), Infinity)).toISOString(),
        to: new Date(last).toISOString(), createdAt: now.toISOString(), status: 'open' })
    }
    const within = (anchor, days, list = txs) => list.filter(t => at(t) <= at(anchor) && at(t) > at(anchor) - days * DAY)

    for (const anchor of txs.filter(t => fresh.has(t.id))) {
      const week = within(anchor, 7)
      // 1. Cash just under the CTR threshold, or cash adding up past it in pieces
      const cash = week.filter(t => t.channel === 'cash')
      const near = cash.filter(t => t.amount >= s.tmCtr * 0.8 && t.amount < s.tmCtr)
      const cashTotal = cash.reduce((n, t) => n + t.amount, 0)
      if (near.length >= 2) raise('cash_structuring', near, `${near.length} cash transactions between ${money(s.tmCtr * 0.8)} and ${money(s.tmCtr)} within 7 days (${money(near.reduce((n, t) => n + t.amount, 0))} in total)`)
      else if (cash.length >= 2 && cash.every(t => t.amount < s.tmCtr) && cashTotal >= s.tmCtr) raise('cash_structuring', cash, `${cash.length} cash transactions, each under ${money(s.tmCtr)}, adding up to ${money(cashTotal)} within 7 days`)
      // 2. Money in, then mostly out again within 3 days
      const ins3 = within(anchor, 3).filter(t => t.direction === 'in'), outs3 = within(anchor, 3).filter(t => t.direction === 'out')
      const inSum = ins3.reduce((n, t) => n + t.amount, 0), outSum = outs3.reduce((n, t) => n + t.amount, 0)
      if (inSum >= s.tmRapidMin && outSum >= inSum * 0.8 && outs3.some(o => ins3.some(i => at(i) <= at(o))))
        raise('rapid_movement', [...ins3, ...outs3], `${money(inSum)} came in and ${money(outSum)} (${Math.round(100 * outSum / inSum)}%) went out again within 3 days`)
      // 3. Many different senders paying in
      const ins7 = week.filter(t => t.direction === 'in' && t.counterparty)
      const senders = new Set(ins7.map(t => norm(t.counterparty)))
      if (senders.size >= s.tmFanCount && ins7.reduce((n, t) => n + t.amount, 0) >= 2000)
        raise('fan_in', ins7, `${senders.size} different senders paid this account within 7 days (${money(ins7.reduce((n, t) => n + t.amount, 0))}) — a pattern of mule accounts collecting from victims`)
      // 4. Many new payees at once
      const before = new Set(txs.filter(t => at(t) <= at(anchor) - 7 * DAY && t.direction === 'out').map(t => norm(t.counterparty)))
      const newOuts = week.filter(t => t.direction === 'out' && t.counterparty && !before.has(norm(t.counterparty)))
      const payees = new Set(newOuts.map(t => norm(t.counterparty)))
      if (payees.size >= s.tmFanCount && newOuts.reduce((n, t) => n + t.amount, 0) >= 2000)
        raise('fan_out', newOuts, `Payments to ${payees.size} payees never paid before, within 7 days (${money(newOuts.reduce((n, t) => n + t.amount, 0))})`)
      // 5. Outflow far above the customer's usual week
      const outWeek = week.filter(t => t.direction === 'out').reduce((n, t) => n + t.amount, 0)
      const prior = txs.filter(t => t.direction === 'out' && at(t) <= at(anchor) - 7 * DAY && at(t) > at(anchor) - 30 * DAY)
      const priorDays = txs.length ? (at(anchor) - 7 * DAY - at(txs[0])) / DAY : 0
      const usual = priorDays >= 14 ? prior.reduce((n, t) => n + t.amount, 0) / (Math.min(23, priorDays) / 7) : null
      if (usual != null && outWeek >= s.tmVelocityMin && outWeek >= Math.max(usual, 1) * s.tmVelocityMultiple)
        raise('velocity', week.filter(t => t.direction === 'out'), `${money(outWeek)} went out in 7 days — ${usual ? `${(outWeek / usual).toFixed(1)}× the usual ${money(usual)} a week` : 'with no outflow in the weeks before'}`)
      // 6. High-risk country
      if (anchor.country && risky.has(anchor.country)) raise('high_risk_country', [anchor], `${anchor.direction === 'in' ? 'Received from' : 'Sent to'} ${anchor.counterparty || 'a counterparty'} in ${anchor.country} (${money(anchor.amount)})`)
      // 7. Money sent to crypto
      const crypto = week.filter(t => t.direction === 'out' && (t.channel === 'crypto' || t.wallet))
      const cryptoSum = crypto.reduce((n, t) => n + t.amount, 0)
      if (segment === 'fi' && cryptoSum >= s.tmCryptoMin) raise('crypto', crypto, `${money(cryptoSum)} sent to crypto exchanges or wallets within 7 days`)
      // 8. Repeated large round amounts
      const round = week.filter(t => t.direction === 'out' && t.amount >= s.tmRoundMin && t.amount % 1000 === 0)
      if (round.length >= 2) raise('round_amounts', round, `${round.length} round-dollar payments of ${money(s.tmRoundMin)} or more within 7 days`)
    }
  }
  return alerts.sort((a, b) => b.score - a.score || b.total - a.total)
}

// Names and wallets in the new transactions worth screening against OFAC
export function screenables(txs, limit = 200) {
  const names = new Map(), wallets = new Set()
  txs.forEach(t => {
    if (t.counterparty && t.counterparty.replace(/[^a-z]/gi, '').length >= 4 && !names.has(norm(t.counterparty))) names.set(norm(t.counterparty), t.counterparty)
    if (t.wallet) wallets.add(t.wallet)
  })
  return { names: [...names.values()].slice(0, limit), wallets: [...wallets].slice(0, limit) }
}
export function sanctionsAlert(customerId, customerName, txs, hit, now = new Date(), segment = 'fi') {
  const key = `${customerId}|sanctions|${hit.name}`
  return { id: 'ALT-' + hash(key).toUpperCase(), key, kind: 'aml', segment, customerId, customerName, rule: 'sanctions', label: RULES.sanctions.label, score: 5, severity: 'high',
    detail: `${hit.subject} ≈ ${hit.name} (${hit.list}, ${hit.programs}) — ${Math.round(hit.score * 100)}% match${hit.others ? `, and ${hit.others} weaker match${hit.others === 1 ? '' : 'es'}` : ''}`, txIds: txs.map(t => t.id),
    total: txs.reduce((n, t) => n + t.amount, 0), from: txs[0]?.ts, to: txs[txs.length - 1]?.ts, createdAt: now.toISOString(), status: 'open', hit }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRAUD — rules looking for customers being robbed (alerts go to 001 Triage)
// ═══════════════════════════════════════════════════════════════════════════════
export const FRAUD_DEFAULTS = {
  fraudEnabled: true,
  fraudContactHours: null,      // reach the customer within N hours; empty = no clock
  fraudAtoMin: 1000,            // account takeover: money out after the changes
  fraudCardTestMax: 2,          // card testing: tiny charges of at most…
  fraudCardTestCount: 5,        // …this many within 24 hours
  fraudScamMin: 2000,           // scam victim: first large payment to a new payee
  fraudDormantDays: 90,         // dormant account: no activity for this many days…
  fraudDormantMin: 1000,        // …then at least this much moving
  fraudCppMin: 3,               // compromised merchant: confirmed-fraud customers who all used it
  fraudNewAddressMin: 1000,     // exchanges: withdrawal to an address added within the day, never used before
}

// Account events: logins, devices, profile changes (an optional second file)
export const EV_FIELDS = [
  { key:'eventId',    label:'Event ID',               syn:['event id','id','reference','ref'] },
  { key:'date',       label:'Date',                   required:true, syn:['date','timestamp','datetime','event time','time','created'] },
  { key:'customerId', label:'Customer or account ID', required:true, syn:['customer id','account','account number','member id','cif','client id','user id','uid'] },
  { key:'type',       label:'Event',                  required:true, syn:['event','event type','type','action','activity'] },
  { key:'device',     label:'Device',                 syn:['device','device id','fingerprint','user agent'] },
  { key:'location',   label:'Location / IP country',  syn:['location','country','ip country','geo','city','ip'] },
  { key:'detail',     label:'Detail',                 syn:['detail','details','description','memo','notes'] },
]
export const EVENT_TYPES = { new_device: 'Login from a new device', new_location: 'Login from a new location', password_change: 'Password changed',
  phone_change: 'Phone number changed', email_change: 'Email changed', address_change: 'Address changed', payee_added: 'New payee added',
  mfa_reset: 'Two-step verification reset', login: 'Login', other: 'Other' }
export function normEventType(raw) {
  const v = norm(raw)
  if (/new device|device (added|new)|unrecognized device|unrecognised device/.test(v)) return 'new_device'
  if (/new (location|country|ip)|unusual location|foreign login/.test(v)) return 'new_location'
  if (/password|passcode|pin (change|reset)/.test(v)) return 'password_change'
  if (/phone|mobile number|sim/.test(v)) return 'phone_change'
  if (/email/.test(v)) return 'email_change'
  if (/payee|beneficiary|recipient added|biller|withdrawal address|whitelist|allowlist|address book/.test(v)) return 'payee_added'
  if (/address/.test(v)) return 'address_change'
  if (/mfa|2fa|two.?factor|otp reset|authenticator/.test(v)) return 'mfa_reset'
  if (/login|log in|sign in|signin/.test(v)) return 'login'
  return 'other'
}
export function guessEvMapping(headers) {
  const H = headers.map(norm), used = new Set(), map = {}
  for (const pass of ['exact', 'contains']) for (const f of EV_FIELDS) {
    if (map[f.key] != null) continue
    const names = [norm(f.label), ...f.syn.map(norm)]
    const i = H.findIndex((h, idx) => !used.has(idx) && (pass === 'exact' ? names.includes(h) : names.some(n => n.length > 3 && h.includes(n))))
    if (i >= 0) { map[f.key] = i; used.add(i) }
  }
  return map
}
export function buildEvents(rows, { mapping, dateFormat = 'mdy', batch = '' }) {
  const get = (r, k) => mapping[k] != null ? String(r[mapping[k]] ?? '').trim() : ''
  const events = [], errors = []
  rows.forEach((r, i) => {
    const row = i + 2, rawDate = get(r, 'date'), d = parseDate(rawDate.split(/[ T]/)[0], dateFormat)
    if (!d) return errors.push({ row, message: `Can’t read “${rawDate}” as a date` })
    const customerId = get(r, 'customerId'); if (!customerId) return errors.push({ row, message: 'Missing customer or account ID' })
    const time = (rawDate.match(/\d{1,2}:\d{2}(:\d{2})?/) || ['12:00'])[0]
    events.push({ id: get(r, 'eventId') || 'EV-' + hash([d, time, customerId, get(r, 'type'), get(r, 'device'), i].join('|')),
      ts: new Date(`${d}T${time.length === 5 ? time + ':00' : time}`).toISOString(), customerId, type: normEventType(get(r, 'type')),
      rawType: get(r, 'type').slice(0, 80), device: get(r, 'device').slice(0, 120), location: get(r, 'location').slice(0, 80), detail: get(r, 'detail').slice(0, 200), batch })
  })
  return { events, errors }
}

export const FRAUD_RULES = {
  account_takeover:    { label: 'Possible account takeover',                weight: 3, action: 'block_card', route: 'recall' },
  card_testing:        { label: 'Card testing — tiny charges in a burst',   weight: 3, action: 'block_card', route: 'desk' },
  compromised_merchant:{ label: 'Merchant shared by several fraud victims', weight: 3, action: 'trio',       route: 'trio' },
  scam_victim:         { label: 'Possible scam — first large payment to a new payee', weight: 2, action: 'hold_payment', route: 'scam' },
  dormant_awakens:     { label: 'Dormant account suddenly active',          weight: 2, action: 'hold_payment', route: 'recall' },
  check_duplicate:     { label: 'Same check deposited twice',               weight: 3, action: 'hold_payment', route: 'recall' },
  new_address_withdrawal: { label: 'Withdrawal to a brand-new address',     weight: 3, action: 'hold_payment', route: 'recall' },
  external:            { label: 'Alert from a connected fraud system',      weight: 2, action: null,           route: null },
}
const SCAM_WORDS = /\b(fee|release|unlock|tax|irs|customs|bail|lawyer|gift ?card|bitcoin|crypto|usdt|invest|investment|profit|grandson|granddaughter|urgent|lottery|prize|refund|support|microsoft|amazon|apple)\b/i

// history: transactions (≥ 120 days for the dormancy rule); events: account events; fresh: ids of new transactions / events
// fraudCases: confirmed card-fraud cases [{ customerName, date }] for the compromised-merchant rule
export function evaluateFraud(history, events, fresh, settings, fraudCases = [], now = new Date(), opts = {}) {
  const segment = opts.segment || 'fi'
  const s = { ...FRAUD_DEFAULTS, ...(settings || {}) }
  if (s.fraudEnabled === false) return []
  const isNew = new Set(fresh)
  const at = t => new Date(t.ts).getTime()
  const out = []
  const raise = (rule, customerId, name, involved, evs, detail, extra = {}) => {
    if (!involved.some(t => isNew.has(t.id)) && !evs.some(e => isNew.has(e.id)) && !extra.always) return
    const last = Math.max(...involved.map(at), ...evs.map(at), 0)
    const key = `${customerId}|${rule}|${new Date(last).toISOString().slice(0, 10)}`
    if (out.some(a => a.key === key)) return
    const r = FRAUD_RULES[rule], total = involved.reduce((n, t) => n + t.amount, 0)
    const due = s.fraudContactHours ? new Date(now.getTime() + Number(s.fraudContactHours) * 3600000).toISOString() : null
    out.push({ id: 'FRD-' + hash(key).toUpperCase(), key, kind: 'fraud', segment, customerId, customerName: name, rule, label: r.label, score: r.weight,
      severity: r.weight >= 3 ? 'high' : 'medium', detail, txIds: involved.map(t => t.id), events: evs.map(e => ({ ts: e.ts, type: e.type, device: e.device, location: e.location })),
      total: Math.round(total * 100) / 100, from: new Date(Math.min(...involved.map(at), ...evs.map(at))).toISOString(), to: new Date(last).toISOString(),
      action: r.action, route: r.route, contactDue: due, createdAt: now.toISOString(), status: 'open', ...extra })
  }
  const byC = new Map()
  ;(history || []).forEach(t => { if (!byC.has(t.customerId)) byC.set(t.customerId, { txs: [], evs: [] }); byC.get(t.customerId).txs.push(t) })
  ;(events || []).forEach(e => { if (!byC.has(e.customerId)) byC.set(e.customerId, { txs: [], evs: [] }); byC.get(e.customerId).evs.push(e) })

  for (const [cid, { txs: rawTx, evs: rawEv }] of byC) {
    const txs = rawTx.slice().sort((a, b) => at(a) - at(b)), evs = rawEv.slice().sort((a, b) => at(a) - at(b))
    const name = txs.find(t => t.customerName)?.customerName || ''
    // 1. Account takeover: new device or location → profile change → money out, within 48 hours
    for (const access of evs.filter(e => e.type === 'new_device' || e.type === 'new_location')) {
      const until = at(access) + 48 * 3600000
      const changes = evs.filter(e => ['password_change', 'phone_change', 'email_change', 'mfa_reset', 'address_change', 'payee_added'].includes(e.type) && at(e) >= at(access) && at(e) <= until)
      const outs = txs.filter(t => t.direction === 'out' && at(t) >= at(access) && at(t) <= until)
      const outSum = outs.reduce((n, t) => n + t.amount, 0)
      if (changes.length && outSum >= s.fraudAtoMin) {
        const steps = [access, ...changes].map(e => `${EVENT_TYPES[e.type].toLowerCase()} (${new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`)
        raise('account_takeover', cid, name, outs, [access, ...changes], `${steps.join(' → ')}, then ${money(outSum)} out within 48 hours`)
      }
    }
    // 2. Card testing: a burst of tiny card charges in 24 hours
    const tiny = txs.filter(t => t.channel === 'card' && t.direction === 'out' && t.amount <= s.fraudCardTestMax)
    for (const t of tiny.filter(x => isNew.has(x.id)).reverse()) {   // the latest new charge sees the whole burst
      const burst = tiny.filter(x => at(x) <= at(t) && at(x) > at(t) - DAY)
      if (burst.length >= s.fraudCardTestCount) {
        const merchants = new Set(burst.map(x => norm(x.counterparty))).size
        const big = txs.filter(x => x.channel === 'card' && x.direction === 'out' && x.amount > 50 && at(x) >= at(burst[0]) && at(x) <= at(t) + DAY)
        raise('card_testing', cid, name, [...burst, ...big], [], `${burst.length} card charges of ${money(s.fraudCardTestMax)} or less at ${merchants} merchant${merchants === 1 ? '' : 's'} within 24 hours${big.length ? `, then ${money(big.reduce((n, x) => n + x.amount, 0))} in larger charges` : ''}`)
        break
      }
    }
    // 4. Dormant account suddenly active
    // (the gap can sit anywhere before a new transaction: a file may carry the account's older history too)
    const wake = txs.findIndex((x, i) => i > 0 && isNew.has(x.id) && at(x) - at(txs[i - 1]) >= s.fraudDormantDays * DAY)
    if (wake > 0) {
      const after = txs.slice(wake), moved = after.reduce((n, x) => n + x.amount, 0)
      if (moved >= s.fraudDormantMin)
        raise('dormant_awakens', cid, name, after, [], `No activity for ${Math.round((at(txs[wake]) - at(txs[wake - 1])) / DAY)} days, then ${money(moved)} moved in ${after.length} transaction${after.length === 1 ? '' : 's'}`)
    }
    // 5. The same check deposited twice (check number, or same amount and payer within 14 days)
    const checks = txs.filter(x => x.direction === 'in' && (x.channel === 'check' || /check|cheque|mobile deposit|rdc/i.test(x.description || '')))
    const num = x => ((x.description || '') + ' ' + (x.counterpartyAccount || '')).match(/(?:check|chk|cheque|#)\s*(?:no\.?|number)?\s*#?(\d{3,})/i)?.[1]
    for (const t of checks.filter(x => isNew.has(x.id))) {
      const twin = checks.find(x => x.id !== t.id && Math.abs(at(x) - at(t)) <= 14 * DAY && x.amount === t.amount && ((num(x) && num(x) === num(t)) || (!num(t) && norm(x.counterparty) && norm(x.counterparty) === norm(t.counterparty))))
      if (twin) { raise('check_duplicate', cid, name, [twin, t], [], `${money(t.amount)} check${num(t) ? ` #${num(t)}` : ` from ${t.counterparty}`} deposited twice within ${Math.max(1, Math.round(Math.abs(at(t) - at(twin)) / DAY))} day${Math.round(Math.abs(at(t) - at(twin)) / DAY) > 1 ? 's' : ''}`); break }
    }
    // 5b. Withdrawal to a wallet address added within the day and never used before (exchanges)
    for (const t of txs.filter(x => isNew.has(x.id) && x.direction === 'out' && x.wallet && x.amount >= s.fraudNewAddressMin)) {
      if (out.some(a => a.customerId === cid && a.txIds.includes(t.id))) continue
      const usedBefore = txs.some(x => x.id !== t.id && at(x) < at(t) && x.wallet === t.wallet)
      const added = evs.filter(e => e.type === 'payee_added' && at(e) <= at(t) && at(t) - at(e) <= DAY).pop()
      if (!usedBefore && added) {
        const mins = Math.round((at(t) - at(added)) / 60000)
        raise('new_address_withdrawal', cid, name, [t], [added], `${money(t.amount)} withdrawn to ${t.wallet.slice(0, 8)}…${t.wallet.slice(-6)}, an address added ${mins < 90 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`} earlier and never used before`)
      }
    }
    // 6. Scam victim: first large payment to a new payee by wire, P2P or crypto — unless another alert
    //    already explains it (takeover, dormancy), or the account collects from many senders (a mule: AML's job)
    const explained = new Set(out.filter(a => a.customerId === cid).flatMap(a => a.txIds))
    for (const t of txs.filter(x => isNew.has(x.id) && !explained.has(x.id) && x.direction === 'out' && ['wire', 'p2p', 'crypto'].includes(x.channel) && x.amount >= s.fraudScamMin)) {
      const senders = new Set(txs.filter(x => x.direction === 'in' && x.counterparty && at(x) <= at(t) && at(x) > at(t) - 7 * DAY).map(x => norm(x.counterparty)))
      if (senders.size >= 3) continue
      // On an exchange the scam pattern is fiat in, then crypto straight out to someone else
      if (segment === 'ce' && txs.filter(x => x.direction === 'in' && ['ach', 'wire', 'card', 'p2p'].includes(x.channel) && at(x) <= at(t) && at(x) > at(t) - 7 * DAY).reduce((n, x) => n + x.amount, 0) < t.amount * 0.5) continue
      const before = txs.filter(x => at(x) < at(t))
      const payee = x => x.wallet || norm(x.counterparty)   // on an exchange the wallet address is the payee
      const paidBefore = before.some(x => x.direction === 'out' && payee(x) && payee(x) === payee(t))
      const biggest = before.filter(x => x.direction === 'out').reduce((m, x) => Math.max(m, x.amount), 0)
      if (!paidBefore && t.amount >= Math.max(biggest * 3, s.fraudScamMin)) {
        const words = (t.description || '').match(SCAM_WORDS)
        raise('scam_victim', cid, name, [t], [], `${money(t.amount)} by ${t.channel} to ${t.counterparty || (t.wallet ? `wallet ${t.wallet.slice(0, 8)}…` : 'a new payee')} — never paid before, ${biggest ? `${(t.amount / biggest).toFixed(1)}× their largest payment in recent months` : 'with no earlier payments on record'}${words ? `; the memo mentions “${words[0]}”` : ''}`,
          { score: words ? 3 : 2, severity: words ? 'high' : 'medium' })
      }
    }
  }

  // 7. Compromised merchant: several confirmed card-fraud victims all used the same merchant in the 60 days before their fraud
  if (fraudCases.length) {
    const byName = new Map()
    ;(history || []).forEach(t => { if (t.customerName) { const k = norm(t.customerName); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(t) } })
    const merchants = new Map()   // merchant → Set(victim)
    fraudCases.forEach(fc => {
      const txs = byName.get(norm(fc.customerName)) || [], fd = new Date(fc.date).getTime()
      new Set(txs.filter(t => t.channel === 'card' && t.direction === 'out' && t.counterparty && at(t) < fd && at(t) > fd - 60 * DAY).map(t => t.counterparty)).forEach(m => {
        if (!merchants.has(m)) merchants.set(m, new Map()); merchants.get(m).set(norm(fc.customerName), { name: fc.customerName, caseId: fc.id })
      })
    })
    merchants.forEach((victims, m) => {
      if (victims.size < s.fraudCppMin) return
      const involved = (history || []).filter(t => t.counterparty === m && victims.has(norm(t.customerName)))
      raise('compromised_merchant', 'MERCHANT:' + norm(m), m, involved, [], `${victims.size} customers with confirmed card fraud all used ${m} in the 60 days before — a likely point of compromise. Other cards used there may be at risk.`,
        { always: true, merchant: m, victims: [...victims.values()] })
    })
  }
  return out.sort((a, b) => b.score - a.score || b.total - a.total)
}

// A day of fictional transactions with patterns planted for the demo and tests
export function sampleDay(now = new Date()) {
  const d = n => { const x = new Date(now.getTime() - n * DAY); return `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()}` }
  const rows = [['Transaction ID', 'Date', 'Account', 'Account Name', 'Amount', 'Currency', 'Type', 'Channel', 'Counterparty', 'Country', 'Wallet', 'Memo']]
  let n = 1000
  const add = (days, acct, name, amt, type, channel, cp = '', country = 'US', wallet = '', memo = '') => rows.push([`TX${n++}`, d(days), acct, name, amt, 'USD', type, channel, cp, country, wallet, memo])
  // Normal life for a few customers (history)
  for (let i = 28; i >= 1; i -= 7) { add(i, 'A-1001', 'K. Mensah', '2450.00', 'Credit', 'ACH', 'Acme Payroll'); add(i - 1 > 0 ? i - 1 : 1, 'A-1001', 'K. Mensah', '120.40', 'Debit', 'Card', 'Grocer Co') }
  for (let i = 26; i >= 2; i -= 8) add(i, 'A-1003', 'P. Novak', '310.00', 'Debit', 'Card', 'Utility Power')
  // Structuring: cash just under $10,000
  add(2, 'A-1002', 'T. Barros', '9500.00', 'Credit', 'Cash', '', 'US', '', 'Branch deposit')
  add(1, 'A-1002', 'T. Barros', '9200.00', 'Credit', 'Cash', '', 'US', '', 'Branch deposit')
  add(0, 'A-1002', 'T. Barros', '8900.00', 'Credit', 'Cash', '', 'US', '', 'ATM deposit')
  // Mule: many senders, then straight out to crypto
  ;['R. Ali', 'M. Chen', 'S. Okafor', 'J. Patel', 'L. Dubois', 'A. Haddad'].forEach((p, i) => add(i < 3 ? 1 : 0, 'A-1004', 'Quick Cash Ventures LLC', (1450 + i * 37).toFixed(2), 'Credit', 'Zelle', p))
  add(0, 'A-1004', 'Quick Cash Ventures LLC', '8600.00', 'Debit', 'Crypto', 'Bitvault Exchange', 'US', '0x252a8bd2319d8a555b872990601221b3a2053bce', 'USDT purchase')
  // High-risk country wire
  add(0, 'A-1003', 'P. Novak', '15000.00', 'Debit', 'Wire', 'Tehran Trading Co', 'Iran', '', 'Invoice 4471')
  // Normal today
  add(0, 'A-1001', 'K. Mensah', '64.10', 'Debit', 'Card', 'Grocer Co')
  // ── Fraud patterns ──
  // Account takeover (see sampleEvents): history, then money out right after a new device and a password change
  add(25, 'A-1005', 'M. Okafor', '42.00', 'Debit', 'Card', 'Corner Cafe'); add(12, 'A-1005', 'M. Okafor', '180.00', 'Debit', 'Card', 'Grocer Co')
  rows.push(['TX9001', d(0) + ' 08:41', 'A-1005', 'M. Okafor', '2400.00', 'USD', 'Debit', 'Zelle', 'Zed Holdings', 'US', '', 'Transfer'])
  // Card testing: a burst of tiny charges, then a big one
  ;['Stream Box', 'Quick Donate', 'App Credits', 'Snack Stop', 'Parking Pay', 'Toll Tag'].forEach((m, i) => rows.push([`TX91${i}`, d(0) + ` 0${2 + Math.floor(i / 3)}:${10 + i * 7}`, 'A-1006', 'D. Patel', (0.5 + i * 0.29).toFixed(2), 'USD', 'Debit', 'Card', m, 'US', '', 'Purchase']))
  rows.push(['TX9120', d(0) + ' 05:02', 'A-1006', 'D. Patel', '780.00', 'USD', 'Debit', 'Card', 'ElectroMax Online', 'US', '', 'Purchase'])
  // Scam victim: a first, large wire with a telling memo
  add(20, 'A-1007', 'E. Moreau', '95.00', 'Debit', 'Card', 'Pharmacy Plus'); add(9, 'A-1007', 'E. Moreau', '240.00', 'Debit', 'ACH', 'City Water')
  add(0, 'A-1007', 'E. Moreau', '9800.00', 'Debit', 'Wire', 'Global Asset Recovery', 'US', '', 'Release fee for frozen investment')
  // Dormant account: nothing for months, then money moves
  add(118, 'A-1008', 'H. Brandt', '25.00', 'Debit', 'Card', 'Bookshop')
  add(0, 'A-1008', 'H. Brandt', '3000.00', 'Credit', 'ACH', 'Unknown Sender LLC'); add(0, 'A-1008', 'H. Brandt', '2900.00', 'Debit', 'P2P', 'R. Vance')
  // The same check deposited twice (mobile, then branch)
  add(1, 'A-1009', 'S. Laurent', '1250.00', 'Credit', 'Check', 'Harbor Roofing', 'US', '', 'Mobile deposit check #4471')
  add(0, 'A-1009', 'S. Laurent', '1250.00', 'Credit', 'Check', 'Harbor Roofing', 'US', '', 'Branch deposit check #4471')
  // Compromised merchant: three customers with confirmed card fraud in the demo cases all bought fuel here
  ;[['A-2001', 'J. Okafor'], ['A-2002', 'M. Chen'], ['A-2003', 'D. Patel']].forEach(([a2, n2], i) => add(18 + i * 3, a2, n2, (48.2 + i * 6).toFixed(2), 'Debit', 'Card', 'Pixel Fuel Station'))
  return rows.map(r => r.map(v => /[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n')
}
// A day on a crypto exchange: deposits in (fiat and crypto), withdrawals out to wallets
export function sampleDayExchange(now = new Date()) {
  const d = n => { const x = new Date(now.getTime() - n * DAY); return `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()}` }
  const rows = [['Txn ID', 'Timestamp', 'User ID', 'User', 'USD Value', 'Currency', 'Side', 'Method', 'Counterparty', 'Country', 'Wallet', 'Note']]
  let n = 5000
  const add = (days, uid, name, usd, side, method, cp = '', country = 'US', wallet = '', note = '', time = '') => rows.push([`XTX${n++}`, d(days) + (time ? ' ' + time : ''), uid, name, usd, 'USD', side, method, cp, country, wallet, note])
  const W = { a: '0x8f3c2a91b7e04d5c66a1e2f9b0c4d7e8a1b2c3d4', b: '0x4e1d9c0b8a7f6e5d4c3b2a19087f6e5d4c3b2a10', c: '0x7a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b', own: '0x1111aaaa2222bbbb3333cccc4444dddd5555eeee' }
  // Regular trader: deposits and withdrawals to their own wallet
  for (let i = 27; i >= 3; i -= 6) { add(i, 'U-301', 'L. Park', '1500.00', 'Deposit', 'ACH'); add(i - 1, 'U-301', 'L. Park', '900.00', 'Withdrawal', 'Crypto withdrawal', 'Own wallet', 'US', W.own) }
  // Exchange account takeover: new device → 2FA reset → withdrawal address added → withdrawal (events in sampleEventsExchange)
  add(20, 'U-302', 'R. Iyer', '2200.00', 'Deposit', 'ACH'); add(14, 'U-302', 'R. Iyer', '600.00', 'Withdrawal', 'Crypto withdrawal', 'Own wallet', 'US', W.own)
  add(0, 'U-302', 'R. Iyer', '8150.00', 'Withdrawal', 'Crypto withdrawal', '', 'US', W.a, 'BTC withdrawal', '03:41')
  // Pig-butchering victim: a large fiat deposit, then a first withdrawal to an outside "investment platform"
  add(25, 'U-303', 'G. Holt', '300.00', 'Deposit', 'ACH'); add(1, 'U-303', 'G. Holt', '15000.00', 'Deposit', 'Wire', 'Holt Family Trust')
  add(0, 'U-303', 'G. Holt', '14800.00', 'Withdrawal', 'Crypto withdrawal', 'Apex Yield Platform', 'US', W.b, 'USDT to investment platform for profit plan')
  // Withdrawal to an address added minutes earlier (no new device — still worth a call)
  add(18, 'U-304', 'T. Nwosu', '4000.00', 'Deposit', 'Wire'); add(0, 'U-304', 'T. Nwosu', '3900.00', 'Withdrawal', 'Crypto withdrawal', '', 'US', W.c, 'ETH withdrawal', '11:05')
  // Withdrawal to an OFAC-listed wallet (AML: sanctions)
  add(5, 'U-305', 'Kestrel OTC Desk', '9000.00', 'Deposit', 'Crypto deposit', '', 'US', '0x9b2e7c1d5f3a8e4b6c0d2f1a7e3b9c5d8f0a2b4c'); add(0, 'U-305', 'Kestrel OTC Desk', '8700.00', 'Withdrawal', 'Crypto withdrawal', '', 'US', '0x252a8bd2319d8a555b872990601221b3a2053bce', 'USDT')
  // Dormant: an account quiet for months suddenly moves money
  add(140, 'U-306', 'F. Sato', '50.00', 'Deposit', 'ACH'); add(0, 'U-306', 'F. Sato', '6200.00', 'Deposit', 'Crypto deposit', '', 'US', '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d'); add(0, 'U-306', 'F. Sato', '6100.00', 'Withdrawal', 'Crypto withdrawal', '', 'US', '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f')
  return rows.map(r => r.map(v => /[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n')
}
export function sampleEventsExchange(now = new Date()) {
  const x = new Date(now), dd = `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()}`
  return ['Event ID,Timestamp,User ID,Event,Device,Location',
    `XEV1,${dd} 03:02,U-302,Login from new device,Windows 11 / Firefox,Bucharest RO`,
    `XEV2,${dd} 03:10,U-302,2FA reset,Windows 11 / Firefox,Bucharest RO`,
    `XEV3,${dd} 03:22,U-302,Withdrawal address added,Windows 11 / Firefox,Bucharest RO`,
    `XEV4,${dd} 10:40,U-304,Withdrawal address added,iPhone 15 / App,Austin US`].join('\n')
}

// Account events to go with sampleDay: the takeover sequence for M. Okafor
export function sampleEvents(now = new Date()) {
  const x = new Date(now), dd = `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()}`
  return ['Event ID,Timestamp,Account,Event,Device,Location',
    `EV1,${dd} 08:12,A-1005,Login from unrecognized device,Android 14 / Chrome,Lagos NG`,
    `EV2,${dd} 08:19,A-1005,Password changed,Android 14 / Chrome,Lagos NG`,
    `EV3,${dd} 08:24,A-1005,Phone number changed,Android 14 / Chrome,Lagos NG`,
    `EV4,${dd} 08:36,A-1005,New payee added: Zed Holdings,Android 14 / Chrome,Lagos NG`,
    `EV5,${dd} 07:55,A-1001,Login,iPhone 15 / Safari,Columbus US`].join('\n')
}

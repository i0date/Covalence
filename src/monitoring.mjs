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
  { key:'customerId',    label:'Customer or account ID',  required:true, syn:['customer id','account','account number','acct','account id','member id','cif','client id','customer number'] },
  { key:'customerName',  label:'Customer name',           syn:['customer name','name','account name','member name','client name','account holder'] },
  { key:'amount',        label:'Amount',                  required:true, syn:['amount','transaction amount','txn amount','value','amt'] },
  { key:'currency',      label:'Currency',                syn:['currency','ccy','currency code'] },
  { key:'direction',     label:'In or out',               syn:['direction','debit credit','dr cr','type','transaction type','in out','dc'], hint:'Leave empty if negative amounts are money going out.' },
  { key:'channel',       label:'Channel',                 syn:['channel','method','rail','payment method','payment type','instrument','tran code'] },
  { key:'counterparty',  label:'Counterparty',            syn:['counterparty','payee','payer','beneficiary','originator','merchant','recipient','sender','other party'] },
  { key:'counterpartyAccount', label:'Counterparty account', syn:['counterparty account','beneficiary account','payee account','to account','from account'] },
  { key:'country',       label:'Counterparty country',    syn:['country','counterparty country','beneficiary country','destination country','country code'] },
  { key:'wallet',        label:'Crypto wallet address',   syn:['wallet','wallet address','crypto address','address','destination address'] },
  { key:'description',   label:'Description / memo',      syn:['description','memo','narrative','details','remarks','purpose'] },
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
export function evaluate(history, newIds, settings, now = new Date()) {
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
      alerts.push({ id: 'ALT-' + hash(key).toUpperCase(), key, customerId, customerName: name, rule, label: r.label, score: r.weight,
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
      if (cryptoSum >= s.tmCryptoMin) raise('crypto', crypto, `${money(cryptoSum)} sent to crypto exchanges or wallets within 7 days`)
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
export function sanctionsAlert(customerId, customerName, txs, hit, now = new Date()) {
  const key = `${customerId}|sanctions|${hit.name}`
  return { id: 'ALT-' + hash(key).toUpperCase(), key, customerId, customerName, rule: 'sanctions', label: RULES.sanctions.label, score: 5, severity: 'high',
    detail: `${hit.subject} ≈ ${hit.name} (${hit.list}, ${hit.programs}) — ${Math.round(hit.score * 100)}% match${hit.others ? `, and ${hit.others} weaker match${hit.others === 1 ? '' : 'es'}` : ''}`, txIds: txs.map(t => t.id),
    total: txs.reduce((n, t) => n + t.amount, 0), from: txs[0]?.ts, to: txs[txs.length - 1]?.ts, createdAt: now.toISOString(), status: 'open', hit }
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
  return rows.map(r => r.map(v => /[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n')
}

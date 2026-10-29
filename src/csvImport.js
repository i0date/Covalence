// ═══════════════════════════════════════════════════════════════════════════════
// CSV IMPORT — turn a case export from another system into Covalence cases
// ═══════════════════════════════════════════════════════════════════════════════
// Plain functions, no React, so they can be tested on their own:
//   parseCsv      the file → headers + rows (quotes, embedded newlines, ; or tab
//                 delimiters, Excel's byte-order mark)
//   guessMapping  which column holds which Covalence field, from the headers
//   buildImport   rows + mapping → new cases, updates to cases already here
//                 (matched on the source system's reference), and per-row errors
// The screen is ImportPanel.jsx.

export const MAX_ROWS = 5000
export const MAX_BYTES = 10 * 1024 * 1024

// ─── Parsing ──────────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const line = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length)
  let best = ',', bestN = 0
  for (const d of [',', ';', '\t', '|']) {
    let n = 0, q = false
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++ }
    if (n > bestN) { best = d; bestN = n }
  }
  return best
}

export function parseCsv(input) {
  const text = String(input || '').replace(/^﻿/, '')
  const d = detectDelimiter(text)
  const rows = []; let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += ch
    } else if (ch === '"' && field === '') q = true
    else if (ch === d) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  if (!rows.length) return { headers: [], rows: [], delimiter: d }
  const seen = {}
  const headers = rows[0].map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`
    if (seen[name]) name = `${name} (${++seen[name]})`; else seen[name] = 1
    return name
  })
  const body = rows.slice(1).map(r => headers.map((_, i) => (r[i] ?? '').trim()))
  return { headers, rows: body, delimiter: d }
}

// ─── Covalence fields ─────────────────────────────────────────────────────────
// type: text | date | amount | email | status | verdict | network | cardType
export const FIELDS = [
  { key:'externalRef',     label:'Case reference',        type:'text',    hint:'The case number in your current system. Used to spot cases already imported.', syn:['case id','case number','case no','case ref','reference','ref','dispute id','dispute number','claim id','claim number','ticket','arn','external id'] },
  { key:'date',            label:'Date opened',           type:'date',    required:true, syn:['date opened','opened','open date','created','created date','date created','received','date received','report date','dispute date','claim date','date'] },
  { key:'merchant',        label:'Merchant / payee',      type:'text',    required:true, syn:['merchant','merchant name','payee','recipient','descriptor','merchant descriptor','beneficiary','counterparty'] },
  { key:'amount',          label:'Amount',                type:'amount',  required:true, syn:['amount','disputed amount','dispute amount','claim amount','transaction amount','txn amount','value','loss amount','amt'] },
  { key:'currency',        label:'Currency',              type:'text',    syn:['currency','ccy','currency code','iso currency'] },
  { key:'network',         label:'Card network',          type:'network', syn:['network','card network','scheme','card brand','brand','card type brand'] },
  { key:'reasonCode',      label:'Reason code',           type:'text',    syn:['reason code','reason','chargeback reason','rc','dispute reason code','reason cd'] },
  { key:'reasonTitle',     label:'Reason description',    type:'text',    syn:['reason description','reason title','reason text','dispute reason'] },
  { key:'status',          label:'Status',                type:'status',  syn:['status','case status','dispute status','stage','state','outcome','result'] },
  { key:'verdict',         label:'Claim type',            type:'verdict', syn:['claim type','dispute type','type','category','fraud type','classification','case type'] },
  { key:'cardholderName',  label:'Cardholder / customer', type:'text',    syn:['cardholder','cardholder name','customer','customer name','member','member name','account holder','client name'] },
  { key:'assignedTo',      label:'Assigned to (email)',   type:'email',   syn:['assigned to','assignee','owner','analyst','agent','investigator','handler','assigned'] },
  { key:'_complaint',      label:'Customer’s description',type:'text',    syn:['description','complaint','customer statement','narrative','details','comments','customer comments','reason for dispute','claim details'] },
  { key:'_transactionDate',label:'Transaction date',      type:'date',    syn:['transaction date','txn date','trans date','purchase date','posting date','post date'] },
  { key:'nextRespDate',    label:'Next response due',     type:'date',    syn:['due date','response due','next due','deadline','response deadline','due'] },
  { key:'provCreditDate',  label:'Provisional credit date',type:'date',   syn:['provisional credit date','pc date','provisional credit','credit date','temp credit date'] },
  { key:'filedAt',         label:'Date filed',            type:'date',    syn:['filed','date filed','filed date','chargeback date','submitted','submission date','date submitted'] },
  { key:'resolvedDate',    label:'Date closed',           type:'date',    syn:['closed','date closed','closed date','resolved','resolved date','resolution date','completed date'] },
  { key:'_cardType',       label:'Debit or credit',       type:'cardType',syn:['card type','product','account type','debit credit','product type'] },
  { key:'note',            label:'Note',                  type:'text',    syn:['note','notes','internal notes','memo','remarks'] },
]
export const FIELD = Object.fromEntries(FIELDS.map(f => [f.key, f]))

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Best column for each field: exact name match first, then a header that contains a synonym
export function guessMapping(headers) {
  const H = headers.map(norm), used = new Set(), map = {}
  for (const pass of ['exact', 'contains']) {
    for (const f of FIELDS) {
      if (map[f.key] != null) continue
      const names = [norm(f.label), ...f.syn.map(norm)]
      const i = H.findIndex((h, idx) => !used.has(idx) && (pass === 'exact' ? names.includes(h) : names.some(n => n.length > 3 && (h.includes(n) || (h.length > 3 && n.includes(h))))))
      if (i >= 0) { map[f.key] = i; used.add(i) }
    }
  }
  return map
}
export const signatureOf = headers => headers.map(norm).sort().join('|')

// ─── Values ───────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0')
const ymd = (y, m, d) => {
  if (y < 100) y += y < 70 ? 2000 : 1900
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}
// Which way round a column's dates are: iso, mdy (US), dmy, or Excel serial numbers
export function detectDateFormat(values) {
  const v = values.filter(Boolean).slice(0, 200)
  if (!v.length) return 'mdy'
  if (v.every(x => /^\d{4,5}(\.\d+)?$/.test(x) && +x > 20000 && +x < 80000)) return 'excel'
  if (v.every(x => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(x))) return 'iso'
  let mdy = true, dmy = true
  v.forEach(x => {
    const m = x.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
    if (!m) return
    if (+m[1] > 12) mdy = false
    if (+m[2] > 12) dmy = false
  })
  return !mdy && dmy ? 'dmy' : 'mdy'
}
// True when the column could be read either way round (no day above 12)
export function dateAmbiguous(values) {
  const v = values.filter(Boolean).slice(0, 200)
  const parts = v.map(x => x.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)).filter(Boolean)
  return parts.length > 0 && parts.every(m => +m[1] <= 12 && +m[2] <= 12) && parts.some(m => m[1] !== m[2])
}
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 }
// → 'YYYY-MM-DD' or null
export function parseDate(raw, fmt) {
  const x = String(raw || '').trim()
  if (!x) return null
  if (fmt === 'excel' && /^\d{4,5}(\.\d+)?$/.test(x)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+x) * 86400000)
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  let m = x.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = x.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) return fmt === 'dmy' ? ymd(+m[3], +m[2], +m[1]) : ymd(+m[3], +m[1], +m[2])
  const month = w => MONTHS[w.toLowerCase()] || MONTHS[w.slice(0, 3).toLowerCase()]
  m = x.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})/)                       // 3 Oct 2026
  if (m && month(m[2])) return ymd(+m[3], month(m[2]), +m[1])
  m = x.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/)                        // Oct 3, 2026
  if (m && month(m[1])) return ymd(+m[3], month(m[1]), +m[2])
  return null
}
const toIso = d => d ? new Date(d + 'T12:00:00').toISOString() : null

const SYMBOLS = [['CA$', 'CAD'], ['C$', 'CAD'], ['US$', 'USD'], ['A$', 'AUD'], ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₦', 'NGN'], ['₹', 'INR']]
// → { value, currency } or null. Accepts "1,234.56", "$1,234.56", "(12.00)", "USD 12", "1.234,56 €"
export function parseAmount(raw) {
  let x = String(raw || '').trim()
  if (!x) return null
  let currency = null
  const code = x.match(/\b([A-Z]{3})\b/)
  if (code) { currency = code[1]; x = x.replace(code[0], '') }
  for (const [sym, cur] of SYMBOLS) if (x.includes(sym)) { currency = currency || cur; x = x.split(sym).join('') }
  x = x.replace(/[()\s-]/g, '')
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(x) || /^\d+,\d{1,2}$/.test(x)) x = x.replace(/\./g, '').replace(',', '.')   // European
  else x = x.replace(/,/g, '')
  const value = Number(x)
  return isFinite(value) && x !== '' ? { value: Math.abs(value), currency } : null
}

export function normNetwork(raw) {
  const v = norm(raw)
  if (!v) return ''
  if (v.includes('visa')) return 'VISA'
  if (v.includes('master') || v === 'mc') return 'MC'
  if (v.includes('amex') || v.includes('american express')) return 'AMEX'
  if (v.includes('discover')) return 'DISCOVER'
  return String(raw).trim().toUpperCase()
}
export function normCardType(raw) {
  const v = norm(raw)
  if (v.includes('debit')) return 'debit'
  if (v.includes('credit')) return 'credit'
  return ''
}

export const STATUSES = [
  ['received', 'Received / new'], ['pending', 'In review'], ['queued', 'Queued to file'], ['filed', 'Filed with network'],
  ['network_invstg', 'Network investigating'], ['representment', 'Merchant responded'], ['pre_arb', 'Pre-arbitration'],
  ['arbitration', 'Arbitration'], ['won', 'Won'], ['lost', 'Lost'], ['withdrawn', 'Withdrawn'], ['closed', 'Closed'],
]
const STATUS_GUESS = [
  ['pre_arb', ['pre arb', 'prearb', 'pre arbitration']], ['arbitration', ['arbitration', 'arb']],
  ['representment', ['represent', 'second presentment', 'merchant respon', 'rebutt']],
  ['network_invstg', ['network invest', 'with network', 'pending network']],
  ['filed', ['filed', 'submitted', 'chargeback raised', 'charged back', 'sent to network']],
  ['queued', ['queued', 'ready to file', 'to be filed']],
  ['won', ['won', 'win', 'favor', 'favour', 'approved', 'recovered', 'paid']],
  ['lost', ['lost', 'loss', 'declined', 'denied', 'rejected', 'unsuccessful', 'written off', 'write off']],
  ['withdrawn', ['withdrawn', 'cancel', 'abandon']],
  ['closed', ['closed', 'complete', 'resolved', 'done']],
  ['pending', ['pending', 'review', 'investigat', 'in progress', 'working', 'open']],
  ['received', ['new', 'received', 'intake', 'logged']],
]
export const VERDICTS = [['TRUE_FRAUD', 'True fraud'], ['FIRST_PARTY_FRAUD', 'First-party fraud'], ['CONSUMER_DISPUTE', 'Consumer dispute'], ['AUTHORIZED_PUSH_PAYMENT', 'Authorised push payment (scam)']]
const VERDICT_GUESS = [
  ['FIRST_PARTY_FRAUD', ['first party', 'friendly', 'abuse']],
  ['AUTHORIZED_PUSH_PAYMENT', ['scam', 'app', 'authorized push', 'authorised push', 'social engineer', 'romance', 'impersonat']],
  ['TRUE_FRAUD', ['fraud', 'unauthori', 'stolen', 'lost card', 'counterfeit', 'ato', 'takeover', 'cnp']],
  ['CONSUMER_DISPUTE', ['dispute', 'not received', 'not as described', 'service', 'merchandise', 'credit not', 'cancel', 'duplicate', 'billing', 'quality']],
]
const guessFrom = (table, raw) => { const v = norm(raw); return v ? (table.find(([, keys]) => keys.some(k => v.includes(k)))?.[0] || '') : '' }
export const guessStatus = raw => guessFrom(STATUS_GUESS, raw)
export const guessVerdict = raw => guessFrom(VERDICT_GUESS, raw)

// Distinct values in a column (for the status / claim type tables), most common first
export function distinctValues(rows, col, limit = 40) {
  const n = {}
  rows.forEach(r => { const v = (r[col] || '').trim(); if (v) n[v] = (n[v] || 0) + 1 })
  return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }))
}

// ─── Build ────────────────────────────────────────────────────────────────────
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CLOSED = ['won', 'lost', 'withdrawn', 'resolved', 'closed']
const newId = (prefix, taken) => {
  let id
  do { id = prefix + Math.random().toString(36).slice(2, 9).toUpperCase() } while (taken.has(id))
  taken.add(id); return id
}
function categoryFor(verdict, network) {
  const mc = network === 'MC'
  if (verdict === 'TRUE_FRAUD' || verdict === 'FIRST_PARTY_FRAUD') return mc ? 'mc_fraud' : 'fraud'
  if (verdict === 'CONSUMER_DISPUTE') return mc ? 'mc_consumer_dispute' : 'consumer_dispute'
  return ''
}

// options: { mapping, dateFormats, statusMap, verdictMap, defaultCurrency, merchantSide, duplicates: 'skip'|'update',
//            fileName, batchId, by, reasonTitles }
// → { creates, updates, errors: [{ row, field, message }], skipped: [{ row, reason }] }
export function buildImport({ rows, existing, options }) {
  const o = options, map = o.mapping || {}
  const get = (r, key) => map[key] != null ? (r[map[key]] ?? '').trim() : ''
  const byRef = new Map((existing || []).filter(c => c.externalRef).map(c => [String(c.externalRef).trim().toLowerCase(), c]))
  const taken = new Set((existing || []).map(c => c.id))
  const seenRefs = new Set()
  const creates = [], updates = [], errors = [], skipped = []
  const now = new Date().toISOString()

  rows.forEach((r, i) => {
    const row = i + 2   // spreadsheet row: 1 is the header
    const err = (field, message) => errors.push({ row, field, message })
    const before = errors.length
    const c = {}

    const ref = get(r, 'externalRef')
    if (ref) {
      const k = ref.toLowerCase()
      if (seenRefs.has(k)) { skipped.push({ row, reason: `Reference ${ref} appears earlier in the file` }); return }
      seenRefs.add(k); c.externalRef = ref
    }
    // Dates
    for (const f of FIELDS.filter(f => f.type === 'date')) {
      const raw = get(r, f.key)
      if (!raw) { if (f.required) err(f.label, 'Missing'); continue }
      const d = parseDate(raw, o.dateFormats?.[f.key] || 'mdy')
      if (!d) { err(f.label, `Can’t read “${raw}” as a date`); continue }
      c[f.key] = f.key === 'nextRespDate' || f.key === '_transactionDate' ? d : toIso(d)
    }
    // Text
    const merchant = get(r, 'merchant')
    if (!merchant) err(FIELD.merchant.label, 'Missing'); else c.merchant = merchant
    ;['reasonCode', 'cardholderName', '_complaint'].forEach(k => { const v = get(r, k); if (v) c[k] = v })
    // Amount
    const rawAmt = get(r, 'amount'), amt = parseAmount(rawAmt)
    if (!rawAmt) err(FIELD.amount.label, 'Missing')
    else if (!amt) err(FIELD.amount.label, `Can’t read “${rawAmt}” as an amount`)
    const currency = (get(r, 'currency') || amt?.currency || o.defaultCurrency || 'USD').toUpperCase().slice(0, 3)
    if (amt) { c.amount = `${amt.value.toFixed(2)} ${currency}`; c._currency = currency }
    // Network, card type
    const network = normNetwork(get(r, 'network')); if (network) c.network = network
    const cardType = normCardType(get(r, '_cardType')); if (cardType) c._cardType = cardType
    // Reason title
    if (c.reasonCode) c.reasonTitle = get(r, 'reasonTitle') || o.reasonTitles?.[c.reasonCode] || ''
    else if (get(r, 'reasonTitle')) c.reasonTitle = get(r, 'reasonTitle')
    // Status and claim type, through the value tables
    const rawStatus = get(r, 'status')
    if (rawStatus) { const s = o.statusMap?.[rawStatus] ?? guessStatus(rawStatus); if (s) c.status = s; else err(FIELD.status.label, `No Covalence status chosen for “${rawStatus}”`) }
    const rawVerdict = get(r, 'verdict')
    if (rawVerdict) { const v = o.verdictMap?.[rawVerdict] ?? guessVerdict(rawVerdict); if (v) c.verdict = v }
    // Owner
    const owner = get(r, 'assignedTo')
    if (owner) { if (EMAIL.test(owner)) c.assignedTo = owner.toLowerCase(); else err(FIELD.assignedTo.label, `“${owner}” isn’t an email address — left unassigned`) }
    const ownerOnly = errors.length - before === 1 && errors[errors.length - 1].field === FIELD.assignedTo.label
    if (errors.length > before && !ownerOnly) return
    if (ownerOnly) errors[errors.length - 1].warning = true   // the case still imports, just unassigned

    const note = get(r, 'note')
    const stamp = { ts: now, event: 'imported', file: o.fileName || '', batch: o.batchId, by: o.by || 'Import' }
    const existingCase = c.externalRef ? byRef.get(c.externalRef.toLowerCase()) : null
    if (existingCase) {
      if (o.duplicates !== 'update') { skipped.push({ row, reason: `Already in Covalence as ${existingCase.id}` }); return }
      updates.push({ ...existingCase, ...c,
        notes: note ? [...(Array.isArray(existingCase.notes) ? existingCase.notes : []), { text: note, ts: now, author: 'Import' }] : existingCase.notes,
        history: [...(existingCase.history || []), { ...stamp, update: true }] })
      return
    }
    const status = c.status || (c.resolvedDate ? 'closed' : c.filedAt ? 'filed' : 'received')
    creates.push({
      id: newId(o.merchantSide ? 'MCH-' : 'COV-', taken), ...c, status,
      category: categoryFor(c.verdict, c.network) || undefined,
      ...(o.merchantSide ? { mode: 'merchant', side: 'merchant' } : {}),
      ...(CLOSED.includes(status) && !c.resolvedDate ? { resolvedDate: c.filedAt || c.date } : {}),
      notes: note ? [{ text: note, ts: now, author: 'Import' }] : [], docs: [],
      source: { type: 'csv', file: o.fileName || '', batch: o.batchId, row },
      history: [stamp],
    })
  })
  return { creates, updates, errors, skipped }
}

// A small file to try the importer with, in a typical core-system export shape
export const SAMPLE_CSV = [
  'Case Number,Date Opened,Merchant Name,Disputed Amount,Currency,Card Brand,Reason Code,Case Status,Dispute Type,Customer Name,Assigned To,Description,Response Due',
  'D-10421,10/02/2026,Glacier Outfitters,$412.50,USD,Visa,13.1,Open,Merchandise not received,K. Mensah,,Jacket ordered Sept 1 never arrived; tracking shows no movement,10/30/2026',
  'D-10422,10/05/2026,Streamly Plus,$14.99,USD,Mastercard,4841,Pending review,Cancelled subscription,L. Ortiz,,Cancelled in August and still billed,',
  'D-10423,10/07/2026,"Harbor & Pine Hotel","$1,284.00",USD,Visa,10.4,Chargeback filed,Fraud - card not present,S. Byrne,,Did not book this stay,11/12/2026',
  'D-10424,09/14/2026,QuickFix Electronics,$89.99,USD,Visa,13.3,Won,Not as described,R. Adeyemi,,Charger stopped working after two days,',
  'D-10425,09/20/2026,Nimbus Air,$642.10,USD,Mastercard,4853,Lost,Service dispute,T. Walsh,,Flight cancelled and voucher refused,',
].join('\n')

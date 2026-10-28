// Shared constants and helpers: settings defaults, business days, DFA grading, case storage, CSV parsing, global styles
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { isSignedIn } from './auth.js'
import { recordDemoCaseEvent } from './demoBackend.js'
import { SUPA_KEY, SUPA_URL, mergeCases, pushCasesToSupa } from './data.js'
import { WORKFLOW_DEFAULTS } from './clocks.mjs'
import { QA_DEFAULTS } from './qa.js'
import { onCasesFromOtherTab, readCases, writeCases } from './caseStore.js'

// ─── Error boundary ───────────────────────────────────────────────────────────
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ padding:'40px', fontFamily:'monospace', background:'#FFF1F1', minHeight:'100vh' }}>
        <div style={{ maxWidth:'700px', margin:'0 auto' }}>
          <div style={{ fontSize:'11px', letterSpacing:'0.1em', color:'#991B1B', marginBottom:'8px' }}>RENDER ERROR</div>
          <div style={{ fontSize:'16px', fontWeight:'bold', color:'#1A1814', marginBottom:'16px' }}>{this.state.error.message}</div>
          <pre style={{ fontSize:'12px', color:'#7C3AED', whiteSpace:'pre-wrap', background:'#F5F3FF', padding:'16px' }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop:'16px', padding:'8px 16px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer' }}>RETRY</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

// ─── Shared compliance defaults ───────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  // Institution profile
  duoInstitutionName:   '',
  institutionType:      '',          // bank | credit_union | fintech | mse | exchange
  jurisdiction:         '',          // us | ca | uk | other
  regulatoryRegime:     '',          // reg_e | fcac | fca | other
  // SAR/STR thresholds by payment type
  sarThreshold:         5000,        // card / general
  sarThresholdACH:      5000,
  sarThresholdP2P:      5000,
  sarThresholdCrypto:   10000,
  dfaEnabled:           true,         // DFA scoring — toggle in Settings
  // Filing windows
  smallDollarThreshold: 50,
  fraudWindowDays:      120,
  consumerWindowDays:   120,
  absoluteCapDays:      540,
  // Operational
  pcMilestones:         [10, 45, 90],
  trackerWindowDays:    60,
  batchFileTime:        '15:00', // HH:MM — daily auto-file time
  // Home snapshot
  snapshotEnabled:      true,
  snapshotDays:         60,
  // Workflow — SLA targets, auto-assignment, escalation, reminders (Settings → Workflow)
  ...WORKFLOW_DEFAULTS,
  // Quality review — monthly sample of closed cases (Settings → Quality review)
  ...QA_DEFAULTS,
}

// ─── Business-day helpers (src/clocks.mjs, shared with the reminder emails) ──
export { addBusinessDays } from './clocks.mjs'
export function daysUntil(date) {
  if (!date) return null
  return Math.ceil((new Date(date) - new Date()) / 86400000)
}

// ─── DFA scoring helpers (shared across 002 and 003) ─────────────────────────
export const DFA_BASE_WIN = {
  '10.1':0.85,'10.2':0.48,'10.3':0.72,'10.4':0.76,'10.5':0.93,
  '11.1':0.88,'11.2':0.82,'11.3':0.75,
  '12.1':0.80,'12.2':0.85,'12.3':0.83,'12.4':0.80,'12.5':0.78,'12.6':0.82,'12.7':0.78,
  '13.1':0.41,'13.2':0.62,'13.3':0.55,'13.4':0.68,'13.5':0.58,'13.6':0.72,'13.7':0.65,'13.8':0.70,'13.9':0.80,
  '4837':0.78,'4840':0.82,'4849':0.88,'4863':0.75,'4870':0.90,'4871':0.81,
  '4808':0.83,'4812':0.80,'4847':0.77,
  '4831':0.85,'4834':0.88,'4835':0.82,'4842':0.86,'4846':0.87,
  '4841':0.48,'4853':0.62,'4854':0.55,'4855':0.68,'4859':0.58,'4860':0.65,'4999':0.72,
}
export const REASON_TITLES = {
  '10.1':'EMV Counterfeit Fraud','10.2':'EMV Lost/Stolen Fraud','10.3':'Other Fraud — Card Present',
  '10.4':'Other Fraud — Card Absent','10.5':'Visa Fraud Monitoring',
  '11.1':'Card Recovery Bulletin','11.2':'Declined Authorization','11.3':'No Authorization',
  '12.1':'Late Presentment','12.2':'Incorrect Transaction Code','12.3':'Incorrect Currency',
  '12.4':'Incorrect Account Number','12.5':'Incorrect Amount','12.6':'Duplicate Processing','12.7':'Invalid Data',
  '13.1':'Merchandise / Services Not Received','13.2':'Cancelled Recurring Transaction',
  '13.3':'Not as Described or Defective','13.4':'Counterfeit Merchandise',
  '13.5':'Misrepresentation','13.6':'Credit Not Processed','13.7':'Cancelled Merchandise / Services',
  '13.8':'Original Credit Transaction Not Accepted','13.9':'Non-Receipt of Cash or Load Value',
  '4837':'No Cardholder Authorization','4840':'Fraudulent Processing of Transactions',
  '4849':'Questionable Merchant Activity','4863':'Cardholder Does Not Recognize',
  '4870':'Chip Liability Shift','4871':'Chip/PIN Liability Shift',
  '4808':'Authorization-Related Chargeback','4812':'Account Number Not on File','4847':'Exceeded Floor Limit',
  '4831':'Transaction Amount Differs','4834':'Duplicate Processing',
  '4835':'Card Not Valid or Expired','4842':'Late Presentment',
  '4846':'Correct Transaction Currency Code Not Provided',
  '4841':'Cancelled Recurring Transaction','4853':'Cardholder Dispute',
  '4854':'Cardholder Dispute — Not Elsewhere Classified',
  '4855':'Goods or Services Not Provided','4859':'Services Not Rendered',
  '4860':'Credit Not Processed','4999':'Domestic Chargeback Dispute',
}

export function estimateFundingGrade(reasonCode, amountStr, signals) {
  signals = signals || {}
  const baseWin = DFA_BASE_WIN[reasonCode] != null ? DFA_BASE_WIN[reasonCode] : 0.55
  let behavScore = 0.60
  const tds = signals.threeDSStatus || ''
  if (tds === 'authenticated') behavScore = 0.95
  else if (tds === 'attempted') behavScore = 0.75
  else if (tds === 'failed')    behavScore = 0.35
  else if (tds === 'none')      behavScore = 0.45
  if (signals.deliveryConfirmed)  behavScore = Math.min(1, behavScore + 0.20)
  if (signals.liabilityShift)     behavScore = Math.min(1, behavScore + 0.15)
  if (signals.refundPolicyShown)  behavScore = Math.min(1, behavScore + 0.05)
  if (signals.priorOrders && parseInt(signals.priorOrders) > 0) behavScore = Math.min(1, behavScore + 0.05)
  const amt = parseFloat((amountStr || '').replace(/[^0-9.]/g, '')) || 0
  const amtScore = amt <= 0 ? 0.50 : amt < 50 ? 0.85 : amt < 250 ? 0.70 : amt < 1000 ? 0.55 : amt < 5000 ? 0.40 : 0.25
  const conf = signals.confidence || ''
  const wp   = signals.winProb   || ''
  const docScore = conf === 'HIGH' || wp === 'HIGH' ? 0.92 : conf === 'LOW' || wp === 'LOW' ? 0.35 : 0.65
  const score = Math.round((baseWin * 0.40 + behavScore * 0.30 + amtScore * 0.15 + docScore * 0.15) * 100)
  const label = score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D'
  const bg    = label === 'A' ? 'bg-emerald-900' : label === 'B' ? 'bg-amber-800' : label === 'C' ? 'bg-orange-800' : 'bg-red-900'
  return { label, bg, text: 'text-stone-50', score }
}

// Case → DFA claim shape (shared by the Desk tracker's →DFA button and the case panel)
export function toDfaClaim(o) {
  return {
    ...o,
    code: parseFloat((o.reasonCode || '').replace(/[^0-9.]/g, '')) || 0,
    filedDaysAgo: Math.max(0, Math.round((Date.now() - new Date(o.date)) / 86400000)),
    windowDays: 45,
    avsMismatch: !!o.avsMismatch, no3DS: !o.threeDSStatus || o.threeDSStatus === 'none',
    deliveryConf: !!o.deliveryConfirmed, merchantAck: false,
    pinVerified: false, isVFMP: !!o.isVFMP,
    strongDocs: (o.confidence === 'HIGH' || o.winProb === 'HIGH'),
    merchantCBR: 0.5, priorClaims: parseInt(o.priorClaims) || 0,
    note: `From Dispute Desk: ${o.merchant || ''}`,
    source: 'desk',
  }
}

export function detectNetwork(code) {
  const c = String(code)
  if (c.startsWith('10') || c.startsWith('11') || c.startsWith('12') || c.startsWith('13')) return 'Visa'
  if (c.startsWith('48') || c === '4999') return 'Mastercard'
  return '—'
}

// ─── Shared storage ───────────────────────────────────────────────────────────
// Case notes exist in two shapes: Desk stored a free-text string, Multi a list of
// { text, ts, author }. Read them through these so neither tool crashes on the other's.
export function notesList(n) {
  if (Array.isArray(n)) return n.filter(x => x && x.text)
  if (typeof n === 'string' && n.trim()) return [{ text: n, ts: null, author: '' }]
  return []
}
export function notesText(n) { return notesList(n).map(x => x.text).join(' · ') }

// Cases live in IndexedDB behind an in-memory copy (see caseStore.js)
export function loadOutcomes()  { return readCases() }
// Case thread: any tool that changes a case gets an updatedAt stamp and, on a
// status change, a history entry — so every case carries its own timeline
// across Triage → Desk → Multi → File without each tool having to log it.
// (Without the stamp, mergeCases kept the stored copy and silently dropped edits.)
function stampCaseChanges(current, next) {
  const byId = new Map(current.map(c => [c.id, c]))
  const now = new Date().toISOString()
  let who = 'Agent'
  try { who = JSON.parse(localStorage.getItem('cov_user') || 'null')?.name || who } catch {}
  return next.map(c => {
    const ex = byId.get(c.id)
    if (ex && new Date(c.updatedAt || 0) > new Date(ex.updatedAt || 0)) return c
    if (ex && JSON.stringify(ex) === JSON.stringify(c)) return c
    const history = [...(c.history || ex?.history || [])]
    if (!ex) history.push({ ts: c.date || now, event: 'created', status: c.status, by: who })
    else if (ex.status !== c.status) history.push({ ts: now, event: 'status', from: ex.status, status: c.status, by: who })
    // Demo visitors: the in-browser audit log records what the database would for a real workspace
    if (!isSignedIn() && history.length > (c.history || ex?.history || []).length) recordDemoCaseEvent(c.id, history[history.length - 1])
    return { ...c, history, updatedAt: now }
  })
}
export function saveOutcomes(o) {
  try {
    const current = readCases()
    const merged = mergeCases(current, stampCaseChanges(current, o))
    writeCases(merged)
    if (window._covSubscribers) window._covSubscribers.forEach(fn => { try { fn(merged) } catch {} })
    // ── Supabase as PRIMARY write (not backup) ─────────────────────────────
    if (SUPA_URL && SUPA_KEY && isSignedIn()) {
      if (window._covSyncStatus) window._covSyncStatus('syncing')
      pushCasesToSupa(merged)
        .then(() => { if (window._covSyncStatus) window._covSyncStatus('synced') })
        .catch(() => { if (window._covSyncStatus) window._covSyncStatus('error') })
    }
  } catch {}
}
// Subscribers hear about saves in this tab and, over the case store's channel, in other tabs
onCasesFromOtherTab(list => { if (window._covSubscribers) window._covSubscribers.forEach(fn => { try { fn(list) } catch {} }) })
export function registerOutcomeSubscriber(fn) {
  if (!window._covSubscribers) window._covSubscribers = new Set()
  window._covSubscribers.add(fn)
  return () => window._covSubscribers.delete(fn)
}
export function loadDeskSession() { try { return JSON.parse(sessionStorage.getItem('cov_desk_session') || 'null') || {} } catch { return {} } }
export function loadSettings()  { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } } }
export function saveSettings(s) { try { localStorage.setItem('cov_settings', JSON.stringify(s)) } catch {} }

// ─── DFA CSV helpers ──────────────────────────────────────────────────────────
function parseDfaCSVLine(line) {
  const cols = []; let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ }
    else if (line[i] === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
    else cur += line[i]
  }
  cols.push(cur.trim()); return cols
}
function parseDfaCSV(text) {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return { claims: [], errors: ['CSV must have a header row and at least one data row.'] }
  const headers = parseDfaCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  const yesno = (v) => (v || '').toLowerCase() === 'yes'
  const claims = []; const errors = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseDfaCSVLine(lines[i])
    if (cols.length < 3) { errors.push('Row ' + i + ': too few columns'); continue }
    const row = {}
    headers.forEach((h, j) => { row[h] = cols[j] || '' })
    claims.push({
      id: row.id || ('ROW-' + i), code: row.code || '',
      amount: parseFloat(row.amount) || 0,
      filedDaysAgo: parseInt(row.filed_days_ago) || 0,
      windowDays: parseInt(row.window_days) || 120,
      avsMismatch: yesno(row.avs_mismatch), no3DS: yesno(row.no_3ds),
      deliveryConf: yesno(row.delivery_confirmed), merchantAck: yesno(row.merchant_acknowledged),
      pinVerified: yesno(row.pin_verified), isVFMP: yesno(row.vfmp_enrolled),
      strongDocs: yesno(row.strong_docs),
      merchantCBR: parseFloat(row.merchant_cbr) || 0,
      priorClaims: parseInt(row.prior_claims) || 0,
      note: row.note || '', source: 'uploaded',
    })
  }
  return { claims, errors }
}

// ─── GLOBAL CSS (injected once by root component) ─────────────────────────────
export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap');

  /* ── Typography ───────────────────────────────────────────────────────── */
  .display-font { font-family:'Fraunces',Georgia,serif; }
  .mono-font    { font-family:'JetBrains Mono',monospace; }

  /* ── Readability layer ─────────────────────────────────────────────────
     The palette's light greys (#A8A29E, #D6D3D1, #78716C) fall below the
     4.5:1 contrast needed for small text on the cream surfaces, and some
     dim greys are too dark on the black panels. These rules correct them
     everywhere, without touching each component: darker warm grey on light
     surfaces, lighter warm grey inside dark panels. */
  .text-stone-300, .text-stone-400 { color:#6B6259 !important; }
  .text-stone-500 { color:#625B53 !important; }
  [style^="color: rgb(168, 162, 158)"], [style*="; color: rgb(168, 162, 158)"],
  [style^="color: rgb(214, 211, 209)"], [style*="; color: rgb(214, 211, 209)"],
  [style^="color: rgb(120, 113, 108)"], [style*="; color: rgb(120, 113, 108)"],
  [style^="color: rgb(122, 112, 104)"], [style*="; color: rgb(122, 112, 104)"] { color:#6B6259 !important; }
  [style*="background: rgb(26, 24, 20)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(26, 24, 20)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(26, 24, 20)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(26, 24, 20)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(26, 24, 20)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(26, 24, 20)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(26, 24, 20)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(26, 24, 20)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(26, 24, 20)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(26, 24, 20)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(26, 24, 20)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(26, 24, 20)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(35, 32, 25)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(35, 32, 25)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(35, 32, 25)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(35, 32, 25)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(35, 32, 25)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(35, 32, 25)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(35, 32, 25)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(35, 32, 25)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(35, 32, 25)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(35, 32, 25)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(35, 32, 25)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(35, 32, 25)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(45, 41, 34)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(45, 41, 34)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(45, 41, 34)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(45, 41, 34)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(45, 41, 34)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(45, 41, 34)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(45, 41, 34)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(45, 41, 34)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(45, 41, 34)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(45, 41, 34)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(45, 41, 34)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(45, 41, 34)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(41, 37, 36)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(41, 37, 36)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(41, 37, 36)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(41, 37, 36)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(41, 37, 36)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(41, 37, 36)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(41, 37, 36)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(41, 37, 36)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(41, 37, 36)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(41, 37, 36)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(41, 37, 36)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(41, 37, 36)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(37, 35, 32)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(37, 35, 32)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(37, 35, 32)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(37, 35, 32)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(37, 35, 32)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(37, 35, 32)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(37, 35, 32)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(37, 35, 32)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(37, 35, 32)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(37, 35, 32)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(37, 35, 32)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(37, 35, 32)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(28, 25, 23)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(28, 25, 23)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(28, 25, 23)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(28, 25, 23)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(28, 25, 23)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(28, 25, 23)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(28, 25, 23)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(28, 25, 23)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(28, 25, 23)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(28, 25, 23)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(28, 25, 23)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(28, 25, 23)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(41, 37, 30)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background: rgb(41, 37, 30)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background: rgb(41, 37, 30)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background: rgb(41, 37, 30)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background: rgb(41, 37, 30)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background: rgb(41, 37, 30)"] [style*="; color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(41, 37, 30)"] [style^="color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(41, 37, 30)"] [style*="; color: rgb(120, 113, 108)"],
  [style*="background-color: rgb(41, 37, 30)"] [style^="color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(41, 37, 30)"] [style*="; color: rgb(122, 112, 104)"],
  [style*="background-color: rgb(41, 37, 30)"] [style^="color: rgb(87, 83, 78)"],
  [style*="background-color: rgb(41, 37, 30)"] [style*="; color: rgb(87, 83, 78)"],
  .bg-stone-900 [style^="color: rgb(120, 113, 108)"],
  .bg-stone-900 [style*="; color: rgb(120, 113, 108)"],
  .bg-stone-900 [style^="color: rgb(122, 112, 104)"],
  .bg-stone-900 [style*="; color: rgb(122, 112, 104)"],
  .bg-stone-900 [style^="color: rgb(87, 83, 78)"],
  .bg-stone-900 [style*="; color: rgb(87, 83, 78)"],
  .bg-stone-800 [style^="color: rgb(120, 113, 108)"],
  .bg-stone-800 [style*="; color: rgb(120, 113, 108)"],
  .bg-stone-800 [style^="color: rgb(122, 112, 104)"],
  .bg-stone-800 [style*="; color: rgb(122, 112, 104)"],
  .bg-stone-800 [style^="color: rgb(87, 83, 78)"],
  .bg-stone-800 [style*="; color: rgb(87, 83, 78)"],
  [style*="background: rgb(26, 24, 20)"] .text-stone-300, [style*="background: rgb(26, 24, 20)"] .text-stone-400, [style*="background: rgb(26, 24, 20)"] .text-stone-500,
  [style*="background: rgb(26, 24, 20)"] .text-stone-600,
  [style*="background-color: rgb(26, 24, 20)"] .text-stone-300, [style*="background-color: rgb(26, 24, 20)"] .text-stone-400, [style*="background-color: rgb(26, 24, 20)"] .text-stone-500,
  [style*="background-color: rgb(26, 24, 20)"] .text-stone-600,
  [style*="background: rgb(35, 32, 25)"] .text-stone-300, [style*="background: rgb(35, 32, 25)"] .text-stone-400, [style*="background: rgb(35, 32, 25)"] .text-stone-500,
  [style*="background: rgb(35, 32, 25)"] .text-stone-600,
  [style*="background-color: rgb(35, 32, 25)"] .text-stone-300, [style*="background-color: rgb(35, 32, 25)"] .text-stone-400, [style*="background-color: rgb(35, 32, 25)"] .text-stone-500,
  [style*="background-color: rgb(35, 32, 25)"] .text-stone-600,
  [style*="background: rgb(45, 41, 34)"] .text-stone-300, [style*="background: rgb(45, 41, 34)"] .text-stone-400, [style*="background: rgb(45, 41, 34)"] .text-stone-500,
  [style*="background: rgb(45, 41, 34)"] .text-stone-600,
  [style*="background-color: rgb(45, 41, 34)"] .text-stone-300, [style*="background-color: rgb(45, 41, 34)"] .text-stone-400, [style*="background-color: rgb(45, 41, 34)"] .text-stone-500,
  [style*="background-color: rgb(45, 41, 34)"] .text-stone-600,
  [style*="background: rgb(41, 37, 36)"] .text-stone-300, [style*="background: rgb(41, 37, 36)"] .text-stone-400, [style*="background: rgb(41, 37, 36)"] .text-stone-500,
  [style*="background: rgb(41, 37, 36)"] .text-stone-600,
  [style*="background-color: rgb(41, 37, 36)"] .text-stone-300, [style*="background-color: rgb(41, 37, 36)"] .text-stone-400, [style*="background-color: rgb(41, 37, 36)"] .text-stone-500,
  [style*="background-color: rgb(41, 37, 36)"] .text-stone-600,
  [style*="background: rgb(37, 35, 32)"] .text-stone-300, [style*="background: rgb(37, 35, 32)"] .text-stone-400, [style*="background: rgb(37, 35, 32)"] .text-stone-500,
  [style*="background: rgb(37, 35, 32)"] .text-stone-600,
  [style*="background-color: rgb(37, 35, 32)"] .text-stone-300, [style*="background-color: rgb(37, 35, 32)"] .text-stone-400, [style*="background-color: rgb(37, 35, 32)"] .text-stone-500,
  [style*="background-color: rgb(37, 35, 32)"] .text-stone-600,
  [style*="background: rgb(28, 25, 23)"] .text-stone-300, [style*="background: rgb(28, 25, 23)"] .text-stone-400, [style*="background: rgb(28, 25, 23)"] .text-stone-500,
  [style*="background: rgb(28, 25, 23)"] .text-stone-600,
  [style*="background-color: rgb(28, 25, 23)"] .text-stone-300, [style*="background-color: rgb(28, 25, 23)"] .text-stone-400, [style*="background-color: rgb(28, 25, 23)"] .text-stone-500,
  [style*="background-color: rgb(28, 25, 23)"] .text-stone-600,
  [style*="background: rgb(41, 37, 30)"] .text-stone-300, [style*="background: rgb(41, 37, 30)"] .text-stone-400, [style*="background: rgb(41, 37, 30)"] .text-stone-500,
  [style*="background: rgb(41, 37, 30)"] .text-stone-600,
  [style*="background-color: rgb(41, 37, 30)"] .text-stone-300, [style*="background-color: rgb(41, 37, 30)"] .text-stone-400, [style*="background-color: rgb(41, 37, 30)"] .text-stone-500,
  [style*="background-color: rgb(41, 37, 30)"] .text-stone-600,
  .bg-stone-900 .text-stone-300, .bg-stone-900 .text-stone-400, .bg-stone-900 .text-stone-500,
  .bg-stone-900 .text-stone-600,
  .bg-stone-800 .text-stone-300, .bg-stone-800 .text-stone-400, .bg-stone-800 .text-stone-500,
  .bg-stone-800 .text-stone-600 { color:#A39A8F !important; }
  /* …but light greys that already read well on the dark panels keep their colour there */
  [style*="background: rgb(26, 24, 20)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(26, 24, 20)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(26, 24, 20)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(26, 24, 20)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background: rgb(35, 32, 25)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(35, 32, 25)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(35, 32, 25)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(35, 32, 25)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background: rgb(45, 41, 34)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(45, 41, 34)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(45, 41, 34)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(45, 41, 34)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background: rgb(41, 37, 36)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(41, 37, 36)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(41, 37, 36)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(41, 37, 36)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background: rgb(37, 35, 32)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(37, 35, 32)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(37, 35, 32)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(37, 35, 32)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background: rgb(28, 25, 23)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(28, 25, 23)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(28, 25, 23)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(28, 25, 23)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background: rgb(41, 37, 30)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background: rgb(41, 37, 30)"] [style*="; color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(41, 37, 30)"] [style^="color: rgb(168, 162, 158)"],
  [style*="background-color: rgb(41, 37, 30)"] [style*="; color: rgb(168, 162, 158)"],
  .bg-stone-900 [style^="color: rgb(168, 162, 158)"],
  .bg-stone-900 [style*="; color: rgb(168, 162, 158)"],
  .bg-stone-800 [style^="color: rgb(168, 162, 158)"],
  .bg-stone-800 [style*="; color: rgb(168, 162, 158)"] { color:#A8A29E !important; }
  [style*="background: rgb(26, 24, 20)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(26, 24, 20)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(26, 24, 20)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(26, 24, 20)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background: rgb(35, 32, 25)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(35, 32, 25)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(35, 32, 25)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(35, 32, 25)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background: rgb(45, 41, 34)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(45, 41, 34)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(45, 41, 34)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(45, 41, 34)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background: rgb(41, 37, 36)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(41, 37, 36)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(41, 37, 36)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(41, 37, 36)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background: rgb(37, 35, 32)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(37, 35, 32)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(37, 35, 32)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(37, 35, 32)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background: rgb(28, 25, 23)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(28, 25, 23)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(28, 25, 23)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(28, 25, 23)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background: rgb(41, 37, 30)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background: rgb(41, 37, 30)"] [style*="; color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(41, 37, 30)"] [style^="color: rgb(214, 211, 209)"],
  [style*="background-color: rgb(41, 37, 30)"] [style*="; color: rgb(214, 211, 209)"],
  .bg-stone-900 [style^="color: rgb(214, 211, 209)"],
  .bg-stone-900 [style*="; color: rgb(214, 211, 209)"],
  .bg-stone-800 [style^="color: rgb(214, 211, 209)"],
  .bg-stone-800 [style*="; color: rgb(214, 211, 209)"] { color:#D6D3D1 !important; }

  /* ── Shared inputs ────────────────────────────────────────────────────── */
  .cov-input, .input-field {
    background:#FAF7F1; border:1px solid #D4CCBC; padding:14px 16px;
    font-family:'Fraunces',Georgia,serif; font-size:15px; width:100%; color:#1A1814;
    transition:border-color 0.2s;
  }
  .cov-input:focus, .input-field:focus { outline:none; border-color:#1A1814; }
  select.input-field { appearance:auto; }

  /* ── Labels ───────────────────────────────────────────────────────────── */
  .cov-label, .input-label {
    font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.15em;
    text-transform:uppercase; color:#6B5F4D; margin-bottom:6px; display:block;
  }

  /* ── Primary button ───────────────────────────────────────────────────── */
  .cov-btn {
    font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.12em;
    padding:14px 24px; background:#1A1814; color:#F5F1EA; border:none; cursor:pointer;
    text-transform:uppercase; transition:background 0.15s;
    display:inline-flex; align-items:center; gap:8px;
  }
  .cov-btn:hover { background:#2D2820; }
  .cov-btn:disabled { opacity:0.4; cursor:not-allowed; }

  /* ── Shared button variants (use via <Button> in ui.jsx) ──────────────── */
  .cov-btn-sm        { padding:8px 14px !important; font-size:10px !important; }
  .cov-btn-secondary { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.12em; text-transform:uppercase;
                       padding:9px 16px; border:1px solid #1A1814; background:#FAF7F1; color:#1A1814; cursor:pointer;
                       display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; white-space:nowrap; }
  .cov-btn-secondary:hover { background:#1A1814; color:#F5F1EA; }
  .cov-btn-danger    { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.12em; text-transform:uppercase;
                       padding:9px 16px; border:1px solid #7F1D1D; background:#7F1D1D; color:#FEF2F2; cursor:pointer;
                       display:inline-flex; align-items:center; gap:6px; transition:background 0.15s; white-space:nowrap; }
  .cov-btn-danger:hover { background:#991B1B; }
  .cov-btn-quiet     { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.12em; text-transform:uppercase;
                       padding:6px 4px; border:none; background:none; color:#57534E; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
  .cov-btn-quiet:hover { color:#1A1814; }
  .cov-btn-secondary:disabled, .cov-btn-danger:disabled, .cov-btn-quiet:disabled { opacity:0.4; cursor:not-allowed; }
  .cov-badge { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.08em; padding:2px 7px; white-space:nowrap; display:inline-block; }

  /* ── Keyboard focus: always visible, never on mouse clicks ────────────── */
  :focus-visible { outline:2px solid #1E3A5F; outline-offset:2px; }
  [style*="background: rgb(26, 24, 20)"] :focus-visible, .wl-doors :focus-visible { outline-color:#D6CFC4; }
  kbd.cov-kbd { font-family:'JetBrains Mono',monospace; font-size:10px; border:1px solid #D4CCBC; border-bottom-width:2px; padding:1px 6px; background:#FAF7F1; color:#1A1814; }

  /* ── Network / mode toggle buttons ───────────────────────────────────── */
  .net-btn {
    font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.12em;
    padding:10px 20px; border:1px solid #D4CCBC; background:#FAF7F1; color:#1A1814;
    cursor:pointer; transition:all 0.15s; text-transform:uppercase;
  }
  .net-btn.active { background:#1A1814; color:#F5F1EA; border-color:#1A1814; }
  .network-btn {
    font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.12em;
    padding:10px 20px; border:1px solid #1A1814; cursor:pointer;
    transition:all 0.15s; flex:1; text-align:center;
  }
  .network-btn.active   { background:#1A1814; color:#F5F1EA; }
  .network-btn.inactive { background:#FAF7F1; color:#6B5F4D; }
  .network-btn.inactive:hover { background:#F0EBE2; }

  /* ── Upload button ────────────────────────────────────────────────────── */
  .upload-btn {
    font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.12em;
    padding:9px 16px; border:1px solid #1A1814; background:#FAF7F1; color:#1A1814;
    cursor:pointer; display:flex; align-items:center; gap:6px; text-transform:uppercase;
    transition:all 0.15s; white-space:nowrap;
  }
  .upload-btn:hover { background:#1A1814; color:#F5F1EA; }

  /* ── Section divider ──────────────────────────────────────────────────── */
  .section-divider { border-top:1px solid #1A1814; margin:32px 0 24px 0; }

  /* ── DFA claim table rows ─────────────────────────────────────────────── */
  .claim-row { border-bottom:1px solid #E8E0D4; transition:background 0.1s; }
  .claim-row:hover td { background:#EEE9E0; }
  .claim-row.selected td { background:#1A1814; color:#F5F1EA; }
  .claim-row.selected td .sub-text { color:#78716c; }
  .claim-row.excluded-row { opacity:0.38; }

  /* ── DFA grade filter tabs ────────────────────────────────────────────── */
  .grade-tab {
    font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.08em;
    padding:5px 12px; border:1px solid #D4CCBC; background:#FAF7F1; color:#6B5F4D;
    cursor:pointer;
  }
  .grade-tab.active { background:#1A1814; color:#F5F1EA; border-color:#1A1814; }
  .grade-tab:hover:not(.active) { border-color:#78716c; color:#1A1814; }
  input[type=range] { accent-color:#1A1814; }

  /* ── Case search rows ─────────────────────────────────────────────────── */
  .cov-search-row:hover { background:#EEE9E0 !important; }
  .cov-nav-search:hover { border-color:#78716C !important; color:#E7E4DF !important; }
  /* Top bar: the compact layout (page name + menu) is used up to 1099px — tablets and small laptops too */
  .cov-nav-menu, .cov-nav-current { display:none; }
  @media (max-width:1099px) {
    .cov-nav-buttons { display:none !important; }
    .cov-nav-current { display:block !important; font-size:10px; letter-spacing:0.14em; color:#D6CFC4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
    .cov-nav-menu { display:block !important; }
    .cov-nav-right .desktop-only { display:none !important; }
    .cov-nav-search { min-width:0 !important; }
    .cov-nav-search-label { display:none !important; }
  }
  /* Laptop widths: icon + shortcut only, so the tab bar stays on one line */
  @media (min-width:768px) and (max-width:1599px) {
    .cov-nav-buttons button { padding:14px 8px !important; letter-spacing:0.06em !important; }
    .cov-nav-collapse { display:none !important; }
    .cov-nav-search { min-width:0 !important; }
    .cov-nav-search-label { display:none !important; }
  }

  /* ── Responsive helpers ───────────────────────────────────────────────── */
  @media(max-width:767px) {
    .cov-search-status { width:auto !important; }
    .cov-yourday-row { grid-template-columns:96px minmax(0,1fr) !important; padding:10px 14px !important; }
    .cov-yourday-row > span:nth-child(2) { display:none; }
    .cov-comingup-row { grid-template-columns:70px minmax(0,1fr) !important; }
    .cov-comingup-row > span:nth-child(2) { display:none; }
    .cov-import-row   { grid-template-columns:1fr !important; gap:6px !important; }
    .cov-import-row select { max-width:none !important; }
    .desktop-only     { display:none !important; }
    /* nav: shrink logo, scroll nav buttons */
    .cov-nav-inner    { overflow-x:auto; -webkit-overflow-scrolling:touch; gap:0 !important; padding:0 8px !important; flex-wrap:nowrap !important; }
    .cov-nav-inner button { flex-shrink:0; padding:14px 8px !important; font-size:10px !important; }
    .cov-nav-logo     { padding-right:10px !important; margin-right:0 !important; border-right:none !important; flex-shrink:0; }
    .cov-nav-logo div { font-size:10px !important; letter-spacing:0.12em !important; }
    .cov-nav-buttons  { overflow-x:auto; -webkit-overflow-scrolling:touch; display:flex !important; flex-shrink:1 !important; min-width:0; }
    .cov-nav-right    { flex-shrink:0; }
    /* home stats: 2-col on mobile */
    .home-stats-grid  { grid-template-columns:repeat(2,1fr) !important; }
    /* single-col fallback for fixed grids */
    .mob-1col         { grid-template-columns:1fr !important; }
    /* platform toggles: no wrap */
    .platform-toggle-btn { white-space:nowrap !important; padding:10px 14px !important; }
    /* phone top bar: logo · current page · search · sync dot · menu (tabs live in the menu) */
    .cov-nav-buttons  { display:none !important; }
    .cov-nav-inner    { min-height:48px; gap:10px !important; padding:0 12px !important; }
    .cov-nav-current  { font-size:10px; letter-spacing:0.14em; color:#D6CFC4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
    .cov-nav-inner .cov-nav-icon { padding:0 !important; width:34px; height:34px; min-width:0 !important; font-size:14px !important; display:inline-flex; align-items:center; justify-content:center; }
    .cov-nav-inner .cov-nav-search svg { width:15px; height:15px; }
    /* mobile menu sits inside the nav but needs full-size tap targets */
    .cov-mobile-menu .cov-mobile-item { font-size:11px !important; padding:15px 20px !important; }
    .cov-mobile-menu .cov-mobile-acct { font-size:10px !important; padding:8px 12px !important; }
  }
  @media(min-width:768px) { .mobile-only  { display:none !important; } }
`

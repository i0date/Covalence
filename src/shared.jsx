// Shared constants and helpers: settings defaults, business days, DFA grading, case storage, CSV parsing, global styles
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { isSignedIn } from './auth.js'
import { recordDemoCaseEvent } from './demoBackend.js'
import { auditWrite } from './audit.js'
import { SUPA_KEY, SUPA_URL, mergeCases, pushCasesToSupa } from './data.js'
import { WORKFLOW_DEFAULTS } from './clocks.mjs'
import { QA_DEFAULTS } from './qa.js'
import { onCasesFromOtherTab, readCases, writeCases } from './caseStore.js'
import { FINCRIME_DEFAULTS } from './fincrime.js'
import { sendCaseSteps } from './claimsData.js'
import { TM_DEFAULTS, FRAUD_DEFAULTS } from './monitoring.mjs'

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
  institutionType:      '',          // bank | credit_union | fintech | mse | exchange | merchant | processor
  sides:                [],          // issuer | acquirer | merchant — empty: implied by the type (sides.mjs)
  mchRespondDays:       10,          // merchant side: days to answer a chargeback (merchantQueue.mjs)
  mchAcceptBelow:       25,          // …recommend accepting chargebacks under this amount
  mchFightCost:         25,          // …what one response costs to prepare
  mchMonthlyTxVisa:     0,           // …card sales per month, for the chargeback ratio on Home (chargebackRatio.mjs)
  mchMonthlyTxMc:       0,
  mchRatioVisa:         1.5,         // …ratio thresholds, %
  mchRatioMc:           1.5,
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
  // Default views (Settings → Default views): where each screen starts
  homeRange:            '60',        // Home date range: 7 | 30 | 60 | 90 | all
  homeCasesOpen:        'closed',    // Home case list starts: closed | open
  triageDefaultTab:     'alerts',    // Triage opens on: alerts | claims
  triageDefaultSide:    'auto',      // fi | ce | auto = from the institution type
  // Workflow — SLA targets, auto-assignment, escalation, reminders (Settings → Workflow)
  ...WORKFLOW_DEFAULTS,
  // Quality review — monthly sample of closed cases (Settings → Quality review)
  ...QA_DEFAULTS,
  // Financial crime — sanctions screening (Settings → Financial crime)
  ...FINCRIME_DEFAULTS,
  // Transaction monitoring rules (Settings → Financial crime)
  ...TM_DEFAULTS,
  // Fraud alert rules and the customer-contact deadline (Settings → Financial crime)
  ...FRAUD_DEFAULTS,
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
// status or owner change, a history entry — so every case carries its own timeline
// across Triage → Desk → Multi → File without each tool having to log it.
// A take-over carries its reason in _assignReason, which moves into the history
// entry (and the audit log) and isn't kept on the case.
// (Without the stamp, mergeCases kept the stored copy and silently dropped edits.)
function stampCaseChanges(current, next) {
  const byId = new Map(current.map(c => [c.id, c]))
  const now = new Date().toISOString()
  let who = 'Agent'
  try { who = JSON.parse(localStorage.getItem('cov_user') || 'null')?.name || who } catch {}
  return next.map(c => {
    const ex = byId.get(c.id)
    // A new owner is always recorded, whichever tool made the change, unless that tool already logged it
    const before = ex?.history || []
    const owner = ex && (ex.assignedTo || '') !== (c.assignedTo || '')
      && !(c.history || []).slice(before.length).some(h => h.event === 'assigned')
    if (!owner) {
      if (ex && new Date(c.updatedAt || 0) > new Date(ex.updatedAt || 0)) return c
      if (ex && JSON.stringify(ex) === JSON.stringify(c)) return c
    }
    const history = [...(c.history || ex?.history || [])], had = history.length
    if (!ex) history.push({ ts: c.date || now, event: 'created', status: c.status, by: who })
    else if (ex.status !== c.status) history.push({ ts: now, event: 'status', from: ex.status, status: c.status, by: who })
    const { _assignReason: reason, _newOwner: newOwner, ...rest } = c
    // A case opened by taking it (CaseThread withOwner): the database logs it as created, not assigned
    if (!ex && newOwner && c.assignedTo) {
      history.push({ ts: now, event: 'assigned', from: '', to: c.assignedTo, by: who })
      if (isSignedIn()) auditWrite('case.assigned', 'case', c.id, { from: null, to: c.assignedTo })
    }
    if (owner) {
      history.push({ ts: now, event: 'assigned', from: ex.assignedTo || '', to: c.assignedTo || '', by: who, ...(reason ? { reason } : {}) })
      // The database logs case.assigned (from, to) itself; a take-over's reason it can't see
      if (isSignedIn() && reason) auditWrite('case.taken_over', 'case', c.id, { from: ex.assignedTo || '', to: c.assignedTo || '', reason })
    }
    // Demo visitors: the in-browser audit log records what the database would for a real workspace
    if (!isSignedIn()) history.slice(had).forEach(h => recordDemoCaseEvent(c.id, h))
    return { ...rest, history, updatedAt: now }
  })
}
export function saveOutcomes(o) {
  try {
    const current = readCases()
    const merged = mergeCases(current, stampCaseChanges(current, o))
    writeCases(merged)
    sendCaseSteps(current, merged)   // cases from the bank's app: provisional credit, filed, resolved
    if (window._covSubscribers) window._covSubscribers.forEach(fn => { try { fn(merged) } catch {} })
    // ── Supabase as PRIMARY write (not backup) ─────────────────────────────
    if (SUPA_URL && SUPA_KEY && isSignedIn()) {
      if (window._covSyncStatus) window._covSyncStatus('syncing')
      pushCasesToSupa(merged)
        .then(touched => {
          if (window._covSyncStatus) window._covSyncStatus('synced')
          // Someone else changed some of these cases meanwhile: their changes, merged with ours, come back in
          if (touched?.length) {
            const now = mergeCases(readCases(), touched)
            writeCases(now)
            if (window._covSubscribers) window._covSubscribers.forEach(fn => { try { fn(now) } catch {} })
          }
        })
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
  /* Top bar controls (alarm, search, reminders, shortcuts, menu): one height, so the row reads as a set */
  .cov-nav-ctl { height:30px; box-sizing:border-box; flex-shrink:0; }
  @media (max-width:767px) { .cov-nav-ctl { height:36px; min-width:36px; } }
  /* Narrow phones: slightly smaller controls; the smallest drop the DEMO tag (the banner below says it) */
  @media (max-width:400px) { .cov-nav-ctl, .cov-nav-inner .cov-nav-icon { height:34px !important; min-width:34px; } .cov-nav-inner .cov-nav-icon { width:34px !important; }
    .cov-nav-inner, .cov-nav-right { gap:6px !important; }
    .cov-nav-logo div { letter-spacing:0.08em !important; } .cov-nav-demo { letter-spacing:0.06em !important; padding:2px 4px !important; } }
  @media (max-width:359px) { .cov-nav-demo { display:none !important; } }
  .cov-nav-search:hover { border-color:#78716C !important; color:#E7E4DF !important; }
  /* Top bar: the compact layout (page name + menu) is used below 1400px, the width the full tab row needs — tablets and laptops too */
  .cov-nav-menu, .cov-nav-current { display:none; }
  @media (max-width:1399px) {
    .cov-nav-buttons { display:none !important; }
    .cov-nav-current { display:block !important; font-size:10px; letter-spacing:0.14em; color:#D6CFC4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
    .cov-nav-menu { display:block !important; }
    .cov-nav-right .desktop-only { display:none !important; }
    .cov-nav-search { min-width:0 !important; }
    .cov-nav-search-label { display:none !important; }
  }
  /* Sound the alarm: the full label on wide screens, "ALARM" down to phones, the flag alone on the smallest */
  @media (max-width:1399px) { .cov-alarm-long { display:none !important; } }
  @media (min-width:1400px) { .cov-alarm-short { display:none !important; } }
  @media (max-width:359px)  { .cov-alarm-short { display:none !important; } }
  @media (max-width:480px)  { .cov-alarm-btn { padding:6px 6px !important; gap:4px !important; letter-spacing:0.04em !important; } }
  .cov-alarm-btn:hover, .cov-alarm-btn:focus-visible { filter:brightness(1.15); }
  /* A possible fraud wave to look at: a small amber dot on the alarm button */
  .cov-alarm-btn { position:relative; }
  .cov-alarm-hint { position:absolute; top:-4px; right:-4px; width:9px; height:9px; border-radius:50%; background:#D97706; border:2px solid #1A1814; }
  /* Phone menu: fit the visible screen (100dvh excludes Safari's address bar) and clear the home indicator */
  .cov-mobile-menu { max-height:calc(100vh - 48px); max-height:calc(100dvh - 48px); padding-bottom:env(safe-area-inset-bottom); }
  /* Phones: the sync status moves into the menu so the top bar keeps room for the alarm */
  @media (max-width:480px) { .cov-sync-pill { display:none !important; } }
  /* Phones: no room for the page name beside the logo and four controls; the page's own masthead names it */
  @media (max-width:480px) { .cov-nav-current { visibility:hidden; } }
  /* Eight tools: the number sits small above each name, as on the mastheads and in the menu; labels line up along the bottom */
  .cov-nav-num { display:none; }
  @media (min-width:1400px) {
    .cov-nav-buttons button { display:inline-flex !important; flex-direction:column; justify-content:flex-end; align-items:flex-start; height:48px; padding:0 8px 13px !important; line-height:1; }
    .cov-nav-buttons .cov-nav-num { display:block; font-size:8px; letter-spacing:0.1em; color:#78716C; margin-bottom:4px; }
  }
  /* Desktop widths: icon + shortcut only, so the tab bar stays on one line (the bar is capped at 1320px) */
  @media (min-width:768px) {
    .cov-nav-buttons button { padding:14px 8px !important; letter-spacing:0.06em !important; }
    .cov-nav-collapse { display:none !important; }
    .cov-nav-search { min-width:0 !important; }
    .cov-nav-search-label { display:none !important; }
  }

  /* ── Responsive helpers ───────────────────────────────────────────────── */
  @media(max-width:1023px) { .home-stats-grid { grid-template-columns:repeat(3, minmax(0,1fr)) !important; } }
  .cov-home-cases-bar:hover { background:#F3EEE5 !important; }
  /* Front page: a dateline between rules, the greeting, a lead sentence, then the brief in columns */
  .cov-front { margin:0 0 28px; }
  .cov-front-dateline { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:10px; letter-spacing:0.16em; color:#57534E;
    border-top:3px double #1A1814; border-bottom:1px solid #1A1814; padding:7px 0 6px; }
  .cov-front-greeting { margin:18px 0 4px; font-size:17px; font-style:italic; color:#57534E; }
  .cov-front-lead { margin:0 0 18px; font-size:clamp(24px, 3vw, 36px); font-weight:500; line-height:1.12; letter-spacing:-0.02em; color:#1A1814; max-width:24em; text-wrap:balance; }
  .cov-front-items { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); }
  .cov-front-item { padding:8px 20px 12px; min-width:0; }
  .cov-front-item:nth-child(4n+1) { padding-left:0; }
  .cov-front-item:not(:nth-child(4n+1)) { border-left:1px solid #D4CCBC; }
  .cov-front-item:nth-child(n+5) { border-top:1px solid #D4CCBC; }
  .cov-front-kicker { font-size:10px; letter-spacing:0.16em; font-weight:600; margin-bottom:6px; color:#1A1814; }
  .cov-front-text { margin:0; font-size:15px; line-height:1.55; color:#1A1814; }
  .cov-new-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#1E3A5F; margin-right:7px; vertical-align:1px; flex-shrink:0; }
  /* Insights: numbered sections between rules, figures in a row, a plain table */
  .cov-ins-section { border-top:1px solid #1A1814; padding:22px 0 34px; }
  .cov-ins-kicker { font-size:10px; letter-spacing:0.18em; color:#57534E; font-weight:600; }
  .cov-ins-title { font-size:clamp(24px, 2.6vw, 32px); font-weight:600; letter-spacing:-0.015em; margin:6px 0 6px; color:#1A1814; }
  .cov-ins-intro { font-size:15px; color:#57534E; line-height:1.5; max-width:640px; margin:0 0 18px; }
  .cov-ins-figures { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); border-top:1px solid #D4CCBC; }
  .cov-ins-figure { padding:14px 18px 6px 0; min-width:0; }
  .cov-ins-figure + .cov-ins-figure { border-left:1px solid #D4CCBC; padding-left:18px; }
  .cov-ins-finding { border-left:3px solid #92400E; background:#FAF7F1; padding:12px 16px; }
  .cov-ins-table { width:100%; border-collapse:collapse; font-family:Georgia,serif; font-size:14px; }
  .cov-ins-table th { text-align:left; font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.12em; font-weight:500; color:#57534E; text-transform:uppercase; padding:8px 12px 8px 0; border-bottom:1px solid #1A1814; }
  .cov-ins-table td { padding:9px 12px 9px 0; border-bottom:1px solid #E7E2D9; vertical-align:top; }
  .cov-ins-check { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid #E7E2D9; }
  @media (max-width:599px) { .cov-ins-figure + .cov-ins-figure { border-left:none; padding-left:0; border-top:1px solid #E7E2D9; } .cov-ins-hide { display:none; } }
  .cov-front-alarm { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; border-left:3px solid #991B1B; background:#FFFFFF; padding:8px 12px; margin:0 0 14px; }
  .cov-front-fold { width:100%; display:flex; align-items:center; gap:14px; background:none; border:none; border-top:1px solid #1A1814; border-bottom:1px solid #D4CCBC; padding:10px 0; text-align:left; cursor:pointer; font-size:10px; letter-spacing:0.12em; color:#57534E; }
  .cov-front-fold:hover .cov-front-fold-btn, .cov-front-fold:focus-visible .cov-front-fold-btn { background:#1A1814; color:#F5F1EA; }
  .cov-front-fold-label { font-weight:600; color:#1A1814; letter-spacing:0.16em; white-space:nowrap; }
  .cov-front-fold-counts { flex:1; min-width:0; display:flex; flex-wrap:wrap; gap:4px 0; }
  .cov-front-sep { margin:0 8px; color:#A8A29E; }
  .cov-front-fold-btn { background:#FFFFFF; border:1px solid #1A1814; padding:6px 10px; color:#1A1814; white-space:nowrap; }
  .cov-front-group { padding-top:12px; }
  .cov-front-group-title { font-size:10px; letter-spacing:0.16em; color:#6B6259; margin-bottom:2px; }
  .cov-front-group .cov-front-items { border-top:none; }
  /* A case or claim named in the brief: a small reference tag you can open */
  .cov-ref { display:inline-block; background:#FFFFFF; border:1px solid #D4CCBC; color:#1A1814; font-size:10.5px; letter-spacing:0.04em; padding:0 5px; margin:1px 0; line-height:1.7; cursor:pointer; vertical-align:1px; }
  .cov-ref-more { display:inline-block; background:none; border:none; border-bottom:1px dotted #8A7F72; color:#57534E; font-size:10.5px; letter-spacing:0.04em; padding:0 1px; margin:1px 0; line-height:1.5; cursor:pointer; vertical-align:1px; }
  .cov-ref-more:hover { color:#1A1814; border-bottom-color:#1A1814; }
  .cov-take-it { flex-shrink:0; background:#1A1814; color:#F5F1EA; border:1px solid #1A1814; padding:4px 9px; font-size:10px; letter-spacing:0.12em; cursor:pointer; white-space:nowrap; }
  .cov-take-it:hover { background:#3F3A35; }
  .cov-pool { border:1px solid #1E3A5F; background:#F4F6F9; padding:12px 14px; display:grid; gap:10px; }
  .cov-pool-urgent { border-color:#991B1B; }
  .cov-pool-quiet { border-color:#D4CCBC; background:#FAF7F1; }
  .cov-pool-row { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
  .cov-pool-kicker { font-size:10px; letter-spacing:0.16em; color:#1E3A5F; }
  .cov-pool-chip { font-size:9.5px; letter-spacing:0.08em; padding:2px 6px; background:#E3E8F0; color:#1E3A5F; }
  .cov-pool-task { display:flex; align-items:center; gap:8px; padding:5px 0; border-top:1px solid #E3E8F0; }
  .cov-pool-task:first-child { border-top:none; }
  .cov-pool-add { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
  .cov-owner { border:1px solid #D4CCBC; background:#FAF7F1; padding:12px 14px; display:grid; gap:12px; }
  .cov-owner-row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  .cov-owner-btn { background:#FFFFFF; border:1px solid #1A1814; color:#1A1814; padding:7px 11px; font-size:10px; letter-spacing:0.12em; cursor:pointer; }
  .cov-owner-btn:hover:not(:disabled) { background:#F3EEE5; }
  .cov-owner-btn-main { background:#1A1814; color:#F5F1EA; }
  .cov-owner-btn-main:hover:not(:disabled) { background:#3F3A35; }
  .cov-owner-btn:disabled { opacity:0.45; cursor:not-allowed; }
  .cov-owner-form { display:grid; gap:10px; border-top:1px solid #E7E2D9; padding-top:12px; }
  .cov-set-grid { display:grid; grid-template-columns:240px minmax(0,1fr); gap:36px; align-items:start; }
  .cov-set-nav { position:sticky; top:16px; display:grid; gap:14px; }
  .cov-set-search { padding:8px 10px; font-size:14px; width:100%; box-sizing:border-box; }
  .cov-set-select { display:none; padding:8px 10px; font-size:14px; width:100%; }
  .cov-set-group { display:grid; gap:1px; margin-bottom:12px; }
  .cov-set-group-title { font-size:10px; letter-spacing:0.16em; color:#8A7F72; padding:0 10px 4px; }
  .cov-set-item { display:flex; justify-content:space-between; align-items:center; gap:8px; width:100%; text-align:left; background:none; border:none; border-left:2px solid transparent; padding:6px 10px; font-family:'Fraunces',Georgia,serif; font-size:15px; color:#3F3A35; cursor:pointer; }
  .cov-set-item:hover { background:#F3EEE5; color:#1A1814; }
  .cov-set-item.active { background:#EEE9E0; border-left-color:#1A1814; color:#1A1814; font-weight:600; }
  .cov-set-results { display:grid; gap:2px; }
  .cov-set-hit { text-align:left; background:#FFFFFF; border:1px solid #E7E2D9; padding:7px 10px; cursor:pointer; }
  .cov-set-hit:hover { border-color:#1A1814; }
  .cov-set-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#1E3A5F; flex-shrink:0; }
  .cov-set-flash { outline:2px solid #1E3A5F; outline-offset:4px; transition:outline-color 1.6s; }
  @media (max-width: 860px) {
    .cov-set-grid { grid-template-columns:minmax(0,1fr); gap:20px; }
    .cov-set-nav { position:static; }
    .cov-set-list { display:none; }
    .cov-set-select { display:block; }
  }
  .cov-app-claims { border:1px solid #D4CCBC; background:#FAF7F1; margin-bottom:24px; }
  .cov-app-claims-bar { width:100%; display:flex; align-items:center; gap:18px; flex-wrap:wrap; background:none; border:none; padding:14px 18px; cursor:pointer; text-align:left; }
  button.cov-app-claims-bar:hover { background:#F3EEE5; }
  .cov-app-claims-title { font-size:20px; font-weight:600; color:#1A1814; letter-spacing:-0.01em; }
  .cov-app-claims-counts { display:flex; flex-wrap:wrap; gap:4px 14px; flex:1; min-width:0; font-size:10px; letter-spacing:0.12em; color:#57534E; }
  .cov-app-claims-btn { flex-shrink:0; background:#FFFFFF; border:1px solid #1A1814; padding:6px 10px; font-size:10px; letter-spacing:0.12em; color:#1A1814; white-space:nowrap; }
  .cov-app-claim { border-bottom:1px solid #E7E2D9; padding:0 14px; }
  .cov-app-claims-tools { display:flex; justify-content:space-between; align-items:center; gap:10px 16px; flex-wrap:wrap; padding:10px 18px; }
  .cov-app-claim:last-child { border-bottom:none; }
  .cov-ref:hover, .cov-ref:focus-visible { border-color:#1A1814; }
  @media (max-width:1023px) { .cov-front-items { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .cov-front-item:nth-child(4n+1) { padding-left:20px; } .cov-front-item:nth-child(2n+1) { padding-left:0; border-left:none !important; }
    .cov-front-item:not(:nth-child(2n+1)) { border-left:1px solid #D4CCBC; } .cov-front-item:nth-child(n+3) { border-top:1px solid #D4CCBC; } }
  @media (max-width:599px) { .cov-front-items { grid-template-columns:minmax(0,1fr); } .cov-front-fold { flex-wrap:wrap; } .cov-front-fold-btn { margin-left:auto; } .cov-front-fold-counts { order:3; flex-basis:100%; }
    .cov-front-item { padding:12px 0 12px !important; border-left:none !important; } .cov-front-item + .cov-front-item { border-top:1px solid #D4CCBC; }
    .cov-front-greeting { margin-top:14px; font-size:16px; } .cov-front-lead { margin-bottom:14px; } }
  /* Your day: the plan, and the forecast beside it on wide screens (below it on narrow ones) */
  /* One left edge for the header, the tabs' text and the rows: 18px in from the border (14px on a phone) */
  .cov-yourday-head { padding:18px 18px 4px; }
  .cov-yd-tabs { display:flex; gap:0; border-bottom:1px solid #D4CCBC; padding:6px 8px 0; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
  .cov-yd-tabs::-webkit-scrollbar { display:none; }
  .cov-yd-tab { background:none; border:none; border-bottom:2px solid transparent; margin-bottom:-1px; padding:11px 10px 9px; font-size:10px; letter-spacing:0.14em; color:#6B6259; cursor:pointer; white-space:nowrap; display:inline-flex; gap:7px; align-items:baseline; }
  .cov-yd-tab:hover { color:#1A1814; }
  .cov-yd-tab[aria-selected="true"] { color:#1A1814; border-bottom-color:#1A1814; font-weight:600; }
  .cov-yd-tab-n { font-size:9.5px; color:#8A7F72; font-weight:500; }
  .cov-yd-pane { padding:14px 20px 16px; }
  /* Pre-dispute alerts (PreDisputePanel.jsx) */
  .cov-pd-stats { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); border-bottom:1px solid #D4CCBC; background:#FFFFFF; }
  .cov-pd-stats > div { padding:12px 18px; display:flex; flex-direction:column; gap:2px; min-width:0; }
  .cov-pd-stats > div + div { border-left:1px solid #E2DACC; }
  .cov-pd-stats span { font-size:9.5px; letter-spacing:0.14em; color:#6B6259; }
  .cov-pd-stats strong { font-family:'Fraunces',Georgia,serif; font-size:28px; font-weight:600; color:#1A1814; line-height:1.1; }
  .cov-pd-stats em { font-size:12.5px; font-style:normal; color:#57534E; }
  .cov-pd-row { padding:14px 18px; border-top:1px solid #E7E2D9; }
  .cov-pd-main { flex:1 1 360px; min-width:0; text-align:left; background:none; border:0; padding:0; cursor:pointer; }
  .cov-pd-settled { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; padding:7px 0; border-top:1px solid #EFEAE1; }
  .cov-acq-merchant { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1.3fr) auto; gap:8px 16px; align-items:center; width:100%; text-align:left; background:none; border:0; padding:0; cursor:pointer; }
  .cov-acq-name { font-size:17px; color:#1A1814; min-width:0; overflow-wrap:break-word; }
  .cov-acq-name span { display:block; font-size:11px; color:#6B6259; margin-top:2px; }
  .cov-acq-counts { display:flex; gap:5px; flex-wrap:wrap; }
  .cov-acq-ratios { display:flex; gap:10px; font-size:10px; letter-spacing:0.1em; color:#6B6259; white-space:nowrap; }
  .cov-acq-case { padding:10px 0; border-top:1px solid #EFEAE1; }
  .cov-acq-answer { margin-top:10px; padding:12px 14px; background:#FFFFFF; border:1px solid #E2DACC; }
  .cov-acq-checks { list-style:none; margin:10px 0 0; padding:0; display:grid; gap:4px; }
  .cov-acq-checks li { font-family:'Fraunces',Georgia,serif; font-size:14px; color:#3F3A35; display:flex; gap:8px; }
  .cov-acq-checks li span { width:14px; flex:none; font-weight:700; }
  .cov-acq-checks li.yes span { color:#065F46; } .cov-acq-checks li.no { color:#991B1B; } .cov-acq-checks li.opt { color:#78716C; }
  .cov-acq-checks em { font-style:normal; font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.08em; margin-left:6px; }
  @media (max-width:767px) { .cov-acq-merchant { grid-template-columns:1fr; } }
  @media (max-width:767px) { .cov-pd-stats { grid-template-columns:repeat(2, minmax(0,1fr)); } .cov-pd-stats > div:nth-child(3) { border-left:none; } .cov-pd-stats > div:nth-child(n+3) { border-top:1px solid #E2DACC; } .cov-pd-row { padding:12px 14px; } }
  .cov-ydv-team { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); border-bottom:1px solid #D4CCBC; }
  .cov-ydv-team-block { padding:14px 18px 14px; min-width:0; }
  .cov-ydv-team-block + .cov-ydv-team-block { border-left:1px solid #D4CCBC; }
  .cov-ydv-stack { display:flex; gap:2px; height:22px; margin:10px 0 10px; }
  .cov-ydv-stack > span { min-width:4px; border-radius:2px; }
  .cov-ydv-stack-key { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:2px 16px; }
  .cov-ydv-stack-key button { display:flex; align-items:baseline; gap:8px; width:100%; background:none; border:0; padding:4px 0; text-align:left; cursor:pointer; border-bottom:1px solid #EDE7DC; }
  .cov-ydv-stack-key button:disabled { cursor:default; opacity:0.55; }
  .cov-ydv-stack-key button:not(:disabled):hover span.display-font { text-decoration:underline; }
  .cov-ydv-stack-key i { width:9px; height:9px; border-radius:2px; flex:none; align-self:center; }
  .cov-ydv-stack-key span.display-font { font-size:13px; color:#1A1814; flex:1; min-width:0; }
  .cov-ydv-stack-key strong { font-size:13px; color:#1A1814; font-weight:600; }
  .cov-ydv-stack-pct { font-size:10px; color:#8A7F72; width:34px; text-align:right; }
  .cov-ydv-ages { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:8px; height:120px; margin-top:10px; align-items:end; }
  .cov-ydv-age { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; min-width:0; }
  .cov-ydv-age-n { font-size:12px; font-weight:600; color:#1A1814; margin-bottom:4px; }
  .cov-ydv-age-bar { width:100%; max-width:44px; border-radius:3px 3px 0 0; }
  .cov-ydv-age-label { font-size:9px; color:#6B6259; margin-top:6px; white-space:nowrap; letter-spacing:0.02em; }
  .cov-ydv-team-note { margin:10px 0 0; font-size:14px; color:#1A1814; }
  @media (max-width:767px) { .cov-ydv-team { grid-template-columns:minmax(0,1fr); } .cov-ydv-team-block + .cov-ydv-team-block { border-left:none; border-top:1px solid #D4CCBC; } .cov-ydv-stack-key { grid-template-columns:minmax(0,1fr); } .cov-ydv-age-label { font-size:8px; white-space:normal; text-align:center; } }
  .cov-yd-team-sum { display:flex; flex-wrap:wrap; gap:6px 18px; padding:12px 18px; font-size:10px; letter-spacing:0.12em; color:#57534E; border-bottom:1px solid #D4CCBC; background:#F7F3EC; }
  .cov-yd-team-sum strong { font-size:13px; color:inherit; font-weight:600; margin-right:4px; letter-spacing:0; }
  /* Your day's panel: the same height on every tab, so it never takes over Home */
  .cov-yd-panel { height:460px; overflow:hidden; position:relative; }
  .cov-yd-panel > [role=tabpanel] { height:100%; }
  .cov-yd-scroll { height:100%; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
  .cov-yd-scroll .cov-plan-head { position:sticky; top:0; z-index:1; background:#FAF7F1; box-shadow:0 1px 0 #EDE7DC; }
  .cov-yd-scroll:focus-visible { outline:2px solid #1A1814; outline-offset:-2px; }
  .cov-yd-panel::after { content:''; position:absolute; left:0; right:0; bottom:0; height:22px; pointer-events:none; background:linear-gradient(rgba(250,247,241,0), #FAF7F1); }
  @media (max-width:767px) { .cov-yd-panel { height:auto; max-height:none; overflow:visible; } .cov-yd-panel::after { display:none; } .cov-yd-scroll { height:auto; max-height:520px; } }
  .cov-ydv-read { margin:0 0 12px; font-size:16px; line-height:1.4; color:#1A1814; }
  .cov-ydv-forecast { padding:18px 20px; height:100%; display:flex; flex-direction:column; }
  .cov-ydv-tiles { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); border:1px solid #D4CCBC; background:#FFFFFF; flex:1; min-height:0; }
  .cov-ydv-tile { padding:14px 16px 14px; display:flex; flex-direction:column; gap:4px; min-width:0; cursor:help; }
  .cov-ydv-tile + .cov-ydv-tile { border-left:1px solid #E2DACC; }
  .cov-ydv-tile-label { font-size:9.5px; letter-spacing:0.16em; color:#6B6259; }
  .cov-ydv-tile-value { font-size:40px; line-height:1.05; font-weight:600; color:#1A1814; letter-spacing:-0.02em; margin-top:4px; font-variant-numeric:tabular-nums; }
  .cov-ydv-tile-caption { font-size:13px; line-height:1.4; color:#57534E; }
  .cov-ydv-tile-spark { flex:1; min-height:48px; max-height:150px; padding-top:12px; display:flex; flex-direction:column; justify-content:flex-end; }
  .cov-ydv-tile-spark > svg { flex:1; min-height:36px; }
  .cov-ydv-tile-you { font-size:10px; letter-spacing:0.1em; color:#1A1814; border-top:1px solid #EDE7DC; padding-top:7px; margin-top:6px; }
  .cov-ydv-foot { margin:10px 0 0; font-size:12px; font-style:italic; color:#8A7F72; }
  .cov-ydv-split { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr); height:100%; }
  .cov-ydv-chart { padding:18px 22px 14px; min-width:0; }
  .cov-ydv-chart svg g[role=button]:focus-visible > rect:first-child { stroke:#1A1814; stroke-width:1; }
  .cov-ydv-side { border-left:1px solid #D4CCBC; background:#F7F3EC; padding:16px 18px; min-width:0; overflow-y:auto; }
  .cov-ydv-side-head { font-size:10px; letter-spacing:0.14em; font-weight:600; padding-bottom:8px; border-bottom:1px solid #D4CCBC; }
  .cov-ydv-side-list { list-style:none; margin:0; padding:0; }
  .cov-ydv-case { display:grid; grid-template-columns:auto minmax(0,1fr); grid-template-areas:'id name' 'why why'; gap:2px 10px; align-items:baseline; width:100%; text-align:left; background:none; border:0; border-bottom:1px solid #EDE7DC; padding:9px 2px; cursor:pointer; }
  .cov-ydv-case-id { grid-area:id; font-size:11px; color:#57534E; white-space:nowrap; }
  .cov-ydv-case-name { grid-area:name; font-size:14px; color:#1A1814; min-width:0; overflow-wrap:break-word; }
  .cov-ydv-case-why { grid-area:why; font-size:10px; letter-spacing:0.04em; line-height:1.5; }
  .cov-ydv-case:hover { background:#FFFFFF; }
  .cov-ydv-legend { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:10px; color:#57534E; margin-top:8px; min-height:15px; }
  .cov-ydv-legend i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:-1px; }
  .cov-ydv-stats { display:flex; flex-direction:column; gap:18px; padding:20px 22px; }
  .cov-ydv-stat-pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; border-top:1px solid #D4CCBC; border-bottom:1px solid #D4CCBC; padding:12px 0; }
  .cov-ydv-stat { font-size:28px; font-weight:600; line-height:1.1; color:#1A1814; font-variant-numeric:tabular-nums; }
  @media (max-width:1100px) { .cov-ydv-tiles { grid-template-columns:repeat(3, minmax(0,1fr)); } .cov-ydv-tile:nth-child(4) { border-left:none; } .cov-ydv-tile:nth-child(n+4) { border-top:1px solid #E2DACC; } .cov-ydv-tile-value { font-size:32px; }
    .cov-yd-panel:has(.cov-ydv-forecast) { height:auto; } .cov-yd-panel:has(.cov-ydv-forecast)::after { display:none; } }
  @media (max-width:767px) { .cov-ydv-split { grid-template-columns:minmax(0,1fr); } .cov-ydv-side { border-left:none; border-top:1px solid #D4CCBC; max-height:340px; }
    .cov-ydv-tiles { grid-template-columns:repeat(2, minmax(0,1fr)); } .cov-ydv-tile { border-left:none !important; border-top:1px solid #E2DACC; } .cov-ydv-tile:nth-child(-n+2) { border-top:none; } .cov-ydv-tile:nth-child(even) { border-left:1px solid #E2DACC !important; }
    .cov-ydv-forecast, .cov-ydv-chart { padding:14px; } .cov-ydv-tile { padding:12px; } .cov-ydv-tile-value { font-size:28px; } }
  .cov-yd-fc-cols { display:grid; grid-template-columns:minmax(0,1fr); }
  .cov-yd-fc-cols > .cov-fc-block { padding:4px 0 12px; }
  .cov-yd-fc-cols > .cov-fc-block + .cov-fc-block { border-top:1px solid #D4CCBC; padding-top:12px; }
  @media (min-width:900px) { .cov-yd-fc-cols { grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:28px; } .cov-yd-fc-cols > .cov-fc-block + .cov-fc-block { border-top:none; border-left:1px solid #D4CCBC; padding:4px 0 12px 28px; } }
  .cov-yd-chart { max-width:760px; }
  .cov-yd-chart svg g[role=button]:focus-visible > rect:first-child { stroke:#1A1814; stroke-width:1; }
  .cov-yd-grid { display:grid; grid-template-columns:minmax(0,1fr); }
  .cov-yd-plan { min-width:0; }
  .cov-yd-forecast { min-width:0; background:#F3EEE6; border-top:1px solid #1A1814; padding:16px 20px 18px; }
  @media (min-width:1100px) { .cov-yd-grid { grid-template-columns:minmax(0,1fr) 380px; } .cov-yd-forecast { border-top:none; border-left:1px solid #D4CCBC; } }
  @media (min-width:1400px) { .cov-yd-grid { grid-template-columns:minmax(0,1fr) 420px; } }
  .cov-plan-group + .cov-plan-group { border-top:1px solid #D4CCBC; }
  .cov-plan-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; padding:12px 18px 8px; }
  .cov-plan-title { font-size:10px; letter-spacing:0.16em; font-weight:600; color:#1A1814; }
  .cov-plan-note { font-size:13px; font-style:italic; color:#6B6259; }
  .cov-plan-batch { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:9px 18px; border-top:1px solid #EDE7DC; }
  .cov-fc-head { font-size:10px; letter-spacing:0.16em; font-weight:600; color:#1A1814; padding-bottom:8px; border-bottom:1px solid #1A1814; }
  .cov-fc-block { padding:12px 0 14px; }
  .cov-fc-block + .cov-fc-block { border-top:1px solid #D4CCBC; }
  .cov-fc-who { font-size:17px; font-weight:600; font-style:italic; color:#1A1814; margin-bottom:6px; }
  .cov-claim-answers { margin:0; display:grid; grid-template-columns:minmax(180px, 44%) minmax(0,1fr); gap:4px 16px; }
  .cov-claim-answers dt { line-height:1.4; }
  @media (max-width: 560px) { .cov-claim-answers { grid-template-columns:1fr; gap:0; } .cov-claim-answers dd { margin-bottom:6px !important; } }
  .cov-fc-pick { margin-top:10px; padding:10px 12px; background:#FFFFFF; border:1px solid #D4CCBC; }
  .cov-yd-forecast svg g[role=button]:focus-visible > rect:first-child { stroke:#1A1814; stroke-width:1; }
  .cov-fc-line { display:grid; grid-template-columns:78px minmax(0,1fr); gap:10px; padding:4px 0; align-items:baseline; }
  .cov-fc-label { font-size:9.5px; letter-spacing:0.12em; color:#6B6259; }
  .cov-fc-text { font-size:14px; line-height:1.45; color:#3F3A35; }
  .cov-fc-text strong { color:#1A1814; font-weight:600; }
  .cov-fc-note { margin:4px 0 0; font-size:12.5px; font-style:italic; color:#6B6259; line-height:1.45; border-top:1px solid #D4CCBC; padding-top:10px; }
  @media (max-width:599px) { .cov-yd-forecast { padding:14px 14px 16px; } .cov-plan-head { padding:12px 14px 8px; } .cov-plan-batch { padding:9px 14px; } }
  @media(max-width:767px) {
    .cov-search-status { width:auto !important; }
    .cov-yourday-row { grid-template-columns:minmax(0,1fr) !important; gap:6px !important; justify-items:start; padding:12px 14px !important; }
    .cov-yourday-why { white-space:normal !important; }
    .cov-yourday-row > span:nth-child(2) { display:none; }
    .cov-comingup-row { grid-template-columns:70px minmax(0,1fr) !important; }
    .cov-comingup-row > span:nth-child(2) { display:none; }
    .cov-comingup-row { align-items:start !important; padding:6px 0 !important; }
    .cov-comingup-what { white-space:normal !important; }
    .cov-comingup-why { display:block; }
    .cov-comingup-dot { display:none; }
    .cov-import-row   { grid-template-columns:1fr !important; gap:6px !important; }
    /* Your day: the hide/show control sits top-right, always in reach */
    .cov-yourday-head { padding:14px 14px 2px; }
    .cov-yd-tabs { padding:4px 4px 0; }
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
    .cov-home-cases-bar  { justify-content:space-between; row-gap:8px !important; }
    .cov-home-cases-sum  { order:3; flex:1 1 100% !important; gap:12px !important; }
    .cov-app-claims-bar { justify-content:space-between; row-gap:8px; }
    .cov-app-claims-counts { order:3; flex:1 1 100%; gap:4px 12px; }
    .cov-app-claims-title { flex:1 1 0; min-width:0; font-size:18px; line-height:1.2; }
    .cov-app-claim { padding:0 6px; }
    /* single-col fallback for fixed grids */
    .mob-1col         { grid-template-columns:1fr !important; }
    /* platform toggles: no wrap */
    .platform-toggle-btn { white-space:nowrap !important; padding:10px 14px !important; }
    /* phone top bar: logo · current page · search · sync dot · menu (tabs live in the menu) */
    .cov-nav-buttons  { display:none !important; }
    .cov-nav-inner    { min-height:48px; gap:8px !important; padding:0 12px !important; }
    .cov-nav-inner .cov-nav-logo { padding-right:0 !important; }
    .cov-nav-right    { padding-left:0 !important; gap:8px !important; }
    .triage-root.cov-home { padding-top:20px !important; }
    .cov-nav-current  { font-size:10px; letter-spacing:0.14em; color:#D6CFC4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
    .cov-nav-inner .cov-nav-icon { padding:0 !important; width:36px; height:36px; min-width:0 !important; font-size:14px !important; display:inline-flex; align-items:center; justify-content:center; }
    .cov-nav-inner .cov-nav-search svg { width:15px; height:15px; }
    /* mobile menu sits inside the nav but needs full-size tap targets */
    .cov-mobile-menu .cov-mobile-item { font-size:11px !important; padding:15px 20px !important; }
    .cov-mobile-menu .cov-mobile-item.cov-mobile-sub { padding-left:32px !important; }
    .cov-mobile-menu .cov-mobile-acct { font-size:10px !important; padding:8px 12px !important; }
  }
  @media(min-width:768px) { .mobile-only  { display:none !important; } }
`

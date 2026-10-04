import React, { useState, useEffect, useRef, useMemo } from 'react'
import { FileText, AlertCircle, Loader2, Copy, Check, ArrowRight, CheckSquare, Square,
         Shield, MessageSquare, ClipboardList, Download, Pencil, Upload,
         ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle, Plus, X,
         Clipboard, BarChart2, Bitcoin, Send, Lock, ExternalLink } from 'lucide-react'

// ─── Error boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
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
const DEFAULT_SETTINGS = {
  smallDollarThreshold: 50,
  sarThreshold:         5000,
  fraudWindowDays:      120,
  consumerWindowDays:   120,
  absoluteCapDays:      540,
  pcMilestones:         [10, 45, 90],
  trackerWindowDays:    60,
}

// ─── Business-day helpers ─────────────────────────────────────────────────────
const HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-05-27','2024-06-19','2024-07-04',
  '2024-09-02','2024-10-14','2024-11-11','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19','2025-07-04',
  '2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
  '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
])
function isBusinessDay(d) {
  const day = d.getDay()
  if (day === 0 || day === 6) return false
  return !HOLIDAYS.has(d.toISOString().split('T')[0])
}
function addBusinessDays(startStr, n) {
  let d = new Date(startStr); let added = 0
  while (added < n) { d.setDate(d.getDate() + 1); if (isBusinessDay(d)) added++ }
  return d
}
function daysUntil(date) {
  if (!date) return null
  return Math.ceil((new Date(date) - new Date()) / 86400000)
}

// ─── DFA scoring helpers (shared across 002 and 003) ─────────────────────────
const DFA_BASE_WIN = {
  '10.1':0.85,'10.2':0.48,'10.3':0.72,'10.4':0.76,'10.5':0.93,
  '11.1':0.88,'11.2':0.82,'11.3':0.75,
  '12.1':0.80,'12.2':0.85,'12.3':0.83,'12.4':0.80,'12.5':0.78,'12.6':0.82,'12.7':0.78,
  '13.1':0.41,'13.2':0.62,'13.3':0.55,'13.4':0.68,'13.5':0.58,'13.6':0.72,'13.7':0.65,'13.8':0.70,'13.9':0.80,
  '4837':0.78,'4840':0.82,'4849':0.88,'4863':0.75,'4870':0.90,'4871':0.81,
  '4808':0.83,'4812':0.80,'4847':0.77,
  '4831':0.85,'4834':0.88,'4835':0.82,'4842':0.86,'4846':0.87,
  '4841':0.48,'4853':0.62,'4854':0.55,'4855':0.68,'4859':0.58,'4860':0.65,'4999':0.72,
}
const REASON_TITLES = {
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

function estimateFundingGrade(reasonCode, amountStr, signals) {
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

function detectNetwork(code) {
  const c = String(code)
  if (c.startsWith('10') || c.startsWith('11') || c.startsWith('12') || c.startsWith('13')) return 'Visa'
  if (c.startsWith('48') || c === '4999') return 'Mastercard'
  return '—'
}

// ─── Shared storage ───────────────────────────────────────────────────────────
function loadOutcomes()  { try { return JSON.parse(localStorage.getItem('cov_outcomes') || '[]') } catch { return [] } }
function saveOutcomes(o) { try { localStorage.setItem('cov_outcomes', JSON.stringify(o)) } catch {} }
function loadSettings()  { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } } }
function saveSettings(s) { try { localStorage.setItem('cov_settings', JSON.stringify(s)) } catch {} }

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
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap');

  /* ── Typography ───────────────────────────────────────────────────────── */
  .display-font { font-family:'Fraunces',Georgia,serif; }
  .mono-font    { font-family:'JetBrains Mono',monospace; }

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

  /* ── Responsive helpers ───────────────────────────────────────────────── */
  @media(max-width:767px) {
    .desktop-only     { display:none !important; }
    /* nav: shrink logo, reduce gap, scroll nav buttons */
    .cov-nav-inner    { overflow-x:auto; -webkit-overflow-scrolling:touch; gap:0 !important; padding:0 12px !important; }
    .cov-nav-inner button { flex-shrink:0; padding:14px 10px !important; font-size:8px !important; }
    .cov-nav-logo     { padding-right:12px !important; margin-right:0 !important; }
    .cov-nav-logo div { font-size:10px !important; letter-spacing:0.15em !important; }
    /* home stats: 2-col on mobile */
    .home-stats-grid  { grid-template-columns:repeat(2,1fr) !important; }
    /* single-col fallback for fixed grids */
    .mob-1col         { grid-template-columns:1fr !important; }
    /* platform toggles: no wrap */
    .platform-toggle-btn { white-space:nowrap !important; padding:10px 14px !important; }
  }
  @media(min-width:768px) { .mobile-only  { display:none !important; } }
`

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — Covalence
// ═══════════════════════════════════════════════════════════════════════════════
export default function Covalence() {
  const [activeSection, setActiveSection] = useState('home')
  const [outcomes,      setOutcomes]      = useState(loadOutcomes)
  const [settings,      setSettings]      = useState(loadSettings)
  const [platformMode,  setPlatformMode]  = useState('fi')
  const [triageHandoff, setTriageHandoff] = useState(null)
  const [dfaQueue,      setDfaQueue]      = useState([])

  useEffect(() => { saveOutcomes(outcomes) }, [outcomes])
  useEffect(() => { saveSettings(settings) }, [settings])

  const NAV = [
    { id:'home',     label:'HOME' },
    { id:'triage',   label:'001  TRIAGE' },
    { id:'desk',     label:'002  DISPUTE DESK' },
    { id:'dfa',      label:'003  DFA' },
    { id:'settings', label:'SETTINGS' },
  ]

  return (
    <ErrorBoundary>
      <div className="min-h-screen" style={{ background:'#F5F1EA', fontFamily:'Georgia,"Times New Roman",serif' }}>
        <style>{GLOBAL_CSS}</style>

        {/* ── Top nav ── */}
        <div className="sticky top-0 z-50" style={{ background:'#1A1814', borderBottom:'1px solid #2D2922' }}>
          <div className="cov-nav-inner" style={{ maxWidth:'1280px', margin:'0 auto', display:'flex', alignItems:'center', gap:'32px', padding:'0 24px' }}>
            <div className="cov-nav-logo" onClick={() => setActiveSection('home')} title="Home" style={{ paddingRight:'28px', borderRight:'1px solid #2D2922', marginRight:'4px', flexShrink:0, cursor:'pointer' }}>
              <div className="mono-font" style={{ fontSize:'14px', letterSpacing:'0.3em', color:'#F5F1EA', fontWeight:500, lineHeight:1 }}>COVALENCE</div>
            </div>
            <div style={{ display:'flex', alignItems:'center' }}>
              {NAV.map(({ id, label }) => (
                <button key={id} onClick={() => setActiveSection(id)}
                  style={{
                    fontFamily:"'JetBrains Mono',monospace", fontSize:'9px', letterSpacing:'0.12em',
                    padding:'14px 16px', background:'transparent', border:'none',
                    borderBottom: activeSection === id ? '2px solid #D6CFC4' : '2px solid transparent',
                    color: activeSection === id ? '#F5F1EA' : '#7A7068',
                    cursor:'pointer', textTransform:'uppercase', transition:'all 0.15s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
            {platformMode === 'merchant' && (
              <span className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', color:'#F59E0B', marginLeft:'auto', padding:'14px 0' }}>MERCHANT MODE</span>
            )}
          </div>
        </div>

        {/* ── Section views ── */}
        {activeSection === 'home'     && (
          <HomeView outcomes={outcomes} settings={settings} setActiveSection={setActiveSection} platformMode={platformMode} />
        )}
        {activeSection === 'triage'   && (
          <TriageView onHandoff={(h) => { setTriageHandoff(h); setActiveSection('desk') }} />
        )}
        {activeSection === 'desk'     && (
          <DeskView
            outcomes={outcomes} setOutcomes={setOutcomes}
            settings={settings} setSettings={setSettings}
            triageHandoff={triageHandoff} setTriageHandoff={setTriageHandoff}
            onScoreInDfa={(cases) => { setDfaQueue(cases); setActiveSection('dfa') }}
            platformMode={platformMode} setPlatformMode={setPlatformMode}
          />
        )}
        {activeSection === 'dfa'      && (
          <DfaView dfaQueue={dfaQueue} setDfaQueue={setDfaQueue} />
        )}
        {activeSection === 'settings' && (
          <SettingsView settings={settings} setSettings={setSettings} />
        )}
      </div>
    </ErrorBoundary>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOME VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function HomeView({ outcomes: _parentOutcomes, settings: _ps, setActiveSection, platformMode }) {
  // Always read fresh from localStorage so stats reflect Desk additions without page reload
  const [outcomes] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('cov_outcomes') || '[]') } catch { return [] }
  })
  const settings = React.useMemo(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } }
  }, [])
  const windowDays = settings.trackerWindowDays || 60
  const sixtyDaysAgo = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const recent   = outcomes.filter(o => new Date(o.date) > sixtyDaysAgo)
  const active   = platformMode === 'merchant' ? recent.filter(o => o.mode === 'merchant') : recent.filter(o => o.mode !== 'merchant')
  const resolved = active.filter(o => o.status === 'won' || o.status === 'lost')
  const won      = active.filter(o => o.status === 'won')
  const inProg   = active.filter(o => ['filed','representment','pre_arb'].includes(o.status))
  const pending  = active.filter(o => o.status === 'pending')
  const winRate  = resolved.length > 0 ? Math.round(won.length / resolved.length * 100) : null
  const urgent   = recent.filter(o => o.mode !== 'merchant' && o.provCreditDate && !['won','lost','withdrawn'].includes(o.status)).filter(o => {
    const d = daysUntil(addBusinessDays(o.provCreditDate, 45)); return d !== null && d >= 0 && d <= 7
  })

  const stats = [
    { label:'OPEN CASES',  value: (pending.length + inProg.length).toString(), sub:'last 60 days' },
    { label:'WIN RATE',    value: winRate !== null ? winRate + '%' : '—',       sub: resolved.length + ' resolved' },
    { label:'IN PROGRESS', value: inProg.length.toString(),                     sub:'filed / representment' },
    { label:'RESOLVED',    value: resolved.length.toString(),                   sub:'won + lost' },
  ]

  return (
    <div className="triage-root" style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <div className="mb-10 pb-8" style={{ borderBottom:'1px solid #D4CCBC' }}>
        <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(48px,7vw,80px)', letterSpacing:'-0.02em', lineHeight:1.05 }}>
          The<br /><span style={{ fontStyle:'italic', fontWeight:500 }}>Brief</span>
        </h1>
        <p className="display-font text-stone-600 mt-4" style={{ fontSize:'clamp(14px,1.6vw,16px)', maxWidth:'520px', lineHeight:1.5 }}>
          Three tools, one workflow — triage incoming disputes, manage the desk, and score portfolios for funding.
        </p>
      </div>

      {urgent.length > 0 && (
        <div className="mb-6 border border-amber-700 px-4 py-3" style={{ background:'#FFFBEB' }}>
          <div className="mono-font text-stone-900 mb-2" style={{ fontSize:'10px', letterSpacing:'0.12em' }}>
            {'⚠'} {urgent.length} CASE{urgent.length > 1 ? 'S' : ''} APPROACHING 45BD DEADLINE
          </div>
          {urgent.map(o => {
            const d45 = addBusinessDays(o.provCreditDate, 45)
            const days = daysUntil(d45)
            return (
              <div key={o.id} className="mono-font text-amber-800" style={{ fontSize:'11px' }}>
                {o.id} — {o.merchant} — due {d45.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ({days}d)
              </div>
            )
          })}
        </div>
      )}

      <div className="mb-8 home-stats-grid" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px' }}>
        {stats.map(s => (
          <div key={s.label} className="border border-stone-300 px-5 py-5" style={{ background:'#FAF7F1' }}>
            <div className="mono-font text-stone-400 mb-2" style={{ fontSize:'9px', letterSpacing:'0.15em' }}>{s.label}</div>
            <div className="display-font font-semibold text-stone-900" style={{ fontSize:'36px', lineHeight:1 }}>{s.value}</div>
            <div className="mono-font text-stone-400 mt-2" style={{ fontSize:'10px' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="mb-10" style={{ display:'flex', flexWrap:'wrap', gap:'12px' }}>
        <button onClick={() => setActiveSection('triage')} className="cov-btn">
          <Clipboard style={{ width:'16px', height:'16px' }} />START TRIAGE
        </button>
        <button onClick={() => setActiveSection('desk')} className="cov-btn" style={{ background:'#3B3530' }}>
          <FileText style={{ width:'16px', height:'16px' }} />DISPUTE DESK
        </button>
        <button onClick={() => setActiveSection('dfa')} className="cov-btn" style={{ background:'#2D3748' }}>
          <BarChart2 style={{ width:'16px', height:'16px' }} />SCORE IN DFA
        </button>
      </div>

      {active.length > 0 ? (
        <div>
          <div className="mono-font text-stone-400 mb-3" style={{ fontSize:'10px', letterSpacing:'0.15em' }}>RECENT CASES</div>
          <div className="border border-stone-200">
            {active.slice(0, 8).map((o, i) => (
              <div key={o.id} onClick={() => setActiveSection('desk')}
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors"
                style={{ borderTop: i > 0 ? '1px solid #E7E2D9' : 'none' }}>
                <span className="mono-font text-stone-400" style={{ fontSize:'10px', width:'88px', flexShrink:0 }}>{o.id}</span>
                <span className="display-font text-stone-700 flex-1 truncate" style={{ fontSize:'14px' }}>{o.merchant}</span>
                <span className="mono-font text-stone-500" style={{ fontSize:'11px' }}>{o.amount}</span>
                <span className="mono-font" style={{
                  fontSize:'9px', padding:'2px 6px',
                  background: o.status === 'won' ? '#064E3B' : o.status === 'lost' ? '#7F1D1D' : o.status === 'pending' ? '#E7E2D9' : '#92400E',
                  color: o.status === 'pending' ? '#4B4540' : '#F9FAFB',
                }}>{o.status.toUpperCase()}</span>
                <span className="mono-font text-stone-400 desktop-only" style={{ fontSize:'10px' }}>
                  {new Date(o.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-stone-200 px-6 py-12 text-center" style={{ background:'#FAF7F1' }}>
          <div className="display-font text-stone-400 italic" style={{ fontSize:'18px' }}>No cases in the last 60 days</div>
          <button onClick={() => setActiveSection('triage')}
            className="mono-font text-stone-500 mt-4 hover:text-stone-800 transition-colors"
            style={{ fontSize:'10px', letterSpacing:'0.12em', background:'none', border:'none', cursor:'pointer', display:'block', margin:'16px auto 0' }}>
            START A TRIAGE {'→'}
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 001 TRIAGE VIEW — stub (full build next)
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// 001 TRIAGE — full view (FI + Crypto Exchange modes)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Transaction types per account type ──────────────────────────────────────
const TX_TYPES = {
  debit:   ['Card-Present (In-person)', 'Card-Not-Present (Online)', 'Card-Not-Present (Phone order)', 'Digital Payment / Wallet', 'ATM Withdrawal'],
  credit:  ['Card-Present (In-person)', 'Card-Not-Present (Online)', 'Card-Not-Present (Phone order)', 'Digital Payment / Wallet', 'Recurring / Subscription'],
  p2p:     ['Zelle', 'Interac e-Transfer', 'P2P (Venmo / Cash App / PayPal)', 'Wire Transfer'],
  ach_eft: ['ACH / EFT Transfer', 'Wire Transfer', 'Bill Payment (ACH)'],
  bnpl:    ['BNPL Purchase', 'Recurring / Subscription'],
  crypto:  ['Card-funded exchange purchase', 'Bank transfer to exchange', 'Wallet-to-wallet transfer', 'NFT marketplace purchase', 'Crypto investment platform deposit'],
}

// ── Known crypto exchanges / platforms for auto-detection ───────────────────
const CRYPTO_MERCHANTS = ['coinbase', 'binance', 'kraken', 'bitbuy', 'newton', 'ndax', 'shakepay', 'gemini', 'crypto.com', 'bybit', 'kucoin', 'bitfinex', 'opensea', 'rarible', 'blur', 'magic eden']
const isCryptoMerchantName = (name) => name && CRYPTO_MERCHANTS.some(k => name.toLowerCase().includes(k))

function TriageView({ onHandoff }) {

  // ── 01 Transaction details ──────────────────────────────────────────────────
  const [accountType, setAccountType]         = useState('')
  const [merchant, setMerchant]               = useState('')
  const [amount, setAmount]                   = useState('')
  const [currency, setCurrency]               = useState('CAD')
  const [transactionDate, setTransactionDate] = useState('')
  const [transactionType, setTransactionType] = useState('')

  // ── 02 Claim & context ──────────────────────────────────────────────────────
  const [flaggedBy, setFlaggedBy]           = useState('')
  const [customerReason, setCustomerReason] = useState('')

  // ── 03 Risk signals — cardholder ────────────────────────────────────────────
  const [priorDisputes, setPriorDisputes]   = useState('')
  const [accountAge, setAccountAge]         = useState('')
  const [cardPossession, setCardPossession] = useState('')

  // ── 03 Risk signals — account integrity (ATO) ───────────────────────────────
  const [accountChanges, setAccountChanges]       = useState('')
  const [deviceRecognized, setDeviceRecognized]   = useState('')

  // ── 03 Risk signals — merchant (card-based only) ────────────────────────────
  const [vfmp, setVfmp]                                   = useState('')
  const [merchantDisputeRate, setMerchantDisputeRate]     = useState('')
  const [mccRisk, setMccRisk]                             = useState('')

  // ── Network (card-based + crypto) ───────────────────────────────────────────
  const [network, setNetwork] = useState('')

  // ── Crypto-specific signals ──────────────────────────────────────────────────
  const [cryptoScenario, setCryptoScenario]       = useState('')
  const [exchangeRegulated, setExchangeRegulated] = useState('')
  const [walletCustody, setWalletCustody]         = useState('')
  const [contactedExchange, setContactedExchange] = useState('')

  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [exportCopied, setExportCopied] = useState(false)
  const [handedOff, setHandedOff]       = useState(false)
  const [triageSearch, setTriageSearch] = useState('')

  // ── Platform mode: 'fi' = Financial Institution, 'ce' = Crypto Exchange ──────
  const [platformMode, setPlatformMode] = useState('fi')

  // ── Crypto Exchange (CE) mode state ─────────────────────────────────────────
  const [ceAccountType, setCeAccountType]               = useState('')
  const [ceAsset, setCeAsset]                           = useState('')
  const [ceChain, setCeChain]                           = useState('')
  const [ceTxType, setCeTxType]                         = useState('')
  const [ceAmount, setCeAmount]                         = useState('')
  const [ceCurrency, setCeCurrency]                     = useState('USD')
  const [ceTxDate, setCeTxDate]                         = useState('')
  const [ceDestinationType, setCeDestinationType]       = useState('')
  const [ceDestinationAddress, setCeDestinationAddress] = useState('')
  const [ceReceivingExchange, setCeReceivingExchange]   = useState('')
  const [ceCompromiseVector, setCeCompromiseVector]     = useState('')
  const [ceRecentAcctChanges, setCeRecentAcctChanges]   = useState('')
  const [ceDeviceNew, setCeDeviceNew]                   = useState('')
  const [cePriorClaims, setCePriorClaims]               = useState('')
  const [ceKycLevel, setCeKycLevel]                     = useState('')
  const [ceBlockchainTrace, setCeBlockchainTrace]       = useState('')
  const [ceCountry, setCeCountry]                       = useState('both')
  const [ceComplaint, setCeComplaint]                   = useState('')
  const [ceFlaggedBy, setCeFlaggedBy]                   = useState('')
  const [ceSarDeadlineDate, setCeSarDeadlineDate]       = useState('')
  const [ceActionPlan, setCeActionPlan]                 = useState(null)
  const [ceActionPlanLoading, setCeActionPlanLoading]   = useState(false)
  const [ceActionPlanError, setCeActionPlanError]       = useState(null)
  const [ceActionPlanCopied, setCeActionPlanCopied]     = useState(false)

  // ── Outcome tracking ────────────────────────────────────────────────────────
  const [outcomes, setOutcomes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('triage_outcomes') || '[]') } catch { return [] }
  })
  useEffect(() => {
    localStorage.setItem('triage_outcomes', JSON.stringify(outcomes))
  }, [outcomes])

  // ── Reset transaction type when account type changes ─────────────────────────
  useEffect(() => {
    if (accountType && transactionType) {
      const validTypes = TX_TYPES[accountType] ?? []
      if (!validTypes.includes(transactionType)) setTransactionType('')
    }
  }, [accountType])

  // ── Computed values ──────────────────────────────────────────────────────────
  const isCardBased     = accountType === 'debit' || accountType === 'credit'
  const isCrypto        = accountType === 'crypto'
  const detectedCrypto  = !isCrypto && isCryptoMerchantName(merchant)
  const showNetworkSel  = isCardBased || isCrypto

  const daysSinceTransaction = transactionDate
    ? Math.floor((Date.now() - new Date(transactionDate).getTime()) / 86400000)
    : null

  const fpfRiskScore = useMemo(() => {
    let s = 40
    if (priorDisputes === '3–5')        s += 15
    if (priorDisputes === '5+')         s += 25
    if (priorDisputes === '1–2')        s +=  5
    if (priorDisputes === 'None')       s -= 20
    if (accountAge === 'Under 6 months') s += 15
    if (accountAge === '6–12 months')    s +=  5
    if (accountAge === '3+ years')       s -= 15
    if (cardPossession === 'Yes — card in hand')      s += 12
    if (cardPossession === 'No — card lost or stolen') s -= 15
    if (flaggedBy === 'System alert (fraud detection)')  s -= 20
    if (flaggedBy?.includes('Customer-reported'))        s +=  5
    if (daysSinceTransaction !== null && daysSinceTransaction > 60) s += 15
    if (daysSinceTransaction !== null && daysSinceTransaction <= 7) s -= 10
    if (accountChanges?.includes('Yes')) s += 8
    if (deviceRecognized?.includes('New')) s -= 10
    if (merchantDisputeRate === 'High (over 2%)') s -= 15
    if (vfmp === 'Yes — VFMP listed')              s -= 15
    if (mccRisk?.includes('High'))                 s -= 10
    return Math.max(0, Math.min(100, Math.round(s)))
  }, [priorDisputes, accountAge, cardPossession, flaggedBy, daysSinceTransaction, accountChanges, deviceRecognized, merchantDisputeRate, vfmp, mccRisk])

  const regFramework =
    accountType === 'debit' || accountType === 'ach_eft' ? 'REG_E' :
    accountType === 'credit'                             ? 'REG_Z' :
    accountType === 'p2p'                                ? 'PROVIDER' :
    accountType === 'bnpl'                               ? 'REG_Z_PROVIDER' :
    accountType === 'crypto'                             ? 'CRYPTO' : null

  const regLabel =
    regFramework === 'REG_E'          ? 'REG E'            :
    regFramework === 'REG_Z'          ? 'REG Z'            :
    regFramework === 'PROVIDER'       ? 'PROVIDER-HANDLED' :
    regFramework === 'REG_Z_PROVIDER' ? 'REG Z / PROVIDER' :
    regFramework === 'CRYPTO'         ? 'CRYPTO / DIGITAL ASSET' : null

  const regSubtext =
    regFramework === 'REG_E'          ? 'Debit / EFT — Electronic Fund Transfer Act applies' :
    regFramework === 'REG_Z'          ? 'Credit — Truth in Lending Act / network chargeback rules apply' :
    regFramework === 'PROVIDER'       ? 'No network chargeback path — contact recipient FI or network' :
    regFramework === 'REG_Z_PROVIDER' ? 'BNPL — dispute through provider, not card network' :
    regFramework === 'CRYPTO'         ? 'No blanket network protection — coverage depends on payment method used and exchange policies' : null

  const regColor =
    regFramework === 'REG_E'    ? { bg: '#1E3A8A', text: '#BFDBFE' } :
    regFramework === 'REG_Z'    ? { bg: '#4C1D95', text: '#DDD6FE' } :
    regFramework === 'CRYPTO'   ? { bg: '#064E3B', text: '#6EE7B7' } :
                                  { bg: '#374151', text: '#D1D5DB' }

  // ── CE computed values ───────────────────────────────────────────────────────
  const isCE           = platformMode === 'ce'
  const ceDaysSince    = ceTxDate ? Math.floor((Date.now() - new Date(ceTxDate).getTime()) / 86400000) : null
  const ceAmountNum    = parseFloat(ceAmount) || 0
  const ceSarFlagUS    = ceAmountNum >= 5000  && (ceCountry === 'us'   || ceCountry === 'both') && ceCurrency === 'USD'
  const ceStrFlagCA    = ceAmountNum >= 10000 && (ceCountry === 'ca'   || ceCountry === 'both') && ceCurrency === 'CAD'
  const ceSarRequired  = ceSarFlagUS || ceStrFlagCA
  const ceSarDeadlineRaw = ceSarDeadlineDate
    ? new Date(new Date(ceSarDeadlineDate).getTime() + 30 * 86400000)
    : null
  const ceSarDeadline  = ceSarDeadlineRaw ? ceSarDeadlineRaw.toLocaleDateString('en-CA') : null
  const ceSarDaysLeft  = ceSarDeadlineRaw ? Math.ceil((ceSarDeadlineRaw - new Date()) / 86400000) : null
  const ceRegLabel     = ceCountry === 'us' ? 'FINCEN / FinCEN MSB' : ceCountry === 'ca' ? 'FINTRAC / PCMLTFA' : 'FinCEN (US) + FINTRAC (CA)'
  const ceRegSubtext   = ceCountry === 'us'
    ? 'FinCEN registration required; SAR if suspicious activity ≥ $5,000 USD'
    : ceCountry === 'ca'
    ? 'FINTRAC STR required for suspicious transactions; $10,000 CAD large cash threshold'
    : 'Dual jurisdiction — FinCEN SAR ($5k USD) and FINTRAC STR ($10k CAD) obligations apply'

  const provisionalCreditApplies = regFramework === 'REG_E' && result &&
    (result.classification === 'TRUE_FRAUD' || result.classification === 'AUTHORIZED_PUSH_PAYMENT')

  const weightStyle = (w) =>
    w === 'HIGH'   ? { bg: '#1A1814', text: '#F5F1EA' } :
    w === 'MEDIUM' ? { bg: '#6B5F4D', text: '#FAF7F1' } :
                     { bg: '#D4CCBC', text: '#1A1814' }

  const classConfig = {
    TRUE_FRAUD: {
      bg: '#064E3B', text: '#D1FAE5', badge: '#065F46', badgeText: '#6EE7B7',
      borderColor: '#065F46', label: 'TRUE FRAUD', Icon: Shield,
    },
    FIRST_PARTY_FRAUD: {
      bg: '#7F1D1D', text: '#FEE2E2', badge: '#991B1B', badgeText: '#FCA5A5',
      borderColor: '#991B1B', label: 'FIRST-PARTY FRAUD', Icon: AlertTriangle,
    },
    CONSUMER_DISPUTE: {
      bg: '#78350F', text: '#FEF3C7', badge: '#92400E', badgeText: '#FCD34D',
      borderColor: '#92400E', label: 'CONSUMER DISPUTE', Icon: MessageSquare,
    },
    AUTHORIZED_PUSH_PAYMENT: {
      bg: '#1E3A5F', text: '#BFDBFE', badge: '#1D4ED8', badgeText: '#93C5FD',
      borderColor: '#1D4ED8', label: 'AUTH. PUSH PAYMENT', Icon: Send,
    },
  }

  const cfg = result ? classConfig[result.classification] : null

  const resolved       = outcomes.filter(o => o.outcome !== 'pending')
  const confirmedCount = outcomes.filter(o => o.outcome === 'confirmed').length
  const accuracy       = resolved.length > 0 ? Math.round((confirmedCount / resolved.length) * 100) : null
  const vcounts = {
    TRUE_FRAUD:              outcomes.filter(o => o.verdict === 'TRUE_FRAUD').length,
    FIRST_PARTY_FRAUD:       outcomes.filter(o => o.verdict === 'FIRST_PARTY_FRAUD').length,
    CONSUMER_DISPUTE:        outcomes.filter(o => o.verdict === 'CONSUMER_DISPUTE').length,
    AUTHORIZED_PUSH_PAYMENT: outcomes.filter(o => o.verdict === 'AUTHORIZED_PUSH_PAYMENT').length,
  }
  const leadingVerdict = Object.entries(vcounts).sort((a, b) => b[1] - a[1])[0]
  const leadingLabel   = leadingVerdict[1] > 0
    ? (classConfig[leadingVerdict[0]]?.label ?? leadingVerdict[0].split('_').join(' '))
    : '—'

  // ── Classify (FI mode) ───────────────────────────────────────────────────────
  const classify = async () => {
    if (!customerReason.trim()) { setError("Customer's stated reason is required."); return }
    setLoading(true); setError(null); setResult(null)

    const accountTypeLabel = { debit: 'Debit Card', credit: 'Credit Card', p2p: 'P2P / e-Transfer', ach_eft: 'ACH / EFT', bnpl: 'BNPL (Buy Now Pay Later)', crypto: 'Crypto / Digital Asset' }[accountType] ?? 'Not specified'
    const daysNote = daysSinceTransaction !== null ? `${daysSinceTransaction} days ago (transaction date: ${transactionDate})` : 'Unknown'

    const prompt = `You are an expert fraud and disputes triage analyst at a financial institution. Classify this incoming dispute claim. You serve credit unions, banks, fintechs, and lenders.

FOUR VERDICT DEFINITIONS:
- TRUE_FRAUD: A third party used the account/card without the cardholder's knowledge or consent. Genuine victim of unauthorized access or card compromise.
- FIRST_PARTY_FRAUD: The cardholder made the transaction themselves and is falsely disputing it. Friendly fraud / chargeback abuse.
- CONSUMER_DISPUTE: Cardholder made the transaction legitimately but has a genuine grievance — non-receipt, item not as described, cancelled subscription, credit not processed, service failure, or misrepresentation.
- AUTHORIZED_PUSH_PAYMENT: Cardholder deliberately authorized and initiated the payment but was deceived into doing so via social engineering (romance scam, fake invoice, buyer-seller fraud, investment scam, impersonation). They believed it was legitimate. Applies primarily to Zelle, Interac e-Transfer, wire transfers, and P2P payments.

ACCOUNT & TRANSACTION:
- Account Type: ${accountTypeLabel}
- Regulatory Framework: ${regFramework ?? 'Unknown'}
- Payment Network: ${network || 'Not specified'}
- ${isCrypto ? 'Destination Wallet / Platform' : 'Merchant / Recipient'}: ${merchant || 'Not provided'}
- Amount: ${amount ? `${amount} ${currency}` : 'Not provided'}
- Transaction occurred: ${daysNote}
- Transaction Type: ${transactionType || 'Not provided'}${(isCrypto || detectedCrypto) ? `
- Crypto / Digital Asset detected: YES
- Crypto Fraud Scenario: ${cryptoScenario || 'Not specified'}
- Exchange Regulated: ${exchangeRegulated || 'Unknown'}
- Wallet Custody: ${walletCustody || 'Unknown'}
- Customer Contacted Exchange First: ${contactedExchange || 'Unknown'}` : ''}

CLAIM:
- How flagged: ${flaggedBy || 'Not provided'}
- Customer's stated reason: ${customerReason}

CARDHOLDER RISK SIGNALS:
- Prior disputes (12 months): ${priorDisputes || 'Unknown'}
- Account age: ${accountAge || 'Unknown'}
${isCardBased ? `- Card in possession when reported: ${cardPossession || 'Unknown'}` : '- Physical card: N/A (non-card payment rail)'}

ACCOUNT INTEGRITY SIGNALS:
- Recent account changes: ${accountChanges || 'Unknown'}
- Device / location at time of transaction: ${deviceRecognized || 'Unknown'}

${isCardBased ? `MERCHANT RISK SIGNALS:
- VFMP listed: ${vfmp || 'Unknown'}
- Merchant dispute rate: ${merchantDisputeRate || 'Unknown'}
- MCC risk tier: ${mccRisk || 'Unknown'}` : `MERCHANT SIGNALS: N/A — non-card payment rail.`}

Return ONLY valid JSON, no markdown:
{
  "classification": "TRUE_FRAUD" | "FIRST_PARTY_FRAUD" | "CONSUMER_DISPUTE" | "AUTHORIZED_PUSH_PAYMENT",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "label": "True Fraud" | "First-Party Fraud" | "Consumer Dispute" | "Authorized Push Payment",
  "headline": "One tight sentence summarizing the triage assessment.",
  "signals": ["Signal 1", "Signal 2", "Signal 3"],
  "signal_influences": [
    { "signal": "Specific signal from inputs", "weight": "HIGH" | "MEDIUM" | "LOW", "toward": "TRUE_FRAUD" | "FIRST_PARTY_FRAUD" | "CONSUMER_DISPUTE" | "AUTHORIZED_PUSH_PAYMENT" }
  ],
  "ato_suspected": true | false,
  "ato_note": "Brief ATO note if suspected, empty string otherwise.",
  "routing": "CARD_CHARGEBACK" | "NACHA_RETURN" | "RECIPIENT_FI" | "PROVIDER_DISPUTE" | "FLAG_INVESTIGATION" | "GOODWILL_FIRST",
  "routing_label": "Human-readable routing label",
  "routing_detail": "1–2 sentences on what the agent should do next.",
  "risk_notes": "Caveats or watch-outs — or empty string if none.",
  "proceed_to_dispute": true | false
}`

    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text)
      setResult(parsed)
      setOutcomes(prev => [{
        id: `T-${Date.now().toString(36).toUpperCase().slice(-5)}`,
        date: new Date().toISOString(),
        merchant: merchant || '—',
        amount: amount ? `${amount} ${currency}` : '—',
        accountType, network: network || '',
        verdict: parsed.classification, confidence: parsed.confidence,
        routing: parsed.routing, outcome: 'pending',
      }, ...prev].slice(0, 100))
    } catch (e) {
      setError(`Classification failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Classify (CE mode) ───────────────────────────────────────────────────────
  const classifyCE = async () => {
    if (!ceComplaint.trim()) { setError("Customer's stated reason is required."); return }
    setLoading(true); setError(null); setResult(null)

    const daysNote = ceDaysSince !== null ? `${ceDaysSince} days ago (${ceTxDate})` : 'Unknown'
    const sarNote  = ceSarRequired
      ? `⚠ SAR/STR THRESHOLD MET — ${ceSarFlagUS ? `FinCEN SAR required ($${ceAmountNum.toLocaleString()} USD ≥ $5,000)` : ''}${ceSarFlagUS && ceStrFlagCA ? ' + ' : ''}${ceStrFlagCA ? `FINTRAC STR required ($${ceAmountNum.toLocaleString()} CAD ≥ $10,000)` : ''}`
      : 'Below SAR/STR threshold'

    const prompt = `You are a senior fraud analyst at a crypto exchange / digital asset platform. Triage this incoming fraud or dispute claim. You operate under FinCEN (US) and/or FINTRAC (Canada) obligations as a Money Services Business.

FOUR VERDICT DEFINITIONS:
- TRUE_FRAUD: Unauthorized third-party access — ATO, SIM-swap, credential phishing, API key theft. Customer did NOT authorize the transaction.
- FIRST_PARTY_FRAUD: Customer authorized transactions themselves but is falsely claiming fraud — typically after a losing trade, price drop, or buyer's remorse.
- CONSUMER_DISPUTE: Customer authorized the transaction but has a legitimate grievance — trade execution error, withdrawal delay, incorrect fee, locked account, asset not credited, platform malfunction.
- AUTHORIZED_PUSH_PAYMENT: Customer was socially engineered into sending crypto voluntarily — pig butchering, romance scam, fake exchange impersonation. Customer believed the transfer was legitimate.

EXCHANGE ACCOUNT:
- Account Type: ${ceAccountType || 'Not specified'}
- KYC Level: ${ceKycLevel || 'Unknown'}
- Prior Claims (12 months): ${cePriorClaims || 'Unknown'}
- Flagged by: ${ceFlaggedBy || 'Not specified'}

TRANSACTION:
- Asset: ${ceAsset || 'Not specified'}
- Blockchain: ${ceChain || 'Not specified'}
- Transaction Type: ${ceTxType || 'Not specified'}
- Amount: ${ceAmount ? `${ceAmount} ${ceCurrency}` : 'Not specified'}
- SAR/STR Status: ${sarNote}
- Transaction occurred: ${daysNote}
- Destination type: ${ceDestinationType || 'Unknown'}
${ceDestinationAddress ? `- Destination: ${ceDestinationAddress}` : ''}
${ceReceivingExchange ? `- Receiving exchange: ${ceReceivingExchange}` : ''}

COMPROMISE SIGNALS:
- Suspected compromise vector: ${ceCompromiseVector || 'Unknown'}
- Recent account changes: ${ceRecentAcctChanges || 'Unknown'}
- Device / location: ${ceDeviceNew || 'Unknown'}
- Blockchain trace: ${ceBlockchainTrace || 'Unknown'}

CUSTOMER STATEMENT:
${ceComplaint}

REGULATORY: ${ceRegLabel}
${ceSarRequired ? '⚠ SAR/STR filing obligation triggered' : 'No automatic threshold triggered'}

Return ONLY valid JSON, no markdown:
{
  "classification": "TRUE_FRAUD" | "FIRST_PARTY_FRAUD" | "CONSUMER_DISPUTE" | "AUTHORIZED_PUSH_PAYMENT",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "label": "True Fraud" | "First-Party Fraud" | "Consumer Dispute" | "Authorized Push Payment",
  "headline": "One tight sentence summarizing the triage assessment.",
  "signals": ["Signal 1", "Signal 2", "Signal 3"],
  "signal_influences": [{ "signal": "...", "weight": "HIGH"|"MEDIUM"|"LOW", "toward": "..." }],
  "ato_suspected": true | false,
  "ato_note": "ATO note or empty string.",
  "sar_note": "${ceSarRequired ? 'SAR/STR filing required.' : ''}",
  "routing": "ACCOUNT_FREEZE" | "EXCHANGE_CONTACT" | "LEA_REFERRAL" | "INTERNAL_REVIEW" | "FLAG_INVESTIGATION",
  "routing_label": "Human-readable routing label",
  "routing_detail": "2–3 sentences on exact next steps.",
  "risk_notes": "Watch-outs or empty string.",
  "proceed_to_dispute": true | false
}`

    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text)
      setResult(parsed)
      setOutcomes(prev => [{
        id: `T-${Date.now().toString(36).toUpperCase().slice(-5)}`,
        date: new Date().toISOString(),
        merchant: ceReceivingExchange || ceDestinationAddress || '—',
        amount: ceAmount ? `${ceAmount} ${ceCurrency}` : '—',
        accountType: 'crypto_exchange', network: ceChain || ceAsset || '',
        verdict: parsed.classification, confidence: parsed.confidence,
        routing: parsed.routing, outcome: 'pending',
      }, ...prev].slice(0, 100))
    } catch (e) {
      setError(`Classification failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── CE action plan ───────────────────────────────────────────────────────────
  const generateCEActionPlan = async () => {
    if (!result) return
    setCeActionPlanLoading(true); setCeActionPlanError(null); setCeActionPlan(null)
    const prompt = `You are a senior fraud operations analyst at a crypto exchange. Based on this triage classification, generate a complete operational action plan.

INCIDENT: ${result.classification} — ${result.label}
Headline: ${result.headline}
Routing: ${result.routing} — ${result.routing_label}
Asset: ${ceAsset || 'Not specified'}${ceChain ? ' on ' + ceChain : ''}
Amount: ${ceAmount ? ceAmount + ' ' + ceCurrency : 'Not specified'}
Destination: ${ceDestinationAddress || 'Not specified'}
Receiving Exchange: ${ceReceivingExchange || 'Unknown'}
Compromise Vector: ${ceCompromiseVector || 'Unknown'}
Jurisdiction: ${ceCountry === 'us' ? 'United States (FinCEN/BSA)' : ceCountry === 'ca' ? 'Canada (FINTRAC/PCMLTFA)' : 'US + Canada'}
SAR Status: ${ceSarRequired ? '⚠ THRESHOLD MET — filing obligation triggered' : 'Below automatic threshold'}
Customer: ${ceComplaint}

Return ONLY valid JSON:
{
  "immediate_actions": ["..."],
  "investigation_steps": ["..."],
  "evidence_required": { "internal": ["..."], "external": ["..."], "blockchain": ["..."] },
  "sar_required": true | false,
  "sar_note": "...",
  "lea_referral_recommended": true | false,
  "lea_note": "...",
  "exchange_contact_required": true | false,
  "exchange_note": "...",
  "recovery_outlook": "HIGH" | "MODERATE" | "LOW" | "VERY_LOW",
  "recovery_note": "...",
  "customer_letter": { "subject": "...", "body": "..." }
}`
    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
      setCeActionPlan(JSON.parse(text))
    } catch (e) {
      setCeActionPlanError(`Action plan failed: ${e.message}`)
    } finally {
      setCeActionPlanLoading(false)
    }
  }

  const reloadCase = (o) => {
    if (o.merchant && o.merchant !== '—') setMerchant(o.merchant)
    if (o.amount && o.amount !== '—') {
      const parts = (o.amount || '').split(' ')
      if (parts[0]) setAmount(parts[0])
      if (parts[1]) setCurrency(parts[1])
    }
    if (o.network) setNetwork(o.network.toLowerCase())
    setResult(null); setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const markOutcome = (id, val) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, outcome: val } : o))

  const exportReport = () => {
    if (!result) return
    const caseId = outcomes[0]?.id ?? '—'
    const lines = [
      `TRIAGE REPORT — ${caseId}`,
      `Generated: ${new Date().toLocaleString()}`,
      '',
      `VERDICT: ${cfg?.label ?? result.classification}`,
      `Confidence: ${result.confidence}`,
      `Headline: ${result.headline}`,
      '',
      `ROUTING: ${result.routing_label}`,
      `Next Steps: ${result.routing_detail}`,
      '',
      'KEY SIGNALS',
      ...(result.signals?.map(s => `  → ${s}`) ?? []),
      result.ato_suspected ? `\nATO SUSPECTED: ${result.ato_note}` : '',
      result.risk_notes ? `\nWATCH FOR: ${result.risk_notes}` : '',
      `\nFPF RISK SCORE: ${fpfRiskScore}/100`,
    ].filter(l => l !== '').join('\n')
    navigator.clipboard.writeText(lines).then(() => {
      setExportCopied(true)
      setTimeout(() => setExportCopied(false), 2000)
    })
  }

  const handleProceedToDisputeDesk = () => {
    if (!result) return
    const caseId = outcomes[0]?.id ?? `T-${Date.now().toString(36).toUpperCase().slice(-5)}`
    if (isCE) {
      onHandoff({
        caseId,
        classification: result.classification,
        confidence: result.confidence,
        headline: result.headline,
        network: ceAsset ? `${ceAsset}${ceChain ? ` (${ceChain})` : ''}` : '',
        amount: ceAmount,
        merchant: ceReceivingExchange || ceDestinationAddress || '',
        transactionDate: ceTxDate,
        complaint: ceComplaint.slice(0, 800),
        notes: '',
      })
    } else {
      onHandoff({
        caseId,
        classification: result.classification,
        confidence: result.confidence,
        headline: result.headline,
        network,
        amount,
        merchant,
        transactionDate,
        complaint: customerReason.slice(0, 800),
        notes: '',
      })
    }
    setHandedOff(true)
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <style>{`
        /* inputs: mono font instead of Fraunces so selects/inputs look sharp */
        .triage-root .input-field {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          padding: 10px 14px;
          background: #FAF7F1;
          border: 1px solid #D4CCBC;
          color: #1A1814;
          width: 100%;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .triage-root .input-field:focus { outline: none; border-color: #1A1814; }
        .triage-root select.input-field { appearance: auto; }
        .triage-root textarea.input-field {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 14px;
          line-height: 1.6;
          padding: 12px 14px;
        }
        .triage-root .input-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #6B5F4D;
          margin-bottom: 6px;
          display: block;
        }
        /* warm up Tailwind cool borders */
        .triage-root .border-stone-200 { border-color: #D4CCBC !important; }
        .triage-root .border-stone-300 { border-color: #C8BFB2 !important; }
        .triage-root .border-stone-100 { border-color: #E4DECE !important; }
        /* dividers */
        .tri-section-rule { border: none; border-top: 1px solid #D4CCBC; margin: 28px 0; }
        .tri-sub-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: #A89B88; margin-bottom: 12px; }
      `}</style>

      {/* ── Masthead ─────────────────────────────────────────────────────────── */}
      <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div className="mono-font text-xs tracking-widest text-stone-600 hidden sm:block">ISSUE Nº 001 — TRIAGE</div>
          <div className="mono-font text-xs tracking-widest text-stone-600 sm:hidden">TRIAGE</div>
          <div className="mono-font text-xs tracking-widest text-stone-600">
            {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
          </div>
        </div>
        <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize: 'clamp(48px, 8vw, 96px)', letterSpacing: '-0.03em' }}>
          <span style={{ fontWeight: 700 }}>Tri</span><span style={{ fontStyle: 'italic', fontWeight: 500 }}>age</span>
        </h1>
        <p className="display-font text-stone-700 mt-3 sm:mt-4 max-w-2xl" style={{ fontSize: 'clamp(15px, 2vw, 17px)', lineHeight: '1.55' }}>
          {isCE
            ? 'Crypto exchange fraud triage. Four verdicts. FinCEN + FINTRAC aware. Built for exchange fraud analysts handling ATO, pig butchering, stablecoin fraud, and consumer disputes on digital asset platforms.'
            : 'Classify incoming dispute claims before anything is filed. Four verdicts. Covers card, ACH, P2P, BNPL, and FI-held crypto — routed by payment rail and regulatory framework: Reg E, Reg Z, NACHA, or provider.'}
        </p>
        {/* Platform mode toggle */}
        <div className="mt-5 flex gap-1 p-1 w-fit" style={{ background: '#E8E3DA' }}>
          {[{ id: 'fi', label: 'Financial Institution' }, { id: 'ce', label: 'Crypto Exchange' }].map(m => (
            <button key={m.id} onClick={() => { setPlatformMode(m.id); setResult(null); setError(null); setHandedOff(false) }}
              className="platform-toggle-btn mono-font text-xs tracking-widest px-4 py-2 transition-all"
              style={{ background: platformMode === m.id ? '#1A1814' : 'transparent', color: platformMode === m.id ? '#F5F1EA' : '#6B5F4D', cursor: 'pointer', border: 'none' }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Two-column layout ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

        {/* ══ LEFT: Inputs ══════════════════════════════════════════════════════ */}
        <div>

        {/* ════════ CRYPTO EXCHANGE MODE ════════ */}
        {isCE && (
          <>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Account &amp; Transaction</h2>
            </div>

            <div className="mb-4">
              <label className="input-label">Jurisdiction</label>
              <select value={ceCountry} onChange={e => setCeCountry(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                <option value="both">Both — US (FinCEN) + Canada (FINTRAC)</option>
                <option value="us">United States — FinCEN / BSA</option>
                <option value="ca">Canada — FINTRAC / PCMLTFA</option>
              </select>
              {ceRegLabel && (
                <div className="flex items-start gap-3 py-2">
                  <span className="mono-font text-xs px-2 py-1 shrink-0" style={{ background: '#064E3B', color: '#6EE7B7' }}>{ceRegLabel}</span>
                  <span className="mono-font text-xs text-stone-400 leading-relaxed">{ceRegSubtext}</span>
                </div>
              )}
            </div>

            <div className="space-y-4 mb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Account Type</label>
                  <select value={ceAccountType} onChange={e => setCeAccountType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select…</option>
                    <option>Standard retail account</option>
                    <option>Business / corporate account</option>
                    <option>API / programmatic access</option>
                    <option>OTC desk account</option>
                    <option>Institutional account</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">KYC Level</label>
                  <select value={ceKycLevel} onChange={e => setCeKycLevel(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option>Tier 1 — email only</option>
                    <option>Tier 2 — ID verified</option>
                    <option>Tier 3 — full KYB / EDD</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Digital Asset</label>
                  <select value={ceAsset} onChange={e => setCeAsset(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select asset…</option>
                    <option>BTC (Bitcoin)</option><option>ETH (Ethereum)</option>
                    <option>USDT (Tether)</option><option>USDC (USD Coin)</option>
                    <option>SOL (Solana)</option><option>XRP (Ripple)</option>
                    <option>BNB (BNB Chain)</option><option>MATIC (Polygon)</option>
                    <option>Other / Unknown</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Blockchain Network</label>
                  <select value={ceChain} onChange={e => setCeChain(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select chain…</option>
                    <option>Bitcoin mainnet</option><option>Ethereum mainnet</option>
                    <option>Solana</option><option>BNB Chain</option>
                    <option>Polygon</option><option>Tron (TRC-20)</option>
                    <option>Avalanche</option><option>Unknown / off-chain</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Transaction Type</label>
                  <select value={ceTxType} onChange={e => setCeTxType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select…</option>
                    <option>External withdrawal</option><option>Internal transfer</option>
                    <option>Spot trade / conversion</option>
                    <option>Fiat deposit → crypto purchase</option>
                    <option>Fiat off-ramp (crypto → fiat)</option>
                    <option>Staking / yield withdrawal</option>
                    <option>API-initiated trade or transfer</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Transaction Date</label>
                  <input type="date" value={ceTxDate} onChange={e => setCeTxDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                  {ceDaysSince !== null && <div className="mono-font text-xs text-stone-400 mt-1.5">{ceDaysSince === 0 ? 'Today' : `${ceDaysSince} day${ceDaysSince !== 1 ? 's' : ''} ago`}</div>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={ceAmount} onChange={e => setCeAmount(e.target.value)} placeholder="0.00" className="input-field" style={{ flex: 2 }} />
                    <select value={ceCurrency} onChange={e => setCeCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      <option>USD</option><option>CAD</option><option>EUR</option><option>GBP</option><option>BTC</option><option>ETH</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-end">
                  {ceSarRequired && (
                    <div className="w-full px-3 py-2.5" style={{ background: '#FEF3C7', border: '1px solid #92400E' }}>
                      <div className="mono-font text-xs tracking-widest" style={{ color: '#92400E' }}>⚠ SAR / STR THRESHOLD</div>
                      <div className="mono-font text-xs mt-0.5" style={{ color: '#78350F' }}>
                        {ceSarFlagUS && 'FinCEN SAR required (≥$5k USD)'}
                        {ceSarFlagUS && ceStrFlagCA && ' · '}
                        {ceStrFlagCA && 'FINTRAC STR required (≥$10k CAD)'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Destination &amp; Recovery</h2>
            </div>
            <div className="space-y-4 mb-5">
              <div>
                <label className="input-label">Destination Type</label>
                <select value={ceDestinationType} onChange={e => setCeDestinationType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Unknown</option>
                  <option>External unhosted wallet (self-custody)</option>
                  <option>Known regulated exchange</option>
                  <option>Unknown / suspicious exchange</option>
                  <option>Internal platform wallet</option>
                  <option>DeFi protocol / smart contract</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Destination Address / Exchange</label>
                  <input type="text" value={ceDestinationAddress} onChange={e => setCeDestinationAddress(e.target.value)} placeholder="0x... or exchange name" className="input-field mono-font" style={{ fontSize: '12px' }} />
                </div>
                <div>
                  <label className="input-label">Receiving Exchange (if known)</label>
                  <input type="text" value={ceReceivingExchange} onChange={e => setCeReceivingExchange(e.target.value)} placeholder="e.g. Binance, OKX, Kraken" className="input-field" style={{ fontSize: '14px' }} />
                </div>
              </div>
              <div>
                <label className="input-label">Blockchain Trace Available</label>
                <select value={ceBlockchainTrace} onChange={e => setCeBlockchainTrace(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Unknown</option>
                  <option>Yes — funds still traceable on-chain</option>
                  <option>Yes — but already moved or mixed</option>
                  <option>No — off-chain or unknown destination</option>
                </select>
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-2">
              <span className="mono-font text-xs text-stone-400">03</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Claim &amp; Signals</h2>
            </div>
            <p className="display-font text-stone-500 text-[14px] mb-5 ml-7 italic" style={{ lineHeight: '1.5' }}>Fill what you know. Unknowns are treated as neutral.</p>

            <div className="space-y-4 mb-5">
              <div>
                <label className="input-label">How Was This Flagged?</label>
                <select value={ceFlaggedBy} onChange={e => setCeFlaggedBy(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Select…</option>
                  <option>Customer-reported (app / support ticket)</option>
                  <option>Customer-reported (email / chat)</option>
                  <option>Customer-reported (phone / live agent)</option>
                  <option>Automated fraud system alert</option>
                  <option>Compliance team flagged (SAR review)</option>
                  <option>Blockchain analytics alert (Chainalysis / Elliptic)</option>
                  <option>Law enforcement inquiry</option>
                </select>
              </div>
              <div>
                <label className="input-label">Suspected Compromise Vector</label>
                <select value={ceCompromiseVector} onChange={e => setCeCompromiseVector(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Unknown / not determined</option>
                  <option value="SIM-swap — mobile number ported or hijacked">SIM-swap</option>
                  <option value="Phishing — fake exchange website or email">Phishing — fake exchange or email</option>
                  <option value="Credential stuffing — reused password from data breach">Credential stuffing / password breach</option>
                  <option value="API key theft — programmatic unauthorized access">API key theft</option>
                  <option value="Social engineering — fake support agent or impersonation">Social engineering / fake support</option>
                  <option value="Investment / pig butchering scam — customer voluntarily sent funds">Investment scam / pig butchering</option>
                  <option value="Malware / device compromise">Malware / device compromise</option>
                  <option value="Insider threat — potential internal actor">Insider threat</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Recent Account Changes</label>
                  <select value={ceRecentAcctChanges} onChange={e => setCeRecentAcctChanges(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="Yes — email, phone, 2FA, or API keys changed recently">Yes — email / phone / 2FA / API changed</option>
                    <option value="No recent account changes detected">No recent changes</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Device / Location</label>
                  <select value={ceDeviceNew} onChange={e => setCeDeviceNew(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="New or unrecognized device / IP flagged">New or unrecognized device / IP</option>
                    <option value="Known device and location">Known device and location</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Prior Claims (12 months)</label>
                  <select value={cePriorClaims} onChange={e => setCePriorClaims(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option>None</option><option>1</option><option>2–3</option><option>4+</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="input-label">Customer's Stated Reason <span style={{ color: '#B45309' }}>*</span></label>
                <textarea value={ceComplaint} onChange={e => setCeComplaint(e.target.value)}
                  placeholder="What is the customer saying happened? Include any details about how they believe the fraud occurred…"
                  rows={5} className="input-field" style={{ resize: 'vertical' }} />
              </div>
            </div>

            <div>
              <label className="input-label">Date Incident Reported <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(optional — enables SAR deadline countdown)</span></label>
              <div className="flex items-center gap-3 flex-wrap">
                <input type="date" value={ceSarDeadlineDate} onChange={e => setCeSarDeadlineDate(e.target.value)}
                  className="input-field mono-font" style={{ fontSize: '13px', maxWidth: '200px' }} />
                {ceSarDeadline && (
                  <div className={`mono-font text-xs px-2 py-1 ${ceSarDaysLeft !== null && ceSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : ceSarDaysLeft !== null && ceSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100'}`}>
                    SAR deadline: {ceSarDeadline} · {ceSarDaysLeft !== null ? `${ceSarDaysLeft}d remaining` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8">
              <button onClick={classifyCE} disabled={loading || !ceComplaint.trim()}
                className="w-full py-4 mono-font text-xs tracking-widest transition-all flex items-center justify-center gap-3"
                style={{ background: loading || !ceComplaint.trim() ? '#D4CCBC' : '#1A1814', color: loading || !ceComplaint.trim() ? '#9A9086' : '#F5F1EA', cursor: loading || !ceComplaint.trim() ? 'not-allowed' : 'pointer', border: 'none' }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /><span>CLASSIFYING CLAIM</span></> : <><Bitcoin className="w-4 h-4" /><span>CLASSIFY EXCHANGE CLAIM</span><ArrowRight className="w-4 h-4" /></>}
              </button>
              {error && <div className="mt-4 border border-red-700 bg-red-50 p-4 flex gap-3 items-start"><AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" /><div className="display-font text-sm text-red-900">{error}</div></div>}
            </div>
          </>
        )}

        {/* ════════ FI MODE ════════ */}
        {!isCE && (
          <>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Transaction Details</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="input-label">Account Type</label>
                <select value={accountType} onChange={e => setAccountType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Select type…</option>
                  <option value="debit">Debit Card</option>
                  <option value="credit">Credit Card</option>
                  <option value="p2p">P2P / e-Transfer</option>
                  <option value="ach_eft">ACH / EFT</option>
                  <option value="bnpl">BNPL (Buy Now Pay Later)</option>
                  <option value="crypto">Crypto / Digital Asset (FI-held)</option>
                </select>
              </div>

              {regLabel && (
                <div className="flex items-start gap-3 py-2">
                  <span className="mono-font text-xs px-2 py-1 shrink-0" style={{ background: regColor.bg, color: regColor.text }}>{regLabel}</span>
                  <span className="mono-font text-xs text-stone-400 leading-relaxed">{regSubtext}</span>
                </div>
              )}

              {showNetworkSel && (
                <div>
                  <label className="input-label">Payment Network</label>
                  <select value={network} onChange={e => setNetwork(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select network…</option>
                    {isCrypto ? (
                      <><option>Bitcoin (BTC)</option><option>Ethereum (ETH)</option><option>Solana (SOL)</option><option>Polygon (MATIC)</option><option>USDT / USDC (Stablecoin)</option><option>Other / Unknown chain</option></>
                    ) : (
                      <><option>Visa</option><option>Mastercard</option><option>American Express</option><option>Interac</option><option>Other</option></>
                    )}
                  </select>
                </div>
              )}

              {detectedCrypto && (
                <div className="flex items-start gap-2 p-3" style={{ background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
                  <Bitcoin className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#065F46' }} />
                  <div>
                    <span className="mono-font text-xs tracking-widest" style={{ color: '#064E3B' }}>CRYPTO MERCHANT DETECTED — </span>
                    <span className="mono-font text-xs" style={{ color: '#065F46' }}>{merchant} is a known exchange. Switch account type to Crypto to unlock all crypto signals.</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">{isCrypto ? 'Destination Wallet / Platform' : 'Merchant / Recipient'}</label>
                  <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)}
                    placeholder={isCrypto ? 'e.g. 0x1a2b… or Uniswap' : 'e.g. TechGadget Co.'} className="input-field"
                    style={isCrypto ? { fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' } : {}} />
                </div>
                <div>
                  <label className="input-label">Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="284.00" className="input-field" style={{ flex: 2 }} />
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      {isCrypto ? <><option>CAD</option><option>USD</option><option>BTC</option><option>ETH</option><option>USDC</option><option>USDT</option></> : <><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option></>}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Transaction Date</label>
                  <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                  {daysSinceTransaction !== null && <div className="mono-font text-xs text-stone-400 mt-1.5">{daysSinceTransaction === 0 ? 'Today' : `${daysSinceTransaction} day${daysSinceTransaction !== 1 ? 's' : ''} ago`}</div>}
                </div>
                <div>
                  <label className="input-label">Transaction Type</label>
                  <select value={transactionType} onChange={e => setTransactionType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select type…</option>
                    {accountType && TX_TYPES[accountType] ? TX_TYPES[accountType].map(t => <option key={t}>{t}</option>) : (
                      <><option>Card-Present (In-person)</option><option>Card-Not-Present (Online)</option><option>Recurring / Subscription</option><option>ATM Withdrawal</option><option>ACH / EFT Transfer</option><option>Wire Transfer</option><option>Zelle</option><option>Interac e-Transfer</option></>
                    )}
                  </select>
                </div>
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Claim &amp; Context</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="input-label">How Was This Flagged?</label>
                <select value={flaggedBy} onChange={e => setFlaggedBy(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Select…</option>
                  <option>Customer-reported (inbound call)</option>
                  <option>Customer-reported (app / self-serve)</option>
                  <option>Customer-reported (email / chat)</option>
                  <option>System alert (fraud detection)</option>
                  <option>Proactive outreach (bank contacted customer first)</option>
                  <option>Chargeback / representment queue</option>
                </select>
              </div>
              <div>
                <label className="input-label">Customer's Stated Reason <span style={{ color: '#B45309' }}>*</span></label>
                <textarea value={customerReason} onChange={e => setCustomerReason(e.target.value)}
                  placeholder="What is the customer saying happened? Paste or summarize their complaint…"
                  rows={5} className="input-field" style={{ resize: 'vertical' }} />
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-2">
              <span className="mono-font text-xs text-stone-400">03</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Risk Signals</h2>
            </div>
            <p className="display-font text-stone-500 text-[14px] mb-5 ml-7 italic" style={{ lineHeight: '1.5' }}>Fill what you know. Unknowns are treated as neutral.</p>

            <div className="mb-5">
              <div className="tri-sub-label">Cardholder</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Prior Disputes (12 months)</label>
                  <select value={priorDisputes} onChange={e => setPriorDisputes(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option><option>None</option><option>1–2</option><option>3–5</option><option>5+</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Account Age</label>
                  <select value={accountAge} onChange={e => setAccountAge(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option><option>Under 6 months</option><option>6–12 months</option><option>1–3 years</option><option>3+ years</option>
                  </select>
                </div>
                {isCardBased && (
                  <div className="sm:col-span-2">
                    <label className="input-label">Card in Possession When Reported</label>
                    <select value={cardPossession} onChange={e => setCardPossession(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option><option>Yes — card in hand</option><option>No — card lost or stolen</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="mb-5">
              <div className="tri-sub-label">Account Integrity</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Recent Account Changes</label>
                  <select value={accountChanges} onChange={e => setAccountChanges(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="Yes — login, password or contact details changed recently">Yes — login or contact details changed</option>
                    <option value="No — no recent changes detected">No changes detected</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Device / Location</label>
                  <select value={deviceRecognized} onChange={e => setDeviceRecognized(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="New or unrecognized device / location flagged">New or unrecognized device</option>
                    <option value="Known device and location">Known device and location</option>
                  </select>
                </div>
              </div>
            </div>

            {isCardBased && (
              <div>
                <div className="tri-sub-label">Merchant</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="input-label">VFMP Listed</label>
                    <select value={vfmp} onChange={e => setVfmp(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Yes — VFMP listed">Yes</option>
                      <option value="No — not VFMP listed">No</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Merchant Dispute Rate</label>
                    <select value={merchantDisputeRate} onChange={e => setMerchantDisputeRate(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Low (under 1%)">Low (&lt;1%)</option>
                      <option value="Medium (1–2%)">Medium</option>
                      <option value="High (over 2%)">High (&gt;2%)</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">MCC Risk Tier</label>
                    <select value={mccRisk} onChange={e => setMccRisk(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Low risk MCC">Low</option>
                      <option value="Medium risk MCC">Medium</option>
                      <option value="High risk MCC (travel, digital goods, gambling)">High</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {(isCrypto || detectedCrypto) && (
              <div className="mt-5">
                <div className="tri-sub-label flex items-center gap-2">
                  <Bitcoin className="w-3 h-3" style={{ color: '#065F46' }} />
                  <span>Crypto / Digital Asset Signals</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="input-label">Crypto Fraud Scenario</label>
                    <select value={cryptoScenario} onChange={e => setCryptoScenario(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Select scenario…</option>
                      <option value="Card used to buy crypto (authorized scam)">Card used to buy crypto (authorized scam)</option>
                      <option value="Pig butchering / investment scam">Pig butchering / investment scam</option>
                      <option value="Wallet / exchange hack (unauthorized access)">Wallet / exchange hack (unauthorized access)</option>
                      <option value="NFT / digital asset fraud">NFT / digital asset fraud</option>
                      <option value="Stablecoin transfer fraud (USDC/USDT used as wire substitute)">Stablecoin fraud (USDC / USDT wire substitute)</option>
                      <option value="FI-held crypto — unauthorized withdrawal from integrated wallet">FI-held crypto — unauthorized withdrawal</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Exchange Regulated?</label>
                    <select value={exchangeRegulated} onChange={e => setExchangeRegulated(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Yes — registered / licensed exchange">Yes — licensed exchange</option>
                      <option value="No — unregulated or offshore">No — unregulated / offshore</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Wallet Custody</label>
                    <select value={walletCustody} onChange={e => setWalletCustody(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Custodial (exchange holds keys)">Custodial (exchange holds keys)</option>
                      <option value="Self-custody (customer holds keys)">Self-custody (customer holds keys)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="input-label">Customer Contacted Exchange?</label>
                    <select value={contactedExchange} onChange={e => setContactedExchange(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Yes — exchange contacted, case open">Yes — case open with exchange</option>
                      <option value="Yes — exchange declined to help">Yes — exchange declined</option>
                      <option value="No — customer came to FI first">No — came to FI first</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8">
              <button onClick={classify} disabled={loading || !customerReason.trim()}
                className="w-full py-4 mono-font text-xs tracking-widest transition-all flex items-center justify-center gap-3"
                style={{ background: loading || !customerReason.trim() ? '#D4CCBC' : '#1A1814', color: loading || !customerReason.trim() ? '#9A9086' : '#F5F1EA', cursor: loading || !customerReason.trim() ? 'not-allowed' : 'pointer', border: 'none' }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /><span>CLASSIFYING CLAIM</span></> : <><span>CLASSIFY CLAIM</span><ArrowRight className="w-4 h-4" /></>}
              </button>
              {error && <div className="mt-4 border border-red-700 bg-red-50 p-4 flex gap-3 items-start"><AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" /><div className="display-font text-sm text-red-900">{error}</div></div>}
            </div>
          </>
        )}
        </div>

        {/* ══ RIGHT: Output ══════════════════════════════════════════════════════ */}
        <div>
          <div className="flex items-baseline gap-3 mb-5">
            <span className="mono-font text-xs text-stone-400">04</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Classification</h2>
          </div>

          {!result && !loading && (
            <div className="border border-dashed border-stone-300 p-12 text-center" style={{ background: '#FAF7F1' }}>
              <Shield className="w-8 h-8 text-stone-300 mx-auto mb-3" />
              <p className="display-font text-stone-400 italic text-[15px]">Triage result will appear here after classification.</p>
            </div>
          )}

          {loading && (
            <div className="border border-stone-200 p-12 text-center" style={{ background: '#FAF7F1' }}>
              <Loader2 className="w-8 h-8 text-stone-600 mx-auto mb-3 animate-spin" />
              <p className="display-font text-stone-600 italic">Weighing signals and classifying claim…</p>
            </div>
          )}

          {result && cfg && (
            <div className="space-y-4">

              {!isCE && regLabel && (
                <div className="flex items-center gap-2">
                  <span className="mono-font text-xs px-2 py-0.5" style={{ background: regColor.bg, color: regColor.text }}>{regLabel}</span>
                  <span className="mono-font text-xs text-stone-400 uppercase tracking-wider">framework</span>
                </div>
              )}

              {isCE && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="mono-font text-xs px-2 py-0.5" style={{ background: '#064E3B', color: '#6EE7B7' }}>{ceRegLabel}</span>
                    <span className="mono-font text-xs text-stone-400 uppercase tracking-wider">jurisdiction</span>
                  </div>
                  {ceSarRequired && (
                    <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#FEF3C7', border: '1px solid #D97706' }}>
                      <span className="mono-font text-xs tracking-widest" style={{ color: '#92400E' }}>⚠ SAR/STR FILING REQUIRED — document this case before closing</span>
                    </div>
                  )}
                </div>
              )}

              {/* Verdict card */}
              <div className="p-6" style={{ background: cfg.bg }}>
                <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                  <div className="mono-font text-xs tracking-widest" style={{ color: cfg.badgeText, opacity: 0.8 }}>TRIAGE VERDICT</div>
                  <div className="mono-font text-xs px-2 py-1" style={{ background: cfg.badge, color: cfg.badgeText }}>{result.confidence} CONFIDENCE</div>
                </div>
                <div className="display-font font-bold mb-3" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', color: cfg.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{cfg.label}</div>
                <p className="display-font italic" style={{ color: cfg.text, fontSize: '15px', lineHeight: '1.55', opacity: 0.85 }}>{result.headline}</p>
              </div>

              {result.ato_suspected && (
                <div className="border border-red-800 p-5" style={{ background: '#FFF1F2' }}>
                  <div className="flex items-center gap-2 mono-font text-xs tracking-widest text-red-900 mb-2">
                    <Lock className="w-3.5 h-3.5 shrink-0" /><span>ACCOUNT TAKEOVER SUSPECTED</span>
                  </div>
                  <p className="display-font text-stone-900 text-[14px] leading-relaxed mb-3">{result.ato_note}</p>
                  <div className="mono-font text-xs text-red-800 tracking-wide">→ Escalate to security team in parallel. Block card and flag account for identity verification before or alongside dispute filing.</div>
                </div>
              )}

              {provisionalCreditApplies && (
                <div className="border p-4" style={{ borderColor: '#1D4ED8', background: '#EFF6FF' }}>
                  <div className="mono-font text-xs tracking-widest mb-2" style={{ color: '#1E3A8A' }}>REG E — PROVISIONAL CREDIT</div>
                  <p className="display-font text-stone-900 text-[14px] leading-relaxed">
                    This Reg E dispute must be resolved within <strong>10 business days</strong> — or provisional credit must be issued. Investigation may extend to <strong>45 business days</strong> (90 days for POS, international, or new accounts) with provisional credit posted.
                  </p>
                </div>
              )}

              <div className="border border-stone-200 p-5" style={{ background: '#FAF7F1' }}>
                <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">KEY SIGNALS</div>
                <div className="space-y-2.5">
                  {result.signals?.map((signal, i) => (
                    <div key={i} className="display-font text-stone-800 text-[15px] flex gap-2 items-start leading-snug">
                      <span className="text-stone-400 shrink-0 mt-0.5">→</span><span>{signal}</span>
                    </div>
                  ))}
                </div>
              </div>

              {result.signal_influences?.length > 0 && (
                <div className="border border-stone-200 p-5" style={{ background: '#FAF7F1' }}>
                  <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">WHAT DROVE THIS VERDICT</div>
                  <div className="space-y-2.5">
                    {result.signal_influences.map((inf, i) => {
                      const ws = weightStyle(inf.weight)
                      const towardCfg = classConfig[inf.toward]
                      return (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <span className="mono-font text-xs px-1.5 py-0.5 shrink-0" style={{ background: ws.bg, color: ws.text }}>{inf.weight}</span>
                          <span className="display-font text-stone-700 text-[13px] flex-1 min-w-0">{inf.signal}</span>
                          {towardCfg && <span className="mono-font shrink-0 px-1.5 py-0.5" style={{ fontSize: '9px', letterSpacing: '0.08em', background: towardCfg.bg, color: towardCfg.badgeText }}>→ {towardCfg.label}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="p-5" style={{ borderLeft: `4px solid ${cfg.borderColor}`, background: '#FAF7F1' }}>
                <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">ROUTING RECOMMENDATION</div>
                <div className="display-font font-semibold text-stone-900 mb-2" style={{ fontSize: '17px', letterSpacing: '-0.01em' }}>{result.routing_label}</div>
                <p className="display-font text-stone-700 text-[15px] leading-relaxed">{result.routing_detail}</p>
              </div>

              {result.risk_notes && (
                <div className="border border-amber-200 bg-amber-50 p-4">
                  <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">⚠ WATCH FOR</div>
                  <p className="display-font text-stone-800 text-[15px] leading-relaxed">{result.risk_notes}</p>
                </div>
              )}

              {(() => {
                const fpfColor = fpfRiskScore >= 70 ? '#991B1B' : fpfRiskScore >= 45 ? '#92400E' : '#065F46'
                const fpfBg    = fpfRiskScore >= 70 ? '#FEE2E2' : fpfRiskScore >= 45 ? '#FEF3C7' : '#ECFDF5'
                const fpfLabel = fpfRiskScore >= 70 ? 'HIGH — Investigate further' : fpfRiskScore >= 45 ? 'MODERATE — Review carefully' : 'LOW — Claim appears genuine'
                return (
                  <div className="border p-4" style={{ background: fpfBg, borderColor: fpfColor + '40' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="mono-font text-xs tracking-widest" style={{ color: fpfColor }}>FIRST-PARTY FRAUD RISK</span>
                      <span className="mono-font text-sm font-bold" style={{ color: fpfColor }}>{fpfRiskScore}/100</span>
                    </div>
                    <div className="w-full h-2 rounded-full mb-2" style={{ background: '#E7E5E4' }}>
                      <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${fpfRiskScore}%`, background: fpfColor }} />
                    </div>
                    <div className="mono-font text-xs" style={{ color: fpfColor }}>{fpfLabel}</div>
                  </div>
                )
              })()}

              <button onClick={exportReport}
                className="w-full flex items-center justify-center gap-2 py-3 border transition-colors"
                style={{ borderColor: '#D4CCBC', background: '#FAF7F1', cursor: 'pointer' }}>
                {exportCopied
                  ? <><Check className="w-4 h-4 text-emerald-600" /><span className="mono-font text-xs tracking-widest text-emerald-600">COPIED TO CLIPBOARD</span></>
                  : <><Copy className="w-4 h-4 text-stone-500" /><span className="mono-font text-xs tracking-widest text-stone-600">EXPORT TRIAGE REPORT</span></>}
              </button>

              {isCE && ceSarRequired && ceSarDeadline && (
                <div className={`flex items-center gap-3 px-3 py-2.5 mono-font text-xs ${ceSarDaysLeft !== null && ceSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : ceSarDaysLeft !== null && ceSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100'}`}>
                  <span>⚠ SAR/STR DEADLINE:</span>
                  <span className="font-bold">{ceSarDeadline}</span>
                  {ceSarDaysLeft !== null && <span>{ceSarDaysLeft > 0 ? `${ceSarDaysLeft} DAYS REMAINING` : ceSarDaysLeft === 0 ? 'DUE TODAY' : `${Math.abs(ceSarDaysLeft)} DAYS OVERDUE`}</span>}
                </div>
              )}

              {isCE && !ceActionPlan && !ceActionPlanLoading && (
                <button onClick={generateCEActionPlan}
                  className="w-full flex items-center justify-center gap-2 py-4 mono-font text-xs tracking-widest transition-all"
                  style={{ background: '#1A1814', color: '#F5F1EA', border: 'none', cursor: 'pointer' }}>
                  <Shield className="w-4 h-4" /><span>GENERATE FULL ACTION PLAN</span><ArrowRight className="w-4 h-4" />
                </button>
              )}
              {isCE && ceActionPlanLoading && (
                <div className="border border-stone-300 p-8 text-center" style={{ background: '#FAF7F1' }}>
                  <Loader2 className="w-6 h-6 text-stone-600 mx-auto mb-2 animate-spin" />
                  <p className="display-font text-stone-600 italic text-sm">Building operational action plan…</p>
                </div>
              )}
              {isCE && ceActionPlanError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{ceActionPlanError}</div>
                </div>
              )}

              {isCE && ceActionPlan && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="mono-font text-xs tracking-widest text-stone-500">FULL ACTION PLAN</div>
                    <button onClick={() => {
                      const t = [`CE ACTION PLAN — ${result.classification?.replace(/_/g,' ')}`, `Recovery: ${ceActionPlan.recovery_outlook}`, '', 'IMMEDIATE ACTIONS:', ...(ceActionPlan.immediate_actions||[]).map((a,i) => `${i+1}. ${a}`), '', 'INVESTIGATION:', ...(ceActionPlan.investigation_steps||[]).map((a,i) => `${i+1}. ${a}`), ceActionPlan.sar_required ? '\nSAR: ' + ceActionPlan.sar_note : '', ceActionPlan.lea_referral_recommended ? '\nLEA: ' + ceActionPlan.lea_note : '', '', 'RECOVERY: ' + ceActionPlan.recovery_note].filter(Boolean).join('\n')
                      navigator.clipboard.writeText(t)
                      setCeActionPlanCopied(true); setTimeout(() => setCeActionPlanCopied(false), 2000)
                    }} className="mono-font text-xs flex items-center gap-1.5 text-stone-600 hover:text-stone-900 transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                      {ceActionPlanCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY ALL</>}
                    </button>
                  </div>

                  <div className="border-l-4 border-red-700 bg-red-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-red-900 mb-3">IMMEDIATE ACTIONS — DO NOW</div>
                    <div className="space-y-2">
                      {ceActionPlan.immediate_actions?.map((a, i) => (
                        <div key={i} className="display-font text-stone-900 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="mono-font text-[11px] text-red-700 shrink-0 mt-0.5 font-bold">{i+1}.</span><span>{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-stone-300 p-5" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">INVESTIGATION STEPS — 24–48 HOURS</div>
                    <div className="space-y-2">
                      {ceActionPlan.investigation_steps?.map((s, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="mono-font text-[11px] text-stone-500 shrink-0 mt-0.5">{i+1}.</span><span>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">EVIDENCE PACKAGE</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[{ key: 'internal', label: 'INTERNAL' }, { key: 'external', label: 'EXTERNAL' }, { key: 'blockchain', label: 'BLOCKCHAIN' }].map(({ key, label }) => (
                        <div key={key} className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">{label}</div>
                          <div className="space-y-2">
                            {(ceActionPlan.evidence_required?.[key] || []).map((item, i) => (
                              <div key={i} className="display-font text-stone-800 text-[13px] flex gap-2 items-start leading-snug">
                                <span className="shrink-0 mt-0.5 text-stone-400">→</span><span>{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {ceActionPlan.sar_required && (
                    <div className="border-l-4 border-amber-700 bg-amber-50 p-5">
                      <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">⚠ SAR / STR FILING REQUIRED</div>
                      <p className="display-font text-stone-900 text-[14px] leading-relaxed">{ceActionPlan.sar_note}</p>
                    </div>
                  )}

                  {ceActionPlan.lea_referral_recommended && (
                    <div className="border border-stone-900 p-5" style={{ background: '#1A1814' }}>
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-2">LAW ENFORCEMENT REFERRAL</div>
                      <p className="display-font text-stone-100 text-[14px] leading-relaxed">{ceActionPlan.lea_note}</p>
                    </div>
                  )}

                  {ceActionPlan.exchange_contact_required && (
                    <div className="border border-stone-400 p-5" style={{ background: '#FAF7F1' }}>
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">RECEIVING EXCHANGE — CONTACT NOW</div>
                      <p className="display-font text-stone-800 text-[14px] leading-relaxed">{ceActionPlan.exchange_note}</p>
                    </div>
                  )}

                  {(() => {
                    const ol = ceActionPlan.recovery_outlook
                    const olStyle = ol === 'HIGH' ? { bg: '#064e3b', text: '#6EE7B7' } : ol === 'MODERATE' ? { bg: '#78350f', text: '#FDE68A' } : ol === 'LOW' ? { bg: '#7f1d1d', text: '#FCA5A5' } : { bg: '#1c1917', text: '#A8A29E' }
                    return (
                      <div className="p-5 border border-stone-200" style={{ background: '#FAF7F1' }}>
                        <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">RECOVERY OUTLOOK</div>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="mono-font text-xs px-2 py-1" style={{ background: olStyle.bg, color: olStyle.text }}>{ol}</span>
                          <span className="mono-font text-xs text-stone-400">{ol === 'HIGH' ? '60–80%' : ol === 'MODERATE' ? '35–60%' : ol === 'LOW' ? '15–35%' : '<15%'}</span>
                        </div>
                        <p className="display-font text-stone-700 text-[14px] leading-relaxed">{ceActionPlan.recovery_note}</p>
                      </div>
                    )
                  })()}

                  {ceActionPlan.customer_letter && (
                    <div className="border border-stone-900">
                      <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="mono-font text-xs tracking-widest text-stone-400 mb-0.5">CUSTOMER LETTER</div>
                          <div className="display-font text-stone-100 font-semibold text-[15px]">{ceActionPlan.customer_letter.subject}</div>
                        </div>
                        <button onClick={() => {
                          navigator.clipboard.writeText(`Subject: ${ceActionPlan.customer_letter.subject}\n\nDear Customer,\n\n${ceActionPlan.customer_letter.body}\n\nSincerely,\nCompliance & Fraud Operations Team`)
                          setCeActionPlanCopied(true); setTimeout(() => setCeActionPlanCopied(false), 2000)
                        }} className="mono-font text-xs flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                          {ceActionPlanCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                        </button>
                      </div>
                      <div className="bg-white p-5 space-y-3">
                        <p className="display-font text-stone-500 text-sm italic">Dear Customer,</p>
                        {ceActionPlan.customer_letter.body?.split('\n\n').map((para, i) => (
                          <p key={i} className="display-font text-stone-900 text-[15px] leading-relaxed">{para}</p>
                        ))}
                        <p className="display-font text-stone-500 text-sm italic pt-2">Sincerely,<br />Compliance &amp; Fraud Operations Team</p>
                      </div>
                    </div>
                  )}

                  <button onClick={() => setCeActionPlan(null)} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    ↺ REGENERATE ACTION PLAN
                  </button>
                </div>
              )}

              {/* ── Send to Dispute Desk ── */}
              {handedOff ? (
                <div className="flex items-center gap-3 px-5 py-4 border border-emerald-700" style={{ background: '#ECFDF5' }}>
                  <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div>
                    <div className="mono-font text-[9px] tracking-widest text-emerald-800 mb-0.5">HANDED OFF TO DISPUTE DESK</div>
                    <div className="display-font text-emerald-900 text-sm">Case {outcomes[0]?.id} is pre-filled in the Dispute Desk — switch to the Desk tab to continue.</div>
                  </div>
                </div>
              ) : (
                <div className="border" style={{ borderColor: result.proceed_to_dispute ? '#065F46' : '#D4CCBC' }}>
                  <button onClick={handleProceedToDisputeDesk}
                    className="w-full flex items-center justify-between p-5 transition-colors"
                    style={{ background: result.proceed_to_dispute ? '#1A1814' : '#FAF7F1', cursor: 'pointer', border: 'none' }}>
                    <div className="text-left">
                      <div className="mono-font text-xs tracking-widest mb-1" style={{ color: result.proceed_to_dispute ? '#6B5F4D' : '#A89B88' }}>
                        {result.proceed_to_dispute ? 'RECOMMENDED NEXT STEP' : 'OPTIONAL — SEND TO DESK'}
                      </div>
                      <div className="display-font font-semibold text-lg" style={{ color: result.proceed_to_dispute ? '#F5F1EA' : '#1A1814', letterSpacing: '-0.01em' }}>
                        {isCE ? 'Log in Dispute Desk →' : 'Open in Dispute Desk →'}
                      </div>
                      <div className="mono-font text-xs mt-1" style={{ color: result.proceed_to_dispute ? '#6B5F4D' : '#A89B88' }}>
                        Merchant, amount, date &amp; complaint pre-filled
                      </div>
                    </div>
                    <ExternalLink className="w-5 h-5 shrink-0" style={{ color: result.proceed_to_dispute ? '#6B5F4D' : '#D4CCBC' }} />
                  </button>
                  {!result.proceed_to_dispute && (
                    <div className="px-5 pb-3 mono-font text-xs" style={{ color: '#A89B88' }}>
                      Note: AI did not recommend filing — review signals before proceeding
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 05: Outcome Log ──────────────────────────────────────────── */}
      {outcomes.length > 0 && (
        <div className="mt-12 sm:mt-16">
          <hr className="tri-section-rule" style={{ margin: '0 0 28px 0' }} />
          <div className="flex items-baseline gap-3 mb-6 flex-wrap">
            <span className="mono-font text-xs text-stone-400">05</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Outcome Log</h2>
            <span className="mono-font text-xs text-stone-400 ml-auto">{outcomes.length} CASE{outcomes.length !== 1 ? 'S' : ''} CLASSIFIED</span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'TOTAL',           value: outcomes.length,                           sub: 'classified' },
              { label: 'ACCURACY',        value: accuracy !== null ? `${accuracy}%` : '—',  sub: `${resolved.length} resolved` },
              { label: 'LEADING VERDICT', value: leadingLabel,                              sub: leadingVerdict[1] > 0 ? `${leadingVerdict[1]} case${leadingVerdict[1] !== 1 ? 's' : ''}` : '' },
            ].map(s => (
              <div key={s.label} className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                <div className="mono-font text-xs tracking-widest text-stone-400 mb-1">{s.label}</div>
                <div className="display-font font-semibold text-stone-900" style={{ fontSize: '22px', letterSpacing: '-0.02em' }}>{s.value}</div>
                <div className="mono-font text-xs text-stone-400 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              placeholder="Search by case ID, merchant, or verdict..."
              value={triageSearch}
              onChange={e => setTriageSearch(e.target.value)}
              className="input-field"
              style={{ fontSize: '12px', padding: '6px 10px', flex: 1, maxWidth: '360px' }}
            />
            {triageSearch && (
              <button onClick={() => setTriageSearch('')} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors tracking-widest">✕ CLEAR</button>
            )}
          </div>

          <div className="border border-stone-200 overflow-hidden" style={{ background: '#FAF7F1' }}>
            <div className="overflow-x-auto">
              <div style={{ minWidth: '600px' }}>
                <div className="grid px-4 py-2 border-b border-stone-200" style={{ gridTemplateColumns: '80px 70px 1fr 90px 1fr' }}>
                  {['CASE', 'DATE', 'MERCHANT', 'AMOUNT', 'VERDICT / OUTCOME'].map(h => (
                    <span key={h} className="mono-font text-xs tracking-widest text-stone-400">{h}</span>
                  ))}
                </div>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {outcomes.filter(o => {
                    if (!triageSearch.trim()) return true
                    const q = triageSearch.toLowerCase()
                    return (o.id||'').toLowerCase().includes(q) ||
                      (o.merchant||'').toLowerCase().includes(q) ||
                      (o.verdict||'').toLowerCase().includes(q) ||
                      (o.amount||'').toLowerCase().includes(q)
                  }).map(o => {
                    const vc = classConfig[o.verdict]
                    if (!vc) return null
                    return (
                      <div key={o.id} className="grid px-4 py-3 border-b border-stone-100 items-center" style={{ gridTemplateColumns: '80px 70px 1fr 90px 1fr' }}>
                        <span className="mono-font text-xs text-stone-400">{o.id}</span>
                        <span className="mono-font text-xs text-stone-500">{new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span className="display-font text-sm text-stone-700 truncate pr-3">{o.merchant}</span>
                        <span className="mono-font text-xs text-stone-600">{o.amount}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="mono-font px-1.5 py-0.5 shrink-0" style={{ fontSize: '8px', letterSpacing: '0.08em', background: vc.bg, color: vc.badgeText }}>{vc.label}</span>
                          {o.outcome === 'pending' ? (
                            <div className="flex gap-1 flex-wrap">
                              <button onClick={() => markOutcome(o.id, 'confirmed')} className="mono-font text-xs px-2 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors" title="Verdict was correct" style={{ background: 'none', cursor: 'pointer' }}>✓</button>
                              <button onClick={() => markOutcome(o.id, 'overridden')} className="mono-font text-xs px-2 py-0.5 border border-red-700 text-red-700 hover:bg-red-50 transition-colors" title="Verdict was overridden" style={{ background: 'none', cursor: 'pointer' }}>✗</button>
                              <button onClick={() => reloadCase(o)} className="mono-font text-xs px-2 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 transition-colors" title="Pre-fill form with this case" style={{ background: 'none', cursor: 'pointer' }}>↺</button>
                            </div>
                          ) : (
                            <div className="flex gap-1 items-center flex-wrap">
                              <span className={`mono-font text-xs ${o.outcome === 'confirmed' ? 'text-emerald-700' : 'text-red-700'}`}>
                                {o.outcome === 'confirmed' ? '✓ CONFIRMED' : '✗ OVERRIDDEN'}
                              </span>
                              <button onClick={() => reloadCase(o)} className="mono-font text-xs px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:bg-stone-50 transition-colors" title="Pre-fill form with this case" style={{ background: 'none', cursor: 'pointer' }}>↺</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button onClick={() => { if (window.confirm('Clear all outcome history?')) setOutcomes([]) }}
              className="mono-font text-xs tracking-widest text-stone-400 hover:text-stone-600 transition-colors"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
              CLEAR LOG
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div className="mt-12 sm:mt-16 pt-6 flex flex-col sm:flex-row sm:items-baseline justify-between text-stone-500 gap-2" style={{ borderTop: '1px solid #D4CCBC' }}>
        <div className="mono-font text-xs tracking-widest">BUILT BY ADEOTI FASHOKUN — RISK &amp; TRUST OPERATIONS</div>
        <div className="display-font italic text-sm">"Classify before you file. The routing matters."</div>
      </div>
    </div>
  )
}



// ═══════════════════════════════════════════════════════════════════════════════
// 002 DISPUTE DESK — full view
// ═══════════════════════════════════════════════════════════════════════════════
function DeskView({ triageHandoff, setTriageHandoff, onScoreInDfa, platformMode, setPlatformMode }) {
  const [network, setNetwork]                               = useState('visa')
  const [complaint, setComplaint]                           = useState('')
  const [merchant, setMerchant]                             = useState('')
  const [amount, setAmount]                                 = useState('')
  const [transactionDate, setTransactionDate]               = useState('')
  const [expectedDeliveryDate, setExpectedDeliveryDate]     = useState('')
  const [currency, setCurrency]                             = useState('CAD')
  const [loading, setLoading]                               = useState(false)
  const [result, setResult]                                 = useState(null)
  const [error, setError]                                   = useState(null)
  const [copied, setCopied]                                 = useState(false)
  const [checked, setChecked]                               = useState({})
  const [rebuttal, setRebuttal]                             = useState(null)
  const [rebuttalLoading, setRebuttalLoading]               = useState(false)
  const [rebuttalError, setRebuttalError]                   = useState(null)
  const [comms, setComms]                                   = useState(null)
  const [commsLoading, setCommsLoading]                     = useState(false)
  const [commsError, setCommsError]                         = useState(null)
  const [commsCopied, setCommsCopied]                       = useState(false)
  const [docRequestCopied, setDocRequestCopied]             = useState(false)
  const [goodwillCopied, setGoodwillCopied]                 = useState(false)
  const [disputedAmount, setDisputedAmount]                 = useState('')     // partial dispute amount (optional)
  const [cardType, setCardType]                             = useState('credit') // 'credit' | 'debit'
  const [sarDiscoveryDate, setSarDiscoveryDate]             = useState('')     // FI: date fraud was detected (for SAR deadline)
  const [editingRow, setEditingRow]                         = useState(null)   // id of row being edited
  const [case360Id, setCase360Id]                           = useState(null)   // id of case with 360 panel open
  const [editDraft, setEditDraft]                           = useState({})     // draft field values

  // ── 3DS / authentication ──────────────────────────────────────────────────
  const [threeDSStatus, setThreeDSStatus]                   = useState('unknown') // 'not_attempted' | 'attempted_failed' | 'attempted_passed' | 'unknown'

  // ── Pre-arb response drafter ──────────────────────────────────────────────
  const [preArbDraft, setPreArbDraft]                       = useState(null)
  const [preArbLoading, setPreArbLoading]                   = useState(false)
  const [preArbError, setPreArbError]                       = useState(null)
  const [preArbCopied, setPreArbCopied]                     = useState(false)
  const [preArbTargetId, setPreArbTargetId]                 = useState(null) // tracker row ID
  const [merchantRepNotes, setMerchantRepNotes]             = useState({}) // {[outcomeId]: string}

  // ── Platform mode ─────────────────────────────────────────────────────────
  // platformMode + setPlatformMode come as props from Covalence

  // ── Merchant intake state ─────────────────────────────────────────────────
  const [mchReasonCode, setMchReasonCode]                   = useState('')
  const [mchOrderDate, setMchOrderDate]                     = useState('')
  const [mchOrderId, setMchOrderId]                         = useState('')
  const [mchCustomerEmail, setMchCustomerEmail]             = useState('')
  const [mchDeliveryConfirmed, setMchDeliveryConfirmed]     = useState('unknown')
  const [mchThreeDS, setMchThreeDS]                         = useState('unknown')
  const [mchRefundPolicyShown, setMchRefundPolicyShown]     = useState('unknown')
  const [mchPriorOrders, setMchPriorOrders]                 = useState('')
  const [mchIpLogs, setMchIpLogs]                           = useState('')
  const [mchCbDisputes, setMchCbDisputes]                   = useState('')
  const [mchCbTransactions, setMchCbTransactions]           = useState('')
  const [mchCbAmount, setMchCbAmount]                       = useState('')
  const [mchResult, setMchResult]                           = useState(null)
  const [mchLoading, setMchLoading]                         = useState(false)
  const [mchError, setMchError]                             = useState(null)
  const [mchRepLetter, setMchRepLetter]                     = useState(null)
  const [mchRepLetterLoading, setMchRepLetterLoading]       = useState(false)
  const [mchRepLetterError, setMchRepLetterError]           = useState(null)
  const [mchRepLetterCopied, setMchRepLetterCopied]         = useState(false)
  const [mchEvidenceChecked, setMchEvidenceChecked]         = useState({})
  const [mchRepPackage, setMchRepPackage]                   = useState({})
  const [mchAcquirer, setMchAcquirer]                       = useState('')
  const [mchRepDeadline, setMchRepDeadline]                 = useState('')
  const [mchSubmitDate, setMchSubmitDate]                   = useState('')
  const [mchTrackingRef, setMchTrackingRef]                 = useState('')

  // ── Deadline push notifications ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    const fireAlerts = () => {
      if (Notification.permission !== 'granted') return
      outcomes.forEach(o => {
        if (!o.provCreditDate || o.mode === 'merchant') return
        const pc45 = addBusinessDays(o.provCreditDate, 45)
        const d = Math.ceil((pc45 - new Date()) / 86400000)
        if (d === 3 || d === 1) {
          new Notification('Covalence — Reg E Deadline', {
            body: `${o.merchant || o.id}: ${d === 1 ? 'tomorrow' : '3 days'} until 45BD provisional credit deadline`,
            icon: '/favicon.ico',
          })
        }
      })
    }
    fireAlerts()
    const timer = setInterval(fireAlerts, 60 * 60 * 1000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Outcome tracking (60-day dispute log) ─────────────────────────────────
  const [outcomes, setOutcomes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cov_outcomes') || '[]') } catch { return [] }
  })
  useEffect(() => {
    localStorage.setItem('cov_outcomes', JSON.stringify(outcomes))
  }, [outcomes])

  // ── Compliance settings — persisted ───────────────────────────────────────
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } }
  })
  useEffect(() => {
    try { localStorage.setItem('cov_settings', JSON.stringify(settings)) } catch {}
  }, [settings])
  const [showSettings, setShowSettings] = useState(false)
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))
  const resetSettings = () => { setSettings({ ...DEFAULT_SETTINGS }); try { localStorage.removeItem('cov_settings') } catch {} }

  // ── Triage handoff — triageHandoff + setTriageHandoff come as props ────
  const showHandoffBanner = triageHandoff !== null
  const dismissHandoffBanner = () => setTriageHandoff(null)
  useEffect(() => {
    if (!triageHandoff) return
    if (triageHandoff.merchant)         setMerchant(triageHandoff.merchant)
    if (triageHandoff.amount)           setAmount(triageHandoff.amount)
    if (triageHandoff.currency)         setCurrency(triageHandoff.currency)
    if (triageHandoff.transactionDate)  setTransactionDate(triageHandoff.transactionDate)
    if (triageHandoff.complaint)        setComplaint(triageHandoff.complaint)
    if (triageHandoff.network) {
      const n = triageHandoff.network.toLowerCase()
      if (n.includes('mastercard') || n.includes('mc')) setNetwork('mastercard')
      else if (n.includes('visa'))                       setNetwork('visa')
    }
  }, [triageHandoff])

  const toggleCheck = (key) => setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const computeDaysSince = (dateStr) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    const today = new Date()
    return Math.floor((today - d) / (1000 * 60 * 60 * 24))
  }

  const filingWindowStatus = (isFraud) => {
    const txnDays      = computeDaysSince(transactionDate)
    const expectedDays = computeDaysSince(expectedDeliveryDate)
    if (txnDays === null && expectedDays === null) return null
    const baseline = (!isFraud && expectedDays !== null) ? expectedDays : txnDays
    const cap      = txnDays
    const fw = isFraud ? settings.fraudWindowDays : settings.consumerWindowDays
    const warnAt = Math.round(fw * 0.83)   // warn at ~83% of window
    if (isFraud) {
      if (cap > fw)     return { status: 'expired', text: `${cap} days since transaction — past ${fw}-day fraud filing window`, color: 'red' }
      if (cap > warnAt) return { status: 'warning', text: `${cap} days since transaction — only ${fw - cap} days remaining`, color: 'amber' }
      return { status: 'ok', text: `${cap} days since transaction — within ${fw}-day fraud filing window`, color: 'green' }
    }
    if (cap !== null && cap > settings.absoluteCapDays) return { status: 'expired', text: `Past ${settings.absoluteCapDays}-day absolute cap (${cap} days since transaction)`, color: 'red' }
    if (baseline > fw)     return { status: 'late',    text: `${baseline} days past baseline date — outside ${fw}-day standard window`, color: 'red' }
    if (baseline > warnAt) return { status: 'warning', text: `${baseline} days elapsed — only ${fw - baseline} days remaining`, color: 'amber' }
    return { status: 'ok', text: `${baseline} days elapsed — within ${fw}-day filing window`, color: 'green' }
  }

  // ─── Visa reason codes prompt section ───────────────────────────────────────
  const visaCodes = `
Visa reason codes:

FRAUD (Category 10):
- 10.1: EMV Liability Shift Counterfeit Fraud
- 10.2: EMV Liability Shift Non-Counterfeit Fraud
- 10.3: Other Fraud — Card-Present Environment
- 10.4: Other Fraud — Card-Absent Environment
- 10.5: Visa Fraud Monitoring Program

AUTHORIZATION (Category 11):
- 11.1: Card Recovery Bulletin
- 11.2: Declined Authorization
- 11.3: No Authorization

PROCESSING ERRORS (Category 12):
- 12.1: Late Presentment
- 12.2: Incorrect Transaction Code
- 12.3: Incorrect Currency
- 12.4: Incorrect Account Number
- 12.5: Incorrect Amount
- 12.6.1: Duplicate Processing
- 12.6.2: Paid by Other Means
- 12.7: Invalid Data

CONSUMER DISPUTES (Category 13):
- 13.1: Merchandise/Services Not Received
- 13.2: Cancelled Recurring Transaction
- 13.3: Not as Described / Defective Merchandise
- 13.4: Counterfeit Merchandise
- 13.5: Misrepresentation
- 13.6: Credit Not Processed
- 13.7: Cancelled Merchandise/Services
- 13.8: Original Credit Transaction Not Accepted
- 13.9: Non-Receipt of Cash or Load Transaction Value`

  const mastercardCodes = `
Mastercard reason codes:

FRAUD:
- 4837: No Cardholder Authorization
- 4840: Fraudulent Processing of Transactions
- 4849: Questionable Merchant Activity
- 4863: Cardholder Does Not Recognize — Potential Fraud
- 4870: Chip Liability Shift
- 4871: Chip/PIN Liability Shift

AUTHORIZATION:
- 4808: Authorization-Related Chargeback
- 4812: Account Number Not On File
- 4847: Required Authorization Not Obtained

PROCESSING ERRORS:
- 4831: Transaction Amount Differs
- 4834: Point-of-Interaction Error
- 4835: Card Not Valid or Expired
- 4842: Late Presentment
- 4846: Correct Transaction Currency Code Not Provided

CONSUMER DISPUTES:
- 4841: Cancelled Recurring or Digital Goods Transaction
- 4850: Installment Billing Dispute
- 4853: Cardholder Dispute — Defective / Not as Described
- 4854: Cardholder Dispute — Not Elsewhere Classified
- 4855: Goods or Services Not Provided
- 4859: Services Not Rendered
- 4860: Credit Not Processed
- 4999: Domestic Chargeback Dispute (Region Use Only)`

  const networkCodes = network === 'visa' ? visaCodes : mastercardCodes

  const categoryMap = network === 'visa'
    ? '"fraud" | "authorization" | "processing_error" | "consumer_dispute"'
    : '"mc_fraud" | "mc_authorization" | "mc_processing_error" | "mc_consumer_dispute"'

  // ─── Analyse ─────────────────────────────────────────────────────────────────
  const analyze = async () => {
    if (!complaint.trim()) { setError('Customer complaint is required.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    setRebuttal(null)
    setComms(null)
    setChecked({})

    const prompt = `You are an experienced ${network === 'visa' ? 'Visa' : 'Mastercard'} dispute analyst. You write dispute summaries in a tight, operational voice: flowing prose, NO first-person pronouns (no "I"), warm but professional, concise. Real dispute summaries are typically 3-5 sentences, around 80-120 words. Avoid legal-brief language, avoid hedging, avoid repetition.

Analyze this customer complaint and generate a structured dispute analysis.

CUSTOMER COMPLAINT:
"""${complaint}"""

TRANSACTION DETAILS:
- Merchant: ${merchant || 'Not provided'}
- Transaction Amount: ${amount ? `${amount} ${currency}` : 'Not provided'}${disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount ? `\n- Disputed Amount: ${disputedAmount} ${currency} (PARTIAL DISPUTE — cardholder is only disputing this portion of the transaction)` : ''}
- Transaction Date: ${transactionDate || 'Not provided'}
- Expected Delivery/Service Date: ${expectedDeliveryDate || 'Not provided'}
- Card Network: ${network === 'visa' ? 'Visa' : 'Mastercard'}
- Card Type: ${cardType === 'debit' ? 'Debit (Reg E / EFTA)' : 'Credit (Reg Z / FCBA)'}
- 3DS Status: ${threeDSStatus === 'not_attempted' ? 'Not attempted — supports fraud claim' : threeDSStatus === 'attempted_passed' ? 'Passed — liability may shift to issuer, review before filing' : threeDSStatus === 'attempted_failed' ? 'Attempted, authentication failed' : 'Unknown'}

${networkCodes}

FORMATTING RULES:
- For FRAUD codes: 2-3 sentences, ~50-70 words. State who, what, when, and that the cardholder did not authorize.
- For CONSUMER DISPUTE codes: 3-5 sentences, ~80-120 words. Facts, what the cardholder tried, what the cardholder is requesting.
- For PROCESSING ERROR codes: 2-4 sentences, ~60-90 words. State the error and the correct treatment.
- NEVER use first-person pronouns.
- Lead with facts. Save the ask for the final sentence.

Return ONLY a valid JSON object:
{
  "recommended_reason_code": "${network === 'visa' ? '13.5' : '4853'}",
  "reason_code_title": "Code title here",
  "category": ${categoryMap},
  "confidence": "high" | "medium" | "low",
  "rationale": "1-2 sentences explaining why this reason code fits best.",
  "dispute_summary": "Tight operational dispute summary.",
  "missing_information": ["list", "of", "info", "needed"],
  "goodwill_outreach_required": true | false,
  "goodwill_outreach_note": "Brief note if required, otherwise empty string.",
  "alternative_codes": [{"code": "4855", "title": "Goods Not Provided", "when_to_use": "One line"}]
}`

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .replace(/```json|```/g, '')
        .trim()
      const parsed = JSON.parse(text)
      setResult(parsed)
      // Save to outcome log with behavioral signals for DFA
      setOutcomes(prev => [{
        id: 'DD-' + Date.now().toString(36).toUpperCase().slice(-5),
        date: new Date().toISOString(),
        merchant: merchant || '—',
        amount: amount ? amount + ' ' + currency : '—',
        network: network === 'visa' ? 'VISA' : 'MC',
        reasonCode: parsed.recommended_reason_code,
        reasonTitle: parsed.reason_code_title,
        status: 'pending',
        resolvedDate: null,
        threeDSStatus: threeDSStatus,
        confidence: parsed.confidence,
        category: parsed.category,
      }, ...prev])
    } catch (e) {
      setError(`Analysis failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ─── Rebuttal simulator ───────────────────────────────────────────────────
  const fetchRebuttal = async () => {
    if (!result) return
    setRebuttalLoading(true)
    setRebuttalError(null)
    setRebuttal(null)

    const prompt = `You are a chargeback representment expert who has reviewed thousands of merchant rebuttals. Given this dispute, predict exactly what the merchant will argue at representment — and how the issuer should counter it.

DISPUTE DETAILS:
- Network: ${network === 'visa' ? 'Visa' : 'Mastercard'}
- Reason Code: ${result.recommended_reason_code} — ${result.reason_code_title}
- Merchant: ${merchant || 'Unknown'}
- Amount: ${amount ? `${amount} ${currency}` : 'Unknown'}
- Dispute Summary: ${result.dispute_summary}

Be specific and realistic. Merchant arguments should reflect what this type of merchant actually argues for this reason code. Counter-strategy should be actionable for the issuing bank's dispute agent.

Return ONLY valid JSON:
{
  "merchant_arguments": [
    "Specific argument 1 the merchant will make",
    "Specific argument 2",
    "Specific argument 3"
  ],
  "merchant_evidence": [
    "Evidence item 1 merchant will likely submit",
    "Evidence item 2"
  ],
  "counter_strategy": [
    "Actionable counter point 1 for the issuer",
    "Actionable counter point 2"
  ],
  "win_risk": "LOW" | "MEDIUM" | "HIGH",
  "win_risk_note": "One sentence on how strong the merchant defense is likely to be and why."
}`

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .replace(/```json|```/g, '')
        .trim()
      setRebuttal(JSON.parse(text))
    } catch (e) {
      setRebuttalError(`Rebuttal preview failed: ${e.message}`)
    } finally {
      setRebuttalLoading(false)
    }
  }

  // ─── Customer communication ───────────────────────────────────────────────
  const fetchComms = async () => {
    if (!result) return
    setCommsLoading(true)
    setCommsError(null)
    setComms(null)

    const outcomeContext = (result.category === 'fraud' || result.category === 'mc_fraud')
      ? 'This is a confirmed fraud dispute. The cardholder did not authorize the transaction. The bank files through network rules — no merchant contact is involved.'
      : result.goodwill_outreach_required
      ? 'This is a consumer dispute where the cardholder must first attempt direct resolution with the merchant before the bank can file. The cardholder — not the bank or analyst — contacts the merchant directly (by email, phone, or chat). The bank cannot file until that outreach is documented.'
      : 'This is a consumer dispute being filed on behalf of the cardholder through Visa/Mastercard network rules. The bank does not contact the merchant directly — the chargeback is processed through the card network.'

    const prompt = `You are a customer communications specialist at an issuing bank. Write a professional, clear cardholder letter based on this dispute analysis.

DISPUTE DETAILS:
- Network: ${network === 'visa' ? 'Visa' : 'Mastercard'}
- Reason Code: ${result.recommended_reason_code} — ${result.reason_code_title}
- Merchant: ${merchant || 'Unknown'}
- Amount: ${amount ? `${amount} ${currency}` : 'Unknown'}
- Dispute Summary: ${result.dispute_summary}
- Context: ${outcomeContext}
- Goodwill outreach required: ${result.goodwill_outreach_required ? 'Yes — ' + result.goodwill_outreach_note : 'No'}
- Original complaint: "${complaint}"

SELECT THE CORRECT OUTCOME:
- FILING: dispute qualifies and the bank will file on the cardholder's behalf
- NOT_FILING: claim doesn't meet threshold or shows first-party indicators (e.g. pattern of prior disputes, transaction matches cardholder behaviour) — firm but professional, never accuse directly
- DECLINED_TXN: the transaction was already declined/reversed and there is no net loss to recover — explain this clearly so the customer understands
- INVESTIGATION: requires further information or review before a decision

CARD ACTION:
- CANCEL_RECOMMENDED: fraud confirmed or card may be compromised — advise cancellation and reissue
- MONITOR: suspicious activity but card status unclear
- NONE: no card action needed

WRITING RULES:
- Bank voice ("we" / "our")
- Empathetic for genuine fraud victims; firm but respectful if not filing
- Never accuse of fraud directly
- No legal jargon
- 3–4 short paragraphs in the body
- Do NOT include salutation or sign-off in the body field — those are injected separately
- Do NOT list specific documents or supporting materials in the body — document collection is handled separately. If outcome is INVESTIGATION, say only that we will be in touch regarding next steps.
- CRITICAL — WHO CONTACTS WHOM: The bank NEVER contacts the merchant directly. For fraud disputes, the chargeback is filed through the Visa/Mastercard network. For consumer disputes requiring merchant contact, the CARDHOLDER must reach out to the merchant themselves — if a next step references merchant contact, it must say "Contact [merchant] directly" addressed to the cardholder, never "We will contact the merchant on your behalf."

Return ONLY valid JSON:
{
  "outcome": "FILING" | "NOT_FILING" | "DECLINED_TXN" | "INVESTIGATION",
  "card_action": "CANCEL_RECOMMENDED" | "MONITOR" | "NONE",
  "subject": "Re: Your [brief description] — [merchant]",
  "body": "Letter body only. Separate paragraphs with \\n\\n.",
  "next_steps": ["Step 1", "Step 2", "Step 3"],
  "timeline": "e.g. 5–10 business days from the date of this letter"
}`

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .replace(/```json|```/g, '')
        .trim()
      setComms(JSON.parse(text))
    } catch (e) {
      setCommsError(`Communication draft failed: ${e.message}`)
    } finally {
      setCommsLoading(false)
    }
  }

  // ─── Copy summary ─────────────────────────────────────────────────────────
  const copySummary = () => {
    if (!result?.dispute_summary) return
    const formatted = `DISPUTE REASON CODE: ${result.recommended_reason_code} — ${result.reason_code_title}\n\n${result.dispute_summary}`
    navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const commsOutcomeMap = {
    FILING:        { bg: 'bg-emerald-900', text: 'text-emerald-50', label: 'FILING DISPUTE'      },
    NOT_FILING:    { bg: 'bg-red-900',     text: 'text-red-50',     label: 'NOT FILING'          },
    DECLINED_TXN:  { bg: 'bg-stone-700',   text: 'text-stone-50',   label: 'TXN DECLINED'        },
    INVESTIGATION: { bg: 'bg-amber-800',   text: 'text-amber-50',   label: 'UNDER INVESTIGATION' },
  }
  const commsOc = comms ? (commsOutcomeMap[comms.outcome] || commsOutcomeMap.INVESTIGATION) : null
  const copyCommsLetter = () => {
    if (!comms) return
    const full = `Subject: ${comms.subject}\n\nDear Valued Cardholder,\n\n${comms.body}\n\nNext Steps:\n${comms.next_steps?.map(s => `• ${s}`).join('\n')}\n\nExpected timeline: ${comms.timeline}\n\nSincerely,\nCustomer Care Team`
    navigator.clipboard.writeText(full)
    setCommsCopied(true)
    setTimeout(() => setCommsCopied(false), 2000)
  }

  // ── Copy cardholder doc list (plain — paste into any channel) ──────────────
  const copyDocRequest = () => {
    if (!result || !evidence) return
    const items = evidence.cardholder.map((item, i) => `${i + 1}. ${item.text}`).join('\n')
    const missingSection = result.missing_information?.length > 0
      ? `\n\nAlso clarify:\n${result.missing_information.map(m => `• ${m}`).join('\n')}`
      : ''
    const full = `Documents needed — ${result.recommended_reason_code} (${result.reason_code_title}):\n\n${items}${missingSection}`
    navigator.clipboard.writeText(full)
    setDocRequestCopied(true)
    setTimeout(() => setDocRequestCopied(false), 2000)
  }

  // ── Goodwill copy helper ───────────────────────────────────────────────────
  const copyGoodwillScript = () => {
    if (!goodwillRec) return
    navigator.clipboard.writeText(goodwillRec.script)
    setGoodwillCopied(true)
    setTimeout(() => setGoodwillCopied(false), 2000)
  }

  // ── Provisional credit helpers ─────────────────────────────────────────────
  const addBusinessDays = (dateStr, bd) => {
    const d = new Date(dateStr)
    let added = 0
    const out = new Date(d)
    while (added < bd) {
      out.setDate(out.getDate() + 1)
      const dow = out.getDay()
      if (dow !== 0 && dow !== 6) added++
    }
    return out
  }
  const markProvCredit = (id) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, provCreditDate: new Date().toISOString() } : o))

  // ── Pre-arb response drafter ──────────────────────────────────────────────
  const generatePreArbDraft = async (outcome) => {
    setPreArbLoading(true); setPreArbError(null); setPreArbDraft(null); setPreArbTargetId(outcome.id)
    const repNotes = merchantRepNotes[outcome.id] || ''
    const prompt = `You are a senior disputes analyst at a financial institution. Generate a formal pre-arbitration rebuttal.

CASE:
- ID: ${outcome.id}  - Merchant: ${outcome.merchant || 'N/A'}  - Amount: ${outcome.amount || 'N/A'}
- Network: ${(outcome.network || '').toUpperCase()}  - Reason Code: ${outcome.reasonCode || 'N/A'}
- Reason: ${outcome.reasonTitle || 'N/A'}  - Stage: ${outcome.status}

MERCHANT REPRESENTMENT:
${repNotes || 'No notes provided.'}

Return ONLY valid JSON:
{
  "summary": "2-sentence summary of issuer pre-arb position",
  "rebuttal_points": ["Point addressing each merchant argument with evidence/rule cite", "..."],
  "evidence_to_attach": ["Specific document to attach", "..."],
  "formal_statement": "200-300 word formal pre-arb statement for network submission",
  "filing_deadline_note": "Deadline and urgency note",
  "win_assessment": "STRONG" | "MODERATE" | "WEAK",
  "win_note": "1-2 sentences on success likelihood"
}`
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
      setPreArbDraft(JSON.parse(text))
    } catch (e) { setPreArbError('Pre-arb draft failed: ' + e.message) }
    finally { setPreArbLoading(false) }
  }

  // ── Merchant dispute analyser ─────────────────────────────────────────────
  const analyzeMerchant = async () => {
    if (!complaint.trim()) { setMchError('Paste the chargeback notification or describe the dispute.'); return }
    setMchLoading(true); setMchError(null); setMchResult(null); setMchRepLetter(null)
    const tds = mchThreeDS === 'passed' ? 'Passed — liability shifts to issuer' : mchThreeDS === 'failed' ? 'Failed' : mchThreeDS === 'not_attempted' ? 'Not attempted' : 'Unknown'
    const prompt = 'You are an expert chargeback representment specialist advising a merchant. Analyze this chargeback and build the best defence strategy.\n\n'
      + 'CHARGEBACK DETAILS:\n- Reason Code: ' + (mchReasonCode || 'Not specified')
      + '\n- Network: ' + (network === 'visa' ? 'Visa' : 'Mastercard')
      + '\n- Amount: ' + (amount ? amount + ' ' + currency : 'Not specified')
      + '\n- Merchant: ' + (merchant || 'Not specified')
      + '\n- Order Date: ' + (mchOrderDate || 'Not specified')
      + '\n- Order ID: ' + (mchOrderId || 'Not specified')
      + '\n- Customer: ' + (mchCustomerEmail || 'Not specified')
      + '\n- Delivery Confirmed: ' + mchDeliveryConfirmed
      + '\n- 3DS: ' + tds
      + '\n- Refund Policy Shown at Checkout: ' + mchRefundPolicyShown
      + '\n- Prior Orders Same Customer: ' + (mchPriorOrders || 'Unknown')
      + '\n- IP/Location Notes: ' + (mchIpLogs || 'None')
      + '\n\nCHARGEBACK NOTIFICATION:\n"""' + complaint + '"""\n\n'
      + 'Return ONLY valid JSON:\n{\n'
      + '  "win_probability": "HIGH" | "MEDIUM" | "LOW",\n'
      + '  "win_note": "2-sentence win/loss likelihood",\n'
      + '  "rebuttal_strategy": "3-4 sentence representment strategy",\n'
      + '  "key_arguments": ["Argument 1", "Argument 2", "Argument 3"],\n'
      + '  "evidence_to_submit": [{"item": "Document", "priority": "required" | "strengthens", "note": "Why"}],\n'
      + '  "weaknesses": ["Weakness 1"],\n'
      + '  "deadline_note": "Representment deadline guidance",\n'
      + '  "liability_shift": true | false,\n'
      + '  "liability_shift_note": "One sentence or empty string"\n}'
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text)
      setMchResult(parsed)
      const mchCode = (mchReasonCode || '').split(/[\s–—]/)[0].trim()
      setOutcomes(prev => [{
        id: 'MCH-' + Date.now().toString(36).toUpperCase().slice(-5),
        date: new Date().toISOString(),
        merchant: merchant || '—',
        amount: amount ? amount + ' ' + currency : '—',
        network: network === 'visa' ? 'VISA' : 'MC',
        reasonCode: mchReasonCode || '—',
        reasonTitle: REASON_TITLES[mchCode] || (mchCode ? 'Chargeback — ' + mchCode : 'Merchant chargeback'),
        status: 'pending',
        resolvedDate: null,
        mode: 'merchant',
        threeDSStatus: mchThreeDS,
        deliveryConfirmed: mchDeliveryConfirmed,
        refundPolicyShown: mchRefundPolicyShown,
        priorOrders: mchPriorOrders,
        liabilityShift: parsed.liability_shift || false,
        winProb: parsed.win_probability,
      }, ...prev])
    } catch (e) { setMchError('Analysis failed: ' + e.message) }
    finally { setMchLoading(false) }
  }

  const generateRepLetter = async () => {
    if (!mchResult) return
    setMchRepLetterLoading(true); setMchRepLetterError(null); setMchRepLetter(null)
    const prompt = 'You are a professional chargeback representment writer. Draft a formal representment letter for a merchant to submit to their acquirer.\n\n'
      + 'CASE:\n- Reason Code: ' + (mchReasonCode || 'N/A') + ' (' + (network === 'visa' ? 'Visa' : 'Mastercard') + ')'
      + '\n- Amount: ' + (amount ? amount + ' ' + currency : 'N/A')
      + '\n- Merchant: ' + (merchant || 'N/A')
      + '\n- Order ID: ' + (mchOrderId || 'N/A')
      + '\n- Order Date: ' + (mchOrderDate || 'N/A')
      + '\n- Delivery Confirmed: ' + mchDeliveryConfirmed
      + '\n- 3DS: ' + mchThreeDS
      + '\n- Strategy: ' + (mchResult.rebuttal_strategy || '')
      + '\n- Key Arguments: ' + (mchResult.key_arguments || []).join('; ')
      + '\n\nWrite a professional representment letter (300-450 words) from the merchant to their acquirer. '
      + 'Opening: state purpose and chargeback reference. Body: make the case, cite evidence. Closing: state the request and contact. '
      + 'Merchant speaks as "we". Return ONLY the letter text, no JSON or metadata.'
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      setMchRepLetter(data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim())
    } catch (e) { setMchRepLetterError('Letter failed: ' + e.message) }
    finally { setMchRepLetterLoading(false) }
  }

  // ── CBR calculations (merchant mode) ──────────────────────────────────────
  // Auto-populate CBR from tracker (current calendar month)
  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const autoMchCount = outcomes.filter(o => o.mode === 'merchant' && new Date(o.date) >= thisMonthStart).length
  const autoMchAmt   = Math.round(outcomes.filter(o => o.mode === 'merchant' && new Date(o.date) >= thisMonthStart)
    .reduce((sum, o) => sum + (parseFloat((o.amount || '').replace(/[^0-9.]/g, '')) || 0), 0))
  const effectiveCbrDisputes = mchCbDisputes !== '' ? mchCbDisputes : String(autoMchCount)
  const effectiveCbrAmount   = mchCbAmount   !== '' ? mchCbAmount   : String(autoMchAmt)
  const cbrPct = (effectiveCbrDisputes && mchCbTransactions && parseFloat(mchCbTransactions) > 0)
    ? (parseFloat(effectiveCbrDisputes) / parseFloat(mchCbTransactions)) * 100
    : null
  const cbrAmtNum     = parseFloat(effectiveCbrAmount) || 0
  const visaVdmpBreach = cbrPct !== null && cbrPct >= 0.9  && cbrAmtNum >= 75000
  const visaVdmpWarn   = cbrPct !== null && cbrPct >= 0.65 && !visaVdmpBreach
  const mcMdmpBreach   = cbrPct !== null && cbrPct >= 1.5  && cbrAmtNum >= 1000
  const mcMdmpWarn     = cbrPct !== null && cbrPct >= 1.0  && !mcMdmpBreach


  // ── Outcome tracker helpers ────────────────────────────────────────────────
  const markCaseOutcome = (id, status) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, status, resolvedDate: new Date().toISOString() } : o))

  const revertCase = (id) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, status: 'pending', resolvedDate: null } : o))

  const startEdit = (o) => { // pre-populate draft from outcome row
    setEditingRow(o.id)
    setEditDraft({ merchant: o.merchant, amount: o.amount, reasonCode: o.reasonCode, reasonTitle: o.reasonTitle, notes: o.notes || '', submitDate: o.submitDate || '', trackingRef: o.trackingRef || '' })
  }
  const cancelEdit = () => { setEditingRow(null); setEditDraft({}) }
  const saveEdit = (id) => {
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, ...editDraft } : o))
    setEditingRow(null)
    setEditDraft({})
  }
  const deleteCase = (id) => {
    if (window.confirm('Remove this case from the tracker?')) {
      setOutcomes(prev => prev.filter(o => o.id !== id))
      if (editingRow === id) { setEditingRow(null); setEditDraft({}) }
    }
  }

  const exportCSV = () => {
    const sixtyDaysAgo = new Date(Date.now() - (settings.trackerWindowDays || 60) * 24 * 60 * 60 * 1000)
    const isMerchant = platformMode === 'merchant'
    const rows = outcomes.filter(o => new Date(o.date) > sixtyDaysAgo && (isMerchant ? o.mode === 'merchant' : o.mode !== 'merchant'))
    // Export DFA-compatible schema so this CSV can be uploaded directly to DisputeFundingAssessor
    const headers = ['id','code','amount','filed_days_ago','window_days','avs_mismatch','no_3ds','delivery_confirmed','merchant_acknowledged','pin_verified','vfmp_enrolled','strong_docs','merchant_cbr','prior_claims','note','status','resolved_date']
    const csv = [
      headers.join(','),
      ...rows.map(o => {
        const filedDaysAgo = o.date ? Math.round((Date.now() - new Date(o.date).getTime()) / 86400000) : ''
        const no3ds = o.threeDSStatus === 'none' ? 'yes' : o.threeDSStatus ? 'no' : ''
        const strongDocs = o.confidence === 'HIGH' ? 'yes' : o.confidence === 'LOW' ? 'no' : (o.refundPolicyShown ? 'yes' : '')
        const deliveryConf = o.deliveryConfirmed ? 'yes' : isMerchant ? 'no' : ''
        const priorClaims = o.priorOrders || '0'
        const note = isMerchant
          ? ('"' + (o.merchant || '') + (o.winProb ? ' — AI: ' + o.winProb : '') + '"')
          : ('"' + (o.merchant || '') + (o.category ? ' — ' + o.category : '') + '"')
        const amt = (o.amount || '').replace(/[^0-9.]/g, '')
        return [o.id, o.reasonCode || '', amt, filedDaysAgo, 120, '', no3ds, deliveryConf, '', '', '', strongDocs, '', priorClaims, note, o.status, o.resolvedDate ? new Date(o.resolvedDate).toLocaleDateString('en-CA') : ''].join(',')
      })
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (isMerchant ? 'dd-merchant-' : 'dd-fi-') + new Date().toISOString().split('T')[0] + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── FI SAR deadline (30 days from detection date, FinCEN / FINTRAC) ────────
  const fiSarDeadlineRaw = sarDiscoveryDate
    ? new Date(new Date(sarDiscoveryDate).getTime() + 30 * 86400000)
    : null
  const fiSarDeadline  = fiSarDeadlineRaw ? fiSarDeadlineRaw.toLocaleDateString('en-CA') : null
  const fiSarDaysLeft  = fiSarDeadlineRaw ? Math.ceil((fiSarDeadlineRaw - new Date()) / 86400000) : null

  // ── Reg E provisional credit deadline (10 BD from when dispute is received) ──
  // Used when cardType === 'debit' and an analysis has been run
  // Reg E deadlines run from date dispute received (transactionDate as proxy if not separately captured)
  const regEBaseDate = transactionDate || new Date().toISOString()
  const regEPcDue = (cardType === 'debit' && result)
    ? addBusinessDays(regEBaseDate, 10).toLocaleDateString('en-CA')
    : null
  const regEInvDue = (cardType === 'debit' && result)
    ? addBusinessDays(regEBaseDate, 45).toLocaleDateString('en-CA')
    : null

  const isFraud     = result?.category === 'fraud' || result?.category === 'mc_fraud'
  let filingWindow  = null
  try { filingWindow = filingWindowStatus(isFraud) } catch(e) { console.error('[DD] filingWindow crash:', e) }
  let evidence      = null
  try { evidence = result ? getEvidencePackage(result?.recommended_reason_code, result?.category) : null } catch(e) { console.error('[DD] evidence crash:', e) }

  // effectiveAmount: use disputed amount if provided (partial dispute), otherwise use full transaction amount
  const isPartialDispute   = disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount
  const effectiveAmount    = isPartialDispute ? disputedAmount : amount
  const effectiveAmtNum    = parseFloat(effectiveAmount) || 0
  const smallDollar        = effectiveAmtNum > 0 && effectiveAmtNum < settings.smallDollarThreshold

  // Goodwill recommendation — only set when goodwill is actually the recommended path
  let goodwillRec = null
  try {
    if (result) {
      const amtStr      = effectiveAmount ? `${effectiveAmount} ${currency}` : 'the disputed amount'
      const merchantStr = merchant || 'the merchant'
      const partialNote = isPartialDispute ? ` (partial dispute — cardholder is disputing ${disputedAmount} ${currency} of a ${amount} ${currency} transaction)` : ''
      if (smallDollar) {
        goodwillRec = {
          recommended: true, type: 'WRITE-OFF RECOMMENDED',
          typeColor: 'bg-amber-800 text-amber-50',
          rationale: `At ${amtStr}${partialNote}, investigation and network fees may exceed recovery (write-off threshold: $${settings.smallDollarThreshold}). A direct courtesy credit is the most efficient resolution.`,
          script: `Hi [Cardholder name],\n\nI've reviewed your dispute regarding ${merchantStr} for ${amtStr}. Given the amount, I'd like to resolve this right away by applying a one-time courtesy credit of ${amtStr} to your account — no formal chargeback required. This will appear within 3-5 business days.\n\nShall I go ahead and apply that credit now?`,
        }
      } else if (result.goodwill_outreach_required) {
        goodwillRec = {
          recommended: true, type: 'GOODWILL RECOMMENDED',
          typeColor: 'bg-amber-700 text-amber-50',
          rationale: result.goodwill_outreach_note || 'Case may not meet all dispute criteria. A goodwill credit protects the customer relationship.',
          script: `Hi [Cardholder name],\n\nThank you for your patience as we reviewed your dispute for ${amtStr} at ${merchantStr}${partialNote ? partialNote : ''}. While this case presents some challenges for a formal dispute, we value your relationship and want to make this right. I'd like to offer a one-time courtesy credit of ${amtStr} as a gesture of goodwill — it will appear within 3-5 business days.\n\nShall I go ahead and apply it?`,
        }
      } else {
        // Clear dispute path — goodwill is NOT recommended. No script needed.
        goodwillRec = {
          recommended: false, type: 'NOT RECOMMENDED',
          typeColor: 'bg-stone-700 text-stone-50',
          rationale: 'A clear chargeback path exists for this case. A courtesy credit would under-recover for the cardholder and is unnecessary — proceed with formal dispute filing using Steps 01–04.',
        }
      }
    }
  } catch(e) { console.error('[DD] goodwillRec crash:', e) }

  // Outcome tracker: 60-day window only
  // Lifecycle stages: pending → filed → representment → pre_arb → won | lost | withdrawn
  const LIFECYCLE_IN_PROGRESS = new Set(['filed', 'representment', 'pre_arb'])
  const sixtyDaysAgo = new Date(Date.now() - (settings.trackerWindowDays || 60) * 24 * 60 * 60 * 1000)
  const visibleOutcomes = outcomes.filter(o => new Date(o.date) > sixtyDaysAgo)
  const trackerOutcomes = platformMode === 'merchant'
    ? visibleOutcomes.filter(o => o.mode === 'merchant')
    : visibleOutcomes.filter(o => o.mode !== 'merchant')
  const wonCount        = trackerOutcomes.filter(o => o.status === 'won').length
  const lostCount       = trackerOutcomes.filter(o => o.status === 'lost').length
  const withdrawnCount  = trackerOutcomes.filter(o => o.status === 'withdrawn').length
  const inProgressCount = trackerOutcomes.filter(o => LIFECYCLE_IN_PROGRESS.has(o.status)).length
  const resolvedCount   = wonCount + lostCount + withdrawnCount
  const winRate         = resolvedCount > 0 ? Math.round((wonCount / resolvedCount) * 100) : null

  // Advance a case to the next lifecycle stage
  const advanceStage = (id, newStatus) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o))

  // Escalation paths (post-resolution)
  const escalateCase = (id, escalation) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, escalation } : o))

  // PC issued toggle
  const markPcIssued = (id) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, pcIssued: !o.pcIssued } : o))

  // Analytics — derived from visibleOutcomes
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [trackerSearch, setTrackerSearch] = useState('')
  const analytics = React.useMemo(() => {
    const resolved = trackerOutcomes.filter(o => o.status === 'won' || o.status === 'lost')
    // by network
    const byNetwork = {}
    resolved.forEach(o => {
      const net = o.network || '—'
      if (!byNetwork[net]) byNetwork[net] = { won: 0, total: 0 }
      byNetwork[net].total++
      if (o.status === 'won') byNetwork[net].won++
    })
    // by reason code (top 6)
    const byCode = {}
    resolved.forEach(o => {
      const code = (o.reasonCode || '—').split(/[\s–—]/)[0].trim()
      if (!byCode[code]) byCode[code] = { won: 0, total: 0 }
      byCode[code].total++
      if (o.status === 'won') byCode[code].won++
    })
    const topCodes = Object.entries(byCode).sort((a, b) => b[1].total - a[1].total).slice(0, 6)
    // weekly trend (last 8 weeks)
    const weeks = []
    for (let w = 7; w >= 0; w--) {
      const from = new Date(Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000)
      const to   = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000)
      const wk   = trackerOutcomes.filter(o => { const d = new Date(o.date); return d >= from && d < to })
      const wWon = wk.filter(o => o.status === 'won').length
      const wRes = wk.filter(o => o.status === 'won' || o.status === 'lost').length
      weeks.push({ label: `W${8 - w}`, total: wk.length, won: wWon, resolved: wRes, rate: wRes > 0 ? Math.round(wWon / wRes * 100) : null })
    }
    // avg resolution time
    const times = trackerOutcomes.filter(o => o.resolvedDate && o.date).map(o => Math.round((new Date(o.resolvedDate) - new Date(o.date)) / (1000 * 60 * 60 * 24)))
    const avgDays = times.length > 0 ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null
    return { byNetwork, topCodes, weeks, avgDays, resolvedCount: resolved.length }
  }, [outcomes, platformMode])

  const filteredTrackerOutcomes = React.useMemo(() => {
    let list = trackerOutcomes
    if (trackerFilter === 'in_progress') list = list.filter(o => LIFECYCLE_IN_PROGRESS.has(o.status))
    else if (trackerFilter === 'won')  list = list.filter(o => o.status === 'won')
    else if (trackerFilter === 'lost') list = list.filter(o => o.status === 'lost')
    else if (trackerFilter === 'fundable') list = list.filter(o => {
      if (o.mode === 'merchant') return false
      const dfaG = estimateFundingGrade(o.reasonCode, o.amount, { threeDSStatus: o.threeDSStatus, deliveryConfirmed: o.deliveryConfirmed, liabilityShift: o.liabilityShift, refundPolicyShown: o.refundPolicyShown, priorOrders: o.priorOrders, winProb: o.winProb, confidence: o.confidence })
      return dfaG && (dfaG.label === 'A' || dfaG.label === 'B')
    })
    if (trackerSearch.trim()) {
      const q = trackerSearch.toLowerCase()
      list = list.filter(o =>
        (o.id || '').toLowerCase().includes(q) ||
        (o.merchant || '').toLowerCase().includes(q) ||
        (o.reasonCode || '').toLowerCase().includes(q) ||
        (o.notes || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [trackerOutcomes, trackerFilter, trackerSearch])

  const impactStyle = (impact) => {
    if (impact === 'required')    return 'text-stone-900'
    if (impact === 'strengthens') return 'text-emerald-800'
    if (impact === 'weakens')     return 'text-red-800'
    return 'text-stone-700'
  }

  const impactLabel = (impact) => {
    if (impact === 'required')    return '— required'
    if (impact === 'strengthens') return '— strengthens case'
    if (impact === 'weakens')     return '— weakens case if present'
    if (impact === 'context')     return '— context only'
    return ''
  }

  const winRiskColor = (risk) => {
    if (risk === 'LOW')    return { bg: 'bg-emerald-900', text: 'text-emerald-50' }
    if (risk === 'MEDIUM') return { bg: 'bg-amber-800',   text: 'text-amber-50'   }
    if (risk === 'HIGH')   return { bg: 'bg-red-900',     text: 'text-red-50'     }
    return { bg: 'bg-stone-700', text: 'text-stone-50' }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 sm:py-12">

        {/* ── Masthead ── */}
        <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div className="mono-font text-xs tracking-widest text-stone-600 hidden sm:block">ISSUE Nº 002 — THE DISPUTE DESK</div>
            <div className="mono-font text-xs tracking-widest text-stone-600">
              {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
            </div>
          </div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize: 'clamp(48px, 7vw, 88px)', letterSpacing: '-0.03em' }}>
            The Dispute<br />
            <span style={{ fontStyle: 'italic', fontWeight: 500 }}>Desk</span>
          </h1>
          <p className="display-font text-stone-700 mt-4 max-w-2xl" style={{ fontSize: 'clamp(15px, 2vw, 17px)', lineHeight: '1.5' }}>
            {platformMode === 'fi'
              ? 'An operational tool for translating customer complaints into compliant dispute summaries — with a built-in evidence package and merchant defense preview for every case.'
              : 'Build your representment case, fight chargebacks with evidence, and monitor your chargeback ratio against Visa and Mastercard network thresholds.'}
          </p>
          <div className="flex items-center mt-6" style={{ borderTop: '1px solid #D4CCBC', paddingTop: '20px' }}>
            <button onClick={() => setPlatformMode('fi')} className={'platform-toggle-btn mono-font text-xs tracking-widest px-5 py-2.5 border border-stone-900 transition-all ' + (platformMode === 'fi' ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-600 hover:bg-stone-100')}>ISSUER / FI MODE</button>
            <button onClick={() => setPlatformMode('merchant')} className={'platform-toggle-btn mono-font text-xs tracking-widest px-5 py-2.5 border-t border-b border-r border-stone-900 transition-all ' + (platformMode === 'merchant' ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-600 hover:bg-stone-100')}>MERCHANT / ACQUIRER</button>
          </div>
        </div>

        {/* ── Triage handoff banner ── */}
        {showHandoffBanner && triageHandoff && (
          <div className="mb-6 flex items-start gap-3 px-4 py-3" style={{ background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
            <Shield className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#065F46' }} />
            <div className="flex-1 min-w-0">
              <span className="mono-font text-xs tracking-widest" style={{ color: '#064E3B' }}>PRE-FILLED FROM TRIAGE — </span>
              <span className="mono-font text-xs" style={{ color: '#065F46' }}>
                Case {triageHandoff.caseId} · {triageHandoff.classification?.replace(/_/g, ' ')} · {triageHandoff.confidence} confidence
              </span>
              {triageHandoff.headline && (
                <div className="display-font italic text-sm mt-1" style={{ color: '#065F46' }}>"{triageHandoff.headline}"</div>
              )}
            </div>
            <button onClick={dismissHandoffBanner} className="mono-font text-xs shrink-0" style={{ color: '#065F46' }}>✕</button>
          </div>
        )}

        {/* ── Steps 01 + 02 ── */}
        {platformMode === 'fi' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">


          {/* ════ FI INTAKE FORM ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Case Intake</h2>
            </div>

            <div className="space-y-5">

              {/* Network + card type selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Card Network</label>
                  <div className="flex gap-0">
                    <button
                      onClick={() => setNetwork('visa')}
                      className={`network-btn ${network === 'visa' ? 'active' : 'inactive'}`}
                    >
                      VISA
                    </button>
                    <button
                      onClick={() => setNetwork('mastercard')}
                      className={`network-btn ${network === 'mastercard' ? 'active' : 'inactive'}`}
                    >
                      MASTERCARD
                    </button>
                  </div>
                </div>
                <div>
                  <label className="input-label">Card Type</label>
                  <div className="flex gap-0">
                    <button
                      onClick={() => setCardType('credit')}
                      className={`network-btn ${cardType === 'credit' ? 'active' : 'inactive'}`}
                    >
                      CREDIT
                    </button>
                    <button
                      onClick={() => setCardType('debit')}
                      className={`network-btn ${cardType === 'debit' ? 'active' : 'inactive'}`}
                    >
                      DEBIT
                    </button>
                  </div>
                  {cardType === 'debit' && (
                    <div className="mt-1.5 mono-font text-[10px] text-blue-800 tracking-wide">
                      Reg E / EFTA applies — PC required within 10 business days
                    </div>
                  )}
                </div>
              </div>

              {/* 3DS / authentication status */}
              <div>
                <label className="input-label">3DS / Authentication Status <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(for CNP disputes — affects reason code strength)</span></label>
                <div className="flex gap-0 flex-wrap">
                  {[
                    { id: 'not_attempted', label: 'NOT ATTEMPTED' },
                    { id: 'attempted_failed', label: 'ATTEMPTED — FAILED' },
                    { id: 'attempted_passed', label: 'ATTEMPTED — PASSED' },
                    { id: 'unknown', label: 'UNKNOWN' },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setThreeDSStatus(opt.id)}
                      className={"network-btn " + (threeDSStatus === opt.id ? 'active' : 'inactive')}
                    >{opt.label}</button>
                  ))}
                </div>
                {threeDSStatus === 'attempted_passed' && (
                  <div className="mt-1.5 mono-font text-[10px] text-red-800 tracking-wide">
                    ⚠ Passed 3DS typically shifts liability to issuer — review before filing 10.4 CNP
                  </div>
                )}
                {threeDSStatus === 'not_attempted' && (
                  <div className="mt-1.5 mono-font text-[10px] text-emerald-800 tracking-wide">
                    No 3DS strengthens fraud disputes — include in evidence package
                  </div>
                )}
              </div>

              <div>
                <label className="input-label">Customer Complaint</label>
                <textarea
                  value={complaint}
                  onChange={e => setComplaint(e.target.value)}
                  placeholder="Paste the cardholder's written complaint here..."
                  rows={6}
                  className="input-field"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Merchant</label>
                  <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="e.g. Sephora" className="input-field" />
                </div>
                <div>
                  <label className="input-label">Transaction Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="345.81" className="input-field" style={{ flex: 2 }} />
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      <option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="input-label">Disputed Amount <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(if partial — leave blank if disputing full amount)</span></label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={disputedAmount}
                    onChange={e => setDisputedAmount(e.target.value)}
                    placeholder={amount || '0.00'}
                    className="input-field"
                    style={{ maxWidth: '200px' }}
                  />
                  {disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount && (
                    <span className="mono-font text-[10px] text-amber-700 self-center">PARTIAL — disputing {disputedAmount} of {amount || '?'} {currency}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Transaction Date</label>
                  <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
                <div>
                  <label className="input-label">Expected Delivery (Optional)</label>
                  <input type="date" value={expectedDeliveryDate} onChange={e => setExpectedDeliveryDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
              </div>

              {/* SAR discovery date — optional, shows SAR deadline when filled */}
              <div>
                <label className="input-label">
                  Date Fraud Detected / Reported <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(optional — enables SAR deadline tracking)</span>
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="date" value={sarDiscoveryDate} onChange={e => setSarDiscoveryDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px', maxWidth: '200px' }} />
                  {fiSarDeadline && (
                    <div className={`mono-font text-xs px-2 py-1 ${fiSarDaysLeft !== null && fiSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : fiSarDaysLeft !== null && fiSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-700 text-stone-50'}`}>
                      SAR deadline: {fiSarDeadline} · {fiSarDaysLeft !== null ? `${fiSarDaysLeft}d remaining` : ''}
                    </div>
                  )}
                </div>
              </div>

              {smallDollar && (
                <div className="border border-stone-400 bg-stone-50 p-4">
                  <div className="mono-font text-xs tracking-widest text-stone-500 mb-1">⚠ SMALL DOLLAR — CONSIDER WRITE-OFF</div>
                  <p className="display-font text-stone-700 text-[14px] leading-relaxed">
                    At {effectiveAmount} {currency}{isPartialDispute ? ` (partial dispute on a ${amount} ${currency} transaction)` : ''}, staff time and network fees may exceed recovery. Consider a direct courtesy credit before filing a formal dispute.
                  </p>
                </div>
              )}

              {filingWindow && (
                <div className={`p-4 border ${filingWindow.color === 'red' ? 'border-red-700 bg-red-50' : filingWindow.color === 'amber' ? 'border-amber-700 bg-amber-50' : 'border-emerald-700 bg-emerald-50'}`}>
                  <div className="mono-font text-xs tracking-widest mb-1 text-stone-700">FILING WINDOW</div>
                  <div className="display-font text-sm text-stone-900">{filingWindow.text}</div>
                </div>
              )}

              <button
                onClick={analyze}
                disabled={loading || !complaint.trim()}
                className="w-full bg-stone-900 text-stone-50 py-4 mono-font text-xs tracking-widest hover:bg-stone-800 disabled:bg-stone-400 transition-all flex items-center justify-center gap-3 group"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /><span>ANALYZING CASE</span></>
                  : <><span>GENERATE DISPUTE SUMMARY</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
                }
              </button>

              {error && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{error}</div>
                </div>
              )}
            </div>
          </div>


          {/* ════ FI ANALYSIS (02) ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Analysis</h2>
            </div>

            {!result && !loading && (
              <div className="border border-dashed border-stone-400 p-12 text-center">
                <FileText className="w-8 h-8 text-stone-400 mx-auto mb-3" />
                <p className="display-font text-stone-500 italic">Output will appear here after analysis.</p>
              </div>
            )}

            {loading && (
              <div className="border border-stone-300 p-12 text-center bg-stone-50">
                <Loader2 className="w-8 h-8 text-stone-700 mx-auto mb-3 animate-spin" />
                <p className="display-font text-stone-700 italic">Reviewing complaint and matching to reason codes…</p>
              </div>
            )}

            {result && (
              <div className="space-y-6">

                {/* Network badge */}
                <div className="mono-font text-xs tracking-widest text-stone-500 flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-white ${network === 'visa' ? 'bg-blue-800' : 'bg-red-900'}`}>
                    {network === 'visa' ? 'VISA' : 'MASTERCARD'}
                  </span>
                  <span>REASON CODE ANALYSIS</span>
                </div>

                {/* Reason code card */}
                <div className="border-2 border-stone-900 bg-stone-50 p-6">
                  <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                    <div className="mono-font text-xs tracking-widest text-stone-600">RECOMMENDED REASON CODE</div>
                    <div className="flex gap-2 flex-wrap">
                      {result.category && (
                        <div className="mono-font text-xs px-2 py-1 bg-stone-200 text-stone-800">
                          {result.category.replace('mc_', '').replace('_', ' ').toUpperCase()}
                        </div>
                      )}
                      <div className={`mono-font text-xs px-2 py-1 ${result.confidence === 'high' ? 'bg-emerald-900 text-emerald-50' : result.confidence === 'medium' ? 'bg-amber-900 text-amber-50' : 'bg-stone-700 text-stone-50'}`}>
                        {result.confidence?.toUpperCase()} CONFIDENCE
                      </div>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-4 mb-3 flex-wrap">
                    <div className="display-font font-bold text-4xl text-stone-900">{result.recommended_reason_code}</div>
                    <div className="display-font italic text-xl text-stone-700">{result.reason_code_title}</div>
                  </div>
                  <p className="display-font text-stone-700 leading-relaxed text-[15px]">{result.rationale}</p>
                </div>

                {/* Dispute summary */}
                <div className="border border-stone-900 bg-white p-6">
                  <div className="flex items-baseline justify-between mb-4">
                    <div className="mono-font text-xs tracking-widest text-stone-600">
                      DISPUTE SUMMARY — READY FOR {network === 'visa' ? 'VISA' : 'MASTERCARD'}
                    </div>
                    <button onClick={copySummary} className="mono-font text-xs flex items-center gap-1.5 text-stone-700 hover:text-stone-900 transition-colors">
                      {copied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                    </button>
                  </div>
                  <p className="display-font text-stone-900 leading-relaxed text-[16px]" style={{ lineHeight: '1.7' }}>
                    {result.dispute_summary}
                  </p>
                  {isFraud && (
                    <div className="mt-4 pt-4 border-t border-stone-200">
                      <p className="mono-font text-xs text-stone-500 italic">
                        Note: for fraud disputes, liability shifts automatically. A brief summary is sufficient — the network does not require extended narrative for fraud reason codes.
                      </p>
                    </div>
                  )}
                </div>

                {/* Merchant contact required flag */}
                {result.goodwill_outreach_required && (
                  <div className="border-l-4 border-amber-700 bg-amber-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">⚠ CARDHOLDER MUST CONTACT MERCHANT FIRST</div>
                    <p className="display-font text-stone-900 text-[15px] leading-relaxed">{result.goodwill_outreach_note}</p>
                    <p className="mono-font text-xs text-amber-800 mt-2">The cardholder — not the bank — contacts the merchant directly. The bank cannot file until that outreach and the merchant's response (or non-response) are documented.</p>
                  </div>
                )}

                {/* SAR / STR reminder — with deadline countdown when discovery date is set */}
                {isFraud && effectiveAmtNum >= settings.sarThreshold && (
                  <div className="border-l-4 border-red-800 bg-red-50 p-5 space-y-3">
                    <div className="mono-font text-xs tracking-widest text-red-900">⚠ SAR / STR REVIEW REQUIRED</div>
                    <p className="display-font text-stone-900 text-[15px] leading-relaxed">
                      This fraud case meets or exceeds the ${settings.sarThreshold.toLocaleString()} threshold. Review for <strong>Suspicious Activity Report</strong> (SAR / FinCEN) or <strong>Suspicious Transaction Report</strong> (STR / FINTRAC) filing requirements per your institution's BSA/AML policy.
                    </p>
                    {fiSarDeadline ? (
                      <div className={`flex items-center gap-3 mono-font text-xs px-3 py-2 ${fiSarDaysLeft !== null && fiSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : fiSarDaysLeft !== null && fiSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100'}`}>
                        <span>SAR DEADLINE: {fiSarDeadline}</span>
                        {fiSarDaysLeft !== null && (
                          <span className="font-bold">
                            {fiSarDaysLeft > 0 ? `${fiSarDaysLeft} DAYS REMAINING` : fiSarDaysLeft === 0 ? 'DUE TODAY' : `${Math.abs(fiSarDaysLeft)} DAYS OVERDUE`}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mono-font text-[11px] text-red-700 italic">
                        ↑ Enter the date fraud was detected in the intake form above to track the 30-day SAR filing deadline.
                      </div>
                    )}
                  </div>
                )}

                {/* Reg E / EFTA compliance block — debit cards only */}
                {cardType === 'debit' && (
                  <div className="border-l-4 p-5 space-y-2" style={{ borderColor: '#1d4ed8', background: '#eff6ff' }}>
                    <div className="mono-font text-xs tracking-widest" style={{ color: '#1e3a8a' }}>REG E / EFTA — DEBIT CARD</div>
                    <p className="display-font text-stone-900 text-[15px] leading-relaxed">
                      This is a debit card dispute. <strong>Regulation E</strong> requires the financial institution to issue provisional credit within <strong>10 business days</strong> of receiving the claim (5 business days for established accounts). Investigation must be completed within <strong>45 business days</strong> (20 business days for point-of-sale or foreign-initiated transactions).
                    </p>
                    {regEPcDue && (
                      <div className="flex flex-wrap gap-4 pt-1">
                        <div className="mono-font text-xs" style={{ color: '#1e40af' }}>
                          <span className="text-stone-500">PC DUE BY: </span><span className="font-bold">{regEPcDue}</span>
                        </div>
                        <div className="mono-font text-xs" style={{ color: '#1e40af' }}>
                          <span className="text-stone-500">INVESTIGATION DUE: </span><span className="font-bold">{regEInvDue}</span>
                        </div>
                      </div>
                    )}
                    <p className="mono-font text-[10px] text-stone-500 italic pt-1">
                      Note: these dates are calculated from today (date of analysis). Adjust if claim was received on a different date.
                    </p>
                  </div>
                )}

                {/* Visa CE3.0 warning — 10.4 Card-Not-Present disputes */}
                {result?.recommended_reason_code?.startsWith('10.4') && network === 'visa' && (
                  <div className="border-l-4 p-5 space-y-3" style={{ borderColor: '#7e22ce', background: '#faf5ff' }}>
                    <div className="mono-font text-xs tracking-widest" style={{ color: '#581c87' }}>⚠ VISA COMPELLING EVIDENCE 3.0 — VERIFY BEFORE FILING</div>
                    <p className="display-font text-stone-900 text-[15px] leading-relaxed">
                      <strong>Visa CE3.0</strong> (active since April 2023) allows merchants to defeat 10.4 CNP fraud chargebacks if they can show two or more prior <em>undisputed</em> transactions from the same device fingerprint and/or IP address within the 120 days preceding this transaction. If the merchant is CE3.0-enabled and has that evidence on file, your chargeback will be reversed.
                    </p>
                    <div className="space-y-1.5">
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">CHECK BEFORE FILING:</div>
                      {[
                        'Is this cardholder a repeat customer at this merchant? If yes, CE3.0 risk is high.',
                        'Pull IP address and device fingerprint from this transaction — do they match prior undisputed orders?',
                        'Ask cardholder: have they ever shopped at this merchant before, even successfully?',
                        'If prior undisputed transactions exist on the same device/IP, consider downgrading to 10.5 (VFMP) or escalating to fraud ops for further review before filing.',
                      ].map((item, i) => (
                        <div key={i} className="display-font text-[14px] flex gap-2 items-start leading-snug" style={{ color: '#4c1d95' }}>
                          <span className="shrink-0 mt-0.5" style={{ color: '#9333ea' }}>→</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing info */}
                {result.missing_information?.length > 0 && (
                  <div className="border border-stone-400 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-700 mb-3">INFORMATION NEEDED BEFORE FILING</div>
                    <ul className="space-y-2">
                      {result.missing_information.map((item, i) => (
                        <li key={i} className="display-font text-stone-800 text-[15px] flex gap-2">
                          <span className="text-stone-400">→</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Alternative codes */}
                {result.alternative_codes?.length > 0 && (
                  <div>
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">ALTERNATIVE CODES TO CONSIDER</div>
                    <div className="space-y-2">
                      {result.alternative_codes.map((alt, i) => (
                        <div key={i} className="border border-stone-300 bg-white p-4">
                          <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                            <span className="mono-font text-sm font-bold text-stone-900">{alt.code}</span>
                            <span className="display-font italic text-stone-700 text-[15px]">{alt.title}</span>
                          </div>
                          <p className="display-font text-stone-600 text-sm">{alt.when_to_use}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        )}

        {/* ── Steps 01 + 02 — Merchant Mode ── */}
        {platformMode === 'merchant' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* ════ MERCHANT INTAKE FORM ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Chargeback Intake</h2>
            </div>
            <div className="space-y-5">

              <div>
                <label className="input-label">Card Network</label>
                <div className="flex gap-0">
                  <button onClick={() => setNetwork('visa')} className={'network-btn ' + (network === 'visa' ? 'active' : 'inactive')}>VISA</button>
                  <button onClick={() => setNetwork('mastercard')} className={'network-btn ' + (network === 'mastercard' ? 'active' : 'inactive')}>MASTERCARD</button>
                </div>
              </div>

              <div>
                <label className="input-label">Reason Code from Issuer <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(e.g. 10.4, 4853 — from your acquirer notification)</span></label>
                <input type="text" value={mchReasonCode} onChange={e => setMchReasonCode(e.target.value)} placeholder="e.g. 13.1" className="input-field" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Merchant / Store Name</label>
                  <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="Your business name" className="input-field" />
                </div>
                <div>
                  <label className="input-label">Chargeback Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="345.81" className="input-field" style={{ flex: 2 }} />
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      <option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Original Order Date</label>
                  <input type="date" value={mchOrderDate} onChange={e => setMchOrderDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
                <div>
                  <label className="input-label">Chargeback Received Date</label>
                  <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Order ID / Reference</label>
                  <input type="text" value={mchOrderId} onChange={e => setMchOrderId(e.target.value)} placeholder="ORD-2024-00183" className="input-field" />
                </div>
                <div>
                  <label className="input-label">Customer Email / ID</label>
                  <input type="text" value={mchCustomerEmail} onChange={e => setMchCustomerEmail(e.target.value)} placeholder="customer@email.com" className="input-field" />
                </div>
              </div>

              <div>
                <label className="input-label">Chargeback Notification / Customer Claim</label>
                <textarea value={complaint} onChange={e => setComplaint(e.target.value)} placeholder="Paste the chargeback notification or describe the dispute..." rows={5} className="input-field" style={{ resize: 'vertical' }} />
              </div>

              <div>
                <label className="input-label">Delivery / Service Confirmed</label>
                <div className="flex gap-0 flex-wrap">
                  {[{ id: 'yes', label: 'YES — CONFIRMED' }, { id: 'no', label: 'NO / UNCONFIRMED' }, { id: 'unknown', label: 'UNKNOWN' }].map(opt => (
                    <button key={opt.id} onClick={() => setMchDeliveryConfirmed(opt.id)} className={'network-btn ' + (mchDeliveryConfirmed === opt.id ? 'active' : 'inactive')}>{opt.label}</button>
                  ))}
                </div>
                {mchDeliveryConfirmed === 'yes' && <div className="mt-1.5 mono-font text-[10px] text-emerald-800 tracking-wide">Confirmed delivery strengthens 13.1 / 4855 defence — include tracking proof</div>}
                {mchDeliveryConfirmed === 'no' && <div className="mt-1.5 mono-font text-[10px] text-amber-800 tracking-wide">Unconfirmed delivery weakens position — focus other arguments</div>}
              </div>

              <div>
                <label className="input-label">3DS Authentication Result</label>
                <div className="flex gap-0 flex-wrap">
                  {[{ id: 'passed', label: 'PASSED' }, { id: 'failed', label: 'FAILED' }, { id: 'not_attempted', label: 'NOT ATTEMPTED' }, { id: 'unknown', label: 'UNKNOWN' }].map(opt => (
                    <button key={opt.id} onClick={() => setMchThreeDS(opt.id)} className={'network-btn ' + (mchThreeDS === opt.id ? 'active' : 'inactive')}>{opt.label}</button>
                  ))}
                </div>
                {mchThreeDS === 'passed' && <div className="mt-1.5 mono-font text-[10px] text-emerald-800 tracking-wide">Liability shifts to issuer — strong defence for 10.4 / 4837 fraud chargebacks</div>}
                {mchThreeDS === 'not_attempted' && <div className="mt-1.5 mono-font text-[10px] text-amber-800 tracking-wide">No 3DS = no liability shift — harder to fight fraud-coded chargebacks</div>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Refund Policy Shown at Checkout</label>
                  <div className="flex gap-0">
                    {[{ id: 'yes', label: 'YES' }, { id: 'no', label: 'NO' }, { id: 'unknown', label: 'UNK' }].map(opt => (
                      <button key={opt.id} onClick={() => setMchRefundPolicyShown(opt.id)} className={'network-btn ' + (mchRefundPolicyShown === opt.id ? 'active' : 'inactive')}>{opt.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="input-label">Prior Orders (Same Customer)</label>
                  <input type="number" value={mchPriorOrders} onChange={e => setMchPriorOrders(e.target.value)} placeholder="0" className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
              </div>

              <div>
                <label className="input-label">IP / Location Notes <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(AVS match, IP vs billing, device fingerprint)</span></label>
                <input type="text" value={mchIpLogs} onChange={e => setMchIpLogs(e.target.value)} placeholder="e.g. IP matches billing zip, AVS match, same device as prior orders" className="input-field" />
              </div>

              <button onClick={analyzeMerchant} disabled={mchLoading || !complaint.trim()}
                className="w-full bg-stone-900 text-stone-50 py-4 mono-font text-xs tracking-widest hover:bg-stone-800 disabled:bg-stone-400 transition-all flex items-center justify-center gap-3 group">
                {mchLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /><span>ANALYZING CHARGEBACK</span></>
                  : <><span>ANALYZE &amp; BUILD DEFENCE</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
              </button>

              {mchError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{mchError}</div>
                </div>
              )}
            </div>
          </div>

          {/* ════ MERCHANT ANALYSIS (02) ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Defence Strategy</h2>
            </div>
            {!mchResult && !mchLoading && (
              <div className="border border-dashed border-stone-400 p-12 text-center">
                <Shield className="w-8 h-8 text-stone-400 mx-auto mb-3" />
                <p className="display-font text-stone-500 italic">Defence strategy will appear after analysis.</p>
              </div>
            )}
            {mchLoading && (
              <div className="border border-stone-300 p-12 text-center bg-stone-50">
                <Loader2 className="w-8 h-8 text-stone-700 mx-auto mb-3 animate-spin" />
                <p className="display-font text-stone-700 italic">Building representment strategy…</p>
              </div>
            )}
            {mchResult && (
              <div className="space-y-6">
                <div className="border-2 border-stone-900 bg-stone-50 p-6">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="mono-font text-xs tracking-widest text-stone-600">WIN PROBABILITY</div>
                    <span className={'mono-font text-sm font-bold px-3 py-1 ' + (mchResult.win_probability === 'HIGH' ? 'bg-emerald-900 text-emerald-50' : mchResult.win_probability === 'MEDIUM' ? 'bg-amber-800 text-amber-50' : 'bg-red-900 text-red-50')}>
                      {mchResult.win_probability}
                    </span>
                  </div>
                  <p className="display-font text-stone-700 leading-relaxed text-[15px]">{mchResult.win_note}</p>
                  {mchResult.liability_shift && (
                    <div className="mt-3 pt-3 border-t border-stone-200">
                      <div className="mono-font text-[10px] tracking-widest text-emerald-800 mb-1">LIABILITY SHIFT</div>
                      <p className="display-font text-emerald-900 text-[14px]">{mchResult.liability_shift_note}</p>
                    </div>
                  )}
                </div>
                <div className="border border-stone-900 bg-white p-6">
                  <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">REPRESENTMENT STRATEGY</div>
                  <p className="display-font text-stone-900 leading-relaxed text-[15px]" style={{ lineHeight: '1.7' }}>{mchResult.rebuttal_strategy}</p>
                </div>
                {mchResult.key_arguments && mchResult.key_arguments.length > 0 && (
                  <div className="border-l-4 border-stone-900 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">KEY ARGUMENTS</div>
                    <div className="space-y-2">
                      {mchResult.key_arguments.map((arg, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 leading-snug">
                          <span className="mono-font text-[11px] text-stone-500 shrink-0 mt-0.5">{i+1}.</span>
                          <span>{arg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mchResult.evidence_to_submit && mchResult.evidence_to_submit.length > 0 && (
                  <div className="border border-stone-300 p-5" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">EVIDENCE TO SUBMIT</div>
                    <div className="space-y-3">
                      {mchResult.evidence_to_submit.map((ev, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <span className={'mono-font text-[9px] tracking-widest px-1.5 py-0.5 mt-0.5 shrink-0 ' + (ev.priority === 'required' ? 'bg-stone-900 text-stone-50' : 'bg-stone-300 text-stone-700')}>{(ev.priority || '').toUpperCase()}</span>
                          <div>
                            <div className="display-font text-stone-800 text-[14px] font-medium">{ev.item}</div>
                            <div className="display-font text-stone-500 text-[12px] italic">{ev.note}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mchResult.weaknesses && mchResult.weaknesses.length > 0 && (
                  <div className="border-l-4 border-amber-700 bg-amber-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">WEAKNESSES TO ADDRESS</div>
                    <div className="space-y-1.5">
                      {mchResult.weaknesses.map((w, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 leading-snug">
                          <span className="text-amber-600 shrink-0 mt-0.5">→</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mchResult.deadline_note && (
                  <div className="mono-font text-[11px] text-amber-800 tracking-wide border border-amber-300 bg-amber-50 px-3 py-2">
                    {mchResult.deadline_note}
                  </div>
                )}
                {!mchRepLetter && !mchRepLetterLoading && (
                  <button onClick={generateRepLetter}
                    className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group w-full justify-center">
                    <FileText className="w-4 h-4" />
                    <span>GENERATE REPRESENTMENT LETTER</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}
                {mchRepLetterLoading && (
                  <div className="border border-stone-300 p-8 bg-stone-50 flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-stone-600 animate-spin shrink-0" />
                    <p className="display-font text-stone-600 italic">Drafting representment letter…</p>
                  </div>
                )}
                {mchRepLetterError && (
                  <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                    <span className="display-font text-sm text-red-900">{mchRepLetterError}</span>
                  </div>
                )}
                {mchRepLetter && (
                  <div className="border border-stone-900">
                    <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
                      <div className="mono-font text-[10px] tracking-widest text-stone-400">REPRESENTMENT LETTER</div>
                      <button onClick={() => { navigator.clipboard.writeText(mchRepLetter); setMchRepLetterCopied(true); setTimeout(() => setMchRepLetterCopied(false), 2000) }}
                        className="mono-font text-[10px] flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors">
                        {mchRepLetterCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                      </button>
                    </div>
                    <div className="bg-white p-5">
                      {mchRepLetter.split('\n\n').map((para, i) => (
                        <p key={i} className={'display-font text-stone-800 text-[14px] leading-relaxed ' + (i > 0 ? 'mt-3' : '')}>{para}</p>
                      ))}
                    </div>
                    <div className="bg-stone-50 px-4 py-2 border-t border-stone-200">
                      <button onClick={generateRepLetter} className="mono-font text-[10px] tracking-widest text-stone-500 hover:text-stone-800 transition-colors">↺ REGENERATE</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
        )}

        {platformMode === 'merchant' && (<>

        {/* ── Step 03 — Evidence Collection ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">03</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Evidence Collection</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
            Gather documents to support your representment. Items below are tailored to your reason code — enter it in Step 01 for a targeted list.
          </p>

          {transactionDate && (() => {
            const ddDays = network === 'mastercard' ? 45 : network === 'amex' ? 20 : 30
            const dl = new Date(transactionDate); dl.setDate(dl.getDate() + ddDays)
            const dLeft = Math.ceil((dl - Date.now()) / 86400000)
            const past = dLeft < 0; const urgent = !past && dLeft <= 7
            return (
              <div className={'flex items-start gap-4 px-4 py-3 mb-6 border ' + (past ? 'border-red-700' : urgent ? 'border-amber-700' : 'border-stone-300')}
                style={{ background: past ? '#FEF2F2' : urgent ? '#FFFBEB' : '#FAF7F1' }}>
                <div>
                  <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-1">
                    {'NETWORK DEADLINE · ' + (network || 'VISA').toUpperCase() + ' · ' + ddDays + 'D FROM CHARGEBACK NOTICE'}
                  </div>
                  <div className={'mono-font text-sm font-semibold ' + (past ? 'text-red-700' : urgent ? 'text-amber-800' : 'text-stone-900')}>
                    {dl.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    <span className="ml-3 font-normal text-xs">{past ? '⚠ DEADLINE PASSED' : dLeft + 'd remaining'}</span>
                  </div>
                  <div className="display-font text-[12px] text-stone-400 mt-1 italic">
                    Your acquirer deadline is typically 3–5 days earlier — confirm with your processor
                  </div>
                </div>
              </div>
            )
          })()}

          {(() => {
            const code = (mchReasonCode || '').trim()
            const isFraud     = !code || /^10\.|^4835|^4863|^48\d{2}/.test(code)
            const isNotRcvd   = !code || /^13\.1|^4855|^4860/.test(code)
            const isCancelled = /^13\.[27]|^4841/.test(code)
            const isNotAsDesc = /^13\.3|^4853/.test(code)
            const items = [
              { id: 'txn_receipt',    label: 'Transaction receipt and authorization record',                  tag: 'ALWAYS' },
              { id: 'avs_cvv',        label: 'AVS and CVV response codes from the authorization',            tag: 'ALWAYS' },
              { id: 'ip_device',      label: 'IP address, device fingerprint, and login logs',               tag: 'ALWAYS' },
              { id: 'customer_comms', label: 'Customer communications — emails, chat logs, SMS',             tag: 'ALWAYS' },
              { id: 'terms',          label: 'T&Cs and refund policy acknowledged at checkout',              tag: 'ALWAYS' },
              ...(isFraud ? [
                { id: '3ds',          label: '3DS authentication result — passed shifts liability to issuer', tag: 'FRAUD' },
                { id: 'billing',      label: 'Billing address match confirmed at time of purchase',          tag: 'FRAUD' },
                { id: 'prior_orders', label: 'Prior successful orders from same customer or device',         tag: 'FRAUD' },
              ] : []),
              ...(isNotRcvd ? [
                { id: 'tracking',     label: 'Carrier tracking number and proof of delivery',               tag: 'NOT RECEIVED' },
                { id: 'signed_rcpt',  label: 'Signed delivery receipt or digital delivery proof',           tag: 'NOT RECEIVED' },
                { id: 'ship_date',    label: 'Proof of shipment date — must predate the dispute notice',    tag: 'NOT RECEIVED' },
              ] : []),
              ...(isCancelled ? [
                { id: 'cancel_pol',   label: 'Cancellation policy displayed at point of signup',            tag: 'RECURRING' },
                { id: 'cancel_conf',  label: 'Cancellation request record or evidence no request was made', tag: 'RECURRING' },
                { id: 'post_use',     label: 'Evidence of service usage after the claimed cancellation date', tag: 'RECURRING' },
              ] : []),
              ...(isNotAsDesc ? [
                { id: 'listing',      label: 'Product listing or spec description at time of purchase',     tag: 'NOT AS DESC' },
                { id: 'photos',       label: 'Photos confirming item matched the description sold',         tag: 'NOT AS DESC' },
              ] : []),
            ]
            const checkedCount = items.filter(it => mchEvidenceChecked[it.id]).length
            const tagBg = { 'ALWAYS': '#1A1814', 'FRAUD': '#92400E', 'NOT RECEIVED': '#1E40AF', 'RECURRING': '#5B21B6', 'NOT AS DESC': '#065F46' }
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="mono-font text-[9px] tracking-widest text-stone-500">
                    {code ? 'EVIDENCE REQUIRED — CODE ' + code : 'FULL CHECKLIST — ENTER REASON CODE IN STEP 01 FOR TAILORED LIST'}
                  </div>
                  <div className="mono-font text-[9px] text-stone-400">{checkedCount} / {items.length} CONFIRMED</div>
                </div>
                <div className="border border-stone-200" style={{ background: '#FAF7F1' }}>
                  {items.map((it, idx) => (
                    <label key={it.id} className={'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors ' + (idx < items.length - 1 ? 'border-b border-stone-200' : '')}>
                      <input type="checkbox" checked={!!mchEvidenceChecked[it.id]}
                        onChange={e => setMchEvidenceChecked(prev => ({ ...prev, [it.id]: e.target.checked }))}
                        className="mt-0.5 shrink-0" style={{ accentColor: '#1A1814' }} />
                      <span className="display-font text-stone-800 text-[14px] leading-snug flex-1">{it.label}</span>
                      <span className="mono-font text-[8px] tracking-widest px-1.5 py-0.5 shrink-0"
                        style={{ background: tagBg[it.tag] || '#1A1814', color: '#F5F1EA' }}>{it.tag}</span>
                    </label>
                  ))}
                </div>
                {checkedCount > 0 && checkedCount === items.length && (
                  <div className="mt-3 mono-font text-[9px] tracking-widest text-emerald-700">
                    ✓ ALL EVIDENCE CONFIRMED — READY FOR STEP 04
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* ── Step 04 — Representment Package ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">04</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Representment Package</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
            Compile the rebuttal letter from Step 02 with your evidence into a single package and log the submission details below.
            Generic documentation almost always loses — every item must directly address the reason code.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="input-label">Acquirer / Processor Name</label>
              <input type="text" value={mchAcquirer} onChange={e => setMchAcquirer(e.target.value)}
                placeholder="e.g. Chase Merchant Services, Stripe, Square" className="input-field" />
            </div>
            <div>
              <label className="input-label">Your Submission Deadline (from acquirer)</label>
              <input type="date" value={mchRepDeadline} onChange={e => setMchRepDeadline(e.target.value)} className="input-field" />
              <p className="display-font text-[11px] text-stone-400 mt-1 italic leading-snug">
                {'Network allows ' + (network === 'mastercard' ? '45' : network === 'amex' ? '20' : '30') + 'd — acquirers typically cut off 3–5 days earlier'}
              </p>
            </div>
          </div>

          <div className="mb-6">
            <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-3">SUBMISSION CHECKLIST</div>
            <div className="border border-stone-200" style={{ background: '#FAF7F1' }}>
              {[
                { id: 'rep_letter',    label: 'Rebuttal letter drafted and reviewed (Step 02)' },
                { id: 'evidence_done', label: 'All evidence items collected and confirmed (Step 03)' },
                { id: 'txn_records',   label: 'Transaction records and authorization response attached' },
                { id: 'code_match',    label: 'Each piece of evidence directly addresses the reason code' },
                { id: 'format_ok',     label: 'Package formatted per acquirer requirements (PDF, file size)' },
                { id: 'submitted',     label: 'Package submitted to acquirer portal or case manager' },
              ].map((item, idx, arr) => (
                <label key={item.id} className={'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors ' + (idx < arr.length - 1 ? 'border-b border-stone-200' : '')}>
                  <input type="checkbox" checked={!!mchRepPackage[item.id]}
                    onChange={e => setMchRepPackage(prev => ({ ...prev, [item.id]: e.target.checked }))}
                    className="mt-0.5 shrink-0" style={{ accentColor: '#1A1814' }} />
                  <span className="display-font text-stone-800 text-[14px] leading-snug">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="input-label">Date Submitted to Acquirer</label>
              <input type="date" value={mchSubmitDate} onChange={e => setMchSubmitDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="input-label">Acquirer Reference / Case Number</label>
              <input type="text" value={mchTrackingRef} onChange={e => setMchTrackingRef(e.target.value)}
                placeholder="e.g. ACQ-2024-88341" className="input-field" />
            </div>
          </div>

          {mchSubmitDate && (
            <div className="mt-5 px-4 py-3 border border-emerald-700" style={{ background: '#ECFDF5' }}>
              <div className="mono-font text-[9px] tracking-widest text-emerald-800 mb-1">SUBMITTED TO ACQUIRER</div>
              <div className="display-font text-emerald-900 text-sm">
                {new Date(mchSubmitDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {mchTrackingRef && <> · Ref: <span className="font-semibold">{mchTrackingRef}</span></>}
              </div>
              <div className="display-font text-emerald-700 text-[12px] mt-1 italic">
                Issuer decision typically arrives 30–75 days after submission. Track the outcome in Step 05 below.
              </div>
            </div>
          )}
        </div>

        </>)}

        {platformMode === 'fi' && (<>
        {/* ── Step 03 — Evidence Package ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">03</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Evidence Package</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-8 ml-7" style={{ lineHeight: '1.5' }}>
                {result ? <>Evidence checklist for <span className="font-semibold text-stone-700">{result.recommended_reason_code} — {result.reason_code_title}</span>. Check items off as you collect them.</> : <>What to collect from your systems, cardholder, and the merchant for each reason code.</>}
              </p>

              {!evidence && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <FileText className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate the evidence package.</p>
                </div>
              )}

              {evidence && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {evidence.systems.length > 0 && (
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">PULL FROM YOUR SYSTEMS</div>
                    <div className="space-y-3">
                      {evidence.systems.map((item, i) => {
                        const key = `sys-${i}`
                        const done = !!checked[key]
                        return (
                          <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-2.5 items-start group">
                            {done ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                            <div>
                              <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : impactStyle(item.impact)}`}>{item.text}</span>
                              {!done && <span className="mono-font text-[10px] text-stone-400 ml-1">{impactLabel(item.impact)}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {evidence.cardholder.length > 0 && (
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">COLLECT FROM CARDHOLDER</div>
                    <div className="space-y-3">
                      {evidence.cardholder.map((item, i) => {
                        const key = `ch-${i}`
                        const done = !!checked[key]
                        return (
                          <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-2.5 items-start group">
                            {done ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                            <div>
                              <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : impactStyle(item.impact)}`}>{item.text}</span>
                              {!done && <span className="mono-font text-[10px] text-stone-400 ml-1">{impactLabel(item.impact)}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {evidence.merchant.length > 0 && (
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">WATCH FOR FROM MERCHANT</div>
                    <p className="display-font text-stone-500 text-[13px] italic mb-3">Merchant may submit these at representment. Know what could weaken or support your position.</p>
                    <div className="space-y-3">
                      {evidence.merchant.map((item, i) => {
                        const key = `mer-${i}`
                        const done = !!checked[key]
                        return (
                          <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-2.5 items-start group">
                            {done ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                            <div>
                              <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : impactStyle(item.impact)}`}>{item.text}</span>
                              {!done && <span className="mono-font text-[10px] text-stone-400 ml-1">{impactLabel(item.impact)}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>}
            </div>

        {/* ── Step 04 — Merchant Defense Preview ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">06</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Merchant Defense Preview</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
                Anticipate what the merchant will argue at representment — before they file it.
              </p>

              {!result && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <Shield className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate the merchant defense preview.</p>
                </div>
              )}
              {result && !rebuttal && !rebuttalLoading && (
                <button
                  onClick={fetchRebuttal}
                  className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group"
                >
                  <Shield className="w-4 h-4" />
                  <span>GENERATE MERCHANT DEFENSE PREVIEW</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              )}

              {rebuttalLoading && (
                <div className="border border-stone-300 p-8 bg-stone-50 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-stone-600 animate-spin shrink-0" />
                  <p className="display-font text-stone-600 italic">Modelling merchant representment strategy…</p>
                </div>
              )}

              {rebuttalError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{rebuttalError}</div>
                </div>
              )}

              {rebuttal && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                  {/* Merchant arguments */}
                  <div className="border-2 border-stone-900 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">MERCHANT WILL ARGUE</div>
                    <div className="space-y-3">
                      {rebuttal.merchant_arguments?.map((arg, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="text-stone-400 shrink-0 mt-0.5">→</span>
                          <span>{arg}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Merchant evidence */}
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">EVIDENCE THEY'LL SUBMIT</div>
                    <div className="space-y-3">
                      {rebuttal.merchant_evidence?.map((ev, i) => (
                        <div key={i} className="display-font text-red-900 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="text-red-400 shrink-0 mt-0.5">⚠</span>
                          <span>{ev}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Counter strategy */}
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">HOW TO COUNTER</div>
                    <div className="space-y-3">
                      {rebuttal.counter_strategy?.map((pt, i) => (
                        <div key={i} className="display-font text-emerald-800 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="text-emerald-600 shrink-0 mt-0.5">✓</span>
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>

                    {rebuttal.win_risk && (
                      <div className="mt-5 pt-4 border-t border-stone-200">
                        <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">MERCHANT DEFENSE STRENGTH</div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`mono-font text-xs px-2 py-0.5 ${winRiskColor(rebuttal.win_risk).bg} ${winRiskColor(rebuttal.win_risk).text}`}>
                            {rebuttal.win_risk} RISK
                          </span>
                        </div>
                        <p className="display-font text-stone-600 text-[13px] italic leading-snug">{rebuttal.win_risk_note}</p>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>

        {/* ── Step 05 — Customer Communication ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">05</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Customer Communication</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
                Draft the cardholder letter based on desk findings — filing, not filing, declined transaction, or investigation.
              </p>

              {!result && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <MessageSquare className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate the customer communication draft.</p>
                </div>
              )}
              {result && !comms && !commsLoading && (
                <button
                  onClick={fetchComms}
                  className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>GENERATE CUSTOMER LETTER</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              )}

              {commsLoading && (
                <div className="border border-stone-300 p-8 bg-stone-50 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-stone-600 animate-spin shrink-0" />
                  <p className="display-font text-stone-600 italic">Drafting customer communication…</p>
                </div>
              )}

              {commsError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{commsError}</div>
                </div>
              )}

              {comms && commsOc && (
                <div className="border border-stone-900">

                  {/* Letter header */}
                  <div className="bg-stone-900 p-4 flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-1">SUBJECT</div>
                      <div className="display-font text-stone-100 font-semibold">{comms.subject}</div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className={`mono-font text-xs px-2 py-1 ${commsOc.bg} ${commsOc.text}`}>{commsOc.label}</span>
                      {comms.card_action === 'CANCEL_RECOMMENDED' && (
                        <span className="mono-font text-xs px-2 py-1 bg-red-700 text-red-50">CANCEL CARD</span>
                      )}
                      {comms.card_action === 'MONITOR' && (
                        <span className="mono-font text-xs px-2 py-1 bg-amber-800 text-amber-50">MONITOR CARD</span>
                      )}
                    </div>
                  </div>

                  {/* Letter body */}
                  <div className="bg-white p-6 space-y-4 border-b border-stone-200">
                    <p className="display-font text-stone-600 text-[14px] italic">Dear Valued Cardholder,</p>
                    {comms.body?.split('\n\n').map((para, i) => (
                      <p key={i} className="display-font text-stone-900 text-[15px] leading-relaxed">{para}</p>
                    ))}
                    <p className="display-font text-stone-600 text-[14px] italic pt-2">
                      Sincerely,<br />Customer Care Team
                    </p>
                  </div>

                  {/* Next steps + timeline */}
                  <div className="bg-stone-50 p-5 grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-stone-200">
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">NEXT STEPS FOR CARDHOLDER</div>
                      <div className="space-y-2">
                        {comms.next_steps?.map((step, i) => (
                          <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 items-start">
                            <span className="text-stone-400 shrink-0 mt-0.5">→</span>
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">EXPECTED TIMELINE</div>
                      <div className="display-font text-stone-800 text-[15px]">{comms.timeline}</div>
                    </div>
                  </div>

                  {/* Copy */}
                  <div className="p-4 flex justify-end bg-stone-50">
                    <button onClick={copyCommsLetter} className="mono-font text-xs flex items-center gap-1.5 text-stone-700 hover:text-stone-900 transition-colors">
                      {commsCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY LETTER</>}
                    </button>
                  </div>

                </div>
              )}

              {/* ── Documents to collect — inline agent reference ── */}
              {result && evidence && evidence.cardholder.length > 0 && (
                <div className="mt-4 border border-stone-300" style={{ background: '#FAF7F1' }}>
                  <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-stone-400" />
                      <span className="mono-font text-xs tracking-widest text-stone-500">DOCUMENTS TO COLLECT FROM CARDHOLDER</span>
                    </div>
                    <button onClick={copyDocRequest} className="mono-font text-xs flex items-center gap-1.5 text-stone-600 hover:text-stone-900 transition-colors">
                      {docRequestCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY LIST</>}
                    </button>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {evidence.cardholder.map((item, i) => {
                      const key = `docreq-${i}`
                      const done = !!checked[key]
                      return (
                        <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-3 items-start group">
                          {done
                            ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                            : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                          <div>
                            <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : 'text-stone-800'}`}>{item.text}</span>
                            {!done && item.impact === 'required' && (
                              <span className="mono-font text-[9px] text-red-700 ml-2 tracking-wider">REQUIRED</span>
                            )}
                            {!done && item.impact === 'strengthens' && (
                              <span className="mono-font text-[9px] text-emerald-700 ml-2 tracking-wider">STRENGTHENS</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {result.missing_information?.length > 0 && (
                    <div className="px-5 pb-4 border-t border-stone-200 pt-3">
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-2">ALSO CLARIFY</div>
                      {result.missing_information.map((m, i) => (
                        <div key={i} className="display-font text-stone-700 text-[14px] flex gap-2 items-start leading-snug mb-1">
                          <span className="text-stone-400">→</span><span>{m}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

        {/* ── Step 06 — Goodwill Credit ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">06</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Goodwill Credit</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
                When a formal dispute isn't the right path — small dollar, relationship risk, or a case that doesn't quite meet threshold — use a courtesy credit instead.
              </p>

              {!result && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <Shield className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate a goodwill recommendation.</p>
                </div>
              )}

              {result && goodwillRec && (
                <div className="border border-stone-300" style={{ background: '#FAF7F1' }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-3">
                    <span className={`mono-font text-xs px-2 py-1 ${goodwillRec.typeColor}`}>{goodwillRec.type}</span>
                    {goodwillRec.recommended && (
                      <button onClick={copyGoodwillScript} className="mono-font text-xs flex items-center gap-1.5 text-stone-600 hover:text-stone-900 transition-colors">
                        {goodwillCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY SCRIPT</>}
                      </button>
                    )}
                  </div>

                  {/* Rationale */}
                  <div className="px-5 pt-4 pb-2">
                    <div className="mono-font text-xs tracking-widest text-stone-400 mb-2">RATIONALE</div>
                    <p className="display-font text-stone-700 text-[14px] leading-relaxed">{goodwillRec.rationale}</p>
                  </div>

                  {/* Script — only shown when goodwill is actually recommended */}
                  {goodwillRec.recommended && goodwillRec.script && (
                    <div className="px-5 pt-3 pb-5">
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-3">AGENT SCRIPT</div>
                      <div className="border border-stone-200 bg-white p-4">
                        {goodwillRec.script.split('\n\n').map((para, i) => (
                          <p key={i} className={`display-font text-stone-800 text-[14px] leading-relaxed ${i > 0 ? 'mt-3' : ''}`}>{para}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* NOT RECOMMENDED — redirect to formal dispute */}
                  {!goodwillRec.recommended && (
                    <div className="px-5 pt-2 pb-5">
                      <div className="flex items-center gap-2 text-stone-500">
                        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                        <p className="mono-font text-xs tracking-wide">Proceed with formal chargeback filing — use Steps 01–04 above.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

        </>)}

        {/* ── Section 07 — Dispute Outcome Tracker ── */}
        <>
            <div className="section-divider" />
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="mono-font text-xs text-stone-500">{platformMode === 'merchant' ? '05' : '07'}</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Dispute Tracker</h2>
                <div className="flex items-center gap-3 ml-auto flex-wrap">
                  <span className="mono-font text-xs text-stone-400">{settings.trackerWindowDays || 60}-DAY WINDOW · {filteredTrackerOutcomes.length}{trackerFilter !== 'all' || trackerSearch ? ` / ${trackerOutcomes.length}` : ''} CASE{filteredTrackerOutcomes.length !== 1 ? 'S' : ''}</span>
                  <button onClick={() => setShowSettings(v => !v)} className={`mono-font text-[10px] tracking-widest px-2.5 py-1 border transition-colors ${showSettings ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700'}`}>
                    ⚙ THRESHOLDS
                  </button>
                </div>
              </div>

              {trackerOutcomes.length === 0 && (
                <div className="border border-dashed border-stone-300 py-10 text-center mt-6" style={{ background: '#FAF7F1' }}>
                  <p className="mono-font text-xs tracking-widest text-stone-400 mb-2">NO CASES LOGGED YET</p>
                  <p className="display-font text-stone-500 italic text-sm">Outcomes recorded in the Dispute Desk will appear here once logged.</p>
                </div>
              )}

              {/* ── Compliance thresholds panel ── */}
              {showSettings && (
                <div className="border border-stone-400 mb-5" style={{ background: '#FAF7F1' }}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200" style={{ background: '#EEE9E0' }}>
                    <span className="mono-font text-[9px] tracking-widest text-stone-600">COMPLIANCE THRESHOLDS — INSTITUTION CONFIGURATION</span>
                    <button onClick={resetSettings} className="mono-font text-[9px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">RESET DEFAULTS</button>
                  </div>
                  <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {[
                      { key: 'trackerWindowDays',    label: 'TRACKER WINDOW (DAYS)',    type: 'number', hint: 'Days of cases shown in tracker and home screen (default: 60)' },
                      { key: 'smallDollarThreshold', label: 'WRITE-OFF THRESHOLD ($)', type: 'number', hint: 'Disputes below this amount trigger a write-off recommendation instead of formal dispute filing' },
                      { key: 'sarThreshold',          label: 'SAR TRIGGER ($)',          type: 'number', hint: 'Fraud disputes at or above this amount display a SAR filing reminder' },
                      { key: 'fraudWindowDays',       label: 'FRAUD WINDOW (DAYS)',       type: 'number', hint: 'Filing window for fraud disputes (Visa/MC standard: 120 days from transaction)' },
                      { key: 'consumerWindowDays',    label: 'CONSUMER WINDOW (DAYS)',    type: 'number', hint: 'Filing window for consumer disputes (typically 120 days from expected delivery)' },
                      { key: 'absoluteCapDays',       label: 'ABSOLUTE CAP (DAYS)',       type: 'number', hint: 'Hard cap on any filing, regardless of reason code (Visa: 540 days from transaction)' },
                    ].map(({ key, label, type, hint }) => (
                      <div key={key}>
                        <label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">{label}</label>
                        <input
                          type={type}
                          value={settings[key]}
                          onChange={e => updateSetting(key, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                          className="input-field"
                          style={{ fontSize: '13px', padding: '7px 10px' }}
                        />
                        <p className="display-font text-[11px] text-stone-400 mt-1 leading-snug italic">{hint}</p>
                      </div>
                    ))}
                    <div>
                      <label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">PC MILESTONES (BUSINESS DAYS)</label>
                      <div className="flex gap-2">
                        {settings.pcMilestones.map((m, i) => (
                          <input key={i} type="number" value={m}
                            onChange={e => updateSetting('pcMilestones', settings.pcMilestones.map((v, j) => j === i ? parseInt(e.target.value) || v : v))}
                            className="input-field"
                            style={{ fontSize: '13px', padding: '7px 10px', textAlign: 'center' }}
                          />
                        ))}
                      </div>
                      <p className="display-font text-[11px] text-stone-400 mt-1 leading-snug italic">Three milestone deadlines (in business days) shown on the PC countdown row</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'TOTAL (60 DAYS)', value: trackerOutcomes.length,                         sub: 'cases analyzed'                            },
                  { label: 'IN PROGRESS',      value: inProgressCount,                               sub: `filed / representment / pre-arb`          },
                  { label: 'WIN RATE',         value: winRate !== null ? `${winRate}%` : '—',        sub: `${resolvedCount} resolved`                 },
                  { label: 'WON / LOST',       value: `${wonCount} / ${lostCount}`,                  sub: `${withdrawnCount} withdrawn`               },
                ].map(s => (
                  <div key={s.label} className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-xs tracking-widest text-stone-400 mb-1">{s.label}</div>
                    <div className="display-font font-semibold text-stone-900" style={{ fontSize: '22px', letterSpacing: '-0.02em' }}>{s.value}</div>
                    <div className="mono-font text-xs text-stone-400 mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* ── Analytics panel ── */}
              {analytics.resolvedCount >= 2 && (
                <div className="mb-5">
                  <button
                    onClick={() => setShowAnalytics(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 border border-stone-300 mono-font text-[10px] tracking-widest text-stone-500 hover:border-stone-500 transition-colors"
                    style={{ background: '#EEE9E0' }}
                  >
                    <span>OUTCOME ANALYTICS ({analytics.resolvedCount} RESOLVED CASES)</span>
                    <span>{showAnalytics ? '▲' : '▼'}</span>
                  </button>
                  {showAnalytics && (
                    <div className="border border-t-0 border-stone-300 p-4 space-y-5" style={{ background: '#FAF7F1' }}>

                      {/* Network breakdown */}
                      {Object.keys(analytics.byNetwork).length > 0 && (
                        <div>
                          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">WIN RATE BY NETWORK</div>
                          <div className="flex gap-6 flex-wrap">
                            {Object.entries(analytics.byNetwork).map(([net, d]) => {
                              const rate = Math.round(d.won / d.total * 100)
                              return (
                                <div key={net} className="flex items-center gap-3">
                                  <span className="mono-font text-xs text-stone-600 w-8">{net}</span>
                                  <div style={{ width: '120px', height: '6px', background: '#D4CCBC', borderRadius: '2px' }}>
                                    <div style={{ height: '100%', width: `${rate}%`, background: rate >= 60 ? '#064e3b' : rate >= 40 ? '#92400e' : '#7f1d1d', borderRadius: '2px', transition: 'width 0.4s' }} />
                                  </div>
                                  <span className="mono-font text-xs font-medium text-stone-800">{rate}%</span>
                                  <span className="mono-font text-[10px] text-stone-400">{d.won}/{d.total}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Reason code breakdown */}
                      {analytics.topCodes.length > 0 && (
                        <div>
                          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">WIN RATE BY REASON CODE (TOP {analytics.topCodes.length})</div>
                          <div className="space-y-2">
                            {analytics.topCodes.map(([code, d]) => {
                              const rate = Math.round(d.won / d.total * 100)
                              return (
                                <div key={code} className="flex items-center gap-3">
                                  <span className="mono-font text-[11px] text-stone-600 w-10 shrink-0">{code}</span>
                                  <div style={{ flex: 1, height: '6px', background: '#D4CCBC', borderRadius: '2px', maxWidth: '160px' }}>
                                    <div style={{ height: '100%', width: `${rate}%`, background: rate >= 60 ? '#064e3b' : rate >= 40 ? '#92400e' : '#7f1d1d', borderRadius: '2px', transition: 'width 0.4s' }} />
                                  </div>
                                  <span className="mono-font text-[11px] font-medium text-stone-800 w-8">{rate}%</span>
                                  <span className="mono-font text-[10px] text-stone-400">{d.won}W / {d.total - d.won}L</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Weekly filing trend */}
                      <div>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">WEEKLY FILING TREND (LAST 8 WEEKS)</div>
                        <div className="flex items-end gap-1.5">
                          {analytics.weeks.map((w, i) => {
                            const barH = w.total > 0 ? Math.max(8, Math.round(w.total / Math.max(...analytics.weeks.map(x => x.total), 1) * 48)) : 2
                            const isLast = i === analytics.weeks.length - 1
                            return (
                              <div key={w.label} className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
                                <div className="mono-font text-[8px] text-stone-400">{w.total > 0 ? w.total : ''}</div>
                                <div style={{ width: '100%', height: `${barH}px`, background: isLast ? '#1A1814' : '#D4CCBC', minHeight: '2px' }} />
                                <div className="mono-font text-[8px] text-stone-400">{w.label}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Summary row */}
                      <div className="flex flex-wrap gap-6 pt-2 border-t border-stone-200">
                        {analytics.avgDays !== null && (
                          <div>
                            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-0.5">AVG RESOLUTION</div>
                            <div className="display-font font-semibold text-stone-900" style={{ fontSize: '20px' }}>{analytics.avgDays} days</div>
                          </div>
                        )}
                        <div>
                          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-0.5">OVERALL WIN RATE</div>
                          <div className="display-font font-semibold text-stone-900" style={{ fontSize: '20px' }}>{winRate !== null ? `${winRate}%` : '—'}</div>
                        </div>
                        <div>
                          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-0.5">CASES RESOLVED</div>
                          <div className="display-font font-semibold text-stone-900" style={{ fontSize: '20px' }}>{analytics.resolvedCount}</div>
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              )}

              {/* Filter / search bar */}
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <div className="flex border border-stone-200 overflow-x-auto" style={{ borderRadius: 0, WebkitOverflowScrolling: 'touch' }}>
                  {[
                    { id: 'all',         label: 'ALL' },
                    { id: 'in_progress', label: 'IN PROGRESS' },
                    { id: 'won',         label: 'WON' },
                    { id: 'lost',        label: 'LOST' },
                    { id: 'fundable',    label: '★ FUNDABLE' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setTrackerFilter(tab.id)}
                      className={'mono-font text-[10px] tracking-widest px-3 py-1.5 transition-colors shrink-0 ' + (trackerFilter === tab.id ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-500 hover:bg-stone-100')}
                      title={tab.id === 'fundable' ? 'DFA grade A or B — cases eligible for dispute funding assessment' : undefined}
                    >{tab.label}</button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Search cases..."
                  value={trackerSearch}
                  onChange={e => setTrackerSearch(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '12px', padding: '6px 10px', flex: '1', minWidth: '160px', maxWidth: '280px' }}
                />
                {(trackerFilter !== 'all' || trackerSearch) && (
                  <button onClick={() => { setTrackerFilter('all'); setTrackerSearch('') }} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors tracking-widest">✕ CLEAR</button>
                )}
              </div>

              {/* Case table */}
              <div className="border border-stone-200 overflow-hidden" style={{ background: '#FAF7F1' }}>
                <div className="overflow-x-auto">
                  <div style={{ minWidth: '700px' }}>
                    {/* Header */}
                    {/* ── Deadline dashboard ── */}
                    {(() => {
                      const now = new Date()
                      const deadlines = trackerOutcomes
                        .filter(o => LIFECYCLE_IN_PROGRESS.has(o.status))
                        .flatMap(o => {
                          const entries = []
                          // Reg E PC deadline (10 BD)
                          if (o.provCreditDate) {
                            const pc10 = addBusinessDays(o.provCreditDate, settings.pcMilestones[0])
                            const daysLeft = Math.ceil((pc10 - now) / 86400000)
                            if (daysLeft <= 14) entries.push({ id: o.id, type: 'REG E PC', deadline: pc10.toLocaleDateString('en-CA'), daysLeft, merchant: o.merchant })
                          }
                          // Reg E investigation deadline (45 BD)
                          if (o.provCreditDate) {
                            const inv = addBusinessDays(o.provCreditDate, settings.pcMilestones[1])
                            const daysLeft = Math.ceil((inv - now) / 86400000)
                            if (daysLeft <= 21) entries.push({ id: o.id, type: 'REG E INV', deadline: inv.toLocaleDateString('en-CA'), daysLeft, merchant: o.merchant })
                          }
                          return entries
                        })
                        .sort((a, b) => a.daysLeft - b.daysLeft)
                      if (deadlines.length === 0) return null
                      return (
                        <div className="mb-4 border border-amber-700 bg-amber-50 p-4">
                          <div className="mono-font text-[10px] tracking-widest text-amber-900 mb-3">⚑ UPCOMING COMPLIANCE DEADLINES</div>
                          <div className="flex flex-wrap gap-3">
                            {deadlines.map((d, i) => (
                              <div key={i} className={"mono-font text-[10px] px-2 py-1.5 flex gap-2 items-center " + (d.daysLeft <= 3 ? 'bg-red-900 text-red-50' : d.daysLeft <= 7 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100')}>
                                <span>{d.type}</span>
                                <span className="font-bold">{d.merchant || d.id}</span>
                                <span>{d.deadline}</span>
                                <span>{d.daysLeft > 0 ? d.daysLeft + 'd' : d.daysLeft === 0 ? 'TODAY' : 'OVERDUE'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    <div className="grid px-4 py-2 border-b border-stone-300" style={{ gridTemplateColumns: '90px 60px 1fr 90px 1fr 44px 160px 80px', background: '#EEE9E0' }}>
                      {['CASE', 'DATE', 'MERCHANT', 'AMOUNT', 'REASON CODE', 'DFA', 'STATUS', ''].map(h => (
                        <span key={h} className="mono-font text-[10px] tracking-widest text-stone-500">{h}</span>
                      ))}
                    </div>
                    <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
                      {filteredTrackerOutcomes.length === 0 && trackerOutcomes.length > 0 && (
                        <div className="py-8 text-center border-b border-stone-100">
                          <p className="mono-font text-xs tracking-widest text-stone-400">NO CASES MATCH THIS FILTER</p>
                        </div>
                      )}
                      {filteredTrackerOutcomes.map(o => {
                        const [m0, m1, m2] = settings.pcMilestones
                        const pc10 = o.provCreditDate ? addBusinessDays(o.provCreditDate, m0) : null
                        const pc45 = o.provCreditDate ? addBusinessDays(o.provCreditDate, m1) : null
                        const pc90 = o.provCreditDate ? addBusinessDays(o.provCreditDate, m2) : null
                        const now  = new Date()
                        const isEditing = editingRow === o.id

                        return (
                          <div key={o.id} className="border-b border-stone-100">
                            {isEditing ? (
                              /* ── Edit mode ─────────────────────────────────── */
                              <div className="px-4 py-3 space-y-3" style={{ background: '#FDF9F3' }}>
                                <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">EDITING {o.id}</div>
                                <div className="grid gap-3 mob-1col" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                  <div>
                                    <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">MERCHANT</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.merchant || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, merchant: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">AMOUNT</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.amount || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, amount: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">REASON CODE</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.reasonCode || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, reasonCode: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">STATUS</label>
                                    <select
                                      className="input-field"
                                      value={o.status}
                                      onChange={e => markCaseOutcome(o.id, e.target.value)}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    >
                                      {o.mode === 'merchant' ? (<>
                                        <option value="pending">Chargeback received — preparing representment</option>
                                        <option value="filed">Representment filed — awaiting acquirer decision</option>
                                        <option value="representment">Acquirer responded — under review</option>
                                        <option value="won">Won — chargeback reversed</option>
                                        <option value="lost">Lost — chargeback upheld</option>
                                        <option value="withdrawn">Withdrawn</option>
                                      </>) : (<>
                                        <option value="pending">Pending — not yet filed</option>
                                        <option value="filed">Filed — submitted to network</option>
                                        <option value="representment">Representment received — merchant responded</option>
                                        <option value="pre_arb">Pre-arb filed — awaiting decision</option>
                                        <option value="won">Won</option>
                                        <option value="lost">Lost</option>
                                        <option value="withdrawn">Withdrawn</option>
                                      </>)}
                                    </select>
                                  </div>
                                </div>
                                {o.mode === 'merchant' && (
                                  <div className="grid gap-3 mob-1col" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                    <div>
                                      <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">DATE SUBMITTED TO ACQUIRER</label>
                                      <input type="date" className="input-field" value={editDraft.submitDate || ''}
                                        onChange={e => setEditDraft(d => ({ ...d, submitDate: e.target.value }))}
                                        style={{ fontSize: '13px', padding: '8px 10px' }}
                                      />
                                    </div>
                                    <div>
                                      <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">ACQUIRER REFERENCE #</label>
                                      <input className="input-field" value={editDraft.trackingRef || ''}
                                        onChange={e => setEditDraft(d => ({ ...d, trackingRef: e.target.value }))}
                                        placeholder="e.g. ACQ-2024-88341"
                                        style={{ fontSize: '13px', padding: '8px 10px' }}
                                      />
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <label className="mono-font text-[9px] tracking-widest text-stone-400 block mb-1">NOTES</label>
                                  <input
                                    className="input-field"
                                    value={editDraft.notes || ''}
                                    onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                                    placeholder="Optional case notes..."
                                    style={{ fontSize: '13px', padding: '8px 10px' }}
                                  />
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button onClick={() => saveEdit(o.id)} className="mono-font text-[10px] tracking-widest px-3 py-1.5 bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors">SAVE</button>
                                  <button onClick={cancelEdit} className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-stone-300 text-stone-500 hover:border-stone-500 transition-colors">CANCEL</button>
                                  <button onClick={() => deleteCase(o.id)} className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-red-300 text-red-600 hover:bg-red-50 transition-colors ml-auto">DELETE CASE</button>
                                </div>
                              </div>
                            ) : (
                              /* ── View mode ─────────────────────────────────── */
                              <div className="grid px-4 py-3 items-center" style={{ gridTemplateColumns: '90px 60px 1fr 90px 1fr 44px 160px 80px' }}>
                                <button
                                  onClick={() => setCase360Id(prev => prev === o.id ? null : o.id)}
                                  className="mono-font text-xs text-stone-400 hover:text-stone-900 transition-colors text-left"
                                  title="Toggle case 360 view"
                                >{o.id}</button>
                                <span className="mono-font text-xs text-stone-500">{new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <span className="display-font text-sm text-stone-700 truncate pr-2">{o.merchant}</span>
                                <span className="mono-font text-xs text-stone-600">{o.amount}</span>
                                <div className="pr-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="mono-font text-xs text-stone-600">{o.reasonCode}</span>
                                    {o.mode === 'merchant' && o.winProb && (
                                      <span className={'mono-font text-[8px] tracking-widest px-1.5 py-0.5 ' + (o.winProb === 'HIGH' ? 'bg-emerald-900 text-emerald-50' : o.winProb === 'LOW' ? 'bg-red-900 text-red-50' : 'bg-amber-800 text-amber-50')}>{o.winProb}</span>
                                    )}
                                  </div>
                                  {o.notes && <p className="display-font text-[11px] text-stone-400 truncate mt-0.5 italic">{o.notes}</p>}
                                  {o.mode === 'merchant' && o.submitDate && (
                                    <p className="mono-font text-[10px] text-emerald-700 mt-0.5">
                                      REPMT FILED {new Date(o.submitDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                                      {o.trackingRef && <> · {o.trackingRef}</>}
                                    </p>
                                  )}
                                  {/* SAR flag — FI mode, fraud cases above threshold */}
                                  {o.mode !== 'merchant' && (() => {
                                    const amtNum = parseFloat((o.amount||'').replace(/[^0-9.]/g,''))
                                    const isFraudLike = (o.classification||'').includes('FRAUD') || (o.reasonCode||'').match(/10\.[0-9]|4853|UA/)
                                    if (!isFraudLike || !(amtNum >= settings.sarThreshold)) return null
                                    return <p className="mono-font text-[10px] text-red-700 mt-0.5 font-bold">⚠ SAR REVIEW</p>
                                  })()}
                                </div>
                                {/* DFA grade badge — FI only; merchant rows show winProb badge in reason cell */}
                                {o.mode !== 'merchant' ? (() => {
                                  const dfaG = estimateFundingGrade(o.reasonCode, o.amount, { threeDSStatus: o.threeDSStatus, deliveryConfirmed: o.deliveryConfirmed, liabilityShift: o.liabilityShift, refundPolicyShown: o.refundPolicyShown, priorOrders: o.priorOrders, winProb: o.winProb, confidence: o.confidence })
                                  return dfaG
                                    ? <span className={`mono-font text-[10px] font-bold px-1.5 py-0.5 ${dfaG.bg} ${dfaG.text} justify-self-start`} title={`Estimated DFA funding grade — ${dfaG.label} based on reason code and amount. Open DFA for full underwriting.`}>{dfaG.label}</span>
                                    : <span className="text-stone-300 mono-font text-[10px]">—</span>
                                })() : <span className="text-stone-300 mono-font text-[10px]">—</span>}
                                <div className="flex gap-1 flex-wrap items-center">
                                  {/* ── Lifecycle stage buttons ───────────────── */}
                                  {o.status === 'pending' && (
                                    <>
                                      <button onClick={() => advanceStage(o.id, 'filed')} title={o.mode === 'merchant' ? 'File representment with acquirer' : 'Mark as filed with network'} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-600 text-stone-600 hover:bg-stone-100 transition-colors">{o.mode === 'merchant' ? 'SEND REPMT' : 'FILED'}</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'won')} className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors">WON</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'lost')} className="mono-font text-[10px] px-1.5 py-0.5 border border-red-700 text-red-700 hover:bg-red-50 transition-colors">LOST</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'withdrawn')} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-100 transition-colors">WD</button>
                                    </>
                                  )}
                                  {o.status === 'filed' && (
                                    <>
                                      <span className="mono-font text-[10px] px-1.5 py-0.5 bg-stone-700 text-stone-50">{o.mode === 'merchant' ? 'REPMT FILED' : 'FILED'}</span>
                                      <button onClick={() => advanceStage(o.id, 'representment')} title={o.mode === 'merchant' ? 'Acquirer responded to representment' : 'Merchant representment received'} className="mono-font text-[10px] px-1.5 py-0.5 border border-amber-700 text-amber-700 hover:bg-amber-50 transition-colors">{o.mode === 'merchant' ? 'ACQ RESP' : 'REPMT'}</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'won')} className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors">WON</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'lost')} className="mono-font text-[10px] px-1.5 py-0.5 border border-red-700 text-red-700 hover:bg-red-50 transition-colors">LOST</button>
                                      <button onClick={() => revertCase(o.id)} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors px-1" title="Revert">↩</button>
                                    </>
                                  )}
                                  {o.status === 'representment' && (
                                    <>
                                      <span className="mono-font text-[10px] px-1.5 py-0.5 bg-amber-800 text-amber-50">{o.mode === 'merchant' ? 'ACQ RESPONDED' : "REPMT RCV'D"}</span>
                                      {o.mode !== 'merchant' && <button onClick={() => {
                                        const amtNum = parseFloat((o.amount || '').replace(/[^0-9.]/g, ''))
                                        const arbFee = (o.network || '').toLowerCase().includes('visa') ? 500 : 200
                                        if (!isNaN(amtNum) && amtNum < arbFee) {
                                          if (!window.confirm('⚠ Arb fee warning: dispute amount (' + (o.amount || '?') + ') is less than the ' + (o.network || 'network') + ' arbitration fee (~$' + arbFee + '). Escalating to pre-arb will cost more than the dispute value. Proceed anyway?')) return
                                        }
                                        advanceStage(o.id, 'pre_arb')
                                      }} title="File pre-arbitration" className="mono-font text-[10px] px-1.5 py-0.5 border border-purple-700 text-purple-700 hover:bg-purple-50 transition-colors">PRE-ARB</button>}
                                      {o.mode !== 'merchant' && <button onClick={() => generatePreArbDraft(o)} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-600 text-stone-600 hover:bg-stone-50 transition-colors">DRAFT PRE-ARB</button>}
                                      <button onClick={() => markCaseOutcome(o.id, 'won')} className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors">WON</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'lost')} className="mono-font text-[10px] px-1.5 py-0.5 border border-red-700 text-red-700 hover:bg-red-50 transition-colors">LOST</button>
                                      <button onClick={() => revertCase(o.id)} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors px-1" title="Revert">↩</button>
                                    </>
                                  )}
                                  {o.status === 'pre_arb' && (
                                    <>
                                      {o.mode !== 'merchant' && <span className="mono-font text-[10px] px-1.5 py-0.5 bg-purple-900 text-purple-50">PRE-ARB FILED</span>}
                                      {o.mode !== 'merchant' && <button onClick={() => generatePreArbDraft(o)} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-600 text-stone-600 hover:bg-stone-50 transition-colors">DRAFT PRE-ARB</button>}
                                      <button onClick={() => markCaseOutcome(o.id, 'won')} className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors">WON</button>
                                      <button onClick={() => markCaseOutcome(o.id, 'lost')} className="mono-font text-[10px] px-1.5 py-0.5 border border-red-700 text-red-700 hover:bg-red-50 transition-colors">LOST</button>
                                      <button onClick={() => revertCase(o.id)} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors px-1" title="Revert">↩</button>
                                    </>
                                  )}
                                  {(o.status === 'won' || o.status === 'lost' || o.status === 'withdrawn') && (
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className={`mono-font text-[10px] px-1.5 py-0.5 ${o.status === 'won' ? 'bg-emerald-900 text-emerald-50' : o.status === 'lost' ? 'bg-red-900 text-red-50' : 'bg-stone-600 text-stone-50'}`}>
                                        {o.status.toUpperCase()}
                                      </span>
                                      {/* Escalation — post-loss paths */}
                                      {o.status === 'lost' && o.mode !== 'merchant' && (
                                        <>
                                          {o.escalation === 'lea_referral'
                                            ? <span className="mono-font text-[10px] px-1.5 py-0.5 bg-orange-900 text-orange-50" title="Referred to Law Enforcement">LEA ✓</span>
                                            : <button onClick={() => escalateCase(o.id, 'lea_referral')} className="mono-font text-[10px] px-1.5 py-0.5 border border-orange-700 text-orange-700 hover:bg-orange-50 transition-colors" title="Refer to law enforcement agency">LEA</button>
                                          }
                                          {o.escalation === 'writeoff'
                                            ? <span className="mono-font text-[10px] px-1.5 py-0.5 bg-stone-700 text-stone-200" title="Written off">W/O ✓</span>
                                            : <button onClick={() => escalateCase(o.id, 'writeoff')} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-500 text-stone-500 hover:bg-stone-100 transition-colors" title="Mark as written off">W/O</button>
                                          }
                                        </>
                                      )}
                                      <button onClick={() => revertCase(o.id)} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors px-1" title="Re-mark">↩</button>
                                    </div>
                                  )}
                                  {/* PC button — FI only (Reg E is issuer obligation) */}
                                  {o.mode !== 'merchant' && !o.provCreditDate && o.status !== 'withdrawn' && (
                                    <button onClick={() => markProvCredit(o.id)} className="mono-font text-[10px] px-1.5 py-0.5 border border-blue-700 text-blue-700 hover:bg-blue-50 transition-colors">PC</button>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 justify-end">
                                  {o.mode !== 'merchant' && onScoreInDfa && (
                                    <button
                                      onClick={() => onScoreInDfa([{
                                        ...o,
                                        code: parseFloat((o.reasonCode || '').replace(/[^0-9.]/g, '')) || 0,
                                        filedDaysAgo: Math.max(0, Math.round((Date.now() - new Date(o.date)) / 86400000)),
                                        windowDays: 45,
                                        avsMismatch: false, no3DS: !o.threeDSStatus || o.threeDSStatus === 'none',
                                        deliveryConf: !!o.deliveryConfirmed, merchantAck: false,
                                        pinVerified: false, isVFMP: false,
                                        strongDocs: (o.confidence === 'HIGH' || o.winProb === 'HIGH'),
                                        merchantCBR: 0.5, priorClaims: 0,
                                        note: `From Dispute Desk: ${o.merchant || ''}`,
                                        source: 'desk',
                                      }])}
                                      className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors"
                                      title="Send to DFA for funding assessment"
                                    >→DFA</button>
                                  )}
                                  <button onClick={() => startEdit(o)} className="text-stone-500 hover:text-stone-900 transition-colors" title="Edit row"><Pencil className="w-3.5 h-3.5" /></button>
                                </div>
                              </div>
                            )}

                            {/* Provisional credit deadline row */}
                            {!isEditing && o.provCreditDate && o.mode !== 'merchant' && (
                              <div className="px-4 pb-2 flex items-center gap-4 flex-wrap" style={{ background: '#EEF2FF' }}>
                                <span className="mono-font text-[10px] text-blue-800 tracking-wider">PC LOGGED: {new Date(o.provCreditDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <button
                                  onClick={() => markPcIssued(o.id)}
                                  className={`mono-font text-[10px] px-1.5 py-0.5 transition-colors ${o.pcIssued ? 'bg-blue-800 text-blue-50' : 'border border-blue-600 text-blue-600 hover:bg-blue-50'}`}
                                  title={o.pcIssued ? 'Provisional credit confirmed as issued to customer' : 'Confirm provisional credit has been physically disbursed to customer'}
                                >
                                  {o.pcIssued ? 'CREDIT ISSUED ✓' : 'MARK ISSUED'}
                                </button>
                                {[{ label: `${m0}BD`, date: pc10 }, { label: `${m1}BD`, date: pc45 }, { label: `${m2}BD`, date: pc90 }].map(({ label, date }) => {
                                  if (!date) return null
                                  const d = daysUntil(date)
                                  const past = d !== null && d < 0
                                  const urgent = !past && d !== null && d <= 5
                                  const warning = !past && !urgent && d !== null && d <= 14
                                  const cls = past ? 'text-red-700 font-bold' : urgent ? 'text-red-600 font-bold' : warning ? 'text-amber-700' : 'text-blue-600'
                                  const badge = past ? '⚠ PAST' : d !== null ? `(${d}d)` : ''
                                  return (
                                    <span key={label} className={`mono-font text-[10px] tracking-wider ${cls}`}>
                                      {label}: {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {badge}
                                    </span>
                                  )
                                })}
                              </div>
                            )}

                            {/* 360 panel — full case detail */}
                            {case360Id === o.id && (
                              <div className="px-4 py-3 border-t border-stone-200" style={{ background: '#F5F1EA' }}>
                                <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">CASE 360 — {o.id}</div>
                                <div className="grid gap-x-6 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                                  {[
                                    ['MERCHANT',    o.merchant],
                                    ['AMOUNT',      o.amount],
                                    ['NETWORK',     o.network],
                                    ['REASON CODE', o.reasonCode],
                                    ['DATE FILED',  o.date ? new Date(o.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['STATUS',      (o.status || '').toUpperCase()],
                                    ['RESOLVED',    o.resolvedDate ? new Date(o.resolvedDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['MODE',        (o.mode || 'fi').toUpperCase()],
                                    ['PC DATE',     o.provCreditDate ? new Date(o.provCreditDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['PC ISSUED',   o.pcIssued ? 'YES ✓' : '—'],
                                    ['ESCALATION',  o.escalation ? o.escalation.replace('_',' ').toUpperCase() : '—'],
                                    ['DFA GRADE',   (() => { const g = estimateFundingGrade(o.reasonCode, o.amount, o); return g ? g.label : '—' })()],
                                    ['TRIAGE CLASS', (o.classification || '—').replace(/_/g,' ')],
                                    ['REPMT FILED',  o.submitDate ? new Date(o.submitDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['ACQ REF #',    o.trackingRef || '—'],
                                    ['CONFIDENCE',  o.confidence || '—'],
                                  ].map(([label, val]) => (
                                    <div key={label}>
                                      <div className="mono-font text-[9px] tracking-widest text-stone-400">{label}</div>
                                      <div className="mono-font text-xs text-stone-700 mt-0.5">{val || '—'}</div>
                                    </div>
                                  ))}
                                </div>
                                {o.notes && (
                                  <div className="mt-3 pt-3 border-t border-stone-200">
                                    <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1">NOTES</div>
                                    <div className="display-font text-sm text-stone-600 italic">{o.notes}</div>
                                  </div>
                                )}
                                <button onClick={() => setCase360Id(null)} className="mono-font text-[9px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors mt-3">✕ CLOSE 360</button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                <button
                  onClick={() => { if (window.confirm('Clear all tracked cases?')) setOutcomes([]) }}
                  className="mono-font text-xs tracking-widest text-stone-400 hover:text-stone-600 transition-colors"
                >CLEAR LOG</button>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => exportDFACSV(trackerOutcomes)}
                    className="flex items-center gap-2 mono-font text-xs tracking-widest text-emerald-800 hover:text-emerald-900 border border-emerald-700 px-3 py-2 hover:bg-emerald-50 transition-colors"
                    style={{ background: '#FAF7F1' }}
                    title="Export pending cases as a DFA-ready CSV — upload directly to the Dispute Funding Assessor"
                  >
                    <Download className="w-3.5 h-3.5" />
                    EXPORT TO DFA
                  </button>
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-2 mono-font text-xs tracking-widest text-stone-700 hover:text-stone-900 border border-stone-300 px-3 py-2 hover:border-stone-500 transition-colors"
                    style={{ background: '#FAF7F1' }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    EXPORT CSV
                  </button>
                </div>
              </div>
            </div>
        </>

        {/* ── Pre-arb draft panel ── */}
        {(preArbDraft || preArbLoading || preArbError) && (
          <>
            <div className="section-divider" />
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="mono-font text-xs text-stone-500 mb-1">PRE-ARBITRATION RESPONSE DRAFTER</div>
                  <div className="display-font font-semibold text-xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>
                    {preArbTargetId && 'Case ' + preArbTargetId}
                  </div>
                </div>
                <button onClick={() => { setPreArbDraft(null); setPreArbError(null); setPreArbTargetId(null) }}
                  className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors tracking-widest">✕ CLOSE</button>
              </div>

              {preArbLoading && (
                <div className="border border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <Loader2 className="w-6 h-6 text-stone-600 mx-auto mb-2 animate-spin" />
                  <p className="display-font text-stone-600 italic text-sm">Drafting pre-arbitration rebuttal…</p>
                </div>
              )}
              {preArbError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <span className="display-font text-sm text-red-900">{preArbError}</span>
                </div>
              )}

              {preArbDraft && (
                <div className="space-y-5">
                  {/* Summary + win assessment */}
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="flex-1 min-w-0 border border-stone-300 p-4" style={{ background: '#FAF7F1' }}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">POSITION SUMMARY</div>
                      <p className="display-font text-stone-800 text-[14px] leading-relaxed">{preArbDraft.summary}</p>
                    </div>
                    <div className="border border-stone-300 p-4 text-center shrink-0" style={{ background: '#FAF7F1', minWidth: '130px' }}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">WIN ASSESSMENT</div>
                      <div className={"mono-font text-sm font-bold px-2 py-1 " + (preArbDraft.win_assessment === 'STRONG' ? 'bg-emerald-900 text-emerald-50' : preArbDraft.win_assessment === 'MODERATE' ? 'bg-amber-800 text-amber-50' : 'bg-red-900 text-red-50')}>
                        {preArbDraft.win_assessment}
                      </div>
                      <p className="display-font text-stone-500 text-[12px] mt-2 leading-snug">{preArbDraft.win_note}</p>
                    </div>
                  </div>

                  {/* Rebuttal points */}
                  <div className="border-l-4 border-stone-900 bg-stone-50 p-5">
                    <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-3">REBUTTAL POINTS</div>
                    <div className="space-y-2">
                      {preArbDraft.rebuttal_points?.map((pt, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 leading-snug">
                          <span className="mono-font text-[11px] text-stone-500 shrink-0 mt-0.5">{i+1}.</span>
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Evidence to attach */}
                  <div className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">EVIDENCE TO ATTACH</div>
                    <div className="flex flex-wrap gap-2">
                      {preArbDraft.evidence_to_attach?.map((e, i) => (
                        <span key={i} className="mono-font text-[10px] px-2 py-1 border border-stone-300 text-stone-700">{e}</span>
                      ))}
                    </div>
                  </div>

                  {/* Formal statement */}
                  <div className="border border-stone-900">
                    <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
                      <div className="mono-font text-[10px] tracking-widest text-stone-400">FORMAL PRE-ARB STATEMENT</div>
                      <button onClick={() => { navigator.clipboard.writeText(preArbDraft.formal_statement || ''); setPreArbCopied(true); setTimeout(() => setPreArbCopied(false), 2000) }}
                        className="mono-font text-[10px] flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors">
                        {preArbCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                      </button>
                    </div>
                    <div className="bg-white p-5">
                      {(preArbDraft.formal_statement || '').split('\n\n').map((para, i) => (
                        <p key={i} className={"display-font text-stone-800 text-[14px] leading-relaxed " + (i > 0 ? 'mt-3' : '')}>{para}</p>
                      ))}
                    </div>
                  </div>

                  {preArbDraft.filing_deadline_note && (
                    <div className="mono-font text-[11px] text-amber-800 tracking-wide">⚠ {preArbDraft.filing_deadline_note}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {platformMode === 'merchant' && (
          <>
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">06</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Chargeback Ratio Monitor</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-4 ml-7">Network monitoring thresholds. Dispute count and volume are auto-filled from your tracker — enter total monthly transactions to compute your CBR.</p>

              {/* CBR inputs */}
              <div className="border border-stone-300 p-4 mb-6" style={{ background: '#EEE9E0' }}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="input-label">DISPUTES THIS MONTH</label>
                    <input type="number" value={mchCbDisputes !== '' ? mchCbDisputes : String(autoMchCount)} onChange={e => setMchCbDisputes(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                  </div>
                  <div>
                    <label className="input-label">TOTAL TXNS THIS MONTH</label>
                    <input type="number" value={mchCbTransactions} onChange={e => setMchCbTransactions(e.target.value)} placeholder="enter total" className="input-field mono-font" style={{ fontSize: '13px' }} />
                    <div className="mono-font text-[9px] text-stone-400 mt-1">required to calculate CBR%</div>
                  </div>
                  <div>
                    <label className="input-label">DISPUTE VOLUME ($)</label>
                    <input type="number" value={mchCbAmount !== '' ? mchCbAmount : String(autoMchAmt)} onChange={e => setMchCbAmount(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                  </div>
                </div>
                {!mchCbTransactions && (
                  <div className="mono-font text-[10px] text-stone-500 mt-3">↑ Enter your total monthly transaction count above to compute CBR% and check thresholds.</div>
                )}
                {cbrPct !== null && (
                  <div className={'mono-font text-xs px-3 py-2 mt-3 flex flex-wrap items-center gap-3 ' + (visaVdmpBreach || mcMdmpBreach ? 'bg-red-900 text-red-50' : visaVdmpWarn || mcMdmpWarn ? 'bg-amber-800 text-amber-50' : 'bg-emerald-900 text-emerald-50')}>
                    <span className="font-bold">CBR: {cbrPct.toFixed(3)}%</span>
                    {visaVdmpBreach && <span>VISA VDMP BREACH — {cbrPct.toFixed(2)}% above 0.90%</span>}
                    {!visaVdmpBreach && visaVdmpWarn && <span>Approaching VISA VDMP ({cbrPct.toFixed(2)}%)</span>}
                    {mcMdmpBreach && <span>MC MDMP BREACH — {cbrPct.toFixed(2)}% above 1.50%</span>}
                    {!mcMdmpBreach && mcMdmpWarn && <span>Approaching MC MDMP ({cbrPct.toFixed(2)}%)</span>}
                    {!visaVdmpBreach && !visaVdmpWarn && !mcMdmpBreach && !mcMdmpWarn && <span>Within network thresholds</span>}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className={'border-2 p-5 ' + (visaVdmpBreach ? 'border-red-700 bg-red-50' : visaVdmpWarn ? 'border-amber-600 bg-amber-50' : 'border-stone-300 bg-stone-50')}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-600 mb-1">VISA VDMP</div>
                      <div className="display-font font-semibold text-stone-900">Visa Dispute Monitoring Programme</div>
                    </div>
                    <span className={'mono-font text-[10px] px-2 py-1 ' + (visaVdmpBreach ? 'bg-red-900 text-red-50' : visaVdmpWarn ? 'bg-amber-800 text-amber-50' : 'bg-emerald-900 text-emerald-50')}>
                      {visaVdmpBreach ? 'BREACH' : visaVdmpWarn ? 'WARNING' : 'OK'}
                    </span>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between"><span className="mono-font text-[11px] text-stone-500">THRESHOLD</span><span className="mono-font text-[11px] text-stone-700">≥ 0.90% CBR AND ≥ $75,000</span></div>
                    <div className="flex items-center justify-between"><span className="mono-font text-[11px] text-stone-500">YOUR CBR</span><span className={'mono-font text-sm font-bold ' + (visaVdmpBreach ? 'text-red-800' : visaVdmpWarn ? 'text-amber-800' : 'text-emerald-800')}>{cbrPct !== null ? cbrPct.toFixed(3) + '%' : '—'}</span></div>
                    <div className="flex items-center justify-between"><span className="mono-font text-[11px] text-stone-500">DISPUTE VOLUME</span><span className={'mono-font text-[11px] font-bold ' + (cbrAmtNum >= 75000 ? 'text-red-700' : 'text-stone-700')}>${cbrAmtNum.toLocaleString()}</span></div>
                  </div>
                  <div style={{ height: '6px', background: '#D4CCBC', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: Math.min(cbrPct / 1.5 * 100, 100) + '%', background: visaVdmpBreach ? '#991b1b' : visaVdmpWarn ? '#92400e' : '#064e3b', borderRadius: '2px', transition: 'width 0.4s' }} />
                  </div>
                  <div className={'mt-3 display-font text-[13px] leading-snug ' + (visaVdmpBreach ? 'text-red-800' : visaVdmpWarn ? 'text-amber-800' : 'text-emerald-800')}>
                    {visaVdmpBreach ? 'Breach. Expect fines from $50/month escalating to $25,000/month. MID termination risk after 12 months.' : visaVdmpWarn ? 'Approaching VDMP. If dispute volume also reaches $75k you will be enrolled. Review top dispute codes now.' : 'Within Visa VDMP thresholds. Next threshold: 0.90% CBR + $75k volume.'}
                  </div>
                </div>
                <div className={'border-2 p-5 ' + (mcMdmpBreach ? 'border-red-700 bg-red-50' : mcMdmpWarn ? 'border-amber-600 bg-amber-50' : 'border-stone-300 bg-stone-50')}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-600 mb-1">MC MDMP</div>
                      <div className="display-font font-semibold text-stone-900">Mastercard Dispute Monitoring Programme</div>
                    </div>
                    <span className={'mono-font text-[10px] px-2 py-1 ' + (mcMdmpBreach ? 'bg-red-900 text-red-50' : mcMdmpWarn ? 'bg-amber-800 text-amber-50' : 'bg-emerald-900 text-emerald-50')}>
                      {mcMdmpBreach ? 'BREACH' : mcMdmpWarn ? 'WARNING' : 'OK'}
                    </span>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between"><span className="mono-font text-[11px] text-stone-500">THRESHOLD</span><span className="mono-font text-[11px] text-stone-700">≥ 1.50% CBR AND ≥ $1,000</span></div>
                    <div className="flex items-center justify-between"><span className="mono-font text-[11px] text-stone-500">YOUR CBR</span><span className={'mono-font text-sm font-bold ' + (mcMdmpBreach ? 'text-red-800' : mcMdmpWarn ? 'text-amber-800' : 'text-emerald-800')}>{cbrPct !== null ? cbrPct.toFixed(3) + '%' : '—'}</span></div>
                    <div className="flex items-center justify-between"><span className="mono-font text-[11px] text-stone-500">DISPUTE VOLUME</span><span className={'mono-font text-[11px] font-bold ' + (cbrAmtNum >= 1000 ? 'text-stone-800' : 'text-stone-500')}>${cbrAmtNum.toLocaleString()}</span></div>
                  </div>
                  <div style={{ height: '6px', background: '#D4CCBC', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: Math.min(cbrPct / 2.5 * 100, 100) + '%', background: mcMdmpBreach ? '#991b1b' : mcMdmpWarn ? '#92400e' : '#064e3b', borderRadius: '2px', transition: 'width 0.4s' }} />
                  </div>
                  <div className={'mt-3 display-font text-[13px] leading-snug ' + (mcMdmpBreach ? 'text-red-800' : mcMdmpWarn ? 'text-amber-800' : 'text-emerald-800')}>
                    {mcMdmpBreach ? 'Breach. Fines start at $100/month. Termination risk after 3 months. Mastercard threshold is lower than Visa — hits SMBs faster.' : mcMdmpWarn ? 'Approaching MC MDMP. Remediate by reducing disputes or increasing transaction volume.' : 'Within Mastercard MDMP thresholds. Next: 1.50% CBR + $1,000 dispute volume.'}
                  </div>
                </div>
              </div>
              <div className="mt-4 border border-stone-200 p-4 bg-stone-50">
                <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">MONITORING PROGRAM PENALTIES</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 display-font text-[13px] text-stone-600" style={{ lineHeight: '1.5' }}>
                  <div><strong className="text-stone-800">Visa VDMP</strong> — $50/month (months 1–4), escalating to $25,000/month (month 10+). MID termination risk after 12 months without remediation.</div>
                  <div><strong className="text-stone-800">MC MDMP</strong> — $100/month + $1,000 per dispute exceeding threshold (months 1–2), escalating from month 3. Termination review at month 3.</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Footer ── */}
        <div className="section-divider" />
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between text-stone-600 gap-2">
          <div className="mono-font text-xs tracking-widest">BUILT BY ADEOTI FASHOKUN — RISK &amp; TRUST OPERATIONS</div>
          <div className="display-font italic text-sm">"Disputes resolve faster when the framework is written down."</div>
        </div>
      </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 003 DFA — MODULE-LEVEL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Alias so DFA internals resolve correctly ────────────────────────
const BASE_WIN_RATES = DFA_BASE_WIN

const CODE_LABELS = {
  // Visa Fraud
  "10.1": "EMV Counterfeit Fraud",       "10.2": "EMV Lost/Stolen Fraud",
  "10.3": "Card-Present Fraud",           "10.4": "Card-Absent (CNP) Fraud",
  "10.5": "Visa Fraud Monitoring Program",
  // Visa Authorization
  "11.1": "Card Recovery Bulletin",       "11.2": "Declined Authorization",
  "11.3": "No Authorization",
  // Visa Processing Errors
  "12.1": "Late Presentment",             "12.2": "Incorrect Transaction Code",
  "12.3": "Incorrect Currency",           "12.4": "Incorrect Account Number",
  "12.5": "Incorrect Amount",             "12.6": "Duplicate / Paid by Other Means",
  "12.6.1": "Duplicate Processing",       "12.6.2": "Paid by Other Means",
  "12.7": "Invalid Data",
  // Visa Consumer Disputes
  "13.1": "Merchandise Not Received",     "13.2": "Cancelled Recurring",
  "13.3": "Not as Described / Defective", "13.4": "Counterfeit Merchandise",
  "13.5": "Misrepresentation",            "13.6": "Credit Not Processed",
  "13.7": "Cancelled Merchandise",        "13.8": "Original Credit Not Accepted",
  "13.9": "Non-Receipt of Cash/Load",
  // MC Fraud
  "4837": "No Cardholder Authorization",  "4840": "Fraudulent Processing",
  "4849": "Questionable Merchant Activity","4863": "Cardholder Does Not Recognize",
  "4870": "Chip Liability Shift",         "4871": "Chip/PIN Liability Shift",
  // MC Authorization
  "4808": "Authorization Chargeback",     "4812": "Account Not on File",
  "4847": "Authorization Not Obtained",
  // MC Processing Errors
  "4831": "Transaction Amount Differs",   "4834": "Duplicate Processing",
  "4835": "Card Not Valid or Expired",    "4842": "Late Presentment",
  "4846": "Incorrect Currency",
  // MC Consumer Disputes
  "4841": "Cancelled Recurring/Digital Goods","4850": "Installment Billing Dispute",
  "4853": "Defective / Not as Described", "4854": "Cardholder Dispute — NEC",
  "4855": "Goods or Services Not Provided","4859": "Services Not Rendered",
  "4860": "Credit Not Processed",         "4999": "Domestic Chargeback",
}


// ─── Sample portfolio (~$100k face, 20 claims, Visa + MC) ─────────────────────
const CLAIMS_DATA = [
  { id:"DSP-001", code:"10.4", amount:4200,  filedDaysAgo:10, windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.2, priorClaims:0, source:"sample", note:"No 3DS, AVS mismatch on shipping address. Clean account history. Strong CNP fraud pattern — issuer holds the stronger hand." },
  { id:"DSP-002", code:"13.1", amount:2800,  filedDaysAgo:25, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:true,  merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.4, priorClaims:1, source:"sample", note:"Delivery confirmation on file. Low-CBR merchant will representment aggressively. One prior dispute on account reduces confidence." },
  { id:"DSP-003", code:"10.5", amount:18500, filedDaysAgo:5,  windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:true,  strongDocs:false, merchantCBR:2.8, priorClaims:0, source:"sample", note:"VFMP-enrolled merchant — near-automatic liability shift. High merchant CBR confirms systemic fraud pattern. Anchor receivable in portfolio." },
  { id:"DSP-004", code:"13.3", amount:1200,  filedDaysAgo:40, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.6, priorClaims:2, source:"sample", note:"Subjective quality dispute with no supporting documentation. Two prior claims on account is a significant red flag." },
  { id:"DSP-005", code:"10.2", amount:5800,  filedDaysAgo:15, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:true,  isVFMP:false, strongDocs:false, merchantCBR:0.8, priorClaims:0, source:"sample", note:"Chip + PIN transaction. PIN verification shifts liability back to the issuer — near-automatic loss at representment." },
  { id:"DSP-006", code:"13.6", amount:3600,  filedDaysAgo:20, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:true,  pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.5, priorClaims:0, source:"sample", note:"Merchant acknowledged credit owed in writing. Strong paper trail. Near-certain win — merchant acknowledgement rarely survives representment." },
  { id:"DSP-007", code:"10.4", amount:750,   filedDaysAgo:50, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.9, priorClaims:1, source:"sample", note:"Small dollar at 70-day mark. Limited fraud evidence and one prior claim. Marginal — funder overhead may exceed expected return." },
  { id:"DSP-008", code:"13.5", amount:8200,  filedDaysAgo:8,  windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.7, priorClaims:0, source:"sample", note:"Strong documentary evidence — screenshots of merchant listing vs. item received. Early in window, clean account history." },
  { id:"DSP-009", code:"10.1", amount:11000, filedDaysAgo:12, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.1, priorClaims:0, source:"sample", note:"High-value chip fraud at POS — merchant ran magnetic stripe on chip-capable terminal. Liability shifts cleanly to merchant under 10.1." },
  { id:"DSP-010", code:"13.1", amount:3200,  filedDaysAgo:18, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.7, priorClaims:0, source:"sample", note:"Cardholder documented non-receipt in writing. No delivery confirmation from merchant. Clean account history. Solid 13.1 position." },
  { id:"DSP-011", code:"10.4", amount:5800,  filedDaysAgo:8,  windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.8, priorClaims:0, source:"sample", note:"Classic CNP pattern — mismatch on billing and shipping, no 3DS, high-CBR merchant. Early in window with clean account history." },
  { id:"DSP-012", code:"13.7", amount:2100,  filedDaysAgo:22, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.6, priorClaims:0, source:"sample", note:"Cancellation dispute with documented cancellation request. Merchant has low CBR — likely to push back. Evidence package will be key at representment." },
  { id:"DSP-013", code:"4837", amount:6400,  filedDaysAgo:9,  windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.4, priorClaims:0, source:"sample", note:"Clean MC fraud — no authorization, AVS mismatch, no 3DS. Cardholder has never seen the merchant. Strong 4837 position." },
  { id:"DSP-014", code:"4870", amount:9200,  filedDaysAgo:6,  windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:2.1, priorClaims:0, source:"sample", note:"Chip liability shift — merchant fell back to magnetic stripe at chip-capable terminal. High merchant CBR signals systemic fraud exposure." },
  { id:"DSP-015", code:"4853", amount:2400,  filedDaysAgo:35, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.8, priorClaims:1, source:"sample", note:"Defective merchandise with photographic evidence. One prior claim on account is a mild concern. Mid-window — still actionable." },
  { id:"DSP-016", code:"4855", amount:4100,  filedDaysAgo:14, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:1.3, priorClaims:0, source:"sample", note:"Services never rendered — strong documentation, elevated merchant CBR. Clean account with no prior disputes. Solid B-grade receivable." },
  { id:"DSP-017", code:"4841", amount:2800,  filedDaysAgo:20, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.6, priorClaims:0, source:"sample", note:"Recurring charge post-cancellation. Strong documentation of cancellation event. Low-CBR merchant may contest aggressively." },
  { id:"DSP-018", code:"4860", amount:2600,  filedDaysAgo:16, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:true,  pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.4, priorClaims:0, source:"sample", note:"Merchant agreed to credit in writing but failed to process. Merchant acknowledgement is powerful MC 4860 evidence. Near-certain win." },
  { id:"DSP-019", code:"4863", amount:3600,  filedDaysAgo:30, windowDays:120, avsMismatch:false, no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.9, priorClaims:0, source:"sample", note:"No 3DS on CNP transaction. AVS matched — mixed signals. Mid-window. Serviceable 4863 but not a slam dunk." },
  { id:"DSP-020", code:"4853", amount:1800,  filedDaysAgo:42, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:true,  merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.5, priorClaims:2, source:"sample", note:"Item received but materially different from listing. Two prior claims and delivery confirmation significantly reduce fundability. D-grade drag on portfolio." },
]

// ─── Scoring model ────────────────────────────────────────────────────────────
function computeRecoveryProb(c) {
  let p = BASE_WIN_RATES[c.code] != null ? BASE_WIN_RATES[c.code] : 0.50
  const code = String(c.code)

  // Authorization codes (11.x, 4808, 4812, 4847) — largely mechanical, few signal adjustments
  const isAuth = code.startsWith("11") || ["4808","4812","4847"].includes(code)
  // Processing error codes (12.x, 4831, 4834, 4835, 4842, 4846) — mechanical wins, no behavioral signals
  const isProcessingError = code.startsWith("12") || ["4831","4834","4835","4842","4846"].includes(code)
  // Fraud codes
  const isFraud = code.startsWith("10") || ["4837","4840","4849","4863","4870","4871"].includes(code)

  if (isAuth || isProcessingError) {
    // Mechanical wins — time window is the main risk factor, signal adjustments minimal
    if (c.priorClaims > 2) p -= 0.05  // unusual volume is mild risk
    // No other behavioral adjustments — these live or die on documentation alone
  } else if (isFraud) {
    if (c.avsMismatch) p += 0.07
    if (c.no3DS)       p += 0.05
    if (c.isVFMP)      p = Math.min(p + 0.15, 0.96)
    if (c.pinVerified) p -= 0.28  // PIN-verified CNP = near-certain loss
    if      (c.merchantCBR >= 2.0) p += 0.06
    else if (c.merchantCBR >= 1.0) p += 0.03
    else if (c.merchantCBR <  0.3) p -= 0.04
    p -= c.priorClaims * 0.07
  } else {
    // Consumer disputes (13.x, 4841, 4850, 4853, 4854, 4855, 4859, 4860, 4999)
    if (c.deliveryConf) p -= 0.22
    if (c.merchantAck)  p += 0.18
    if (c.strongDocs)   p += 0.12
    if      (c.merchantCBR >= 1.5) p += 0.05
    else if (c.merchantCBR <  0.3) p -= 0.05
    p -= c.priorClaims * 0.07
  }
  return parseFloat(Math.max(0.05, Math.min(0.96, p)).toFixed(2))
}

function computeTimeScore(c) {
  const r = c.windowDays - c.filedDaysAgo
  if (r > 90) return 1.00
  if (r > 60) return 0.90
  if (r > 30) return 0.78
  if (r > 15) return 0.60
  return 0.35
}

function computeAmountScore(a) {
  if (a < 50)    return 0.15
  if (a < 100)   return 0.40
  if (a < 200)   return 0.65
  if (a <= 2000) return 1.00
  if (a <= 5000) return 0.85
  return 0.70
}

function scoreClaim(c) {
  const recoveryProb     = computeRecoveryProb(c)
  const timeScore        = computeTimeScore(c)
  const amountScore      = computeAmountScore(c.amount)
  const fundability      = Math.round((recoveryProb * 0.55 + timeScore * 0.25 + amountScore * 0.20) * 100)
  const expectedRecovery = c.amount * recoveryProb * timeScore
  return { recoveryProb, timeScore, amountScore, fundability, expectedRecovery }
}

const SCORED_SAMPLE = CLAIMS_DATA.map(c => ({ ...c, codeLabel: CODE_LABELS[c.code] || `Code ${c.code}`, ...scoreClaim(c) }))

// ─── CSV utilities ────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS = ["id","code","amount","filed_days_ago","window_days","avs_mismatch","no_3ds","delivery_confirmed","merchant_acknowledged","pin_verified","vfmp_enrolled","strong_docs","merchant_cbr","prior_claims","note"]
const TEMPLATE_EXAMPLE = ["DSP-021","10.4","750","15","120","yes","yes","no","no","no","no","no","1.1","0","CNP fraud — AVS mismatch on shipping address"]

function parseBool(v) { return v ? ["yes","true","1","y"].includes(v.toLowerCase().trim()) : false }
function parseCSVLine(line) {
  const r = []; let cur = "", q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { r.push(cur); cur = "" }
    else cur += ch
  }
  r.push(cur); return r
}
function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { claims: [], errors: ["CSV must have a header row and at least one data row."] }
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g,"_"))
  const errors = [], claims = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = parseCSVLine(lines[i])
    const row = {}; headers.forEach((h,idx) => { row[h] = (cols[idx]||"").trim() })
    const code = (row.code||"").trim()
    if (!code) { errors.push(`Row ${i+1}: missing reason code — skipped`); continue }
    const amount = parseFloat(row.amount)
    if (isNaN(amount)||amount<=0) { errors.push(`Row ${i+1}: invalid amount "${row.amount}" — skipped`); continue }
    const c = {
      id: row.id||`UPL-${String(i).padStart(3,"0")}`, code, codeLabel: CODE_LABELS[code]||`Code ${code}`,
      amount, filedDaysAgo: parseInt(row.filed_days_ago||"0",10)||0,
      windowDays: parseInt(row.window_days||"120",10)||120,
      avsMismatch: parseBool(row.avs_mismatch), no3DS: parseBool(row.no_3ds),
      deliveryConf: parseBool(row.delivery_confirmed), merchantAck: parseBool(row.merchant_acknowledged),
      pinVerified: parseBool(row.pin_verified), isVFMP: parseBool(row.vfmp_enrolled),
      strongDocs: parseBool(row.strong_docs),
      merchantCBR: parseFloat(row.merchant_cbr||"0.5")||0.5,
      priorClaims: parseInt(row.prior_claims||"0",10)||0,
      note: row.note||"", source: "uploaded",
    }
    claims.push({ ...c, ...scoreClaim(c) })
  }
  return { claims, errors }
}
function downloadTemplate() {
  const blob = new Blob([[TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE.join(",")].join("\n")], { type:"text/csv" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob)
  a.download = "dispute_portfolio_template.csv"; a.click()
}

// ─── Grade ────────────────────────────────────────────────────────────────────
function grade(score) {
  if (score >= 75) return { label:"A", bg:"bg-emerald-900", text:"text-emerald-50", bar:"#064e3b", pill:"border-emerald-700 text-emerald-800" }
  if (score >= 60) return { label:"B", bg:"bg-stone-700",   text:"text-stone-50",   bar:"#44403c", pill:"border-stone-500 text-stone-700"   }
  if (score >= 45) return { label:"C", bg:"bg-amber-800",   text:"text-amber-50",   bar:"#92400e", pill:"border-amber-700 text-amber-800"   }
  return              { label:"D", bg:"bg-red-900",     text:"text-red-50",     bar:"#7f1d1d", pill:"border-red-700 text-red-800"       }
}
function ScoreBar({ value, color }) {
  return (
    <div style={{ height:"3px", background:"#D4CCBC", width:"100%" }}>
      <div style={{ height:"100%", width:`${Math.min(100,Math.round(value*100))}%`, background:color }} />
    </div>
  )
}

// ─── Export scored results ────────────────────────────────────────────────────
function exportResultsCSV(claims, advanceRate) {
  const headers = ["id","network","code","code_label","amount","fundability","grade","win_prob_pct","expected_recovery","advance","projected_net","days_remaining","note"]
  const rows = claims.map(c => {
    const g = grade(c.fundability)
    const note = (c.note || "").replace(/"/g, "'")
    return [c.id, detectNetwork(c.code), c.code, CODE_LABELS[c.code]||c.code,
      c.amount, c.fundability, g.label, Math.round(c.recoveryProb*100),
      Math.round(c.expectedRecovery), Math.round(c.expectedRecovery*advanceRate),
      Math.round(c.expectedRecovery*(1-advanceRate)), c.windowDays-c.filedDaysAgo, `"${note}"`].join(",")
  })
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type:"text/csv" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "dispute_portfolio_scored.csv"; a.click()
}

// ─── Portfolio helpers ────────────────────────────────────────────────────────
function calcTranches(claims) {
  return ['A','B','C','D'].map(gl => {
    const sub = claims.filter(c => grade(c.fundability).label === gl)
    if (!sub.length) return null
    return { gl, count:sub.length, value:sub.reduce((s,c)=>s+c.amount,0), expected:sub.reduce((s,c)=>s+c.expectedRecovery,0) }
  }).filter(Boolean)
}

function portfolioRiskFlags(claims, totalValue) {
  const flags = []
  if (!claims.length || !totalValue) return flags
  const topClaim = claims.reduce((a,b) => a.amount > b.amount ? a : b)
  if (topClaim.amount / totalValue > 0.35)
    flags.push({ type:"warn", text:`Concentration: ${topClaim.id} represents ${Math.round(topClaim.amount/totalValue*100)}% of portfolio face value` })
  const byCode = {}; claims.forEach(c => { byCode[c.code] = (byCode[c.code]||0) + c.amount })
  const [topCode, topCodeVal] = Object.entries(byCode).sort((a,b) => b[1]-a[1])[0]
  if (topCodeVal / totalValue > 0.50)
    flags.push({ type:"warn", text:`Code concentration: ${Math.round(topCodeVal/totalValue*100)}% in ${topCode} (${CODE_LABELS[topCode]||topCode})` })
  const shortVal = claims.filter(c => (c.windowDays-c.filedDaysAgo) <= 30).reduce((s,c)=>s+c.amount,0)
  if (shortVal / totalValue > 0.20)
    flags.push({ type:"urgent", text:`Window risk: ${Math.round(shortVal/totalValue*100)}% of portfolio ($${Math.round(shortVal).toLocaleString()}) has ≤30 days remaining` })
  const dGrade = claims.filter(c => grade(c.fundability).label === 'D')
  if (dGrade.length > 0)
    flags.push({ type:"info", text:`${dGrade.length} D-grade claim${dGrade.length>1?"s":""} ($${Math.round(dGrade.reduce((s,c)=>s+c.amount,0)).toLocaleString()}) drag the portfolio average — consider excluding` })
  return flags
}

// ─── Manual claim defaults ────────────────────────────────────────────────────
const MANUAL_DEFAULTS = {
  id:"", code:"10.4", amount:"", filedDaysAgo:"0", windowDays:"120",
  avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false,
  pinVerified:false, isVFMP:false, strongDocs:false,
  merchantCBR:"0.8", priorClaims:"0", note:"",
}

// ─── Claim detail panel ───────────────────────────────────────────────────────
function ClaimDetail({ sc, advanceRate, claimNet, onClose, excluded, onToggleExclude, onRemove }) {
  const g       = grade(sc.fundability)
  const network = detectNetwork(sc.code)
  const evidenceItems = [
    { label:"AVS mismatch on shipping address", active:sc.avsMismatch,  positive:true  },
    { label:"No 3DS authentication data",       active:sc.no3DS,        positive:true  },
    { label:"Delivery confirmation on file",    active:sc.deliveryConf, positive:false },
    { label:"Merchant acknowledged in writing", active:sc.merchantAck,  positive:true  },
    { label:"PIN-verified transaction",         active:sc.pinVerified,  positive:false },
    { label:"VFMP enrolled merchant",           active:sc.isVFMP,       positive:true  },
    { label:"Strong documentary evidence",      active:sc.strongDocs,   positive:true  },
    ...(sc.priorClaims > 0 ? [{ label:`${sc.priorClaims} prior claim(s) on account`, active:true, positive:false }] : []),
  ].filter(e => e.active)

  return (
    <div className={`border-2 transition-opacity ${excluded?"border-stone-300 opacity-60":"border-stone-900"}`} style={{ background:"#FAF7F1" }}>
      <div className="flex items-start justify-between px-5 py-4 border-b border-stone-300" style={{ background:"#1A1814" }}>
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="mono-font text-xs font-medium text-stone-100">{sc.id}</span>
            {sc.source === "uploaded" && <span className="mono-font text-[8px] px-1.5 py-0.5 bg-blue-800 text-blue-100">CSV</span>}
            {sc.source === "manual"   && <span className="mono-font text-[8px] px-1.5 py-0.5 bg-violet-800 text-violet-100">MANUAL</span>}
            <span className="mono-font text-[8px] px-1.5 py-0.5 border border-stone-600 text-stone-400">{network.toUpperCase()}</span>
          </div>
          <div className="display-font text-stone-300 text-[13px]">{sc.code} — {sc.codeLabel}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`mono-font text-sm font-bold px-2 py-0.5 ${g.bg} ${g.text}`}>{g.label}</span>
          {onClose && <button onClick={onClose} className="text-stone-400 hover:text-stone-100 transition-colors mono-font text-lg leading-none ml-1">×</button>}
        </div>
      </div>

      {onToggleExclude && (
        <div className="px-5 py-2 border-b border-stone-200 flex items-center justify-between" style={{ background:"#EEE9E0" }}>
          <span className="mono-font text-[9px] tracking-widest text-stone-500">PORTFOLIO INCLUSION</span>
          <div className="flex items-center gap-2">
            <button onClick={() => onToggleExclude(sc.id)}
              className={`mono-font text-[9px] tracking-wide px-2.5 py-1 border transition-colors ${excluded?"border-amber-700 bg-amber-50 text-amber-800":"border-stone-400 text-stone-600 hover:border-stone-800 hover:text-stone-900"}`}>
              {excluded ? "EXCLUDED — CLICK TO RESTORE" : "EXCLUDE FROM PORTFOLIO"}
            </button>
            {onRemove && (sc.source === 'manual' || sc.source === 'desk') && (
              <button onClick={() => { if (window.confirm('Remove this claim permanently?')) onRemove(sc.id) }}
                className="mono-font text-[9px] tracking-wide px-2.5 py-1 border border-red-400 text-red-600 hover:bg-red-50 transition-colors">
                REMOVE
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-5 py-5 space-y-5">
        <div>
          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">SCORE BREAKDOWN</div>
          <div className="space-y-3">
            {[
              { label:"Recovery probability", weight:"55%", raw:sc.recoveryProb, display:`${Math.round(sc.recoveryProb*100)}%`, color:sc.recoveryProb>=0.65?"#064e3b":sc.recoveryProb>=0.40?"#92400e":"#7f1d1d" },
              { label:"Time value",           weight:"25%", raw:sc.timeScore,    display:`${Math.round(sc.timeScore*100)}%`,    color:sc.timeScore>=0.85?"#064e3b":sc.timeScore>=0.65?"#92400e":"#7f1d1d"       },
              { label:"Amount efficiency",    weight:"20%", raw:sc.amountScore,  display:`${Math.round(sc.amountScore*100)}%`,  color:sc.amountScore>=0.85?"#064e3b":sc.amountScore>=0.55?"#92400e":"#7f1d1d"   },
            ].map(m => (
              <div key={m.label}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <div><span className="display-font text-[13px] text-stone-700">{m.label}</span><span className="mono-font text-[9px] text-stone-400 ml-1.5">({m.weight})</span></div>
                  <span className="mono-font text-xs font-medium text-stone-800">{m.display}</span>
                </div>
                <ScoreBar value={m.raw} color={m.color} />
              </div>
            ))}
          </div>
        </div>

        {evidenceItems.length > 0 && (
          <div>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-2">EVIDENCE FACTORS</div>
            <div className="space-y-1.5">
              {evidenceItems.map(e => (
                <div key={e.label} className="flex items-start gap-2">
                  {e.positive ? <CheckCircle className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />}
                  <span className={`display-font text-[13px] leading-snug ${e.positive?"text-emerald-800":"text-red-800"}`}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {sc.note && (
          <div>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-2">UNDERWRITER NOTE</div>
            <p className="display-font text-stone-700 text-[13px] leading-relaxed border-l-2 border-stone-300 pl-3 italic">{sc.note}</p>
          </div>
        )}

        <div className="border-t border-stone-200 pt-4">
          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">FUNDING SUMMARY</div>
          <div className="space-y-2">
            {[
              { label:"Face value",                                            val:`$${sc.amount.toLocaleString()}`,                                                                      bold:false },
              { label:"Expected recovery",                                     val:`$${Math.round(sc.expectedRecovery).toLocaleString()} (${Math.round(sc.recoveryProb*100)}% win rate)`, bold:false },
              { label:`Advance (${Math.round(advanceRate*100)}% of expected)`, val:`$${Math.round(sc.expectedRecovery*advanceRate).toLocaleString()}`,                                    bold:false },
              { label:"Projected net to funder",                               val:`$${claimNet(sc).toLocaleString()}`,                                                                   bold:true  },
              { label:"Return on advance",                                     val:`${Math.round(((1-advanceRate)/advanceRate)*100)}%`,                                                   bold:true  },
            ].map(r => (
              <div key={r.label} className="flex justify-between gap-3">
                <span className="display-font text-[13px] text-stone-500 leading-snug">{r.label}</span>
                <span className={`mono-font text-xs shrink-0 ${r.bold?"text-emerald-800 font-medium":"text-stone-700"}`}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// 003 DFA VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function DfaView({ dfaQueue, setDfaQueue }) {
  const [selected, setSelected]             = useState(null)
  const [sortCol, setSortCol]               = useState("fundability")
  const [sortDir, setSortDir]               = useState("desc")
  const [uploadedClaims, setUploaded]       = useState([])
  const [parseErrors, setParseErrors]       = useState([])
  const [expandedMobile, setExpandedMobile] = useState(null)
  const [manualClaims, setManualClaims]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('dfa_manual_claims') || '[]') } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_manual_claims', JSON.stringify(manualClaims)) } catch {}
  }, [manualClaims])

  const [excludedIds, setExcludedIds]       = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dfa_excluded_ids') || '[]')) } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_excluded_ids', JSON.stringify([...excludedIds])) } catch {}
  }, [excludedIds])

  const removeManualClaim = (id) => setManualClaims(prev => prev.filter(c => c.id !== id))

  const [gradeFilter, setGradeFilter]       = useState("all")
  const [showAddForm, setShowAddForm]       = useState(false)
  const [draft, setDraft]                   = useState({ ...MANUAL_DEFAULTS })
  // Investor controls — persisted so settings survive refresh
  const [advanceOverride, setAdvanceOverride] = useState(() => {
    try { const v = localStorage.getItem('dfa_advance_override'); return v !== null ? parseFloat(v) : null } catch { return null }
  })
  useEffect(() => {
    try {
      if (advanceOverride !== null) localStorage.setItem('dfa_advance_override', String(advanceOverride))
      else localStorage.removeItem('dfa_advance_override')
    } catch {}
  }, [advanceOverride])

  const [recourseType, setRecourseType]       = useState(() => {
    try { return localStorage.getItem('dfa_recourse_type') || 'nonrecourse' } catch { return 'nonrecourse' }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_recourse_type', recourseType) } catch {}
  }, [recourseType])

  const [refundPct, setRefundPct]             = useState(() => {
    try { return parseFloat(localStorage.getItem('dfa_refund_pct') || '0.20') } catch { return 0.20 }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_refund_pct', String(refundPct)) } catch {}
  }, [refundPct])

  const [holdingDays, setHoldingDays]         = useState(() => {
    try { return parseInt(localStorage.getItem('dfa_holding_days') || '90', 10) } catch { return 90 }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_holding_days', String(holdingDays)) } catch {}
  }, [holdingDays])
  const fileRef       = useRef(null)
  const manualCounter = useRef(1)

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d==="desc"?"asc":"desc")
    else { setSortCol(col); setSortDir("desc") }
  }
  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { claims, errors } = parseCSVText(ev.target.result)
      setUploaded(claims); setParseErrors(errors); setSelected(null); setExpandedMobile(null)
    }
    reader.readAsText(file); e.target.value = ""
  }
  function clearUploaded() { setUploaded([]); setParseErrors([]); setSelected(null); setExpandedMobile(null) }

  function toggleExclude(id) {
    setExcludedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else { next.add(id); if (selected === id) setSelected(null) }
      return next
    })
  }

  function addManualClaim() {
    const amount = parseFloat(draft.amount)
    if (!draft.code || isNaN(amount) || amount <= 0) return
    const id = draft.id.trim() || `MAN-${String(manualCounter.current).padStart(3,"0")}`
    manualCounter.current++
    const c = {
      id, code: draft.code, codeLabel: CODE_LABELS[draft.code]||`Code ${draft.code}`,
      amount, filedDaysAgo: parseInt(draft.filedDaysAgo)||0, windowDays: parseInt(draft.windowDays)||120,
      avsMismatch:draft.avsMismatch, no3DS:draft.no3DS, deliveryConf:draft.deliveryConf,
      merchantAck:draft.merchantAck, pinVerified:draft.pinVerified, isVFMP:draft.isVFMP, strongDocs:draft.strongDocs,
      merchantCBR:parseFloat(draft.merchantCBR)||0.5, priorClaims:parseInt(draft.priorClaims)||0,
      note:draft.note, source:"manual",
    }
    setManualClaims(prev => [...prev, { ...c, ...scoreClaim(c) }])
    setDraft({ ...MANUAL_DEFAULTS }); setShowAddForm(false)
  }

  const allScoredRaw = useMemo(() => [...SCORED_SAMPLE, ...uploadedClaims, ...manualClaims], [uploadedClaims, manualClaims])
  const activeScored = useMemo(() => allScoredRaw.filter(c => !excludedIds.has(c.id)), [allScoredRaw, excludedIds])

  // ── Portfolio metrics ──────────────────────────────────────────────────────
  const totalValue     = activeScored.reduce((s,c) => s+c.amount, 0)
  const totalExpected  = activeScored.reduce((s,c) => s+c.expectedRecovery, 0)
  const weightedScore  = totalValue > 0 ? activeScored.reduce((s,c) => s+c.fundability*c.amount, 0)/totalValue : 0
  const topShare       = activeScored.length > 0 ? Math.max(...activeScored.map(c=>c.amount))/totalValue : 0
  const concPenalty    = topShare > 0.35 ? 4 : 0
  const portfolioScore = Math.round(weightedScore - concPenalty)
  const pg             = grade(portfolioScore)
  const gradeAdvRate   = portfolioScore>=75?0.65:portfolioScore>=60?0.55:portfolioScore>=45?0.44:0.30
  const advanceRate    = advanceOverride !== null ? advanceOverride : gradeAdvRate
  const advanceValue   = totalExpected * advanceRate
  const totalNet       = totalExpected - advanceValue
  const claimNet       = c => Math.round(c.expectedRecovery*(1-advanceRate))
  const roaPercent     = advanceValue>0 ? Math.round((totalNet/advanceValue)*100) : 0

  // Recourse bonus — on losing claims, issuer refunds refundPct × advance
  const recourseBonus  = recourseType === "partial"
    ? activeScored.reduce((s,c) => s + c.expectedRecovery*advanceRate*(1-c.recoveryProb)*refundPct, 0)
    : 0
  const adjustedNet    = totalNet + recourseBonus

  // IRR
  const grossReturn    = advanceValue > 0 ? adjustedNet/advanceValue : 0
  const annualizedIRR  = advanceValue > 0 ? Math.round(((1+grossReturn)**(365/holdingDays)-1)*100) : 0

  // Scenarios (advance is fixed at origination — what changes is what comes back)
  const stressExpected   = activeScored.reduce((s,c) => s + c.amount*Math.min(c.recoveryProb*0.80,0.96)*c.timeScore, 0)
  const recoveryExpected = activeScored.reduce((s,c) => s + c.amount*c.recoveryProb*c.timeScore + c.amount*(1-c.recoveryProb)*c.timeScore*0.30, 0)

  const tranches   = useMemo(() => calcTranches(activeScored),               [activeScored])
  const riskFlags  = useMemo(() => portfolioRiskFlags(activeScored,totalValue), [activeScored,totalValue])

  const gradeCounts = useMemo(() => {
    const ct = { all:allScoredRaw.length, A:0, B:0, C:0, D:0 }
    allScoredRaw.forEach(cl => { ct[grade(cl.fundability).label]++ })
    return ct
  }, [allScoredRaw])

  const sorted = useMemo(() => {
    const list = gradeFilter==="all" ? [...allScoredRaw] : allScoredRaw.filter(c => grade(c.fundability).label===gradeFilter)
    return list.sort((a,b) => {
      const v = c => sortCol==="amount"?c.amount:sortCol==="expectedRecovery"?c.expectedRecovery:sortCol==="projectedNet"?claimNet(c):c.fundability
      return sortDir==="desc" ? v(b)-v(a) : v(a)-v(b)
    })
  }, [allScoredRaw, sortCol, sortDir, gradeFilter])

  const sc = selected ? allScoredRaw.find(c=>c.id===selected) : null

  function SortBtn({ col, label }) {
    const active = sortCol===col
    const Icon   = active && sortDir==="asc" ? ChevronUp : ChevronDown
    return (
      <button onClick={() => handleSort(col)} className={`flex items-center gap-0.5 mono-font text-[10px] tracking-widest transition-colors ${active?"text-stone-900":"text-stone-400 hover:text-stone-600"}`}>
        {label}<Icon className="w-3 h-3" />
      </button>
    )
  }


  // ── Pre-load cases queued from Dispute Desk ─────────────────────────────
  useEffect(() => {
    if (!dfaQueue || dfaQueue.length === 0) return
    const mapped = dfaQueue.map(o => {
      const c = {
        id: o.id, code: o.code,
        codeLabel: CODE_LABELS[o.code] || `Code ${o.code}`,
        amount: parseFloat(o.amount) || 0,
        filedDaysAgo: parseInt(o.filedDaysAgo) || 0,
        windowDays: parseInt(o.windowDays) || 45,
        avsMismatch: !!o.avsMismatch, no3DS: !!o.no3DS,
        deliveryConf: !!o.deliveryConf, merchantAck: !!o.merchantAck,
        pinVerified: !!o.pinVerified, isVFMP: !!o.isVFMP,
        strongDocs: !!o.strongDocs,
        merchantCBR: parseFloat(o.merchantCBR) || 0.5,
        priorClaims: parseInt(o.priorClaims) || 0,
        note: (o.note || `From Dispute Desk: ${o.merchant || ''}`).trim(),
        source: "desk",
      }
      return { ...c, ...scoreClaim(c) }
    })
    setManualClaims(prev => {
      const existingIds = new Set(prev.map(c => c.id))
      return [...prev, ...mapped.filter(c => !existingIds.has(c.id))]
    })
    setDfaQueue([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dfaQueue])

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 sm:py-12">
        {/* ── Masthead ── */}
        <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div className="mono-font text-xs tracking-widest text-stone-600">ISSUE Nº 003 — DFA</div>
            <div className="mono-font text-xs tracking-widest text-stone-600">{new Date().toLocaleDateString("en-US",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}</div>
          </div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:"clamp(36px,6vw,80px)", letterSpacing:"-0.03em" }}>
            The Dispute<br /><span style={{ fontStyle:"italic", fontWeight:500 }}>Funding Assessor</span>
          </h1>
          <p className="display-font text-stone-700 mt-4 max-w-2xl" style={{ fontSize:"clamp(14px,1.8vw,17px)", lineHeight:"1.6" }}>
            Payment disputes as an asset class. Upload a portfolio of Visa or Mastercard claims and the assessor underwrites each receivable — scoring fundability, modelling probability-weighted recovery, and recommending an advance rate. Built for issuers, servicers, and dispute funders.
          </p>
        </div>
        {/* ── Step 01 — Portfolio Upload ── */}
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="mono-font text-xs text-stone-500">01</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Portfolio Upload</h2>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          <div className="border border-dashed border-stone-400 p-4 sm:p-5 flex flex-wrap gap-3 items-center" style={{ background:"#FAF7F1" }}>
            <button className="upload-btn" onClick={() => fileRef.current?.click()}><Upload style={{ width:13,height:13 }} /> Upload CSV</button>
            <button className="upload-btn" onClick={downloadTemplate}><Download style={{ width:13,height:13 }} /> Template</button>
            <button className="upload-btn" onClick={() => setShowAddForm(v=>!v)}><Plus style={{ width:13,height:13 }} /> Add claim</button>
            <div className="flex items-center gap-3 sm:ml-auto flex-wrap">
              {uploadedClaims.length > 0 && <><span className="mono-font text-[10px] tracking-widest text-stone-500">{uploadedClaims.length} CSV CLAIM{uploadedClaims.length!==1?"S":""}</span><button onClick={clearUploaded} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">CLEAR</button></>}
              {manualClaims.length > 0 && <span className="mono-font text-[10px] tracking-widest text-stone-500">{manualClaims.length} MANUAL</span>}
              {excludedIds.size > 0 && <span className="mono-font text-[10px] tracking-widest text-amber-600">{excludedIds.size} EXCLUDED</span>}
            </div>
          </div>

          {showAddForm && (
            <div className="border border-stone-400 mt-3" style={{ background:"#FAF7F1" }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200" style={{ background:"#EEE9E0" }}>
                <div className="mono-font text-[10px] tracking-widest text-stone-600">ADD CLAIM MANUALLY</div>
                <button onClick={() => { setShowAddForm(false); setDraft({...MANUAL_DEFAULTS}) }} className="text-stone-400 hover:text-stone-700 transition-colors"><X className="w-4 h-4" /></button>
              </div>
              <div className="px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">CLAIM ID</label><input className="input-field" placeholder="AUTO" value={draft.id} onChange={e=>setDraft(d=>({...d,id:e.target.value}))} /></div>
                  <div className="col-span-2"><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">REASON CODE</label><select className="input-field" value={draft.code} onChange={e=>setDraft(d=>({...d,code:e.target.value}))}>{Object.entries(CODE_LABELS).map(([k,v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></div>
                  <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">AMOUNT ($)</label><input className="input-field" type="number" placeholder="0.00" value={draft.amount} onChange={e=>setDraft(d=>({...d,amount:e.target.value}))} /></div>
                  <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">FILED DAYS AGO</label><input className="input-field" type="number" value={draft.filedDaysAgo} onChange={e=>setDraft(d=>({...d,filedDaysAgo:e.target.value}))} /></div>
                  <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">WINDOW (DAYS)</label><input className="input-field" type="number" value={draft.windowDays} onChange={e=>setDraft(d=>({...d,windowDays:e.target.value}))} /></div>
                  <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">MERCHANT CBR</label><input className="input-field" type="number" step="0.1" value={draft.merchantCBR} onChange={e=>setDraft(d=>({...d,merchantCBR:e.target.value}))} /></div>
                  <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">PRIOR CLAIMS</label><input className="input-field" type="number" value={draft.priorClaims} onChange={e=>setDraft(d=>({...d,priorClaims:e.target.value}))} /></div>
                </div>
                <div>
                  <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-2">EVIDENCE SIGNALS — click to toggle</div>
                  <div className="flex flex-wrap gap-2">
                    {[{key:"avsMismatch",label:"AVS MISMATCH"},{key:"no3DS",label:"NO 3DS"},{key:"deliveryConf",label:"DELIVERY CONF"},{key:"merchantAck",label:"MERCHANT ACK"},{key:"pinVerified",label:"PIN VERIFIED"},{key:"isVFMP",label:"VFMP ENROLLED"},{key:"strongDocs",label:"STRONG DOCS"}].map(({key,label}) => (
                      <button key={key} type="button" onClick={() => setDraft(d=>({...d,[key]:!d[key]}))}
                        className={`mono-font text-[9px] tracking-wide px-2.5 py-1.5 border transition-colors ${draft[key]?"border-stone-900 bg-stone-900 text-stone-50":"border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div><label className="mono-font text-[9px] tracking-widest text-stone-500 block mb-1">UNDERWRITER NOTE (OPTIONAL)</label><input className="input-field" placeholder="Observations on this claim..." value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))} /></div>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={addManualClaim} disabled={!draft.amount||isNaN(parseFloat(draft.amount))||parseFloat(draft.amount)<=0} className="mono-font text-[10px] tracking-widest px-4 py-2 bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">SCORE &amp; ADD CLAIM</button>
                  <button type="button" onClick={() => { setDraft({...MANUAL_DEFAULTS}); setShowAddForm(false) }} className="mono-font text-[10px] tracking-widest px-4 py-2 border border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700 transition-colors">CANCEL</button>
                </div>
              </div>
            </div>
          )}
          {parseErrors.length > 0 && <div className="mt-3 border border-amber-700 bg-amber-50 p-4"><div className="mono-font text-xs tracking-widest text-amber-800 mb-2">⚠ ROWS SKIPPED</div>{parseErrors.map((e,i) => <div key={i} className="display-font text-sm text-amber-900">{e}</div>)}</div>}
        </div>

        {/* ── Step 02 — Portfolio Summary ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="mono-font text-xs text-stone-500">02</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Portfolio Summary</h2>
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              {(uploadedClaims.length>0||manualClaims.length>0||excludedIds.size>0) && (
                <span className="mono-font text-[10px] text-stone-400">{SCORED_SAMPLE.length} SAMPLE{uploadedClaims.length>0?` + ${uploadedClaims.length} CSV`:""}{manualClaims.length>0?` + ${manualClaims.length} MANUAL`:""}{excludedIds.size>0?` · ${excludedIds.size} EXCLUDED`:""}</span>
              )}
              <span className={`mono-font text-sm font-bold px-3 py-1 ${pg.bg} ${pg.text}`}>GRADE {pg.label}</span>
            </div>
          </div>

          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight:"1.5" }}>
            This portfolio grades <strong className="text-stone-700">{pg.label}</strong> — advancing <strong className="text-stone-700">${Math.round(advanceValue).toLocaleString()}</strong> today ({Math.round(advanceRate*100)}% of expected recovery) against <strong className="text-stone-700">${Math.round(totalExpected).toLocaleString()}</strong> expected at resolution. That is a <strong className="text-stone-700">{roaPercent}% gross return</strong> on capital deployed — approximately <strong className="text-stone-700">~{annualizedIRR}% annualized</strong> over a {holdingDays}-day resolution window, before servicing costs.
            {concPenalty > 0 && <span className="text-amber-700"> Concentration penalty applied.</span>}
          </p>

          {/* Metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            {[
              { label:"PORTFOLIO VALUE",      value:`$${totalValue.toLocaleString()}`,                sub:`${activeScored.length} active receivables`                              },
              { label:"EXPECTED RECOVERY",    value:`$${Math.round(totalExpected).toLocaleString()}`, sub:`${Math.round(totalValue>0?totalExpected/totalValue*100:0)}% of face value` },
              { label:"RECOMMENDED ADVANCE",  value:`$${Math.round(advanceValue).toLocaleString()}`,  sub:`${Math.round(advanceRate*100)}% of expected recovery`                   },
              { label:"PROJECTED NET RETURN", value:`$${Math.round(adjustedNet).toLocaleString()}`,   sub:`${roaPercent}% return on advance`, hi:true                             },
              { label:"FUNDABILITY SCORE",    value:`${portfolioScore} / 100`,                        sub:concPenalty>0?`−${concPenalty} concentration`:"no concentration risk"    },
            ].map(m => (
              <div key={m.label} className={`border p-4 ${m.hi?"border-emerald-700 bg-emerald-50":"border-stone-300"}`} style={m.hi?{}:{background:"#FAF7F1"}}>
                <div className={`mono-font text-[9px] tracking-widest mb-2 ${m.hi?"text-emerald-700":"text-stone-400"}`}>{m.label}</div>
                <div className={`display-font font-semibold ${m.hi?"text-emerald-900":"text-stone-900"}`} style={{ fontSize:"clamp(16px,2.5vw,22px)", letterSpacing:"-0.02em" }}>{m.value}</div>
                <div className={`mono-font text-[9px] tracking-wide mt-1 ${m.hi?"text-emerald-600":"text-stone-400"}`}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Advance rate slider */}
          <div className="border border-stone-300 p-4 mb-5" style={{ background:"#FAF7F1" }}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div>
                <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-0.5">ADVANCE RATE</div>
                <div className="display-font text-stone-500 text-[13px]">
                  Grade default: <strong className="text-stone-800">{Math.round(gradeAdvRate*100)}%</strong>
                  {advanceOverride !== null && <span className="mono-font text-[10px] text-amber-700 ml-2">OVERRIDDEN</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="mono-font text-[10px] text-stone-400">30%</span>
                <input type="range" min="0.30" max="0.75" step="0.01"
                  value={advanceOverride !== null ? advanceOverride : gradeAdvRate}
                  onChange={e => setAdvanceOverride(parseFloat(e.target.value))}
                  className="w-32 sm:w-44" />
                <span className="mono-font text-[10px] text-stone-400">75%</span>
                <span className="mono-font text-sm font-bold text-stone-900 w-10 text-right">{Math.round(advanceRate*100)}%</span>
                {advanceOverride !== null && (
                  <button onClick={() => setAdvanceOverride(null)} className="mono-font text-[9px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">RESET</button>
                )}
              </div>
            </div>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 leading-relaxed">
              DEPLOYING ${Math.round(advanceValue).toLocaleString()} · {roaPercent}% GROSS RETURN · ~{annualizedIRR}% ANNUALIZED ({holdingDays}-DAY WINDOW){recourseType==="partial"?` · +$${Math.round(recourseBonus).toLocaleString()} RECOURSE REFUND`:""}
            </div>
          </div>

          {/* Tranche breakdown */}
          {tranches.length > 0 && (
            <div className="border border-stone-300 overflow-hidden mb-4" style={{ background:"#FAF7F1" }}>
              <div className="px-4 py-2 border-b border-stone-200" style={{ background:"#EEE9E0" }}><span className="mono-font text-[9px] tracking-widest text-stone-600">TRANCHE BREAKDOWN</span></div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-stone-200">{["GRADE","CLAIMS","FACE VALUE","EXPECTED RECOVERY","SHARE OF EXPECTED"].map(h => <th key={h} className={`px-4 py-2 mono-font text-[9px] tracking-widest text-stone-400 ${h==="GRADE"?"text-left":"text-right"}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {tranches.map(t => {
                      const tg = grade(t.gl==="A"?80:t.gl==="B"?65:t.gl==="C"?50:30)
                      const share = totalExpected>0 ? Math.round(t.expected/totalExpected*100) : 0
                      return (
                        <tr key={t.gl} className="border-b border-stone-100 last:border-0">
                          <td className="px-4 py-2.5"><span className={`mono-font text-xs font-bold px-2 py-0.5 ${tg.bg} ${tg.text}`}>{t.gl}</span></td>
                          <td className="px-4 py-2.5 mono-font text-xs text-stone-700 text-right">{t.count}</td>
                          <td className="px-4 py-2.5 mono-font text-xs text-stone-700 text-right">${t.value.toLocaleString()}</td>
                          <td className="px-4 py-2.5 mono-font text-xs text-stone-700 text-right">${Math.round(t.expected).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right"><div className="flex items-center justify-end gap-2"><div style={{ width:"60px",height:"3px",background:"#D4CCBC" }}><div style={{ height:"100%",width:`${share}%`,background:tg.bar }} /></div><span className="mono-font text-[10px] text-stone-500">{share}%</span></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {riskFlags.length > 0 && (
            <div className="space-y-2">
              {riskFlags.map((f,i) => (
                <div key={i} className={`flex items-start gap-2 px-4 py-3 border ${f.type==="urgent"?"border-red-700 bg-red-50":f.type==="warn"?"border-amber-700 bg-amber-50":"border-stone-300 bg-stone-50"}`}>
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${f.type==="urgent"?"text-red-700":f.type==="warn"?"text-amber-700":"text-stone-400"}`} />
                  <span className={`display-font text-[13px] leading-snug ${f.type==="urgent"?"text-red-900":f.type==="warn"?"text-amber-900":"text-stone-600"}`}>{f.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Recovery timeline projection ── */}
        {activeScored.length > 0 && (() => {
          const now = new Date()
          const buckets = [
            { label: '0–30 DAYS',  max: 30,  claims: [], value: 0, expected: 0 },
            { label: '31–60 DAYS', max: 60,  claims: [], value: 0, expected: 0 },
            { label: '61–90 DAYS', max: 90,  claims: [], value: 0, expected: 0 },
            { label: '91+ DAYS',   max: 9999, claims: [], value: 0, expected: 0 },
          ]
          activeScored.forEach(c => {
            const daysLeft = Math.max(0, c.windowDays - c.filedDaysAgo)
            const b = buckets.find(bk => daysLeft <= bk.max) || buckets[buckets.length-1]
            b.claims.push(c); b.value += c.amount; b.expected += c.expectedRecovery
          })
          const maxExpected = Math.max(...buckets.map(b => b.expected), 1)
          return (
            <div className="mb-6 mt-2">
              <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">RECOVERY TIMELINE — PROJECTED CASH RETURN BY RESOLUTION WINDOW</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {buckets.map(b => {
                  const barW = Math.round(b.expected / maxExpected * 100)
                  const projDate = new Date(now)
                  projDate.setDate(projDate.getDate() + (b.max === 9999 ? 120 : b.max))
                  return (
                    <div key={b.label} className="border border-stone-200 p-3" style={{ background: '#FAF7F1' }}>
                      <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1">{b.label}</div>
                      <div className="display-font font-semibold text-stone-900 mb-0.5" style={{ fontSize: 'clamp(14px,4vw,18px)', letterSpacing: '-0.02em' }}>
                        ${Math.round(b.expected).toLocaleString()}
                      </div>
                      <div className="mono-font text-[10px] text-stone-400 mb-2">{b.claims.length} claim{b.claims.length !== 1 ? 's' : ''}<br/>${Math.round(b.value).toLocaleString()} face</div>
                      <div style={{ height: '4px', background: '#D4CCBC', borderRadius: '2px' }}>
                        <div style={{ height: '100%', width: `${barW}%`, background: '#064e3b', borderRadius: '2px', transition: 'width 0.4s' }} />
                      </div>
                      {b.claims.length > 0 && (
                        <div className="mono-font text-[9px] text-stone-400 mt-1.5">
                          est. return by {projDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 mono-font text-[9px] text-stone-400">
                Timeline based on filing window remaining per claim (windowDays − daysAgo). Actual resolution may vary by network and issuer response.
              </div>
            </div>
          )
        })()}

        {/* ── Concentration drill-down ── */}
        {activeScored.length > 1 && (() => {
          const byMerchant = {}
          activeScored.forEach(c => {
            const key = c.note?.replace(/^From Dispute Desk:\s*/,'').split('·')[0].trim() || c.id
            if (!byMerchant[key]) byMerchant[key] = { count: 0, value: 0, expected: 0, codes: new Set() }
            byMerchant[key].count++
            byMerchant[key].value += c.amount
            byMerchant[key].expected += c.expectedRecovery
            byMerchant[key].codes.add(c.code)
          })
          const rows = Object.entries(byMerchant)
            .map(([name, d]) => ({ name, ...d, codes: [...d.codes] }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8)
          if (rows.length < 2) return null
          return (
            <div className="mt-2 mb-6">
              <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">CONCENTRATION BY MERCHANT / SOURCE (TOP {rows.length})</div>
              <div className="border border-stone-200 overflow-x-auto">
                <table className="w-full" style={{ minWidth: '480px' }}>
                  <thead>
                    <tr style={{ background: '#EEE9E0' }}>
                      {['MERCHANT / SOURCE','CLAIMS','FACE VALUE','EXP. RECOVERY','SHARE'].map(h=>(
                        <th key={h} className="mono-font text-[9px] tracking-widest text-stone-400 px-3 py-2 text-left font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r,i) => {
                      const share = totalValue > 0 ? Math.round(r.value / totalValue * 100) : 0
                      const shareColor = share > 35 ? 'text-red-700 font-bold' : share > 20 ? 'text-amber-700' : 'text-stone-600'
                      return (
                        <tr key={r.name} className="border-t border-stone-100" style={{ background: i % 2 === 0 ? '#FAF7F1' : '#F5F1EA' }}>
                          <td className="display-font text-sm text-stone-700 px-3 py-2 max-w-[200px] truncate">{r.name}</td>
                          <td className="mono-font text-xs text-stone-500 px-3 py-2">{r.count}</td>
                          <td className="mono-font text-xs text-stone-600 px-3 py-2">${r.value.toLocaleString()}</td>
                          <td className="mono-font text-xs text-stone-600 px-3 py-2">${Math.round(r.expected).toLocaleString()}</td>
                          <td className={`mono-font text-xs px-3 py-2 ${shareColor}`}>{share}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* ── Step 03 — Receivables Detail ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <span className="mono-font text-xs text-stone-500">03</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Receivables Detail</h2>
            <div className="sm:ml-auto flex gap-2 flex-wrap">
              <button className="upload-btn" onClick={() => {
                const w = window.open('','_blank')
                const g = grade
                w.document.write('<!DOCTYPE html><html><head><title>Covalence DFA — Portfolio Summary</title><style>body{font-family:monospace;padding:40px;color:#1A1814;max-width:900px;margin:0 auto}h1{font-size:26px;margin-bottom:4px}h2{font-size:13px;color:#78716c;margin:0 0 28px;font-weight:normal}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.card{border:1px solid #D4CCBC;padding:10px}.label{font-size:9px;letter-spacing:0.1em;color:#78716c;margin-bottom:3px}.val{font-size:19px;font-weight:600}.sub{font-size:10px;color:#a8a29e;margin-top:1px}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;padding:5px 8px;background:#EEE9E0;font-size:9px;letter-spacing:0.08em;font-weight:normal}td{padding:5px 8px;border-top:1px solid #f5f5f4}.A{color:#064e3b;font-weight:700}.B{color:#065f46}.C{color:#92400e}.D{color:#7f1d1d}.footer{margin-top:32px;font-size:9px;color:#a8a29e;border-top:1px solid #D4CCBC;padding-top:10px}@media print{button{display:none}}</style></head><body>'
                  + '<h1>Covalence — Dispute Funding Assessor</h1>'
                  + '<h2>Portfolio Summary &mdash; ' + new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) + '</h2>'
                  + '<div class="grid">'
                  + '<div class="card"><div class="label">PORTFOLIO VALUE</div><div class="val">$' + totalValue.toLocaleString() + '</div><div class="sub">' + activeScored.length + ' receivables</div></div>'
                  + '<div class="card"><div class="label">EXPECTED RECOVERY</div><div class="val">$' + Math.round(totalExpected).toLocaleString() + '</div><div class="sub">' + Math.round(totalValue>0?totalExpected/totalValue*100:0) + '% of face</div></div>'
                  + '<div class="card"><div class="label">RECOMMENDED ADVANCE</div><div class="val">$' + Math.round(advanceValue).toLocaleString() + '</div><div class="sub">' + Math.round(advanceRate*100) + '% of expected recovery</div></div>'
                  + '<div class="card"><div class="label">PORTFOLIO GRADE</div><div class="val">' + grade(weightedScore).label + '</div><div class="sub">' + Math.round(weightedScore) + ' weighted score</div></div>'
                  + '</div>'
                  + '<table><thead><tr><th>ID</th><th>FACE VALUE</th><th>CODE</th><th>GRADE</th><th>EXP. RECOVERY</th><th>ADVANCE</th><th>DAYS LEFT</th><th>NOTE</th></tr></thead><tbody>'
                  + activeScored.map(c=>{const gl=grade(c.fundability).label;return '<tr><td>'+c.id+'</td><td>$'+c.amount.toLocaleString()+'</td><td>'+c.code+'</td><td class="'+gl+'">'+gl+'</td><td>$'+Math.round(c.expectedRecovery).toLocaleString()+'</td><td>$'+Math.round(c.expectedRecovery*advanceRate).toLocaleString()+'</td><td>'+Math.max(0,c.windowDays-c.filedDaysAgo)+'d</td><td>'+String(c.note||'').replace(/</g,'&lt;').slice(0,60)+'</td></tr>'}).join('')
                  + '</tbody></table>'
                  + '<div class="footer">Generated by Covalence &middot; ' + new Date().toISOString().slice(0,19).replace('T',' ') + ' UTC</div>'
                  + '<br><button onclick="window.print()">&#128438; Print / Save as PDF</button>'
                  + '</body></html>')
                w.document.close()
              }}><Download style={{ width:13,height:13 }} /> Print Summary</button>
              <button className="upload-btn" onClick={() => exportResultsCSV(activeScored,advanceRate)}><Download style={{ width:13,height:13 }} /> Export CSV</button>
            </div>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-4 ml-7" style={{ lineHeight:"1.5" }}>
            Each claim scored as a standalone receivable. Select any row to view the full breakdown. Use <em>Exclude from portfolio</em> to model the portfolio without a claim.
          </p>

          <div className="flex flex-wrap gap-1 mb-4 ml-7">
            {(["all","A","B","C","D"]).map(g => (
              <button key={g} className={`grade-tab ${gradeFilter===g?"active":""}`} onClick={() => { setGradeFilter(g); setSelected(null) }}>
                {g==="all"?`ALL (${gradeCounts.all})`:`${g} (${gradeCounts[g]||0})`}
              </button>
            ))}
          </div>

          {/* Mobile */}
          <div className="mobile-only space-y-3">
            {sorted.map(c => {
              const g = grade(c.fundability); const isExpanded = expandedMobile===c.id; const isExcluded = excludedIds.has(c.id)
              return (
                <div key={c.id} className={`border border-stone-300 transition-opacity ${isExcluded?"opacity-40":""}`} style={{ background:"#FAF7F1" }}>
                  <button className="w-full text-left px-4 py-4" onClick={() => setExpandedMobile(isExpanded?null:c.id)}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="mono-font text-xs font-medium text-stone-800">{c.id}</span>
                          {c.source==="uploaded"&&<span className="mono-font text-[8px] px-1.5 py-0.5 bg-blue-900 text-blue-50">CSV</span>}
                          {c.source==="manual"&&<span className="mono-font text-[8px] px-1.5 py-0.5 bg-violet-900 text-violet-50">MANUAL</span>}
                          <span className="mono-font text-[8px] px-1.5 py-0.5 border border-stone-300 text-stone-500">{detectNetwork(c.code).toUpperCase()}</span>
                          {isExcluded&&<span className="mono-font text-[8px] px-1.5 py-0.5 border border-amber-600 text-amber-700">EXCL</span>}
                        </div>
                        <div className="display-font text-stone-600 text-[13px]">{c.code} — {c.codeLabel}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`mono-font text-xs font-bold px-2 py-0.5 ${g.bg} ${g.text}`}>{g.label}</span>
                        {isExpanded?<ChevronUp className="w-4 h-4 text-stone-400"/>:<ChevronDown className="w-4 h-4 text-stone-400"/>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="mono-font text-xs text-stone-600">${c.amount.toLocaleString()}</span>
                      <span className="mono-font text-[10px] text-stone-400">{c.windowDays-c.filedDaysAgo}d remaining</span>
                      <span className="mono-font text-[10px] text-stone-400">{Math.round(c.recoveryProb*100)}% win rate</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1"><ScoreBar value={c.fundability/100} color={g.bar} /></div>
                      <div className="flex gap-4 shrink-0">
                        <div className="text-right"><div className="mono-font text-[10px] text-stone-400">EXPECTED</div><div className="mono-font text-xs text-stone-700">${Math.round(c.expectedRecovery).toLocaleString()}</div></div>
                        <div className="text-right"><div className="mono-font text-[10px] text-stone-400">NET</div><div className="mono-font text-xs text-emerald-800 font-medium">${claimNet(c).toLocaleString()}</div></div>
                        <div className="text-right"><div className="mono-font text-[10px] text-stone-400">SCORE</div><div className="mono-font text-xs text-stone-800 font-medium">{c.fundability}</div></div>
                      </div>
                    </div>
                  </button>
                  {isExpanded&&<div className="border-t border-stone-300"><ClaimDetail sc={c} advanceRate={advanceRate} claimNet={claimNet} onClose={null} excluded={isExcluded} onToggleExclude={toggleExclude} onRemove={removeManualClaim} /></div>}
                </div>
              )
            })}
          </div>

          {/* Desktop */}
          <div className="desktop-only flex gap-6 items-start">
            <div style={{ flex:1, minWidth:0 }}>
              <div className="border border-stone-300 overflow-hidden" style={{ background:"#FAF7F1" }}>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth:"660px" }}>
                    <thead>
                      <tr className="border-b border-stone-300" style={{ background:"#EEE9E0" }}>
                        <th className="text-left px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">CLAIM</span></th>
                        <th className="text-left px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">CODE</span></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="amount" label="AMOUNT" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="expectedRecovery" label="EXPECTED" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="projectedNet" label="NET" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="fundability" label="SCORE" /></div></th>
                        <th className="text-center px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">GRADE</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(c => {
                        const g = grade(c.fundability); const isSel = selected===c.id; const isExcluded = excludedIds.has(c.id)
                        return (
                          <tr key={c.id} onClick={() => setSelected(isSel?null:c.id)} className={`claim-row cursor-pointer ${isSel?"selected":""} ${isExcluded?"excluded-row":""}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`mono-font text-xs font-medium ${isSel?"text-stone-100":"text-stone-800"}`}>{c.id}</span>
                                {c.source==="uploaded"&&<span className={`mono-font text-[8px] px-1.5 py-0.5 ${isSel?"bg-stone-600 text-stone-200":"bg-blue-900 text-blue-50"}`}>CSV</span>}
                                {c.source==="manual"&&<span className={`mono-font text-[8px] px-1.5 py-0.5 ${isSel?"bg-stone-600 text-stone-200":"bg-violet-900 text-violet-50"}`}>MAN</span>}
                              </div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{c.windowDays-c.filedDaysAgo}d remaining</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>{c.code}</div>
                              <div className={`sub-text display-font text-[11px] leading-snug mt-0.5 ${isSel?"":"text-stone-500"}`}>{c.codeLabel}</div>
                            </td>
                            <td className={`px-4 py-3 text-right mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>${c.amount.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">
                              <div className={`mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>${Math.round(c.expectedRecovery).toLocaleString()}</div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{Math.round(c.recoveryProb*100)}% win</div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className={`mono-font text-xs font-medium ${isSel?"text-emerald-300":"text-emerald-800"}`}>${claimNet(c).toLocaleString()}</div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{Math.round((1-advanceRate)*100)}% margin</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`mono-font text-xs text-right mb-1.5 ${isSel?"text-stone-100":"text-stone-800"}`}>{c.fundability}</div>
                              <ScoreBar value={c.fundability/100} color={isSel?"#F5F1EA":g.bar} />
                            </td>
                            <td className="px-4 py-3 text-center"><span className={`mono-font text-xs px-2 py-0.5 font-medium ${g.bg} ${g.text}`}>{g.label}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="w-80 flex-shrink-0">
              {sc ? (
                <ClaimDetail sc={sc} advanceRate={advanceRate} claimNet={claimNet} onClose={() => setSelected(null)} excluded={excludedIds.has(sc.id)} onToggleExclude={toggleExclude} onRemove={removeManualClaim} />
              ) : (
                <div className="border border-dashed border-stone-300 flex flex-col items-center justify-center py-20" style={{ background:"#FAF7F1" }}>
                  <div className="mono-font text-[9px] tracking-widest text-stone-300 text-center leading-relaxed">SELECT A CLAIM<br />TO VIEW DETAIL</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Step 04 — Investor Analysis ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">04</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Investor Analysis</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-8 ml-7" style={{ lineHeight:"1.5" }}>
            Stress-test the portfolio across scenarios, adjust the resolution window, and model the impact of a partial recourse structure. The advance is fixed at origination — scenarios affect only what the funder collects at resolution.
          </p>

          {/* Capital flow waterfall */}
          <div className="mb-8">
            <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">CAPITAL FLOW</div>
            <div className="space-y-2.5">
              {[
                { label:"FACE VALUE",        value:totalValue,                                  color:"#D4CCBC", textColor:"text-stone-500" },
                { label:"EXPECTED RECOVERY", value:totalExpected,                               color:"#78716c", textColor:"text-stone-600" },
                { label:"ADVANCE DEPLOYED",  value:advanceValue,                                color:"#064e3b", textColor:"text-emerald-900" },
                { label:"PROJECTED NET",     value:adjustedNet,                                 color:"#10b981", textColor:"text-emerald-700" },
              ].map(row => {
                const pct = totalValue > 0 ? Math.round(row.value/totalValue*100) : 0
                return (
                  <div key={row.label} className="flex items-center gap-3 sm:gap-4">
                    <div className="mono-font text-[9px] tracking-widest text-stone-400 w-32 sm:w-40 shrink-0 text-right">{row.label}</div>
                    <div className="flex-1" style={{ background:"#EEE9E0", height:"20px", position:"relative", minWidth:0 }}>
                      <div style={{ position:"absolute", top:0, left:0, height:"100%", width:`${pct}%`, background:row.color, transition:"width 0.4s ease" }} />
                    </div>
                    <div className={`mono-font text-xs shrink-0 w-36 sm:w-44 ${row.textColor}`}>
                      ${Math.round(row.value).toLocaleString()} <span className="text-stone-400">({pct}%)</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Scenario table */}
          <div className="mb-8">
            <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">SCENARIO ANALYSIS</div>
            <div className="border border-stone-300 overflow-hidden" style={{ background:"#FAF7F1" }}>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth:"580px" }}>
                  <thead>
                    <tr className="border-b border-stone-200" style={{ background:"#EEE9E0" }}>
                      {["SCENARIO","EXPECTED RECOVERY","ADVANCE (FIXED)","NET TO FUNDER","RETURN","ANNUALIZED"].map(h => (
                        <th key={h} className={`px-4 py-2.5 mono-font text-[9px] tracking-widest text-stone-500 ${h==="SCENARIO"?"text-left":"text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label:"Base case",  sub:`Model as-is`,                  expected:totalExpected    },
                      { label:"Stress",     sub:`Win rates −20%`,               expected:stressExpected   },
                      { label:"Recovery",   sub:`30% partial on losing claims`,  expected:recoveryExpected },
                    ].map((s,i) => {
                      const scenNet    = s.expected - advanceValue + recourseBonus
                      const scenReturn = advanceValue > 0 ? scenNet/advanceValue : 0
                      const scenAnn    = advanceValue > 0 ? Math.round(((1+scenReturn)**(365/holdingDays)-1)*100) : 0
                      const pos        = scenNet > 0
                      return (
                        <tr key={s.label} className={`border-t border-stone-100 ${i===0?"":"bg-stone-50/30"}`}>
                          <td className="px-4 py-3">
                            <div className={`mono-font text-xs font-medium ${i===0?"text-stone-800":i===1?"text-red-800":"text-emerald-800"}`}>{s.label}</div>
                            <div className="display-font text-stone-400 text-[12px] italic mt-0.5">{s.sub}</div>
                          </td>
                          <td className="px-4 py-3 mono-font text-xs text-stone-700 text-right">${Math.round(s.expected).toLocaleString()}</td>
                          <td className="px-4 py-3 mono-font text-xs text-stone-400 text-right">${Math.round(advanceValue).toLocaleString()}</td>
                          <td className={`px-4 py-3 mono-font text-xs font-medium text-right ${pos?"text-emerald-800":"text-red-800"}`}>${Math.round(scenNet).toLocaleString()}</td>
                          <td className={`px-4 py-3 mono-font text-xs font-medium text-right ${pos?"text-emerald-800":"text-red-800"}`}>{Math.round(scenReturn*100)}%</td>
                          <td className={`px-4 py-3 mono-font text-xs font-medium text-right ${pos?"text-emerald-800":"text-red-800"}`}>{scenAnn}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recourse + holding period controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Recourse */}
            <div className="border border-stone-300 p-5" style={{ background:"#FAF7F1" }}>
              <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">RECOURSE STRUCTURE</div>
              <div className="flex gap-0 mb-4">
                {[["nonrecourse","Non-recourse"],["partial","Partial recourse"]].map(([val,lbl]) => (
                  <button key={val} onClick={() => setRecourseType(val)}
                    className={`mono-font text-[9px] tracking-wide px-3 py-2 border transition-colors flex-1 ${recourseType===val?"border-stone-900 bg-stone-900 text-stone-50":"border-stone-300 text-stone-500 hover:border-stone-600"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              {recourseType === "partial" ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="display-font text-stone-600 text-[13px]">Issuer refund on losses</span>
                    <span className="mono-font text-xs font-bold text-stone-900">{Math.round(refundPct*100)}%</span>
                  </div>
                  <input type="range" min="0.05" max="0.50" step="0.05" value={refundPct} onChange={e => setRefundPct(parseFloat(e.target.value))} className="w-full" />
                  <div className="flex justify-between mono-font text-[9px] text-stone-400 mt-1 mb-3"><span>5%</span><span>25%</span><span>50%</span></div>
                  <div className="mono-font text-[9px] tracking-widest text-emerald-700">+${Math.round(recourseBonus).toLocaleString()} expected refund · improves net return by {advanceValue>0?Math.round(recourseBonus/advanceValue*100):0}pp</div>
                </div>
              ) : (
                <p className="display-font text-stone-500 text-[13px] leading-relaxed">Funder bears all credit losses. No refund from issuer on losing claims. Full downside risk sits with the funder.</p>
              )}
            </div>

            {/* Holding period */}
            <div className="border border-stone-300 p-5" style={{ background:"#FAF7F1" }}>
              <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">RESOLUTION WINDOW</div>
              <div className="flex items-center justify-between mb-2">
                <span className="display-font text-stone-600 text-[13px]">Average holding period</span>
                <span className="mono-font text-xs font-bold text-stone-900">{holdingDays} days</span>
              </div>
              <input type="range" min="45" max="180" step="15" value={holdingDays} onChange={e => setHoldingDays(parseInt(e.target.value))} className="w-full" />
              <div className="flex justify-between mono-font text-[9px] text-stone-400 mt-1 mb-4"><span>45d</span><span>90d</span><span>135d</span><span>180d</span></div>
              <div className="border-t border-stone-200 pt-4 space-y-2">
                {[
                  { label:"Gross return on advance", val:`${roaPercent}%` },
                  { label:`Annualized (${holdingDays}d)`, val:`~${annualizedIRR}%`, bold:true },
                  { label:"Est. net after 15% costs", val:`~${Math.round(annualizedIRR*0.85)}%`, muted:true },
                ].map(r => (
                  <div key={r.label} className="flex justify-between">
                    <span className="display-font text-stone-500 text-[13px]">{r.label}</span>
                    <span className={`mono-font text-xs font-medium ${r.muted?"text-stone-400":r.bold?"text-emerald-800":"text-stone-700"}`}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Underwriting criteria ── */}
        <div className="section-divider" />
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-500 mb-4">UNDERWRITING CRITERIA</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { title:"RECOVERY PROBABILITY (55%)", body:"Reason code base win rate adjusted separately for fraud and consumer signals. Fraud: AVS mismatch, 3DS absence, VFMP enrollment (positive); PIN verification (severe negative). Consumer: delivery confirmation (negative), merchant acknowledgement, documentation strength. Merchant CBR uses a sliding scale — high CBR signals systemic bad-actor risk; very clean merchants fight representment harder. Prior claim history applies a 7% penalty per claim." },
              { title:"TIME VALUE (25%)", body:"Days remaining in the filing window, decayed non-linearly. Inside 30 days: material discount. Inside 15 days: severe penalty. Visa's standard window is 120 days; fraud codes extend further. Claims inside 15 days should rarely be funded — time pressure disadvantages the issuer at every stage of the process and reduces funder negotiating leverage." },
              { title:"AMOUNT EFFICIENCY (20%)", body:"Funder overhead — legal, operational, servicing — is roughly fixed per claim. Sub-$100 claims rarely justify the cost. Above $2,000 introduces single-claim concentration risk. The sweet spot is $200–$2,000. Portfolio advance rates: A → 65% / B → 55% / C → 44% / D → 30% of probability-weighted expected recovery. Override with the advance rate slider above." },
            ].map(m => (
              <div key={m.title}>
                <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-2">{m.title}</div>
                <p className="display-font text-stone-600 text-[14px] leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Disclaimer ── */}
        <div className="section-divider" />
        <div className="flex items-start gap-3 border border-amber-700 bg-amber-50 p-4">
          <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <p className="display-font text-stone-800 text-[13px] leading-relaxed">
            Win-rate baselines approximate Visa issuer dispute outcome data and carry model uncertainty. Advance rates and portfolio grade reflect expected value — actual recovery depends on evidence quality, merchant behaviour at representment, and network rule changes. Annualized returns assume resolution within the modelled window. Not legal or financial advice.
          </p>
        </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsView({ settings, setSettings }) {
  const set = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))
  const FIELDS = [
    { key:'smallDollarThreshold', label:'Small-Dollar Write-Off Threshold ($)' },
    { key:'sarThreshold',         label:'SAR Flag Threshold ($)' },
    { key:'fraudWindowDays',      label:'Fraud Filing Window (days)' },
    { key:'consumerWindowDays',   label:'Consumer Filing Window (days)' },
    { key:'absoluteCapDays',      label:'Absolute Filing Cap (days)' },
    { key:'trackerWindowDays',    label:'Tracker Window (days)' },
  ]
  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <div className="mb-8 pb-6" style={{ borderBottom:'1px solid #D4CCBC' }}>
        <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(40px,6vw,72px)', letterSpacing:'-0.03em' }}>
          Settings
        </h1>
        <p className="display-font text-stone-600 mt-3" style={{ fontSize:'clamp(14px,1.8vw,16px)', lineHeight:1.5 }}>
          Compliance thresholds and operational defaults applied across all tools.
        </p>
      </div>
      <div style={{ maxWidth:'480px', display:'grid', gap:'24px' }}>
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="cov-label">{label}</label>
            <input type="number" value={settings[key]}
              onChange={e => set(key, Number(e.target.value))}
              className="cov-input mono-font" style={{ fontSize:'14px', maxWidth:'320px' }} />
          </div>
        ))}
        <div style={{ display:'flex', gap:'12px', paddingTop:'8px' }}>
          <button onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
            className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'8px 16px', border:'1px solid #A09585', color:'#6B5F4D', background:'transparent', cursor:'pointer' }}>
            RESET TO DEFAULTS
          </button>
        </div>
      </div>
    </div>
  )
}

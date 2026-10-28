// ═══════════════════════════════════════════════════════════════════════════════
// ALERTS PANEL — transaction monitoring alerts, in two places:
//   005 Licit → Alerts   (kind 'aml')    money laundering, sanctions
//   001 Triage → Alerts  (kind 'fraud')  customers being robbed
// ═══════════════════════════════════════════════════════════════════════════════
// One import feeds both: the transaction file (and an optional account-events
// file) is stored once, both rule sets run, and each alert shows up where it
// belongs. Data sent through the API (api/intake.js) lands here the same way.
// Import a day's transactions (core banking or processor export), run the rules
// (monitoring.mjs) over each customer's last 30 days, screen counterparties and
// wallets against OFAC, and work the alerts: close one as not suspicious with a
// reason, or escalate it to an AML case — which gets a SAR review and the
// 30-day clock, and is worked like any other case in Licit.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { canWrite } from './auth.js'
import { auditWrite } from './audit.js'
import { openCase } from './CaseThread.jsx'
import { parseCsv, MAX_BYTES } from './csvImport.js'
import { TX_FIELDS, EV_FIELDS, guessTxMapping, guessEvMapping, buildTransactions, buildEvents, evaluate, evaluateFraud, screenables, sanctionsAlert, sampleDay, sampleEvents, sampleDayExchange, sampleEventsExchange, RULES } from './monitoring.mjs'
import { ingest, ingestEvents, windowFor, windowByNames, eventsWindow, batches as listBatches, addAlerts, listAlerts, setAlert } from './monitoringData.js'
import { FraudAlertDetail } from './FraudAlertDetail.jsx'
import { detectDateFormat } from './csvImport.js'
import { Badge, Button } from './ui.jsx'

const DAY = 86400000
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString()
const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px', marginBottom:'20px' }
const SEV = { high: 'danger', medium: 'warn', low: 'neutral' }
const CLOSE_REASONS = ['Explained by the customer, with evidence', 'Matches the customer’s known business or income', 'Duplicate of another alert or case', 'Data error in the transaction file', 'Below our level of concern after review']

async function screenBatch(txs, threshold) {
  const { names, wallets } = screenables(txs)
  const hits = []
  for (let i = 0; i < Math.max(names.length, wallets.length); i += 20) {
    const r = await fetch('/api/sanctions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjects: names.slice(i, i + 20).map(name => ({ role: 'Counterparty', name })), wallets: wallets.slice(i, i + 20), threshold }) })
    if (!r.ok) throw new Error('Sanctions screening is unavailable right now')
    const d = await r.json()
    d.results.forEach(x => x.hits.forEach(h => hits.push({ ...h, subject: x.name })))
    d.walletResults.forEach(x => x.hits.forEach(h => hits.push({ ...h, subject: x.address, wallet: true })))
  }
  return hits
}

export function AlertsPanel({ kind = 'aml', segment = 'fi', outcomes, setOutcomes, settings, covUser, route, institution }) {
  // Licit shows every AML alert; Triage shows fraud alerts for the side picked (bank / credit union, or crypto exchange)
  const seg = kind === 'fraud' ? segment : null
  const writer = canWrite()
  const [file, setFile] = useState(null)          // { name, headers, rows }
  const [evFile, setEvFile] = useState(null)      // optional account events { name, headers, rows, mapping }
  const evRef = useRef(null)
  const [mapping, setMapping] = useState({})
  const [dateFormat, setDateFormat] = useState('mdy')
  const [run, setRun] = useState(null)            // { stage, done, total, summary, error }
  const [alerts, setAlerts] = useState([])
  const [filter, setFilter] = useState('open')
  const [imports, setImports] = useState([])
  const [open, setOpenId] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const inputRef = useRef(null)

  const refresh = () => {
    listAlerts().then(setAlerts).catch(e => setLoadErr(e.message))
    listBatches().then(setImports).catch(() => {})
  }
  useEffect(refresh, [])

  const loadEvents = async (f, text) => {
    const p = parseCsv(text ?? await f.text())
    if (!p.rows.length) return setRun({ error: 'The events file has no rows under a header line.' })
    setEvFile({ name: f?.name || 'sample-events.csv', headers: p.headers, rows: p.rows, mapping: guessEvMapping(p.headers) })
  }
  const load = async (f, text) => {
    setRun(null)
    if (f && f.size > MAX_BYTES) return setRun({ error: 'Files up to 10 MB can be imported — split it and import each part.' })
    const p = parseCsv(text ?? await f.text())
    if (!p.rows.length) return setRun({ error: 'That file has no rows under a header line.' })
    if (p.rows.length > 50000) return setRun({ error: `That file has ${p.rows.length.toLocaleString()} rows; up to 50,000 at a time.` })
    const map = guessTxMapping(p.headers)
    setFile({ name: f?.name || 'sample-day.csv', headers: p.headers, rows: p.rows })
    setMapping(map)
    setDateFormat(map.date != null ? detectDateFormat(p.rows.map(r => String(r[map.date] || '').split(/[ T]/)[0])) : 'mdy')
  }
  const missing = TX_FIELDS.filter(f => f.required && mapping[f.key] == null)

  const go = async () => {
    const batch = 'TMB-' + Date.now().toString(36).toUpperCase()
    try {
      setRun({ stage: 'Reading the file' })
      const { txs, errors } = buildTransactions(file.rows, { mapping, dateFormat, batch })
      if (!txs.length) return setRun({ error: `No transactions could be read. First problem: row ${errors[0]?.row}: ${errors[0]?.message}` })
      const ev = evFile ? buildEvents(evFile.rows, { mapping: evFile.mapping, dateFormat, batch }) : { events: [], errors: [] }
      setRun({ stage: 'Storing transactions', done: 0, total: txs.length })
      const added = await ingest(txs, (done, total) => setRun({ stage: 'Storing transactions', done, total }))
      if (ev.events.length) { setRun({ stage: 'Storing account events' }); await ingestEvents(ev.events) }
      setRun({ stage: 'Running the fraud and AML rules' })
      const customers = [...new Set([...txs.map(t => t.customerId), ...ev.events.map(e => e.customerId)])]
      const earliest = txs.reduce((m, t) => Math.min(m, new Date(t.ts).getTime()), Infinity)
      // 120 days back, for the dormant-account rule; the AML rules look at the last 30 within it
      const history = await windowFor(customers, new Date(earliest - 120 * DAY).toISOString())
      const events = await eventsWindow(customers, new Date(earliest - 7 * DAY).toISOString()).catch(() => [])
      // Confirmed card-fraud cases: where did the victims shop? (compromised-merchant rule)
      const fraudCases = outcomes.filter(c => c.verdict === 'TRUE_FRAUD' && c.cardholderName && !c.kind && Date.now() - new Date(c.date || 0) < 90 * DAY)
        .map(c => ({ id: c.id, customerName: c.cardholderName, date: c.date }))
      const victimTx = fraudCases.length ? await windowByNames([...new Set(fraudCases.map(c => c.customerName))], new Date(earliest - 150 * DAY).toISOString()).catch(() => []) : []
      const seen = new Set(history.map(t => t.id)), allTx = [...history, ...victimTx.filter(t => !seen.has(t.id))]
      const fresh = [...txs.map(t => t.id), ...ev.events.map(e => e.id)]
      const ruleAlerts = [...evaluate(history.filter(t => new Date(t.ts) > earliest - 31 * DAY), txs.map(t => t.id), settings, new Date(), { segment }), ...evaluateFraud(allTx, events, fresh, settings, fraudCases, new Date(), { segment })]
      setRun({ stage: 'Screening counterparties against OFAC' })
      let screenNote = ''
      const sanc = []
      try {
        const hits = await screenBatch(txs, settings?.screeningThreshold ?? 0.9)
        // One alert per customer and counterparty, carrying its best match (and how many others)
        const bySubject = new Map()
        hits.forEach(h => { if (!bySubject.has(h.subject)) bySubject.set(h.subject, []); bySubject.get(h.subject).push(h) })
        bySubject.forEach((list, subject) => {
          list.sort((a, b) => b.score - a.score)
          const best = { ...list[0], others: list.length - 1 }
          const involved = txs.filter(t => (best.wallet ? t.wallet === subject : t.counterparty === subject))
          const byCustomer = new Map(); involved.forEach(t => { if (!byCustomer.has(t.customerId)) byCustomer.set(t.customerId, []); byCustomer.get(t.customerId).push(t) })
          byCustomer.forEach((tl, cid) => sanc.push(sanctionsAlert(cid, tl[0].customerName, tl, best, new Date(), segment)))
        })
      } catch (e) { screenNote = ` Sanctions screening was skipped: ${e.message}.` }
      const all = [...sanc, ...ruleAlerts]
      const raised = all.length ? await addAlerts(all) : 0
      auditWrite('transactions.imported', 'workspace', batch, { file: file.name, rows: file.rows.length, stored: added, problems: errors.length, events: ev.events.length })
      if (raised) auditWrite('alerts.raised', 'workspace', batch, { alerts: raised, rules: [...new Set(all.map(a => a.rule))].join(', ') })
      const nf = all.filter(x => x.kind === 'fraud').length, na = all.length - nf
      setRun({ summary: `${txs.length.toLocaleString()} transactions${ev.events.length ? ` and ${ev.events.length} account events` : ''} read (${added.toLocaleString()} new), ${customers.length.toLocaleString()} customers checked. ${raised} new alert${raised === 1 ? '' : 's'}: ${nf} fraud (001 Triage), ${na} AML (005 Licit).${errors.length ? ` ${errors.length} row${errors.length === 1 ? '' : 's'} couldn’t be read.` : ''}${screenNote}`, errors })
      setFile(null); setEvFile(null); setFilter('open'); refresh()
    } catch (e) { setRun({ error: e.message }) }
  }

  const mine = alerts.filter(a => (a.kind || 'aml') === kind && (!seg || (a.segment || 'fi') === seg))
  const shown = mine.filter(a => filter === 'all' || a.status === filter)
  const counts = useMemo(() => mine.reduce((m, a) => (m[a.status] = (m[a.status] || 0) + 1, m), {}), [alerts, kind])

  return (<>
    {/* ── Import ── */}
    <section style={box}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'12px', flexWrap:'wrap' }}>
        <h2 className="display-font" style={{ fontSize:'20px', fontWeight:600, color:'#1A1814', margin:0 }}>Import transactions</h2>
        <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{imports.length ? `Last import ${day(imports[0].imported_at)} · ${imports.reduce((n, b) => n + Number(b.transactions), 0).toLocaleString()} transactions stored` : 'Nothing imported yet'}</span>
      </div>
      <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'8px 0 12px', lineHeight:1.5, maxWidth:'760px' }}>
        {segment === 'ce' ? 'A day of deposits and withdrawals from your exchange, as CSV — plus,' : 'A day’s transactions from your core system or processor, as CSV — plus,'} optionally, account events (logins, new devices, profile changes). Fraud alerts go to 001 Triage, AML alerts to 005 Licit. Systems can also send data directly (Settings → Connections).
      </p>
      {writer ? (<>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display:'none' }} onChange={e => { load(e.target.files?.[0]); e.target.value = '' }} />
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose a file</Button>
          <Button variant="quiet" onClick={() => segment === 'ce' ? (load(null, sampleDayExchange()), loadEvents(null, sampleEventsExchange())) : (load(null, sampleDay()), loadEvents(null, sampleEvents()))}>Try a sample day{segment === 'ce' ? ' (exchange)' : ''}</Button>
        </div>
      </>) : <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Your role can read alerts but not import.</p>}
      {file && (
        <div style={{ marginTop:'14px' }}>
          <div className="mono-font" style={{ fontSize:'11px', color:'#57534E', marginBottom:'8px' }}>{file.name} — {file.rows.length.toLocaleString()} rows. Check the columns:</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:'8px 14px' }}>
            {TX_FIELDS.map(f => (
              <label key={f.key} className="display-font" style={{ fontSize:'13px', display:'grid', gap:'3px' }}>
                <span>{f.label}{f.required && <span style={{ color:'#991B1B' }}> *</span>}</span>
                <select className="input-field" value={mapping[f.key] ?? ''} onChange={e => setMapping(m => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n })} style={{ padding:'6px 8px', fontSize:'13px' }}>
                  <option value="">— not in file —</option>
                  {file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
            <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'3px' }}>
              <span>Dates are</span>
              <select className="input-field" value={dateFormat} onChange={e => setDateFormat(e.target.value)} style={{ padding:'6px 8px', fontSize:'13px' }}>
                <option value="mdy">Month first (10/03)</option><option value="dmy">Day first (03/10)</option><option value="iso">Year first</option><option value="excel">Excel numbers</option>
              </select>
            </label>
          </div>
          <div style={{ marginTop:'12px', display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
            <input ref={evRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display:'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) loadEvents(f); e.target.value = '' }} />
            {evFile ? (
              <span className="mono-font" style={{ fontSize:'11px', color:'#065F46' }}>Account events: {evFile.name} — {evFile.rows.length} rows ({EV_FIELDS.filter(f => evFile.mapping[f.key] != null).length}/{EV_FIELDS.length} columns matched)
                {EV_FIELDS.some(f => f.required && evFile.mapping[f.key] == null) && <span style={{ color:'#991B1B' }}> — missing {EV_FIELDS.filter(f => f.required && evFile.mapping[f.key] == null).map(f => f.label.toLowerCase()).join(', ')}</span>}
                {' '}<button onClick={() => setEvFile(null)} style={{ background:'none', border:'none', color:'#57534E', textDecoration:'underline', cursor:'pointer', font:'inherit' }}>remove</button></span>
            ) : <Button variant="quiet" onClick={() => evRef.current?.click()}>Add account events (optional)</Button>}
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center', marginTop:'12px', flexWrap:'wrap' }}>
            <Button disabled={!!missing.length || !!run?.stage || (evFile && EV_FIELDS.some(f => f.required && evFile.mapping[f.key] == null))} onClick={go}>Import and run the rules</Button>
            <Button variant="quiet" onClick={() => { setFile(null); setEvFile(null) }}>Cancel</Button>
            {missing.length > 0 && <span className="mono-font" style={{ fontSize:'11px', color:'#991B1B' }}>Choose a column for {missing.map(f => f.label.toLowerCase()).join(', ')}.</span>}
          </div>
        </div>
      )}
      {run?.stage && <p role="status" className="mono-font" style={{ fontSize:'11px', color:'#1E3A5F', margin:'12px 0 0' }}>{run.stage}{run.total ? ` — ${run.done.toLocaleString()} of ${run.total.toLocaleString()}` : '…'}</p>}
      {run?.summary && <p role="status" className="display-font" style={{ fontSize:'14px', color:'#065F46', margin:'12px 0 0' }}>{run.summary}</p>}
      {run?.error && <p role="alert" className="display-font" style={{ fontSize:'14px', color:'#991B1B', margin:'12px 0 0' }}>{run.error}</p>}
    </section>

    {/* ── Alerts ── */}
    <div role="tablist" aria-label="Alert status" style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'12px' }}>
      {[['open', 'Open'], ['escalated', 'Escalated'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => (
        <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className="mono-font"
          style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'6px 12px', border:'1px solid #1A1814', cursor:'pointer', background: filter === k ? '#1A1814' : 'transparent', color: filter === k ? '#F5F1EA' : '#1A1814' }}>
          {l.toUpperCase()} {k === 'all' ? mine.length : counts[k] || 0}
        </button>
      ))}
    </div>
    {loadErr && <p role="alert" className="display-font" style={{ fontSize:'14px', color:'#991B1B' }}>{loadErr}</p>}
    {shown.length === 0 ? <p className="display-font" style={{ ...box, fontStyle:'italic', color:'#57534E' }}>{filter === 'open' ? 'No open alerts.' : 'Nothing here.'}</p> : (
      <div style={{ border:'1px solid #D4CCBC', marginBottom:'20px' }}>
        {shown.map(a => (
          <div key={a.id} style={{ borderTop:'1px solid #E7E2D9', background: open === a.id ? '#FFFFFF' : '#FAF7F1' }}>
            <button onClick={() => setOpenId(o => o === a.id ? null : a.id)} aria-expanded={open === a.id}
              style={{ display:'grid', gridTemplateColumns:'78px minmax(0,1fr) auto', gap:'12px', width:'100%', textAlign:'left', background:'none', border:'none', padding:'12px 16px', cursor:'pointer', alignItems:'center' }}>
              <span><Badge tone={SEV[a.severity]}>{a.severity.toUpperCase()}</Badge></span>
              <span style={{ minWidth:0 }}>
                <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814' }}>{a.label} <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>· {a.customerName || a.customerId}</span></span>
                <span className="mono-font" style={{ display:'block', fontSize:'11px', color:'#57534E', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.detail}</span>
              </span>
              <span className="mono-font" style={{ fontSize:'11px', color:'#1A1814', textAlign:'right', whiteSpace:'nowrap' }}>{money(a.total)}<br /><span style={{ color:'#6B6259' }}>{a.status === 'open' ? day(a.to) : a.status}</span></span>
            </button>
            {open === a.id && (kind === 'fraud'
              ? <FraudAlertDetail a={a} segment={a.segment || 'fi'} covUser={covUser} writer={writer} institution={institution} route={route} onDone={close => { if (close) setOpenId(null); refresh() }} />
              : <AlertDetail a={a} outcomes={outcomes} setOutcomes={setOutcomes} covUser={covUser} writer={writer} onDone={() => { setOpenId(null); refresh() }} />)}
          </div>
        ))}
      </div>
    )}
  </>)
}

// An AML case built from an alert (used by Licit, and by Triage when the customer turns out to be involved)
export function amlCaseFrom(a, txs, who) {
  const now = new Date().toISOString()
  const slimTx = (txs || []).slice(0, 50).map(t => ({ id: t.id, ts: t.ts, amount: t.amount, currency: t.currency, direction: t.direction, channel: t.channel, counterparty: t.counterparty, country: t.country, wallet: t.wallet }))
  const top = Object.entries((txs || []).reduce((m, t) => (t.counterparty ? (m[t.counterparty] = (m[t.counterparty] || 0) + t.amount, m) : m), {})).sort((x, y) => y[1] - x[1])[0]?.[0]
  return { id: 'AML-' + Date.now().toString(36).toUpperCase().slice(-6), kind: 'aml', amlCustomerId: a.customerId, date: now, status: 'aml_review', accountType: 'aml',
    cardholderName: a.customerName || a.customerId, merchant: top || 'Account activity', amount: `${Number(a.total).toFixed(2)} USD`, verdict: '',
    _complaint: `Monitoring alert: ${a.label}. ${a.detail}`, alerts: [{ id: a.id, rule: a.rule, label: a.label, severity: a.severity, detail: a.detail, total: a.total, from: a.from, to: a.to }],
    tmTransactions: slimTx, notes: [], docs: [], sarReview: { flaggedAt: now, level: a.severity, signals: [a.rule], by: who, referredFrom: a.kind === 'fraud' ? 'Fraud alert' : 'Monitoring' },
    history: [{ ts: now, event: 'created_from_alert', alert: a.label, by: who }] }
}

function AlertDetail({ a, outcomes, setOutcomes, covUser, writer, onDone }) {
  const [txs, setTxs] = useState(null)
  const [mode, setMode] = useState(null)
  const [reason, setReason] = useState(''), [note, setNote] = useState(''), [err, setErr] = useState('')
  useEffect(() => {
    windowFor([a.customerId], new Date(new Date(a.from || a.to).getTime() - DAY).toISOString())
      .then(rows => setTxs(rows.filter(t => a.txIds.includes(t.id)))).catch(() => setTxs([]))
  }, [a.id])
  const who = covUser?.name || covUser?.email || 'Analyst'
  const existing = outcomes.find(c => c.kind === 'aml' && c.amlCustomerId === a.customerId && !['closed', 'withdrawn'].includes(c.status))

  const close = async () => {
    try {
      await setAlert(a.id, 'closed', { disposition: { reason, note, by: who, ts: new Date().toISOString() } })
      auditWrite('alert.closed', 'alert', a.id, { customer: a.customerId, rule: a.rule, reason, note })
      onDone()
    } catch (e) { setErr(e.message) }
  }
  const escalate = async () => {
    const now = new Date().toISOString()
    const slimTx = (txs || []).slice(0, 50).map(t => ({ id: t.id, ts: t.ts, amount: t.amount, currency: t.currency, direction: t.direction, channel: t.channel, counterparty: t.counterparty, country: t.country, wallet: t.wallet }))
    const alertRef = { id: a.id, rule: a.rule, label: a.label, severity: a.severity, detail: a.detail, total: a.total, from: a.from, to: a.to }
    let caseId = existing?.id
    if (existing) {
      setOutcomes(prev => prev.map(c => c.id === existing.id ? { ...c, alerts: [...(c.alerts || []), alertRef], tmTransactions: [...(c.tmTransactions || []), ...slimTx].slice(-200),
        history: [...(c.history || []), { ts: now, event: 'alert_added', alert: a.label, by: who }] } : c))
    } else {
      caseId = 'AML-' + Date.now().toString(36).toUpperCase().slice(-6)
      const top = Object.entries((txs || []).reduce((m, t) => (t.counterparty ? (m[t.counterparty] = (m[t.counterparty] || 0) + t.amount, m) : m), {})).sort((x, y) => y[1] - x[1])[0]?.[0]
      setOutcomes(prev => [{
        id: caseId, kind: 'aml', amlCustomerId: a.customerId, date: now, status: 'aml_review', accountType: 'aml',
        cardholderName: a.customerName || a.customerId, merchant: top || 'Account activity', amount: `${Number(a.total).toFixed(2)} USD`,
        verdict: '', _complaint: `Monitoring alert: ${a.label}. ${a.detail}`, alerts: [alertRef], tmTransactions: slimTx, notes: [], docs: [],
        sarReview: { flaggedAt: now, level: a.severity, signals: [a.rule], by: who, referredFrom: 'Monitoring' },
        history: [{ ts: now, event: 'created_from_alert', alert: a.label, by: who }],
      }, ...prev])
    }
    try {
      await setAlert(a.id, 'escalated', { escalatedTo: caseId, by: who, ts: now })
      auditWrite('alert.escalated', 'alert', a.id, { customer: a.customerId, rule: a.rule, case: caseId })
      onDone(); openCase(caseId)
    } catch (e) { setErr(e.message) }
  }

  return (
    <div style={{ padding:'4px 16px 16px' }}>
      <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 8px', lineHeight:1.5 }}>
        <strong>Why:</strong> {a.detail}. <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>Rule: {RULES[a.rule]?.label || a.rule} · SAR category: {RULES[a.rule]?.sar} · customer {a.customerId}</span>
      </p>
      {txs === null ? <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Loading the transactions…</p> : (
        <div style={{ overflowX:'auto', marginBottom:'12px' }}>
          <table className="mono-font" style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
            <thead><tr>{['Date', 'In/out', 'Amount', 'Channel', 'Counterparty', 'Country', 'Wallet'].map(h => <th key={h} scope="col" style={{ textAlign:'left', padding:'5px 8px', color:'#57534E', fontWeight:500, borderBottom:'1px solid #D4CCBC' }}>{h}</th>)}</tr></thead>
            <tbody>{txs.map(t => (
              <tr key={t.id}>{[day(t.ts), t.direction === 'in' ? 'In' : 'Out', `${money(t.amount)}`, t.channel, t.counterparty || '—', t.country || '—', t.wallet ? t.wallet.slice(0, 10) + '…' : '—'].map((v, i) => (
                <td key={i} style={{ padding:'5px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace:'nowrap', color: i === 1 && v === 'Out' ? '#92400E' : '#1A1814' }}>{v}</td>))}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {a.status !== 'open' ? (
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:0 }}>
          {a.status === 'closed' ? <>Closed by {a.disposition?.by}, {day(a.disposition?.ts)}: {a.disposition?.reason}. “{a.disposition?.note}”</>
            : <>Escalated by {a.by} to <button onClick={() => openCase(a.escalatedTo)} style={{ background:'none', border:'none', padding:0, color:'#1E3A5F', textDecoration:'underline', cursor:'pointer', font:'inherit' }}>{a.escalatedTo}</button>.</>}
        </p>
      ) : !writer ? <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Your role can’t work alerts.</p>
      : mode === 'close' ? (
        <div style={{ display:'grid', gap:'8px', maxWidth:'560px' }}>
          <select className="input-field" value={reason} onChange={e => setReason(e.target.value)} style={{ padding:'7px 9px', fontSize:'14px' }} aria-label="Why this isn't suspicious">
            <option value="">— why isn’t this suspicious? —</option>{CLOSE_REASONS.map(r => <option key={r}>{r}</option>)}
          </select>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="What you checked" className="cov-input" style={{ padding:'8px 10px', fontSize:'14px', fontFamily:'inherit' }} aria-label="What you checked" />
          <div style={{ display:'flex', gap:'8px' }}>
            <Button small disabled={!reason || note.trim().length < 5} onClick={close}>Close the alert</Button>
            <Button variant="quiet" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <Button variant="danger" onClick={escalate} disabled={txs === null}>{existing ? `Add to ${existing.id}` : 'Escalate to a case'}</Button>
          <Button variant="secondary" onClick={() => setMode('close')}>Close — not suspicious</Button>
        </div>
      )}
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B' }}>{err}</p>}
    </div>
  )
}

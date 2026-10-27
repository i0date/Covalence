// 003 MULTI — queues, batch filing, My Queue, Intel
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { evidencePath, CaseLink } from '../CaseThread.jsx'
import { fetchAgents } from '../data.js'
import { notesList, registerOutcomeSubscriber, saveOutcomes } from '../shared.jsx'

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ═══════════════════════════════════════════════════════════════════════════════
// ─── MULTI — Bulk dispute management ──────────────────────────────────────────
export function MultiView({ outcomes: _propOutcomes, setOutcomes: setAppOutcomes, settings, setActiveSection, covUser }) {
  // Read live from localStorage so DeskView changes appear immediately
  const [outcomes, setLiveOutcomes] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('cov_outcomes') || '[]') } catch { return _propOutcomes || [] }
  })
  // Subscribe to all outcome changes (same-tab and cross-tab)
  React.useEffect(() => {
    const refresh = (merged) => {
      const fresh = merged || JSON.parse(localStorage.getItem('cov_outcomes') || '[]')
      setLiveOutcomes(fresh)
    }
    const unregister = registerOutcomeSubscriber(refresh)
    const storageHandler = (e) => { if (e.key === 'cov_outcomes' && !window._covSaving) refresh() }
    window.addEventListener('storage', storageHandler)
    return () => { unregister(); window.removeEventListener('storage', storageHandler) }
  }, [])
  // Wrapper that keeps localStorage + App state in sync
  const setOutcomes = React.useCallback((updater) => {
    setLiveOutcomes(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try { saveOutcomes(next) } catch {}
      if (setAppOutcomes) setAppOutcomes(next)
      return next
    })
  }, [setAppOutcomes])

  const [noteOpen,      setNoteOpen]      = React.useState({})
  const [noteDraft,     setNoteDraft]     = React.useState({})
  const [selectedIds,   setSelectedIds]   = React.useState([])
  const [assignFilter,  setAssignFilter]  = React.useState('all')
  const [agentList,     setAgentList]     = React.useState([])
  const [assignOpen,    setAssignOpen]    = React.useState({})
  // Portfolio Analytics moved into Intel tab
  const [multiSearch,   setMultiSearch]   = React.useState('')
  const [multiTab,      setMultiTab]      = React.useState('queue') // 'queue'|'myqueue'

  const isFraudCase = o => (o.verdict === 'TRUE_FRAUD' || o.verdict === 'AUTHORIZED_PUSH_PAYMENT' || o.fraud_sub_type || o.category === 'fraud' || o.category === 'mc_fraud')
  const myEmail = covUser?.email||''
  const applyFilter = arr => assignFilter==='mine' ? arr.filter(o=>o.assignedTo===myEmail) : assignFilter==='unassigned' ? arr.filter(o=>!o.assignedTo) : arr
  const _applySearch = arr => {
    if (!multiSearch.trim()) return arr
    const q = multiSearch.toLowerCase()
    return arr.filter(o => (o.id||'').toLowerCase().includes(q) || (o.merchant||'').toLowerCase().includes(q) || (o.cardholderName||'').toLowerCase().includes(q) || (o.reasonCode||'').toLowerCase().includes(q) || (o.amount||'').toString().includes(q))
  }
  const queuedFraud   = _applySearch(applyFilter(outcomes.filter(o => o.status === 'queued' && isFraudCase(o))))
  const queuedService = _applySearch(applyFilter(outcomes.filter(o => o.status === 'queued' && !isFraudCase(o))))
  const [filed, setFiled] = React.useState(false)
  const [pkgModal, setPkgModal] = React.useState(null)   // { caseId, network, text } | null

  // ── 3pm auto-file ──────────────────────────────────────────────────────────
  const [autoFile, setAutoFile] = React.useState(() => {
    try { return localStorage.getItem('cov_autobatch_3pm') === 'on' } catch { return false }
  })
  const [batchCountdown, setBatchCountdown] = React.useState('')
  const [nearBatch, setNearBatch]   = React.useState(false)
  const queuedFraudRef = React.useRef(queuedFraud)
  queuedFraudRef.current = queuedFraud
  const autoFileFired = React.useRef(false)

  React.useEffect(() => {
    const tick = () => {
      const now = new Date()
      const [bh, bm] = (settings?.batchFileTime || '15:00').split(':').map(Number)
      const target = new Date(now); target.setHours(bh, bm, 0, 0)
      if (now >= target) { target.setDate(target.getDate() + 1); autoFileFired.current = false }
      const diff = Math.max(0, target - now)
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setBatchCountdown(h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`)
      setNearBatch(diff < 15 * 60 * 1000) // within 15 min
      if (autoFile && diff <= 1000 && !autoFileFired.current && queuedFraudRef.current.length > 0) {
        autoFileFired.current = true
        const _autoAgent = localStorage.getItem('cov_agent_name') || ''
        setOutcomes(prev => prev.map(o => isFraudCase(o) && o.status === 'queued' ? { ...o, status: 'filed', filedAt: new Date().toISOString(), filedBy: _autoAgent || 'AUTO' } : o))
        setFiled(true)
        setTimeout(() => setFiled(false), 5000)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [autoFile])

  const toggleAutoFile = () => {
    const next = !autoFile
    setAutoFile(next)
    try { localStorage.setItem('cov_autobatch_3pm', next ? 'on' : 'off') } catch {}
  }

  const generateFilingPackage = (o) => {
    const net = (o.network || '').toLowerCase()
    const isVisa = net.includes('visa')
    const isMC   = net.includes('master')
    const isAmex = net.includes('amex') || net.includes('american')
    const isDiscover = net.includes('discover')
    const rc = o.reasonCode || ''
    const amtRaw = parseFloat((o.amount || '0').replace(/[^0-9.]/g,'')) || 0
    const amt = amtRaw.toFixed(2)
    const currency = (o.currency || 'USD').toUpperCase()
    const txDate = o._transactionDate || o.date || ''
    const filedDate = new Date().toISOString().split('T')[0]
    const instName = settings?.duoInstitutionName || '[INSTITUTION NAME]'
    const agentName = localStorage.getItem('cov_agent_name') || '[AGENT NAME]'
    const docs = (o.docs || [])
    const docManifest = docs.length
      ? docs.map((d,i) => `  ${String(i+1).padStart(2,'0')}. ${d.name} (${d.type||'unknown'}, ${d.size?`${(d.size/1024).toFixed(0)} KB`:'-'}) | ${d.uploadedAt?new Date(d.uploadedAt).toLocaleDateString('en-CA'):'-'} | ${d.uploadedBy||'-'} | ref ${evidencePath(d) || '-'}`).join('\n')
      : '  [NO DOCUMENTS ATTACHED — attach evidence in Dispute Desk before filing]'

    let body = ''

    if (isVisa) {
      body = `VISA CHARGEBACK SUBMISSION PACKAGE
═══════════════════════════════════════════════════════════════════
PACKAGE GENERATED:    ${filedDate}
ISSUER:               ${instName}
PREPARED BY:          ${agentName}
COVALENCE CASE ID:    ${o.id}
═══════════════════════════════════════════════════════════════════

DISPUTE DETAILS
───────────────────────────────────────────────────────────────────
CARDHOLDER NAME:      ${o.cardholderName || '[CARDHOLDER NAME]'}
CARD LAST 4:          ${o.cardLast4 || '[XXXX]'}
MERCHANT NAME:        ${o.merchant || '[MERCHANT NAME]'}
TRANSACTION DATE:     ${txDate}
TRANSACTION AMOUNT:   ${currency} ${amt}
DISPUTE AMOUNT:       ${currency} ${amt}
REASON CODE:          ${rc}
REASON DESCRIPTION:   ${o.verdict ? o.verdict.replace(/_/g,' ') : '[REASON DESCRIPTION]'}
CHARGEBACK REFERENCE: ${o.id}-VISA-${filedDate.replace(/-/g,'')}

VISA REASON CODE MAPPING
───────────────────────────────────────────────────────────────────
FUNCTION CODE:        ${rc.startsWith('10') ? '4853' : rc.startsWith('13') ? '4853' : rc}
DISPUTE CATEGORY:     ${rc.startsWith('10') ? 'Fraud (10.x)' : rc.startsWith('11') ? 'Authorization (11.x)' : rc.startsWith('12') ? 'Processing Error (12.x)' : rc.startsWith('13') ? 'Consumer Disputes (13.x)' : 'Other'}
VISA ONLINE QUEUE:    ${rc.startsWith('10') || rc.startsWith('11') ? 'FRAUD_OR_NOT_RECEIVED' : 'DISPUTE_RESOLUTION'}

REQUIRED FIELDS — VISA ONLINE
───────────────────────────────────────────────────────────────────
ACQUIRER REF NUMBER:  ${o.trackingRef || '[ARN — obtain from acquirer]'}
TRANSACTION ID:       ${o.transactionId || '[TRANSACTION ID]'}
AUTHORIZATION CODE:   ${o.authCode || '[AUTH CODE]'}
MCC:                  ${o.mcc || '[MCC]'}
3DS STATUS:           ${o.threeDSStatus || 'UNKNOWN'}

CARDHOLDER STATEMENT SUMMARY
───────────────────────────────────────────────────────────────────
${o._complaint ? o._complaint.substring(0,500) + (o._complaint.length > 500 ? '...' : '') : '[PASTE CARDHOLDER STATEMENT]'}

EVIDENCE MANIFEST (${docs.length} document${docs.length !== 1 ? 's' : ''})
───────────────────────────────────────────────────────────────────
${docManifest}

CERTIFICATION
───────────────────────────────────────────────────────────────────
I certify that this dispute has been received from the cardholder,
investigated in accordance with Visa Core Rules and Visa Product
and Service Rules, and that all information provided is accurate.

Prepared by: ${agentName}
Institution: ${instName}
Date:        ${filedDate}

NEXT STEPS
───────────────────────────────────────────────────────────────────
1. Upload this package to Visa Online → Disputes → New Dispute
2. Attach all evidence documents listed in manifest above
3. Enter ARN and transaction details in the Visa Online form
4. Submit and record Visa reference number back in Covalence
═══════════════════════════════════════════════════════════════════`
    } else if (isMC) {
      body = `MASTERCARD CHARGEBACK SUBMISSION PACKAGE
═══════════════════════════════════════════════════════════════════
PACKAGE GENERATED:    ${filedDate}
ISSUER:               ${instName}
PREPARED BY:          ${agentName}
COVALENCE CASE ID:    ${o.id}
═══════════════════════════════════════════════════════════════════

DISPUTE DETAILS
───────────────────────────────────────────────────────────────────
CARDHOLDER NAME:      ${o.cardholderName || '[CARDHOLDER NAME]'}
CARD LAST 4:          ${o.cardLast4 || '[XXXX]'}
MERCHANT NAME:        ${o.merchant || '[MERCHANT NAME]'}
TRANSACTION DATE:     ${txDate}
TRANSACTION AMOUNT:   ${currency} ${amt}
DISPUTE AMOUNT:       ${currency} ${amt}
REASON CODE:          ${rc}
REASON DESCRIPTION:   ${o.verdict ? o.verdict.replace(/_/g,' ') : '[REASON DESCRIPTION]'}
CHARGEBACK REFERENCE: ${o.id}-MC-${filedDate.replace(/-/g,'')}

MASTERCARD REASON CODE MAPPING
───────────────────────────────────────────────────────────────────
MC REASON CODE:       ${rc || '[4xxx — see MC Chargeback Guide]'}
DISPUTE CATEGORY:     ${rc==='4853'?'Cardholder Dispute':rc==='4863'?'Cardholder Does Not Recognize':rc==='4870'?'Chip Liability Shift':rc==='4871'?'Chip/PIN Liability Shift':rc==='4837'?'No Cardholder Authorization':rc==='4849'?'Questionable Merchant Activity':'See MC Chargeback Guide'}

REQUIRED FIELDS — MC CONNECT
───────────────────────────────────────────────────────────────────
ACQUIRER REF NUMBER:  ${o.trackingRef || '[ARN]'}
TRANSACTION ID:       ${o.transactionId || '[TRANSACTION ID]'}
AUTHORIZATION CODE:   ${o.authCode || '[AUTH CODE]'}
DE 38 (AUTH CODE):    ${o.authCode || '[DE 38 VALUE]'}
DE 22 (POS ENTRY):    ${o.posEntry || '[POS ENTRY MODE]'}
3DS STATUS:           ${o.threeDSStatus || 'UNKNOWN'}

CARDHOLDER STATEMENT SUMMARY
───────────────────────────────────────────────────────────────────
${o._complaint ? o._complaint.substring(0,500) + (o._complaint.length > 500 ? '...' : '') : '[PASTE CARDHOLDER STATEMENT]'}

EVIDENCE MANIFEST (${docs.length} document${docs.length !== 1 ? 's' : ''})
───────────────────────────────────────────────────────────────────
${docManifest}

CERTIFICATION
───────────────────────────────────────────────────────────────────
I certify that this dispute complies with the Mastercard Rules and
the Mastercard Chargeback Guide, and that all documentation has
been reviewed and authenticated.

Prepared by: ${agentName}
Institution: ${instName}
Date:        ${filedDate}

NEXT STEPS
───────────────────────────────────────────────────────────────────
1. Log in to MC Connect → Dispute Management
2. Upload this package and all evidence documents
3. Enter DE fields and ARN as required
4. Record MC reference number in Covalence
═══════════════════════════════════════════════════════════════════`
    } else if (isAmex) {
      body = `AMERICAN EXPRESS DISPUTE SUBMISSION PACKAGE
═══════════════════════════════════════════════════════════════════
PACKAGE GENERATED:    ${filedDate}
ISSUER:               ${instName}
PREPARED BY:          ${agentName}
COVALENCE CASE ID:    ${o.id}
═══════════════════════════════════════════════════════════════════

DISPUTE DETAILS
───────────────────────────────────────────────────────────────────
CARDMEMBER NAME:      ${o.cardholderName || '[CARDMEMBER NAME]'}
CARD LAST 5:          ${o.cardLast4 || '[XXXXX]'}
MERCHANT NAME:        ${o.merchant || '[MERCHANT NAME]'}
CHARGE DATE:          ${txDate}
CHARGE AMOUNT:        ${currency} ${amt}
DISPUTE AMOUNT:       ${currency} ${amt}
DISPUTE CATEGORY:     ${o.verdict ? o.verdict.replace(/_/g,' ') : '[DISPUTE CATEGORY]'}
AMEX CASE ID:         ${o.id}-AMEX-${filedDate.replace(/-/g,'')}

REQUIRED FIELDS — AMEX DISPUTE PORTAL
───────────────────────────────────────────────────────────────────
SE NUMBER:            ${o.seNumber || '[SERVICE ESTABLISHMENT NUMBER]'}
TRANSACTION REF:      ${o.transactionId || '[AMEX TRANSACTION REFERENCE]'}
AUTHORIZATION CODE:   ${o.authCode || '[AUTH CODE]'}

CARDMEMBER STATEMENT SUMMARY
───────────────────────────────────────────────────────────────────
${o._complaint ? o._complaint.substring(0,500) + (o._complaint.length > 500 ? '...' : '') : '[PASTE CARDMEMBER STATEMENT]'}

EVIDENCE MANIFEST (${docs.length} document${docs.length !== 1 ? 's' : ''})
───────────────────────────────────────────────────────────────────
${docManifest}

Prepared by: ${agentName} · ${instName} · ${filedDate}
═══════════════════════════════════════════════════════════════════`
    } else {
      // Discover or unknown network
      const netLabel = isDiscover ? 'DISCOVER' : (o.network || 'UNKNOWN NETWORK').toUpperCase()
      body = `${netLabel} DISPUTE SUBMISSION PACKAGE
═══════════════════════════════════════════════════════════════════
PACKAGE GENERATED:    ${filedDate}
ISSUER:               ${instName}
PREPARED BY:          ${agentName}
COVALENCE CASE ID:    ${o.id}
═══════════════════════════════════════════════════════════════════

DISPUTE DETAILS
───────────────────────────────────────────────────────────────────
CARDHOLDER NAME:      ${o.cardholderName || '[CARDHOLDER NAME]'}
CARD LAST 4:          ${o.cardLast4 || '[XXXX]'}
MERCHANT NAME:        ${o.merchant || '[MERCHANT NAME]'}
TRANSACTION DATE:     ${txDate}
TRANSACTION AMOUNT:   ${currency} ${amt}
DISPUTE AMOUNT:       ${currency} ${amt}
REASON CODE:          ${rc}
REASON DESCRIPTION:   ${o.verdict ? o.verdict.replace(/_/g,' ') : '[REASON DESCRIPTION]'}

CARDHOLDER STATEMENT SUMMARY
───────────────────────────────────────────────────────────────────
${o._complaint ? o._complaint.substring(0,500) + (o._complaint.length > 500 ? '...' : '') : '[PASTE CARDHOLDER STATEMENT]'}

EVIDENCE MANIFEST (${docs.length} document${docs.length !== 1 ? 's' : ''})
───────────────────────────────────────────────────────────────────
${docManifest}

Prepared by: ${agentName} · ${instName} · ${filedDate}
═══════════════════════════════════════════════════════════════════`
    }

    const networkLabel = isVisa ? 'VISA' : isMC ? 'MC' : isAmex ? 'AMEX' : isDiscover ? 'DISCOVER' : 'NETWORK'
    setPkgModal({ caseId: o.id, network: networkLabel, text: body })
  }

  const fileAllFraud = () => {
    const _agent = localStorage.getItem('cov_agent_name') || ''
    setOutcomes(prev => prev.map(o =>
      isFraudCase(o) && o.status === 'queued' ? { ...o, status: 'filed', filedAt: new Date().toISOString(), filedBy: _agent || 'SYSTEM' } : o
    ))
    setFiled(true)
    setTimeout(() => setFiled(false), 3000)
  }

  React.useEffect(() => { fetchAgents().then(setAgentList).catch(()=>{}) }, [])

  const toggleSelect = id => setSelectedIds(p => p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const clearSelected = () => setSelectedIds([])
  const fileSelected = () => {
    const _agent = localStorage.getItem('cov_agent_name') || ''
    setOutcomes(prev=>prev.map(o=>selectedIds.includes(o.id)&&isFraudCase(o)&&o.status==='queued'?{...o,status:'filed',filedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),filedBy:_agent||'SYSTEM'}:o))
    clearSelected(); setFiled(true); setTimeout(()=>setFiled(false),3000)
  }
  const exportSelectedCSV = () => {
    const rows=outcomes.filter(o=>selectedIds.includes(o.id))
    if(!rows.length) return
    const h='ID,MERCHANT,AMOUNT,CURRENCY,VERDICT,STATUS,REASON CODE,DATE,ASSIGNED TO'
    const lines=rows.map(o=>[o.id,o.merchant||'',o.amount||'',o.currency||'',o.verdict||'',o.status||'',o.reasonCode||'',o.date||'',o.assignedTo||''].map(v=>JSON.stringify(v)).join(','))
    const a=document.createElement('a'); a.href='data:text/csv,'+encodeURIComponent([h,...lines].join('\n')); a.download=`cov-cases-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    clearSelected()
  }
  const assignCase = (caseId,email,name) => {
    setOutcomes(prev=>prev.map(o=>o.id===caseId?{...o,assignedTo:email,assignedName:name,updatedAt:new Date().toISOString()}:o))
    setAssignOpen(p=>({...p,[caseId]:false}))
  }

  const saveNote = (id) => {
    const text = (noteDraft[id] || '').trim()
    setOutcomes(prev => prev.map(o => o.id === id
      ? { ...o, notes: [
            ...notesList(o.notes),
            { text, ts: new Date().toISOString(), author: localStorage.getItem('cov_agent_name') || 'Agent' }
          ].filter(n => n.text)
        }
      : o
    ))
    setNoteDraft(prev => ({ ...prev, [id]: '' }))
    setNoteOpen(prev => ({ ...prev, [id]: false }))
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 24px 80px' }}>
      <div className="mb-8 pb-6" style={{ borderBottom:'1px solid #D4CCBC', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'24px' }}>
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-400 mb-3">ISSUE Nº 003 — MULTI</div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(48px,8vw,96px)', letterSpacing:'-0.03em' }}>
            <span style={{ fontWeight:700 }}>Mul</span><span style={{ fontStyle:'italic', fontWeight:500 }}>ti</span>
          </h1>
          <p className="display-font text-stone-600 mt-4" style={{ fontSize:'clamp(14px,1.8vw,16px)', lineHeight:'1.5', maxWidth:'520px' }}>
            Bulk dispute operations. Queue fraud and service cases from the Dispute Desk, file fraud chargebacks in batch, and route service disputes for manual review.
          </p>
        </div>
        <div className="mono-font text-xs tracking-widest text-stone-600 shrink-0">
          {new Date().toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }).toUpperCase()}
        </div>
      </div>
      {/* ── Tab switcher ── */}
      <div className="flex gap-0 mb-6 border-b border-stone-200">
        {[['queue','FILING QUEUE'],['myqueue','MY QUEUE'],['intel','INTEL']].map(([id,label])=>(
          <button key={id} onClick={()=>setMultiTab(id)}
            className="mono-font text-[9px] tracking-widest px-5 py-3 transition-colors"
            style={{borderBottom: multiTab===id ? '2px solid #1C1917' : '2px solid transparent',
                    color: multiTab===id ? '#1C1917' : '#78716C', background:'transparent', cursor:'pointer'}}>
            {label}{id==='myqueue'&&myEmail?' ('+outcomes.filter(o=>o.assignedTo===myEmail&&o.status!=='won'&&o.status!=='lost').length+')':''}
          </button>
        ))}
      </div>

      {multiTab === 'myqueue' && (
        <MyQueuePanel outcomes={outcomes} myEmail={myEmail} covUser={covUser} setActiveSection={setActiveSection} setOutcomes={setOutcomes} />
      )}

      {multiTab === 'intel' && (
        <IntelView outcomes={outcomes} platformMode={null} covUser={covUser} />
      )}

      <div style={{display: multiTab==='queue' ? 'block' : 'none'}}>
      {selectedIds.length > 0 && (
        <div className="sticky top-14 z-40 mb-4 flex items-center gap-3 flex-wrap px-4 py-3 border border-stone-800" style={{background:'#1C1917'}}>
          <span className="mono-font text-[10px] tracking-widest text-stone-300">{selectedIds.length} SELECTED</span>
          <button onClick={fileSelected} className="mono-font text-[9px] tracking-widest px-3 py-1.5 bg-emerald-900 text-emerald-50 hover:bg-emerald-800 transition-colors">FILE FRAUD SELECTED</button>
          <button onClick={exportSelectedCSV} className="mono-font text-[9px] tracking-widest px-3 py-1.5 border border-stone-600 text-stone-300 hover:border-stone-400 transition-colors">EXPORT CSV</button>
          <button onClick={clearSelected} className="mono-font text-[9px] px-3 py-1.5 border border-stone-600 text-stone-500 hover:text-stone-300 transition-colors">DESELECT ALL ✕</button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[['all','ALL'],['mine','MINE'],['unassigned','UNASSIGNED']].map(([v,l])=>(
          <button key={v} onClick={()=>setAssignFilter(v)} className="mono-font text-[9px] tracking-widest px-3 py-1.5 transition-colors"
            style={{background:assignFilter===v?'#1C1917':'transparent',color:assignFilter===v?'#F5F1EA':'#78716C',border:'1px solid',borderColor:assignFilter===v?'#1C1917':'#D4CCBC',cursor:'pointer'}}>
            {l}
          </button>
        ))}
        {covUser&&<span className="mono-font text-[9px] text-stone-400 ml-2">· {covUser.name}</span>}
        <div className="flex items-center gap-1 ml-auto" style={{flex:'0 0 auto'}}>
          <input
            value={multiSearch} onChange={e => setMultiSearch(e.target.value)}
            placeholder="Search by ID, merchant, cardholder..."
            className="mono-font text-[10px] border border-stone-300 px-3 py-1.5 focus:outline-none focus:border-stone-600"
            style={{background:'white', minWidth:'220px'}} />
          {multiSearch && (
            <button onClick={() => setMultiSearch('')} className="mono-font text-[9px] text-stone-400 hover:text-stone-700 px-2">✕</button>
          )}
        </div>
      </div>
      {/* Batch summary bar */}
      {(() => {
        const fraudTotal   = queuedFraud.reduce((s,o)=>s+(parseFloat((o.amount||'0').replace(/[^0-9.]/g,''))||0),0)
        const serviceTotal = queuedService.reduce((s,o)=>s+(parseFloat((o.amount||'0').replace(/[^0-9.]/g,''))||0),0)
        return (
          <div className="mb-6" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'1px',background:'#D4CCBC'}}>
            {[
              {label:'FRAUD IN QUEUE',     val:queuedFraud.length,   sub:`$${fraudTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} total`,   col:'#4C1D95', jump:'mfq'},
              {label:'SERVICE IN QUEUE',   val:queuedService.length, sub:`$${serviceTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} total`, col:'#1E3A5F', jump:'msq'},
              {label:'SELECTED',           val:selectedIds.length,   sub:selectedIds.length>0?'ready to file':'none selected',                                               col:'#1A1814', jump:null},
              {label:'NEXT BATCH IN',      val:batchCountdown,       sub:autoFile?'auto-file ON':'auto-file OFF',                                                            col:nearBatch?'#92400E':'#57534E', jump:null},
            ].map(({label,val,sub,col,jump})=>(
              <button key={label} onClick={()=>jump&&setTimeout(()=>document.getElementById(jump)?.scrollIntoView({behavior:'smooth'}),60)}
                className="text-left"
                style={{background:'#FAF7F1',padding:'14px 18px',border:'none',cursor:jump?'pointer':'default'}}>
                <div className="mono-font" style={{fontSize:'8px',letterSpacing:'0.16em',color:'#78716C',marginBottom:'4px'}}>{label}</div>
                <div className="mono-font font-bold" style={{fontSize:'22px',color:col,lineHeight:1}}>{val}</div>
                <div className="mono-font" style={{fontSize:'9px',color:'#A8A29E',marginTop:'3px'}}>{sub}</div>
              </button>
            ))}
          </div>
        )
      })()}

      {/* Fraud queue */}
      <div id="mfq" className="border border-stone-300 mb-6" style={{ background: '#FAF7F1' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {queuedFraud.length>0&&<input type="checkbox"
              checked={queuedFraud.length>0&&queuedFraud.every(o=>selectedIds.includes(o.id))}
              onChange={e=>e.target.checked?setSelectedIds(p=>[...new Set([...p,...queuedFraud.map(o=>o.id)])]):setSelectedIds(p=>p.filter(id=>!queuedFraud.find(o=>o.id===id)))}
              style={{width:'14px',height:'14px',cursor:'pointer',accentColor:'#1C1917'}} title="Select all"/>}
            <div>
              <div className="mono-font text-xs tracking-widest text-stone-600">FRAUD DISPUTES — QUEUED FOR FILING</div>
              <div className="mono-font text-[10px] text-stone-400 mt-0.5">{queuedFraud.length} case{queuedFraud.length!==1?'s':''} · automated filing eligible</div>
            </div>
          </div>
          <button
            onClick={fileAllFraud}
            disabled={queuedFraud.length === 0}
            className="mono-font text-[10px] tracking-widest px-4 py-2"
            style={{ background: queuedFraud.length === 0 ? '#D6D3CD' : filed ? '#064E3B' : '#1C1917', color: '#F5F1EA', border: 'none', cursor: queuedFraud.length === 0 ? 'not-allowed' : 'pointer' }}>
            {filed ? 'FILED ✓' : `FILE ALL (${queuedFraud.length})`}
          </button>
        </div>
        {queuedFraud.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="mono-font text-[10px] text-stone-400 tracking-widest mb-1">NO FRAUD CASES IN QUEUE</div>
            <p className="display-font text-stone-400 text-[13px]">Cases marked IN QUEUE with a fraud verdict will appear here.</p>
            <button onClick={() => setActiveSection('desk')} className="mono-font text-[10px] tracking-widest mt-3 px-3 py-1.5 border border-stone-300 text-stone-500 hover:bg-stone-100 transition-colors">OPEN DISPUTE DESK</button>
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {queuedFraud.map(o => (
              <div key={o.id}>
                <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
                  <input type="checkbox" checked={selectedIds.includes(o.id)} onChange={()=>toggleSelect(o.id)} style={{width:'13px',height:'13px',cursor:'pointer',accentColor:'#1C1917',flexShrink:0}}/>
                  <span className="mono-font text-[10px] text-stone-400"><CaseLink id={o.id} /></span>
                  <span className="mono-font text-[11px] text-stone-800 font-medium flex-1 truncate">{o.merchant || '—'}</span>
                  <span className="mono-font text-[11px] text-stone-600">{o.amount} {o.currency || ''}</span>
                  <span className="mono-font text-[9px] px-2 py-0.5 bg-stone-800 text-stone-100">{o.verdict?.replace(/_/g,' ')}</span>
                  <span className="mono-font text-[9px] text-stone-400">{o.date?new Date(o.date).toLocaleDateString('en-CA'):''}</span>
                  {assignOpen[o.id]?(
                    <div className="flex items-center gap-1 flex-wrap">
                      {agentList.length>0?agentList.map(a=>(<button key={a.email} onClick={()=>assignCase(o.id,a.email,a.name)} className="mono-font text-[8px] px-2 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-800 hover:text-stone-50 transition-colors">{a.name}</button>)):<span className="mono-font text-[9px] text-stone-400 italic">No agents</span>}
                      <button onClick={()=>setAssignOpen(p=>({...p,[o.id]:false}))} className="mono-font text-[9px] px-1 text-stone-400">✕</button>
                    </div>
                  ):(
                    <button onClick={()=>setAssignOpen(p=>({...p,[o.id]:true}))} className="mono-font text-[8px] px-2 py-0.5 border border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 transition-colors whitespace-nowrap">
                      {o.assignedTo?(o.assignedName||o.assignedTo.split('@')[0]).toUpperCase():'ASSIGN'}
                    </button>
                  )}
                  <button onClick={() => setNoteOpen(p => ({...p, [o.id]: !p[o.id]}))}
                    className="mono-font text-[9px] px-2 py-0.5 border border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 transition-colors whitespace-nowrap">
                    {notesList(o.notes).length > 0 ? `📝 ${notesList(o.notes).length}` : '+ NOTE'}
                  </button>
                  <button
                    onClick={() => generateFilingPackage(o)}
                    className="mono-font text-[8px] px-2 py-0.5 border transition-colors whitespace-nowrap"
                    style={{ borderColor:'#92400E', color:'#92400E', background:'transparent', cursor:'pointer' }}
                    title="Generate network-formatted filing package"
                  >↓ PKG{(o.docs||[]).length > 0 ? ` · ${(o.docs||[]).length} DOC${(o.docs||[]).length!==1?'S':''}` : ''}</button>
                </div>
                {notesList(o.notes).length > 0 && !noteOpen[o.id] && (
                  <div className="px-5 pb-2 space-y-1">
                    {notesList(o.notes).map((n,i) => (
                      <div key={i} className="mono-font text-[9px] text-stone-500 flex gap-2">
                        <span className="text-stone-400">{n.ts ? new Date(n.ts).toLocaleDateString('en-CA') : ''} {n.author}</span>
                        <span className="text-stone-600">{n.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                {noteOpen[o.id] && (
                  <div className="px-5 pb-3 pt-1 border-t border-stone-200" style={{background:'#F9F7F3'}}>
                    <textarea
                      value={noteDraft[o.id] || ''}
                      onChange={e => setNoteDraft(p => ({...p, [o.id]: e.target.value}))}
                      placeholder="Add a case note..."
                      rows={2}
                      className="w-full mono-font text-[11px] border border-stone-300 px-3 py-2 resize-none focus:outline-none focus:border-stone-500"
                      style={{background:'#FAF7F1'}}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => saveNote(o.id)} disabled={!(noteDraft[o.id]||'').trim()}
                        className="mono-font text-[9px] px-3 py-1 bg-stone-800 text-stone-50 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors">SAVE NOTE</button>
                      <button onClick={() => setNoteOpen(p => ({...p, [o.id]: false}))}
                        className="mono-font text-[9px] px-2 py-1 border border-stone-300 text-stone-400 hover:text-stone-600 transition-colors">CANCEL</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Service queue */}
      <div id="msq" className="border border-stone-300 mb-6" style={{ background: '#FAF7F1' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-3">
          <div>
            <div className="mono-font text-xs tracking-widest text-stone-600">SERVICE DISPUTES — QUEUED</div>
            <div className="mono-font text-[10px] text-stone-400 mt-0.5">{queuedService.length} case{queuedService.length !== 1 ? 's' : ''} · manual review required before filing</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono-font text-[10px] px-3 py-1.5 border border-amber-600 text-amber-700">MANUAL REVIEW REQUIRED</span>
            {queuedService.length > 0 && (
              <button
                onClick={() => {
                  if (!window.confirm(`File all ${queuedService.length} service dispute${queuedService.length!==1?'s':''}? Each requires manual review before filing. Confirm only if you have reviewed all cases.`)) return
                  setOutcomes(prev => prev.map(o =>
                    !isFraudCase(o) && o.status === 'queued'
                      ? { ...o, status: 'filed', filedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                      : o
                  ))
                }}
                className="mono-font text-[10px] tracking-widest px-4 py-1.5"
                style={{ background:'#78350F', color:'#FEF3C7', border:'none', cursor:'pointer' }}>
                FILE ALL REVIEWED ({queuedService.length})
              </button>
            )}
          </div>
        </div>
        {queuedService.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="mono-font text-[10px] text-stone-400 tracking-widest mb-1">NO SERVICE CASES IN QUEUE</div>
            <p className="display-font text-stone-400 text-[13px]">Consumer dispute and service cases require a final agent review before filing.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {queuedService.map(o => (
              <div key={o.id}>
                <div className="px-5 py-3 flex items-center gap-4 flex-wrap">
                  <span className="mono-font text-[10px] text-stone-400"><CaseLink id={o.id} /></span>
                  <span className="mono-font text-[11px] text-stone-800 font-medium flex-1 truncate">{o.merchant || '—'}</span>
                  <span className="mono-font text-[11px] text-stone-600">{o.amount} {o.currency || ''}</span>
                  <span className="mono-font text-[9px] px-2 py-0.5 bg-amber-800 text-amber-50">{(o.verdict || 'CONSUMER DISPUTE')?.replace(/_/g, ' ')}</span>
                  <button onClick={() => setActiveSection('desk')} className="mono-font text-[9px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-100 transition-colors">REVIEW</button>
                  {assignOpen[o.id]?(
                    <div className="flex items-center gap-1 flex-wrap">
                      {agentList.length>0?agentList.map(a=>(<button key={a.email} onClick={()=>assignCase(o.id,a.email,a.name)} className="mono-font text-[8px] px-2 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-800 hover:text-stone-50 transition-colors">{a.name}</button>)):<span className="mono-font text-[9px] text-stone-400 italic">No agents</span>}
                      <button onClick={()=>setAssignOpen(p=>({...p,[o.id]:false}))} className="mono-font text-[9px] px-1 text-stone-400">✕</button>
                    </div>
                  ):(
                    <button onClick={()=>setAssignOpen(p=>({...p,[o.id]:true}))} className="mono-font text-[8px] px-2 py-0.5 border border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 transition-colors whitespace-nowrap">
                      {o.assignedTo?(o.assignedName||o.assignedTo.split('@')[0]).toUpperCase():'ASSIGN'}
                    </button>
                  )}
                  <button onClick={() => setNoteOpen(p => ({...p, [o.id]: !p[o.id]}))}
                    className="mono-font text-[9px] px-2 py-0.5 border border-stone-300 text-stone-400 hover:border-stone-500 hover:text-stone-600 transition-colors whitespace-nowrap">
                    {notesList(o.notes).length > 0 ? `📝 ${notesList(o.notes).length}` : '+ NOTE'}
                  </button>
                  <button
                    onClick={() => generateFilingPackage(o)}
                    className="mono-font text-[8px] px-2 py-0.5 border transition-colors whitespace-nowrap"
                    style={{ borderColor:'#92400E', color:'#92400E', background:'transparent', cursor:'pointer' }}
                    title="Generate filing package">
                    ↓ PKG{(o.docs||[]).length > 0 ? ` · ${(o.docs||[]).length} DOC${(o.docs||[]).length!==1?'S':''}` : ''}
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm(`File case ${o.id} — ${o.merchant}? Confirm you have completed manual review.`)) return
                      setOutcomes(prev => prev.map(x => x.id === o.id ? { ...x, status:'filed', filedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : x))
                    }}
                    className="mono-font text-[9px] px-2 py-0.5 transition-colors whitespace-nowrap"
                    style={{ background:'#1C1917', color:'#F5F1EA', border:'none', cursor:'pointer' }}
                    title="File this case after manual review">
                    FILE ✓
                  </button>
                </div>
                {notesList(o.notes).length > 0 && !noteOpen[o.id] && (
                  <div className="px-5 pb-2 space-y-1">
                    {notesList(o.notes).map((n,i) => (
                      <div key={i} className="mono-font text-[9px] text-stone-500 flex gap-2">
                        <span className="text-stone-400">{n.ts ? new Date(n.ts).toLocaleDateString('en-CA') : ''} {n.author}</span>
                        <span className="text-stone-600">{n.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                {noteOpen[o.id] && (
                  <div className="px-5 pb-3 pt-1 border-t border-stone-200" style={{background:'#F9F7F3'}}>
                    <textarea
                      value={noteDraft[o.id] || ''}
                      onChange={e => setNoteDraft(p => ({...p, [o.id]: e.target.value}))}
                      placeholder="Add a case note..."
                      rows={2}
                      className="w-full mono-font text-[11px] border border-stone-300 px-3 py-2 resize-none focus:outline-none focus:border-stone-500"
                      style={{background:'#FAF7F1'}}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => saveNote(o.id)} disabled={!(noteDraft[o.id]||'').trim()}
                        className="mono-font text-[9px] px-3 py-1 bg-stone-800 text-stone-50 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors">SAVE NOTE</button>
                      <button onClick={() => setNoteOpen(p => ({...p, [o.id]: false}))}
                        className="mono-font text-[9px] px-2 py-1 border border-stone-300 text-stone-400 hover:text-stone-600 transition-colors">CANCEL</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3pm batch schedule panel */}
      <div className={`border px-5 py-4 ${nearBatch && queuedFraud.length > 0 ? 'border-amber-600 bg-amber-50' : 'border-stone-300'}`} style={{ background: nearBatch && queuedFraud.length > 0 ? undefined : '#FAF7F1' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-1">BATCH FILING WINDOW — 3:00 PM DAILY</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`mono-font text-sm font-bold ${nearBatch && queuedFraud.length > 0 ? 'text-amber-700' : 'text-stone-700'}`}>
                {batchCountdown} until 3:00 PM
              </span>
              <span className="mono-font text-[10px] text-stone-400">· {queuedFraud.length} fraud case{queuedFraud.length !== 1 ? 's' : ''} ready</span>
            </div>
            {nearBatch && queuedFraud.length > 0 && (
              <p className="display-font text-amber-800 text-[13px] mt-1">⚡ Batch window approaching — file now or wait for auto-file at 3:00 PM.</p>
            )}
            <p className="display-font text-stone-400 text-[11px] mt-1 italic">Service disputes always require manual agent sign-off before filing.</p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="mono-font text-[9px] tracking-widest text-stone-500">AUTO-FILE AT 3PM</span>
              <button
                onClick={toggleAutoFile}
                className={`mono-font text-[9px] tracking-widest px-3 py-1.5 border transition-colors ${autoFile ? 'bg-stone-900 text-stone-50 border-stone-900' : 'border-stone-400 text-stone-500 hover:border-stone-700 hover:text-stone-700'}`}
                title={autoFile ? 'Auto-file is ON — fraud cases will file automatically at 3:00 PM while this tab is open' : 'Enable auto-file at 3:00 PM (requires this tab to be open)'}
              >{autoFile ? 'ON ✓' : 'OFF'}</button>
            </div>
            {autoFile && <p className="mono-font text-[9px] text-emerald-700">Tab must remain open</p>}
          </div>
        </div>
      </div>

      {/* Portfolio Analytics consolidated into Intel tab */}

      </div>{/* end queue tab */}
      {/* ── Filing Package Modal ─────────────────────────────────────────── */}
      {pkgModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
          <div style={{ background:'#FAF7F1', maxWidth:'760px', width:'100%', maxHeight:'85vh', display:'flex', flexDirection:'column', border:'2px solid #1C1917' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-stone-300">
              <div>
                <div className="mono-font text-[10px] tracking-widest text-stone-500">FILING PACKAGE — {pkgModal.network}</div>
                <div className="mono-font text-xs text-stone-800 mt-0.5">{pkgModal.caseId}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(pkgModal.text)
                    a.download = `COV-${pkgModal.caseId}-${pkgModal.network}-${new Date().toISOString().split('T')[0]}.txt`
                    a.click()
                  }}
                  className="mono-font text-[9px] tracking-widest px-3 py-1.5 transition-colors"
                  style={{ background:'#1C1917', color:'#F5F1EA', border:'none', cursor:'pointer' }}
                >↓ DOWNLOAD .TXT</button>
                <button onClick={() => setPkgModal(null)} className="mono-font text-[10px] text-stone-500 hover:text-stone-900 transition-colors px-2">✕</button>
              </div>
            </div>
            <pre style={{ flex:1, overflow:'auto', padding:'20px', fontFamily:'monospace', fontSize:'11px', lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-word', color:'#1C1917', background:'#FAF7F1' }}>
              {pkgModal.text}
            </pre>
            <div className="px-5 py-3 border-t border-stone-200 flex items-center gap-3 flex-wrap" style={{ background:'#F0EDE6' }}>
              <span className="mono-font text-[9px] text-stone-500">Review all fields before uploading to the network portal. Bracketed values must be filled in manually.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MY QUEUE PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function MyQueuePanel({ outcomes, myEmail, covUser, setActiveSection }) {
  const mine = outcomes.filter(o => o.assignedTo === myEmail && o.status !== 'won' && o.status !== 'lost')
  const resolved = outcomes.filter(o => o.assignedTo === myEmail && (o.status === 'won' || o.status === 'lost'))
  const windowDays = o => {
    if (!o.date) return null
    const d = new Date(o.date); d.setDate(d.getDate() + (o.network === 'mastercard' ? 45 : 60))
    return Math.ceil((d - new Date()) / 86400000)
  }
  const urgencyStyle = days => {
    if (days === null) return { color:'#44403C', background:'#F5F5F4', border:'1px solid #D6D3D1' }
    if (days <= 5)  return { color:'#7F1D1D', background:'#FEE2E2', border:'1px solid #FCA5A5' }
    if (days <= 15) return { color:'#78350F', background:'#FEF3C7', border:'1px solid #FCD34D' }
    return { color:'#064E3B', background:'#D1FAE5', border:'1px solid #6EE7B7' }
  }
  if (mine.length === 0 && resolved.length === 0) return (
    <div className="text-center py-16">
      <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">MY QUEUE</div>
      <p className="display-font text-stone-400 text-[15px]">No cases assigned to {covUser?.name || myEmail || 'you'}.</p>
      <p className="display-font text-stone-400 text-[13px] mt-1 italic">Cases assigned in the filing queue will appear here.</p>
    </div>
  )
  return (
    <div>
      {mine.length > 0 && (
        <div className="mb-8">
          <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-3">OPEN — {mine.length} CASE{mine.length !== 1 ? 'S' : ''}</div>
          <div className="border border-stone-200" style={{ borderBottom:'none' }}>
            {[...mine].sort((a,b) => (windowDays(a)??999) - (windowDays(b)??999)).map(o => {
              const days = windowDays(o)
              return (
                <div key={o.id} className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderBottom:'1px solid #E7E2DA', background:'#FAFAF8' }}>
                  <span className="mono-font text-[9px] text-stone-400 w-24 shrink-0"><CaseLink id={o.id} /></span>
                  <span className="mono-font text-[11px] text-stone-800 font-medium flex-1 min-w-[120px] truncate">{o.merchant || '—'}</span>
                  <span className="mono-font text-[10px] text-stone-500 w-20 shrink-0">{o.amount} {o.currency||''}</span>
                  <span className="mono-font text-[9px] px-2 py-0.5 shrink-0" style={{ background:'#EDE9E0', color:'#57534E' }}>{(o.network||'—').toUpperCase()}</span>
                  <span className="mono-font text-[9px] px-2 py-0.5 shrink-0" style={{ background:'#EDE9E0', color:'#57534E' }}>{o.reasonCode||'—'}</span>
                  {days !== null && <span className="mono-font text-[9px] px-2 py-0.5 font-bold shrink-0" style={urgencyStyle(days)}>{days <= 0 ? 'EXPIRED' : days+'d LEFT'}</span>}
                  <span className="mono-font text-[9px] px-2 py-0.5 font-bold shrink-0" style={{ background:'#1E3A5F', color:'#BAE6FD' }}>{(o.status||'pending').toUpperCase().replace(/_/g,' ')}</span>
                  <button onClick={() => setActiveSection('desk')} className="mono-font text-[8px] tracking-widest px-2 py-1 border border-stone-400 text-stone-500 hover:bg-stone-100 transition-colors shrink-0">OPEN DESK</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">RESOLVED — {resolved.length} CASE{resolved.length !== 1 ? 'S' : ''}</div>
          <div className="border border-stone-200" style={{ borderBottom:'none' }}>
            {resolved.slice(0,20).map(o => (
              <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap" style={{ borderBottom:'1px solid #EDE9E0', background:'#F7F5F0' }}>
                <span className="mono-font text-[9px] text-stone-300 w-24 shrink-0"><CaseLink id={o.id} /></span>
                <span className="mono-font text-[11px] text-stone-500 flex-1 min-w-[120px] truncate">{o.merchant || '—'}</span>
                <span className="mono-font text-[9px] text-stone-400 w-20 shrink-0">{o.amount} {o.currency||''}</span>
                <span className="mono-font text-[9px] font-bold px-2 py-0.5 shrink-0" style={{ background: o.status==='won'?'#D1FAE5':'#FEE2E2', color: o.status==='won'?'#064E3B':'#7F1D1D' }}>{o.status?.toUpperCase()}</span>
                {o.resolvedDate && <span className="mono-font text-[9px] text-stone-300 shrink-0">{new Date(o.resolvedDate).toLocaleDateString('en-CA')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// =============================================================================
// 008 INTEL VIEW
// =============================================================================
function IntelView({ outcomes, platformMode, covUser }) {
  const [intelTab, setIntelTab] = React.useState('portfolio')
  const [chartMonths, setChartMonths] = React.useState(6)
  const resolved  = outcomes.filter(o => o.status === 'won' || o.status === 'lost')
  const won       = resolved.filter(o => o.status === 'won')
  const lost      = resolved.filter(o => o.status === 'lost')
  const pending   = outcomes.filter(o => o.status !== 'won' && o.status !== 'lost')
  const winRate   = resolved.length > 0 ? (won.length / resolved.length * 100).toFixed(1) : null
  const totalAmt  = o => parseFloat((o.amount||'0').replace(/[^0-9.]/g,'')) || 0
  const recovered = won.reduce((s,o) => s + totalAmt(o), 0)
  const atRisk    = pending.reduce((s,o) => s + totalAmt(o), 0)
  const resolutionDays = resolved.filter(o => o.date && o.resolvedDate)
    .map(o => Math.ceil((new Date(o.resolvedDate) - new Date(o.date)) / 86400000)).filter(d => d > 0 && d < 400)
  const avgResolution = resolutionDays.length > 0 ? Math.round(resolutionDays.reduce((a,b)=>a+b,0)/resolutionDays.length) : null
  const months = []
  for (let i = chartMonths - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
    const key = d.toISOString().substring(0,7)
    const mo = outcomes.filter(o => (o.date||'').startsWith(key))
    months.push({ key, label: d.toLocaleDateString('en-US',{month:'short'}), total:mo.length, won:mo.filter(o=>o.status==='won').length, lost:mo.filter(o=>o.status==='lost').length })
  }
  const maxM = Math.max(...months.map(m=>m.total),1)
  const byCode = {}
  resolved.forEach(o => {
    const code = (o.reasonCode||o.code||'UNKNOWN').split(/[\s–—]/)[0].trim()
    if (!byCode[code]) byCode[code] = { won:0, lost:0, total:0, label:o.reasonTitle||'' }
    byCode[code].total++; if (o.status==='won') byCode[code].won++; else byCode[code].lost++
  })
  const codeRows = Object.entries(byCode).map(([code,d])=>({code,...d,rate:d.total>0?(d.won/d.total*100).toFixed(0):0})).sort((a,b)=>b.total-a.total).slice(0,12)
  const byMerchant = {}
  outcomes.forEach(o => {
    const m = (o.merchant||'').trim()||'—'
    if (!byMerchant[m]) byMerchant[m]={won:0,lost:0,total:0,pending:0}
    byMerchant[m].total++; if (o.status==='won') byMerchant[m].won++; else if (o.status==='lost') byMerchant[m].lost++; else byMerchant[m].pending++
  })
  const merchantRows = Object.entries(byMerchant).filter(([m])=>m!=='—').map(([merchant,d])=>{const res=d.won+d.lost;return{merchant,...d,rate:res>0?(d.won/res*100).toFixed(0):null}}).sort((a,b)=>b.total-a.total).slice(0,15)
  const byAgent = {}
  outcomes.forEach(o => {
    const agent = o.assignedName||(o.assignedTo?o.assignedTo.split('@')[0]:'UNASSIGNED')
    if (!byAgent[agent]) byAgent[agent]={won:0,lost:0,total:0,pending:0}
    byAgent[agent].total++; if (o.status==='won') byAgent[agent].won++; else if (o.status==='lost') byAgent[agent].lost++; else byAgent[agent].pending++
  })
  const agentRows = Object.entries(byAgent).map(([agent,d])=>{const res=d.won+d.lost;return{agent,...d,rate:res>0?(d.won/res*100).toFixed(0):null}}).sort((a,b)=>b.total-a.total)
  const calibratedCodes = new Set(resolved.filter(o=>o.reasonCode).map(o=>(o.reasonCode||'').split(/[\s–—]/)[0].trim()))
  const dfaCalibrated = outcomes.filter(o=>o.dfaScore||o.dfaFundability)
  const T = id => ({ borderBottom:intelTab===id?'2px solid #1C1917':'2px solid transparent', color:intelTab===id?'#1C1917':'#78716C', background:'transparent', cursor:'pointer' })
  const WinBar = ({rate,lg}) => {
    const r=parseFloat(rate)||0, col=r>=65?'#064E3B':r>=45?'#78350F':'#7F1D1D'
    return (<div className="flex items-center gap-2"><div style={{width:lg?100:72,height:5,background:'#EDE9E0',overflow:'hidden'}}><div style={{width:r+'%',height:'100%',background:col}}/></div><span className="mono-font font-bold" style={{fontSize:'10px',color:col}}>{r}%</span></div>)
  }
  const Stat = ({label,value,sub,color='#1C1917'}) => (
    <div style={{background:'#FAF7F1',padding:'18px',borderRight:'1px solid #E7E2DA'}}>
      <div className="mono-font" style={{fontSize:'8px',letterSpacing:'0.16em',color:'#78716C',marginBottom:'5px'}}>{label}</div>
      <div className="mono-font font-bold" style={{fontSize:'26px',color,lineHeight:1,marginBottom:'2px'}}>{value}</div>
      {sub&&<div className="mono-font" style={{fontSize:'9px',color:'#A8A29E'}}>{sub}</div>}
    </div>
  )
  return (
    <div style={{maxWidth:'960px',margin:'0 auto',padding:'24px 16px 80px'}}>
      <div className="mb-6 pb-5" style={{borderBottom:'1px solid #D4CCBC'}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'16px',flexWrap:'wrap'}}>
          <div>
                <h1 className="display-font font-bold text-stone-900 leading-none" style={{fontSize:'clamp(28px,5vw,52px)',letterSpacing:'-0.03em'}}>
              <span style={{fontWeight:700}}>In</span><span style={{fontStyle:'italic',fontWeight:500}}>tel</span>
            </h1>
            <p className="display-font text-stone-500 mt-2" style={{fontSize:'clamp(12px,1.6vw,14px)',lineHeight:'1.5',maxWidth:'480px'}}>
              Portfolio intelligence — win rates, merchant patterns, team throughput, DFA calibration.
            </p>
          </div>
          <div className="mono-font text-[9px] tracking-widest text-stone-500 shrink-0 mt-1">{outcomes.length} CASES · {resolved.length} RESOLVED</div>
        </div>
      </div>
      {outcomes.length === 0 ? (
        <div className="text-center py-20">
          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-4">NO DATA YET</div>
          <p className="display-font text-stone-400 text-[15px]">Resolve cases in the Dispute Desk to populate intelligence.</p>
        </div>
      ) : (
        <>
          <div style={{overflowX:'auto',marginBottom:'24px',borderBottom:'1px solid #E7E2DA'}}>
            <div className="flex gap-0" style={{minWidth:'max-content'}}>
              {[['portfolio','PORTFOLIO'],['codes','BY CODE'],['merchants','BY MERCHANT'],['team','TEAM'],['dfa','DFA']].map(([id,label])=>(
                <button key={id} onClick={()=>setIntelTab(id)} className="mono-font text-[9px] tracking-widest px-4 py-3 transition-colors whitespace-nowrap" style={T(id)}>{label}</button>
              ))}
            </div>
          </div>
          {intelTab==='portfolio'&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'1px',background:'#D4CCBC',marginBottom:'28px'}}>
                <Stat label="TOTAL CASES" value={outcomes.length} sub={pending.length+' pending'} />
                <Stat label="WIN RATE" value={winRate!==null?winRate+'%':'—'} sub={won.length+'W / '+lost.length+'L of '+resolved.length+' resolved'} color={winRate>=65?'#064E3B':winRate>=45?'#78350F':'#7F1D1D'} />
                <Stat label="RECOVERED" value={'$'+Math.round(recovered).toLocaleString()} sub="from won disputes" color="#064E3B" />
                <Stat label="AT RISK" value={'$'+Math.round(atRisk).toLocaleString()} sub="pending" color="#78350F" />
                <Stat label="AVG RESOLUTION" value={avgResolution!==null?avgResolution+'d':'—'} sub="filed to decision" />
              </div>
              <div className="mb-8">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <div className="mono-font text-[9px] tracking-widest text-stone-500">CASE VOLUME</div>
                  <div className="flex gap-1">
                    {[3,6,12].map(n=>(
                      <button key={n} onClick={()=>setChartMonths(n)} className="mono-font text-[8px] tracking-widest px-2 py-1 transition-colors" style={{background:chartMonths===n?'#1C1917':'transparent',color:chartMonths===n?'#F5F1EA':'#78716C',border:'1px solid '+(chartMonths===n?'#1C1917':'#D4CCBC'),cursor:'pointer'}}>{n}M</button>
                    ))}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'flex-end',gap:'6px',height:'110px',borderBottom:'1px solid #E7E2DA',overflowX:'auto'}}>
                  {months.map(m=>(
                    <div key={m.key} style={{flex:1,minWidth:'24px',display:'flex',flexDirection:'column',alignItems:'center',gap:'2px',height:'100%',justifyContent:'flex-end'}}>
                      {m.total>0&&(<div style={{width:'100%',display:'flex',flexDirection:'column',gap:'1px'}}>
                        <div style={{background:'#064E3B',height:(m.won/maxM*85)+'px',minHeight:m.won?2:0,width:'100%'}}/>
                        <div style={{background:'#7F1D1D',height:(m.lost/maxM*85)+'px',minHeight:m.lost?2:0,width:'100%'}}/>
                        <div style={{background:'#D4CCBC',height:((m.total-m.won-m.lost)/maxM*85)+'px',minHeight:(m.total-m.won-m.lost)?2:0,width:'100%'}}/>
                      </div>)}
                      <div className="mono-font text-[8px] text-stone-400 mt-1">{m.label}</div>
                      <div className="mono-font text-[8px] text-stone-600 font-bold">{m.total}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  {[['#064E3B','Won'],['#7F1D1D','Lost'],['#D4CCBC','Pending']].map(([col,lbl])=>(
                    <div key={lbl} className="flex items-center gap-1.5"><div style={{width:10,height:10,background:col}}/><span className="mono-font text-[9px] text-stone-500">{lbl}</span></div>
                  ))}
                </div>
              </div>
              {(()=>{
                const nets={}; outcomes.forEach(o=>{const n=(o.network||'unknown').toLowerCase();if(!nets[n])nets[n]={total:0,won:0};nets[n].total++;if(o.status==='won')nets[n].won++})
                const netRows=Object.entries(nets).sort((a,b)=>b[1].total-a[1].total)
                if(!netRows.length) return null
                return (<div>
                  <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-3">BY NETWORK</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'1px',background:'#D4CCBC'}}>
                    {netRows.map(([net,d])=>(<div key={net} style={{background:'#FAF7F1',padding:'14px 16px'}}>
                      <div className="mono-font text-[8px] tracking-widest text-stone-500 mb-1">{net.toUpperCase()}</div>
                      <div className="mono-font font-bold text-[20px] text-stone-900">{d.total}</div>
                      <div className="mono-font text-[9px] text-stone-500">{d.total>0?(d.won/d.total*100).toFixed(0):0}% win rate</div>
                    </div>))}
                  </div>
                </div>)
              })()}
            </div>
          )}
          {intelTab==='codes'&&(
            <div>
              {codeRows.length===0?(<p className="display-font text-stone-400 text-[14px]">No resolved cases with reason codes yet.</p>):(
                <>
                  <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">WIN RATE BY REASON CODE — {codeRows.length} CODES</div>
                  <div style={{borderTop:'1px solid #E7E2DA'}}>
                    {codeRows.map(row=>(<div key={row.code} className="flex items-center gap-4 py-3 flex-wrap" style={{borderBottom:'1px solid #EDE9E0'}}>
                      <span className="mono-font text-[10px] font-bold text-stone-800 w-16 shrink-0">{row.code}</span>
                      <span className="display-font text-[12px] text-stone-500 flex-1 min-w-[80px] truncate">{row.label||'—'}</span>
                      <WinBar rate={row.rate} lg />
                      <div className="mono-font text-[9px] text-stone-400 w-24 text-right shrink-0">{row.won}W/{row.lost}L/{row.total} total</div>
                    </div>))}
                  </div>
                  <div className="mt-5 px-4 py-3 border border-stone-200 bg-stone-50 mono-font text-[9px] text-stone-400">Rates derive from your resolved cases only. Codes with fewer than 5 cases carry high variance. Green ≥65% · Amber 45–64% · Red &lt;45%.</div>
                </>
              )}
            </div>
          )}
          {intelTab==='merchants'&&(
            <div>
              {merchantRows.length===0?(<p className="display-font text-stone-400 text-[14px]">No merchant data yet.</p>):(
                <>
                  <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">DISPUTE FREQUENCY BY MERCHANT — TOP {merchantRows.length}</div>
                  <div style={{borderTop:'1px solid #E7E2DA'}}>
                    <div className="flex items-center gap-4 py-2" style={{borderBottom:'2px solid #1C1917'}}>
                      <span className="mono-font text-[8px] tracking-widest text-stone-500 flex-1">MERCHANT</span>
                      {['TOTAL','W','L','PEND','WIN RATE'].map(h=>(<span key={h} className="mono-font text-[8px] tracking-widest text-stone-500 w-16 text-right shrink-0">{h}</span>))}
                    </div>
                    {merchantRows.map((row,i)=>(<div key={row.merchant} className="flex items-center gap-4 py-2.5" style={{borderBottom:'1px solid #EDE9E0',background:i%2===0?'#FAFAF8':'white'}}>
                      <span className="mono-font text-[11px] font-medium text-stone-800 flex-1 truncate">{row.merchant}</span>
                      <span className="mono-font text-[10px] text-stone-600 w-16 text-right font-bold">{row.total}</span>
                      <span className="mono-font text-[10px] text-emerald-700 w-16 text-right">{row.won}</span>
                      <span className="mono-font text-[10px] text-red-700 w-16 text-right">{row.lost}</span>
                      <span className="mono-font text-[10px] text-stone-400 w-16 text-right">{row.pending}</span>
                      <div className="w-16 text-right shrink-0">{row.rate!==null?<WinBar rate={row.rate}/>:<span className="mono-font text-[9px] text-stone-300">—</span>}</div>
                    </div>))}
                  </div>
                </>
              )}
            </div>
          )}
          {intelTab==='team'&&(
            <div>
              {agentRows.length===0||(agentRows.length===1&&agentRows[0].agent==='UNASSIGNED')?(
                <div className="text-center py-12"><p className="display-font text-stone-400 text-[15px]">Assign cases to agents in Multi to see team throughput.</p></div>
              ):(
                <>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'1px',background:'#D4CCBC',marginBottom:'28px'}}>
                    {agentRows.slice(0,6).map(row=>{const rate=row.rate!==null?parseFloat(row.rate):null;return(
                      <div key={row.agent} style={{background:'#FAF7F1',padding:'16px 18px'}}>
                        <div className="mono-font text-[8px] tracking-widest text-stone-500 mb-1 truncate">{row.agent.toUpperCase()}</div>
                        <div className="mono-font font-bold text-[22px] text-stone-900">{row.total}</div>
                        <div className="mono-font text-[9px] text-stone-500">{row.won}W/{row.lost}L/{row.pending} open</div>
                        {rate!==null&&<div className="mt-2"><WinBar rate={rate}/></div>}
                      </div>
                    )})}
                  </div>
                  <div style={{borderTop:'1px solid #E7E2DA'}}>
                    <div className="flex items-center gap-4 py-2" style={{borderBottom:'2px solid #1C1917'}}>
                      <span className="mono-font text-[8px] tracking-widest text-stone-500 flex-1">AGENT</span>
                      {['TOTAL','W','L','OPEN','WIN RATE'].map(h=>(<span key={h} className="mono-font text-[8px] tracking-widest text-stone-500 w-14 text-right shrink-0">{h}</span>))}
                    </div>
                    {agentRows.map((row,i)=>(<div key={row.agent} className="flex items-center gap-4 py-2.5" style={{borderBottom:'1px solid #EDE9E0',background:i%2===0?'#FAFAF8':'white'}}>
                      <span className="mono-font text-[11px] font-medium text-stone-800 flex-1 truncate">{row.agent}</span>
                      <span className="mono-font text-[10px] font-bold text-stone-600 w-14 text-right">{row.total}</span>
                      <span className="mono-font text-[10px] text-emerald-700 w-14 text-right">{row.won}</span>
                      <span className="mono-font text-[10px] text-red-700 w-14 text-right">{row.lost}</span>
                      <span className="mono-font text-[10px] text-stone-400 w-14 text-right">{row.pending}</span>
                      <div className="w-14 text-right shrink-0">{row.rate!==null?<WinBar rate={row.rate}/>:<span className="mono-font text-[9px] text-stone-300">—</span>}</div>
                    </div>))}
                  </div>
                </>
              )}
            </div>
          )}
          {intelTab==='dfa'&&(
            <div>
              <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-5">DFA MODEL CALIBRATION STATUS</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'1px',background:'#D4CCBC',marginBottom:'28px'}}>
                {[
                  {label:'RESOLVED CASES',value:resolved.length,sub:'feed historical win rates',color:'#1C1917'},
                  {label:'CODES CALIBRATED',value:calibratedCodes.size,sub:'reason codes with outcome data',color:calibratedCodes.size>=5?'#064E3B':'#78350F'},
                  {label:'DFA-SCORED CASES',value:dfaCalibrated.length,sub:'annotated with fundability',color:'#1C1917'},
                  {label:'MODEL CONFIDENCE',value:resolved.length>=20?'HIGH':resolved.length>=10?'MED':'LOW',sub:'needs '+(Math.max(0,20-resolved.length))+' more for HIGH',color:resolved.length>=20?'#064E3B':resolved.length>=10?'#78350F':'#7F1D1D'},
                ].map(s=>(<div key={s.label} style={{background:'#FAF7F1',padding:'16px'}}>
                  <div className="mono-font text-[8px] tracking-widest text-stone-500 mb-1">{s.label}</div>
                  <div className="mono-font font-bold text-[24px]" style={{color:s.color}}>{s.value}</div>
                  <div className="mono-font text-[9px] text-stone-400">{s.sub}</div>
                </div>))}
              </div>
              <div className="mb-5 px-5 py-4 border border-stone-200 bg-stone-50">
                <div className="mono-font text-[9px] tracking-widest text-stone-600 mb-2">HOW CALIBRATION WORKS</div>
                <p className="display-font text-stone-600 text-[13px] leading-relaxed">The DFA model starts from hardcoded baseline win rates. As you resolve cases, Covalence computes your actual win rates by reason code and layers them over the baseline — your history takes precedence once at least 2 resolved cases exist per code. This calibration feeds fundability scores, so the model gets more accurate the more you use it.</p>
              </div>
              {codeRows.length>0&&(
                <div style={{borderTop:'1px solid #E7E2DA'}}>
                  <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-3">YOUR WIN RATES vs BASELINE</div>
                  {codeRows.map(row=>(<div key={row.code} className="flex items-center gap-4 py-2.5" style={{borderBottom:'1px solid #EDE9E0'}}>
                    <span className="mono-font text-[10px] font-bold text-stone-800 w-16 shrink-0">{row.code}</span>
                    <span className="display-font text-[11px] text-stone-500 flex-1 truncate">{row.label||'—'}</span>
                    <span className="mono-font text-[9px] text-stone-400 w-12 text-right shrink-0">{row.total} cases</span>
                    <WinBar rate={row.rate}/>
                    <span className="mono-font text-[8px] px-2 py-0.5 shrink-0" style={{background:row.total>=2?'#D1FAE5':'#FEF3C7',color:row.total>=2?'#064E3B':'#78350F'}}>{row.total>=2?'CALIBRATED':'NEEDS DATA'}</span>
                  </div>))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

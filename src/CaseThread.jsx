// ═══════════════════════════════════════════════════════════════════════════════
// CASE THREAD — one COV- case travelling through all seven tools
// ═══════════════════════════════════════════════════════════════════════════════
// The tools stay first-class destinations. This module is the connective layer:
//   • stageOf()      — where a case sits in Triage → Desk → Multi → File → DFA
//   • <CaseLink>     — any case number, anywhere, opens the case panel
//   • <CasePanel>    — slide-over with pipeline strip, next action, timeline,
//                      parties, evidence, AI analysis, Duo/Trio links, notes
//   • <CaseSearch>   — find a case by number, merchant or cardholder (⌘K / Ctrl+K)
//   • <MobileMenu>   — the full tool list on small screens
//   • buildDemoInstitution() — a realistic portfolio for first-time visitors
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { accessToken, legalHoldsList, legalHoldSet, canWrite, canConfigure } from './auth.js'
import { exportCaseFile } from './caseExport.js'
import { auditWrite, auditList, AUDIT_LABELS, describeAudit } from './audit.js'

const OPEN_EVENT = 'cov:open-case'
export function openCase(id) { if (id) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { id } })) }
export function useOpenCaseListener(fn) {
  useEffect(() => {
    const h = e => fn(e.detail.id)
    window.addEventListener(OPEN_EVENT, h)
    return () => window.removeEventListener(OPEN_EVENT, h)
  }, [fn])
}

const readLS = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback } }

// ── Evidence links ────────────────────────────────────────────────────────────
// The evidence bucket is private: a document opens through a short-lived signed
// link from /api/evidence-url. Older uploads stored a public URL; the storage
// path is recovered from it so they open the same way.
export function evidencePath(d) {
  if (d?.path) return d.path
  const tail = String(d?.url || '').split('/object/public/cov-evidence/')[1]
  return tail ? decodeURIComponent(tail.split('?')[0]) : null
}
export async function openEvidence(d) {
  // Open the tab synchronously (inside the click) so popup blockers allow it
  const w = window.open('', '_blank')
  try {
    const token = accessToken()
    if (!token) throw new Error('sign in to open evidence')
    const r = await fetch('/api/evidence-url', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ path: evidencePath(d) }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.url) throw new Error(j.error || `HTTP ${r.status}`)
    if (w) { w.opener = null; w.location.href = j.url } else window.location.href = j.url
  } catch (e) {
    if (w) w.close()
    window.alert(`Could not open ${d?.name || 'document'}: ${e.message}`)
  }
}

// ── Stage model ───────────────────────────────────────────────────────────────
export const STAGES = [
  { id:'triage', num:'001', label:'Triage' },
  { id:'desk',   num:'002', label:'Desk'   },
  { id:'multi',  num:'003', label:'Multi'  },
  { id:'file',   num:'004', label:'File'   },
  { id:'dfa',    num:'005', label:'DFA'    },
]
const FILE_STAGE_STATUSES = ['filed','network_invstg','representment','pre_arb','arbitration','pending_arb','rebuttal_prep','submitted']
const CLOSED_STATUSES     = ['won','lost','withdrawn','resolved','closed']

export function stageOf(c) {
  if (!c) return 'triage'
  if (c._triageOnly) return 'triage'
  if (CLOSED_STATUSES.includes(c.status)) return 'closed'
  if (FILE_STAGE_STATUSES.includes(c.status)) return 'file'
  if (c.status === 'queued') return 'multi'
  return 'desk'
}
// done | current | todo | optional, per stage
export function stageStates(c) {
  const cur = stageOf(c)
  const order = ['triage','desk','multi','file']
  const idx = cur === 'closed' ? order.length : order.indexOf(cur)
  const out = {}
  order.forEach((s, i) => { out[s] = i < idx ? 'done' : i === idx ? 'current' : 'todo' })
  // A case that never went through Triage still counts Triage as passed once it is past intake
  if (!c?._triageRecord && !c?._triageOnly && cur !== 'triage') out.triage = 'skipped'
  out.dfa = c?.dfaScore ? 'done' : 'optional'
  return out
}
const STATUS_LABEL = s => (s || 'pending').replace(/_/g, ' ').toUpperCase()
const STATUS_BG = s => s === 'won' ? '#064E3B' : s === 'lost' ? '#7F1D1D' : s === 'queued' ? '#4C1D95'
  : FILE_STAGE_STATUSES.includes(s) ? '#92400E' : '#E7E2D9'
const STATUS_FG = s => (['won','lost','queued'].includes(s) || FILE_STAGE_STATUSES.includes(s)) ? '#F9FAFB' : '#4B4540'

export function StatusChip({ status }) {
  return <span className="mono-font" style={{ fontSize:'9px', padding:'2px 6px', letterSpacing:'0.06em', background:STATUS_BG(status), color:STATUS_FG(status), whiteSpace:'nowrap' }}>{STATUS_LABEL(status)}</span>
}

// Compact five-dot pipeline for list rows
export function PipelineDots({ c }) {
  const st = stageStates(c)
  return (
    <span title={`Stage: ${stageOf(c)}`} style={{ display:'inline-flex', gap:'3px', alignItems:'center' }}>
      {STAGES.map(s => {
        const v = st[s.id]
        const bg = v === 'done' ? '#1A1814' : v === 'current' ? '#D97706' : 'transparent'
        const bd = v === 'todo' || v === 'optional' || v === 'skipped' ? '#C9C0B2' : bg
        return <span key={s.id} style={{ width:'7px', height:'7px', borderRadius:'50%', background:bg, border:`1px solid ${bd}`, display:'inline-block' }} />
      })}
    </span>
  )
}

// ── Case lookup across tools ──────────────────────────────────────────────────
// cov_outcomes is the shared record; Triage's intake log fills in the first stage.
export function allThreadCases(outcomes) {
  const triage = readLS('triage_outcomes', [])
  const byId = new Map()
  ;(outcomes || []).forEach(o => byId.set(o.id, { ...o }))
  triage.forEach(t => {
    if (!t?.id) return
    if (byId.has(t.id)) byId.set(t.id, { ...byId.get(t.id), _triageRecord: t })
    else byId.set(t.id, { id:t.id, date:t.date, merchant:t.merchant, amount:t.amount, network:t.network,
      verdict:t.verdict, confidence:t.confidence, status:'triaged', isDemo:t.isDemo, _triageOnly:true, _triageRecord:t })
  })
  return [...byId.values()].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
}

export function CaseLink({ id, style, className }) {
  if (!id) return null
  return (
    <button type="button" onClick={e => { e.stopPropagation(); openCase(id) }}
      className={`mono-font ${className || ''}`} title="Open case"
      style={{ background:'none', border:'none', padding:0, cursor:'pointer', textDecoration:'underline', textDecorationColor:'#C9C0B2', textUnderlineOffset:'3px', color:'inherit', font:'inherit', ...style }}>
      {id}
    </button>
  )
}

// ── Next action per stage ─────────────────────────────────────────────────────
function nextAction(c) {
  const stage = stageOf(c)
  if (stage === 'triage') return { label:'Build the case in Desk', go:'desk-handoff', hint:'Triage is done — carry the classification into a full dispute.' }
  if (stage === 'desk')   return { label:'Open in Desk', go:'desk', hint:'Analyse the complaint and pick the reason code.' }
  if (stage === 'multi')  return { label:'File in Multi', go:'multi', hint:'Queued — goes out with the next batch or file it now.' }
  if (stage === 'file') {
    const d = c.nextRespDate ? Math.round((new Date(c.nextRespDate + 'T12:00:00') - new Date()) / 86400000) : null
    return { label:'Track in File', go:'file', hint: d === null ? 'Filed — watch for the merchant response.' : d < 0 ? `Response overdue by ${-d}d.` : `Next response due in ${d}d.` , urgent: d !== null && d <= 3 }
  }
  return { label:'View in File', go:'file', hint:`Closed — ${STATUS_LABEL(c.status).toLowerCase()}.` }
}

// ── Case panel ────────────────────────────────────────────────────────────────
export function CasePanel({ caseId, outcomes, setOutcomes, onClose, onGo, onDeskOpen, onTriageHandoff, onScoreInDfa, onSendToDuo, covUser }) {
  const [note, setNote] = useState('')
  const [trail, setTrail] = useState(null)
  const [hold, setHold] = useState(null)        // legal hold on this case, if any
  const [exporting, setExporting] = useState(false)
  const c = useMemo(() => allThreadCases(outcomes).find(x => x.id === caseId), [caseId, outcomes])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // Signed in, real case: record the view and load the case's audit trail
  const audited = !!covUser?.authed && !!caseId && !isDemoCase({ id: caseId })
  useEffect(() => {
    setTrail(null)
    if (!audited) return
    auditWrite('case.viewed', 'case', caseId)
    auditList(caseId, 100).then(setTrail).catch(() => setTrail([]))
    legalHoldsList().then(h => setHold(h.find(x => x.case_id === caseId) || null)).catch(() => setHold(null))
  }, [caseId, audited])
  if (!caseId) return null

  const duo  = readLS('duo_my_sessions', []).filter(s => s.caseId === caseId)
  const trio = readLS('cov_trio_incidents', []).filter(i => (i.linkedCaseIds || []).includes(caseId))

  const timeline = []
  if (c) {
    const t = c._triageRecord
    if (t) timeline.push({ ts:t.date, kind:'TRIAGE', text:`Classified ${(t.verdict||'').replace(/_/g,' ').toLowerCase() || '—'}${t.routing ? ` · routed to ${t.routing.replace(/_/g,' ').toLowerCase()}` : ''}${t.confidence ? ` · ${t.confidence} confidence` : ''}` })
    ;(c.history || []).forEach(h => timeline.push({ ts:h.ts, kind: h.event === 'created' ? 'OPENED' : 'STATUS',
      text: h.event === 'created' ? `Case opened (${STATUS_LABEL(h.status).toLowerCase()})` : `${STATUS_LABEL(h.from).toLowerCase()} → ${STATUS_LABEL(h.status).toLowerCase()}`, by:h.by }))
    if (c.ai?.ts) timeline.push({ ts:c.ai.ts, kind:'AI', text:`Desk analysis · ${c.reasonCode || ''} ${c.reasonTitle || ''}`.trim() })
    if (c.filedAt && !(c.history||[]).some(h => h.status === 'filed')) timeline.push({ ts:c.filedAt, kind:'FILED', text:`Filed${c.filedBy ? ` by ${c.filedBy}` : ''}` })
    if (c.dfaScoredAt) timeline.push({ ts:c.dfaScoredAt, kind:'DFA', text:`Scored for funding · grade ${c.dfaScore}${c.dfaFundability ? ` · ${c.dfaFundability}/100` : ''}` })
    if (c.resolvedDate) timeline.push({ ts:c.resolvedDate, kind:'CLOSED', text:`Resolved · ${STATUS_LABEL(c.status).toLowerCase()}` })
    ;(c.docs || []).forEach(d => timeline.push({ ts:d.uploadedAt, kind:'EVIDENCE', text:`Uploaded ${d.name}`, by:d.uploadedBy }))
    ;(Array.isArray(c.notes) ? c.notes : typeof c.notes === 'string' && c.notes.trim() ? [{ text:c.notes, ts:c.updatedAt }] : [])
      .forEach(n => timeline.push({ ts:n.ts, kind:'NOTE', text:n.text, by:n.author }))
    duo.forEach(s => timeline.push({ ts:s.joinedAt, kind:'DUO', text:`${s.role === 'b' ? 'Joined' : 'Opened'} Duo session ${s.id}` }))
  }
  timeline.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))

  const addNote = () => {
    const text = note.trim(); if (!text || !c || c._triageOnly) return
    setOutcomes(prev => prev.map(o => o.id === caseId
      ? { ...o, notes:[...(Array.isArray(o.notes) ? o.notes : typeof o.notes === 'string' && o.notes.trim() ? [{ text:o.notes, ts:null, author:'' }] : []),
                       { text, ts:new Date().toISOString(), author: covUser?.name || 'Agent' }] }
      : o))
    setNote('')
  }

  const act = (go) => {
    if (!c) return
    if (go === 'desk-handoff') onTriageHandoff(c)
    else if (go === 'desk') onDeskOpen(c)
    else onGo(go)
    onClose()
  }
  const stageClick = (s) => {
    if (!c) return
    if (s === 'dfa') { onScoreInDfa(c); onClose(); return }
    if (s === 'desk') { c._triageOnly ? onTriageHandoff(c) : onDeskOpen(c); onClose(); return }
    onGo(s); onClose()
  }

  const st = c ? stageStates(c) : {}
  const na = c ? nextAction(c) : null
  const Label = ({ children }) => <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.16em', color:'#8A7F72', marginBottom:'8px' }}>{children}</div>
  const Row = ({ k, v }) => v ? (
    <div style={{ display:'flex', justifyContent:'space-between', gap:'12px', padding:'5px 0', borderBottom:'1px solid #EDE7DC' }}>
      <span className="mono-font" style={{ fontSize:'10px', color:'#8A7F72' }}>{k}</span>
      <span className="display-font" style={{ fontSize:'13px', color:'#1A1814', textAlign:'right' }}>{v}</span>
    </div>) : null

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9000, display:'flex', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,24,20,0.45)' }} />
      <aside role="dialog" aria-label={`Case ${caseId}`}
        style={{ position:'relative', width:'min(560px, 100vw)', height:'100%', background:'#F5F1EA', overflowY:'auto', boxShadow:'-12px 0 40px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div style={{ background:'#1A1814', padding:'18px 22px 20px', position:'sticky', top:0, zIndex:1 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.2em', color:'#8A7F72' }}>COV CASE{c?.isDemo ? ' · DEMO' : ''}</span>
            <button onClick={onClose} aria-label="Close" style={{ background:'none', border:'none', color:'#8A7F72', fontSize:'16px', cursor:'pointer' }}>✕</button>
          </div>
          <div className="mono-font" style={{ fontSize:'18px', letterSpacing:'0.12em', color:'#F5F1EA', marginTop:'6px' }}>{caseId}</div>
          {c && <div className="display-font" style={{ fontSize:'24px', color:'#F5F1EA', marginTop:'2px', lineHeight:1.15 }}>
            {c.merchant || '—'} <span style={{ fontStyle:'italic', color:'#A8A29E', fontSize:'18px' }}>{c.amount || ''}</span>
          </div>}
          {c && <div style={{ marginTop:'10px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <StatusChip status={c.status} />
            {hold && <span className="mono-font" title={hold.reason || 'Legal hold'} style={{ fontSize:'9px', letterSpacing:'0.08em', padding:'2px 6px', background:'#7F1D1D', color:'#FEF2F2' }}>LEGAL HOLD</span>}
            {c.reasonCode && <span className="mono-font" style={{ fontSize:'10px', color:'#D6CFC4' }}>{c.network ? `${c.network} ` : ''}{c.reasonCode}{c.reasonTitle ? ` · ${c.reasonTitle}` : ''}</span>}
          </div>}
        </div>

        {!c ? (
          <div className="display-font" style={{ padding:'40px 22px', color:'#78716C', fontStyle:'italic' }}>This case isn’t in this workspace.</div>
        ) : (
        <div style={{ padding:'20px 22px 40px', display:'flex', flexDirection:'column', gap:'22px' }}>
          {/* Pipeline strip */}
          <div>
            <Label>PIPELINE</Label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4CCBC' }}>
              {STAGES.map(s => {
                const v = st[s.id]
                const bg = v === 'current' ? '#1A1814' : v === 'done' ? '#E3DDD5' : '#F5F1EA'
                const fg = v === 'current' ? '#F5F1EA' : v === 'todo' || v === 'optional' || v === 'skipped' ? '#A8A29E' : '#1A1814'
                return (
                  <button key={s.id} onClick={() => stageClick(s.id)} title={`Open ${s.label}`}
                    className="mono-font" style={{ background:bg, color:fg, border:'none', padding:'9px 6px', cursor:'pointer', textAlign:'left' }}>
                    <div style={{ fontSize:'7px', letterSpacing:'0.2em', opacity:0.7 }}>{s.num}</div>
                    <div style={{ fontSize:'10px', letterSpacing:'0.08em', fontWeight:600 }}>{v === 'done' ? '✓ ' : ''}{s.label.toUpperCase()}</div>
                    <div style={{ fontSize:'7px', letterSpacing:'0.1em', marginTop:'2px', opacity:0.75 }}>{v === 'skipped' ? 'DIRECT' : v === 'optional' ? 'OPTIONAL' : v.toUpperCase()}</div>
                  </button>
                )
              })}
            </div>
            {stageOf(c) === 'closed' && <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', color:'#57534E', marginTop:'6px' }}>CLOSED · {STATUS_LABEL(c.status)}{c.resolvedDate ? ` · ${new Date(c.resolvedDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}</div>}
          </div>

          {/* Next action */}
          <div style={{ border:`1px solid ${na.urgent ? '#B45309' : '#1A1814'}`, background: na.urgent ? '#FFFBEB' : '#FAF7F1', padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={{ minWidth:0 }}>
              <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.16em', color: na.urgent ? '#B45309' : '#8A7F72' }}>NEXT ACTION</div>
              <div className="display-font" style={{ fontSize:'14px', color:'#1A1814', marginTop:'3px' }}>{na.hint}</div>
            </div>
            <button className="cov-btn" style={{ padding:'10px 16px', fontSize:'10px' }} onClick={() => act(na.go)}>{na.label} →</button>
          </div>

          {/* Secondary actions */}
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            {!c._triageOnly && <button className="upload-btn" onClick={() => { onScoreInDfa(c); onClose() }}>Score in DFA</button>}
            <button className="upload-btn" onClick={() => { onSendToDuo(c); onClose() }}>Coordinate in Duo</button>
            <button className="upload-btn" onClick={() => { onGo('trio'); onClose() }}>Link to Trio incident</button>
            {/* Case file for regulators / legal — every role, demo included */}
            <button className="upload-btn" disabled={exporting} onClick={async () => {
              setExporting(true)
              try {
                await exportCaseFile(c, { timeline, trail: trail || [], hold, exportedBy: covUser?.email || covUser?.name || '',
                  institution: covUser?.authed ? covUser.institution : 'Demo institution', isDemo: isDemoCase(c) })
              } finally { setExporting(false) }
            }}>{exporting ? 'Exporting…' : 'Export case file'}</button>
            {/* Legal hold: admins and reviewers, real cases only. Held cases are never purged. */}
            {audited && covUser?.authed && canConfigure() && (
              <button className="upload-btn" style={hold ? { borderColor:'#7F1D1D', color:'#7F1D1D' } : undefined} onClick={async () => {
                try {
                  if (hold) {
                    if (!window.confirm(`Lift the legal hold on ${caseId}? It will become eligible for retention purge again.`)) return
                    await legalHoldSet(caseId, false); setHold(null)
                  } else {
                    const reason = window.prompt(`Reason for the legal hold on ${caseId} (e.g. litigation, regulator request):`, '')
                    if (reason === null) return
                    await legalHoldSet(caseId, true, reason); setHold({ case_id: caseId, reason, set_at: new Date().toISOString() })
                  }
                  auditList(caseId, 100).then(setTrail).catch(() => {})
                } catch (e) { window.alert(e.message) }
              }}>{hold ? 'Lift legal hold' : 'Place legal hold'}</button>
            )}
          </div>

          {/* AI analysis */}
          {(c.ai?.summary || c._triageRecord) && (
            <div>
              <Label>AI ANALYSIS</Label>
              {c.ai?.summary && <p className="display-font" style={{ fontSize:'14px', lineHeight:1.6, color:'#2D2922', margin:0 }}>{c.ai.summary}</p>}
              {c.ai?.rationale && <p className="display-font" style={{ fontSize:'12px', lineHeight:1.6, color:'#78716C', margin:'8px 0 0', fontStyle:'italic' }}>Why: {c.ai.rationale}</p>}
              {Array.isArray(c.ai?.missing) && c.ai.missing.length > 0 && (
                <div className="mono-font" style={{ fontSize:'10px', color:'#92400E', marginTop:'8px' }}>Still needed: {c.ai.missing.join(' · ')}</div>
              )}
              {!c.ai?.summary && c._triageRecord && <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:0 }}>Triage verdict: {(c._triageRecord.verdict || '—').replace(/_/g,' ').toLowerCase()} ({c._triageRecord.confidence || '—'} confidence).</p>}
            </div>
          )}

          {/* Parties & details */}
          <div>
            <Label>PARTIES & DETAILS</Label>
            <Row k="Cardholder" v={c.cardholderName} />
            <Row k="Merchant / payee" v={c.merchant} />
            <Row k="Network" v={c.network} />
            <Row k="Category" v={c.category ? c.category.replace(/^mc_/,'').replace(/_/g,' ') : (c.verdict || '').replace(/_/g,' ').toLowerCase()} />
            <Row k="3-D Secure" v={c.threeDSStatus} />
            <Row k="Assigned to" v={c.assignedTo} />
            <Row k="Opened" v={c.date ? new Date(c.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : null} />
            <Row k="Next response due" v={c.nextRespDate} />
            {duo.map(s => <Row key={s.id} k={`Duo ${s.id}`} v={s.myInstitution ? `${s.myInstitution} (you) + counterparty` : 'Shared session'} />)}
          </div>

          {/* Evidence */}
          <div>
            <Label>EVIDENCE ({(c.docs || []).length})</Label>
            {(c.docs || []).length === 0
              ? <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E' }}>No documents yet — upload from the Desk tracker.</div>
              : (c.docs || []).map((d, i) => (
                <button key={i} onClick={() => openEvidence(d)} title="Opens a link that expires in 5 minutes" className="mono-font"
                  style={{ display:'block', background:'none', border:'none', textAlign:'left', cursor:'pointer', fontSize:'11px', color:'#1E3A5F', padding:'4px 0', textDecoration:'underline' }}>{d.name}</button>
              ))}
          </div>

          {/* Collaboration */}
          {(duo.length > 0 || trio.length > 0) && (
            <div>
              <Label>LINKED COORDINATION</Label>
              {duo.map(s => (
                <button key={s.id} onClick={() => { onGo('duo'); onClose() }} className="mono-font" style={{ display:'block', background:'none', border:'none', padding:'4px 0', fontSize:'11px', color:'#064E3B', cursor:'pointer' }}>Duo · {s.id} · {(s.lastStatus || 'active').replace(/_/g,' ')}</button>
              ))}
              {trio.map(i => (
                <button key={i.id} onClick={() => { onGo('trio'); onClose() }} className="mono-font" style={{ display:'block', background:'none', border:'none', padding:'4px 0', fontSize:'11px', color:'#7F1D1D', cursor:'pointer' }}>Trio · {i.id} · {i.title || i.name || 'incident'}</button>
              ))}
            </div>
          )}

          {/* Audit trail — from the institution's append-only log */}
          {audited && (
            <div>
              <Label>AUDIT TRAIL</Label>
              {trail === null ? <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E' }}>Loading…</div>
                : trail.length === 0 ? <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E' }}>No entries yet.</div>
                : trail.slice(0, 30).map(e => (
                  <div key={e.id} className="mono-font" style={{ fontSize:'10px', color:'#57534E', padding:'4px 0', borderBottom:'1px solid #EDE7DC', display:'flex', gap:'10px' }}>
                    <span style={{ color:'#A8A29E', whiteSpace:'nowrap' }}>{new Date(e.at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>
                    <span style={{ minWidth:0 }}>{AUDIT_LABELS[e.action] || e.action}{describeAudit(e) ? ` · ${describeAudit(e)}` : ''} <span style={{ color:'#A8A29E' }}>— {e.actor_email || 'system'}</span></span>
                  </div>
                ))}
            </div>
          )}

          {/* Timeline */}
          <div>
            <Label>TIMELINE</Label>
            {timeline.length === 0 ? <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E' }}>No activity recorded yet.</div> : (
              <div style={{ borderLeft:'1px solid #D4CCBC', marginLeft:'4px' }}>
                {timeline.map((e, i) => (
                  <div key={i} style={{ position:'relative', padding:'0 0 12px 16px' }}>
                    <span style={{ position:'absolute', left:'-4px', top:'4px', width:'7px', height:'7px', borderRadius:'50%', background: i === 0 ? '#1A1814' : '#C9C0B2' }} />
                    <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.1em', color:'#8A7F72' }}>
                      {e.kind} · {e.ts ? new Date(e.ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—'}{e.by ? ` · ${e.by}` : ''}
                    </div>
                    <div className="display-font" style={{ fontSize:'13px', color:'#2D2922', lineHeight:1.5 }}>{e.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Note */}
          {!c._triageOnly && canWrite() && (
            <div>
              <Label>ADD NOTE</Label>
              <div style={{ display:'flex', gap:'8px' }}>
                <input className="cov-input" style={{ padding:'10px 12px', fontSize:'14px' }} value={note} placeholder="Findings, calls, next steps…"
                  onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote() }} />
                <button className="cov-btn" style={{ padding:'10px 14px' }} onClick={addNote} disabled={!note.trim()}>ADD</button>
              </div>
            </div>
          )}
        </div>
        )}
      </aside>
    </div>
  )
}

// ── Case search (⌘K / Ctrl+K) ─────────────────────────────────────────────────
export function CaseSearch({ outcomes, open, setOpen }) {
  const [q, setQ] = useState('')
  const inputRef = useRef(null)
  useEffect(() => {
    const k = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [setOpen])
  useEffect(() => { if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])
  const cases = useMemo(() => open ? allThreadCases(outcomes) : [], [open, outcomes])
  if (!open) return null
  const term = q.trim().toLowerCase()
  const hits = (term ? cases.filter(c => [c.id, c.merchant, c.cardholderName, c.reasonCode, c.amount].some(v => String(v || '').toLowerCase().includes(term))) : cases).slice(0, 12)
  return (
    <div role="dialog" aria-label="Search cases" style={{ position:'fixed', inset:0, zIndex:9500, background:'rgba(26,24,20,0.55)', display:'flex', justifyContent:'center', alignItems:'flex-start', padding:'max(12px, 8vh) 12px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div style={{ width:'100%', maxWidth:'600px', background:'#F5F1EA', border:'1px solid #1A1814', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', borderBottom:'1px solid #D4CCBC' }}>
          {/* 16px text stops iOS zooming into the field */}
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} className="cov-input" type="search" enterKeyHint="go"
            placeholder="Search cases…" aria-label="Search cases"
            onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { openCase(hits[0].id); setOpen(false) } }}
            style={{ border:'none', fontSize:'16px', flex:1, minWidth:0 }} />
          <button onClick={() => setOpen(false)} aria-label="Close search" title="Close (Esc)"
            style={{ flexShrink:0, width:'48px', height:'48px', background:'none', border:'none', borderLeft:'1px solid #D4CCBC', color:'#57534E', fontSize:'18px', cursor:'pointer' }}>✕</button>
        </div>
        <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.1em', color:'#A8A29E', padding:'6px 16px', borderBottom:'1px solid #EDE7DC' }}>
          CASE NUMBER · MERCHANT · CARDHOLDER · REASON CODE
        </div>
        <div style={{ maxHeight:'55vh', overflowY:'auto' }}>
          {hits.length === 0 ? <div className="mono-font" style={{ fontSize:'11px', color:'#A8A29E', padding:'16px' }}>No cases match.</div>
            : hits.map(c => {
              // Second line: amount · reason code / verdict — fills the row and helps tell similar merchants apart
              const detail = [c.amount, c.reasonCode ? `${c.network ? c.network + ' ' : ''}${c.reasonCode}` : (c.verdict || '').replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')
              return (
              <button key={c.id} onClick={() => { openCase(c.id); setOpen(false) }} className="cov-search-row"
                style={{ display:'flex', width:'100%', gap:'12px', alignItems:'center', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #EDE7DC', cursor:'pointer', textAlign:'left' }}>
                <span style={{ width:'84px', flexShrink:0, display:'flex', flexDirection:'column', gap:'3px' }}>
                  <span className="mono-font" style={{ fontSize:'10px', color:'#78716C', whiteSpace:'nowrap' }}>{c.id}</span>
                  {isDemoCase(c) && <span className="mono-font" style={{ fontSize:'8px', letterSpacing:'0.12em', color:'#8A7F72', border:'1px dashed #B8B0A4', padding:'0 4px', width:'fit-content' }}>DEMO</span>}
                </span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span className="display-font" style={{ display:'block', fontSize:'14px', color:'#1A1814', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'}</span>
                  {detail && <span className="mono-font" style={{ display:'block', fontSize:'10px', color:'#A8A29E', marginTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{detail}</span>}
                </span>
                {/* Fixed-width columns keep dots and status aligned row to row */}
                <span className="desktop-only" style={{ width:'52px', flexShrink:0, display:'flex', justifyContent:'flex-start' }}><PipelineDots c={c} /></span>
                <span className="cov-search-status" style={{ width:'112px', flexShrink:0, display:'flex', justifyContent:'flex-end' }}><StatusChip status={c.status} /></span>
              </button>
            )})}
        </div>
        <div className="mono-font desktop-only" style={{ fontSize:'9px', letterSpacing:'0.12em', color:'#A8A29E', padding:'8px 16px' }}>ENTER TO OPEN · ESC TO CLOSE</div>
      </div>
    </div>
  )
}

// ── Mobile menu ───────────────────────────────────────────────────────────────
export function MobileMenu({ nav, active, onSelect, user, onSignIn, onSignOut }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const k = e => { if (e.key === 'Escape') setOpen(false) }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', k)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', k) }
  }, [open])
  const item = (isActive) => ({ display:'block', width:'100%', textAlign:'left', padding:'14px 20px', background: isActive ? '#2D2922' : 'transparent',
    color: isActive ? '#F5F1EA' : '#A8A29E', border:'none', borderBottom:'1px solid #2D2922', fontSize:'11px', letterSpacing:'0.14em', cursor:'pointer' })
  return (
    <div className="mobile-only">
      <button onClick={() => setOpen(o => !o)} aria-label="Menu" aria-expanded={open}
        className="mono-font cov-nav-icon" style={{ background:'transparent', border:'1px solid #3D3A35', color:'#D6CFC4', cursor:'pointer' }}>
        {open ? '✕' : '☰'}
      </button>
      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:'48px 0 0 0', background:'rgba(26,24,20,0.45)', zIndex:59 }} />
          <div className="cov-mobile-menu" style={{ position:'fixed', top:'48px', left:0, right:0, maxHeight:'calc(100vh - 48px)', overflowY:'auto', background:'#1A1814', borderTop:'1px solid #2D2922', zIndex:60, boxShadow:'0 12px 24px rgba(0,0,0,0.35)' }}>
            {nav.map(({ id, label }) => (
              <button key={id} onClick={() => { onSelect(id); setOpen(false) }} className="mono-font cov-mobile-item" style={item(active === id)}>
                {label.replace(/\s+/g, ' ')}
              </button>
            ))}
            {/* Account — moved here from the top bar on phones */}
            {user && (
              <div style={{ padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', borderTop:'1px solid #3D3A35' }}>
                <div style={{ minWidth:0 }}>
                  <div className="mono-font" style={{ fontSize:'11px', color:'#E7E4DF', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.name}</div>
                  <div className="mono-font" style={{ fontSize:'9px', color:'#78716C', letterSpacing:'0.08em', marginTop:'3px' }}>{user.authed ? user.institution : 'DEMO — not signed in'}</div>
                </div>
                <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
                  {onSignIn && <button onClick={() => { setOpen(false); onSignIn() }} className="mono-font cov-mobile-acct" style={{ background:'transparent', border:'1px solid #D6CFC4', color:'#E7E4DF', padding:'8px 12px', fontSize:'10px', letterSpacing:'0.1em', cursor:'pointer' }}>SIGN IN</button>}
                  <button onClick={() => { setOpen(false); onSignOut() }} className="mono-font cov-mobile-acct" style={{ background:'transparent', border:'1px solid #3D3A35', color:'#A8A29E', padding:'8px 12px', fontSize:'10px', letterSpacing:'0.1em', cursor:'pointer' }}>{user.authed ? 'SIGN OUT' : 'LEAVE DEMO'}</button>
                </div>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// ── Demo institution ──────────────────────────────────────────────────────────
// Fictional merchants and cardholders. Demo cases are flagged isDemo and are
// never pushed to the shared Supabase pool. The COV-DEMO prefix is reserved, so
// a case Desk builds from a demo triage record still counts as demo.
export const isDemoCase = c => !!c && (c.isDemo || /^(COV|MCH)-DEMO/.test(c.id || ''))
export function buildDemoInstitution(userEmail) {
  const day = 86400000
  const iso = d => new Date(Date.now() - d * day).toISOString()
  const ymd = d => new Date(Date.now() + d * day).toISOString().slice(0, 10)
  const me = userEmail || ''
  const h = (...steps) => steps.map(([d, status, from]) => from
    ? { ts: iso(d), event:'status', from, status, by:'Demo Analyst' }
    : { ts: iso(d), event:'created', status, by:'Demo Analyst' })
  const base = { isDemo:true, notes:[], docs:[] }
  const cases = [
    { id:'COV-DEMO01', date:iso(2),  merchant:'Northwind Electronics', amount:'1249.99 USD', network:'VISA', status:'received', category:'fraud', verdict:'TRUE_FRAUD', cardholderName:'J. Okafor', confidence:'HIGH', threeDSStatus:'none', history:h([2,'received']),
      _complaint:'I did not make this purchase. My card was in my wallet the whole time and I have never shopped at Northwind.' },
    { id:'COV-DEMO02', date:iso(1),  merchant:'Lumen Streaming', amount:'17.99 USD', network:'MC', status:'pending', category:'mc_consumer_dispute', verdict:'CONSUMER_DISPUTE', cardholderName:'A. Reyes', confidence:'MEDIUM', history:h([1,'pending']),
      _complaint:'I cancelled my subscription in March but was still charged in April and May.' },
    { id:'COV-DEMO03', date:iso(6),  merchant:'Harbor Air', amount:'842.40 USD', network:'VISA', status:'queued', category:'fraud', verdict:'TRUE_FRAUD', reasonCode:'10.4', reasonTitle:'Other Fraud — Card Absent', cardholderName:'M. Chen', confidence:'HIGH', threeDSStatus:'none', avsMismatch:true, assignedTo:me,
      ai:{ summary:'Cardholder reports an unrecognised card-not-present airline purchase. AVS mismatch on the billing address and no 3-D Secure authentication support a 10.4 fraud chargeback.', rationale:'CNP + AVS mismatch + no 3DS', missing:[], ts:iso(5) },
      history:h([6,'received'],[5,'queued','received']) },
    { id:'COV-DEMO04', date:iso(8),  merchant:'QuickCart Grocery', amount:'312.18 USD', network:'MC', status:'queued', category:'mc_fraud', verdict:'TRUE_FRAUD', reasonCode:'4837', reasonTitle:'No Cardholder Authorization', cardholderName:'D. Patel', confidence:'MEDIUM', assignedTo:me, history:h([8,'received'],[7,'queued','received']) },
    { id:'COV-DEMO05', date:iso(9),  merchant:'Atlas Furniture', amount:'1980.00 USD', network:'VISA', status:'queued', category:'consumer_dispute', verdict:'CONSUMER_DISPUTE', reasonCode:'13.1', reasonTitle:'Merchandise / Services Not Received', cardholderName:'S. Laurent', confidence:'MEDIUM',
      ai:{ summary:'Sofa ordered with a promised 3-week delivery; nothing received after 9 weeks and the merchant has stopped responding.', rationale:'Expected delivery date passed, merchant contact attempts logged', missing:['Order confirmation with promised delivery date'], ts:iso(8) },
      history:h([9,'received'],[8,'queued','received']) },
    { id:'COV-DEMO06', date:iso(18), merchant:'Brightline Fitness', amount:'89.00 USD', network:'VISA', status:'filed', category:'consumer_dispute', verdict:'CONSUMER_DISPUTE', reasonCode:'13.2', reasonTitle:'Cancelled Recurring Transaction', cardholderName:'K. Novak', filedAt:iso(12), filedBy:'Demo Analyst', history:h([18,'received'],[15,'queued','received'],[12,'filed','queued']) },
    { id:'COV-DEMO07', date:iso(25), merchant:'Pacific Rail Tickets', amount:'264.50 USD', network:'MC', status:'network_invstg', category:'mc_fraud', verdict:'TRUE_FRAUD', reasonCode:'4837', reasonTitle:'No Cardholder Authorization', cardholderName:'L. Haddad', filedAt:iso(20), history:h([25,'received'],[22,'queued','received'],[20,'filed','queued'],[9,'network_invstg','filed']) },
    { id:'COV-DEMO08', date:iso(34), merchant:'Copperleaf Hotels', amount:'1415.75 USD', network:'VISA', status:'representment', category:'consumer_dispute', verdict:'CONSUMER_DISPUTE', reasonCode:'13.6', reasonTitle:'Credit Not Processed', cardholderName:'R. Asante', filedAt:iso(28), nextRespDate:ymd(3), provCreditDate:iso(30), assignedTo:me,
      notes:[{ text:'Merchant representment claims refund was issued — no credit visible on statement. Requesting ARN.', ts:iso(2), author:'Demo Analyst' }],
      history:h([34,'received'],[31,'queued','received'],[28,'filed','queued'],[4,'representment','filed']) },
    { id:'COV-DEMO09', date:iso(48), merchant:'Zenith Gaming Credits', amount:'560.00 USD', network:'MC', status:'pre_arb', category:'mc_fraud', verdict:'TRUE_FRAUD', reasonCode:'4863', reasonTitle:'Cardholder Does Not Recognize', cardholderName:'T. Ibrahim', filedAt:iso(42), nextRespDate:ymd(6), history:h([48,'received'],[45,'queued','received'],[42,'filed','queued'],[20,'representment','filed'],[5,'pre_arb','representment']) },
    { id:'COV-DEMO10', date:iso(40), merchant:'Meridian Telecom', amount:'134.99 USD', network:'VISA', status:'won', category:'processing_error', verdict:'CONSUMER_DISPUTE', reasonCode:'12.6', reasonTitle:'Duplicate Processing', cardholderName:'E. Moreau', filedAt:iso(36), resolvedDate:iso(10), dfaScore:'A', dfaFundability:82, dfaScoredAt:iso(30),
      history:h([40,'received'],[38,'queued','received'],[36,'filed','queued'],[10,'won','filed']) },
    { id:'COV-DEMO11', date:iso(52), merchant:'Orbit Rideshare', amount:'46.20 USD', network:'MC', status:'won', category:'mc_fraud', verdict:'TRUE_FRAUD', reasonCode:'4837', reasonTitle:'No Cardholder Authorization', cardholderName:'P. Svensson', filedAt:iso(49), resolvedDate:iso(21), history:h([52,'received'],[50,'queued','received'],[49,'filed','queued'],[21,'won','filed']) },
    { id:'COV-DEMO12', date:iso(57), merchant:'Solace Wellness', amount:'720.00 USD', network:'VISA', status:'lost', category:'consumer_dispute', verdict:'CONSUMER_DISPUTE', reasonCode:'13.3', reasonTitle:'Not as Described or Defective', cardholderName:'N. Kowalski', filedAt:iso(53), resolvedDate:iso(14),
      notes:[{ text:'Lost on representment — merchant produced signed service agreement. Customer informed.', ts:iso(14), author:'Demo Analyst' }],
      history:h([57,'received'],[55,'queued','received'],[53,'filed','queued'],[30,'representment','filed'],[14,'lost','representment']) },
    // Merchant / acquirer side — chargebacks received against the merchant (Desk merchant mode)
    { id:'MCH-DEMO01', mode:'merchant', date:iso(3),  merchant:'Northwind Electronics', amount:'689.00 USD', network:'VISA', status:'received', reasonCode:'13.1', reasonTitle:'Merchandise / Services Not Received', acquirer:'Demo Acquiring', threeDSStatus:'authenticated', deliveryConfirmed:true, winProb:'HIGH', history:h([3,'received']) },
    { id:'MCH-DEMO02', mode:'merchant', date:iso(11), merchant:'Northwind Electronics', amount:'1249.99 USD', network:'VISA', status:'rebuttal_prep', reasonCode:'10.4', reasonTitle:'Other Fraud — Card Absent', acquirer:'Demo Acquiring', threeDSStatus:'authenticated', deliveryConfirmed:true, liabilityShift:true, winProb:'HIGH', nextRespDate:ymd(4),
      notes:[{ text:'3DS authenticated — liability shift applies. Pulling delivery photo and IP match for rebuttal.', ts:iso(1), author:'Demo Analyst' }],
      history:h([11,'received'],[2,'rebuttal_prep','received']) },
    { id:'MCH-DEMO03', mode:'merchant', date:iso(26), merchant:'Northwind Electronics', amount:'214.50 USD', network:'MC', status:'submitted', reasonCode:'4853', reasonTitle:'Cardholder Dispute', acquirer:'Demo Acquiring', threeDSStatus:'none', deliveryConfirmed:true, winProb:'MEDIUM', history:h([26,'received'],[20,'rebuttal_prep','received'],[15,'submitted','rebuttal_prep']) },
    { id:'MCH-DEMO04', mode:'merchant', date:iso(45), merchant:'Northwind Electronics', amount:'98.00 USD', network:'VISA', status:'won', reasonCode:'13.2', reasonTitle:'Cancelled Recurring Transaction', acquirer:'Demo Acquiring', resolvedDate:iso(18), winProb:'HIGH', history:h([45,'received'],[41,'rebuttal_prep','received'],[37,'submitted','rebuttal_prep'],[18,'won','submitted']) },
  ].map(c => ({ ...base, ...c, updatedAt: iso(0) }))
  const triage = [
    // Crypto Exchange triage log (Triage → Crypto Exchange mode)
    { id:'COV-DEMO15', date:iso(1), merchant:'Unhosted wallet 0x7a3f…c91e', amount:'2.4 ETH', accountType:'crypto_exchange', network:'Ethereum', verdict:'AUTHORIZED_PUSH_PAYMENT', confidence:'HIGH', routing:'ACCOUNT_FREEZE', outcome:'pending', isDemo:true },
    { id:'COV-DEMO16', date:iso(4), merchant:'Halcyon Exchange', amount:'18,500 USDT', accountType:'crypto_exchange', network:'Tron', verdict:'TRUE_FRAUD', confidence:'MEDIUM', routing:'ACCOUNT_FREEZE', outcome:'confirmed', isDemo:true },
    { id:'COV-DEMO13', date:iso(0), merchant:'Veridian Crypto Exchange', amount:'4200 USD', accountType:'debit', network:'', verdict:'AUTHORIZED_PUSH_PAYMENT', confidence:'HIGH', routing:'ACCOUNT_FREEZE', outcome:'pending', fraud_sub_type:'investment_scam', isDemo:true },
    { id:'COV-DEMO14', date:iso(0), merchant:'Keystone Tutoring', amount:'380 USD', accountType:'credit', network:'visa', verdict:'CONSUMER_DISPUTE', confidence:'MEDIUM', routing:'CARD_CHARGEBACK', outcome:'pending', isDemo:true },
    // Triage records for cases that have since moved on, so their pipeline shows Triage ✓
    { id:'COV-DEMO01', date:iso(2), merchant:'Northwind Electronics', amount:'1249.99 USD', accountType:'credit', network:'visa', verdict:'TRUE_FRAUD', confidence:'HIGH', routing:'CARD_CHARGEBACK', outcome:'pending', isDemo:true },
    { id:'COV-DEMO03', date:iso(6), merchant:'Harbor Air', amount:'842.40 USD', accountType:'credit', network:'visa', verdict:'TRUE_FRAUD', confidence:'HIGH', routing:'CARD_CHARGEBACK', outcome:'pending', isDemo:true },
  ]
  return { cases, triage }
}

// Storage is written before any tool reads it: tools load their own copy on
// mount and save it back, so seeding after they mount gets overwritten.
function writeDemoToStorage(userEmail) {
  const { cases, triage } = buildDemoInstitution(userEmail)
  try {
    localStorage.setItem('triage_outcomes', JSON.stringify([...triage, ...readLS('triage_outcomes', []).filter(t => !isDemoCase(t))]))
    localStorage.setItem('cov_outcomes', JSON.stringify([...cases, ...readLS('cov_outcomes', []).filter(o => !isDemoCase(o))]))
    localStorage.setItem('cov_demo_loaded', DEMO_VERSION)
  } catch {}
  return cases
}

// Bump when the demo set changes; browsers holding an older set get it refreshed.
const DEMO_VERSION = '3'

// First visit: a new visitor gets a working portfolio instead of empty screens.
// Call before the tools mount. Returns true when it seeded.
export function seedDemoIfFirstVisit(userEmail) {
  try {
    const loaded = localStorage.getItem('cov_demo_loaded')
    if (loaded && loaded !== DEMO_VERSION) { writeDemoToStorage(userEmail); return true }
    if (localStorage.getItem('cov_demo_offered')) return false
    localStorage.setItem('cov_demo_offered', '1')
    if (readLS('cov_outcomes', []).length > 0 || readLS('triage_outcomes', []).length > 0) return false
    writeDemoToStorage(userEmail)
    return true
  } catch { return false }
}

// From the Home button: callers remount the tools afterwards so they re-read storage.
export function loadDemoInstitution(setOutcomes, userEmail) {
  const cases = writeDemoToStorage(userEmail)
  setOutcomes(prev => [...cases, ...prev.filter(o => !isDemoCase(o))])
}

export function clearDemoInstitution(setOutcomes) {
  try {
    localStorage.setItem('triage_outcomes', JSON.stringify(readLS('triage_outcomes', []).filter(t => !isDemoCase(t))))
    // saveOutcomes merges rather than replaces, so remove demo rows from storage directly
    localStorage.setItem('cov_outcomes', JSON.stringify(readLS('cov_outcomes', []).filter(o => !isDemoCase(o))))
    localStorage.removeItem('cov_demo_loaded')
  } catch {}
  setOutcomes(prev => prev.filter(o => !isDemoCase(o)))
}

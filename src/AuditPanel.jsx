// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT PANEL — Settings → Audit log: recent activity, integrity check, export
// ═══════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react'
import { auditList, auditVerify, auditWrite, AUDIT_LABELS, describeAudit } from './audit.js'
import { CaseLink } from './CaseThread.jsx'

const mono = { fontFamily:"'JetBrains Mono',monospace" }
const fmt = ts => new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })

export function AuditPanel({ covUser }) {
  const [rows,    setRows]    = useState(null)
  const [q,       setQ]       = useState('')
  const [err,     setErr]     = useState('')
  const [check,   setCheck]   = useState(null)   // null | 'running' | { ok, checked, first_bad_id }
  const [limit,   setLimit]   = useState(25)     // newest first; "Show more" adds 25
  const load = () => auditList(null, 500).then(r => { setRows(r); setErr('') }).catch(e => { setRows([]); setErr(e.message) })
  useEffect(() => { load() }, [covUser?.institutionId])

  const term = q.trim().toLowerCase()
  const shown = (rows || []).filter(e => !term || [e.actor_email, e.action, AUDIT_LABELS[e.action], e.entity_id, describeAudit(e)].some(v => String(v || '').toLowerCase().includes(term)))

  const verify = async () => {
    setCheck('running')
    try { setCheck(await auditVerify()) } catch (e) { setCheck({ ok:false, error:e.message }) }
  }
  const exportCsv = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['id','time_utc','actor','action','entity','entity_id','detail'].join(',')]
    ;(rows || []).forEach(e => lines.push([e.id, new Date(e.at).toISOString(), e.actor_email, e.action, e.entity, e.entity_id, JSON.stringify(e.detail || {})].map(esc).join(',')))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type:'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href:url, download:`covalence-audit-${new Date().toISOString().slice(0,10)}.csv` })
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    auditWrite('audit.exported', 'audit', '', { rows: (rows || []).length })
  }

  return (
    <div className="border border-stone-300 mb-6" style={{ background:'#FAF7F1' }}>
      <div className="px-5 py-3" style={{ ...mono, fontSize:'10px', letterSpacing:'0.15em', color:'#6B5F4D', borderBottom:'1px solid #D4CCBC', display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap', alignItems:'center' }}>
        <span>AUDIT LOG · APPEND-ONLY</span>
        <span style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button className="cov-btn-secondary" style={{ padding:'5px 10px' }} onClick={verify} disabled={check === 'running'}>{check === 'running' ? 'CHECKING…' : 'VERIFY INTEGRITY'}</button>
          <button className="cov-btn-secondary" style={{ padding:'5px 10px' }} onClick={exportCsv} disabled={!rows?.length}>EXPORT CSV</button>
        </span>
      </div>
      <div className="px-5 py-4">
        <p className="display-font" style={{ fontSize:'12px', color:'#78716C', lineHeight:1.5, margin:'0 0 12px' }}>
          {covUser?.demo
            ? 'Demo Bank’s log, kept in your browser and fingerprinted entry by entry — as a real workspace does in the database.'
            : 'Recorded by the database; entries can’t be edited or deleted, and each is fingerprinted to the one before it.'}
        </p>
        {check && check !== 'running' && (
          <div style={{ ...mono, fontSize:'11px', padding:'8px 12px', marginBottom:'12px', border:`1px solid ${check.ok ? '#065F46' : '#B91C1C'}`, background: check.ok ? '#ECFDF5' : '#FEF2F2', color: check.ok ? '#065F46' : '#991B1B' }}>
            {check.error ? `Could not verify: ${check.error}`
              : check.ok ? `✓ Intact — all ${check.checked} entries match their fingerprints.`
              : `✗ Chain broken at entry #${check.first_bad_id} (after ${check.checked - 1} good entries). Contact support.`}
          </div>
        )}
        <input className="cov-input" style={{ padding:'8px 12px', fontSize:'14px', marginBottom:'10px' }} placeholder="Filter by person, action, case number…" value={q} onChange={e => setQ(e.target.value)} />
        {err && <div style={{ ...mono, fontSize:'11px', color:'#B91C1C', marginBottom:'8px' }}>{err}</div>}
        {rows === null ? <div style={{ ...mono, fontSize:'10px', color:'#A8A29E' }}>Loading…</div>
          : shown.length === 0 ? <div style={{ ...mono, fontSize:'10px', color:'#A8A29E' }}>{rows.length ? 'Nothing matches.' : 'No activity recorded yet.'}</div>
          : (
          <div style={{ borderTop:'1px solid #EDE7DC' }}>
            {shown.slice(0, limit).map(e => (
              <div key={e.id} style={{ display:'grid', gridTemplateColumns:'minmax(96px,auto) minmax(0,1fr)', gap:'2px 14px', padding:'6px 0', borderBottom:'1px solid #EDE7DC' }}>
                <span style={{ ...mono, fontSize:'10px', color:'#8A7F72', whiteSpace:'nowrap' }}>{fmt(e.at)}</span>
                <span style={{ minWidth:0 }}>
                  <span className="display-font" style={{ fontSize:'13px', color:'#1A1814' }}>{AUDIT_LABELS[e.action] || e.action}</span>
                  {e.entity_id && <span style={{ ...mono, fontSize:'10px', color:'#57534E', marginLeft:'8px' }}>{e.entity === 'case' ? <CaseLink id={e.entity_id} /> : e.entity_id}</span>}
                  <span style={{ ...mono, display:'block', fontSize:'10px', color:'#A8A29E', marginTop:'1px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={`${e.actor_email || 'system'}${describeAudit(e) ? ` · ${describeAudit(e)}` : ''}`}>
                    {e.actor_email || 'system'}{describeAudit(e) ? ` · ${describeAudit(e)}` : ''}
                  </span>
                </span>
              </div>
            ))}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0 0', ...mono, fontSize:'10px', color:'#A8A29E' }}>
              <span>Showing {Math.min(limit, shown.length)} of {shown.length}</span>
              {shown.length > limit && <button className="cov-btn-secondary" style={{ padding:'4px 10px' }} onClick={() => setLimit(l => l + 25)}>SHOW MORE</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

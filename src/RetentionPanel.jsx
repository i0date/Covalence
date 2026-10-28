// ═══════════════════════════════════════════════════════════════════════════════
// RETENTION PANEL — Settings → Data retention: period, legal holds, purge
// ═══════════════════════════════════════════════════════════════════════════════
// Admins set how long closed cases are kept and run the purge; everyone signed in
// can see the policy and which cases are on legal hold.
import React, { useEffect, useState } from 'react'
import { retentionGet, retentionSet, retentionCandidates, legalHoldsList, accessToken, isSignedIn } from './auth.js'
import { demoRpc } from './demoBackend.js'
import { CaseLink } from './CaseThread.jsx'
import { readCases } from './caseStore.js'

const mono = { fontFamily:"'JetBrains Mono',monospace" }
const YEARS = [1, 2, 3, 5, 7, 10]

export function RetentionPanel({ covUser }) {
  const isAdmin = covUser?.role === 'admin'
  const [pol,   setPol]   = useState(null)
  const [holds, setHolds] = useState([])
  const [cands, setCands] = useState(null)   // null until previewed
  const [busy,  setBusy]  = useState(false)
  const [msg,   setMsg]   = useState('')
  const [err,   setErr]   = useState('')
  const load = () => {
    retentionGet().then(setPol).catch(e => setErr(e.message))
    legalHoldsList().then(setHolds).catch(() => {})
  }
  useEffect(load, [covUser?.institutionId])

  const years = pol ? Math.round(pol.closed_case_days / 365) : 5
  const change = async (y) => {
    setErr(''); setMsg('')
    try { await retentionSet(y * 365); load(); setCands(null) } catch (e) { setErr(e.message) }
  }
  const preview = () => retentionCandidates().then(setCands).catch(e => setErr(e.message))
  const purge = async () => {
    if (!cands?.length) return
    if (!window.confirm(`Permanently delete ${cands.length} closed case${cands.length === 1 ? '' : 's'} and their evidence files? Cases on legal hold are kept. This can’t be undone; each deletion is recorded in the audit log.`)) return
    setBusy(true); setErr(''); setMsg('')
    try {
      // Demo Bank: purge the demo cases in this browser and tell the open tools
      if (!isSignedIn()) {
        const n = await demoRpc('retention_purge', { p_case_ids: cands.map(c => c.case_id) })
        const list = readCases()
        ;(window._covSubscribers || []).forEach(fn => { try { fn(list) } catch {} })
        setMsg(`Purged ${n} demo case${n === 1 ? '' : 's'} (demo evidence files are kept only for the browser session anyway).`)
        setCands(null); load(); setBusy(false); return
      }
      const r = await fetch('/api/retention', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${accessToken()}` }, body: JSON.stringify({ caseIds: cands.map(c => c.case_id) }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setMsg(`Purged ${j.purged} case${j.purged === 1 ? '' : 's'} and ${j.files} evidence file${j.files === 1 ? '' : 's'}.`)
      setCands(null); load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="border border-stone-300 mb-6" style={{ background:'#FAF7F1' }}>
      <div className="px-5 py-3" style={{ ...mono, fontSize:'10px', letterSpacing:'0.15em', color:'#6B5F4D', borderBottom:'1px solid #D4CCBC' }}>DATA RETENTION</div>
      <div className="px-5 py-4" style={{ display:'grid', gap:'16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
          <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>Keep closed cases for</span>
          {isAdmin ? (
            <select className="input-field" style={{ width:'auto', padding:'6px 10px', fontSize:'14px' }} value={YEARS.includes(years) ? years : ''} onChange={e => change(Number(e.target.value))}>
              {!YEARS.includes(years) && <option value="">{years} years</option>}
              {YEARS.map(y => <option key={y} value={y}>{y} year{y === 1 ? '' : 's'}</option>)}
            </select>
          ) : <b className="display-font" style={{ fontSize:'14px' }}>{years} years</b>}
          <span style={{ ...mono, fontSize:'10px', color:'#A8A29E' }}>after they’re won, lost or withdrawn</span>
        </div>
        <p className="display-font" style={{ fontSize:'12px', color:'#78716C', lineHeight:1.6, margin:0 }}>
          Set this to your record-keeping obligations (for example, five years for SAR supporting documentation under the BSA). Cases on legal hold are never purged.
          {pol && <> {pol.eligible} case{pol.eligible === 1 ? ' is' : 's are'} past the period now · {pol.on_hold} on legal hold · {pol.purged_total} purged so far.</>}
        </p>

        {holds.length > 0 && (
          <div>
            <div style={{ ...mono, fontSize:'10px', letterSpacing:'0.15em', color:'#8A7F72', marginBottom:'4px' }}>ON LEGAL HOLD</div>
            {holds.map(h => (
              <div key={h.case_id} style={{ ...mono, fontSize:'11px', display:'flex', gap:'10px', padding:'5px 0', borderBottom:'1px solid #EDE7DC', flexWrap:'wrap' }}>
                <CaseLink id={h.case_id} />
                <span style={{ color:'#57534E', flex:1, minWidth:0 }}>{h.reason || '—'}</span>
                <span style={{ color:'#A8A29E' }}>{new Date(h.set_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{h.set_by_email ? ` · ${h.set_by_email}` : ''}</span>
              </div>
            ))}
            <div style={{ ...mono, fontSize:'10px', color:'#A8A29E', marginTop:'4px' }}>Place or lift a hold from the case panel.</div>
          </div>
        )}

        {isAdmin && (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <button className="cov-btn-secondary" onClick={preview}>PREVIEW ELIGIBLE CASES</button>
            {cands && (cands.length === 0
              ? <span style={{ ...mono, fontSize:'11px', color:'#065F46' }}>Nothing to purge.</span>
              : <button className="cov-btn" style={{ padding:'8px 14px', fontSize:'10px', background:'#7F1D1D' }} disabled={busy} onClick={purge}>
                  {busy ? 'PURGING…' : `PURGE ${cands.length} CASE${cands.length === 1 ? '' : 'S'}`}
                </button>)}
          </div>
        )}
        {cands?.length > 0 && (
          <div style={{ maxHeight:'180px', overflowY:'auto', borderTop:'1px solid #EDE7DC' }}>
            {cands.map(c => (
              <div key={c.case_id} style={{ ...mono, fontSize:'11px', display:'flex', gap:'10px', padding:'4px 0', borderBottom:'1px solid #EDE7DC' }}>
                <CaseLink id={c.case_id} /><span style={{ color:'#57534E' }}>{c.status}</span>
                <span style={{ color:'#A8A29E' }}>closed {new Date(c.closed_on).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ ...mono, fontSize:'11px', color:'#065F46' }}>{msg}</div>}
        {err && <div style={{ ...mono, fontSize:'11px', color:'#B91C1C' }}>{err}</div>}
      </div>
    </div>
  )
}

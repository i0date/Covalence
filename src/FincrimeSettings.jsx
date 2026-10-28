// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL CRIME SETTINGS — Settings → Financial crime
// ═══════════════════════════════════════════════════════════════════════════════
// The OFAC lists in use and when they were downloaded, screening options, and a
// work queue: unresolved sanctions matches, confirmed matches awaiting the OFAC
// report, and cases waiting on a SAR decision or filing.
import React, { useEffect, useState } from 'react'
import { openCase } from './CaseThread.jsx'
import { CLOSED_STATUSES } from './clocks.mjs'
import { FINCRIME_DEFAULTS, screeningStatus } from './fincrime.js'
import { Badge } from './ui.jsx'

const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px' }
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 12px', fontWeight:500 }}>{children}</h2>

function Queue({ title, tone, rows, empty }) {
  return (
    <div style={{ marginBottom:'14px' }}>
      <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'6px' }}>
        <span className="display-font" style={{ fontSize:'15px', fontWeight:600, color:'#1A1814' }}>{title}</span>
        <Badge tone={rows.length ? tone : 'neutral'}>{rows.length}</Badge>
      </div>
      {rows.length === 0 ? <div className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>{empty}</div> : rows.map(({ c, note }) => (
        <button key={c.id} onClick={() => openCase(c.id)} className="cov-search-row mono-font"
          style={{ display:'flex', gap:'12px', width:'100%', textAlign:'left', background:'none', border:'none', borderTop:'1px solid #EDE7DC', padding:'6px 0', cursor:'pointer', fontSize:'11px', color:'#1A1814' }}>
          <span style={{ color:'#57534E', flexShrink:0 }}>{c.id}</span>
          <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'} · {c.amount || ''}</span>
          <span style={{ color:'#6B6259', flexShrink:0 }}>{note}</span>
        </button>
      ))}
    </div>
  )
}

export function FincrimeSettings({ settings, set, locked, outcomes }) {
  const s = { ...FINCRIME_DEFAULTS, ...settings }
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/sanctions').then(r => r.json().then(d => r.ok ? setList(d.list) : setErr(d.error || `HTTP ${r.status}`))).catch(() => setErr('The screening service couldn’t be reached.'))
  }, [])

  const real = (outcomes || []).filter(c => !c._triageOnly)
  const open = real.filter(c => !CLOSED_STATUSES.includes(c.status))
  const screened = open.filter(c => c.screening).length
  const potential = real.filter(c => screeningStatus(c) === 'potential').map(c => ({ c, note: `${c.screening.hits.length} hit${c.screening.hits.length === 1 ? '' : 's'} · ${day(c.screening.ts)}` }))
  const toReport = real.filter(c => screeningStatus(c) === 'confirmed' && !c.ofacReportedAt).map(c => ({ c, note: `confirmed ${day(c.screening.decision.ts)}` }))
  const sar = real.filter(c => c.sarReview && (!c.sarReview.decision || (c.sarReview.decision === 'file' && !c.sarReview.filedAt)))
    .map(c => ({ c, note: c.sarReview.decision === 'file' ? 'to file' : `decide by ${day(new Date(new Date(c.sarReview.flaggedAt).getTime() + 30 * 86400000))}` }))

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:'20px', alignItems:'start' }}>
      <section style={box}>
        <H2>WORK QUEUE</H2>
        <Queue title="Possible sanctions matches" tone="danger" rows={potential} empty="None waiting." />
        <Queue title="Confirmed matches to report to OFAC" tone="danger" rows={toReport} empty="None waiting." />
        <Queue title="SAR decisions and filings" tone="warn" rows={sar} empty="None waiting." />
        <div className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{screened} of {open.length} open cases screened.</div>
      </section>

      <section style={box}>
        <H2>SANCTIONS LISTS</H2>
        {list ? (
          <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 12px' }}>
            {list.source}: {list.entries.toLocaleString()} entries and {list.wallets} crypto addresses, downloaded from the US Treasury {day(list.fetchedAt)} and refreshed every 12 hours.
          </p>
        ) : <p className="mono-font" style={{ fontSize:'11px', color: err ? '#991B1B' : '#6B6259', margin:'0 0 12px' }}>{err || 'Checking the lists…'}</p>}
        <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, display:'grid', gap:'12px', opacity: locked ? 0.75 : 1 }}>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', cursor:'pointer' }}>
            <input type="checkbox" checked={s.screeningAuto !== false} onChange={e => set('screeningAuto', e.target.checked)} />
            Screen new and changed cases automatically
          </label>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            Flag names that match at least
            <select className="input-field" value={s.screeningThreshold} onChange={e => set('screeningThreshold', Number(e.target.value))} style={{ padding:'6px 8px', fontSize:'14px' }}>
              {[[0.85, '85% — catches more spellings, more to clear'], [0.88, '88%'], [0.9, '90% — recommended'], [0.92, '92%'], [0.95, '95% — fewer alerts, may miss variants']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <p className="display-font" style={{ fontSize:'13px', color:'#57534E', lineHeight:1.5, margin:0 }}>
            Cardholders, merchants and payees, and any crypto wallet addresses in a case, are screened. Wallets must match exactly. Ship and aircraft names are skipped.
            SAR thresholds for the AML signals are set under Institution settings ({(settings?.sarThreshold || 5000).toLocaleString()} for cards, {(settings?.sarThresholdCrypto || 10000).toLocaleString()} for crypto).
          </p>
        </fieldset>
      </section>
    </div>
  )
}

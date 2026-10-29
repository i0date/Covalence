// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL CRIME SETTINGS — Settings → Financial crime
// ═══════════════════════════════════════════════════════════════════════════════
// The OFAC lists in use and the screening options. The work itself — matches,
// OFAC reports, investigations, SARs — happens in 005 Licit (tools/Licit.jsx).
import React, { useEffect, useState } from 'react'
import { CLOSED_STATUSES } from './clocks.mjs'
import { FINCRIME_DEFAULTS, screeningStatus } from './fincrime.js'
import { TM_DEFAULTS, FRAUD_DEFAULTS } from './monitoring.mjs'
import { SharingSettings } from './SharingPanel.jsx'

const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px' }
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 12px', fontWeight:500 }}>{children}</h2>

export function FincrimeSettings({ settings, set, locked, outcomes, admin }) {
  const s = { ...FINCRIME_DEFAULTS, ...TM_DEFAULTS, ...FRAUD_DEFAULTS, ...settings }
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/sanctions').then(r => r.json().then(d => r.ok ? setList(d.list) : setErr(d.error || `HTTP ${r.status}`))).catch(() => setErr('The screening service couldn’t be reached.'))
  }, [])

  const real = (outcomes || []).filter(c => !c._triageOnly)
  const open = real.filter(c => !CLOSED_STATUSES.includes(c.status))
  const potential = real.filter(c => screeningStatus(c) === 'potential').map(c => ({ c, note: `${c.screening.hits.length} hit${c.screening.hits.length === 1 ? '' : 's'} · ${day(c.screening.ts)}` }))
  const toReport = real.filter(c => screeningStatus(c) === 'confirmed' && !c.ofacReportedAt).map(c => ({ c, note: `confirmed ${day(c.screening.decision.ts)}` }))
  const sar = real.filter(c => c.sarReview && (!c.sarReview.decision || (c.sarReview.decision === 'file' && !c.sarReview.filedAt)))
    .map(c => ({ c, note: c.sarReview.decision === 'file' ? 'to file' : `decide by ${day(new Date(new Date(c.sarReview.flaggedAt).getTime() + 30 * 86400000))}` }))

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:'20px', alignItems:'start' }}>
      <section style={box}>
        <H2>WHERE THE WORK HAPPENS</H2>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.55, margin:0 }}>
          Possible matches, OFAC reports, investigations and SARs are worked in <strong>005 Licit</strong>. This page holds the settings.
          {' '}{potential.length + toReport.length + sar.length > 0 && <>Waiting now: {potential.length} possible match{potential.length === 1 ? '' : 'es'}, {toReport.length} OFAC report{toReport.length === 1 ? '' : 's'}, {sar.length} SAR task{sar.length === 1 ? '' : 's'}.</>}
        </p>
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

      <SharingSettings admin={admin} />

      <section style={box}>
        <H2>FRAUD ALERTS (001 TRIAGE)</H2>
        <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, display:'grid', gap:'10px', opacity: locked ? 0.75 : 1 }}>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', cursor:'pointer' }}>
            <input type="checkbox" checked={s.fraudEnabled !== false} onChange={e => set('fraudEnabled', e.target.checked)} /> Run the fraud rules
          </label>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', justifyContent:'space-between', gap:'12px', alignItems:'center' }}>
            <span>Reach the customer within (hours) <span style={{ display:'block', fontSize:'12px', color:'#6B6259' }}>Leave empty for no deadline.</span></span>
            <input type="number" min={1} max={168} value={s.fraudContactHours ?? ''} placeholder="—" onChange={e => set('fraudContactHours', e.target.value === '' ? null : Math.max(1, Math.min(168, Number(e.target.value) || 1)))} className="cov-input" style={{ width:'110px', padding:'6px 8px', fontSize:'14px' }} aria-label="Reach the customer within hours" />
          </label>
          {[['fraudAtoMin', 'Account takeover: money out after the changes — at least', 1, 1000000], ['fraudCardTestMax', 'Card testing: tiny charges of at most', 1, 50],
            ['fraudCardTestCount', '…this many within 24 hours', 2, 100], ['fraudScamMin', 'Scam: first payment to a new payee of at least', 100, 1000000],
            ['fraudDormantDays', 'Dormant: no activity for (days)', 30, 730], ['fraudDormantMin', '…then at least this much moving', 100, 1000000],
            ['fraudCppMin', 'Compromised merchant: fraud victims who used it — at least', 2, 50], ['fraudNewAddressMin', 'Exchanges: withdrawal to a just-added address of at least', 100, 1000000]].map(([k, l, min, max]) => (
            <label key={k} className="display-font" style={{ fontSize:'14px', display:'flex', justifyContent:'space-between', gap:'12px', alignItems:'center' }}>
              <span>{l}</span>
              <input type="number" min={min} max={max} value={s[k] ?? FRAUD_DEFAULTS[k]} onChange={e => set(k, Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="cov-input" style={{ width:'110px', padding:'6px 8px', fontSize:'14px' }} aria-label={l} />
            </label>
          ))}
        </fieldset>
      </section>

      <section style={box}>
        <H2>AML MONITORING RULES (005 LICIT)</H2>
        <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, display:'grid', gap:'10px', opacity: locked ? 0.75 : 1 }}>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', cursor:'pointer' }}>
            <input type="checkbox" checked={s.tmEnabled !== false} onChange={e => set('tmEnabled', e.target.checked)} /> Run the rules on every import
          </label>
          {[['tmCtr', 'Cash reporting threshold (structuring looks just under it)', 1000, 100000], ['tmRapidMin', 'Money in and back out within 3 days — at least', 500, 1000000],
            ['tmFanCount', 'Senders paying in, or new payees, within 7 days — at least', 2, 100], ['tmVelocityMultiple', 'Outflow this week vs. the usual week — times', 2, 50],
            ['tmVelocityMin', '…and at least', 500, 1000000], ['tmCryptoMin', 'Sent to crypto within 7 days — at least', 100, 1000000], ['tmRoundMin', 'Round-dollar payments of at least', 500, 1000000]].map(([k, l, min, max]) => (
            <label key={k} className="display-font" style={{ fontSize:'14px', display:'flex', justifyContent:'space-between', gap:'12px', alignItems:'center' }}>
              <span>{l}</span>
              <input type="number" min={min} max={max} value={s[k] ?? TM_DEFAULTS[k]} onChange={e => set(k, Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="cov-input" style={{ width:'110px', padding:'6px 8px', fontSize:'14px' }} aria-label={l} />
            </label>
          ))}
          <label className="display-font" style={{ fontSize:'14px', display:'grid', gap:'4px' }}>
            High-risk countries (ISO codes)
            <input value={s.tmHighRiskCountries ?? TM_DEFAULTS.tmHighRiskCountries} onChange={e => set('tmHighRiskCountries', e.target.value.toUpperCase())} className="cov-input" style={{ padding:'6px 8px', fontSize:'14px' }} />
            <span style={{ fontSize:'12px', color:'#6B6259' }}>Starts with FATF’s call-for-action list (IR, KP, MM). Add the grey-list and internal high-risk countries your policy names.</span>
          </label>
        </fieldset>
      </section>
    </div>
  )
}

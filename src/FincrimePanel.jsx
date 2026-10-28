// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL CRIME PANEL — the case file's sanctions, AML and OSINT section
// ═══════════════════════════════════════════════════════════════════════════════
// Sanctions: the latest OFAC screening and its hits; admins and reviewers clear
//   a potential match or confirm it (then record the OFAC report).
// AML: the signals behind the case's risk level, the cases they link to, and
//   the SAR decision (file / don't file, with a rationale; then the BSA ID).
// OSINT: counterparty-only lookups — domain age and links to open sources.
// Rules and lookups are in fincrime.js; this file is the screen.
import React, { useEffect, useMemo, useState } from 'react'
import { canWrite, canConfigure } from './auth.js'
import { auditWrite } from './audit.js'
import { openCase } from './CaseThread.jsx'
import { amlIndex, amlSignals, domainAge, osintLinks, screenCase, screeningStatus } from './fincrime.js'
import { Badge, Button, Input } from './ui.jsx'

const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : ''
const H = ({ children }) => <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', margin:'14px 0 6px' }}>{children}</div>
const P = ({ children, style }) => <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.5, margin:'4px 0', ...style }}>{children}</p>
const STATUS = {
  none: ['NOT SCREENED', 'neutral'], clear: ['CLEAR', 'ok'], potential: ['POTENTIAL MATCH', 'danger'],
  false_positive: ['CLEARED — FALSE POSITIVE', 'neutral'], confirmed: ['CONFIRMED MATCH', 'danger'],
}
const LEVEL = { none: ['NO SIGNALS', 'ok'], low: ['LOW', 'neutral'], medium: ['MEDIUM', 'warn'], high: ['HIGH', 'danger'] }

function NoteForm({ label, placeholder, onSubmit, onCancel, submitLabel, danger }) {
  const [v, setV] = useState('')
  return (
    <div style={{ display:'grid', gap:'6px', marginTop:'8px' }}>
      <label className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.1em', color:'#57534E' }}>{label}
        <textarea value={v} onChange={e => setV(e.target.value)} rows={2} placeholder={placeholder} className="cov-input" style={{ display:'block', width:'100%', marginTop:'4px', padding:'8px 10px', fontSize:'14px', resize:'vertical', fontFamily:'inherit' }} />
      </label>
      <div style={{ display:'flex', gap:'8px' }}>
        <Button small variant={danger ? 'danger' : 'primary'} disabled={v.trim().length < 5} onClick={() => onSubmit(v.trim())}>{submitLabel}</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export function FincrimePanel({ c, caseId, outcomes, setOutcomes, covUser, settings }) {
  const [mode, setMode] = useState(null)          // which form is open
  const [screening, setScreening] = useState(false)
  const [err, setErr] = useState('')
  const [ages, setAges] = useState({})
  const writable = canWrite() && !c._triageOnly
  const decider = writable && canConfigure()      // admins and reviewers decide on matches and SARs
  const who = covUser?.name || covUser?.email || 'Agent'
  const update = patch => setOutcomes(prev => prev.map(o => o.id === caseId ? { ...o, ...(typeof patch === 'function' ? patch(o) : patch) } : o))

  const status = screeningStatus(c), sc = c.screening
  const aml = useMemo(() => amlSignals(c, outcomes, settings, amlIndex(outcomes)), [c, outcomes, settings])
  const links = useMemo(() => osintLinks(c), [c])
  useEffect(() => {
    links.filter(g => g.domain && !ages[g.domain]).forEach(g => {
      setAges(a => ({ ...a, [g.domain]: { loading: true } }))
      domainAge(g.domain).then(d => setAges(a => ({ ...a, [g.domain]: d }))).catch(e => setAges(a => ({ ...a, [g.domain]: { error: e.message } })))
    })
  }, [links])

  const screenNow = async () => {
    setScreening(true); setErr('')
    try {
      const rec = await screenCase(c, settings, who)
      update(o => ({ screening: rec, screenings: [...(o.screenings || []), ...(o.screening ? [o.screening] : [])].slice(-5) }))
      auditWrite('sanctions.screened', 'case', caseId, { status: rec.status, hits: rec.hits.length, list: rec.list?.fetchedAt || '', manual: true })
    } catch (e) { setErr(e.message) } finally { setScreening(false) }
  }
  const decide = (outcome, note) => {
    update(o => ({ screening: { ...o.screening, decision: { outcome, note, by: who, byEmail: covUser?.email || '', ts: new Date().toISOString() } } }))
    auditWrite('sanctions.decided', 'case', caseId, { outcome, note }); setMode(null)
  }

  return (
    <div>
      {/* ── Monitoring alerts behind an AML case ── */}
      {c.alerts?.length > 0 && (<>
        <H>MONITORING ALERTS ({c.alerts.length})</H>
        {c.alerts.map(a => <P key={a.id}><strong>{a.label}</strong> — {a.detail} <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>({a.severity}, {day(a.to)})</span></P>)}
        {c.tmTransactions?.length > 0 && (
          <details style={{ margin:'4px 0 8px' }}>
            <summary className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#1E3A5F', cursor:'pointer' }}>{c.tmTransactions.length} TRANSACTIONS</summary>
            <ul className="mono-font" style={{ fontSize:'11px', color:'#1A1814', margin:'6px 0 0', paddingLeft:'16px', lineHeight:1.6 }}>
              {c.tmTransactions.map(t => <li key={t.id}>{day(t.ts)} · {t.direction === 'in' ? 'in' : 'out'} ${Math.round(t.amount).toLocaleString()} · {t.channel}{t.counterparty ? ` · ${t.counterparty}` : ''}{t.country ? ` · ${t.country}` : ''}</li>)}
            </ul>
          </details>
        )}
      </>)}

      {/* ── Sanctions ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
        <H>SANCTIONS SCREENING</H>
        <Badge tone={STATUS[status][1]}>{STATUS[status][0]}</Badge>
      </div>
      {sc ? (
        <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', lineHeight:1.6, overflowWrap:'anywhere' }}>
          {day(sc.ts)} · {sc.by} · {sc.list?.source || 'OFAC'} (downloaded {day(sc.list?.fetchedAt)}, {sc.list?.entries?.toLocaleString()} entries) · match at {Math.round((sc.threshold || 0.9) * 100)}%
          <br />Screened: {sc.screened.join(' · ') || 'nothing screenable'}
        </div>
      ) : <P>{writable ? 'Not screened yet. New and changed cases are screened automatically within a minute or two.' : 'Not screened yet.'}</P>}

      {sc?.hits?.length > 0 && (
        <ul style={{ listStyle:'none', margin:'8px 0 0', padding:0, display:'grid', gap:'6px' }}>
          {sc.hits.map((h, i) => (
            <li key={i} style={{ border:'1px solid #FCA5A5', background:'#FEF2F2', padding:'8px 10px', overflowWrap:'anywhere', minWidth:0 }}>
              <div className="display-font" style={{ fontSize:'14px', color:'#7F1D1D' }}>
                <strong>{h.subject}</strong> ({h.role}) ≈ <strong>{h.name}</strong> <span className="mono-font" style={{ fontSize:'11px' }}>{Math.round(h.score * 100)}%</span>
              </div>
              <div className="mono-font" style={{ fontSize:'10px', color:'#7F1D1D', marginTop:'2px', lineHeight:1.5 }}>
                {h.list} · {h.programs} · {h.type}{h.alias || h.wallet ? ` · matched “${h.matchedName}”` : ''}{h.remarks ? ` · ${h.remarks}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sc?.decision && (
        <P style={{ color: sc.decision.outcome === 'true_match' ? '#7F1D1D' : '#3F3A35' }}>
          {sc.decision.outcome === 'true_match' ? 'Confirmed as a true match' : 'Cleared as a false positive'} by {sc.decision.by}, {day(sc.decision.ts)} — “{sc.decision.note}”
        </P>
      )}
      {status === 'confirmed' && (
        <div style={{ border:'2px solid #7F1D1D', padding:'10px 12px', marginTop:'8px', background:'#FFFFFF' }}>
          <P style={{ margin:0, color:'#7F1D1D' }}><strong>Don’t pay, credit or release funds on this case.</strong> Block or reject as your sanctions procedures require, and report to OFAC within 10 business days.</P>
          {c.ofacReportedAt ? <P>OFAC report recorded {day(c.ofacReportedAt)}{c.ofacRef ? ` · reference ${c.ofacRef}` : ''}.</P>
            : decider && (mode === 'ofac'
              ? <NoteForm label="OFAC REPORT REFERENCE" placeholder="Reference or case number from your OFAC report" submitLabel="Record report"
                  onSubmit={ref => { update({ ofacReportedAt: new Date().toISOString(), ofacRef: ref }); auditWrite('sanctions.reported', 'case', caseId, { ref }); setMode(null) }} onCancel={() => setMode(null)} />
              : <div style={{ marginTop:'8px' }}><Button variant="secondary" onClick={() => setMode('ofac')}>Record the OFAC report</Button></div>)}
        </div>
      )}
      {status === 'potential' && (decider ? (
        mode === 'fp' ? <NoteForm label="WHY IS THIS NOT THEM?" placeholder="e.g. Different date of birth and nationality" submitLabel="Clear as false positive" onSubmit={n => decide('false_positive', n)} onCancel={() => setMode(null)} />
        : mode === 'tm' ? <NoteForm danger label="WHAT CONFIRMS THE MATCH?" placeholder="e.g. Name, date of birth and address all match" submitLabel="Confirm match" onSubmit={n => decide('true_match', n)} onCancel={() => setMode(null)} />
        : <div style={{ display:'flex', gap:'8px', marginTop:'8px', flexWrap:'wrap' }}>
            <Button variant="secondary" onClick={() => setMode('fp')}>False positive</Button>
            <Button variant="danger" onClick={() => setMode('tm')}>Confirm match</Button>
          </div>
      ) : <P style={{ fontSize:'13px', color:'#57534E' }}>An admin or reviewer decides whether this is a true match.</P>)}
      {writable && (
        <div style={{ marginTop:'8px' }}>
          <Button variant="quiet" onClick={screenNow} disabled={screening}>{screening ? 'Screening…' : sc ? 'Screen again' : 'Screen now'}</Button>
          {err && <span className="mono-font" role="alert" style={{ fontSize:'11px', color:'#991B1B', marginLeft:'8px' }}>{err}</span>}
        </div>
      )}

      {/* ── AML ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', flexWrap:'wrap', marginTop:'10px' }}>
        <H>AML SIGNALS</H>
        <Badge tone={LEVEL[aml.level][1]}>{LEVEL[aml.level][0]}{aml.score ? ` · ${aml.score}` : ''}</Badge>
      </div>
      {aml.signals.length === 0 ? <P>No money-laundering signals in this case or the cases linked to it.</P> : (
        <ul style={{ listStyle:'none', margin:0, padding:0, display:'grid', gap:'6px' }}>
          {aml.signals.map(s => (
            <li key={s.key} style={{ display:'flex', gap:'8px', alignItems:'baseline' }}>
              <span className="mono-font" style={{ fontSize:'10px', padding:'1px 5px', background: s.weight >= 3 ? '#7F1D1D' : s.weight === 2 ? '#92400E' : '#E7E2D9', color: s.weight >= 2 ? '#FFF7ED' : '#3F3A35', flexShrink:0 }}>+{s.weight}</span>
              <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>
                {s.label}<span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}> — {s.detail}</span>
                {s.cases.length > 0 && <span className="mono-font" style={{ fontSize:'11px' }}> · {s.cases.map(id => (
                  <button key={id} onClick={() => openCase(id)} style={{ background:'none', border:'none', padding:'0 3px', color:'#1E3A5F', textDecoration:'underline', cursor:'pointer', fontSize:'11px', fontFamily:'inherit' }}>{id}</button>
                ))}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {c.sarReview ? (
        <div style={{ border:'1px solid #D4CCBC', background:'#FFFFFF', padding:'10px 12px', marginTop:'10px' }}>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E' }}>SAR REVIEW · FLAGGED {day(c.sarReview.flaggedAt).toUpperCase()} · DECIDE BY {day(new Date(new Date(c.sarReview.flaggedAt).getTime() + 30 * 86400000)).toUpperCase()}</div>
          {c.sarReview.decision ? (
            <P>{c.sarReview.decision === 'file' ? 'Decision: file a SAR' : 'Decision: no SAR'} — {c.sarReview.by}, {day(c.sarReview.decidedAt)}. “{c.sarReview.rationale}”
              {c.sarReview.decision === 'file' && (c.sarReview.filedAt ? <> Filed {day(c.sarReview.filedAt)}, BSA ID {c.sarReview.bsaId}.</> : ' Not filed yet.')}</P>
          ) : <P>Someone with the reviewer or admin role decides whether to file a Suspicious Activity Report. FinCEN expects it within 30 days of first spotting the activity.</P>}
          {decider && !c.sarReview.decision && (mode === 'sar-file' || mode === 'sar-no'
            ? <NoteForm label={mode === 'sar-file' ? 'WHY FILE?' : 'WHY NOT FILE?'} placeholder={mode === 'sar-file' ? 'The suspicious activity, in a sentence or two' : 'e.g. Customer explained the payments; documents on file'}
                submitLabel={mode === 'sar-file' ? 'Decide: file a SAR' : 'Decide: no SAR'} danger={mode === 'sar-file'} onCancel={() => setMode(null)}
                onSubmit={r => { const decision = mode === 'sar-file' ? 'file' : 'no_file'; update(o => ({ sarReview: { ...o.sarReview, decision, rationale: r, by: who, byEmail: covUser?.email || '', decidedAt: new Date().toISOString() } })); auditWrite('sar.decided', 'case', caseId, { decision, rationale: r }); setMode(null) }} />
            : <div style={{ display:'flex', gap:'8px', marginTop:'8px', flexWrap:'wrap' }}>
                <Button variant="danger" onClick={() => setMode('sar-file')}>File a SAR</Button>
                <Button variant="secondary" onClick={() => setMode('sar-no')}>No SAR</Button>
              </div>)}
          {decider && c.sarReview.decision === 'file' && !c.sarReview.filedAt && (mode === 'sar-filed'
            ? <NoteForm label="BSA ID FROM FINCEN" placeholder="The BSA identifier on the filing acknowledgment" submitLabel="Record filing" onCancel={() => setMode(null)}
                onSubmit={id => { update(o => ({ sarReview: { ...o.sarReview, filedAt: new Date().toISOString(), bsaId: id } })); auditWrite('sar.filed', 'case', caseId, { bsaId: id }); setMode(null) }} />
            : <div style={{ marginTop:'8px' }}><Button variant="secondary" onClick={() => setMode('sar-filed')}>Record the filing</Button></div>)}
        </div>
      ) : writable && (
        <div style={{ marginTop:'8px' }}>
          <Button variant="quiet" onClick={() => { update({ sarReview: { flaggedAt: new Date().toISOString(), level: aml.level, signals: aml.signals.map(s => s.key), manual: true, by: who } }); auditWrite('aml.flagged', 'case', caseId, { level: aml.level, manual: true }) }}>Flag for SAR review</Button>
        </div>
      )}

      {/* ── OSINT ── */}
      {links.length > 0 && (<>
        <H>OPEN-SOURCE CHECKS · COUNTERPARTY ONLY</H>
        {links.map(g => {
          const a = g.domain ? ages[g.domain] : null
          return (
            <div key={g.group} style={{ marginBottom:'8px' }}>
              <div className="display-font" style={{ fontSize:'14px', color:'#1A1814', overflowWrap:'anywhere' }}>{g.group}</div>
              {a && !a.loading && (a.error ? <div className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Registration lookup failed: {a.error}</div>
                : !a.found ? <div className="mono-font" style={{ fontSize:'11px', color:'#92400E' }}>No registration found — the domain may not exist.</div>
                : <div className="mono-font" style={{ fontSize:'11px', color: a.ageDays != null && a.ageDays < 180 ? '#991B1B' : '#3F3A35' }}>
                    Registered {day(a.registered)}{a.ageDays != null ? ` (${a.ageDays < 60 ? `${a.ageDays} days` : `${Math.round(a.ageDays / 30.4)} months`} ago)` : ''}{a.registrar ? ` via ${a.registrar}` : ''}
                    {a.ageDays != null && a.ageDays < 180 && ' — new domains are common in scam storefronts'}
                  </div>)}
              <div style={{ display:'flex', gap:'4px 12px', flexWrap:'wrap', marginTop:'2px' }}>
                {g.links.map(([label, url]) => <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="mono-font" style={{ fontSize:'11px', color:'#1E3A5F' }}>{label} ↗</a>)}
              </div>
            </div>
          )
        })}
        <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }}>Links open in a new tab. Nothing about the customer is looked up.</div>
      </>)}
    </div>
  )
}

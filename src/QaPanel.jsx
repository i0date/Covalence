// ═══════════════════════════════════════════════════════════════════════════════
// QA PANEL — Settings → Quality review
// ═══════════════════════════════════════════════════════════════════════════════
// The month's sample of closed cases (qa.js), a review form for each, and how
// the AI did. Admins and reviewers record reviews and set the sample size;
// everyone else can read. Nobody reviews a case assigned to them.
import React, { useState } from 'react'
import { canWrite } from './auth.js'
import { auditWrite } from './audit.js'
import { openCase } from './CaseThread.jsx'
import { QA_CHECKS, QA_DEFAULTS, QA_RESULTS, closedAt, periodLabel, qaCsv, qaSample, qaStats, recentPeriods } from './qa.js'
import { Badge, Button, Input } from './ui.jsx'

const RESULT_TONE = { pass: 'ok', coaching: 'warn', fail: 'danger' }

function Tile({ label, value, sub }) {
  return (
    <div style={{ border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'12px 14px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E' }}>{label}</div>
      <div className="display-font" style={{ fontSize:'26px', fontWeight:600, color:'#1A1814', lineHeight:1.2 }}>{value ?? '—'}</div>
      {sub && <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', marginTop:'2px' }}>{sub}</div>}
    </div>
  )
}

function ReviewForm({ c, onSave, onCancel }) {
  const [checks, setChecks] = useState(c.qa?.checks || {})
  const [result, setResult] = useState(c.qa?.result || '')
  const [note, setNote] = useState(c.qa?.note || '')
  const failing = Object.values(checks).includes('no')
  return (
    <div style={{ background:'#FFFFFF', border:'1px solid #D4CCBC', padding:'14px 16px', display:'grid', gap:'12px' }}>
      {QA_CHECKS.map(([k, label]) => (
        <div key={k} role="radiogroup" aria-label={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
          <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>{label}</span>
          <span style={{ display:'flex', gap:'12px' }}>
            {[['yes', 'Yes'], ['no', 'No'], ['na', 'N/A']].map(([v, l]) => (
              <label key={v} className="mono-font" style={{ fontSize:'11px', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer' }}>
                <input type="radio" name={`qa-${c.id}-${k}`} checked={checks[k] === v} onChange={() => setChecks(x => ({ ...x, [k]: v }))} />{l}
              </label>
            ))}
          </span>
        </div>
      ))}
      <div style={{ display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
        <label className="mono-font" htmlFor={`qa-res-${c.id}`} style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E' }}>RESULT</label>
        <select id={`qa-res-${c.id}`} className="input-field" value={result} onChange={e => setResult(e.target.value)} style={{ padding:'8px 10px', fontSize:'14px' }}>
          <option value="">— choose —</option>
          {Object.entries(QA_RESULTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {failing && result === 'pass' && <span className="mono-font" style={{ fontSize:'10px', color:'#92400E' }}>A check is marked No — is “Pass” right?</span>}
      </div>
      <label className="mono-font" htmlFor={`qa-note-${c.id}`} style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E' }}>NOTE {result && result !== 'pass' ? '(required)' : ''}</label>
      <textarea id={`qa-note-${c.id}`} value={note} onChange={e => setNote(e.target.value)} rows={2} className="cov-input" style={{ padding:'8px 10px', fontSize:'14px', resize:'vertical' }} />
      <div style={{ display:'flex', gap:'8px' }}>
        <Button small disabled={!result || QA_CHECKS.some(([k]) => !checks[k]) || (result !== 'pass' && note.trim().length < 3)} onClick={() => onSave({ checks, result, note: note.trim() })}>Save review</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

export function QaPanel({ settings, set, locked, covUser, outcomes, setOutcomes }) {
  const s = { ...QA_DEFAULTS, ...settings }
  const periods = recentPeriods(12)
  const [period, setPeriod] = useState(periods[0])
  const [open, setOpen] = useState(null)
  const sample = qaSample(outcomes, period, s)
  const st = qaStats(outcomes, period, s)
  const me = (covUser?.email || '').toLowerCase()
  const mayReview = !locked && canWrite()

  const save = (c, r) => {
    const qa = { ...r, period, reviewer: covUser?.name || covUser?.email || 'Reviewer', reviewerEmail: me, ts: new Date().toISOString() }
    setOutcomes(prev => prev.map(o => o.id === c.id ? { ...o, qa } : o))
    auditWrite('qa.reviewed', 'case', c.id, { period, result: r.result, note: r.note })
    setOpen(null)
  }
  const download = () => {
    const blob = new Blob([qaCsv(outcomes, period, s)], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `covalence-qa-${period}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    auditWrite('audit.exported', 'qa', period, { what: 'QA sample', rows: sample.length })
  }
  const topFails = Object.entries(st.failedChecks).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${QA_CHECKS.find(x => x[0] === k)?.[1] || k} (${n})`)

  return (<>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:'16px', flexWrap:'wrap', marginBottom:'16px' }}>
      <div>
        <label className="mono-font" htmlFor="qa-period" style={{ display:'block', fontSize:'10px', letterSpacing:'0.12em', color:'#57534E', marginBottom:'6px' }}>CASES CLOSED IN</label>
        <select id="qa-period" className="input-field" value={period} onChange={e => { setPeriod(e.target.value); setOpen(null) }} style={{ padding:'9px 10px', fontSize:'14px' }}>
          {periods.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
      </div>
      <Button variant="secondary" onClick={download} disabled={!sample.length}>Download sample (CSV)</Button>
    </div>

    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'10px', marginBottom:'20px' }}>
      <Tile label="CLOSED" value={st.closed} />
      <Tile label="IN SAMPLE" value={st.sampled} sub={`${s.qaSampleRate}% random + always-included`} />
      <Tile label="REVIEWED" value={`${st.reviewed}/${st.sampled}`} />
      <Tile label="PASS RATE" value={st.passRate != null ? `${st.passRate}%` : null} sub={st.reviewed ? `${st.fail} fail · ${st.coaching} coaching` : 'No reviews yet'} />
    </div>

    <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 8px', fontWeight:500 }}>HOW THE AI DID — {periodLabel(period).toUpperCase()}</h2>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'10px', marginBottom:'8px' }}>
      <Tile label="CASES WITH AI DECISIONS" value={st.ai.cases} />
      <Tile label="PEOPLE AGREED" value={st.ai.agreeRate != null ? `${st.ai.agreeRate}%` : null} sub={`${st.ai.reviews} review${st.ai.reviews === 1 ? '' : 's'} recorded`} />
      <Tile label="FILED UNDER AI’S CODE" value={st.ai.followedRate != null ? `${st.ai.followedRate}%` : null} sub={`${st.ai.coded} cases with a code`} />
      <Tile label="WON: FOLLOWED / CHANGED" value={st.ai.coded ? `${st.ai.wonFollowed ?? '—'}% / ${st.ai.wonChanged ?? '—'}%` : null} sub={st.ai.coded ? `${st.ai.nFollowed} followed · ${st.ai.nChanged} changed` : ''} />
    </div>
    <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:'0 0 20px', lineHeight:1.5 }}>
      Small months move these numbers a lot; read them over several months. {topFails.length > 0 && <>Most-missed checks: {topFails.join(' · ')}.</>}
    </p>

    <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 8px', fontWeight:500 }}>THE SAMPLE</h2>
    {sample.length === 0 ? (
      <p className="display-font" style={{ fontSize:'15px', color:'#57534E', fontStyle:'italic', border:'1px dashed #D4CCBC', padding:'16px' }}>No cases closed in {periodLabel(period)}.</p>
    ) : (
      <div style={{ border:'1px solid #D4CCBC' }}>
        {sample.map(({ c, why }) => {
          const own = me && (c.assignedTo || '').toLowerCase() === me
          return (
            <div key={c.id} style={{ borderTop:'1px solid #E7E2D9', padding:'12px 14px', background:'#FAF7F1' }}>
              <div style={{ display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
                <button onClick={() => openCase(c.id)} className="mono-font" style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'11px', color:'#1E3A5F', textDecoration:'underline' }}>{c.id}</button>
                <span className="display-font" style={{ fontSize:'15px', color:'#1A1814', flex:'1 1 160px', minWidth:0 }}>{c.merchant || '—'} <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>· {c.amount || ''} · {String(c.status).toUpperCase()} · closed {(closedAt(c) || '').slice(0, 10)}</span></span>
                {c.qa?.result ? <Badge tone={RESULT_TONE[c.qa.result]}>{QA_RESULTS[c.qa.result].toUpperCase()}</Badge> : <Badge>NOT REVIEWED</Badge>}
                {mayReview && open !== c.id && (
                  own ? <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }} title="Someone else reviews your own cases">Your case</span>
                      : <Button variant="secondary" onClick={() => setOpen(c.id)}>{c.qa?.result ? 'Edit review' : 'Review'}</Button>
                )}
              </div>
              <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', marginTop:'4px' }}>
                {why.join(' · ')} · worked by {c.assignedTo || 'unassigned'}
                {c.qa?.result && <> · reviewed by {c.qa.reviewer} {c.qa.ts?.slice(0, 10)}{c.qa.note ? ` — “${c.qa.note}”` : ''}</>}
              </div>
              {open === c.id && <div style={{ marginTop:'10px' }}><ReviewForm c={c} onSave={r => save(c, r)} onCancel={() => setOpen(null)} /></div>}
            </div>
          )
        })}
      </div>
    )}

    <fieldset disabled={locked} style={{ border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'16px 20px', margin:'24px 0 0', minWidth:0, opacity: locked ? 0.75 : 1 }}>
      <legend className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', padding:'0 6px' }}>SAMPLING RULES{locked ? ' — ADMINS AND REVIEWERS CHANGE THESE' : ''}</legend>
      <div style={{ display:'flex', gap:'24px', flexWrap:'wrap', alignItems:'center' }}>
        <label className="display-font" style={{ fontSize:'14px', display:'flex', alignItems:'center', gap:'8px' }}>
          Randomly sample <Input type="number" min={1} max={100} value={s.qaSampleRate} style={{ width:'80px' }} aria-label="Sample rate percent"
            onChange={e => set('qaSampleRate', Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /> % of closed cases
        </label>
        <label className="display-font" style={{ fontSize:'14px', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}>
          <input type="checkbox" checked={!!s.qaAlwaysAiDisagreed} onChange={e => set('qaAlwaysAiDisagreed', e.target.checked)} /> Always include cases where people went against the AI
        </label>
        <label className="display-font" style={{ fontSize:'14px', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }}>
          <input type="checkbox" checked={!!s.qaAlwaysLost} onChange={e => set('qaAlwaysLost', e.target.checked)} /> Always include lost cases
        </label>
      </div>
    </fieldset>
  </>)
}

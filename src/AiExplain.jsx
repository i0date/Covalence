// ═══════════════════════════════════════════════════════════════════════════════
// AI EXPLAIN — "Why the AI said this", shown under every AI decision
// ═══════════════════════════════════════════════════════════════════════════════
// Renders an AI record (ai.js): the factors behind the answer, the options it
// ruled out, what it assumed, what would change its mind, what it was given,
// and which model and prompt produced it. With onReview, a person can record
// whether they agree; disagreeing needs a reason. Reviews feed QA (Settings →
// Quality review).
import React, { useState } from 'react'
import { Button } from './ui.jsx'

const WEIGHT = { HIGH: { bg:'#1A1814', fg:'#F5F1EA' }, MEDIUM: { bg:'#57534E', fg:'#F5F1EA' }, LOW: { bg:'#E7E2D9', fg:'#3F3A35' } }
const label = s => String(s || '').replace(/_/g, ' ').toLowerCase()
const when = ts => ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''

function H({ children }) {
  return <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', margin:'14px 0 6px' }}>{children}</div>
}

// One line naming the model and prompt behind a draft; shown above AI-written letters and plans
export function AiDraftNote({ record }) {
  if (!record) return null
  return (
    <div className="mono-font" style={{ fontSize:'10px', color:'#57534E', letterSpacing:'0.04em', margin:'6px 0' }}>
      AI DRAFT · {record.model} · {record.prompt} · {when(record.ts)} — read and edit before it goes anywhere. <a href="/ai" target="_blank" rel="noopener" style={{ color:'#1E3A5F' }}>How the AI works</a>
    </div>
  )
}

export function AiExplain({ record, review, onReview, title = 'WHY THE AI SAID THIS', defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showInputs, setShowInputs] = useState(false)
  const [mode, setMode] = useState(null)   // 'disagree' while typing a reason
  const [note, setNote] = useState('')
  if (!record) return null
  const r = record
  const submit = verdict => { onReview({ verdict, note: note.trim() }); setMode(null); setNote('') }

  return (
    <section className="cov-ai-explain" aria-label="AI explanation" style={{ border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'14px 18px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="mono-font"
          style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'10px', letterSpacing:'0.14em', color:'#1A1814', fontWeight:600 }}>
          {open ? '▾' : '▸'} {title}
        </button>
        <span className="mono-font" style={{ fontSize:'10px', color:'#57534E' }}>
          {r.answer ? <strong style={{ color:'#1A1814' }}>{label(r.answer).toUpperCase()}</strong> : null}
          {r.confidence ? <> · {String(r.confidence).toUpperCase()} confidence<span title="The model's own rating of how sure it is. It is not a measured probability."> ⓘ</span></> : null}
        </span>
      </div>

      {open && (<>
        {r.factors?.length > 0 && (<>
          <H>WHAT DROVE IT</H>
          <ul style={{ listStyle:'none', margin:0, padding:0, display:'grid', gap:'6px' }}>
            {r.factors.map((f, i) => {
              const w = WEIGHT[String(f.weight).toUpperCase()] || WEIGHT.LOW
              return (
                <li key={i} style={{ display:'flex', gap:'8px', alignItems:'baseline', flexWrap:'wrap' }}>
                  {f.weight && <span className="mono-font" style={{ fontSize:'10px', padding:'1px 5px', background:w.bg, color:w.fg, flexShrink:0 }}>{String(f.weight).toUpperCase()}</span>}
                  <span className="mono-font" aria-label={f.effect === 'against' ? 'weighs against' : 'supports'} style={{ fontSize:'11px', color: f.effect === 'against' ? '#991B1B' : '#065F46', flexShrink:0 }}>{f.effect === 'against' ? '▼' : '▲'}</span>
                  <span className="display-font" style={{ fontSize:'14px', color:'#1A1814', flex:'1 1 220px', minWidth:0 }}>
                    {f.factor}
                    {(f.source || f.toward) && <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }}> · {f.source ? `from ${f.source}` : ''}{f.source && f.toward ? ' · ' : ''}{f.toward ? `points to ${label(f.toward)}` : ''}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </>)}

        {r.alternatives?.length > 0 && (<>
          <H>ALSO CONSIDERED</H>
          {r.alternatives.map((a, i) => (
            <p key={i} className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 4px', lineHeight:1.5 }}>
              <strong style={{ fontWeight:600 }}>{a.option}</strong> — {a.why_not}
            </p>
          ))}
        </>)}

        {(r.assumptions?.length > 0 || r.wouldChangeIf?.length > 0) && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'0 20px' }}>
            {r.assumptions?.length > 0 && <div><H>ASSUMED</H><ul style={{ margin:0, paddingLeft:'18px' }}>{r.assumptions.map((x, i) => <li key={i} className="display-font" style={{ fontSize:'13px', color:'#3F3A35', lineHeight:1.5 }}>{x}</li>)}</ul></div>}
            {r.wouldChangeIf?.length > 0 && <div><H>WOULD CHANGE IF</H><ul style={{ margin:0, paddingLeft:'18px' }}>{r.wouldChangeIf.map((x, i) => <li key={i} className="display-font" style={{ fontSize:'13px', color:'#3F3A35', lineHeight:1.5 }}>{x}</li>)}</ul></div>}
          </div>
        )}

        {!r.factors?.length && !r.alternatives?.length && (
          <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:'10px 0 0', fontStyle:'italic' }}>
            This result was produced before Covalence recorded the AI’s reasoning, so only the answer is kept.
          </p>
        )}

        {Object.keys(r.inputs || {}).length > 0 && (
          <div style={{ marginTop:'12px' }}>
            <button onClick={() => setShowInputs(v => !v)} aria-expanded={showInputs} className="mono-font"
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:'10px', letterSpacing:'0.1em', color:'#1E3A5F', textDecoration:'underline' }}>
              {showInputs ? 'Hide' : 'Show'} what the AI was given ({Object.keys(r.inputs).length} fields)
            </button>
            {showInputs && (
              <dl className="mono-font" style={{ display:'grid', gridTemplateColumns:'minmax(110px, max-content) 1fr', gap:'4px 12px', fontSize:'11px', margin:'8px 0 0' }}>
                {Object.entries(r.inputs).map(([k, v]) => (<React.Fragment key={k}><dt style={{ color:'#57534E' }}>{label(k)}</dt><dd style={{ margin:0, color:'#1A1814', overflowWrap:'anywhere' }}>{v}</dd></React.Fragment>))}
              </dl>
            )}
          </div>
        )}

        <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', marginTop:'12px', lineHeight:1.6 }}>
          {r.task} · {r.model} · prompt {r.prompt} · run by {r.by} · {when(r.ts)}
          <br />The AI recommends; a person decides. Card numbers, ID numbers, emails and phone numbers are removed before the AI sees the case. <a href="/ai" target="_blank" rel="noopener" style={{ color:'#1E3A5F' }}>How the AI works</a>
        </div>

        {(review || onReview) && (
          <div style={{ borderTop:'1px solid #E7E2D9', marginTop:'12px', paddingTop:'10px' }}>
            {review ? (
              <div className="mono-font" style={{ fontSize:'11px', color: review.verdict === 'agree' ? '#065F46' : '#991B1B' }}>
                {review.verdict === 'agree' ? '✓ Agreed' : '✗ Disagreed'} by {review.by} · {when(review.ts)}{review.note ? ` — “${review.note}”` : ''}
                {onReview && <button onClick={() => onReview(null)} className="mono-font" style={{ background:'none', border:'none', color:'#57534E', textDecoration:'underline', cursor:'pointer', fontSize:'10px', marginLeft:'8px' }}>Change</button>}
              </div>
            ) : mode === 'disagree' ? (
              <div style={{ display:'grid', gap:'8px' }}>
                <label className="mono-font" htmlFor={`ai-note-${r.id}`} style={{ fontSize:'10px', letterSpacing:'0.1em', color:'#57534E' }}>WHAT DID THE AI GET WRONG?</label>
                <textarea id={`ai-note-${r.id}`} value={note} onChange={e => setNote(e.target.value)} rows={2} className="cov-input" style={{ padding:'8px 10px', fontSize:'14px', resize:'vertical' }} />
                <div style={{ display:'flex', gap:'8px' }}>
                  <Button small variant="danger" disabled={note.trim().length < 3} onClick={() => submit('disagree')}>Record disagreement</Button>
                  <Button variant="quiet" onClick={() => setMode(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.1em', color:'#57534E' }}>DO YOU AGREE?</span>
                <Button variant="secondary" onClick={() => submit('agree')}>Agree</Button>
                <Button variant="secondary" onClick={() => setMode('disagree')}>Disagree</Button>
              </div>
            )}
          </div>
        )}
      </>)}
    </section>
  )
}

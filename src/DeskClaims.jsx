// ═══════════════════════════════════════════════════════════════════════════════
// FROM YOUR APP — disputes customers raised in the bank's app, on the Dispute Desk
// ═══════════════════════════════════════════════════════════════════════════════
// A dispute about a purchase (not received, not as described, cancelled, billing
// error, charged twice) needs no triage: it comes straight here when it arrives
// (claims.mjs DESK_TYPES, api/claims.js). Fraud and scams go to 001 Triage → Claims,
// where "Send to the Desk" moves one the customer called fraud that's really a purchase
// dispute; it then shows here too, with the kind of dispute Triage picked.
// "Start the case" fills the Desk's intake form from what the customer told the app,
// the same way a Triage hand-off does, and the case keeps the claim (intake.claimId),
// so its provisional credit, filing and resolution are sent back to the app. A claim
// leaves this list once a case has it. Oldest first: the Reg E / Reg Z clock is
// already running from the customer's report.
import React, { useEffect, useState } from 'react'
import { listClaims } from './claimsData.js'
import { CHANNELS, CLAIM_TYPES, claimTotal, deskTypeOf } from './claims.mjs'
import { questionById, answerWords } from './claimQuestions.mjs'
import { timeLeft } from './clocks.mjs'
import { canWrite } from './auth.js'
import { Asked } from './AppClaims.jsx'
import { Badge, Button } from './ui.jsx'

const money = (n, cur = 'USD') => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: cur?.length === 3 ? cur : 'USD' })
const day = d => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }
const SHOWN_KEY = 'cov_desk_claims_open'

// What the Desk's intake form needs, from the claim (as Triage's hand-off sends it)
export function handoffFromClaim(c) {
  const d = c.data || {}, tx = d.transactions || [], first = tx[0] || {}
  const answers = Object.entries(d.answers || {}).map(([q, a]) => `${questionById(q)?.ask || q} ${answerWords(q, a)}`)
  return {
    caseId: '', source: 'app', classification: deskTypeOf(c) || d.claimType || 'dispute', confidence: d.ai?.confidence || '',
    headline: d.ai?.summary || CLAIM_TYPES[deskTypeOf(c) || d.claimType] || '', network: first.network || '', amount: claimTotal(d).toFixed(2), currency: first.currency || 'USD',
    merchant: first.merchant || '', transactionDate: first.ts ? first.ts.slice(0, 10) : '',
    complaint: [d.statement, answers.length ? `Answers in the app — ${answers.join('; ')}.` : '', tx.length > 1 ? `${tx.length} transactions: ${tx.map(t => `${t.merchant || t.id} ${t.amount}`).join(', ')}.` : ''].filter(Boolean).join('\n').slice(0, 800),
    notes: '', intake: { claimId: c.id, reference: c.external_id, channel: c.channel, reportedAt: c.reported_at },
  }
}

export function DeskClaims({ cases, onStart }) {
  const [claims, setClaims] = useState(null), [err, setErr] = useState(''), [open, setOpen] = useState(null)
  const [shown, setShown] = useState(() => { try { return localStorage.getItem(SHOWN_KEY) !== '0' } catch { return true } })
  const show = v => { setShown(v); try { localStorage.setItem(SHOWN_KEY, v ? '1' : '0') } catch {} }
  const load = () => listClaims().then(r => { setClaims(r); setErr('') }).catch(e => { setClaims([]); setErr(e.message) })
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    const on = () => load()
    window.addEventListener('cov:claims-changed', on)
    return () => { clearInterval(t); window.removeEventListener('cov:claims-changed', on) }
  }, [])
  if (!claims) return null
  const taken = new Set((cases || []).map(o => o.intake?.claimId).filter(Boolean))
  // Straight from the app, or sent here from Triage: with the Desk and no case yet
  const list = claims.filter(c => (c.segment || 'fi') === 'fi' && c.status === 'with_desk' && !c.case_id && !taken.has(c.id))
    .sort((a, b) => new Date(a.reported_at) - new Date(b.reported_at))
  if (!list.length && !err) return null
  const writer = canWrite()
  const late = list.filter(c => c.data?.clock?.due && new Date(c.data.clock.due + 'T23:59:59') < Date.now()).length

  return (
    <section aria-label="Disputes from your app" className="cov-app-claims" style={{ marginBottom:'24px' }}>
      <button type="button" className="cov-app-claims-bar" onClick={() => show(!shown)} aria-expanded={shown}>
        <span className="display-font cov-app-claims-title">From your app and website</span>
        <span className="mono-font cov-app-claims-counts">
          <span><strong style={{ color:'#1A1814' }}>{list.length}</strong> DISPUTE{list.length === 1 ? '' : 'S'} TO START</span>
          {late > 0 && <span style={{ color:'#991B1B' }}><strong>{late}</strong> PAST THE CLOCK</span>}
          <span>NO TRIAGE NEEDED</span>
        </span>
        <span className="mono-font cov-app-claims-btn">{shown ? '▴ HIDE' : '▾ SHOW'}</span>
      </button>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0, padding:'0 18px 12px' }}>{err}</p>}
      {shown && <ul style={{ listStyle:'none', margin:0, padding:0, borderTop:'1px solid #E7E2D9' }}>
        {list.map(c => {
          const d = c.data || {}, tx = d.transactions || [], k = d.clock, expanded = open === c.id, kind = deskTypeOf(c)
          const sent = d.route !== 'desk' && [...(c.history || [])].reverse().find(h => h.status === 'with_desk')
          const left = k ? new Date(k.due + 'T23:59:59') - Date.now() : null
          const merchants = [...new Set(tx.map(t => t.merchant).filter(Boolean))]
          return (
            <li key={c.id} className="cov-app-claim">
              <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', padding:'12px 4px', flexWrap:'wrap' }}>
                <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded}
                  style={{ flex:'1 1 320px', minWidth:0, textAlign:'left', background:'none', border:0, padding:0, cursor:'pointer' }}>
                  <span style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', marginBottom:'4px' }}>
                    <Badge tone="info">{(CHANNELS[c.channel] || c.channel).toUpperCase()}</Badge>
                    <Badge tone="dark">{(CLAIM_TYPES[kind || d.claimType] || 'Dispute').toUpperCase()}</Badge>
                    {sent && <Badge tone="info" title={sent.note}>FROM TRIAGE{sent.by ? ` · ${String(sent.by).toUpperCase()}` : ''}</Badge>}
                    {k && <Badge tone={left < 0 ? 'danger' : left < 2 * 86400000 ? 'warn' : 'neutral'} title={`${k.what} by ${day(k.due)}`}>{k.rule.toUpperCase()} · {timeLeft(left).toUpperCase()}</Badge>}
                    {!c.ready && <Badge title={(d.missing || []).join('; ')}>SOMETHING MISSING</Badge>}
                    {d.ai && d.ai.route !== 'dispute' && <Badge tone="warn" title={d.ai.summary}>AI READS IT AS {d.ai.route.replace(/_/g, ' ').toUpperCase()}</Badge>}
                  </span>
                  <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814' }}>
                    {d.customer?.name || d.customer?.id} · {money(claimTotal(d), tx[0]?.currency)}{merchants.length ? ` · ${merchants.slice(0, 2).join(', ')}` : ''}
                  </span>
                  <span className="display-font" style={{ display:'block', fontSize:'13px', color:'#57534E' }}>Reported {ago(c.reported_at)} · {c.external_id}</span>
                </button>
                {writer && onStart && <Button small onClick={() => onStart(handoffFromClaim(c))}>Start the case</Button>}
              </div>
              {expanded && (
                <div className="display-font" style={{ fontSize:'13px', color:'#3F3A35', padding:'0 4px 14px', display:'grid', gap:'10px' }}>
                  {sent && <p style={{ margin:0, color:'#1E3A5F' }}>{sent.note}{sent.by ? ` (${sent.by})` : ''}. The customer reported it as {(CLAIM_TYPES[d.claimType] || 'something else').toLowerCase()}.</p>}
                  {d.instructions?.length > 0 && <Asked d={d} />}
                  {d.ai?.summary && <p style={{ margin:0, borderLeft:'2px solid #1E3A5F', paddingLeft:'10px' }}>{d.ai.summary}</p>}
                  {d.statement && <blockquote style={{ margin:0, paddingLeft:'10px', borderLeft:'2px solid #D4CCBC', fontStyle:'italic' }}>“{d.statement}”</blockquote>}
                  {!c.ready && d.missing?.length > 0 && <p style={{ margin:0, color:'#92400E' }}>Missing: {d.missing.map(x => x.replace(/ \(\w+\)$/, '')).join('; ')}.</p>}
                  {k && <p style={{ margin:0 }}>{k.rule}: {k.what.toLowerCase()} by {day(k.due)}.</p>}
                  <ul style={{ margin:0, paddingLeft:'18px' }}>{tx.map(t => <li key={t.id}>{t.ts ? day(t.ts) : '—'} · {t.merchant || '—'} · {money(t.amount, t.currency)} <span className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>{t.id}</span></li>)}</ul>
                  {Object.keys(d.answers || {}).length > 0 && (
                    <dl className="cov-claim-answers" aria-label="What the customer answered in the app">
                      {Object.entries(d.answers).map(([q, a]) => <React.Fragment key={q}><dt style={{ color:'#6B6259' }}>{questionById(q)?.ask || q}</dt><dd style={{ margin:0, fontWeight:500 }}>{answerWords(q, a)}</dd></React.Fragment>)}
                    </dl>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FROM THE APP — claims customers reported in the bank's app, in 001 Triage → Claims
// ═══════════════════════════════════════════════════════════════════════════════
// The bank's systems post claims to /api/claims (api/claims.js). Each arrives
// tagged with where it came from, with its Reg E or Reg Z clock already running
// from the customer's report, and marked Ready for Desk when nothing is missing.
// AI triage reads each claim as it arrives and suggests the kind of problem, the
// route and what to ask the customer. "Triage this" fills the claim form below;
// handing it to the Desk or closing it moves the claim on, and the bank's app is
// told (claim.updated). Once it's with the Desk, the case's provisional credit,
// filing and resolution are sent too (claim.provisional_credit, .filed, .resolved).
import React, { useEffect, useState } from 'react'
import { listClaims, setClaim, triageClaim } from './claimsData.js'
import { CHANNELS, CLAIM_TYPES, OUTCOMES, STATUSES, STEPS, UPDATE_DAYS, claimTotal, silentDays, waitingClaims } from './claims.mjs'
import { timeLeft } from './clocks.mjs'
import { canWrite, isSignedIn } from './auth.js'
import { Badge, Button, NewDot, Select } from './ui.jsx'
import { previousVisit } from './brief.js'

const money = (n, cur = 'USD') => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: cur.length === 3 ? cur : 'USD' })
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : Math.round(m / 1440) === 1 ? 'yesterday' : `${Math.round(m / 1440)} days ago` }
const day = d => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const words = k => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const answerText = v => v === true ? 'Yes' : v === false ? 'No' : String(v)
const ROUTES = { dispute: 'Dispute', fraud: 'Fraud', scam: 'Scam', not_a_dispute: 'Not a dispute' }
const CLOSE_REASONS = ['The customer recognised the transaction', 'The customer withdrew the claim', 'Duplicate of another claim', 'Resolved with the merchant before a dispute', 'Not a dispute: sent to another team']

// Due in → a tone: overdue red, two business days or less amber
function clockOf(c) {
  const k = c.data?.clock
  if (!k) return null
  const left = new Date(k.due + 'T23:59:59') - Date.now()
  return { ...k, left, text: timeLeft(left), tone: left < 0 ? 'danger' : left < 2 * 86400000 ? 'warn' : 'neutral' }
}

export function AppClaims({ segment, activeId, onTriage }) {
  const [claims, setClaims] = useState(null), [err, setErr] = useState(''), [open, setOpen] = useState(null), [closing, setClosing] = useState(null)
  const [reason, setReason] = useState(CLOSE_REASONS[0]), [busy, setBusy] = useState(false)
  const writer = canWrite()
  const load = () => listClaims().then(r => { setClaims(r); setErr('') }).catch(e => { setClaims([]); setErr(e.message) })
  useEffect(() => { load() }, [])
  // New claims arrive at any time: check every 30 seconds while the page is in view, and after a claim moves on
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    const on = () => load()
    window.addEventListener('cov:claims-changed', on)
    return () => { clearInterval(t); window.removeEventListener('cov:claims-changed', on) }
  }, [])
  // Home's brief and Your day open a claim here ('cov:open-claim' with { id }); it may arrive before the list has loaded
  const [focus, setFocus] = useState(null)
  useEffect(() => {
    const h = e => { if (e.detail?.id) { setFocus(e.detail.id); setOpen(e.detail.id) } }
    window.addEventListener('cov:open-claim', h); return () => window.removeEventListener('cov:open-claim', h)
  }, [])
  useEffect(() => {
    if (!focus || !claims) return
    const t = setTimeout(() => { document.getElementById(`claim-${focus}`)?.scrollIntoView({ block:'center', behavior:'smooth' }); setFocus(null) }, 120)
    return () => clearTimeout(t)
  }, [focus, claims])
  if (claims === null) return null
  const open_ = claims.filter(c => (c.segment || 'fi') === segment && c.status !== 'closed')
  const prevVisit = previousVisit()
  // Customers who haven't heard from you in UPDATE_DAYS days come first, longest silence first
  const silent = waitingClaims(open_), quiet = new Set(silent.map(c => c.id))
  const waiting = open_.filter(c => c.status !== 'with_desk')
  const mine = [...silent, ...waiting.filter(c => !quiet.has(c.id)), ...open_.filter(c => c.status === 'with_desk' && !quiet.has(c.id))]
  if (!mine.length && !err) return (
    <p className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.1em', color:'#6B6259', margin:'0 0 28px' }}>
      FROM YOUR APP · NOTHING WAITING — claims your customers report in your app arrive here (Settings → Connections).
    </p>
  )

  const triage = async c => {
    setBusy(true)
    try { if (c.status === 'received' && writer) await setClaim(c.id, 'in_review', { publicNote: 'An analyst is reviewing your claim.' }); onTriage(c); load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const close = async c => {
    setBusy(true)
    try { await setClaim(c.id, 'closed', { note: reason, publicNote: reason === 'The customer withdrew the claim' ? 'Closed at your request.' : '' }); setClosing(null); load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const rerun = async c => {
    setBusy(true)
    try { await triageClaim(c.id); load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <section aria-label="Claims from your app" style={{ marginBottom:'36px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'10px', flexWrap:'wrap', marginBottom:'10px' }}>
        <h2 className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.16em', color:'#1A1814', margin:0, fontWeight:600 }}>FROM YOUR APP · {waiting.length} WAITING{open_.length > waiting.length ? ` · ${open_.length - waiting.length} WITH THE DESK` : ''}{silent.length ? <span style={{ color:'#92400E' }}> · {silent.length} WITHOUT AN UPDATE FOR {UPDATE_DAYS}+ DAYS</span> : ''}</h2>
        <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.1em', color:'#6B6259' }}>LONGEST WITHOUT AN UPDATE FIRST · CLOCKS RUN FROM THE CUSTOMER’S REPORT</span>
      </div>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:'0 0 8px' }}>{err}</p>}
      <ul style={{ listStyle:'none', margin:0, padding:0, borderTop:'1px solid #1A1814' }}>
        {mine.map(c => {
          const d = c.data || {}, k = clockOf(c), tx = d.transactions || [], expanded = open === c.id, active = activeId === c.id, ai = d.ai, onDesk = c.status === 'with_desk'
          const steps = (c.history || []).filter(h => h.step)
          const merchants = [...new Set(tx.map(t => t.merchant).filter(Boolean))]
          return (
            <li key={c.id} id={`claim-${c.id}`} style={{ borderBottom:'1px solid #D4CCBC', background: active ? '#F3EEE4' : 'transparent' }}>
              <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', padding:'12px 4px', flexWrap:'wrap' }}>
                <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded}
                  style={{ flex:'1 1 320px', minWidth:0, textAlign:'left', background:'none', border:0, padding:0, cursor:'pointer' }}>
                  <span style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', marginBottom:'4px' }}>
                    {prevVisit && new Date(c.updated_at || 0) > prevVisit && <NewDot />}
                    {quiet.has(c.id) && <Badge tone="warn" title="The customer hasn’t been told anything new in this time">NO UPDATE {silentDays(c)}d</Badge>}
                    <Badge tone="info">{(CHANNELS[c.channel] || c.channel).toUpperCase()}</Badge>
                    {onDesk ? <Badge tone="dark">WITH THE DESK{c.case_id ? ` · ${c.case_id}` : ''}</Badge> : c.ready ? <Badge tone="ok">READY FOR DESK</Badge> : <Badge>NEEDS A LOOK</Badge>}
                    {c.status === 'in_review' && <Badge tone="dark">IN REVIEW</Badge>}
                    {steps.map(h => <Badge key={h.step} tone="ok">{STEPS[h.step].toUpperCase()}</Badge>)}
                    {!onDesk && ai && <Badge tone={ai.priority === 'urgent' ? 'danger' : 'neutral'} title={ai.summary}>AI · {ROUTES[ai.route].toUpperCase()}{ai.priority === 'urgent' ? ' · URGENT' : ''}</Badge>}
                    {!onDesk && !steps.length && k && <Badge tone={k.tone} title={`${k.what} by ${day(k.due)}`}>{k.rule.toUpperCase()} · {k.text.toUpperCase()}</Badge>}
                  </span>
                  <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814' }}>
                    {d.customer?.name || d.customer?.id} · {money(claimTotal(d), tx[0]?.currency)}{merchants.length ? ` · ${merchants.slice(0, 2).join(', ')}${merchants.length > 2 ? '…' : ''}` : ''}
                  </span>
                  <span className="display-font" style={{ display:'block', fontSize:'13px', color:'#57534E' }}>
                    {CLAIM_TYPES[d.claimType] || 'Claim type not given'} · reported {ago(c.reported_at)} · {c.external_id}
                  </span>
                </button>
                {writer && (
                  <span style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                    {!onDesk && <Button small disabled={busy} onClick={() => triage(c)}>{active ? 'In the form below' : 'Triage this'}</Button>}
                    <Button small variant="quiet" disabled={busy} onClick={() => setClosing(closing === c.id ? null : c.id)}>Close</Button>
                  </span>
                )}
              </div>

              {closing === c.id && (
                <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap', padding:'0 4px 12px' }}>
                  <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'3px', flex:'1 1 260px' }}>Why is it closed?
                    <Select value={reason} onChange={e => setReason(e.target.value)} style={{ fontSize:'13px' }}>{CLOSE_REASONS.map(r => <option key={r}>{r}</option>)}</Select>
                  </label>
                  <Button small variant="danger" disabled={busy} onClick={() => close(c)}>Close the claim</Button>
                </div>
              )}

              {expanded && (
                <div className="display-font" style={{ fontSize:'13px', color:'#3F3A35', padding:'0 4px 14px', display:'grid', gap:'10px' }}>
                  {ai && (
                    <div style={{ borderLeft:'2px solid #1E3A5F', paddingLeft:'10px', display:'grid', gap:'4px' }}>
                      <p className="mono-font" style={{ margin:0, fontSize:'10px', letterSpacing:'0.12em', color:'#1E3A5F' }}>
                        AI TRIAGE · {ROUTES[ai.route].toUpperCase()} · {ai.priority.toUpperCase()} PRIORITY · {ai.confidence.toUpperCase()} CONFIDENCE
                      </p>
                      <p style={{ margin:0 }}>{ai.summary}</p>
                      {ai.claimType !== d.claimType && <p style={{ margin:0, color:'#92400E' }}>Reads as {CLAIM_TYPES[ai.claimType] || ai.claimType}{d.claimType ? `, not ${CLAIM_TYPES[d.claimType] || d.claimType} as the customer chose` : ''}.</p>}
                      {ai.reasons?.length > 0 && <ul style={{ margin:0, paddingLeft:'18px', listStyle:'disc' }}>{ai.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
                      {ai.askCustomer?.length > 0 && <p style={{ margin:0 }}><span style={{ color:'#6B6259' }}>Ask the customer:</span> {ai.askCustomer.join(' ')}</p>}
                      <p className="mono-font" style={{ margin:0, fontSize:'10px', letterSpacing:'0.08em', color:'#6B6259' }}>A SUGGESTION FROM THE CLAIM AS SENT — YOU DECIDE IN TRIAGE</p>
                    </div>
                  )}
                  {!ai && writer && isSignedIn() && !onDesk && (
                    <p style={{ margin:0, display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ color:'#6B6259' }}>{Date.now() - new Date(c.created_at) < 120000 ? 'AI triage is reading this claim.' : 'AI triage didn’t finish for this claim.'}</span>
                      <Button small variant="quiet" disabled={busy} onClick={() => rerun(c)}>Run AI triage</Button>
                    </p>
                  )}
                  {d.statement && <blockquote style={{ margin:0, paddingLeft:'10px', borderLeft:'2px solid #D4CCBC', fontStyle:'italic' }}>“{d.statement}”</blockquote>}
                  {!c.ready && d.missing?.length > 0 && <p style={{ margin:0, color:'#92400E' }}>Missing for the Desk: {d.missing.map(x => x.replace(/ \(\w+\)$/, '')).join('; ')}.</p>}
                  {k && <p style={{ margin:0 }}>{k.rule}: {k.what.toLowerCase()} by {day(k.due)}.</p>}
                  <table style={{ borderCollapse:'collapse', fontSize:'12px', width:'100%' }}>
                    <thead><tr>{['Transaction', 'Date', 'Merchant', 'Amount'].map(h => <th key={h} scope="col" className="mono-font" style={{ textAlign:'left', fontWeight:500, color:'#6B6259', padding:'4px 6px', borderBottom:'1px solid #D4CCBC', fontSize:'10px', letterSpacing:'0.1em' }}>{h.toUpperCase()}</th>)}</tr></thead>
                    <tbody>{tx.map(t => (
                      <tr key={t.id}>
                        <td className="mono-font" style={{ padding:'4px 6px' }}>{t.id}</td>
                        <td style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>{t.ts ? day(t.ts) : '—'}</td>
                        <td style={{ padding:'4px 6px' }}>{t.merchant || '—'}{t.merchantLocation ? ` · ${t.merchantLocation}` : ''}</td>
                        <td style={{ padding:'4px 6px', whiteSpace:'nowrap' }}>{money(t.amount, t.currency)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {Object.keys(d.answers || {}).length > 0 && (
                    <dl style={{ margin:0, display:'grid', gridTemplateColumns:'minmax(140px, max-content) 1fr', gap:'2px 12px' }}>
                      {Object.entries(d.answers).map(([q, a]) => <React.Fragment key={q}><dt style={{ color:'#6B6259' }}>{words(q)}</dt><dd style={{ margin:0 }}>{answerText(a)}</dd></React.Fragment>)}
                    </dl>
                  )}
                  {d.attachments?.length > 0 && <p style={{ margin:0 }}>Attachments: {d.attachments.map(a => a.name || 'file').join(', ')} (held in your systems)</p>}
                  {(c.history || []).length > 1 && (
                    <ol style={{ margin:0, paddingLeft:'18px', listStyle:'decimal', fontSize:'12px', color:'#57534E' }} aria-label="What the customer has been told">
                      {c.history.map((h, i) => <li key={i}>{day(h.at)} · {h.step ? STEPS[h.step] : STATUSES[h.status] || h.status}{h.outcome ? `: ${OUTCOMES[h.outcome] || h.outcome}` : ''}{h.public ? ` — “${h.public}”` : ''}</li>)}
                    </ol>
                  )}
                  <p className="mono-font" style={{ margin:0, fontSize:'10px', letterSpacing:'0.08em', color: d.consent?.given ? '#065F46' : '#92400E' }}>
                    {d.consent?.given ? `CONSENT GIVEN${d.consent.at ? ' ' + day(d.consent.at).toUpperCase() : ''}` : 'NO CONSENT RECORDED'} · {c.id}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

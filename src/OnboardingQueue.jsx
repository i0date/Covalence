// ═══════════════════════════════════════════════════════════════════════════════
// 005 LICIT → ONBOARDING — new customers to decide (Onboard with Covalence)
// ═══════════════════════════════════════════════════════════════════════════════
// Applications from the bank's app or the hosted form (onboarding.mjs), the ones on hold
// for a possible sanctions match first, then by risk. Each opens to the checks, the
// reasons for its rating, what the customer told us and what we'd do. Approve, ask
// for more or decline; the decision is audited and sent to the bank's systems
// (onboardingData.js → onboarding.decided).
import React, { useEffect, useState } from 'react'
import { listOnboarding, decideOnboarding, clearOnboardingHold } from './onboardingData.js'
import { STATUSES, OPEN, RATINGS, KINDS, PURPOSES, MONTHLY, SOURCES, INDUSTRIES, titleOf, ageOn } from './onboarding.mjs'
import { canWrite } from './auth.js'
import { Badge, Button } from './ui.jsx'

const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', marginBottom:'20px' }
const label = { fontSize:'10px', letterSpacing:'0.16em', color:'#6B6259' }
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago` }
const RATING_TONE = { low: 'ok', medium: 'warn', high: 'danger' }
const STATUS_TONE = { waiting_idv: 'neutral', to_review: 'info', on_hold: 'danger', more_info: 'warn', approved: 'ok', declined: 'dark' }
const MARK = { pass: ['✓', '#065F46'], flag: ['!', '#92400E'], fail: ['✗', '#991B1B'], pending: ['○', '#78716C'] }
const REC = { approve: 'WE’D APPROVE', review: 'LOOK AT THE REASONS', edd: 'ENHANCED DUE DILIGENCE', more_info: 'ASK FOR MORE', decline: 'WE’D DECLINE', hold: 'CLEAR THE MATCH FIRST', wait: 'WAIT FOR THE ID CHECK' }
const name = (list, v) => (list.find(x => x[0] === v) || [])[1] || '—'
const place = a => a ? [a.line1, a.line2, a.city, a.region, a.postal, a.country !== 'US' ? a.country : ''].filter(Boolean).join(', ') : '—'
const order = a => (a.status === 'on_hold' ? 0 : OPEN.includes(a.status) ? 1 : 2) * 10 + ({ high: 0, medium: 1, low: 2 }[a.rating] ?? 3)

function Person({ p, now, owner }) {
  return (
    <dl className="cov-claim-answers" style={{ fontSize:'13px' }}>
      <dt style={{ color:'#6B6259' }}>Name</dt><dd style={{ margin:0 }}>{p.name}{owner ? ` · ${p.ownership || 0}%${p.controller ? ' · manages it' : ''}${p.title ? ` · ${p.title}` : ''}` : ''}</dd>
      <dt style={{ color:'#6B6259' }}>Born</dt><dd style={{ margin:0 }}>{p.dob ? `${new Date(p.dob + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })} (${ageOn(p.dob, now)})` : '—'}</dd>
      <dt style={{ color:'#6B6259' }}>Home</dt><dd style={{ margin:0 }}>{place(p.address)}</dd>
      {!owner && <><dt style={{ color:'#6B6259' }}>Contact</dt><dd style={{ margin:0, overflowWrap:'anywhere' }}>{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</dd></>}
      {p.idLast4 && <><dt style={{ color:'#6B6259' }}>SSN / ITIN</dt><dd className="mono-font" style={{ margin:0, fontSize:'12px' }}>•••{p.idLast4} <span style={{ color:'#78716C' }}>(the full number is in your systems)</span></dd></>}
    </dl>
  )
}

export function OnboardingQueue({ covUser }) {
  const [rows, setRows] = useState(null), [err, setErr] = useState(''), [msg, setMsg] = useState(''), [open, setOpen] = useState(null), [busy, setBusy] = useState(false)
  const [view, setView] = useState('open'), [acting, setActing] = useState(null), [note, setNote] = useState('')
  const writer = canWrite() && covUser?.role !== 'auditor'
  const load = () => listOnboarding().then(r => { setRows(r); setErr('') }).catch(e => { setRows([]); setErr(e.message) })
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    window.addEventListener('cov:onboarding-changed', load)
    return () => { clearInterval(t); window.removeEventListener('cov:onboarding-changed', load) }
  }, [])
  if (rows === null) return null
  const now = new Date()
  const openRows = rows.filter(a => OPEN.includes(a.status)).sort((a, b) => order(a) - order(b) || new Date(a.createdAt) - new Date(b.createdAt))
  const decided = rows.filter(a => !OPEN.includes(a.status)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  const month = rows.filter(a => now - new Date(a.createdAt) < 30 * 86400000)
  const list = view === 'open' ? openRows : decided
  const toDecide = openRows.filter(a => ['to_review', 'more_info'].includes(a.status)).length

  const act = async (a, action) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      if (action === 'clear') { await clearOnboardingHold(a.id, note); setMsg(`${a.id}: the hold is cleared and it’s back for review.`) }
      else {
        const r = await decideOnboarding(a.id, action, note)
        const what = action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'asked for more'
        setMsg(`${titleOf(a.app)}: ${what}.${r.sent === true ? ' Sent to your systems.' : r.sent === false ? ` Not sent to your systems${r.error ? ` (${r.error})` : ''}: do it there by hand.` : ''}`)
      }
      setActing(null); setNote(''); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <section aria-label="Onboarding" style={box}>
      <div style={{ padding:'16px 18px 12px', borderBottom:'1px solid #D4CCBC' }}>
        <div className="mono-font" style={label}>NEW CUSTOMERS · ONBOARD WITH COVALENCE</div>
        <h2 className="display-font" style={{ margin:'4px 0 0', fontSize:'22px', fontWeight:600, color:'#1A1814' }}>
          {toDecide ? `${toDecide} application${toDecide === 1 ? '' : 's'} to decide` : 'Nothing to decide right now'}
        </h2>
        <p className="display-font" style={{ margin:'4px 0 0', fontSize:'14px', color:'#57534E', lineHeight:1.5, maxWidth:'780px' }}>
          People and businesses opening an account, checked on arrival: sanctions, the customer’s own answer on public positions, their age and address, where they applied from, details used on other applications, and a business’s owners. Your identity provider’s result arrives from your systems.
        </p>
      </div>
      <div className="cov-pd-stats">
        <div><span className="mono-font">TO DECIDE</span><strong>{toDecide}</strong><em className="display-font">{openRows.filter(a => a.status === 'waiting_idv').length} waiting on the ID check</em></div>
        <div><span className="mono-font">ON HOLD</span><strong style={openRows.some(a => a.status === 'on_hold') ? { color:'#991B1B' } : undefined}>{openRows.filter(a => a.status === 'on_hold').length}</strong><em className="display-font">possible sanctions match</em></div>
        <div><span className="mono-font">HIGH RISK · OPEN</span><strong style={openRows.some(a => a.rating === 'high') ? { color:'#92400E' } : undefined}>{openRows.filter(a => a.rating === 'high').length}</strong><em className="display-font">need enhanced due diligence</em></div>
        <div><span className="mono-font">LAST 30 DAYS</span><strong>{month.length}</strong><em className="display-font">{month.filter(a => a.status === 'approved').length} approved · {month.filter(a => a.status === 'declined').length} declined</em></div>
      </div>
      <div role="tablist" aria-label="Which applications" style={{ display:'flex', gap:'18px', padding:'10px 18px 0', borderBottom:'1px solid #E7E2D9' }}>
        {[['open', `Open (${openRows.length})`], ['decided', `Decided (${decided.length})`]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className="mono-font"
            style={{ background:'none', border:0, borderBottom: view === k ? '2px solid #1A1814' : '2px solid transparent', padding:'6px 0 8px', fontSize:'10px', letterSpacing:'0.14em', cursor:'pointer', color: view === k ? '#1A1814' : '#6B6259' }}>{l.toUpperCase()}</button>
        ))}
      </div>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0, padding:'10px 18px' }}>{err}</p>}
      {msg && <p role="status" className="mono-font" style={{ fontSize:'11px', color:'#065F46', margin:0, padding:'10px 18px' }}>{msg}</p>}
      {!list.length && !err && <p className="display-font" style={{ margin:0, padding:'16px 18px', fontSize:'14px', color:'#57534E' }}>
        {view === 'open' ? (rows.length ? 'Everything has been decided.' : 'No applications yet. Your systems send them to /api/onboarding, or open the hosted form for a customer (see For your developers under Connections).') : 'Nothing decided in the last 180 days.'}</p>}
      <ul style={{ listStyle:'none', margin:0, padding:0 }}>
        {list.map(a => {
          const app = a.app, expanded = open === a.id, isOpen = OPEN.includes(a.status), mine = acting?.id === a.id
          const idvPassed = a.idv?.result === 'passed'
          return (
            <li key={a.id} className="cov-pd-row">
              <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', flexWrap:'wrap' }}>
                <button type="button" className="cov-pd-main" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : a.id)}>
                  <span style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
                    <Badge tone={STATUS_TONE[a.status]}>{STATUSES[a.status].toUpperCase()}</Badge>
                    <Badge tone={RATING_TONE[a.rating]}>{RATINGS[a.rating].toUpperCase()}</Badge>
                    {isOpen && a.recommend?.action && <Badge tone="neutral">{REC[a.recommend.action]}</Badge>}
                  </span>
                  <span className="display-font" style={{ display:'block', fontSize:'17px', color:'#1A1814', marginTop:'5px' }}>{titleOf(app)}</span>
                  <span className="mono-font" style={{ display:'block', fontSize:'11px', color:'#6B6259', marginTop:'2px' }}>{KINDS[a.kind]} · {a.reference || a.id} · {a.channel === 'form' ? 'hosted form' : 'your app'} · {ago(a.createdAt)}{a.reasons?.length ? ` · ${a.reasons.slice(0, 2).join('; ')}${a.reasons.length > 2 ? '…' : ''}` : ''}</span>
                </button>
                {writer && isOpen && <span style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                  {a.status === 'on_hold'
                    ? <><Button small variant="secondary" disabled={busy} onClick={() => { setActing({ id: a.id, action: 'clear' }); setNote(''); setOpen(a.id) }}>Not a match</Button>
                        <Button small variant="danger" disabled={busy} onClick={() => { setActing({ id: a.id, action: 'decline' }); setNote('Confirmed sanctions match'); setOpen(a.id) }}>Confirmed: decline</Button></>
                    : <><Button small disabled={busy || !idvPassed} title={idvPassed ? '' : 'Approve once the identity check has passed'} onClick={() => { if (a.rating === 'high') { setActing({ id: a.id, action: 'approve' }); setNote(''); setOpen(a.id) } else act(a, 'approve') }}>Approve</Button>
                        <Button small variant="secondary" disabled={busy} onClick={() => { setActing({ id: a.id, action: 'more_info' }); setNote(''); setOpen(a.id) }}>Ask for more</Button>
                        <Button small variant="quiet" disabled={busy} onClick={() => { setActing({ id: a.id, action: 'decline' }); setNote(''); setOpen(a.id) }}>Decline</Button></>}
                </span>}
              </div>
              {mine && (
                <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap', marginTop:'10px' }}>
                  <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'3px', flex:'1 1 320px' }}>
                    {acting.action === 'approve' ? 'High risk: what enhanced due diligence was done?' : acting.action === 'more_info' ? 'What do you need from them?' : acting.action === 'clear' ? 'Why isn’t it a match? (date of birth, nationality, …)' : 'Why is it declined?'}
                    <textarea className="cov-input" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
                  </label>
                  <Button small variant={acting.action === 'decline' ? 'danger' : 'primary'} disabled={busy || !note.trim()} onClick={() => act(a, acting.action)}>
                    {{ approve: 'Approve', more_info: 'Ask for it', decline: 'Decline', clear: 'Clear the hold' }[acting.action]}</Button>
                  <Button small variant="quiet" onClick={() => setActing(null)}>Cancel</Button>
                </div>
              )}
              {mine && acting.action === 'decline' && a.status === 'on_hold' && <p className="display-font" style={{ margin:'6px 0 0', fontSize:'13px', color:'#991B1B' }}>A confirmed match must be reported to OFAC within 10 business days. Record it on a case in Licit’s queue.</p>}
              {expanded && (
                <div className="display-font" style={{ fontSize:'14px', color:'#3F3A35', marginTop:'12px', display:'grid', gap:'12px', lineHeight:1.5 }}>
                  {isOpen && a.recommend?.why && <p style={{ margin:0, borderLeft:'3px solid #1E3A5F', paddingLeft:'10px' }}><strong>{REC[a.recommend.action].charAt(0) + REC[a.recommend.action].slice(1).toLowerCase()}.</strong> {a.recommend.why}</p>}
                  <div>
                    <div className="mono-font" style={{ ...label, marginBottom:'6px' }}>THE CHECKS</div>
                    <ul style={{ listStyle:'none', margin:0, padding:0, display:'grid', gap:'5px' }}>
                      {a.checks.map(c => <li key={c.key} style={{ display:'grid', gridTemplateColumns:'16px minmax(0,1fr)', gap:'8px' }}>
                        <span aria-label={c.state} style={{ fontWeight:700, color: MARK[c.state]?.[1] }}>{MARK[c.state]?.[0]}</span>
                        <span><strong style={{ fontWeight:600 }}>{c.label}.</strong> <span style={{ color:'#57534E' }}>{c.detail}</span></span>
                      </li>)}
                    </ul>
                  </div>
                  {a.kind === 'business' && <div>
                    <div className="mono-font" style={{ ...label, marginBottom:'6px' }}>THE BUSINESS</div>
                    <dl className="cov-claim-answers" style={{ fontSize:'13px' }}>
                      <dt style={{ color:'#6B6259' }}>Name</dt><dd style={{ margin:0 }}>{app.business.name}{app.business.dba ? ` (trading as ${app.business.dba})` : ''} · {app.business.type || '—'}{app.business.registeredIn ? `, ${app.business.registeredIn}` : ''}</dd>
                      <dt style={{ color:'#6B6259' }}>Does</dt><dd style={{ margin:0 }}>{name(INDUSTRIES, app.business.industry)}{app.business.formedOn ? ` · formed ${app.business.formedOn}` : ''}</dd>
                      <dt style={{ color:'#6B6259' }}>Address</dt><dd style={{ margin:0 }}>{place(app.business.address)}</dd>
                      {app.business.website && <><dt style={{ color:'#6B6259' }}>Website</dt><dd style={{ margin:0, overflowWrap:'anywhere' }}>{app.business.website}</dd></>}
                      {app.business.einLast4 && <><dt style={{ color:'#6B6259' }}>EIN</dt><dd className="mono-font" style={{ margin:0, fontSize:'12px' }}>•••{app.business.einLast4}</dd></>}
                    </dl>
                  </div>}
                  <div>
                    <div className="mono-font" style={{ ...label, marginBottom:'6px' }}>{a.kind === 'business' ? 'OPENED BY' : 'THE APPLICANT'}</div>
                    <Person p={app.applicant} now={now} />
                  </div>
                  {(app.owners || []).length > 0 && <div>
                    <div className="mono-font" style={{ ...label, marginBottom:'6px' }}>OWNERS AND CONTROLLER</div>
                    <div style={{ display:'grid', gap:'10px' }}>{app.owners.map((o, i) => <Person key={i} p={o} now={now} owner />)}</div>
                  </div>}
                  <div>
                    <div className="mono-font" style={{ ...label, marginBottom:'6px' }}>THE ACCOUNT</div>
                    <dl className="cov-claim-answers" style={{ fontSize:'13px' }}>
                      {app.occupation && <><dt style={{ color:'#6B6259' }}>{a.kind === 'business' ? 'Their role' : 'Work'}</dt><dd style={{ margin:0 }}>{app.occupation}</dd></>}
                      <dt style={{ color:'#6B6259' }}>For</dt><dd style={{ margin:0 }}>{name(PURPOSES[a.kind] || [], app.purpose)}</dd>
                      <dt style={{ color:'#6B6259' }}>Each month</dt><dd style={{ margin:0 }}>{name(MONTHLY, app.activity?.monthly)}{app.activity?.cash ? ' · cash deposits' : ''}{app.activity?.international ? ` · international${app.activity.countries ? ` (${app.activity.countries})` : ''}` : ''}</dd>
                      <dt style={{ color:'#6B6259' }}>Money from</dt><dd style={{ margin:0 }}>{name(SOURCES, app.sourceOfFunds)}</dd>
                      <dt style={{ color:'#6B6259' }}>Public position</dt><dd style={{ margin:0 }}>{app.pep?.declared ? `Yes${app.pep.detail ? `: ${app.pep.detail}` : ''}` : 'No'}</dd>
                    </dl>
                  </div>
                  <div className="mono-font" style={{ fontSize:'11px', color:'#6B6259', display:'grid', gap:'2px' }}>
                    {a.history.map((h, i) => <span key={i}>{new Date(h.at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })} · {(STATUSES[h.status] || h.status).toUpperCase()}{h.by ? ` · ${h.by}` : ''}{h.note ? ` · ${h.note}` : ''}</span>)}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 003 MULTI — acquirer side: your merchants' chargebacks, grouped by merchant
// ═══════════════════════════════════════════════════════════════════════════════
// First, the merchants' answers to check before they go to the network (a weak or
// late response is lost); then every merchant, the ones over or near a network
// threshold first, each opening to its chargebacks: send it to the merchant, record
// their answer, check it, send it on (acquirer.mjs).
import React, { useMemo, useState } from 'react'
import { CaseLink } from './CaseThread.jsx'
import { Badge, Button } from './ui.jsx'
import { isSignedIn } from './auth.js'
import { recordDemoCaseEvent } from './demoBackend.js'
import { isAcquirerCase } from './sides.mjs'
import { STAGES, OPEN, amountOf, daysLeft, evidenceFor, merchantBook, merchantDue, networkDue, reviewResponse } from './acquirer.mjs'

const money = n => '$' + n.toLocaleString('en-US', Number.isInteger(n) || n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = d => d ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '—'
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', marginBottom:'20px' }
const label = { fontSize:'10px', letterSpacing:'0.16em', color:'#6B6259' }
const RATIO_TONE = { over:'danger', over_ratio:'warn', approaching:'warn', ok:'ok', unknown:'neutral' }
const STAGE_TONE = { received:'warn', with_merchant:'neutral', response_in:'info', submitted:'dark', won:'ok', lost:'danger', withdrawn:'neutral' }
// Sample monthly card sales for the demo merchants, until real ones are entered
const DEMO_SALES = { 'Vela Supplements': { visa: 300, mc: 150 }, 'Brightline Fitness': { visa: 900, mc: 800 }, 'Kestrel Outdoor': { visa: 1200, mc: 400 }, 'Copperleaf Hotels': { visa: 600, mc: 250 } }

function Left({ d, prefix = '' }) {
  const left = daysLeft(d)
  if (left == null) return <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>—</span>
  return <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.08em', fontWeight:600, color: left < 0 ? '#991B1B' : left <= 3 ? '#92400E' : '#57534E' }}>
    {prefix}{left < 0 ? `${-left}D LATE` : left === 0 ? 'TODAY' : `${left}D`}
  </span>
}

export function AcquirerView({ outcomes, setOutcomes, settings, setSettings, covUser }) {
  const readOnly = covUser?.role === 'auditor'
  const by = covUser?.name || covUser?.email || 'Analyst'
  const demo = !!covUser?.demo && !covUser?.authed
  const cases = useMemo(() => (outcomes || []).filter(isAcquirerCase), [outcomes])
  const book = useMemo(() => merchantBook(cases, settings, new Date(), { demoSales: demo ? DEMO_SALES : null }), [cases, settings, demo])
  const toCheck = cases.filter(c => c.status === 'response_in').sort((a, b) => (networkDue(a, settings) || 0) - (networkDue(b, settings) || 0))
  const [open, setOpen] = useState(null), [answering, setAnswering] = useState(null), [draft, setDraft] = useState({ decision: 'fight', evidence: [], note: '' })
  const [msg, setMsg] = useState('')

  const move = (c, status, extra = {}, note = '') => {
    const ts = new Date().toISOString()
    const ev = { ts, event: 'status', from: c.status || 'received', status, by, ...(note ? { note } : {}) }
    if (!isSignedIn()) recordDemoCaseEvent(c.id, ev)
    setOutcomes(prev => prev.map(o => o.id === c.id ? { ...o, ...extra, status, updatedAt: ts, history: [...(o.history || []), ev] } : o))
  }
  const say = t => { setMsg(t); setTimeout(() => setMsg(''), 5000) }
  const sendToMerchant = c => { move(c, 'with_merchant', { sentToMerchantAt: new Date().toISOString(), merchantResponse: null }); say(`${c.id} sent to ${c.merchant}. Their answer is due ${day(merchantDue({ ...c, sentToMerchantAt: new Date().toISOString() }, settings))}.`) }
  const saveAnswer = c => {
    const r = { ...draft, evidence: draft.decision === 'accept' ? [] : draft.evidence, at: new Date().toISOString(), by: c.merchant, recordedBy: by }
    move(c, 'response_in', { merchantResponse: r }); setAnswering(null); say(`${c.merchant}’s answer recorded on ${c.id}. Check it under “Check before it goes on”.`)
  }
  const sendOn = c => { move(c, 'submitted', { submitDate: new Date().toISOString().slice(0, 10) }); say(`${c.id} sent to ${c.network === 'MC' ? 'Mastercard' : 'Visa'}.`) }
  const sendBack = (c, problems) => { move(c, 'with_merchant', { sentBackAt: new Date().toISOString(), sentToMerchantAt: new Date().toISOString() }, `Sent back: ${problems.join('; ')}`); say(`${c.id} sent back to ${c.merchant}: ${problems.join('; ')}.`) }
  const closeAccepted = c => { move(c, 'withdrawn', { resolvedDate: new Date().toISOString(), accepted: { by, ts: new Date().toISOString(), reason: 'The merchant accepted the chargeback' } }); say(`${c.id} closed: ${c.merchant} takes the loss.`) }
  const setSales = (merchant, key, value) => setSettings && setSettings(prev => ({ ...prev, acqMerchants: { ...(prev.acqMerchants || {}), [merchant]: { ...(prev.acqMerchants?.[merchant] || DEMO_SALES[merchant] || {}), [key]: Math.max(0, parseInt(value, 10) || 0) } } }))

  const sum = {
    merchants: book.length, toCheck: toCheck.length,
    waiting: cases.filter(c => c.status === 'with_merchant').length,
    toSend: cases.filter(c => (c.status || 'received') === 'received').length,
    due: cases.filter(c => OPEN.includes(c.status || 'received') && daysLeft(networkDue(c, settings)) <= 3).length,
    flagged: book.filter(r => r.ratios.some(x => ['over', 'over_ratio', 'approaching'].includes(x.state))).length,
  }
  if (!cases.length) return (
    <section style={box}><div style={{ padding:'18px' }}>
      <div className="mono-font" style={label}>YOUR MERCHANTS</div>
      <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', margin:'6px 0 0', lineHeight:1.55 }}>No chargebacks against your merchants yet. Import them from your network reports (Settings → Import) with a side column of <code>acquirer</code>, or send them through <code>/api/intake</code>.</p>
    </div></section>
  )

  return (
    <div>
      <section aria-label="Acquirer summary" style={box}>
        <div style={{ padding:'16px 18px 12px', borderBottom:'1px solid #D4CCBC' }}>
          <div className="mono-font" style={label}>YOUR MERCHANTS’ CHARGEBACKS</div>
          <h2 className="display-font" style={{ margin:'4px 0 0', fontSize:'22px', fontWeight:600, color:'#1A1814' }}>
            {sum.toCheck ? `${sum.toCheck} merchant answer${sum.toCheck === 1 ? '' : 's'} to check before ${sum.toCheck === 1 ? 'it goes' : 'they go'} to the network` : 'Nothing to check right now'}
          </h2>
        </div>
        <div className="cov-pd-stats cov-acq-stats">
          <div><span className="mono-font">TO SEND TO MERCHANTS</span><strong>{sum.toSend}</strong><em className="display-font">arrived from the network</em></div>
          <div><span className="mono-font">WAITING ON MERCHANTS</span><strong>{sum.waiting}</strong><em className="display-font">across {sum.merchants} merchant{sum.merchants === 1 ? '' : 's'}</em></div>
          <div><span className="mono-font">DUE TO THE NETWORK ≤ 3 DAYS</span><strong style={sum.due ? { color:'#991B1B' } : undefined}>{sum.due}</strong><em className="display-font">still open</em></div>
          <div><span className="mono-font">NEAR OR OVER A THRESHOLD</span><strong style={sum.flagged ? { color:'#92400E' } : undefined}>{sum.flagged}</strong><em className="display-font">merchant{sum.flagged === 1 ? '' : 's'}, last 30 days</em></div>
        </div>
        {msg && <p role="status" className="mono-font" style={{ fontSize:'11px', color:'#065F46', margin:0, padding:'10px 18px', borderTop:'1px solid #E7E2D9' }}>{msg}</p>}
      </section>

      {toCheck.length > 0 && (
        <section aria-label="Merchant answers to check" style={box}>
          <div className="mono-font" style={{ ...label, padding:'14px 18px 4px' }}>CHECK BEFORE IT GOES ON</div>
          <ul style={{ listStyle:'none', margin:0, padding:0 }}>
            {toCheck.map(c => {
              const rv = reviewResponse(c, settings), r = c.merchantResponse || {}, ev = evidenceFor(c), have = new Set(r.evidence || [])
              return (
                <li key={c.id} className="cov-pd-row">
                  <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', flexWrap:'wrap' }}>
                    <div style={{ flex:'1 1 360px', minWidth:0 }}>
                      <span style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
                        <Badge tone="dark">{c.merchant.toUpperCase()}</Badge>
                        <Badge tone={rv.decision === 'accept' ? 'neutral' : rv.ok ? 'ok' : 'danger'}>{rv.decision === 'accept' ? 'MERCHANT ACCEPTS' : rv.ok ? 'READY TO SEND' : `${rv.problems.length} TO FIX`}</Badge>
                        <Left d={networkDue(c, settings)} prefix="NETWORK " />
                      </span>
                      <span className="display-font" style={{ display:'block', fontSize:'16px', color:'#1A1814', marginTop:'5px' }}>{money(amountOf(c))} · {c.network === 'MC' ? 'Mastercard' : 'Visa'} {c.reasonCode} · {ev.label}</span>
                      <span className="mono-font" style={{ display:'block', fontSize:'11px', color:'#6B6259', marginTop:'2px' }}><CaseLink id={c.id} />{c.cardholderName ? ` · ${c.cardholderName}` : ''} · answered {r.at ? day(new Date(r.at)) : '—'}</span>
                    </div>
                    {!readOnly && <span style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                      {rv.decision === 'accept'
                        ? <Button small onClick={() => closeAccepted(c)}>Close: merchant takes it</Button>
                        : <>{rv.ok && <Button small onClick={() => sendOn(c)}>Send to the network</Button>}
                            <Button small variant={rv.ok ? 'quiet' : 'secondary'} onClick={() => sendBack(c, rv.problems.length ? rv.problems : ['Please strengthen the response'])}>Send back to the merchant</Button></>}
                    </span>}
                  </div>
                  {r.note && <p className="display-font" style={{ margin:'8px 0 0', fontSize:'14px', color:'#3F3A35', borderLeft:'3px solid #D4CCBC', paddingLeft:'10px' }}>“{r.note}”</p>}
                  {rv.decision !== 'accept' && <ul className="cov-acq-checks">
                    {ev.items.map(it => <li key={it.key} className={have.has(it.key) ? 'yes' : it.required ? 'no' : 'opt'}>
                      <span aria-hidden="true">{have.has(it.key) ? '✓' : it.required ? '✗' : '○'}</span>{it.label}{!have.has(it.key) && it.required ? <em> required</em> : ''}
                    </li>)}
                  </ul>}
                  {[...rv.problems.filter(p => !p.startsWith('Missing')), ...rv.notes].map(t => <p key={t} className="display-font" style={{ margin:'6px 0 0', fontSize:'13px', color: rv.problems.includes(t) ? '#991B1B' : '#57534E' }}>{t}</p>)}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label="Your merchants" style={box}>
        <div className="mono-font" style={{ ...label, padding:'14px 18px 4px' }}>YOUR MERCHANTS · NEAR A THRESHOLD FIRST{demo ? ' · DEMO SALES FIGURES' : ''}</div>
        <ul style={{ listStyle:'none', margin:0, padding:0 }}>
          {book.map(m => {
            const expanded = open === m.merchant
            return (
              <li key={m.merchant} className="cov-pd-row">
                <button type="button" className="cov-acq-merchant" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : m.merchant)}>
                  <span className="cov-acq-name display-font">{m.merchant}<span className="mono-font">{m.open} open · {money(m.atStake)} at stake{m.decided ? ` · won ${m.won} of ${m.decided}` : ''}</span></span>
                  <span className="cov-acq-counts mono-font">
                    {m.toSend > 0 && <Badge tone="warn">{m.toSend} TO SEND</Badge>}
                    {m.waiting > 0 && <Badge tone="neutral">{m.waiting} WITH THEM</Badge>}
                    {m.toReview > 0 && <Badge tone="info">{m.toReview} TO CHECK</Badge>}
                    {m.late > 0 && <Badge tone="danger">{m.late} DUE ≤ 3D</Badge>}
                  </span>
                  <span className="cov-acq-ratios">
                    {m.ratios.map(x => <span key={x.key} className="mono-font" title={x.ratio == null ? `Add ${m.merchant}’s monthly ${x.label} sales to see this` : `${x.count} chargebacks on ${x.sales.toLocaleString('en-US')} sales in 30 days; ${x.label} ${x.program} threshold ${x.limit}%`}>
                      {x.label === 'Mastercard' ? 'MC' : 'VISA'} <Badge tone={RATIO_TONE[x.state]}>{x.ratio == null ? '—' : x.ratio.toFixed(2) + '%'}</Badge>
                    </span>)}
                  </span>
                </button>
                {expanded && (
                  <div style={{ marginTop:'12px' }}>
                    <div className="display-font" style={{ display:'flex', gap:'14px', flexWrap:'wrap', alignItems:'flex-end', fontSize:'13px', color:'#3F3A35', marginBottom:'10px' }}>
                      <span style={{ flex:'1 1 260px' }}>Ratios count every chargeback in the last 30 days, won or lost, against the merchant’s monthly card sales.{m.demoSales ? ' These are sample sales figures.' : ''}</span>
                      {m.ratios.map(x => <label key={x.key} style={{ display:'grid', gap:'3px' }}><span className="mono-font" style={label}>MONTHLY {x.label.toUpperCase()} SALES</span>
                        <input type="number" min="0" inputMode="numeric" className="cov-input" disabled={readOnly || !setSettings} defaultValue={x.sales || ''} onBlur={e => setSales(m.merchant, x.key, e.target.value)} style={{ width:'130px' }} /></label>)}
                    </div>
                    <ul style={{ listStyle:'none', margin:0, padding:0 }}>
                      {m.cases.slice().sort((a, b) => (OPEN.includes(b.status || 'received') - OPEN.includes(a.status || 'received')) || new Date(b.date) - new Date(a.date)).map(c => {
                        const st = c.status || 'received', md = merchantDue(c, settings)
                        return (
                          <li key={c.id} className="cov-acq-case">
                            <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center' }}>
                              <Badge tone={STAGE_TONE[st] || 'neutral'}>{(STAGES[st] || st).toUpperCase()}</Badge>
                              <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>{money(amountOf(c))} · {c.network === 'MC' ? 'MC' : 'Visa'} {c.reasonCode} {c.reasonTitle ? `· ${c.reasonTitle}` : ''}</span>
                              <span className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}><CaseLink id={c.id} /> · arrived {day(new Date(c.date))}</span>
                              {OPEN.includes(st) && <Left d={networkDue(c, settings)} prefix="NETWORK " />}
                              {st === 'with_merchant' && <Left d={md} prefix="MERCHANT " />}
                              {!readOnly && <span style={{ marginLeft:'auto', display:'flex', gap:'6px' }}>
                                {st === 'received' && <Button small onClick={() => sendToMerchant(c)}>Send to the merchant</Button>}
                                {st === 'with_merchant' && <Button small variant="secondary" onClick={() => { setAnswering(answering === c.id ? null : c.id); setDraft({ decision: 'fight', evidence: [], note: '' }) }}>Record their answer</Button>}
                              </span>}
                            </div>
                            {answering === c.id && (
                              <div className="cov-acq-answer">
                                <div role="radiogroup" aria-label="The merchant’s answer" style={{ display:'flex', gap:'14px', flexWrap:'wrap' }}>
                                  {[['fight', 'They’ll fight it'], ['accept', 'They accept it']].map(([k, l]) => <label key={k} className="display-font" style={{ fontSize:'14px', display:'flex', gap:'6px', alignItems:'center' }}>
                                    <input type="radio" name={`ans-${c.id}`} checked={draft.decision === k} onChange={() => setDraft(d => ({ ...d, decision: k }))} />{l}</label>)}
                                </div>
                                {draft.decision === 'fight' && <fieldset style={{ border:0, padding:0, margin:'10px 0 0', display:'grid', gap:'5px' }}>
                                  <legend className="mono-font" style={{ ...label, marginBottom:'4px' }}>WHAT THEY SENT · {evidenceFor(c).label.toUpperCase()}</legend>
                                  {evidenceFor(c).items.map(it => <label key={it.key} className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'flex-start' }}>
                                    <input type="checkbox" checked={draft.evidence.includes(it.key)} onChange={e => setDraft(d => ({ ...d, evidence: e.target.checked ? [...d.evidence, it.key] : d.evidence.filter(x => x !== it.key) }))} style={{ marginTop:'3px' }} />
                                    <span>{it.label}{it.required ? <em className="mono-font" style={{ fontStyle:'normal', fontSize:'10px', color:'#92400E', marginLeft:'6px' }}>REQUIRED</em> : ''}</span></label>)}
                                </fieldset>}
                                <label className="display-font" style={{ display:'grid', gap:'3px', fontSize:'13px', marginTop:'10px' }}>Their note (optional)
                                  <textarea className="cov-input" rows={2} value={draft.note} maxLength={600} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} /></label>
                                <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}>
                                  <Button small onClick={() => saveAnswer(c)}>Save their answer</Button>
                                  <Button small variant="quiet" onClick={() => setAnswering(null)}>Cancel</Button>
                                </div>
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
      <p className="display-font" style={{ fontSize:'12px', color:'#78716C', lineHeight:1.5, margin:'0 2px' }}>
        Network deadlines default to 30 days for Visa and 45 for Mastercard from arrival, and merchants get 10 days to answer, never later than three days before the network’s deadline. Thresholds follow Visa VAMP and Mastercard ECM; your network agreements are what apply.
      </p>
    </div>
  )
}

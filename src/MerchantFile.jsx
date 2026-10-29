// ═══════════════════════════════════════════════════════════════════════════════
// 004 FILE — merchant side: answered chargebacks and the checks after a win
// ═══════════════════════════════════════════════════════════════════════════════
// Responses waiting on the cardholder's bank, escalations, and wins — with the
// money-back, final-date, repeat-cardholder and evidence checks on each win
// (merchantFile.mjs). Chargebacks still to answer live in 003 Multi.
import React, { useMemo, useState } from 'react'
import { CaseLink } from './CaseThread.jsx'
import { Button, Input } from './ui.jsx'
import { amountOf } from './merchantQueue.mjs'
import { ce3Applies, chargebacksFrom, finalOn, isFinal, merchantFile, moneyBack, sentAt, wonAt } from './merchantFile.mjs'

const money = n => '$' + Number(n || 0).toLocaleString('en-US', Number.isInteger(n) || n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'
const ago = d => d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000)) : null
const H2 = ({ children, count }) => (
  <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'28px 0 8px', fontWeight:500 }}>{children}{count != null ? ` · ${count}` : ''}</h2>
)
const Row = ({ c, right, children }) => (
  <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', padding:'12px 14px', borderBottom:'1px solid #EDE8E0', flexWrap:'wrap' }}>
    <div style={{ flex:'1 1 260px', minWidth:0 }}>
      <div style={{ display:'flex', gap:'8px', alignItems:'baseline', flexWrap:'wrap' }}>
        <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}><CaseLink id={c.id} /></span>
        <span className="display-font" style={{ fontSize:'15px', color:'#1A1814' }}>{c.reasonTitle || 'Chargeback'}</span>
        <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>{[c.network, c.reasonCode].filter(Boolean).join(' ')}{c.cardholderName ? ` · ${c.cardholderName}` : ''}</span>
      </div>
      {children}
    </div>
    <div style={{ textAlign:'right', minWidth:'110px' }}>
      <div className="display-font" style={{ fontSize:'17px', fontWeight:700, color:'#1A1814' }}>{money(amountOf(c))}</div>
      {right}
    </div>
  </div>
)
const Check = ({ tone = 'ok', children }) => {
  const c = { ok:'#065F46', warn:'#92400E', info:'#57534E' }[tone]
  return <div className="display-font" style={{ fontSize:'13px', color:c, marginTop:'4px', lineHeight:1.45 }}>{tone === 'ok' ? '✓ ' : tone === 'warn' ? '⚠ ' : '• '}{children}</div>
}
const Box = ({ children }) => <div style={{ border:'1px solid #D4CCBC', background:'#FFFFFF' }}>{children}</div>
const Empty = ({ children }) => <p className="display-font" style={{ fontSize:'14px', color:'#6B6259', padding:'16px 14px', margin:0 }}>{children}</p>

export function MerchantFile({ cases, update, covUser, setActiveSection }) {
  const readOnly = covUser?.role === 'auditor'
  const f = useMemo(() => merchantFile(cases), [cases])
  const [rec, setRec] = useState(null)   // { id, amount, date } while recording money received
  const [showClosed, setShowClosed] = useState(false)
  const setStatus = (c, status) => update(c.id, { status, resolvedDate: ['won', 'lost'].includes(status) ? new Date().toISOString() : null })
  const acts = (c, list) => !readOnly && (
    <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end', marginTop:'6px', flexWrap:'wrap' }}>
      {list.map(([status, label, variant]) => <Button key={status} variant={variant || 'quiet'} onClick={() => setStatus(c, status)}>{label}</Button>)}
    </div>
  )

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', border:'1px solid #D4CCBC', background:'#FFFFFF' }}>
        {[['WAITING', f.waiting.length, 'responses with the bank'], ['ESCALATED', f.escalated.length, 'Pre-Arbitration or arbitration'],
          ['WIN RATE', f.winRate == null ? '—' : f.winRate + '%', `${f.won.length} won · ${f.lost.length} lost`], ['RECOVERED', money(f.recovered), 'money back from the acquirer'],
          ['NOT BACK YET', money(f.outstanding), f.notFinal ? `${f.notFinal} win${f.notFinal === 1 ? '' : 's'} not final yet` : 'every win is final']].map(([k, v, sub], i) => (
          <div key={k} style={{ padding:'14px 16px', borderLeft: i ? '1px solid #EDE8E0' : 'none' }}>
            <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color: k === 'NOT BACK YET' && f.outstanding ? '#92400E' : '#78716C' }}>{k}</div>
            <div className="display-font" style={{ fontSize:'26px', fontWeight:700, color:'#1A1814', lineHeight:1.1 }}>{v}</div>
            <div className="display-font" style={{ fontSize:'12px', color:'#6B6259' }}>{sub}</div>
          </div>
        ))}
      </div>

      <H2 count={f.waiting.length}>WAITING ON THE CARDHOLDER’S BANK</H2>
      <Box>
        {f.waiting.length === 0 ? <Empty>No responses out right now. Answer chargebacks from 003 Multi; once a response is sent, it’s tracked here.</Empty>
          : f.waiting.map(c => (
            <Row key={c.id} c={c} right={acts(c, [['won', 'Bank accepted — won', 'secondary'], ['pre_arb', 'Pre-Arbitration filed'], ['lost', 'Lost']])}>
              <Check tone="info">Response sent {sentAt(c) ? `${day(sentAt(c))} (${ago(sentAt(c))} days ago)` : ''}{c.acquirer ? ` through ${c.acquirer}` : ''}. The bank either accepts it or escalates to Pre-Arbitration.</Check>
            </Row>
          ))}
      </Box>

      {f.escalated.length > 0 && (<>
        <H2 count={f.escalated.length}>ESCALATED</H2>
        <Box>
          {f.escalated.map(c => (
            <Row key={c.id} c={c} right={acts(c, c.status === 'pre_arb'
              ? [['won', 'Won', 'secondary'], ['arbitration', 'Went to arbitration'], ['lost', 'Lost']]
              : [['won', 'Won', 'secondary'], ['lost', 'Lost']])}>
              <Check tone="warn">{c.status === 'pre_arb' ? 'The bank filed Pre-Arbitration.' : 'In arbitration — the network decides, and the loser usually pays the network’s fee.'}{c.nextRespDate ? ` Respond by ${day(c.nextRespDate)}.` : ''} Build the answer in 002 Desk (Pre-Arbitration response letter).</Check>
            </Row>
          ))}
        </Box>
      </>)}

      <H2 count={f.won.length}>WON — AFTER THE WIN</H2>
      <Box>
        {f.won.length === 0 ? <Empty>No wins yet.</Empty> : f.won.map(c => {
          const m = moneyBack(c), fin = finalOn(c), n = chargebacksFrom(cases, c), recording = rec?.id === c.id
          return (
            <Row key={c.id} c={c} right={<div className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>WON {day(wonAt(c)).toUpperCase()}</div>}>
              {m.state === 'received' && <Check>{money(m.got)} back{m.date ? ` on ${day(m.date)}` : ''}.</Check>}
              {m.state === 'short' && <Check tone="warn">{money(m.got)} back{m.date ? ` on ${day(m.date)}` : ''} — {money(m.short)} short. Ask {c.acquirer || 'your acquirer'} what was deducted; it’s often a fee.</Check>}
              {m.state === 'expected' && !recording && (
                <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
                  <Check tone="warn">Expecting {money(m.expected)} back from {c.acquirer || 'your acquirer'} — not recorded yet.</Check>
                  {!readOnly && <Button variant="quiet" onClick={() => setRec({ id: c.id, amount: String(m.expected), date: new Date().toLocaleDateString('en-CA') })}>Record money received</Button>}
                </div>
              )}
              {recording && (
                <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap', marginTop:'6px' }}>
                  <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'2px' }}>Amount received
                    <Input type="number" min="0" step="0.01" value={rec.amount} onChange={e => setRec({ ...rec, amount: e.target.value })} style={{ width:'120px', padding:'5px 8px', fontSize:'13px' }} />
                  </label>
                  <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'2px' }}>On
                    <Input type="date" value={rec.date} onChange={e => setRec({ ...rec, date: e.target.value })} style={{ padding:'5px 8px', fontSize:'13px' }} />
                  </label>
                  <Button small disabled={!(Number(rec.amount) >= 0) || !rec.date} onClick={() => { update(c.id, { reversal: { amount: Number(rec.amount), date: rec.date, by: covUser?.name || covUser?.email || '' } }); setRec(null) }}>Save</Button>
                  <Button variant="quiet" onClick={() => setRec(null)}>Cancel</Button>
                </div>
              )}
              {isFinal(c) ? <Check>Final since {day(fin)} — the bank can no longer escalate.</Check> : (
                <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
                  <Check tone="info">Final on {day(fin)}. Until then the bank can still file Pre-Arbitration.</Check>
                  {!readOnly && <Button variant="quiet" onClick={() => setStatus(c, 'pre_arb')}>Bank escalated</Button>}
                </div>
              )}
              {n >= 2 && <Check tone="warn">{n} chargebacks from {c.cardholderName}. Consider extra verification on their next order.</Check>}
              {ce3Applies(c) && <Check tone="info">Keep this order’s details (device, IP, delivery address): under Visa Compelling Evidence 3.0 they can help answer a future fraud chargeback from the same cardholder.</Check>}
            </Row>
          )
        })}
      </Box>

      <H2>CLOSED</H2>
      <div className="display-font" style={{ fontSize:'14px', color:'#3F3A35' }}>
        {f.lost.length} lost ({money(f.lost.reduce((n, c) => n + amountOf(c), 0))}) · {f.accepted.length} accepted or settled without a fight ({money(f.accepted.reduce((n, c) => n + amountOf(c), 0))})
        {(f.lost.length + f.accepted.length) > 0 && <> · <button type="button" onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.1em', background:'none', border:0, padding:0, cursor:'pointer', textDecoration:'underline', color:'#57534E' }}>{showClosed ? 'HIDE' : 'SHOW'}</button></>}
      </div>
      {showClosed && (
        <div style={{ marginTop:'8px' }}><Box>
          {[...f.lost, ...f.accepted].map(c => (
            <Row key={c.id} c={c} right={<div className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>{c.status === 'lost' ? 'LOST' : c.settled ? 'SETTLED' : 'ACCEPTED'}</div>}>
              {c.settled && <Check>Settled early in Duo: refunded ${Number(c.settled.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{c.settled.ref ? ` (${c.settled.ref})` : ''} and the bank withdrew the chargeback.</Check>}
              {c.accepted?.reason && <Check tone="info">Accepted by {c.accepted.by}: {c.accepted.reason}</Check>}
            </Row>
          ))}
        </Box></div>
      )}

      <p className="display-font" style={{ fontSize:'12px', color:'#6B6259', margin:'20px 0 0', lineHeight:1.5 }}>
        A win becomes final 30 days after it for Visa and 45 for Mastercard — working defaults; check your acquirer’s terms. Most card network monitoring programs still count a won chargeback toward your chargeback ratio.
        {setActiveSection && <> Chargebacks still to answer are in <button type="button" onClick={() => setActiveSection('multi')} className="mono-font" style={{ fontSize:'11px', background:'none', border:0, padding:0, cursor:'pointer', textDecoration:'underline', color:'#1A1814' }}>003 Multi</button>.</>}
      </p>
    </div>
  )
}

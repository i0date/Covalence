// ═══════════════════════════════════════════════════════════════════════════════
// 003 MULTI — merchant side: chargebacks to answer
// ═══════════════════════════════════════════════════════════════════════════════
// Every chargeback filed against the merchant that still needs an answer,
// soonest deadline first, with a fight-or-accept call on each (merchantQueue.mjs).
// The response itself is built in 002 Desk; accepting closes the case here.
import React, { useMemo, useState } from 'react'
import { CaseLink } from './CaseThread.jsx'
import { Button } from './ui.jsx'
import { isSignedIn } from './auth.js'
import { recordDemoCaseEvent } from './demoBackend.js'
import { MERCHANT_DEFAULTS, amountOf, answeredCases, merchantQueue } from './merchantQueue.mjs'

const money = n => '$' + n.toLocaleString('en-US', Number.isInteger(n) || n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = d => d ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '—'
const CALL = {
  fight:  { label:'FIGHT',  color:'#065F46', bg:'#ECFDF5' },
  accept: { label:'ACCEPT', color:'#57534E', bg:'#F5F1EA' },
  review: { label:'REVIEW', color:'#92400E', bg:'#FEF3C7' },
}
function Due({ left }) {
  if (left == null) return <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>NO DATE</span>
  const late = left < 0, soon = left <= 3
  return <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.08em', fontWeight:600, color: late ? '#991B1B' : soon ? '#92400E' : '#57534E' }}>
    {late ? `${-left}D OVERDUE` : left === 0 ? 'DUE TODAY' : `${left}D LEFT`}
  </span>
}

export function MerchantQueue({ outcomes, setOutcomes, settings, covUser, setActiveSection }) {
  const s = { ...MERCHANT_DEFAULTS, ...settings }
  const me = covUser?.email || ''
  const readOnly = covUser?.role === 'auditor'
  const [filter, setFilter] = useState('all'), [q, setQ] = useState('')
  const [picked, setPicked] = useState([]), [confirm, setConfirm] = useState(null), [done, setDone] = useState('')

  const all = useMemo(() => merchantQueue(outcomes, settings), [outcomes, settings])
  const answered = useMemo(() => answeredCases(outcomes), [outcomes])
  const rows = all.filter(({ c }) => (filter === 'mine' ? c.assignedTo === me : filter === 'unassigned' ? !c.assignedTo : true)
    && (!q.trim() || [c.id, c.merchant, c.reasonCode, c.reasonTitle, c.cardholderName, c.amount].some(v => String(v || '').toLowerCase().includes(q.trim().toLowerCase()))))
  const overdue = all.filter(r => r.left != null && r.left < 0).length
  const soon = all.filter(r => r.left != null && r.left >= 0 && r.left <= 3).length
  const atStake = all.reduce((n, r) => n + amountOf(r.c), 0)
  const small = all.filter(r => r.rec.call === 'accept' && amountOf(r.c) < s.mchAcceptBelow)

  // The history entry and updatedAt are written here: Multi saves through the case
  // store and the app at once, and the second save would otherwise drop the entry
  const accept = ids => {
    const set = new Set(ids), ts = new Date().toISOString(), by = covUser?.name || me || 'Analyst'
    setOutcomes(prev => prev.map(o => {
      if (!set.has(o.id)) return o
      const ev = { ts, event: 'status', from: o.status || 'received', status: 'withdrawn', by }
      if (!isSignedIn()) recordDemoCaseEvent(o.id, ev)
      return { ...o, status: 'withdrawn', resolvedDate: ts, updatedAt: ts, history: [...(o.history || []), ev],
        accepted: { by, ts, reason: all.find(r => r.c.id === o.id)?.rec.why || 'Accepted' } }
    }))
    setPicked([]); setConfirm(null); setDone(`${ids.length} chargeback${ids.length === 1 ? '' : 's'} accepted.`)
    setTimeout(() => setDone(''), 4000)
  }
  const assignMe = id => { const ts = new Date().toISOString(); setOutcomes(prev => prev.map(o => o.id === id ? { ...o, assignedTo: me, assignedAt: ts, updatedAt: ts } : o)) }
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  return (
    <div>
      {/* The day's numbers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', border:'1px solid #D4CCBC', background:'#FFFFFF', marginBottom:'20px' }}>
        {[['TO ANSWER', all.length, 'chargebacks open'], ['OVERDUE', overdue, 'past the acquirer’s deadline'], ['DUE IN 3 DAYS', soon, 'answer these next'], ['AT STAKE', money(atStake), 'across open chargebacks']].map(([k, v, sub], i) => (
          <div key={k} style={{ padding:'14px 16px', borderLeft: i ? '1px solid #EDE8E0' : 'none' }}>
            <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color: k === 'OVERDUE' && overdue ? '#991B1B' : '#78716C' }}>{k}</div>
            <div className="display-font" style={{ fontSize:'28px', fontWeight:700, color:'#1A1814', lineHeight:1.1 }}>{v}</div>
            <div className="display-font" style={{ fontSize:'12px', color:'#6B6259' }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Filters and bulk actions */}
      <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center', marginBottom:'12px' }}>
        <div role="group" aria-label="Show" style={{ display:'flex', gap:'2px' }}>
          {[['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className="mono-font"
              style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'7px 12px', border:'1px solid #1A1814', cursor:'pointer', background: filter === k ? '#1A1814' : 'transparent', color: filter === k ? '#F5F1EA' : '#57534E' }}>{l.toUpperCase()}</button>
          ))}
        </div>
        <input className="cov-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search ID, reason code, customer…" aria-label="Search chargebacks"
          style={{ flex:'1 1 200px', minWidth:0, padding:'7px 10px', fontSize:'13px' }} />
        {!readOnly && picked.length > 0 && <Button small onClick={() => setConfirm(picked)}>Accept {picked.length} selected</Button>}
        {!readOnly && small.length > 0 && <Button variant="secondary" onClick={() => setConfirm(small.map(r => r.c.id))}>Accept {small.length} under ${s.mchAcceptBelow}</Button>}
      </div>

      {confirm && (
        <div role="alertdialog" aria-label="Confirm accepting chargebacks" style={{ border:'1px solid #1A1814', background:'#FAF7F1', padding:'12px 14px', marginBottom:'12px' }}>
          <div className="display-font" style={{ fontSize:'14px', color:'#1A1814', marginBottom:'8px' }}>
            Accept {confirm.length} chargeback{confirm.length === 1 ? '' : 's'} ({money(confirm.reduce((n, id) => n + amountOf(all.find(r => r.c.id === id)?.c), 0))})? The money stays with the cardholder and the case closes. Tell your acquirer you won’t respond if they ask.
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <Button small onClick={() => accept(confirm)}>Yes, accept</Button>
            <Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {done && <p role="status" className="mono-font" style={{ fontSize:'11px', color:'#065F46', margin:'0 0 12px' }}>{done}</p>}

      {/* The queue */}
      <div style={{ border:'1px solid #D4CCBC', background:'#FFFFFF' }}>
        {rows.length === 0 ? (
          <p className="display-font" style={{ fontSize:'14px', color:'#6B6259', padding:'24px 16px', margin:0 }}>
            {all.length ? 'Nothing matches this filter.' : 'No chargebacks waiting for an answer. New ones appear here as your acquirer sends them, or when you add one in 002 Desk.'}
          </p>
        ) : rows.map(({ c, due, left, rec }) => {
          const k = CALL[rec.call]
          return (
            <div key={c.id} style={{ display:'flex', gap:'12px', alignItems:'flex-start', padding:'12px 14px', borderBottom:'1px solid #EDE8E0', flexWrap:'wrap' }}>
              {!readOnly && <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.id}`} style={{ marginTop:'4px' }} />}
              <div style={{ width:'92px', flexShrink:0 }}>
                <Due left={left} />
                <div className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>by {day(due)}</div>
              </div>
              <div style={{ flex:'1 1 220px', minWidth:0 }}>
                <div style={{ display:'flex', gap:'8px', alignItems:'baseline', flexWrap:'wrap' }}>
                  <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}><CaseLink id={c.id} /></span>
                  <span className="display-font" style={{ fontSize:'15px', color:'#1A1814' }}>{c.reasonTitle || 'Chargeback'}</span>
                  <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>{[c.network, c.reasonCode].filter(Boolean).join(' ')}</span>
                </div>
                <div className="display-font" style={{ fontSize:'12px', color:'#6B6259', marginTop:'2px' }}>
                  <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.08em', padding:'1px 6px', marginRight:'6px', color:k.color, background:k.bg }}>{k.label}</span>{rec.why}
                </div>
                <div className="mono-font" style={{ fontSize:'10px', color:'#78716C', marginTop:'4px' }}>
                  {c.status === 'rebuttal_prep' ? 'RESPONSE IN PROGRESS' : 'NOT STARTED'} · {c.assignedTo ? `OWNER ${c.assignedTo === me ? 'YOU' : c.assignedTo}` : 'UNASSIGNED'}
                </div>
              </div>
              <div style={{ textAlign:'right', minWidth:'90px' }}>
                <div className="display-font" style={{ fontSize:'17px', fontWeight:700, color:'#1A1814' }}>{money(amountOf(c))}</div>
                <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end', marginTop:'6px', flexWrap:'wrap' }}>
                  {!readOnly && !c.assignedTo && me && <Button variant="quiet" onClick={() => assignMe(c.id)}>Take it</Button>}
                  <Button small variant="secondary" onClick={() => setActiveSection?.('desk')}>Answer in Desk</Button>
                  {!readOnly && <Button variant="quiet" onClick={() => setConfirm([c.id])}>Accept</Button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="display-font" style={{ fontSize:'13px', color:'#6B6259', margin:'12px 0 0', lineHeight:1.5 }}>
        {answered.length ? `${answered.length} response${answered.length === 1 ? '' : 's'} sent and waiting on the cardholder’s bank. ` : ''}
        Deadlines are {s.mchRespondDays} days from arrival unless the case has its own; the fight-or-accept call uses the win estimate, the amount and a ${s.mchFightCost} cost to fight. Change these in Settings.
      </p>
    </div>
  )
}

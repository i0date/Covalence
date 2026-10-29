// ═══════════════════════════════════════════════════════════════════════════════
// 007 DUO — invites from the other side of a chargeback (matched by ARN)
// ═══════════════════════════════════════════════════════════════════════════════
// Another institution holding the same chargeback asked to coordinate. Accepting
// opens a Duo session linked to both cases; declining shares nothing.
import React, { useEffect, useState } from 'react'
import { arnInviteRespond, arnInvites } from './data.js'
import { CaseLink } from './CaseThread.jsx'
import { Button } from './ui.jsx'

const SIDE = { issuer: 'cardholder’s bank', acquirer: 'acquirer', merchant: 'merchant' }
const ago = ts => { const h = Math.round((Date.now() - new Date(ts)) / 3600000); return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago` }

export function ArnInvites({ onOpen, readOnly }) {
  const [list, setList] = useState([]), [busy, setBusy] = useState(null), [err, setErr] = useState('')
  const load = () => arnInvites().then(r => setList(r.filter(i => i.direction === 'in' && i.status === 'pending'))).catch(() => setList([]))
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
  if (!list.length) return null
  const respond = async (i, accept) => {
    setBusy(i.id); setErr('')
    try { const code = await arnInviteRespond(i.id, accept); await load(); if (accept && code) onOpen(code, i.my_case_id) }
    catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  return (
    <section aria-label="Invites from the other side" style={{ border:'2px solid #1A1814', background:'#FAF7F1', padding:'14px 16px', marginBottom:'24px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#57534E', marginBottom:'8px' }}>THE OTHER SIDE WANTS TO COORDINATE · {list.length}</div>
      <div style={{ display:'grid', gap:'10px' }}>
        {list.map(i => (
          <div key={i.id} style={{ display:'flex', gap:'12px', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
            <div className="display-font" style={{ fontSize:'14px', color:'#1A1814', flex:'1 1 280px' }}>
              <strong>{i.other_institution}</strong> ({SIDE[i.other_side] || i.other_side}) has the same chargeback as your case <CaseLink id={i.my_case_id} />
              <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}> · {[i.network, i.arn_last4 ? `ARN …${i.arn_last4}` : '', i.amount].filter(Boolean).join(' · ')} · {ago(i.created_at)}</span>
            </div>
            {!readOnly && <div style={{ display:'flex', gap:'6px' }}>
              <Button small disabled={busy === i.id} onClick={() => respond(i, true)}>Open a session</Button>
              <Button variant="quiet" disabled={busy === i.id} onClick={() => respond(i, false)}>Decline</Button>
            </div>}
          </div>
        ))}
      </div>
      <p className="display-font" style={{ fontSize:'12px', color:'#6B6259', margin:'10px 0 0', lineHeight:1.5 }}>
        Matched on the chargeback’s ARN and amount. Nothing about your case is shared until you open a session, and declining tells them nothing. Official responses still go through the card network.
      </p>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:'6px 0 0' }}>{err}</p>}
    </section>
  )
}

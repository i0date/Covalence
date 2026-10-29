// ═══════════════════════════════════════════════════════════════════════════════
// THE OTHER SIDE — link a card dispute to the other side's case by ARN (Duo)
// ═══════════════════════════════════════════════════════════════════════════════
// The cardholder's bank and the merchant both hold the chargeback's Acquirer
// Reference Number. "Find the other side" asks Covalence to invite the
// institution holding the matching case, if there is one (supabase_arn.sql).
// The sender isn't told whether a match exists; a Duo session opens for both
// once the other side accepts.
import React, { useEffect, useState } from 'react'
import { arnFindOtherSide, arnInvites, loadMyDuoSessions, saveMyDuoSessions } from './data.js'
import { Button, Input } from './ui.jsx'
import { isMerchantCase } from './sides.mjs'

const digits = v => String(v || '').replace(/\D/g, '')
const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : ''

// Open a linked session in 007 Duo (remembered in this browser's session list first)
export function openDuoSession(id, role, caseId, institution) {
  const mine = loadMyDuoSessions()
  if (!mine.some(s => s.id === id)) saveMyDuoSessions([{ id, role, myInstitution: institution || '', joinedAt: new Date().toISOString(), lastStatus: 'active', caseId }, ...mine])
  window.dispatchEvent(new CustomEvent('cov:go', { detail: { section: 'duo' } }))
  window.dispatchEvent(new CustomEvent('cov:duo-open', { detail: { id, role } }))
}

export function ArnLink({ c, setOutcomes, covUser, onClose }) {
  const [draft, setDraft] = useState(c.arn || ''), [editing, setEditing] = useState(!c.arn)
  const [invites, setInvites] = useState([]), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false)
  const readOnly = covUser?.role === 'auditor'
  const load = () => arnInvites().then(setInvites).catch(() => setInvites([]))
  useEffect(() => { load() }, [c.id])
  if (!c.network && !c.arn) return null   // ARNs belong to card disputes

  const other = isMerchantCase(c) ? 'the cardholder’s bank' : 'the merchant'
  const linked = invites.find(i => i.my_case_id === c.id && i.status === 'accepted')
  const waiting = invites.find(i => i.my_case_id === c.id && i.direction === 'in' && i.status === 'pending')
  const valid = digits(draft).length === 23
  const patch = p => setOutcomes(prev => prev.map(o => o.id === c.id ? { ...o, ...p } : o))
  const save = () => { if (!valid) return; patch({ arn: digits(draft) }); setEditing(false); setMsg(null) }
  const find = async () => {
    setBusy(true); setMsg(null)
    try { await arnFindOtherSide(c.id); patch({ arnLookupAt: new Date().toISOString() }); load() }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const open = i => { openDuoSession(i.session_id, i.direction === 'out' ? 'a' : 'b', c.id, covUser?.institution); onClose?.() }

  return (
    <div>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#8A7F72', marginBottom:'8px' }}>THE OTHER SIDE · ARN</div>
      <div style={{ border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'12px 14px', display:'grid', gap:'8px' }}>
        {editing ? (
          <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap' }}>
            <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'3px', flex:'1 1 220px' }}>Acquirer Reference Number (23 digits)
              <Input value={draft} onChange={e => setDraft(e.target.value)} inputMode="numeric" placeholder="7491 2346 0815 0041 8864 821" aria-label="ARN" disabled={readOnly}
                style={{ padding:'6px 8px', fontSize:'13px', fontFamily:"'JetBrains Mono',monospace" }} />
            </label>
            {!readOnly && <Button small disabled={!valid} onClick={save}>Save</Button>}
            {c.arn && <Button variant="quiet" onClick={() => { setDraft(c.arn); setEditing(false) }}>Cancel</Button>}
            {draft && !valid && <span className="mono-font" style={{ fontSize:'10px', color:'#92400E', flexBasis:'100%' }}>{digits(draft).length} of 23 digits</span>}
          </div>
        ) : (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <span className="mono-font" style={{ fontSize:'13px', color:'#1A1814', letterSpacing:'0.04em' }}>{c.arn.replace(/(\d{4})(?=\d)/g, '$1 ')}</span>
            {!readOnly && !linked && <Button variant="quiet" onClick={() => setEditing(true)}>Change</Button>}
          </div>
        )}

        {linked ? (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <span className="display-font" style={{ fontSize:'13px', color:'#065F46' }}>✓ Linked with {linked.other_institution} in Duo session {linked.session_id}.</span>
            <Button small onClick={() => open(linked)}>Open in Duo</Button>
          </div>
        ) : waiting ? (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <span className="display-font" style={{ fontSize:'13px', color:'#92400E' }}>{waiting.other_institution} wants to coordinate on this chargeback.</span>
            <Button small onClick={() => { window.dispatchEvent(new CustomEvent('cov:go', { detail: { section: 'duo' } })); onClose?.() }}>Answer in Duo</Button>
          </div>
        ) : c.arn && !editing && (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            {!readOnly && <Button small variant="secondary" disabled={busy} onClick={find}>{busy ? 'Looking…' : c.arnLookupAt ? 'Look again' : 'Find the other side'}</Button>}
            <span className="display-font" style={{ fontSize:'12px', color:'#57534E', flex:'1 1 220px' }}>
              {c.arnLookupAt
                ? `Asked ${day(c.arnLookupAt)}. If ${other} uses Covalence and has this chargeback, they’ve been invited; nothing is shared until they accept.`
                : `If ${other} uses Covalence, they’ll be invited to a Duo session about this chargeback. You won’t be told whether they do.`}
            </span>
          </div>
        )}
        {msg && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0 }}>{msg}</p>}
      </div>
    </div>
  )
}

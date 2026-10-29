// ═══════════════════════════════════════════════════════════════════════════════
// 007 DUO — a session linked by ARN: both cases' stages, and settling early
// ═══════════════════════════════════════════════════════════════════════════════
// Each side chooses whether to share its own case's stage; nothing here changes
// the other side's case. Settling early: the merchant offers a refund, the
// cardholder's bank agrees, the merchant records the refund, the bank records
// that it withdrew the chargeback (supabase_arn_sync.sql). The official steps
// still happen in the network and the acquirer's systems.
import React, { useEffect, useState } from 'react'
import { arnLinkState, arnPublishStage, arnSettle } from './data.js'
import { readCases } from './caseStore.js'
import { saveOutcomes } from './shared.jsx'
import { CaseLink } from './CaseThread.jsx'
import { Button, Input } from './ui.jsx'

export const STAGE_LABEL = {
  received: 'Chargeback received', pending: 'Chargeback received', triaged: 'Chargeback received', rebuttal_prep: 'Preparing a response', submitted: 'Responded',
  queued: 'Chargeback being filed', investigating: 'Investigating', filed: 'Chargeback filed', network_invstg: 'With the network', representment: 'Merchant responded',
  pre_arb: 'Pre-Arbitration', pending_arb: 'Pre-Arbitration', arbitration: 'Arbitration', won: 'Won', lost: 'Lost', withdrawn: 'Withdrawn', closed: 'Closed',
}
export const stageText = st => STAGE_LABEL[st] || (st ? st.replace(/_/g, ' ') : '')
const SIDE = { issuer: 'cardholder’s bank', acquirer: 'acquirer', merchant: 'merchant' }
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const when = ts => ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''
const amountOf = v => parseFloat(String(v || '').replace(/[^0-9.]/g, '')) || 0

const Box = ({ children }) => <div style={{ border:'1px solid #D4CCBC', background:'#FFFFFF', padding:'12px 14px' }}>{children}</div>
const H = ({ children }) => <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#78716C', marginBottom:'6px' }}>{children}</div>
const P = ({ children, tone }) => <div className="display-font" style={{ fontSize:'13px', lineHeight:1.5, color: tone === 'ok' ? '#065F46' : tone === 'warn' ? '#92400E' : '#3F3A35' }}>{children}</div>

// Change this institution's own copy of the case (the case store tells the rest of the app)
function patchCase(id, fn) {
  const all = readCases(); if (!all.some(c => c.id === id)) return
  saveOutcomes(all.map(c => c.id === id ? fn(c) : c))
}

export function LinkedCases({ session, covUser }) {
  const [st, setSt] = useState(undefined), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState(''), [ref, setRef] = useState('')
  const readOnly = covUser?.role === 'auditor'
  const load = () => arnLinkState(session.id).then(r => setSt(r || null)).catch(() => setSt(null))
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [session.id])
  const myCase = st ? readCases().find(c => c.id === st.my_case) : null
  // Remember the link on this side's case, so stage changes can be shared from anywhere in the app
  useEffect(() => { if (myCase && myCase.arnLink?.session !== session.id) patchCase(myCase.id, c => ({ ...c, arnLink: { session: session.id, sync: !!st?.me?.sync, published: st?.me?.stage || '' } })) }, [myCase?.id, session.id])
  if (!st) return null

  const merchant = ['merchant', 'acquirer'].includes(st.my_side)
  const them = SIDE[st.their_side] || 'other side'
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const share = on => run(async () => {
    await arnPublishStage(session.id, myCase?.status || '', on)
    if (myCase) patchCase(myCase.id, c => ({ ...c, arnLink: { session: session.id, sync: on, published: c.status || '' } }))
  })
  const closeMine = (how) => myCase && patchCase(myCase.id, c => ({ ...c, status: 'withdrawn', resolvedDate: new Date().toISOString(),
    settled: { session: session.id, amount: s?.amount, ref: s?.refund_ref || '', how, at: new Date().toISOString() } }))
  const s = st.settlement

  return (
    <div className="mb-6" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:'12px' }}>
      <Box>
        <H>LINKED CASES</H>
        <P>Your case {st.my_case ? <CaseLink id={st.my_case} /> : '—'}: <strong>{stageText(myCase?.status) || '—'}</strong></P>
        <P>Their case ({them}): <strong>{st.them.sync ? stageText(st.them.stage) || '—' : 'not shared'}</strong>{st.them.sync && st.them.stage_at ? <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}> · {when(st.them.stage_at)}</span> : null}</P>
        <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'8px', alignItems:'center', marginTop:'8px', cursor: readOnly ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={!!st.me.sync} disabled={readOnly || busy || !myCase} onChange={e => share(e.target.checked)} />
          Share my case’s stage with the {them}
        </label>
        <div className="display-font" style={{ fontSize:'11px', color:'#78716C', marginTop:'4px' }}>Only the stage is shared (e.g. “Responded”), and it updates as your case moves. Each side still records its own status.</div>
      </Box>

      <Box>
        <H>SETTLE EARLY</H>
        {!s || s.status === 'declined' ? (merchant ? (<>
          <P>{s?.status === 'declined' ? 'The bank declined the last offer. ' : ''}Offer a refund instead of working the chargeback through the network. If the bank agrees, it withdraws the chargeback once the refund posts.</P>
          {!readOnly && <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap', marginTop:'8px' }}>
            <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'2px' }}>Refund amount
              <Input type="number" min="0" step="0.01" value={amount} placeholder={String(amountOf(session.claim?.amount) || '')} onChange={e => setAmount(e.target.value)} style={{ width:'130px', padding:'5px 8px', fontSize:'13px' }} />
            </label>
            <Button small disabled={busy} onClick={() => run(() => arnSettle(session.id, 'offer', { amount: Number(amount || amountOf(session.claim?.amount)) }))}>Offer the refund</Button>
          </div>}
        </>) : <P>{s?.status === 'declined' ? 'You declined the merchant’s offer. ' : ''}The merchant can offer a refund in place of the chargeback; it would appear here.</P>)
        : s.status === 'offered' ? (merchant ? <P>You offered {money(s.amount)} — waiting for the bank.</P> : (<>
          <P tone="warn">The merchant offers to refund {money(s.amount)}{s.note ? ` (${s.note})` : ''}. If you agree, you withdraw the chargeback once the refund posts.</P>
          {!readOnly && <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
            <Button small disabled={busy} onClick={() => run(() => arnSettle(session.id, 'agree'))}>Agree</Button>
            <Button variant="quiet" disabled={busy} onClick={() => run(() => arnSettle(session.id, 'decline'))}>Decline</Button>
          </div>}
        </>))
        : s.status === 'agreed' ? (merchant ? (<>
          <P tone="warn">The bank agreed to {money(s.amount)}. Send the refund, then record its reference.</P>
          {!readOnly && <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap', marginTop:'8px' }}>
            <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'2px' }}>Refund reference
              <Input value={ref} onChange={e => setRef(e.target.value)} placeholder="RF-…" style={{ width:'160px', padding:'5px 8px', fontSize:'13px' }} />
            </label>
            <Button small disabled={busy || !ref.trim()} onClick={() => run(() => arnSettle(session.id, 'refunded', { ref: ref.trim() }))}>Refund sent</Button>
          </div>}
        </>) : <P>You agreed to {money(s.amount)}. Waiting for the merchant to send the refund.</P>)
        : s.status === 'refunded' ? (merchant ? <P>Refund sent ({s.refund_ref}). Waiting for the bank to withdraw the chargeback.</P> : (<>
          <P tone="warn">The merchant refunded {money(s.amount)} — reference {s.refund_ref}. Once it’s on the cardholder’s account, withdraw the chargeback in the network system, then record it here.</P>
          {!readOnly && <div style={{ marginTop:'8px' }}><Button small disabled={busy} onClick={() => run(async () => { await arnSettle(session.id, 'withdrawn'); closeMine('withdrew the chargeback') })}>Chargeback withdrawn — close my case</Button></div>}
        </>))
        : (<>
          <P tone="ok">✓ Settled {when(s.withdrawn_at)}: refunded {money(s.amount)} ({s.refund_ref}) and the chargeback withdrawn.</P>
          {merchant && myCase && myCase.status !== 'withdrawn' && !readOnly && <div style={{ marginTop:'8px' }}><Button small onClick={() => closeMine('refunded the cardholder')}>Close my case as settled</Button></div>}
        </>)}
        <div className="display-font" style={{ fontSize:'11px', color:'#78716C', marginTop:'8px' }}>The refund and the withdrawal themselves happen in your own systems and the network’s; this keeps both sides’ record.</div>
      </Box>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0, gridColumn:'1 / -1' }}>{err}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM LINKS — send a customer the hosted claim form, from Triage → Claims
// ═══════════════════════════════════════════════════════════════════════════════
// For banks without developers, or a customer on the phone who'd rather fill it in
// themselves: the agent enters the customer and the payments from the bank's records,
// and gets a link (claimLinks.mjs) to send by the bank's usual email or text. Covalence
// doesn't send it. The link works once and expires; the claim it makes lands in the box
// above, tagged Web. Below the form: the last links made, and where each one is.
import React, { useEffect, useState } from 'react'
import { listLinks, makeLink, revokeLink } from './claimLinksData.js'
import { linkState } from './claimLinks.mjs'
import { openClaim } from './claimsData.js'
import { canWrite } from './auth.js'
import { Badge, Button, Field, Input, Select } from './ui.jsx'

const ACCOUNTS = [['debit', 'Debit card'], ['credit', 'Credit card'], ['p2p', 'P2P / e-Transfer'], ['ach_eft', 'ACH / EFT'], ['bnpl', 'Buy now, pay later'], ['crypto', 'Crypto (held with you)']]
const EXPIRY = [[24, '24 hours'], [72, '3 days'], [168, '7 days']]
const TONE = { used: 'ok', opened: 'info', waiting: 'neutral', expired: 'neutral', revoked: 'neutral' }
const blankTx = () => ({ ts: '', amount: '', merchant: '', merchantLocation: '' })
const money = n => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const when = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function ClaimLinks() {
  const writer = canWrite()
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState(null)
  const [c, setC] = useState({ name: '', id: '', email: '', accountType: 'debit' })
  const [txs, setTxs] = useState([blankTx()])
  const [reference, setReference] = useState(''), [hours, setHours] = useState(72)
  const [made, setMade] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false)
  const load = () => listLinks().then(setLinks).catch(e => { setLinks([]); setErr(e.message) })
  useEffect(() => { if (open && links === null) load() }, [open])

  const setTx = (i, k, v) => setTxs(t => t.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const ready = c.id.trim() && txs.every(t => t.ts && t.amount !== '' && isFinite(Number(t.amount)) && t.merchant.trim())
  const make = async () => {
    setBusy(true); setErr('')
    try {
      const r = await makeLink({ reference: reference.trim(), expiresInHours: hours,
        customer: { id: c.id.trim(), name: c.name.trim(), email: c.email.trim(), accountType: c.accountType },
        transactions: txs.map((t, i) => ({ id: `${c.id.trim()}-${new Date(t.ts).getTime()}-${i}`, ts: new Date(t.ts).toISOString(), amount: Math.abs(Number(t.amount)), currency: 'USD',
          merchant: t.merchant.trim(), merchantLocation: t.merchantLocation.trim() })) })
      setMade(r); setCopied(false); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const again = () => { setMade(null); setC({ name: '', id: '', email: '', accountType: 'debit' }); setTxs([blankTx()]); setReference('') }
  const copy = url => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const revoke = async id => { setErr(''); try { await revokeLink(id); load() } catch (e) { setErr(e.message) } }

  return (
    <div className="cov-claim-links">
      <button type="button" className="cov-claim-links-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="display-font" style={{ fontSize:'15px', fontWeight:600 }}>Send a customer the claim form</span>
        <span className="display-font" style={{ fontSize:'13px', color:'#6B6259', flex:1, minWidth:0 }}>A link to a form in your bank’s colours, for the payments you pick. It works once.</span>
        <span className="mono-font cov-app-claims-btn">{open ? '▴ HIDE' : '▾ OPEN'}</span>
      </button>
      {open && <div style={{ padding:'4px 18px 16px' }}>
        {!writer ? <p className="display-font" style={{ fontSize:'14px', color:'#6B6259', margin:'0 0 12px' }}>Your role can see links but not make them.</p>
        : made ? (
          <div className="cov-claim-link-made" role="status">
            <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#065F46', marginBottom:'6px' }}>LINK READY · {made.id}</div>
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
              <code className="mono-font cov-claim-link-url">{made.url}</code>
              <Button small onClick={() => copy(made.url)}>{copied ? 'Copied' : 'Copy link'}</Button>
              <a className="mono-font cov-ref-more" href={made.url} target="_blank" rel="noopener noreferrer">open it</a>
            </div>
            <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:'8px 0 0' }}>
              Send it from your usual email or text. It works once and expires {when(made.expiresAt)}. Only you see it now: Covalence keeps no copy of the link{String(made.url).includes('/demo_') ? ' (except in the demo)' : ''}, so if it’s lost, make another.
            </p>
            <Button small variant="quiet" onClick={again} style={{ marginTop:'10px' }}>Make another</Button>
          </div>
        ) : (
          <div style={{ display:'grid', gap:'12px' }}>
            <div className="cov-claim-link-grid">
              <Field label="Customer name" htmlFor="cl-name"><Input id="cl-name" value={c.name} onChange={e => setC({ ...c, name: e.target.value })} placeholder="Jordan Ellis" /></Field>
              <Field label="Customer ID" htmlFor="cl-id" hint="Your own ID for them"><Input id="cl-id" value={c.id} onChange={e => setC({ ...c, id: e.target.value })} placeholder="A-5520" /></Field>
              <Field label="Account" htmlFor="cl-acct"><Select id="cl-acct" value={c.accountType} onChange={e => setC({ ...c, accountType: e.target.value })}>{ACCOUNTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            </div>
            <div>
              <div className="cov-label" style={{ marginBottom:'6px' }}>Payments, as they are in your records</div>
              {txs.map((t, i) => (
                <div key={i} className="cov-claim-link-tx">
                  <Input type="datetime-local" aria-label={`Payment ${i + 1}: when`} value={t.ts} onChange={e => setTx(i, 'ts', e.target.value)} />
                  <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Payment ${i + 1}: amount in USD`} placeholder="Amount" value={t.amount} onChange={e => setTx(i, 'amount', e.target.value)} />
                  <Input aria-label={`Payment ${i + 1}: merchant as on the statement`} placeholder="As on the statement, e.g. SQ *BLUE BOTTLE" value={t.merchant} onChange={e => setTx(i, 'merchant', e.target.value)} />
                  <Input aria-label={`Payment ${i + 1}: where`} placeholder="Where (optional)" value={t.merchantLocation} onChange={e => setTx(i, 'merchantLocation', e.target.value)} />
                  {txs.length > 1 && <button type="button" className="mono-font cov-ref-more" onClick={() => setTxs(txs.filter((_, j) => j !== i))} aria-label={`Remove payment ${i + 1}`}>remove</button>}
                </div>
              ))}
              {txs.length < 25 && <button type="button" className="mono-font cov-ref-more" onClick={() => setTxs([...txs, blankTx()])}>+ another payment</button>}
            </div>
            <div className="cov-claim-link-grid">
              <Field label="Email (optional)" htmlFor="cl-email" hint="Kept with the claim; Covalence doesn’t email it"><Input id="cl-email" type="email" value={c.email} onChange={e => setC({ ...c, email: e.target.value })} /></Field>
              <Field label="Your reference (optional)" htmlFor="cl-ref"><Input id="cl-ref" value={reference} onChange={e => setReference(e.target.value)} /></Field>
              <Field label="Works for" htmlFor="cl-exp"><Select id="cl-exp" value={hours} onChange={e => setHours(Number(e.target.value))}>{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            </div>
            <div><Button disabled={!ready || busy} onClick={make}>{busy ? 'Making…' : 'Make the link'}</Button></div>
          </div>
        )}
        {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:'10px 0 0' }}>{err}</p>}
        {links?.length > 0 && <>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#6B6259', margin:'18px 0 6px' }}>RECENT LINKS</div>
          <ul style={{ listStyle:'none', margin:0, padding:0 }}>
            {links.slice(0, 10).map(l => {
              const s = linkState(l)
              return (
                <li key={l.id} className="cov-claim-link-row">
                  <Badge tone={TONE[s.key]}>{s.label.toUpperCase()}</Badge>
                  <span className="display-font" style={{ flex:'1 1 200px', minWidth:0, fontSize:'14px' }}>
                    {l.customer_name || 'A customer'} · {l.transactions} payment{l.transactions === 1 ? '' : 's'}, {money(l.amount)}
                    <span style={{ color:'#6B6259' }}> · {l.created_by || '—'}, {when(l.created_at)}</span>
                  </span>
                  <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }}>{l.id}</span>
                  {l.claim_id && <button type="button" className="mono-font cov-ref-more" onClick={() => openClaim(l.claim_id)}>{l.claim_id}</button>}
                  {writer && ['waiting', 'opened'].includes(s.key) && <button type="button" className="mono-font cov-ref-more" onClick={() => revoke(l.id)}>cancel link</button>}
                </li>
              )
            })}
          </ul>
        </>}
      </div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRAUD ALERT DETAIL — 001 Triage → Alerts: work one fraud alert
// ═══════════════════════════════════════════════════════════════════════════════
// The bank found it, so the work starts with the customer, not a claim form:
//   1. why it fired (transactions, account events, the rule's reasoning)
//   2. protect: block the card or hold the payment — sent to the institution's own
//      systems as a signed event (Settings → Connections, api/action.js); where
//      nothing is connected, done there by hand and confirmed here
//   3. reach the customer: an outreach script and a log of attempts
//   4. their answer routes it straight on — no re-classification:
//      it was me → closed · not me (card) → Desk · not me (transfer) → recall in Duo
//      tricked into sending it → closed at intake + Licit · they're involved → Licit
// A compromised merchant goes to Trio as an incident instead.
import React, { useEffect, useState } from 'react'
import { auditWrite } from './audit.js'
import { EVENT_TYPES, FRAUD_RULES } from './monitoring.mjs'
import { windowFor, setAlert, sendAction } from './monitoringData.js'
import { Badge, Button } from './ui.jsx'

const DAY = 86400000
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString()
const when = ts => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const H = ({ children }) => <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', margin:'14px 0 6px' }}>{children}</div>
const ACTIONS = { fi: { block_card: 'Block the card', hold_payment: 'Hold the payment' }, ce: { block_card: 'Lock the account', hold_payment: 'Hold the withdrawal' } }
const SYSTEM = { fi: { block_card: 'card', hold_payment: 'payments' }, ce: { block_card: 'exchange admin', hold_payment: 'exchange admin' } }

function script(a, institution) {
  const what = { account_takeover: 'changes to your online banking and a payment', card_testing: 'some small card charges', scam_victim: 'a large payment',
    dormant_awakens: 'activity on an account that’s been quiet for a while', check_duplicate: 'a check deposit', external: 'activity on your account' }[a.rule] || 'activity on your account'
  return [`Hello, this is the fraud team at ${institution || 'your bank'}. We’re calling about ${what} on ${new Date(a.to).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}${a.total ? ` totalling ${money(a.total)}` : ''}.`,
    'Before we go on, can you confirm your identity using the details we hold on file?',
    'Did you make or authorise this yourself?',
    ...(a.rule === 'scam_victim' ? ['Has anyone asked you to send money, pay a fee to release funds, buy gift cards or crypto, or keep this payment secret?'] : []),
    ...(a.rule === 'account_takeover' ? ['Did you change your password or phone number recently, or share a one-time code with anyone?'] : []),
    '',
    'Remember: never ask for a full card number, PIN, password or one-time code.'].join('\n')
}

export function FraudAlertDetail({ a, segment = 'fi', covUser, writer, institution, onDone, route }) {
  const ce = segment === 'ce', LABEL = ACTIONS[segment] || ACTIONS.fi, SYS = SYSTEM[segment] || SYSTEM.fi
  const [txs, setTxs] = useState(null)
  const [log, setLog] = useState({ method: 'Call', outcome: 'Reached', note: '' })
  const [pending, setPending] = useState(null)        // protective action being confirmed
  const [send, setSend] = useState(null)              // { busy } | { notConnected } | { error }
  const [err, setErr] = useState('')
  const who = covUser?.name || covUser?.email || 'Analyst'
  useEffect(() => {
    if (a.rule === 'compromised_merchant') { setTxs([]); return }
    windowFor([a.customerId], new Date(new Date(a.from || a.to).getTime() - DAY).toISOString())
      .then(rows => setTxs(rows.filter(t => (a.txIds || []).includes(t.id)))).catch(() => setTxs([]))
  }, [a.id])
  const patch = async (status, p, auditAction, detail) => {
    try { await setAlert(a.id, status, p); auditWrite(auditAction, 'alert', a.id, { customer: a.customerId, rule: a.rule, ...detail }); onDone(status !== 'open') }
    catch (e) { setErr(e.message) }
  }
  const reached = (a.contacts || []).some(c => c.outcome === 'Reached')
  const overdue = a.contactDue && !reached && new Date(a.contactDue) < new Date()
  const base = { by: who, ts: new Date().toISOString() }
  const outs = (txs || []).filter(t => t.direction === 'out')
  const top = Object.entries(outs.reduce((m, t) => (t.counterparty ? (m[t.counterparty] = (m[t.counterparty] || 0) + t.amount, m) : m), {})).sort((x, y) => y[1] - x[1])[0]?.[0]
  const statement = how => `${how} — confirmed with the customer by ${(a.contacts || []).filter(c => c.outcome === 'Reached').slice(-1)[0]?.method?.toLowerCase() || 'contact'} on ${new Date().toLocaleDateString('en-US')}. Alert: ${a.label}. ${a.detail}`
  const caseFrom = (extra) => ({
    id: 'COV-' + Date.now().toString(36).toUpperCase().slice(-6), date: new Date().toISOString(), status: 'received', verdict: 'TRUE_FRAUD', confidence: 'HIGH',
    merchant: top || a.customerName || 'Account activity', amount: `${(outs.reduce((n, t) => n + t.amount, 0) || a.total).toFixed(2)} USD`, cardholderName: a.customerName || a.customerId,
    notes: [], docs: [], source: { type: 'alert', alertId: a.id, rule: a.rule }, history: [{ ts: new Date().toISOString(), event: 'created_from_alert', alert: a.label, by: who }], ...extra,
  })

  const answers = [
    { key: 'genuine', label: 'Yes, it was me', tone: 'secondary', run: () => patch('closed', { disposition: { outcome: 'Customer confirmed genuine', ...base } }, 'alert.closed', { reason: 'Customer confirmed genuine' }) },
    !ce && { key: 'desk', label: 'No — open a card dispute', tone: route?.desk ? 'primary' : 'secondary', run: () => {
      const c = caseFrom({ category: 'fraud', _complaint: statement('Customer did not make these card transactions'), accountType: 'credit' })
      route.openDesk(c); patch('escalated', { escalatedTo: c.id, outcome: 'Not me — card dispute', ...base }, 'alert.escalated', { case: c.id, route: 'desk' }) } },
    { key: 'recall', label: ce ? 'No — ask the receiving exchange to freeze it' : 'No — recall the transfer', tone: 'secondary', run: () => {
      const c = caseFrom({ accountType: ce ? 'crypto_exchange' : 'p2p', _complaint: statement(ce ? 'Customer did not authorise this withdrawal' : 'Customer did not authorise this transfer') })
      route.recall(c, segment); patch('escalated', { escalatedTo: c.id, outcome: 'Not me — recall', ...base }, 'alert.escalated', { case: c.id, route: 'recall' }) } },
    { key: 'scam', label: 'They sent it, but were tricked', tone: 'secondary', run: () => {
      const c = caseFrom({ verdict: 'AUTHORIZED_PUSH_PAYMENT', accountType: 'p2p', _complaint: statement('Customer sent this payment themselves after being deceived'), status: 'closed', resolvedDate: new Date().toISOString(),
        closedAtIntake: { reason: 'no_rights', reasonLabel: 'No dispute rights', basis: 'authorised_push', basisLabel: 'The customer sent the payment themselves (wire, Zelle or another person-to-person transfer)', note: `From fraud alert ${a.id}`, ts: new Date().toISOString(), aiSuggested: '' } })
      route.scam(c); patch('escalated', { escalatedTo: c.id, outcome: 'Scam — no dispute rights, sent to Licit', ...base }, 'alert.escalated', { case: c.id, route: 'scam' }) } },
    { key: 'involved', label: 'The customer is involved', tone: 'secondary', run: () => {
      const id = route.toLicit(a, txs || []); patch('escalated', { escalatedTo: id, outcome: 'Customer involved — sent to Licit', ...base }, 'alert.escalated', { case: id, route: 'licit' }) } },
  ].filter(Boolean)
  const suggested = { desk: 'desk', recall: 'recall', scam: 'scam' }[FRAUD_RULES[a.rule]?.route] || null

  return (
    <div style={{ padding:'4px 16px 16px' }}>
      <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 6px', lineHeight:1.5 }}><strong>Why:</strong> {a.detail}.</p>
      {a.source && <div className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>From a connected system ({a.source}){a.externalId ? `, alert ${a.externalId}` : ''}.</div>}
      {a.contactDue && a.status === 'open' && (
        <div className="mono-font" style={{ fontSize:'11px', color: overdue ? '#991B1B' : '#92400E', margin:'4px 0' }}>{overdue ? 'OVERDUE — ' : ''}Reach the customer by {when(a.contactDue)}{reached ? ' · reached' : ''}</div>
      )}

      {a.events?.length > 0 && (<>
        <H>ACCOUNT ACTIVITY</H>
        <ol style={{ margin:0, paddingLeft:'18px' }}>{a.events.map((e, i) => <li key={i} className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>{when(e.ts)} — {EVENT_TYPES[e.type] || e.type}{e.device ? ` · ${e.device}` : ''}{e.location ? ` · ${e.location}` : ''}</li>)}</ol>
      </>)}

      {a.rule === 'compromised_merchant' ? (<>
        <H>CONFIRMED FRAUD VICTIMS WHO USED {String(a.merchant || a.customerName).toUpperCase()}</H>
        <ul style={{ margin:0, paddingLeft:'18px' }}>{(a.victims || []).map(v => <li key={v.caseId} className="display-font" style={{ fontSize:'14px' }}>{v.name} <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>({v.caseId})</span></li>)}</ul>
      </>) : txs === null ? <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Loading the transactions…</p> : txs.length > 0 && (<>
        <H>TRANSACTIONS</H>
        <div style={{ overflowX:'auto' }}>
          <table className="mono-font" style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
            <thead><tr>{['When', 'In/out', 'Amount', 'Channel', 'Counterparty', 'Memo'].map(h => <th key={h} scope="col" style={{ textAlign:'left', padding:'5px 8px', color:'#57534E', fontWeight:500, borderBottom:'1px solid #D4CCBC' }}>{h}</th>)}</tr></thead>
            <tbody>{txs.map(t => <tr key={t.id}>{[when(t.ts), t.direction === 'in' ? 'In' : 'Out', money(t.amount), t.channel, t.counterparty || '—', t.description || '—'].map((v, i) => <td key={i} style={{ padding:'5px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace: i === 5 ? 'normal' : 'nowrap' }}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </>)}

      {a.status !== 'open' ? (
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'12px 0 0' }}>
          {a.outcome || a.disposition?.outcome || a.status}{a.escalatedTo ? ` → ${a.escalatedTo}` : ''} · {a.by || a.disposition?.by}, {when(a.ts || a.disposition?.ts)}
        </p>
      ) : !writer ? <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Your role can’t work alerts.</p> : a.rule === 'compromised_merchant' ? (
        <div style={{ marginTop:'12px', display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <Button onClick={() => { const id = route.trio(a); patch('escalated', { escalatedTo: id, outcome: 'Trio incident opened', ...base }, 'alert.escalated', { incident: id, route: 'trio' }) }}>Open a Trio incident</Button>
          <Button variant="secondary" onClick={() => patch('closed', { disposition: { outcome: 'Not a common point of compromise', ...base } }, 'alert.closed', { reason: 'Not a common point of compromise' })}>Not a compromise — close</Button>
        </div>
      ) : (<>
        {/* Protect */}
        <H>PROTECT THE CUSTOMER</H>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
          {Object.entries(LABEL).map(([k, l]) => {
            const done = (a.actions || []).find(x => x.type === k)
            return done ? <Badge key={k} tone="ok">{l.toUpperCase()} — {done.status?.startsWith('sent') ? 'SENT' : 'DONE'} {when(done.ts).toUpperCase()}{done.reference ? ` · REF ${done.reference}` : ''}</Badge>
              : <Button key={k} variant={a.action === k ? 'danger' : 'secondary'} onClick={() => { setSend(null); setPending(k) }}>{l}{a.action === k ? ' (recommended)' : ''}</Button>
          })}
        </div>
        {pending && (
          <div style={{ border:'1px solid #FCD34D', background:'#FFFBEB', padding:'10px 12px', marginTop:'8px' }}>
            {send?.notConnected || send?.error ? (<>
              <p className="display-font" style={{ fontSize:'14px', margin:'0 0 8px', color:'#3F3A35' }}>
                {send.error ? <>Your {SYS[pending]} system didn’t confirm it: {send.error}. </> : <>Covalence isn’t connected to your {SYS[pending]} system yet (Settings → Connections). </>}
                {LABEL[pending]} there, then confirm here so it’s on the record.
              </p>
              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                <Button small onClick={() => { const actions = [...(a.actions || []), { type: pending, ...base, status: 'done in external system' }]; setPending(null); setSend(null); patch('open', { actions }, 'alert.action', { action: pending, how: 'manual' }) }}>Done in the {SYS[pending]} system</Button>
                {send.error && <Button small variant="secondary" onClick={() => setSend(null)}>Try again</Button>}
                <Button variant="quiet" onClick={() => { setPending(null); setSend(null) }}>Cancel</Button>
              </div>
            </>) : (<>
              <p className="display-font" style={{ fontSize:'14px', margin:'0 0 8px', color:'#3F3A35' }}>
                {LABEL[pending]} for {a.customerName || a.customerId}{a.total ? ` (${money(a.total)})` : ''}? Covalence sends it to your {SYS[pending]} system and records the answer.
              </p>
              <div style={{ display:'flex', gap:'8px' }}>
                <Button small variant="danger" disabled={send?.busy} onClick={async () => {
                  setSend({ busy: true })
                  try {
                    const r = await sendAction({ alertId: a.id, action: pending })
                    if (r.notConnected) return setSend({ notConnected: true })
                    if (!r.ok) return setSend({ error: r.error || 'no answer' })
                    const actions = [...(a.actions || []), { type: pending, ...base, status: r.demo ? 'sent (demo)' : 'sent', reference: r.reference || null, event: r.event || null }]
                    setPending(null); setSend(null); patch('open', { actions }, 'alert.action', { action: pending, how: 'sent', reference: r.reference || null })
                  } catch (e) { setSend({ error: e.message }) }
                }}>{send?.busy ? 'Sending…' : `Yes — ${LABEL[pending].toLowerCase()}`}</Button>
                <Button variant="quiet" disabled={send?.busy} onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </>)}
          </div>
        )}

        {/* Reach */}
        <H>REACH THE CUSTOMER</H>
        <details>
          <summary className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#1E3A5F', cursor:'pointer' }}>OUTREACH SCRIPT</summary>
          <pre className="display-font" style={{ whiteSpace:'pre-wrap', fontSize:'14px', lineHeight:1.55, color:'#1A1814', background:'#FFFFFF', border:'1px solid #E7E2D9', padding:'10px 12px', margin:'6px 0' }}>{script(a, institution)}</pre>
        </details>
        {(a.contacts || []).length > 0 && (
          <ul className="mono-font" style={{ fontSize:'11px', color:'#3F3A35', margin:'6px 0', paddingLeft:'16px' }}>
            {a.contacts.map((c, i) => <li key={i}>{when(c.ts)} · {c.method} · {c.outcome}{c.note ? ` — ${c.note}` : ''} · {c.by}</li>)}
          </ul>
        )}
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', marginTop:'6px' }}>
          <select className="input-field" aria-label="Contact method" value={log.method} onChange={e => setLog(l => ({ ...l, method: e.target.value }))} style={{ padding:'6px 8px', fontSize:'13px' }}>{['Call', 'SMS', 'Email', 'In-app message'].map(x => <option key={x}>{x}</option>)}</select>
          <select className="input-field" aria-label="Contact outcome" value={log.outcome} onChange={e => setLog(l => ({ ...l, outcome: e.target.value }))} style={{ padding:'6px 8px', fontSize:'13px' }}>{['Reached', 'No answer', 'Left a message', 'Wrong number'].map(x => <option key={x}>{x}</option>)}</select>
          <input className="cov-input" aria-label="Contact note" placeholder="Note (optional)" value={log.note} onChange={e => setLog(l => ({ ...l, note: e.target.value }))} style={{ padding:'6px 8px', fontSize:'13px', flex:'1 1 160px' }} />
          <Button small variant="secondary" onClick={() => { const contacts = [...(a.contacts || []), { ...log, ...base }]; setLog({ method: log.method, outcome: 'Reached', note: '' }); patch('open', { contacts }, 'alert.contacted', { method: log.method, outcome: log.outcome }) }}>Log contact</Button>
        </div>

        {/* Answer */}
        <H>THE CUSTOMER’S ANSWER{reached ? '' : ' — LOG THE CONTACT FIRST'}</H>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          {answers.map(x => <Button key={x.key} disabled={!reached && x.key !== 'involved'} variant={x.key === suggested ? 'primary' : x.key === 'involved' ? 'quiet' : 'secondary'} onClick={x.run}>{x.label}</Button>)}
        </div>
        <div style={{ marginTop:'8px' }}>
          <Button variant="quiet" onClick={() => patch('closed', { disposition: { outcome: 'Closed — rule fired on legitimate activity', ...base } }, 'alert.closed', { reason: 'False positive' })}>Close without contact — false positive</Button>
        </div>
      </>)}
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B' }}>{err}</p>}
    </div>
  )
}

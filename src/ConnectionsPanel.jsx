// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTIONS — Settings → Connections: send data straight to Covalence
// ═══════════════════════════════════════════════════════════════════════════════
// In: an institution's own systems (core banking, card processor, a fraud engine)
// POST transactions, account events and alerts to /api/intake with an API key.
// Admins create and revoke keys here; a key is shown once and only its hash is
// stored (supabase_fraud.sql).
// Out: when an analyst presses Hold / Block / Lock, and when new alerts arrive,
// Covalence POSTs signed events to the institution's endpoint, and new alerts can
// post to Slack (supabase_actions.sql, api/action.js).
import React, { useEffect, useState } from 'react'
import { createKey, listKeys, revokeKey, getEndpoint, setEndpoint, rotateSecret, sendAction, intakeStatus } from './monitoringData.js'
import { Badge, Button, Input } from './ui.jsx'

const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px', marginBottom:'20px' }
const day = ts => ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '—'
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 12px', fontWeight:500 }}>{children}</h2>
const Code = ({ children }) => <pre className="mono-font" style={{ fontSize:'12px', background:'#1A1814', color:'#F5F1EA', padding:'12px 14px', overflowX:'auto', margin:'8px 0', lineHeight:1.5 }}>{children}</pre>

export function ConnectionsPanel({ covUser }) {
  const [keys, setKeys] = useState([]), [label, setLabel] = useState(''), [fresh, setFresh] = useState(null), [err, setErr] = useState('')
  const admin = covUser?.role === 'admin'
  const [status, setStatus] = useState(null)
  const refresh = () => { listKeys().then(setKeys).catch(e => setErr(e.message)); intakeStatus().then(setStatus).catch(() => {}) }
  useEffect(refresh, [])
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://covalence.vercel.app'

  return (<>
    <section style={box}>
      <H2>SEND DATA STRAIGHT TO COVALENCE</H2>
      <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 10px', maxWidth:'780px' }}>
        Your core banking system, card processor or fraud engine can post transactions, account events and its own alerts the moment they happen. Covalence stores them, runs the fraud and AML rules for the customers involved, and the alerts appear in 001 Triage and 005 Licit within seconds — no daily file needed.
      </p>
      {status && <LiveStatus status={status} />}
      {covUser?.demo && <p className="mono-font" style={{ fontSize:'11px', color:'#92400E', margin:'10px 0 0' }}>Demo: keys made here are for show and won’t work with the API. Signed-in workspaces get working keys.</p>}
    </section>

    <section style={box}>
      <H2>API KEYS</H2>
      {fresh && (
        <div role="status" style={{ border:'2px solid #065F46', background:'#ECFDF5', padding:'12px 14px', marginBottom:'14px' }}>
          <div className="display-font" style={{ fontSize:'15px', color:'#064E3B', marginBottom:'6px' }}>Copy this key now — it won’t be shown again.</div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <code className="mono-font" style={{ fontSize:'12px', background:'#FFFFFF', border:'1px solid #6EE7B7', padding:'6px 8px', overflowWrap:'anywhere' }}>{fresh}</code>
            <Button small onClick={() => navigator.clipboard?.writeText(fresh)}>Copy</Button>
            <Button variant="quiet" onClick={() => setFresh(null)}>Done</Button>
          </div>
        </div>
      )}
      {admin ? (
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', marginBottom:'14px' }}>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="What will use it, e.g. Card processor" aria-label="Key name" style={{ width:'280px', padding:'8px 10px', fontSize:'14px' }} />
          <Button disabled={!label.trim()} onClick={async () => { setErr(''); try { setFresh(await createKey(label.trim())); setLabel(''); refresh() } catch (e) { setErr(e.message) } }}>Create a key</Button>
        </div>
      ) : <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259', margin:'0 0 12px' }}>Admins create and revoke keys.</p>}
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B' }}>{err}</p>}
      {keys.length === 0 ? <p className="display-font" style={{ fontSize:'14px', color:'#57534E', fontStyle:'italic', margin:0 }}>No keys yet.</p> : (
        <div style={{ overflowX:'auto' }}>
          <table className="mono-font" style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
            <thead><tr>{['Name', 'Key', 'Created', 'Last used', ''].map(h => <th key={h} scope="col" style={{ textAlign:'left', padding:'6px 8px', color:'#57534E', fontWeight:500, borderBottom:'1px solid #D4CCBC' }}>{h}</th>)}</tr></thead>
            <tbody>{keys.map(k => (
              <tr key={k.id}>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC' }}>{k.label}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC' }}>{k.prefix}…</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace:'nowrap' }}>{day(k.created_at)}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace:'nowrap' }}>{k.last_used_at ? day(k.last_used_at) : 'never'}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC' }}>
                  {k.revoked_at ? <Badge>REVOKED</Badge> : admin && <Button variant="quiet" onClick={async () => { if (!window.confirm(`Revoke “${k.label}”? Systems using it will stop working.`)) return; try { await revokeKey(k.id); refresh() } catch (e) { setErr(e.message) } }}>Revoke</Button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>

    <ActOnAlerts admin={admin} demo={!!covUser?.demo} origin={origin} />

    <section style={box}>
      <H2>HOW TO SEND DATA</H2>
      <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 6px' }}>One endpoint. Up to 1,000 of each per call; sending the same id twice is ignored.</p>
      <Code>{`POST ${origin}/api/intake
Authorization: Bearer cvl_…
Content-Type: application/json

{
  "transactions": [{ "id": "TX-88121", "customerId": "A-1005", "customerName": "M. Okafor",
                     "ts": "2026-10-28T08:41:00Z", "amount": -2400, "currency": "USD",
                     "channel": "zelle", "counterparty": "Zed Holdings", "description": "Transfer" }],
  "events":       [{ "id": "EV-551", "customerId": "A-1005", "ts": "2026-10-28T08:12:00Z",
                     "type": "new device login", "device": "Android 14", "location": "Lagos NG" }],
  "alerts":       [{ "id": "ENGINE-77", "customerId": "A-1006", "title": "High device risk",
                     "reason": "Device risk 97/100", "severity": "high", "amount": 450,
                     "recommendedAction": "block_card" }]
}`}</Code>
      <ul className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.6, margin:'8px 0 0', paddingLeft:'18px' }}>
        <li><strong>Transactions:</strong> negative amounts are money out (or send <code>direction</code>: "in" / "out"). Channel words like zelle, wire, ach, card, cash, crypto, check are recognised.</li>
        <li><strong>Events:</strong> logins, new devices or locations, password, phone or email changes, new payees — what the account-takeover rule reads.</li>
        <li><strong>Alerts</strong> from your own fraud engine land in 001 Triage → Alerts as they are.</li>
        <li><strong>Crypto exchanges:</strong> add <code>"segment": "ce"</code> to the body — withdrawals to wallets are judged as an exchange’s, and alerts land on Triage’s Crypto Exchange side.</li>
        <li>The answer lists what was stored, what was a duplicate, any rows with problems, and the ids of the alerts raised.</li>
      </ul>
    </section>
  </>)
}

// "Is data arriving?" — shown here and above the alerts in Triage and Licit
export function LiveStatus({ status, compact }) {
  const ago = status.last_received ? Date.now() - new Date(status.last_received).getTime() : null
  const live = ago != null && ago < 24 * 3600000
  const rel = ago == null ? '' : ago < 60000 ? 'just now' : ago < 3600000 ? `${Math.round(ago / 60000)} min ago` : ago < 86400000 ? `${Math.round(ago / 3600000)} h ago` : `${Math.round(ago / 86400000)} days ago`
  const [dot, color, text] = live ? ['●', '#065F46', `LIVE — last data received ${rel}`]
    : status.active_keys > 0 ? ['○', '#92400E', ago == null ? 'CONNECTED — waiting for the first data' : `CONNECTED — nothing received for ${rel.replace(' ago', '')}`]
    : ['○', '#6B6259', 'NOT CONNECTED — your systems aren’t sending data yet']
  return <div className="mono-font" role="status" style={{ fontSize: compact ? '10px' : '11px', letterSpacing:'0.1em', color }}>{dot} {text}</div>
}

const SEVS = [['high', 'High only'], ['medium', 'Medium and high'], ['low', 'Every alert'], ['off', 'Off']]
function ActOnAlerts({ admin, demo, origin }) {
  const [ep, setEp] = useState(undefined), [url, setUrl] = useState(''), [slack, setSlack] = useState(''), [min, setMin] = useState('high')
  const [secret, setSecret] = useState(null), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false)
  const load = () => getEndpoint().then(e => { setEp(e); setUrl(e?.url || ''); setMin(e?.notify_min || 'high') }).catch(e => setMsg({ err: e.message }))
  useEffect(() => { load() }, [])
  const run = async (fn, okText) => { setBusy(true); setMsg(null); try { const r = await fn(); if (okText) setMsg({ ok: okText }); return r } catch (e) { setMsg({ err: e.message }) } finally { setBusy(false) } }
  const save = (slackValue) => run(async () => { await setEndpoint(url.trim(), slackValue, min); setSlack(''); await load() }, 'Saved.')
  const test = () => run(async () => {
    const r = await sendAction({ test: true })
    if (r.notConnected) throw new Error('Save an endpoint first')
    if (!r.ok) throw new Error(r.error || 'No answer')
    setMsg({ ok: r.demo ? 'Demo: a test event would be sent now.' : `Your endpoint answered ${r.status}${r.reference ? ` (reference ${r.reference})` : ''}.` })
  })
  const field = { padding:'8px 10px', fontSize:'14px', width:'100%', maxWidth:'520px' }
  if (ep === undefined) return null

  return (<>
    <section style={box}>
      <H2>ACT IN YOUR SYSTEMS</H2>
      <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 12px', maxWidth:'780px' }}>
        When an analyst presses <strong>Block the card</strong>, <strong>Hold the payment</strong> or <strong>Lock the account</strong>, Covalence sends a signed event to your endpoint and records its answer on the alert. New alerts are sent there too, so your own systems can react.
      </p>
      {admin ? (<div style={{ display:'grid', gap:'10px' }}>
        <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>Your endpoint (https)
          <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://fraud-actions.yourbank.com/covalence" aria-label="Endpoint URL" style={field} />
        </label>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
          <Button disabled={busy} onClick={() => save(null)}>Save</Button>
          <Button variant="secondary" disabled={busy || !ep?.url} onClick={test}>Send a test event</Button>
          <Button variant="quiet" disabled={busy} onClick={() => run(async () => { setSecret(await rotateSecret()); await load() })}>{ep?.has_secret ? 'Replace the signing secret' : 'Create a signing secret'}</Button>
        </div>
        {secret && (
          <div role="status" style={{ border:'2px solid #065F46', background:'#ECFDF5', padding:'12px 14px' }}>
            <div className="display-font" style={{ fontSize:'15px', color:'#064E3B', marginBottom:'6px' }}>Copy this secret into your receiver now — it won’t be shown again.</div>
            <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
              <code className="mono-font" style={{ fontSize:'12px', background:'#FFFFFF', border:'1px solid #6EE7B7', padding:'6px 8px', overflowWrap:'anywhere' }}>{demo ? secret.slice(0, 14) + '… (demo)' : secret}</code>
              <Button small onClick={() => navigator.clipboard?.writeText(secret)}>Copy</Button>
              <Button variant="quiet" onClick={() => setSecret(null)}>Done</Button>
            </div>
          </div>
        )}
      </div>) : <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259', margin:0 }}>{ep?.url ? `Sending to ${ep.url}. ` : ''}Admins set this up.</p>}
      {admin && ep && <p className="mono-font" style={{ fontSize:'11px', color:'#57534E', margin:'10px 0 0' }}>{ep.url ? `Sending to ${ep.url}` : 'No endpoint yet'} · {ep.has_secret ? 'signed' : 'not signed — create a secret'}</p>}
    </section>

    <section style={box}>
      <H2>ALERT NOTIFICATIONS</H2>
      <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 12px', maxWidth:'780px' }}>
        New alerts from your connected systems post to a Slack channel within seconds, so nobody has to watch the queue. Email alerts follow once Covalence’s sending domain is verified.
      </p>
      {admin ? (<div style={{ display:'grid', gap:'10px' }}>
        <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>Slack incoming webhook {ep?.slack_set && <span className="mono-font" style={{ fontSize:'11px', color:'#065F46' }}>● connected — paste a new one to replace it</span>}
          <Input value={slack} onChange={e => setSlack(e.target.value)} placeholder={ep?.slack_set ? '•••• saved' : 'https://hooks.slack.com/services/…'} aria-label="Slack webhook URL" style={field} />
        </label>
        <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px', maxWidth:'260px' }}>Notify for
          <select className="input-field" value={min} onChange={e => setMin(e.target.value)} style={{ padding:'8px 10px', fontSize:'14px' }}>{SEVS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <Button disabled={busy} onClick={() => save(slack.trim() ? slack.trim() : null)}>Save</Button>
          {ep?.slack_set && <Button variant="quiet" disabled={busy} onClick={() => save('')}>Remove Slack</Button>}
        </div>
      </div>) : <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259', margin:0 }}>{ep?.slack_set ? `Posting ${SEVS.find(x => x[0] === ep.notify_min)?.[1].toLowerCase()} alerts to Slack. ` : ''}Admins set this up.</p>}
      {msg && <p role={msg.err ? 'alert' : 'status'} className="mono-font" style={{ fontSize:'11px', color: msg.err ? '#991B1B' : '#065F46', margin:'10px 0 0' }}>{msg.err || msg.ok}</p>}
    </section>

    <section style={box}>
      <H2>WHAT YOUR ENDPOINT RECEIVES</H2>
      <Code>{`POST <your endpoint>
Covalence-Event-Type: action.requested
Covalence-Signature: t=1793170000,v1=5f2c…   (HMAC-SHA256 of "<t>.<body>" with your secret)

{ "id": "evt_9c1…", "type": "action.requested", "created": "2026-10-28T08:45:12Z",
  "data": { "action": "hold_payment", "segment": "fi", "alertId": "FR-…",
            "customerId": "A-1005", "customerName": "M. Okafor", "amount": 2400,
            "transactionIds": ["TX-88121"], "requestedBy": { "name": "…", "email": "…" } } }

Answer 2xx when it's done — add { "reference": "HOLD-5521" } to show it on the alert.`}</Code>
      <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'6px 0 0', lineHeight:1.5 }}>
        Other events: <code>alert.created</code> (new alerts, with their customer and recommended action) and <code>covalence.test</code>. Check the signature and reject anything older than five minutes. Actions for crypto exchanges arrive as <code>block_card</code> (lock the account) and <code>hold_payment</code> (hold the withdrawal) with <code>"segment": "ce"</code>.
      </p>
    </section>
  </>)
}

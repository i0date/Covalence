// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTIONS — Settings → Connections: send data straight to Covalence
// ═══════════════════════════════════════════════════════════════════════════════
// An institution's own systems (core banking, card processor, a fraud engine)
// POST transactions, account events and alerts to /api/intake with an API key.
// Admins create and revoke keys here; a key is shown once and only its hash is
// stored (supabase_fraud.sql).
import React, { useEffect, useState } from 'react'
import { createKey, listKeys, revokeKey } from './monitoringData.js'
import { Badge, Button, Input } from './ui.jsx'

const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px', marginBottom:'20px' }
const day = ts => ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '—'
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 12px', fontWeight:500 }}>{children}</h2>
const Code = ({ children }) => <pre className="mono-font" style={{ fontSize:'12px', background:'#1A1814', color:'#F5F1EA', padding:'12px 14px', overflowX:'auto', margin:'8px 0', lineHeight:1.5 }}>{children}</pre>

export function ConnectionsPanel({ covUser }) {
  const [keys, setKeys] = useState([]), [label, setLabel] = useState(''), [fresh, setFresh] = useState(null), [err, setErr] = useState('')
  const admin = covUser?.role === 'admin'
  const refresh = () => listKeys().then(setKeys).catch(e => setErr(e.message))
  useEffect(refresh, [])
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://covalence.vercel.app'

  return (<>
    <section style={box}>
      <H2>SEND DATA STRAIGHT TO COVALENCE</H2>
      <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 10px', maxWidth:'780px' }}>
        Your core banking system, card processor or fraud engine can post transactions, account events and its own alerts the moment they happen. Covalence stores them, runs the fraud and AML rules for the customers involved, and the alerts appear in 001 Triage and 005 Licit within seconds — no daily file needed.
      </p>
      {covUser?.demo && <p className="mono-font" style={{ fontSize:'11px', color:'#92400E', margin:'0 0 10px' }}>Demo: keys made here are for show and won’t work with the API. Signed-in workspaces get working keys.</p>}
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
        <li>The answer lists what was stored, what was a duplicate, any rows with problems, and the ids of the alerts raised.</li>
      </ul>
    </section>
  </>)
}

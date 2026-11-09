// ═══════════════════════════════════════════════════════════════════════════════
// THE NETWORK WARNED YOU — pre-dispute alerts, 001 Triage → Alerts, Merchant side
// ═══════════════════════════════════════════════════════════════════════════════
// Ethoca, Verifi CDRN and RDR, Visa Order Insight and Mastercard Consumer Clarity
// (preDispute.mjs). The ones waiting come first, soonest window first, each with what
// we'd do and why (from Settings → Chargebacks against you); then the last 30 days
// settled. Deciding is audited and sent to your systems (preDisputeData.js), which
// refund and report the outcome to the provider.
import React, { useEffect, useState } from 'react'
import { listPreDispute, decidePreDispute } from './preDisputeData.js'
import { SOURCES, REASONS, STATUSES, AVOIDED, DECLINE_REASONS, clockOf, recommend, summary } from './preDispute.mjs'
import { canWrite } from './auth.js'
import { Badge, Button, Select } from './ui.jsx'

const money = (n, cur = 'USD') => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: /^[A-Z]{3}$/.test(cur) ? cur : 'USD' })
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago` }
const left = ms => { const h = Math.floor(Math.abs(ms) / 3600000); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? `${h}h` : `${Math.max(1, Math.round(Math.abs(ms) / 60000))} min` }
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', marginBottom:'20px' }
const STATUS_TONE = { refunded: 'ok', already_refunded: 'ok', rdr_refunded: 'ok', shared: 'info', declined: 'neutral', rdr_declined: 'neutral', expired: 'danger', acknowledged: 'warn' }
const ACT = { refund: 'Refund', share: 'Share the order', look: 'Check the order', answer: 'Answer on Desk' }

export function PreDisputePanel({ settings }) {
  const [rows, setRows] = useState(null), [err, setErr] = useState(''), [open, setOpen] = useState(null), [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(null), [why, setWhy] = useState(DECLINE_REASONS[0]), [msg, setMsg] = useState('')
  const writer = canWrite()
  const load = () => listPreDispute().then(r => { setRows(r); setErr('') }).catch(e => { setRows([]); setErr(e.message) })
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    window.addEventListener('cov:predispute-changed', load)
    return () => { clearInterval(t); window.removeEventListener('cov:predispute-changed', load) }
  }, [])
  if (rows === null) return null
  const sum = summary(rows)
  const waiting = rows.filter(a => a.status === 'open').sort((a, b) => (a.respondBy ? new Date(a.respondBy) : Infinity) - (b.respondBy ? new Date(b.respondBy) : Infinity))
  const settled = rows.filter(a => a.status !== 'open' && Date.now() - new Date(a.receivedAt) < 30 * 86400000).sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))

  const decide = async (a, action, note = '') => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await decidePreDispute(a.id, action, note)
      setMsg(`${a.id}: ${STATUSES[action]}.${action === 'acknowledged' ? ' It will show on 002 Desk → Merchant when your acquirer sends it.' : ''}${r.sent === true ? ' Sent to your systems.' : r.sent === false ? ` Not sent to your systems${r.error ? ` (${r.error})` : ''}: do it there by hand.` : ''}`)
      setDeclining(null); setOpen(null); load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <section aria-label="Pre-dispute alerts" style={box}>
      <div style={{ padding:'16px 18px 12px', borderBottom:'1px solid #D4CCBC' }}>
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#6B6259' }}>THE NETWORK WARNED YOU</div>
        <h2 className="display-font" style={{ margin:'4px 0 0', fontSize:'22px', fontWeight:600, color:'#1A1814' }}>
          {waiting.length ? `${waiting.length} alert${waiting.length === 1 ? '' : 's'} to answer before ${waiting.length === 1 ? 'it becomes a chargeback' : 'they become chargebacks'}` : 'Nothing waiting on you'}
        </h2>
        <p className="display-font" style={{ margin:'4px 0 0', fontSize:'14px', color:'#57534E', lineHeight:1.5, maxWidth:'760px' }}>
          Refund in time and there’s no chargeback, and nothing counts against your Visa or Mastercard ratio. Alerts come from Ethoca, Verifi and the networks through your systems (Settings → Connections).
        </p>
      </div>
      <div className="cov-pd-stats">
        <div><span className="mono-font">WAITING</span><strong>{sum.open}</strong></div>
        <div><span className="mono-font">CHARGEBACKS AVOIDED · 30 DAYS</span><strong style={{ color:'#065F46' }}>{sum.avoided}</strong><em className="display-font">{money(sum.avoidedAmount)} kept off your ratio</em></div>
        <div><span className="mono-font">GOING TO A CHARGEBACK · 30 DAYS</span><strong style={sum.toChargeback ? { color:'#991B1B' } : undefined}>{sum.toChargeback}</strong><em className="display-font">let go, already filed, or the window passed</em></div>
        <div><span className="mono-font">ALERTS · 30 DAYS</span><strong>{sum.month}</strong><em className="display-font">{sum.month ? `${Math.round((sum.avoided / sum.month) * 100)}% stopped` : '—'}</em></div>
      </div>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0, padding:'10px 18px' }}>{err}</p>}
      {msg && <p role="status" className="mono-font" style={{ fontSize:'11px', color:'#065F46', margin:0, padding:'10px 18px', borderTop:'1px solid #E7E2D9' }}>{msg}</p>}

      {waiting.length > 0 && <ul style={{ listStyle:'none', margin:0, padding:0 }}>
        {waiting.map(a => {
          const src = SOURCES[a.source], k = clockOf(a), rec = recommend(a, settings), expanded = open === a.id
          const tone = k.late ? 'danger' : k.left != null && k.left < 24 * 3600000 ? 'warn' : 'neutral'
          return (
            <li key={a.id} className="cov-pd-row">
              <div style={{ display:'flex', gap:'12px', alignItems:'flex-start', flexWrap:'wrap' }}>
                <button type="button" onClick={() => setOpen(expanded ? null : a.id)} aria-expanded={expanded} className="cov-pd-main">
                  <span style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
                    <Badge tone="dark">{src.label.toUpperCase()}</Badge>
                    {a.reason !== 'unknown' && <Badge tone={a.reason === 'fraud' ? 'danger' : 'neutral'}>{a.reason === 'fraud' ? 'FRAUD' : 'DISPUTE'}{a.reasonCode ? ` · ${a.reasonCode}` : ''}</Badge>}
                    {a.cbFiled && <Badge tone="danger">ALREADY A CHARGEBACK</Badge>}
                    {k.left != null ? <Badge tone={tone}>{k.late ? `WINDOW PASSED ${left(k.left)} AGO` : `${left(k.left).toUpperCase()} LEFT`}</Badge> : <Badge tone="info">ANSWER NOW</Badge>}
                    {rec && <Badge tone={rec.action === 'refund' ? 'ok' : rec.action === 'answer' ? 'warn' : 'info'}>WE’D {ACT[rec.action].toUpperCase()}</Badge>}
                  </span>
                  <span className="display-font" style={{ display:'block', fontSize:'16px', color:'#1A1814', marginTop:'5px' }}>{money(a.amount, a.currency)} · order {a.orderId || '—'}{a.cardLast4 ? ` · card •••• ${a.cardLast4}` : ''}</span>
                  <span className="mono-font" style={{ display:'block', fontSize:'11px', color:'#6B6259', marginTop:'2px', overflowWrap:'break-word' }}>{a.descriptor || src.network} · {src.network} · received {ago(a.receivedAt)}</span>
                </button>
                {writer && <span style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                  {a.cbFiled
                    ? <Button small disabled={busy} title="The bank already filed: a refund now would pay twice" onClick={() => decide(a, 'acknowledged')}>Acknowledge · answer on Desk</Button>
                    : src.kind === 'lookup'
                    ? <><Button small disabled={busy} onClick={() => decide(a, 'shared')}>Order details shared</Button>
                        <Button small variant="quiet" disabled={busy} onClick={() => setDeclining(declining === a.id ? null : a.id)}>Nothing to share</Button></>
                    : <><Button small variant={rec?.action === 'refund' ? 'primary' : 'secondary'} disabled={busy || k.late} onClick={() => decide(a, 'refunded')}>Refund</Button>
                        <Button small variant="secondary" disabled={busy} onClick={() => decide(a, 'already_refunded')}>Already refunded</Button>
                        <Button small variant="quiet" disabled={busy} onClick={() => setDeclining(declining === a.id ? null : a.id)}>Let it go</Button></>}
                </span>}
              </div>
              {declining === a.id && (
                <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', flexWrap:'wrap', marginTop:'10px' }}>
                  <label className="display-font" style={{ fontSize:'12px', display:'grid', gap:'3px', flex:'1 1 280px' }}>{src.kind === 'lookup' ? 'Why is there nothing to share?' : 'Why let it go to a chargeback?'}
                    <Select value={why} onChange={e => setWhy(e.target.value)} style={{ fontSize:'13px' }}>{DECLINE_REASONS.map(r => <option key={r}>{r}</option>)}</Select>
                  </label>
                  <Button small variant="danger" disabled={busy} onClick={() => decide(a, 'declined', why)}>{src.kind === 'lookup' ? 'Record it' : 'Let it go'}</Button>
                </div>
              )}
              {expanded && (
                <div className="display-font" style={{ fontSize:'14px', color:'#3F3A35', marginTop:'10px', display:'grid', gap:'8px', lineHeight:1.5 }}>
                  <p style={{ margin:0 }}>{a.cbFiled ? 'The bank sent this alert after filing the chargeback. It’s on its way to you through your acquirer, so refunding here won’t stop it.' : src.what}</p>
                  {rec && <p style={{ margin:0, borderLeft:'3px solid ' + (rec.action === 'refund' ? '#065F46' : rec.action === 'answer' ? '#92400E' : '#1E3A5F'), paddingLeft:'10px' }}><strong>We’d {ACT[rec.action].toLowerCase()}.</strong> {rec.why}</p>}
                  <dl className="cov-claim-answers" style={{ fontSize:'13px' }}>
                    <dt style={{ color:'#6B6259' }}>Reason</dt><dd style={{ margin:0 }}>{REASONS[a.reason]}{a.reasonCode ? ` (${a.network} ${a.reasonCode})` : ''}</dd>
                    <dt style={{ color:'#6B6259' }}>Bought</dt><dd style={{ margin:0 }}>{a.transactionAt ? new Date(a.transactionAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'}</dd>
                    {a.respondBy && <><dt style={{ color:'#6B6259' }}>Answer by</dt><dd style={{ margin:0 }}>{new Date(a.respondBy).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}</dd></>}
                    {a.arn && <><dt style={{ color:'#6B6259' }}>ARN</dt><dd className="mono-font" style={{ margin:0, fontSize:'12px' }}>{a.arn}</dd></>}
                    <dt style={{ color:'#6B6259' }}>Provider’s id</dt><dd className="mono-font" style={{ margin:0, fontSize:'12px' }}>{a.externalId} · {a.id}</dd>
                  </dl>
                </div>
              )}
            </li>
          )
        })}
      </ul>}

      {settled.length > 0 && <>
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#6B6259', padding:'14px 18px 6px', borderTop:'1px solid #D4CCBC' }}>SETTLED · LAST 30 DAYS</div>
        <ul style={{ listStyle:'none', margin:0, padding:'0 18px 12px' }}>
          {settled.map(a => {
            const last = a.history?.at(-1)
            return (
              <li key={a.id} className="cov-pd-settled">
                <Badge tone={STATUS_TONE[a.status] || 'neutral'}>{STATUSES[a.status].toUpperCase()}</Badge>
                <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>{money(a.amount, a.currency)} · order {a.orderId || '—'}</span>
                <span className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>{SOURCES[a.source]?.label} · {ago(a.receivedAt)}{last?.by && !['Provider', 'Covalence'].includes(last.by) ? ` · ${last.by}` : ''}{last?.note && !['Received', 'Refunded in time'].includes(last.note) ? ` · ${last.note}` : ''}</span>
              </li>
            )
          })}
        </ul>
      </>}

      {!rows.length && !err && <p className="display-font" style={{ margin:0, padding:'16px 18px', fontSize:'14px', color:'#57534E' }}>No alerts yet. Your systems send them to <code>/api/intake</code> as <code>{'{ "preDispute": [ … ] }'}</code> (see For your developers under Connections).</p>}
    </section>
  )
}

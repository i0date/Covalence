// ═══════════════════════════════════════════════════════════════════════════════
// 314(b) INFORMATION SHARING — Settings → Financial crime, and every Duo session
// ═══════════════════════════════════════════════════════════════════════════════
// Section 314(b) gives institutions a safe harbor for sharing information to
// identify and report possible money laundering or terrorist financing, when
// both are registered with FinCEN (one year at a time) and share for that
// purpose. Admins record the registration here; each Duo session shows whether
// both sides are covered, asks once why the institution is sharing, and keeps a
// record of every share (supabase_314b.sql — enforced in the database).
import React, { useEffect, useState } from 'react'
import { sharingGet, sharingSet, duoSharingStatus, duoShareConfirm } from './data.js'
import { Button, Input } from './ui.jsx'

const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px' }
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 12px', fontWeight:500 }}>{children}</h2>
const day = d => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'
const when = ts => ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''
const daysLeft = d => d ? Math.ceil((new Date(d + 'T23:59:59') - Date.now()) / 86400000) : null

export const PURPOSES = [
  'Identify and report possible money laundering',
  'Identify and report possible terrorist financing',
  'Fraud that may involve money laundering (e.g. scam proceeds moving through accounts)',
]

// ── Settings → Financial crime ───────────────────────────────────────────────
export function SharingSettings({ admin }) {
  const [v, setV] = useState(undefined), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false)
  const load = () => sharingGet().then(r => setV(r || { registered: false, expires_on: '', contact_name: '', contact_email: '', require_both: false })).catch(e => { setV(null); setMsg({ err: e.message }) })
  useEffect(() => { load() }, [])
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await sharingSet(v); await load(); setMsg({ ok: 'Saved.' }) } catch (e) { setMsg({ err: e.message }) } finally { setBusy(false) }
  }
  const up = (k, x) => setV(o => ({ ...o, [k]: x }))
  const left = v?.registered ? daysLeft(v.expires_on) : null

  return (
    <section style={box}>
      <H2>INFORMATION SHARING — 314(b)</H2>
      <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 12px' }}>
        Duo sessions share case details with another institution. Under Section 314(b) that sharing has a safe harbor when <strong>both</strong> institutions are registered with FinCEN and share to identify and report possible money laundering or terrorist financing. Each Duo session shows whether both sides are covered and keeps a record of every share.
      </p>
      {v === undefined ? <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}>Loading…</p> : v === null ? null : (<>
        {v.registered && left != null && (
          <p role="status" className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.06em', margin:'0 0 12px', color: left <= 30 ? '#92400E' : '#065F46' }}>
            {left <= 30 ? `⚠ REGISTRATION EXPIRES IN ${left} DAY${left === 1 ? '' : 'S'} — renew with FinCEN, then update the date here` : `● REGISTERED UNTIL ${day(v.expires_on).toUpperCase()}`}
          </p>
        )}
        <fieldset disabled={!admin || busy} style={{ border:0, padding:0, margin:0, display:'grid', gap:'10px', opacity: admin ? 1 : 0.75 }}>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', cursor:'pointer' }}>
            <input type="checkbox" checked={!!v.registered} onChange={e => up('registered', e.target.checked)} /> We’re registered with FinCEN for 314(b)
          </label>
          {v.registered && (<>
            <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px', maxWidth:'220px' }}>Registration expires
              <Input type="date" value={v.expires_on || ''} onChange={e => up('expires_on', e.target.value)} aria-label="Registration expires" style={{ padding:'6px 8px', fontSize:'14px' }} />
            </label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'10px' }}>
              <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>Point of contact
                <Input value={v.contact_name || ''} onChange={e => up('contact_name', e.target.value)} placeholder="BSA Officer’s name" aria-label="Point of contact" style={{ padding:'6px 8px', fontSize:'14px' }} />
              </label>
              <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>Contact email
                <Input type="email" value={v.contact_email || ''} onChange={e => up('contact_email', e.target.value)} placeholder="bsa@yourbank.com" aria-label="Contact email" style={{ padding:'6px 8px', fontSize:'14px' }} />
              </label>
            </div>
          </>)}
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'flex-start', cursor:'pointer' }}>
            <input type="checkbox" checked={!!v.require_both} onChange={e => up('require_both', e.target.checked)} style={{ marginTop:'4px' }} />
            <span>Only share in Duo when both sides are registered <span style={{ display:'block', fontSize:'12px', color:'#6B6259' }}>Otherwise analysts see a warning and can still share; each share is recorded as covered or not.</span></span>
          </label>
          {admin && <div><Button disabled={busy} onClick={save}>Save</Button></div>}
        </fieldset>
        {!admin && <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259', margin:'10px 0 0' }}>Admins record the registration.</p>}
        <p className="display-font" style={{ fontSize:'12px', color:'#6B6259', lineHeight:1.5, margin:'10px 0 0' }}>
          Registration is as stated by each institution’s admin; confirm the other side on FinCEN’s 314(b) participant list when it matters. The safe harbor doesn’t cover sharing for other purposes, and it doesn’t replace filing a SAR.
        </p>
      </>)}
      {msg && <p role={msg.err ? 'alert' : 'status'} className="mono-font" style={{ fontSize:'11px', color: msg.err ? '#991B1B' : '#065F46', margin:'10px 0 0' }}>{msg.err || msg.ok}</p>}
    </section>
  )
}

// ── Duo session: both sides' registration, the purpose, the sharing record ─────
export function useDuoSharing(sessionId, joined) {
  const [st, setSt] = useState(undefined)
  const reload = () => sessionId ? duoSharingStatus(sessionId).then(r => setSt(r || null)).catch(() => setSt(null)) : setSt(null)
  useEffect(() => { reload() }, [sessionId, joined])
  return [st, reload]
}

function Side({ s, label }) {
  if (!s) return (
    <div style={{ flex:'1 1 200px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.1em', color:'#78716C' }}>{label}</div>
      <div className="display-font" style={{ fontSize:'13px', color:'#78716C' }}>Not joined yet</div>
    </div>
  )
  return (
    <div style={{ flex:'1 1 200px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.1em', color:'#78716C' }}>{label} · {s.institution}</div>
      <div className="display-font" style={{ fontSize:'13px', color: s.valid ? '#065F46' : '#92400E' }}>
        {s.valid ? `● Registered until ${day(s.expires_on)}` : s.registered ? `Registration expired ${day(s.expires_on)}` : 'No 314(b) registration recorded'}
      </div>
      {s.valid && s.contact_email && <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', overflowWrap:'anywhere' }}>Contact: {s.contact_name} · {s.contact_email}</div>}
    </div>
  )
}

export function DuoSharingBar({ st, myRole }) {
  const [open, setOpen] = useState(false)
  if (!st) return null
  const mine = myRole === 'b' ? st.b : st.a, theirs = myRole === 'b' ? st.a : st.b
  const tone = st.safe_harbor ? { c:'#065F46', bg:'#ECFDF5', b:'#6EE7B7' } : { c:'#92400E', bg:'#FEF3C7', b:'#FCD34D' }
  const why = st.safe_harbor ? null : !theirs ? 'The other institution hasn’t joined, so coverage can’t be checked yet.'
    : !mine?.valid ? 'Your institution has no current 314(b) registration (Settings → Financial crime).'
    : `${theirs.institution} has no current 314(b) registration recorded.`
  const KIND = { purpose: 'Purpose confirmed', message: 'Shared a message', status: 'Changed the status' }
  return (
    <div className="mb-6" style={{ border:`1px solid ${tone.b}`, background: tone.bg, padding:'12px 14px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', marginBottom:'8px' }}>
        <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color: tone.c, fontWeight:600 }}>
          {st.safe_harbor ? '314(b) SAFE HARBOR — BOTH SIDES REGISTERED' : '314(b) — NOT COVERED'}
        </span>
        {!st.safe_harbor && <span className="display-font" style={{ fontSize:'13px', color:'#78350F' }}>{why}{st.require_both ? ' Your institution only shares when both sides are covered.' : ' Share only what you could share without the safe harbor.'}</span>}
      </div>
      <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
        <Side s={mine} label="YOU" /><Side s={theirs} label="THEM" />
      </div>
      {st.purpose && <div className="display-font" style={{ fontSize:'12px', color:'#3F3A35', marginTop:'8px' }}>Purpose: {st.purpose.text} <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }}>— {st.purpose.by || 'your team'}, {when(st.purpose.at)}</span></div>}
      {st.log?.length > 0 && (
        <div style={{ marginTop:'8px' }}>
          <button type="button" onClick={() => setOpen(o => !o)} className="mono-font" aria-expanded={open}
            style={{ fontSize:'10px', letterSpacing:'0.1em', background:'transparent', border:0, padding:0, color:'#57534E', cursor:'pointer', textDecoration:'underline' }}>
            {open ? 'HIDE' : 'SHOW'} SHARING RECORD ({st.log.length})
          </button>
          {open && (
            <ul style={{ listStyle:'none', margin:'8px 0 0', padding:0, display:'grid', gap:'4px' }}>
              {st.log.map((l, i) => (
                <li key={i} className="mono-font" style={{ fontSize:'10px', color:'#3F3A35', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  <span style={{ color:'#6B6259' }}>{when(l.at)}</span>
                  <span>{l.by || 'Your team'} · {KIND[l.kind] || l.kind}{l.kind === 'status' && l.detail?.to ? ` → ${String(l.detail.to).replace(/_/g, ' ')}` : ''}</span>
                  <span style={{ color: l.safe_harbor ? '#065F46' : '#92400E' }}>{l.safe_harbor ? '314(b) covered' : 'not covered'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Shown in place of POST ENTRY until this institution has said why it is sharing
export function SharingPurpose({ sessionId, onDone, disabled }) {
  const [pick, setPick] = useState(PURPOSES[2]), [note, setNote] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true); setErr('')
    try { await duoShareConfirm(sessionId, note.trim() ? `${pick} — ${note.trim()}` : pick); await onDone() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div style={{ border:'1px solid #C8C0B0', background:'#FAF7F1', padding:'12px 14px', marginTop:'8px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', marginBottom:'6px' }}>BEFORE YOU SHARE — WHY IS YOUR INSTITUTION SHARING?</div>
      <div role="radiogroup" aria-label="Purpose of sharing" style={{ display:'grid', gap:'4px' }}>
        {PURPOSES.map(p => (
          <label key={p} className="display-font" style={{ fontSize:'13px', display:'flex', gap:'8px', alignItems:'flex-start', cursor:'pointer' }}>
            <input type="radio" name={`purpose-${sessionId}`} checked={pick === p} onChange={() => setPick(p)} style={{ marginTop:'4px' }} /> {p}
          </label>
        ))}
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional: what you suspect, in a few words" aria-label="Purpose detail"
        style={{ marginTop:'8px', padding:'6px 8px', fontSize:'13px', width:'100%', boxSizing:'border-box' }} />
      <div style={{ display:'flex', gap:'10px', alignItems:'center', marginTop:'8px', flexWrap:'wrap' }}>
        <Button disabled={busy || disabled} onClick={confirm}>{busy ? 'Saving…' : 'Confirm and continue'}</Button>
        <span className="display-font" style={{ fontSize:'12px', color:'#6B6259' }}>Asked once per session; it goes on the sharing record and the audit log.</span>
      </div>
      {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:'6px 0 0' }}>{err}</p>}
    </div>
  )
}

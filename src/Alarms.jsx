// ═══════════════════════════════════════════════════════════════════════════════
// SOUND THE ALARM — the header button, the banner everyone sees, and the dialog
// ═══════════════════════════════════════════════════════════════════════════════
// One open alarm per institution (alarmData.js, supabase_alarms.sql). The banner
// names the level, the owner, what to do now and when the next update is due, so
// nobody has to guess how worried to be. Level 2 and 3 open a Trio incident with
// the matching playbook; only level 3 is red.
import React, { useEffect, useState } from 'react'
import { LEVELS, alarmList, alarmRaise, alarmUpdate } from './alarmData.js'
import { listTeam } from './auth.js'
import { demoRpc } from './demoBackend.js'
import { Button, Input } from './ui.jsx'
import { typesFor } from './trioPlaybooks.mjs'
import { doesIssuing } from './sides.mjs'

const openDialog = () => window.dispatchEvent(new Event('cov:alarm-open'))
const time = ts => ts ? new Date(ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : ''
const mins = ts => ts ? Math.round((new Date(ts) - Date.now()) / 60000) : null
const dueText = ts => { const m = mins(ts); if (m == null) return ''; return m < 0 ? `next update ${-m} min overdue` : `next update ${time(ts)} (in ${m} min)` }

function useAlarms(enabled) {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!enabled) return
    const load = () => alarmList().then(setList).catch(() => setList([]))
    load(); const t = setInterval(load, 30000)
    window.addEventListener('cov:alarm-changed', load)
    return () => { clearInterval(t); window.removeEventListener('cov:alarm-changed', load) }
  }, [enabled])
  return list
}
const signedInOrDemo = u => !!(u?.authed || u?.demo)

// Ask 008 Trio to open an incident for this alarm (Trio is always mounted)
function openTrioIncident(a) {
  return new Promise(resolve => {
    const sev = { 1: 'MEDIUM', 2: 'HIGH', 3: 'CRITICAL' }[a.level]
    window.dispatchEvent(new CustomEvent('cov:trio-create', { detail: { name: a.title, severity: sev, type: a.kind || 'other', description: `Opened from a level ${a.level} alarm. ${a.do_now || ''}`.trim(), alarmId: a.id, reply: resolve } }))
    setTimeout(() => resolve(null), 1500)
  })
}

export function AlarmButton({ covUser }) {
  const open = useAlarms(signedInOrDemo(covUser)).find(a => a.status === 'open')
  if (!signedInOrDemo(covUser)) return null
  const L = open ? LEVELS[open.level] : null
  return (
    <button onClick={openDialog} title={open ? `Level ${open.level} alarm open — ${open.title}` : 'Sound the alarm'} aria-label={open ? `Level ${open.level} alarm open` : 'Sound the alarm'}
      className="mono-font cov-nav-icon" style={{ display:'inline-flex', alignItems:'center', gap:'6px', background: L ? L.bg : '#232019', color: L ? L.color : '#D6CFC4',
        border:`1px solid ${L ? L.border : '#3D3A35'}`, padding:'5px 9px', cursor:'pointer', fontSize:'10px', letterSpacing:'0.12em', whiteSpace:'nowrap' }}>
      <span aria-hidden="true">⚑</span><span className="desktop-only">{open ? `LEVEL ${open.level}` : 'ALARM'}</span>
    </button>
  )
}

export function AlarmBanner({ covUser }) {
  const open = useAlarms(signedInOrDemo(covUser)).find(a => a.status === 'open')
  if (!open) return null
  const L = LEVELS[open.level], late = (mins(open.next_update_at) ?? 1) < 0
  return (
    <div role="status" aria-live="polite" className="mono-font" style={{ background: L.bg, color: L.color, borderBottom:`1px solid ${L.border}`, fontSize:'11px', letterSpacing:'0.04em', padding:'8px 24px', display:'flex', gap:'14px', alignItems:'center', flexWrap:'wrap' }}>
      <strong style={{ letterSpacing:'0.12em' }}>⚑ LEVEL {open.level} · {L.name.toUpperCase()}</strong>
      <span className="display-font" style={{ fontSize:'14px', letterSpacing:0 }}>{open.title}</span>
      <span>Owner: {open.owner_name || '—'}</span>
      {open.do_now && <span>Do now: {open.do_now}</span>}
      <span style={{ fontWeight: late ? 700 : 400 }}>{dueText(open.next_update_at)}</span>
      {open.reports?.length > 1 && <span>{open.reports.length} reports</span>}
      <button onClick={openDialog} className="mono-font" style={{ marginLeft:'auto', background:'none', border:`1px solid ${L.color}`, color: L.color, padding:'3px 10px', cursor:'pointer', fontSize:'10px', letterSpacing:'0.12em' }}>DETAILS</button>
    </div>
  )
}

export function AlarmDialog({ covUser, sides = ['issuer'] }) {
  const [shown, setShown] = useState(false)
  const list = useAlarms(signedInOrDemo(covUser))
  const open = list.find(a => a.status === 'open')
  const [f, setF] = useState({ level: 1, title: '', doNow: '', next: 30, confirmed: false, note: '', owner: '', kind: 'other' })
  const [team, setTeam] = useState([]), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [mode, setMode] = useState('view')
  const canConfigure = ['admin', 'reviewer'].includes(covUser?.role), readOnly = covUser?.role === 'auditor'
  useEffect(() => { const h = () => { setShown(true); setErr(''); setMode('view') }; window.addEventListener('cov:alarm-open', h); return () => window.removeEventListener('cov:alarm-open', h) }, [])
  useEffect(() => { if (shown && signedInOrDemo(covUser)) (covUser?.authed ? listTeam() : demoRpc('list_team')).then(t => setTeam(t || [])).catch(() => setTeam([])) }, [shown])
  useEffect(() => { if (!shown) return; const k = e => { if (e.key === 'Escape') setShown(false) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [shown])
  if (!shown) return null
  const up = (k, v) => setF(o => ({ ...o, [k]: v }))
  const run = async fn => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const needConfirm = lvl => lvl === 3 && !canConfigure

  const raise = () => run(async () => {
    const r = await alarmRaise({ level: f.level, title: f.title, doNow: f.doNow, nextMinutes: f.next, confirmed: f.confirmed })
    if (!r.joined && r.level >= 2) { const id = await openTrioIncident({ id: r.id, level: r.level, title: f.title, do_now: f.doNow, kind: f.kind }); if (id) await alarmUpdate(r.id, 'incident', { incidentId: id }) }
    setF({ level: 1, title: '', doNow: '', next: 30, confirmed: false, note: '', owner: '', kind: 'other' }); setShown(false)
  })
  const LevelPicker = ({ value, onPick }) => (
    <div role="radiogroup" aria-label="Level" style={{ display:'grid', gap:'6px' }}>
      {[1, 2, 3].map(n => { const L = LEVELS[n], on = value === n; return (
        <label key={n} style={{ display:'flex', gap:'10px', alignItems:'flex-start', padding:'8px 10px', cursor:'pointer', border:`1px solid ${on ? L.border : '#D4CCBC'}`, background: on ? L.bg : '#FFFFFF', color: on ? L.color : '#1A1814' }}>
          <input type="radio" name="alarm-level" checked={on} onChange={() => onPick(n)} style={{ marginTop:'3px' }} />
          <span><span className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.12em', fontWeight:700 }}>{n} · {L.name.toUpperCase()}</span>
            <span className="display-font" style={{ display:'block', fontSize:'13px' }}>{L.meaning}. Who’s told: {L.told}.</span></span>
        </label>) })}
    </div>
  )

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9500, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'60px 16px', overflowY:'auto' }}>
      <div onClick={() => setShown(false)} style={{ position:'absolute', inset:0, background:'rgba(26,24,20,0.5)' }} />
      <div role="dialog" aria-label={open ? 'Open alarm' : 'Sound the alarm'} style={{ position:'relative', width:'min(560px, 100%)', background:'#F5F1EA', border:'2px solid #1A1814', padding:'20px 22px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <span className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.16em', color:'#57534E' }}>⚑ {open ? 'OPEN ALARM' : 'SOUND THE ALARM'}</span>
          <button onClick={() => setShown(false)} aria-label="Close" style={{ background:'none', border:0, fontSize:'16px', cursor:'pointer', color:'#57534E' }}>✕</button>
        </div>

        {!open ? (<>
          <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.5, margin:'0 0 12px' }}>For a fraud wave or an attack that the whole team should know about. Pick the level that matches what you know now; it can go up or down later.</p>
          <LevelPicker value={f.level} onPick={n => up('level', n)} />
          <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px', marginTop:'12px' }}>What’s happening?
            <Input value={f.title} onChange={e => up('title', e.target.value)} placeholder="e.g. Card-testing attack on the checkout — 400 declines in 20 min" style={{ padding:'7px 9px', fontSize:'14px' }} />
          </label>
          <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px', marginTop:'10px' }}>What should people do now?
            <Input value={f.doNow} onChange={e => up('doNow', e.target.value)} placeholder="e.g. Hold manual approvals on new cards; don’t contact customers yet" style={{ padding:'7px 9px', fontSize:'14px' }} />
          </label>
          {f.level >= 2 && <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'8px', alignItems:'center', marginTop:'10px', flexWrap:'wrap' }}>Kind of incident
            <select className="cov-input" value={f.kind} onChange={e => up('kind', e.target.value)} style={{ padding:'5px 8px', fontSize:'13px', maxWidth:'100%' }}>
              {typesFor(!doesIssuing(sides)).map(([v, t]) => <option key={v} value={v}>{t.label}</option>)}
            </select>
            <span style={{ fontSize:'12px', color:'#6B6259' }}>Its Trio incident starts with this playbook.</span>
          </label>}
          <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'8px', alignItems:'center', marginTop:'10px' }}>Next update in
            <select className="cov-input" value={f.next} onChange={e => up('next', Number(e.target.value))} style={{ padding:'5px 8px', fontSize:'13px' }}>{[15, 30, 60, 120].map(m => <option key={m} value={m}>{m} minutes</option>)}</select>
          </label>
          {needConfirm(f.level) && <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'8px', alignItems:'flex-start', marginTop:'10px', color:'#7F1D1D' }}>
            <input type="checkbox" checked={f.confirmed} onChange={e => up('confirmed', e.target.checked)} style={{ marginTop:'3px' }} /> This is an active attack with real losses. Everyone, including leadership, will be told.
          </label>}
          <div style={{ display:'flex', gap:'8px', marginTop:'14px', alignItems:'center', flexWrap:'wrap' }}>
            <Button disabled={readOnly || busy || !f.title.trim() || (needConfirm(f.level) && !f.confirmed)} onClick={raise}>{busy ? 'Raising…' : `Raise level ${f.level}`}</Button>
            <span className="display-font" style={{ fontSize:'12px', color:'#6B6259' }}>You’ll be the owner; you can hand it over.</span>
          </div>
        </>) : (<>
          <div style={{ background: LEVELS[open.level].bg, color: LEVELS[open.level].color, border:`1px solid ${LEVELS[open.level].border}`, padding:'10px 12px' }}>
            <div className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.12em', fontWeight:700 }}>LEVEL {open.level} · {LEVELS[open.level].name.toUpperCase()} — {LEVELS[open.level].meaning.toLowerCase()}</div>
            <div className="display-font" style={{ fontSize:'17px', marginTop:'2px' }}>{open.title}</div>
          </div>
          <dl className="display-font" style={{ fontSize:'13px', color:'#3F3A35', display:'grid', gridTemplateColumns:'max-content 1fr', gap:'4px 12px', margin:'12px 0' }}>
            <dt style={{ color:'#78716C' }}>Owner</dt><dd style={{ margin:0 }}>{open.owner_name || '—'}</dd>
            <dt style={{ color:'#78716C' }}>Do now</dt><dd style={{ margin:0 }}>{open.do_now || '—'}</dd>
            <dt style={{ color:'#78716C' }}>Next update</dt><dd style={{ margin:0 }}>{dueText(open.next_update_at)}</dd>
            <dt style={{ color:'#78716C' }}>Raised</dt><dd style={{ margin:0 }}>{time(open.raised_at)} by {open.reports?.[0]?.by || '—'}</dd>
            {open.incident_id && <><dt style={{ color:'#78716C' }}>Incident</dt><dd style={{ margin:0 }}><button onClick={() => { window.dispatchEvent(new CustomEvent('cov:go', { detail: { section: 'trio' } })); setShown(false) }} className="mono-font" style={{ background:'none', border:0, padding:0, textDecoration:'underline', cursor:'pointer', fontSize:'12px' }}>{open.incident_id} in 008 Trio</button></dd></>}
          </dl>
          {open.reports?.length > 1 && <ul style={{ margin:'0 0 12px', padding:'0 0 0 16px' }}>{open.reports.slice(1).map((r, i) => <li key={i} className="display-font" style={{ fontSize:'12px', color:'#57534E' }}>{time(r.at)} · {r.by} (level {r.level}): {r.note}</li>)}</ul>}

          {!readOnly && mode === 'view' && <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <Button small onClick={() => { setF(o => ({ ...o, level: open.level, note: '', confirmed: false })); setMode('report') }}>Add my report</Button>
            <Button small variant="secondary" onClick={() => { setF(o => ({ ...o, level: open.level, confirmed: false })); setMode('level') }}>Change level</Button>
            <Button small variant="secondary" onClick={() => { setF(o => ({ ...o, doNow: open.do_now, next: 30, owner: open.owner_email })); setMode('update') }}>Post an update</Button>
            <Button small variant="quiet" onClick={() => { setF(o => ({ ...o, note: '' })); setMode('stand') }}>Stand down</Button>
          </div>}
          {mode === 'report' && (<>
            <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>What you’re seeing
              <Input value={f.note} onChange={e => up('note', e.target.value)} placeholder="e.g. Same BIN range hitting the mobile app too" style={{ padding:'7px 9px', fontSize:'14px' }} />
            </label>
            <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}><Button small disabled={busy || !f.note.trim()} onClick={() => run(async () => { await alarmRaise({ level: open.level, title: f.note, nextMinutes: 30 }); setMode('view') })}>Add to this alarm</Button><Button variant="quiet" onClick={() => setMode('view')}>Cancel</Button></div>
          </>)}
          {mode === 'level' && (<>
            <LevelPicker value={f.level} onPick={n => up('level', n)} />
            {needConfirm(f.level) && <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'8px', marginTop:'8px', color:'#7F1D1D' }}><input type="checkbox" checked={f.confirmed} onChange={e => up('confirmed', e.target.checked)} /> This is an active attack with real losses.</label>}
            <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}><Button small disabled={busy || f.level === open.level || (needConfirm(f.level) && !f.confirmed)} onClick={() => run(async () => {
              await alarmUpdate(open.id, 'level', { level: f.level, confirmed: f.confirmed })
              if (f.level >= 2 && !open.incident_id) { const id = await openTrioIncident({ ...open, level: f.level }); if (id) await alarmUpdate(open.id, 'incident', { incidentId: id }) }
              setMode('view') })}>Set level {f.level}</Button><Button variant="quiet" onClick={() => setMode('view')}>Cancel</Button></div>
          </>)}
          {mode === 'update' && (<>
            <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>Do now
              <Input value={f.doNow} onChange={e => up('doNow', e.target.value)} style={{ padding:'7px 9px', fontSize:'14px' }} />
            </label>
            <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginTop:'8px' }}>
              <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'6px', alignItems:'center' }}>Owner
                <select className="cov-input" value={f.owner} onChange={e => up('owner', e.target.value)} style={{ padding:'5px 8px', fontSize:'13px' }}>
                  {team.map(m => <option key={m.email} value={m.email}>{m.display_name || m.email}</option>)}{!team.some(m => m.email === f.owner) && <option value={f.owner}>{open.owner_name}</option>}
                </select></label>
              <label className="display-font" style={{ fontSize:'13px', display:'flex', gap:'6px', alignItems:'center' }}>Next update in
                <select className="cov-input" value={f.next} onChange={e => up('next', Number(e.target.value))} style={{ padding:'5px 8px', fontSize:'13px' }}>{[15, 30, 60, 120].map(m => <option key={m} value={m}>{m} min</option>)}</select></label>
            </div>
            <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}><Button small disabled={busy} onClick={() => run(async () => { await alarmUpdate(open.id, 'update', { doNow: f.doNow, nextMinutes: f.next, ownerEmail: f.owner !== open.owner_email ? f.owner : null }); setMode('view') })}>Post update</Button><Button variant="quiet" onClick={() => setMode('view')}>Cancel</Button></div>
          </>)}
          {mode === 'stand' && (<>
            <label className="display-font" style={{ fontSize:'13px', display:'grid', gap:'4px' }}>How it ended
              <Input value={f.note} onChange={e => up('note', e.target.value)} placeholder="e.g. Attack blocked at 2:40 PM; 12 cards reissued" style={{ padding:'7px 9px', fontSize:'14px' }} />
            </label>
            <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}><Button small disabled={busy} onClick={() => run(async () => { await alarmUpdate(open.id, 'stand_down', { note: f.note }); setShown(false) })}>Stand down</Button><Button variant="quiet" onClick={() => setMode('view')}>Cancel</Button></div>
          </>)}
        </>)}
        {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:'10px 0 0' }}>{err}</p>}
        {list.filter(a => a.status !== 'open').length > 0 && !open && (
          <details style={{ marginTop:'14px' }}><summary className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E', cursor:'pointer' }}>RECENT ALARMS</summary>
            <ul style={{ margin:'6px 0 0', padding:'0 0 0 16px' }}>{list.filter(a => a.status !== 'open').map(a => <li key={a.id} className="display-font" style={{ fontSize:'12px', color:'#57534E' }}>Level {a.level} · {a.title} — stood down {time(a.stood_down_at)}{a.stand_down_note ? `: ${a.stand_down_note}` : ''}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  )
}

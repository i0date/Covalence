// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW — runs the institution's rules in the app, and the reminders bell
// ═══════════════════════════════════════════════════════════════════════════════
// The rules themselves (SLA clocks, auto-assignment, escalation, who gets
// reminded) live in clocks.mjs so the daily email uses the same ones. Here they
// are applied to the case pool whenever it changes and once a minute (clocks
// cross into "breached" with nobody touching the case). Every browser computes
// the same result, so two people online at once can't assign a case twice.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listTeam, canWrite } from './auth.js'
import { auditWrite } from './audit.js'
import { openCase } from './CaseThread.jsx'
import { workflowChanges, applyChanges, remindersFor, CLOSED_STATUSES } from './clocks.mjs'
import { screenCase, screeningKey, subjectsOf, walletsOf, amlIndex, amlSignals, needsSarReview } from './fincrime.js'

export const WORKFLOW_RUN_EVENT = 'cov:workflow-run'   // Settings → "Apply to existing cases"

export function useTeam(covUser) {
  const [team, setTeam] = useState([])
  useEffect(() => {
    if (!covUser) return
    let live = true
    const load = () => listTeam().then(t => { if (live) setTeam(t || []) }).catch(() => {})
    load()
    const iv = setInterval(load, 5 * 60000)
    window.addEventListener('cov:team-changed', load)
    return () => { live = false; clearInterval(iv); window.removeEventListener('cov:team-changed', load) }
  }, [covUser?.email, covUser?.institutionId, covUser?.role])
  return team
}

export function useWorkflow({ outcomes, setOutcomes, settings, covUser, team }) {
  const [tick, setTick] = useState(0)
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(iv) }, [])

  const me = covUser?.email   // covUser is rebuilt every render; depend on the email only
  const run = useCallback((opts = {}) => {
    if (!me || !canWrite()) return 0
    const changes = workflowChanges(outcomes, settings, team, new Date(), opts)
    if (!changes.length) return 0
    setOutcomes(prev => applyChanges(prev, changes))
    changes.forEach(ch => ch.audit.forEach(([action, detail]) => auditWrite(action, 'case', ch.id, detail)))
    return changes.length
  }, [outcomes, settings, team, me])

  useEffect(() => { run() }, [run, tick])
  useEffect(() => {
    const h = e => { const n = run({ backlog: true }); e.detail?.done?.(n) }
    window.addEventListener(WORKFLOW_RUN_EVENT, h)
    return () => window.removeEventListener(WORKFLOW_RUN_EVENT, h)
  }, [run])
}

// ── Financial crime: screen new or changed cases, flag cases for SAR review ──
// Screening runs a few cases a minute against OFAC (api/sanctions.js), so a
// big import is worked through in the background. AML flags are rules over the
// whole pool (fincrime.js); a flag starts the 30-day SAR clock.
export function useFincrime({ outcomes, setOutcomes, settings, covUser }) {
  const me = covUser?.email
  const busy = useRef(new Set())
  const [tick, setTick] = useState(0)
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(iv) }, [])
  const open = c => !CLOSED_STATUSES.includes(c.status) && !c._triageOnly

  // Sanctions screening — up to 4 cases per pass
  useEffect(() => {
    if (!me || !canWrite() || settings?.screeningAuto === false) return
    const due = outcomes.filter(c => open(c) && !busy.current.has(c.id) && (subjectsOf(c).length || walletsOf(c).length)
      && (!c.screening || c.screening.key !== screeningKey(c))).slice(0, 4)
    due.forEach(c => {
      busy.current.add(c.id)
      screenCase(c, settings, 'Automatic').then(rec => {
        setOutcomes(prev => prev.map(o => o.id === c.id ? { ...o, screening: rec, screenings: [...(o.screenings || []), ...(o.screening ? [o.screening] : [])].slice(-5) } : o))
        auditWrite('sanctions.screened', 'case', c.id, { status: rec.status, hits: rec.hits.length, list: rec.list?.fetchedAt || '' })
      }).catch(() => {}).finally(() => setTimeout(() => busy.current.delete(c.id), 30000))
    })
  }, [outcomes, settings?.screeningAuto, settings?.screeningThreshold, me, tick])

  // AML: flag open cases whose signals reach "medium" for SAR review
  useEffect(() => {
    if (!me || !canWrite()) return
    const ix = amlIndex(outcomes), now = new Date().toISOString()
    const flags = []
    outcomes.forEach(c => {
      if (!open(c) || c.sarReview) return
      const a = amlSignals(c, outcomes, settings, ix)
      if (needsSarReview(a)) flags.push([c.id, { flaggedAt: now, level: a.level, signals: a.signals.map(x => x.key) }])
    })
    if (!flags.length) return
    const byId = new Map(flags)
    setOutcomes(prev => prev.map(o => byId.has(o.id) && !o.sarReview ? { ...o, sarReview: byId.get(o.id) } : o))
    flags.forEach(([id, f]) => auditWrite('aml.flagged', 'case', id, { level: f.level, signals: f.signals.join(', ') }))
  }, [outcomes, settings?.sarThreshold, settings?.sarThresholdCrypto, me])
}

// ── Reminders bell ───────────────────────────────────────────────────────────
const SEEN_KEY = 'cov_reminders_seen'   // per browser: which reminders this person has looked at
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const LINE = {
  due: i => `${i.clock.label}: ${i.clock.text}`,
  escalated: i => `Escalated to you — ${i.c.escalationReason || 'needs review'}`,
  assigned: i => `Assigned to you${i.c.assignedBy === 'auto' ? ' automatically' : ''}`,
}
const TONE = i => i.kind === 'due' ? (i.clock.state === 'breached' ? '#FCA5A5' : '#FCD34D') : i.kind === 'escalated' ? '#FCA5A5' : '#93C5FD'

export function RemindersBell({ cases, covUser, settings }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(readSeen)
  const [, setTick] = useState(0)
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(iv) }, [])
  const items = remindersFor(cases, covUser?.email, settings)
  const unseen = items.filter(i => !seen.has(i.key)).length
  const ref = useRef(null), panelRef = useRef(null)
  // The top bar scrolls sideways (and so clips), so the panel is portalled and placed under the bell
  const [pos, setPos] = useState(null)
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect(); if (!r) return
      const right = Math.max(16, window.innerWidth - r.right)
      // Narrow screens: full width with a 16px gutter
      setPos(window.innerWidth - right - 360 < 16 ? { top: r.bottom + 8, left: 16, right: 16 } : { top: r.bottom + 8, right })
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const markAll = () => {
    // Keep only keys that are still live, so the list doesn't grow forever
    const next = new Set(items.map(i => i.key))
    setSeen(next); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next])) } catch {}
  }
  if (!covUser) return null
  return (
    <div ref={ref} style={{ position:'relative', flexShrink:0 }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unseen ? `Reminders: ${unseen} new` : 'Reminders'} title="Reminders" className="mono-font"
        style={{ background:'none', border:'1px solid #3D3A35', color: unseen ? '#F5F1EA' : '#A8A29E', padding:'4px 8px', cursor:'pointer',
          fontSize:'11px', display:'flex', alignItems:'center', gap:'5px', lineHeight:1.2 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        {unseen > 0 && <span style={{ background:'#B91C1C', color:'#FEF2F2', padding:'0 5px', fontSize:'10px', fontWeight:600 }}>{unseen}</span>}
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} role="dialog" aria-label="Reminders" className="cov-reminders"
          style={{ position:'fixed', right:pos.right, left:pos.left, top:pos.top, width: pos.left != null ? 'auto' : '360px', maxHeight:'70vh', overflowY:'auto',
            background:'#1A1814', border:'1px solid #3D3A35', zIndex:9500, boxShadow:'0 12px 32px rgba(0,0,0,0.35)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderBottom:'1px solid #3D3A35' }}>
            <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#D6D3D1' }}>REMINDERS</span>
            {unseen > 0 && <button onClick={markAll} className="mono-font" style={{ background:'none', border:'none', color:'#A8A29E', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer', textDecoration:'underline' }}>Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <div className="display-font" style={{ padding:'16px 14px', fontSize:'14px', color:'#D6D3D1', fontStyle:'italic' }}>Nothing due on your cases.</div>
          ) : items.map(i => (
            <button key={i.key} onClick={() => { setOpen(false); openCase(i.c.id) }}
              style={{ display:'block', width:'100%', textAlign:'left', background: seen.has(i.key) ? 'none' : 'rgba(245,241,234,0.05)', border:'none',
                borderBottom:'1px solid #2A2722', padding:'10px 14px', cursor:'pointer' }}>
              <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E', display:'flex', gap:'8px' }}>
                {!seen.has(i.key) && <span aria-label="new" style={{ color:TONE(i) }}>●</span>}
                <span>{i.c.id}</span><span style={{ marginLeft:'auto' }}>{i.c.amount || ''}</span>
              </div>
              <div className="display-font" style={{ fontSize:'14px', color:'#F5F1EA', margin:'2px 0' }}>{i.c.merchant || '—'}</div>
              <div className="mono-font" style={{ fontSize:'11px', color:TONE(i) }}>{LINE[i.kind](i)}</div>
            </button>
          ))}
          <div className="mono-font" style={{ fontSize:'10px', color:'#A39A8F', padding:'10px 14px', lineHeight:1.5 }}>
            {settings?.emailReminders ? 'Your institution also emails these each weekday morning.' : 'Admins can turn on a daily email in Settings → Workflow.'}
          </div>
        </div>, document.body
      )}
    </div>
  )
}

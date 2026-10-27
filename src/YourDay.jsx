// ═══════════════════════════════════════════════════════════════════════════════
// YOUR DAY — Home's first panel: what needs you today, most urgent first
// ═══════════════════════════════════════════════════════════════════════════════
// Ranks open cases by their clocks (clocks.mjs — the same ones the reminders
// bell and the daily email use): anything breached, escalations to you, clocks
// due soon, new cases waiting for analysis, and what goes out in today's batch.
// Shows the user's own cases (assigned or escalated to them) when there are
// any, otherwise the team's. Below that, the team's other deadlines this week.
import React, { useMemo, useState } from 'react'
import { allThreadCases, stageOf, openCase } from './CaseThread.jsx'
import { caseClocks, pressing, sortClocks } from './clocks.mjs'
import { Badge, Button } from './ui.jsx'

const DAY = 86400000
const short = k => k.text.replace(/ (left|overdue)$/, '')
const BREACHED = { response: k => `OVERDUE ${short(k)}`, regE: () => 'REG E OVERDUE', file: () => 'FILE SLA MISSED', assign: () => 'NO OWNER' }
const SOON     = { response: k => `DUE ${short(k)}`, regE: k => `REG E ${short(k)}`, file: k => `FILE IN ${short(k)}`, assign: k => `ASSIGN ${short(k)}` }

// Each open case gets at most one reason, the most urgent one
function reasonFor(c, settings, me) {
  const stage = stageOf(c)
  if (stage === 'closed') return null
  const top = pressing(caseClocks(c, settings))[0]
  if (top?.state === 'breached') return { rank: 0, tone: 'danger', label: BREACHED[top.key](top), why: `${top.label} — ${top.text}` }
  if (me && (c.escalatedTo || '').toLowerCase() === me) return { rank: 1, tone: 'danger', label: 'ESCALATED', why: `Escalated to you — ${c.escalationReason || 'needs review'}` }
  if (top) return { rank: top.key === 'response' ? 1 : 2, tone: 'warn', label: SOON[top.key](top), why: `${top.label} — ${top.text}` }
  if (stage === 'triage') return { rank: 3, tone: 'info', label: 'TRIAGED', why: 'Build the case in Desk' }
  if (stage === 'desk')   return { rank: 3, tone: 'info', label: 'NEW', why: 'Analyse and pick the reason code' }
  if (stage === 'multi')  return { rank: 4, tone: 'neutral', label: `BATCH ${settings?.batchFileTime || '15:00'}`, why: 'Queued — goes out with today’s batch' }
  if (c.nextRespDate)     return { rank: 5, tone: 'neutral', label: `DUE ${Math.round((new Date(c.nextRespDate + 'T12:00:00') - new Date()) / DAY)}d`, why: 'Waiting on the merchant' }
  return null
}

export function YourDay({ outcomes, covUser, settings, platformMode }) {
  const [showAll, setShowAll] = useState(false)
  const me = covUser?.email?.toLowerCase()
  const { items, scope, counts, comingUp, unowned } = useMemo(() => {
    const all = allThreadCases(outcomes)
      .filter(c => (platformMode === 'merchant' ? c.mode === 'merchant' : c.mode !== 'merchant'))
    const open = all.map(c => ({ c, r: reasonFor(c, settings, me) })).filter(x => x.r)
    const isMine = c => !!me && ((c.assignedTo || '').toLowerCase() === me || (c.escalatedTo || '').toLowerCase() === me)
    const mine = open.filter(x => isMine(x.c))
    const list = (mine.length ? mine : open).sort((a, b) => a.r.rank - b.r.rank || (a.c.nextRespDate || '9').localeCompare(b.c.nextRespDate || '9'))
    const counts = { urgent: list.filter(x => x.r.rank <= 2).length, todo: list.filter(x => x.r.rank === 3).length, batch: list.filter(x => x.r.rank === 4).length }
    // The whole team's deadlines in the next 7 days that aren't already listed above.
    // Cases with no owner are summed up in one line rather than listed one by one.
    const listed = new Set(list.map(x => x.c.id))
    const comingUp = all.filter(c => !listed.has(c.id)).map(c => {
      const k = sortClocks(caseClocks(c, settings)).find(k => k.key !== 'assign' && (k.state === 'breached' || k.state === 'soon' || (k.state === 'ok' && k.left <= 7 * DAY)))
      return k ? { c, k } : null
    }).filter(Boolean).sort((a, b) => a.k.left - b.k.left)
    const unowned = all.filter(c => caseClocks(c, settings).some(k => k.key === 'assign' && k.state === 'breached')).length
    return { items: list, scope: mine.length ? 'mine' : 'team', counts, comingUp, unowned }
  }, [outcomes, me, settings, platformMode])

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })
  const shown = showAll ? items : items.slice(0, 6)

  return (
    <section aria-labelledby="your-day" className="mb-8" style={{ border:'1px solid #1A1814', background:'#FAF7F1' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'12px', flexWrap:'wrap', padding:'14px 18px', borderBottom:'1px solid #D4CCBC' }}>
        <div>
          <h2 id="your-day" className="display-font" style={{ fontSize:'22px', fontWeight:600, color:'#1A1814', margin:0, letterSpacing:'-0.01em' }}>
            Your <span style={{ fontStyle:'italic', fontWeight:500 }}>day</span>
          </h2>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#6B6259', marginTop:'2px' }}>
            {today.toUpperCase()} · {scope === 'mine' ? 'YOUR CASES' : 'TEAM QUEUE — NOTHING ASSIGNED TO YOU YET'}
          </div>
        </div>
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
          {counts.urgent > 0 && <Badge tone="danger">{counts.urgent} URGENT</Badge>}
          {counts.todo > 0 && <Badge tone="info">{counts.todo} TO ANALYSE</Badge>}
          {counts.batch > 0 && <Badge tone="neutral">{counts.batch} IN TODAY’S BATCH</Badge>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="display-font" style={{ padding:'18px', fontSize:'15px', color:'#57534E', fontStyle:'italic' }}>Nothing needs you today. Clear desk.</div>
      ) : (
        <ol style={{ listStyle:'none', margin:0, padding:0 }}>
          {shown.map(({ c, r }, i) => (
            <li key={c.id}>
              <button onClick={() => openCase(c.id)} data-yourday-row={i}
                style={{ display:'grid', gridTemplateColumns:'110px 92px minmax(0,1fr) auto', gap:'12px', alignItems:'center', width:'100%', textAlign:'left',
                  padding:'10px 18px', background:'none', border:'none', borderTop: i ? '1px solid #EDE7DC' : 'none', cursor:'pointer' }}
                className="cov-search-row cov-yourday-row">
                <span><Badge tone={r.tone}>{r.label}</Badge></span>
                <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{c.id}</span>
                <span style={{ minWidth:0 }}>
                  <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'}</span>
                  <span className="mono-font" style={{ display:'block', fontSize:'11px', color:'#6B6259', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.why}{c.amount ? ` · ${c.amount}` : ''}</span>
                </span>
                <span className="mono-font desktop-only" style={{ fontSize:'11px', color:'#1A1814' }}>Open →</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {items.length > 6 && (
        <div style={{ padding:'8px 18px 12px', borderTop:'1px solid #EDE7DC' }}>
          <Button variant="quiet" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${items.length}`}</Button>
        </div>
      )}

      {/* Coming up — the team's deadlines this week */}
      <div style={{ borderTop:'1px solid #D4CCBC', padding:'12px 18px 14px' }}>
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', marginBottom: comingUp.length ? '6px' : 0 }}>
          COMING UP · NEXT 7 DAYS{scope === 'mine' ? ' · WHOLE TEAM' : ''}
          {!comingUp.length && <span style={{ color:'#6B6259', letterSpacing:'0.04em' }}> — no other deadlines this week.</span>}
        </div>
        {unowned > 0 && (
          <div className="mono-font" style={{ fontSize:'11px', color:'#92400E', padding:'5px 0' }}>
            {unowned} open case{unowned === 1 ? ' has' : 's have'} had no owner for longer than the {settings?.slaAssignHours ?? 24}h target
            {settings?.autoAssign ? '.' : ' — assign them in Multi, or turn on auto-assignment in Settings → Workflow.'}
          </div>
        )}
        {comingUp.map(({ c, k }) => (
          <button key={c.id} onClick={() => openCase(c.id)} className="cov-search-row mono-font cov-comingup-row"
            style={{ display:'grid', gridTemplateColumns:'86px 92px minmax(0,1fr) auto', gap:'12px', alignItems:'center', width:'100%', textAlign:'left',
              background:'none', border:'none', padding:'5px 0', cursor:'pointer', fontSize:'11px', color:'#1A1814' }}>
            <span style={{ color: k.state === 'breached' ? '#991B1B' : k.state === 'soon' ? '#92400E' : '#1E3A5F', fontWeight:500 }}>{k.state === 'breached' ? `OVERDUE ${short(k)}` : `in ${short(k)}`}</span>
            <span style={{ color:'#57534E' }}>{c.id}</span>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'} <span style={{ color:'#6B6259' }}>· {k.label}</span></span>
            <span className="desktop-only" style={{ color:'#6B6259' }}>{c.assignedTo ? c.assignedTo.split('@')[0] : 'unassigned'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

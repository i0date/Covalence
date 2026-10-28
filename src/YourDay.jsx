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
import { insights, greeting, daySummary, money, WEEKDAYS } from './insights.js'

const OPEN_KEY = 'cov_yourday_open'   // per browser: whether Your day is expanded

// New cases per day for the last 14 days; today's bar carries a dashed outline at the forecast
function IntakeBars({ days, expected }) {
  const [hover, setHover] = useState(null)
  const W = 168, H = 44, gap = 2, bw = (W - gap * (days.length - 1)) / days.length
  const max = Math.max(1, expected || 0, ...days.map(d => d.count))
  const y = v => H - (v / max) * (H - 4)
  const label = (d, i) => `${d.date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}: ${d.count} opened${i === days.length - 1 && expected != null ? ` so far, about ${expected.toFixed(1)} expected` : ''}`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" preserveAspectRatio="none"
        aria-label={`New cases per day, last 14 days: ${days.map(d => d.count).join(', ')}${expected != null ? `. About ${expected.toFixed(1)} expected today.` : ''}`}
        onMouseLeave={() => setHover(null)} style={{ display:'block', overflow:'visible' }}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#D4CCBC" strokeWidth="1" />
        {days.map((d, i) => {
          const x = i * (bw + gap), today = i === days.length - 1
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x} y="0" width={bw + gap} height={H} fill="transparent" />
              {d.count > 0 && <rect x={x} y={y(d.count)} width={bw} height={H - y(d.count)} rx="1.5" fill={today ? '#1A1814' : hover === i ? '#3F3A35' : '#8A7F72'} />}
              {today && expected != null && expected > d.count && (
                <rect x={x + 0.5} y={y(expected)} width={bw - 1} height={y(d.count) - y(expected)} rx="1.5" fill="none" stroke="#1A1814" strokeWidth="1" strokeDasharray="2 1.5" />
              )}
              <title>{label(d, i)}</title>
            </g>
          )
        })}
      </svg>
      <div className="mono-font" aria-live="polite" style={{ fontSize:'10px', color:'#6B6259', marginTop:'4px', minHeight:'14px' }}>
        {hover != null ? label(days[hover], hover) : <>LAST 14 DAYS · <span style={{ borderBottom:'1px dashed #1A1814' }}>dashed</span> = expected today</>}
      </div>
    </div>
  )
}

function Tile({ label, value, sub, children, dim }) {
  return (
    <div style={{ background:'#FFFFFF', border:'1px solid #E7E2D9', padding:'12px 14px', minWidth:0, display:'flex', flexDirection:'column', gap:'2px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E' }}>{label}</div>
      {value != null && <div className="display-font" style={{ fontSize:'28px', fontWeight:600, color: dim ? '#8A7F72' : '#1A1814', lineHeight:1.1, letterSpacing:'-0.01em' }}>{value}</div>}
      {sub && <div className="display-font" style={{ fontSize:'13px', color:'#57534E', lineHeight:1.4 }}>{sub}</div>}
      {children}
    </div>
  )
}

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
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch {} return !o })
  const ins = useMemo(() => insights(allThreadCases(outcomes).filter(c => (platformMode === 'merchant' ? c.mode === 'merchant' : c.mode !== 'merchant')),
    { me, settings }), [outcomes, me, settings, platformMode])
  const firstName = (covUser?.name || '').replace(/\s*\(.*\)$/, '').split(/[\s@]/)[0]
  const summary = daySummary({ total: items.length, urgent: counts.urgent, overdue: items.filter(x => x.r.rank === 0).length,
    todo: counts.todo, batch: counts.batch, batchTime: settings?.batchFileTime || '15:00' })
  const ex = ins.expected, pc = ins.pace
  const trend = pc.last7 - pc.prev7

  return (
    <section aria-labelledby="your-day" className="mb-8" style={{ border:'1px solid #1A1814', background:'#FAF7F1' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px', flexWrap:'wrap', padding:'18px 20px 16px', borderBottom: open ? '1px solid #D4CCBC' : 'none' }}>
        <div style={{ minWidth:0, flex:'1 1 320px' }}>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#6B6259', marginBottom:'6px' }}>
            YOUR DAY · {today.toUpperCase()}{scope === 'team' ? ' · TEAM QUEUE' : ''}
          </div>
          <h2 id="your-day" className="display-font" style={{ fontSize:'clamp(22px, 3.2vw, 28px)', fontWeight:600, color:'#1A1814', margin:0, letterSpacing:'-0.015em', lineHeight:1.15 }}>
            {greeting()}{firstName ? <>, <span style={{ fontStyle:'italic', fontWeight:500 }}>{firstName}</span></> : null}.
          </h2>
          <p className="display-font" style={{ fontSize:'16px', color:'#3F3A35', margin:'6px 0 0', lineHeight:1.45 }}>
            {summary}{scope === 'team' && items.length ? ' Nothing is assigned to you yet, so this is the team’s queue.' : ''}
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
          {counts.urgent > 0 && <Badge tone="danger">{counts.urgent} URGENT</Badge>}
          {counts.todo > 0 && <Badge tone="info">{counts.todo} TO ANALYSE</Badge>}
          {counts.batch > 0 && <Badge tone="neutral">{counts.batch} IN TODAY’S BATCH</Badge>}
          <button onClick={toggle} aria-expanded={open} aria-controls="your-day-body" className="mono-font"
            style={{ background:'none', border:'1px solid #D4CCBC', padding:'5px 10px', cursor:'pointer', fontSize:'10px', letterSpacing:'0.12em', color:'#1A1814' }}>
            {open ? '▴ HIDE' : '▾ SHOW'}
          </button>
        </div>
      </div>

      {open && (<div id="your-day-body">
      {/* Insights — each one says what it's based on, and steps aside without enough history */}
      <div className="cov-yourday-insights" style={{ display:'grid', gap:'10px', padding:'14px 20px', background:'#F3EEE6', borderBottom:'1px solid #D4CCBC' }}>
        <Tile label="TODAY’S CASELOAD" value={items.length}
          sub={!ex ? 'Forecasts start after two weeks of cases.' : (() => {
            const v = ex.mine ?? ex.team, who = ex.mine != null ? 'for you' : 'for the team'
            return v < 0.5 ? <>{WEEKDAYS[new Date().getDay()]}s are usually quiet {who} — based on {ex.basis}</>
              : <>+ about <strong>{v < 1.5 ? 'one' : Math.round(v)}</strong> new {who}, based on {ex.basis}</>
          })()}>
          <div style={{ marginTop:'8px' }}><IntakeBars days={ins.days} expected={ex ? ex.team : null} /></div>
        </Tile>
        <Tile label={pc.who === 'mine' ? 'YOUR PACE' : 'TEAM PACE'} value={pc.last7 || !pc.enough ? `${pc.last7} closed` : `${pc.last28} closed`} dim={!pc.enough}
          sub={!pc.enough ? 'No cases closed in the last four weeks yet.' : <>
            {!pc.last7 ? 'in the last four weeks, none this week.' : trend === 0 ? 'this week, the same as the week before.'
              : <>this week, <span aria-hidden="true" style={{ color: trend > 0 ? '#065F46' : '#991B1B' }}>{trend > 0 ? '▲' : '▼'}</span> {Math.abs(trend)} {trend > 0 ? 'more' : 'fewer'} than the week before.</>}
            {pc.clearDays != null && pc.openNow > 0 && <> At this rate, the {pc.openNow} open clear in about {pc.clearDays} day{pc.clearDays === 1 ? '' : 's'}.</>}
            {pc.who === 'team' && ins.scope === 'mine' && <span style={{ display:'block', fontSize:'12px', color:'#6B6259', marginTop:'4px' }}>The team’s pace — you haven’t closed a case in four weeks.</span>}
          </>} />
        <Tile label="THIS WEEK" value={`${ins.week.total} deadline${ins.week.total === 1 ? '' : 's'}`} dim={!ins.week.total}
          sub={ins.week.total ? <>Busiest {ins.week.busiestLabel} ({ins.week.byDay[ins.week.busiest]})</> : 'No response, filing or Reg E deadlines in the next 7 days.'}>
          {ins.week.total > 0 && (
            <div aria-hidden="true" style={{ display:'flex', gap:'3px', alignItems:'flex-end', height:'22px', marginTop:'8px' }}>
              {ins.week.byDay.map((n, i) => (
                <div key={i} title={`${i === 0 ? 'Today' : WEEKDAYS[(new Date().getDay() + i) % 7]}: ${n}`} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'2px' }}>
                  <div style={{ width:'100%', height: n ? `${4 + 14 * n / Math.max(...ins.week.byDay)}px` : '2px', background: n ? (i === ins.week.busiest ? '#92400E' : '#8A7F72') : '#E7E2D9', borderRadius:'1.5px 1.5px 0 0' }} />
                  <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259', lineHeight:1 }}>{WEEKDAYS[(new Date().getDay() + i) % 7].slice(0, 2)}</span>
                </div>
              ))}
            </div>
          )}
        </Tile>
        <Tile label="AT RISK" value={ins.atRisk.cases ? money(ins.atRisk.amount, ins.atRisk.currency) : 'Nothing'} dim={!ins.atRisk.cases}
          sub={ins.atRisk.cases ? <>on {ins.atRisk.cases} case{ins.atRisk.cases === 1 ? '' : 's'} with a deadline missed or close</> : 'No missed or nearly-due deadlines.'} />
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
      </div>)}
    </section>
  )
}

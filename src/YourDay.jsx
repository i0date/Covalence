// ═══════════════════════════════════════════════════════════════════════════════
// YOUR DAY — Home's centre: the plan for today, and the forecast
// ═══════════════════════════════════════════════════════════════════════════════
// Ranks open cases by their clocks (clocks.mjs — the same ones the reminders
// bell and the daily email use): anything breached, escalations to you, clocks
// due soon, new cases waiting for analysis, and what goes out in today's batch.
// Shows the user's own cases (assigned or escalated to them) when there are
// any, otherwise the team's, grouped into the order to work them (planOf), with
// the team's other deadlines this week below. Beside it on wide screens (below
// on narrow ones), the forecast for you and the team, and the week ahead.
import React, { useEffect, useMemo, useState } from 'react'
import { allThreadCases, stageOf, openCase } from './CaseThread.jsx'
import { caseClocks, pressing, sortClocks } from './clocks.mjs'
import { Badge, Button, NewDot } from './ui.jsx'
import { insights, money, WEEKDAYS } from './insights.js'
import { Refs } from './FrontPage.jsx'
import { isMerchantCase } from './sides.mjs'
import { briefPeriod, noteVisit, changedSince } from './brief.js'
import { waitingClaims, silentDays, claimTotal } from './claims.mjs'
import { listClaims, openClaim } from './claimsData.js'
import { alarmList } from './alarmData.js'
import { usePatterns } from './Alarms.jsx'

const OPEN_KEY = 'cov_yourday_open'   // per browser: whether Your day is expanded
// Show/hide on Home: one look for every panel that folds
export const foldLook = { background:'#FFFFFF', border:'1px solid #1A1814', padding:'6px 10px', fontSize:'10px', letterSpacing:'0.12em', color:'#1A1814', whiteSpace:'nowrap' }

const DAY = 86400000
const short = k => k.text.replace(/ (left|overdue)$/, '')
const BREACHED = { response: k => `OVERDUE ${short(k)}`, regE: () => 'REG E OVERDUE', file: () => 'FILE SLA MISSED', assign: () => 'NO OWNER',
  screen: () => 'SANCTIONS HIT', ofac: () => 'OFAC REPORT LATE', sar: () => 'SAR OVERDUE' }
const SOON     = { response: k => `DUE ${short(k)}`, regE: k => `REG E ${short(k)}`, file: k => `FILE IN ${short(k)}`, assign: k => `ASSIGN ${short(k)}`,
  screen: () => 'SANCTIONS HIT', ofac: k => `OFAC ${short(k)}`, sar: k => `SAR ${short(k)}` }

// Each open case gets at most one reason, the most urgent one
function reasonFor(c, settings, me) {
  const stage = stageOf(c)
  const top = pressing(caseClocks(c, settings))[0]
  if (stage === 'closed' && !top) return null   // closed disputes can still owe a sanctions or SAR decision
  if (top?.state === 'breached') return { rank: 0, tone: 'danger', label: BREACHED[top.key](top), why: `${top.label} — ${top.text}`, key: top.key, late: true, left: short(top) }
  if (me && (c.escalatedTo || '').toLowerCase() === me) return { rank: 1, tone: 'danger', label: 'ESCALATED', escalated: true, why: `Escalated to you — ${c.escalationReason || 'needs review'}` }
  if (top) return { rank: top.key === 'response' || top.key === 'screen' ? 1 : 2, tone: top.key === 'screen' ? 'danger' : 'warn', label: SOON[top.key](top), why: `${top.label} — ${top.text}`, due: top.due, key: top.key, left: short(top) }
  if (stage === 'triage') return { rank: 3, tone: 'info', label: 'TRIAGED', why: 'Build the case in Desk' }
  if (stage === 'desk')   return { rank: 3, tone: 'info', label: 'NEW', why: 'Analyse and pick the reason code' }
  if (stage === 'multi')  return { rank: 4, tone: 'neutral', label: `BATCH ${settings?.batchFileTime || '15:00'}`, why: 'Queued — goes out with today’s batch' }
  if (c.nextRespDate)     return { rank: 5, tone: 'neutral', label: `DUE ${Math.round((new Date(c.nextRespDate + 'T12:00:00') - new Date()) / DAY)}d`, why: 'Waiting on the merchant' }
  return null
}

// True while a media query matches (Home switches to two columns on wide screens)
export function useMedia(query) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query); if (!mq) return
    const f = () => setOn(mq.matches); f()
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f)
  }, [query])
  return on
}

// Everything Your day shows, worked out once: Home passes it to the panel and, on wide screens, to the side column
export function useDay({ outcomes, covUser, settings, platformMode }) {
  const me = covUser?.email?.toLowerCase()
  // The brief looks back to the last working day, or to the last visit when that was earlier
  const [prev] = useState(() => noteVisit())
  const period = useMemo(() => briefPeriod(new Date(), prev), [prev])
  // Claims from the bank's app (issuers only) and alarms, for the brief and for customers waiting on an update
  const [claims, setClaims] = useState([])
  const [alarms, setAlarms] = useState([])
  const fi = platformMode !== 'merchant', canAlarm = !!(covUser?.authed || covUser?.demo)
  useEffect(() => {
    if (!fi) { setClaims([]); return }
    let live = true
    const load = () => listClaims().then(r => { if (live) setClaims(r) }).catch(() => {})
    load(); window.addEventListener('cov:claims-changed', load)
    return () => { live = false; window.removeEventListener('cov:claims-changed', load) }
  }, [fi])
  useEffect(() => {
    if (!canAlarm) return
    let live = true
    const load = () => alarmList().then(r => { if (live) setAlarms(r) }).catch(() => {})
    load(); window.addEventListener('cov:alarm-changed', load)
    return () => { live = false; window.removeEventListener('cov:alarm-changed', load) }
  }, [canAlarm])
  const work = useMemo(() => {
    const all = allThreadCases(outcomes)
      .filter(c => (platformMode === 'merchant' ? isMerchantCase(c) : !isMerchantCase(c)))
    const open = all.map(c => ({ c, r: reasonFor(c, settings, me) })).filter(x => x.r)
    const isMine = c => !!me && ((c.assignedTo || '').toLowerCase() === me || (c.escalatedTo || '').toLowerCase() === me)
    const mine = open.filter(x => isMine(x.c))
    // Customers who haven't heard from the bank in a while are everyone's job, whoever is signed in
    const waiting = waitingClaims(claims).map(cl => {
      const d = cl.data || {}, n = silentDays(cl)
      return { claim: true, c: { _claimRow: cl, id: cl.id, merchant: d.customer?.name || d.customer?.id || 'Customer', amount: claimTotal(d) ? `${claimTotal(d).toFixed(2)} ${d.transactions?.[0]?.currency || 'USD'}` : '' },
        r: { rank: 1, tone: 'warn', label: `NO UPDATE ${n}d`, waiting: true, why: `Claim from your app — the customer hasn’t heard from you in ${n} days` } }
    })
    const list = [...(mine.length ? mine : open), ...waiting].sort((a, b) => a.r.rank - b.r.rank || (a.c.nextRespDate || '9').localeCompare(b.c.nextRespDate || '9'))
    const counts = { urgent: list.filter(x => x.r.rank <= 2).length, todo: list.filter(x => x.r.rank === 3).length, batch: list.filter(x => x.r.rank === 4).length }
    // The whole team's deadlines in the next 7 days that aren't already listed above.
    // Cases with no owner are summed up in one line rather than listed one by one.
    const listed = new Set(list.map(x => x.c.id))
    const comingUp = all.filter(c => !listed.has(c.id)).map(c => {
      const k = sortClocks(caseClocks(c, settings)).find(k => k.key !== 'assign' && (k.state === 'breached' || k.state === 'soon' || (k.state === 'ok' && k.left <= 7 * DAY)))
      return k ? { c, k } : null
    }).filter(Boolean).sort((a, b) => a.k.left - b.k.left)
    const unowned = all.filter(c => caseClocks(c, settings).some(k => k.key === 'assign' && k.state === 'breached')).length
    return { all, items: list, scope: mine.length ? 'mine' : 'team', counts, comingUp, unowned }
  }, [outcomes, me, settings, platformMode, claims])
  const ins = useMemo(() => insights(work.all, { me, settings }), [work.all, me, settings])
  const patterns = usePatterns(outcomes, platformMode)
  const myName = covUser?.name || ''
  const changed = c => c?._claimRow ? !!prev && new Date(c._claimRow.updated_at || 0) > prev : changedSince(c, prev, myName)
  return { ...work, ins, me, platformMode, claims, alarms, patterns, period, prev, changed }
}

// ── The forecast: for you, for the team, and the working week ahead ──
// Every figure is a count or an average of past weeks, and says what it's based on.
const about = v => v < 0.5 ? 'none' : v < 1.5 ? 'about one' : `about ${Math.round(v)}`
const nOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

function Line({ label, children }) {
  return (
    <div className="cov-fc-line">
      <span className="mono-font cov-fc-label">{label}</span>
      <span className="display-font cov-fc-text">{children}</span>
    </div>
  )
}

function paceText(p) {
  if (!p.enough) return 'No cases closed in the last four weeks yet.'
  const trend = p.last7 - p.prev7
  return <>
    <strong>{p.last7}</strong> closed this week{trend ? <>, <span aria-hidden="true" style={{ color: trend > 0 ? '#065F46' : '#991B1B' }}>{trend > 0 ? '▲' : '▼'}</span> {Math.abs(trend)} {trend > 0 ? 'more' : 'fewer'} than the week before</> : ', the same as the week before'}.
    {p.clearDays != null && p.openNow > 0 && <> At this rate the {p.openNow} open clear in about {nOf(p.clearDays, 'day')}.</>}
  </>
}
const weekText = w => w.total ? <><strong>{w.total}</strong> deadline{w.total === 1 ? '' : 's'} in the next 7 days; the busiest is {w.busiestLabel} ({w.byDay[w.busiest]}).</> : 'No response, filing or Reg E deadlines in the next 7 days.'
const riskText = r => r.cases ? <><strong>{money(r.amount, r.currency)}</strong> on {nOf(r.cases, 'case')} with a deadline missed or close.</> : 'Nothing with a deadline missed or close.'

// Deadlines ahead: anything already late, then today and the next four working days. Each bar
// stacks your deadlines (dark) under the rest of the team's (light); a weekend deadline sits on
// the working day before it. Under each day, how many new cases a day like it usually brings.
// Pick a bar to list its cases, each one a link.
const INK = '#1A1814', REST = '#B5AA9A', LATE_MINE = '#991B1B', LATE_REST = '#D9A3A3'
function DeadlinesAhead({ ahead, late, withMine }) {
  const [hover, setHover] = useState(null)
  const [pick, setPick] = useState(null)
  const cols = [...(late.length ? [{ late: true, due: late, deadlines: late.length, mine: withMine ? late.filter(e => e.mine).length : null }] : []), ...ahead]
  const W = 300, H = 70, foot = cols.some(d => d.weekend) ? 38 : 28, gw = W / cols.length, bw = Math.min(26, gw - 18)
  const max = Math.max(1, ...cols.map(d => d.deadlines))
  const h = v => (v / max) * (H - 14)
  const name = d => d.late ? 'Late' : d.today ? 'Today' : WEEKDAYS[d.date.getDay()].slice(0, 3)
  const full = d => d.late ? 'Already late' : d.today ? 'Today' : WEEKDAYS[d.date.getDay()]
  const label = d => `${full(d)}: ${nOf(d.deadlines, 'deadline')}${d.late ? ' missed' : ''}${withMine && d.mine ? `, ${d.mine} yours` : ''}${d.weekend ? ', including the weekend' : ''}${!d.late && d.expected != null ? `; usually ${about(d.expected).replace('about ', '')} new` : ''}`
  const toggle = i => setPick(p => p === i ? null : i)
  const heavy = ahead.slice(1).reduce((m, d) => d.deadlines > (m ? m.deadlines : 0) ? d : m, null)
  const sel = pick != null ? cols[pick] : null
  const sw = c => <svg width="9" height="9" aria-hidden="true" style={{ display:'inline-block', verticalAlign:'-1px', marginRight:'4px' }}><rect width="9" height="9" rx="1.5" fill={c} /></svg>
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + foot}`} width="100%" role="group" aria-label="Deadlines ahead, by day" onMouseLeave={() => setHover(null)} style={{ display:'block', overflow:'visible' }}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="#D4CCBC" />
        {cols.map((d, i) => {
          const x = i * gw + gw / 2, mineN = withMine ? d.mine : 0, restN = d.deadlines - mineN
          const on = hover === i || pick === i, dim = pick != null && pick !== i
          const top = H - h(d.deadlines)
          return (
            <g key={i} role="button" tabIndex={0} aria-pressed={pick === i} aria-label={label(d)} style={{ cursor: d.deadlines ? 'pointer' : 'default', outline:'none' }}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onClick={() => d.deadlines && toggle(i)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && d.deadlines) { e.preventDefault(); toggle(i) } }}>
              <rect x={i * gw} y="0" width={gw} height={H + foot} fill={pick === i ? '#F3EEE4' : 'transparent'} />
              <g opacity={dim ? 0.45 : 1}>
                {mineN > 0 && <rect x={x - bw / 2} y={H - h(mineN)} width={bw} height={h(mineN)} rx="2" fill={d.late ? LATE_MINE : INK} />}
                {restN > 0 && <rect x={x - bw / 2} y={top} width={bw} height={h(restN) - (mineN > 0 ? 2 : 0)} rx="2" fill={d.late ? LATE_REST : REST} />}
                {on && d.deadlines > 0 && <rect x={x - bw / 2 - 2} y={top - 2} width={bw + 4} height={h(d.deadlines) + 2} rx="3" fill="none" stroke={INK} strokeWidth="1" />}
              </g>
              <text x={x} y={top - 4} textAnchor="middle" fontSize="10" fill={d.late ? LATE_MINE : '#1A1814'} fontWeight={d.late ? 600 : 500} fontFamily="JetBrains Mono, monospace">{d.deadlines}</text>
              <text x={x} y={H + 12} textAnchor="middle" fontSize="9.5" fill={d.late ? LATE_MINE : d.today ? INK : '#57534E'} fontWeight={d.today || d.late ? 600 : 400} fontFamily="JetBrains Mono, monospace">{name(d)}</text>
              {!d.late && d.expected != null && <text x={x} y={H + 24} textAnchor="middle" fontSize="8.5" fill="#8A7F72" fontFamily="JetBrains Mono, monospace">~{Math.round(d.expected)} new</text>}
              {d.weekend && <text x={x} y={H + 35} textAnchor="middle" fontSize="8.5" fill="#57534E" fontFamily="JetBrains Mono, monospace">+ weekend</text>}
            </g>
          )
        })}
      </svg>
      <div className="mono-font" aria-live="polite" style={{ fontSize:'10px', color:'#6B6259', marginTop:'6px', minHeight:'14px', lineHeight:1.5 }}>
        {hover != null ? label(cols[hover]) : <span style={{ display:'flex', flexWrap:'wrap', columnGap:'12px' }}>
          {withMine && <span>{sw(INK)}yours</span>}<span>{sw(REST)}{withMine ? 'rest of the team' : 'deadlines'}</span>{late.length > 0 && <span>{sw(LATE_MINE)}late</span>}<span>~ usual new cases</span>
        </span>}
      </div>
      {sel ? (
        <div className="cov-fc-pick">
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color: sel.late ? LATE_MINE : '#57534E', display:'flex', justifyContent:'space-between', gap:'8px' }}>
            <span>{full(sel).toUpperCase()} · {nOf(sel.deadlines, 'DEADLINE', 'DEADLINES')}</span>
            <button type="button" className="mono-font cov-ref" onClick={() => setPick(null)} aria-label="Close the list">CLOSE ×</button>
          </div>
          <ul style={{ listStyle:'none', margin:'6px 0 0', padding:0 }}>
            {sel.due.slice().sort((a, b) => (b.mine - a.mine) || a.id.localeCompare(b.id)).map((e, k) => (
              <li key={e.id + e.key + k} style={{ display:'flex', gap:'8px', alignItems:'baseline', padding:'3px 0', borderTop: k ? '1px solid #EDE7DC' : 'none' }}>
                <button type="button" className="mono-font cov-ref" onClick={() => openCase(e.id)} aria-label={`Open ${e.id}`}>{e.id}</button>
                <span className="display-font" style={{ fontSize:'13px', color:'#57534E', minWidth:0, flex:1, lineHeight:1.35 }}>{e.merchant ? <><span style={{ color:'#1A1814' }}>{e.merchant}</span> · </> : null}{e.label}</span>
                {withMine && e.mine && <span className="mono-font" style={{ fontSize:'9.5px', letterSpacing:'0.1em', color:INK }}>YOURS</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="display-font" style={{ margin:'8px 0 0', fontSize:'14px', lineHeight:1.45, color:'#1A1814' }}>
          {heavy ? <>{WEEKDAYS[heavy.date.getDay()]} looks the busiest of the days ahead, with {nOf(heavy.deadlines, 'deadline')}{withMine && heavy.mine ? ` (${heavy.mine} yours)` : ''}. </> : 'No deadlines in the days ahead. '}
          <span style={{ color:'#6B6259' }}>Pick a day to see its cases.</span>
        </p>
      )}
    </div>
  )
}

// Keeping up: open cases at the end of each of the last 14 days, so a growing backlog shows
// before it hurts. Hover a day for what came in and what was closed.
function KeepingUp({ backlog }) {
  const [hover, setHover] = useState(null)
  if (!backlog?.length) return null
  const W = 300, H = 56, n = backlog.length
  const vals = backlog.map(d => d.open), lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = Math.max(1, Math.ceil((hi - lo) * 0.15)), min = Math.max(0, lo - pad), max = hi + pad
  const x = i => 4 + (i / (n - 1)) * (W - 8)
  const y = v => 6 + (1 - (v - min) / Math.max(1, max - min)) * (H - 12)
  const path = backlog.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.open).toFixed(1)}`).join(' ')
  const first = backlog[0], last = backlog[n - 1]
  const inN = backlog.slice(1).reduce((s, d) => s + d.opened, 0), outN = backlog.slice(1).reduce((s, d) => s + d.closed, 0)
  const date = d => d.date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
  const label = (d, i) => `${i === n - 1 ? 'Today' : date(d)}: ${d.open} open · ${d.opened} came in, ${d.closed} closed`
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width * W - 4) / (W - 8) * (n - 1)))))
  }
  const diff = last.open - first.open
  return (
    <div>
      <div className="display-font cov-fc-who">Keeping up · whole team</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display:'block', overflow:'visible' }}
        aria-label={`Open cases over the last 14 days: ${vals.join(', ')}`}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#D4CCBC" />
        <path d={`${path} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill="#EDE7DC" />
        <path d={path} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="#8A7F72" strokeDasharray="2 2" />}
        <circle cx={x(hover ?? n - 1)} cy={y(backlog[hover ?? n - 1].open)} r="4" fill={INK} stroke="#FAF7F1" strokeWidth="2" />
        <text x={x(0)} y={y(first.open) - 7} fontSize="9.5" fill="#57534E" fontFamily="JetBrains Mono, monospace">{first.open}</text>
        <text x={x(n - 1)} y={y(last.open) - 9} textAnchor="end" fontSize="10" fontWeight="600" fill={INK} fontFamily="JetBrains Mono, monospace">{last.open} open</text>
      </svg>
      <div className="mono-font" aria-live="polite" style={{ fontSize:'10px', color:'#6B6259', marginTop:'4px', minHeight:'14px' }}>
        {hover != null ? label(backlog[hover], hover) : `OPEN CASES · ${date(first).toUpperCase()} – TODAY`}
      </div>
      <p className="display-font" style={{ margin:'8px 0 0', fontSize:'14px', lineHeight:1.45, color:'#1A1814' }}>
        {diff === 0 ? <>Steady at {last.open} open over two weeks</> : <>Open cases went from {first.open} to {last.open} over two weeks</>}: {inN} came in and {outN} {outN === 1 ? 'was' : 'were'} closed.
        {diff > 0 && inN > outN && <span style={{ color:'#6B6259' }}> More is coming in than going out.</span>}
      </p>
    </div>
  )
}
export function Forecast({ day, settings }) {
  const { ins, unowned } = day
  const ex = ins.expected, you = ins.you, team = ins.team
  const weekday = WEEKDAYS[new Date().getDay()]
  return (
    <div className="cov-yd-forecast">
      <div className="mono-font cov-fc-head">THE FORECAST</div>
      {you && (
        <section className="cov-fc-block" aria-label="Your forecast">
          <div className="display-font cov-fc-who">For you</div>
          <Line label="OPEN"><strong>{nOf(you.open, 'case')}</strong> assigned to you; {you.dueToday ? <><strong>{you.dueToday}</strong> with a deadline today.</> : 'none with a deadline today.'}</Line>
          <Line label="NEW">{ex?.mine == null ? 'Forecasts start after two weeks of cases.' : ex.mine < 0.5 ? 'Probably nothing new for you today, judging by your share of new cases over the last 30 days.'
            : <>{about(ex.mine).replace(/^./, c => c.toUpperCase())} new for you today, judging by your share of new cases over the last 30 days.</>}</Line>
          <Line label="THIS WEEK">{weekText(you.week)}</Line>
          <Line label="PACE">{paceText(you.pace)}</Line>
          <Line label="AT RISK">{riskText(you.atRisk)}</Line>
        </section>
      )}
      <section className="cov-fc-block" aria-label="The team's forecast">
        <div className="display-font cov-fc-who">For the team</div>
        <Line label="OPEN"><strong>{team.open}</strong> open{unowned ? <>, {unowned} without an owner past the {settings?.slaAssignHours ?? 24}h target</> : ''}{team.dueToday ? <>; {team.dueToday} with a deadline today</> : ''}.</Line>
        <Line label="NEW">{!ex ? 'Forecasts start after two weeks of cases.' : <>
          {ex.team < 0.5 ? `${weekday}s are usually quiet` : `${about(ex.team).replace(/^./, c => c.toUpperCase())} expected today`}, based on the last {ins.weeks} {weekday}s; {team.openedToday} so far.</>}</Line>
        <Line label="THIS WEEK">{weekText(team.week)}</Line>
        <Line label="PACE">{paceText(team.pace)}</Line>
        <Line label="AT RISK">{riskText(team.atRisk)}</Line>
      </section>
      <section className="cov-fc-block" aria-label="The week ahead">
        <div className="display-font cov-fc-who">Deadlines ahead · whole team</div>
        <DeadlinesAhead ahead={ins.ahead} late={ins.late} withMine={!!you} />
      </section>
      <section className="cov-fc-block" aria-label="Keeping up">
        <KeepingUp backlog={ins.backlog} />
      </section>
      <p className="display-font cov-fc-note">Forecasts are averages of past weeks, so holidays, time off and one-off spikes will throw them off.</p>
    </div>
  )
}
// ── The plan: the list, grouped into the order to work it ──
//   first   past a deadline, escalated to you, or a customer waiting on an update
//   today   deadlines later today, by the clock, and today's batch
//   soon    deadlines in the next few days
//   build   new cases to analyse
//   motion  queued or waiting on someone else: one line, nothing to do yet
const hhmm = d => new Date(d).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })
function planOf(items, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const g = { first: [], today: [], soon: [], build: [], motion: [] }
  items.forEach(x => {
    const r = x.r
    if (r.rank === 0 || r.escalated || r.waiting) g.first.push(x)
    else if (r.due && new Date(r.due) <= end) g.today.push({ ...x, r: { ...r, label: hhmm(r.due) === '23:59' ? 'BY END OF DAY' : `BY ${hhmm(r.due)}` } })
    else if (r.rank <= 2) g.soon.push(x)
    else if (r.rank === 3) g.build.push(x)
    else g.motion.push(x)
  })
  g.today.sort((a, b) => new Date(a.r.due) - new Date(b.r.due))
  return g
}
// What the first thing on the list needs, in words
const NEEDS = {
  response: (late, t) => late ? `its response deadline passed ${t} ago` : `its response is due in ${t}`,
  file:     (late, t) => late ? `it was due to be filed ${t} ago` : `it needs filing within ${t}`,
  regE:     (late, t) => late ? `the Reg E limit passed ${t} ago` : `the Reg E limit is ${t} away`,
  assign:   () => 'it needs an owner',
  screen:   () => 'a possible sanctions match needs review',
  ofac:     (late, t) => late ? 'the OFAC report is late' : `the OFAC report is due in ${t}`,
  sar:      (late, t) => late ? 'the SAR decision is late' : `a SAR decision is due in ${t}`,
}
function startWith(x) {
  if (!x) return null
  const who = `${x.c.id}${x.c.merchant ? ` (${x.c.merchant})` : ''}`
  const what = x.r.waiting ? 'the customer is waiting on an update' : x.r.escalated ? 'it was escalated to you'
    : NEEDS[x.r.key] ? NEEDS[x.r.key](x.r.late, x.r.left) : x.r.rank === 3 ? 'a new case to analyse' : x.r.why.charAt(0).toLowerCase() + x.r.why.slice(1)
  return `Start with ${who}: ${what}.`
}

function Row({ x, i, day }) {
  const { c, r, claim } = x
  return (
    <li>
      <button onClick={() => claim ? openClaim(c.id) : openCase(c.id)} data-yourday-row={i}
        style={{ display:'grid', gridTemplateColumns:'150px 92px minmax(0,1fr) auto', gap:'12px', alignItems:'center', width:'100%', textAlign:'left',
          padding:'9px 18px', background:'none', border:'none', borderTop:'1px solid #EDE7DC', cursor:'pointer' }}
        className="cov-search-row cov-yourday-row">
        <span style={{ display:'inline-flex', alignItems:'center', minWidth:0, maxWidth:'100%', overflow:'hidden' }}>{day.changed(c) && <NewDot />}<Badge tone={r.tone}>{r.label}</Badge></span>
        <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{c.id}</span>
        <span style={{ minWidth:0 }}>
          <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'}</span>
          <span className="mono-font cov-yourday-why" style={{ display:'block', fontSize:'11px', color:'#6B6259', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.why}{c.amount ? ` · ${c.amount}` : ''}</span>
        </span>
        <span className="mono-font desktop-only" style={{ fontSize:'11px', color:'#1A1814' }}>Open →</span>
      </button>
    </li>
  )
}

function Group({ title, note, list, cap, day, children }) {
  if (!list.length && !children) return null
  return (
    <div className="cov-plan-group">
      <div className="cov-plan-head">
        <span className="mono-font cov-plan-title">{title}</span>
        {note && <span className="display-font cov-plan-note">{note}</span>}
      </div>
      <ol style={{ listStyle:'none', margin:0, padding:0 }}>
        {list.slice(0, cap).map((x, i) => <Row key={x.c.id} x={x} i={i} day={day} />)}
        {children}
      </ol>
    </div>
  )
}

export function YourDay({ day, covUser, settings }) {
  const [showAll, setShowAll] = useState(false)
  const { items, scope, counts, comingUp, unowned } = day
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch {} return !o })
  const plan = useMemo(() => planOf(items), [items])
  const batchTime = settings?.batchFileTime || '15:00'
  const batch = plan.motion.filter(x => x.r.rank === 4), waitingOn = plan.motion.filter(x => x.r.rank !== 4)
  const first = plan.first[0] || plan.today[0] || plan.soon[0] || plan.build[0]
  const headline = first ? startWith(first) : 'Nothing needs you today. A clear desk.'
  const sub = [
    scope === 'team' && 'Nothing’s assigned to you, so this is the team’s day.',
    items.length && `${items.length} on ${scope === 'team' ? 'the team’s' : 'your'} list`,
    plan.today.length && `${plan.today.length} due later today`,
    batch.length && `the ${batchTime} batch takes ${batch.length}`,
    plan.build.length && `${plan.build.length} new to analyse`,
  ].filter(Boolean)
  const subText = sub.length ? (scope === 'team' ? `${sub[0]} ${sub.slice(1).join('; ')}` : sub.join('; ')).replace(/^./, c => c.toUpperCase()) + '.' : ''
  const cap = n => showAll ? Infinity : n
  const hidden = Math.max(0, plan.first.length - 5) + Math.max(0, plan.today.length - 5) + Math.max(0, plan.soon.length - 4) + Math.max(0, plan.build.length - 4)
  const refs = list => list.map(x => ({ id: x.c.id }))

  return (
    <section aria-labelledby="your-day" className="mb-8" style={{ border:'1px solid #1A1814', background:'#FAF7F1' }}>
      {/* The whole header folds and unfolds the panel (easier to hit on a phone than the small button) */}
      <div onClick={e => { if (!e.target.closest('button')) toggle() }} className="cov-yourday-head"
        style={{ position:'relative', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px', flexWrap:'wrap', padding:'18px 20px 16px', borderBottom: open ? '1px solid #1A1814' : 'none' }}>
        <div style={{ minWidth:0, flex:'1 1 320px' }}>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#6B6259', marginBottom:'6px' }}>YOUR DAY{scope === 'team' ? ' · THE TEAM’S LIST' : ''}</div>
          <h2 id="your-day" className="display-font" style={{ fontSize:'clamp(20px, 2.2vw, 26px)', fontWeight:600, color:'#1A1814', margin:0, lineHeight:1.25, letterSpacing:'-0.01em' }}>{headline}</h2>
          {subText && <p className="display-font" style={{ margin:'6px 0 0', fontSize:'15px', color:'#57534E', lineHeight:1.45 }}>{subText}</p>}
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
          {!open && counts.urgent > 0 && <Badge tone="danger">{counts.urgent} URGENT</Badge>}
          {!open && counts.todo > 0 && <Badge tone="info">{counts.todo} TO ANALYSE</Badge>}
          {!open && counts.batch > 0 && <Badge tone="neutral">{counts.batch} IN TODAY’S BATCH</Badge>}
          <button onClick={toggle} aria-expanded={open} aria-controls="your-day-body" className="mono-font cov-yourday-toggle"
            style={{ ...foldLook, cursor:'pointer' }}>
            {open ? '▴ HIDE' : '▾ SHOW'}
          </button>
        </div>
      </div>

      {open && (<div id="your-day-body" className="cov-yd-grid">
        <div className="cov-yd-plan">
          {items.length === 0 && <div className="display-font" style={{ padding:'18px', fontSize:'15px', color:'#57534E', fontStyle:'italic' }}>Nothing on the list. Use the time for the cases coming up below.</div>}
          <Group title="START WITH" note="Past a deadline, escalated to you, or a customer waiting" list={plan.first} cap={cap(5)} day={day} />
          <Group title="TODAY, BY THE CLOCK" list={plan.today} cap={cap(5)} day={day}>
            {batch.length > 0 && (
              <li className="cov-plan-batch">
                <Badge tone="neutral">{`BATCH ${batchTime}`}</Badge>
                <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>Today’s batch goes out with {batch.length} case{batch.length === 1 ? '' : 's'}: <Refs parts={refs(batch)} /></span>
              </li>
            )}
          </Group>
          <Group title="IN THE NEXT FEW DAYS" list={plan.soon} cap={cap(4)} day={day} />
          <Group title="NEW, TO ANALYSE" note="Build the case and pick the reason code" list={plan.build} cap={cap(4)} day={day} />
          {waitingOn.length > 0 && (
            <div className="cov-plan-group">
              <div className="cov-plan-head"><span className="mono-font cov-plan-title">IN MOTION</span></div>
              <p className="display-font" style={{ margin:0, padding:'8px 18px 12px', fontSize:'14px', color:'#57534E', borderTop:'1px solid #EDE7DC' }}>
                {waitingOn.length} waiting on the merchant or the network, nothing to do yet: <Refs parts={refs(waitingOn)} />
              </p>
            </div>
          )}
          {hidden > 0 && (
            <div style={{ padding:'8px 18px 12px', borderTop:'1px solid #EDE7DC' }}>
              <Button variant="quiet" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show ${hidden} more`}</Button>
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
                <span style={{ display:'inline-flex', alignItems:'center', color: k.state === 'breached' ? '#991B1B' : k.state === 'soon' ? '#92400E' : '#1E3A5F', fontWeight:500 }}>{day.changed(c) && <NewDot />}{k.state === 'breached' ? `OVERDUE ${short(k)}` : `in ${short(k)}`}</span>
                <span style={{ color:'#57534E' }}>{c.id}</span>
                <span className="cov-comingup-what" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'} <span className="cov-comingup-why" style={{ color:'#6B6259' }}><span className="cov-comingup-dot">· </span>{k.label}</span></span>
                <span className="desktop-only" style={{ color:'#6B6259' }}>{c.assignedTo ? c.assignedTo.split('@')[0] : 'unassigned'}</span>
              </button>
            ))}
          </div>
        </div>
        <Forecast day={day} settings={settings} />
      </div>)}
    </section>
  )
}

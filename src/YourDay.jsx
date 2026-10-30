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

// New cases per day for the last 14 days; today's bar is solid for cases so far, with a dashed outline
// up to how many usually arrive by the end of the day (the forecast)
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
        {hover != null ? label(days[hover], hover) : (() => {
          const now = days[days.length - 1]?.count || 0
          const sw = dashed => <svg width="9" height="9" aria-hidden="true" style={{ display:'inline-block', verticalAlign:'-1px', marginRight:'4px' }}><rect x="0.5" y="0.5" width="8" height="8" rx="1" fill={dashed ? 'none' : '#1A1814'} stroke="#1A1814" strokeWidth="1" strokeDasharray={dashed ? '2 1.5' : undefined} /></svg>
          return <>NEW CASES, LAST 14 DAYS · today {sw(false)}{now} so far{expected != null && expected > now && <> · {sw(true)}about {Math.round(expected)} by day’s end</>}</>
        })()}
      </div>
    </div>
  )
}

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

// The next five working days: deadlines (solid) and the new cases a day like it usually brings (dashed)
function WeekAhead({ ahead }) {
  const [hover, setHover] = useState(null)
  const W = 300, H = 64, gw = W / ahead.length, bw = 16
  const max = Math.max(1, ...ahead.map(d => Math.max(d.deadlines, d.expected || 0)))
  const h = v => (v / max) * (H - 14)
  const name = d => d.today ? 'Today' : WEEKDAYS[d.date.getDay()].slice(0, 3)
  const label = d => `${d.today ? 'Today' : WEEKDAYS[d.date.getDay()]}: ${nOf(d.deadlines, 'deadline')}${d.mine != null ? ` (${d.mine} yours)` : ''}${d.expected != null ? `, usually ${about(d.expected).replace('about ', '')} new` : ''}`
  const heavy = ahead.slice(1).reduce((m, d) => (d.deadlines + (d.expected || 0)) > (m ? m.deadlines + (m.expected || 0) : 0) ? d : m, null)
  const sw = dashed => <svg width="9" height="9" aria-hidden="true" style={{ display:'inline-block', verticalAlign:'-1px', marginRight:'4px' }}><rect x="0.5" y="0.5" width="8" height="8" rx="1" fill={dashed ? 'none' : '#8A7F72'} stroke={dashed ? '#1A1814' : '#8A7F72'} strokeWidth="1" strokeDasharray={dashed ? '2 1.5' : undefined} /></svg>
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} width="100%" role="img" aria-label={ahead.map(label).join('. ')} onMouseLeave={() => setHover(null)} style={{ display:'block', overflow:'visible' }}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="#D4CCBC" />
        {ahead.map((d, i) => {
          const x = i * gw + gw / 2
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * gw} y="0" width={gw} height={H + 16} fill="transparent" />
              {d.deadlines > 0 && <rect x={x - bw - 1} y={H - h(d.deadlines)} width={bw} height={h(d.deadlines)} rx="2" fill={hover === i ? '#3F3A35' : d.today ? '#1A1814' : '#8A7F72'} />}
              <text x={x - bw / 2 - 1} y={H - h(d.deadlines) - 3} textAnchor="middle" fontSize="9" fill="#57534E" fontFamily="JetBrains Mono, monospace">{d.deadlines}</text>
              {d.expected != null && d.expected >= 0.5 && <rect x={x + 1.5} y={H - h(d.expected) + 0.5} width={bw - 1} height={h(d.expected) - 0.5} rx="2" fill="none" stroke="#1A1814" strokeDasharray="2 1.5" />}
              <text x={x} y={H + 12} textAnchor="middle" fontSize="9.5" fill={d.today ? '#1A1814' : '#6B6259'} fontWeight={d.today ? 600 : 400} fontFamily="JetBrains Mono, monospace">{name(d)}</text>
              <title>{label(d)}</title>
            </g>
          )
        })}
      </svg>
      <div className="mono-font" aria-live="polite" style={{ fontSize:'10px', color:'#6B6259', marginTop:'6px', minHeight:'14px' }}>
        {hover != null ? label(ahead[hover]) : <>{sw(false)}deadlines · {sw(true)}new cases a day like it usually brings</>}
      </div>
      {heavy && (heavy.deadlines > 0 || heavy.expected >= 0.5) && (
        <p className="display-font" style={{ margin:'8px 0 0', fontSize:'14px', lineHeight:1.45, color:'#1A1814' }}>
          Of the days ahead, {WEEKDAYS[heavy.date.getDay()]} looks the busiest: {[heavy.deadlines > 0 && nOf(heavy.deadlines, 'deadline'), heavy.expected >= 0.5 && `${about(heavy.expected)} new case${Math.round(heavy.expected) === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}.
        </p>
      )}
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
        <div className="display-font cov-fc-who">The week ahead · whole team</div>
        <WeekAhead ahead={ins.ahead} />
      </section>
      <section className="cov-fc-block" aria-label="New cases, last 14 days">
        <IntakeBars days={ins.days} expected={ex ? ex.team : null} />
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

// ═══════════════════════════════════════════════════════════════════════════════
// YOUR DAY — Home's centre: the plan for today, and the forecast
// ═══════════════════════════════════════════════════════════════════════════════
// Ranks open cases by their clocks (clocks.mjs — the same ones the reminders
// bell and the daily email use): anything breached, escalations to you, clocks
// due soon, new cases waiting for analysis, and what goes out in today's batch.
// Shows the user's own cases (assigned or escalated to them) when there are
// any, otherwise the team's, grouped into the order to work them (planOf), with
// the team's other deadlines this week below. It doesn't fold: tabs under the headline
// show one thing at a time in a panel of fixed height, so it never takes over Home —
// the list (scrolling inside), the forecast (YourDayViews.jsx tiles), the deadlines ahead
// with the picked day's cases, and the backlog with what came in and went out.
import React, { useEffect, useMemo, useState } from 'react'
import { allThreadCases, stageOf, openCase, takeCase } from './CaseThread.jsx'
import { caseClocks, pressing, sortClocks } from './clocks.mjs'
import { Badge, Button, NewDot } from './ui.jsx'
import { insights } from './insights.js'
import { Refs } from './FrontPage.jsx'
import { ForecastTiles, DeadlinesPanel, BacklogPanel } from './YourDayViews.jsx'
import { canWrite } from './auth.js'
import { poolRole, tasksFor, HELP } from './Pool.jsx'
import { isMerchantCase } from './sides.mjs'
import { briefPeriod, noteVisit, changedSince } from './brief.js'
import { waitingClaims, silentDays, claimTotal } from './claims.mjs'
import { listClaims, openClaim } from './claimsData.js'
import { alarmList } from './alarmData.js'
import { usePatterns } from './Alarms.jsx'

const TAB_KEY = 'cov_yourday_tab'     // per browser: which of its tabs is showing
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
  const canTake = !!covUser?.email && canWrite()
  return { ...work, ins, me, platformMode, claims, alarms, patterns, period, prev, changed, canTake }
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

// Take it: on a case no one owns, for anyone who can work cases
const TakeIt = ({ c, day, style }) => !c.assignedTo && day.canTake ? (
  <button type="button" className="mono-font cov-take-it" style={style} onClick={() => takeCase(c.id)} aria-label={`Take ${c.id}`}>TAKE IT</button>
) : null

function Row({ x, i, day }) {
  const { c, r, claim } = x
  const take = !claim && !c.assignedTo && day.canTake
  return (
    <li style={take ? { display:'flex', alignItems:'center', borderTop:'1px solid #EDE7DC' } : undefined}>
      <button onClick={() => claim ? openClaim(c.id) : openCase(c.id)} data-yourday-row={i}
        style={{ display:'grid', gridTemplateColumns:'150px 92px minmax(0,1fr) auto', gap:'12px', alignItems:'center', width:'100%', textAlign:'left', flex:1, minWidth:0,
          padding:'9px 18px', background:'none', border:'none', borderTop: take ? 'none' : '1px solid #EDE7DC', cursor:'pointer' }}
        className="cov-search-row cov-yourday-row">
        <span style={{ display:'inline-flex', alignItems:'center', minWidth:0, maxWidth:'100%', overflow:'hidden' }}>{day.changed(c) && <NewDot />}<Badge tone={r.tone}>{r.label}</Badge></span>
        <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{c.id}</span>
        <span style={{ minWidth:0 }}>
          <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'}</span>
          <span className="mono-font cov-yourday-why" style={{ display:'block', fontSize:'11px', color:'#6B6259', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.why}{c.amount ? ` · ${c.amount}` : ''}</span>
        </span>
        <span className="mono-font desktop-only" style={{ fontSize:'11px', color:'#1A1814' }}>Open →</span>
      </button>
      {take && <TakeIt c={c} day={day} style={{ marginRight:'18px' }} />}
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

// The tabs, each with a count when it has one: what's on the list, what's late, what's open
const TABS = (day, items) => [
  ['list', 'THE LIST', items.length || null],
  ['forecast', 'FORECAST', null],
  ['ahead', 'DEADLINES AHEAD', day.ins.late?.length ? `${day.ins.late.length} LATE` : null, '#991B1B'],
  ['backlog', 'KEEPING UP', day.ins.backlog?.length ? `${day.ins.backlog[day.ins.backlog.length - 1].open} OPEN` : null],
]

export function YourDay({ day, covUser, settings }) {
  const [showAll, setShowAll] = useState(false)
  const { items, scope, comingUp, unowned } = day
  const plan = useMemo(() => planOf(items), [items])
  // Inside, one thing at a time: the list, the forecast, the deadlines ahead, the backlog
  const [tab, setTab] = useState(() => { try { return localStorage.getItem(TAB_KEY) || 'list' } catch { return 'list' } })
  const pickTab = t => { setTab(t); try { localStorage.setItem(TAB_KEY, t) } catch {} }
  // Pools: asked to help, ones you're in, your own, then open ones you could join (urgent first)
  const pools = useMemo(() => {
    const me = covUser?.email || '', order = { invited: 0, member: 1, owner: 2, open: 3 }
    const firstName = s => String(s || '').split(/[\s@]/)[0]
    const needs = p => p.ask || (p.help || []).map(h => HELP[h] || h).join(', ').toLowerCase() || 'help with this case'
    return (day.all || []).map(c => ({ c, role: poolRole(c, me) })).filter(x => x.role)
      .sort((a, b) => order[a.role] - order[b.role] || (b.c.pool.urgent - a.c.pool.urgent) || new Date(b.c.pool.openedAt) - new Date(a.c.pool.openedAt))
      .map(({ c, role }) => {
        const p = c.pool, mine = tasksFor(c, me).length, open = (p.tasks || []).filter(t => !t.done).length
        const r = role === 'invited' ? { tone: 'info', label: 'ASKED TO HELP', why: `${firstName(p.openedBy?.name) || 'The owner'} needs: ${needs(p)}` }
          : role === 'member' ? { tone: 'info', label: 'IN THE POOL', why: mine ? `${mine} task${mine === 1 ? '' : 's'} for you · ${open} open in all` : `${open} open task${open === 1 ? '' : 's'} · ${needs(p)}` }
          : role === 'owner' ? { tone: 'dark', label: 'YOUR POOL', why: `${(p.members || []).length} helping · ${(p.tasks || []).length - open} of ${(p.tasks || []).length} tasks done` }
          : { tone: p.urgent ? 'danger' : 'neutral', label: p.urgent ? 'URGENT POOL' : 'OPEN POOL', why: `${firstName(c.assignedName || c.assignedTo)} needs: ${needs(p)}` }
        return { c, r }
      })
  }, [day.all, covUser?.email])
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
  const hidden = Math.max(0, pools.length - 4) + Math.max(0, plan.first.length - 5) + Math.max(0, plan.today.length - 5) + Math.max(0, plan.soon.length - 4) + Math.max(0, plan.build.length - 4)
  const refs = list => list.map(x => ({ id: x.c.id }))

  return (
    <section aria-labelledby="your-day" className="mb-8" style={{ border:'1px solid #1A1814', background:'#FAF7F1' }}>
      <div className="cov-yourday-head">
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#6B6259', marginBottom:'5px' }}>YOUR DAY{scope === 'team' ? ' · THE TEAM’S LIST' : ''}</div>
        <h2 id="your-day" className="display-font" style={{ fontSize:'clamp(20px, 2.2vw, 25px)', fontWeight:600, color:'#1A1814', margin:0, lineHeight:1.25, letterSpacing:'-0.01em' }}>{headline}</h2>
        {subText && <p className="display-font" style={{ margin:'5px 0 0', fontSize:'15px', color:'#57534E', lineHeight:1.45 }}>{subText}</p>}
      </div>

      <div id="your-day-body">
        <div role="tablist" aria-label="Your day" className="cov-yd-tabs">
          {TABS(day, items).map(([k, l, n, tone]) => (
            <button key={k} type="button" role="tab" id={`yd-tab-${k}`} aria-selected={tab === k} aria-controls={`yd-pane-${k}`} onClick={() => pickTab(k)} className="mono-font cov-yd-tab"
              onKeyDown={e => { const ks = TABS(day, items).map(t => t[0]), i = ks.indexOf(k); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const nx = ks[(i + (e.key === 'ArrowRight' ? 1 : ks.length - 1)) % ks.length]; pickTab(nx); document.getElementById(`yd-tab-${nx}`)?.focus() } }}>
              {l}{n != null && <span className="cov-yd-tab-n" style={tone ? { color: tone } : undefined}>{n}</span>}
            </button>
          ))}
        </div>
        <div className="cov-yd-panel">
        {tab === 'forecast' && <div role="tabpanel" id="yd-pane-forecast" aria-labelledby="yd-tab-forecast"><ForecastTiles ins={day.ins} unowned={unowned} settings={settings} /></div>}
        {tab === 'ahead' && <div role="tabpanel" id="yd-pane-ahead" aria-labelledby="yd-tab-ahead"><DeadlinesPanel ahead={day.ins.ahead} late={day.ins.late} withMine={!!day.ins.you} /></div>}
        {tab === 'backlog' && <div role="tabpanel" id="yd-pane-backlog" aria-labelledby="yd-tab-backlog"><BacklogPanel backlog={day.ins.backlog} pace={day.ins.team.pace} /></div>}
        {(tab === 'list' || !['forecast', 'ahead', 'backlog'].includes(tab)) && <div role="tabpanel" id="yd-pane-list" aria-labelledby="yd-tab-list" className="cov-yd-plan cov-yd-scroll" tabIndex={0}>
          {items.length === 0 && <div className="display-font" style={{ padding:'18px', fontSize:'15px', color:'#57534E', fontStyle:'italic' }}>Nothing on the list. Use the time for the cases coming up below.</div>}
          <Group title="START WITH" note="Past a deadline, escalated to you, or a customer waiting" list={plan.first} cap={cap(5)} day={day} />
          <Group title="POOLS" note="Cases the team is working together" list={pools} cap={cap(4)} day={day} />
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
                {settings?.autoAssign ? '.' : <> — take one with <strong>Take it</strong> below, assign them in Multi, or turn on auto-assignment in Settings → Workflow.</>}
              </div>
            )}
            {comingUp.map(({ c, k }) => (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <button onClick={() => openCase(c.id)} className="cov-search-row mono-font cov-comingup-row"
                style={{ display:'grid', gridTemplateColumns:'86px 92px minmax(0,1fr) auto', gap:'12px', alignItems:'center', width:'100%', flex:1, minWidth:0, textAlign:'left',
                  background:'none', border:'none', padding:'5px 0', cursor:'pointer', fontSize:'11px', color:'#1A1814' }}>
                <span style={{ display:'inline-flex', alignItems:'center', color: k.state === 'breached' ? '#991B1B' : k.state === 'soon' ? '#92400E' : '#1E3A5F', fontWeight:500 }}>{day.changed(c) && <NewDot />}{k.state === 'breached' ? `OVERDUE ${short(k)}` : `in ${short(k)}`}</span>
                <span style={{ color:'#57534E' }}>{c.id}</span>
                <span className="cov-comingup-what" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant || '—'} <span className="cov-comingup-why" style={{ color:'#6B6259' }}><span className="cov-comingup-dot">· </span>{k.label}</span></span>
                <span className="desktop-only" style={{ color: c.assignedTo ? '#6B6259' : '#92400E' }}>{c.assignedTo ? c.assignedTo.split('@')[0] : 'no owner'}</span>
              </button>
              <TakeIt c={c} day={day} />
              </div>
            ))}
          </div>
        </div>}
        </div>
      </div>
    </section>
  )
}

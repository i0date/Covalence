// ═══════════════════════════════════════════════════════════════════════════════
// YOUR DAY — the Forecast, Deadlines ahead and Keeping up tabs
// ═══════════════════════════════════════════════════════════════════════════════
// Each tab fills the same fixed panel, so switching doesn't move the page:
//   ForecastTiles   five figures for the team, each with a small trend and your own figure
//   DeadlinesPanel  the late deadlines and the next five working days as bars, and the
//                   picked day's cases beside them (Late first)
//   BacklogPanel    open cases over 14 days as a line, with what came in and went out each
//                   day as bars under it, and the net change beside it
// Figures come from insights.js; every tile's full sentence is its tooltip and screen-reader text.
import React, { useState } from 'react'
import { openCase } from './CaseThread.jsx'
import { money, WEEKDAYS } from './insights.js'

const INK = '#1A1814', MUTED = '#8A7F72', LINE = '#D4CCBC', REST = '#B5AA9A', LATE = '#991B1B', LATE_REST = '#D9A3A3', OUT = '#5F7F6A', WARN = '#92400E'
const MONO = 'JetBrains Mono, monospace'
const nOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const about = v => v < 0.5 ? 'none' : v < 1.5 ? 'about one' : `about ${Math.round(v)}`
const shortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ── A small trend: a line (or bars) with the last point marked ──
function Spark({ values, bars, color = INK, label }) {
  if (!values?.length) return null
  const W = 120, H = 40, n = values.length, max = Math.max(1, ...values), min = bars ? 0 : Math.min(...values)
  const x = i => n === 1 ? W / 2 : 2 + (i / (n - 1)) * (W - 4)
  const y = v => 3 + (1 - (v - min) / Math.max(1, max - min)) * (H - 6)
  if (bars) {
    const bw = Math.max(2, (W / n) - 2)
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label={label} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke={LINE} vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => <rect key={i} x={i * (W / n) + 1} y={H - Math.max(v ? 2 : 0, (v / max) * (H - 2))} width={bw} height={Math.max(v ? 2 : 0, (v / max) * (H - 2))} rx="1" fill={i === n - 1 ? color : REST} />)}
      </svg>
    )
  }
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label={label} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <path d={`${d} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Part of a whole, as one bar: how many of the open cases are at risk
function Meter({ part, whole, label }) {
  const f = whole ? Math.min(1, part / whole) : 0
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
      <div className="mono-font" style={{ fontSize: '10px', color: '#57534E', marginBottom: '6px' }}>{part} of {whole} open</div>
      <div style={{ height: '10px', background: '#EDE7DC', borderRadius: '2px', overflow: 'hidden' }}><div style={{ width: `${f * 100}%`, height: '100%', background: part ? LATE : 'transparent', borderRadius: '2px' }} /></div>
    </div>
  )
}

function Tile({ label, value, tone, caption, you, spark, title }) {
  return (
    <div className="cov-ydv-tile" title={title}>
      <div className="mono-font cov-ydv-tile-label">{label}</div>
      <div className="display-font cov-ydv-tile-value" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="display-font cov-ydv-tile-caption">{caption}</div>
      <div className="cov-ydv-tile-spark">{spark}</div>
      {you != null && <div className="mono-font cov-ydv-tile-you">YOU · {you}</div>}
      <span className="sr-only">{title}</span>
    </div>
  )
}

export function ForecastTiles({ ins, unowned, settings }) {
  const team = ins.team, you = ins.you, ex = ins.expected, weekday = WEEKDAYS[new Date().getDay()]
  const opens = (ins.backlog || []).map(d => d.open), ins14 = (ins.days || []).map(d => d.count), outs = (ins.backlog || []).map(d => d.closed)
  const first = opens[0] ?? team.open, net = team.open - first
  const p = team.pace, trend = p.last7 - p.prev7
  const r = team.atRisk
  // One sentence on what matters most, from the same figures
  const read = r.cases ? `${money(r.amount, r.currency)} is on cases with a deadline missed or close: start there.`
    : net > 0 ? `More is coming in than going out: open cases went from ${first} to ${team.open} in two weeks.`
    : team.week.total ? `${nOf(team.week.total, 'deadline')} in the next 7 days, most on ${team.week.busiestLabel}.`
    : 'A quiet stretch: nothing late, nothing piling up.'
  return (
    <div className="cov-ydv-forecast">
      <p className="display-font cov-ydv-read">{read}</p>
      <div className="cov-ydv-tiles">
        <Tile label="OPEN" value={team.open} tone={null}
          caption={unowned ? <span style={{ color: WARN }}>{unowned} without an owner</span> : net ? `${net > 0 ? '+' : ''}${net} in two weeks` : 'steady for two weeks'}
          spark={<Spark values={opens} label={`Open cases over 14 days: ${opens.join(', ')}`} />} you={you ? you.open : null}
          title={`${team.open} open${unowned ? `, ${unowned} without an owner past the ${settings?.slaAssignHours ?? 24}h target` : ''}${team.dueToday ? `; ${team.dueToday} with a deadline today` : ''}.`} />
        <Tile label="NEW TODAY" value={team.openedToday}
          caption={!ex ? 'forecasts start after two weeks' : ex.team < 0.5 ? `${weekday}s are usually quiet` : `usually ${about(ex.team).replace('about ', '~')} on a ${weekday}`}
          spark={<Spark bars values={ins14} label={`New cases each day, last 14 days: ${ins14.join(', ')}`} />}
          you={you ? (ex?.mine == null ? '—' : `~${Math.round(ex.mine)} expected`) : null}
          title={!ex ? 'Forecasts start after two weeks of cases.' : `${team.openedToday} so far today; ${ex.team < 0.5 ? `${weekday}s are usually quiet` : `${about(ex.team)} expected`}, based on the last ${ins.weeks} ${weekday}s.`} />
        <Tile label="NEXT 7 DAYS" value={team.week.total} caption={team.week.total ? `deadlines · busiest ${team.week.busiestLabel} (${team.week.byDay[team.week.busiest]})` : 'no deadlines due'}
          spark={<Spark bars values={team.week.byDay} label={`Deadlines on each of the next 7 days: ${team.week.byDay.join(', ')}`} />}
          you={you ? `${you.week.total} due` : null}
          title={team.week.total ? `${nOf(team.week.total, 'response, filing or Reg E deadline')} in the next 7 days; the busiest is ${team.week.busiestLabel}.` : 'No response, filing or Reg E deadlines in the next 7 days.'} />
        <Tile label="CLOSED THIS WEEK" value={p.last7}
          caption={!p.enough ? 'none closed in four weeks' : <>{trend ? <span style={{ color: trend > 0 ? '#065F46' : LATE }}>{trend > 0 ? '▲' : '▼'} {Math.abs(trend)} vs last week</span> : 'same as last week'}{p.clearDays != null && p.openNow > 0 ? ` · clears in ~${p.clearDays}d` : ''}</>}
          spark={<Spark bars values={outs} color={OUT} label={`Cases closed each day, last 14 days: ${outs.join(', ')}`} />}
          you={you ? `${you.pace.last7} closed` : null}
          title={!p.enough ? 'No cases closed in the last four weeks yet.' : `${p.last7} closed this week, ${trend ? `${Math.abs(trend)} ${trend > 0 ? 'more' : 'fewer'} than` : 'the same as'} the week before.${p.clearDays != null && p.openNow > 0 ? ` At this rate the ${p.openNow} open clear in about ${nOf(p.clearDays, 'day')}.` : ''}`} />
        <Tile label="AT RISK" value={r.cases ? money(r.amount, r.currency) : '—'} tone={r.cases ? LATE : null}
          caption={r.cases ? `on ${nOf(r.cases, 'case')} with a deadline missed or close` : 'nothing with a deadline missed or close'}
          spark={<Meter part={r.cases} whole={team.open} label={`${r.cases} of ${team.open} open cases at risk`} />} you={you ? (you.atRisk.cases ? money(you.atRisk.amount, you.atRisk.currency) : 'nothing') : null}
          title={r.cases ? `${money(r.amount, r.currency)} on ${nOf(r.cases, 'case')} with a deadline missed or close.` : 'Nothing with a deadline missed or close.'} />
      </div>
      <p className="display-font cov-ydv-foot">Averages of past weeks: holidays, time off and one-off spikes throw them off. Point at a figure for what it’s based on.</p>
    </div>
  )
}

// ── Deadlines ahead: bars, and the picked day's cases beside them ──
export function DeadlinesPanel({ ahead, late, withMine }) {
  const cols = [...(late.length ? [{ late: true, due: late, deadlines: late.length, mine: late.filter(e => e.mine).length }] : []), ...ahead]
  const firstBusy = cols.findIndex(d => d.deadlines)
  const [pick, setPick] = useState(firstBusy < 0 ? 0 : firstBusy)
  const [hover, setHover] = useState(null)
  const W = 520, H = 170, top = 18, foot = 40, gw = W / cols.length, bw = Math.min(56, gw - 22)
  const max = Math.max(1, ...cols.map(d => d.deadlines))
  const h = v => (v / max) * (H - top)
  const name = d => d.late ? 'Late' : d.today ? 'Today' : WEEKDAYS[d.date.getDay()].slice(0, 3)
  const full = d => d.late ? 'Already late' : d.today ? 'Today' : `${WEEKDAYS[d.date.getDay()]} ${shortDate(d.date)}`
  const sel = cols[pick] || cols[0]
  const heavy = ahead.reduce((m, d) => d.deadlines > (m ? m.deadlines : 0) ? d : m, null)
  const lead = late.length ? <><strong style={{ color: LATE }}>{nOf(late.length, 'deadline')} already missed</strong>{withMine && cols[0].mine ? ` (${cols[0].mine} yours)` : ''}: clear those first.{heavy ? ` Then ${heavy.today ? 'today' : WEEKDAYS[heavy.date.getDay()]} is the busiest day ahead, with ${heavy.deadlines}.` : ''}</>
    : heavy ? <>{heavy.today ? 'Today' : WEEKDAYS[heavy.date.getDay()]} is the busiest day ahead, with {nOf(heavy.deadlines, 'deadline')}.</> : 'No deadlines in the days ahead.'
  return (
    <div className="cov-ydv-split">
      <div className="cov-ydv-chart">
        <p className="display-font cov-ydv-read">{lead}</p>
        <svg viewBox={`0 0 ${W} ${H + foot}`} width="100%" role="group" aria-label="Deadlines by day: late, then the next five working days" style={{ display: 'block', overflow: 'visible' }} onMouseLeave={() => setHover(null)}>
          {[0.5, 1].map(f => <line key={f} x1="0" x2={W} y1={H - (H - top) * f} y2={H - (H - top) * f} stroke="#EDE7DC" strokeDasharray="2 3" />)}
          <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke={LINE} />
          {cols.map((d, i) => {
            const x = i * gw + gw / 2, mineN = withMine ? d.mine || 0 : 0, restN = d.deadlines - mineN, y0 = H - h(d.deadlines)
            const on = pick === i, hov = hover === i
            return (
              <g key={i} role="button" tabIndex={0} aria-pressed={on} aria-label={`${full(d)}: ${nOf(d.deadlines, 'deadline')}${withMine && mineN ? `, ${mineN} yours` : ''}`}
                style={{ cursor: 'pointer', outline: 'none' }} onClick={() => setPick(i)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(i) } }}>
                <rect x={i * gw + 2} y="0" width={gw - 4} height={H + foot} rx="3" fill={on ? '#F1EBE0' : hov ? '#F7F3EC' : 'transparent'} />
                {d.deadlines === 0 && <rect x={x - bw / 2} y={H - 2} width={bw} height="2" fill={LINE} />}
                {mineN > 0 && <rect x={x - bw / 2} y={H - h(mineN)} width={bw} height={h(mineN)} rx="3" fill={d.late ? LATE : INK} />}
                {restN > 0 && <rect x={x - bw / 2} y={y0} width={bw} height={h(restN) - (mineN > 0 ? 2 : 0)} rx="3" fill={d.late ? LATE_REST : REST} />}
                <text x={x} y={y0 - 6} textAnchor="middle" fontSize="15" fontWeight="600" fill={d.late && d.deadlines ? LATE : INK} fontFamily={MONO}>{d.deadlines}</text>
                <text x={x} y={H + 16} textAnchor="middle" fontSize="11" fontWeight={on || d.today || d.late ? 600 : 400} fill={d.late ? LATE : on ? INK : '#57534E'} fontFamily={MONO}>{name(d)}</text>
                <text x={x} y={H + 31} textAnchor="middle" fontSize="9.5" fill={MUTED} fontFamily={MONO}>{d.late ? 'missed' : `${shortDate(d.date)}${d.weekend ? ' +wknd' : ''}`}</text>
              </g>
            )
          })}
        </svg>
        <div className="mono-font cov-ydv-legend">
          {withMine && <span><i style={{ background: INK }} />yours</span>}<span><i style={{ background: REST }} />{withMine ? 'rest of the team' : 'deadlines'}</span>
          {late.length > 0 && <span><i style={{ background: LATE }} />missed</span>}<span style={{ color: MUTED }}>a weekend deadline counts on the Friday before</span>
        </div>
      </div>
      <div className="cov-ydv-side" aria-live="polite">
        <div className="mono-font cov-ydv-side-head" style={{ color: sel?.late ? LATE : INK }}>
          {sel ? `${full(sel).toUpperCase()} · ${nOf(sel.deadlines, 'DEADLINE', 'DEADLINES')}` : ''}
          {sel && !sel.late && sel.expected != null && <span style={{ color: MUTED, fontWeight: 400 }}> · ~{Math.round(sel.expected)} NEW USUALLY</span>}
        </div>
        {!sel?.deadlines ? <p className="display-font" style={{ margin: '10px 0 0', fontSize: '14px', color: '#6B6259', fontStyle: 'italic' }}>Nothing due{sel?.late ? '' : ' that day'}.</p> : (
          <ul className="cov-ydv-side-list">
            {sel.due.slice().sort((a, b) => (b.mine - a.mine) || a.id.localeCompare(b.id)).map((e, k) => (
              <li key={e.id + e.key + k}>
                <button type="button" onClick={() => openCase(e.id)} className="cov-ydv-case">
                  <span className="mono-font cov-ydv-case-id">{e.id}</span>
                  <span className="display-font cov-ydv-case-name">{e.merchant || '—'}</span>
                  <span className="mono-font cov-ydv-case-why" style={{ color: sel.late ? LATE : '#6B6259' }}>{e.label}{withMine && e.mine ? <strong style={{ color: INK }}> · YOURS</strong> : null}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Keeping up: the backlog line, and what came in and went out each day ──
export function BacklogPanel({ backlog, pace }) {
  const [hover, setHover] = useState(null)
  if (!backlog?.length) return <p className="display-font" style={{ margin: 0, padding: '18px', color: '#6B6259' }}>Nothing to show yet.</p>
  const n = backlog.length, W = 560, LH = 120, GAP = 14, BH = 46, H = LH + GAP + BH * 2
  const opens = backlog.map(d => d.open), lo = Math.min(...opens), hi = Math.max(...opens), pad = Math.max(1, Math.ceil((hi - lo) * 0.2))
  const min = Math.max(0, lo - pad), max = hi + pad
  const step = W / n, x = i => step * i + step / 2
  const y = v => 8 + (1 - (v - min) / Math.max(1, max - min)) * (LH - 16)
  const flow = Math.max(1, ...backlog.map(d => Math.max(d.opened, d.closed))), mid = LH + GAP + BH
  const fh = v => (v / flow) * (BH - 4)
  const path = backlog.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.open).toFixed(1)}`).join(' ')
  const first = backlog[0], last = backlog[n - 1], net = last.open - first.open
  const inN = backlog.slice(1).reduce((s, d) => s + d.opened, 0), outN = backlog.slice(1).reduce((s, d) => s + d.closed, 0)
  const dateOf = (d, i) => i === n - 1 ? 'Today' : d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const hv = hover != null ? backlog[hover] : null
  const onMove = e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)))) }
  const verdict = net > 0 && inN > outN ? { text: 'More is coming in than going out.', tone: LATE } : net < 0 ? { text: 'The backlog is shrinking.', tone: '#065F46' } : { text: 'Holding steady.', tone: INK }
  return (
    <div className="cov-ydv-split">
      <div className="cov-ydv-chart">
        <p className="display-font cov-ydv-read"><strong style={{ color: verdict.tone }}>{verdict.text}</strong> Open cases went from {first.open} to {last.open} over two weeks.</p>
        <svg viewBox={`0 -14 ${W} ${H + 32}`} width="100%" role="img" aria-label={`Open cases each day for 14 days: ${opens.join(', ')}. Came in: ${backlog.map(d => d.opened).join(', ')}. Closed: ${backlog.map(d => d.closed).join(', ')}.`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
          <text x="0" y="-4" fontSize="9.5" fill={MUTED} fontFamily={MONO} letterSpacing="1">OPEN</text>
          <line x1="0" x2={W} y1={LH} y2={LH} stroke={LINE} />
          <path d={`${path} L${x(n - 1)},${LH} L${x(0)},${LH} Z`} fill={INK} opacity="0.07" />
          <path d={path} fill="none" stroke={INK} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          <text x={x(n - 1)} y={y(last.open) - 9} textAnchor="end" fontSize="13" fontWeight="600" fill={INK} fontFamily={MONO}>{last.open}</text>
          <text x={x(0)} y={y(first.open) - 8} fontSize="11" fill="#57534E" fontFamily={MONO}>{first.open}</text>
          <text x="0" y={LH + GAP - 2} fontSize="9.5" fill={MUTED} fontFamily={MONO} letterSpacing="1">CAME IN ↑ · CLOSED ↓</text>
          <line x1="0" x2={W} y1={mid} y2={mid} stroke={LINE} />
          {backlog.map((d, i) => (
            <g key={i} opacity={hover == null || hover === i ? 1 : 0.4}>
              {d.opened > 0 && <rect x={x(i) - Math.min(14, step * 0.32)} y={mid - fh(d.opened) - 1} width={Math.min(28, step * 0.64)} height={fh(d.opened)} rx="2" fill={INK} />}
              {d.closed > 0 && <rect x={x(i) - Math.min(14, step * 0.32)} y={mid + 1} width={Math.min(28, step * 0.64)} height={fh(d.closed)} rx="2" fill={OUT} />}
            </g>
          ))}
          {hover != null && <>
            <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke={MUTED} strokeDasharray="2 2" />
            <circle cx={x(hover)} cy={y(hv.open)} r="4.5" fill={INK} stroke="#FAF7F1" strokeWidth="2" />
          </>}
          {[0, Math.floor((n - 1) / 2), n - 1].map(i => <text key={i} x={x(i)} y={H + 14} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="9.5" fill={MUTED} fontFamily={MONO}>{i === n - 1 ? 'Today' : shortDate(backlog[i].date)}</text>)}
        </svg>
        <div className="mono-font cov-ydv-legend">
          {hv ? <span style={{ color: INK }}>{dateOf(hv, hover)}: {hv.open} open · {hv.opened} came in · {hv.closed} closed</span>
            : <><span><i style={{ background: INK }} />came in</span><span><i style={{ background: OUT }} />closed</span><span style={{ color: MUTED }}>point at a day for its numbers</span></>}
        </div>
      </div>
      <div className="cov-ydv-side cov-ydv-stats">
        <div><div className="mono-font cov-ydv-tile-label">NET, 14 DAYS</div><div className="display-font cov-ydv-tile-value" style={{ color: net > 0 ? LATE : net < 0 ? '#065F46' : INK }}>{net > 0 ? '+' : ''}{net}</div><div className="display-font cov-ydv-tile-caption">open cases</div></div>
        <div className="cov-ydv-stat-pair">
          <div><div className="mono-font cov-ydv-tile-label">CAME IN</div><div className="display-font cov-ydv-stat">{inN}</div></div>
          <div><div className="mono-font cov-ydv-tile-label">CLOSED</div><div className="display-font cov-ydv-stat" style={{ color: OUT }}>{outN}</div></div>
        </div>
        <div><div className="mono-font cov-ydv-tile-label">AT THIS PACE</div><div className="display-font cov-ydv-tile-caption" style={{ fontSize: '15px', color: INK }}>
          {pace?.enough && pace.clearDays != null && pace.openNow > 0 ? <>The {pace.openNow} open clear in about <strong>{nOf(pace.clearDays, 'day')}</strong>.</> : 'Not enough closed yet to say.'}
        </div></div>
      </div>
    </div>
  )
}

// ── The Team tab's charts: the team's open work by what it needs, and how old it is ──
// Team-level only: nothing here is split by person.
//   parts  [{ key, label, count, color }] in the order of the groups below the charts
//   ages   open cases' age in days
const AGE_BUCKETS = [['< 1 day', 0, 1], ['1–3 days', 1, 3], ['3–7 days', 3, 7], ['1–2 weeks', 7, 14], ['2–4 weeks', 14, 28], ['4+ weeks', 28, Infinity]]
export function TeamCharts({ parts, ages, onPick }) {
  const total = parts.reduce((a, p) => a + p.count, 0)
  const buckets = AGE_BUCKETS.map(([label, lo, hi]) => ({ label, n: ages.filter(a => a >= lo && a < hi).length, old: lo >= 14 }))
  const maxB = Math.max(1, ...buckets.map(b => b.n)), old = buckets.filter(b => b.old).reduce((a, b) => a + b.n, 0)
  const median = ages.length ? [...ages].sort((a, b) => a - b)[Math.floor(ages.length / 2)] : 0
  return (
    <div className="cov-ydv-team">
      <section aria-label="The team's open work, by what it needs" className="cov-ydv-team-block">
        <div className="mono-font cov-ydv-tile-label">WHAT THE OPEN WORK NEEDS · {total}</div>
        <div className="cov-ydv-stack" role="img" aria-label={parts.map(p => `${p.label} ${p.count}`).join(', ')}>
          {parts.filter(p => p.count).map(p => <span key={p.key} style={{ flexGrow: p.count, background: p.color }} title={`${p.label}: ${p.count}`} />)}
        </div>
        <ul className="cov-ydv-stack-key">
          {parts.map(p => (
            <li key={p.key}>
              <button type="button" onClick={() => onPick?.(p.key)} disabled={!p.count}>
                <i style={{ background: p.color }} /><span className="display-font">{p.label}</span>
                <strong className="mono-font">{p.count}</strong>
                <span className="mono-font cov-ydv-stack-pct">{total ? Math.round((p.count / total) * 100) : 0}%</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="How old the open cases are" className="cov-ydv-team-block">
        <div className="mono-font cov-ydv-tile-label">AGE OF OPEN CASES · MEDIAN {median} DAY{median === 1 ? '' : 'S'}</div>
        <div className="cov-ydv-ages" role="img" aria-label={buckets.map(b => `${b.label}: ${b.n}`).join(', ')}>
          {buckets.map(b => (
            <div key={b.label} className="cov-ydv-age" title={`${b.label}: ${nOf(b.n, 'case')}`}>
              <span className="mono-font cov-ydv-age-n" style={b.old && b.n ? { color: LATE } : undefined}>{b.n}</span>
              <span className="cov-ydv-age-bar" style={{ height: `${Math.max(b.n ? 6 : 2, (b.n / maxB) * 100)}%`, background: b.n ? (b.old ? LATE_REST : REST) : LINE }} />
              <span className="mono-font cov-ydv-age-label">{b.label}</span>
            </div>
          ))}
        </div>
        <p className="display-font cov-ydv-team-note">{old ? <><strong style={{ color: LATE }}>{nOf(old, 'case')}</strong> open for more than two weeks.</> : 'Nothing open for more than two weeks.'}</p>
      </section>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRONT PAGE — the top of Home, set like the front of a paper
// ═══════════════════════════════════════════════════════════════════════════════
// The date and the period the brief covers, the greeting, and one calm sentence
// on what happened since you were last in. What needs care (cases past a deadline,
// customers waiting, a possible pattern) is counted on one line beneath it and
// opens on a tap, so the morning starts with a recap, not a list of problems.
// What to do today is Your day's job, just below.
import React, { useMemo, useState } from 'react'
import { openCase } from './CaseThread.jsx'
import { openClaim } from './claimsData.js'
import { brief } from './brief.js'
import { greeting } from './insights.js'
// Opens the alarm form filled in from a pattern (the same event Alarms.jsx raiseFromPattern sends)
const raiseFromPattern = p => window.dispatchEvent(new CustomEvent('cov:alarm-open', { detail: { prefill: { level: p.level, title: p.title, doNow: p.doNow } } }))
const OPEN_KEY = 'cov_brief_open'   // per browser: whether the brief's details are open

// Case and claim references; a run of more than three reads "A B C +2 more", and the
// "+2 more" opens the rest in place
export function Refs({ parts }) {
  const [all, setAll] = useState(false)
  const out = []
  for (let i = 0; i < parts.length; i++) {
    if (typeof parts[i] === 'string') { out.push(parts[i]); continue }
    const run = []
    while (i < parts.length && typeof parts[i] === 'object') run.push(parts[i++])
    i--
    const shown = all ? run : run.slice(0, 3)
    shown.forEach((p, j) => {
      const id = p.id || p.claim
      out.push(<button key={id + i} type="button" className="mono-font cov-ref" onClick={() => p.claim ? openClaim(id) : openCase(id)}
        aria-label={`Open ${id}`}>{id}</button>)
      if (j < shown.length - 1) out.push(' ')
    })
    if (run.length > 3) out.push(<React.Fragment key={'more' + i}> <button type="button" className="mono-font cov-ref-more" aria-expanded={all}
      onClick={e => { e.stopPropagation(); setAll(a => !a) }}>{all ? 'show fewer' : `+${run.length - 3} more`}</button></React.Fragment>)
  }
  return out.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)
}

export function FrontPage({ day, covUser, settings }) {
  const { lead, alarm, happened, attention } = useMemo(() => brief(day.all, { claims: day.claims, alarms: day.alarms, patterns: day.patterns, me: day.me, settings, period: day.period }),
    [day.all, day.claims, day.alarms, day.patterns, day.me, settings, day.period])
  const now = new Date()
  const first = (covUser?.name || '').replace(/\s*\(.*\)$/, '').split(/[\s@]/)[0]
  const name = first && first[0].toUpperCase() + first.slice(1)
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === '1' } catch { return false } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch {} return !o })
  const count = it => `${it.count} ${it.kicker}`
  const any = happened.length + attention.length > 0

  const Group = ({ title, items }) => items.length > 0 && (
    <div className="cov-front-group">
      <div className="mono-font cov-front-group-title">{title}</div>
      <div className="cov-front-items">
        {items.map(it => (
          <article key={it.key} className="cov-front-item">
            <div className="mono-font cov-front-kicker">{it.kicker}</div>
            <p className="display-font cov-front-text">
              <Refs parts={it.text} />
              {it.pattern && <> <button type="button" className="mono-font cov-ref" onClick={() => raiseFromPattern(it.pattern)}>LOOK AT IT →</button></>}
            </p>
          </article>
        ))}
      </div>
    </div>
  )

  return (
    <header className="cov-front" aria-labelledby="cov-front-lead">
      <div className="mono-font cov-front-dateline">
        <span>{now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase()}</span>
        <span>THE BRIEF · {day.period.label.toUpperCase()}</span>
      </div>
      <p className="display-font cov-front-greeting">{greeting(now)}{name ? <>, {name}</> : null}.</p>
      <h1 id="cov-front-lead" className="display-font cov-front-lead">{lead}</h1>
      {alarm && (
        <div className="cov-front-alarm">
          <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#991B1B', fontWeight:600 }}>LEVEL {alarm.level} ALARM OPEN</span>
          <span className="display-font" style={{ fontSize:'15px', color:'#1A1814', minWidth:0 }}>{alarm.title}</span>
          <button type="button" className="mono-font cov-ref" onClick={() => window.dispatchEvent(new Event('cov:alarm-open'))}>OPEN IT →</button>
        </div>
      )}
      {any && (
        <>
          <button type="button" className="mono-font cov-front-fold" onClick={toggle} aria-expanded={open} aria-controls="cov-front-details">
            <span className="cov-front-fold-label">THE DETAILS</span>
            <span className="cov-front-fold-counts">
              {[...happened, ...attention].map((it, i) => <span key={it.key}>{i ? <span aria-hidden="true" className="cov-front-sep">·</span> : null}{count(it)}</span>)}
            </span>
            <span className="cov-front-fold-btn">{open ? '▴ HIDE' : '▾ SHOW'}</span>
          </button>
          {open && (
            <div id="cov-front-details">
              <Group title="WHAT HAPPENED" items={happened} />
              <Group title="WORTH A LOOK" items={attention} />
            </div>
          )}
        </>
      )}
    </header>
  )
}

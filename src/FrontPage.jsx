// ═══════════════════════════════════════════════════════════════════════════════
// FRONT PAGE — the top of Home, set like the front of a paper
// ═══════════════════════════════════════════════════════════════════════════════
// The date and the period the brief covers, the greeting, one lead sentence about
// the two things that matter most today, then the brief's items in columns, each
// under a small label. Every case and claim it names is a reference you can open.
// It stays in view whether Your day below is open or folded.
import React, { useMemo } from 'react'
import { openCase } from './CaseThread.jsx'
import { openClaim } from './claimsData.js'
import { brief } from './brief.js'
import { greeting } from './insights.js'

const TONE = { danger: '#991B1B', warn: '#92400E', good: '#065F46' }

// Case and claim references; a run of more than three reads "A, B, C and 2 more"
export function Refs({ parts }) {
  const out = []
  for (let i = 0; i < parts.length; i++) {
    if (typeof parts[i] === 'string') { out.push(parts[i]); continue }
    const run = []
    while (i < parts.length && typeof parts[i] === 'object') run.push(parts[i++])
    i--
    run.slice(0, 3).forEach((p, j) => {
      const id = p.id || p.claim
      out.push(<button key={id + i} type="button" className="mono-font cov-ref" onClick={() => p.claim ? openClaim(id) : openCase(id)}
        aria-label={`Open ${id}`}>{id}</button>)
      if (j < Math.min(run.length, 3) - 1) out.push(' ')
    })
    if (run.length > 3) out.push(<span key={'more' + i} className="mono-font" style={{ fontSize:'11px', color:'#6B6259' }}> +{run.length - 3} more</span>)
  }
  return out.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)
}

export function FrontPage({ day, covUser, settings }) {
  const { lead, items } = useMemo(() => brief(day.all, { claims: day.claims, alarms: day.alarms, me: day.me, settings, from: day.period.from }),
    [day.all, day.claims, day.alarms, day.me, settings, day.period])
  const now = new Date()
  const first = (covUser?.name || '').replace(/\s*\(.*\)$/, '').split(/[\s@]/)[0]
  const name = first && first[0].toUpperCase() + first.slice(1)
  const since = day.period.label.replace(/^Since /, '').toUpperCase()

  return (
    <header className="cov-front" aria-labelledby="cov-front-lead">
      <div className="mono-font cov-front-dateline">
        <span>{now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase()}</span>
        <span>THE BRIEF · SINCE {since}</span>
      </div>
      <p className="display-font cov-front-greeting">{greeting(now)}{name ? <>, {name}</> : null}.</p>
      <h1 id="cov-front-lead" className="display-font cov-front-lead">
        {lead || 'A quiet start: nothing new came in, nothing was decided, and nothing is due in the next 24 hours.'}
      </h1>
      {items.length > 0 && (
        <div className="cov-front-items">
          {items.map(it => (
            <article key={it.key} className="cov-front-item">
              <div className="mono-font cov-front-kicker" style={{ color: TONE[it.tone] || '#57534E' }}>{it.kicker}</div>
              <p className="display-font cov-front-text">
                <Refs parts={it.text} />
                {it.alarm && <> <button type="button" className="mono-font cov-ref" onClick={() => window.dispatchEvent(new Event('cov:alarm-open'))}>OPEN THE ALARM →</button></>}
              </p>
            </article>
          ))}
        </div>
      )}
    </header>
  )
}

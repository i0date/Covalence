// ═══════════════════════════════════════════════════════════════════════════════
// INSIGHTS — the money, where it leaks, and how an exam would go
// ═══════════════════════════════════════════════════════════════════════════════
// Not a tool with a number: a page to read once a week. Three sections, each from
// the case records (insightsData.mjs), each case behind a figure one click away.
// Multi → Intel stays where it is, beside the filing queue it describes.
import React, { useMemo } from 'react'
import { allThreadCases } from '../CaseThread.jsx'
import { isMerchantCase } from '../sides.mjs'
import { money } from '../insights.js'
import { moneyView, leaks, examReady, EXAM_CHECKS, LEAK_MIN } from '../insightsData.mjs'
import { Refs } from '../FrontPage.jsx'

const usd = n => money(n, 'USD')
const ids = list => list.map(c => ({ id: c.id }))

function Section({ kicker, title, intro, children }) {
  return (
    <section className="cov-ins-section">
      <div className="mono-font cov-ins-kicker">{kicker}</div>
      <h2 className="display-font cov-ins-title">{title}</h2>
      {intro && <p className="display-font cov-ins-intro">{intro}</p>}
      {children}
    </section>
  )
}

function Figure({ label, value, sub, refs, tone }) {
  return (
    <div className="cov-ins-figure">
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color: tone === 'danger' ? '#991B1B' : tone === 'warn' ? '#92400E' : '#57534E' }}>{label}</div>
      <div className="display-font" style={{ fontSize:'32px', fontWeight:600, lineHeight:1.1, color:'#1A1814', margin:'4px 0 2px' }}>{value}</div>
      {sub && <div className="display-font" style={{ fontSize:'13px', color:'#57534E', lineHeight:1.4 }}>{sub}</div>}
      {refs?.length > 0 && <div style={{ marginTop:'6px' }}><Refs parts={ids(refs)} /></div>}
    </div>
  )
}

export function InsightsView({ outcomes, settings, platformMode }) {
  const cases = useMemo(() => allThreadCases(outcomes).filter(c => platformMode === 'merchant' ? isMerchantCase(c) : !isMerchantCase(c)), [outcomes, platformMode])
  const m = useMemo(() => moneyView(cases, { settings }), [cases, settings])
  const lk = useMemo(() => leaks(cases), [cases])
  const ex = useMemo(() => examReady(cases, { settings }), [cases, settings])
  const issuer = platformMode !== 'merchant'
  const due = d => d ? new Date(d).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : ''

  return (
    <div className="triage-root" style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <div style={{ borderBottom:'1px solid #D4CCBC', marginBottom:'8px', paddingBottom:'24px' }}>
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.25em', color:'#A8A29E', marginBottom:'12px' }}>COVALENCE · READ ONCE A WEEK</div>
        <h1 className="display-font text-stone-900" style={{ fontSize:'clamp(40px,6vw,72px)', letterSpacing:'-0.03em', lineHeight:1, margin:0 }}>
          <span style={{ fontWeight:700 }}>In</span><span style={{ fontStyle:'italic', fontWeight:500 }}>sights</span>
        </h1>
        <p className="display-font text-stone-500 mt-3" style={{ fontSize:'14px', lineHeight:1.5, maxWidth:'560px' }}>
          The money in play, where cases are being lost and what that costs, and how your records would stand up to an exam. Every figure is worked out from your cases; click any case to see it.
        </p>
      </div>

      {/* ── Money ── */}
      <Section kicker="01 · MONEY" title={issuer ? 'Provisional credit and recoveries' : 'Recoveries'}
        intro={issuer ? 'Provisional credit is money you’ve credited to customers while you investigate. Decide before the Reg E limit, or it becomes final and can’t be reversed.' : 'What came back and what didn’t, over the last 90 days.'}>
        <div className="cov-ins-figures">
          {issuer && <Figure label="PROVISIONAL CREDIT OUT" value={usd(m.credited.amount)} sub={m.credited.cases.length ? `on ${m.credited.cases.length} open case${m.credited.cases.length === 1 ? '' : 's'}` : 'None outstanding.'} />}
          {issuer && <Figure label="BECOMES FINAL IN 10 DAYS" tone={m.finalSoon.cases.length ? 'warn' : undefined} value={usd(m.finalSoon.amount)}
            sub={m.finalSoon.cases.length ? `unless decided — the first on ${due(m.finalSoon.first)}` : 'Nothing close to the limit.'} refs={m.finalSoon.cases} />}
          {issuer && <Figure label="PAST THE REG E LIMIT" tone={m.pastLimit.cases.length ? 'danger' : undefined} value={usd(m.pastLimit.amount)}
            sub={m.pastLimit.cases.length ? 'credit you can no longer reverse' : 'Nothing past the limit.'} refs={m.pastLimit.cases} />}
          <Figure label="RECOVERED · 90 DAYS" value={usd(m.recovered.amount)} sub={`${m.recovered.cases.length} case${m.recovered.cases.length === 1 ? '' : 's'} won`} />
          <Figure label="LOST · 90 DAYS" value={usd(m.lost.amount)} sub={`${m.lost.cases.length} case${m.lost.cases.length === 1 ? '' : 's'} decided against you`} />
        </div>
      </Section>

      {/* ── Leaks ── */}
      <Section kicker="02 · LEAKS" title="Where cases are lost"
        intro={`From the ${lk.decided} case${lk.decided === 1 ? '' : 's'} decided in the last year, by reason code, most money lost first.`}>
        {lk.findings.length > 0 && (
          <div style={{ display:'grid', gap:'10px', marginBottom:'18px' }}>
            {lk.findings.slice(0, 3).map(f => (
              <div key={f.code + f.feature} className="cov-ins-finding">
                <p className="display-font" style={{ margin:0, fontSize:'18px', lineHeight:1.4, color:'#1A1814' }}>
                  You lose <strong>{f.lossWithout}%</strong> of {f.code} cases without {f.feature}, and {f.lossWith}% with it. Closing that gap is worth about <strong>{usd(f.worthQuarter)} a quarter</strong> at last year’s volume.
                </p>
                <p className="mono-font" style={{ margin:'6px 0 0', fontSize:'10px', letterSpacing:'0.08em', color:'#6B6259' }}>BASED ON {f.without} CASES WITHOUT IT AND {f.withCount} WITH IT</p>
              </div>
            ))}
          </div>
        )}
        {lk.findings.length === 0 && lk.decided > 0 && (
          <p className="display-font" style={{ fontSize:'14px', color:'#57534E', fontStyle:'italic', margin:'0 0 14px' }}>
            Findings on what evidence changes the outcome appear once a reason code has {LEAK_MIN} decided cases with it and {LEAK_MIN} without.
          </p>
        )}
        {lk.byCode.length === 0 ? (
          <p className="display-font" style={{ fontSize:'14px', color:'#57534E', fontStyle:'italic', margin:0 }}>No cases decided in the last year yet.</p>
        ) : (
          <table className="cov-ins-table">
            <thead><tr><th>Reason</th><th>Decided</th><th>Win rate</th><th>Lost</th><th className="cov-ins-hide">Cases lost</th></tr></thead>
            <tbody>
              {lk.byCode.slice(0, 8).map(g => (
                <tr key={g.key}>
                  <td><span className="mono-font" style={{ fontSize:'12px' }}>{g.key}</span>{g.title && <span className="display-font" style={{ color:'#57534E' }}> · {g.title}</span>}</td>
                  <td>{g.decided}</td>
                  <td>{g.winRate}%</td>
                  <td>{g.lost ? usd(g.lostAmount) : '—'}</td>
                  <td className="cov-ins-hide"><Refs parts={ids(g.cases.filter(c => c.status === 'lost'))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Exam readiness ── */}
      <Section kicker="03 · EXAM READINESS" title="If an examiner walked in today"
        intro="Each open case, and each case closed in the last year, checked against what an examiner asks for. A check of what Covalence can see in the records; it doesn’t replace your compliance review.">
        <div style={{ display:'flex', gap:'28px', alignItems:'flex-start', flexWrap:'wrap' }}>
          <div style={{ minWidth:'180px' }}>
            <div className="display-font" style={{ fontSize:'64px', fontWeight:600, lineHeight:1, color: ex.score == null ? '#8A7F72' : ex.score >= 90 ? '#065F46' : ex.score >= 70 ? '#92400E' : '#991B1B' }}>
              {ex.score == null ? '—' : `${ex.score}%`}
            </div>
            <div className="display-font" style={{ fontSize:'14px', color:'#57534E', marginTop:'6px' }}>{ex.complete} of {ex.checked} case records complete</div>
          </div>
          <div style={{ flex:'1 1 420px', minWidth:0 }}>
            {Object.entries(EXAM_CHECKS).map(([k, chk]) => {
              const list = ex.gaps[k]
              return (
                <div key={k} className="cov-ins-check">
                  <span className="mono-font" style={{ fontSize:'11px', fontWeight:600, color: list.length ? '#991B1B' : '#065F46', width:'28px', flexShrink:0 }}>{list.length ? list.length : '✓'}</span>
                  <span style={{ minWidth:0, flex:1 }}>
                    <span className="display-font" style={{ display:'block', fontSize:'15px', color:'#1A1814' }}>{chk.label}</span>
                    <span className="mono-font" style={{ display:'block', fontSize:'10px', letterSpacing:'0.06em', color:'#6B6259' }}>{chk.why.toUpperCase()}</span>
                    {list.length > 0 && <span style={{ display:'block', marginTop:'4px' }}><Refs parts={ids(list)} /></span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Section>
    </div>
  )
}

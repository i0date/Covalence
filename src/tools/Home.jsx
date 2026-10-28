// 000 HOME — The Brief: stats, deadlines, case list
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { YourDay } from '../YourDay.jsx'
import { isDemoCase, allThreadCases, stageOf, PipelineDots, StatusChip } from '../CaseThread.jsx'
import { DEFAULT_SETTINGS } from '../shared.jsx'

// ═══════════════════════════════════════════════════════════════════════════════
// HOME VIEW
// ═══════════════════════════════════════════════════════════════════════════════
const RANGES = [['7', '7D'], ['30', '30D'], ['60', '60D'], ['90', '90D'], ['all', 'ALL']]

export function HomeView({ outcomes, settings: _ps, setActiveSection, platformMode, onLoadDemo, onClearDemo, covUser }) {
  // outcomes comes from the root, which stays in sync with every tool via the outcome subscribers
  const [tourOpen, setTourOpen] = React.useState(false)
  // Adaptive Brief: full intro for the first few visits, then a one-line version that can be expanded
  const [briefOpen, setBriefOpen] = React.useState(() => {
    try {
      const pref = localStorage.getItem('cov_brief_open')
      if (pref !== null) return pref === '1'
      // One visit per browser session (Home remounts on demo load and in dev StrictMode)
      let visits = parseInt(localStorage.getItem('cov_home_visits') || '0')
      if (!sessionStorage.getItem('cov_visit_counted')) {
        visits += 1
        localStorage.setItem('cov_home_visits', String(visits))
        sessionStorage.setItem('cov_visit_counted', '1')
      }
      return visits <= 3
    } catch { return true }
  })
  const toggleBrief = () => setBriefOpen(o => { try { localStorage.setItem('cov_brief_open', o ? '0' : '1') } catch {} ; return !o })
  const [caseFilter, setCaseFilter] = React.useState('open')
  const hasDemo = outcomes.some(isDemoCase)
  const [tourSlide, setTourSlide] = React.useState(0)
  const settings = React.useMemo(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } }
  }, [])
  // The full case list folds away (Your day already shows what needs attention); how it starts is a default in Settings
  const [casesOpen, setCasesOpen] = React.useState(() => settings.homeCasesOpen === 'open' || settings.homeCasesOpen === true)
  const toggleCases = () => setCasesOpen(o => !o)
  // The period the cases and numbers cover: starts at the Settings default, changeable here
  const [range, setRange] = React.useState(() => RANGES.some(([v]) => v === String(settings.homeRange)) ? String(settings.homeRange) : '60')
  const windowDays = range === 'all' ? null : Number(range)
  const since = windowDays ? new Date(Date.now() - windowDays * 86400000) : null
  const inRange = o => { if (!since) return true; const d = new Date(o.date || o.createdAt || o.ts || 0); return isNaN(d) || d > since }
  const rangeText = windowDays ? `last ${windowDays} days` : 'all time'
  const recent   = outcomes.filter(inRange)
  const active   = platformMode === 'merchant' ? recent.filter(o => o.mode === 'merchant') : recent.filter(o => o.mode !== 'merchant')
  const resolved = active.filter(o => o.status === 'won' || o.status === 'lost')
  const won      = active.filter(o => o.status === 'won')
  const inProg   = active.filter(o => ['filed','representment','pre_arb','rebuttal_prep','submitted'].includes(o.status))
  const winRate  = resolved.length > 0 ? Math.round(won.length / resolved.length * 100) : null

  return (
    <div className="triage-root" style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      {briefOpen ? (
        <div className="mb-10 pb-8" style={{ borderBottom:'1px solid #D4CCBC' }}>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(48px,7vw,80px)', letterSpacing:'-0.02em', lineHeight:1.05 }}>
            The<br /><span style={{ fontStyle:'italic', fontWeight:500 }}>Brief</span>
          </h1>
          <p className="display-font text-stone-600 mt-4" style={{ fontSize:'clamp(14px,1.6vw,16px)', maxWidth:'520px', lineHeight:1.5 }}>
            From first call to final submission — triage disputes, build the case, queue for batch filing, generate network-compliant packages, screen against sanctions and work AML investigations and SARs, score portfolios for funding, coordinate across institutions, and command fraud incidents. Eight tools in three areas, one case record.
          </p>
          <button onClick={toggleBrief} className="mono-font" style={{ marginTop:'14px', fontSize:'10px', letterSpacing:'0.14em', background:'none', border:'none', color:'#A8A29E', cursor:'pointer', padding:0 }}>
            COLLAPSE INTRO ↑
          </button>
        </div>
      ) : (
        <div className="mb-6 pb-4" style={{ borderBottom:'1px solid #D4CCBC', display:'flex', alignItems:'baseline', gap:'14px', flexWrap:'wrap' }}>
          <h1 className="display-font font-bold text-stone-900" style={{ fontSize:'32px', letterSpacing:'-0.02em', lineHeight:1 }}>
            The <span style={{ fontStyle:'italic', fontWeight:500 }}>Brief</span>
          </h1>
          <span className="display-font text-stone-500" style={{ fontSize:'14px' }}>Eight tools in three areas, one case record.</span>
          <button onClick={toggleBrief} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', background:'none', border:'none', color:'#A8A29E', cursor:'pointer', padding:0 }}>
            SHOW INTRO ↓
          </button>
        </div>
      )}

      {/* ── The eight tools in three areas (orientation) + tour, under the Brief ── */}
      <div className="mb-8 cov-home-tools" style={{ display:'flex', gap:'12px', alignItems:'stretch', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', flex:'1 1 560px' }}>
          {[
            ['DISPUTES', [['001', 'TRIAGE', 'triage', '#EDE9E3'], ['002', 'DESK', 'desk', '#E8E3DC'], ['003', 'MULTI', 'multi', '#E3DDD5'], ['004', 'FILE', 'file', '#DDD7CE']], '4 1 320px'],
            ['COMPLIANCE', [['005', 'LICIT', 'licit', '#D8D1C7']], '1 1 90px'],
            ['RECOVERY', [['006', 'DFA', 'dfa', '#D2CBC1'], ['007', 'DUO', 'duo', '#CCC4B8'], ['008', 'TRIO', 'trio', '#C6BEB2']], '3 1 240px'],
          ].map(([area, tools, flex]) => (
            <div key={area} style={{ flex, minWidth:0 }}>
              <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.18em', color:'#6B6259', marginBottom:'4px' }}>{area}</div>
              <div style={{ display:'flex', gap:'1px', background:'#D4CCBC' }}>
                {tools.map(([num, name, section, bg]) => (
                  <button key={num} onClick={() => setActiveSection(section)}
                    className="mono-font"
                    style={{ background:bg, border:'none', cursor:'pointer', padding:'9px 14px', flex:'1 1 auto', textAlign:'left', transition:'background 0.15s', minWidth:'72px' }}
                    onMouseEnter={e => e.currentTarget.style.background='#B8B0A4'}
                    onMouseLeave={e => e.currentTarget.style.background=bg}>
                    <div style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E' }}>{num}</div>
                    <div style={{ fontSize:'11px', letterSpacing:'0.1em', color:'#1A1814', fontWeight:700 }}>{name}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => { setTourSlide(0); setTourOpen(true) }}
          className="mono-font"
          style={{ fontSize:'10px', letterSpacing:'0.16em', padding:'9px 18px', background:'#2D2922', border:'none', color:'#E8E3DC', cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.background='#1A1814'; e.currentTarget.style.color='#FAF7F1' }}
          onMouseLeave={e => { e.currentTarget.style.background='#2D2922'; e.currentTarget.style.color='#E8E3DC' }}>
          ◎ &nbsp;TAKE THE TOUR
        </button>
      </div>

      {hasDemo && (
        <div className="mb-6 mono-font" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', flexWrap:'wrap', border:'1px dashed #B8B0A4', padding:'10px 14px', fontSize:'10px', letterSpacing:'0.1em', color:'#57534E' }}>
          <span>DEMO INSTITUTION LOADED — fictional cases across every stage. They stay in this browser and are never shared.</span>
          <button onClick={onClearDemo} style={{ background:'none', border:'1px solid #78716C', color:'#57534E', padding:'4px 10px', cursor:'pointer', fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.12em' }}>CLEAR DEMO DATA</button>
        </div>
      )}

      {/* ── Your day: what needs attention, most urgent first ── */}
      <YourDay outcomes={outcomes} covUser={covUser} settings={settings} platformMode={platformMode} />

      {/* ── Tour: one slide per tool ── */}
      {tourOpen && (() => {
        const SLIDES = [
          { num:'001', name:'Triage', section:'triage', color:'#4C1D95',
            problem:'Most institutions receive dispute first-contacts in free text — a phone call, a chat message, a form that asks only for the amount and the date. What gets lost is not information but structure.',
            tool:'Triage is the entry point. It walks through transaction type, reason code, dollar amount, product, and filing window — and produces a structured handoff to the Dispute Desk.',
            detail:'Filing windows are strict. Context, unlike time, can be recovered.' },
          { num:'002', name:'Dispute Desk', section:'desk', color:'#1E3A5F',
            problem:'A chargeback case is a sequence — intake, investigation, documentation, rebuttal, filing, outcome. Most ops teams manage this sequence across disconnected systems. Each handoff is a place where context falls out.',
            tool:'The Dispute Desk is a case management layer. Each case carries its own timeline, reason code, status, evidence packet, and agent notes. Evidence lives with the case, not beside it.',
            detail:'A document uploaded in Desk travels with the case into Multi, into filing, into the audit log.' },
          { num:'003', name:'Multi', section:'multi', color:'#064E3B',
            problem:'One dispute costs roughly the same to work whether the recovery is forty dollars or four thousand. Fixed operational cost against variable recovery — that asymmetry is the core economics problem in dispute management.',
            tool:'Multi is the batch operations layer. It groups cases by network and surfaces fraud and service queues separately for group filing or case-by-case package generation. My Queue lets each analyst work their own assigned cases. Intel surfaces portfolio intelligence — win rates by reason code, merchant dispute patterns, team throughput, and DFA calibration — all derived from your live case log.',
            detail:'The batch summary bar shows total dollar exposure queued and countdown to the next auto-file window. Portfolio Analytics now lives in Intel, not buried in a collapse.' },
          { num:'004', name:'File', section:'file', color:'#92400E',
            problem:'Filing a chargeback is not the end of a case. The network receives the package, a timer starts, and if the merchant representments — a response is required, grounded in the original submission.',
            tool:'File is a submission history log and lifecycle tracker. Every case filed through Covalence leaves a record here. The CB pipeline runs from 1st CB through NTW INVSTG → Merchant Resp → Pre-Arb → Arbitration → Won/Lost. Connect lives here — import disputes directly from Visa Resolve Online or Mastercard Connect via CSV, and configure live API access once network credentials are available.',
            detail:'Cases that advance to any post-filing stage stay visible here. Filter by All / Active / Won / Lost. Network integrations (Visa DMS, Mastercard MDRI, Ethoca, Verifi) are built and waiting on credentials.' },
          { num:'005', name:'Licit', section:'licit', color:'#7F1D1D',
            problem:'A dispute and a money-laundering case are often the same case. The romance-scam victim disputing a transfer is also the trail to a mule account, a sanctioned wallet, a SAR. Most institutions work them in separate systems and key the facts twice.',
            tool:'Licit is the compliance desk on the same case record. Every case is screened against OFAC’s sanctions lists automatically; AML rules link cases by customer, payee and wallet; the SAR builder gathers the facts and drafts the narrative with every statement traced to a case.',
            detail:'Deadlines are built in: one business day to review a sanctions hit, ten to report a confirmed match to OFAC, thirty from detection to decide on a SAR.' },
          { num:'006', name:'DFA', section:'dfa', color:'#1A1814',
            problem:'A dispute portfolio is an asset. The right to recover from a filed chargeback has economic value before it is won. But the pricing of a dispute portfolio is opaque and often tilted against the institution selling.',
            tool:'The Dispute Funding Analyzer scores individual claims across recovery rate, filing window proximity, reason code strength, and documentation quality — graded A through D with estimated advance rates.',
            detail:'The portfolio view surfaces concentration risk, window risk, and the drag of low-grade claims on the aggregate score.' },
          { num:'007', name:'Duo', section:'duo', color:'#1E3A5F',
            problem:'Fraud does not stop at one institution. A card compromised in one breach surfaces at dozens of FIs within hours. The information that would interrupt these patterns is distributed across institutions with limited mechanisms to share it in time.',
            tool:'Duo is a real-time collaboration layer for two institutions working a shared case or fraud pattern. Both sides connect to a live session, contribute case data, and maintain a joint record — synced through Supabase.',
            detail:'The primary obstacle to inter-institutional coordination is not willingness but friction. Duo removes the friction.' },
          { num:'008', name:'Trio', section:'trio', color:'#7F1D1D',
            problem:'The hardest fraud events involve three parties simultaneously — your institution, the receiving platform or FI, and the cardholder population in between. These require coordination across all three layers at once.',
            tool:'Trio is an incident command module with two modes: Operational (war room, linked cases, SAR tracking, receiving FI coordination) and Strategy (pattern intelligence, post-incident debrief, threat brief generation).',
            detail:'Fraud incidents at scale are not case management problems. They are coordination problems. Trio is a room, not a record.' },
        ]
        const slide = SLIDES[tourSlide]
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}
            onClick={e => { if (e.target === e.currentTarget) setTourOpen(false) }}>
            <div style={{ background:'#1A1814', border:'1px solid #44403C', width:'100%', maxWidth:'560px', display:'flex', flexDirection:'column' }}>
              {/* Header */}
              <div style={{ borderBottom:'1px solid #2D2922', padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', gap:'6px' }}>
                  {SLIDES.map((_,i) => (
                    <button key={i} onClick={() => setTourSlide(i)}
                      style={{ width:'24px', height:'3px', background: i===tourSlide?'#D4CCBC':'#3D3A35', border:'none', cursor:'pointer', padding:0, transition:'background 0.15s' }}/>
                  ))}
                </div>
                <button onClick={() => setTourOpen(false)} style={{ background:'transparent', border:'none', color:'#57534E', cursor:'pointer', fontSize:'16px', lineHeight:1 }}>✕</button>
              </div>
              {/* Slide */}
              <div style={{ padding:'32px 28px', flex:1 }}>
                <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', marginBottom:'8px' }}>{slide.num} — {tourSlide+1} OF 7</div>
                <div className="display-font" style={{ fontSize:'28px', fontWeight:700, color:'#F5F1EA', lineHeight:1.1, marginBottom:'24px' }}>
                  {slide.name.split('').map((c,i) => <span key={i} style={{ fontStyle: i>0&&i%3===0?'italic':'normal' }}>{c}</span>)}
                </div>
                <div style={{ borderLeft:`2px solid ${slide.color}`, paddingLeft:'16px', marginBottom:'16px' }}>
                  <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', marginBottom:'6px' }}>THE PROBLEM</div>
                  <div className="display-font" style={{ fontSize:'13px', color:'#A8A29E', lineHeight:1.7 }}>{slide.problem}</div>
                </div>
                <div style={{ borderLeft:`2px solid ${slide.color}`, paddingLeft:'16px', marginBottom:'16px' }}>
                  <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', marginBottom:'6px' }}>THE TOOL</div>
                  <div className="display-font" style={{ fontSize:'13px', color:'#E7E4DF', lineHeight:1.7 }}>{slide.tool}</div>
                </div>
                <div className="mono-font" style={{ fontSize:'10px', color:'#57534E', fontStyle:'italic', lineHeight:1.6 }}>{slide.detail}</div>
              </div>
              {/* Footer nav */}
              <div style={{ borderTop:'1px solid #2D2922', padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <button onClick={() => setTourSlide(p => Math.max(0,p-1))} disabled={tourSlide===0}
                  className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'8px 16px', background:'transparent', border:'1px solid #3D3A35', color:tourSlide===0?'#3D3A35':'#78716C', cursor:tourSlide===0?'default':'pointer' }}>
                  ← PREV
                </button>
                <button onClick={() => { setActiveSection(slide.section); setTourOpen(false) }}
                  className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'6px 14px', background:'transparent', border:'1px solid #57534E', color:'#78716C', cursor:'pointer' }}>
                  OPEN {slide.name.toUpperCase()} →
                </button>
                {tourSlide < SLIDES.length - 1
                  ? <button onClick={() => setTourSlide(p => p+1)} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'8px 16px', background:'#D4CCBC', border:'none', color:'#1A1814', cursor:'pointer' }}>NEXT →</button>
                  : <button onClick={() => setTourOpen(false)} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'8px 16px', background:'#D4CCBC', border:'none', color:'#1A1814', cursor:'pointer' }}>DONE ✓</button>
                }
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Date range for the cases and numbers below ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px', flexWrap:'wrap', margin:'4px 0 10px' }}>
        <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.15em', color:'#78716C' }}>CASES AND NUMBERS · {rangeText.toUpperCase()}</span>
        <div role="group" aria-label="Date range" style={{ display:'flex', border:'1px solid #D4CCBC' }}>
          {RANGES.map(([v, l], i) => (
            <button key={v} onClick={() => setRange(v)} aria-pressed={range === v} className="mono-font"
              style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'5px 10px', border:'none', borderLeft: i ? '1px solid #D4CCBC' : 'none', cursor:'pointer',
                background: range === v ? '#1A1814' : '#FAF7F1', color: range === v ? '#F5F1EA' : '#57534E' }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── Cases: every case across all eight tools, with where it sits in the pipeline ── */}
      {(() => {
        const everything = allThreadCases(outcomes).filter(o => platformMode === 'merchant' ? o.mode === 'merchant' : o.mode !== 'merchant')
        const thread = everything.filter(inRange)
        const dueIn = o => o.nextRespDate && stageOf(o) !== 'closed' ? Math.round((new Date(o.nextRespDate + 'T12:00:00') - new Date()) / 86400000) : null
        const FILTERS = [
          { id:'open',   label:'OPEN',          test: o => stageOf(o) !== 'closed' },
          { id:'action', label:'NEEDS ACTION',  test: o => ['triage','desk'].includes(stageOf(o)) || (dueIn(o) !== null && dueIn(o) <= 7) },
          { id:'mine',   label:'MINE',          test: o => { try { const me = JSON.parse(localStorage.getItem('cov_user')||'null')?.email; return !!me && o.assignedTo === me } catch { return false } } },
          { id:'closed', label:'CLOSED',        test: o => stageOf(o) === 'closed' },
          { id:'all',    label:'ALL',           test: () => true },
        ]
        const f = FILTERS.find(x => x.id === caseFilter) || FILTERS[0]
        const rows = thread.filter(f.test)
        if (everything.length === 0) return (
          <div className="border border-stone-200 px-6 py-8 mb-5" style={{ background:'#FAF7F1', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px', flexWrap:'wrap' }}>
            <div>
              <div className="display-font text-stone-500 italic" style={{ fontSize:'17px' }}>No cases yet.</div>
              <div className="mono-font text-stone-400" style={{ fontSize:'10px', marginTop:'4px' }}>Start with a triage, or load a demo institution to see every tool with data in it.</div>
            </div>
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
              <button onClick={onLoadDemo} className="cov-btn" style={{ padding:'10px 16px', fontSize:'10px' }}>LOAD DEMO INSTITUTION</button>
              <button onClick={() => setActiveSection('triage')} className="upload-btn">START A TRIAGE →</button>
            </div>
          </div>
        )
        const open = thread.filter(FILTERS[0].test).length, action = thread.filter(FILTERS[1].test).length
        const overdue = thread.filter(o => dueIn(o) !== null && dueIn(o) < 0).length
        return (
          <section className="mb-5" style={{ border:'1px solid #D4CCBC', background:'#FAF7F1' }}>
            <button onClick={toggleCases} aria-expanded={casesOpen} aria-controls="home-cases" className="cov-home-cases-bar"
              style={{ width:'100%', display:'flex', alignItems:'center', gap:'18px', flexWrap:'wrap', background:'none', border:'none', padding:'14px 18px', cursor:'pointer', textAlign:'left' }}>
              <span className="display-font" style={{ fontSize:'20px', fontWeight:600, color:'#1A1814', letterSpacing:'-0.01em' }}>Cases</span>
              <span className="mono-font cov-home-cases-sum" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E', display:'flex', gap:'14px', flexWrap:'wrap', flex:1 }}>
                <span><strong style={{ color:'#1A1814' }}>{open}</strong> OPEN</span>
                <span><strong style={{ color:'#1A1814' }}>{action}</strong> NEED ACTION</span>
                {overdue > 0 && <span style={{ color:'#B91C1C' }}><strong>{overdue}</strong> OVERDUE</span>}
                <span>{thread.length} {windowDays ? `IN THE LAST ${windowDays} DAYS` : 'IN ALL'}</span>
              </span>
              <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#1A1814', whiteSpace:'nowrap' }}>{casesOpen ? 'HIDE ↑' : 'SHOW ↓'}</span>
            </button>
            {casesOpen && (<div id="home-cases" style={{ borderTop:'1px solid #E7E2D9' }}>
              <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', padding:'10px 18px' }}>
                {FILTERS.map(x => (
                  <button key={x.id} onClick={() => setCaseFilter(x.id)} className={`grade-tab ${caseFilter === x.id ? 'active' : ''}`} style={{ fontSize:'10px' }}>
                    {x.label} {thread.filter(x.test).length}
                  </button>
                ))}
              </div>
              {rows.length === 0 ? (
                <div className="mono-font text-stone-400" style={{ fontSize:'10px', padding:'14px 18px', borderTop:'1px solid #E7E2D9' }}>Nothing here.</div>
              ) : rows.slice(0, 25).map(o => {
                const due = dueIn(o)
                return (
                  <div key={o.id} onClick={() => window.dispatchEvent(new CustomEvent('cov:open-case', { detail:{ id:o.id } }))}
                    data-case-row tabIndex={0} role="button" aria-label={`Open ${o.id} ${o.merchant || ''}`}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.dispatchEvent(new CustomEvent('cov:open-case', { detail:{ id:o.id } })) } }}
                    className="flex items-center gap-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors"
                    style={{ borderTop:'1px solid #E7E2D9', padding:'12px 18px' }}>
                    <span className="mono-font text-stone-400" style={{ fontSize:'10px', width:'92px', flexShrink:0 }}>{o.id}</span>
                    <span className="display-font text-stone-700 flex-1 truncate" style={{ fontSize:'14px', minWidth:0 }}>{o.merchant}</span>
                    <span className="mono-font text-stone-500 desktop-only" style={{ fontSize:'11px' }}>{o.amount}</span>
                    <PipelineDots c={o} />
                    {due !== null && (
                      <span className="mono-font desktop-only" style={{ fontSize:'10px', color: due < 0 ? '#B91C1C' : due <= 3 ? '#92400E' : '#78716C', whiteSpace:'nowrap' }}>
                        {due < 0 ? `OVERDUE ${-due}d` : due === 0 ? 'DUE TODAY' : `DUE ${due}d`}
                      </span>
                    )}
                    <StatusChip status={o.status} />
                  </div>
                )
              })}
              <div className="mono-font text-stone-400" style={{ fontSize:'10px', letterSpacing:'0.1em', padding:'10px 18px', borderTop:'1px solid #E7E2D9', display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
                <span>● TRIAGE · DESK · MULTI · FILE · LICIT · DFA — click a case for its full record{rows.length > 25 ? ` · showing 25 of ${rows.length}` : ''}</span>
                {!hasDemo && <button onClick={onLoadDemo} style={{ background:'none', border:'none', color:'#A8A29E', cursor:'pointer', fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.1em', padding:0 }}>LOAD DEMO INSTITUTION</button>}
              </div>
            </div>)}
          </section>
        )
      })()}

      {/* ── The numbers: one strip (snapshot figures can be turned off in Settings) ── */}
      {(() => {
        const cells = [
          { label:'NEW',         value: active.length,                  sub: windowDays ? `opened in ${windowDays} days` : 'opened, all time' },
          { label:'IN PROGRESS', value: inProg.length,                  sub: platformMode === 'merchant' ? 'rebuttal / submitted' : 'filed / representment' },
          { label:'WIN RATE',    value: winRate !== null ? winRate + '%' : '—', sub:`${resolved.length} resolved` },
        ]
        if (settings.snapshotEnabled !== false) {
          const recent = outcomes.filter(o => o.date && inRange(o))
          const days = recent.filter(o => ['won','lost','withdrawn'].includes(o.status) && o.date && o.resolvedDate)
            .map(o => Math.max(0, Math.round((new Date(o.resolvedDate) - new Date(o.date)) / 86400000)))
          const fraud = recent.filter(o => o.category === 'fraud' || o.category === 'mc_fraud' || o.verdict === 'TRUE_FRAUD').length
          const cats = {}
          recent.forEach(o => { if (o.category) { const c = o.category.replace('mc_', ''); cats[c] = (cats[c] || 0) + 1 } })
          const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]
          if (days.length) cells.push({ label:'AVG RESOLUTION', value: Math.round(days.reduce((a, b) => a + b, 0) / days.length) + 'd', sub:'opened to closed' })
          if (recent.length) cells.push({ label:'FRAUD / SERVICE', value:`${fraud} / ${recent.length - fraud}`, sub:`of ${recent.length} cases` })
          if (top) cells.push({ label:'TOP CATEGORY', value: top[0].replace(/_/g, ' '), sub:`${top[1]} cases`, small:true })
        }
        return (
          <div className="home-stats-grid" style={{ display:'grid', gridTemplateColumns:`repeat(${cells.length}, minmax(0,1fr))`, gap:'1px', background:'#D4CCBC', border:'1px solid #D4CCBC' }}>
            {cells.map(c => (
              <div key={c.label} style={{ background:'#FAF7F1', padding:'14px 18px', minWidth:0 }}>
                <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.15em', color:'#78716C' }}>{c.label}</div>
                <div className="display-font" style={{ fontSize: c.small ? '20px' : '28px', fontWeight:600, color:'#1A1814', lineHeight:1.1, marginTop:'6px', textTransform: c.small ? 'capitalize' : 'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.value}</div>
                <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E', marginTop:'4px' }}>{c.sub}</div>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

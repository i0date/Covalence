// 005 LICIT — the compliance desk: sanctions matches, AML investigations, SARs
// Works on the same case records as the dispute tools. Rules and screening are
// in fincrime.js; this is where the BSA/AML team does the work:
//   Queue           possible matches, OFAC reports due, SAR decisions and filings
//   Investigations  cases tied together by a shared customer, payee or wallet
//   SAR builder     facts gathered from the cases, an AI-drafted narrative with
//                   every statement traced to a case, and a worksheet for BSA E-Filing
//   Screening log   what was screened, when, against which list
import React, { useEffect, useMemo, useState } from 'react'
import { canWrite, canConfigure } from '../auth.js'
import { auditWrite } from '../audit.js'
import { openCase } from '../CaseThread.jsx'
import { CLOSED_STATUSES, caseClocks, parseAmount } from '../clocks.mjs'
import { amlIndex, amlSignals, screeningStatus, walletsOf } from '../fincrime.js'
import { EXPLAIN_RULES, aiDraftRecord, readAiJson } from '../ai.js'
import { Badge, Button } from '../ui.jsx'

const DAY = 86400000
const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'
const money = n => '$' + Math.round(n).toLocaleString()
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px', marginBottom:'20px' }
const H2 = ({ children, n }) => (
  <h2 className="display-font" style={{ fontSize:'22px', fontWeight:600, color:'#1A1814', margin:'0 0 14px', display:'flex', gap:'10px', alignItems:'baseline' }}>
    {n && <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E' }}>{n}</span>}{children}
  </h2>
)
const SAR_ACTIVITY = { structuring: 'Structuring', aggregate: 'Structuring', repeat: 'Fraud — repeated claims', velocity: 'Fraud — repeated claims',
  payee: 'Fraud — mule or beneficiary account', wallet: 'Virtual currency — shared wallet', scam: 'Fraud — elder or romance / investment scam', round: 'Suspicious amounts', sanctions: 'Sanctions — OFAC match' }

// ─── Clusters: cases tied together by a customer, payee or wallet ─────────────
function clustersOf(cases, settings) {
  const ix = amlIndex(cases), parent = new Map(cases.map(c => [c.id, c.id]))
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => parent.set(find(a), find(b))
  const entities = new Map()   // root → Map(key → { kind, label })
  const link = (kind, label, list) => { if (list.length < 2) return; list.slice(1).forEach(o => union(list[0].id, o.id)); list.forEach(o => { (o._ents ||= []).push({ kind, label, key: kind + ':' + norm(label) }) }) }
  const scratch = cases.map(c => ({ ...c, _ents: [] })), byId = new Map(scratch.map(c => [c.id, c]))
  const rebind = list => list.map(o => byId.get(o.id)).filter(Boolean)
  ix.holder.forEach((list, k) => link('Customer', list[0].cardholderName || k, rebind(list)))
  ix.payee.forEach((list) => { if (new Set(list.map(o => norm(o.cardholderName))).size >= 2) link('Payee', list[0].merchant, rebind(list)) })
  ix.wallet.forEach((list, w) => link('Wallet', w, rebind(list)))
  const groups = new Map()
  scratch.forEach(c => { const r = find(c.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c) })
  return [...groups.values()].filter(g => g.length >= 2).map(g => {
    const ents = new Map(); g.forEach(c => c._ents.forEach(e => ents.set(e.key, e)))
    const amls = g.map(c => amlSignals(c, cases, settings, ix))
    const risky = g.some((c, i) => amls[i].level === 'medium' || amls[i].level === 'high' || c.sarReview || ['potential', 'confirmed'].includes(screeningStatus(c)))
    const dates = g.map(c => new Date(c.date || 0).getTime())
    return { id: g.map(c => c.id).sort().join('+'), cases: g, entities: [...ents.values()], risky,
      total: g.reduce((t, c) => t + parseAmount(c.amount), 0), customers: new Set(g.map(c => norm(c.cardholderName)).filter(Boolean)).size,
      from: Math.min(...dates), to: Math.max(...dates), level: amls.some(a => a.level === 'high') ? 'high' : amls.some(a => a.level === 'medium') ? 'medium' : 'low',
      signals: [...new Set(amls.flatMap(a => a.signals.map(s => s.key)))] }
  }).filter(cl => cl.risky).sort((a, b) => b.total - a.total)
}

// Entities on the left, cases on the right, a line for each tie
function ClusterMap({ cl }) {
  const ents = cl.entities.slice(0, 8), cs = cl.cases.slice(0, 8)
  const rowH = 26, H = Math.max(ents.length, cs.length) * rowH + 8, W = 520
  const ey = i => 16 + i * rowH + (Math.max(ents.length, cs.length) - ents.length) * rowH / 2
  const cy = i => 16 + i * rowH + (Math.max(ents.length, cs.length) - cs.length) * rowH / 2
  const color = { Customer: '#1E3A5F', Payee: '#92400E', Wallet: '#7F1D1D' }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth:`${W}px`, display:'block' }} role="img"
      aria-label={`${ents.map(e => `${e.kind} ${e.label}`).join(', ')} linked to cases ${cs.map(c => c.id).join(', ')}`}>
      {cs.map((c, ci) => c._ents.map(e => { const ei = ents.findIndex(x => x.key === e.key); return ei < 0 ? null : (
        <line key={c.id + e.key} x1="200" y1={ey(ei)} x2="320" y2={cy(ci)} stroke={color[e.kind]} strokeOpacity="0.45" strokeWidth="1.5" />) }))}
      {ents.map((e, i) => (
        <g key={e.key}>
          <circle cx="200" cy={ey(i)} r="5" fill={color[e.kind]} />
          <text x="190" y={ey(i) + 4} textAnchor="end" fontSize="11" fontFamily="'JetBrains Mono',monospace" fill="#1A1814">
            {e.label.length > 22 ? e.label.slice(0, 10) + '…' + e.label.slice(-8) : e.label}<title>{`${e.kind}: ${e.label}`}</title>
          </text>
        </g>
      ))}
      {cs.map((c, i) => (
        <g key={c.id} style={{ cursor:'pointer' }} onClick={() => openCase(c.id)}>
          <rect x="320" y={cy(i) - 9} width="196" height="18" rx="2" fill="#FFFFFF" stroke="#D4CCBC" />
          <text x="328" y={cy(i) + 4} fontSize="11" fontFamily="'JetBrains Mono',monospace" fill="#1A1814">{c.id} · {c.amount}<title>{`${c.id} — ${c.merchant} — ${c.amount}`}</title></text>
        </g>
      ))}
    </svg>
  )
}

function Row({ c, note, tone }) {
  return (
    <button onClick={() => openCase(c.id)} className="cov-search-row mono-font"
      style={{ display:'grid', gridTemplateColumns:'110px minmax(0,1fr) auto', gap:'12px', width:'100%', textAlign:'left', background:'none', border:'none', borderTop:'1px solid #EDE7DC', padding:'8px 0', cursor:'pointer', fontSize:'11px', color:'#1A1814', alignItems:'center' }}>
      <span style={{ color:'#57534E' }}>{c.id}</span>
      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}><span className="display-font" style={{ fontSize:'14px' }}>{c.merchant || '—'}</span> · {c.amount || ''}{c.cardholderName ? ` · ${c.cardholderName}` : ''}</span>
      <span style={{ color: tone === 'danger' ? '#991B1B' : tone === 'warn' ? '#92400E' : '#57534E', whiteSpace:'nowrap' }}>{note}</span>
    </button>
  )
}

export function LicitView({ outcomes, setOutcomes, settings, covUser }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('cov_licit_tab') || 'queue' } catch { return 'queue' } })
  const pick = t => { setTab(t); try { localStorage.setItem('cov_licit_tab', t) } catch {} }
  const [sarIds, setSarIds] = useState(null)   // set by "Build a SAR" on an investigation
  const cases = useMemo(() => (outcomes || []).filter(c => c?.id && !c._triageOnly), [outcomes])
  const clockOf = (c, key) => caseClocks(c, settings).find(k => k.key === key)
  const note = (c, key, fallback) => { const k = clockOf(c, key); return k ? (k.state === 'breached' ? `overdue ${k.text.replace(' overdue', '')}` : `${k.text} · due ${day(k.due)}`) : fallback }

  const potential = cases.filter(c => screeningStatus(c) === 'potential')
  const toReport = cases.filter(c => screeningStatus(c) === 'confirmed' && !c.ofacReportedAt)
  const toDecide = cases.filter(c => c.sarReview && !c.sarReview.decision)
  const toFile = cases.filter(c => c.sarReview?.decision === 'file' && !c.sarReview.filedAt)
  const clusters = useMemo(() => clustersOf(cases, settings), [cases, settings])
  const open = cases.filter(c => !CLOSED_STATUSES.includes(c.status))

  const TABS = [['queue', 'Queue', potential.length + toReport.length + toDecide.length + toFile.length], ['investigations', 'Investigations', clusters.length], ['sar', 'SAR builder', toDecide.length + toFile.length], ['log', 'Screening log', null]]

  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <div className="mb-10 pb-6" style={{ borderBottom:'1px solid #D4CCBC', display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:'16px' }}>
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-400 mb-3">ISSUE Nº 005 — LICIT</div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(48px,8vw,96px)', letterSpacing:'-0.03em' }}>
            <span style={{ fontWeight:700 }}>Li</span><span style={{ fontStyle:'italic', fontWeight:500 }}>cit</span>
          </h1>
          <p className="display-font text-stone-600 mt-4" style={{ fontSize:'clamp(14px,1.8vw,16px)', lineHeight:1.6, maxWidth:'600px' }}>
            The compliance desk. Sanctions matches, money-laundering investigations and SARs — on the same case records the dispute team works, so nothing is keyed twice.
          </p>
        </div>
        <div className="mono-font text-xs tracking-widest text-stone-600">{new Date().toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }).toUpperCase()}</div>
      </div>

      <div role="tablist" aria-label="Licit sections" style={{ display:'flex', gap:'2px', borderBottom:'1px solid #D4CCBC', marginBottom:'24px', overflowX:'auto' }}>
        {TABS.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => pick(k)} className="mono-font"
            style={{ background:'none', border:'none', borderBottom: tab === k ? '2px solid #1A1814' : '2px solid transparent', marginBottom:'-1px', padding:'10px 14px',
              fontSize:'10px', letterSpacing:'0.14em', textTransform:'uppercase', whiteSpace:'nowrap', cursor:'pointer', color: tab === k ? '#1A1814' : '#6B6259' }}>
            {label}{n ? <span style={{ marginLeft:'6px', background: tab === k ? '#1A1814' : '#D4CCBC', color: tab === k ? '#F5F1EA' : '#1A1814', padding:'0 5px' }}>{n}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'queue' && (<>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:'10px', marginBottom:'20px' }}>
          {[['POSSIBLE MATCHES', potential.length, 'review within 1 business day'], ['OFAC REPORTS DUE', toReport.length, '10 business days from confirmation'],
            ['SAR DECISIONS', toDecide.length, '30 days from detection'], ['SARS TO FILE', toFile.length, 'record the BSA ID']].map(([l, n, sub]) => (
            <div key={l} style={{ background:'#FFFFFF', border:'1px solid #E7E2D9', padding:'12px 14px' }}>
              <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#57534E' }}>{l}</div>
              <div className="display-font" style={{ fontSize:'28px', fontWeight:600, color: n ? '#1A1814' : '#8A7F72' }}>{n}</div>
              <div className="display-font" style={{ fontSize:'13px', color:'#57534E' }}>{sub}</div>
            </div>
          ))}
        </div>
        {[['Possible sanctions matches', potential, c => note(c, 'screen', `${c.screening.hits.length} hit${c.screening.hits.length === 1 ? '' : 's'}`), 'danger', 'Nothing to review. Every screened case is clear or decided.'],
          ['Confirmed matches to report to OFAC', toReport, c => note(c, 'ofac', 'report due'), 'danger', 'No reports due.'],
          ['SAR decisions', toDecide, c => note(c, 'sar', 'decide'), 'warn', 'No cases waiting on a SAR decision.'],
          ['SARs to file', toFile, c => note(c, 'sar', 'to file'), 'warn', 'No SARs waiting to be filed.']].map(([title, rows, fmt, tone, empty]) => (
          <section key={title} style={box}>
            <div style={{ display:'flex', gap:'10px', alignItems:'center', marginBottom:'6px' }}>
              <span className="display-font" style={{ fontSize:'17px', fontWeight:600, color:'#1A1814' }}>{title}</span>
              <Badge tone={rows.length ? tone : 'neutral'}>{rows.length}</Badge>
            </div>
            {rows.length ? rows.map(c => <Row key={c.id} c={c} note={fmt(c)} tone={tone} />) : <div className="display-font" style={{ fontSize:'14px', color:'#6B6259', fontStyle:'italic' }}>{empty}</div>}
          </section>
        ))}
        <div className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{open.filter(c => c.screening).length} of {open.length} open cases screened. Decisions are made in each case file.</div>
      </>)}

      {tab === 'investigations' && (<>
        <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', margin:'0 0 16px', maxWidth:'760px', lineHeight:1.55 }}>
          Cases tied together by the same customer, the same payee across different customers, or the same wallet — shown where at least one of them carries a risk signal. Click a case to open it.
        </p>
        {clusters.length === 0 ? <p className="display-font" style={{ ...box, fontStyle:'italic', color:'#57534E' }}>No linked cases with risk signals.</p> : clusters.map(cl => (
          <section key={cl.id} style={box}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap', marginBottom:'10px' }}>
              <div>
                <div className="display-font" style={{ fontSize:'18px', fontWeight:600, color:'#1A1814' }}>{cl.cases.length} cases · {money(cl.total)} · {cl.customers} customer{cl.customers === 1 ? '' : 's'}</div>
                <div className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>{day(cl.from)} – {day(cl.to)} · {cl.signals.map(s => SAR_ACTIVITY[s] || s).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</div>
              </div>
              <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                <Badge tone={cl.level === 'high' ? 'danger' : cl.level === 'medium' ? 'warn' : 'neutral'}>{cl.level.toUpperCase()} RISK</Badge>
                <Button variant="secondary" onClick={() => { setSarIds(cl.cases.map(c => c.id)); pick('sar') }}>Build a SAR</Button>
              </div>
            </div>
            <div style={{ overflowX:'auto' }}><ClusterMap cl={cl} /></div>
            <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', marginTop:'6px' }}>
              <span style={{ color:'#1E3A5F' }}>●</span> customer &nbsp; <span style={{ color:'#92400E' }}>●</span> payee &nbsp; <span style={{ color:'#7F1D1D' }}>●</span> wallet
            </div>
          </section>
        ))}
      </>)}

      {tab === 'sar' && <SarBuilder cases={cases} clusters={clusters} settings={settings} covUser={covUser} setOutcomes={setOutcomes} preset={sarIds} />}

      {tab === 'log' && <ScreeningLog cases={cases} />}
    </div>
  )
}

// ─── SAR builder ──────────────────────────────────────────────────────────────
function SarBuilder({ cases, clusters, settings, covUser, setOutcomes, preset }) {
  const candidates = cases.filter(c => c.sarReview)
  const [ids, setIds] = useState(() => preset || (candidates[0] ? (clusters.find(cl => cl.cases.some(c => c.id === candidates[0].id))?.cases.map(c => c.id) || [candidates[0].id]) : []))
  useEffect(() => { if (preset) setIds(preset) }, [preset])
  const chosen = cases.filter(c => ids.includes(c.id))
  const ix = useMemo(() => amlIndex(cases), [cases])
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [draft, setDraft] = useState(null)
  const existing = chosen.find(c => c.sarReview?.narrative)?.sarReview.narrative
  useEffect(() => { setDraft(existing ? { ...existing } : null); setErr('') }, [ids.join()])
  const writer = canWrite()

  // The facts, gathered from the cases — what the SAR form asks for
  const facts = useMemo(() => {
    const amls = chosen.map(c => amlSignals(c, cases, settings, ix))
    const dates = chosen.map(c => new Date(c.date || 0).getTime())
    return {
      subjects: [...new Set(chosen.map(c => c.cardholderName).filter(Boolean))],
      counterparties: [...new Set(chosen.map(c => c.merchant).filter(m => m && m !== '—'))],
      wallets: [...new Set(chosen.flatMap(walletsOf))],
      total: chosen.reduce((t, c) => t + parseAmount(c.amount), 0),
      from: dates.length ? new Date(Math.min(...dates)) : null, to: dates.length ? new Date(Math.max(...dates)) : null,
      activity: [...new Set(amls.flatMap(a => a.signals.map(s => SAR_ACTIVITY[s.key] || s.label)))],
      sanctions: [...new Set(chosen.filter(c => ['potential', 'confirmed'].includes(screeningStatus(c))).flatMap(c => c.screening.hits.map(h => `${h.subject} ≈ ${h.name} (${h.list}, ${h.programs.replace(/\]\s*\[/g, ' · ')})${screeningStatus(c) === 'confirmed' ? ' — confirmed' : ' — not yet decided'}`)))],
      cases: chosen.map(c => ({ id: c.id, opened: (c.date || '').slice(0, 10), amount: c.amount, customer: c.cardholderName || '', payee: c.merchant || '', type: (c.verdict || '').replace(/_/g, ' ').toLowerCase(), statement: (c._complaint || '').slice(0, 400) })),
    }
  }, [ids.join(), cases, settings])

  const runDraft = async () => {
    setBusy(true); setErr('')
    const prompt = `You are a BSA/AML investigator at a US financial institution writing the narrative for a Suspicious Activity Report (FinCEN SAR, Part V).

Write a clear, factual narrative that answers who, what, when, where, why and how, in chronological order, in the third person. Use only the facts below. Do not speculate about guilt; describe the activity and why it is suspicious. Refer to cases by their case number. Keep it to 250–450 words.
- Do not cite reporting thresholds, rules or regulations (for example CTR limits) unless they appear in the facts.
- Do not describe systems, monitoring, investigations or contacts the facts don't mention; say where information came from (a customer statement, a sanctions screening).
- State a sanctions match exactly as the facts give it: "confirmed" or "not yet decided".

FACTS FROM THE CASE RECORDS:
${JSON.stringify(facts, null, 1)}
${EXPLAIN_RULES}

Return ONLY valid JSON:
{
  "narrative": "The narrative text, in paragraphs separated by blank lines.",
  "facts_used": [{ "statement": "A sentence or claim made in the narrative", "source": "The case number(s) or fact it comes from" }],
  "gaps": ["Information an investigator should add before filing, e.g. account numbers, subject identifiers, law-enforcement contact"],
  "activity_types": ["SAR Part II suspicious activity categories that apply"]
}`
    try {
      const r = await fetch('/api/analyze', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ messages:[{ role:'user', content: prompt }] }) })
      if (!r.ok) throw new Error(`The AI service answered ${r.status}`)
      const data = await r.json(), p = readAiJson(data)
      const rec = aiDraftRecord('sar_narrative', data)
      setDraft({ text: p.narrative || '', factsUsed: p.facts_used || [], gaps: p.gaps || [], activity: p.activity_types || [], ai: rec, ts: new Date().toISOString(), by: covUser?.name || covUser?.email || 'Investigator' })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const save = () => {
    const n = { ...draft, savedAt: new Date().toISOString(), cases: ids }
    setOutcomes(prev => prev.map(o => ids.includes(o.id) ? { ...o, sarReview: { ...(o.sarReview || { flaggedAt: new Date().toISOString(), manual: true }), narrative: n },
      aiDecisions: draft.ai && !(o.aiDecisions || []).some(d => d.id === draft.ai.id) ? [...(o.aiDecisions || []), draft.ai].slice(-20) : o.aiDecisions } : o))
    ids.forEach(id => auditWrite('sar.drafted', 'case', id, { cases: ids.join(', '), words: n.text.split(/\s+/).length }))
  }
  const worksheet = () => {
    const L = []
    L.push('SUSPICIOUS ACTIVITY REPORT — WORKSHEET (prepared in Covalence; file through FinCEN BSA E-Filing)', '')
    L.push('PART I — SUBJECT INFORMATION', ...(facts.subjects.length ? facts.subjects.map(s => `  • ${s}`) : ['  • (add subject details)']), '')
    L.push('PART II — SUSPICIOUS ACTIVITY INFORMATION',
      `  Amount involved: ${money(facts.total)}`, `  Date range: ${day(facts.from)} – ${day(facts.to)}`,
      '  Categories:', ...[...new Set([...(draft?.activity || []), ...facts.activity])].map(a => `    • ${a}`), '')
    if (facts.counterparties.length || facts.wallets.length) L.push('  Counterparties / instruments:', ...facts.counterparties.map(x => `    • ${x}`), ...facts.wallets.map(w => `    • Wallet ${w}`), '')
    if (facts.sanctions.length) L.push('  Sanctions screening:', ...facts.sanctions.map(x => `    • ${x}`), '')
    L.push('PART V — NARRATIVE', '', draft?.text || '(no narrative yet)', '')
    if (draft?.gaps?.length) L.push('TO COMPLETE BEFORE FILING', ...draft.gaps.map(g => `  • ${g}`), '')
    L.push('CASES', ...facts.cases.map(c => `  ${c.id} · opened ${c.opened} · ${c.amount} · ${c.customer} → ${c.payee}`))
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\n')], { type:'text/plain' })); a.download = `SAR-worksheet-${ids[0] || 'case'}.txt`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    ids.forEach(id => auditWrite('case.exported', 'case', id, { what: 'SAR worksheet' }))
  }

  const options = [...clusters.map(cl => ({ value: cl.cases.map(c => c.id).join(','), label: `Linked: ${cl.cases.map(c => c.id).join(', ')} (${money(cl.total)})` })),
    ...candidates.map(c => ({ value: c.id, label: `${c.id} · ${c.merchant} · ${c.amount}` }))]

  return (<>
    <section style={box}>
      <H2 n="01">What the SAR covers</H2>
      {options.length === 0 ? <p className="display-font" style={{ fontSize:'14px', color:'#57534E', fontStyle:'italic', margin:0 }}>No cases are flagged for SAR review. Cases are flagged automatically from their AML signals, or from a case file.</p> : (
        <select className="input-field" value={ids.join(',')} onChange={e => setIds(e.target.value.split(','))} style={{ padding:'9px 10px', fontSize:'14px', maxWidth:'100%' }} aria-label="Cases the SAR covers">
          {!options.some(o => o.value === ids.join(',')) && ids.length > 0 && <option value={ids.join(',')}>{ids.join(', ')}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </section>

    {chosen.length > 0 && (<>
      <section style={box}>
        <H2 n="02">Facts from the cases</H2>
        <dl className="display-font" style={{ display:'grid', gridTemplateColumns:'minmax(140px, max-content) 1fr', gap:'6px 16px', fontSize:'14px', margin:0, color:'#1A1814' }}>
          <dt style={{ color:'#57534E' }}>Subjects</dt><dd style={{ margin:0 }}>{facts.subjects.join(' · ') || '—'}</dd>
          <dt style={{ color:'#57534E' }}>Payees</dt><dd style={{ margin:0 }}>{facts.counterparties.join(' · ') || '—'}</dd>
          {facts.wallets.length > 0 && <><dt style={{ color:'#57534E' }}>Wallets</dt><dd className="mono-font" style={{ margin:0, fontSize:'12px', overflowWrap:'anywhere' }}>{facts.wallets.join(' · ')}</dd></>}
          <dt style={{ color:'#57534E' }}>Amount</dt><dd style={{ margin:0 }}>{money(facts.total)} across {chosen.length} case{chosen.length === 1 ? '' : 's'}</dd>
          <dt style={{ color:'#57534E' }}>Dates</dt><dd style={{ margin:0 }}>{day(facts.from)} – {day(facts.to)}</dd>
          <dt style={{ color:'#57534E' }}>Activity</dt><dd style={{ margin:0 }}>{facts.activity.join(' · ') || '—'}</dd>
          {facts.sanctions.length > 0 && <><dt style={{ color:'#57534E' }}>Sanctions</dt><dd style={{ margin:0, color:'#7F1D1D' }}>{facts.sanctions.join(' · ')}</dd></>}
        </dl>
      </section>

      <section style={box}>
        <H2 n="03">Narrative</H2>
        {!draft ? (
          <div style={{ display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
            <Button onClick={runDraft} disabled={busy || !writer}>{busy ? 'Drafting… (about 30 seconds)' : 'Draft the narrative with AI'}</Button>
            <Button variant="secondary" disabled={!writer} onClick={() => setDraft({ text: '', factsUsed: [], gaps: [], activity: [], ts: new Date().toISOString(), by: covUser?.name || 'Investigator' })}>Write it myself</Button>
            {err && <span role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B' }}>{err}</span>}
          </div>
        ) : (<>
          {draft.ai && <div className="mono-font" style={{ fontSize:'10px', color:'#57534E', letterSpacing:'0.08em', marginBottom:'6px' }}>AI DRAFT — read every sentence against the cases before filing</div>}
          <textarea value={draft.text} onChange={e => setDraft(d => ({ ...d, text: e.target.value }))} rows={14} className="cov-input" aria-label="SAR narrative"
            style={{ width:'100%', padding:'12px 14px', fontSize:'15px', lineHeight:1.6, fontFamily:"'Fraunces',Georgia,serif", resize:'vertical' }} />
          <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', margin:'4px 0 12px' }}>{draft.text.split(/\s+/).filter(Boolean).length} words</div>
          {draft.factsUsed?.length > 0 && (
            <details style={{ marginBottom:'12px' }}>
              <summary className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#1E3A5F', cursor:'pointer' }}>WHERE EACH STATEMENT COMES FROM ({draft.factsUsed.length})</summary>
              <ul style={{ margin:'8px 0 0', paddingLeft:'18px' }}>{draft.factsUsed.map((f, i) => <li key={i} className="display-font" style={{ fontSize:'13px', color:'#3F3A35', lineHeight:1.5 }}>{f.statement} <span className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>— {f.source}</span></li>)}</ul>
            </details>
          )}
          {draft.gaps?.length > 0 && (
            <div style={{ border:'1px solid #FCD34D', background:'#FFFBEB', padding:'10px 12px', marginBottom:'12px' }}>
              <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#92400E', marginBottom:'4px' }}>ADD BEFORE FILING</div>
              <ul style={{ margin:0, paddingLeft:'18px' }}>{draft.gaps.map((g, i) => <li key={i} className="display-font" style={{ fontSize:'13px', color:'#3F3A35' }}>{g}</li>)}</ul>
            </div>
          )}
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
            <Button disabled={!writer || !draft.text.trim()} onClick={save}>Save to the case{ids.length === 1 ? '' : 's'}</Button>
            <Button variant="secondary" disabled={!draft.text.trim()} onClick={worksheet}>Download SAR worksheet</Button>
            <Button variant="secondary" disabled={!draft.text.trim()} onClick={() => navigator.clipboard?.writeText(draft.text)}>Copy narrative</Button>
            <Button variant="quiet" disabled={busy || !writer} onClick={runDraft}>{busy ? 'Drafting…' : 'Redraft with AI'}</Button>
            {existing?.savedAt && <span className="mono-font" style={{ fontSize:'10px', color:'#065F46' }}>Saved {day(existing.savedAt)}</span>}
          </div>
          <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:'12px 0 0', lineHeight:1.5 }}>
            File through FinCEN’s BSA E-Filing System; the worksheet follows the SAR’s parts so it can be copied across. Record the decision and the BSA ID in each case file.
            {!canConfigure() && ' An admin or reviewer records the filing decision.'}
          </p>
        </>)}
      </section>
    </>)}
  </>)
}

// ─── Screening log ────────────────────────────────────────────────────────────
function ScreeningLog({ cases }) {
  const [list, setList] = useState(null), [err, setErr] = useState('')
  useEffect(() => { fetch('/api/sanctions').then(r => r.json().then(d => r.ok ? setList(d.list) : setErr(d.error || `HTTP ${r.status}`))).catch(() => setErr('The screening service couldn’t be reached.')) }, [])
  const rows = cases.flatMap(c => [...(c.screenings || []), ...(c.screening ? [c.screening] : [])].map(s => ({ c, s }))).sort((a, b) => new Date(b.s.ts) - new Date(a.s.ts)).slice(0, 200)
  return (<>
    <section style={box}>
      <H2>Lists in use</H2>
      <p className="display-font" style={{ fontSize:'14px', color: err ? '#991B1B' : '#3F3A35', margin:0, lineHeight:1.55 }}>
        {list ? `${list.source}: ${list.entries.toLocaleString()} entries and ${list.wallets} crypto addresses, downloaded from the US Treasury ${day(list.fetchedAt)} and refreshed every 12 hours. Match threshold and automatic screening are set in Settings → Financial crime.` : err || 'Checking…'}
      </p>
    </section>
    <section style={box}>
      <H2>Recent screenings</H2>
      {rows.length === 0 ? <p className="display-font" style={{ fontSize:'14px', color:'#57534E', fontStyle:'italic', margin:0 }}>Nothing screened yet.</p> : (
        <div style={{ overflowX:'auto' }}>
          <table className="mono-font" style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
            <thead><tr>{['Screened', 'Case', 'Result', 'Hits', 'By', 'List as of'].map(h => <th key={h} scope="col" style={{ textAlign:'left', padding:'6px 8px', color:'#57534E', fontWeight:500, borderBottom:'1px solid #D4CCBC' }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(({ c, s }) => (
              <tr key={c.id + s.id}>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace:'nowrap' }}>{day(s.ts)}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC' }}><button onClick={() => openCase(c.id)} style={{ background:'none', border:'none', padding:0, color:'#1E3A5F', textDecoration:'underline', cursor:'pointer', fontFamily:'inherit', fontSize:'11px' }}>{c.id}</button></td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC', color: s.status === 'clear' ? '#065F46' : '#991B1B' }}>{s.status === 'clear' ? 'Clear' : s.decision?.outcome === 'false_positive' ? 'Cleared (false positive)' : s.decision?.outcome === 'true_match' ? 'Confirmed match' : 'Possible match'}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC' }}>{s.hits.length}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC' }}>{s.by}</td>
                <td style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace:'nowrap' }}>{day(s.list?.fetchedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  </>)
}

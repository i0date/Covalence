// ═══════════════════════════════════════════════════════════════════════════════
// THE HOSTED CLAIM FORM — public page at /claim/<token>, in the bank's colours
// ═══════════════════════════════════════════════════════════════════════════════
// What a bank's customer sees when the bank sends them a claim link (claimLinks.mjs).
// No sign-in: the link is the key, and it works once. The customer
//   1. says what went wrong, in their own words' terms (FORM_TYPES)
//   2. for a payment they didn't make: "Is this yours?" for each one, with the merchant
//      as people know it; recognising every one ends it there, with nothing to dispute.
//      For a problem with a purchase: which payments it's about
//   3. answers the questions for that kind of problem (claimQuestions.mjs)
//   4. tells it in their own words and agrees to the investigation, then sends it
// The claim lands in Triage → Claims tagged Web. Styled on its own (not GLOBAL_CSS),
// so it looks like the bank's page, not Covalence's.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { openForm, sendForm } from './claimLinksData.js'
import { onAccent } from './claimLinks.mjs'

const FALLBACK = '#1E3A5F'
const UNAUTH = /^unauth|^ato|^counterfeit/
const when = ts => ts ? new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const asked = (q, a) => !q.showIf || Object.entries(q.showIf).every(([k, v]) => a[k] === v)
const answered = (q, v) => q.kind === 'yesno' ? typeof v === 'boolean' : q.kind === 'amount' ? v !== '' && v != null && isFinite(Number(v)) && Number(v) >= 0 : String(v ?? '').trim() !== ''

const CSS = `
  .cf { --accent:${FALLBACK}; --on-accent:#fff; --ink:#1B1F24; --muted:#5B6470; --line:#DCE0E5; --soft:#F4F6F8; --card:#FFFFFF; --bg:#EEF1F4; --bad:#B42318;
    min-height:100vh; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
  .cf * { box-sizing:border-box; }
  .cf-top { background:var(--accent); color:var(--on-accent); }
  .cf-top-in { max-width:640px; margin:0 auto; padding:14px 16px; display:flex; align-items:center; gap:12px; }
  .cf-logo { height:32px; max-width:160px; object-fit:contain; }
  .cf-mono { width:34px; height:34px; border-radius:8px; display:grid; place-items:center; font-weight:700; font-size:14px; background:rgba(255,255,255,.18); }
  .cf-bank { font-weight:600; font-size:17px; }
  .cf-main { max-width:640px; margin:0 auto; padding:20px 16px 48px; }
  .cf-card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:22px 20px; }
  .cf-step { font-size:13px; color:var(--muted); margin:0 0 6px; }
  .cf-bar { height:4px; background:var(--soft); border-radius:4px; margin-bottom:18px; overflow:hidden; }
  .cf-bar > i { display:block; height:100%; background:var(--accent); border-radius:4px; transition:width .25s; }
  .cf h1 { font-size:22px; line-height:1.25; margin:0 0 6px; font-weight:650; }
  .cf p.cf-sub { margin:0 0 18px; color:var(--muted); }
  .cf-group { font-size:13px; font-weight:600; color:var(--muted); margin:18px 0 8px; }
  .cf-opt { display:flex; align-items:center; gap:12px; width:100%; text-align:left; background:var(--card); border:1.5px solid var(--line); border-radius:10px;
    padding:13px 14px; margin-bottom:8px; font:inherit; color:inherit; cursor:pointer; }
  .cf-opt:hover { border-color:var(--muted); }
  .cf-opt[aria-pressed="true"], .cf-opt[aria-checked="true"] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; background:color-mix(in srgb, var(--accent) 6%, white); }
  .cf-dot { width:18px; height:18px; border-radius:50%; border:2px solid var(--line); flex:none; }
  .cf-opt[aria-pressed="true"] .cf-dot, .cf-opt[aria-checked="true"] .cf-dot { border-color:var(--accent); background:radial-gradient(var(--accent) 45%, transparent 50%); }
  .cf-box { width:18px; height:18px; border-radius:4px; border:2px solid var(--line); flex:none; display:grid; place-items:center; font-size:12px; color:var(--on-accent); }
  .cf-opt[aria-checked="true"] .cf-box { background:var(--accent); border-color:var(--accent); }
  .cf :focus-visible { outline:3px solid color-mix(in srgb, var(--accent) 45%, white); outline-offset:2px; }
  .cf-pay { border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:12px; }
  .cf-pay-head { display:flex; gap:12px; align-items:center; }
  .cf-pay-logo { width:44px; height:44px; border-radius:10px; flex:none; display:grid; place-items:center; color:#fff; font-weight:700; overflow:hidden; }
  .cf-pay-logo img { width:100%; height:100%; object-fit:cover; }
  .cf-pay-name { font-weight:650; font-size:17px; }
  .cf-pay-meta { color:var(--muted); font-size:14px; }
  .cf-pay-amt { margin-left:auto; font-weight:650; font-size:17px; white-space:nowrap; }
  .cf-hints { margin:12px 0 0; padding:0; list-style:none; font-size:14px; color:var(--muted); }
  .cf-hints li { padding:3px 0 3px 18px; position:relative; }
  .cf-hints li::before { content:''; position:absolute; left:4px; top:11px; width:5px; height:5px; border-radius:50%; background:var(--muted); }
  .cf-two { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px; }
  .cf-two .cf-opt { justify-content:center; margin:0; text-align:center; }
  .cf-q { margin-bottom:20px; }
  .cf-q label, .cf-q .cf-ask { display:block; font-weight:600; margin-bottom:8px; }
  .cf-q .cf-opt-req { color:var(--muted); font-weight:400; font-size:14px; }
  .cf input[type=text], .cf input[type=date], .cf input[type=number], .cf textarea { width:100%; font:inherit; padding:12px 13px; border:1.5px solid var(--line); border-radius:10px; background:#fff; color:var(--ink); }
  .cf textarea { min-height:120px; resize:vertical; }
  .cf input:focus, .cf textarea:focus { border-color:var(--accent); outline:none; box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 20%, white); }
  .cf-nav { display:flex; gap:10px; margin-top:22px; align-items:center; }
  .cf-btn { font:inherit; font-weight:600; border-radius:10px; padding:13px 20px; cursor:pointer; border:none; background:var(--accent); color:var(--on-accent); }
  .cf-btn:disabled { opacity:.45; cursor:not-allowed; }
  .cf-btn.ghost { background:transparent; color:var(--ink); border:1.5px solid var(--line); }
  .cf-nav .cf-btn:not(.ghost) { margin-left:auto; }
  .cf-err { color:var(--bad); font-size:14px; margin-top:12px; }
  .cf-hint { color:var(--muted); font-size:14px; margin-top:6px; }
  .cf-ref { font:600 20px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.04em; background:var(--soft); border-radius:8px; padding:10px 12px; display:inline-block; margin:4px 0 14px; }
  .cf-foot { max-width:640px; margin:0 auto; padding:0 16px 32px; color:var(--muted); font-size:13px; }
  .cf-foot a { color:inherit; }
  .cf-tick { width:52px; height:52px; border-radius:50%; background:color-mix(in srgb, var(--accent) 12%, white); color:var(--accent); display:grid; place-items:center; font-size:26px; margin-bottom:12px; }
  @media (max-width:480px) { .cf-card { padding:18px 16px; } .cf h1 { font-size:20px; } .cf-pay-amt { font-size:15px; } }
`

function Option({ on, onClick, kind = 'radio', children }) {
  return (
    <button type="button" className="cf-opt" onClick={onClick} {...(kind === 'check' ? { role: 'checkbox', 'aria-checked': on } : { 'aria-pressed': on })}>
      {kind === 'check' ? <span className="cf-box" aria-hidden>{on ? '✓' : ''}</span> : kind === 'radio' ? <span className="cf-dot" aria-hidden /> : null}
      <span>{children}</span>
    </button>
  )
}

function Payment({ card, children }) {
  return (
    <div className="cf-pay">
      <div className="cf-pay-head">
        <div className="cf-pay-logo" style={{ background: card.monogram?.color || '#3F3A35' }} aria-hidden>
          {card.logo ? <img src={card.logo} alt="" referrerPolicy="no-referrer" /> : card.monogram?.letters}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="cf-pay-name">{card.name || card.statementName}</div>
          <div className="cf-pay-meta">{[when(card.when), card.where].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="cf-pay-amt">{card.amountText}</div>
      </div>
      {children}
    </div>
  )
}

function Question({ q, value, set }) {
  const id = `q-${q.id}`
  if (q.kind === 'yesno' || q.kind === 'choice') {
    const opts = q.kind === 'yesno' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : q.options
    return (
      <div className="cf-q" role="radiogroup" aria-labelledby={id}>
        <span className="cf-ask" id={id}>{q.ask}{!q.required && <span className="cf-opt-req"> (optional)</span>}</span>
        <div className={q.kind === 'yesno' ? 'cf-two' : ''} style={q.kind === 'yesno' ? { marginTop: 0 } : null}>
          {opts.map(o => <Option key={String(o.value)} on={value === o.value} onClick={() => set(o.value)} kind={q.kind === 'yesno' ? 'plain' : 'radio'}>{o.label}</Option>)}
        </div>
      </div>
    )
  }
  return (
    <div className="cf-q">
      <label htmlFor={id}>{q.ask}{!q.required && <span className="cf-opt-req"> (optional)</span>}</label>
      {q.kind === 'text' ? <textarea id={id} maxLength={500} value={value || ''} onChange={e => set(e.target.value)} style={{ minHeight: 80 }} />
        : q.kind === 'date' ? <input id={id} type="date" max={today()} value={value || ''} onChange={e => set(e.target.value)} />
        : <input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value ?? ''} onChange={e => set(e.target.value)} />}
    </div>
  )
}

export default function ClaimFormPage({ token: initial }) {
  const [token, setToken] = useState(initial)
  const [form, setForm] = useState(null)
  const [step, setStep] = useState('what')
  const [type, setType] = useState('')
  const [rec, setRec] = useState({})          // { txId: true | false } — "Is this yours?"
  const [picked, setPicked] = useState([])    // which payments a purchase problem is about
  const [answers, setAnswers] = useState({})
  const [statement, setStatement] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    document.title = 'Report a problem with a payment'
    // The link is a key: don't send it to the bank's logo host (or anywhere else) as a referrer
    const meta = Object.assign(document.createElement('meta'), { name: 'referrer', content: 'no-referrer' }); document.head.appendChild(meta)
    openForm(initial).then(f => {
      setForm(f)
      if (f.token) { setToken(f.token); window.history.replaceState(null, '', `/claim/${f.token}`) }
      if (f.cards?.length) setPicked(f.cards.map(c => c.transactionId))
    }).catch(() => setForm({ error: 'We couldn’t open this form — check your connection and try again.' }))
  }, [initial])

  const brand = form?.brand || done?.brand || null
  const accent = brand?.accent || FALLBACK
  const cards = form?.cards || []
  const unauth = UNAUTH.test(type)
  const questions = useMemo(() => (form?.questions?.[type] || []).filter(q => q.id !== 'recognisesTransaction'), [form, type])
  const shown = questions.filter(q => asked(q, answers))
  const missingQ = shown.filter(q => q.required && !answered(q, answers[q.id]))
  const disputed = unauth ? cards.filter(c => rec[c.transactionId] === false) : cards.filter(c => picked.includes(c.transactionId))
  const allYours = unauth && cards.length > 0 && cards.every(c => rec[c.transactionId] === true)

  // The steps this customer goes through, for the progress bar and Back
  const path = ['what', unauth ? 'yours' : cards.length > 1 ? 'which' : null, shown.length || questions.length ? 'questions' : null, 'story'].filter(Boolean)
  const at = Math.max(0, path.indexOf(step))
  const go = dir => { setErr(''); const next = path[at + dir]; if (next) { setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }) } }

  const send = async (all = false) => {
    setBusy(true); setErr('')
    const clean = Object.fromEntries(shown.filter(q => answered(q, answers[q.id])).map(q => [q.id, q.kind === 'amount' ? Number(answers[q.id]) : answers[q.id]]))
    try {
      const r = await sendForm(token, { claimType: type, recognised: unauth ? rec : undefined, transactionIds: unauth ? undefined : picked,
        answers: all ? {} : clean, statement: all ? '' : statement, consent: all ? false : consent })
      setDone(r); setStep('done'); window.scrollTo({ top: 0 })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const header = (
    <header className="cf-top">
      <div className="cf-top-in">
        {brand?.logo ? <img className="cf-logo" src={brand.logo} alt={brand.name} referrerPolicy="no-referrer" />
          : <><div className="cf-mono" aria-hidden>{(brand?.name || 'B').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div><div className="cf-bank">{brand?.name || 'Your bank'}</div></>}
      </div>
    </header>
  )
  const footer = (
    <footer className="cf-foot">
      {brand?.phone && <div>Questions? Call {brand.name} on <a href={`tel:${brand.phone.replace(/[^\d+]/g, '')}`}>{brand.phone}</a>.</div>}
      {brand?.help && <div><a href={brand.help} target="_blank" rel="noopener noreferrer">Help with disputes</a></div>}
      <div style={{ marginTop: 6 }}>{brand?.name || 'Your bank'} uses Covalence to receive claims. What you tell us here goes only to {brand?.name || 'your bank'}.</div>
    </footer>
  )
  const wrap = body => (
    <div className="cf" style={{ '--accent': accent, '--on-accent': onAccent(accent) }}>
      <style>{CSS}</style>{header}<main className="cf-main"><div className="cf-card">{body}</div></main>{footer}
    </div>
  )

  if (!form) return wrap(<p className="cf-sub" style={{ margin: 0 }}>Loading…</p>)
  if (form.error) return wrap(<><h1>This link can’t be used</h1><p className="cf-sub" style={{ margin: 0 }}>{form.error}</p></>)

  const progress = (
    <>
      <p className="cf-step">Step {at + 1} of {path.length}</p>
      <div className="cf-bar" aria-hidden><i style={{ width: `${((at + 1) / path.length) * 100}%` }} /></div>
    </>
  )
  const nav = (ok, label = 'Continue', onNext = () => go(1)) => (
    <div className="cf-nav">
      {at > 0 && <button type="button" className="cf-btn ghost" onClick={() => go(-1)}>Back</button>}
      <button type="button" className="cf-btn" disabled={!ok || busy} onClick={onNext}>{busy ? 'Sending…' : label}</button>
    </div>
  )

  if (step === 'done') return wrap(done?.closedAtIntake ? (
    <><div className="cf-tick" aria-hidden>✓</div><h1>Thanks — there’s nothing to dispute</h1>
      <p className="cf-sub">You told us you recognise {cards.length === 1 ? 'this payment' : 'these payments'}, so we’ve closed this. If you change your mind, contact us and we’ll look again.</p></>
  ) : (
    <><div className="cf-tick" aria-hidden>✓</div><h1>We’ve got your claim</h1>
      <p className="cf-sub" style={{ marginBottom: 6 }}>Your reference:</p>
      <div className="cf-ref">{done?.id}</div>
      <p style={{ margin: '0 0 8px' }}>What happens next:</p>
      <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)' }}>
        <li>We’ll look into it and may contact you if we need anything else.</li>
        <li>Keep any receipts, emails or messages about {disputed.length === 1 ? 'the payment' : 'the payments'}.</li>
        {unauth && <li>If your card is still active and you didn’t make {disputed.length === 1 ? 'this payment' : 'these payments'}, lock it in your banking app or call us.</li>}
      </ul></>
  ))

  if (step === 'what') return wrap(<>
    {progress}
    <h1>{form.firstName ? `Hi ${form.firstName}, what went wrong?` : 'What went wrong?'}</h1>
    <p className="cf-sub">This is about {cards.length === 1 ? 'a payment' : `${cards.length} payments`} on your account. Pick the one that fits best.</p>
    {form.types.map(g => (
      <div key={g.group}>
        <div className="cf-group">{g.group}</div>
        {g.types.map(([v, label]) => <Option key={v} on={type === v} onClick={() => { setType(v); setAnswers({}) }}>{label}</Option>)}
      </div>
    ))}
    {nav(!!type)}
  </>)

  if (step === 'yours') return wrap(<>
    {progress}
    <h1>{cards.length === 1 ? 'Is this payment yours?' : 'Are these payments yours?'}</h1>
    <p className="cf-sub">Payments often show under a different name from the shop’s. Here’s each one as you’d know it.</p>
    {cards.map(c => (
      <Payment key={c.transactionId} card={c}>
        {c.hints?.length > 0 && <ul className="cf-hints">{c.hints.map(h => <li key={h}>{h}</li>)}</ul>}
        <div className="cf-two">
          <Option kind="plain" on={rec[c.transactionId] === true} onClick={() => setRec(r => ({ ...r, [c.transactionId]: true }))}>Yes, that was me</Option>
          <Option kind="plain" on={rec[c.transactionId] === false} onClick={() => setRec(r => ({ ...r, [c.transactionId]: false }))}>No, I don’t recognise it</Option>
        </div>
      </Payment>
    ))}
    {allYours && <p className="cf-hint">You recognise {cards.length === 1 ? 'it' : 'all of them'}, so there’s nothing to dispute.</p>}
    {err && <div className="cf-err" role="alert">{err}</div>}
    {allYours ? nav(true, 'That’s all, close this', () => send(true)) : nav(cards.every(c => typeof rec[c.transactionId] === 'boolean'))}
  </>)

  if (step === 'which') return wrap(<>
    {progress}
    <h1>Which payments is it about?</h1>
    <p className="cf-sub">Tick each one.</p>
    {cards.map(c => (
      <Option key={c.transactionId} kind="check" on={picked.includes(c.transactionId)} onClick={() => setPicked(p => p.includes(c.transactionId) ? p.filter(x => x !== c.transactionId) : [...p, c.transactionId])}>
        <strong>{c.name}</strong> · {c.amountText}<br /><span className="cf-pay-meta">{[when(c.when), c.where].filter(Boolean).join(' · ')}</span>
      </Option>
    ))}
    {nav(picked.length > 0)}
  </>)

  if (step === 'questions') return wrap(<>
    {progress}
    <h1>A few questions</h1>
    <p className="cf-sub">These help us handle your claim under the card and banking rules.</p>
    {shown.map(q => <Question key={q.id} q={q} value={answers[q.id]} set={v => setAnswers(a => ({ ...a, [q.id]: v }))} />)}
    {missingQ.length > 0 && <p className="cf-hint">{missingQ.length === 1 ? 'One question still needs an answer.' : `${missingQ.length} questions still need an answer.`}</p>}
    {nav(!missingQ.length)}
  </>)

  // story
  return wrap(<>
    {progress}
    <h1>In your own words</h1>
    <p className="cf-sub">Tell us what happened{disputed.length ? ` with ${disputed.length === 1 ? disputed[0].name : `these ${disputed.length} payments`}` : ''}. Include anything that might help.</p>
    <div className="cf-q">
      <label htmlFor="cf-story">What happened</label>
      <textarea id="cf-story" maxLength={4000} value={statement} onChange={e => setStatement(e.target.value)} />
      {statement.trim().length > 0 && statement.trim().length < 20 && <div className="cf-hint">A little more detail helps us act faster.</div>}
    </div>
    <Option kind="check" on={consent} onClick={() => setConsent(c => !c)}>{form.consentText}</Option>
    {err && <div className="cf-err" role="alert">{err}</div>}
    {nav(consent && statement.trim().length > 0, 'Send my claim', () => send(false))}
  </>)
}

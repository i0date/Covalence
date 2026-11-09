// ═══════════════════════════════════════════════════════════════════════════════
// THE HOSTED ONBOARDING FORM — public page at /onboard/<token>
// ═══════════════════════════════════════════════════════════════════════════════
// What a new customer sees when they open an account from the bank's app or website,
// when the bank uses Covalence's form instead of building its own (onboarding.mjs).
// Always in the bank's name. No sign-in: the link is the key, and it works once.
//   A person: about you → your home → your ID number → the account → public position → check and send
//   A business: the business → you → its owners → the account → public position → check and send
// The ID number goes straight to the bank's systems and isn't kept here (api/_onboarding.js).
// Photo ID and a selfie come next, from the bank's own identity check.
// /onboard/demo and /onboard/demo-business are samples: nothing is stored or sent.
import React, { useEffect, useState } from 'react'
import { CSS } from './ClaimFormPage.jsx'
import { openOnboardForm, sendOnboardForm } from './onboardingData.js'
import { CONSENT, INDUSTRIES, MONTHLY, PURPOSES, SOURCES, isAdult, normaliseApplication } from './onboarding.mjs'

const EXTRA = `
  .ob-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .ob-grid .full { grid-column:1 / -1; }
  .ob-f label { display:block; font-weight:600; margin-bottom:6px; font-size:15px; }
  .ob-f .ob-hint { font-weight:400; color:var(--muted); font-size:13px; }
  .cf select, .cf input[type=email], .cf input[type=tel], .cf input[type=password] { width:100%; font:inherit; padding:11px 12px; border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:0; }
  .ob-owner { border:1px solid var(--line); background:#fff; padding:14px; margin-bottom:10px; }
  .ob-sum { margin:0 0 14px; padding:0; list-style:none; border-top:1px solid var(--line); }
  .ob-sum li { display:flex; gap:12px; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--line); font-size:15px; }
  .ob-sum li span:first-child { color:var(--muted); }
  .ob-sum li span:last-child { text-align:right; overflow-wrap:anywhere; }
  .ob-link { background:none; border:0; padding:0; font:inherit; color:var(--ink); text-decoration:underline; cursor:pointer; }
  @media (max-width:480px) { .ob-grid { grid-template-columns:1fr; } }
`
const STEPS = { person: ['you', 'home', 'id', 'account', 'pep', 'send'], business: ['business', 'you', 'owners', 'account', 'pep', 'send'] }
const NAMES = { you: 'About you', home: 'Your home', id: 'Your ID number', business: 'The business', owners: 'Its owners', account: 'The account', pep: 'Public positions', send: 'Check and send' }
const emptyAddr = { line1: '', line2: '', city: '', region: '', postal: '', country: 'US' }
const emptyOwner = () => ({ name: '', dob: '', ownership: '', controller: false, title: '', address: { ...emptyAddr }, idNumber: '' })
const ssnShape = v => v.replace(/\D/g, '').slice(0, 9).replace(/^(\d{3})(\d{1,2})?(\d{1,4})?$/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'))
const einShape = v => v.replace(/\D/g, '').slice(0, 9).replace(/^(\d{2})(\d{1,7})?$/, (_, a, b) => [a, b].filter(Boolean).join('-'))
const label = (list, v) => (list.find(x => x[0] === v) || [])[1] || '—'

function Field({ label: l, hint, children, full }) {
  return <div className={`ob-f${full ? ' full' : ''}`}><label>{l}{hint && <span className="ob-hint"> {hint}</span>}{children}</label></div>
}
function Opt({ on, onClick, children }) {
  return <button type="button" className="cf-opt" aria-pressed={on} onClick={onClick}><span className="cf-dot" aria-hidden /><span>{children}</span></button>
}
function YesNo({ value, onChange }) {
  return <div className="cf-two">{[[true, 'Yes'], [false, 'No']].map(([v, l]) => <button key={l} type="button" className="cf-opt" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>
}
function Address({ value, onChange, idp }) {
  const set = k => e => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="ob-grid">
      <Field label="Street address" full><input id={idp + '-l1'} type="text" autoComplete="address-line1" value={value.line1} onChange={set('line1')} /></Field>
      <Field label="Apartment, suite" hint="(optional)" full><input type="text" autoComplete="address-line2" value={value.line2} onChange={set('line2')} /></Field>
      <Field label="City"><input type="text" autoComplete="address-level2" value={value.city} onChange={set('city')} /></Field>
      <Field label="State"><input type="text" autoComplete="address-level1" value={value.region} onChange={set('region')} /></Field>
      <Field label="ZIP or postal code"><input type="text" autoComplete="postal-code" value={value.postal} onChange={set('postal')} /></Field>
      <Field label="Country"><select autoComplete="country" value={value.country} onChange={set('country')}>
        {[['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'], ['GB', 'United Kingdom'], ['PR', 'Puerto Rico']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        {!['US', 'CA', 'MX', 'GB', 'PR'].includes(value.country) && <option value={value.country}>{value.country}</option>}
      </select></Field>
    </div>
  )
}
const addrDone = a => a.line1.trim() && a.city.trim() && a.postal.trim()

export default function OnboardPage({ token }) {
  const [form, setForm] = useState(null), [step, setStep] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [done, setDone] = useState(null)
  const [me, setMe] = useState({ name: '', dob: '', email: '', phone: '', address: { ...emptyAddr }, idNumber: '', title: '' })
  const [biz, setBiz] = useState({ name: '', dba: '', type: 'LLC', industry: '', registeredIn: '', formedOn: '', website: '', ein: '', description: '', address: { ...emptyAddr } })
  const [owners, setOwners] = useState([])
  const [occupation, setOccupation] = useState(''), [purpose, setPurpose] = useState(''), [monthly, setMonthly] = useState(''), [cash, setCash] = useState(null)
  const [intl, setIntl] = useState(null), [countries, setCountries] = useState(''), [source, setSource] = useState(''), [pep, setPep] = useState(null), [pepDetail, setPepDetail] = useState(''), [consent, setConsent] = useState(false)

  useEffect(() => {
    openOnboardForm(token).then(f => {
      setForm(f)
      const p = f?.prefill || {}
      if (p.name || p.email || p.phone) setMe(m => ({ ...m, name: p.name || '', email: p.email || '', phone: p.phone || '' }))
      if (p.businessName) setBiz(b => ({ ...b, name: p.businessName }))
    })
  }, [token])
  useEffect(() => { document.title = form?.brand?.name ? `Open an account · ${form.brand.name}` : 'Open an account' }, [form])
  useEffect(() => { window.scrollTo(0, 0) }, [step, done])

  const brand = form?.brand, kind = form?.kind || 'person', steps = STEPS[kind], at = steps[step]
  const header = (
    <header className="cf-top"><div className="cf-top-in">
      {brand?.logo ? <img className="cf-logo" src={brand.logo} alt={brand.name} referrerPolicy="no-referrer" /> : <div className="cf-bank">{brand?.name || ''}</div>}
      <span className="mono cf-what">OPEN AN ACCOUNT</span>
    </div></header>
  )
  const footer = (
    <footer className="cf-foot">
      {brand?.phone && <div>Questions? Call {brand.name} on <a href={`tel:${brand.phone.replace(/[^\d+]/g, '')}`}>{brand.phone}</a>.</div>}
      {form?.demo && <div className="mono" style={{ marginTop: 8, fontSize: 10, letterSpacing: '.12em' }}>SAMPLE FORM · NOTHING YOU ENTER IS SENT</div>}
    </footer>
  )
  const wrap = body => <div className="cf"><style>{CSS + EXTRA}</style>{header}<main className="cf-main"><div className="cf-card">{body}</div></main>{footer}</div>
  if (!form) return wrap(<p className="mono cf-step">LOADING…</p>)
  if (form.error) return wrap(<><h1>We can’t open this application</h1><p className="cf-sub">{form.error}</p></>)

  if (done) return wrap(<>
    <div className="cf-tick" aria-hidden>✓</div>
    <h1>Thanks — {brand.name} has your application</h1>
    <p className="mono cf-step" style={{ marginBottom: 6 }}>YOUR REFERENCE</p>
    <div className="cf-ref">{done.id}</div>
    <p style={{ margin: '0 0 8px' }}>What happens next:</p>
    <ul style={{ margin: 0, paddingLeft: 20, color: '#57534E' }}>
      <li>{brand.name} will ask you for a photo ID and a quick selfie, to confirm it’s you.</li>
      <li>They’ll check the details you gave and let you know when your account is open, or if they need anything else.</li>
      {kind === 'business' && <li>Each owner you named may be asked to confirm who they are too.</li>}
    </ul>
    {done.demo && <div className="cf-note">This was a sample. Nothing was sent to {brand.name}.</div>}
  </>)

  // What's needed before Next
  const ownersOk = owners.length > 0 && owners.every(o => o.name.trim() && o.dob && addrDone(o.address) && Number(o.ownership) >= 0) && owners.some(o => o.controller)
    && owners.reduce((n, o) => n + (Number(o.ownership) || 0), 0) <= 100
  const ready = {
    you: me.name.trim() && me.dob && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(me.email) && me.phone.replace(/\D/g, '').length >= 10 && (kind === 'business' ? addrDone(me.address) && me.idNumber.replace(/\D/g, '').length === 9 && me.title.trim() : occupation.trim()),
    home: addrDone(me.address),
    id: me.idNumber.replace(/\D/g, '').length === 9,
    business: biz.name.trim() && biz.industry && addrDone(biz.address) && biz.ein.replace(/\D/g, '').length === 9,
    owners: ownersOk,
    account: purpose && monthly && cash !== null && intl !== null && source && (!intl || countries.trim()),
    pep: pep !== null && (!pep || pepDetail.trim()),
    send: consent,
  }
  const minorYou = at === 'you' && me.dob && !isAdult(me.dob)

  const application = () => ({
    kind, applicant: { ...me }, occupation: kind === 'person' ? occupation : me.title,
    ...(kind === 'business' ? { business: biz, owners: owners.map(o => ({ ...o, ownership: Number(o.ownership) || 0 })) } : {}),
    purpose, activity: { monthly, cash: !!cash, international: !!intl, countries: intl ? countries : '' }, sourceOfFunds: source, pep: { declared: !!pep, detail: pep ? pepDetail : '' }, consent,
  })
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const { errors } = normaliseApplication(application())
      if (errors.length) throw new Error('Some answers are missing — go back and check each step.')
      setDone(await sendOnboardForm(token, application()))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const body = {
    you: <>
      <h1>{kind === 'business' ? 'About you' : 'Let’s start with you'}</h1>
      <p className="cf-sub">{kind === 'business' ? `You’re opening the account for the business. ${brand.name} needs to know who you are, too.` : `Use your legal name, as it is on your ID.`}</p>
      <div className="ob-grid">
        <Field label="Full legal name" full><input type="text" autoComplete="name" value={me.name} onChange={e => setMe({ ...me, name: e.target.value })} /></Field>
        <Field label="Date of birth"><input type="date" autoComplete="bday" value={me.dob} max={new Date().toISOString().slice(0, 10)} onChange={e => setMe({ ...me, dob: e.target.value })} /></Field>
        <Field label="Mobile number"><input type="tel" autoComplete="tel" value={me.phone} onChange={e => setMe({ ...me, phone: e.target.value })} /></Field>
        <Field label="Email" full><input type="email" autoComplete="email" value={me.email} onChange={e => setMe({ ...me, email: e.target.value })} /></Field>
        {kind === 'person'
          ? <Field label="What do you do for work?" full><input type="text" value={occupation} placeholder="For example: nurse, retired, student" onChange={e => setOccupation(e.target.value)} /></Field>
          : <Field label="Your role in the business" full><input type="text" value={me.title} placeholder="For example: owner, CEO, finance director" onChange={e => setMe({ ...me, title: e.target.value })} /></Field>}
      </div>
      {kind === 'business' && <><div className="cf-group">Your home address</div><Address idp="me" value={me.address} onChange={a => setMe({ ...me, address: a })} />
        <div className="cf-group">Your Social Security number</div>
        <Field label="SSN or ITIN" hint="— goes straight to the bank and isn’t kept by this form"><input type="password" inputMode="numeric" autoComplete="off" value={me.idNumber} onChange={e => setMe({ ...me, idNumber: ssnShape(e.target.value) })} /></Field></>}
      {minorYou && <div className="cf-note">You need to be 18 or over to open this account. {brand.name} can tell you about accounts for younger people.</div>}
    </>,
    home: <>
      <h1>Where do you live?</h1>
      <p className="cf-sub">Your home address, not a PO box. {brand.name} uses it to confirm who you are.</p>
      <Address idp="home" value={me.address} onChange={a => setMe({ ...me, address: a })} />
    </>,
    id: <>
      <h1>Your Social Security number</h1>
      <p className="cf-sub">Banks in the US are required to ask for it to confirm who you are. It goes straight to {brand.name} and isn’t kept by this form. An ITIN works too.</p>
      <Field label="SSN or ITIN"><input type="password" inputMode="numeric" autoComplete="off" value={me.idNumber} onChange={e => setMe({ ...me, idNumber: ssnShape(e.target.value) })} /></Field>
      <p className="cf-hint">Nine digits. {brand.name} won’t ask for it by text or email.</p>
    </>,
    business: <>
      <h1>About the business</h1>
      <p className="cf-sub">As it’s registered with the state.</p>
      <div className="ob-grid">
        <Field label="Legal name" full><input type="text" autoComplete="organization" value={biz.name} onChange={e => setBiz({ ...biz, name: e.target.value })} /></Field>
        <Field label="Trading name" hint="(if different)" full><input type="text" value={biz.dba} onChange={e => setBiz({ ...biz, dba: e.target.value })} /></Field>
        <Field label="Type"><select value={biz.type} onChange={e => setBiz({ ...biz, type: e.target.value })}>{['LLC', 'Corporation', 'Partnership', 'Sole proprietor', 'Non-profit'].map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="State where it’s registered"><input type="text" value={biz.registeredIn} onChange={e => setBiz({ ...biz, registeredIn: e.target.value })} /></Field>
        <Field label="What it does" full><select value={biz.industry} onChange={e => setBiz({ ...biz, industry: e.target.value })}><option value="">Choose one…</option>{INDUSTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="When it was formed" hint="(optional)"><input type="date" value={biz.formedOn} onChange={e => setBiz({ ...biz, formedOn: e.target.value })} /></Field>
        <Field label="Website" hint="(optional)"><input type="text" inputMode="url" placeholder="https://" value={biz.website} onChange={e => setBiz({ ...biz, website: e.target.value })} /></Field>
        <Field label="Employer Identification Number (EIN)" hint="— goes straight to the bank" full><input type="text" inputMode="numeric" autoComplete="off" value={biz.ein} onChange={e => setBiz({ ...biz, ein: einShape(e.target.value) })} /></Field>
      </div>
      <div className="cf-group">Where it operates from</div>
      <Address idp="biz" value={biz.address} onChange={a => setBiz({ ...biz, address: a })} />
    </>,
    owners: <>
      <h1>Who owns and runs it?</h1>
      <p className="cf-sub">The law asks {brand.name} for everyone who owns 25% or more of the business, and one person who manages it, such as the CEO or the managing member. If that’s you, add yourself.</p>
      {owners.map((o, i) => {
        const set = patch => setOwners(list => list.map((x, j) => j === i ? { ...x, ...patch } : x))
        return (
          <div key={i} className="ob-owner">
            <div className="ob-grid">
              <Field label="Full legal name" full><input type="text" value={o.name} onChange={e => set({ name: e.target.value })} /></Field>
              <Field label="Date of birth"><input type="date" value={o.dob} onChange={e => set({ dob: e.target.value })} /></Field>
              <Field label="Share they own (%)"><input type="number" min="0" max="100" inputMode="numeric" value={o.ownership} onChange={e => set({ ownership: e.target.value })} /></Field>
            </div>
            <div style={{ margin: '10px 0' }}><button type="button" className="cf-opt" role="checkbox" aria-checked={o.controller} onClick={() => set({ controller: !o.controller })}>
              <span className="cf-box" aria-hidden>{o.controller ? '✓' : ''}</span><span>This person manages the business day to day</span></button></div>
            <Address idp={'o' + i} value={o.address} onChange={a => set({ address: a })} />
            <div style={{ marginTop: 10 }}><button type="button" className="ob-link" onClick={() => setOwners(list => list.filter((_, j) => j !== i))}>Remove this person</button></div>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <button type="button" className="cf-btn ghost" onClick={() => setOwners(list => [...list, emptyOwner()])}>Add a person</button>
        {!owners.some(o => o.name === me.name) && me.name && <button type="button" className="ob-link" onClick={() => setOwners(list => [...list, { ...emptyOwner(), name: me.name, dob: me.dob, address: { ...me.address }, controller: true, title: me.title }])}>Add yourself</button>}
      </div>
      {owners.length > 0 && !owners.some(o => o.controller) && <p className="cf-hint">Tick the person who manages the business.</p>}
      {owners.reduce((n, o) => n + (Number(o.ownership) || 0), 0) > 100 && <div className="cf-err">The shares add up to more than 100%.</div>}
    </>,
    account: <>
      <h1>How you’ll use the account</h1>
      <p className="cf-sub">{brand.name} asks every customer this. It helps them spot anything unusual on your account later.</p>
      <div className="cf-group">Mainly for</div>
      {PURPOSES[kind].map(([k, l]) => <Opt key={k} on={purpose === k} onClick={() => setPurpose(k)}>{l}</Opt>)}
      <div className="cf-group">About how much will go in each month?</div>
      {MONTHLY.map(([k, l]) => <Opt key={k} on={monthly === k} onClick={() => setMonthly(k)}>{l}</Opt>)}
      <div className="cf-group">Where the money comes from</div>
      <select value={source} onChange={e => setSource(e.target.value)} aria-label="Where the money comes from"><option value="">Choose one…</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <div className="cf-group">Will you deposit cash?</div>
      <YesNo value={cash} onChange={setCash} />
      <div className="cf-group">Will you send or receive money from other countries?</div>
      <YesNo value={intl} onChange={setIntl} />
      {intl && <div className="cf-q" style={{ marginTop: 12 }}><label>Which countries?<input type="text" value={countries} onChange={e => setCountries(e.target.value)} /></label></div>}
    </>,
    pep: <>
      <h1>Public positions</h1>
      <p className="cf-sub">{kind === 'business' ? 'Do you, or anyone you named, hold' : 'Do you hold'}, or have {kind === 'business' ? 'they' : 'you'} held, a senior public position? For example a government minister, a judge, a senior military officer, an ambassador, or a senior official of a political party or a state-owned company. Close family and associates of someone like that count too.</p>
      <YesNo value={pep} onChange={setPep} />
      {pep && <div className="cf-q" style={{ marginTop: 12 }}><label>Who, and what position?<input type="text" value={pepDetail} onChange={e => setPepDetail(e.target.value)} /></label></div>}
      <p className="cf-hint">Saying yes doesn’t stop you opening an account. {brand.name} may ask a few more questions.</p>
    </>,
    send: <>
      <h1>Check and send</h1>
      <ul className="ob-sum">
        {kind === 'business' && <li><span>Business</span><span>{biz.name}{biz.dba ? ` (${biz.dba})` : ''}</span></li>}
        {kind === 'business' && <li><span>Owners</span><span>{owners.map(o => `${o.name} ${Number(o.ownership) || 0}%${o.controller ? ', manages it' : ''}`).join('; ')}</span></li>}
        <li><span>{kind === 'business' ? 'Opened by' : 'Name'}</span><span>{me.name}</span></li>
        <li><span>Email</span><span>{me.email}</span></li>
        <li><span>Address</span><span>{[(kind === 'business' ? biz : me).address.line1, (kind === 'business' ? biz : me).address.city, (kind === 'business' ? biz : me).address.region].filter(Boolean).join(', ')}</span></li>
        <li><span>{kind === 'business' ? 'EIN' : 'SSN or ITIN'}</span><span>•••{(kind === 'business' ? biz.ein : me.idNumber).replace(/\D/g, '').slice(-4)}</span></li>
        <li><span>The account</span><span>{label(PURPOSES[kind], purpose)} · {label(MONTHLY, monthly)} a month</span></li>
      </ul>
      <button type="button" className="cf-opt" role="checkbox" aria-checked={consent} onClick={() => setConsent(!consent)}>
        <span className="cf-box" aria-hidden>{consent ? '✓' : ''}</span><span>{CONSENT[kind].replace('the bank', brand.name)}</span>
      </button>
    </>,
  }[at]

  return wrap(<>
    <p className="mono cf-step">STEP {step + 1} OF {steps.length} · {NAMES[at].toUpperCase()}</p>
    <div className="cf-bar" aria-hidden><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
    {body}
    {err && <div className="cf-err" role="alert">{err}</div>}
    <div className="cf-nav">
      {step > 0 && <button type="button" className="cf-btn ghost" onClick={() => { setErr(''); setStep(step - 1) }}>Back</button>}
      {at === 'send'
        ? <button type="button" className="cf-btn" disabled={!consent || busy} onClick={send}>{busy ? 'Sending…' : `Send to ${brand.name}`}</button>
        : <button type="button" className="cf-btn" disabled={!ready[at] || minorYou} onClick={() => { setErr(''); setStep(step + 1) }}>Next</button>}
    </div>
  </>)
}

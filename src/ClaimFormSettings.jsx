// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS → CLAIM FORM — your name on the hosted claim form
// ═══════════════════════════════════════════════════════════════════════════════
// The form (/claim/<token>, ClaimFormPage.jsx) is what your app or website opens
// when a customer taps "Report a problem", if you don't build claim screens of your
// own. It's in Covalence's style; this sets the name, logo and phone number at the
// top and bottom. Stored for the institution (supabase_claim_links.sql claim_form),
// not in this browser, because the customer's page reads it on the server. Admins
// and reviewers change it; every change is audited (claim.form_changed).
import React, { useEffect, useState } from 'react'
import { getClaimForm, setClaimForm } from './claimLinksData.js'
import { normaliseBrand } from './claimLinks.mjs'
import { Button, Field, Input } from './ui.jsx'

const EMPTY = { display_name: '', logo_url: '', support_phone: '', help_url: '' }
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', overflow:'hidden' }
const head = { background:'#EEE9E0', borderBottom:'1px solid #D4CCBC', padding:'10px 20px' }
const pick = r => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, r?.[k] || ''])) })

export function ClaimFormSettings({ locked, demo }) {
  const [f, setF] = useState(null), [inst, setInst] = useState(''), [saved, setSaved] = useState(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [ok, setOk] = useState(false)
  useEffect(() => {
    getClaimForm().then(r => { const v = pick(r); setF(v); setSaved(v); setInst(r?.institution || '') })
      .catch(e => { setF(EMPTY); setSaved(EMPTY); setErr(e.message) })
  }, [])
  if (!f) return null
  const set = (k, v) => { setF({ ...f, [k]: v }); setOk(false) }
  const changed = JSON.stringify(f) !== JSON.stringify(saved)
  const problems = [
    f.logo_url && !/^https:\/\//i.test(f.logo_url) && 'The logo needs an https:// link',
    f.help_url && !/^https:\/\//i.test(f.help_url) && 'The help page needs an https:// link',
  ].filter(Boolean)
  const save = async () => {
    setBusy(true); setErr('')
    try { const v = pick(await setClaimForm(f)); setF(v); setSaved(v); setOk(true) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const b = normaliseBrand(problems.length ? { ...f, logo_url: '' } : f, inst)

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
      <div style={box}>
        <div style={head}><span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E' }}>ON THE FORM</span></div>
        <fieldset disabled={locked} style={{ border:0, margin:0, padding:'20px', display:'grid', gap:'16px', minWidth:0, opacity: locked ? 0.75 : 1 }}>
          <Field label="Your name" htmlFor="cf-name" hint={`Leave it blank to use ${inst || 'your institution’s name'}.`}>
            <Input id="cf-name" value={f.display_name} onChange={e => set('display_name', e.target.value)} placeholder={inst} maxLength={120} />
          </Field>
          <Field label="Logo" htmlFor="cf-logo" hint="An https:// link to a light version of your logo, about 28px tall, for a dark bar. Without one, your name is shown.">
            <Input id="cf-logo" value={f.logo_url} onChange={e => set('logo_url', e.target.value.trim())} placeholder="https://www.yourbank.com/logo-white.svg" />
          </Field>
          <Field label="Phone number for questions" htmlFor="cf-phone">
            <Input id="cf-phone" value={f.support_phone} onChange={e => set('support_phone', e.target.value)} placeholder="1-800-555-0100" maxLength={40} />
          </Field>
          <Field label="Help page (optional)" htmlFor="cf-help" hint="Your own page about disputes and fraud.">
            <Input id="cf-help" value={f.help_url} onChange={e => set('help_url', e.target.value.trim())} placeholder="https://www.yourbank.com/help/disputes" />
          </Field>
          {problems.map(p => <p key={p} className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0 }}>{p}</p>)}
          {err && <p role="alert" className="mono-font" style={{ fontSize:'11px', color:'#991B1B', margin:0 }}>{err}</p>}
          {!locked && <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
            <Button disabled={!changed || busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
            {ok && <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#065F46' }}>SAVED</span>}
          </div>}
        </fieldset>
      </div>

      <div style={box}>
        <div style={head}><span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E' }}>PREVIEW</span></div>
        <div style={{ padding:'20px', display:'grid', gap:'14px' }}>
          <div style={{ border:'1px solid #D4CCBC', background:'#F5F1EA' }} aria-label="Preview of the claim form">
            <div style={{ background:'#1A1814', color:'#F5F1EA', padding:'10px 14px', display:'flex', alignItems:'center', gap:'10px' }}>
              {b.logo ? <img src={b.logo} alt="" referrerPolicy="no-referrer" style={{ height:'24px', maxWidth:'140px', objectFit:'contain' }} /> : <span className="display-font" style={{ fontWeight:600 }}>{b.name}</span>}
              <span className="mono-font" style={{ marginLeft:'auto', fontSize:'9px', letterSpacing:'0.16em', color:'#BFB6A8' }}>REPORT A PROBLEM</span>
            </div>
            <div style={{ padding:'14px' }}>
              <div style={{ background:'#FAF7F1', border:'1px solid #D4CCBC', padding:'14px' }}>
                <div className="display-font" style={{ fontWeight:600, fontSize:'18px', color:'#1A1814', marginBottom:'10px' }}>Jordan, what went wrong?</div>
                {['Someone used my card or account online', 'I didn’t receive it'].map((t, i) => (
                  <div key={t} className="display-font" style={{ border:'1px solid ' + (i === 0 ? '#1A1814' : '#D4CCBC'), background: i === 0 ? '#EEE9E0' : '#fff', padding:'9px 11px', marginBottom:'6px', fontSize:'14px' }}>{t}</div>
                ))}
                <div style={{ textAlign:'right', marginTop:'10px' }}><span className="mono-font" style={{ background:'#1A1814', color:'#F5F1EA', padding:'9px 14px', fontSize:'10px', letterSpacing:'0.16em', display:'inline-block' }}>CONTINUE</span></div>
              </div>
              {b.phone && <div className="display-font" style={{ fontSize:'12px', color:'#6B6259', marginTop:'10px' }}>Need to talk to someone? Call {b.name} on {b.phone}.</div>}
            </div>
          </div>
          <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:0, lineHeight:1.5 }}>
            Your app or website opens the form when a customer taps “Report a problem”: your systems ask Covalence for a link for that customer and their recent payments (see For your developers under Connections). Fraud and scams arrive in <strong>001 Triage → Claims</strong>; disputes about a purchase go straight to the <strong>Dispute Desk</strong>.
            {demo && <> <a className="mono-font cov-ref-more" href="/claim/demo" target="_blank" rel="noopener noreferrer">try it as a customer</a></>}
          </p>
        </div>
      </div>
    </div>
  )
}

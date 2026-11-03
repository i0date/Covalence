// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS → CLAIM FORM — how the hosted claim form looks to your customers
// ═══════════════════════════════════════════════════════════════════════════════
// The name, colour, logo and phone number on /claim/<token> (ClaimFormPage.jsx).
// Stored for the institution (supabase_claim_links.sql claim_form), not in this
// browser, because the customer's page reads it on the server. Admins and
// reviewers change it; every change is audited (claim.form_changed).
import React, { useEffect, useState } from 'react'
import { getClaimForm, setClaimForm } from './claimLinksData.js'
import { normaliseBrand, onAccent } from './claimLinks.mjs'
import { Button, Field, Input } from './ui.jsx'

const EMPTY = { display_name: '', accent: '', logo_url: '', support_phone: '', help_url: '' }
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', overflow:'hidden' }
const head = { background:'#EEE9E0', borderBottom:'1px solid #D4CCBC', padding:'10px 20px' }

export function ClaimFormSettings({ locked, demo }) {
  const [f, setF] = useState(null), [inst, setInst] = useState(''), [saved, setSaved] = useState(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [ok, setOk] = useState(false)
  useEffect(() => {
    getClaimForm().then(r => { const v = { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, r?.[k] || ''])) }; setF(v); setSaved(v); setInst(r?.institution || '') })
      .catch(e => { setF(EMPTY); setSaved(EMPTY); setErr(e.message) })
  }, [])
  if (!f) return null
  const set = (k, v) => { setF({ ...f, [k]: v }); setOk(false) }
  const changed = JSON.stringify(f) !== JSON.stringify(saved)
  const problems = [
    f.accent && !/^#[0-9a-f]{6}$/i.test(f.accent) && 'The colour should look like #1E3A5F',
    f.logo_url && !/^https:\/\//i.test(f.logo_url) && 'The logo needs an https:// link',
    f.help_url && !/^https:\/\//i.test(f.help_url) && 'The help page needs an https:// link',
  ].filter(Boolean)
  const save = async () => {
    setBusy(true); setErr('')
    try { const r = await setClaimForm(f); const v = { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, r?.[k] || ''])) }; setF(v); setSaved(v); setOk(true) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const b = normaliseBrand(problems.length ? { ...f, accent: '', logo_url: '' } : f, inst)
  const accent = b.accent || '#1E3A5F'

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
      <div style={box}>
        <div style={head}><span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E' }}>WHAT YOUR CUSTOMERS SEE</span></div>
        <fieldset disabled={locked} style={{ border:0, margin:0, padding:'20px', display:'grid', gap:'16px', minWidth:0, opacity: locked ? 0.75 : 1 }}>
          <Field label="Name on the form" htmlFor="cf-name" hint={`Leave it blank to use ${inst || 'your institution’s name'}.`}>
            <Input id="cf-name" value={f.display_name} onChange={e => set('display_name', e.target.value)} placeholder={inst} maxLength={120} />
          </Field>
          <Field label="Colour" htmlFor="cf-accent" hint="The bar across the top and the buttons. Text on it turns dark or light to stay readable.">
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <input type="color" aria-label="Pick a colour" value={/^#[0-9a-f]{6}$/i.test(f.accent) ? f.accent : '#1E3A5F'} onChange={e => set('accent', e.target.value.toUpperCase())}
                style={{ width:'44px', height:'40px', padding:0, border:'1px solid #D4CCBC', background:'none', cursor:'pointer' }} />
              <Input id="cf-accent" value={f.accent} onChange={e => set('accent', e.target.value.trim())} placeholder="#1E3A5F" style={{ maxWidth:'140px' }} />
            </div>
          </Field>
          <Field label="Logo" htmlFor="cf-logo" hint="An https:// link to your logo (PNG or SVG, about 32px tall, light on your colour). Without one, your initials are shown.">
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
          <div style={{ border:'1px solid #DCE0E5', borderRadius:'12px', overflow:'hidden', background:'#EEF1F4', fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" }} aria-label="Preview of the claim form">
            <div style={{ background:accent, color:onAccent(accent), padding:'12px 14px', display:'flex', alignItems:'center', gap:'10px' }}>
              {b.logo ? <img src={b.logo} alt="" referrerPolicy="no-referrer" style={{ height:'26px', maxWidth:'140px', objectFit:'contain' }} />
                : <><span style={{ width:'28px', height:'28px', borderRadius:'7px', background:'rgba(255,255,255,.18)', display:'grid', placeItems:'center', fontWeight:700, fontSize:'12px' }}>{b.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <span style={{ fontWeight:600 }}>{b.name}</span></>}
            </div>
            <div style={{ padding:'14px' }}>
              <div style={{ background:'#fff', border:'1px solid #DCE0E5', borderRadius:'10px', padding:'14px' }}>
                <div style={{ fontWeight:650, fontSize:'17px', color:'#1B1F24', marginBottom:'10px' }}>Hi Jordan, what went wrong?</div>
                {['Someone used my card or account online', 'I didn’t receive it'].map((t, i) => (
                  <div key={t} style={{ border:`1.5px solid ${i === 0 ? accent : '#DCE0E5'}`, borderRadius:'8px', padding:'9px 11px', marginBottom:'6px', fontSize:'14px', color:'#1B1F24' }}>{t}</div>
                ))}
                <div style={{ textAlign:'right', marginTop:'10px' }}><span style={{ background:accent, color:onAccent(accent), borderRadius:'8px', padding:'8px 14px', fontWeight:600, fontSize:'14px', display:'inline-block' }}>Continue</span></div>
              </div>
              {b.phone && <div style={{ fontSize:'12px', color:'#5B6470', marginTop:'10px' }}>Questions? Call {b.name} on {b.phone}.</div>}
            </div>
          </div>
          <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:0, lineHeight:1.5 }}>
            You send a customer the form from <strong>001 Triage → Claims</strong>, or your systems make links through the API (see For your developers under Connections).
            {demo && <> <a className="mono-font cov-ref-more" href="/claim/demo" target="_blank" rel="noopener noreferrer">try it as a customer</a></>}
          </p>
        </div>
      </div>
    </div>
  )
}

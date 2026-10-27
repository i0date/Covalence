// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SCREENS — email-code sign-in, institution onboarding, team management
// ═══════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react'
import { sendCode, verifyCode, signOut, createInstitution, acceptInvite, pendingInvite, clearPendingInvite,
         createInvite, listTeam, listInvites, revokeInvite, removeMember, inviteLink, setMemberRole, ROLES } from './auth.js'

// Shared dark styles — match the welcome screen
const gate = {
  label: { fontFamily:'monospace', fontSize:'9px', letterSpacing:'0.2em', color:'#78716C', marginBottom:'6px' },
  input: { width:'100%', background:'#252320', border:'1px solid #3D3A35', color:'#E7E4DF', padding:'10px 14px', fontFamily:'monospace', fontSize:'16px', outline:'none', boxSizing:'border-box' },
  btn:   { width:'100%', padding:'12px', background:'#292524', border:'1px solid #57534E', color:'#E7E4DF', fontFamily:'monospace', fontSize:'10px', letterSpacing:'0.15em', cursor:'pointer' },
  link:  { background:'none', border:'none', color:'#78716C', fontFamily:'monospace', fontSize:'9px', letterSpacing:'0.12em', cursor:'pointer', padding:0, textDecoration:'underline', textUnderlineOffset:'3px' },
  err:   { fontFamily:'monospace', fontSize:'9px', color:'#F87171', letterSpacing:'0.05em', marginBottom:'12px' },
  note:  { fontFamily:'monospace', fontSize:'10px', color:'#A8A29E', letterSpacing:'0.04em', lineHeight:1.6, marginBottom:'20px' },
}
export function GateShell({ title, subtitle, children }) {
  return (
    <div style={{ minHeight:'100vh', background:'#1A1814', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
      <div style={{ width:'100%', maxWidth:'400px' }}>
        <div style={{ fontFamily:'monospace', fontSize:'9px', letterSpacing:'0.25em', color:'#57534E', marginBottom:'32px' }}>COVALENCE · DISPUTE OPS</div>
        <div style={{ fontFamily:'Georgia,serif', fontSize:'26px', color:'#E7E4DF', letterSpacing:'-0.02em', marginBottom:'6px' }}>{title}</div>
        {subtitle && <div style={{ fontFamily:'monospace', fontSize:'10px', color:'#78716C', letterSpacing:'0.05em', marginBottom:'32px', lineHeight:1.6 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  )
}
// Inside the welcome page's right-hand panel the sign-in form sits without its own full-screen shell
function Shell({ embedded, title, subtitle, children }) {
  if (!embedded) return <GateShell title={title} subtitle={subtitle}>{children}</GateShell>
  return <div>{subtitle && <div style={{ fontFamily:'monospace', fontSize:'10px', color:'#A8A29E', letterSpacing:'0.04em', lineHeight:1.6, marginBottom:'24px' }}>{subtitle}</div>}{children}</div>
}
const Field = ({ label, children }) => <div style={{ marginBottom:'16px' }}><div style={gate.label}>{label}</div>{children}</div>

// ── Sign in with an emailed code ──────────────────────────────────────────────
export function SignInPanel({ onBack, embedded }) {
  const [step,    setStep]    = useState('email')   // email | code
  const [email,   setEmail]   = useState('')
  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const invited = !!pendingInvite()

  const send = async (e) => {
    e?.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErr('Enter a valid email address.'); return }
    setLoading(true); setErr('')
    try { await sendCode(email); setStep('code') }
    catch (x) { setErr(/rate|limit|seconds/i.test(x.message) ? 'Too many codes requested — wait a minute and try again.' : x.message) }
    setLoading(false)
  }
  const verify = async (e) => {
    e.preventDefault()
    if (!/^\d{6,10}$/.test(code.trim())) { setErr('Enter the code from the email.'); return }
    setLoading(true); setErr('')
    try { await verifyCode(email, code) } // the app moves on when the session arrives
    catch (x) { setErr(/expired|invalid/i.test(x.message) ? 'That code is wrong or has expired. Request a new one.' : x.message); setLoading(false) }
  }

  return (
    <Shell embedded={embedded} title="Sign in"
      subtitle={invited ? 'You’ve been invited to a Covalence workspace. Sign in with the email address the invite was sent to.'
        : 'Sign in to share cases with your team, use Duo and case links, and attach evidence.'}>
      {step === 'email' ? (
        <form onSubmit={send}>
          <Field label="WORK EMAIL">
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoFocus placeholder="you@institution.com" style={gate.input} />
          </Field>
          {err && <div style={gate.err}>{err}</div>}
          <button type="submit" disabled={loading} style={{ ...gate.btn, cursor: loading ? 'not-allowed' : 'pointer' }}>{loading ? 'SENDING…' : 'EMAIL ME A SIGN-IN LINK →'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          {/* Supabase's built-in sender only sends the link; the code appears once custom SMTP + template are set up */}
          <div style={gate.note}>Check <span style={{ color:'#E7E4DF' }}>{email.trim().toLowerCase()}</span> and <span style={{ color:'#E7E4DF' }}>click the sign-in link</span> in the email — it signs you in here. It expires in an hour.</div>
          <div style={{ ...gate.note, marginBottom:'12px', color:'#78716C' }}>If your email shows a code instead, enter it:</div>
          <Field label="CODE">
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456"
              style={{ ...gate.input, letterSpacing:'0.4em', fontSize:'18px' }} />
          </Field>
          {err && <div style={gate.err}>{err}</div>}
          <button type="submit" disabled={loading} style={{ ...gate.btn, cursor: loading ? 'not-allowed' : 'pointer' }}>{loading ? 'CHECKING…' : 'SIGN IN →'}</button>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:'16px' }}>
            <button type="button" style={gate.link} onClick={() => { setStep('email'); setCode(''); setErr('') }}>Use a different email</button>
            <button type="button" style={gate.link} onClick={send} disabled={loading}>Send a new code</button>
          </div>
        </form>
      )}
      {onBack && <div style={{ marginTop:'28px', borderTop:'1px solid #2D2922', paddingTop:'16px' }}>
        <button type="button" style={gate.link} onClick={onBack}>← Just explore the demo instead</button>
      </div>}
    </Shell>
  )
}

// ── First sign-in: create an institution, or accept an invite ─────────────────
export function Onboarding({ email, onDone }) {
  const invite = pendingInvite()
  const [mode,    setMode]    = useState(invite ? 'join' : 'choose')   // choose | create | join
  const [inst,    setInst]    = useState('')
  const [name,    setName]    = useState('')
  const [code,    setCode]    = useState(invite)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setErr('Enter your name.'); return }
    if (mode === 'create' && inst.trim().length < 2) { setErr('Enter your institution’s name.'); return }
    if (mode === 'join' && !code.trim()) { setErr('Paste the invite code or open the invite link.'); return }
    setLoading(true); setErr('')
    try {
      const m = mode === 'create' ? await createInstitution(inst.trim(), name.trim()) : await acceptInvite(code.trim(), name.trim())
      clearPendingInvite()
      onDone(m)
    } catch (x) { setErr(x.message); setLoading(false) }
  }

  const signedInAs = <div style={{ ...gate.note, marginBottom:'24px' }}>Signed in as <span style={{ color:'#E7E4DF' }}>{email}</span> · <button type="button" style={gate.link} onClick={() => signOut()}>Sign out</button></div>

  if (mode === 'choose') return (
    <GateShell title="Set up your workspace" subtitle="Your cases, team and Duo sessions live in your institution’s workspace.">
      {signedInAs}
      <button style={{ ...gate.btn, marginBottom:'10px', textAlign:'left', padding:'16px' }} onClick={() => setMode('create')}>
        <div>CREATE MY INSTITUTION’S WORKSPACE</div>
        <div style={{ color:'#78716C', letterSpacing:'0.04em', marginTop:'6px', fontSize:'10px' }}>You become its admin and invite your team.</div>
      </button>
      <button style={{ ...gate.btn, textAlign:'left', padding:'16px' }} onClick={() => setMode('join')}>
        <div>I HAVE AN INVITE</div>
        <div style={{ color:'#78716C', letterSpacing:'0.04em', marginTop:'6px', fontSize:'10px' }}>Join a workspace your admin invited you to.</div>
      </button>
    </GateShell>
  )

  return (
    <GateShell title={mode === 'create' ? 'Create your workspace' : 'Join your team'}
      subtitle={mode === 'create' ? 'Teammates can only join through an invite you send — nobody can join just by typing your institution’s name.'
        : 'Invites are tied to the email address they were sent to.'}>
      {signedInAs}
      <form onSubmit={submit}>
        {mode === 'create' && <Field label="INSTITUTION NAME"><input value={inst} onChange={e => setInst(e.target.value)} autoFocus placeholder="First National Bank" style={gate.input} /></Field>}
        {mode === 'join' && <Field label="INVITE CODE"><input value={code} onChange={e => setCode(e.target.value)} autoFocus={!invite} placeholder="From your invite link" style={gate.input} /></Field>}
        <Field label="YOUR NAME"><input value={name} onChange={e => setName(e.target.value)} autoFocus={mode === 'join' && !!invite} placeholder="Shown to your team" style={gate.input} /></Field>
        {err && <div style={gate.err}>{err}</div>}
        <button type="submit" disabled={loading} style={{ ...gate.btn, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'SAVING…' : mode === 'create' ? 'CREATE WORKSPACE →' : 'JOIN WORKSPACE →'}
        </button>
        <div style={{ marginTop:'16px' }}><button type="button" style={gate.link} onClick={() => { setMode('choose'); setErr('') }}>← Back</button></div>
      </form>
    </GateShell>
  )
}

// ── Settings → Team ───────────────────────────────────────────────────────────
export function TeamPanel({ covUser }) {
  const isAdmin = covUser?.role === 'admin'
  const [team,    setTeam]    = useState([])
  const [invites, setInvites] = useState([])
  const [email,   setEmail]   = useState('')
  const [role,    setRole]    = useState('analyst')
  const [newLink, setNewLink] = useState('')
  const [copied,  setCopied]  = useState(false)
  const [err,     setErr]     = useState('')
  const refresh = () => {
    listTeam().then(setTeam).catch(e => setErr(e.message))
    if (isAdmin) listInvites().then(setInvites).catch(() => {})
  }
  useEffect(refresh, [covUser?.institutionId, isAdmin])

  const invite = async (e) => {
    e.preventDefault(); setErr(''); setNewLink(''); setCopied(false)
    try { const code = await createInvite(email.trim(), role); setNewLink(inviteLink(code)); setEmail(''); refresh() }
    catch (x) { setErr(x.message) }
  }
  const copy = (text) => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {}) }
  const row = { display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderBottom:'1px solid #EDE7DC' }
  const small = { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px' }

  return (
    <div className="border border-stone-300 mb-6" style={{ background:'#FAF7F1' }}>
      <div className="mono-font px-5 py-3" style={{ fontSize:'10px', letterSpacing:'0.15em', color:'#6B5F4D', borderBottom:'1px solid #D4CCBC', display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
        <span>TEAM · {(covUser?.institution || '').toUpperCase()}</span>
        <span style={{ color:'#A8A29E' }}>YOU ARE {(ROLES[covUser?.role]?.label || covUser?.role || '').toUpperCase()}</span>
      </div>
      <div className="px-5 py-4">
        {team.map(m => (
          <div key={m.user_id} style={row}>
            <span className="display-font" style={{ fontSize:'14px', color:'#1A1814', flex:1, minWidth:0 }}>{m.display_name || m.email}</span>
            <span style={{ ...small, color:'#78716C' }} className="desktop-only">{m.email}</span>
            {isAdmin ? (
              <select aria-label={`Role for ${m.display_name || m.email}`} value={m.role === 'member' ? 'analyst' : m.role}
                onChange={e => setMemberRole(m.user_id, e.target.value).then(refresh).catch(x => setErr(x.message))}
                style={{ ...small, fontSize:'10px', padding:'3px 6px', border:'1px solid #D4CCBC', background:'#fff', color: m.role === 'admin' ? '#7F1D1D' : '#1A1814' }}>
                {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
              </select>
            ) : (
              <span style={{ ...small, fontSize:'9px', letterSpacing:'0.1em', color: m.role === 'admin' ? '#7F1D1D' : '#78716C' }}>{(ROLES[m.role]?.label || m.role).toUpperCase()}</span>
            )}
            {isAdmin && m.email !== covUser.email && (
              <button style={{ ...small, fontSize:'9px', background:'none', border:'none', color:'#B91C1C', cursor:'pointer' }}
                onClick={() => { if (window.confirm(`Remove ${m.display_name || m.email} from ${covUser.institution}?`)) removeMember(m.user_id).then(refresh).catch(e => setErr(e.message)) }}>REMOVE</button>
            )}
          </div>
        ))}

        {isAdmin && (
          <>
            <form onSubmit={invite} style={{ display:'flex', gap:'8px', marginTop:'16px', flexWrap:'wrap' }}>
              <input className="cov-input" style={{ padding:'9px 12px', fontSize:'14px', flex:'1 1 220px' }} type="email" placeholder="colleague@institution.com" value={email} onChange={e => setEmail(e.target.value)} />
              <select className="input-field" style={{ padding:'9px 10px', fontSize:'13px', width:'auto' }} value={role} onChange={e => setRole(e.target.value)}>
                {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
              </select>
              <button className="cov-btn" style={{ padding:'9px 16px', fontSize:'10px' }} disabled={!email.trim()}>INVITE</button>
            </form>
            <div style={{ ...small, color:'#8A7F72', marginTop:'8px', lineHeight:1.7 }}>
              {Object.entries(ROLES).map(([k, r]) => <div key={k}><b style={{ color:'#57534E', fontWeight:500 }}>{r.label}</b> — {r.help}</div>)}
            </div>
            {newLink && (
              <div className="mt-3 p-3" style={{ border:'1px solid #065F46', background:'#ECFDF5' }}>
                <div style={{ ...small, color:'#065F46', marginBottom:'6px' }}>{covUser?.demo ? 'Invite created (demo — no email is sent, and the link only works for a real workspace).' : 'Invite created. Send this link to them — it works only for that email address and expires in 14 days.'}</div>
                <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                  <code style={{ ...small, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#1A1814' }}>{newLink}</code>
                  <button className="upload-btn" style={{ padding:'5px 10px' }} onClick={() => copy(newLink)}>{copied ? 'COPIED ✓' : 'COPY'}</button>
                </div>
              </div>
            )}
            {invites.length > 0 && (
              <div className="mt-4">
                <div style={{ ...small, fontSize:'9px', letterSpacing:'0.15em', color:'#8A7F72', marginBottom:'4px' }}>PENDING INVITES</div>
                {invites.map(i => (
                  <div key={i.code} style={row}>
                    <span style={{ ...small, color:'#1A1814', flex:1, minWidth:0 }}>{i.email}</span>
                    <span style={{ ...small, fontSize:'9px', color:'#78716C' }}>{(ROLES[i.role]?.label || i.role).toUpperCase()} · expires {new Date(i.expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
                    <button style={{ ...small, fontSize:'9px', background:'none', border:'none', color:'#1E3A5F', cursor:'pointer' }} onClick={() => copy(inviteLink(i.code))}>COPY LINK</button>
                    <button style={{ ...small, fontSize:'9px', background:'none', border:'none', color:'#B91C1C', cursor:'pointer' }} onClick={() => revokeInvite(i.code).then(refresh).catch(e => setErr(e.message))}>REVOKE</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {err && <div style={{ ...small, color:'#B91C1C', marginTop:'10px' }}>{err}</div>}
      </div>
    </div>
  )
}

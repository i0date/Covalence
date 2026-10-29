import React, { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { seedDemoIfFirstVisit, useOpenCaseListener, loadDemoInstitution, clearDemoInstitution, MobileMenu, CasePanel, CaseSearch, isDemoCase } from './CaseThread.jsx'
import { pendingInvite, authAvailable, clearPendingInvite, signOut, getSession, onSessionChange, getMembership, setCurrentRole, purgedCaseIds, ROLES } from './auth.js'
import { DEMO_INSTITUTION, demoRole, setDemoRole, ensureDemoSeeded, demoAudit } from './demoBackend.js'
import { SignInPanel, Onboarding } from './AuthScreens.jsx'
import { WelcomePage } from './Welcome.jsx'
import { startWorkspaceSync, stopWorkspaceSync } from './workspaceSync.js'
import { useShortcuts, ShortcutHelp } from './shortcuts.jsx'
import { auditWrite } from './audit.js'
import { amlCaseFrom } from './AlertsPanel.jsx'
import { useTeam, useWorkflow, useFincrime, RemindersBell } from './workflow.jsx'
import { SUPA_KEY, SUPA_URL, mergeCases, pullCasesFromSupa, pushCasesToSupa } from './data.js'
import { ErrorBoundary, GLOBAL_CSS, loadOutcomes, loadSettings, registerOutcomeSubscriber, saveOutcomes, saveSettings, toDfaClaim } from './shared.jsx'
import { DeskView } from './tools/Desk.jsx'
import { DfaView } from './tools/Dfa.jsx'
import { DuoView } from './tools/Duo.jsx'
import { FileView } from './tools/File.jsx'
import { HomeView } from './tools/Home.jsx'
import { MultiView } from './tools/Multi.jsx'
import { SettingsView } from './tools/Settings.jsx'
import { TriageView } from './tools/Triage.jsx'
import { TrioView } from './tools/Trio.jsx'
import { readCases, writeCases } from './caseStore.js'
import { LicitView } from './tools/Licit.jsx'
import { screeningStatus } from './fincrime.js'
import { doesIssuing, doesMerchant, navFor, workspaceSides } from './sides.mjs'
import { useArnStageSync } from './useArnStageSync.js'
import { AlarmBanner, AlarmButton, AlarmDialog } from './Alarms.jsx'

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN GATE — identity capture on first visit
// ═══════════════════════════════════════════════════════════════════════════════
function LoginGate({ onLogin, startInSignIn, onCancel }) {
  // Two ways in: explore the demo (local data, visit logged), or sign in to a real workspace
  const [mode,        setMode]        = useState(() => (startInSignIn || pendingInvite()) && authAvailable ? 'signin' : 'demo')
  const [name,        setName]        = useState('')
  const [email,       setEmail]       = useState('')
  const [institution, setInstitution] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState('')

  async function handleEnter(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) { setErr('Both fields required.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErr('Please enter a valid email address.'); return }
    setLoading(true); setErr('')
    const userData = { name: name.trim(), email: email.trim(), institution: institution.trim(), at: new Date().toISOString() }
    // Log to Supabase access_log (non-blocking — gate opens regardless)
    const _url = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_SUPABASE_URL || '') : ''
    const _key = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_SUPABASE_ANON_KEY || '') : ''
    if (_url && _key) {
      fetch(`${_url}/rest/v1/access_log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: _key, Authorization: `Bearer ${_key}`, Prefer: 'return=minimal' },
        body: JSON.stringify({ id: crypto.randomUUID(), name:userData.name, email:userData.email, entered_at:userData.at, user_agent:navigator.userAgent }),
      }).catch(() => {})
    }
    localStorage.setItem('cov_user', JSON.stringify(userData))
    setLoading(false)
    onLogin(userData)
  }

  const leaveSignIn = () => { clearPendingInvite(); if (onCancel) onCancel(); else setMode('demo') }
  const label = { fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.2em', color:'#78716C', marginBottom:'6px', display:'block' }

  return (
    <WelcomePage>
      {authAvailable && (
        <div role="tablist" style={{ display:'flex', borderBottom:'1px solid #2D2922', marginBottom:'28px' }}>
          <button role="tab" aria-selected={mode === 'demo'} className={`wl-tab ${mode === 'demo' ? 'on' : ''}`} onClick={leaveSignIn}>EXPLORE THE DEMO</button>
          <button role="tab" aria-selected={mode === 'signin'} className={`wl-tab ${mode === 'signin' ? 'on' : ''}`} onClick={() => setMode('signin')}>SIGN IN</button>
        </div>
      )}

      {mode === 'signin' ? <SignInPanel embedded onBack={null} /> : (
        <>
          <div className="wl-serif" style={{ fontSize:'26px', color:'#F5F1EA', letterSpacing:'-0.01em', marginBottom:'8px' }}>See it with real work in it.</div>
          <div className="wl-mono" style={{ fontSize:'10px', color:'#A8A29E', letterSpacing:'0.04em', lineHeight:1.7, marginBottom:'28px' }}>
            Loads a realistic portfolio — chargebacks, scams, crypto and merchant cases across every stage. Fictional data that never leaves your browser.
          </div>
          <form onSubmit={handleEnter}>
            <div style={{ marginBottom:'14px' }}>
              <label style={label} htmlFor="wl-name">NAME</label>
              <input id="wl-name" className="wl-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
            </div>
            <div style={{ marginBottom:'14px' }}>
              <label style={label} htmlFor="wl-email">WORK EMAIL</label>
              <input id="wl-email" className="wl-input" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@institution.com" autoComplete="email" />
            </div>
            <div style={{ marginBottom:'22px' }}>
              <label style={label} htmlFor="wl-inst">INSTITUTION <span style={{ color:'#57534E' }}>(optional)</span></label>
              <input id="wl-inst" className="wl-input" value={institution} onChange={e => setInstitution(e.target.value)} placeholder="First National Bank" autoComplete="organization" />
            </div>
            {err && <div className="wl-mono" style={{ fontSize:'10px', color:'#F87171', marginBottom:'12px' }}>{err}</div>}
            <button type="submit" className="wl-primary" disabled={loading}>{loading ? 'LOADING…' : 'EXPLORE THE DEMO →'}</button>
          </form>
          {authAvailable && (
            <div className="wl-mono" style={{ marginTop:'28px', paddingTop:'18px', borderTop:'1px solid #2D2922', fontSize:'10px', color:'#78716C', lineHeight:1.7 }}>
              Your team already uses Covalence?{' '}
              <button type="button" onClick={() => setMode('signin')} style={{ background:'none', border:'none', color:'#E7E4DF', fontFamily:'inherit', fontSize:'10px', letterSpacing:'0.08em', cursor:'pointer', padding:0, textDecoration:'underline', textUnderlineOffset:'3px' }}>Sign in to your workspace</button>
              <br/>Have an invite? Open the link from your email.
            </div>
          )}
        </>
      )}

      {onCancel && (
        <div style={{ marginTop:'24px' }}>
          <button type="button" onClick={onCancel} className="wl-mono" style={{ background:'none', border:'none', color:'#78716C', fontSize:'10px', letterSpacing:'0.12em', cursor:'pointer', padding:0, textDecoration:'underline', textUnderlineOffset:'3px' }}>← Back to the demo</button>
        </div>
      )}
    </WelcomePage>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — Covalence
// ═══════════════════════════════════════════════════════════════════════════════
export default function Covalence() {
  // Demo visitor (welcome-screen details, local demo data) — used when not signed in
  const [demoUser,      setDemoUser]      = useState(() => {
    let u = null
    try { u = JSON.parse(localStorage.getItem('cov_user') || 'null') } catch {}
    if (u) seedDemoIfFirstVisit(u.email) // runs before the outcomes initializer below reads storage
    return u
  })
  // Signed-in user (Supabase Auth) and their institution membership
  const [authReady,     setAuthReady]     = useState(!authAvailable)
  const [session,       setSession]       = useState(null)
  const [membership,    setMembership]    = useState(null)
  const [membershipChecked, setMembershipChecked] = useState(false)
  const [showSignIn,    setShowSignIn]    = useState(() => authAvailable && !!pendingInvite()) // invite links go straight to sign-in
  // Demo visitors work inside "Demo Bank" with a role they can switch (Admin by default)
  const [demoRoleState, setDemoRoleState] = useState(demoRole)
  useEffect(() => {
    const h = e => setDemoRoleState(e.detail)
    window.addEventListener('cov:demo-role', h); return () => window.removeEventListener('cov:demo-role', h)
  }, [])
  const covUser = membership
    ? { name: membership.display_name || membership.email, email: membership.email, institution: membership.institution_name,
        institutionId: membership.institution_id, role: membership.role === 'member' ? 'analyst' : membership.role, authed: true }
    : demoUser ? { ...demoUser, institution: DEMO_INSTITUTION, institutionId: 'demo', role: demoRoleState, demo: true } : null
  if (!membership) setCurrentRole(demoUser ? demoRoleState : null)
  const [activeSection, setActiveSection] = useState('home')
  // Any tool can send people elsewhere: dispatch 'cov:go' with { section, tab } (tab: a Settings tab)
  useEffect(() => {
    const h = e => { if (e.detail?.section) setActiveSection(e.detail.section) }
    window.addEventListener('cov:go', h); return () => window.removeEventListener('cov:go', h)
  }, [])
  const [outcomes,      setOutcomes]      = useState(loadOutcomes)
  const [settings,      setSettings]      = useState(loadSettings)
  const [platformMode,  setPlatformMode]  = useState('fi')
  const [triageHandoff, setTriageHandoff] = useState(null)
  const [dfaQueue,      setDfaQueue]      = useState([])
  const [duoHandoff,    setDuoHandoff]    = useState(null)
  // Case thread
  const [openCaseId,      setOpenCaseId]      = useState(null)
  const [searchOpen,      setSearchOpen]      = useState(false)
  const [deskOpenRequest, setDeskOpenRequest] = useState(null)
  const [dataVersion,     setDataVersion]     = useState(0) // bump to remount tools after demo load/clear
  useOpenCaseListener(setOpenCaseId)
  const openSearch = React.useCallback(() => setSearchOpen(true), [])
  // Triage closed a claim that isn't a dispute: keep it on the shared record, closed — and in Licit if referred
  const closeAtIntake = (c, d) => {
    const now = new Date().toISOString(), by = covUser?.name || covUser?.email || 'Analyst'
    const kase = { ...c, closedAtIntake: { ...c.closedAtIntake, by },
      history: [...(c.history || []), { ts: now, event: 'closed_at_intake', reason: c.closedAtIntake.reasonLabel, by }],
      ...(d.toLicit ? { sarReview: { flaggedAt: now, manual: true, level: 'referred', signals: ['intake'], by, referredFrom: 'Triage' } } : {}) }
    setOutcomes(prev => [kase, ...prev.filter(o => o.id !== c.id)])
    auditWrite('case.closed_at_intake', 'case', c.id, { reason: c.closedAtIntake.reasonLabel, basis: c.closedAtIntake.basisLabel || '', toLicit: !!d.toLicit, aiSuggested: c.closedAtIntake.aiSuggested })
    if (d.toLicit) auditWrite('aml.flagged', 'case', c.id, { level: 'referred', manual: true, from: 'Triage' })
  }
  // Fraud alerts (001 Triage → Alerts): where the customer's answer sends the case
  const fraudRoute = {
    desk: true,
    openDesk: c => { setOutcomes(prev => [c, ...prev]); setDeskOpenRequest({ case: c, t: Date.now() }); setActiveSection('desk') },
    recall: (c, segment) => {
      setOutcomes(prev => [c, ...prev])
      setDuoHandoff(segment === 'ce'
        ? { source: 'alert', caseId: c.id, accountType: 'crypto_exchange', classification: 'TRUE_FRAUD', routing: 'EXCHANGE_CONTACT', routing_label: 'Ask the receiving exchange to freeze the funds', amount: c.amount, merchant: c.merchant }
        : { source: 'alert', caseId: c.id, accountType: 'p2p', classification: 'TRUE_FRAUD', routing: 'RECIPIENT_FI', routing_label: 'Recall from the receiving institution', amount: c.amount, merchant: c.merchant })
      setActiveSection('duo')
    },
    scam: c => closeAtIntake(c, { toLicit: true }),
    toLicit: (a, txs) => {
      const c = amlCaseFrom(a, txs, covUser?.name || covUser?.email || 'Analyst')
      setOutcomes(prev => [c, ...prev]); auditWrite('aml.flagged', 'case', c.id, { level: a.severity, from: 'Fraud alert' })
      return c.id
    },
    trio: a => {
      const now = new Date().toISOString(), id = 'TRI-' + Date.now().toString(36).toUpperCase()
      window.dispatchEvent(new CustomEvent('cov:trio-create', { detail: { id, name: `Compromised merchant: ${a.merchant || a.customerName}`, type: 'fraud_wave', severity: 'HIGH',
        detectionDate: now.slice(0, 10), affectedProduct: 'Cards', description: `${a.detail} Victims: ${(a.victims || []).map(v => `${v.name} (${v.caseId})`).join(', ')}.`,
        status: 'active', linkedCaseIds: (a.victims || []).map(v => v.caseId), notes: [], cardholderNotified: 0, cardholderTotal: 0, createdAt: now, updatedAt: now, fromAlert: a.id } }))
      return id
    },
  }

  // DFA scores claims for funding; a case with a confirmed sanctions match can't be funded or sold
  const scoreInDfa = claims => {
    const blocked = new Set(outcomes.filter(o => screeningStatus(o) === 'confirmed').map(o => o.id))
    const ok = claims.filter(cl => !blocked.has(cl.id) && !blocked.has(cl.caseId))
    if (ok.length < claims.length) window.alert(`${claims.length - ok.length} case${claims.length - ok.length === 1 ? ' has' : 's have'} a confirmed sanctions match and can’t be scored for funding. See 005 Licit.`)
    if (!ok.length) return
    setDfaQueue(ok); setActiveSection('dfa')
  }
  const { help: shortcutsOpen, setHelp: setShortcutsOpen } = useShortcuts({ setActiveSection, openSearch, activeSection, enabled: !!(demoUser || membership) })
  // Workflow: auto-assignment and escalation rules run on the case pool (Settings → Workflow)
  const team = useTeam(covUser)
  useWorkflow({ outcomes, setOutcomes, settings, covUser, team })
  // Financial crime: sanctions screening and AML flags (Settings → Financial crime)
  useFincrime({ outcomes, setOutcomes, settings, covUser })
  useArnStageSync(outcomes, setOutcomes)
  // Links in reminder emails: /?open=COV-123 opens that case once the app is ready
  useEffect(() => {
    if (!covUser) return
    try {
      const u = new URL(window.location.href), id = u.searchParams.get('open')
      if (!id) return
      u.searchParams.delete('open'); window.history.replaceState(null, '', u.toString())
      setTimeout(() => setOpenCaseId(id), 0)
    } catch {}
  }, [!!covUser])

  const loadDemo  = () => { loadDemoInstitution(setOutcomes, covUser?.email); setDataVersion(v => v + 1) }
  const clearDemo = () => { clearDemoInstitution(setOutcomes); setDataVersion(v => v + 1) }
  const handleLogin = (u) => { if (seedDemoIfFirstVisit(u?.email)) setOutcomes(loadOutcomes()); setDemoUser(u) }
  const handleSignOut = async () => {
    await signOut(); setSession(null); setMembership(null); setMembershipChecked(false)
    // (the sessionUserId effect below removes the workspace's data from this browser)
  }

  // Restore the session on load, follow sign-in / sign-out, and load the membership
  useEffect(() => {
    if (!authAvailable) return
    getSession().then(s => { setSession(s); setAuthReady(true) }).catch(() => setAuthReady(true))
    return onSessionChange(s => setSession(s))
  }, [])
  const sessionUserId = session?.user?.id || null
  const signedInBefore = useRef(false)
  useEffect(() => {
    if (!sessionUserId) {
      setMembership(null); setMembershipChecked(false)
      // Signed out (button, expiry, or another tab): take the workspace's data off this browser
      if (signedInBefore.current) {
        signedInBefore.current = false
        stopWorkspaceSync()
        setCurrentRole(null)
        setOutcomes(loadOutcomes()); setSettings(loadSettings()); setDataVersion(v => v + 1)
      }
      return
    }
    signedInBefore.current = true
    setMembershipChecked(false)
    getMembership().then(m => { setCurrentRole(m?.role); setMembership(m); setShowSignIn(false) })
      .catch(() => setMembership(null))
      .finally(() => setMembershipChecked(true))
  }, [sessionUserId])
  // Workspace data (settings, Triage log, DFA, Trio playbooks, Duo list, Desk history):
  // pull it before the tools mount, then keep it synced while signed in
  const [workspaceReady, setWorkspaceReady] = useState(false)
  useEffect(() => {
    if (!membership?.institution_id) { setWorkspaceReady(false); return }
    let cancelled = false
    const giveUp = setTimeout(() => { if (!cancelled) setWorkspaceReady(true) }, 5000) // slow network: open with local data
    startWorkspaceSync(membership.institution_id).finally(() => {
      if (cancelled) return
      clearTimeout(giveUp)
      setSettings(loadSettings()); setDataVersion(v => v + 1); setWorkspaceReady(true)
    })
    return () => { cancelled = true; clearTimeout(giveUp) }
  }, [membership?.institution_id])
  // Notes, filings and assignments are signed with the user's name
  useEffect(() => { if (covUser?.name) try { localStorage.setItem('cov_agent_name', covUser.name) } catch {} }, [covUser?.name])

  const [globalSyncStatus, setGlobalSyncStatus] = useState('idle') // idle|syncing|synced|error

  // Guard: if outcomes came from a localStorage read, don't write back (avoids circular loop)
  const _skipSaveRef = useRef(false)
  useEffect(() => {
    if (_skipSaveRef.current) { _skipSaveRef.current = false; return }
    saveOutcomes(outcomes)
    if (SUPA_URL && SUPA_KEY && outcomes.length > 0) pushCasesToSupa(outcomes).catch(()=>{})
  }, [outcomes])
  // Register global sync status hook so saveOutcomes can update nav indicator
  useEffect(() => {
    window._covSyncStatus = setGlobalSyncStatus
    return () => { delete window._covSyncStatus }
  }, [])
  // Subscribe to outcomes changes from any view in this tab and from other tabs
  useEffect(() => {
    const refresh = (merged) => {
      const fresh = merged || readCases()
      _skipSaveRef.current = true
      setOutcomes(fresh)
    }
    const unregister = registerOutcomeSubscriber(refresh)
    return unregister
  }, [])
  useEffect(() => { saveSettings(settings) }, [settings])
  // Demo visitors: settings changes go into Demo Bank's audit log, with old → new values
  const prevSettings = useRef(settings)
  useEffect(() => {
    const before = prevSettings.current; prevSettings.current = settings
    if (session || !demoUser || before === settings) return
    const diff = {}
    Object.keys({ ...before, ...settings }).forEach(k => { if (JSON.stringify(before[k]) !== JSON.stringify(settings[k])) diff[k] = { from: before[k] ?? null, to: settings[k] ?? null } })
    if (!Object.keys(diff).length) return
    const t = setTimeout(() => ensureDemoSeeded().then(() => demoAudit('settings.changed', 'settings', 'cov_settings', diff)), 800)
    return () => clearTimeout(t)
  }, [settings])
  useEffect(() => {
    if (!SUPA_URL || !SUPA_KEY || !membership) return
    const pull = async () => {
      // Cases purged under the retention policy: drop this browser's copies so they can't come back
      try {
        const purged = new Set(await purgedCaseIds())
        if (purged.size) {
          writeCases(loadOutcomes().filter(o => !purged.has(o.id)))
          setOutcomes(l => l.filter(o => !purged.has(o.id)))
        }
      } catch {}
      try {
        const r = await pullCasesFromSupa()
        // Pulls after the first bring only changed cases, so everyone (auditors too) merges
        if (r.length) setOutcomes(l => mergeCases(l, r))
      } catch {}
    }
    pull(); const id=setInterval(pull,60000); return ()=>clearInterval(id)
  }, [membership?.institution_id])

  // The menu follows what the workspace does (sides.mjs): issuers get the dispute
  // pipeline first; merchant-side workspaces get their chargebacks first. Every tool is listed.
  const sides = workspaceSides(settings, { demo: !!covUser?.demo && !covUser?.authed })
  const NAV = navFor(sides)
  // Desk opens on a side this workspace works
  const sidesKey = sides.join(',')
  useEffect(() => {
    if (!doesIssuing(sides) && platformMode !== 'merchant') setPlatformMode('merchant')
    if (!doesMerchant(sides) && platformMode !== 'fi') setPlatformMode('fi')
  }, [sidesKey])

  if (!authReady) return <div style={{ minHeight:'100vh', background:'#1A1814' }} />
  if (session && !membershipChecked) return <div style={{ minHeight:'100vh', background:'#1A1814' }} />
  if (session && membership && !workspaceReady) return (
    <div style={{ minHeight:'100vh', background:'#1A1814', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ fontFamily:'monospace', fontSize:'10px', letterSpacing:'0.2em', color:'#78716C' }}>LOADING {String(membership.institution_name || '').toUpperCase()}…</div>
    </div>
  )
  if (session && !membership) return <Onboarding email={session.user?.email || ''} onDone={m => { setMembership(m); setShowSignIn(false); setDataVersion(v => v + 1) }} />
  if (showSignIn && !session) return <LoginGate startInSignIn onLogin={handleLogin} onCancel={() => setShowSignIn(false)} />
  if (!covUser) return <LoginGate onLogin={handleLogin} />

  return (
    <ErrorBoundary>
      <div className="min-h-screen" style={{ background:'#F5F1EA', fontFamily:'Georgia,"Times New Roman",serif' }}>
        <style>{GLOBAL_CSS}</style>

        {/* ── Top nav ── */}
        <div className="sticky top-0 z-50" style={{ background:'#1A1814', borderBottom:'1px solid #2D2922', overflowY:'hidden', overflowX:'auto' }}>
          <div className="cov-nav-inner" style={{ maxWidth:'1320px', margin:'0 auto', display:'flex', alignItems:'center', gap:'20px', padding:'0 24px' }}>
            <div className="cov-nav-logo" onClick={() => setActiveSection('home')} title="Home" style={{ paddingRight:'28px', borderRight:'1px solid #2D2922', marginRight:'4px', flexShrink:0, cursor:'pointer' }}>
              <div className="mono-font" style={{ fontSize:'14px', letterSpacing:'0.3em', color:'#F5F1EA', fontWeight:500, lineHeight:1, display:'flex', alignItems:'center', gap:'10px' }}>
                COVALENCE
                {/* Not signed in → everything here is local demo data; say so */}
                {!covUser?.authed && <span title="You're exploring with demo data. Sign in to use your institution's workspace."
                  style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#D6CFC4', border:'1px dashed #78716C', padding:'2px 6px' }}>DEMO</span>}
              </div>
            </div>
            <span className="mono-font cov-nav-current">{(NAV.find(n => n.id === activeSection)?.label || '').replace(/\s+/g, ' ')}</span>
            <div className="cov-nav-buttons" style={{ display:'flex', alignItems:'center' }}>
              {NAV.map(({ id, label, group }, i) => (<React.Fragment key={id}>
                {/* A thin rule where one area ends and the next begins */}
                {i > 0 && group !== NAV[i - 1].group && <span aria-hidden="true" className="cov-nav-sep" style={{ width:'1px', height:'16px', background:'#3D3A35', margin:'0 6px', flexShrink:0 }} />}
                <button onClick={() => setActiveSection(id)} title={group ? `${group}` : undefined}
                  style={{
                    fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.12em',
                    padding:'14px 12px', background:'transparent', border:'none',
                    borderBottom: activeSection === id ? '2px solid #D6CFC4' : '2px solid transparent',
                    color: activeSection === id ? '#F5F1EA' : '#7A7068',
                    cursor:'pointer', textTransform:'uppercase', transition:'all 0.15s', whiteSpace:'nowrap',
                  }}>
                  {label.includes('  ') ? <><span className="cov-nav-num">{label.split('  ')[0]}&nbsp;&nbsp;</span>{label.split('  ')[1]}</> : label}
                </button>
              </React.Fragment>))}
            </div>
            <div className="cov-nav-right" style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:'8px',flexShrink:0,paddingLeft:'8px'}}>
              <AlarmButton covUser={covUser} />
              {/* Desktop: a search field look (icon · label · shortcut). Phones: icon-only button. */}
              <button onClick={() => setSearchOpen(true)} title="Search cases" aria-label="Search cases" className="mono-font cov-nav-icon cov-nav-search"
                style={{display:'inline-flex',alignItems:'center',gap:'8px',background:'#232019',border:'1px solid #3D3A35',color:'#A8A29E',padding:'5px 8px 5px 10px',minWidth:'190px',cursor:'pointer',fontSize:'10px',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>
                <Search size={13} strokeWidth={1.75} style={{flexShrink:0}} />
                <span className="desktop-only cov-nav-search-label" style={{flex:1,textAlign:'left'}}>Search cases</span>
                <kbd className="desktop-only" style={{fontFamily:'inherit',fontSize:'10px',color:'#78716C',border:'1px solid #3D3A35',padding:'1px 5px',lineHeight:1.4}}>
                  {/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'}
                </kbd>
              </button>

              {SUPA_URL && SUPA_KEY && covUser?.authed && globalSyncStatus !== 'idle' && (
                <span className="mono-font" style={{fontSize:'10px',letterSpacing:'0.12em',padding:'3px 8px',border:'1px solid',
                  color: globalSyncStatus==='syncing'?'#D97706':globalSyncStatus==='error'?'#DC2626':'#059669',
                  borderColor: globalSyncStatus==='syncing'?'#D97706':globalSyncStatus==='error'?'#DC2626':'#059669'}}>
                  <span className="desktop-only">{globalSyncStatus==='syncing'?'↻ SYNC':globalSyncStatus==='error'?'✗ SYNC ERROR':'✓ LIVE'}</span>
                  <span className="mobile-only" title={globalSyncStatus==='error'?'Sync error':globalSyncStatus==='syncing'?'Syncing':'Live'}>●</span>
                </span>
              )}
              {platformMode==='merchant'&&activeSection==='desk'&&<span className="mono-font desktop-only" style={{fontSize:'10px',letterSpacing:'0.12em',color:'#F59E0B',padding:'14px 0'}}>MERCHANT MODE</span>}
              {covUser?.demo && (
                <label className="mono-font desktop-only" title="Try Covalence as each role — the app changes what you can do" style={{fontSize:'10px',letterSpacing:'0.1em',color:'#78716C',display:'flex',alignItems:'center',gap:'6px'}}>
                  <span className="cov-nav-collapse">VIEW AS</span>
                  <select value={demoRoleState} onChange={e => setDemoRole(e.target.value)} aria-label="View the demo as role"
                    style={{background:'#232019',border:'1px solid #3D3A35',color:'#E7E4DF',fontFamily:'inherit',fontSize:'10px',letterSpacing:'0.1em',padding:'3px 4px',cursor:'pointer'}}>
                    {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label.toUpperCase()}</option>)}
                  </select>
                </label>
              )}
              {covUser&&<div className="mono-font desktop-only" style={{fontSize:'10px',color:'#78716C',display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
                <span className="cov-nav-collapse" style={{color:'#A8A29E',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={covUser.name+(covUser.institution?` · ${covUser.institution}`:'')}>
                  {covUser.name}{covUser.authed && <span className="desktop-only" style={{color:'#57534E'}}> · {covUser.institution}</span>}
                </span>
                {!covUser.authed && authAvailable && (
                  <button onClick={() => setShowSignIn(true)} title="Sign in to share cases with your team"
                    style={{background:'transparent',border:'1px solid #D6CFC4',color:'#E7E4DF',padding:'3px 8px',cursor:'pointer',fontFamily:'monospace',fontSize:'10px',letterSpacing:'0.1em',flexShrink:0}}>SIGN IN</button>
                )}
                <button onClick={() => { if (covUser.authed) handleSignOut(); else { localStorage.removeItem('cov_user'); setDemoUser(null) } }}
                  title={covUser.authed ? 'Sign out' : 'Leave the demo'}
                  style={{background:'transparent',border:'1px solid #3D3A35',color:'#57534E',padding:'3px 8px',cursor:'pointer',fontFamily:'monospace',fontSize:'10px',letterSpacing:'0.1em',flexShrink:0}}>OUT</button>
              </div>}
              <RemindersBell cases={outcomes} covUser={covUser} settings={settings} />
              <button onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" className="mono-font desktop-only cov-nav-collapse"
                style={{background:'transparent',border:'1px solid #3D3A35',color:'#A8A29E',width:'28px',height:'28px',cursor:'pointer',fontSize:'12px'}}>?</button>
              <MobileMenu nav={NAV} active={activeSection} onSelect={setActiveSection} user={covUser} roles={ROLES} onRole={setDemoRole}
                onSignIn={!covUser?.authed && authAvailable ? () => setShowSignIn(true) : null}
                onSignOut={() => { if (covUser?.authed) handleSignOut(); else { localStorage.removeItem('cov_user'); setDemoUser(null) } }} />
            </div>
          </div>
        </div>

        {/* Auditors: read-only, and say so on every page */}
        {covUser?.role === 'auditor' && (
          <div className="mono-font" role="status" style={{ background:'#1E3A5F', color:'#DBEAFE', fontSize:'10px', letterSpacing:'0.12em', padding:'8px 24px', textAlign:'center' }}>
            READ-ONLY · AUDITOR ACCESS — you can view cases, the audit log and exports. Changes you make on screen aren’t saved.
          </div>
        )}

        {/* ── Sound the alarm: the open alarm, for everyone, on every screen ── */}
        <AlarmBanner covUser={covUser} />
        <AlarmDialog covUser={covUser} sides={sides} />

        {/* ── Case thread: panel + search, available from every tool ── */}
        {openCaseId && (
          <CasePanel caseId={openCaseId} outcomes={outcomes} setOutcomes={setOutcomes} covUser={covUser} settings={settings}
            onClose={() => setOpenCaseId(null)}
            onGo={setActiveSection}
            onDeskOpen={(c) => { setDeskOpenRequest({ case: c, t: Date.now() }); setActiveSection('desk') }}
            onTriageHandoff={(c) => {
              setTriageHandoff({ caseId: c.id, classification: c.verdict, confidence: c.confidence || 'MEDIUM',
                headline: (c.verdict || '').replace(/_/g, ' '), merchant: c.merchant || '', amount: String(c.amount || '').split(' ')[0],
                network: (c.network || '').toLowerCase(), complaint: c._complaint || '' })
              setActiveSection('desk')
            }}
            onScoreInDfa={(c) => scoreInDfa([toDfaClaim(c)])}
            onSendToDuo={(c) => { setDuoHandoff(c); setActiveSection('duo') }}
          />
        )}
        <CaseSearch outcomes={outcomes} open={searchOpen} setOpen={setSearchOpen} />
        <ShortcutHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        {/* ── Section views — all kept mounted (display:none when inactive) to preserve local state ── */}
        <React.Fragment key={dataVersion}>
        <div style={{ display: activeSection === 'home' ? 'block' : 'none' }}>
          <HomeView outcomes={outcomes} settings={settings} setActiveSection={setActiveSection} platformMode={platformMode}
            onLoadDemo={loadDemo} onClearDemo={clearDemo} covUser={covUser} />
        </div>
        <div style={{ display: activeSection === 'triage' ? 'block' : 'none' }}>
          <TriageView appOutcomes={outcomes} setAppOutcomes={setOutcomes} settings={settings} covUser={covUser} sides={sides} fraudRoute={fraudRoute} onCloseAtIntake={closeAtIntake} onHandoff={(h) => { setTriageHandoff(h); setActiveSection('desk') }} onGoToDuo={() => setActiveSection('duo')} onSendToDuo={(claim) => { setDuoHandoff(claim); setActiveSection('duo') }} />
        </div>
        <div style={{ display: activeSection === 'desk' ? 'block' : 'none' }}>
          <DeskView
            onGoToDesk={() => setActiveSection('desk')}
            outcomes={outcomes} setOutcomes={setOutcomes}
            settings={settings} setSettings={setSettings}
            triageHandoff={triageHandoff} setTriageHandoff={setTriageHandoff}
            onScoreInDfa={(cases) => scoreInDfa(cases)}
            onSendToDuo={(claim) => { setDuoHandoff(claim); setActiveSection('duo') }}
            onGoToDuo={() => setActiveSection('duo')}
            platformMode={platformMode} setPlatformMode={setPlatformMode} sides={sides} rootSettings={settings}
            covUser={covUser}
            deskOpenRequest={deskOpenRequest}
          />
        </div>
        <div style={{ display: activeSection === 'multi' ? 'block' : 'none' }}>
          <MultiView outcomes={outcomes} setOutcomes={setOutcomes} settings={settings} setActiveSection={setActiveSection} covUser={covUser} platformMode={platformMode} setPlatformMode={setPlatformMode} sides={sides} />
        </div>
        <div style={{ display: activeSection === 'file' ? 'block' : 'none' }}>
          <FileView setActiveSection={setActiveSection} setAppOutcomes={setOutcomes} platformMode={platformMode} setPlatformMode={setPlatformMode} sides={sides} covUser={covUser} />
        </div>
        <div style={{ display: activeSection === 'licit' ? 'block' : 'none' }}>
          <LicitView outcomes={outcomes} setOutcomes={setOutcomes} settings={settings} covUser={covUser} />
        </div>
        <div style={{ display: activeSection === 'dfa' ? 'block' : 'none' }}>
          <DfaView dfaQueue={dfaQueue} setDfaQueue={setDfaQueue} onGoToDuo={() => setActiveSection('duo')} historicalOutcomes={outcomes} />
        </div>
        <div style={{ display: activeSection === 'duo' ? 'block' : 'none' }}>
          <DuoView duoHandoff={duoHandoff} setDuoHandoff={setDuoHandoff} authInstitution={covUser?.authed || covUser?.demo ? covUser.institution : null} onSignIn={() => setShowSignIn(true)} covUser={covUser} />
        </div>
        <div style={{ display: activeSection === 'trio' ? 'block' : 'none' }}>
          <TrioView outcomes={outcomes} sides={sides} />
        </div>
        <div style={{ display: activeSection === 'settings' ? 'block' : 'none' }}>
          <SettingsView settings={settings} setSettings={setSettings} covUser={covUser} outcomes={outcomes} setOutcomes={setOutcomes} team={team} />
        </div>
        </React.Fragment>
      </div>
    </ErrorBoundary>
  )
}

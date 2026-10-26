// 006 DUO — two-institution coordination sessions and case links
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import { useState, useRef, useEffect } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle, Check, Copy, X } from 'lucide-react'
import { SUPA_KEY, SUPA_URL, buildThread, caseLinkActivity, caseLinkCreate, duoCreate, duoFind, duoGet, duoPatch, genDuoCode, loadMyDuoSessions, parseThread, saveMyDuoSessions } from '../data.js'

const DUO_STATUS = {
  active:           { label:'OPEN',             color:'#57534E', bg:'#F5F1EA' },
  in_discussion:    { label:'IN DISCUSSION',    color:'#1E40AF', bg:'#EFF6FF' },
  agreed:           { label:'AGREED',           color:'#065F46', bg:'#ECFDF5' },
  freeze_requested: { label:'FREEZE REQUESTED', color:'#92400E', bg:'#FEF3C7' },
  freeze_confirmed: { label:'FREEZE CONFIRMED', color:'#065F46', bg:'#ECFDF5' },
  closed:           { label:'CLOSED',           color:'#F5F1EA', bg:'#1A1814' },
}
const DUO_STATUS_ORDER         = ['active','in_discussion','agreed','closed']
const DUO_STATUS_ORDER_CRYPTO  = ['active','freeze_requested','freeze_confirmed','closed']

export function DuoView({ duoHandoff, setDuoHandoff, authInstitution, onSignIn }) {
  const [phase,         setPhase]        = useState('dashboard')
  const [myRole,        setMyRole]       = useState(null)
  const [session,       setSession]      = useState(null)
  const [mySessions,    setMySessions]   = useState(loadMyDuoSessions)
  const [myInstitution, setMyInstitution]= useState(() => { try { return JSON.parse(localStorage.getItem('cov_settings') || '{}').duoInstitutionName || '' } catch { return '' } })
  const [joinCode,      setJoinCode]     = useState('')
  const [newEntry,      setNewEntry]     = useState('')
  const [saving,        setSaving]       = useState(false)
  const [loading,       setLoading]      = useState(false)
  const [error,         setError]        = useState('')
  const [copied,        setCopied]       = useState(false)
  const [lastSync,      setLastSync]     = useState(null)
  const [notifySent,    setNotifySent]   = useState(false)
  const [recovering,    setRecovering]   = useState(false)
  const [recoverQuery,  setRecoverQuery] = useState('')
  const [recoverResults,setRecoverResults] = useState(null)
  const [recoverLoading,setRecoverLoading] = useState(false)
  // Session type for Duo (standard or crypto exchange)
  const [sessionType,   setSessionType]   = useState('standard')
  // Crypto session fields (for crypto handoffs)
  const [cryptoFields,  setCryptoFields]  = useState({ asset_type:'', wallet_addresses:'', transaction_ids:'', amount_crypto:'', amount_usd:'' })
  // External link state
  const [linkType,      setLinkType]      = useState('standard') // 'standard' | 'crypto'
  const [linkPayload,   setLinkPayload]   = useState({ case_ref:'', report_type:'', incident_date:'', amount:'', currency:'USD', nature:'', summary:'', receiving_account:'', receiving_account_name:'', transaction_ref:'', sending_account_last4:'', asset_type:'BTC', wallet_addresses:'', transaction_ids:'', chain_analytics_link:'', source_institution:'' })
  const [linkToken,     setLinkToken]     = useState('')
  const [linkCopied,    setLinkCopied]    = useState(false)
  const [linkLoading,   setLinkLoading]   = useState(false)
  const [linkResponses, setLinkResponses] = useState([])
  const [linkAccessLog, setLinkAccessLog] = useState([])
  const [linkRespSync,  setLinkRespSync]  = useState(null)
  const [accessLogOpen, setAccessLogOpen] = useState(false)
  const pollRef   = useRef(null)
  const linkPollRef = useRef(null)
  const [duoFilter, setDuoFilter]           = useState('')
  const [duoStatusFilter, setDuoStatusFilter] = useState('all')
  const [closureNote, setClosureNote]       = useState('')
  const [closurePromptId, setClosurePromptId] = useState(null)

  useEffect(() => {
    if (phase !== 'link-ready' || !linkToken || !configured) { clearInterval(linkPollRef.current); return }
    const load = async () => {
      try {
        const { responses, access } = await caseLinkActivity(linkToken)
        setLinkResponses(responses)
        setLinkAccessLog(access)
        setLinkRespSync(new Date())
      } catch {}
    }
    load()
    linkPollRef.current = setInterval(load, 15000)
    return () => clearInterval(linkPollRef.current)
  }, [phase, linkToken])
  const threadRef = useRef(null)
  const configured = !!(SUPA_URL && SUPA_KEY)

  async function createCaseLink() {
    if (!configured) { setError('Supabase not configured.'); return }
    setLinkLoading(true); setError('')
    try {
      const payload = linkType === 'crypto'
        ? { case_ref: linkPayload.case_ref, report_type: linkPayload.report_type, incident_date: linkPayload.incident_date, nature: linkPayload.nature, summary: linkPayload.summary, asset_type: linkPayload.asset_type, amount: linkPayload.amount, amount_usd: linkPayload.amount_usd, chain_analytics_link: linkPayload.chain_analytics_link, wallet_addresses: linkPayload.wallet_addresses.split('\n').map(s => s.trim()).filter(Boolean), transaction_ids: linkPayload.transaction_ids.split('\n').map(s => s.trim()).filter(Boolean) }
        : { case_ref: linkPayload.case_ref, report_type: linkPayload.report_type, incident_date: linkPayload.incident_date, amount: linkPayload.amount, currency: linkPayload.currency, nature: linkPayload.nature, summary: linkPayload.summary }
      const row = await caseLinkCreate({ case_type: linkType, sender_institution: myInstitution.trim(), payload })
      setLinkToken(row.token)
      setPhase('link-ready')
    } catch (e) { setError(e.message) }
    setLinkLoading(false)
  }

  function getCaseLinkUrl(token) { return `${window.location.origin}/?case=${token}` }

  useEffect(() => {
    if (duoHandoff && phase === 'dashboard') {
      if (duoHandoff.accountType === 'crypto' || duoHandoff.accountType === 'crypto_exchange') setSessionType('crypto')
      else setSessionType('standard')
      setPhase('creating')
    }
  }, [duoHandoff])

  useEffect(() => {
    if (phase !== 'session' || !session) { clearInterval(pollRef.current); return }
    pollRef.current = setInterval(async () => {
      try { const fresh = await duoGet(session.id); if (fresh) { setSession(fresh); setLastSync(new Date()) } } catch {}
    }, 5000)
    return () => clearInterval(pollRef.current)
  }, [phase, session && session.id])

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [session && session.notes_a, session && session.notes_b])

  const persistSession = (id, role, institution, status, caseId) => {
    const prevEntry = mySessions.find(s => s.id === id)
    const next = [{ id, role, myInstitution: institution, joinedAt: prevEntry?.joinedAt || new Date().toISOString(), lastStatus: status || 'active',
                    caseId: caseId || prevEntry?.caseId || null },
                  ...mySessions.filter(s => s.id !== id)]
    setMySessions(next); saveMyDuoSessions(next)
  }

  const updateLocalStatus = (id, status) => {
    const next = mySessions.map(s => s.id === id ? { ...s, lastStatus: status } : s)
    setMySessions(next); saveMyDuoSessions(next)
  }

  const recoverSessions = async () => {
    if ((!recoverQuery.trim() && !authInstitution) || !configured) return
    setRecoverLoading(true); setRecoverResults(null)
    try {
      const data = await duoFind(recoverQuery.trim() || authInstitution)
      setRecoverResults(Array.isArray(data) ? data : [])
    } catch { setRecoverResults([]) }
    setRecoverLoading(false)
  }

  const openSession = async (saved) => {
    setLoading(true); setError('')
    try {
      const sess = await duoGet(saved.id)
      if (!sess) { setError(`Session ${saved.id} not found.`); setLoading(false); return }
      setSession(sess); setMyRole(saved.role); setLastSync(new Date()); setPhase('session')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!myInstitution.trim()) { setError('Enter your institution name.'); return }
    if (!configured) { setError('Supabase not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to Vercel, then redeploy.'); return }
    setLoading(true); setError('')
    try {
      let claim = { accountType: sessionType === 'crypto' ? 'crypto_exchange' : 'standard' }
      if (duoHandoff) {
        claim = { ...claim, caseId: duoHandoff.id, merchant: duoHandoff.merchant, amount: duoHandoff.amount, reasonCode: duoHandoff.reasonCode, date: duoHandoff.date, status: duoHandoff.status, classification: duoHandoff.classification }
        if (sessionType === 'crypto') {
          claim.accountType = 'crypto_exchange'
          if (cryptoFields.asset_type)       claim.asset_type        = cryptoFields.asset_type
          if (cryptoFields.amount_crypto)    claim.amount_crypto      = cryptoFields.amount_crypto
          if (cryptoFields.amount_usd)       claim.amount_usd         = cryptoFields.amount_usd
          if (cryptoFields.wallet_addresses) claim.wallet_addresses   = cryptoFields.wallet_addresses.split('\n').map(s => s.trim()).filter(Boolean)
          if (cryptoFields.transaction_ids)  claim.transaction_ids    = cryptoFields.transaction_ids.split('\n').map(s => s.trim()).filter(Boolean)
        }
      }
      const id = genDuoCode()
      const created = await duoCreate({ id, institution_a: myInstitution.trim(), institution_b: '', claim, notes_a: '[]', notes_b: '[]', status: 'active' })
      const sess = created || { id, institution_a: myInstitution.trim(), institution_b: '', claim, notes_a: '[]', notes_b: '[]', status: 'active' }
      setSession(sess); setMyRole('a'); setLastSync(new Date())
      persistSession(id, 'a', myInstitution.trim(), 'active', claim.caseId)
      if (setDuoHandoff) setDuoHandoff(null)
      setPhase('session')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const handleJoin = async () => {
    if (!myInstitution.trim()) { setError('Enter your institution name.'); return }
    if (!joinCode.trim()) { setError('Enter the session code.'); return }
    if (!configured) { setError('Supabase not configured.'); return }
    setLoading(true); setError('')
    try {
      const sess = await duoGet(joinCode.toUpperCase().trim())
      if (!sess) { setError('Session not found. Check the code and try again.'); setLoading(false); return }
      if (sess.institution_b && sess.institution_b !== myInstitution.trim()) { setError('Both institution slots are filled.'); setLoading(false); return }
      const updated = await duoPatch(sess.id, { institution_b: myInstitution.trim() })
      const final = updated || { ...sess, institution_b: myInstitution.trim() }
      setSession(final); setMyRole('b'); setLastSync(new Date())
      persistSession(final.id, 'b', myInstitution.trim(), final.status, final.claim?.caseId)
      setPhase('session')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const handleAddEntry = async () => {
    if (!newEntry.trim() || !session) return
    setSaving(true); setError('')
    try {
      const field = myRole === 'a' ? 'notes_a' : 'notes_b'
      const existing = parseThread(session[field])
      const next = [...existing, { text: newEntry.trim(), ts: new Date().toISOString() }]
      const updated = await duoPatch(session.id, { [field]: JSON.stringify(next) })
      if (updated) { setSession(updated); setLastSync(new Date()) }
      setNewEntry('')
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const handleStatusChange = async (status, note) => {
    if (!session) return; setSaving(true)
    try {
      const updated = await duoPatch(session.id, { status })
      if (updated) {
        setSession(updated); setLastSync(new Date()); updateLocalStatus(session.id, status)
        try {
          const auditKey = `duo_audit_${session.id}`
          const existing = JSON.parse(localStorage.getItem(auditKey) || '[]')
          const myInst = myRole === 'a' ? session.institution_a : session.institution_b
          localStorage.setItem(auditKey, JSON.stringify([{ ts: new Date().toISOString(), status, institution: myInst, note: note || '' }, ...existing]))
        } catch {}
      }
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const handleCopy = () => {
    if (!session) return
    navigator.clipboard.writeText(session.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const BtnPrimary = ({ onClick, disabled, children, style }) => (
    <button onClick={onClick} disabled={!!disabled} className="mono-font"
      style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'10px 20px', background:'#1A1814', color:'#F5F1EA', border:'none', cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.6:1, ...style }}>
      {children}
    </button>
  )
  const BtnSecondary = ({ onClick, children }) => (
    <button onClick={onClick} className="mono-font"
      style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'10px 16px', background:'transparent', border:'1px solid #A09585', color:'#6B5F4D', cursor:'pointer' }}>
      {children}
    </button>
  )
  const ErrBox = () => error ? (
    <div className="mono-font text-[10px] tracking-wide text-red-700 border border-red-200 bg-red-50 p-3">{error}</div>
  ) : null
  const DuoMasthead = ({ sub }) => (
    <div className="mb-8 pb-6" style={{ borderBottom:'1px solid #D4CCBC' }}>
      <div className="mono-font text-xs tracking-widest text-stone-600 mb-2">ISSUE Nº 006 — DUO{sub ? ` · ${sub}` : ''}</div>
      <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(36px,5vw,64px)', letterSpacing:'-0.03em' }}>Duo Mode</h1>
    </div>
  )

  // ── DASHBOARD ─────────────────────────────────────────────────────────────────────────
  if (phase === 'dashboard') return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <DuoMasthead />
      <p className="display-font text-stone-600 mb-8" style={{ fontSize:'clamp(14px,1.6vw,16px)', lineHeight:1.7, maxWidth:'600px' }}>
        A live coordination session for two institutions working the same case — issuer and acquirer, sending and receiving bank. Both sides see the same claim and build a shared record toward resolution.
      </p>
      <p className="display-font text-stone-600 mb-8" style={{ fontSize:'clamp(14px,1.6vw,16px)', lineHeight:1.7, maxWidth:'600px' }}>
        Use it when fraud crosses an institutional boundary: a wire transfer, an e-transfer, an ACH recall, an account takeover where funds landed elsewhere. Create a session, share the six-character code with your counterpart, and work toward recovery together.
      </p>
      {!configured && (
        <div className="flex gap-3 border border-amber-700 bg-amber-50 p-4 mb-8" style={{ maxWidth:'560px' }}>
          <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <div>
            <div className="mono-font text-[10px] tracking-widest text-amber-900 mb-1">SUPABASE NOT CONFIGURED</div>
            <p className="display-font text-stone-800 text-[13px] leading-relaxed">Add <code className="mono-font bg-amber-100 px-1">VITE_SUPABASE_URL</code> and <code className="mono-font bg-amber-100 px-1">VITE_SUPABASE_ANON_KEY</code> to Vercel environment variables, then redeploy.</p>
          </div>
        </div>
      )}
      {configured && !authInstitution && (
        <div className="flex gap-3 items-center justify-between flex-wrap border border-stone-800 p-4 mb-8" style={{ maxWidth:'560px', background:'#FAF7F1' }}>
          <div>
            <div className="mono-font text-[10px] tracking-widest text-stone-800 mb-1">SIGN IN TO USE DUO</div>
            <p className="display-font text-stone-600 text-[13px] leading-relaxed">Duo sessions are shared with another institution, so they run under your institution’s signed-in workspace — not the demo.</p>
          </div>
          {onSignIn && <BtnPrimary onClick={onSignIn}>SIGN IN</BtnPrimary>}
        </div>
      )}
      <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'40px', ...(configured && !authInstitution ? { opacity:0.4, pointerEvents:'none' } : {}) }}>
        <BtnPrimary onClick={() => { setError(''); setMyInstitution(authInstitution || ''); setPhase('creating') }}>CREATE SESSION</BtnPrimary>
        <BtnSecondary onClick={() => { setError(''); setMyInstitution(authInstitution || ''); setJoinCode(''); setPhase('joining') }}>JOIN SESSION</BtnSecondary>
        <button onClick={() => { setError(''); setPhase('link-setup') }} className="mono-font"
          style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'10px 16px', background:'transparent', border:'1px solid #B45309', color:'#92400E', cursor:'pointer' }}>
          SEND EXTERNAL LINK
        </button>
      </div>
      {mySessions.length > 0 && (
        <div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'12px', flexWrap:'wrap' }}>
            <div className="mono-font text-[10px] tracking-widest text-stone-500 shrink-0">YOUR SESSIONS</div>
            <input value={duoFilter} onChange={e => setDuoFilter(e.target.value)}
              placeholder="Search institution or code…"
              className="mono-font" style={{ fontSize:'11px', padding:'5px 10px', border:'1px solid #D4CCBC', background:'#FFFFFF', outline:'none', flex:1, minWidth:'140px', maxWidth:'260px' }} />
            <select value={duoStatusFilter} onChange={e => setDuoStatusFilter(e.target.value)}
              className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.08em', padding:'5px 8px', border:'1px solid #D4CCBC', background:'#FFFFFF', cursor:'pointer', outline:'none' }}>
              <option value="all">ALL STATUSES</option>
              {Object.entries(DUO_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div style={{ display:'grid', gap:'2px', maxWidth:'680px' }}>
            {mySessions.filter(saved => {
              const q = duoFilter.toLowerCase().trim()
              const matchText = !q || saved.id.toLowerCase().includes(q) || (saved.myInstitution||'').toLowerCase().includes(q)
              const matchStatus = duoStatusFilter === 'all' || saved.lastStatus === duoStatusFilter
              return matchText && matchStatus
            }).map(saved => {
              const st = DUO_STATUS[saved.lastStatus || 'active'] || DUO_STATUS.active
              return (
                <button key={saved.id} onClick={() => openSession(saved)}
                  style={{ textAlign:'left', padding:'12px 16px', background:'#FFFFFF', border:'1px solid #D4CCBC', cursor:'pointer', display:'flex', alignItems:'center', gap:'16px' }}>
                  <div className="mono-font font-bold tracking-widest text-stone-900" style={{ fontSize:'14px', minWidth:'52px' }}>{saved.id}</div>
                  <div className="display-font text-stone-700 text-[13px] flex-1">{saved.myInstitution}</div>
                  <div className="mono-font text-[9px] tracking-widest px-2 py-0.5 shrink-0" style={{ color: st.color, background: st.bg, border: saved.lastStatus === 'closed' ? 'none' : `1px solid ${st.color}20` }}>{st.label}</div>
                  <ArrowRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                </button>
              )
            })}
          </div>
          {error && <div className="mono-font text-[10px] tracking-wide text-red-700 border border-red-200 bg-red-50 p-3 mt-3" style={{ maxWidth:'480px' }}>{error}</div>}
          {loading && <div className="mono-font text-[10px] tracking-widest text-stone-400 mt-3">LOADING…</div>}
        </div>
      )}

      {/* ── Session recovery ── */}
      {configured && (
        <div style={{ marginTop:'40px', paddingTop:'32px', borderTop:'1px solid #E8E3DA', maxWidth:'560px' }}>
          <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">RECOVER SESSIONS</div>
          <p className="display-font text-stone-500 text-[13px] mb-4">{authInstitution ? `Switched computers or cleared your browser? List every session ${authInstitution} is part of.` : 'Switched computers or cleared your browser? Find sessions by institution name.'}</p>
          <div style={{ display:'flex', gap:'8px' }}>
            {!authInstitution && <input className="cov-input mono-font flex-1" style={{ fontSize:'13px' }}
              placeholder="Enter your institution name…"
              value={recoverQuery} onChange={e => setRecoverQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && recoverSessions()} />}
            <button onClick={recoverSessions} disabled={recoverLoading}
              className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', padding:'8px 16px', background:'#1A1814', color:'#F5F1EA', border:'none', cursor:'pointer', whiteSpace:'nowrap' }}>
              {recoverLoading ? '…' : authInstitution ? 'SHOW MY SESSIONS' : 'SEARCH'}
            </button>
          </div>
          {recoverResults !== null && (
            <div className="mt-3">
              {recoverResults.length === 0
                ? <div className="mono-font text-[10px] tracking-widest text-stone-400 mt-2">No sessions found.</div>
                : <div style={{ display:'grid', gap:'2px' }}>
                    {recoverResults.map(s => {
                      const st = DUO_STATUS[s.status || 'active'] || DUO_STATUS.active
                      const already = mySessions.some(x => x.id === s.id)
                      return (
                        <div key={s.id} style={{ padding:'12px 16px', background:'#FFFFFF', border:'1px solid #D4CCBC', display:'flex', alignItems:'center', gap:'16px' }}>
                          <div className="mono-font font-bold tracking-widest text-stone-900" style={{ fontSize:'14px', minWidth:'52px' }}>{s.id}</div>
                          <div className="display-font text-stone-600 text-[13px] flex-1">{s.institution_a} · {s.institution_b}</div>
                          <div className="mono-font text-[9px] tracking-widest px-2 py-0.5 shrink-0" style={{ color: st.color, background: st.bg }}>{st.label}</div>
                          <button onClick={() => {
                            const mine = authInstitution && s.institution_b === authInstitution ? 'b' : 'a'
                            const entry = { id: s.id, role: mine, myInstitution: mine === 'b' ? s.institution_b : s.institution_a, lastStatus: s.status }
                            if (!already) { const next = [...mySessions, entry]; setMySessions(next); saveMyDuoSessions(next) }
                            openSession(entry)
                          }} className="mono-font shrink-0" style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'5px 10px', background:'#064E3B', color:'#F0FDF4', border:'none', cursor:'pointer' }}>
                            {already ? 'OPEN →' : 'RECOVER →'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
              }
            </div>
          )}
        </div>
      )}
    </div>
  )

  // ── CREATING ─────────────────────────────────────────────────────────────────────
  if (phase === 'creating') return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <DuoMasthead sub="CREATE SESSION" />
      {duoHandoff && (
        <div className="flex gap-3 border border-emerald-700 bg-emerald-50 p-4 mb-6" style={{ maxWidth:'460px' }}>
          <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <div className="mono-font text-[10px] tracking-widest text-emerald-900">
              {duoHandoff.source === 'triage'
                ? (duoHandoff.accountType === 'crypto' ? 'CRYPTO / EXCHANGE CASE — FROM TRIAGE' : 'CROSS-INSTITUTIONAL CASE — FROM TRIAGE')
                : `CASE PRE-FILLED FROM DESK${duoHandoff.id ? ` — ${duoHandoff.id}` : ''}${duoHandoff.merchant ? ` · ${duoHandoff.merchant}` : ''}`}
            </div>
            {duoHandoff.source === 'triage' && duoHandoff.accountType === 'crypto' && (
              <div className="mono-font text-[9px] text-emerald-700 mt-1 leading-relaxed">
                The counterparty in this session is likely an exchange or digital asset platform. Enter their name below — many exchanges have dedicated fraud/compliance contacts.
              </div>
            )}
            {duoHandoff.routing_label && (
              <div className="mono-font text-[9px] text-emerald-700 mt-1">ROUTING: {duoHandoff.routing_label}</div>
            )}
          </div>
        </div>
      )}
      <div style={{ maxWidth:'480px', display:'grid', gap:'20px' }}>
        {/* Session type toggle */}
        <div>
          <label className="cov-label">SESSION TYPE</label>
          <div style={{ display:'flex', gap:'2px' }}>
            {[['standard','STANDARD'],['crypto','CRYPTO / EXCHANGE']].map(([val, label]) => (
              <button key={val} onClick={() => setSessionType(val)} className="mono-font"
                style={{ flex:1, padding:'9px 0', fontSize:'9px', letterSpacing:'0.12em', border:'1px solid #C8C0B0', cursor:'pointer', background: sessionType === val ? '#1A1814' : 'transparent', color: sessionType === val ? '#F5F1EA' : '#6B5F4D' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="cov-label">YOUR INSTITUTION NAME</label>
          <input className="cov-input mono-font" value={myInstitution} onChange={e => setMyInstitution(e.target.value)} readOnly={!!authInstitution} title={authInstitution ? 'From your signed-in workspace' : undefined}
            placeholder="First Community Credit Union" style={{ fontSize:'14px' }} />
        </div>

        {/* Crypto-specific fields — shown when session type is crypto */}
        {sessionType === 'crypto' && (
          <>
            <div style={{ borderTop:'1px solid #E8E3DA', paddingTop:'16px' }}>
              <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-4">CRYPTO / DIGITAL ASSET DETAILS</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
              <div>
                <label className="cov-label">ASSET TYPE</label>
                <input className="cov-input mono-font" value={cryptoFields.asset_type}
                  onChange={e => setCryptoFields(f => ({ ...f, asset_type: e.target.value }))}
                  placeholder="BTC / ETH / USDT" style={{ fontSize:'13px' }} />
              </div>
              <div>
                <label className="cov-label">AMOUNT (CRYPTO)</label>
                <input className="cov-input mono-font" value={cryptoFields.amount_crypto}
                  onChange={e => setCryptoFields(f => ({ ...f, amount_crypto: e.target.value }))}
                  placeholder="0.234" style={{ fontSize:'13px' }} />
              </div>
            </div>
            <div>
              <label className="cov-label">AMOUNT (USD EQUIVALENT)</label>
              <input className="cov-input mono-font" value={cryptoFields.amount_usd}
                onChange={e => setCryptoFields(f => ({ ...f, amount_usd: e.target.value }))}
                placeholder="8400.00" style={{ fontSize:'13px' }} />
            </div>
            <div>
              <label className="cov-label">WALLET ADDRESS(ES) — one per line</label>
              <textarea className="cov-input mono-font" value={cryptoFields.wallet_addresses}
                onChange={e => setCryptoFields(f => ({ ...f, wallet_addresses: e.target.value }))}
                rows={3} placeholder={"bc1q...\nbc1q..."} style={{ fontSize:'12px', resize:'vertical', lineHeight:1.6 }} />
            </div>
            <div>
              <label className="cov-label">TRANSACTION ID(S) — one per line</label>
              <textarea className="cov-input mono-font" value={cryptoFields.transaction_ids}
                onChange={e => setCryptoFields(f => ({ ...f, transaction_ids: e.target.value }))}
                rows={3} placeholder={"a1b2c3d4...\ne5f6g7h8..."} style={{ fontSize:'12px', resize:'vertical', lineHeight:1.6 }} />
            </div>
          </>
        )}

        <ErrBox />
        <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
          <BtnPrimary onClick={handleCreate} disabled={loading}>{loading ? 'CREATING…' : 'CREATE SESSION →'}</BtnPrimary>
          <BtnSecondary onClick={() => { setPhase('dashboard'); if (setDuoHandoff) setDuoHandoff(null) }}>BACK</BtnSecondary>
        </div>
      </div>
    </div>
  )

  // ── JOINING ───────────────────────────────────────────────────────────────────────
  if (phase === 'joining') return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <DuoMasthead sub="JOIN SESSION" />
      <div style={{ maxWidth:'380px', display:'grid', gap:'20px' }}>
        <div>
          <label className="cov-label">SESSION CODE</label>
          <input className="cov-input mono-font" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123" maxLength={6} style={{ fontSize:'28px', letterSpacing:'0.25em', textTransform:'uppercase', maxWidth:'200px' }} />
        </div>
        <div>
          <label className="cov-label">YOUR INSTITUTION NAME</label>
          <input className="cov-input mono-font" value={myInstitution} onChange={e => setMyInstitution(e.target.value)} readOnly={!!authInstitution} title={authInstitution ? 'From your signed-in workspace' : undefined}
            placeholder="Riverside Federal Credit Union" style={{ fontSize:'14px' }} />
        </div>
        <ErrBox />
        <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
          <BtnPrimary onClick={handleJoin} disabled={loading}>{loading ? 'CONNECTING…' : 'JOIN SESSION →'}</BtnPrimary>
          <BtnSecondary onClick={() => setPhase('dashboard')}>BACK</BtnSecondary>
        </div>
      </div>
    </div>
  )

  // ── SESSION ───────────────────────────────────────────────────────────────────────
  if (phase === 'session' && session) {
    const claim        = session.claim || {}
    const thread       = buildThread(session)
    const myName       = myRole === 'a' ? session.institution_a : session.institution_b
    const isCryptoClaim = claim.accountType === 'crypto' || claim.accountType === 'crypto_exchange'
    const statusOrder  = isCryptoClaim ? DUO_STATUS_ORDER_CRYPTO : DUO_STATUS_ORDER
    const st           = DUO_STATUS[session.status] || DUO_STATUS.active
    const stIdx        = statusOrder.indexOf(session.status)
    const nextSt       = stIdx < statusOrder.length - 1 ? statusOrder[stIdx + 1] : null
    const nextStCfg    = nextSt ? DUO_STATUS[nextSt] : null
    const STANDARD_KEYS = ['caseId','merchant','amount','reasonCode','date','status','classification']
    const CRYPTO_KEYS   = ['caseId','asset_type','amount_crypto','amount_usd','classification']
    const claimEntries  = Object.entries(claim).filter(([k]) => (isCryptoClaim ? CRYPTO_KEYS : STANDARD_KEYS).includes(k))

    return (
      <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
        {/* Header */}
        <div className="mb-6 pb-5" style={{ borderBottom:'1px solid #D4CCBC', display:'flex', flexWrap:'wrap', gap:'12px', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div style={{ flex:1, minWidth:'200px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px', flexWrap:'wrap' }}>
              <div className="mono-font text-[9px] tracking-widest text-stone-400">ISSUE Nº 006 — DUO</div>
              <div className="mono-font text-[9px] tracking-widest px-2 py-0.5" style={{ color: st.color, background: st.bg, border: session.status === 'closed' ? 'none' : `1px solid ${st.color}30` }}>{st.label}</div>
            </div>
            <h1 className="display-font font-bold text-stone-900 leading-tight" style={{ fontSize:'clamp(18px,3vw,34px)', letterSpacing:'-0.02em' }}>
              {session.institution_a}
              {session.institution_b
                ? <> <span style={{ color:'#C8C0B0', fontWeight:400 }}>×</span> {session.institution_b}</>
                : <span className="display-font font-normal text-stone-400" style={{ fontSize:'55%' }}> × awaiting respondent</span>}
            </h1>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
            {nextSt && nextStCfg && nextSt !== 'closed' && (
              <button onClick={() => handleStatusChange(nextSt)} className="mono-font"
                style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'7px 12px', background:'transparent', border:`1px solid ${nextStCfg.color}`, color: nextStCfg.color, cursor:'pointer' }}>
                MARK {nextStCfg.label}
              </button>
            )}
            {nextSt === 'closed' && (
              <button onClick={() => setClosurePromptId(session.id)} className="mono-font"
                style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'7px 12px', background:'transparent', border:'1px solid #1A1814', color:'#1A1814', cursor:'pointer' }}>
                CLOSE SESSION
              </button>
            )}
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <div>
                {notifySent && (
                  <div className="mono-font text-[9px] tracking-widest text-emerald-700 border border-emerald-300 bg-emerald-50 px-2 py-1">INVITE SENT</div>
                )}
                <div className="mono-font text-[9px] tracking-widest text-stone-400 text-right">SESSION</div>
                <div className="mono-font font-bold text-stone-900 tracking-[0.2em]" style={{ fontSize:'18px' }}>{session.id}</div>
              </div>
              <button onClick={handleCopy} style={{ padding:'6px 8px', background:'transparent', border:'1px solid #D4CCBC', cursor:'pointer' }}>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-stone-500" />}
              </button>
              <button onClick={() => setPhase('dashboard')} className="mono-font" style={{ padding:'6px 12px', background:'transparent', border:'1px solid #D4CCBC', cursor:'pointer', display:'flex', alignItems:'center', gap:'6px', fontSize:'9px', letterSpacing:'0.1em', color:'#6B5F4D' }}>
                <X className="w-3 h-3" />SESSIONS
              </button>
            </div>
          </div>
        </div>

        {closurePromptId === session.id && (
          <div className="mb-6 border border-stone-800 bg-stone-50 px-4 py-3" style={{ maxWidth:'520px' }}>
            <div className="mono-font text-[9px] tracking-widest text-stone-600 mb-2">CLOSURE SUMMARY (OPTIONAL)</div>
            <textarea value={closureNote} onChange={e => setClosureNote(e.target.value)} rows={3}
              placeholder="Outcome, agreed amount, reference numbers, next steps..."
              style={{ width:'100%', fontSize:'13px', fontFamily:'Georgia,serif', lineHeight:1.5, padding:'8px', border:'1px solid #C8C0B0', background:'#FAF7F1', resize:'none', boxSizing:'border-box' }} />
            <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
              <button onClick={async () => {
                await handleStatusChange('closed', closureNote)
                if (closureNote.trim()) {
                  const field = myRole === 'a' ? 'notes_a' : 'notes_b'
                  const existing = parseThread(session[field])
                  const next = [...existing, { text: `[CLOSURE] ${closureNote.trim()}`, ts: new Date().toISOString() }]
                  try { await duoPatch(session.id, { [field]: JSON.stringify(next) }) } catch {}
                }
                setClosurePromptId(null); setClosureNote('')
              }} className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'6px 14px', background:'#1A1814', color:'#F5F1EA', border:'none', cursor:'pointer' }}>
                CONFIRM CLOSE
              </button>
              <button onClick={() => { setClosurePromptId(null); setClosureNote('') }}
                className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'6px 12px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', cursor:'pointer' }}>
                CANCEL
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Claim panel */}
          <div>
            <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-3">CLAIM</div>
            {claimEntries.length === 0 && !isCryptoClaim ? (
              <div style={{ border:'1px solid #E8E3DA', background:'#F9F7F3', padding:'20px' }}>
                <p className="mono-font text-[10px] tracking-wide text-stone-400 leading-relaxed">
                  No claim attached to this session.<br/>
                  Use →DUO from the Dispute Desk to link a case automatically.
                </p>
              </div>
            ) : (
              <div style={{ border:'1px solid #D4CCBC', background:'#FFFFFF' }}>
                {isCryptoClaim && (
                  <div style={{ padding:'8px 12px', background:'#1A1814', borderBottom:'1px solid #2D2922' }}>
                    <span className="mono-font text-[9px] tracking-widest" style={{ color:'#C9A86C' }}>⬡ CRYPTO / DIGITAL ASSET CASE</span>
                  </div>
                )}
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <tbody>
                    {claimEntries.map(([k, v]) => (
                      <tr key={k} style={{ borderBottom:'1px solid #EDE8E0' }}>
                        <td className="mono-font px-3 py-2.5 text-stone-400" style={{ fontSize:'10px', letterSpacing:'0.06em', whiteSpace:'nowrap', width:'40%', verticalAlign:'top', textTransform:'uppercase' }}>{k.replace(/_/g,' ')}</td>
                        <td className="mono-font px-3 py-2.5 text-stone-900" style={{ fontSize:'11px' }}>{String(v)}</td>
                      </tr>
                    ))}
                    {/* Crypto: wallet addresses with copy */}
                    {isCryptoClaim && Array.isArray(claim.wallet_addresses) && claim.wallet_addresses.length > 0 && (
                      <tr style={{ borderBottom:'1px solid #EDE8E0', background:'#FAFAF8' }}>
                        <td className="mono-font px-3 py-2.5 text-stone-400" style={{ fontSize:'10px', letterSpacing:'0.06em', verticalAlign:'top' }}>WALLET ADDRESS</td>
                        <td className="px-3 py-2.5" style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                          {claim.wallet_addresses.map((addr, i) => (
                            <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                              <code className="mono-font" style={{ fontSize:'10px', color:'#1A1814', background:'#F0EBE3', padding:'2px 6px', wordBreak:'break-all', flex:1 }}>{addr}</code>
                              <button onClick={() => navigator.clipboard.writeText(addr)}
                                className="mono-font shrink-0" style={{ fontSize:'8px', letterSpacing:'0.1em', padding:'2px 7px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', cursor:'pointer' }}>COPY</button>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                    {/* Crypto: txids with copy */}
                    {isCryptoClaim && Array.isArray(claim.transaction_ids) && claim.transaction_ids.length > 0 && (
                      <tr style={{ background:'#FAFAF8' }}>
                        <td className="mono-font px-3 py-2.5 text-stone-400" style={{ fontSize:'10px', letterSpacing:'0.06em', verticalAlign:'top' }}>TXID</td>
                        <td className="px-3 py-2.5" style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                          {claim.transaction_ids.map((txid, i) => (
                            <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                              <code className="mono-font" style={{ fontSize:'10px', color:'#1A1814', background:'#F0EBE3', padding:'2px 6px', wordBreak:'break-all', flex:1 }}>{txid}</code>
                              <button onClick={() => navigator.clipboard.writeText(txid)}
                                className="mono-font shrink-0" style={{ fontSize:'8px', letterSpacing:'0.1em', padding:'2px 7px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', cursor:'pointer' }}>COPY</button>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {/* Crypto: freeze action strip */}
                {isCryptoClaim && session.status !== 'closed' && (
                  <div style={{ padding:'10px 12px', borderTop:'1px solid #EDE8E0', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
                    <span className="mono-font text-[9px] tracking-widest text-stone-400">ASSET ACTION:</span>
                    {session.status !== 'freeze_requested' && session.status !== 'freeze_confirmed' && (
                      <button onClick={() => handleStatusChange('freeze_requested')} className="mono-font"
                        style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'5px 10px', background:'#FEF3C7', border:'1px solid #D97706', color:'#92400E', cursor:'pointer' }}>
                        REQUEST FREEZE
                      </button>
                    )}
                    {session.status === 'freeze_requested' && (
                      <button onClick={() => handleStatusChange('freeze_confirmed')} className="mono-font"
                        style={{ fontSize:'9px', letterSpacing:'0.1em', padding:'5px 10px', background:'#ECFDF5', border:'1px solid #065F46', color:'#065F46', cursor:'pointer' }}>
                        CONFIRM FREEZE
                      </button>
                    )}
                    {session.status === 'freeze_confirmed' && (
                      <span className="mono-font text-[9px] tracking-widest" style={{ color:'#065F46' }}>✓ FREEZE CONFIRMED — log reference in thread</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Thread panel */}
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div className="mono-font text-[10px] tracking-widest text-stone-500">CASE THREAD</div>
            <div ref={threadRef}
              style={{ minHeight:'260px', maxHeight:'380px', overflowY:'auto', border:'1px solid #D4CCBC', background:'#FFFFFF', padding:'14px', display:'flex', flexDirection:'column', gap:'12px' }}>
              {thread.length === 0
                ? <div className="mono-font text-[10px] tracking-wide text-stone-300 text-center" style={{ marginTop:'80px' }}>No entries yet.</div>
                : thread.map((entry, i) => {
                    const isMe = entry.role === myRole
                    return (
                      <div key={i} style={{ display:'flex', flexDirection:'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                        <div className="mono-font text-[9px] tracking-wide text-stone-400 mb-1">
                          {entry.institution || (entry.role === 'a' ? 'Institution A' : 'Institution B')} · {new Date(entry.ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                        </div>
                        <div style={{ maxWidth:'86%', padding:'10px 13px', background: isMe ? '#1A1814' : '#F5F1EA', color: isMe ? '#F5F1EA' : '#2D2922', fontSize:'13px', fontFamily:'Georgia,"Times New Roman",serif', lineHeight:1.6 }}>
                          {entry.text}
                        </div>
                      </div>
                    )
                  })
              }
            </div>
            {/* New entry */}
            <div>
              <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1.5">AS {myName || 'YOUR INSTITUTION'}</div>
              <textarea value={newEntry} onChange={e => setNewEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddEntry() }}
                rows={3} placeholder="Findings, proposed resolution, agreed next steps…"
                style={{ width:'100%', resize:'none', fontSize:'13px', fontFamily:'Georgia,"Times New Roman",serif', lineHeight:1.6, padding:'10px', border:'1px solid #C8C0B0', background:'#FFFFFF', boxSizing:'border-box', outline:'none' }} />
              {error && <div className="mono-font text-[10px] text-red-700 mt-1">{error}</div>}
              <div style={{ display:'flex', alignItems:'center', gap:'12px', marginTop:'8px', flexWrap:'wrap' }}>
                <BtnPrimary onClick={handleAddEntry} disabled={saving || !newEntry.trim()}>{saving ? 'POSTING…' : 'POST ENTRY'}</BtnPrimary>
                <div className="mono-font text-[9px] tracking-widest text-stone-400">
                  ⌘↵ to post · syncs every 5s{lastSync ? ` · ${lastSync.toLocaleTimeString()}` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      {/* Task 16: Session history / audit trail */}
      {(() => {
        try {
          const auditLog = JSON.parse(localStorage.getItem(`duo_audit_${session.id}`) || '[]')
          if (!auditLog.length) return null
          return (
            <div className="mt-6 pt-6" style={{ borderTop:'1px solid #E8E3DA' }}>
              <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">SESSION HISTORY</div>
              <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxWidth:'480px' }}>
                {auditLog.map((entry, i) => {
                  const stCfg = DUO_STATUS[entry.status] || DUO_STATUS.active
                  return (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:'12px', padding:'8px 12px', background:'#FFFFFF', border:'1px solid #E8E3DA' }}>
                      <div className="mono-font text-[9px] tracking-widest px-1.5 py-0.5 shrink-0" style={{ color:stCfg.color, background:stCfg.bg }}>{stCfg.label}</div>
                      <div style={{ flex:1 }}>
                        <div className="mono-font text-[9px] text-stone-400">{new Date(entry.ts).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · {entry.institution || 'Unknown'}</div>
                        {entry.note && <div className="display-font text-stone-700 text-[12px] mt-0.5 italic">{entry.note}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        } catch { return null }
      })()}
      </div>
    )
  }

  // ── LINK SETUP ────────────────────────────────────────────────────────────────
  if (phase === 'link-setup') {
    const lp = linkPayload
    const setLp = (k, v) => setLinkPayload(p => ({ ...p, [k]: v }))
    // Inline helper — NOT a React component, called as a function to avoid remount-on-rerender
    const F = (label, k, placeholder, type) => (
      <div key={k}>
        <label className="cov-label">{label}</label>
        <input className="cov-input mono-font" value={lp[k] || ''} onChange={e => setLp(k, e.target.value)}
          placeholder={placeholder} type={type || 'text'} style={{ fontSize:'13px' }} />
      </div>
    )
    return (
      <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
        <DuoMasthead sub="SEND EXTERNAL LINK" />
        <p className="display-font text-stone-600 mb-6" style={{ fontSize:'15px', lineHeight:1.7, maxWidth:'560px' }}>
          Generate a secure, expiring case link to send to a financial institution that isn't on Covalence. They'll identify themselves to access it and can submit a structured response — including a freeze confirmation if applicable.
        </p>

        {/* Case type toggle */}
        <div style={{ display:'flex', gap:'2px', marginBottom:'28px', maxWidth:'360px' }}>
          {[['standard','STANDARD CASE'],['crypto','CRYPTO / DIGITAL ASSET']].map(([val, label]) => (
            <button key={val} onClick={() => setLinkType(val)} className="mono-font"
              style={{ flex:1, padding:'10px 0', fontSize:'9px', letterSpacing:'0.12em', border:'1px solid #C8C0B0', cursor:'pointer', background: linkType === val ? '#1A1814' : 'transparent', color: linkType === val ? '#F5F1EA' : '#6B5F4D' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ maxWidth:'560px', display:'grid', gap:'18px' }}>
          <div>
            <label className="cov-label">YOUR INSTITUTION NAME</label>
            <input className="cov-input mono-font" value={myInstitution} onChange={e => setMyInstitution(e.target.value)} readOnly={!!authInstitution} title={authInstitution ? 'From your signed-in workspace' : undefined}
              placeholder="First Community Credit Union" style={{ fontSize:'13px' }} />
          </div>
          {linkType === 'standard' ? (
            <>
              {F('CASE REFERENCE', 'case_ref', 'TXN-2024-00142')}
              {F('REPORT TYPE', 'report_type', 'Wire Fraud / ACH Recall / Account Takeover')}
              {F('INCIDENT DATE', 'incident_date', '2024-01-15', 'date')}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'12px' }}>
                {F('AMOUNT', 'amount', '5200.00')}
                {F('CURRENCY', 'currency', 'USD')}
              </div>

              {/* Transaction identifiers — lets the receiving FI find the account */}
              <div style={{ borderTop:'1px solid #E8E3DA', paddingTop:'18px', marginTop:'4px' }}>
                <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-4">TRANSACTION IDENTIFIERS — sent to receiving institution</div>
                <div style={{ display:'grid', gap:'14px' }}>
                  <div>
                    {F('RECEIVING ACCOUNT NUMBER', 'receiving_account', '****1234 or full account number')}
                    <div className="mono-font text-[9px] text-stone-400 mt-1 leading-relaxed">
                      Account at the receiving institution where funds landed. Use full number or last 4 — the receiving FI cannot look up the case without this.
                    </div>
                  </div>
                  {F('RECEIVING ACCOUNT HOLDER NAME', 'receiving_account_name', 'Name on the account at the receiving institution')}
                  <div>
                    {F('TRANSACTION REFERENCE', 'transaction_ref', 'ACH trace no. / wire IMAD / Fedwire ref')}
                    <div className="mono-font text-[9px] text-stone-400 mt-1">ACH trace number, wire IMAD/OMAD, or internal transfer reference.</div>
                  </div>
                  {F('YOUR ACCOUNT (last 4, optional)', 'sending_account_last4', '****5678')}
                </div>
              </div>

              {F('NATURE OF REPORT', 'nature', 'Authorized push payment fraud / account takeover / etc.')}
              <div>
                <label className="cov-label">SUMMARY</label>
                <textarea className="cov-input mono-font" value={lp.summary || ''} onChange={e => setLp('summary', e.target.value)}
                  rows={3} placeholder="Brief factual summary of what occurred."
                  style={{ fontSize:'13px', resize:'vertical', lineHeight:1.5 }} />
              </div>
            </>
          ) : (
            <>
              {F('CASE REFERENCE', 'case_ref', 'CRYPTO-2024-00142')}
              {F('REPORT TYPE', 'report_type', 'Investment scam / pig butchering / unauthorized transfer')}
              {F('INCIDENT DATE', 'incident_date', '2024-01-15', 'date')}
              <div>
                {F('SOURCE INSTITUTION (optional)', 'source_institution', 'Name of the bank or fintech the victim used to send funds')}
                <div className="mono-font text-[9px] text-stone-400 mt-1">Helps the receiving exchange trace the fiat on-ramp.</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {F('ASSET TYPE', 'asset_type', 'BTC / ETH / USDT')}
                {F('AMOUNT (CRYPTO)', 'amount', '0.234')}
              </div>
              {F('AMOUNT (USD EQUIVALENT)', 'amount_usd', '8400.00')}
              {F('NATURE OF REPORT', 'nature', 'Authorized push payment fraud / pig butchering / romance scam')}
              <div>
                <label className="cov-label">SUMMARY</label>
                <textarea className="cov-input mono-font" value={lp.summary || ''} onChange={e => setLp('summary', e.target.value)}
                  rows={3} placeholder="Brief factual summary — no customer PII."
                  style={{ fontSize:'13px', resize:'vertical', lineHeight:1.5 }} />
              </div>
              <div>
                <label className="cov-label">WALLET ADDRESS(ES) — one per line</label>
                <textarea className="cov-input mono-font" value={lp.wallet_addresses || ''} onChange={e => setLp('wallet_addresses', e.target.value)}
                  rows={3} placeholder={"bc1q...\nbc1q..."} style={{ fontSize:'12px', resize:'vertical', lineHeight:1.6 }} />
              </div>
              <div>
                <label className="cov-label">TRANSACTION ID(S) — one per line</label>
                <textarea className="cov-input mono-font" value={lp.transaction_ids || ''} onChange={e => setLp('transaction_ids', e.target.value)}
                  rows={3} placeholder={"a1b2c3d4...\ne5f6g7h8..."} style={{ fontSize:'12px', resize:'vertical', lineHeight:1.6 }} />
              </div>
              {F('CHAIN ANALYTICS LINK (optional)', 'chain_analytics_link', 'https://platform.chainalysis.com/...')}
            </>
          )}

          {error && <div className="mono-font text-[10px] tracking-wide text-red-700 border border-red-200 bg-red-50 p-3">{error}</div>}

          <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginTop:'8px' }}>
            <BtnPrimary onClick={createCaseLink} disabled={linkLoading || !myInstitution.trim()}>
              {linkLoading ? 'GENERATING…' : 'GENERATE LINK →'}
            </BtnPrimary>
            <BtnSecondary onClick={() => { setError(''); setPhase('dashboard') }}>BACK</BtnSecondary>
          </div>

          <div className="mono-font text-[10px] text-stone-400 leading-relaxed" style={{ maxWidth:'480px' }}>
            The link expires in 30 days. Every access is logged with name, email, institution, and timestamp. Account-level identifiers (account number, transaction reference) are included in the payload to allow the receiving institution to look up the case — share only what your institution's data-sharing agreements permit.
          </div>
        </div>
      </div>
    )
  }

  // ── LINK READY ────────────────────────────────────────────────────────────────
  if (phase === 'link-ready') {
    const url = getCaseLinkUrl(linkToken)
    return (
      <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
        <DuoMasthead sub="LINK READY" />
        <div style={{ maxWidth:'580px' }}>
          <p className="display-font text-stone-600 mb-8" style={{ fontSize:'15px', lineHeight:1.7 }}>
            Your case link is live. Share it directly with the compliance or fraud team at the receiving institution. It expires in 30 days.
          </p>

          {/* The link */}
          <div style={{ border:'1px solid #C8C0B0', background:'#FFFFFF', padding:'20px', marginBottom:'24px' }}>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">SHAREABLE CASE LINK</div>
            <div className="mono-font text-stone-900 break-all" style={{ fontSize:'13px', lineHeight:1.6, marginBottom:'16px' }}>{url}</div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => { navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500) }}
                className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', padding:'8px 16px', background:'#1A1814', color:'#F5F1EA', border:'none', cursor:'pointer' }}>
                {linkCopied ? '✓ COPIED' : 'COPY LINK'}
              </button>
              <a href={`mailto:?subject=Case%20for%20your%20attention&body=Please%20review%20the%20following%20case%3A%0A%0A${encodeURIComponent(url)}%0A%0AThis%20link%20expires%20in%2030%20days.`}
                className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', padding:'8px 16px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', textDecoration:'none', display:'inline-block' }}>
                OPEN IN EMAIL
              </a>
            </div>
          </div>

          {/* What happens next */}
          <div style={{ border:'1px solid #E8E3DA', background:'#F9F7F3', padding:'20px', marginBottom:'24px' }}>
            <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-3">WHAT HAPPENS NEXT</div>
            {[
              'The receiving institution opens the link and sees your institution name and case type — the details are blurred until they identify themselves.',
              'They enter their name, email, institution, and role. This is logged to your audit trail.',
              'They see the full case and submit a structured response — disposition, internal reference, and freeze confirmation if applicable.',
              'Their response appears live in the Responses panel below — auto-refreshing every 15 seconds.',
            ].map((t, i) => (
              <div key={i} style={{ display:'flex', gap:'12px', marginBottom:'12px' }}>
                <div className="mono-font text-[9px] text-stone-400 shrink-0" style={{ paddingTop:'2px' }}>0{i+1}</div>
                <div className="display-font text-stone-700" style={{ fontSize:'13px', lineHeight:1.6 }}>{t}</div>
              </div>
            ))}
          </div>

          {/* ACCESS LOG */}
          <div style={{ border:'1px solid #E8E3DA', marginBottom:'16px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', background:'#F9F7F3', cursor:'pointer', userSelect:'none' }}
              onClick={() => setAccessLogOpen(v => !v)}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <div className="mono-font text-[9px] tracking-widest text-stone-500">ACCESS LOG</div>
                <div className="mono-font text-[9px]" style={{ background:'#E8E3DA', color:'#6B5F4D', padding:'2px 7px' }}>
                  {linkAccessLog.length} {linkAccessLog.length === 1 ? 'VIEW' : 'VIEWS'}
                </div>
              </div>
              <div className="mono-font text-[9px] text-stone-400">{accessLogOpen ? '▲ COLLAPSE' : '▼ EXPAND'}</div>
            </div>
            {accessLogOpen && (
              <div style={{ padding:'0 16px 12px' }}>
                {linkAccessLog.length === 0
                  ? <div className="mono-font text-[10px] text-stone-400 py-3">No views yet — share the link to get started.</div>
                  : linkAccessLog.map((a, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'10px 0', borderBottom: i < linkAccessLog.length - 1 ? '1px solid #F0EBE3' : 'none' }}>
                      <div>
                        <div className="display-font font-semibold text-stone-900" style={{ fontSize:'13px' }}>{a.accessor_name || '—'}</div>
                        <div className="mono-font text-[10px] text-stone-500 mt-0.5">{[a.accessor_institution, a.accessor_role].filter(Boolean).join(' · ')}</div>
                        {a.accessor_email && <div className="mono-font text-[10px] text-stone-400 mt-0.5">{a.accessor_email}</div>}
                      </div>
                      <div className="mono-font text-[9px] text-stone-400 text-right shrink-0 ml-4">
                        {a.accessed_at ? new Date(a.accessed_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          {/* LIVE RESPONSES */}
          <div style={{ border:'1px solid #C8C0B0', marginBottom:'24px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', background:'#F5F1EA', borderBottom:'1px solid #E8E3DA' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <div className="mono-font text-[9px] tracking-widest text-stone-700">RESPONSES</div>
                <div className="mono-font text-[9px]" style={{ background: linkResponses.length > 0 ? '#065F46' : '#E8E3DA', color: linkResponses.length > 0 ? '#ECFDF5' : '#6B5F4D', padding:'2px 7px' }}>
                  {linkResponses.length} {linkResponses.length === 1 ? 'RESPONSE' : 'RESPONSES'}
                </div>
              </div>
              <div className="mono-font text-[9px] text-stone-400">
                {linkRespSync ? `SYNCED ${new Date(linkRespSync).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}` : 'SYNCING…'}
              </div>
            </div>
            <div style={{ padding: linkResponses.length > 0 ? '0' : '20px 16px' }}>
              {linkResponses.length === 0 ? (
                <div style={{ textAlign:'center' }}>
                  <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1">WAITING FOR RESPONSE</div>
                  <div className="display-font text-stone-500" style={{ fontSize:'13px', lineHeight:1.6 }}>
                    Responses submitted via the case link will appear here automatically.
                  </div>
                </div>
              ) : linkResponses.map((r, i) => {
                const dispColor = {
                  acknowledged:{ bg:'#EFF6FF', color:'#1E40AF' },
                  investigating:{ bg:'#FEF3C7', color:'#92400E' },
                  frozen:       { bg:'#ECFDF5', color:'#065F46' },
                  resolved:     { bg:'#F0FDF4', color:'#166534' },
                  declined:     { bg:'#FEF2F2', color:'#991B1B' },
                }[r.disposition] || { bg:'#F5F5F5', color:'#374151' }
                return (
                  <div key={i} style={{ padding:'16px', borderBottom: i < linkResponses.length - 1 ? '1px solid #E8E3DA' : 'none' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px', marginBottom:'10px' }}>
                      <div>
                        <div className="display-font font-bold text-stone-900" style={{ fontSize:'14px' }}>{r.respondent_name || 'Unknown'}</div>
                        <div className="mono-font text-[10px] text-stone-500 mt-0.5">
                          {[r.respondent_institution, r.respondent_role].filter(Boolean).join(' · ')}
                        </div>
                        {r.respondent_email && <div className="mono-font text-[10px] text-stone-400 mt-0.5">{r.respondent_email}</div>}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px', shrink:0 }}>
                        <div className="mono-font text-[9px]" style={{ ...dispColor, padding:'3px 8px', letterSpacing:'0.08em' }}>
                          {(r.disposition || 'UNKNOWN').toUpperCase()}
                        </div>
                        {r.freeze_confirmed && (
                          <div className="mono-font text-[9px]" style={{ background:'#ECFDF5', color:'#065F46', padding:'3px 8px', letterSpacing:'0.08em' }}>
                            ✓ FREEZE CONFIRMED
                          </div>
                        )}
                      </div>
                    </div>
                    {r.internal_case_ref && (
                      <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 shrink-0 pt-0.5">THEIR REF</div>
                        <div className="mono-font text-[11px] text-stone-700">{r.internal_case_ref}</div>
                      </div>
                    )}
                    {r.freeze_reference && (
                      <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 shrink-0 pt-0.5">FREEZE REF</div>
                        <div className="mono-font text-[11px] text-stone-700">{r.freeze_reference}</div>
                      </div>
                    )}
                    {r.notes && (
                      <div style={{ background:'#F9F7F3', border:'1px solid #E8E3DA', padding:'10px 12px', marginTop:'8px' }}>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1">NOTES</div>
                        <div className="display-font text-stone-700" style={{ fontSize:'13px', lineHeight:1.6 }}>{r.notes}</div>
                      </div>
                    )}
                    <div className="mono-font text-[9px] text-stone-400 mt-8" style={{ textAlign:'right' }}>
                      {r.responded_at ? new Date(r.responded_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Incentive note */}
          <div style={{ background:'#1A1814', padding:'16px 20px', marginBottom:'24px' }}>
            <div className="mono-font text-[9px] tracking-widest mb-2" style={{ color:'#C9A86C' }}>COVALENCE USERS GET MORE</div>
            <p className="display-font" style={{ fontSize:'13px', color:'#C8C0B0', lineHeight:1.6 }}>
              Receiving institutions that join Covalence can respond directly inside their own dashboard, run live Duo sessions with you, and track all their cross-institutional cases in one place. They'll see the prompt when they access this link.
            </p>
          </div>

          <div style={{ display:'flex', gap:'10px' }}>
            <BtnPrimary onClick={() => { setPhase('link-setup'); setLinkToken(''); setLinkResponses([]); setLinkAccessLog([]) }}>SEND ANOTHER</BtnPrimary>
            <BtnSecondary onClick={() => setPhase('dashboard')}>BACK TO DUO</BtnSecondary>
          </div>
        </div>
      </div>
    )
  }

  // ── LINK SETUP ────────────────────────────────────────────────────────────────
  if (phase === 'link-setup') {
    const lp = linkPayload
    const setLp = (k, v) => setLinkPayload(p => ({ ...p, [k]: v }))
    // Inline helper — NOT a React component, called as a function to avoid remount-on-rerender
    const F = (label, k, placeholder, type) => (
      <div key={k}>
        <label className="cov-label">{label}</label>
        <input className="cov-input mono-font" value={lp[k] || ''} onChange={e => setLp(k, e.target.value)}
          placeholder={placeholder} type={type || 'text'} style={{ fontSize:'13px' }} />
      </div>
    )
    return (
      <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
        <DuoMasthead sub="SEND EXTERNAL LINK" />
        <p className="display-font text-stone-600 mb-6" style={{ fontSize:'15px', lineHeight:1.7, maxWidth:'560px' }}>
          Generate a secure, expiring case link to send to a financial institution that isn't on Covalence. They'll identify themselves to access it and can submit a structured response — including a freeze confirmation if applicable.
        </p>

        {/* Case type toggle */}
        <div style={{ display:'flex', gap:'2px', marginBottom:'28px', maxWidth:'360px' }}>
          {[['standard','STANDARD CASE'],['crypto','CRYPTO / DIGITAL ASSET']].map(([val, label]) => (
            <button key={val} onClick={() => setLinkType(val)} className="mono-font"
              style={{ flex:1, padding:'10px 0', fontSize:'9px', letterSpacing:'0.12em', border:'1px solid #C8C0B0', cursor:'pointer', background: linkType === val ? '#1A1814' : 'transparent', color: linkType === val ? '#F5F1EA' : '#6B5F4D' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ maxWidth:'560px', display:'grid', gap:'18px' }}>
          <div>
            <label className="cov-label">YOUR INSTITUTION NAME</label>
            <input className="cov-input mono-font" value={myInstitution} onChange={e => setMyInstitution(e.target.value)} readOnly={!!authInstitution} title={authInstitution ? 'From your signed-in workspace' : undefined}
              placeholder="First Community Credit Union" style={{ fontSize:'13px' }} />
          </div>
          {linkType === 'standard' ? (
            <>
              {F('CASE REFERENCE', 'case_ref', 'TXN-2024-00142')}
              {F('REPORT TYPE', 'report_type', 'Wire Fraud / ACH Recall / Account Takeover')}
              {F('INCIDENT DATE', 'incident_date', '2024-01-15', 'date')}
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'12px' }}>
                {F('AMOUNT', 'amount', '5200.00')}
                {F('CURRENCY', 'currency', 'USD')}
              </div>

              {/* Transaction identifiers — lets the receiving FI find the account */}
              <div style={{ borderTop:'1px solid #E8E3DA', paddingTop:'18px', marginTop:'4px' }}>
                <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-4">TRANSACTION IDENTIFIERS — sent to receiving institution</div>
                <div style={{ display:'grid', gap:'14px' }}>
                  <div>
                    {F('RECEIVING ACCOUNT NUMBER', 'receiving_account', '****1234 or full account number')}
                    <div className="mono-font text-[9px] text-stone-400 mt-1 leading-relaxed">
                      Account at the receiving institution where funds landed. Use full number or last 4 — the receiving FI cannot look up the case without this.
                    </div>
                  </div>
                  {F('RECEIVING ACCOUNT HOLDER NAME', 'receiving_account_name', 'Name on the account at the receiving institution')}
                  <div>
                    {F('TRANSACTION REFERENCE', 'transaction_ref', 'ACH trace no. / wire IMAD / Fedwire ref')}
                    <div className="mono-font text-[9px] text-stone-400 mt-1">ACH trace number, wire IMAD/OMAD, or internal transfer reference.</div>
                  </div>
                  {F('YOUR ACCOUNT (last 4, optional)', 'sending_account_last4', '****5678')}
                </div>
              </div>

              {F('NATURE OF REPORT', 'nature', 'Authorized push payment fraud / account takeover / etc.')}
              <div>
                <label className="cov-label">SUMMARY</label>
                <textarea className="cov-input mono-font" value={lp.summary || ''} onChange={e => setLp('summary', e.target.value)}
                  rows={3} placeholder="Brief factual summary of what occurred."
                  style={{ fontSize:'13px', resize:'vertical', lineHeight:1.5 }} />
              </div>
            </>
          ) : (
            <>
              {F('CASE REFERENCE', 'case_ref', 'CRYPTO-2024-00142')}
              {F('REPORT TYPE', 'report_type', 'Investment scam / pig butchering / unauthorized transfer')}
              {F('INCIDENT DATE', 'incident_date', '2024-01-15', 'date')}
              <div>
                {F('SOURCE INSTITUTION (optional)', 'source_institution', 'Name of the bank or fintech the victim used to send funds')}
                <div className="mono-font text-[9px] text-stone-400 mt-1">Helps the receiving exchange trace the fiat on-ramp.</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                {F('ASSET TYPE', 'asset_type', 'BTC / ETH / USDT')}
                {F('AMOUNT (CRYPTO)', 'amount', '0.234')}
              </div>
              {F('AMOUNT (USD EQUIVALENT)', 'amount_usd', '8400.00')}
              {F('NATURE OF REPORT', 'nature', 'Authorized push payment fraud / pig butchering / romance scam')}
              <div>
                <label className="cov-label">SUMMARY</label>
                <textarea className="cov-input mono-font" value={lp.summary || ''} onChange={e => setLp('summary', e.target.value)}
                  rows={3} placeholder="Brief factual summary — no customer PII."
                  style={{ fontSize:'13px', resize:'vertical', lineHeight:1.5 }} />
              </div>
              <div>
                <label className="cov-label">WALLET ADDRESS(ES) — one per line</label>
                <textarea className="cov-input mono-font" value={lp.wallet_addresses || ''} onChange={e => setLp('wallet_addresses', e.target.value)}
                  rows={3} placeholder={"bc1q...\nbc1q..."} style={{ fontSize:'12px', resize:'vertical', lineHeight:1.6 }} />
              </div>
              <div>
                <label className="cov-label">TRANSACTION ID(S) — one per line</label>
                <textarea className="cov-input mono-font" value={lp.transaction_ids || ''} onChange={e => setLp('transaction_ids', e.target.value)}
                  rows={3} placeholder={"a1b2c3d4...\ne5f6g7h8..."} style={{ fontSize:'12px', resize:'vertical', lineHeight:1.6 }} />
              </div>
              {F('CHAIN ANALYTICS LINK (optional)', 'chain_analytics_link', 'https://platform.chainalysis.com/...')}
            </>
          )}

          {error && <div className="mono-font text-[10px] tracking-wide text-red-700 border border-red-200 bg-red-50 p-3">{error}</div>}

          <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginTop:'8px' }}>
            <BtnPrimary onClick={createCaseLink} disabled={linkLoading || !myInstitution.trim()}>
              {linkLoading ? 'GENERATING…' : 'GENERATE LINK →'}
            </BtnPrimary>
            <BtnSecondary onClick={() => { setError(''); setPhase('dashboard') }}>BACK</BtnSecondary>
          </div>

          <div className="mono-font text-[10px] text-stone-400 leading-relaxed" style={{ maxWidth:'480px' }}>
            The link expires in 30 days. Every access is logged with name, email, institution, and timestamp. Account-level identifiers (account number, transaction reference) are included in the payload to allow the receiving institution to look up the case — share only what your institution's data-sharing agreements permit.
          </div>
        </div>
      </div>
    )
  }

  // ── LINK READY ────────────────────────────────────────────────────────────────
  if (phase === 'link-ready') {
    const url = getCaseLinkUrl(linkToken)
    return (
      <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
        <DuoMasthead sub="LINK READY" />
        <div style={{ maxWidth:'580px' }}>
          <p className="display-font text-stone-600 mb-8" style={{ fontSize:'15px', lineHeight:1.7 }}>
            Your case link is live. Share it directly with the compliance or fraud team at the receiving institution. It expires in 30 days.
          </p>

          {/* The link */}
          <div style={{ border:'1px solid #C8C0B0', background:'#FFFFFF', padding:'20px', marginBottom:'24px' }}>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">SHAREABLE CASE LINK</div>
            <div className="mono-font text-stone-900 break-all" style={{ fontSize:'13px', lineHeight:1.6, marginBottom:'16px' }}>{url}</div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => { navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500) }}
                className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', padding:'8px 16px', background:'#1A1814', color:'#F5F1EA', border:'none', cursor:'pointer' }}>
                {linkCopied ? '✓ COPIED' : 'COPY LINK'}
              </button>
              <a href={`mailto:?subject=Case%20for%20your%20attention&body=Please%20review%20the%20following%20case%3A%0A%0A${encodeURIComponent(url)}%0A%0AThis%20link%20expires%20in%2030%20days.`}
                className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', padding:'8px 16px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', textDecoration:'none', display:'inline-block' }}>
                OPEN IN EMAIL
              </a>
            </div>
          </div>

          {/* What happens next */}
          <div style={{ border:'1px solid #E8E3DA', background:'#F9F7F3', padding:'20px', marginBottom:'24px' }}>
            <div className="mono-font text-[9px] tracking-widest text-stone-500 mb-3">WHAT HAPPENS NEXT</div>
            {[
              'The receiving institution opens the link and sees your institution name and case type — the details are blurred until they identify themselves.',
              'They enter their name, email, institution, and role. This is logged to your audit trail.',
              'They see the full case and submit a structured response — disposition, internal reference, and freeze confirmation if applicable.',
              'Their response appears live in the Responses panel below — auto-refreshing every 15 seconds.',
            ].map((t, i) => (
              <div key={i} style={{ display:'flex', gap:'12px', marginBottom:'12px' }}>
                <div className="mono-font text-[9px] text-stone-400 shrink-0" style={{ paddingTop:'2px' }}>0{i+1}</div>
                <div className="display-font text-stone-700" style={{ fontSize:'13px', lineHeight:1.6 }}>{t}</div>
              </div>
            ))}
          </div>

          {/* ACCESS LOG */}
          <div style={{ border:'1px solid #E8E3DA', marginBottom:'16px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', background:'#F9F7F3', cursor:'pointer', userSelect:'none' }}
              onClick={() => setAccessLogOpen(v => !v)}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <div className="mono-font text-[9px] tracking-widest text-stone-500">ACCESS LOG</div>
                <div className="mono-font text-[9px]" style={{ background:'#E8E3DA', color:'#6B5F4D', padding:'2px 7px' }}>
                  {linkAccessLog.length} {linkAccessLog.length === 1 ? 'VIEW' : 'VIEWS'}
                </div>
              </div>
              <div className="mono-font text-[9px] text-stone-400">{accessLogOpen ? '▲ COLLAPSE' : '▼ EXPAND'}</div>
            </div>
            {accessLogOpen && (
              <div style={{ padding:'0 16px 12px' }}>
                {linkAccessLog.length === 0
                  ? <div className="mono-font text-[10px] text-stone-400 py-3">No views yet — share the link to get started.</div>
                  : linkAccessLog.map((a, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'10px 0', borderBottom: i < linkAccessLog.length - 1 ? '1px solid #F0EBE3' : 'none' }}>
                      <div>
                        <div className="display-font font-semibold text-stone-900" style={{ fontSize:'13px' }}>{a.accessor_name || '—'}</div>
                        <div className="mono-font text-[10px] text-stone-500 mt-0.5">{[a.accessor_institution, a.accessor_role].filter(Boolean).join(' · ')}</div>
                        {a.accessor_email && <div className="mono-font text-[10px] text-stone-400 mt-0.5">{a.accessor_email}</div>}
                      </div>
                      <div className="mono-font text-[9px] text-stone-400 text-right shrink-0 ml-4">
                        {a.accessed_at ? new Date(a.accessed_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          {/* LIVE RESPONSES */}
          <div style={{ border:'1px solid #C8C0B0', marginBottom:'24px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', background:'#F5F1EA', borderBottom:'1px solid #E8E3DA' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <div className="mono-font text-[9px] tracking-widest text-stone-700">RESPONSES</div>
                <div className="mono-font text-[9px]" style={{ background: linkResponses.length > 0 ? '#065F46' : '#E8E3DA', color: linkResponses.length > 0 ? '#ECFDF5' : '#6B5F4D', padding:'2px 7px' }}>
                  {linkResponses.length} {linkResponses.length === 1 ? 'RESPONSE' : 'RESPONSES'}
                </div>
              </div>
              <div className="mono-font text-[9px] text-stone-400">
                {linkRespSync ? `SYNCED ${new Date(linkRespSync).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}` : 'SYNCING…'}
              </div>
            </div>
            <div style={{ padding: linkResponses.length > 0 ? '0' : '20px 16px' }}>
              {linkResponses.length === 0 ? (
                <div style={{ textAlign:'center' }}>
                  <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1">WAITING FOR RESPONSE</div>
                  <div className="display-font text-stone-500" style={{ fontSize:'13px', lineHeight:1.6 }}>
                    Responses submitted via the case link will appear here automatically.
                  </div>
                </div>
              ) : linkResponses.map((r, i) => {
                const dispColor = {
                  acknowledged:{ bg:'#EFF6FF', color:'#1E40AF' },
                  investigating:{ bg:'#FEF3C7', color:'#92400E' },
                  frozen:       { bg:'#ECFDF5', color:'#065F46' },
                  resolved:     { bg:'#F0FDF4', color:'#166534' },
                  declined:     { bg:'#FEF2F2', color:'#991B1B' },
                }[r.disposition] || { bg:'#F5F5F5', color:'#374151' }
                return (
                  <div key={i} style={{ padding:'16px', borderBottom: i < linkResponses.length - 1 ? '1px solid #E8E3DA' : 'none' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px', marginBottom:'10px' }}>
                      <div>
                        <div className="display-font font-bold text-stone-900" style={{ fontSize:'14px' }}>{r.respondent_name || 'Unknown'}</div>
                        <div className="mono-font text-[10px] text-stone-500 mt-0.5">
                          {[r.respondent_institution, r.respondent_role].filter(Boolean).join(' · ')}
                        </div>
                        {r.respondent_email && <div className="mono-font text-[10px] text-stone-400 mt-0.5">{r.respondent_email}</div>}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px', shrink:0 }}>
                        <div className="mono-font text-[9px]" style={{ ...dispColor, padding:'3px 8px', letterSpacing:'0.08em' }}>
                          {(r.disposition || 'UNKNOWN').toUpperCase()}
                        </div>
                        {r.freeze_confirmed && (
                          <div className="mono-font text-[9px]" style={{ background:'#ECFDF5', color:'#065F46', padding:'3px 8px', letterSpacing:'0.08em' }}>
                            ✓ FREEZE CONFIRMED
                          </div>
                        )}
                      </div>
                    </div>
                    {r.internal_case_ref && (
                      <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 shrink-0 pt-0.5">THEIR REF</div>
                        <div className="mono-font text-[11px] text-stone-700">{r.internal_case_ref}</div>
                      </div>
                    )}
                    {r.freeze_reference && (
                      <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 shrink-0 pt-0.5">FREEZE REF</div>
                        <div className="mono-font text-[11px] text-stone-700">{r.freeze_reference}</div>
                      </div>
                    )}
                    {r.notes && (
                      <div style={{ background:'#F9F7F3', border:'1px solid #E8E3DA', padding:'10px 12px', marginTop:'8px' }}>
                        <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-1">NOTES</div>
                        <div className="display-font text-stone-700" style={{ fontSize:'13px', lineHeight:1.6 }}>{r.notes}</div>
                      </div>
                    )}
                    <div className="mono-font text-[9px] text-stone-400 mt-8" style={{ textAlign:'right' }}>
                      {r.responded_at ? new Date(r.responded_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Incentive note */}
          <div style={{ background:'#1A1814', padding:'16px 20px', marginBottom:'24px' }}>
            <div className="mono-font text-[9px] tracking-widest mb-2" style={{ color:'#C9A86C' }}>COVALENCE USERS GET MORE</div>
            <p className="display-font" style={{ fontSize:'13px', color:'#C8C0B0', lineHeight:1.6 }}>
              Receiving institutions that join Covalence can respond directly inside their own dashboard, run live Duo sessions with you, and track all their cross-institutional cases in one place. They'll see the prompt when they access this link.
            </p>
          </div>

          <div style={{ display:'flex', gap:'10px' }}>
            <BtnPrimary onClick={() => { setPhase('link-setup'); setLinkToken(''); setLinkResponses([]); setLinkAccessLog([]) }}>SEND ANOTHER</BtnPrimary>
            <BtnSecondary onClick={() => setPhase('dashboard')}>BACK TO DUO</BtnSecondary>
          </div>
        </div>
      </div>
    )
  }

  return null
}

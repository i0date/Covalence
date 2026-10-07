import { useState, useEffect } from 'react'

const SUPA_URL = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_SUPABASE_URL || '') : ''
const SUPA_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_SUPABASE_ANON_KEY || '') : ''

function supaH() {
  return { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
}

async function fetchCaseLink(token) {
  const r = await fetch(`${SUPA_URL}/rest/v1/duo_case_links?token=eq.${token}&select=*`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  })
  if (!r.ok) throw new Error('Could not load case.')
  const d = await r.json()
  return d[0] || null
}

async function logAccess(token, data) {
  if (!SUPA_URL || !SUPA_KEY) return
  fetch(`${SUPA_URL}/rest/v1/case_link_access_log`, {
    method: 'POST',
    headers: supaH(),
    body: JSON.stringify({ token, ...data, user_agent: navigator.userAgent })
  }).catch(() => {})
}

async function submitResponse(token, data) {
  const r = await fetch(`${SUPA_URL}/rest/v1/case_link_responses`, {
    method: 'POST',
    headers: supaH(),
    body: JSON.stringify({ token, ...data })
  })
  if (!r.ok) throw new Error('Failed to submit response.')
}

const DISPOSITIONS = [
  { value: 'acknowledged', label: 'Acknowledged — reviewing internally' },
  { value: 'investigating', label: 'Under investigation on our end' },
  { value: 'frozen', label: 'Asset / funds frozen' },
  { value: 'resolved', label: 'Resolved — see notes' },
  { value: 'declined', label: 'Cannot act on this case' },
]

export default function CaseViewer({ token }) {
  const [caseData, setCaseData]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [phase, setPhase]           = useState('gate') // gate | view | respond | done
  const [expired, setExpired]       = useState(false)

  // Gate fields
  const [name, setName]             = useState('')
  const [email, setEmail]           = useState('')
  const [institution, setInstitution] = useState('')
  const [role, setRole]             = useState('')
  const [gateErr, setGateErr]       = useState('')
  const [gateLoading, setGateLoading] = useState(false)

  // Response fields
  const [disposition, setDisposition]     = useState('')
  const [internalRef, setInternalRef]     = useState('')
  const [freezeConfirmed, setFreezeConfirmed] = useState(false)
  const [freezeRef, setFreezeRef]         = useState('')
  const [notes, setNotes]                 = useState('')
  const [respLoading, setRespLoading]     = useState(false)
  const [respErr, setRespErr]             = useState('')

  useEffect(() => {
    if (!token) { setError('No case token found in URL.'); setLoading(false); return }
    fetchCaseLink(token)
      .then(d => {
        if (!d) { setError('Case not found or link is invalid.'); setLoading(false); return }
        if (!d.is_active) { setError('This case link has been deactivated.'); setLoading(false); return }
        if (new Date(d.expires_at) < new Date()) { setExpired(true); setCaseData(d); setLoading(false); return }
        setCaseData(d)
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [token])

  const handleGate = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !institution.trim() || !role.trim()) {
      setGateErr('All fields are required.'); return
    }
    setGateLoading(true); setGateErr('')
    await logAccess(token, { accessor_name: name.trim(), accessor_email: email.trim(), accessor_institution: institution.trim(), accessor_role: role.trim() })
    setGateLoading(false)
    setPhase('view')
  }

  const handleRespond = async (e) => {
    e.preventDefault()
    if (!disposition) { setRespErr('Please select a disposition.'); return }
    setRespLoading(true); setRespErr('')
    try {
      await submitResponse(token, {
        respondent_name: name,
        respondent_email: email,
        respondent_institution: institution,
        respondent_role: role,
        disposition,
        internal_case_ref: internalRef,
        freeze_confirmed: freezeConfirmed,
        freeze_reference: freezeRef,
        notes,
      })
      setPhase('done')
    } catch (e) { setRespErr(e.message) }
    setRespLoading(false)
  }

  const payload = caseData?.payload || {}
  const isCrypto = caseData?.case_type === 'crypto'

  // ── Loading / Error ──────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F9F7F3', fontFamily:'Georgia,serif' }}>
      <div style={{ color:'#8C7B6B', fontSize:'13px', letterSpacing:'0.1em', fontFamily:'Courier New,monospace' }}>LOADING CASE…</div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F9F7F3' }}>
      <div style={{ maxWidth:'420px', textAlign:'center', padding:'40px 24px' }}>
        <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.15em', color:'#9B1C1C', marginBottom:'16px' }}>CASE NOT FOUND</div>
        <p style={{ fontFamily:'Georgia,serif', color:'#57534E', fontSize:'15px', lineHeight:1.7 }}>{error}</p>
        <p style={{ fontFamily:'Courier New,monospace', fontSize:'11px', color:'#A09585', marginTop:'24px', letterSpacing:'0.05em' }}>If you believe this is an error, contact the institution that sent you this link.</p>
      </div>
    </div>
  )

  if (expired) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F9F7F3' }}>
      <div style={{ maxWidth:'420px', textAlign:'center', padding:'40px 24px' }}>
        <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.15em', color:'#92400E', marginBottom:'16px' }}>LINK EXPIRED</div>
        <p style={{ fontFamily:'Georgia,serif', color:'#57534E', fontSize:'15px', lineHeight:1.7 }}>This case link expired on {new Date(caseData.expires_at).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}.</p>
        <p style={{ fontFamily:'Courier New,monospace', fontSize:'11px', color:'#A09585', marginTop:'24px', letterSpacing:'0.05em' }}>Contact {caseData.sender_institution || 'the sending institution'} for a renewed link.</p>
      </div>
    </div>
  )

  // ── Gate ─────────────────────────────────────────────────────────────────────
  if (phase === 'gate') return (
    <div style={{ minHeight:'100vh', background:'#F9F7F3', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div style={{ background:'#1A1814', padding:'16px 32px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.18em', color:'#8C7B6B' }}>COVALENCE</div>
          <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.12em', color:'#4B4540', marginTop:'2px' }}>SECURE CASE LINK</div>
        </div>
        <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.1em', color:'#4B4540' }}>
          EXPIRES {new Date(caseData.expires_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }).toUpperCase()}
        </div>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px' }}>
        <div style={{ width:'100%', maxWidth:'920px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'48px', alignItems:'start' }}>

          {/* Left: blurred case preview */}
          <div>
            <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.14em', color:'#8C7B6B', marginBottom:'16px' }}>
              {isCrypto ? 'CRYPTO / DIGITAL ASSET CASE' : 'INTER-INSTITUTIONAL CASE'}
            </div>
            <div style={{ background:'#FFFFFF', border:'1px solid #D4CCBC', padding:'24px', position:'relative', overflow:'hidden' }}>
              {/* Visible top row */}
              <div style={{ marginBottom:'16px' }}>
                <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.1em', color:'#8C7B6B', marginBottom:'4px' }}>FROM</div>
                <div style={{ fontFamily:'Georgia,serif', fontSize:'18px', color:'#1A1814', fontWeight:'bold' }}>{caseData.sender_institution || 'Financial Institution'}</div>
              </div>
              {/* Blurred rows */}
              <div style={{ filter:'blur(6px)', userSelect:'none', pointerEvents:'none' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ marginBottom:'12px' }}>
                    <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', color:'#C8C0B0', marginBottom:'3px', width:`${40 + (i % 3) * 15}px`, background:'#E8E3DA', height:'10px', borderRadius:'2px' }} />
                    <div style={{ fontFamily:'Georgia,serif', fontSize:'13px', color:'#57534E', background:'#F5F1EA', height:'14px', borderRadius:'2px', width:`${120 + (i % 4) * 30}px` }} />
                  </div>
                ))}
              </div>
              {/* Lock overlay */}
              <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', paddingBottom:'28px', background:'linear-gradient(to bottom, transparent 35%, rgba(249,247,243,0.95) 60%)' }}>
                <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.12em', color:'#8C7B6B' }}>IDENTIFY YOURSELF TO VIEW THIS CASE →</div>
              </div>
            </div>
            <div style={{ marginTop:'16px', fontFamily:'Courier New,monospace', fontSize:'10px', color:'#A09585', letterSpacing:'0.06em', lineHeight:1.8 }}>
              Access to this case is logged. Your identity, institution, and timestamp are recorded for the sending institution's compliance record.
            </div>
          </div>

          {/* Right: gate form */}
          <div>
            <div style={{ fontFamily:'Georgia,serif', fontSize:'26px', fontWeight:'bold', color:'#1A1814', letterSpacing:'-0.02em', marginBottom:'8px' }}>Identify yourself to access this case</div>
            <p style={{ fontFamily:'Georgia,serif', fontSize:'14px', color:'#6B5F4D', lineHeight:1.7, marginBottom:'32px' }}>
              {caseData.sender_institution || 'A financial institution'} has shared a case with your organisation via Covalence. Enter your details to unlock the full case and submit a response.
            </p>
            <form onSubmit={handleGate} style={{ display:'grid', gap:'16px' }}>
              {[
                { label:'FULL NAME', val: name, set: setName, placeholder:'Jane Osei' },
                { label:'WORK EMAIL', val: email, set: setEmail, placeholder:'jane.osei@yourbank.com', type:'email' },
                { label:'INSTITUTION NAME', val: institution, set: setInstitution, placeholder:'Midwest Community Bank' },
                { label:'YOUR ROLE', val: role, set: setRole, placeholder:'Fraud Analyst / Compliance Officer' },
              ].map(({ label, val, set, placeholder, type }) => (
                <div key={label}>
                  <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#8C7B6B', marginBottom:'6px' }}>{label}</div>
                  <input type={type || 'text'} value={val} onChange={e => set(e.target.value)}
                    placeholder={placeholder} required
                    style={{ width:'100%', padding:'10px 12px', fontFamily:'Georgia,serif', fontSize:'14px', border:'1px solid #C8C0B0', background:'#FFFFFF', outline:'none', boxSizing:'border-box', color:'#1A1814' }} />
                </div>
              ))}
              {gateErr && <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', color:'#9B1C1C', letterSpacing:'0.06em' }}>{gateErr}</div>}
              <button type="submit" disabled={gateLoading}
                style={{ padding:'12px 24px', background:'#1A1814', color:'#F5F1EA', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.14em', border:'none', cursor:'pointer', marginTop:'8px', opacity: gateLoading ? 0.6 : 1 }}>
                {gateLoading ? 'LOGGING ACCESS…' : 'ACCESS CASE →'}
              </button>
            </form>

            {/* Covalence CTA */}
            <div style={{ marginTop:'32px', padding:'16px', background:'#1A1814', borderLeft:'3px solid #C9A86C' }}>
              <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#C9A86C', marginBottom:'6px' }}>RECEIVE CASES LIKE THIS IN YOUR OWN DASHBOARD</div>
              <p style={{ fontFamily:'Georgia,serif', fontSize:'13px', color:'#C8C0B0', lineHeight:1.6, marginBottom:'12px' }}>
                Covalence users can respond directly from their platform, track resolution across all their cases, and send case links to other institutions.
              </p>
              <a href="https://covalence.vercel.app" target="_blank" rel="noopener noreferrer"
                style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.12em', color:'#C9A86C', textDecoration:'none' }}>
                REQUEST EARLY ACCESS →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // ── View + Respond ────────────────────────────────────────────────────────────
  if (phase === 'view' || phase === 'respond') return (
    <div style={{ minHeight:'100vh', background:'#F9F7F3', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div style={{ background:'#1A1814', padding:'16px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.18em', color:'#8C7B6B' }}>COVALENCE · SECURE CASE LINK</div>
          <div style={{ fontFamily:'Georgia,serif', fontSize:'15px', color:'#F5F1EA', marginTop:'2px' }}>{caseData.sender_institution || 'Institution'} → {institution}</div>
        </div>
        <div style={{ display:'flex', gap:'16px', alignItems:'center' }}>
          <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.1em', color:'#4B4540' }}>
            ACCESSED {new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }).toUpperCase()}
          </div>
          {phase === 'view' && (
            <button onClick={() => setPhase('respond')}
              style={{ padding:'8px 16px', background:'#064E3B', color:'#F0FDF4', fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.12em', border:'none', cursor:'pointer' }}>
              SUBMIT RESPONSE →
            </button>
          )}
        </div>
      </div>

      <div style={{ maxWidth:'960px', margin:'0 auto', padding:'40px 24px', width:'100%' }}>

        {/* Case type badge */}
        <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.14em', color:'#8C7B6B', marginBottom:'24px' }}>
          {isCrypto ? '⬡ CRYPTO / DIGITAL ASSET CASE' : '⬡ INTER-INSTITUTIONAL CASE'}
          {' · '}{caseData.sender_institution}
        </div>

        {/* Case details */}
        <div style={{ background:'#FFFFFF', border:'1px solid #D4CCBC', marginBottom:'32px' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid #EDE8E0', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.12em', color:'#8C7B6B' }}>CASE DETAILS</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <tbody>
              {/* Standard fields always shown */}
              {[
                { k:'Case Reference', v: payload.case_ref },
                { k:'Report Type', v: payload.report_type },
                { k:'Incident Date', v: payload.incident_date },
                { k:'Amount', v: payload.amount ? `${payload.amount}${payload.currency ? ' ' + payload.currency : ''}` : null },
                { k:'Nature of Report', v: payload.nature },
                { k:'Summary', v: payload.summary },
              ].filter(r => r.v).map(({ k, v }) => (
                <tr key={k} style={{ borderBottom:'1px solid #F0EBE3' }}>
                  <td style={{ padding:'12px 20px', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.06em', color:'#8C7B6B', width:'35%', verticalAlign:'top', whiteSpace:'nowrap' }}>{k.toUpperCase()}</td>
                  <td style={{ padding:'12px 20px', fontFamily:'Georgia,serif', fontSize:'14px', color:'#1A1814', lineHeight:1.6 }}>{v}</td>
                </tr>
              ))}

              {/* Crypto-specific fields */}
              {isCrypto && payload.asset_type && (
                <tr style={{ borderBottom:'1px solid #F0EBE3', background:'#FAFAF8' }}>
                  <td style={{ padding:'12px 20px', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.06em', color:'#8C7B6B', verticalAlign:'top' }}>ASSET TYPE</td>
                  <td style={{ padding:'12px 20px', fontFamily:'Courier New,monospace', fontSize:'13px', color:'#1A1814' }}>{payload.asset_type}</td>
                </tr>
              )}
              {isCrypto && payload.wallet_addresses?.length > 0 && (
                <tr style={{ borderBottom:'1px solid #F0EBE3', background:'#FAFAF8' }}>
                  <td style={{ padding:'12px 20px', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.06em', color:'#8C7B6B', verticalAlign:'top' }}>WALLET ADDRESS(ES)</td>
                  <td style={{ padding:'12px 20px' }}>
                    {payload.wallet_addresses.map((addr, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px' }}>
                        <code style={{ fontFamily:'Courier New,monospace', fontSize:'12px', color:'#1A1814', background:'#F5F1EA', padding:'4px 8px', wordBreak:'break-all' }}>{addr}</code>
                        <button onClick={() => navigator.clipboard.writeText(addr)}
                          style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.1em', padding:'3px 8px', background:'transparent', border:'1px solid #C8C0B0', color:'#8C7B6B', cursor:'pointer', whiteSpace:'nowrap' }}>
                          COPY
                        </button>
                      </div>
                    ))}
                  </td>
                </tr>
              )}
              {isCrypto && payload.transaction_ids?.length > 0 && (
                <tr style={{ borderBottom:'1px solid #F0EBE3', background:'#FAFAF8' }}>
                  <td style={{ padding:'12px 20px', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.06em', color:'#8C7B6B', verticalAlign:'top' }}>TRANSACTION ID(S)</td>
                  <td style={{ padding:'12px 20px' }}>
                    {payload.transaction_ids.map((txid, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px' }}>
                        <code style={{ fontFamily:'Courier New,monospace', fontSize:'12px', color:'#1A1814', background:'#F5F1EA', padding:'4px 8px', wordBreak:'break-all' }}>{txid}</code>
                        <button onClick={() => navigator.clipboard.writeText(txid)}
                          style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.1em', padding:'3px 8px', background:'transparent', border:'1px solid #C8C0B0', color:'#8C7B6B', cursor:'pointer', whiteSpace:'nowrap' }}>
                          COPY
                        </button>
                      </div>
                    ))}
                  </td>
                </tr>
              )}
              {isCrypto && payload.chain_analytics_link && (
                <tr style={{ background:'#FAFAF8' }}>
                  <td style={{ padding:'12px 20px', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.06em', color:'#8C7B6B', verticalAlign:'top' }}>CHAIN ANALYTICS</td>
                  <td style={{ padding:'12px 20px' }}>
                    <a href={payload.chain_analytics_link} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily:'Courier New,monospace', fontSize:'11px', color:'#1E40AF', letterSpacing:'0.04em' }}>
                      OPEN IN ANALYTICS PLATFORM →
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Response form */}
        {phase === 'respond' && (
          <div style={{ background:'#FFFFFF', border:'1px solid #D4CCBC' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #EDE8E0', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.12em', color:'#8C7B6B' }}>YOUR RESPONSE</div>
            <form onSubmit={handleRespond} style={{ padding:'24px', display:'grid', gap:'20px' }}>
              {/* Disposition */}
              <div>
                <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#8C7B6B', marginBottom:'8px' }}>DISPOSITION *</div>
                <div style={{ display:'grid', gap:'8px' }}>
                  {DISPOSITIONS.map(d => (
                    <label key={d.value} style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer', padding:'10px 12px', border:`1px solid ${disposition === d.value ? '#1A1814' : '#E8E3DA'}`, background: disposition === d.value ? '#1A1814' : '#FAFAF8' }}>
                      <input type="radio" name="disposition" value={d.value} checked={disposition === d.value}
                        onChange={() => setDisposition(d.value)} style={{ accentColor:'#C9A86C' }} />
                      <span style={{ fontFamily:'Georgia,serif', fontSize:'13px', color: disposition === d.value ? '#F5F1EA' : '#2D2922' }}>{d.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Internal ref */}
              <div>
                <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#8C7B6B', marginBottom:'6px' }}>YOUR INTERNAL CASE / TICKET REFERENCE</div>
                <input value={internalRef} onChange={e => setInternalRef(e.target.value)}
                  placeholder="e.g. FRAUD-2024-00892"
                  style={{ width:'100%', padding:'10px 12px', fontFamily:'Courier New,monospace', fontSize:'13px', border:'1px solid #C8C0B0', background:'#FFFFFF', outline:'none', boxSizing:'border-box', color:'#1A1814' }} />
              </div>

              {/* Freeze confirmation (crypto + frozen disposition) */}
              {(isCrypto || disposition === 'frozen') && (
                <div style={{ padding:'16px', background:'#F0FDF4', border:'1px solid #6EE7B7' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer', marginBottom:'12px' }}>
                    <input type="checkbox" checked={freezeConfirmed} onChange={e => setFreezeConfirmed(e.target.checked)}
                      style={{ width:'16px', height:'16px', accentColor:'#065F46' }} />
                    <span style={{ fontFamily:'Georgia,serif', fontSize:'13px', color:'#065F46', fontWeight:'bold' }}>
                      I confirm that the {isCrypto ? 'asset / wallet' : 'funds'} have been frozen pending this investigation.
                    </span>
                  </label>
                  {freezeConfirmed && (
                    <div>
                      <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#065F46', marginBottom:'6px' }}>FREEZE / HOLD REFERENCE NUMBER</div>
                      <input value={freezeRef} onChange={e => setFreezeRef(e.target.value)}
                        placeholder="e.g. HOLD-20240115-004"
                        style={{ width:'100%', padding:'10px 12px', fontFamily:'Courier New,monospace', fontSize:'13px', border:'1px solid #6EE7B7', background:'#FFFFFF', outline:'none', boxSizing:'border-box', color:'#1A1814' }} />
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#8C7B6B', marginBottom:'6px' }}>NOTES / FINDINGS</div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                  placeholder="Any relevant findings, actions taken, or context for the sending institution…"
                  style={{ width:'100%', padding:'10px 12px', fontFamily:'Georgia,serif', fontSize:'14px', border:'1px solid #C8C0B0', background:'#FFFFFF', outline:'none', boxSizing:'border-box', resize:'vertical', lineHeight:1.6, color:'#1A1814' }} />
              </div>

              {respErr && <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', color:'#9B1C1C', letterSpacing:'0.06em' }}>{respErr}</div>}

              <div style={{ display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
                <button type="submit" disabled={respLoading}
                  style={{ padding:'12px 24px', background:'#064E3B', color:'#F0FDF4', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.14em', border:'none', cursor:'pointer', opacity: respLoading ? 0.6 : 1 }}>
                  {respLoading ? 'SUBMITTING…' : 'SUBMIT RESPONSE →'}
                </button>
                <button type="button" onClick={() => setPhase('view')}
                  style={{ padding:'12px 16px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.14em', cursor:'pointer' }}>
                  BACK
                </button>
                <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', color:'#A09585', letterSpacing:'0.06em' }}>
                  Your response is logged with a timestamp and sent to {caseData.sender_institution || 'the sending institution'}.
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={{ minHeight:'100vh', background:'#F9F7F3', display:'flex', flexDirection:'column' }}>
      <div style={{ background:'#1A1814', padding:'16px 32px' }}>
        <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.18em', color:'#8C7B6B' }}>COVALENCE · SECURE CASE LINK</div>
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 24px' }}>
        <div style={{ maxWidth:'520px', textAlign:'center' }}>
          <div style={{ fontFamily:'Courier New,monospace', fontSize:'10px', letterSpacing:'0.15em', color:'#065F46', marginBottom:'20px' }}>RESPONSE SUBMITTED</div>
          <h1 style={{ fontFamily:'Georgia,serif', fontSize:'32px', fontWeight:'bold', color:'#1A1814', letterSpacing:'-0.02em', marginBottom:'16px' }}>Response recorded.</h1>
          <p style={{ fontFamily:'Georgia,serif', fontSize:'15px', color:'#6B5F4D', lineHeight:1.7, marginBottom:'32px' }}>
            Your response has been logged and will be visible to {caseData.sender_institution || 'the sending institution'} in their Covalence dashboard. Your freeze confirmation (if provided) creates a timestamped record for both parties.
          </p>

          {/* Covalence CTA */}
          <div style={{ background:'#1A1814', padding:'24px', textAlign:'left' }}>
            <div style={{ fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', color:'#C9A86C', marginBottom:'8px' }}>RECEIVE FUTURE CASES IN YOUR OWN DASHBOARD</div>
            <p style={{ fontFamily:'Georgia,serif', fontSize:'13px', color:'#C8C0B0', lineHeight:1.6, marginBottom:'16px' }}>
              Covalence users get a full inter-institutional case management platform — send and receive case links, run live Duo sessions, track resolution, and build your compliance record automatically.
            </p>
            <a href="https://covalence.vercel.app" target="_blank" rel="noopener noreferrer"
              style={{ display:'inline-block', padding:'10px 20px', background:'#C9A86C', color:'#1A1814', fontFamily:'Courier New,monospace', fontSize:'9px', letterSpacing:'0.14em', textDecoration:'none', fontWeight:'bold' }}>
              REQUEST EARLY ACCESS →
            </a>
          </div>
        </div>
      </div>
    </div>
  )

  return null
}

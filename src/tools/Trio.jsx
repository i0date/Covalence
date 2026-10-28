// 008 TRIO — incident command (operational + strategy)
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { CaseLink } from '../CaseThread.jsx'
import { mergeTrioIncidents, pullTrioFromSupa, pushTrioToSupa } from '../data.js'

// ═══════════════════════════════════════════════════════════════════════════════
// TRIO VIEW — fraud incident command
// ═══════════════════════════════════════════════════════════════════════════════
export function TrioView({ outcomes: _parentOutcomes }) {
  const STORAGE_KEY = 'cov_trio_incidents'
  const loadIncidents = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] } }
  const saveIncidents = (arr) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)) } catch {} }

  const [incidents, setIncidents]   = React.useState(loadIncidents)
  const [activeId,  setActiveId]    = React.useState(null)
  const [showCreate, setShowCreate] = React.useState(false)
  const [noteDraft,  setNoteDraft]  = React.useState('')
  const [linkInput,     setLinkInput]     = React.useState('')
  const [linkError,     setLinkError]     = React.useState('')
  const [syncStatus,    setSyncStatus]    = React.useState('')
  const [mergeModal,    setMergeModal]    = React.useState(null)
  const [fiInput,       setFiInput]       = React.useState({ name:'', type:'bank', status:'notified' })
  const [receivingEdit, setReceivingEdit] = React.useState(false)
  const [receivingDraft,setReceivingDraft]= React.useState({})
  // ── Strategy mode ──
  const [strategyMode,      setStrategyMode]      = React.useState(false)
  const [strategyIncId,     setStrategyIncId]     = React.useState(null)   // which incident is open in debrief
  const [strategyNotes,     setStrategyNotes]     = React.useState(() => { try { return JSON.parse(localStorage.getItem('cov_trio_strategy_notes') || '{}') } catch { return {} } })
  const [strategyDraft,     setStrategyDraft]     = React.useState('')
  const [briefCopied,       setBriefCopied]       = React.useState(false)
  const [playbooks,         setPlaybooks]         = React.useState(() => { try { return JSON.parse(localStorage.getItem('cov_trio_playbooks')||'[]') } catch { return [] } })
  const [playbookIncId,     setPlaybookIncId]     = React.useState(null)
  const [structuredDebriefs,setStructuredDebriefs]= React.useState(() => { try { return JSON.parse(localStorage.getItem('cov_trio_debriefs')||'{}') } catch { return {} } })
  const [structDraft,       setStructDraft]       = React.useState({})
  const [showPlaybooks,     setShowPlaybooks]     = React.useState(false)
  const [caseFilter,        setCaseFilter]        = React.useState('all')   // all | fraud | service | won | open
  const [globalNoteDraft,   setGlobalNoteDraft]   = React.useState('')
  const [globalNotes,       setGlobalNotes]       = React.useState(() => { try { return JSON.parse(localStorage.getItem('cov_strategy_global_notes') || '[]') } catch { return [] } })
  const saveGlobalNote = (text) => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('cov_user') || 'null') } catch { return null } })()
    const note = { id: crypto.randomUUID(), text, author: user?.name || 'Strategist', ts: new Date().toISOString() }
    const updated = [note, ...globalNotes]
    setGlobalNotes(updated)
    setGlobalNoteDraft('')
    try { localStorage.setItem('cov_strategy_global_notes', JSON.stringify(updated)) } catch {}
  }

  const saveStrategyNote = (incId, text) => {
    const updated = { ...strategyNotes, [incId]: [...(strategyNotes[incId]||[]), { text, author: localStorage.getItem('cov_agent_name')||'Strategist', ts: new Date().toISOString() }] }
    setStrategyNotes(updated)
    try { localStorage.setItem('cov_trio_strategy_notes', JSON.stringify(updated)) } catch {}
    setStrategyDraft('')
  }

  const generateThreatBrief = (inc) => {
    const linked = (inc.linkedCaseIds||[]).length
    const fis    = (inc.affectedFis||[]).map(f => f.name).join(', ') || 'None recorded'
    const parts  = (inc.participants||[]).join(', ') || 'None recorded'
    const notes  = (strategyNotes[inc.id]||[])
    const noteLines = notes.length ? notes.map(n => `  [${new Date(n.ts).toLocaleDateString()}] ${n.author}: ${n.text}`).join('\n') : '  No strategic annotations recorded.'
    const sarFlag = (() => { try { const s = JSON.parse(localStorage.getItem('cov_settings')||'{}'); const t = parseFloat(s.sarThreshold)||5000; const allC = JSON.parse(localStorage.getItem('cov_outcomes')||'[]'); const total = allC.filter(c=>(inc.linkedCaseIds||[]).includes(c.id)).reduce((s,c)=>s+parseFloat(c.amount||0),0); return total>=t ? `⚠ SAR THRESHOLD: Linked case total $${total.toFixed(2)} meets or exceeds $${t.toLocaleString()} threshold. Review SAR/STR filing obligation.` : `Linked case total: $${total.toFixed(2)} (below SAR threshold of $${t.toLocaleString()})` } catch { return 'SAR assessment unavailable.' } })()
    return `TRIO THREAT BRIEF
══════════════════════════════════════════════════════
INCIDENT:       ${inc.name}
ID:             ${inc.id}
TYPE:           ${(inc.type||'').replace(/_/g,' ').toUpperCase()}
SEVERITY:       ${inc.severity||'—'}
STATUS:         ${(inc.status||'active').toUpperCase()}
DETECTED:       ${inc.detectionDate||'—'}
GENERATED:      ${new Date().toLocaleString()}

SUMMARY
──────────────────────────────────────────────────────
${inc.description||'No description provided.'}

SCOPE
──────────────────────────────────────────────────────
Linked cases:         ${linked}
Participating agents: ${parts}
Affected FIs:         ${fis}
Cardholder exposure:  ${inc.cardholderNotified||0} notified of ${inc.cardholderTotal||0} affected

REGULATORY
──────────────────────────────────────────────────────
${sarFlag}

WAR ROOM — LAST 5 ENTRIES
──────────────────────────────────────────────────────
${(inc.notes||[]).slice(-5).map(n=>`  [${new Date(n.ts).toLocaleTimeString()}] ${n.author}: ${n.text}`).join('\n')||'  No war room entries.'}

STRATEGIC ANNOTATIONS
──────────────────────────────────────────────────────
${noteLines}

RECOMMENDED ACTIONS
──────────────────────────────────────────────────────
${inc.status==='closed'
  ? '  ✓ Incident closed. Review pattern findings and update fraud policy if applicable.'
  : '  • Confirm SAR/STR obligations with BSA Officer.\n  • Assess whether Duo coordination with receiving FIs is active.\n  • Determine escalation path to Risk Committee if exposure exceeds threshold.'}

══════════════════════════════════════════════════════
COVALENCE · TRIO RISK INTELLIGENCE · CONFIDENTIAL
`
  }

  // Create form state
  const [form, setForm] = React.useState({ name:'', type:'fraud_wave', severity:'HIGH', detectionDate: new Date().toISOString().split('T')[0], affectedProduct:'', description:'' })

  const settings = React.useMemo(() => { try { return JSON.parse(localStorage.getItem('cov_settings') || '{}') } catch { return {} } }, [])
  // allCases = Desk/Multi/File cases (cov_outcomes) + Triage intake log (triage_outcomes), deduplicated by id
  const allCases = React.useMemo(() => {
    try {
      const desk    = JSON.parse(localStorage.getItem('cov_outcomes')    || '[]')
      const triage  = JSON.parse(localStorage.getItem('triage_outcomes') || '[]').map(t => ({
        ...t,
        _source: 'TRIAGE',
        status: t.outcome || t.routing || 'triaged',
        merchant: t.merchant || '—',
      }))
      const deskIds = new Set(desk.map(c => c.id))
      const triageOnly = triage.filter(t => !deskIds.has(t.id))
      return [...desk, ...triageOnly].sort((a,b) => new Date(b.date||0) - new Date(a.date||0))
    } catch { return [] }
  }, [])
  const sarThreshold = parseFloat(settings.sarThreshold) || 5000
  const agentName = localStorage.getItem('cov_agent_name') || 'Agent'

  // Supabase sync on mount + every 30s
  React.useEffect(() => {
    const sync = async () => {
      setSyncStatus('syncing')
      try {
        const remote = await pullTrioFromSupa()
        if (remote.length) {
          setIncidents(prev => {
            const merged = mergeTrioIncidents(prev, remote)
            saveIncidents(merged)
            return merged
          })
        }
        setSyncStatus('synced')
      } catch { setSyncStatus('error') }
    }
    sync()
    const id = setInterval(sync, 30000)
    return () => clearInterval(id)
  }, [])

  const persist = (updated) => {
    setIncidents(updated)
    saveIncidents(updated)
    pushTrioToSupa(updated).catch(() => {})
  }

  // A compromised-merchant alert in 001 Triage opens an incident here
  React.useEffect(() => {
    const h = e => setIncidents(prev => {
      if (prev.some(i => i.id === e.detail.id)) return prev
      const next = [e.detail, ...prev]; saveIncidents(next); pushTrioToSupa(next).catch(() => {}); return next
    })
    window.addEventListener('cov:trio-create', h)
    return () => window.removeEventListener('cov:trio-create', h)
  }, [])

  const mergeIncidents = (fromId, intoId) => {
    setIncidents(prev => {
      const from = prev.find(i => i.id === fromId)
      const into = prev.find(i => i.id === intoId)
      if (!from || !into) return prev
      const merged = {
        ...into,
        linkedCaseIds: [...new Set([...(into.linkedCaseIds||[]), ...(from.linkedCaseIds||[])])],
        notes: [...(into.notes||[]), ...(from.notes||[])].sort((a,b) => new Date(a.ts)-new Date(b.ts)),
        participants: [...new Set([...(into.participants||[]), ...(from.participants||[])])],
        affectedFis: [...(into.affectedFis||[]), ...(from.affectedFis||[]).filter(f => !(into.affectedFis||[]).find(x => x.name === f.name))],
        cardholderNotified: (into.cardholderNotified||0) + (from.cardholderNotified||0),
        cardholderTotal: (into.cardholderTotal||0) + (from.cardholderTotal||0),
        updatedAt: new Date().toISOString(),
      }
      const updated = prev.filter(i => i.id !== fromId).map(i => i.id === intoId ? merged : i)
      saveIncidents(updated)
      pushTrioToSupa(updated).catch(()=>{})
      return updated
    })
    setMergeModal(null)
    setActiveId(intoId)
  }

  const joinIncident = (id) => {
    setActiveId(id)
    setIncidents(prev => {
      const updated = prev.map(i => {
        if (i.id !== id) return i
        const parts = i.participants || []
        if (parts.includes(agentName)) return i
        return { ...i, participants: [...parts, agentName], updatedAt: new Date().toISOString() }
      })
      saveIncidents(updated)
      pushTrioToSupa(updated).catch(() => {})
      return updated
    })
  }

  const activeIncident = incidents.find(i => i.id === activeId) || null
  const linkedCases = activeIncident ? allCases.filter(c => (activeIncident.linkedCaseIds||[]).includes(c.id)) : []
  const linkedTotal = linkedCases.reduce((sum, c) => sum + (parseFloat((c.amount||'0').replace(/[^0-9.]/g,''))||0), 0)
  const sarProgress = Math.min(linkedTotal / sarThreshold, 1)
  const sarCrossed = linkedTotal >= sarThreshold

  const elapsedLabel = (detectionDate) => {
    if (!detectionDate) return '—'
    const ms = Date.now() - new Date(detectionDate + 'T00:00:00').getTime()
    const h = Math.floor(ms / 3600000)
    if (h < 24) return `${h}h elapsed`
    return `${Math.floor(h/24)}d ${h%24}h elapsed`
  }

  const createIncident = () => {
    if (!form.name.trim()) return
    const inc = {
      id: 'TRI-' + Date.now().toString(36).toUpperCase(),
      name: form.name.trim(),
      type: form.type,
      severity: form.severity,
      detectionDate: form.detectionDate,
      affectedProduct: form.affectedProduct.trim(),
      description: form.description.trim(),
      status: 'active',
      linkedCaseIds: [],
      notes: [],
      cardholderNotified: 0,
      cardholderTotal: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const updated = [inc, ...incidents]
    persist(updated)
    setActiveId(inc.id)
    setShowCreate(false)
    setForm({ name:'', type:'fraud_wave', severity:'HIGH', detectionDate: new Date().toISOString().split('T')[0], affectedProduct:'', description:'' })
  }

  const updateIncident = (id, patch) => {
    persist(incidents.map(i => i.id === id ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i))
  }

  const addNote = () => {
    const text = noteDraft.trim()
    if (!text || !activeIncident) return
    const note = { text, author: agentName, ts: new Date().toISOString() }
    updateIncident(activeId, { notes: [...(activeIncident.notes||[]), note] })
    setNoteDraft('')
  }

  const linkCase = () => {
    const cid = linkInput.trim().toUpperCase()
    setLinkError('')
    if (!cid) return
    if ((activeIncident.linkedCaseIds||[]).includes(cid)) { setLinkError('Already linked'); return }
    const found = allCases.find(c => c.id === cid)
    if (!found) { setLinkError(`Case ${cid} not found in tracker`); return }
    updateIncident(activeId, { linkedCaseIds: [...(activeIncident.linkedCaseIds||[]), cid] })
    setLinkInput('')
  }

  const unlinkCase = (cid) => {
    updateIncident(activeId, { linkedCaseIds: (activeIncident.linkedCaseIds||[]).filter(x => x !== cid) })
  }

  const SEV_COLORS = { LOW:'#065F46', MEDIUM:'#92400E', HIGH:'#B45309', CRITICAL:'#991B1B' }
  const SEV_BG     = { LOW:'#ECFDF5', MEDIUM:'#FEF3C7', HIGH:'#FEF3C7', CRITICAL:'#FEF2F2' }
  const STATUS_COLORS = { active:'#991B1B', contained:'#92400E', closed:'#78716C' }
  const TYPE_LABELS = { fraud_wave:'Fraud Wave', bin_attack:'BIN Attack', ato:'Account Takeover', platform_compromise:'Platform Compromise', p2p_scam:'P2P Scam Campaign', other:'Other' }

  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>

      {/* ── Masthead ── */}
      <div className="mb-6 pb-6" style={{ borderBottom:'1px solid #D4CCBC', display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:'16px' }}>
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-400 mb-3">ISSUE Nº 008 — TRIO</div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:'clamp(48px,8vw,96px)', letterSpacing:'-0.03em' }}>
            <span style={{ fontWeight:700 }}>Tri</span><span style={{ fontStyle:'italic', fontWeight:500 }}>o</span>
          </h1>
          <p className="display-font text-stone-600 mt-3" style={{ fontSize:'clamp(14px,1.8vw,16px)', lineHeight:1.5, maxWidth:'560px' }}>
            Three parties — your institution, the receiving platform or FI, and the affected customers — one incident record. Open a TRIO incident when a fraud wave hits: link your Desk cases, map the transaction chain, track SAR obligations, coordinate receiving FIs, and run the war room.
          </p>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'12px' }}>
          <div className="mono-font text-xs tracking-widest text-stone-600">{new Date().toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</div>
          {/* ── Mode toggle ── */}
          <div style={{ display:'flex', gap:'1px', background:'#D4CCBC' }}>
            {[['OPERATIONAL','⚡'],['STRATEGY','◈']].map(([mode, icon]) => {
              const active = strategyMode ? mode==='STRATEGY' : mode==='OPERATIONAL'
              return (
                <button key={mode} onClick={() => { setStrategyMode(mode==='STRATEGY'); setStrategyIncId(null) }}
                  className="mono-font"
                  style={{ fontSize:'10px', letterSpacing:'0.14em', padding:'10px 22px', border:'none', cursor:'pointer', transition:'all 0.15s',
                    background: active ? '#1A1814' : '#EDE9E3',
                    color:      active ? '#D4CCBC' : '#78716C',
                    fontWeight: active ? 700 : 400 }}>
                  {icon} &nbsp;{mode}
                </button>
              )
            })}
          </div>
          {strategyMode && (
            <div className="mono-font text-[10px] tracking-widest" style={{ color:'#78716C' }}>RISK STRATEGIST VIEW</div>
          )}
        </div>
      </div>

      {/* ── Early access banner — Trio is still growing, and says so ── */}
      <div className="mb-6 px-4 py-2.5 flex items-center gap-3 flex-wrap" style={{ background:'#FAF7F1', border:'1px solid #7F1D1D' }}>
        <span className="mono-font text-[10px] tracking-widest px-2 py-0.5" style={{ background:'#7F1D1D', color:'#FEF2F2' }}>EARLY ACCESS</span>
        <span className="display-font text-[12px] text-stone-700">Trio is live and growing — new incident command capabilities are rolling out in phases, with cross-institutional coordination next.</span>
      </div>

      {/* ══════════════════════════════════════════════════════════
           STRATEGY MODE
      ══════════════════════════════════════════════════════════ */}
      {strategyMode && (() => {
        const closed   = incidents.filter(i => i.status === 'closed')
        const allIncs  = incidents
        const debriefInc = strategyIncId ? incidents.find(i => i.id === strategyIncId) : null

        // Pattern aggregates
        const typeCount = {}
        const fiCount   = {}
        allIncs.forEach(i => {
          typeCount[i.type||'unknown'] = (typeCount[i.type||'unknown']||0)+1;
          (i.affectedFis||[]).forEach(f => { fiCount[f.name] = (fiCount[f.name]||0)+1 })
        })
        const topTypes   = Object.entries(typeCount).sort((a,b)=>b[1]-a[1])
        const topFis     = Object.entries(fiCount).sort((a,b)=>b[1]-a[1]).slice(0,6)
        const totalCases = allIncs.reduce((s,i)=>s+(i.linkedCaseIds||[]).length,0)
        const openCount  = allIncs.filter(i=>i.status==='active').length
        const contCount  = allIncs.filter(i=>i.status==='contained').length
        const closeCount = closed.length
        // Exposure + SAR
        const allOutcomesS  = (() => { try { return JSON.parse(localStorage.getItem('cov_outcomes')||'[]') } catch { return [] } })()
        const sarThresholdV = parseFloat(settings?.sarThreshold)||5000
        const incidentSAR   = allIncs.map(inc => {
          const linked   = allOutcomesS.filter(c => (inc.linkedCaseIds||[]).includes(c.id))
          const exposure = linked.reduce((s,c) => s+(parseFloat(c.amount)||0), 0)
          return { ...inc, exposure, sarTriggered: exposure >= sarThresholdV, linkedCount: linked.length }
        })
        const totalExposure = incidentSAR.reduce((s,i)=>s+i.exposure,0)
        const sarHits       = incidentSAR.filter(i=>i.sarTriggered).length
        // 12-month timeline
        const nowD = new Date()
        const incTimeline = Array.from({length:12}, (_,idx) => {
          const d   = new Date(nowD.getFullYear(), nowD.getMonth()-(11-idx), 1)
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
          return { label: d.toLocaleDateString('en-US',{month:'short'}), key, count: allIncs.filter(i=>(i.detectionDate||'').startsWith(key)).length }
        })
        const maxInc = Math.max(...incTimeline.map(m=>m.count),1)
        // Playbook helpers
        const PLAYBOOK_STEPS = {
          fraud_wave:        { immediate:['Freeze approvals on flagged BIN range','Alert BSA Officer — SAR threshold assessment','Notify card operations to monitor velocity'], containment:['Block compromised BIN range at auth layer','Issue replacement cards to affected cardholders','Coordinate with network fraud desk'], recovery:['File chargebacks for confirmed fraud transactions','Submit fraud dispute batch through Covalence Multi','Pursue cross-institutional recovery via Duo if applicable'] },
          account_takeover:  { immediate:['Lock affected accounts pending re-authentication','Alert cardholder via registered contact','Engage identity verification for re-access'], containment:['Reset credentials and MFA on all compromised accounts','Audit recent transactions for unauthorized activity','Flag associated devices/IPs in fraud rules'], recovery:['Initiate provisional credits for unauthorized transactions','File representments for all confirmed ATO-linked disputes','Document for SAR filing if threshold met'] },
          social_engineering:{ immediate:['Brief front-line staff on active social engineering pattern','Issue internal alert with attack vector description','Escalate to compliance if customer funds were transferred'], containment:['Freeze any accounts involved in mule activity','Alert receiving institutions via Duo coordination','Enhance verification on affected account types'], recovery:['Pursue wire recall if transfer is recent','File SARs on mule accounts','Coordinate with LEA if losses exceed reporting threshold'] },
          merchant_breach:   { immediate:['Identify full cardholder population at risk from breach','Alert affected cardholders with reissuance guidance','Report to network via compromise management program'], containment:['Reissue compromised cards — prioritize high-balance accounts','Enhance monitoring on exposed PANs','File CAMS report with card networks'], recovery:['Track dispute rate on compromised cards for 90 days','File chargebacks for confirmed fraud from breach window','Recover from merchant or acquirer where applicable'] },
        }
        const getSteps = (type) => PLAYBOOK_STEPS[type] || { immediate:['Assess scope and affected accounts','Alert relevant teams','Engage BSA Officer for SAR review'], containment:['Isolate affected accounts or channels','Enhance transaction monitoring'], recovery:['File chargebacks for confirmed losses','Document for regulatory reporting'] }
        const generatePlaybookText = (inc) => {
          const steps = getSteps(inc.type)
          const sd    = structuredDebriefs[inc.id]||{}
          const notes = (strategyNotes[inc.id]||[]).map(n=>n.text).join('\n')
          const incCasesP = allOutcomesS.filter(c=>(inc.linkedCaseIds||[]).includes(c.id))
          const exposureP = incCasesP.reduce((s,c)=>s+(parseFloat(c.amount)||0),0)
          return 'TRIO RESPONSE PLAYBOOK\n======================================================\nFRAUD TYPE:      '+(inc.type||'UNKNOWN').replace(/_/g,' ').toUpperCase()+'\nSEVERITY:        '+(inc.severity||'--')+'\nSOURCE INCIDENT: '+inc.name+'  ('+inc.id+')\nGENERATED:       '+new Date().toLocaleString()+'\n\nTRIGGER SIGNALS\n------------------------------------------------------\n'+(sd.detection?'• Detection: '+sd.detection:'• (Complete structured debrief to populate)')+(sd.firstFailure?'\n• First failure: '+sd.firstFailure:'')+'\n\nIMMEDIATE ACTIONS (first 2 hours)\n------------------------------------------------------\n'+steps.immediate.map((s,i)=>(i+1)+'. '+s).join('\n')+'\n\nESCALATION PATH\n------------------------------------------------------\n1. Fraud Operations Lead — immediate\n2. BSA/AML Officer — SAR assessment within 24h\n3. Risk Committee — if exposure exceeds $'+sarThresholdV.toLocaleString()+'\n4. Legal/Compliance — if LEA referral required\n\nCONTAINMENT STEPS\n------------------------------------------------------\n'+steps.containment.map((s,i)=>(i+1)+'. '+s).join('\n')+(sd.slowedContainment?'\n\nNote — what slowed containment last time:\n'+sd.slowedContainment:'')+'\n\nRECOVERY STEPS\n------------------------------------------------------\n'+steps.recovery.map((s,i)=>(i+1)+'. '+s).join('\n')+'\n\nREGULATORY CHECKLIST\n------------------------------------------------------\n[ ] SAR/STR if cumulative exposure >= $'+sarThresholdV.toLocaleString()+'\n[ ] SAR filing deadline: 30 days from detection date\n[ ] Document all SAR decisions with rationale\n[ ] LEA referral if losses exceed institution threshold\n[ ] Network compromise report if card data involved\n'+(exposureP>0?'\nSource incident exposure: $'+Math.round(exposureP).toLocaleString()+' across '+incCasesP.length+' cases\n':'')+'\nWHAT WORKED\n------------------------------------------------------\n'+(sd.whatWorked||'(Complete structured debrief to populate)')+'\n\nRECOMMENDED CONTROL CHANGES\n------------------------------------------------------\n'+(sd.controlChange||'(Complete structured debrief to populate)')+'\n\nSTRATEGIC OBSERVATIONS\n------------------------------------------------------\n'+(notes||'(No annotations recorded)')+'\n\n======================================================\nCOVALENCE · TRIO RISK INTELLIGENCE · CONFIDENTIAL'
        }
        const savePlaybook = (inc) => {
          const pb = { id: crypto.randomUUID(), incidentId: inc.id, incidentName: inc.name, type: inc.type, createdAt: new Date().toISOString(), text: generatePlaybookText(inc) }
          const updated = [pb, ...playbooks]
          setPlaybooks(updated)
          try { localStorage.setItem('cov_trio_playbooks', JSON.stringify(updated)) } catch {}
          setShowPlaybooks(true)
        }
        const DEBRIEF_QUESTIONS = [
          { key:'detection',         label:'HOW WAS THIS DETECTED?',              ph:'e.g. Customer complaint spike, velocity alert, partner notification...' },
          { key:'firstFailure',      label:'WHAT WAS THE FIRST CONTROL FAILURE?', ph:'e.g. Velocity threshold too high, no cross-channel monitoring...' },
          { key:'slowedContainment', label:'WHAT SLOWED CONTAINMENT?',            ph:'e.g. Approval chains, system access limits, coordination delays...' },
          { key:'whatWorked',        label:'WHAT WORKED WELL?',                   ph:'e.g. War room speed, early cardholder notification, network liaison...' },
          { key:'controlChange',     label:'RECOMMENDED CONTROL CHANGE',          ph:'e.g. Lower BIN velocity threshold, add cross-channel linking rule...' },
        ]

        return (
          <div>
            {/* ── Strategy header ── */}
            <div className="mb-6 px-4 py-3" style={{ background:'#1A1814', border:'1px solid #44403C' }}>
              <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#78716C' }}>TRIO — STRATEGY MODE</div>
              <div className="display-font" style={{ color:'#D4CCBC', fontSize:'13px' }}>Post directives · Aggregate risk exposure · Debrief closed incidents · Build response playbooks</div>
            </div>

            {/* ── Strategy directives — broadcast to all analysts ── */}
            <div className="mb-6">
              <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#78716C', borderBottom:'1px solid #2D2922', paddingBottom:'8px' }}>◈ STRATEGY DIRECTIVES</div>
              <div className="mono-font text-[10px] mb-3" style={{ color:'#57534E' }}>Directives are visible to all analysts in the operational view. Use them to broadcast priorities, containment instructions, or escalation decisions.</div>
              <textarea
                value={globalNoteDraft}
                onChange={e => setGlobalNoteDraft(e.target.value)}
                placeholder="e.g. — Pause all P2P approvals over $500 pending further review. Escalate any new linked accounts immediately to BSA. All analysts: prioritise linked cases COV-XXXXX through COV-XXXXX."
                rows={4}
                style={{ width:'100%', background:'#1E1C18', border:'1px solid #44403C', color:'#E7E4DF', padding:'12px', fontFamily:'monospace', fontSize:'11px', resize:'vertical', marginBottom:'8px', boxSizing:'border-box' }}
              />
              <button onClick={() => { if(globalNoteDraft.trim()) saveGlobalNote(globalNoteDraft.trim()) }}
                disabled={!globalNoteDraft.trim()}
                className="mono-font text-[10px] tracking-widest px-5 py-2.5"
                style={{ background: globalNoteDraft.trim()?'#D4CCBC':'transparent', color: globalNoteDraft.trim()?'#1A1814':'#3D3A35', border:'1px solid #3D3A35', cursor: globalNoteDraft.trim()?'pointer':'default' }}>
                ◈ POST DIRECTIVE TO ANALYSTS
              </button>
              {globalNotes.length > 0 && (
                <div className="mt-4" style={{ maxHeight:'200px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'6px' }}>
                  {globalNotes.map((n,idx) => (
                    <div key={n.id||idx} style={{ padding:'10px 14px', background:'#1E1C18', borderLeft:'3px solid #78716C', display:'flex', gap:'12px', alignItems:'flex-start' }}>
                      <div style={{ flex:1 }}>
                        <div className="mono-font text-[10px] mb-1" style={{ color:'#57534E' }}>{n.author} · {new Date(n.ts).toLocaleString()}</div>
                        <div className="display-font" style={{ fontSize:'13px', color:'#C8C2B8', lineHeight:1.55 }}>{n.text}</div>
                      </div>
                      <button onClick={() => { const updated = globalNotes.filter((_,i)=>i!==idx); setGlobalNotes(updated); try{localStorage.setItem('cov_strategy_global_notes',JSON.stringify(updated))}catch{} }}
                        style={{ background:'transparent', border:'none', color:'#3D3A35', cursor:'pointer', fontSize:'11px', flexShrink:0, padding:'2px' }}
                        onMouseEnter={e=>e.currentTarget.style.color='#EF4444'}
                        onMouseLeave={e=>e.currentTarget.style.color='#3D3A35'}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Pattern layer ── */}
            <div className="mb-6">
              <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#78716C', borderBottom:'1px solid #2D2922', paddingBottom:'8px' }}>◈ PATTERN LAYER — ALL INCIDENTS</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:'1px', background:'#2D2922', marginBottom:'20px' }}>
                {[
                  ['TOTAL INCIDENTS', allIncs.length,    null],
                  ['ACTIVE',          openCount,         '#991B1B'],
                  ['CONTAINED',       contCount,         '#92400E'],
                  ['CLOSED',          closeCount,        '#57534E'],
                  ['LINKED CASES',    totalCases,        null],
                  ['TOTAL EXPOSURE',  totalExposure>0?'$'+Math.round(totalExposure).toLocaleString():'—', totalExposure>0?'#D97706':null],
                  ['SAR FLAGS',       sarHits,           sarHits>0?'#991B1B':null],
                ].map(([label,val,col]) => (
                  <div key={label} style={{ background:'#1E1C18', padding:'14px' }}>
                    <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#57534E' }}>{label}</div>
                    <div className="mono-font font-bold" style={{ fontSize:'20px', color: col||'#D4CCBC' }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* 12-month timeline */}
              <div style={{ background:'#1E1C18', border:'1px solid #2D2922', padding:'16px', marginBottom:'16px' }}>
                <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#57534E' }}>INCIDENT FREQUENCY — LAST 12 MONTHS</div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:'4px', height:'56px', borderBottom:'1px solid #2D2922' }}>
                  {incTimeline.map(m => (
                    <div key={m.key} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', height:'100%', justifyContent:'flex-end' }}>
                      {m.count>0 && <div style={{ width:'100%', background:'#7F1D1D', height:(m.count/maxInc*48)+'px', minHeight:'4px' }}/>}
                      <div className="mono-font" style={{ fontSize:'10px', color:'#3D3A35', marginTop:'2px' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                {allIncs.length===0 && <div className="mono-font text-[10px] mt-2" style={{ color:'#3D3A35' }}>No incidents recorded yet.</div>}
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', flexWrap:'wrap' }}>
                {/* Incident types */}
                <div style={{ background:'#1E1C18', border:'1px solid #2D2922', padding:'16px' }}>
                  <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#57534E' }}>INCIDENT TYPES</div>
                  {topTypes.length ? topTypes.map(([type,count]) => (
                    <div key={type} className="flex items-center justify-between mb-2">
                      <div className="mono-font text-[10px]" style={{ color:'#A8A29E' }}>{type.replace(/_/g,' ').toUpperCase()}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <div style={{ width:`${Math.round((count/allIncs.length)*80)}px`, height:'4px', background:'#D4CCBC', minWidth:'4px' }}/>
                        <div className="mono-font text-[10px]" style={{ color:'#D4CCBC' }}>{count}</div>
                      </div>
                    </div>
                  )) : <div className="mono-font text-[10px]" style={{ color:'#57534E' }}>No incidents yet.</div>}
                </div>

                {/* Repeat FIs */}
                <div style={{ background:'#1E1C18', border:'1px solid #2D2922', padding:'16px' }}>
                  <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#57534E' }}>REPEAT INSTITUTIONS</div>
                  {topFis.length ? topFis.map(([fi,count]) => (
                    <div key={fi} className="flex items-center justify-between mb-2">
                      <div className="mono-font text-[10px]" style={{ color:'#A8A29E' }}>{fi}</div>
                      <div className="mono-font text-[10px] font-bold" style={{ color: count>1?'#F59E0B':'#78716C' }}>{count}×</div>
                    </div>
                  )) : <div className="mono-font text-[10px]" style={{ color:'#57534E' }}>No cross-incident FI data.</div>}
                </div>
              </div>
            </div>

            {/* ── SAR Aggregation ── */}
            <div className="mb-6">
              <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#78716C', borderBottom:'1px solid #2D2922', paddingBottom:'8px' }}>◈ SAR AGGREGATION — REGULATORY EXPOSURE BY INCIDENT</div>
              {incidentSAR.length === 0 ? (
                <div className="mono-font text-[10px]" style={{ color:'#3D3A35' }}>No incidents recorded. SAR assessment populates as incidents are created and cases linked.</div>
              ) : (
                <>
                  <div style={{ border:'1px solid #2D2922' }}>
                    <div className="flex items-center gap-3 px-4 py-2" style={{ borderBottom:'1px solid #2D2922', background:'#141210' }}>
                      <span className="mono-font text-[10px] tracking-widest flex-1" style={{ color:'#3D3A35' }}>INCIDENT</span>
                      <span className="mono-font text-[10px] tracking-widest w-14 text-right shrink-0" style={{ color:'#3D3A35' }}>CASES</span>
                      <span className="mono-font text-[10px] tracking-widest w-24 text-right shrink-0" style={{ color:'#3D3A35' }}>EXPOSURE</span>
                      <span className="mono-font text-[10px] tracking-widest w-20 text-right shrink-0" style={{ color:'#3D3A35' }}>SAR</span>
                    </div>
                    {incidentSAR.map((inc,i) => (
                      <div key={inc.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop:i>0?'1px solid #2D2922':'none', background:'#1A1814' }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="mono-font text-[10px] mb-0.5" style={{ color:'#57534E' }}>{inc.id} · {(inc.status||'active').toUpperCase()}</div>
                          <div className="display-font truncate" style={{ fontSize:'12px', color:'#D4CCBC' }}>{inc.name}</div>
                        </div>
                        <div className="mono-font text-[10px] w-14 text-right shrink-0" style={{ color:'#78716C' }}>{inc.linkedCount}</div>
                        <div className="mono-font text-[10px] w-24 text-right shrink-0 font-bold" style={{ color:inc.sarTriggered?'#F59E0B':'#57534E' }}>
                          {inc.exposure>0?'$'+Math.round(inc.exposure).toLocaleString():'—'}
                        </div>
                        <div className="w-20 text-right shrink-0">
                          <span className="mono-font text-[10px] px-2 py-0.5" style={{ background:inc.sarTriggered?'#7F1D1D':'#1E2A3A', color:inc.sarTriggered?'#FEE2E2':'#93C5FD' }}>
                            {inc.sarTriggered?'REVIEW':'BELOW'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mono-font text-[10px] mt-2" style={{ color:'#3D3A35' }}>
                    SAR threshold: ${sarThresholdV.toLocaleString()} (configurable in Settings) · {sarHits} incident{sarHits!==1?'s':''} at or above threshold
                  </div>
                </>
              )}
            </div>

            {/* ── Post-incident debrief ── */}
            <div className="mb-6">
              <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#78716C', borderBottom:'1px solid #2D2922', paddingBottom:'8px' }}>◈ POST-INCIDENT DEBRIEF</div>
              {closed.length === 0 ? (
                <div className="mono-font text-[10px]" style={{ color:'#57534E' }}>No closed incidents yet. Close an incident in operational mode to begin debrief.</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {closed.map(i => {
                    const sdI = structuredDebriefs[i.id]||{}
                    const completedFields = DEBRIEF_QUESTIONS.filter(q=>sdI[q.key]?.trim()).length
                    return (
                      <button key={i.id} onClick={() => setStrategyIncId(strategyIncId===i.id ? null : i.id)}
                        className="w-full text-left px-4 py-3"
                        style={{ background: strategyIncId===i.id?'#252320':'#1E1C18', border:`1px solid ${strategyIncId===i.id?'#78716C':'#2D2922'}`, cursor:'pointer' }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="mono-font text-[10px] mb-0.5" style={{ color:'#57534E' }}>{i.id} · CLOSED</div>
                            <div className="display-font" style={{ color:'#E7E4DF', fontSize:'13px' }}>{i.name}</div>
                          </div>
                          <div className="mono-font text-[10px] text-right" style={{ color:'#57534E' }}>
                            <div>{completedFields}/5 debrief · {(strategyNotes[i.id]||[]).length} notes</div>
                            <div>{strategyIncId===i.id?'▲':'▼'}</div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Debrief panel */}
              {debriefInc && (() => {
                const sdD = structuredDebriefs[debriefInc.id]||{}
                const updateSD = (key, val) => {
                  const updated = { ...structuredDebriefs, [debriefInc.id]: { ...(structuredDebriefs[debriefInc.id]||{}), [key]:val } }
                  setStructuredDebriefs(updated)
                  try { localStorage.setItem('cov_trio_debriefs', JSON.stringify(updated)) } catch {}
                }
                const incCasesD = allOutcomesS.filter(c=>(debriefInc.linkedCaseIds||[]).includes(c.id))
                const exposureD = incCasesD.reduce((s,c)=>s+(parseFloat(c.amount)||0),0)
                return (
                  <div style={{ background:'#1A1814', border:'1px solid #44403C', padding:'20px' }}>
                    <div className="mono-font text-[10px] tracking-widest mb-4" style={{ color:'#78716C' }}>DEBRIEF — {debriefInc.name.toUpperCase()}</div>

                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:'10px', marginBottom:'20px' }}>
                      {[['TYPE',(debriefInc.type||'—').replace(/_/g,' ').toUpperCase()],['SEVERITY',debriefInc.severity||'—'],['DETECTED',debriefInc.detectionDate||'—'],['CASES',(debriefInc.linkedCaseIds||[]).length],['AGENTS',(debriefInc.participants||[]).length],['EXPOSURE',exposureD>0?'$'+Math.round(exposureD).toLocaleString():'—']].map(([k,v])=>(
                        <div key={k}>
                          <div className="mono-font text-[10px] tracking-widest mb-0.5" style={{ color:'#57534E' }}>{k}</div>
                          <div className="mono-font text-[10px]" style={{ color:'#D4CCBC' }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Structured debrief questions */}
                    <div className="mb-5">
                      <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#57534E', borderBottom:'1px solid #2D2922', paddingBottom:'6px' }}>STRUCTURED DEBRIEF</div>
                      <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                        {DEBRIEF_QUESTIONS.map(q => (
                          <div key={q.key}>
                            <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#78716C' }}>{q.label}</div>
                            <textarea value={sdD[q.key]||''} onChange={e=>updateSD(q.key,e.target.value)} placeholder={q.ph} rows={2}
                              style={{ width:'100%', background:'#252320', border:'1px solid '+(sdD[q.key]?'#78716C':'#3D3A35'), color:'#E7E4DF', padding:'8px 10px', fontFamily:'monospace', fontSize:'11px', resize:'vertical', boxSizing:'border-box' }} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Strategic annotations */}
                    <div className="mb-5">
                      <div className="mono-font text-[10px] tracking-widest mb-2" style={{ color:'#57534E' }}>STRATEGIC ANNOTATIONS</div>
                      {(strategyNotes[debriefInc.id]||[]).length===0&&<div className="mono-font text-[10px] mb-2" style={{ color:'#3D3A35' }}>No annotations yet.</div>}
                      {(strategyNotes[debriefInc.id]||[]).map((n,idx)=>(
                        <div key={idx} className="mb-2 px-3 py-2" style={{ background:'#252320', borderLeft:'2px solid #78716C' }}>
                          <div className="mono-font text-[10px] mb-1" style={{ color:'#57534E' }}>{n.author} · {new Date(n.ts).toLocaleString()}</div>
                          <div className="display-font text-sm" style={{ color:'#D4CCBC' }}>{n.text}</div>
                        </div>
                      ))}
                      <textarea value={strategyDraft} onChange={e=>setStrategyDraft(e.target.value)}
                        placeholder="Add strategic observation — pattern, anomaly, open question..."
                        rows={2} style={{ width:'100%', background:'#252320', border:'1px solid #3D3A35', color:'#E7E4DF', padding:'8px 10px', fontFamily:'monospace', fontSize:'11px', resize:'vertical', marginTop:'6px' }} />
                      <button onClick={()=>{ if(strategyDraft.trim()) saveStrategyNote(debriefInc.id,strategyDraft.trim()) }} disabled={!strategyDraft.trim()}
                        className="mono-font text-[10px] tracking-widest mt-2 px-4 py-2"
                        style={{ background:strategyDraft.trim()?'#D4CCBC':'transparent', color:strategyDraft.trim()?'#1A1814':'#3D3A35', border:'1px solid #3D3A35', cursor:strategyDraft.trim()?'pointer':'default' }}>
                        + ADD ANNOTATION
                      </button>
                    </div>

                    {/* Actions row */}
                    <div style={{ borderTop:'1px solid #2D2922', paddingTop:'16px', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                      <button onClick={()=>{ navigator.clipboard.writeText(generateThreatBrief(debriefInc)); setBriefCopied(true); setTimeout(()=>setBriefCopied(false),2500) }}
                        className="mono-font text-[10px] tracking-widest px-4 py-2.5"
                        style={{ background:'#1A1814', border:'1px solid #78716C', color:'#D4CCBC', cursor:'pointer' }}>
                        {briefCopied?'✓ COPIED':'◈ COPY THREAT BRIEF'}
                      </button>
                      <button onClick={()=>{ const txt=generateThreatBrief(debriefInc); const a=document.createElement('a'); a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(txt); a.download='TRIO-BRIEF-'+debriefInc.id+'-'+new Date().toISOString().split('T')[0]+'.txt'; a.click() }}
                        className="mono-font text-[10px] tracking-widest px-4 py-2.5"
                        style={{ background:'transparent', border:'1px solid #57534E', color:'#78716C', cursor:'pointer' }}>
                        ↓ THREAT BRIEF .TXT
                      </button>
                      <button onClick={()=>savePlaybook(debriefInc)}
                        className="mono-font text-[10px] tracking-widest px-4 py-2.5"
                        style={{ background:'#7F1D1D', border:'none', color:'#FEE2E2', cursor:'pointer' }}>
                        ◈ BUILD RESPONSE PLAYBOOK
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* ── Playbook Library ── */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3" style={{ borderBottom:'1px solid #2D2922', paddingBottom:'8px' }}>
                <div className="mono-font text-[10px] tracking-widest" style={{ color:'#78716C' }}>◈ RESPONSE PLAYBOOK LIBRARY ({playbooks.length})</div>
                {playbooks.length>0&&<button onClick={()=>setShowPlaybooks(p=>!p)} className="mono-font text-[10px]" style={{ background:'transparent', border:'none', color:'#57534E', cursor:'pointer' }}>{showPlaybooks?'▲ COLLAPSE':'▼ EXPAND'}</button>}
              </div>
              {playbooks.length===0 ? (
                <div className="mono-font text-[10px]" style={{ color:'#3D3A35' }}>No playbooks yet. Complete a debrief and click "Build Response Playbook" to create the first one.</div>
              ) : showPlaybooks && (
                <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                  {playbooks.map((pb,i)=>(
                    <div key={pb.id||i} style={{ background:'#1E1C18', border:'1px solid #2D2922', padding:'14px', display:'flex', alignItems:'center', gap:'12px' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="mono-font text-[10px] mb-0.5" style={{ color:'#57534E' }}>{(pb.type||'').replace(/_/g,' ').toUpperCase()} · {new Date(pb.createdAt).toLocaleDateString()}</div>
                        <div className="display-font truncate" style={{ color:'#E7E4DF', fontSize:'13px' }}>{pb.incidentName}</div>
                      </div>
                      <button onClick={()=>{ const a=document.createElement('a'); a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(pb.text); a.download='TRIO-PLAYBOOK-'+(pb.incidentName||'').replace(/\s+/g,'-').toUpperCase()+'-'+new Date(pb.createdAt).toISOString().split('T')[0]+'.txt'; a.click() }}
                        className="mono-font text-[10px] tracking-widest px-3 py-1.5 shrink-0"
                        style={{ background:'transparent', border:'1px solid #57534E', color:'#78716C', cursor:'pointer' }}>
                        ↓ DOWNLOAD
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Cross-tool intelligence ── */}
            <div className="mb-6">
              <div className="mono-font text-[10px] tracking-widest mb-3" style={{ color:'#78716C', borderBottom:'1px solid #2D2922', paddingBottom:'8px' }}>◈ CROSS-TOOL CASE INTELLIGENCE</div>
              <div className="mono-font text-[10px] mb-4" style={{ color:'#57534E' }}>All cases across Triage, Desk, Multi and File — visible to the strategist in read mode.</div>

              {/* Filter bar */}
              <div style={{ display:'flex', gap:'2px', marginBottom:'12px', flexWrap:'wrap' }}>
                {[['all','ALL'],['triage','TRIAGE ONLY'],['fraud','FRAUD'],['service','SERVICE'],['open','OPEN'],['won','WON'],['lost','LOST']].map(([val,lbl]) => (
                  <button key={val} onClick={() => setCaseFilter(val)}
                    className="mono-font"
                    style={{ fontSize:'10px', letterSpacing:'0.14em', padding:'5px 12px', border:'1px solid', cursor:'pointer', transition:'all 0.12s',
                      background: caseFilter===val ? (val==='triage'?'#2D1B4E':'#D4CCBC') : 'transparent',
                      color:      caseFilter===val ? (val==='triage'?'#C4B5FD':'#1A1814')  : '#57534E',
                      borderColor:caseFilter===val ? (val==='triage'?'#6D28D9':'#D4CCBC')  : '#2D2922' }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Case rows */}
              {(() => {
                const filtered = allCases.filter(c => {
                  if (caseFilter === 'triage')  return c._source === 'TRIAGE'
                  if (caseFilter === 'fraud')   return c.category === 'fraud' || c.category === 'mc_fraud' || c.verdict === 'TRUE_FRAUD'
                  if (caseFilter === 'service') return c.category !== 'fraud' && c.category !== 'mc_fraud' && c.verdict !== 'TRUE_FRAUD'
                  if (caseFilter === 'open')    return !['won','lost','withdrawn'].includes(c.status)
                  if (caseFilter === 'won')     return c.status === 'won'
                  if (caseFilter === 'lost')    return c.status === 'lost'
                  return true
                })
                if (filtered.length === 0) return (
                  <div className="mono-font text-[10px] py-6 text-center" style={{ color:'#3D3A35', border:'1px solid #2D2922' }}>No cases match this filter.</div>
                )
                return (
                  <div style={{ border:'1px solid #2D2922', maxHeight:'320px', overflowY:'auto' }}>
                    {filtered.slice(0,50).map((c,i) => (
                      <div key={c.id||i} style={{ display:'flex', gap:'12px', alignItems:'center', padding:'10px 14px', borderTop: i>0?'1px solid #2D2922':'none', background:'#1A1814' }}>
                        <div className="mono-font" style={{ fontSize:'10px', padding:'2px 6px', flexShrink:0, background: c._source==='TRIAGE'?'#2D1B4E':'#1E2A3A', color: c._source==='TRIAGE'?'#C4B5FD':'#93C5FD', letterSpacing:'0.1em' }}>
                          {c._source||'DESK'}
                        </div>
                        <div className="mono-font" style={{ fontSize:'10px', color:'#57534E', flexShrink:0, width:'88px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.id||'—'}</div>
                        <div className="display-font" style={{ fontSize:'12px', color:'#D4CCBC', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.merchant||c.description||'—'}</div>
                        <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E', flexShrink:0 }}>{c.amount||'—'}</div>
                        <div className="mono-font" style={{ fontSize:'10px', padding:'2px 7px', flexShrink:0,
                          background: c.status==='won'?'#064E3B':c.status==='lost'?'#7F1D1D':c.status==='triaged'||c.status==='DESK'?'#3D2A00':c.status==='pending'?'#292524':'#1E3A5F',
                          color: c.status==='won'?'#D1FAE5':c.status==='lost'?'#FEE2E2':c.status==='triaged'||c.status==='DESK'?'#FCD34D':'#CBD5E1' }}>
                          {(c.status||'unknown').toUpperCase()}
                        </div>
                        <div className="mono-font" style={{ fontSize:'10px', color:'#57534E', flexShrink:0, minWidth:'54px', textAlign:'right' }}>
                          {c.date ? new Date(c.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}
                        </div>
                      </div>
                    ))}
                    {filtered.length > 50 && (
                      <div className="mono-font text-center py-2" style={{ fontSize:'10px', color:'#57534E', borderTop:'1px solid #2D2922' }}>+ {filtered.length-50} more — apply a filter to narrow</div>
                    )}
                  </div>
                )
              })()}
            </div>


          </div>
        )
      })()}

      {/* ── Operational mode ── */}
      {!strategyMode && <div style={{ display:'flex', gap:'24px', flexWrap:'wrap', alignItems:'flex-start' }}>

        {/* ── Incident list ── */}
        <div style={{ flex:'0 0 min(280px, 100%)', minWidth:0, maxWidth:'100%' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="mono-font text-[10px] tracking-widest text-stone-500">INCIDENTS ({incidents.length})</div>
            <button onClick={() => setShowCreate(true)}
              className="mono-font text-[10px] tracking-widest px-3 py-1.5 transition-colors"
              style={{ background:'#7F1D1D', color:'#FEF2F2', border:'none', cursor:'pointer' }}>
              + NEW INCIDENT
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="border border-red-200 p-4 mb-4" style={{ background:'#FEF2F2' }}>
              <div className="mono-font text-[10px] tracking-widest text-red-800 mb-3">NEW INCIDENT</div>
              <div className="space-y-3">
                <div>
                  <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">INCIDENT NAME *</label>
                  <input className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[11px]" style={{ background:'#FAF7F1' }}
                    value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                    placeholder="e.g. Skip the Dishes BIN Attack Oct 2026" />
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns:'1fr 1fr' }}>
                  <div>
                    <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">TYPE</label>
                    <select className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'#FAF7F1' }}
                      value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                      {Object.entries(TYPE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">SEVERITY</label>
                    <select className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'#FAF7F1' }}
                      value={form.severity} onChange={e => setForm(f => ({...f, severity: e.target.value}))}>
                      {['LOW','MEDIUM','HIGH','CRITICAL'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">DETECTION DATE</label>
                  <input type="date" className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[11px]" style={{ background:'#FAF7F1' }}
                    value={form.detectionDate} onChange={e => setForm(f => ({...f, detectionDate: e.target.value}))} />
                </div>
                <div>
                  <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">AFFECTED PRODUCT / CHANNEL</label>
                  <input className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[11px]" style={{ background:'#FAF7F1' }}
                    value={form.affectedProduct} onChange={e => setForm(f => ({...f, affectedProduct: e.target.value}))}
                    placeholder="e.g. Visa debit, P2P / Skip" />
                </div>
                <div>
                  <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">INITIAL SUMMARY</label>
                  <textarea rows={2} className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[11px] resize-none" style={{ background:'#FAF7F1' }}
                    value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
                    placeholder="What happened, how it was detected..." />
                </div>
                <div className="flex gap-2">
                  <button onClick={createIncident} disabled={!form.name.trim()}
                    className="mono-font text-[10px] tracking-widest px-4 py-1.5 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
                    style={{ background: form.name.trim() ? '#7F1D1D' : undefined, color: form.name.trim() ? '#FEF2F2' : undefined, border:'none', cursor: form.name.trim() ? 'pointer' : undefined }}>
                    OPEN INCIDENT
                  </button>
                  <button onClick={() => setShowCreate(false)}
                    className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-stone-300 text-stone-500 hover:bg-stone-100 transition-colors">
                    CANCEL
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Incident list */}
          {incidents.length === 0 && !showCreate && (
            <div className="px-4 py-8 text-center border border-dashed border-stone-300" style={{ background:'#FAF7F1' }}>
              <div className="mono-font text-[10px] text-stone-400 tracking-widest mb-2">NO INCIDENTS</div>
              <p className="display-font text-stone-400 text-[12px]">Open an incident when a fraud wave is detected.</p>
            </div>
          )}

          <div className="space-y-2">
            {incidents.map(inc => (
              <button key={inc.id} onClick={() => joinIncident(inc.id)}
                className="w-full text-left px-3 py-3 border transition-colors"
                style={{ background: activeId === inc.id ? '#1A1814' : '#FAF7F1', borderColor: activeId === inc.id ? '#1A1814' : '#D4CCBC' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="mono-font text-[10px]" style={{ color: activeId === inc.id ? '#A8A29E' : '#78716C' }}>{inc.id}</span>
                  <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold"
                    style={{ background: SEV_BG[inc.severity], color: SEV_COLORS[inc.severity] }}>{inc.severity}</span>
                </div>
                <div className="display-font text-sm font-semibold leading-tight" style={{ color: activeId === inc.id ? '#F5F1EA' : '#1A1814' }}>{inc.name}</div>
                <div className="mono-font text-[10px] mt-1" style={{ color: activeId === inc.id ? '#78716C' : '#A8A29E' }}>
                  {TYPE_LABELS[inc.type]||inc.type} · {(inc.linkedCaseIds||[]).length} cases
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="mono-font text-[10px] font-bold" style={{ color: STATUS_COLORS[inc.status]||'#78716C' }}>
                    ● {(inc.status||'active').toUpperCase()}
                  </span>
                  <span className="mono-font text-[10px]" style={{ color: activeId === inc.id ? '#78716C' : '#A8A29E' }}>{elapsedLabel(inc.detectionDate)}</span>
                  {(inc.participants||[]).length > 0 && (
                    <span className="mono-font text-[10px]" style={{ color: activeId === inc.id ? '#78716C' : '#A8A29E' }}>
                      · 👤 {(inc.participants||[]).length}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Active incident detail ── */}
        {activeIncident && (
          <div style={{ display:'flex', gap:'16px', alignItems:'flex-start', flexWrap:'wrap' }}>

          {/* ── Left: operational panels ── */}
          <div className="space-y-5" style={{ flex:'1 1 min(100%, 580px)', minWidth:0 }}>

            {/* Header */}
            <div className="px-5 py-4 border" style={{ background:'#1A1814', borderColor:'#1A1814' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">{activeIncident.id} · {TYPE_LABELS[activeIncident.type]||activeIncident.type}</div>
                  <div className="display-font font-bold text-stone-50" style={{ fontSize:'clamp(18px,2.5vw,26px)', letterSpacing:'-0.01em' }}>{activeIncident.name}</div>
                  {activeIncident.affectedProduct && (
                    <div className="mono-font text-[10px] text-stone-400 mt-1">PRODUCT / CHANNEL: {activeIncident.affectedProduct}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="mono-font text-[10px] px-2 py-1 font-bold"
                    style={{ background: SEV_BG[activeIncident.severity], color: SEV_COLORS[activeIncident.severity] }}>{activeIncident.severity}</span>
                  <select value={activeIncident.status}
                    onChange={e => updateIncident(activeIncident.id, { status: e.target.value })}
                    className="mono-font text-[10px] px-2 py-1 border-none font-bold tracking-widest cursor-pointer"
                    style={{ background: activeIncident.status==='active'?'#7F1D1D':activeIncident.status==='contained'?'#78350F':'#374151', color:'#F5F1EA' }}>
                    <option value="active">● ACTIVE</option>
                    <option value="contained">◐ CONTAINED</option>
                    <option value="closed">○ CLOSED</option>
                  </select>
                  {activeIncident.status !== 'closed' && (
                    <button
                      onClick={() => { if (window.confirm(`Close incident "${activeIncident.name}"? This moves it to debrief in Strategy Mode.`)) updateIncident(activeIncident.id, { status:'closed', closedAt: new Date().toISOString() }) }}
                      className="mono-font text-[10px] px-3 py-1 tracking-widest transition-colors"
                      style={{ background:'transparent', color:'#9CA3AF', border:'1px solid #374151', cursor:'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background='#374151'; e.currentTarget.style.color='#F5F1EA' }}
                      onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#9CA3AF' }}>
                      ○ CLOSE INCIDENT
                    </button>
                  )}
                  {activeIncident.status === 'closed' && (
                    <button
                      onClick={() => updateIncident(activeIncident.id, { status:'active', closedAt: null })}
                      className="mono-font text-[10px] px-3 py-1 tracking-widest"
                      style={{ background:'transparent', color:'#6EE7B7', border:'1px solid #065F46', cursor:'pointer' }}>
                      ↺ REOPEN
                    </button>
                  )}
                  {incidents.length > 1 && (
                    <button onClick={() => setMergeModal(activeIncident.id)}
                      className="mono-font text-[10px] px-2 py-1 tracking-widest"
                      style={{ background:'#292524', color:'#A8A29E', border:'1px solid #44403C' }}>
                      ⇄ MERGE
                    </button>
                  )}
                </div>
              </div>
              {activeIncident.description && (
                <p className="display-font text-stone-400 text-[13px] mt-3 leading-snug">{activeIncident.description}</p>
              )}
              <div className="mono-font text-[10px] text-stone-600 mt-3">
                DETECTED {activeIncident.detectionDate} · {elapsedLabel(activeIncident.detectionDate)} · {(activeIncident.notes||[]).length} WAR ROOM ENTRIES
              </div>
              {(activeIncident.participants||[]).length > 0 && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="mono-font text-[10px] text-stone-500 tracking-widest">AGENTS IN ROOM:</span>
                  {(activeIncident.participants||[]).map((p,i) => (
                    <span key={i} className="mono-font text-[10px] px-1.5 py-0.5 font-bold"
                      style={{ background: p === agentName ? '#065F46' : '#292524', color: p === agentName ? '#D1FAE5' : '#A8A29E' }}>
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {syncStatus && (
                <div className="mono-font text-[10px] mt-2" style={{ color: syncStatus==='error' ? '#EF4444' : syncStatus==='syncing' ? '#D97706' : '#6EE7B7' }}>
                  {syncStatus==='syncing' ? '↻ SYNCING...' : syncStatus==='error' ? '✗ SYNC ERROR' : '✓ LIVE'}
                </div>
              )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'LINKED CASES', value: (activeIncident.linkedCaseIds||[]).length },
                { label:'TOTAL EXPOSURE', value: linkedTotal > 0 ? `$${linkedTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : '$0.00' },
                { label:'SAR STATUS', value: sarCrossed ? 'THRESHOLD HIT' : `$${(sarThreshold-linkedTotal).toFixed(0)} TO SAR`, highlight: sarCrossed },
                { label:'CH NOTIFIED', value: `${activeIncident.cardholderNotified||0}${activeIncident.cardholderTotal?` / ${activeIncident.cardholderTotal}`:''}` },
              ].map(s => (
                <div key={s.label} className="px-4 py-3 border border-stone-300" style={{ background: s.highlight ? '#FEF2F2' : '#FAF7F1' }}>
                  <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">{s.label}</div>
                  <div className="mono-font text-base font-bold" style={{ color: s.highlight ? '#991B1B' : '#1A1814' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* SAR progress bar */}
            <div className="border border-stone-300 px-4 py-3" style={{ background: sarCrossed ? '#FEF2F2' : '#FAF7F1' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="mono-font text-[10px] tracking-widest text-stone-500">SAR / STR THRESHOLD TRACKER</div>
                {sarCrossed && <span className="mono-font text-[10px] tracking-widest font-bold text-red-700">⚠ FILING OBLIGATION MET</span>}
              </div>
              <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                <div className="h-2 transition-all" style={{ width: `${(sarProgress*100).toFixed(1)}%`, background: sarCrossed ? '#DC2626' : sarProgress > 0.7 ? '#D97706' : '#059669' }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="mono-font text-[10px] text-stone-500">${linkedTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} linked</span>
                <span className="mono-font text-[10px] text-stone-400">threshold: ${sarThreshold.toLocaleString()}</span>
              </div>
              {sarCrossed && (
                <p className="mono-font text-[10px] text-red-700 mt-2 font-bold">SAR/STR filing is required. Coordinate with your compliance officer before finalizing write-offs on linked cases.</p>
              )}
            </div>

            {/* Linked cases */}
            <div className="border border-stone-300" style={{ background:'#FAF7F1' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                <div className="mono-font text-[10px] tracking-widest text-stone-600">LINKED CASES ({(activeIncident.linkedCaseIds||[]).length})</div>
                <div className="flex items-center gap-2">
                  <input value={linkInput} onChange={e => setLinkInput(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && linkCase()}
                    placeholder="CASE-XXXXXX" className="mono-font text-[10px] border border-stone-300 px-2 py-1"
                    style={{ background:'white', width:'120px' }} />
                  <button onClick={linkCase} className="mono-font text-[10px] tracking-widest px-3 py-1 border border-stone-700 text-stone-700 hover:bg-stone-100 transition-colors whitespace-nowrap">
                    + LINK
                  </button>
                </div>
              </div>
              {linkError && <div className="px-4 py-1 mono-font text-[10px] text-red-600">{linkError}</div>}
              {(activeIncident.linkedCaseIds||[]).length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="mono-font text-[10px] text-stone-400">No cases linked. Enter a case ID from the Dispute Desk tracker.</p>
                </div>
              ) : (
                <div className="divide-y divide-stone-200">
                  {linkedCases.length > 0 && linkedCases.map(c => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                      <span className="mono-font text-[10px] text-stone-500 w-24 shrink-0"><CaseLink id={c.id} /></span>
                      <span className="display-font text-sm text-stone-800 flex-1 truncate">{c.merchant||'—'}</span>
                      <span className="mono-font text-[10px] text-stone-600">{c.amount||'—'}</span>
                      <span className="mono-font text-[10px] px-1.5 py-0.5"
                        style={{ background: c.status==='filed'?'#1C1917':c.status==='queued'?'#4C1D95':c.status==='won'?'#064E3B':c.status==='lost'?'#7F1D1D':'#D6D3CD', color: ['filed','queued','won','lost'].includes(c.status)?'#F5F1EA':'#57534E' }}>
                        {(c.status||'pending').toUpperCase()}
                      </span>
                      <button onClick={() => unlinkCase(c.id)} className="mono-font text-[10px] text-stone-400 hover:text-red-600 transition-colors">✕</button>
                    </div>
                  ))}
                  {/* Show unresolved IDs (cases not yet in tracker) */}
                  {(activeIncident.linkedCaseIds||[]).filter(id => !linkedCases.find(c=>c.id===id)).map(id => (
                    <div key={id} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="mono-font text-[10px] text-stone-400 w-24 shrink-0">{id}</span>
                      <span className="mono-font text-[10px] text-amber-700 italic">not found in local tracker</span>
                      <button onClick={() => unlinkCase(id)} className="mono-font text-[10px] text-stone-400 hover:text-red-600 transition-colors ml-auto">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cardholder notification tracker */}
            <div className="border border-stone-300 px-4 py-4" style={{ background:'#FAF7F1' }}>
              <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-3">CARDHOLDER NOTIFICATION</div>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <label className="mono-font text-[10px] text-stone-400 block mb-1">NOTIFIED</label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateIncident(activeIncident.id, { cardholderNotified: Math.max(0,(activeIncident.cardholderNotified||0)-1) })}
                      className="mono-font text-xs px-2 py-0.5 border border-stone-300 text-stone-500 hover:bg-stone-100">−</button>
                    <span className="mono-font text-lg font-bold text-stone-900 px-3">{activeIncident.cardholderNotified||0}</span>
                    <button onClick={() => updateIncident(activeIncident.id, { cardholderNotified: (activeIncident.cardholderNotified||0)+1 })}
                      className="mono-font text-xs px-2 py-0.5 border border-stone-300 text-stone-500 hover:bg-stone-100">+</button>
                  </div>
                </div>
                <div>
                  <label className="mono-font text-[10px] text-stone-400 block mb-1">TARGET TOTAL</label>
                  <input type="number" min="0"
                    value={activeIncident.cardholderTotal||''}
                    onChange={e => updateIncident(activeIncident.id, { cardholderTotal: parseInt(e.target.value)||0 })}
                    className="mono-font text-base border border-stone-300 px-2 py-1 w-24"
                    style={{ background:'white' }} placeholder="0" />
                </div>
                {(activeIncident.cardholderTotal||0) > 0 && (
                  <div className="flex-1">
                    <div className="mono-font text-[10px] text-stone-400 mb-1">
                      {Math.round((activeIncident.cardholderNotified||0)/(activeIncident.cardholderTotal||1)*100)}% COMPLETE
                    </div>
                    <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                      <div className="h-1.5 bg-blue-600 transition-all"
                        style={{ width: `${Math.min(100, Math.round((activeIncident.cardholderNotified||0)/(activeIncident.cardholderTotal||1)*100))}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Customer / Transaction Flow ─────────────────────────────── */}
            <div className="border border-stone-300 px-4 py-4" style={{ background:'#FAF7F1' }}>
              <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-3">TRANSACTION FLOW — THREE PARTIES</div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Party A — Our cardholder */}
                <div className="flex-1 border border-stone-300 px-3 py-2.5 text-center" style={{ minWidth:'120px', background:'#F0FDF4' }}>
                  <div className="mono-font text-[10px] tracking-widest text-green-700 mb-1">PARTY A · YOUR FI</div>
                  <input
                    value={activeIncident.flowSender || ''}
                    onChange={e => updateIncident(activeIncident.id, { flowSender: e.target.value })}
                    placeholder="e.g. Our cardholder"
                    className="w-full text-center mono-font text-[10px] border-none focus:outline-none bg-transparent text-stone-800"
                  />
                </div>
                <div className="mono-font text-stone-400 text-sm px-1">→</div>
                {/* Party B — Platform / Receiving FI */}
                <div className="flex-1 border border-stone-300 px-3 py-2.5 text-center" style={{ minWidth:'120px', background:'#FEF3C7' }}>
                  <div className="mono-font text-[10px] tracking-widest text-amber-700 mb-1">PARTY B · PLATFORM / RECEIVING FI</div>
                  <input
                    value={activeIncident.flowPlatform || ''}
                    onChange={e => updateIncident(activeIncident.id, { flowPlatform: e.target.value })}
                    placeholder="e.g. Skip the Dishes"
                    className="w-full text-center mono-font text-[10px] border-none focus:outline-none bg-transparent text-stone-800"
                  />
                </div>
                <div className="mono-font text-stone-400 text-sm px-1">→</div>
                {/* Party C — Fraudster / recipient account */}
                <div className="flex-1 border border-stone-300 px-3 py-2.5 text-center" style={{ minWidth:'120px', background:'#FEF2F2' }}>
                  <div className="mono-font text-[10px] tracking-widest text-red-700 mb-1">PARTY C · RECEIVING ACCOUNT</div>
                  <input
                    value={activeIncident.flowReceiver || ''}
                    onChange={e => updateIncident(activeIncident.id, { flowReceiver: e.target.value })}
                    placeholder="e.g. Fraudster's account"
                    className="w-full text-center mono-font text-[10px] border-none focus:outline-none bg-transparent text-stone-800"
                  />
                </div>
              </div>
              {(activeIncident.flowSender || activeIncident.flowPlatform || activeIncident.flowReceiver) && (
                <p className="mono-font text-[10px] text-stone-400 mt-2">Click any field to edit. This maps the fraud chain for the incident record.</p>
              )}
            </div>

            {/* ── Receiving FI / Platform ───────────────────────────────────── */}
            <div className="border border-stone-300" style={{ background:'#FAF7F1' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                <div className="mono-font text-[10px] tracking-widest text-stone-600">RECEIVING FI / PLATFORM</div>
                <button onClick={() => { setReceivingEdit(!receivingEdit); setReceivingDraft(activeIncident.receivingFi || {}) }}
                  className="mono-font text-[10px] px-2 py-0.5 border border-stone-300 text-stone-500 hover:bg-stone-100 transition-colors">
                  {receivingEdit ? 'CANCEL' : (activeIncident.receivingFi?.name ? 'EDIT' : '+ ADD')}
                </button>
              </div>
              {receivingEdit ? (
                <div className="px-4 py-3 space-y-2">
                  <div className="grid gap-2" style={{ gridTemplateColumns:'1fr 1fr' }}>
                    <div>
                      <label className="mono-font text-[10px] text-stone-400 block mb-1">INSTITUTION / PLATFORM NAME</label>
                      <input className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'white' }}
                        value={receivingDraft.name||''} onChange={e => setReceivingDraft(d => ({...d, name: e.target.value}))} placeholder="e.g. Skip the Dishes" />
                    </div>
                    <div>
                      <label className="mono-font text-[10px] text-stone-400 block mb-1">TYPE</label>
                      <select className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'white' }}
                        value={receivingDraft.type||'platform'} onChange={e => setReceivingDraft(d => ({...d, type: e.target.value}))}>
                        <option value="platform">Platform / Marketplace</option>
                        <option value="bank">Bank / Credit Union</option>
                        <option value="fintech">Fintech / Neobank</option>
                        <option value="exchange">Crypto Exchange</option>
                        <option value="p2p">P2P Network</option>
                        <option value="acquirer">Acquirer / Processor</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="mono-font text-[10px] text-stone-400 block mb-1">CONTACT NAME</label>
                      <input className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'white' }}
                        value={receivingDraft.contactName||''} onChange={e => setReceivingDraft(d => ({...d, contactName: e.target.value}))} placeholder="Fraud / Risk team contact" />
                    </div>
                    <div>
                      <label className="mono-font text-[10px] text-stone-400 block mb-1">CONTACT INFO</label>
                      <input className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'white' }}
                        value={receivingDraft.contactInfo||''} onChange={e => setReceivingDraft(d => ({...d, contactInfo: e.target.value}))} placeholder="Email or phone" />
                    </div>
                  </div>
                  <div>
                    <label className="mono-font text-[10px] text-stone-400 block mb-1">COOPERATION STATUS</label>
                    <select className="border border-stone-300 px-2 py-1.5 mono-font text-[10px]" style={{ background:'white' }}
                      value={receivingDraft.status||'not_contacted'} onChange={e => setReceivingDraft(d => ({...d, status: e.target.value}))}>
                      <option value="not_contacted">Not yet contacted</option>
                      <option value="notified">Notified</option>
                      <option value="freeze_requested">Freeze requested</option>
                      <option value="freeze_confirmed">Freeze confirmed</option>
                      <option value="cooperating">Cooperating</option>
                      <option value="unresponsive">Unresponsive</option>
                    </select>
                  </div>
                  <div>
                    <label className="mono-font text-[10px] text-stone-400 block mb-1">NOTES</label>
                    <textarea rows={2} className="w-full border border-stone-300 px-2 py-1.5 mono-font text-[10px] resize-none" style={{ background:'white' }}
                      value={receivingDraft.notes||''} onChange={e => setReceivingDraft(d => ({...d, notes: e.target.value}))} placeholder="Any relevant context..." />
                  </div>
                  <button onClick={() => { updateIncident(activeIncident.id, { receivingFi: receivingDraft }); setReceivingEdit(false) }}
                    className="mono-font text-[10px] tracking-widest px-4 py-1.5 transition-colors"
                    style={{ background:'#1A1814', color:'#F5F1EA', border:'none', cursor:'pointer' }}>
                    SAVE
                  </button>
                </div>
              ) : activeIncident.receivingFi?.name ? (
                <div className="px-4 py-3 grid gap-x-6 gap-y-1" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))' }}>
                  {[
                    ['NAME', activeIncident.receivingFi.name],
                    ['TYPE', (activeIncident.receivingFi.type||'').replace(/_/g,' ').toUpperCase()],
                    ['CONTACT', activeIncident.receivingFi.contactName],
                    ['INFO', activeIncident.receivingFi.contactInfo],
                    ['STATUS', (activeIncident.receivingFi.status||'').replace(/_/g,' ').toUpperCase()],
                  ].filter(([,v])=>v).map(([k,v]) => (
                    <div key={k}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400">{k}</div>
                      <div className="mono-font text-[11px] text-stone-800">{v}</div>
                    </div>
                  ))}
                  {activeIncident.receivingFi.notes && (
                    <div className="col-span-full">
                      <div className="mono-font text-[10px] tracking-widest text-stone-400">NOTES</div>
                      <div className="display-font text-[12px] text-stone-600 italic">{activeIncident.receivingFi.notes}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-4 py-5 text-center">
                  <p className="mono-font text-[10px] text-stone-400">No receiving FI on record. Add contact and cooperation status.</p>
                </div>
              )}
            </div>

            {/* ── Other FIs Affected ───────────────────────────────────────── */}
            <div className="border border-stone-300" style={{ background:'#FAF7F1' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-wrap gap-2">
                <div className="mono-font text-[10px] tracking-widest text-stone-600">OTHER FIs AFFECTED ({(activeIncident.affectedFis||[]).length})</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input value={fiInput.name} onChange={e => setFiInput(f => ({...f, name: e.target.value}))}
                    placeholder="Institution name" className="mono-font text-[10px] border border-stone-300 px-2 py-1" style={{ background:'white', width:'160px' }} />
                  <select value={fiInput.status} onChange={e => setFiInput(f => ({...f, status: e.target.value}))}
                    className="mono-font text-[10px] border border-stone-300 px-1 py-1" style={{ background:'white' }}>
                    <option value="notified">Notified</option>
                    <option value="unaware">Unaware</option>
                    <option value="cooperating">Cooperating</option>
                    <option value="unresponsive">Unresponsive</option>
                  </select>
                  <button onClick={() => {
                    if (!fiInput.name.trim()) return
                    const entry = { name: fiInput.name.trim(), type: fiInput.type, status: fiInput.status, addedAt: new Date().toISOString() }
                    updateIncident(activeIncident.id, { affectedFis: [...(activeIncident.affectedFis||[]), entry] })
                    setFiInput({ name:'', type:'bank', status:'notified' })
                  }} className="mono-font text-[10px] tracking-widest px-3 py-1 border border-stone-700 text-stone-700 hover:bg-stone-100 transition-colors whitespace-nowrap">
                    + ADD FI
                  </button>
                </div>
              </div>
              {(activeIncident.affectedFis||[]).length === 0 ? (
                <div className="px-4 py-5 text-center">
                  <p className="mono-font text-[10px] text-stone-400">No other FIs recorded. Add institutions affected by the same wave.</p>
                </div>
              ) : (
                <div className="divide-y divide-stone-200">
                  {(activeIncident.affectedFis||[]).map((fi, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                      <span className="display-font text-sm text-stone-800 flex-1">{fi.name}</span>
                      <span className="mono-font text-[10px] px-1.5 py-0.5"
                        style={{ background: fi.status==='cooperating'?'#ECFDF5':fi.status==='unresponsive'?'#FEF2F2':'#F5F1EA', color: fi.status==='cooperating'?'#065F46':fi.status==='unresponsive'?'#991B1B':'#57534E' }}>
                        {(fi.status||'').replace(/_/g,' ').toUpperCase()}
                      </span>
                      <button onClick={() => updateIncident(activeIncident.id, { affectedFis: (activeIncident.affectedFis||[]).filter((_,j)=>j!==i) })}
                        className="mono-font text-[10px] text-stone-400 hover:text-red-600 transition-colors">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>{/* end left operational column */}

          {/* ── Right: war room sticky panel ── */}
          <div style={{ flex:'0 0 min(100%, 340px)', position:'sticky', top:'80px', alignSelf:'flex-start' }}>
            <div className="border border-stone-800" style={{ background:'#1A1814', display:'flex', flexDirection:'column', minHeight:'520px' }}>
              <div className="px-4 py-3 border-b border-stone-700 flex items-center justify-between">
                <div className="mono-font text-[10px] tracking-widest" style={{ color:'#A8A29E' }}>WAR ROOM FEED</div>
                <span className="mono-font text-[10px]" style={{ color:'#78716C' }}>{(activeIncident.notes||[]).length} ENTRIES</span>
              </div>
              <div style={{ flex:1, overflowY:'auto', maxHeight:'400px' }}>
                {(activeIncident.notes||[]).length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="mono-font text-[10px]" style={{ color:'#57534E' }}>No updates yet. Post the first situation report.</p>
                  </div>
                ) : (
                  <div>
                    {[...(activeIncident.notes||[])].reverse().map((n, i) => (
                      <div key={i} className="px-4 py-3 border-b" style={{ borderColor:'#292524' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="mono-font text-[10px] font-bold" style={{ color: n.author === agentName ? '#6EE7B7' : '#78716C' }}>{n.author}</span>
                          <span className="mono-font text-[10px]" style={{ color:'#57534E' }}>{new Date(n.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})} {new Date(n.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                        <p className="display-font text-[13px] leading-snug" style={{ color:'#D6D3D1' }}>{n.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t" style={{ borderColor:'#292524' }}>
                <textarea rows={2} value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
                  placeholder="Situation update, action taken, decision made... (⌘↵ to post)"
                  className="w-full mono-font text-[11px] px-3 py-2 resize-none focus:outline-none"
                  style={{ background:'#292524', color:'#D6D3D1', border:'1px solid #44403C', borderRadius:0 }} />
                <button onClick={addNote} disabled={!noteDraft.trim()}
                  className="mono-font text-[10px] tracking-widest px-4 py-1.5 mt-2 w-full disabled:cursor-not-allowed transition-colors"
                  style={{ background: noteDraft.trim() ? '#16A34A' : '#292524', color: noteDraft.trim() ? '#F0FDF4' : '#57534E', border:'none', cursor: noteDraft.trim() ? 'pointer' : undefined }}>
                  POST UPDATE
                </button>
              </div>
            </div>
          </div>{/* end war room right column */}

          </div>
        )}

      </div>}{/* end !strategyMode operational wrapper */}

      {/* ── Strategist directives — always visible to analysts in operational mode ── */}
      {!strategyMode && (
        <div className="mt-6" style={{ border:'1px solid #44403C', background:'#1A1814', padding:'16px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
            <div>
              <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#D4CCBC' }}>◈ STRATEGY DIRECTIVES</div>
              <div className="mono-font text-[10px]" style={{ color:'#57534E' }}>Posted by Risk Strategist — read before actioning cases</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <div className="mono-font text-[10px] px-2 py-1" style={{ color:'#F59E0B', background:'#292524', border:'1px solid #92400E' }}>READ ONLY</div>
              <button onClick={() => { setStrategyMode(true); setStrategyIncId(null) }}
                className="mono-font text-[10px] tracking-widest px-3 py-1"
                style={{ background:'transparent', border:'1px solid #44403C', color:'#78716C', cursor:'pointer' }}
                onMouseEnter={e=>{e.currentTarget.style.color='#D4CCBC'}}
                onMouseLeave={e=>{e.currentTarget.style.color='#78716C'}}>
                ◈ OPEN STRATEGY MODE
              </button>
            </div>
          </div>
          {globalNotes.length === 0 ? (
            <div className="mono-font text-[10px] py-4 text-center" style={{ color:'#3D3A35', border:'1px solid #2D2922' }}>
              No directives posted yet. Switch to Strategy Mode to post one.
            </div>
          ) : (
            <div style={{ maxHeight:'220px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'6px' }}>
              {globalNotes.slice(0,10).map((n,idx) => (
                <div key={n.id||idx} style={{ padding:'12px 16px', background:'#252320', borderLeft:'3px solid #78716C' }}>
                  <div className="mono-font text-[10px] mb-2" style={{ color:'#57534E' }}>{n.author} · {new Date(n.ts).toLocaleString()}</div>
                  <div className="display-font" style={{ fontSize:'13px', color:'#E7E4DF', lineHeight:1.6 }}>{n.text}</div>
                </div>
              ))}
              {globalNotes.length > 10 && (
                <div className="mono-font text-[10px] text-center py-1" style={{ color:'#3D3A35' }}>+ {globalNotes.length-10} older directives — switch to Strategy Mode to see all</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Merge modal (always mounted) ── */}
      {mergeModal && (() => {
          const fromInc = incidents.find(i => i.id === mergeModal)
          if (!fromInc) return null
          return (
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'24px' }}>
              <div style={{ background:'#1A1814', border:'1px solid #44403C', width:'100%', maxWidth:'440px', padding:'24px' }}>
                <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#78716C' }}>MERGE INCIDENT</div>
                <div className="display-font font-bold mb-1" style={{ color:'#F5F1EA', fontSize:'16px' }}>{fromInc.name}</div>
                <div className="mono-font text-[10px] mb-4" style={{ color:'#57534E' }}>Linked cases, notes, participants and affected FIs will be absorbed into the target incident. This incident will be removed.</div>
                <div className="mono-font text-[10px] tracking-widest mb-2" style={{ color:'#78716C' }}>MERGE INTO →</div>
                <div className="space-y-2">
                  {incidents.filter(i => i.id !== mergeModal).map(i => (
                    <button key={i.id} onClick={() => { if (window.confirm(`Merge "${fromInc.name}" into "${i.name}"? This cannot be undone.`)) mergeIncidents(mergeModal, i.id) }}
                      className="w-full text-left px-3 py-3 border transition-colors hover:border-stone-400"
                      style={{ background:'#252320', borderColor:'#3D3A35' }}>
                      <div className="mono-font text-[10px] mb-0.5" style={{ color:'#57534E' }}>{i.id}</div>
                      <div className="display-font text-sm" style={{ color:'#E7E4DF' }}>{i.name}</div>
                      <div className="mono-font text-[10px] mt-1" style={{ color:'#78716C' }}>
                        {(i.linkedCaseIds||[]).length} cases · {(i.notes||[]).length} notes · {(i.participants||[]).length} agents
                      </div>
                    </button>
                  ))}
                </div>
                <button onClick={() => setMergeModal(null)}
                  className="mono-font text-[10px] tracking-widest mt-4 w-full py-2"
                  style={{ background:'transparent', border:'1px solid #3D3A35', color:'#78716C' }}>
                  CANCEL
                </button>
              </div>
            </div>
          )
        })()}
    </div>
  )
}

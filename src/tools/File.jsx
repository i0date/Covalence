// 004 FILE — submission log, lifecycle, Connect
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { evidencePath, CaseLink } from '../CaseThread.jsx'
import { SUPA_KEY, SUPA_URL, pushCasesToSupa } from '../data.js'
import { registerOutcomeSubscriber, saveOutcomes } from '../shared.jsx'
import { readCases } from '../caseStore.js'
import { isSignedIn } from '../auth.js'
import { recordDemoCaseEvent } from '../demoBackend.js'
import { MerchantFile } from '../MerchantFile.jsx'
import { doesIssuing, doesMerchant, isMerchantCase } from '../sides.mjs'

// ═══════════════════════════════════════════════════════════════════════════════
// FILE VIEW
// ═══════════════════════════════════════════════════════════════════════════════
const FILE_STATUSES = ['filed','network_invstg','representment','pre_arb','arbitration','won','lost','pending_arb','withdrawn']

export function FileView({ setActiveSection, setAppOutcomes, platformMode = 'fi', setPlatformMode, sides = ['issuer'], covUser }) {
  const [filedCases, setFiledCases] = React.useState([])
  const [allCases,   setAllCases]   = React.useState([])   // the merchant view reads every merchant case
  const [pkgModal2,  setPkgModal2]  = React.useState(null)
  const [fileSearch, setFileSearch] = React.useState('')
  const [fileFilter, setFileFilter] = React.useState('all') // all | active | won | lost
  const [fileNetFilter, setFileNetFilter] = React.useState('') // '' | 'visa' | 'master' | 'amex' | 'discover'
  const [fileNoteOpen, setFileNoteOpen] = React.useState(null)
  const [fileNoteDraft, setFileNoteDraft] = React.useState('')
  const [fileTab, setFileTab]     = React.useState('cases') // 'cases'|'connect'
  const settings = React.useMemo(() => { try { return JSON.parse(localStorage.getItem('cov_settings') || '{}') } catch { return {} } }, [])

  React.useEffect(() => {
    const refresh = (merged) => {
      try {
        const all = merged || readCases()
        setFiledCases(all.filter(o => FILE_STATUSES.includes(o.status) && !isMerchantCase(o)).sort((a,b) => new Date(b.filedAt||b.date) - new Date(a.filedAt||a.date)))
        setAllCases(all)
      } catch {}
    }
    refresh() // initial load
    const unregister = registerOutcomeSubscriber(refresh)
    return unregister
  }, [])

  // updatedAt marks the edit as newest, which also skips the case store's automatic
  // history stamp — so a status change writes its own history entry here
  const updateOutcome = (id, newStatus, patch = {}) => {
    try {
      const all = readCases(), now = new Date().toISOString()
      let who = 'Agent'; try { who = covUser?.name || JSON.parse(localStorage.getItem('cov_user') || 'null')?.name || who } catch {}
      const updated = all.map(o => {
        if (o.id !== id) return o
        const moved = newStatus !== o.status
        const ev = { ts: now, event: 'status', from: o.status, status: newStatus, by: who }
        if (moved && !isSignedIn()) recordDemoCaseEvent(o.id, ev)
        return { ...o, status: newStatus, outcomeAt: now, updatedAt: now, ...(moved ? { history: [...(o.history || []), ev] } : {}), ...patch }
      })
      saveOutcomes(updated)
      if (setAppOutcomes) setAppOutcomes(updated)
      setAllCases(updated)
      setFiledCases(updated.filter(o => FILE_STATUSES.includes(o.status) && !isMerchantCase(o)).sort((a,b) => new Date(b.filedAt||b.date) - new Date(a.filedAt||a.date)))
      if (SUPA_URL && SUPA_KEY) pushCasesToSupa(updated).catch(()=>{})
    } catch {}
  }

  const regenPackage = (o) => {
    const net = (o.network||'').toLowerCase()
    const isVisa = net.includes('visa'); const isMC = net.includes('master')
    const isAmex = net.includes('amex')||net.includes('american'); const isDiscover = net.includes('discover')
    const netLabel = isVisa?'VISA':isMC?'MC':isAmex?'AMEX':isDiscover?'DISCOVER':'NETWORK'
    const amt = (parseFloat((o.amount||'0').replace(/[^0-9.]/g,''))||0).toFixed(2)
    const currency = (o.currency||'USD').toUpperCase()
    const instName = settings?.duoInstitutionName || '[INSTITUTION NAME]'
    const agentName = localStorage.getItem('cov_agent_name')||'[AGENT]'
    const filedDate = o.filedAt ? new Date(o.filedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    const docs = o.docs||[]
    const docManifest = docs.length
      ? docs.map((d,i)=>`  ${String(i+1).padStart(2,'0')}. ${d.name} — ref ${evidencePath(d) || '-'}`).join('\n')
      : '  [NO DOCUMENTS ATTACHED]'
    const text = `${netLabel} CHARGEBACK SUBMISSION — ${o.id}
${'═'.repeat(64)}
FILED:       ${filedDate}
ISSUER:      ${instName}
PREPARED BY: ${agentName}
${'─'.repeat(64)}
MERCHANT:    ${o.merchant||'—'}
AMOUNT:      ${currency} ${amt}
REASON CODE: ${o.reasonCode||'—'}
VERDICT:     ${(o.verdict||'—').replace(/_/g,' ')}
CARD LAST 4: ${o.cardLast4||'—'}
TX DATE:     ${o._transactionDate||o.date||'—'}
${'─'.repeat(64)}
EVIDENCE MANIFEST (${docs.length} doc${docs.length!==1?'s':''})
${docManifest}
${'═'.repeat(64)}`
    setPkgModal2({ caseId: o.id, network: netLabel, text })
  }

  return (
    <div style={{maxWidth:'1280px',margin:'0 auto',padding:'40px 24px'}}>

      {/* Masthead */}
      <div className="mb-10 pb-6" style={{borderBottom:'1px solid #D4CCBC',display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'16px'}}>
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-400 mb-3">ISSUE Nº 004 — FILE</div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{fontSize:'clamp(48px,8vw,96px)',letterSpacing:'-0.03em'}}>
            <span style={{fontWeight:700}}>Fi</span><span style={{fontStyle:'italic',fontWeight:500}}>le</span>
          </h1>
          <p className="display-font text-stone-600 mt-4" style={{fontSize:'clamp(14px,1.8vw,16px)',lineHeight:1.6,maxWidth:'560px'}}>
            {platformMode === 'merchant'
              ? 'Every chargeback you’ve answered, until the cardholder’s bank decides — and after a win, whether the money came back and when the win is final.'
              : 'Submission audit trail. Generate filing packages from Multi — they live here as a permanent record. Direct API submission is coming once network certification is in place.'}
          </p>
        </div>
        <div className="mono-font text-xs tracking-widest text-stone-600">{new Date().toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</div>
      </div>

      {/* A workspace that works both sides switches here, the same switch as Desk's */}
      {doesIssuing(sides) && doesMerchant(sides) && setPlatformMode && (
        <div role="group" aria-label="Side" className="flex mb-8" style={{ flexWrap:'wrap' }}>
          {[['fi', 'ISSUER / FI'], ['merchant', 'MERCHANT / ACQUIRER']].map(([k, l], i) => (
            <button key={k} type="button" onClick={() => setPlatformMode(k)} aria-pressed={platformMode === k}
              className={'platform-toggle-btn mono-font text-xs tracking-widest px-5 py-2.5 border border-stone-900 transition-all ' + (i ? 'border-l-0 ' : '') + (platformMode === k ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-600 hover:bg-stone-100')}>{l}</button>
          ))}
        </div>
      )}

      {platformMode === 'merchant' ? (
        <MerchantFile cases={allCases} covUser={covUser} setActiveSection={setActiveSection}
          update={(id, patch) => { const o = allCases.find(x => x.id === id); if (o) updateOutcome(id, patch.status || o.status, patch) }} />
      ) : (<>

      {/* ── Tab switcher ── */}
      <div className="flex gap-0 mb-8 border-b border-stone-200">
        {[['cases','FILED CASES'],['connect','CONNECT']].map(([id,label])=>(
          <button key={id} onClick={()=>setFileTab(id)}
            className="mono-font text-[10px] tracking-widest px-5 py-3 transition-colors"
            style={{borderBottom:fileTab===id?'2px solid #1C1917':'2px solid transparent',color:fileTab===id?'#1C1917':'#78716C',background:'transparent',cursor:'pointer'}}>
            {label}
          </button>
        ))}
      </div>

      {fileTab==='connect'&&(
        <ConnectView outcomes={filedCases} setOutcomes={setAppOutcomes||(() => {})} covUser={null} />
      )}

      {fileTab==='cases'&&<>

      {/* Network cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
        {[{l:'VISA',s:'Visa Online · Dispute Submission',c:'#1A3A8F'},{l:'MASTERCARD',s:'MC Connect · Dispute Management',c:'#B22222'},{l:'AMEX',s:'American Express · Dispute Portal',c:'#006DB7'},{l:'DISCOVER',s:'Discover · Network Filing',c:'#B45309'}].map(n=>{
          const netKey = n.l==='VISA'?'visa':n.l==='MASTERCARD'?'master':n.l==='AMEX'?'amex':'discover'
          const count = filedCases.filter(o=>{const net=(o.network||'').toLowerCase();return n.l==='VISA'?net.includes('visa'):n.l==='MASTERCARD'?net.includes('master'):n.l==='AMEX'?(net.includes('amex')||net.includes('american')):net.includes('discover')}).length
          const isActive = fileNetFilter === netKey
          return (
            <button key={n.l} onClick={() => setFileNetFilter(isActive ? '' : netKey)}
              className="border px-4 py-5 text-left transition-colors w-full"
              style={{background: isActive ? '#1A1814' : '#FAF7F1', borderColor: isActive ? '#1A1814' : '#D1CCBB', cursor:'pointer'}}>
              <div className="mono-font text-[10px] tracking-widest mb-2" style={{color: isActive ? '#F5F1EA' : n.c}}>{n.l}</div>
              <div className="display-font text-[12px] leading-snug" style={{color: isActive ? '#D4CCBC' : '#78716C'}}>{n.s}</div>
              <div className="mono-font text-[10px] mt-3 tracking-widest" style={{color: isActive ? '#A8A29E' : '#A8A29E'}}>{count > 0 ? `${count} FILED${isActive?' · FILTERING':''}` : 'NO CASES YET'}</div>
            </button>
          )
        })}
      </div>

      {/* Submission log */}
      <div className="border border-stone-300 mb-8" style={{background:'#FAF7F1'}}>
        <div className="px-5 py-3 border-b border-stone-200">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <div>
              <div className="mono-font text-xs tracking-widest text-stone-600">SUBMISSION LOG</div>
              <div className="mono-font text-[10px] text-stone-400 mt-0.5">{filedCases.length} case{filedCases.length!==1?'s':''} · all post-filing statuses</div>
            </div>
            <button onClick={()=>setActiveSection('multi')} className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-stone-400 text-stone-500 hover:bg-stone-100 transition-colors">← MULTI</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[['all','ALL'],['active','ACTIVE'],['won','WON'],['lost','LOST']].map(([v,l])=>(
              <button key={v} onClick={()=>setFileFilter(v)}
                className="mono-font text-[10px] tracking-widest px-3 py-1 transition-colors"
                style={{background:fileFilter===v?'#1C1917':'transparent',color:fileFilter===v?'#F5F1EA':'#78716C',border:'1px solid',borderColor:fileFilter===v?'#1C1917':'#D4CCBC',cursor:'pointer'}}>
                {l}
              </button>
            ))}
            <div className="flex items-center gap-1 ml-auto">
              <input value={fileSearch} onChange={e=>setFileSearch(e.target.value)}
                placeholder="Search ID, merchant..."
                className="mono-font text-[10px] border border-stone-300 px-3 py-1 focus:outline-none focus:border-stone-500"
                style={{background:'white',minWidth:'180px'}}/>
              {fileSearch&&<button onClick={()=>setFileSearch('')} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 px-1">✕</button>}
            </div>
          </div>
        </div>
        {(() => {
          const ACTIVE_STATUSES = ['filed','network_invstg','representment','pre_arb','arbitration','pending_arb']
          const filtered = filedCases.filter(o => {
            if (fileFilter === 'active') return ACTIVE_STATUSES.includes(o.status)
            if (fileFilter === 'won')    return o.status === 'won'
            if (fileFilter === 'lost')   return o.status === 'lost'
            return true
          }).filter(o => {
            if (!fileSearch.trim()) return true
            const q = fileSearch.toLowerCase()
            return (o.id||'').toLowerCase().includes(q)||(o.merchant||'').toLowerCase().includes(q)||(o.reasonCode||'').toLowerCase().includes(q)||(o.network||'').toLowerCase().includes(q)
          }).filter(o => {
            if (!fileNetFilter) return true
            const net = (o.network||'').toLowerCase()
            return (fileNetFilter==='visa'&&net.includes('visa'))||(fileNetFilter==='master'&&net.includes('master'))||(fileNetFilter==='amex'&&(net.includes('amex')||net.includes('american')))||(fileNetFilter==='discover'&&net.includes('discover'))
          })
          return filtered
        })().length === 0 && filedCases.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="mono-font text-[10px] text-stone-400 tracking-widest mb-2">NO FILED CASES YET</div>
            <p className="display-font text-stone-400 text-[13px] mb-4">File cases from the Multi queue — they'll appear here as a permanent log with re-downloadable packages.</p>
            <button onClick={()=>setActiveSection('multi')} className="mono-font text-[10px] tracking-widest px-4 py-2 border border-stone-400 text-stone-500 hover:bg-stone-100 transition-colors">→ GO TO MULTI</button>
          </div>
        ) : (() => {
          const ACTIVE_STATUSES = ['filed','network_invstg','representment','pre_arb','arbitration','pending_arb']
          const filtered = filedCases.filter(o => {
            if (fileFilter === 'active') return ACTIVE_STATUSES.includes(o.status)
            if (fileFilter === 'won')    return o.status === 'won'
            if (fileFilter === 'lost')   return o.status === 'lost'
            return true
          }).filter(o => {
            if (!fileSearch.trim()) return true
            const q = fileSearch.toLowerCase()
            return (o.id||'').toLowerCase().includes(q)||(o.merchant||'').toLowerCase().includes(q)||(o.reasonCode||'').toLowerCase().includes(q)||(o.network||'').toLowerCase().includes(q)
          }).filter(o => {
            if (!fileNetFilter) return true
            const net = (o.network||'').toLowerCase()
            return (fileNetFilter==='visa'&&net.includes('visa'))||(fileNetFilter==='master'&&net.includes('master'))||(fileNetFilter==='amex'&&(net.includes('amex')||net.includes('american')))||(fileNetFilter==='discover'&&net.includes('discover'))
          })
          return filtered.length === 0 ? (
            <div className="px-5 py-8 text-center mono-font text-[10px] text-stone-400 tracking-widest">NO CASES MATCH FILTER</div>
          ) : (
          <div className="divide-y divide-stone-200" style={{overflowX:'auto'}}>
            <div style={{minWidth:'560px'}}>
            <div className="grid px-5 py-2 mono-font text-[10px] tracking-widest text-stone-400" style={{background:'#EEE9E0',gridTemplateColumns:'100px 60px minmax(0,1fr) 90px 50px auto'}}>
              <span>CASE ID</span>
              <span>FILED</span>
              <span>MERCHANT</span>
              <span>AMT</span>
              <span>NET</span>
              <span>↓ PKG</span>
            </div>
            {filtered.map(o => {
              const CB_STAGES = [
                {id:'filed',          label:'1ST CB'},
                {id:'network_invstg', label:'NTW INVSTG'},
                {id:'representment',  label:'MERCHANT RESP'},
                {id:'pre_arb',        label:'PRE-ARB'},
                {id:'arbitration',    label:'ARB'},
              ]
              const TERMINAL = {won:'WON ✓',lost:'LOST','withdrawn':'WD','pending_arb':'PEND ARB'}
              const curIdx = CB_STAGES.findIndex(s => s.id === o.status)
              const isTerminal = !!TERMINAL[o.status]
              const netColor = (o.network||'').toLowerCase().includes('visa')?'#1A3A8F':(o.network||'').toLowerCase().includes('master')?'#B22222':'#78716C'
              return (
                <div key={o.id} className="border-b border-stone-100">
                  <div className="grid items-center px-5 py-3" style={{gridTemplateColumns:'100px 60px minmax(0,1fr) 90px 50px auto',gap:'8px'}}>
                    <span className="mono-font text-[10px] text-stone-500"><CaseLink id={o.id} /></span>
                    <span className="mono-font text-[10px] text-stone-400">{o.filedAt ? new Date(o.filedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}{o.filedBy && <span className="ml-1 text-stone-300" title="Filed by">[{o.filedBy}]</span>}</span>
                    <span className="mono-font text-[11px] text-stone-800 truncate font-medium">{o.merchant||'—'}</span>
                    <span className="mono-font text-[10px] text-stone-600">{o.amount||'—'}</span>
                    <span className="mono-font text-[10px] font-bold" style={{color:netColor}}>{(o.network||'—').toUpperCase().substring(0,4)}</span>
                    <div className="flex gap-1">
                      <button onClick={() => regenPackage(o)} className="mono-font text-[10px] px-2 py-0.5 border border-amber-700 text-amber-700 hover:bg-amber-50 transition-colors">↓ PKG</button>
                      {(o.docs||[]).length > 0 && <span className="mono-font text-[10px] px-1.5 py-0.5 bg-stone-700 text-stone-50">{(o.docs||[]).length}📎</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 px-5 pb-2 flex-wrap">
                    {CB_STAGES.map((s, i) => {
                      const isPast = curIdx > i && !isTerminal
                      const isCurrent = curIdx === i && !isTerminal
                      return (
                        <React.Fragment key={s.id}>
                          {i > 0 && <span className="mono-font text-[10px] text-stone-300">›</span>}
                          <button onClick={() => !isCurrent && updateOutcome(o.id, s.id)} disabled={isCurrent}
                            className="mono-font text-[10px] px-2 py-0.5 transition-colors whitespace-nowrap"
                            style={{background:isCurrent?'#1A1814':isPast?'#D4CCBC':'transparent',color:isCurrent?'#F5F1EA':isPast?'#78716C':'#A8A29E',border:isCurrent?'1px solid #1A1814':isPast?'1px solid #D4CCBC':'1px solid #E0D9CE',cursor:isCurrent?'default':'pointer'}}>
                            {s.label}
                          </button>
                        </React.Fragment>
                      )
                    })}
                    <span className="mono-font text-[10px] text-stone-300">›</span>
                    {!isTerminal ? (<>
                      <button onClick={() => updateOutcome(o.id,'won')} className="mono-font text-[10px] px-2 py-0.5 border border-stone-400 text-stone-500 hover:border-green-700 hover:text-green-700 hover:bg-green-50 transition-colors whitespace-nowrap">✓ WON</button>
                      <button onClick={() => updateOutcome(o.id,'lost')} className="mono-font text-[10px] px-2 py-0.5 border border-stone-400 text-stone-500 hover:border-red-700 hover:text-red-700 hover:bg-red-50 transition-colors whitespace-nowrap">✗ LOST</button>
                    </>) : (
                      <span className="mono-font text-[10px] px-2 py-0.5 font-bold" style={{background:o.status==='won'?'#064E3B':o.status==='lost'?'#7F1D1D':o.status==='pending_arb'?'#4C1D95':'#57534E',color:o.status==='won'?'#D1FAE5':o.status==='lost'?'#FEE2E2':o.status==='pending_arb'?'#EDE9FE':'#E7E2D9'}}>{TERMINAL[o.status]}</span>
                    )}
                    {isTerminal && <button onClick={() => updateOutcome(o.id,'filed')} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 transition-colors">↩</button>}
                  <button onClick={() => { if (fileNoteOpen===o.id) { setFileNoteOpen(null) } else { setFileNoteOpen(o.id); setFileNoteDraft(o.note||'') } }}
                    className="mono-font text-[10px] px-2 py-0.5 border transition-colors"
                    style={{borderColor: o.note ? '#92400E' : '#D4CCBC', color: o.note ? '#92400E' : '#A8A29E', background: fileNoteOpen===o.id ? '#FFFBEB' : 'transparent'}}>
                    {o.note ? '📝 NOTE' : '+ NOTE'}
                  </button>
                  </div>
                  {fileNoteOpen === o.id && (
                    <div className="mt-2 pt-2 border-t border-stone-200">
                      <textarea value={fileNoteDraft} onChange={e=>setFileNoteDraft(e.target.value)}
                        placeholder="Case notes, response strategy, adjuster contact..."
                        className="w-full display-font text-sm text-stone-700 resize-none border border-stone-300 px-3 py-2 focus:outline-none focus:border-stone-500"
                        style={{background:'#FEFCF9',minHeight:'72px'}} />
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => { updateOutcome(o.id, o.status, { note: fileNoteDraft }); setFileNoteOpen(null) }}
                          className="mono-font text-[10px] tracking-widest px-3 py-1 border border-stone-700 text-stone-700 hover:bg-stone-700 hover:text-stone-50 transition-colors">
                          SAVE NOTE
                        </button>
                        {o.note && <button onClick={() => { updateOutcome(o.id, o.status, { note: '' }); setFileNoteOpen(null) }}
                          className="mono-font text-[10px] tracking-widest px-3 py-1 border border-red-300 text-red-400 hover:bg-red-50 transition-colors">
                          CLEAR
                        </button>}
                        <button onClick={() => setFileNoteOpen(null)} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 px-2">cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          </div>
          )
        })()}
      </div>

      {/* Coming soon chips */}
      <div className="flex gap-3 flex-wrap">
        {['DIRECT API SUBMISSION (PHASE 2)','NETWORK-SPEC VALIDATION','BATCH FILING','NETWORK ACKNOWLEDGMENT TRACKING'].map(f=>(
          <div key={f} className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-stone-300 text-stone-400">{f}</div>
        ))}
      </div>

      {/* Package re-download modal */}
      </>
      }{/* end cases tab */}
      </>)}{/* end issuer view */}

      {pkgModal2 && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'24px'}}>
          <div style={{background:'#FAF7F1',maxWidth:'760px',width:'100%',maxHeight:'85vh',display:'flex',flexDirection:'column',border:'2px solid #1C1917'}}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-stone-300">
              <div>
                <div className="mono-font text-[10px] tracking-widest text-stone-500">FILING PACKAGE — {pkgModal2.network}</div>
                <div className="mono-font text-xs text-stone-800 mt-0.5">{pkgModal2.caseId}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { const a=document.createElement('a'); a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(pkgModal2.text); a.download=`COV-${pkgModal2.caseId}-${pkgModal2.network}.txt`; a.click() }}
                  className="mono-font text-[10px] tracking-widest px-3 py-1.5 transition-colors"
                  style={{background:'#1C1917',color:'#F5F1EA',border:'none',cursor:'pointer'}}
                >↓ DOWNLOAD .TXT</button>
                <button onClick={()=>setPkgModal2(null)} className="mono-font text-[10px] text-stone-500 hover:text-stone-900 px-2">✕</button>
              </div>
            </div>
            <pre style={{flex:1,overflow:'auto',padding:'20px',fontFamily:'monospace',fontSize:'11px',lineHeight:1.7,whiteSpace:'pre-wrap',wordBreak:'break-word',color:'#1C1917',background:'#FAF7F1'}}>{pkgModal2.text}</pre>
          </div>
        </div>
      )}
    </div>
  )
}


// =============================================================================
// 009 CONNECT VIEW
// =============================================================================
function ConnectView({ outcomes, setOutcomes, covUser }) {
  const [connectTab,   setConnectTab]  = React.useState('network')
  const [vroPaste,     setVroPaste]    = React.useState('')
  const [mcPaste,      setMcPaste]     = React.useState('')
  const [vroParsed,    setVroParsed]   = React.useState(null)
  const [mcParsed,     setMcParsed]    = React.useState(null)
  const [vroError,     setVroError]    = React.useState(null)
  const [mcError,      setMcError]     = React.useState(null)
  const [vroImported,  setVroImported] = React.useState(false)
  const [mcImported,   setMcImported]  = React.useState(false)
  const [repFilter,    setRepFilter]   = React.useState('pending')
  const [lastChecked,  setLastChecked] = React.useState(null)

  const parseCSV = (text, network) => {
    const lines = text.trim().split('\n').filter(Boolean)
    if (lines.length < 2) return { error:'Paste the full CSV export including the header row.' }
    const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toUpperCase())
    const get = (vals, ...keys) => { for (const k of keys) { const idx = headers.findIndex(h=>h.includes(k)); if (idx>=0 && vals[idx]) return vals[idx] } return '' }
    const rows = lines.slice(1).map((line,i) => {
      const v = line.split(',').map(x => x.replace(/^"|"$/g,'').trim())
      return {
        id: get(v,'CASE','REF','NUMBER','ID') || (network==='visa'?'VRO':'MCC')+'-'+Date.now().toString(36).toUpperCase()+'-'+i,
        merchant: get(v,'MERCHANT','MERCH'),
        amount: get(v,'AMOUNT','AMT','TRANS AMT','DISPUTE AMT'),
        currency: get(v,'CURRENCY','CCY') || (network==='visa'?'USD':'USD'),
        network,
        reasonCode: get(v,'REASON CODE','RC','REASON','DISPUTE REASON'),
        date: get(v,'TRANS DATE','DATE','TXN DATE'),
        status: 'queued',
        source: network==='visa'?'vro_import':'mc_import',
        importedAt: new Date().toISOString(),
      }
    })
    return { rows }
  }

  const doImport = (parsed, onDone) => {
    if (!parsed) return
    const existingIds = new Set(outcomes.map(o=>o.id))
    const newCases = parsed.filter(r => !existingIds.has(r.id))
    setOutcomes(prev => [...prev, ...newCases])
    onDone()
  }

  const T = id => ({ borderBottom:connectTab===id?'2px solid #1C1917':'2px solid transparent', color:connectTab===id?'#1C1917':'#78716C', background:'transparent', cursor:'pointer' })

  const APIPlaceholder = ({ name, description }) => (
    <div style={{border:'1px solid #E7E2DA',padding:'22px',background:'#FAFAF8',opacity:0.78}}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="mono-font text-[10px] font-bold text-stone-700 mb-1">{name}</div>
          <p className="display-font text-stone-500 text-[13px] leading-relaxed">{description}</p>
        </div>
        <span className="mono-font text-[10px] tracking-widest px-2 py-1 shrink-0" style={{background:'#FEF3C7',color:'#78350F',border:'1px solid #FCD34D',whiteSpace:'nowrap'}}>AWAITING CREDENTIALS</span>
      </div>
      <button disabled className="mono-font text-[10px] tracking-widest px-4 py-2 border border-stone-300 text-stone-400 cursor-not-allowed" style={{background:'#F0EDE6'}}>CONFIGURE →</button>
    </div>
  )

  const ImportPanel = ({ network, paste, setPaste, parsed, setParsed, error, setError, imported, setImported }) => {
    const isVisa = network === 'visa'
    const parse = () => {
      setError(null); setParsed(null); setImported(false)
      const result = parseCSV(paste, network)
      if (result.error) { setError(result.error); return }
      setParsed(result.rows)
    }
    return (
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="mono-font text-[10px] tracking-widest text-stone-500">{isVisa?'VISA RESOLVE ONLINE':'MASTERCARD CONNECT'} — CSV IMPORT</div>
          <span className="mono-font text-[10px] px-2 py-0.5" style={{background:isVisa?'#EFF6FF':'#FFF1F2',color:isVisa?'#1E40AF':'#9F1239',border:isVisa?'1px solid #BFDBFE':'1px solid #FECDD3'}}>{isVisa?'VISA':'MASTERCARD'}</span>
        </div>
        <p className="display-font text-stone-500 text-[13px] mb-4">
          {isVisa?'Export from VRO (Cases → Export → CSV). Paste the full file below.':'Export from Mastercard Connect (Disputes → View All → Export). Paste the CSV below.'}
          {' '}Covalence maps case IDs, merchants, amounts, reason codes, and dates automatically.
        </p>
        <textarea value={paste} onChange={e=>{setPaste(e.target.value);setParsed(null);setImported(false)}}
          placeholder={isVisa?'Paste VRO CSV export here...':'Paste MC Connect CSV export here...'}
          className="w-full mono-font text-[11px] border border-stone-300 px-3 py-3 focus:outline-none focus:border-stone-600 resize-none"
          style={{minHeight:'100px',background:'#FAFAF8',fontFamily:'monospace'}} />
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <button onClick={parse} disabled={!paste.trim()}
            className="mono-font text-[10px] tracking-widest px-4 py-2 bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            PARSE CSV
          </button>
          {parsed&&(
            <button onClick={()=>doImport(parsed,()=>{setImported(true);setPaste('');setParsed(null)})}
              className="mono-font text-[10px] tracking-widest px-4 py-2 bg-emerald-900 text-emerald-50 hover:bg-emerald-800 transition-colors">
              IMPORT {parsed.length} CASE{parsed.length!==1?'S':''}
            </button>
          )}
          {imported&&<span className="mono-font text-[10px] text-emerald-700">✓ Imported — cases added to Multi queue</span>}
          {error&&<span className="mono-font text-[10px] text-red-700">{error}</span>}
        </div>
        {parsed&&(
          <div className="mt-4 border border-stone-200" style={{maxHeight:'180px',overflowY:'auto'}}>
            <div className="flex items-center gap-3 px-4 py-2 bg-stone-100" style={{borderBottom:'1px solid #E7E2DA'}}>
              <span className="mono-font text-[10px] tracking-widest text-stone-500">PREVIEW — {parsed.length} ROWS</span>
            </div>
            {parsed.slice(0,6).map((r,i)=>(
              <div key={i} className="flex items-center gap-3 px-4 py-2 flex-wrap" style={{borderBottom:'1px solid #F0EDE6'}}>
                <span className="mono-font text-[10px] text-stone-400 w-24 shrink-0 truncate">{r.id}</span>
                <span className="mono-font text-[10px] text-stone-700 flex-1 truncate">{r.merchant||'—'}</span>
                <span className="mono-font text-[10px] text-stone-500">{r.amount} {r.currency}</span>
                <span className="mono-font text-[10px] text-stone-400">{r.reasonCode||'—'}</span>
                <span className="mono-font text-[10px] text-stone-300">{r.date}</span>
              </div>
            ))}
            {parsed.length>6&&<div className="px-4 py-2 mono-font text-[10px] text-stone-400">+{parsed.length-6} more rows</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{maxWidth:'960px',margin:'0 auto',padding:'24px 16px 80px'}}>
      <div className="mb-6 pb-5" style={{borderBottom:'1px solid #D4CCBC'}}>
        <h1 className="display-font font-bold text-stone-900 leading-none" style={{fontSize:'clamp(28px,5vw,52px)',letterSpacing:'-0.03em'}}>
          <span style={{fontWeight:700}}>Con</span><span style={{fontStyle:'italic',fontWeight:500}}>nect</span>
        </h1>
        <p className="display-font text-stone-500 mt-2" style={{fontSize:'clamp(12px,1.6vw,14px)',lineHeight:'1.5',maxWidth:'520px'}}>
          Direct API layer to Visa and Mastercard dispute systems. Track incoming representments. Fall back to CSV while credentials are pending.
        </p>
      </div>
      <div style={{overflowX:'auto',marginBottom:'24px',borderBottom:'1px solid #E7E2DA'}}>
        <div className="flex gap-0" style={{minWidth:'max-content'}}>
          {[['network','NETWORK API'],['representments','REPRESENTMENTS'],['import','CSV IMPORT']].map(([id,label])=>(
            <button key={id} onClick={()=>setConnectTab(id)} className="mono-font text-[10px] tracking-widest px-5 py-3 transition-colors whitespace-nowrap" style={T(id)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── NETWORK API TAB ── */}
      {connectTab==='network'&&(
        <div>
          <div className="mb-5 px-4 py-3" style={{border:'1px solid #FCD34D',background:'#FFFBEB'}}>
            <div className="mono-font text-[10px] tracking-widest text-amber-800 mb-1">AWAITING CREDENTIALS</div>
            <p className="mono-font text-[10px] text-amber-700">The API layer is built and ready. Once network credentials are issued by your sponsoring acquirer or directly by Visa/Mastercard, configure each integration below. CSV import remains available in the meantime.</p>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
            {[
              { id:'visa_dms',   net:'VISA',        name:'VISA DISPUTE MANAGEMENT SYSTEM (DMS)',         scope:'Dispute submission, case status, deadline tracking, and reason code details direct from Visa. Replaces manual VRO exports. Cases filed through Covalence will push directly and receive status callbacks.',     cred:'Visa DMS Client ID + Secret (via acquirer)' },
              { id:'mc_mdri',    net:'MASTERCARD',  name:'MASTERCARD DISPUTE RESOLUTION INITIATIVE (MDRI)',scope:'Real-time dispute ingestion, case lifecycle events, pre-arbitration triggers, and cycle deadline management from Mastercard. Incoming representments surface automatically in the Representments tab.',         cred:'MC MDRI API Key + Merchant ID (via acquirer)' },
              { id:'mc_match',   net:'MASTERCARD',  name:'MASTERCARD MATCH — TERMINATED MERCHANT FILE',  scope:'Screen merchants against the MATCH list at onboarding or case intake. Flags prior terminations for fraud or excessive chargebacks before disputes are worked.',                                                  cred:'MC MATCH API Key' },
              { id:'ethoca',     net:'ETHOCA',      name:'ETHOCA ALERT NETWORK',                         scope:'Receive fraud alerts from Ethoca before chargebacks are filed. Enables proactive refund to avoid the chargeback and protect your chargeback ratio. Alerts arrive in the Representments tab as actionable items.',cred:'Ethoca Merchant Token + Alert endpoint URL' },
              { id:'verifi',     net:'VERIFI',      name:'VERIFI ORDER INSIGHT / RAPID DISPUTE RESOLUTION',scope:'Pre-dispute intelligence for Visa disputes. Automatically deflect disputes with order data at the issuer inquiry stage, before a chargeback is raised. Requires Verifi merchant agreement.',                cred:'Verifi Client ID + Secret + Merchant ID' },
            ].map(({id,net,name,scope,cred})=>(
              <div key={id} style={{border:'1px solid #E7E2DA',padding:'20px',background:'#FAFAF8'}}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div style={{flex:1}}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="mono-font text-[10px] px-1.5 py-0.5" style={{background:net==='VISA'?'#EFF6FF':net==='MASTERCARD'?'#FFF1F2':'#F0FDF4',color:net==='VISA'?'#1E40AF':net==='MASTERCARD'?'#9F1239':'#166534',border:'1px solid '+(net==='VISA'?'#BFDBFE':net==='MASTERCARD'?'#FECDD3':'#BBF7D0')}}>{net}</span>
                      <span className="mono-font text-[10px] font-bold text-stone-700">{name}</span>
                    </div>
                    <p className="display-font text-stone-500 text-[13px] leading-relaxed mb-2">{scope}</p>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400">REQUIRED: {cred}</div>
                  </div>
                  <span className="mono-font text-[10px] tracking-widest px-2 py-1 shrink-0" style={{background:'#FEF3C7',color:'#78350F',border:'1px solid #FCD34D',whiteSpace:'nowrap'}}>AWAITING CREDENTIALS</span>
                </div>
                <button disabled className="mono-font text-[10px] tracking-widest px-4 py-2" style={{background:'#F0EDE6',border:'1px solid #D4CCBC',color:'#A8A29E',cursor:'not-allowed'}}>CONFIGURE →</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── REPRESENTMENTS TAB ── */}
      {connectTab==='representments'&&(()=>{
        const repCases = outcomes.filter(c => ['merchant_resp','pre_arb','arbitration'].includes(c.cbStage)||c.status==='merchant_resp')
        const pending  = repCases.filter(c => !c.repReceivedAt)
        const received = repCases.filter(c =>  c.repReceivedAt)
        const view     = repFilter==='pending' ? pending : repFilter==='received' ? received : repCases
        const daysSince = (dateStr) => { if(!dateStr) return null; const d=Math.floor((Date.now()-new Date(dateStr))/(1000*60*60*24)); return d }
        return (
          <div>
            <div className="mb-5">
              <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-2">WHAT THIS TRACKS</div>
              <p className="display-font text-stone-600 text-[13px] leading-relaxed">After a chargeback is filed, the merchant has a window to respond — usually 20–45 days depending on network and reason code. Once MDRI and Ethoca are live, incoming responses will appear here automatically and update the case in Desk. Until then this view reads from cases in the CB pipeline that are awaiting a merchant response.</p>
            </div>

            <div className="mb-5 px-4 py-3" style={{border:'1px solid #E7E2DA',background:'#FAFAF8'}}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-0.5">AWAITING RESPONSE</div>
                    <div className="mono-font font-bold text-[22px] text-stone-800">{pending.length}</div>
                  </div>
                  <div>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-0.5">RESPONSE RECEIVED</div>
                    <div className="mono-font font-bold text-[22px] text-emerald-700">{received.length}</div>
                  </div>
                  <div>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-0.5">TOTAL IN PIPELINE</div>
                    <div className="mono-font font-bold text-[22px] text-stone-500">{repCases.length}</div>
                  </div>
                </div>
                <button onClick={()=>setLastChecked(new Date().toLocaleTimeString())}
                  className="mono-font text-[10px] tracking-widest px-4 py-2"
                  style={{background:'#1C1917',color:'#F5F1EA',border:'none',cursor:'pointer'}}>
                  ↻ CHECK FOR UPDATES
                </button>
              </div>
              {lastChecked&&<div className="mono-font text-[10px] text-stone-400 mt-2">Last checked: {lastChecked} — live polling active once MDRI/Ethoca credentials are configured</div>}
            </div>

            <div style={{display:'flex',gap:'2px',marginBottom:'14px'}}>
              {[['pending','AWAITING'],['received','RECEIVED'],['all','ALL']].map(([v,l])=>(
                <button key={v} onClick={()=>setRepFilter(v)} className="mono-font text-[10px] tracking-widest px-4 py-2"
                  style={{background:repFilter===v?'#1C1917':'transparent',color:repFilter===v?'#F5F1EA':'#78716C',border:'1px solid '+(repFilter===v?'#1C1917':'#D4CCBC'),cursor:'pointer'}}>
                  {l} ({v==='pending'?pending.length:v==='received'?received.length:repCases.length})
                </button>
              ))}
            </div>

            {view.length===0?(
              <div className="mono-font text-[10px] py-10 text-center" style={{color:'#A8A29E',border:'1px solid #E7E2DA'}}>
                {repCases.length===0
                  ? 'No cases in the merchant response stage yet. Cases filed through Desk move here once they reach the CB pipeline.'
                  : 'No cases match this filter.'}
              </div>
            ):(
              <div style={{border:'1px solid #E7E2DA'}}>
                <div className="flex items-center gap-3 px-4 py-2" style={{borderBottom:'1px solid #E7E2DA',background:'#F5F1EA'}}>
                  <span className="mono-font text-[10px] tracking-widest text-stone-400 flex-1">CASE</span>
                  <span className="mono-font text-[10px] tracking-widest text-stone-400 w-24 shrink-0">STAGE</span>
                  <span className="mono-font text-[10px] tracking-widest text-stone-400 w-20 text-right shrink-0">AMOUNT</span>
                  <span className="mono-font text-[10px] tracking-widest text-stone-400 w-24 text-right shrink-0">FILED</span>
                  <span className="mono-font text-[10px] tracking-widest text-stone-400 w-20 text-right shrink-0">STATUS</span>
                </div>
                {view.map((c,i)=>{
                  const age = daysSince(c.filedAt||c.date)
                  const overdue = age!=null && age>30
                  return (
                    <div key={c.id||i} className="flex items-center gap-3 px-4 py-3" style={{borderTop:i>0?'1px solid #F0EDE6':'none',background:'#FAFAF8'}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="mono-font text-[10px] text-stone-400 mb-0.5">{c.id||'—'}</div>
                        <div className="display-font text-[13px] text-stone-700 truncate">{c.merchant||c.description||'—'}</div>
                      </div>
                      <div className="mono-font text-[10px] w-24 shrink-0" style={{color:'#78716C'}}>{(c.cbStage||c.status||'—').replace(/_/g,' ').toUpperCase()}</div>
                      <div className="mono-font text-[10px] w-20 text-right shrink-0 text-stone-600">{c.amount?'$'+c.amount:'—'}</div>
                      <div className="mono-font text-[10px] w-24 text-right shrink-0" style={{color:overdue?'#B45309':'#A8A29E'}}>
                        {age!=null?age+'d ago':'—'}{overdue?' ⚠':''}
                      </div>
                      <div className="w-20 text-right shrink-0">
                        <span className="mono-font text-[10px] px-2 py-0.5" style={{background:c.repReceivedAt?'#D1FAE5':'#FEF3C7',color:c.repReceivedAt?'#064E3B':'#78350F',border:'1px solid '+(c.repReceivedAt?'#6EE7B7':'#FCD34D')}}>
                          {c.repReceivedAt?'RECEIVED':'PENDING'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-6 px-4 py-3" style={{border:'1px solid #E7E2DA',background:'#FAFAF8'}}>
              <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">ONCE MDRI + ETHOCA ARE LIVE</div>
              <p className="display-font text-stone-500 text-[13px] leading-relaxed">Merchant responses will arrive via webhook. Covalence will update the case stage in Desk automatically, flag responses that need attention, and surface pre-dispute alerts from Ethoca and Verifi here for action before a chargeback is raised.</p>
            </div>
          </div>
        )
      })()}

      {/* ── CSV IMPORT TAB ── */}
      {connectTab==='import'&&(
        <div>
          <div className="mb-5 px-4 py-3" style={{border:'1px solid #E7E2DA',background:'#FAFAF8'}}>
            <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">CSV IMPORT — INTERIM METHOD</div>
            <p className="display-font text-stone-500 text-[13px] leading-relaxed">Export from VRO or Mastercard Connect and paste below. Cases are mapped and added to the Multi queue. Once Network API credentials are configured, this step is replaced by automatic ingestion.</p>
          </div>
          <div className="space-y-10">
            <ImportPanel network="visa" paste={vroPaste} setPaste={setVroPaste} parsed={vroParsed} setParsed={setVroParsed} error={vroError} setError={setVroError} imported={vroImported} setImported={setVroImported} />
            <div style={{borderTop:'1px solid #E7E2DA'}}/>
            <ImportPanel network="mastercard" paste={mcPaste} setPaste={setMcPaste} parsed={mcParsed} setParsed={setMcParsed} error={mcError} setError={setMcError} imported={mcImported} setImported={setMcImported} />
          </div>
        </div>
      )}
    </div>
  )
}

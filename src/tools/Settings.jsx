// SETTINGS — every setting, in pages grouped down the left (Linear-style)
// ═══════════════════════════════════════════════════════════════════════════════
// Groups: Workspace, Team & access, Cases & workflow, Financial crime,
// Integrations, Records. A search box finds any setting by its name or what it
// does and jumps to it. Each setting changed from the default has a dot (so has
// its page), and a page only some roles can change has a lock. Only what applies
// is shown: merchant settings for merchant-side workspaces, the team and the log
// for workspaces. Links keep working: 'cov:go' { section: 'settings', tab: <page id> }
// (the old 'settings' tab opens Profile).
import React from 'react'
import { TeamPanel } from '../AuthScreens.jsx'
import { AuditPanel } from '../AuditPanel.jsx'
import { RetentionPanel } from '../RetentionPanel.jsx'
import { WorkflowPanel } from '../WorkflowPanel.jsx'
import { QaPanel } from '../QaPanel.jsx'
import { ImportPanel } from '../ImportPanel.jsx'
import { FincrimeSettings } from '../FincrimeSettings.jsx'
import { ConnectionsPanel } from '../ConnectionsPanel.jsx'
import { ClaimFormSettings } from '../ClaimFormSettings.jsx'
import { DEFAULT_SETTINGS } from '../shared.jsx'
import { SIDES, alertsSource, doesMerchant, workspaceSides } from '../sides.mjs'


const GROUPS = ['Workspace', 'Team & access', 'Cases & workflow', 'Financial crime', 'Integrations', 'Records']
// who: the lowest role that can change the page (admin, or reviewer = admins and reviewers)
// keys: the settings on the page, for the changed dot and Reset; find: what else search can match
const PAGES = [
  { group: 'Workspace', id: 'profile', label: 'Profile', who: 'reviewer', blurb: 'Who you are and the rules you work under. Used in filing packages, Duo sessions and AI triage.',
    keys: ['duoInstitutionName', 'institutionType', 'sides', 'jurisdiction', 'regulatoryRegime'] },
  { group: 'Workspace', id: 'views', label: 'Default views', who: 'reviewer', blurb: 'Where each screen starts for everyone at the institution. Anyone can change them on the page.',
    keys: ['homeRange', 'homeCasesOpen', 'triageDefaultTab', 'triageDefaultSide'] },
  { group: 'Workspace', id: 'modules', label: 'Modules', who: 'reviewer', blurb: 'Parts of Covalence you can switch off.', keys: ['dfaEnabled', 'snapshotEnabled'] },
  { group: 'Team & access', id: 'team', label: 'Team', who: 'admin', workspace: true, blurb: 'Who’s in the workspace, their roles, and invites.',
    find: ['Invite someone', 'Roles', 'Remove a member', 'Admin', 'Reviewer', 'Analyst', 'Auditor'] },
  { group: 'Cases & workflow', id: 'workflow', label: 'Workflow', who: 'reviewer', workspace: true, blurb: 'Service targets, who gets new cases, escalation and reminders.',
    keys: ['slaAssignHours', 'slaFileBusinessDays', 'reminderLeadDays', 'regEWarnDays', 'autoAssign', 'autoAssignRoles', 'escalateTo', 'escalateOnBreach', 'escalateAmount', 'emailReminders'],
    find: ['SLA targets', 'Owner assigned within (hours)', 'Filed with the network within (business days)', 'Warn before a response deadline (days)', 'Warn before the Reg E 45-day limit (days)', 'Auto-assignment', 'Who gets cases', 'Escalation', 'Escalate to', 'Escalate cases worth at least', 'Reminders', 'Daily email'] },
  { group: 'Cases & workflow', id: 'filing', label: 'Deadlines and filing', who: 'reviewer', blurb: 'Filing windows, the daily batch and the provisional credit milestones.',
    keys: ['smallDollarThreshold', 'fraudWindowDays', 'consumerWindowDays', 'absoluteCapDays', 'trackerWindowDays', 'batchFileTime', 'pcMilestones'] },
  { group: 'Cases & workflow', id: 'merchant', label: 'Chargebacks against you', who: 'reviewer', when: sides => doesMerchant(sides), blurb: 'How Multi answers chargebacks raised against you, and your chargeback ratio.',
    keys: ['mchRespondDays', 'mchAcceptBelow', 'mchFightCost', 'mchMonthlyTxVisa', 'mchMonthlyTxMc', 'mchRatioVisa', 'mchRatioMc'] },
  { group: 'Cases & workflow', id: 'qa', label: 'Quality review', who: 'reviewer', workspace: true, blurb: 'The monthly sample of closed cases a reviewer checks.',
    keys: ['qaSampleRate', 'qaAlwaysLost', 'qaAlwaysAiDisagreed'], find: ['Sample rate percent', 'Always review lost cases', 'Always review cases where people disagreed with the AI', 'Someone else reviews your own cases'] },
  { group: 'Financial crime', id: 'fincrime', label: 'Financial crime', who: 'reviewer', workspace: true, blurb: 'Fraud alert rules, AML monitoring rules and sanctions screening.',
    keys: ['fraudEnabled', 'fraudContactHours', 'tmEnabled', 'tmCtr', 'tmRapidMin', 'tmFanCount', 'tmVelocityMultiple', 'tmVelocityMin', 'tmCryptoMin', 'tmRoundMin', 'tmHighRiskCountries', 'screeningAuto', 'screeningThreshold',
      'fraudAtoMin', 'fraudCardTestMax', 'fraudCardTestCount', 'fraudScamMin', 'fraudDormantDays', 'fraudDormantMin', 'fraudCppMin', 'fraudNewAddressMin'],
    find: ['Fraud alerts (001 Triage)', 'AML monitoring rules (005 Licit)', 'Sanctions lists', 'Reach the customer within hours', 'Account takeover', 'Card testing', 'Scam victim', 'Dormant account', 'Cash reporting (CTR)', 'Structuring', 'High-risk countries', 'Rapid movement', 'Where the work happens'] },
  { group: 'Financial crime', id: 'sar', label: 'SAR / STR thresholds', who: 'reviewer', blurb: 'The amount, by payment type, at which a case is considered for a suspicious activity report.',
    keys: ['sarThreshold', 'sarThresholdACH', 'sarThresholdP2P', 'sarThresholdCrypto'] },
  { group: 'Integrations', id: 'connections', label: 'Connections', who: 'admin', workspace: true, blurb: 'Your systems sending data to Covalence, and Covalence acting in them.',
    find: ['API keys', 'Create a key', 'Act in your systems', 'Your endpoint', 'Signing secret', 'Alert notifications', 'Slack', 'For your developers', 'Developer guide'] },
  { group: 'Integrations', id: 'claimform', label: 'Claim form', who: 'reviewer', workspace: true, blurb: 'The form your customers fill in when you send them a claim link: your name, colour, logo and phone number.',
    find: ['Hosted claim form', 'Claim link', 'Brand colour', 'Logo', 'Support phone number', 'Help page'] },
  { group: 'Integrations', id: 'import', label: 'Import cases', who: 'reviewer', workspace: true, blurb: 'Bring cases in from a CSV or spreadsheet export.', find: ['CSV', 'Mapping', 'Spreadsheet'] },
  { group: 'Records', id: 'audit', label: 'Audit log', workspace: true, blurb: 'Everything that happened in the workspace, in a chain that can’t be changed.', find: ['Export the log', 'Verify the chain'] },
  { group: 'Records', id: 'retention', label: 'Data retention', who: 'admin', workspace: true, blurb: 'How long closed cases are kept, and legal holds.', find: ['Retention period', 'Legal hold', 'Purge'] },
]
const INSTITUTION = ['profile', 'views', 'modules', 'filing', 'merchant', 'sar']
// Field labels and hints on the pages above that live in this file, for search
const FIELDS = {
  profile: [['Institution Name', 'Used in filing packages, Duo sessions and AI triage context.'], ['Institution Type', 'credit union bank fintech exchange merchant processor'], ['What you do', 'issuer acquirer merchant menu order'], ['Jurisdiction', 'SAR STR thresholds country'], ['Consumer Protection Regime', 'Reg E FCAC FCA filing windows']],
  views: [['Home date range', 'period Home covers'], ['Home case list', 'open or folded'], ['Triage opens on', 'alerts claims'], ['Triage side', 'Financial Institution Crypto Exchange']],
  modules: [['DFA Scoring Engine', 'Dispute Funding Analyzer'], ['Home Snapshot', 'resolution time fraud service split']],
  filing: [['Small-Dollar Write-Off Threshold ($)', 'courtesy credit'], ['Fraud Filing Window (days)', 'Visa Mastercard 120 days'], ['Consumer Dispute Window (days)', 'expected delivery'], ['Absolute Cap (days)', '540 days'], ['Tracker Window (days)', 'tracker'], ['Batch Filing Time (daily auto-file)', 'batch Multi'], ['PC Milestones (business days)', 'provisional credit countdown']],
  merchant: [['Days to answer', 'acquirer deadline'], ['Accept chargebacks under ($)', 'accept in bulk'], ['Cost to fight one ($)', 'fees staff time'], ['Card sales per month — Visa / Mastercard', 'chargeback ratio'], ['Ratio thresholds, % — Visa / Mastercard', 'VAMP ECM']],
  sar: [['Card / General ($)', 'card fraud'], ['ACH / EFT ($)', 'bank transfer'], ['P2P / E-Transfer ($)', 'Zelle Interac wire'], ['Crypto / Digital Asset ($)', 'virtual asset']],
}
function searchSettings(q, pages) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const match = text => words.every(w => text.toLowerCase().includes(w))
  const out = []
  for (const p of pages) {
    if (match(`${p.label} ${p.group} ${p.blurb || ''}`)) out.push({ page: p, label: p.label })
    for (const [label, hint] of FIELDS[p.id] || []) if (match(`${label} ${hint} ${p.label}`)) out.push({ page: p, label })
    for (const label of p.find || []) if (match(`${label} ${p.label}`)) out.push({ page: p, label })
  }
  return out.slice(0, 12)
}
const Lock = ({ title }) => (
  <svg width="10" height="11" viewBox="0 0 10 11" role="img" aria-label={title || 'Restricted'} style={{ flexShrink:0 }}>
    {title && <title>{title}</title>}
    <rect x="1" y="4.5" width="8" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export function SettingsView({ settings, setSettings, covUser, outcomes, setOutcomes, team }) {
  const [saved, setSaved] = React.useState(false)
  const set = (key, val) => {
    setSettings(prev => ({ ...prev, [key]: val }))
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }
  const agent = (() => { try { return JSON.parse(localStorage.getItem('cov_user') || 'null') } catch { return null } })()
  // Institution settings: admins and reviewers change them; analysts and auditors see them (enforced in the database too)
  const locked = !!(covUser?.authed || covUser?.demo) && !['admin', 'reviewer'].includes(covUser.role)
  const sides = workspaceSides(settings, { demo: !!covUser?.demo && !covUser?.authed })
  const workspace = covUser?.authed || covUser?.demo   // demo visitors get Demo Bank's team, log and retention
  // Pages in groups, Linear-style; only what applies to this workspace (PAGES below)
  const role = covUser?.role || ''
  const pages = PAGES.filter(p => (!p.workspace || workspace) && (!p.when || p.when(sides)))
  const legacy = { settings: 'profile' }   // old tab names in links and in this browser
  const [tab, setTab] = React.useState(() => { try { const t = localStorage.getItem('cov_settings_tab') || 'profile'; return legacy[t] || t } catch { return 'profile' } })
  const activeTab = pages.some(p => p.id === tab) ? tab : 'profile'
  const page = pages.find(p => p.id === activeTab)
  const [q, setQ] = React.useState(''), [flash, setFlash] = React.useState(null), [lit, setLit] = React.useState('')
  const pickTab = (k, label) => { k = legacy[k] || k; setTab(k); setQ(''); setFlash(label || null); try { localStorage.setItem('cov_settings_tab', k) } catch {} }
  React.useEffect(() => {
    const h = e => { if (e.detail?.section === 'settings' && e.detail.tab) pickTab(e.detail.tab) }
    window.addEventListener('cov:go', h); return () => window.removeEventListener('cov:go', h)
  }, [])
  // A search result: once its page is showing, bring the setting into view and mark it for a moment
  const content = React.useRef(null)
  React.useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => {
      // The setting by its exact name, or else the shortest label that starts with it ("Slack" → "Slack incoming webhook")
      const want = flash.toLowerCase(), text = e => (e.dataset?.setting || e.textContent || '').trim().toLowerCase()
      const all = [...(content.current?.querySelectorAll('[data-setting], label, h2, h3, legend, span, div, button') || [])]
      const el = all.find(e => text(e) === want)
        || all.filter(e => text(e).startsWith(want) && text(e).length < want.length + 60).sort((x, y) => text(x).length - text(y).length)[0]
      const box = el?.closest('[data-setting-box]') || el
      if (box) {
        box.scrollIntoView({ block:'center', behavior:'smooth' })
        // A field on this page is drawn again on each change, so it carries the mark itself; a panel's element takes a class
        if (el.dataset?.setting) { setLit(el.dataset.setting); setTimeout(() => setLit(''), 1800) }
        else { box.classList.add('cov-set-flash'); setTimeout(() => box.classList.remove('cov-set-flash'), 1800) }
      }
      setFlash(null)
    }, 80)
    return () => clearTimeout(t)
  }, [flash, activeTab])
  const isChanged = k => String(k).split(',').some(x => JSON.stringify(settings[x] ?? DEFAULT_SETTINGS[x] ?? '') !== JSON.stringify(DEFAULT_SETTINGS[x] ?? ''))
  const pageChanged = p => (p.keys || []).some(isChanged)
  const restricted = p => p.who === 'admin' ? 'Only admins can change these' : p.who === 'reviewer' ? 'Only admins and reviewers can change these' : ''
  const canChange = p => !workspace || !p.who || (p.who === 'admin' ? role === 'admin' : ['admin', 'reviewer'].includes(role))
  const hits = q.trim().length < 2 ? [] : searchSettings(q, pages)
  const resetPage = p => { setSettings(prev => { const n = { ...prev }; (p.keys || []).forEach(k => { n[k] = DEFAULT_SETTINGS[k] }); return n }); setSaved(true); setTimeout(() => setSaved(false), 1800) }

  const Field = ({ label, hint, k, children }) => (
    <div style={{ display:'flex', flexDirection:'column', gap:'6px' }} data-setting-box="" className={lit && lit === label ? 'cov-set-flash' : undefined}>
      <label className="mono-font" data-setting={label} style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#78716C', textTransform:'uppercase', display:'flex', alignItems:'center', gap:'6px' }}>
        {label}{k && isChanged(k) && <span className="cov-set-dot" title="Changed from the default" aria-label="changed from the default" />}
      </label>
      {children}
      {hint && <p className="display-font" style={{ fontSize:'11px', color:'#A8A29E', lineHeight:1.4, margin:0 }}>{hint}</p>}
    </div>
  )
  const Card = ({ title, children }) => (
    <div style={{ border:'1px solid #D4CCBC', background:'#FAF7F1', overflow:'hidden' }}>
      <div style={{ background:'#EEE9E0', borderBottom:'1px solid #D4CCBC', padding:'10px 20px' }}>
        <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E' }}>{title}</span>
      </div>
      <div style={{ padding:'20px', display:'grid', gap:'18px' }}>{children}</div>
    </div>
  )
  const Txt = ({ field, placeholder, hint }) => (
    <input type="text" value={settings[field] || ''} onChange={e => set(field, e.target.value)}
      placeholder={placeholder}
      style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'12px', color:'#1A1814', width:'100%', boxSizing:'border-box', outline:'none' }} />
  )
  const Num = ({ field, hint, min, max, step }) => (
    <input type="number" value={settings[field] ?? DEFAULT_SETTINGS[field]} min={min} max={max} step={step}
      onChange={e => set(field, Number(e.target.value))}
      style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'13px', color:'#1A1814', width:'140px', outline:'none' }} />
  )
  const Sel = ({ field, options }) => (
    <select value={settings[field] || ''} onChange={e => set(field, e.target.value)}
      style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'12px', color:'#1A1814', width:'100%', cursor:'pointer', outline:'none', appearance:'auto' }}>
      <option value="">— select —</option>
      {options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  const Toggle = ({ field, onLabel, offLabel, hint }) => (
    <Field label="" hint={hint}>
      <button onClick={() => set(field, !settings[field])}
        style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 16px', border:'1px solid', cursor:'pointer', width:'fit-content', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.12em', background: settings[field] ? '#064E3B' : '#292524', color: settings[field] ? '#D1FAE5' : '#A8A29E', borderColor: settings[field] ? '#064E3B' : '#44403C', transition:'all 0.15s' }}>
        <span style={{ fontSize:'10px' }}>{settings[field] ? '●' : '○'}</span>
        {settings[field] ? onLabel : offLabel}
      </button>
    </Field>
  )

  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>

      {/* Masthead */}
      <div style={{ borderBottom:'1px solid #D4CCBC', marginBottom:'28px', paddingBottom:'22px', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:'16px' }}>
        <div>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.25em', color:'#A8A29E', marginBottom:'12px' }}>COVALENCE · CONFIGURATION</div>
          <h1 className="display-font font-bold text-stone-900" style={{ fontSize:'clamp(40px,6vw,72px)', letterSpacing:'-0.03em', lineHeight:1 }}>
            <span style={{ fontWeight:700 }}>Set</span><span style={{ fontStyle:'italic', fontWeight:500 }}>tings</span>
          </h1>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px' }}>
          {saved && (
            <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.15em', color:'#065F46', background:'#ECFDF5', padding:'4px 10px', border:'1px solid #6EE7B7' }}>✓ SAVED</div>
          )}
          {agent && (
            <div style={{ textAlign:'right' }}>
              <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#78716C' }}>{agent.name}</div>
              <div className="mono-font" style={{ fontSize:'10px', color:'#A8A29E' }}>{agent.email}{agent.institution ? ` · ${agent.institution}` : ''}</div>
            </div>
          )}
        </div>
      </div>

      <div className="cov-set-grid">
        {/* ── The list: search, then the pages in their groups ── */}
        <nav aria-label="Settings" className="cov-set-nav">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" className="input-field cov-set-search" />
          {q.trim().length >= 2 ? (
            <div role="list" aria-label="Settings found" className="cov-set-results">
              {hits.length === 0 && <p className="display-font" style={{ fontSize:'13px', color:'#6B6259', fontStyle:'italic', margin:'8px 2px' }}>No setting matches “{q.trim()}”.</p>}
              {hits.map(h => (
                <button key={h.page.id + h.label} type="button" role="listitem" className="cov-set-hit" onClick={() => pickTab(h.page.id, h.label)}>
                  <span className="display-font" style={{ display:'block', fontSize:'14px', color:'#1A1814' }}>{h.label}</span>
                  <span className="mono-font" style={{ display:'block', fontSize:'10px', letterSpacing:'0.08em', color:'#6B6259' }}>{h.page.group.toUpperCase()} · {h.page.label.toUpperCase()}</span>
                </button>
              ))}
            </div>
          ) : (<>
            {/* Phone: one menu instead of the list */}
            <select className="input-field cov-set-select" value={activeTab} onChange={e => pickTab(e.target.value)} aria-label="Settings page">
              {GROUPS.map(g => { const ps = pages.filter(p => p.group === g); return ps.length > 0 && <optgroup key={g} label={g}>{ps.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup> })}
            </select>
            <div className="cov-set-list">
              {GROUPS.map(g => {
                const ps = pages.filter(p => p.group === g)
                return ps.length > 0 && (
                  <div key={g} className="cov-set-group">
                    <div className="mono-font cov-set-group-title">{g.toUpperCase()}</div>
                    {ps.map(p => (
                      <button key={p.id} type="button" aria-current={activeTab === p.id ? 'page' : undefined} className={`cov-set-item ${activeTab === p.id ? 'active' : ''}`} onClick={() => pickTab(p.id)}>
                        <span>{p.label}</span>
                        <span style={{ display:'inline-flex', gap:'6px', alignItems:'center' }}>
                          {pageChanged(p) && <span className="cov-set-dot" title="Changed from the default" aria-label="changed from the default" />}
                          {p.who && !canChange(p) && <Lock title={restricted(p)} />}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </>)}
        </nav>

        {/* ── The page ── */}
        <div ref={content} style={{ minWidth:0 }}>
          <div style={{ marginBottom:'18px' }}>
            <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#8A7F72', marginBottom:'4px' }}>{page.group.toUpperCase()}</div>
            <h2 className="display-font" style={{ fontSize:'28px', fontWeight:600, color:'#1A1814', margin:0, letterSpacing:'-0.01em' }}>{page.label}</h2>
            {page.blurb && <p className="display-font" style={{ fontSize:'15px', color:'#57534E', margin:'6px 0 0', lineHeight:1.5, maxWidth:'680px' }}>{page.blurb}</p>}
            {page.who && workspace && (
              <p className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.08em', color: canChange(page) ? '#6B6259' : '#92400E', margin:'8px 0 0', display:'flex', alignItems:'center', gap:'6px' }}>
                <Lock /> {restricted(page).toUpperCase()}{!canChange(page) ? ' · YOU CAN SEE THEM' : ''}
              </p>
            )}
          </div>

      {activeTab === 'workflow'  && <WorkflowPanel settings={settings} set={set} locked={locked} covUser={covUser} outcomes={outcomes || []} team={team || []} />}
      {activeTab === 'qa'        && <QaPanel settings={settings} set={set} locked={locked} covUser={covUser} outcomes={outcomes || []} setOutcomes={setOutcomes} />}
      {activeTab === 'fincrime'  && <FincrimeSettings settings={settings} set={set} locked={locked} outcomes={outcomes || []} admin={covUser?.role === 'admin'} />}
      {activeTab === 'connections' && <ConnectionsPanel covUser={covUser} />}
      {activeTab === 'claimform' && <ClaimFormSettings locked={!canChange(page)} demo={!!covUser?.demo && !covUser?.authed} />}
      {activeTab === 'import'    && <ImportPanel covUser={covUser} locked={locked} outcomes={outcomes || []} setOutcomes={setOutcomes} />}
      {activeTab === 'team'      && <TeamPanel covUser={covUser} />}
      {activeTab === 'audit'     && <AuditPanel covUser={covUser} />}
      {activeTab === 'retention' && <RetentionPanel covUser={covUser} />}

      {INSTITUTION.includes(activeTab) && (
      <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, minWidth:0, opacity: locked ? 0.75 : 1 }}>
      {activeTab === 'profile' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
        {/* ── Institution Profile ── */}
        <Card title="INSTITUTION PROFILE">
          <Field k="duoInstitutionName" label="Institution Name" hint="Used in filing packages, Duo sessions and AI triage context.">
            <Txt field="duoInstitutionName" placeholder="First Community Credit Union" />
          </Field>
          <Field k="institutionType" label="Institution Type" hint="Informs AI analysis — credit unions have different chargeback obligations than banks.">
            <Sel field="institutionType" options={[['bank','Bank'],['credit_union','Credit Union'],['fintech','Fintech / Neo-bank'],['mse','Money Service Business'],['exchange','Crypto Exchange / Platform'],['merchant','Merchant'],['processor','Payment Processor / Acquirer']]} />
          </Field>
          <Field k="sides" label="What you do" hint="Sets the menu order and where each tool starts. Every tool stays on the menu. Leave as it is to follow the institution type.">
            <div role="group" aria-label="What you do" style={{ display:'grid', gap:'6px' }}>
              {SIDES.map(([k, l, d]) => (
                <label key={k} className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'flex-start', cursor:'pointer' }}>
                  <input type="checkbox" checked={sides.includes(k)} style={{ marginTop:'4px' }}
                    onChange={e => { const next = e.target.checked ? [...sides, k] : sides.filter(x => x !== k); if (next.length) set('sides', SIDES.map(([x]) => x).filter(x => next.includes(x))) }} />
                  <span>{l} <span style={{ display:'block', fontSize:'12px', color:'#6B6259' }}>{d}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field k="jurisdiction" label="Jurisdiction" hint="Sets the regulatory lens for SAR/STR thresholds and consumer protection rules.">
            <Sel field="jurisdiction" options={[['us','United States'],['ca','Canada'],['uk','United Kingdom'],['other','Other']]} />
          </Field>
          <Field k="regulatoryRegime" label="Consumer Protection Regime" hint="Calibrates filing windows and dispute eligibility rules in Triage.">
            <Sel field="regulatoryRegime" options={[['reg_e','Reg E (US — EFTA)'],['fcac','FCAC (Canada)'],['fca','FCA (UK)'],['other','Other / Mixed']]} />
          </Field>
        </Card>
        </div>
      )}
      {activeTab === 'views' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
        {/* ── Default views: where each screen starts for everyone at the institution ── */}
        <Card title="DEFAULT VIEWS">
          <Field k="homeRange" label="Home date range" hint="The period Home’s cases and numbers cover when it opens. Anyone can change it on the page.">
            <Sel field="homeRange" options={[['7','Last 7 days'],['30','Last 30 days'],['60','Last 60 days'],['90','Last 90 days'],['all','All time']]} />
          </Field>
          <Field k="homeCasesOpen" label="Home case list" hint="Whether the full case list starts open or folded away.">
            <Sel field="homeCasesOpen" options={[['closed','Folded away'],['open','Open']]} />
          </Field>
          <Field k="triageDefaultTab" label="Triage opens on" hint="Alerts suit a team whose systems send data to Covalence; Claims suits one that starts from customer reports.">
            <Sel field="triageDefaultTab" options={[['alerts',`Alerts — ${alertsSource(sides, settings.institutionType === 'exchange').toLowerCase()}`],['claims','Claims — the customer reported it']]} />
          </Field>
          <Field k="triageDefaultSide" label="Triage side" hint="Leave on automatic to follow the institution type (crypto exchanges open on the Crypto Exchange side).">
            <Sel field="triageDefaultSide" options={[['auto','Automatic'],['fi','Financial Institution'],['ce','Crypto Exchange']]} />
          </Field>
        </Card>
        </div>
      )}
      {activeTab === 'modules' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
        {/* ── Module Settings ── */}
        <Card title="MODULE SETTINGS">
          <Field k="dfaEnabled" label="DFA Scoring Engine" hint="Toggle the Dispute Funding Analyzer scoring engine. Default: on.">
            <button onClick={() => set('dfaEnabled', settings.dfaEnabled === false ? true : false)}
              style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 16px', border:'1px solid', cursor:'pointer', width:'fit-content', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.12em', background: settings.dfaEnabled !== false ? '#064E3B' : '#292524', color: settings.dfaEnabled !== false ? '#D1FAE5' : '#A8A29E', borderColor: settings.dfaEnabled !== false ? '#064E3B' : '#44403C', transition:'all 0.15s' }}>
              <span style={{ fontSize:'10px' }}>{settings.dfaEnabled !== false ? '●' : '○'}</span>
              {settings.dfaEnabled !== false ? 'DFA ON' : 'DFA OFF'}
            </button>
          </Field>
          <Field k="snapshotEnabled" label="Home Snapshot" hint="Show resolution time, fraud / service split and top category in Home’s numbers.">
            <button onClick={() => set('snapshotEnabled', settings.snapshotEnabled === false ? true : false)}
              style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 16px', border:'1px solid', cursor:'pointer', width:'fit-content', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.12em', background: settings.snapshotEnabled !== false ? '#064E3B' : '#292524', color: settings.snapshotEnabled !== false ? '#D1FAE5' : '#A8A29E', borderColor: settings.snapshotEnabled !== false ? '#064E3B' : '#44403C', transition:'all 0.15s' }}>
              <span style={{ fontSize:'10px' }}>{settings.snapshotEnabled !== false ? '●' : '○'}</span>
              {settings.snapshotEnabled !== false ? 'SNAPSHOT ON' : 'SNAPSHOT OFF'}
            </button>
          </Field>
        </Card>
        </div>
      )}
      {activeTab === 'filing' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
        {/* ── Filing Windows ── */}
        <Card title="FILING WINDOWS">
          <Field k="smallDollarThreshold" label="Small-Dollar Write-Off Threshold ($)" hint="Cases below this amount may be courtesy-credited directly."><Num field="smallDollarThreshold" min={0} /></Field>
          <Field k="fraudWindowDays" label="Fraud Filing Window (days)" hint="Visa/MC standard: 120 days from transaction."><Num field="fraudWindowDays" min={1} /></Field>
          <Field k="consumerWindowDays" label="Consumer Dispute Window (days)" hint="Typically 120 days from expected delivery."><Num field="consumerWindowDays" min={1} /></Field>
          <Field k="absoluteCapDays" label="Absolute Cap (days)" hint="Hard cap on any filing. Visa: 540 days from transaction."><Num field="absoluteCapDays" min={1} /></Field>
        </Card>
        {/* ── Operational Defaults ── */}
        <Card title="OPERATIONAL DEFAULTS">
          <Field k="trackerWindowDays" label="Tracker Window (days)" hint="Days of cases shown in the tracker.">
            <Num field="trackerWindowDays" min={1} max={365} />
          </Field>
          <Field k="batchFileTime" label="Batch Filing Time (daily auto-file)" hint="Queued fraud cases auto-file at this time daily when the Multi tab is open.">
            <input type="time" value={settings.batchFileTime || '15:00'}
              onChange={e => set('batchFileTime', e.target.value)}
              style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'13px', color:'#1A1814', width:'140px', outline:'none', cursor:'pointer' }} />
          </Field>
          <Field k="pcMilestones" label="PC Milestones (business days)" hint="Three milestone deadlines shown on the PC countdown row.">
            <div style={{ display:'flex', gap:'8px' }}>
              {(settings.pcMilestones || DEFAULT_SETTINGS.pcMilestones).map((m, i) => (
                <input key={i} type="number" value={m} min={1}
                  onChange={e => set('pcMilestones', (settings.pcMilestones || DEFAULT_SETTINGS.pcMilestones).map((v,j) => j===i ? parseInt(e.target.value)||v : v))}
                  style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'13px', color:'#1A1814', width:'72px', textAlign:'center', outline:'none' }} />
              ))}
            </div>
          </Field>
        </Card>
        </div>
      )}
      {activeTab === 'merchant' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
        <Card title="CHARGEBACKS AGAINST YOU">
          <Field k="mchRespondDays" label="Days to answer" hint="Your acquirer’s deadline, counted from when a chargeback arrives. A case with its own response date uses that instead.">
            <Num field="mchRespondDays" min={1} max={45} />
          </Field>
          <Field k="mchAcceptBelow" label="Accept chargebacks under ($)" hint="Multi recommends accepting these and can accept them in bulk. 0 turns it off.">
            <Num field="mchAcceptBelow" min={0} max={10000} />
          </Field>
          <Field k="mchFightCost" label="Cost to fight one ($)" hint="Staff time and fees to prepare a response. Multi recommends fighting only when the likely recovery is worth more.">
            <Num field="mchFightCost" min={0} max={10000} />
          </Field>
          <Field k="mchMonthlyTxVisa,mchMonthlyTxMc" label="Card sales per month — Visa / Mastercard" hint="For the chargeback ratio on Home: chargebacks in the last 30 days over these. Leave at 0 if you don’t know.">
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}><Num field="mchMonthlyTxVisa" min={0} max={100000000} /><Num field="mchMonthlyTxMc" min={0} max={100000000} /></div>
          </Field>
          <Field k="mchRatioVisa,mchRatioMc" label="Ratio thresholds, % — Visa / Mastercard" hint="Defaults follow Visa VAMP (1.5% from 2026) and Mastercard ECM (1.5%). Use your acquirer’s figures if they differ; Home warns from two thirds of these.">
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}><Num field="mchRatioVisa" min={0.1} max={10} step={0.1} /><Num field="mchRatioMc" min={0.1} max={10} step={0.1} /></div>
          </Field>
        </Card>
        </div>
      )}
      {activeTab === 'sar' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px', alignItems:'start' }}>
        {/* ── SAR / STR Thresholds ── */}
        <Card title="SAR / STR THRESHOLDS BY PAYMENT TYPE">
          <Field k="sarThreshold" label="Card / General ($)" hint="Debit and credit card fraud cases."><Num field="sarThreshold" min={0} /></Field>
          <Field k="sarThresholdACH" label="ACH / EFT ($)" hint="ACH / EFT / bank transfer fraud."><Num field="sarThresholdACH" min={0} /></Field>
          <Field k="sarThresholdP2P" label="P2P / E-Transfer ($)" hint="Zelle, Interac e-Transfer, wire fraud."><Num field="sarThresholdP2P" min={0} /></Field>
          <Field k="sarThresholdCrypto" label="Crypto / Digital Asset ($)" hint="Higher default reflects FinCEN/FINTRAC guidance for virtual asset MSBs."><Num field="sarThresholdCrypto" min={0} /></Field>
        </Card>
        </div>
      )}
      <div style={{ marginTop:'28px', paddingTop:'20px', borderTop:'1px solid #E8E3DA', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
        <p className="display-font text-stone-400" style={{ fontSize:'12px', margin:0 }}>Saved automatically as you type.</p>
        {pageChanged(page) && (
          <button onClick={() => resetPage(page)} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.15em', padding:'8px 16px', border:'1px solid #D4CCBC', color:'#78716C', background:'transparent', cursor:'pointer' }}>
            RESET THIS PAGE TO DEFAULTS
          </button>
        )}
      </div>
      </fieldset>
      )}
        </div>
      </div>
    </div>
  )
}

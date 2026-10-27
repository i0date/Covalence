// SETTINGS — institution profile, thresholds, defaults, team
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React from 'react'
import { TeamPanel } from '../AuthScreens.jsx'
import { AuditPanel } from '../AuditPanel.jsx'
import { RetentionPanel } from '../RetentionPanel.jsx'
import { DEFAULT_SETTINGS } from '../shared.jsx'

export function SettingsView({ settings, setSettings, covUser }) {
  const [saved, setSaved] = React.useState(false)
  const set = (key, val) => {
    setSettings(prev => ({ ...prev, [key]: val }))
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }
  const agent = (() => { try { return JSON.parse(localStorage.getItem('cov_user') || 'null') } catch { return null } })()
  // Institution settings: admins and reviewers change them; analysts and auditors see them (enforced in the database too)
  const locked = !!(covUser?.authed || covUser?.demo) && !['admin', 'reviewer'].includes(covUser.role)
  const workspace = covUser?.authed || covUser?.demo   // demo visitors get Demo Bank's team, log and retention
  // One section at a time, so the audit log doesn't push the settings down the page
  const TABS = [['settings', 'Institution settings'], ...(workspace ? [['team', 'Team'], ['audit', 'Audit log'], ['retention', 'Data retention']] : [])]
  const [tab, setTab] = React.useState(() => { try { return localStorage.getItem('cov_settings_tab') || 'settings' } catch { return 'settings' } })
  const activeTab = TABS.some(([k]) => k === tab) ? tab : 'settings'
  const pickTab = k => { setTab(k); try { localStorage.setItem('cov_settings_tab', k) } catch {} }

  const Field = ({ label, hint, children }) => (
    <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
      <label className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.2em', color:'#78716C', textTransform:'uppercase' }}>{label}</label>
      {children}
      {hint && <p className="display-font" style={{ fontSize:'11px', color:'#A8A29E', lineHeight:1.4, margin:0 }}>{hint}</p>}
    </div>
  )
  const Card = ({ title, children }) => (
    <div style={{ border:'1px solid #D4CCBC', background:'#FAF7F1', overflow:'hidden' }}>
      <div style={{ background:'#EEE9E0', borderBottom:'1px solid #D4CCBC', padding:'10px 20px' }}>
        <span className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.2em', color:'#57534E' }}>{title}</span>
      </div>
      <div style={{ padding:'20px', display:'grid', gap:'18px' }}>{children}</div>
    </div>
  )
  const Txt = ({ field, placeholder, hint }) => (
    <input type="text" value={settings[field] || ''} onChange={e => set(field, e.target.value)}
      placeholder={placeholder}
      style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'12px', color:'#1A1814', width:'100%', boxSizing:'border-box', outline:'none' }} />
  )
  const Num = ({ field, hint, min, max }) => (
    <input type="number" value={settings[field] ?? DEFAULT_SETTINGS[field]} min={min} max={max}
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
        <span style={{ fontSize:'7px' }}>{settings[field] ? '●' : '○'}</span>
        {settings[field] ? onLabel : offLabel}
      </button>
    </Field>
  )

  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>

      {/* Masthead */}
      <div style={{ borderBottom:'1px solid #D4CCBC', marginBottom:'40px', paddingBottom:'24px', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:'16px' }}>
        <div>
          <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.25em', color:'#A8A29E', marginBottom:'12px' }}>COVALENCE · CONFIGURATION</div>
          <h1 className="display-font font-bold text-stone-900" style={{ fontSize:'clamp(40px,6vw,72px)', letterSpacing:'-0.03em', lineHeight:1 }}>
            <span style={{ fontWeight:700 }}>Set</span><span style={{ fontStyle:'italic', fontWeight:500 }}>tings</span>
          </h1>
          <p className="display-font text-stone-500 mt-3" style={{ fontSize:'14px', lineHeight:1.5, maxWidth:'480px' }}>
            Institution profile, compliance thresholds, and operational defaults — applied across all tools and fed into the AI triage engine.
          </p>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px' }}>
          {saved && (
            <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.15em', color:'#065F46', background:'#ECFDF5', padding:'4px 10px', border:'1px solid #6EE7B7' }}>✓ SAVED</div>
          )}
          {agent && (
            <div style={{ textAlign:'right' }}>
              <div className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.12em', color:'#78716C' }}>{agent.name}</div>
              <div className="mono-font" style={{ fontSize:'8px', color:'#A8A29E' }}>{agent.email}{agent.institution ? ` · ${agent.institution}` : ''}</div>
            </div>
          )}
        </div>
      </div>

      {TABS.length > 1 && (
        <div role="tablist" aria-label="Settings sections" className="cov-settings-tabs" style={{ display:'flex', gap:'2px', borderBottom:'1px solid #D4CCBC', marginBottom:'24px', overflowX:'auto' }}>
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={activeTab === k} onClick={() => pickTab(k)} className="mono-font"
              style={{ background:'none', border:'none', borderBottom: activeTab === k ? '2px solid #1A1814' : '2px solid transparent', marginBottom:'-1px',
                padding:'10px 14px', fontSize:'10px', letterSpacing:'0.14em', textTransform:'uppercase', whiteSpace:'nowrap', cursor:'pointer',
                color: activeTab === k ? '#1A1814' : '#8A7F72' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'team'      && <TeamPanel covUser={covUser} />}
      {activeTab === 'audit'     && <AuditPanel covUser={covUser} />}
      {activeTab === 'retention' && <RetentionPanel covUser={covUser} />}

      {activeTab === 'settings' && (<>
      {locked && (
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.08em', color:'#57534E', border:'1px dashed #B8B0A4', padding:'10px 14px', marginBottom:'16px' }}>
          These are {covUser.institution}’s settings. Only admins and reviewers can change them — ask an admin if something needs updating.
        </div>
      )}
      <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, minWidth:0, opacity: locked ? 0.75 : 1 }}>

      {/* Two-column grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:'20px', alignItems:'start' }}>

        {/* ── Institution Profile ── */}
        <Card title="INSTITUTION PROFILE">
          <Field label="Institution Name" hint="Used in filing packages, Duo sessions and AI triage context.">
            <Txt field="duoInstitutionName" placeholder="First Community Credit Union" />
          </Field>
          <Field label="Institution Type" hint="Informs AI analysis — credit unions have different chargeback obligations than banks.">
            <Sel field="institutionType" options={[['bank','Bank'],['credit_union','Credit Union'],['fintech','Fintech / Neo-bank'],['mse','Money Service Business'],['exchange','Crypto Exchange / Platform']]} />
          </Field>
          <Field label="Jurisdiction" hint="Sets the regulatory lens for SAR/STR thresholds and consumer protection rules.">
            <Sel field="jurisdiction" options={[['us','United States'],['ca','Canada'],['uk','United Kingdom'],['other','Other']]} />
          </Field>
          <Field label="Consumer Protection Regime" hint="Calibrates filing windows and dispute eligibility rules in Triage.">
            <Sel field="regulatoryRegime" options={[['reg_e','Reg E (US — EFTA)'],['fcac','FCAC (Canada)'],['fca','FCA (UK)'],['other','Other / Mixed']]} />
          </Field>
        </Card>

        {/* ── SAR / STR Thresholds ── */}
        <Card title="SAR / STR THRESHOLDS BY PAYMENT TYPE">
          <Field label="Card / General ($)" hint="Debit and credit card fraud cases."><Num field="sarThreshold" min={0} /></Field>
          <Field label="ACH / EFT ($)" hint="ACH / EFT / bank transfer fraud."><Num field="sarThresholdACH" min={0} /></Field>
          <Field label="P2P / E-Transfer ($)" hint="Zelle, Interac e-Transfer, wire fraud."><Num field="sarThresholdP2P" min={0} /></Field>
          <Field label="Crypto / Digital Asset ($)" hint="Higher default reflects FinCEN/FINTRAC guidance for virtual asset MSBs."><Num field="sarThresholdCrypto" min={0} /></Field>
        </Card>

        {/* ── Filing Windows ── */}
        <Card title="FILING WINDOWS">
          <Field label="Small-Dollar Write-Off Threshold ($)" hint="Cases below this amount may be courtesy-credited directly."><Num field="smallDollarThreshold" min={0} /></Field>
          <Field label="Fraud Filing Window (days)" hint="Visa/MC standard: 120 days from transaction."><Num field="fraudWindowDays" min={1} /></Field>
          <Field label="Consumer Dispute Window (days)" hint="Typically 120 days from expected delivery."><Num field="consumerWindowDays" min={1} /></Field>
          <Field label="Absolute Cap (days)" hint="Hard cap on any filing. Visa: 540 days from transaction."><Num field="absoluteCapDays" min={1} /></Field>
        </Card>

        {/* ── Operational Defaults ── */}
        <Card title="OPERATIONAL DEFAULTS">
          <Field label="Tracker Window (days)" hint="Days of cases shown in tracker and home screen.">
            <Num field="trackerWindowDays" min={1} max={365} />
          </Field>
          <Field label="Batch Filing Time (daily auto-file)" hint="Queued fraud cases auto-file at this time daily when the Multi tab is open.">
            <input type="time" value={settings.batchFileTime || '15:00'}
              onChange={e => set('batchFileTime', e.target.value)}
              style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'13px', color:'#1A1814', width:'140px', outline:'none', cursor:'pointer' }} />
          </Field>
          <Field label="PC Milestones (business days)" hint="Three milestone deadlines shown on the PC countdown row.">
            <div style={{ display:'flex', gap:'8px' }}>
              {(settings.pcMilestones || DEFAULT_SETTINGS.pcMilestones).map((m, i) => (
                <input key={i} type="number" value={m} min={1}
                  onChange={e => set('pcMilestones', (settings.pcMilestones || DEFAULT_SETTINGS.pcMilestones).map((v,j) => j===i ? parseInt(e.target.value)||v : v))}
                  style={{ background:'white', border:'1px solid #D4CCBC', padding:'9px 12px', fontFamily:"'JetBrains Mono',monospace", fontSize:'13px', color:'#1A1814', width:'72px', textAlign:'center', outline:'none' }} />
              ))}
            </div>
          </Field>
        </Card>

        {/* ── Module Settings ── */}
        <Card title="MODULE SETTINGS">
          <Field label="DFA Scoring Engine" hint="Toggle the Dispute Funding Analyzer scoring engine. Default: on.">
            <button onClick={() => set('dfaEnabled', settings.dfaEnabled === false ? true : false)}
              style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 16px', border:'1px solid', cursor:'pointer', width:'fit-content', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.12em', background: settings.dfaEnabled !== false ? '#064E3B' : '#292524', color: settings.dfaEnabled !== false ? '#D1FAE5' : '#A8A29E', borderColor: settings.dfaEnabled !== false ? '#064E3B' : '#44403C', transition:'all 0.15s' }}>
              <span style={{ fontSize:'7px' }}>{settings.dfaEnabled !== false ? '●' : '○'}</span>
              {settings.dfaEnabled !== false ? 'DFA ON' : 'DFA OFF'}
            </button>
          </Field>
          <Field label="Home Snapshot" hint="Show the rolling case snapshot on the home screen.">
            <button onClick={() => set('snapshotEnabled', settings.snapshotEnabled === false ? true : false)}
              style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 16px', border:'1px solid', cursor:'pointer', width:'fit-content', fontFamily:"'JetBrains Mono',monospace", fontSize:'10px', letterSpacing:'0.12em', background: settings.snapshotEnabled !== false ? '#064E3B' : '#292524', color: settings.snapshotEnabled !== false ? '#D1FAE5' : '#A8A29E', borderColor: settings.snapshotEnabled !== false ? '#064E3B' : '#44403C', transition:'all 0.15s' }}>
              <span style={{ fontSize:'7px' }}>{settings.snapshotEnabled !== false ? '●' : '○'}</span>
              {settings.snapshotEnabled !== false ? 'SNAPSHOT ON' : 'SNAPSHOT OFF'}
            </button>
          </Field>
          <Field label="Snapshot Window (days)" hint="Number of days the home snapshot looks back. Default: 60.">
              <Num field="snapshotDays" min={7} max={365} />
            </Field>
        </Card>

      </div>

      {/* Reset */}
      <div style={{ marginTop:'32px', paddingTop:'24px', borderTop:'1px solid #E8E3DA', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
        <p className="display-font text-stone-400" style={{ fontSize:'12px', margin:0 }}>Settings are saved automatically as you type.</p>
        <button onClick={() => { setSettings({ ...DEFAULT_SETTINGS }); setSaved(true); setTimeout(() => setSaved(false), 1800) }}
          className="mono-font" style={{ fontSize:'9px', letterSpacing:'0.15em', padding:'8px 16px', border:'1px solid #D4CCBC', color:'#78716C', background:'transparent', cursor:'pointer' }}>
          RESET TO DEFAULTS
        </button>
      </div>
      </fieldset>
      </>)}

    </div>
  )
}

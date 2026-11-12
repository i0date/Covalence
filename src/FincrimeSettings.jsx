// ═══════════════════════════════════════════════════════════════════════════════
// FRAUD & AML SETTINGS — Settings → Fraud alert rules, Monitoring rules, Screening
// ═══════════════════════════════════════════════════════════════════════════════
// Each rule is a row: what it catches, a switch, and its threshold. A rule switched
// off raises no new alerts; alerts it already raised stay where they are
// (settings.rulesOff, features.mjs). The work itself — alerts, matches, OFAC
// reports, investigations, SARs — happens in 001 Triage and 005 Licit.
import React, { useEffect, useState } from 'react'
import { CLOSED_STATUSES } from './clocks.mjs'
import { FINCRIME_DEFAULTS, screeningStatus } from './fincrime.js'
import { TM_DEFAULTS, FRAUD_DEFAULTS, FRAUD_RULES, RULES } from './monitoring.mjs'
import { ruleOn, switchRule } from './features.mjs'
import { SharingSettings } from './SharingPanel.jsx'

const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—'
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px' }
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 12px', fontWeight:500 }}>{children}</h2>

// [rule, what it catches, [[setting, label, min, max], …]]
const FRAUD_ROWS = [
  ['account_takeover', 'A new device or location, then changes to the profile or password, then money out within 48 hours.', [['fraudAtoMin', 'Money out of at least ($)', 1, 1000000]]],
  ['card_testing', 'A burst of tiny card charges, often at several merchants, before bigger ones.', [['fraudCardTestMax', 'Charges of at most ($)', 1, 50], ['fraudCardTestCount', 'This many within 24 hours', 2, 100]]],
  ['scam_victim', 'A first payment to a new payee, far bigger than usual, sometimes with tell-tale words in the memo.', [['fraudScamMin', 'Payment of at least ($)', 100, 1000000]]],
  ['dormant_awakens', 'An account with no activity for months that suddenly moves money.', [['fraudDormantDays', 'Quiet for (days)', 30, 730], ['fraudDormantMin', 'Then moving at least ($)', 100, 1000000]]],
  ['compromised_merchant', 'Several customers with confirmed card fraud who all used the same merchant beforehand.', [['fraudCppMin', 'Fraud victims who used it, at least', 2, 50]]],
  ['check_duplicate', 'The same check deposited twice, here or by mobile and at a branch.', []],
  ['new_address_withdrawal', 'Exchanges: a withdrawal to an address added the same day and never used before.', [['fraudNewAddressMin', 'Withdrawal of at least ($)', 100, 1000000]]],
]
const TM_ROWS = [
  ['cash_structuring', 'Cash deposits kept just under the reporting threshold.', [['tmCtr', 'Reporting threshold ($)', 1000, 100000]]],
  ['rapid_movement', 'Money that comes in and goes straight back out within 3 days.', [['tmRapidMin', 'At least ($)', 500, 1000000]]],
  ['fan_in', 'Many different senders paying one account within 7 days.', [['tmFanCount', 'Senders or new payees, at least', 2, 100]]],
  ['fan_out', 'Many new payees at once within 7 days (same count as above).', []],
  ['velocity', 'A week’s outflow far above the customer’s usual week.', [['tmVelocityMultiple', 'Times the usual week', 2, 50], ['tmVelocityMin', 'And at least ($)', 500, 1000000]]],
  ['crypto', 'Large amounts sent to crypto within 7 days.', [['tmCryptoMin', 'At least ($)', 100, 1000000]]],
  ['round_amounts', 'Repeated large payments in round dollars.', [['tmRoundMin', 'Payments of at least ($)', 500, 1000000]]],
  ['high_risk_country', 'A payment to or from a country your policy treats as high-risk.', []],
]

// One rule: its name and what it catches, a switch, and its thresholds
function RuleRow({ rule, label, what, fields, s, set, locked, children }) {
  const on = ruleOn(s, rule)
  return (
    <div data-setting-box="" style={{ borderTop:'1px solid #E7E2D9', padding:'14px 0', display:'grid', gap:'10px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px' }}>
        <div style={{ minWidth:0 }}>
          <div className="display-font" data-setting={label} style={{ fontSize:'16px', fontWeight:600, color: on ? '#1A1814' : '#8A7F72' }}>{label}</div>
          <div className="display-font" style={{ fontSize:'13px', color:'#57534E', lineHeight:1.45 }}>{what}</div>
        </div>
        <Switch on={on} label={label} disabled={locked} onChange={v => set('rulesOff', switchRule(s, rule, v))} />
      </div>
      {on && fields.length > 0 && (
        <div style={{ display:'flex', gap:'14px', flexWrap:'wrap' }}>
          {fields.map(([k, l, min, max]) => (
            <label key={k} className="display-font" style={{ fontSize:'13px', color:'#3F3A35', display:'grid', gap:'4px' }}>
              {l}
              <input type="number" min={min} max={max} value={s[k]} disabled={locked}
                onChange={e => set(k, Math.max(min, Math.min(max, Number(e.target.value) || min)))} className="cov-input" style={{ width:'130px', padding:'6px 8px', fontSize:'14px' }} />
            </label>
          ))}
        </div>
      )}
      {on && children}
    </div>
  )
}

// An on/off switch (Settings → Your setup and the rule rows)
export function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="mono-font"
      style={{ flexShrink:0, display:'inline-flex', alignItems:'center', gap:'8px', padding:'5px 10px', border:'1px solid', cursor: disabled ? 'not-allowed' : 'pointer', fontSize:'10px', letterSpacing:'0.12em',
        background: on ? '#064E3B' : '#FFFFFF', color: on ? '#D1FAE5' : '#57534E', borderColor: on ? '#064E3B' : '#A8A29E', opacity: disabled ? 0.6 : 1 }}>
      <span aria-hidden="true">{on ? '●' : '○'}</span>{on ? 'ON' : 'OFF'}
    </button>
  )
}

const ruleNote = 'A rule switched off raises no new alerts. Alerts it already raised stay where they are.'

export function FraudRulesSettings({ settings, set, locked }) {
  const s = { ...FRAUD_DEFAULTS, ...settings }
  return (
    <section style={box}>
      <H2>WHAT RAISES AN ALERT IN 001 TRIAGE</H2>
      <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:'0 0 6px', lineHeight:1.5 }}>The rules run on each day’s files from your systems. {ruleNote}</p>
      <label data-setting-box="" className="display-font" style={{ fontSize:'14px', display:'flex', justifyContent:'space-between', gap:'12px', alignItems:'center', padding:'10px 0' }}>
        <span data-setting="Reach the customer within (hours)">Reach the customer within (hours) <span style={{ display:'block', fontSize:'12px', color:'#6B6259' }}>A clock on every fraud alert. Leave empty for none.</span></span>
        <input type="number" min={1} max={168} value={s.fraudContactHours ?? ''} placeholder="—" disabled={locked}
          onChange={e => set('fraudContactHours', e.target.value === '' ? null : Math.max(1, Math.min(168, Number(e.target.value) || 1)))} className="cov-input" style={{ width:'110px', padding:'6px 8px', fontSize:'14px' }} aria-label="Reach the customer within hours" />
      </label>
      {FRAUD_ROWS.map(([rule, what, fields]) => <RuleRow key={rule} rule={rule} label={FRAUD_RULES[rule].label} what={what} fields={fields} s={s} set={set} locked={locked} />)}
    </section>
  )
}

export function MonitoringRulesSettings({ settings, set, locked }) {
  const s = { ...TM_DEFAULTS, ...settings }
  return (
    <section style={box}>
      <H2>WHAT RAISES AN AML ALERT IN 005 LICIT</H2>
      <p className="display-font" style={{ fontSize:'13px', color:'#57534E', margin:'0 0 6px', lineHeight:1.5 }}>The rules run on every transaction file. {ruleNote}</p>
      {TM_ROWS.map(([rule, what, fields]) => (
        <RuleRow key={rule} rule={rule} label={RULES[rule].label} what={what} fields={fields} s={s} set={set} locked={locked}>
          {rule === 'high_risk_country' && (
            <label className="display-font" style={{ fontSize:'13px', color:'#3F3A35', display:'grid', gap:'4px' }}>
              High-risk countries (ISO codes)
              <input value={s.tmHighRiskCountries} disabled={locked} onChange={e => set('tmHighRiskCountries', e.target.value.toUpperCase())} className="cov-input" style={{ padding:'6px 8px', fontSize:'14px' }} />
              <span style={{ fontSize:'12px', color:'#6B6259' }}>Starts with FATF’s call-for-action list (IR, KP, MM). Add the grey-list and internal high-risk countries your policy names.</span>
            </label>
          )}
        </RuleRow>
      ))}
    </section>
  )
}

export function ScreeningSettings({ settings, set, locked, outcomes, admin }) {
  const s = { ...FINCRIME_DEFAULTS, ...settings }
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/sanctions').then(r => r.json().then(d => r.ok ? setList(d.list) : setErr(d.error || `HTTP ${r.status}`))).catch(() => setErr('The screening service couldn’t be reached.'))
  }, [])

  const real = (outcomes || []).filter(c => !c._triageOnly && !CLOSED_STATUSES.includes(c.status))
  const potential = real.filter(c => screeningStatus(c) === 'potential').length
  const toReport = real.filter(c => screeningStatus(c) === 'confirmed' && !c.ofacReportedAt).length

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:'20px', alignItems:'start' }}>
      <section style={box}>
        <H2>SANCTIONS LISTS</H2>
        {list ? (
          <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.55, margin:'0 0 12px' }}>
            {list.source}: {list.entries.toLocaleString()} entries and {list.wallets} crypto addresses, downloaded from the US Treasury {day(list.fetchedAt)} and refreshed every 12 hours.
          </p>
        ) : <p className="mono-font" style={{ fontSize:'11px', color: err ? '#991B1B' : '#6B6259', margin:'0 0 12px' }}>{err || 'Checking the lists…'}</p>}
        <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, display:'grid', gap:'12px', opacity: locked ? 0.75 : 1 }}>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', cursor:'pointer' }}>
            <input type="checkbox" checked={s.screeningAuto !== false} onChange={e => set('screeningAuto', e.target.checked)} />
            Screen new and changed cases automatically
          </label>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            Flag names that match at least
            <select className="input-field" value={s.screeningThreshold} onChange={e => set('screeningThreshold', Number(e.target.value))} style={{ padding:'6px 8px', fontSize:'14px' }}>
              {[[0.85, '85% — catches more spellings, more to clear'], [0.88, '88%'], [0.9, '90% — recommended'], [0.92, '92%'], [0.95, '95% — fewer alerts, may miss variants']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <p className="display-font" style={{ fontSize:'13px', color:'#57534E', lineHeight:1.5, margin:0 }}>
            Cardholders, merchants and payees, and any crypto wallet addresses in a case, are screened. Wallets must match exactly. Ship and aircraft names are skipped.
            {potential + toReport > 0 && <> Waiting in 005 Licit now: {potential} possible match{potential === 1 ? '' : 'es'}, {toReport} OFAC report{toReport === 1 ? '' : 's'}.</>}
          </p>
        </fieldset>
      </section>
      <SharingSettings admin={admin} />
    </div>
  )
}

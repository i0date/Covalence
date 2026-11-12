// ═══════════════════════════════════════════════════════════════════════════════
// FEATURES — every tool and feature can be switched off (Settings → Your setup)
// ═══════════════════════════════════════════════════════════════════════════════
// Off means gone: not in the menu, not on Home, not in Your day, not in search.
// Switching something off never deletes its data; switching it back on brings it
// back. What's off lives in the institution's settings as settings.off (a list of
// ids), which only admins can change; the database audits every change
// (supabase_features.sql). A feature inside a tool is off when its tool is.
// Single rules (fraud and monitoring) are tuned separately in settings.rulesOff.

export const TOOLS = [
  ['triage',   '001 Triage',       'Alerts and customer claims, and the verdict on each.'],
  ['desk',     '002 Dispute Desk', 'Working cases from intake to resolution.'],
  ['multi',    '003 Multi',        'Filing with the networks, and chargebacks against you.'],
  ['file',     '004 File',         'Network filing packages and their status.'],
  ['licit',    '005 Licit',        'Sanctions, AML alerts, onboarding, investigations and SARs.'],
  ['dfa',      '006 DFA',          'Dispute funding: what to credit while a case is open.'],
  ['duo',      '007 Duo',          'Working a case with the other institution.'],
  ['trio',     '008 Trio',         'One incident across many cases.'],
  ['insights', 'Insights',         'Trends across closed and open cases.'],
].map(([id, label, what]) => ({ id, label, what, tool: true }))

// in: the tool it belongs to · hides: what switching it off takes away
export const FEATURES = [
  { id: 'fraudRules', in: 'triage', label: 'Fraud alerts', what: 'Six fraud rules run on your daily files and raise alerts in Triage.',
    hides: 'Triage → Alerts for banks and exchanges, and Settings → Fraud alert rules. No new fraud alerts are raised.' },
  { id: 'appClaims', in: 'triage', label: 'Claims from your app', what: 'Customers report a problem in your app or website and the claim arrives in Triage.',
    hides: 'The claims list in Triage → Claims, and claims waiting in Your day.' },
  { id: 'claimForm', in: 'triage', label: 'Hosted claim form', what: 'A form with your name on it for banks without developers.',
    hides: 'Settings → Claim form. No new claim links can be made.' },
  { id: 'predispute', in: 'triage', label: 'Pre-dispute alerts', what: 'Ethoca and Verifi warnings before a chargeback, so a refund can come first.',
    hides: 'Triage → Alerts on the Merchant side.' },
  { id: 'warnMerchant', in: 'desk', label: 'Warn the merchant first', what: 'Before filing, warn the merchant through Ethoca or Verifi.',
    hides: 'WARN MCH on cases in the Dispute Desk.' },
  { id: 'tmRules', in: 'licit', label: 'Monitoring rules', what: 'AML rules on every transaction file.',
    hides: 'Licit → Alerts and Settings → Monitoring rules. No new AML alerts are raised.' },
  { id: 'screening', in: 'licit', label: 'Sanctions screening', what: 'Names and wallets on cases checked against OFAC’s lists.',
    hides: 'Licit → Screening log, sanctions matches in Licit and Your day, and Settings → Screening.' },
  { id: 'sar', in: 'licit', label: 'SARs', what: 'Flagging cases for a suspicious activity report, and building it.',
    hides: 'Licit → SAR builder, SAR deadlines in Your day, and Settings → SAR / STR thresholds.' },
  { id: 'onboarding', in: 'licit', label: 'Onboard with Covalence', what: 'KYC and KYB for new customers, so their record starts on day one.',
    hides: 'Licit → Onboarding.' },
  { id: 'alarm', label: 'The alarm', what: 'Raise the alarm when one pattern hits many customers at once.',
    hides: 'The ALARM button and alarms in Your day.' },
  { id: 'pools', label: 'Pools', what: 'Several people from your team working one case together.',
    hides: 'Pools on cases and pool tasks in Your day.' },
]

const ALL = new Map([...TOOLS, ...FEATURES].map(f => [f.id, f]))
export const featureOf = id => ALL.get(id)
const offList = settings => Array.isArray(settings?.off) ? settings.off : []

// Is this tool or feature switched on? A feature is off when its tool is.
export function isOn(settings, id) {
  const off = offList(settings)
  if (off.includes(id)) return false
  const parent = ALL.get(id)?.in
  return parent ? !off.includes(parent) : true
}
// The new list of what's off, sorted so the same set always looks the same
export function switchTo(settings, id, on) {
  const off = new Set(offList(settings).filter(x => ALL.has(x)))
  if (on) off.delete(id); else off.add(id)
  return [...off].sort()
}

// Single rules: a rule switched off raises no new alerts; its alerts stay
const rulesOff = settings => Array.isArray(settings?.rulesOff) ? settings.rulesOff : []
export const ruleOn = (settings, rule) => !rulesOff(settings).includes(rule)
export function switchRule(settings, rule, on) {
  const off = new Set(rulesOff(settings))
  if (on) off.delete(rule); else off.add(rule)
  return [...off].sort()
}

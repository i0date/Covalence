// ═══════════════════════════════════════════════════════════════════════════════
// SIDES — which side of a dispute a workspace works, and which side a case is on
// ═══════════════════════════════════════════════════════════════════════════════
// A workspace does one or more of: issuer (files for its cardholders), acquirer
// (between the network and its merchants), merchant (answers chargebacks filed
// against it). Every tool stays available; the sides set the menu order and each
// tool's default view (docs/plans/roles-and-arn-linking.md). Separate from the
// institution type, which picks FI or crypto wording and rules.

export const SIDES = [
  ['issuer',   'Issuer',   'We file disputes for our cardholders and account holders'],
  ['acquirer', 'Acquirer', 'We process card payments for merchants and pass their chargebacks on'],
  ['merchant', 'Merchant', 'We answer chargebacks filed against our sales'],
]
const KNOWN = new Set(SIDES.map(([k]) => k))

// The side a case is on. Cases saved before sides existed carry mode: 'merchant'.
export function caseSide(c) {
  if (c && KNOWN.has(c.side)) return c.side
  return c?.mode === 'merchant' ? 'merchant' : 'issuer'
}
// Merchant and acquirer cases share the merchant views until the acquirer views exist
export const isMerchantCase = c => caseSide(c) !== 'issuer'

// What this workspace does: chosen in Settings, or implied by the institution type.
// Demo visitors see every side, so both halves of Desk stay on show.
export function workspaceSides(settings, { demo = false } = {}) {
  const picked = Array.isArray(settings?.sides) ? settings.sides.filter(s => KNOWN.has(s)) : []
  if (picked.length) return picked
  if (demo) return ['issuer', 'merchant']
  if (settings?.institutionType === 'merchant')  return ['merchant']
  if (settings?.institutionType === 'processor') return ['acquirer']
  return ['issuer']
}
export const doesIssuing  = sides => sides.includes('issuer')
export const doesMerchant = sides => sides.includes('merchant') || sides.includes('acquirer')

// The menu, in the order that suits the workspace. Every tool is always on it:
// merchant-side workspaces get their chargeback tools first, then the rest.
const TOOLS = {
  triage: '001  TRIAGE', desk: '002  DISPUTE DESK', multi: '003  MULTI', file: '004  FILE',
  licit: '005  LICIT', dfa: '006  DFA', duo: '007  DUO', trio: '008  TRIO',
}
const ISSUER_NAV = [['triage', 'Disputes'], ['desk', 'Disputes'], ['multi', 'Disputes'], ['file', 'Disputes'],
  ['licit', 'Compliance'], ['dfa', 'Recovery'], ['duo', 'Recovery'], ['trio', 'Recovery']]
const MERCHANT_NAV = [['multi', 'Chargebacks'], ['desk', 'Chargebacks'], ['file', 'Chargebacks'], ['triage', 'Chargebacks'],
  ['duo', 'Collaboration'], ['trio', 'Collaboration'], ['licit', 'Compliance'], ['dfa', 'Recovery']]

export function navFor(sides) {
  const rows = doesIssuing(sides) ? ISSUER_NAV : MERCHANT_NAV
  return [{ id: 'home', label: 'HOME' }, ...rows.map(([id, group]) => ({ id, label: TOOLS[id], group })), { id: 'settings', label: 'SETTINGS' }]
}

// Triage's Alerts tab: who found it
export function alertsSource(sides, crypto) {
  if (!doesIssuing(sides)) return 'The network warned you'
  return crypto ? 'The exchange found it' : 'The FI found it'
}

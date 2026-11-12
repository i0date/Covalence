// ═══════════════════════════════════════════════════════════════════════════════
// SIDES — which side of a dispute a workspace works, and which side a case is on
// ═══════════════════════════════════════════════════════════════════════════════
// A workspace does one or more of: issuer (files for its cardholders), acquirer
// (between the network and its merchants), merchant (answers chargebacks filed
// against it). The sides set the menu order and each tool's default view
// (docs/plans/roles-and-arn-linking.md), and the merchant and acquirer views show
// only for a workspace that ticked them. Separate from the institution type, which
// picks FI or crypto wording and rules.
import { isOn } from './features.mjs'

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
// Each case shows on its own side: an acquirer's cases (its merchants' chargebacks)
// stay out of the merchant's own queue, ratio and figures, and out of the issuer's
export const isMerchantCase = c => caseSide(c) === 'merchant'
export const isIssuerCase   = c => caseSide(c) === 'issuer'
export const isAcquirerCase = c => caseSide(c) === 'acquirer'
export const doesAcquiring  = sides => sides.includes('acquirer')

// What this workspace does: ticked in Settings → Your setup. Nothing ticked: an
// issuer (demo visitors see every side until they tick their own).
export function workspaceSides(settings, { demo = false } = {}) {
  const picked = Array.isArray(settings?.sides) ? settings.sides.filter(s => KNOWN.has(s)) : []
  if (picked.length) return SIDES.map(([k]) => k).filter(k => picked.includes(k))
  return demo ? ['issuer', 'merchant', 'acquirer'] : ['issuer']
}
// Workspaces from before the ticks followed their institution type; what that implied
export function impliedSides(settings) {
  if (settings?.institutionType === 'merchant')  return ['merchant']
  if (settings?.institutionType === 'processor') return ['acquirer']
  return null
}
export const doesIssuing  = sides => sides.includes('issuer')
export const doesMerchant = sides => sides.includes('merchant') || sides.includes('acquirer')

// The menu, in the order that suits the workspace: merchant-side workspaces get
// their chargeback tools first, then the rest. Tools switched off aren't on it.
const TOOLS = {
  triage: '001  TRIAGE', desk: '002  DISPUTE DESK', multi: '003  MULTI', file: '004  FILE',
  licit: '005  LICIT', dfa: '006  DFA', duo: '007  DUO', trio: '008  TRIO',
}
const ISSUER_NAV = [['triage', 'Disputes'], ['desk', 'Disputes'], ['multi', 'Disputes'], ['file', 'Disputes'],
  ['licit', 'Compliance'], ['dfa', 'Recovery'], ['duo', 'Recovery'], ['trio', 'Recovery']]
const MERCHANT_NAV = [['multi', 'Chargebacks'], ['desk', 'Chargebacks'], ['file', 'Chargebacks'], ['triage', 'Chargebacks'],
  ['duo', 'Collaboration'], ['trio', 'Collaboration'], ['licit', 'Compliance'], ['dfa', 'Recovery']]

export function navFor(sides, settings) {
  const rows = doesIssuing(sides) ? ISSUER_NAV : MERCHANT_NAV
  return [{ id: 'home', label: 'HOME' }, ...rows.map(([id, group]) => ({ id, label: TOOLS[id], group })), { id: 'insights', label: 'INSIGHTS' }, { id: 'settings', label: 'SETTINGS' }]
    .filter(n => isOn(settings, n.id))
}

// Triage's Alerts tab: who found it
export function alertsSource(sides, crypto, segment) {
  if (segment === 'mx' || !doesIssuing(sides)) return 'The network warned you'
  return crypto ? 'The exchange found it' : 'The FI found it'
}

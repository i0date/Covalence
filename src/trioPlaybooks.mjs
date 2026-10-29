// ═══════════════════════════════════════════════════════════════════════════════
// TRIO PLAYBOOKS — first steps for each kind of incident, bank side and merchant side
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript (no React). Each type has immediate steps (the first two hours),
// containment and recovery. An active incident shows its playbook as a checklist;
// a debrief turns it into a written playbook. Merchant types lead the list for
// merchant-side workspaces (sides.mjs).

export const INCIDENT_TYPES = {
  // Issuer / bank side
  fraud_wave:          { label: 'Fraud wave',                 side: 'issuer' },
  bin_attack:          { label: 'BIN attack',                 side: 'issuer' },
  ato:                 { label: 'Account takeover',           side: 'issuer' },
  platform_compromise: { label: 'Platform compromise',        side: 'issuer' },
  p2p_scam:            { label: 'P2P scam campaign',          side: 'issuer' },
  // Merchant side
  card_testing:        { label: 'Card-testing attack',        side: 'merchant' },
  customer_ato:        { label: 'Customer account takeover',  side: 'merchant' },
  merchant_breach:     { label: 'Data breach at the merchant', side: 'merchant' },
  chargeback_spike:    { label: 'Chargeback spike',           side: 'merchant' },
  refund_abuse:        { label: 'Refund or "not received" abuse', side: 'merchant' },
  other:               { label: 'Other',                      side: 'any' },
}

export const PLAYBOOKS = {
  fraud_wave: {
    immediate:   ['Freeze approvals on the flagged BIN range', 'Alert the BSA Officer for a SAR threshold assessment', 'Ask card operations to watch velocity'],
    containment: ['Block the compromised BIN range at authorisation', 'Reissue cards to affected cardholders', 'Coordinate with the network’s fraud desk'],
    recovery:    ['File chargebacks for confirmed fraud', 'Batch the fraud disputes through 003 Multi', 'Pursue recovery across institutions in 007 Duo where it applies'],
  },
  bin_attack: {
    immediate:   ['Decline the attacked BIN range at authorisation', 'Raise the velocity limits on card-not-present attempts', 'Tell card operations and the processor'],
    containment: ['Reissue cards that had approved test transactions', 'Add the merchant IDs used in the attack to monitoring'],
    recovery:    ['File chargebacks for approved fraudulent transactions', 'Report the attack to the network'],
  },
  ato: {
    immediate:   ['Lock affected accounts until they re-authenticate', 'Contact cardholders on their registered details', 'Verify identity before giving access back'],
    containment: ['Reset credentials and multi-factor on every compromised account', 'Review recent transactions for unauthorised activity', 'Flag the devices and IPs involved in the fraud rules'],
    recovery:    ['Give provisional credit for unauthorised transactions (Reg E)', 'File disputes for confirmed takeover transactions', 'Assess a SAR if the threshold is met'],
  },
  platform_compromise: {
    immediate:   ['Identify the systems and customers exposed', 'Bring in security and legal', 'Preserve logs and evidence'],
    containment: ['Rotate exposed credentials and keys', 'Increase monitoring on exposed accounts'],
    recovery:    ['Notify customers and regulators as required', 'Document the incident for the regulator and the board'],
  },
  p2p_scam: {
    immediate:   ['Brief front-line staff on the scam script', 'Send an internal alert with how the scam works', 'Escalate to compliance where customer funds moved'],
    containment: ['Freeze mule accounts', 'Alert receiving institutions through 007 Duo', 'Add verification on the affected payment type'],
    recovery:    ['Recall recent transfers', 'File SARs on mule accounts', 'Refer to law enforcement above the reporting threshold'],
  },
  card_testing: {
    immediate:   ['Turn on 3-D Secure or a CAPTCHA at checkout', 'Block the IPs, devices and BIN ranges in the attack', 'Tell your acquirer and payment processor'],
    containment: ['Add velocity limits on small authorisations and failed attempts', 'Void or refund approved test transactions before they settle', 'Watch the decline rate until it is back to normal'],
    recovery:    ['Expect fraud chargebacks (Visa 10.4, Mastercard 4837) for 30–90 days; answer them from 003 Multi', 'Watch the chargeback ratio on Home against the network thresholds', 'Record the attack for the acquirer’s review'],
  },
  customer_ato: {
    immediate:   ['Force password resets on the affected customer accounts', 'Hold orders shipping to newly added addresses', 'Block the IPs and devices logging in'],
    containment: ['Add multi-factor or step-up checks on login and address changes', 'Review orders since the first suspicious login'],
    recovery:    ['Cancel or refund fraudulent orders before they ship', 'Answer the resulting fraud chargebacks with login and device evidence', 'Tell affected customers'],
  },
  merchant_breach: {
    immediate:   ['Contain the breach: isolate the affected systems', 'Tell your acquirer straight away — card networks set short notice deadlines', 'Preserve logs; don’t wipe systems before the investigation'],
    containment: ['Engage a PCI Forensic Investigator if the networks or acquirer require one', 'Stop storing or transmitting card data on the affected systems'],
    recovery:    ['Follow the networks’ account compromise programme with your acquirer', 'Notify customers and regulators as the law requires', 'Budget for fraud chargebacks on the exposed cards'],
  },
  chargeback_spike: {
    immediate:   ['Find the reason codes, products and channels driving the spike', 'Check the chargeback ratio on Home against the 1.5% thresholds', 'Tell your acquirer before they tell you'],
    containment: ['Refund disputed orders before they become chargebacks (pre-dispute alerts in 001 Triage)', 'Fix the cause: unclear billing descriptor, cancellation flow or delivery problem', 'Accept small chargebacks in bulk and fight the strong ones in 003 Multi'],
    recovery:    ['Track the ratio daily until it is under the warning level', 'Agree a remediation plan with the acquirer if you are enrolled in a monitoring programme'],
  },
  refund_abuse: {
    immediate:   ['Identify the accounts, addresses and devices involved', 'Hold refunds and replacements for those accounts', 'Collect delivery proof (photos, GPS, signatures)'],
    containment: ['Require signature or photo on delivery for flagged accounts', 'Limit refunds without a return for repeat claimants'],
    recovery:    ['Answer “not received” chargebacks with delivery evidence', 'Close or restrict abusive accounts per your terms', 'Share the pattern with your acquirer'],
  },
  other: {
    immediate:   ['Assess the scope and the accounts affected', 'Alert the teams involved', 'Bring in the BSA Officer if money laundering is possible'],
    containment: ['Isolate the affected accounts or channels', 'Increase monitoring'],
    recovery:    ['Recover losses through disputes or chargebacks', 'Document it for regulatory reporting'],
  },
}
// Older incidents used these names for the same playbooks
const ALIASES = { account_takeover: 'ato', social_engineering: 'p2p_scam' }
export const playbookFor = type => PLAYBOOKS[ALIASES[type] || type] || PLAYBOOKS.other
export const typeLabel = type => INCIDENT_TYPES[ALIASES[type] || type]?.label || String(type || 'Other').replace(/_/g, ' ')

// Types in the order that suits the workspace: its own side first
export function typesFor(merchantFirst) {
  const all = Object.entries(INCIDENT_TYPES)
  const first = merchantFirst ? 'merchant' : 'issuer'
  return [...all.filter(([, t]) => t.side === first), ...all.filter(([, t]) => t.side !== first && t.side !== 'any'), ...all.filter(([, t]) => t.side === 'any')]
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLE CUSTOMERS — for the demo's /claim/demo links and Settings → Claim form's walk-through
// ═══════════════════════════════════════════════════════════════════════════════
// One per side: a bank's customer (fi) with a coffee they buy every week, an online
// charge they don't know and a subscription; an exchange's customer (ce) with two
// withdrawals they didn't make; a shop's customer (mx) whose order of seven arrived
// with four. Fictional people and payments. Plain data, no imports.
const DAY = 86400000

export function sampleLink(segment = 'fi', now = Date.now()) {
  const ago = d => new Date(now - d * DAY).toISOString()
  if (segment === 'ce') return { reference: 'SAMPLE-CE', segment: 'ce', customer: { id: 'X-2207', name: 'Riley Chen', accountType: 'exchange' },
    transactions: [
      { id: 'WD-55120', ts: ago(0.2), amount: -2450, merchant: 'Withdrawal · 0.034 BTC to bc1q9h…7xk2', merchantLocation: 'Online', merchantCategory: 'Crypto withdrawal', channel: 'withdrawal' },
      { id: 'WD-55121', ts: ago(0.19), amount: -1180, merchant: 'Withdrawal · 1,180 USDT (Tron) to TQ3x…p9Lm', merchantLocation: 'Online', merchantCategory: 'Crypto withdrawal', channel: 'withdrawal' },
    ] }
  if (segment === 'mx') return { reference: 'SAMPLE-MX', segment: 'mx', customer: { id: 'C-88410', name: 'Ama Owusu', email: 'ama.o@example.com' },
    transactions: [{ id: 'ORD-20417', ts: ago(9), amount: -312.6, merchant: 'Order #20417 · 7 items', merchantLocation: 'Online', merchantCategory: 'Home goods', channel: 'card_not_present' }] }
  return { reference: 'SAMPLE', segment: 'fi', customer: { id: 'A-5520', name: 'Jordan Ellis', email: 'jordan.e@example.com', accountType: 'debit', accountOpened: '2021-08-14' },
    transactions: [
      { id: 'TX-93011', ts: ago(2), amount: -6.75, merchant: 'SQ *BLUE BOTTLE COFFEE #1234', merchantLocation: 'San Francisco, CA', merchantCategory: 'Coffee shop', channel: 'card_present', network: 'Visa' },
      { id: 'TX-93018', ts: ago(1), amount: -389, merchant: 'SHOPZ*GADGETHUB 8885551234', merchantLocation: 'Online', merchantCategory: 'Electronics', channel: 'card_not_present', network: 'Visa' },
      { id: 'TX-93020', ts: ago(1), amount: -15.49, merchant: 'NFLX DIGITAL NTFLX.COM', merchantLocation: 'Online', merchantCategory: 'Streaming', channel: 'card_not_present', network: 'Visa' },
    ] }
}

// Jordan's earlier payments, so "Is this yours?" can say they've paid a merchant before
export const sampleHistory = (customerId, now = Date.now()) => customerId !== 'A-5520' ? []
  : [7, 14, 21, 28, 35, 42].map(d => ({ id: 'H' + d, ts: new Date(now - d * DAY).toISOString(), amount: -6.25, currency: 'USD', counterparty: 'SQ *BLUE BOTTLE COFFEE' }))
    .concat([33, 63, 93].map(d => ({ id: 'N' + d, ts: new Date(now - d * DAY).toISOString(), amount: -15.49, currency: 'USD', counterparty: 'NETFLIX.COM' })))

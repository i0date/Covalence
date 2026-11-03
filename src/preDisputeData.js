// ═══════════════════════════════════════════════════════════════════════════════
// PRE-DISPUTE DATA — a merchant's pre-dispute alerts (supabase_predispute.sql)
// ═══════════════════════════════════════════════════════════════════════════════
// Signed in: the institution's alerts through institution-scoped functions; each
// decision is then sent to the merchant's endpoint (api/action.js predispute.decided)
// so their systems refund and report the outcome to the provider.
// Demo visitors: Demo Bank's in-browser copy (demoBackend.js).
import { accessToken, isSignedIn } from './auth.js'
import { demoRpc } from './demoBackend.js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''

async function rpc(fn, args) {
  if (!isSignedIn()) return demoRpc(fn, args)
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${accessToken() || SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (r.status === 404) throw new Error('Pre-dispute alerts aren’t set up in this workspace yet (run supabase_predispute.sql).')
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

// Rows as the panel uses them (camelCase, like preDispute.mjs)
const shape = r => ({ id: r.id, externalId: r.external_id, source: r.source, network: r.network, amount: Number(r.amount), currency: r.currency,
  reason: r.reason, reasonCode: r.reason_code, descriptor: r.descriptor, orderId: r.order_id, arn: r.arn, cardLast4: r.card_last4,
  transactionAt: r.transaction_at, receivedAt: r.received_at, respondBy: r.respond_by, status: r.status, note: r.note, history: r.history || [] })
export const listPreDispute = () => rpc('predispute_list').then(rows => (rows || []).map(shape))

// A decision, then the merchant's systems are told (a failed send doesn't undo the decision)
// → { ok, sent: true | false | null (not connected), error? }
export async function decidePreDispute(id, action, note = '') {
  await rpc('predispute_act', { p_id: id, p_action: action, p_note: note })
  window.dispatchEvent(new Event('cov:predispute-changed'))
  if (!isSignedIn()) return { ok: true, sent: null }
  const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify({ preDisputeId: id }) }).catch(() => null)
  const j = r ? await r.json().catch(() => null) : null
  if (r?.status === 409 && j?.error === 'not_connected') return { ok: true, sent: null }
  return { ok: true, sent: !!j?.ok, error: j?.ok ? null : j?.error || null }
}

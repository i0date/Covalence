// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING DATA — a bank's applications (supabase_onboarding.sql)
// ═══════════════════════════════════════════════════════════════════════════════
// Signed in: the institution's applications through institution-scoped functions; each
// decision is then sent to the bank's endpoint (api/action.js onboarding.decided).
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
  if (r.status === 404) throw new Error('Onboarding isn’t set up in this workspace yet (run supabase_onboarding.sql).')
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

const shape = r => ({ id: r.id, reference: r.reference, kind: r.kind, channel: r.channel, app: r.applicant || {}, checks: r.checks || [], rating: r.rating,
  reasons: r.reasons || [], recommend: r.recommend || {}, status: r.status, idv: r.idv || null, history: r.history || [], createdAt: r.created_at, updatedAt: r.updated_at })
export const listOnboarding = () => rpc('onboarding_list').then(rows => (rows || []).map(shape))

// Then the bank's systems are told (a failed send doesn't undo the decision) → { ok, sent: true | false | null, error? }
async function tellBank(id) {
  if (!isSignedIn()) return { ok: true, sent: null }
  const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify({ onboardingId: id }) }).catch(() => null)
  const j = r ? await r.json().catch(() => null) : null
  if (r?.status === 409 && j?.error === 'not_connected') return { ok: true, sent: null }
  return { ok: true, sent: !!j?.ok, error: j?.ok ? null : j?.error || null }
}
export async function decideOnboarding(id, action, note = '') {
  await rpc('onboarding_decide', { p_id: id, p_action: action, p_note: note })
  window.dispatchEvent(new Event('cov:onboarding-changed'))
  return tellBank(id)
}
export async function clearOnboardingHold(id, note) {
  await rpc('onboarding_clear_hold', { p_id: id, p_note: note })
  window.dispatchEvent(new Event('cov:onboarding-changed'))
  return { ok: true }
}

// ── The customer's side: the hosted form at /onboard/<token> (no sign-in) ──
// demo and demo-business are samples: nothing is stored or sent.
export const isDemoForm = token => token === 'demo' || token === 'demo-business'
export async function openOnboardForm(token) {
  if (isDemoForm(token)) return { brand: { name: 'Demo Bank', logo: '', phone: '(800) 555-0100' }, kind: token === 'demo' ? 'person' : 'business', prefill: {}, demo: true }
  const r = await fetch(`/api/onboarding?form=${encodeURIComponent(token)}`)
  const j = await r.json().catch(() => null)
  if (!r.ok) return { error: j?.error || 'We couldn’t open this application — try again in a minute.', brand: j?.brand || null }
  return j
}
export async function sendOnboardForm(token, application) {
  if (isDemoForm(token)) return { id: 'ONB-SAMPLE0001', demo: true }
  const r = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: token, application }) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error || 'We couldn’t send your application — try again.')
  return j
}

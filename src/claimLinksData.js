// ═══════════════════════════════════════════════════════════════════════════════
// CLAIM FORM DATA — the hosted claim form and its look (supabase_claim_links.sql)
// ═══════════════════════════════════════════════════════════════════════════════
// Links are made by the bank's own systems (api/claims.js { link }), never from here.
// Signed in: the form's look through institution-scoped functions.
// Demo visitors: Demo Bank's in-browser copy (demoBackend.js); demo links start with demo_.
// The customer's side (/claim/<token>) needs no sign-in: api/claims.js ?form=.
import { accessToken, isSignedIn } from './auth.js'
import { demoRpc } from './demoBackend.js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''
const NOT_SET_UP = 'The hosted claim form isn’t set up in this workspace yet (run supabase_claim_links.sql).'

async function rpc(fn, args) {
  if (!isSignedIn()) return demoRpc(fn, args)
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${accessToken() || SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (r.status === 404) throw new Error(NOT_SET_UP)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

export const getClaimForm = () => rpc('claim_form_get')
export const setClaimForm = f => rpc('claim_form_set', { p_display_name: f.display_name || '', p_logo_url: f.logo_url || '', p_support_phone: f.support_phone || '', p_help_url: f.help_url || '' })

// ── The customer's side ──
const isDemo = token => /^demo(-ce|-mx)?$|^demo_[a-f0-9]{48}$/.test(token)
// → { brand, firstName, cards, types, questions, consentText } or { error, brand }
export async function openForm(token) {
  if (isDemo(token)) {
    if (!token.startsWith('demo_')) { const l = await demoRpc('claim_link_sample', { p_segment: token.slice(5) || 'fi' }); return { ...(await demoRpc('claim_form_open', { p_token: l.token })), token: l.token } }
    return demoRpc('claim_form_open', { p_token: token })
  }
  const r = await fetch(`/api/claims?form=${encodeURIComponent(token)}`)
  const j = await r.json().catch(() => null)
  if (!r.ok) return { error: j?.error || 'We couldn’t open this form — try again in a minute.', brand: j?.brand || null }
  return j
}
// → { id, status, closedAtIntake, brand }; throws with words for the customer
export async function sendForm(token, claim) {
  if (isDemo(token)) return demoRpc('claim_form_send', { p_token: token, p_claim: claim })
  const r = await fetch('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: token, claim }) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error || 'We couldn’t send your claim — try again.')
  return j
}

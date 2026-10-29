// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS DATA — claims from the bank's app (supabase_claims.sql, api/claims.js)
// ═══════════════════════════════════════════════════════════════════════════════
// Signed in: the institution's claims, through institution-scoped functions; each
// status change is then sent to the bank's endpoint as a signed claim.updated event.
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
  if (r.status === 404) throw new Error('Claims from your app aren’t set up in this workspace yet (run supabase_claims.sql).')
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

export const listClaims = () => rpc('claims_list').then(rows => rows || [])

// Move a claim on, then tell the bank's systems (a failed notification doesn't undo the change)
export async function setClaim(id, status, { note = '', publicNote = '', caseId = '' } = {}) {
  const r = await rpc('claim_set', { p_id: id, p_status: status, p_note: note, p_public: publicNote, p_case_id: caseId })
  if (r?.changed && isSignedIn()) {
    fetch('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify({ notify: id }) }).catch(() => {})
  }
  return r
}

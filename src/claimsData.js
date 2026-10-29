// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS DATA — claims from the bank's app (supabase_claims.sql, api/claims.js)
// ═══════════════════════════════════════════════════════════════════════════════
// Signed in: the institution's claims, through institution-scoped functions; each
// status change is then sent to the bank's endpoint as a signed claim.updated event,
// and each step on the Desk case (provisional credit, filed, resolved) as its own event.
// Demo visitors: Demo Bank's in-browser copy (demoBackend.js).
import { accessToken, canWrite, isSignedIn } from './auth.js'
import { demoRpc } from './demoBackend.js'
import { STEP_NOTES, caseSteps } from './claims.mjs'

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

const api = body => fetch('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify(body) })
const notify = id => { if (isSignedIn()) api({ notify: id }).catch(() => {}) }

// Move a claim on, then tell the bank's systems (a failed notification doesn't undo the change)
export async function setClaim(id, status, { note = '', publicNote = '', caseId = '' } = {}) {
  const r = await rpc('claim_set', { p_id: id, p_status: status, p_note: note, p_public: publicNote, p_case_id: caseId })
  if (r?.changed) notify(id)
  return r
}

// A step on the claim's Desk case. Each step is recorded once, so sending it again changes nothing.
export async function stepClaim(id, step, { outcome = '', caseId = '' } = {}) {
  const r = await rpc('claim_step', { p_id: id, p_step: step, p_outcome: outcome, p_public: STEP_NOTES[step === 'resolved' ? outcome : step] || '', p_case_id: caseId })
  if (r?.changed) notify(id)
  return r
}

// Called with the case list before and after each save (shared.jsx saveOutcomes)
export function sendCaseSteps(before, after) {
  if (!canWrite()) return
  const steps = caseSteps(before, after)
  if (!steps.length) return
  ;(async () => {
    for (const s of steps) await stepClaim(s.claimId, s.step, s).catch(e => console.warn('[claims] step not recorded:', s.claimId, s.step, e.message))
    window.dispatchEvent(new Event('cov:claims-changed'))
  })()
}

// AI triage again, for a claim whose first read failed or is out of date (signed in only)
export async function triageClaim(id) {
  const r = await api({ triage: id })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j.ai
}

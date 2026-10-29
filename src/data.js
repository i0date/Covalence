// Data layer: Supabase RPC calls, case/Trio sync, Duo sessions, case links, evidence upload
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import { isDemoCase } from './CaseThread.jsx'
import { accessToken, isSignedIn, canWrite } from './auth.js'
import { demoRpc, demoStoreFile } from './demoBackend.js'

// ═══════════════════════════════════════════════════════════════════════════════
// 007 DUO — multi-institutional real-time collaboration
// ═══════════════════════════════════════════════════════════════════════════════

export const SUPA_URL = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_SUPABASE_URL || '') : ''
export const SUPA_KEY = (typeof import.meta !== 'undefined' && import.meta.env) ? (import.meta.env.VITE_SUPABASE_ANON_KEY || '') : ''

export function genDuoCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let c = ''
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)]
  return c
}
function supaH() {
  // Signed in → the user's token, so the database scopes every call to their institution
  return { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${accessToken() || SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
}
// ── RPC layer ────────────────────────────────────────────────────────────────
// Tables are closed to the public key (see supabase_rls.sql); the app calls
// SECURITY DEFINER functions instead. If a function isn't deployed yet
// (PostgREST 404 / PGRST202) we fall back to the legacy direct-table call so
// the app keeps working until the SQL has been run.
const _rpcMissing = new Set()
// Duo and case links work for demo visitors too, against Demo Bank's in-browser backend
const DEMO_RPCS = new Set(['duo_get', 'duo_create', 'duo_update', 'duo_find', 'case_link_create', 'case_link_activity',
  'sharing_get', 'sharing_set', 'duo_sharing_status', 'duo_share_confirm', 'arn_find_other_side', 'arn_invites', 'arn_invite_respond',
  'arn_link_state', 'arn_publish_stage', 'arn_settle'])
async function supaRpc(fn, args, fallback) {
  if (!isSignedIn() && DEMO_RPCS.has(fn)) return demoRpc(fn, args)
  if (!_rpcMissing.has(fn)) {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, { method:'POST', headers: supaH(), body: JSON.stringify(args) })
    if (r.ok) { const t = await r.text(); return t ? JSON.parse(t) : null }
    if (r.status !== 404 || !fallback) throw new Error(await r.text())
    _rpcMissing.add(fn)
  }
  return fallback()
}
const firstRow = d => Array.isArray(d) ? (d[0] || null) : d
// Workspace = institution entered at sign-in; scopes the shared case pool.
function covWorkspace() {
  try {
    const u = JSON.parse(localStorage.getItem('cov_user') || 'null')
    const s = JSON.parse(localStorage.getItem('cov_settings') || '{}')
    return (u?.institution || s.duoInstitutionName || '').trim().toLowerCase()
  } catch { return '' }
}

export async function duoGet(id) {
  return firstRow(await supaRpc('duo_get', { p_id: id }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/duo_sessions?id=eq.${id}&select=*`, { headers: supaH() })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }))
}
export async function duoCreate(obj) {
  return firstRow(await supaRpc('duo_create', { p: obj }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/duo_sessions`, { method:'POST', headers: supaH(), body: JSON.stringify(obj) })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }))
}
export async function duoPatch(id, updates) {
  return firstRow(await supaRpc('duo_update', { p_id: id, p: updates }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/duo_sessions?id=eq.${id}`, { method:'PATCH', headers: supaH(), body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }) })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }))
}
export async function duoFind(institution) {
  return await supaRpc('duo_find', { p_institution: institution }, async () => {
    const q = encodeURIComponent(institution)
    const r = await fetch(`${SUPA_URL}/rest/v1/duo_sessions?or=(institution_a.ilike.*${q}*,institution_b.ilike.*${q}*)&order=created_at.desc&limit=10`, { headers: supaH() })
    return r.json()
  }) || []
}
// ── 314(b) information sharing (supabase_314b.sql) ───────────────────────────
// Errors come back as PostgREST JSON; show the database's own sentence
const rpcMsg = e => { try { return JSON.parse(e.message).message || e.message } catch { return e.message } }
const plain = p => p.catch(e => { throw new Error(rpcMsg(e)) })
export const sharingGet = () => plain(supaRpc('sharing_get', {})).then(firstRow)
export const sharingSet = (v) => plain(supaRpc('sharing_set', { p_registered: !!v.registered, p_expires_on: v.registered ? v.expires_on || null : null,
  p_contact_name: v.contact_name || '', p_contact_email: v.contact_email || '', p_require_both: !!v.require_both }))
export const duoSharingStatus = id => plain(supaRpc('duo_sharing_status', { p_id: id }))
// kind: recovery | dispute | aml (supabase_duo_purpose.sql)
export const duoShareConfirm = (id, purpose, kind = 'aml') => plain(supaRpc('duo_share_confirm', { p_id: id, p_purpose: purpose, p_kind: kind }))
// ── Linking cases by ARN (supabase_arn.sql) ──────────────────────────────────
export const arnFindOtherSide = caseId => plain(supaRpc('arn_find_other_side', { p_case_id: caseId }))
export const arnInvites = () => plain(supaRpc('arn_invites', {})).then(r => Array.isArray(r) ? r : [])
export const arnInviteRespond = (id, accept) => plain(supaRpc('arn_invite_respond', { p_id: id, p_accept: !!accept }))
// Linked cases: shared stages and settling early (supabase_arn_sync.sql)
export const arnLinkState = id => plain(supaRpc('arn_link_state', { p_id: id }))
export const arnPublishStage = (id, stage, sync) => plain(supaRpc('arn_publish_stage', { p_id: id, p_stage: stage || '', p_sync: !!sync }))
export const arnSettle = (id, action, { amount = null, ref = '', note = '' } = {}) => plain(supaRpc('arn_settle', { p_id: id, p_action: action, p_amount: amount, p_ref: ref, p_note: note }))

export async function caseLinkCreate(body) {
  return firstRow(await supaRpc('case_link_create', { p: body }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/duo_case_links`, { method:'POST', headers: supaH(), body: JSON.stringify(body) })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }))
}
export async function caseLinkActivity(token) {
  const d = await supaRpc('case_link_activity', { p_token: token }, async () => {
    const h = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
    const [responses, access] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/case_link_responses?token=eq.${token}&order=responded_at.desc`, { headers: h }).then(r => r.json()),
      fetch(`${SUPA_URL}/rest/v1/case_link_access_log?token=eq.${token}&order=accessed_at.desc`, { headers: h }).then(r => r.json()),
    ])
    return { responses, access }
  })
  return { responses: Array.isArray(d?.responses) ? d.responses : [], access: Array.isArray(d?.access) ? d.access : [] }
}
// ── Supabase shared-pool sync helpers ─────────────────────────────────────────
// What the server already holds (case id → updatedAt), so a save sends only the
// cases that changed, 500 at a time — an import of thousands doesn't resend
// the whole workspace on every edit. Pulls page through every case the first
// time, then ask only for cases changed since the last pull.
const PUSH_CHUNK = 500, PULL_PAGE = 1000
const _synced = new Map()
let _lastPull = null       // server timestamp of the newest case pulled
let _syncScope = ''
function syncScope() {     // a different person or institution starts over
  const scope = covWorkspace() + '|' + (accessToken() ? 'in' : 'out')
  if (scope !== _syncScope) { _syncScope = scope; _synced.clear(); _lastPull = null }
}
export async function pushCasesToSupa(cases) {
  // Demo cases stay in this browser — they never reach the shared pool
  const real = (cases || []).filter(c => !isDemoCase(c))
  if (!SUPA_URL || !SUPA_KEY || !isSignedIn() || !canWrite() || !real.length) return  // auditors are read-only
  syncScope()
  const changed = real.filter(c => _synced.get(c.id) !== (c.updatedAt || ''))
  for (let i = 0; i < changed.length; i += PUSH_CHUNK) {
    const chunk = changed.slice(i, i + PUSH_CHUNK)
    const rows = chunk.map(c => ({ id:c.id, data:c, assigned_to:c.assignedTo||null, updated_at:new Date().toISOString() }))
    await supaRpc('cov_push_cases', { p_workspace: covWorkspace(), p_rows: rows }, () =>
      fetch(`${SUPA_URL}/rest/v1/cov_cases`, { method:'POST', headers:{...supaH(), Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(rows) }))
    chunk.forEach(c => _synced.set(c.id, c.updatedAt || ''))
  }
}
export async function pullCasesFromSupa() {
  if (!SUPA_URL || !SUPA_KEY || !isSignedIn()) return []
  syncScope()
  const since = _lastPull, out = []
  let newest = null, legacy = false
  for (let offset = 0; offset < 100000; offset += PULL_PAGE) {
    const page = await supaRpc('cov_pull_cases_page', { p_since: since, p_offset: offset, p_limit: PULL_PAGE }, async () => {
      // Database not updated yet (supabase_import.sql): the old call, capped at 500 cases
      legacy = true
      return await supaRpc('cov_pull_cases', { p_workspace: covWorkspace() }, async () => {
        const r = await fetch(`${SUPA_URL}/rest/v1/cov_cases?select=data,updated_at&order=updated_at.desc&limit=500`, {headers:supaH()})
        return r.ok ? r.json() : []
      })
    }).catch(() => null)
    if (!page) break
    page.forEach(r => { if (r?.data) out.push(r.data); if (r?.updated_at && (!newest || r.updated_at > newest)) newest = r.updated_at })
    if (legacy || page.length < PULL_PAGE) break
  }
  // Ask again from a little before the newest row, in case of rows saved mid-pull
  if (newest && !legacy) _lastPull = new Date(new Date(newest).getTime() - 120000).toISOString()
  out.forEach(c => _synced.set(c.id, c.updatedAt || ''))
  return out
}
export function mergeCases(local, remote) {
  const map = {}
  local.forEach(c=>{map[c.id]=c})
  remote.forEach(c=>{ const ex=map[c.id]; if(!ex){map[c.id]=c;return} if(new Date(c.updatedAt||0)>new Date(ex.updatedAt||0)) map[c.id]=c })
  return Object.values(map)
}
// Team list = members of the signed-in user's institution (memberships, see supabase_auth.sql)
export async function fetchAgents() {
  if (!SUPA_URL||!SUPA_KEY||!isSignedIn()) return []
  return await supaRpc('cov_list_agents', { p_institution: covWorkspace() }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/cov_agents?select=email,name,institution&order=name.asc&limit=100`, {headers:supaH()})
    return r.ok ? r.json() : []
  }).catch(() => []) || []
}

export async function pushTrioToSupa(incidents) {
  if (!SUPA_URL || !SUPA_KEY || !isSignedIn() || !canWrite() || !incidents?.length) return
  const rows = incidents.map(i => ({ id: i.id, data: i, updated_at: i.updatedAt || new Date().toISOString() }))
  await supaRpc('cov_push_trio', { p_workspace: covWorkspace(), p_rows: rows }, () =>
    fetch(`${SUPA_URL}/rest/v1/cov_trio_incidents`, {
      method: 'POST',
      headers: { ...supaH(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    }))
}
export async function pullTrioFromSupa() {
  if (!SUPA_URL || !SUPA_KEY || !isSignedIn()) return []
  const d = await supaRpc('cov_pull_trio', { p_workspace: covWorkspace() }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/cov_trio_incidents?select=data,updated_at&order=updated_at.desc&limit=100`, { headers: supaH() })
    return r.ok ? r.json() : []
  }).catch(() => [])
  return (d || []).map(r => r.data).filter(Boolean)
}
export function mergeTrioIncidents(local, remote) {
  const map = {}
  local.forEach(i => { map[i.id] = i })
  remote.forEach(i => {
    const ex = map[i.id]
    if (!ex) { map[i.id] = i; return }
    if (new Date(i.updatedAt || 0) > new Date(ex.updatedAt || 0)) map[i.id] = i
  })
  return Object.values(map).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

export async function uploadEvidence(caseId, file, agentEmail) {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase not configured')
  // Demo visitors: the file stays in this tab's memory (gone on reload) and never leaves the browser
  if (!isSignedIn()) return { name: file.name, path: demoStoreFile(caseId, file), type: file.type || 'application/octet-stream', size: file.size, uploadedAt: new Date().toISOString(), uploadedBy: agentEmail || 'demo' }
  const ts = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${caseId}/${ts}-${safeName}`
  const r = await fetch(`${SUPA_URL}/storage/v1/object/cov-evidence/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${accessToken()}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: file,
  })
  if (!r.ok) { const txt = await r.text().catch(()=>''); throw new Error(`Upload failed (${r.status}): ${txt}`) }
  // The bucket is private: store the path, and open it later through a signed link (openEvidence)
  return { name: file.name, path, type: file.type || 'application/octet-stream', size: file.size, uploadedAt: new Date().toISOString(), uploadedBy: agentEmail || '' }
}

export function parseThread(raw) { try { return JSON.parse(raw || '[]') } catch { return raw ? [{ text: raw, ts: new Date(0).toISOString() }] : [] } }
export function buildThread(session) {
  const a = parseThread(session.notes_a).map(e => ({ ...e, role:'a', institution: session.institution_a }))
  const b = parseThread(session.notes_b).map(e => ({ ...e, role:'b', institution: session.institution_b }))
  return [...a, ...b].sort((x, y) => new Date(x.ts) - new Date(y.ts))
}
export function loadMyDuoSessions() { try { return JSON.parse(localStorage.getItem('duo_my_sessions') || '[]') } catch { return [] } }
export function saveMyDuoSessions(arr) { localStorage.setItem('duo_my_sessions', JSON.stringify(arr)) }

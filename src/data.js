// Data layer: Supabase RPC calls, case/Trio sync, Duo sessions, case links, evidence upload
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import { isDemoCase } from './CaseThread.jsx'
import { accessToken, isSignedIn, canWrite } from './auth.js'

// ═══════════════════════════════════════════════════════════════════════════════
// 005 DUO VIEW — multi-institutional real-time collaboration
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
async function supaRpc(fn, args, fallback) {
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
export async function pushCasesToSupa(cases) {
  // Demo cases stay in this browser — they never reach the shared pool
  const real = (cases || []).filter(c => !isDemoCase(c))
  if (!SUPA_URL || !SUPA_KEY || !isSignedIn() || !canWrite() || !real.length) return  // auditors are read-only
  const rows = real.map(c => ({ id:c.id, data:c, assigned_to:c.assignedTo||null, updated_at:new Date().toISOString() }))
  await supaRpc('cov_push_cases', { p_workspace: covWorkspace(), p_rows: rows }, () =>
    fetch(`${SUPA_URL}/rest/v1/cov_cases`, { method:'POST', headers:{...supaH(), Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(rows) }))
}
export async function pullCasesFromSupa() {
  if (!SUPA_URL || !SUPA_KEY || !isSignedIn()) return []
  const d = await supaRpc('cov_pull_cases', { p_workspace: covWorkspace() }, async () => {
    const r = await fetch(`${SUPA_URL}/rest/v1/cov_cases?select=data,updated_at&order=updated_at.desc&limit=500`, {headers:supaH()})
    return r.ok ? r.json() : []
  }).catch(() => [])
  return (d||[]).map(r=>r.data).filter(Boolean)
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
  if (!isSignedIn()) throw new Error('Sign in to attach evidence — demo cases stay in this browser')
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

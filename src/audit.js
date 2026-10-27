// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT — the institution's append-only, hash-chained activity log
// ═══════════════════════════════════════════════════════════════════════════════
// Most entries are written by database triggers (cases, team, invites, Duo, case
// links, settings — see supabase_workspace_audit.sql). The app adds the events
// the database can't see, such as a case being viewed or the log being exported.
import { accessToken, isSignedIn } from './auth.js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''

async function rpc(fn, args) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${accessToken() || SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (!r.ok) throw new Error(r.status === 404 ? 'Audit log is not set up yet' : await r.text())
  const t = await r.text(); return t ? JSON.parse(t) : null
}

// Fire-and-forget: a failed audit write never blocks the user's work
export function auditWrite(action, entity, entityId, detail) {
  if (!SUPA_URL || !isSignedIn()) return
  rpc('audit_write', { p_action: action, p_entity: entity || '', p_entity_id: entityId || '', p_detail: detail || {} }).catch(() => {})
}
export const auditList   = (entityId, limit) => rpc('audit_list', { p_entity_id: entityId || null, p_limit: limit || 200 }).then(d => d || [])
export const auditVerify = () => rpc('audit_verify').then(d => (d && d[0]) || null)

// Plain-English labels for the log
export const AUDIT_LABELS = {
  'case.created': 'Case created', 'case.status_changed': 'Status changed', 'case.assigned': 'Case assigned',
  'case.edited': 'Case edited', 'case.viewed': 'Case viewed', 'evidence.uploaded': 'Evidence uploaded',
  'evidence.opened': 'Evidence opened', 'member.joined': 'Member joined', 'member.removed': 'Member removed',
  'member.role_changed': 'Role changed', 'invite.created': 'Invite sent', 'invite.revoked': 'Invite revoked',
  'invite.accepted': 'Invite accepted', 'duo.created': 'Duo session opened', 'duo.joined': 'Duo session joined',
  'duo.status_changed': 'Duo status changed', 'case_link.created': 'Case link sent', 'settings.changed': 'Settings changed',
  'workspace.updated': 'Workspace data updated', 'audit.exported': 'Audit log exported',
}
export function describeAudit(e) {
  const d = e.detail || {}
  if (e.action === 'settings.changed') return Object.entries(d).map(([k, v]) => `${k}: ${JSON.stringify(v.from ?? '—')} → ${JSON.stringify(v.to ?? '—')}`).join(' · ')
  if (d.from !== undefined || d.to !== undefined) return `${d.from ?? '—'} → ${d.to ?? '—'}`
  return Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ')
}

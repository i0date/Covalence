// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT — the institution's append-only, hash-chained activity log
// ═══════════════════════════════════════════════════════════════════════════════
// Most entries are written by database triggers (cases, team, invites, Duo, case
// links, settings — see supabase_workspace_audit.sql). The app adds the events
// the database can't see, such as a case being viewed or the log being exported.
import { accessToken, isSignedIn } from './auth.js'
import { demoRpc } from './demoBackend.js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''

async function rpc(fn, args) {
  if (!isSignedIn()) return demoRpc(fn, args)   // demo visitors: Demo Bank's in-browser log
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
  rpc('audit_write', { p_action: action, p_entity: entity || '', p_entity_id: entityId || '', p_detail: detail || {} }).catch(() => {})
}
export const auditList   = (entityId, limit) => rpc('audit_list', { p_entity_id: entityId || null, p_limit: limit || 200 }).then(d => d || [])
export const auditVerify = () => rpc('audit_verify').then(d => (d && d[0]) || null)

// Plain-English labels for the log
export const AUDIT_LABELS = {
  'case.created': 'Case created', 'case.status_changed': 'Status changed', 'case.assigned': 'Case assigned',
  'case.auto_assigned': 'Case auto-assigned', 'case.escalated': 'Case escalated', 'reminders.sent': 'Reminder email sent',
  'ai.reviewed': 'AI decision reviewed', 'qa.reviewed': 'QA review recorded', 'cases.imported': 'Cases imported', 'transactions.imported': 'Transactions imported', 'alerts.raised': 'Monitoring alerts raised', 'alert.closed': 'Alert closed', 'alert.escalated': 'Alert escalated to a case', 'alert.contacted': 'Customer contact logged', 'alert.action': 'Protective action recorded',
  'intake.received': 'Data received via API', 'intake_key.created': 'API key created', 'intake_key.revoked': 'API key revoked', 'case.closed_at_intake': 'Closed at intake',
  'sanctions.screened': 'Sanctions screening', 'sanctions.decided': 'Sanctions match decided', 'sanctions.reported': 'OFAC report recorded',
  'aml.flagged': 'Flagged for SAR review', 'sar.decided': 'SAR decision', 'sar.filed': 'SAR filed', 'sar.drafted': 'SAR narrative saved',
  'case.edited': 'Case edited', 'case.viewed': 'Case viewed', 'evidence.uploaded': 'Evidence uploaded',
  'evidence.opened': 'Evidence opened', 'member.joined': 'Member joined', 'member.removed': 'Member removed',
  'member.role_changed': 'Role changed', 'invite.created': 'Invite sent', 'invite.revoked': 'Invite revoked',
  'invite.accepted': 'Invite accepted', 'duo.created': 'Duo session opened', 'duo.joined': 'Duo session joined',
  'duo.status_changed': 'Duo status changed', 'duo.info_shared': 'Information shared in Duo', 'duo.arn_lookup': 'Looked for the other side (ARN)', 'duo.arn_linked': 'Linked with the other side (ARN)', 'duo.arn_declined': 'Declined to link (ARN)', 'duo.sharing_purpose': 'Sharing purpose confirmed', 'sharing.updated': '314(b) registration updated', 'case_link.created': 'Case link sent', 'settings.changed': 'Settings changed',
  'workspace.updated': 'Workspace data updated', 'audit.exported': 'Audit log exported',
  'case.exported': 'Case file exported', 'case.legal_hold_on': 'Legal hold placed', 'case.legal_hold_off': 'Legal hold lifted',
  'case.purged': 'Case purged (retention)', 'retention.policy_changed': 'Retention period changed', 'retention.purged': 'Retention purge run',
}
export function describeAudit(e) {
  const d = e.detail || {}
  if (e.action === 'sanctions.screened') return d.status === 'clear' ? 'Clear' : `${d.hits} potential match${d.hits === 1 ? '' : 'es'}`
  if (e.action === 'sanctions.decided') return `${d.outcome === 'true_match' ? 'Confirmed match' : 'False positive'}${d.note ? ` — ${d.note}` : ''}`
  if (e.action === 'aml.flagged') return `${(d.level || '').toUpperCase()} · ${d.signals || ''}`
  if (e.action === 'sar.decided') return `${d.decision === 'file' ? 'File a SAR' : 'No SAR'}${d.rationale ? ` — ${d.rationale}` : ''}`
  if (e.action === 'case.closed_at_intake') return `${d.reason}${d.basis ? ` — ${d.basis}` : ''}${d.toLicit ? ' · sent to Licit' : ''}`
  if (e.action === 'transactions.imported') return `${d.file} · ${d.stored} new transactions${d.problems ? ` · ${d.problems} unreadable rows` : ''}`
  if (e.action === 'alerts.raised') return `${d.alerts} alerts · ${d.rules}`
  if (e.action === 'alert.contacted') return `${d.method} · ${d.outcome}`
  if (e.action === 'alert.action') return `${d.action === 'block_card' ? 'Card blocked' : 'Payment held'} (in the external system)`
  if (e.action === 'intake.received') return `${d.transactions} transactions · ${d.events} events · ${d.alerts} alerts${d.problems ? ` · ${d.problems} problems` : ''}`
  if (e.action === 'alert.closed') return `${d.rule} · ${d.reason} — ${d.note}`
  if (e.action === 'alert.escalated') return `${d.rule} → ${d.case || d.incident} (${d.route || 'case'})`
  if (e.action === 'cases.imported') return `${d.file} · ${d.created} new · ${d.updated} updated · ${d.skipped} skipped · ${d.rejected} not imported`
  if (e.action === 'ai.reviewed') return `${d.verdict === 'agree' ? 'Agreed with' : 'Disagreed with'} ${d.answer || 'the AI'}${d.note ? ` — ${d.note}` : ''}`
  if (e.action === 'qa.reviewed') return `${(d.result || '').toUpperCase()} · ${d.period || ''}${d.note ? ` — ${d.note}` : ''}`
  if (e.action === 'case.auto_assigned') return `to ${d.to} · balanced workload rule`
  if (e.action === 'case.escalated') return `to ${d.to} · ${d.reason || ''}`
  if (e.action === 'reminders.sent') return `${d.recipients ?? 0} people · ${d.items ?? 0} items`
  if (e.action === 'settings.changed') return Object.entries(d).map(([k, v]) => `${k}: ${JSON.stringify(v.from ?? '—')} → ${JSON.stringify(v.to ?? '—')}`).join(' · ')
  if (e.action === 'duo.info_shared') return `with ${d.with || 'the other institution'} · ${d.safe_harbor ? 'under the 314(b) safe harbor' : 'not covered by 314(b)'}`
  if (e.action === 'duo.sharing_purpose') return `${d.purpose}${d.safe_harbor ? ' · 314(b) covered' : ' · not covered by 314(b)'}`
  if (e.action === 'sharing.updated') return d.registered ? `Registered until ${d.expires_on} · contact ${d.contact}${d.require_both ? ' · Duo requires both sides' : ''}` : 'Not registered'
  if (d.from !== undefined || d.to !== undefined) return `${d.from ?? '—'} → ${d.to ?? '—'}`
  return Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ')
}

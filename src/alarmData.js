// Sound the alarm — data (supabase_alarms.sql, api/alarm.js). Demo visitors get
// Demo Bank's in-browser copy (demoBackend.js).
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
  if (r.status === 404) throw new Error('Alarms aren’t set up in this workspace yet (run supabase_alarms.sql).')
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}
const changed = () => window.dispatchEvent(new Event('cov:alarm-changed'))
// Level 2 and 3 alarms also go to the team's Slack channel; failures don't block the alarm
const notify = (alarmId, event) => isSignedIn()
  ? fetch('/api/alarm', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify({ alarmId, event }) }).catch(() => {})
  : Promise.resolve()

export const LEVELS = {
  1: { name: 'Watch',    meaning: 'Something looks off',                 told: 'the fraud team, with a quiet banner',               color: '#1A1814', bg: '#E7E2D9', border: '#B8B0A4' },
  2: { name: 'Alert',    meaning: 'A confirmed pattern; losses possible', told: 'the whole team and Slack; a Trio incident opens',   color: '#78350F', bg: '#FEF3C7', border: '#D97706' },
  3: { name: 'Critical', meaning: 'An active attack with real losses',    told: 'everyone, including leadership; the playbook starts', color: '#FFFFFF', bg: '#991B1B', border: '#7F1D1D' },
}

export const alarmList = () => rpc('alarm_list').then(r => Array.isArray(r) ? r : [])
export async function alarmRaise({ level, title, doNow, nextMinutes, confirmed }) {
  const r = await rpc('alarm_raise', { p_level: level, p_title: title, p_do_now: doNow || '', p_next_minutes: nextMinutes || 30, p_confirmed: !!confirmed })
  notify(r.id, r.joined ? 'joined' : 'raised'); changed(); return r
}
export async function alarmUpdate(id, action, { level = null, doNow = null, nextMinutes = null, ownerEmail = null, incidentId = null, note = '', confirmed = false } = {}) {
  await rpc('alarm_update', { p_id: id, p_action: action, p_level: level, p_do_now: doNow, p_next_minutes: nextMinutes, p_owner_email: ownerEmail,
    p_incident_id: incidentId, p_note: note, p_confirmed: !!confirmed })
  if (action === 'level' || action === 'stand_down') notify(id, action === 'level' ? 'level' : 'stood_down')
  changed()
}

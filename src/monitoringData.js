// ═══════════════════════════════════════════════════════════════════════════════
// MONITORING DATA — transactions and alerts (supabase_monitoring.sql)
// ═══════════════════════════════════════════════════════════════════════════════
// Signed in: the institution's tables, through institution-scoped functions.
// Demo visitors: Demo Bank's in-browser copy (demoBackend.js). Imports go up in
// batches of 1000; the rules (monitoring.mjs) run in the browser over each
// customer's last 30 days and the alerts they raise are stored here.
import { accessToken, isSignedIn } from './auth.js'
import { demoRpc } from './demoBackend.js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''
const CHUNK = 1000

async function rpc(fn, args) {
  if (!isSignedIn()) return demoRpc(fn, args)
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${accessToken() || SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (r.status === 404) throw new Error('Transaction monitoring isn’t set up in this workspace yet (run supabase_monitoring.sql).')
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || `HTTP ${r.status}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

export async function ingest(txs, onProgress) {
  let added = 0
  for (let i = 0; i < txs.length; i += CHUNK) {
    added += (await rpc('tm_ingest', { p_rows: txs.slice(i, i + CHUNK) })) || 0
    onProgress?.(Math.min(txs.length, i + CHUNK), txs.length)
  }
  return added
}
export const windowFor = (customers, since) => rpc('tm_window', { p_customers: customers, p_since: since }).then(rows => (rows || []).map(r => ({ ...r, amount: Number(r.amount) })))
export const batches = () => rpc('tm_batches').then(d => d || [])
export async function addAlerts(alerts) {
  let added = 0
  for (let i = 0; i < alerts.length; i += CHUNK) added += (await rpc('tm_alerts_add', { p_rows: alerts.slice(i, i + CHUNK) })) || 0
  return added
}
export const listAlerts = status => rpc('tm_alerts_list', { p_status: status || null, p_limit: 2000 })
  .then(rows => (rows || []).map(r => ({ ...r.data, id: r.id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at })))
export const setAlert = (id, status, patch) => rpc('tm_alert_set', { p_id: id, p_status: status, p_patch: patch || {} })

// ── Fraud: account events, confirmed-victim lookups, API keys (supabase_fraud.sql) ──
export async function ingestEvents(events) {
  let added = 0
  for (let i = 0; i < events.length; i += CHUNK) added += (await rpc('tm_events_ingest', { p_rows: events.slice(i, i + CHUNK) })) || 0
  return added
}
export const eventsWindow = (customers, since) => rpc('tm_events_window', { p_customers: customers, p_since: since }).then(d => d || [])
export const windowByNames = (names, since) => rpc('tm_window_names', { p_names: names, p_since: since }).then(rows => (rows || []).map(r => ({ ...r, amount: Number(r.amount) })))
export const createKey = label => rpc('intake_key_create', { p_label: label })
export const listKeys = () => rpc('intake_keys_list').then(d => d || [])
export const revokeKey = id => rpc('intake_key_revoke', { p_id: id })

// ── Acting in the institution's systems, and notifications (supabase_actions.sql, api/action.js) ──
export const getEndpoint = () => rpc('action_endpoint_get').then(d => (d && d[0]) || null)
export const setEndpoint = (url, slackUrl, notifyMin) => rpc('action_endpoint_set', { p_url: url, p_slack_url: slackUrl, p_notify_min: notifyMin })
export const rotateSecret = () => rpc('action_secret_rotate')
export const intakeStatus = () => rpc('intake_status').then(d => (d && d[0]) || { active_keys: 0, last_received: null })
export const markDemoFeed = () => { try { localStorage.setItem('cov_demo_feed_at', JSON.stringify(new Date().toISOString())) } catch {} }
// Sends the action to the institution's endpoint. Answers { ok, reference, error } or
// { notConnected: true } when no endpoint is set up. Demo: simulated, nothing leaves the browser.
export async function sendAction(body) {
  if (!isSignedIn()) {
    await new Promise(r => setTimeout(r, 600))
    let e = null; try { e = JSON.parse(localStorage.getItem('cov_demo_action_endpoint') || 'null') } catch {}
    if (body.test && !e?.url) return { notConnected: true }
    return { ok: true, demo: true, reference: 'DEMO-' + Math.random().toString(36).slice(2, 8).toUpperCase() }
  }
  const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (r.status === 409 && d.error === 'not_connected') return { notConnected: true }
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

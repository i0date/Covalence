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

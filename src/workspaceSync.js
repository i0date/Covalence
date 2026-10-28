// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE SYNC — browser-only data → the institution's workspace (workspace_kv)
// ═══════════════════════════════════════════════════════════════════════════════
// The tools keep reading and writing localStorage as before. While a user is
// signed in, writes to the keys below are mirrored to Supabase, and the
// workspace's values are pulled into this browser on sign-in, on focus and
// every minute. Demo rows (COV-DEMO / MCH-DEMO) never leave the browser.
// On sign-out the workspace's data is removed from this browser.
import { accessToken, canWrite, canConfigure } from './auth.js'
import { isDemoCase } from './CaseThread.jsx'
import { readCases, writeCases } from './caseStore.js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''

// What belongs to the institution (everything else stays per-browser: who you
// are, demo flags, UI preferences; cases and Trio incidents sync on their own)
const SYNC_KEYS = new Set([
  'cov_settings', 'cov_autobatch_3pm',
  'triage_outcomes', 'triage_archive',
  'dfa_manual_claims', 'dfa_crypto_claims', 'dfa_excluded_ids', 'dfa_win_overrides',
  'dfa_refund_pct', 'dfa_recourse_type', 'dfa_holding_days', 'dfa_advance_override',
  'cov_trio_playbooks', 'cov_trio_debriefs', 'cov_trio_strategy_notes', 'cov_strategy_global_notes',
  'duo_my_sessions', 'cov_import_templates',
])
const SYNC_PREFIXES = ['desk_cs_hist_', 'desk_cs_stage_', 'duo_audit_']
export const isSyncedKey = k => SYNC_KEYS.has(k) || SYNC_PREFIXES.some(p => k.startsWith(p))
// Arrays that may contain demo rows (records, or bare case ids)
const DEMO_FILTERED = new Set(['triage_outcomes', 'triage_archive', 'dfa_manual_claims', 'dfa_crypto_claims', 'dfa_excluded_ids'])
const isDemoItem = x => typeof x === 'string' ? isDemoCase({ id: x }) : isDemoCase(x)

let active = false          // signed in with an institution
let applyingRemote = false  // suppress echo while writing pulled values
let institutionId = null
let lastPull = null
const pending = new Map()   // key → timer
const origSet = Storage.prototype.setItem
const origRemove = Storage.prototype.removeItem

async function rpc(fn, args) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${accessToken() || SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (r.status === 404) { const e = new Error('not deployed'); e.missing = true; throw e }
  if (!r.ok) throw new Error(await r.text())
  const t = await r.text(); return t ? JSON.parse(t) : null
}

const withoutDemo = (key, raw) => {
  if (!DEMO_FILTERED.has(key) || raw == null) return raw
  try { return JSON.stringify(JSON.parse(raw).filter(x => !isDemoItem(x))) } catch { return raw }
}
// Remote value + this browser's demo rows
const withLocalDemo = (key, remoteRaw) => {
  if (!DEMO_FILTERED.has(key)) return remoteRaw
  try {
    const local = JSON.parse(localStorage.getItem(key) || '[]').filter(isDemoItem)
    return JSON.stringify([...JSON.parse(remoteRaw), ...local])
  } catch { return remoteRaw }
}

const SETTINGS_KEYS = new Set(['cov_settings', 'cov_autobatch_3pm'])  // admins & reviewers only (enforced in the database too)
function push(key) {
  if (!canWrite() || (SETTINGS_KEYS.has(key) && !canConfigure())) return
  clearTimeout(pending.get(key))
  pending.set(key, setTimeout(async () => {
    pending.delete(key)
    if (!active) return
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) await rpc('kv_delete', { p_key: key })
      else await rpc('kv_put', { p_key: key, p_value: withoutDemo(key, raw) })
    } catch (e) { if (!e.missing) console.warn('[workspace sync]', key, e.message) }
  }, 800))
}

// Mirror the tools' own localStorage writes (installed once, inert until signed in)
let installed = false
function install() {
  if (installed) return
  installed = true
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v)
    if (active && !applyingRemote && this === window.localStorage && isSyncedKey(k)) push(k)
  }
  Storage.prototype.removeItem = function (k) {
    origRemove.call(this, k)
    if (active && !applyingRemote && this === window.localStorage && isSyncedKey(k)) push(k)
  }
}

// Apply the workspace's values to this browser. Returns the number of keys changed.
async function pull() {
  const rows = await rpc('kv_pull', { p_since: lastPull })
  let changed = 0
  applyingRemote = true
  try {
    for (const row of rows || []) {
      if (pending.has(row.key)) continue // a local edit is about to be sent; it wins
      const next = withLocalDemo(row.key, row.value)
      if (localStorage.getItem(row.key) !== next) { origSet.call(localStorage, row.key, next); changed++ }
      if (!lastPull || row.updated_at > lastPull) lastPull = row.updated_at
    }
  } finally { applyingRemote = false }
  return { rows: rows || [], changed }
}

let timer = null
const onFocus = () => { if (active) pull().catch(() => {}) }

// Signed in: first pull, then upload anything this browser has that the
// workspace doesn't yet (first sign-in after using Covalence locally).
export async function startWorkspaceSync(instId) {
  install()
  if (!SUPA_URL || !SUPA_KEY) return { changed: 0 }
  if (institutionId !== instId) { institutionId = instId; lastPull = null }
  active = true
  try {
    const { rows, changed } = await pull()
    const remoteKeys = new Set(rows.map(r => r.key))
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (isSyncedKey(k) && !remoteKeys.has(k)) push(k)
    }
    clearInterval(timer); timer = setInterval(onFocus, 60000)
    window.addEventListener('focus', onFocus)
    return { changed }
  } catch (e) {
    if (e.missing) { active = false; return { changed: 0 } } // SQL not deployed yet: stay local
    console.warn('[workspace sync]', e.message)
    return { changed: 0 }
  }
}

// Sign-out: stop syncing and remove the workspace's data from this browser
// (demo rows stay so the demo keeps working).
export function stopWorkspaceSync({ clearLocal = true } = {}) {
  active = false
  institutionId = null; lastPull = null
  clearInterval(timer); timer = null
  window.removeEventListener('focus', onFocus)
  pending.forEach(t => clearTimeout(t)); pending.clear()
  if (!clearLocal) return
  const keys = []
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isSyncedKey(k)) keys.push(k) }
  keys.forEach(k => {
    if (DEMO_FILTERED.has(k)) {
      try { origSet.call(localStorage, k, JSON.stringify(JSON.parse(localStorage.getItem(k) || '[]').filter(isDemoItem))) } catch { origRemove.call(localStorage, k) }
    } else origRemove.call(localStorage, k)
  })
  // Shared cases and Trio incidents synced from the workspace
  writeCases(readCases().filter(isDemoCase))
  try { origSet.call(localStorage, 'cov_trio_incidents', JSON.stringify(JSON.parse(localStorage.getItem('cov_trio_incidents') || '[]').filter(isDemoCase))) } catch {}
}

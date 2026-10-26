// ═══════════════════════════════════════════════════════════════════════════════
// AUTH — Supabase Auth sign-in (email code) + institution membership
// ═══════════════════════════════════════════════════════════════════════════════
// Shared features (case pool, team queue, Duo, case links, Trio sync, evidence)
// run as the signed-in user, so the database scopes everything to their
// institution (see supabase_auth.sql). Visitors who don't sign in keep the
// local demo.
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = import.meta.env?.VITE_SUPABASE_URL || ''
const SUPA_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''

export const supabase = SUPA_URL && SUPA_KEY
  ? createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cov_auth' } })
  : null
export const authAvailable = !!supabase

// Current access token, kept in sync for the app's raw fetch calls
let _token = null
export function accessToken() { return _token }
export function isSignedIn() { return !!_token }
if (supabase) supabase.auth.onAuthStateChange((_event, session) => { _token = session?.access_token || null })

// Invite links look like https://covalence.vercel.app/?invite=<code>
export function pendingInvite() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('invite')
    if (fromUrl) sessionStorage.setItem('cov_invite', fromUrl)
    return sessionStorage.getItem('cov_invite') || ''
  } catch { return '' }
}
export function clearPendingInvite() {
  try {
    sessionStorage.removeItem('cov_invite')
    const u = new URL(window.location.href)
    if (u.searchParams.has('invite')) { u.searchParams.delete('invite'); window.history.replaceState(null, '', u.toString()) }
  } catch {}
}

function need() { if (!supabase) throw new Error('Sign-in is not configured for this deployment') }
async function rpc(fn, args) {
  need()
  const { data, error } = await supabase.rpc(fn, args || {})
  if (error) throw new Error(error.message)
  return data
}

export async function getSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  _token = data.session?.access_token || null
  return data.session
}
export function onSessionChange(fn) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_e, session) => fn(session))
  return () => data.subscription.unsubscribe()
}

// Sends a 6-digit code (and a sign-in link, depending on the email template)
export async function sendCode(email) {
  need()
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + window.location.search },
  })
  if (error) throw new Error(error.message)
}
export async function verifyCode(email, code) {
  need()
  const { data, error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
  if (error) throw new Error(error.message)
  _token = data.session?.access_token || null
  return data.session
}
export async function signOut() {
  if (supabase) await supabase.auth.signOut().catch(() => {})
  _token = null
}

// Membership: { institution_id, institution_name, role, display_name, email } or null
export async function getMembership() { const d = await rpc('my_membership'); return (d && d[0]) || null }
export async function createInstitution(name, displayName) {
  const d = await rpc('create_institution', { p_name: name, p_display_name: displayName }); return d && d[0]
}
export async function acceptInvite(code, displayName) {
  const d = await rpc('accept_invite', { p_code: code, p_display_name: displayName }); return d && d[0]
}
export const createInvite = (email, role) => rpc('create_invite', { p_email: email, p_role: role || 'member' })
export const listTeam     = () => rpc('list_team').then(d => d || [])
export const listInvites  = () => rpc('list_invites').then(d => d || [])
export const revokeInvite = (code) => rpc('revoke_invite', { p_code: code })
export const removeMember = (userId) => rpc('remove_member', { p_user_id: userId })
export const inviteLink   = (code) => `${window.location.origin}/?invite=${code}`

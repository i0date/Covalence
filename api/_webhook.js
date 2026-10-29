// Shared by api/action.js and api/intake.js (the leading underscore keeps it from being a route)
// Signed events to an institution's own endpoint, and Slack notifications.
//
// Every event is signed like this, so the receiver can check it came from Covalence:
//   Covalence-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the secret>
// Receivers should reject a signature older than 5 minutes.

const crypto = require('crypto')
const dns = require('dns').promises
const net = require('net')
const TIMEOUT_MS = 8000

function sign(secret, body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
}

// Only public https hosts — never this server's own network
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateIp(v.slice(7))
}
async function safeUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return 'That isn’t a valid URL' }
  if (u.protocol !== 'https:') return 'The endpoint must use https://'
  if (u.username || u.password) return 'Put credentials in your receiver, not in the URL'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return 'The endpoint must be reachable on the public internet'
  const addrs = net.isIP(host) ? [host] : await dns.lookup(host, { all: true }).then(r => r.map(x => x.address)).catch(() => [])
  if (!addrs.length) return `Couldn’t find ${host}`
  if (addrs.some(privateIp)) return 'The endpoint must be reachable on the public internet'
  return null
}

async function post(url, body, headers = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Covalence-Webhooks/1', ...headers }, body, signal: ctl.signal, redirect: 'manual' })
    const text = (await r.text().catch(() => '')).slice(0, 2000)
    let json = null; try { json = JSON.parse(text) } catch {}
    return { ok: r.ok, status: r.status, json, text }
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? `No answer within ${TIMEOUT_MS / 1000} seconds` : 'Couldn’t reach the endpoint' }
  } finally { clearTimeout(t) }
}

// A signed event to the institution's endpoint
async function sendEvent(endpoint, type, data) {
  const unsafe = await safeUrl(endpoint.url)
  if (unsafe) return { ok: false, status: 0, error: unsafe }
  const id = 'evt_' + crypto.randomBytes(12).toString('hex')
  const body = JSON.stringify({ id, type, created: new Date().toISOString(), data })
  const r = await post(endpoint.url, body, { 'Covalence-Event-Id': id, 'Covalence-Event-Type': type, ...(endpoint.secret ? { 'Covalence-Signature': sign(endpoint.secret, body) } : {}) })
  return { ...r, id }
}

const RANK = { high: 3, medium: 2, low: 1 }
const meets = (sev, min) => min !== 'off' && (RANK[sev] || 0) >= (RANK[min] || 3)

// One Slack message for a batch of new alerts
async function notifySlack(slackUrl, alerts, appUrl) {
  if (!slackUrl || !alerts.length) return null
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
  const where = a => a.kind === 'fraud' ? '001 Triage → Alerts' : '005 Licit → Alerts'
  const lines = alerts.slice(0, 10).map(a => `• *${String(a.severity || '').toUpperCase()}* ${a.label} — ${a.customerName || a.customerId}${a.total ? `, ${money(a.total)}` : ''} _(${where(a)})_`)
  const text = `${alerts.length} new alert${alerts.length === 1 ? '' : 's'} in Covalence\n${lines.join('\n')}${alerts.length > 10 ? `\n…and ${alerts.length - 10} more` : ''}\n<${appUrl}|Open Covalence>`
  return post(slackUrl, JSON.stringify({ text }))
}

// A plain Slack message (alarms)
const postSlack = (slackUrl, text) => slackUrl ? post(slackUrl, JSON.stringify({ text })) : Promise.resolve(null)

module.exports = { sign, safeUrl, sendEvent, notifySlack, postSlack, meets }

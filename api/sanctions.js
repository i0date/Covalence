// Vercel serverless function — /api/sanctions → screen names and wallet addresses against OFAC
//   POST { subjects: [{ role, name }], wallets: [address], threshold? }
//        → { list: { source, fetchedAt, entries, wallets }, results: [{ role, name, hits }], walletResults: [{ address, hits }] }
//   GET  → the list's details (when it was fetched, how many entries)
// Lists: OFAC SDN + Consolidated (non-SDN), from the Treasury's sanctions list
// service. Downloading them takes ~35 s from Vercel, so a compact copy is kept
// in Supabase Storage (bucket cov-reference) and a cold start reads that in a
// second or two. A daily cron (GET ?refresh=1 with CRON_SECRET) downloads a
// fresh copy; if the copy is missing or more than 36 hours old, the function
// downloads from Treasury itself and saves a new copy.
// Matching is src/sanctionsMatch.mjs (shared with the tests).
// Security hardening:
//   • Only names and wallet addresses are accepted — never whole cases
//   • ≤ 20 subjects and ≤ 20 wallets per call, names ≤ 200 characters
//   • Per-IP rate limit: 60 / 60 s; CORS restricted to ALLOWED_ORIGIN; nothing is logged

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const REFRESH_MS = 12 * 60 * 60 * 1000          // in-memory copy
const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000  // stored copy
const BUCKET = 'cov-reference', OBJECT = 'ofac-lists.json'
const _rateStore = {}
let _cache = null       // { index, fetchedAt }
let _loading = null

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = _rateStore[ip]
  if (!entry || now > entry.resetAt) { _rateStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }; return true }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// ── Supabase Storage copy ──
const store = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, h: { apikey: key, Authorization: `Bearer ${key}` } } : null
}
async function readSnapshot() {
  const st = store(); if (!st) return null
  try {
    const r = await fetch(`${st.url}/storage/v1/object/${BUCKET}/${OBJECT}`, { headers: st.h, signal: AbortSignal.timeout(15000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}
async function writeSnapshot(snap) {
  const st = store(); if (!st) return
  try {
    await fetch(`${st.url}/storage/v1/bucket`, { method: 'POST', headers: { ...st.h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) })   // already there → 400/409, fine
    await fetch(`${st.url}/storage/v1/object/${BUCKET}/${OBJECT}`, { method: 'POST',
      headers: { ...st.h, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(snap) })
  } catch {}
}

// ── Treasury ──
async function fromTreasury(m) {
  const get = async f => {
    const r = await fetch(m.LIST_BASE + f, { headers: { 'User-Agent': 'Covalence sanctions screening' } })
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`)
    return m.parseOfacCsv(new TextDecoder('latin1').decode(await r.arrayBuffer()))
  }
  const [sdn, alt, cons, consAlt] = await Promise.all(Object.values(m.LIST_FILES).map(get))
  // Keep only the columns the matcher reads (id, name, type, programs, title … remarks)
  const slim = rows => rows.map(r => [r[0], r[1], r[2], r[3], r[4], '', '', '', '', '', '', r[11] || ''])
  const slimAlt = rows => rows.map(r => [r[0], r[1], r[2], r[3]])
  return { fetchedAt: new Date().toISOString(), source: 'treasury', sdn: slim(sdn), alt: slimAlt(alt), cons: slim(cons), consAlt: slimAlt(consAlt) }
}

async function loadLists(m, { force } = {}) {
  let snap = force ? null : await readSnapshot()
  if (!snap || Date.now() - new Date(snap.fetchedAt) > SNAPSHOT_MAX_AGE_MS) {
    try { snap = await fromTreasury(m); await writeSnapshot(snap) }
    catch (e) { if (!snap) throw e }   // Treasury unreachable: an older stored copy is better than none
  }
  return { index: m.buildIndex(snap), fetchedAt: snap.fetchedAt }
}
async function lists(m, opts = {}) {
  if (!opts.force && _cache && Date.now() - new Date(_cache.fetchedAt) < REFRESH_MS) return _cache
  if (!_loading) _loading = loadLists(m, opts).then(c => { _cache = c; return c }).finally(() => { _loading = null })
  try { return await _loading }
  catch (e) { if (_cache) return _cache; throw e }
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  if (!checkRateLimit(ip)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many screening requests — wait a minute' }) }

  const m = await import('../src/sanctionsMatch.mjs')
  // Daily cron: download a fresh copy from Treasury and store it
  if (req.method === 'GET' && req.query?.refresh) {
    const secret = process.env.CRON_SECRET
    if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })
    try { const c = await lists(m, { force: true }); return res.status(200).json({ refreshed: c.fetchedAt, entries: c.index.entries }) }
    catch { return res.status(502).json({ error: 'Treasury couldn’t be reached' }) }
  }
  let c
  try { c = await lists(m) }
  catch { return res.status(503).json({ error: 'The OFAC lists couldn’t be reached. Try again shortly.' }) }
  const list = { source: 'OFAC SDN + Consolidated (non-SDN)', fetchedAt: c.fetchedAt, entries: c.index.entries, wallets: c.index.wallets.size }
  if (req.method === 'GET') return res.status(200).json({ list })

  const { subjects = [], wallets = [], threshold } = req.body || {}
  if (!Array.isArray(subjects) || !Array.isArray(wallets) || subjects.length > 20 || wallets.length > 20)
    return res.status(400).json({ error: 'Send up to 20 names and 20 wallet addresses' })
  const t = typeof threshold === 'number' && threshold >= 0.8 && threshold <= 1 ? threshold : 0.9
  const results = subjects
    .filter(s => s && typeof s.name === 'string' && s.name.trim() && s.name.length <= 200)
    .map(s => ({ role: String(s.role || '').slice(0, 40), name: s.name.trim(), hits: m.screenName(c.index, s.name, { threshold: t }) }))
  const walletResults = wallets.filter(w => typeof w === 'string' && w.length <= 100)
    .map(address => ({ address, hits: m.screenWallet(c.index, address) }))
  return res.status(200).json({ list, threshold: t, results, walletResults })
}

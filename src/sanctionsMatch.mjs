// ═══════════════════════════════════════════════════════════════════════════════
// SANCTIONS MATCH — OFAC lists → an index, and fuzzy name / exact wallet screening
// ═══════════════════════════════════════════════════════════════════════════════
// Plain JavaScript (no browser, no React) so the server (api/sanctions.js) and
// the tests use the same code. Lists: OFAC's Specially Designated Nationals
// (SDN.CSV + ALT.CSV aliases) and the Consolidated non-SDN list
// (CONS_PRIM.CSV + CONS_ALT.CSV), as published at
// sanctionslistservice.ofac.treas.gov. Digital currency addresses come from the
// SDN remarks ("Digital Currency Address - ETH 0x…").
//
// Names are compared after normalising (accents, punctuation, word order,
// common company suffixes) with a token-by-token Jaro-Winkler score in both
// directions, so "Banco Nacional de Cuba" ≈ "BANCO NACIONAL DE CUBA" and
// "Vladimir Putin" ≈ "PUTIN, Vladimir Vladimirovich". Wallets must match exactly.

export const LIST_FILES = { sdn: 'SDN.CSV', alt: 'ALT.CSV', cons: 'CONS_PRIM.CSV', consAlt: 'CONS_ALT.CSV' }
export const LIST_BASE = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/'

// ─── CSV (no header row; "-0-" means empty) ───────────────────────────────────
export function parseOfacCsv(text) {
  const rows = []; let row = [], f = '', q = false
  const s = String(text || '').replace(/\u001a/g, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++ } else q = false } else f += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1) rows.push(row); row = [] }
    else f += ch
  }
  row.push(f); if (row.length > 1) rows.push(row)
  return rows.map(r => r.map(v => { const t = v.trim(); return t === '-0-' ? '' : t }))
}

// ─── Normalising ──────────────────────────────────────────────────────────────
const NOISE = new Set(['the', 'of', 'and', 'ltd', 'llc', 'inc', 'co', 'company', 'corp', 'corporation', 'limited', 'plc', 'sa', 'sas', 'srl', 'gmbh', 'ag',
  'jsc', 'ojsc', 'pjsc', 'cjsc', 'llp', 'lp', 'bv', 'nv', 'oy', 'ab', 'spa', 'fze', 'fzco', 'fzc', 'dmcc', 'pte', 'pty', 'sdn', 'bhd', 'ooo', 'zao', 'oao', 'tov', 'jv'])
export function tokens(name) {
  return String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(t => t && !NOISE.has(t))
}

// Jaro-Winkler similarity of two words, 0..1
export function jw(a, b) {
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false)
  let m = 0
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (mb[j] || a[i] !== b[j]) continue
      ma[i] = mb[j] = true; m++; break
    }
  }
  if (!m) return 0
  let t = 0, k = 0
  for (let i = 0; i < la; i++) { if (!ma[i]) continue; while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++ }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3
  let p = 0; while (p < 4 && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

// How alike two token lists are, in both directions, weighted by word length
export function nameScore(q, e) {
  if (!q.length || !e.length) return 0
  const side = (x, y) => {
    let sum = 0, w = 0
    for (const a of x) { let best = 0; for (const b of y) { const s = jw(a, b); if (s > best) best = s } const wt = Math.min(a.length, 8); sum += best * wt; w += wt }
    return sum / w
  }
  return (side(q, e) + side(e, q)) / 2
}

// ─── Index ────────────────────────────────────────────────────────────────────
// entries: [{ uid, list, name, type, programs, remarks, names: [{ text, tokens, alias }] }]
export function buildIndex({ sdn, alt, cons, consAlt }) {
  const entries = new Map()
  const add = (list, rows) => rows.forEach(r => {
    const [uid, name, type, program, title, , , , , , , remarks] = r
    if (!uid || !name) return
    entries.set(list + ':' + uid, { uid, list, name, type: type || 'entity', programs: program || '', title: title || '', remarks: remarks || '', names: [{ text: name, tokens: tokens(name), alias: false }] })
  })
  const addAlt = (list, rows) => rows.forEach(r => {
    const [uid, , kind, name] = r
    const e = entries.get(list + ':' + uid)
    if (e && name) e.names.push({ text: name, tokens: tokens(name), alias: true, kind: kind || 'aka' })
  })
  add('SDN', sdn || []); addAlt('SDN', alt || [])
  add('NON-SDN', cons || []); addAlt('NON-SDN', consAlt || [])

  // Token prefixes → names, so a query only compares against plausible candidates
  const byPrefix = new Map(), wallets = new Map()
  for (const e of entries.values()) {
    e.names.forEach((n, ni) => n.tokens.forEach(t => {
      if (t.length < 2) return
      const k = t.slice(0, 3)
      if (!byPrefix.has(k)) byPrefix.set(k, [])
      byPrefix.get(k).push([e, ni])
    }))
    for (const m of e.remarks.matchAll(/Digital Currency Address - ([A-Z0-9]+) ([A-Za-z0-9]+)/g)) {
      const addr = m[2], key = /^0x/i.test(addr) ? addr.toLowerCase() : addr
      if (!wallets.has(key)) wallets.set(key, [])
      wallets.get(key).push({ e, currency: m[1], address: addr })
    }
  }
  return { entries: entries.size, byPrefix, wallets, names: [...entries.values()].reduce((n, e) => n + e.names.length, 0) }
}

// OFAC writes several programs as "IRAN-HR] [CYBER2"
const programs = p => p.replace(/^\[|\]$/g, '').split(/\]\s*\[/).map(x => x.trim()).filter(Boolean).join(' · ')
const summary = (e, extra) => ({ uid: e.uid, list: e.list, name: e.name, type: e.type, programs: programs(e.programs), title: e.title,
  remarks: e.remarks.length > 300 ? e.remarks.slice(0, 300) + '…' : e.remarks, ...extra })

// → hits, best first: [{ uid, list, name, type, programs, score, matchedName, alias }]
// Ships and aircraft are skipped unless asked for: their names ("MARIA GRACE") collide with people's
export function screenName(index, name, { threshold = 0.9, limit = 5, skipTypes = ['vessel', 'aircraft'] } = {}) {
  const q = tokens(name)
  if (!q.length) return []
  const seen = new Map()
  for (const t of q) {
    if (t.length < 2) continue
    for (const [e, ni] of index.byPrefix.get(t.slice(0, 3)) || []) {
      const key = e.list + ':' + e.uid + ':' + ni
      if (seen.has(key)) continue
      const n = e.names[ni]
      if (skipTypes.includes(e.type)) { seen.set(key, 0); continue }
      // One-word names only match one-word entries exactly; otherwise common words would flood the results
      if ((q.length === 1 || n.tokens.length === 1) && q.join(' ') !== n.tokens.join(' ')) { seen.set(key, 0); continue }
      const s = nameScore(q, n.tokens)
      seen.set(key, s)
      if (s >= threshold) {
        const id = e.list + ':' + e.uid
        const prev = seen.get('best:' + id)
        if (!prev || s > prev.score) seen.set('best:' + id, summary(e, { score: Math.round(s * 1000) / 1000, matchedName: n.text, alias: n.alias }))
      }
    }
  }
  return [...seen.entries()].filter(([k]) => k.startsWith('best:')).map(([, v]) => v).sort((a, b) => b.score - a.score).slice(0, limit)
}

export function screenWallet(index, address) {
  const a = String(address || '').trim()
  if (a.length < 20) return []
  return (index.wallets.get(/^0x/i.test(a) ? a.toLowerCase() : a) || []).map(w => summary(w.e, { score: 1, matchedName: `${w.currency} ${w.address}`, wallet: true }))
}

// Wallet addresses mentioned in free text (BTC, ETH/EVM, TRON, …), for screening
export function findWallets(text) {
  const s = String(text || '')
  const out = new Set()
  for (const m of s.matchAll(/\b(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,59})\b/g)) out.add(m[1])
  return [...out]
}

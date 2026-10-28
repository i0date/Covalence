// ═══════════════════════════════════════════════════════════════════════════════
// CASE STORE — the case list (cov_outcomes) in IndexedDB
// ═══════════════════════════════════════════════════════════════════════════════
// localStorage holds about 5 million characters per site (~6,000 imported cases),
// so cases live in IndexedDB, one record per case. The tools read and write
// synchronously against an in-memory copy loaded once before the app renders;
// writes reach IndexedDB in the background, changed cases only, and other tabs
// hear about them over a BroadcastChannel. Where IndexedDB can't be opened
// (some private modes) cases stay in localStorage as before.
const KEY = 'cov_outcomes'            // the old localStorage key (migrated once, then removed)
const DB_NAME = 'covalence', STORE = 'cases'
const OPEN_TIMEOUT = 3000             // a stuck open (seen in private modes) falls back to localStorage

let cache = []                        // what the tools see
let db = null                         // null → localStorage fallback
let pending = null                    // { puts: Map, dels: Set } waiting to be written
let flushing = null
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cov_cases') : null
const remoteListeners = new Set()

const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    const t = setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT)
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }) }
    r.onsuccess = () => { clearTimeout(t); resolve(r.result) }
    r.onerror = () => { clearTimeout(t); reject(r.error) }
    r.onblocked = () => { clearTimeout(t); reject(new Error('IndexedDB blocked')) }
  })
}
const readAll = () => req(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())

// Call once before rendering. Moves any localStorage cases into IndexedDB.
export async function initCaseStore() {
  try {
    db = await openDb()
    db.onversionchange = () => { db.close(); db = null }
    const legacy = localStorage.getItem(KEY)
    if (legacy !== null) {
      const list = readLocal().filter(c => c && c.id != null)
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite'), s = tx.objectStore(STORE)
        list.forEach(c => s.put(c))
        tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error)
      })
      localStorage.removeItem(KEY)
    }
    cache = await readAll()
  } catch (e) {
    console.warn('[case store] IndexedDB unavailable, using localStorage:', e?.message || e)
    db = null
    cache = readLocal()
  }
  return cache
}

export const readCases = () => cache
// 'indexeddb', or 'localStorage' when IndexedDB couldn't be opened
export const caseStoreBackend = () => db ? 'indexeddb' : 'localStorage'

// Replace the case list. Cases not in `next` are deleted; cases whose object
// changed (by reference — the tools copy, never mutate) are written.
export function writeCases(next) {
  const prev = cache
  cache = next
  if (!db) {
    try { localStorage.setItem(KEY, JSON.stringify(next)) }
    catch (e) { console.warn('[case store] could not save cases:', e?.message || e) }
    channel?.postMessage('changed')
    return
  }
  const before = new Map(prev.map(c => [c.id, c]))
  if (!pending) pending = { puts: new Map(), dels: new Set() }
  for (const c of next) {
    if (before.get(c.id) !== c) { pending.puts.set(c.id, c); pending.dels.delete(c.id) }
    before.delete(c.id)
  }
  for (const id of before.keys()) { pending.dels.add(id); pending.puts.delete(id) }
  if (!pending.puts.size && !pending.dels.size) { pending = null; return }
  flush()
}

function flush() {
  if (flushing) return flushing
  flushing = (async () => {
    while (pending && db) {
      const { puts, dels } = pending; pending = null
      try {
        await new Promise((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite'), s = tx.objectStore(STORE)
          puts.forEach(c => s.put(c)); dels.forEach(id => s.delete(id))
          tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error)
        })
        channel?.postMessage('changed')
      } catch (e) { console.warn('[case store] could not save cases:', e?.message || e) }
    }
    flushing = null
  })()
  return flushing
}

// Resolves once every write so far has reached IndexedDB.
export const caseStoreIdle = () => flushing || Promise.resolve()

// Another tab changed the cases: reload them and tell `fn` (returns unsubscribe)
export function onCasesFromOtherTab(fn) {
  remoteListeners.add(fn)
  return () => remoteListeners.delete(fn)
}
if (channel) channel.onmessage = async () => {
  try {
    await caseStoreIdle()                         // don't let a stale read overwrite our own queued writes
    let fresh = db ? await readAll() : readLocal()
    if (pending) {                                // writes queued meanwhile win over what was read
      const map = new Map(fresh.map(c => [c.id, c]))
      pending.puts.forEach((c, id) => map.set(id, c)); pending.dels.forEach(id => map.delete(id))
      fresh = [...map.values()]
    }
    cache = fresh
    remoteListeners.forEach(fn => { try { fn(fresh) } catch {} })
  } catch {}
}

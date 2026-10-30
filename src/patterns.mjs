// ═══════════════════════════════════════════════════════════════════════════════
// PATTERNS — an early warning of a fraud wave, before anyone sounds the alarm
// ═══════════════════════════════════════════════════════════════════════════════
// Groups cases by who was paid (a merchant, a payee, a wallet) and flags any that
// suddenly gets far more cases than usual: at least MIN_CASES in the last 7 days,
// and at least SPIKE times its usual weekly rate over the 4 weeks before. Each
// pattern says what it's based on and suggests the alarm to raise; a person
// decides. Dismissed patterns stay quiet until they grow.
const DAY = 86400000
export const MIN_CASES = 3, SPIKE = 3
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const DISMISS_KEY = 'cov_patterns_dismissed'   // per browser: { key: caseCountWhenDismissed }

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 .]/g, '').trim()
const kindOf = name => /wallet|0x[0-9a-f]{4}/i.test(name) ? 'wallet' : /^(zelle|venmo|cash app|paypal|interac|wire|ach) to /i.test(name) ? 'payee' : 'merchant'

export function detectPatterns(cases, now = new Date()) {
  const recentFrom = now - 7 * DAY, baseFrom = now - 35 * DAY
  const groups = new Map()
  ;(cases || []).forEach(c => {
    const t = new Date(c.date || 0).getTime(), key = norm(c.merchant)
    if (!key || !t || t < baseFrom || t > now) return
    if (!groups.has(key)) groups.set(key, { key, name: c.merchant, recent: [], before: 0 })
    const g = groups.get(key)
    if (t >= recentFrom) g.recent.push(c); else g.before++
  })
  const parse = a => { const n = parseFloat(String(a ?? '').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0 }
  return [...groups.values()].map(g => {
    const usual = g.before / 4   // cases a week over the four weeks before
    return { ...g, usual, ratio: g.recent.length / Math.max(usual, 0.5), kind: kindOf(g.name), amount: g.recent.reduce((s, c) => s + parse(c.amount), 0) }
  }).filter(g => g.recent.length >= MIN_CASES && g.recent.length >= SPIKE * Math.max(g.usual, 0.5) - 1e-9)
    .map(g => ({ ...g,
      level: g.recent.length >= 8 ? 2 : 1,
      title: `${g.recent.length} cases at ${g.name} in 7 days`,
      basis: g.before ? `usually ${g.usual < 1 ? 'under one' : `about ${WORDS[Math.round(g.usual)] || Math.round(g.usual)}`} a week` : 'none in the four weeks before',
      doNow: g.kind === 'merchant' ? `Check new disputes for ${g.name}; consider a block or step-up on new charges there.`
        : `Check payments to ${g.name}; consider holding new ones while you look.` }))
    .sort((a, b) => b.recent.length - a.recent.length)
}

// Patterns not dismissed, or grown since they were
export function livePatterns(cases, now = new Date()) {
  let gone = {}
  try { gone = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') } catch {}
  return detectPatterns(cases, now).filter(p => !(gone[p.key] >= p.recent.length))
}
export function dismissPattern(p) {
  try { const gone = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); gone[p.key] = p.recent.length; localStorage.setItem(DISMISS_KEY, JSON.stringify(gone)) } catch {}
  window.dispatchEvent(new Event('cov:patterns-changed'))
}

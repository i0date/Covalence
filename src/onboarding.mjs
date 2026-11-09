// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARD WITH COVALENCE — a bank's new customers, checked when they open an account
// ═══════════════════════════════════════════════════════════════════════════════
// A person or a business applies through the bank's own app (POST /api/onboarding
// { application }) or the hosted form the bank opens for them (/onboard/<token>).
// Covalence keeps what the bank's compliance team needs to decide, runs the checks,
// rates the risk with its reasons, and puts it in 005 Licit → Onboarding. The
// decision goes back to the bank's systems as onboarding.decided.
//   • ID numbers (SSN, ITIN, EIN) are never stored here: they go straight to the bank's
//     endpoint as a signed onboarding.identity event, and only the last four are kept.
//   • Identity documents and selfies stay with the bank's own identity provider; the
//     bank posts the result back ({ idv }), and the application waits for it.
//   • Sanctions: OFAC screening of every person and the business (api/sanctions.js).
//     PEP comes from the customer's own declaration: no PEP list is connected.
// Plain functions, no imports, so the server and the browser agree.
// The SQL is supabase_onboarding.sql; the API is api/_onboarding.js.

const DAY = 86400000
export const LINK_HOURS = 72, MAX_LINK_HOURS = 168
export const TOKEN_RE = /^cvo_[a-f0-9]{48}$/
export const linkIdFrom = hex => 'ONL-' + hex.slice(0, 8).toUpperCase()
export const appIdFrom = hex => 'ONB-' + hex.slice(0, 10).toUpperCase()
export const linkUrl = (origin, token) => `${String(origin || '').replace(/\/+$/, '')}/onboard/${token}`

export const KINDS = { person: 'A person', business: 'A business' }
export const STATUSES = {
  waiting_idv: 'Waiting on the ID check', to_review: 'To review', on_hold: 'On hold: possible sanctions match',
  more_info: 'Asked for more', approved: 'Approved', declined: 'Declined',
}
export const OPEN = ['waiting_idv', 'to_review', 'on_hold', 'more_info']
export const RATINGS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

// What the account is for, and how it will be used (the bank's CDD questions)
export const PURPOSES = {
  person: [['everyday', 'Everyday spending and bills'], ['salary', 'Receiving my pay'], ['savings', 'Saving'], ['sending_abroad', 'Sending money to family or friends abroad'], ['business_side', 'A side business or freelance work']],
  business: [['operating', 'Running the business: paying suppliers and staff'], ['receiving', 'Taking payments from customers'], ['payroll', 'Payroll'], ['treasury', 'Holding reserves'], ['international', 'Paying or being paid abroad']],
}
export const MONTHLY = [['under_2k', 'Under $2,000'], ['2k_10k', '$2,000 to $10,000'], ['10k_50k', '$10,000 to $50,000'], ['50k_250k', '$50,000 to $250,000'], ['over_250k', 'Over $250,000']]
export const SOURCES = [['salary', 'Salary or wages'], ['business_income', 'Income from a business'], ['savings', 'Savings'], ['investments', 'Investments'], ['inheritance', 'An inheritance or gift'], ['pension', 'Pension or benefits'], ['sale_of_property', 'Selling property'], ['other', 'Something else']]
// Industries a bank looks at harder (FFIEC manual; the bank's own risk appetite decides)
export const INDUSTRIES = [
  ['retail', 'Retail or e-commerce'], ['professional', 'Professional services'], ['hospitality', 'Restaurants and hospitality'], ['construction', 'Construction and trades'],
  ['technology', 'Software and technology'], ['healthcare', 'Healthcare'], ['real_estate', 'Real estate'], ['nonprofit', 'Charity or non-profit'],
  ['msb', 'Money transmission, check cashing or currency exchange', true], ['crypto', 'Crypto assets', true], ['gambling', 'Gambling', true],
  ['cannabis', 'Cannabis', true], ['adult', 'Adult entertainment', true], ['firearms', 'Firearms and ammunition', true], ['precious_metals', 'Precious metals and jewellery', true],
  ['other', 'Something else'],
]
const HIGH_RISK_INDUSTRY = new Set(INDUSTRIES.filter(x => x[2]).map(x => x[0]))
export const CONSENT = {
  person: 'I confirm that what I’ve told you is true and complete. I agree that the bank may check my identity, screen me against sanctions lists, and keep this information as the law requires.',
  business: 'I confirm that what I’ve told you about the business and its owners is true and complete, and that I’m allowed to open this account for it. I agree that the bank may check the business and the people named, screen them against sanctions lists, and keep this information as the law requires.',
}
const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com']

const str = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n)
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(v + 'T00:00:00Z'))
const ageOn = (dob, now) => { const d = new Date(dob + 'T00:00:00Z'), n = new Date(now); let a = n.getUTCFullYear() - d.getUTCFullYear(); if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--; return a }
const digits = v => String(v ?? '').replace(/\D/g, '')
const pick = (v, list) => list.some(([k]) => k === v) ? v : ''

function address(a = {}) {
  return { line1: str(a.line1, 120), line2: str(a.line2, 120), city: str(a.city, 80), region: str(a.region, 40), postal: str(a.postal, 20), country: str(a.country || 'US', 2).toUpperCase() }
}
const addressProblems = (a, where) => !a.line1 || !a.city || !a.postal || !/^[A-Z]{2}$/.test(a.country) ? [`${where}: street, city, postal code and country are required`] : []
// A person: the applicant, or an owner of a business. idNumber is split off, never kept.
function person(p = {}, where, { owner = false } = {}) {
  const errors = []
  const out = {
    name: str(p.name, 120), dob: isDate(p.dob) ? p.dob : '', address: address(p.address),
    email: str(p.email, 160).toLowerCase(), phone: str(p.phone, 40), citizenship: str(p.citizenship || '', 2).toUpperCase(),
    ...(owner ? { ownership: Math.max(0, Math.min(100, Number(p.ownership) || 0)), controller: p.controller === true, title: str(p.title, 80) } : {}),
  }
  const id = digits(p.idNumber)
  out.idLast4 = id ? id.slice(-4) : ''
  if (!out.name) errors.push(`${where}: name is required`)
  if (!out.dob) errors.push(`${where}: date of birth is required (YYYY-MM-DD)`)
  errors.push(...addressProblems(out.address, `${where} address`))
  if (!owner && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) errors.push(`${where}: a valid email is required`)
  if (id && id.length !== 9) errors.push(`${where}: an SSN or ITIN has 9 digits`)
  return { out, id, errors }
}

// The bank asks for a link to the hosted form → { link, errors }
export function normaliseLink(b = {}, now = new Date()) {
  const errors = []
  const kind = KINDS[b.kind] ? b.kind : 'person'
  if (b.kind && !KINDS[b.kind]) errors.push('kind must be person or business')
  const hours = Number(b.expiresInHours) > 0 ? Math.min(MAX_LINK_HOURS, Number(b.expiresInHours)) : LINK_HOURS
  const pre = b.prefill || {}
  const prefill = kind === 'person'
    ? { name: str(pre.name, 120), email: str(pre.email, 160).toLowerCase(), phone: str(pre.phone, 40) }
    : { businessName: str(pre.businessName, 160), name: str(pre.name, 120), email: str(pre.email, 160).toLowerCase() }
  return { errors, link: { reference: str(b.reference, 120), kind, prefill, expiresAt: new Date(now.getTime() + hours * 3600000).toISOString() } }
}
export function linkProblem(row, now = new Date()) {
  if (!row) return 'This link isn’t valid. Open the application again from the bank’s app or website.'
  if (row.revoked_at) return 'This link was cancelled by the bank. Open the application again from its app or website.'
  if (row.used_at) return 'This application has already been sent. The bank will be in touch.'
  if (new Date(row.expires_at) < now) return 'This link has expired. Open the application again from the bank’s app or website.'
  return ''
}

// An application → { app, ids: [{ who, kind, number }], errors }. ids are for the bank's endpoint only.
export function normaliseApplication(a = {}, now = new Date()) {
  const errors = [], ids = []
  const kind = KINDS[a.kind] ? a.kind : null
  if (!kind) return { app: null, ids, errors: ['kind must be person or business'] }
  const app = { kind, reference: str(a.reference, 120), receivedAt: now.toISOString() }
  if (kind === 'person') {
    const p = person(a.applicant, 'applicant')
    app.applicant = p.out; errors.push(...p.errors)
    if (p.id) ids.push({ who: 'applicant', kind: 'ssn', number: p.id })
    app.occupation = str(a.occupation, 120)
    if (!app.occupation) errors.push('occupation is required')
  } else {
    const b = a.business || {}
    const ein = digits(b.ein)
    app.business = {
      name: str(b.name, 160), dba: str(b.dba, 160), type: str(b.type, 40), industry: pick(b.industry, INDUSTRIES) || 'other',
      registeredIn: str(b.registeredIn, 40), formedOn: isDate(b.formedOn) ? b.formedOn : '', website: /^https?:\/\//i.test(String(b.website || '')) ? str(b.website, 200) : '',
      address: address(b.address), einLast4: ein ? ein.slice(-4) : '', description: str(b.description, 600),
    }
    if (!app.business.name) errors.push('business: name is required')
    errors.push(...addressProblems(app.business.address, 'business address'))
    if (ein && ein.length !== 9) errors.push('business: an EIN has 9 digits')
    if (ein) ids.push({ who: 'business', kind: 'ein', number: ein })
    const c = person(a.applicant, 'the person applying')
    app.applicant = c.out; errors.push(...c.errors)
    if (c.id) ids.push({ who: 'applicant', kind: 'ssn', number: c.id })
    app.owners = (Array.isArray(a.owners) ? a.owners : []).slice(0, 8).map((o, i) => {
      const p = person(o, `owners[${i}]`, { owner: true }); errors.push(...p.errors)
      if (p.id) ids.push({ who: `owners[${i}]`, kind: 'ssn', number: p.id })
      return p.out
    })
  }
  app.purpose = pick(a.purpose, PURPOSES[kind]) || ''
  if (!app.purpose) errors.push('purpose is required')
  const act = a.activity || {}
  app.activity = { monthly: pick(act.monthly, MONTHLY) || '', cash: act.cash === true, international: act.international === true, countries: str(act.countries, 200) }
  if (!app.activity.monthly) errors.push('activity.monthly is required')
  app.sourceOfFunds = pick(a.sourceOfFunds, SOURCES) || ''
  if (!app.sourceOfFunds) errors.push('sourceOfFunds is required')
  app.pep = { declared: a.pep?.declared === true, detail: str(a.pep?.detail, 300) }
  if (typeof a.pep?.declared !== 'boolean') errors.push('pep.declared is required: true or false')
  app.consent = { given: a.consent === true || a.consent?.given === true, text: CONSENT[kind], at: now.toISOString() }
  if (!app.consent.given) errors.push('consent is required')
  return { app, ids, errors }
}

// Everyone to screen against sanctions lists: [{ role, name }]
export function subjectsOf(app) {
  const out = [{ role: app.kind === 'business' ? 'Person applying' : 'Applicant', name: app.applicant?.name }]
  if (app.kind === 'business') { out.unshift({ role: 'Business', name: app.business?.name }); if (app.business?.dba) out.push({ role: 'Trading as', name: app.business.dba }) }
  ;(app.owners || []).forEach(o => out.push({ role: o.controller ? 'Controller' : `Owner (${o.ownership}%)`, name: o.name }))
  return out.filter(s => s.name)
}

// The checks → [{ key, label, state: pass | flag | fail | pending, detail }]
//   ctx: { sanctions: null | { results: [{ role, name, hits: [...] }] }, duplicates: [{ field, id, sameName }], ipCountry, idv, now }
export function runChecks(app, ctx = {}) {
  const now = ctx.now || new Date(), out = []
  const add = (key, label, state, detail = '') => out.push({ key, label, state, detail })
  const people = [app.applicant, ...(app.owners || [])].filter(Boolean)
  // Identity (the bank's own provider)
  const idv = ctx.idv || app.idv
  if (!idv) add('idv', 'Identity check (documents and selfie)', 'pending', 'Waiting on the result from your identity provider')
  else add('idv', 'Identity check (documents and selfie)', idv.result === 'passed' ? 'pass' : idv.result === 'failed' ? 'fail' : 'flag',
    `${idv.result === 'passed' ? 'Passed' : idv.result === 'failed' ? 'Failed' : 'Needs a person to look'}${idv.provider ? ` · ${idv.provider}` : ''}${idv.reference ? ` · ${idv.reference}` : ''}`)
  // Sanctions
  const s = ctx.sanctions
  if (!s) add('sanctions', 'OFAC sanctions screening', 'pending', 'Not screened yet: screen from Licit')
  else {
    const hits = (s.results || []).filter(r => (r.hits || []).length)
    add('sanctions', 'OFAC sanctions screening', hits.length ? 'fail' : 'pass',
      hits.length ? hits.map(r => `${r.role} ${r.name}: possible match with ${r.hits[0].name}${[].concat(r.hits[0].programs || []).length ? ` (${[].concat(r.hits[0].programs).join(', ')})` : ''}`).join('; ') : `${subjectsOf(app).length} name${subjectsOf(app).length === 1 ? '' : 's'} screened, no matches`)
  }
  // PEP: from the declaration
  add('pep', 'Politically exposed person', app.pep?.declared ? 'flag' : 'pass', app.pep?.declared ? `Declared${app.pep.detail ? `: ${app.pep.detail}` : ''}. Enhanced due diligence needed` : 'Not declared. No PEP list is connected, so this rests on the customer’s answer')
  // Age and date of birth
  const ages = people.filter(p => p.dob).map(p => ({ p, age: ageOn(p.dob, now) }))
  const minor = ages.find(x => x.age < 18), odd = ages.find(x => x.age > 110 || x.age < 0)
  add('age', 'Date of birth', minor ? 'fail' : odd ? 'flag' : 'pass', minor ? `${minor.p.name} is ${minor.age}: under 18` : odd ? `${odd.p.name}: a date of birth that can’t be right` : 'All adults')
  // Address
  const pobox = [app.applicant, ...(app.owners || [])].filter(Boolean).find(p => /\b(p\.?\s*o\.?\s*box|post\s*office\s*box)\b/i.test(`${p.address?.line1} ${p.address?.line2}`))
  add('address', 'Residential address', pobox ? 'flag' : 'pass', pobox ? `${pobox.name} gave a PO box: a home address is needed` : 'A street address')
  // Email
  const dom = String(app.applicant?.email || '').split('@')[1] || ''
  add('email', 'Email address', DISPOSABLE.includes(dom) ? 'flag' : 'pass', DISPOSABLE.includes(dom) ? `${dom} gives out throwaway addresses` : 'An ordinary address')
  // Where they applied from
  const home = app.kind === 'business' ? app.business?.address?.country : app.applicant?.address?.country
  if (ctx.ipCountry) add('location', 'Where they applied from', ctx.ipCountry === home ? 'pass' : 'flag', ctx.ipCountry === home ? `From ${ctx.ipCountry}, where they live` : `From ${ctx.ipCountry}, but the address is in ${home}`)
  // Details seen on other applications
  const dups = ctx.duplicates || []
  if (dups.length) {
    const other = dups.filter(d => !d.sameName)
    add('duplicates', 'Details used on other applications', other.length ? 'fail' : 'flag',
      dups.map(d => `${d.field} also on ${d.id}${d.sameName ? '' : ' under a different name'}`).join('; ') + (other.length ? '. Different names with the same details can mean a made-up identity' : ''))
  } else add('duplicates', 'Details used on other applications', 'pass', 'None in the last 90 days')
  // Businesses
  if (app.kind === 'business') {
    const owners = app.owners || []
    const controller = owners.some(o => o.controller), share = owners.reduce((n, o) => n + (o.ownership || 0), 0)
    add('owners', 'Owners and a controller (FinCEN CDD rule)', owners.length && controller && share <= 100 ? 'pass' : 'fail',
      !owners.length ? 'No owners named: list everyone with 25% or more, and one person who controls the business' : !controller ? 'No controller named: one person who manages the business (often the CEO or CFO)' : share > 100 ? `Ownership adds up to ${share}%` : `${owners.length} named, ${share}% of the ownership`)
    const ind = app.business?.industry
    add('industry', 'Industry', HIGH_RISK_INDUSTRY.has(ind) ? 'flag' : 'pass', HIGH_RISK_INDUSTRY.has(ind) ? `${INDUSTRIES.find(x => x[0] === ind)[1]}: higher risk, check licences and the bank’s appetite` : (INDUSTRIES.find(x => x[0] === ind) || [])[1] || '')
    const young = app.business?.formedOn && (now - new Date(app.business.formedOn + 'T00:00:00Z')) < 365 * DAY
    if (young) add('age_business', 'How long it has traded', 'flag', 'Formed less than a year ago')
  }
  return out
}

// The rating, its reasons, the status and what we'd do → { rating, reasons, status, recommend: { action, why } }
export function rate(app, checks) {
  const st = k => checks.find(c => c.key === k)?.state
  const high = [], medium = []
  if (st('sanctions') === 'fail') high.push('A possible sanctions match')
  if (st('pep') === 'flag') high.push('Declared a senior public position (PEP)')
  if (st('idv') === 'fail') high.push('The identity check failed')
  if (st('duplicates') === 'fail') high.push('Same details as another application under a different name')
  if (st('industry') === 'flag') high.push('A higher-risk industry')
  if (st('age') === 'fail') high.push('Under 18')
  const a = app.activity || {}
  if (['50k_250k', 'over_250k'].includes(a.monthly) && app.kind === 'person') medium.push('High expected monthly activity for a personal account')
  if (a.monthly === 'over_250k' && app.kind === 'business') medium.push('Over $250,000 a month expected')
  if (a.cash) medium.push('Expects to deposit cash')
  if (a.international) medium.push(`Expects international payments${a.countries ? ` (${a.countries})` : ''}`)
  for (const k of ['location', 'email', 'address', 'idv', 'duplicates', 'age_business']) if (st(k) === 'flag') medium.push(checks.find(c => c.key === k).detail)
  if (st('owners') === 'fail') medium.push('Owners or controller missing')
  const rating = high.length ? 'high' : medium.length ? 'medium' : 'low'
  const reasons = [...high, ...medium]
  const status = st('sanctions') === 'fail' ? 'on_hold' : st('idv') === 'pending' ? 'waiting_idv' : 'to_review'
  const recommend = st('sanctions') === 'fail' ? { action: 'hold', why: 'Clear the possible sanctions match first: if it’s confirmed, the account can’t be opened and OFAC must be told.' }
    : st('age') === 'fail' ? { action: 'decline', why: 'Under 18: offer an account for minors with a parent instead.' }
    : st('idv') === 'fail' ? { action: 'decline', why: 'The identity check failed. Ask for a new check only if there’s a clear reason it failed.' }
    : st('owners') === 'fail' ? { action: 'more_info', why: 'Ask for every owner with 25% or more and one controller before deciding.' }
    : st('idv') === 'pending' ? { action: 'wait', why: 'Wait for the identity check before deciding.' }
    : rating === 'high' ? { action: 'edd', why: 'Enhanced due diligence before approving: source of wealth, the reason for the account, and senior sign-off.' }
    : rating === 'medium' ? { action: 'review', why: 'Look at the reasons below; approve if they fit what the customer told you.' }
    : { action: 'approve', why: 'Everything checked out.' }
  return { rating, reasons, status, recommend }
}

// Who it is, in one line
export const titleOf = app => app.kind === 'business' ? `${app.business?.name || 'A business'}${app.business?.dba ? ` (trading as ${app.business.dba})` : ''}` : app.applicant?.name || 'An applicant'
export const isAdult = (dob, now = new Date()) => isDate(dob) && ageOn(dob, now) >= 18
export { isDate, ageOn }

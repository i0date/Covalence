// ═══════════════════════════════════════════════════════════════════════════════
// AI RECORDS — what the AI was asked, what it said, and why
// ═══════════════════════════════════════════════════════════════════════════════
// Every AI decision (a Triage verdict, a Desk reason code, a merchant defence
// assessment) is kept on the case as a record: the inputs it saw, the model
// and prompt version, its answer, the factors behind it, the options it ruled
// out, and what a person later said about it (agree / disagree). Drafts —
// letters, action plans, rebuttal predictions — get a lighter record (the
// model and prompt version), since a person edits and sends them.
// The page at /ai explains all of this for customers and examiners.

// Bump a version whenever its prompt changes, so a record shows which wording produced it
export const PROMPTS = {
  triage_fi:      { version: 'triage-fi@3',        label: 'Triage — dispute classification' },
  triage_ce:      { version: 'triage-exchange@3',  label: 'Triage — exchange claim classification' },
  ce_plan:        { version: 'exchange-plan@1',    label: 'Triage — exchange action plan (draft)' },
  desk_analysis:  { version: 'desk-analysis@3',    label: 'Desk — reason code and dispute summary' },
  rebuttal:       { version: 'rebuttal-sim@1',     label: 'Desk — merchant rebuttal prediction (draft)' },
  comms:          { version: 'customer-letter@1',  label: 'Desk — customer letter (draft)' },
  pre_arb:        { version: 'pre-arb@1',          label: 'Desk — pre-arbitration response (draft)' },
  merchant:       { version: 'merchant-defence@3', label: 'Desk — merchant defence assessment' },
  rep_letter:     { version: 'rep-letter@1',       label: 'Desk — representment letter (draft)' },
  mch_pre_arb:    { version: 'mch-pre-arb@1',      label: 'Desk — merchant pre-arbitration letter (draft)' },
  sar_narrative:  { version: 'sar-narrative@2',    label: 'Licit — SAR narrative (draft)' },
}

// Appended to every decision prompt. Asks for the reasoning in a fixed shape,
// grounded in the case as given.
export const EXPLAIN_RULES = `
EXPLAINING YOUR ANSWER:
- Base every key factor on information given above. Name the input it came from. Never invent facts.
- If something important is missing or unclear, list what you assumed in "assumptions".
- Under "alternatives_considered", name the closest other answers and why they fit less well.
- Under "would_change_if", list facts that, if learned, would change the answer.
- Keep it short: 3 to 5 key factors, at most 2 alternatives, at most 3 items in each list, one line each.`
export const EXPLAIN_JSON = `"explanation": {
    "key_factors": [{ "factor": "What in the case mattered", "source": "Which input it came from", "weight": "HIGH" | "MEDIUM" | "LOW", "effect": "supports" | "against" }],
    "alternatives_considered": [{ "option": "Another possible answer", "why_not": "Why it fits less well" }],
    "assumptions": ["Anything taken as given that the case doesn't state"],
    "would_change_if": ["A fact that would change this answer"]
  }`

// Text of a Messages API response, and the JSON inside it
export function readAiJson(data) {
  const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim()
  if (data?.stop_reason === 'max_tokens') throw new Error('the AI’s answer was cut off — try again')
  return JSON.parse(text)
}

const clip = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 400 ? s.slice(0, 400) + '…' : s }
// Only the inputs that had a value, short enough to store on the case
export function inputsSeen(obj) {
  const out = {}
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = clip(v) })
  return out
}

function who() {
  try { const u = JSON.parse(localStorage.getItem('cov_user') || 'null'); return u?.name || u?.email || 'Agent' } catch { return 'Agent' }
}

// A decision record. `answer` is the headline result (e.g. "TRUE_FRAUD" or "13.1 — Merchandise Not Received").
export function aiRecord(kind, { data, inputs, answer, confidence, summary, explanation, factors }) {
  const ex = explanation || {}
  const keyFactors = Array.isArray(ex.key_factors) && ex.key_factors.length ? ex.key_factors : (factors || [])
  return {
    id: 'AI-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
    kind, prompt: PROMPTS[kind]?.version || kind, task: PROMPTS[kind]?.label || kind,
    model: data?.model || 'unknown', ts: new Date().toISOString(), by: who(),
    inputs: inputsSeen(inputs), answer: answer || '', confidence: confidence || '', summary: summary || '',
    factors: keyFactors.slice(0, 12).map(f => ({ factor: f.factor || f.signal || '', source: f.source || '', weight: f.weight || '', effect: f.effect || '', toward: f.toward || '' })),
    alternatives: (ex.alternatives_considered || []).slice(0, 6),
    assumptions: (ex.assumptions || []).slice(0, 8),
    wouldChangeIf: (ex.would_change_if || []).slice(0, 8),
  }
}
// A draft's record: who asked, which model and prompt
export const aiDraftRecord = (kind, data) => ({
  id: 'AI-' + Date.now().toString(36).toUpperCase(), kind, draft: true,
  prompt: PROMPTS[kind]?.version || kind, task: PROMPTS[kind]?.label || kind, model: data?.model || 'unknown', ts: new Date().toISOString(), by: who(),
})

// Keep the newest 20 decisions on a case
export const withDecision = (c, rec) => ({ ...c, aiDecisions: [...(c.aiDecisions || []), rec].slice(-20) })

// All AI decisions about a case, oldest first (Triage's sits on the Triage log entry)
export function decisionsOf(c) {
  const t = c?._triageRecord?.aiDecision
  return [...(t ? [t] : []), ...(c?.aiDecisions || [])].sort((a, b) => new Date(a.ts) - new Date(b.ts))
}
// The most recent decision on what the case should be filed under
export function latestCodeDecision(c) {
  return [...(c?.aiDecisions || [])].reverse().find(d => d.kind === 'desk_analysis')
}
// Did the people working the case go with the AI's reason code?
export function codeFollowed(c) {
  const d = latestCodeDecision(c)
  if (!d || !c.reasonCode) return null
  return String(d.answer).split(' ')[0] === String(c.reasonCode).split(' ')[0]
}

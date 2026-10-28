// 005 DFA — Dispute Funding Assessor
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { CheckCircle, XCircle, ChevronUp, ChevronDown, Plus, Upload, Download, X, AlertTriangle } from 'lucide-react'
import { DFA_BASE_WIN, detectNetwork, saveOutcomes } from '../shared.jsx'
import { readCases } from '../caseStore.js'

// ═══════════════════════════════════════════════════════════════════════════════
// 003 DFA — MODULE-LEVEL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Alias so DFA internals resolve correctly ────────────────────────
const BASE_WIN_RATES = DFA_BASE_WIN

// ─── Cycle stage labels + modifier ───────────────────────────────────
const CYCLE_STAGE_LABELS = {
  '1cb':    '1st Chargeback',
  '2cb':    '2nd Presentment / Representment',
  'prearb': 'Pre-Arbitration',
  'arb':    'Arbitration',
}
function computeStageModifier(stage) {
  if (stage === '2cb')    return { probMod:+0.08, timeMulti:1.00, feeRisk:false, feeNote:'' }
  if (stage === 'prearb') return { probMod:-0.05, timeMulti:0.90, feeRisk:true,  feeNote:'Pre-arb filing fee risk — Visa $500 / MC $500+' }
  if (stage === 'arb')    return { probMod:-0.15, timeMulti:0.75, feeRisk:true,  feeNote:'Arbitration fee risk: up to $1,100 (MC) or $500 (Visa) if lost — assess carefully on claims under $2k' }
  return { probMod:0, timeMulti:1.00, feeRisk:false, feeNote:'' }
}

const CODE_LABELS = {
  // Visa Fraud
  "10.1": "EMV Counterfeit Fraud",       "10.2": "EMV Lost/Stolen Fraud",
  "10.3": "Card-Present Fraud",           "10.4": "Card-Absent (CNP) Fraud",
  "10.5": "Visa Fraud Monitoring Program",
  // Visa Authorization
  "11.1": "Card Recovery Bulletin",       "11.2": "Declined Authorization",
  "11.3": "No Authorization",
  // Visa Processing Errors
  "12.1": "Late Presentment",             "12.2": "Incorrect Transaction Code",
  "12.3": "Incorrect Currency",           "12.4": "Incorrect Account Number",
  "12.5": "Incorrect Amount",             "12.6": "Duplicate / Paid by Other Means",
  "12.6.1": "Duplicate Processing",       "12.6.2": "Paid by Other Means",
  "12.7": "Invalid Data",
  // Visa Consumer Disputes
  "13.1": "Merchandise Not Received",     "13.2": "Cancelled Recurring",
  "13.3": "Not as Described / Defective", "13.4": "Counterfeit Merchandise",
  "13.5": "Misrepresentation",            "13.6": "Credit Not Processed",
  "13.7": "Cancelled Merchandise",        "13.8": "Original Credit Not Accepted",
  "13.9": "Non-Receipt of Cash/Load",
  // MC Fraud
  "4837": "No Cardholder Authorization",  "4840": "Fraudulent Processing",
  "4849": "Questionable Merchant Activity","4863": "Cardholder Does Not Recognize",
  "4870": "Chip Liability Shift",         "4871": "Chip/PIN Liability Shift",
  // MC Authorization
  "4808": "Authorization Chargeback",     "4812": "Account Not on File",
  "4847": "Authorization Not Obtained",
  // MC Processing Errors
  "4831": "Transaction Amount Differs",   "4834": "Duplicate Processing",
  "4835": "Card Not Valid or Expired",    "4842": "Late Presentment",
  "4846": "Incorrect Currency",
  // MC Consumer Disputes
  "4841": "Cancelled Recurring/Digital Goods","4850": "Installment Billing Dispute",
  "4853": "Defective / Not as Described", "4854": "Cardholder Dispute — NEC",
  "4855": "Goods or Services Not Provided","4859": "Services Not Rendered",
  "4860": "Credit Not Processed",         "4999": "Domestic Chargeback",
}


// ─── Sample portfolio (~$100k face, 20 claims, Visa + MC) ─────────────────────
const CLAIMS_DATA = [
  { id:"DSP-001", code:"10.4", amount:4200,  filedDaysAgo:10, windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.2, priorClaims:0, source:"sample", note:"No 3DS, AVS mismatch on shipping address. Clean account history. Strong CNP fraud pattern — issuer holds the stronger hand." },
  { id:"DSP-002", code:"13.1", amount:2800,  filedDaysAgo:25, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:true,  merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.4, priorClaims:1, source:"sample", note:"Delivery confirmation on file. Low-CBR merchant will representment aggressively. One prior dispute on account reduces confidence." },
  { id:"DSP-003", code:"10.5", amount:18500, filedDaysAgo:5,  windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:true,  strongDocs:false, merchantCBR:2.8, priorClaims:0, source:"sample", note:"VFMP-enrolled merchant — near-automatic liability shift. High merchant CBR confirms systemic fraud pattern. Anchor receivable in portfolio." },
  { id:"DSP-004", code:"13.3", amount:1200,  filedDaysAgo:40, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.6, priorClaims:2, source:"sample", note:"Subjective quality dispute with no supporting documentation. Two prior claims on account is a significant red flag." },
  { id:"DSP-005", code:"10.2", amount:5800,  filedDaysAgo:15, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:true,  isVFMP:false, strongDocs:false, merchantCBR:0.8, priorClaims:0, source:"sample", note:"Chip + PIN transaction. PIN verification shifts liability back to the issuer — near-automatic loss at representment." },
  { id:"DSP-006", code:"13.6", amount:3600,  filedDaysAgo:20, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:true,  pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.5, priorClaims:0, source:"sample", note:"Merchant acknowledged credit owed in writing. Strong paper trail. Near-certain win — merchant acknowledgement rarely survives representment." },
  { id:"DSP-007", code:"10.4", amount:750,   filedDaysAgo:50, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.9, priorClaims:1, source:"sample", note:"Small dollar at 70-day mark. Limited fraud evidence and one prior claim. Marginal — funder overhead may exceed expected return." },
  { id:"DSP-008", code:"13.5", amount:8200,  filedDaysAgo:8,  windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.7, priorClaims:0, source:"sample", note:"Strong documentary evidence — screenshots of merchant listing vs. item received. Early in window, clean account history." },
  { id:"DSP-009", code:"10.1", amount:11000, filedDaysAgo:12, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.1, priorClaims:0, source:"sample", note:"High-value chip fraud at POS — merchant ran magnetic stripe on chip-capable terminal. Liability shifts cleanly to merchant under 10.1." },
  { id:"DSP-010", code:"13.1", amount:3200,  filedDaysAgo:18, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.7, priorClaims:0, source:"sample", note:"Cardholder documented non-receipt in writing. No delivery confirmation from merchant. Clean account history. Solid 13.1 position." },
  { id:"DSP-011", code:"10.4", amount:5800,  filedDaysAgo:8,  windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.8, priorClaims:0, source:"sample", note:"Classic CNP pattern — mismatch on billing and shipping, no 3DS, high-CBR merchant. Early in window with clean account history." },
  { id:"DSP-012", code:"13.7", amount:2100,  filedDaysAgo:22, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.6, priorClaims:0, source:"sample", note:"Cancellation dispute with documented cancellation request. Merchant has low CBR — likely to push back. Evidence package will be key at representment." },
  { id:"DSP-013", code:"4837", amount:6400,  filedDaysAgo:9,  windowDays:120, avsMismatch:true,  no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:1.4, priorClaims:0, source:"sample", note:"Clean MC fraud — no authorization, AVS mismatch, no 3DS. Cardholder has never seen the merchant. Strong 4837 position." },
  { id:"DSP-014", code:"4870", amount:9200,  filedDaysAgo:6,  windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:2.1, priorClaims:0, source:"sample", note:"Chip liability shift — merchant fell back to magnetic stripe at chip-capable terminal. High merchant CBR signals systemic fraud exposure." },
  { id:"DSP-015", code:"4853", amount:2400,  filedDaysAgo:35, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.8, priorClaims:1, source:"sample", note:"Defective merchandise with photographic evidence. One prior claim on account is a mild concern. Mid-window — still actionable." },
  { id:"DSP-016", code:"4855", amount:4100,  filedDaysAgo:14, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:1.3, priorClaims:0, source:"sample", note:"Services never rendered — strong documentation, elevated merchant CBR. Clean account with no prior disputes. Solid B-grade receivable." },
  { id:"DSP-017", code:"4841", amount:2800,  filedDaysAgo:20, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.6, priorClaims:0, source:"sample", note:"Recurring charge post-cancellation. Strong documentation of cancellation event. Low-CBR merchant may contest aggressively." },
  { id:"DSP-018", code:"4860", amount:2600,  filedDaysAgo:16, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:true,  pinVerified:false, isVFMP:false, strongDocs:true,  merchantCBR:0.4, priorClaims:0, source:"sample", note:"Merchant agreed to credit in writing but failed to process. Merchant acknowledgement is powerful MC 4860 evidence. Near-certain win." },
  { id:"DSP-019", code:"4863", amount:3600,  filedDaysAgo:30, windowDays:120, avsMismatch:false, no3DS:true,  deliveryConf:false, merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.9, priorClaims:0, source:"sample", note:"No 3DS on CNP transaction. AVS matched — mixed signals. Mid-window. Serviceable 4863 but not a slam dunk." },
  { id:"DSP-020", code:"4853", amount:1800,  filedDaysAgo:42, windowDays:120, avsMismatch:false, no3DS:false, deliveryConf:true,  merchantAck:false, pinVerified:false, isVFMP:false, strongDocs:false, merchantCBR:0.5, priorClaims:2, source:"sample", note:"Item received but materially different from listing. Two prior claims and delivery confirmation significantly reduce fundability. D-grade drag on portfolio." },
]

// ─── Scoring model ────────────────────────────────────────────────────────────
function computeRecoveryProb(c, winRateOverrides) {
  const rates = { ...BASE_WIN_RATES, ...(winRateOverrides || {}) }
  let p = rates[c.code] != null ? rates[c.code] : 0.50
  const code = String(c.code)

  // Authorization codes (11.x, 4808, 4812, 4847) — largely mechanical, few signal adjustments
  const isAuth = code.startsWith("11") || ["4808","4812","4847"].includes(code)
  // Processing error codes (12.x, 4831, 4834, 4835, 4842, 4846) — mechanical wins, no behavioral signals
  const isProcessingError = code.startsWith("12") || ["4831","4834","4835","4842","4846"].includes(code)
  // Fraud codes
  const isFraud = code.startsWith("10") || ["4837","4840","4849","4863","4870","4871"].includes(code)

  if (isAuth || isProcessingError) {
    // Mechanical wins — time window is the main risk factor, signal adjustments minimal
    if (c.priorClaims > 2) p -= 0.05  // unusual volume is mild risk
    // No other behavioral adjustments — these live or die on documentation alone
  } else if (isFraud) {
    if (c.avsMismatch) p += 0.07
    if (c.no3DS)       p += 0.05
    if (c.isVFMP)      p = Math.min(p + 0.15, 0.96)
    if (c.pinVerified) p -= 0.28  // PIN-verified CNP = near-certain loss
    if      (c.merchantCBR >= 2.0) p += 0.06
    else if (c.merchantCBR >= 1.0) p += 0.03
    else if (c.merchantCBR <  0.3) p -= 0.04
    p -= c.priorClaims * 0.07
  } else {
    // Consumer disputes (13.x, 4841, 4850, 4853, 4854, 4855, 4859, 4860, 4999)
    if (c.deliveryConf) p -= 0.22
    if (c.merchantAck)  p += 0.18
    if (c.strongDocs)   p += 0.12
    if      (c.merchantCBR >= 1.5) p += 0.05
    else if (c.merchantCBR <  0.3) p -= 0.05
    p -= c.priorClaims * 0.07
  }
  return parseFloat(Math.max(0.05, Math.min(0.96, p)).toFixed(2))
}

function computeTimeScore(c) {
  const r = c.windowDays - c.filedDaysAgo
  if (r > 90) return 1.00
  if (r > 60) return 0.90
  if (r > 30) return 0.78
  if (r > 15) return 0.60
  return 0.35
}

function computeAmountScore(a) {
  if (a < 50)    return 0.15
  if (a < 100)   return 0.40
  if (a < 200)   return 0.65
  if (a <= 2000) return 1.00
  if (a <= 5000) return 0.85
  return 0.70
}

function scoreClaim(c, effectiveWinRates) {
  const stageMod         = computeStageModifier(c.cycleStage)
  const baseProb         = computeRecoveryProb(c, effectiveWinRates)
  const recoveryProb     = parseFloat(Math.max(0.05, Math.min(0.96, baseProb + stageMod.probMod)).toFixed(2))
  const timeScore        = parseFloat(Math.min(1, computeTimeScore(c) * stageMod.timeMulti).toFixed(2))
  const amountScore      = computeAmountScore(c.amount)
  // MC arbitration-fee penalty on low-value claims at late stages
  const isMC             = detectNetwork(c.code) === 'Mastercard'
  const feeRiskPenalty   = stageMod.feeRisk && isMC && c.amount < 1500 ? 6 : stageMod.feeRisk && c.amount < 600 ? 4 : 0
  const fundability      = Math.max(0, Math.round((recoveryProb * 0.55 + timeScore * 0.25 + amountScore * 0.20) * 100) - feeRiskPenalty)
  const expectedRecovery = c.amount * recoveryProb * timeScore
  return { recoveryProb, timeScore, amountScore, fundability, expectedRecovery, stageMod, feeRiskPenalty }
}

const SCORED_SAMPLE = CLAIMS_DATA.map(c => ({ ...c, codeLabel: CODE_LABELS[c.code] || `Code ${c.code}`, ...scoreClaim(c) }))

// ─── CSV utilities ────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS = ["id","code","amount","filed_days_ago","window_days","cycle_stage","issuer","avs_mismatch","no_3ds","delivery_confirmed","merchant_acknowledged","pin_verified","vfmp_enrolled","strong_docs","merchant_cbr","prior_claims","note"]
const TEMPLATE_EXAMPLE = ["DSP-021","10.4","750","15","120","1cb","Chase","yes","yes","no","no","no","no","no","1.1","0","CNP fraud — AVS mismatch on shipping address"]

function parseBool(v) { return v ? ["yes","true","1","y"].includes(v.toLowerCase().trim()) : false }
function parseCSVLine(line) {
  const r = []; let cur = "", q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { r.push(cur); cur = "" }
    else cur += ch
  }
  r.push(cur); return r
}
function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { claims: [], errors: ["CSV must have a header row and at least one data row."] }
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g,"_"))
  const errors = [], claims = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = parseCSVLine(lines[i])
    const row = {}; headers.forEach((h,idx) => { row[h] = (cols[idx]||"").trim() })
    const code = (row.code||"").trim()
    if (!code) { errors.push(`Row ${i+1}: missing reason code — skipped`); continue }
    const amount = parseFloat(row.amount)
    if (isNaN(amount)||amount<=0) { errors.push(`Row ${i+1}: invalid amount "${row.amount}" — skipped`); continue }
    const cycleStage = ['1cb','2cb','prearb','arb'].includes(row.cycle_stage) ? row.cycle_stage : '1cb'
    const c = {
      id: row.id||`UPL-${String(i).padStart(3,"0")}`, code, codeLabel: CODE_LABELS[code]||`Code ${code}`,
      amount, filedDaysAgo: parseInt(row.filed_days_ago||"0",10)||0,
      windowDays: parseInt(row.window_days||"120",10)||120,
      cycleStage, issuer: row.issuer||'',
      avsMismatch: parseBool(row.avs_mismatch), no3DS: parseBool(row.no_3ds),
      deliveryConf: parseBool(row.delivery_confirmed), merchantAck: parseBool(row.merchant_acknowledged),
      pinVerified: parseBool(row.pin_verified), isVFMP: parseBool(row.vfmp_enrolled),
      strongDocs: parseBool(row.strong_docs),
      merchantCBR: parseFloat(row.merchant_cbr||"0.5")||0.5,
      priorClaims: parseInt(row.prior_claims||"0",10)||0,
      note: row.note||"", source: "uploaded",
    }
    claims.push({ ...c, ...scoreClaim(c) })
  }
  return { claims, errors }
}
function downloadTemplate() {
  const blob = new Blob([[TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE.join(",")].join("\n")], { type:"text/csv" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob)
  a.download = "dispute_portfolio_template.csv"; a.click()
}

// ─── Grade ────────────────────────────────────────────────────────────────────
function grade(score) {
  if (score >= 75) return { label:"A", bg:"bg-emerald-900", text:"text-emerald-50", bar:"#064e3b", pill:"border-emerald-700 text-emerald-800" }
  if (score >= 60) return { label:"B", bg:"bg-stone-700",   text:"text-stone-50",   bar:"#44403c", pill:"border-stone-500 text-stone-700"   }
  if (score >= 45) return { label:"C", bg:"bg-amber-800",   text:"text-amber-50",   bar:"#92400e", pill:"border-amber-700 text-amber-800"   }
  return              { label:"D", bg:"bg-red-900",     text:"text-red-50",     bar:"#7f1d1d", pill:"border-red-700 text-red-800"       }
}
function ScoreBar({ value, color }) {
  return (
    <div style={{ height:"3px", background:"#D4CCBC", width:"100%" }}>
      <div style={{ height:"100%", width:`${Math.min(100,Math.round(value*100))}%`, background:color }} />
    </div>
  )
}

// ─── Export scored results ────────────────────────────────────────────────────
function exportResultsCSV(claims, advanceRate) {
  const headers = ["id","network","code","code_label","amount","fundability","grade","win_prob_pct","expected_recovery","advance","projected_net","days_remaining","note"]
  const rows = claims.map(c => {
    const g = grade(c.fundability)
    const note = (c.note || "").replace(/"/g, "'")
    return [c.id, detectNetwork(c.code), c.code, CODE_LABELS[c.code]||c.code,
      c.amount, c.fundability, g.label, Math.round(c.recoveryProb*100),
      Math.round(c.expectedRecovery), Math.round(c.expectedRecovery*advanceRate),
      Math.round(c.expectedRecovery*(1-advanceRate)), c.windowDays-c.filedDaysAgo, `"${note}"`].join(",")
  })
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type:"text/csv" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "dispute_portfolio_scored.csv"; a.click()
}

// ─── Portfolio helpers ────────────────────────────────────────────────────────
function calcTranches(claims) {
  return ['A','B','C','D'].map(gl => {
    const sub = claims.filter(c => grade(c.fundability).label === gl)
    if (!sub.length) return null
    return { gl, count:sub.length, value:sub.reduce((s,c)=>s+c.amount,0), expected:sub.reduce((s,c)=>s+c.expectedRecovery,0) }
  }).filter(Boolean)
}

function portfolioRiskFlags(claims, totalValue) {
  const flags = []
  if (!claims.length || !totalValue) return flags
  const topClaim = claims.reduce((a,b) => a.amount > b.amount ? a : b)
  if (topClaim.amount / totalValue > 0.35)
    flags.push({ type:"warn", text:`Concentration: ${topClaim.id} represents ${Math.round(topClaim.amount/totalValue*100)}% of portfolio face value` })
  const byCode = {}; claims.forEach(c => { byCode[c.code] = (byCode[c.code]||0) + c.amount })
  const [topCode, topCodeVal] = Object.entries(byCode).sort((a,b) => b[1]-a[1])[0]
  if (topCodeVal / totalValue > 0.50)
    flags.push({ type:"warn", text:`Code concentration: ${Math.round(topCodeVal/totalValue*100)}% in ${topCode} (${CODE_LABELS[topCode]||topCode})` })
  const shortVal = claims.filter(c => (c.windowDays-c.filedDaysAgo) <= 30).reduce((s,c)=>s+c.amount,0)
  if (shortVal / totalValue > 0.20)
    flags.push({ type:"urgent", text:`Window risk: ${Math.round(shortVal/totalValue*100)}% of portfolio ($${Math.round(shortVal).toLocaleString()}) has ≤30 days remaining` })
  const dGrade = claims.filter(c => grade(c.fundability).label === 'D')
  if (dGrade.length > 0)
    flags.push({ type:"info", text:`${dGrade.length} D-grade claim${dGrade.length>1?"s":""} ($${Math.round(dGrade.reduce((s,c)=>s+c.amount,0)).toLocaleString()}) drag the portfolio average — consider excluding` })
  return flags
}

// ─── Manual claim defaults ────────────────────────────────────────────────────
const MANUAL_DEFAULTS = {
  id:"", code:"10.4", amount:"", filedDaysAgo:"0", windowDays:"120",
  cycleStage:"1cb", issuer:"",
  avsMismatch:false, no3DS:false, deliveryConf:false, merchantAck:false,
  pinVerified:false, isVFMP:false, strongDocs:false,
  merchantCBR:"0.8", priorClaims:"0", note:"",
}

// ─── Claim detail panel ───────────────────────────────────────────────────────
function ClaimDetail({ sc, advanceRate, claimNet, onClose, excluded, onToggleExclude, onRemove }) {
  const g       = grade(sc.fundability)
  const network = detectNetwork(sc.code)
  const evidenceItems = [
    { label:"AVS mismatch on shipping address", active:sc.avsMismatch,  positive:true  },
    { label:"No 3DS authentication data",       active:sc.no3DS,        positive:true  },
    { label:"Delivery confirmation on file",    active:sc.deliveryConf, positive:false },
    { label:"Merchant acknowledged in writing", active:sc.merchantAck,  positive:true  },
    { label:"PIN-verified transaction",         active:sc.pinVerified,  positive:false },
    { label:"VFMP enrolled merchant",           active:sc.isVFMP,       positive:true  },
    { label:"Strong documentary evidence",      active:sc.strongDocs,   positive:true  },
    ...(sc.priorClaims > 0 ? [{ label:`${sc.priorClaims} prior claim(s) on account`, active:true, positive:false }] : []),
  ].filter(e => e.active)

  return (
    <div className={`border-2 transition-opacity ${excluded?"border-stone-300 opacity-60":"border-stone-900"}`} style={{ background:"#FAF7F1" }}>
      <div className="flex items-start justify-between px-5 py-4 border-b border-stone-300" style={{ background:"#1A1814" }}>
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="mono-font text-xs font-medium text-stone-100">{sc.id}</span>
            {sc.source === "uploaded" && <span className="mono-font text-[10px] px-1.5 py-0.5 bg-blue-800 text-blue-100">CSV</span>}
            {sc.source === "manual"   && <span className="mono-font text-[10px] px-1.5 py-0.5 bg-violet-800 text-violet-100">MANUAL</span>}
            <span className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-600 text-stone-400">{network.toUpperCase()}</span>
            {sc.cycleStage && sc.cycleStage !== '1cb' && (
              <span className={`mono-font text-[10px] px-1.5 py-0.5 border ${sc.cycleStage==='2cb'?'border-emerald-600 text-emerald-300':sc.cycleStage==='arb'?'border-red-600 text-red-300':'border-amber-600 text-amber-300'}`}>
                {CYCLE_STAGE_LABELS[sc.cycleStage]?.toUpperCase()}
              </span>
            )}
          </div>
          <div className="display-font text-stone-300 text-[13px]">{sc.code} — {sc.codeLabel}</div>
          {sc.issuer && <div className="mono-font text-[10px] text-stone-400 mt-0.5">ISSUER: {sc.issuer}</div>}
          {sc.stageMod?.feeRisk && <div className="mono-font text-[10px] text-amber-400 mt-1">⚠ {sc.stageMod.feeNote}</div>}
          {sc.feeRiskPenalty > 0 && <div className="mono-font text-[10px] text-amber-400">−{sc.feeRiskPenalty} pts fee-risk penalty applied to fundability score</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`mono-font text-sm font-bold px-2 py-0.5 ${g.bg} ${g.text}`}>{g.label}</span>
          {onClose && <button onClick={onClose} className="text-stone-400 hover:text-stone-100 transition-colors mono-font text-lg leading-none ml-1">×</button>}
        </div>
      </div>

      {onToggleExclude && (
        <div className="px-5 py-2 border-b border-stone-200 flex items-center justify-between" style={{ background:"#EEE9E0" }}>
          <span className="mono-font text-[10px] tracking-widest text-stone-500">PORTFOLIO INCLUSION</span>
          <div className="flex items-center gap-2">
            <button onClick={() => onToggleExclude(sc.id)}
              className={`mono-font text-[10px] tracking-wide px-2.5 py-1 border transition-colors ${excluded?"border-amber-700 bg-amber-50 text-amber-800":"border-stone-400 text-stone-600 hover:border-stone-800 hover:text-stone-900"}`}>
              {excluded ? "EXCLUDED — CLICK TO RESTORE" : "EXCLUDE FROM PORTFOLIO"}
            </button>
            {onRemove && (sc.source === 'manual' || sc.source === 'desk') && (
              <button onClick={() => { if (window.confirm('Remove this claim permanently?')) onRemove(sc.id) }}
                className="mono-font text-[10px] tracking-wide px-2.5 py-1 border border-red-400 text-red-600 hover:bg-red-50 transition-colors">
                REMOVE
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-5 py-5 space-y-5">
        <div>
          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">SCORE BREAKDOWN</div>
          <div className="space-y-3">
            {[
              { label:"Recovery probability", weight:"55%", raw:sc.recoveryProb, display:`${Math.round(sc.recoveryProb*100)}%`, color:sc.recoveryProb>=0.65?"#064e3b":sc.recoveryProb>=0.40?"#92400e":"#7f1d1d" },
              { label:"Time value",           weight:"25%", raw:sc.timeScore,    display:`${Math.round(sc.timeScore*100)}%`,    color:sc.timeScore>=0.85?"#064e3b":sc.timeScore>=0.65?"#92400e":"#7f1d1d"       },
              { label:"Amount efficiency",    weight:"20%", raw:sc.amountScore,  display:`${Math.round(sc.amountScore*100)}%`,  color:sc.amountScore>=0.85?"#064e3b":sc.amountScore>=0.55?"#92400e":"#7f1d1d"   },
            ].map(m => (
              <div key={m.label}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <div><span className="display-font text-[13px] text-stone-700">{m.label}</span><span className="mono-font text-[10px] text-stone-400 ml-1.5">({m.weight})</span></div>
                  <span className="mono-font text-xs font-medium text-stone-800">{m.display}</span>
                </div>
                <ScoreBar value={m.raw} color={m.color} />
              </div>
            ))}
            {sc.cycleStage && sc.cycleStage !== '1cb' && sc.stageMod && (
              <div className={`mono-font text-[10px] px-2.5 py-1.5 border ${sc.cycleStage==='2cb'?'border-emerald-300 bg-emerald-50 text-emerald-800':sc.cycleStage==='arb'?'border-red-300 bg-red-50 text-red-800':'border-amber-300 bg-amber-50 text-amber-800'}`}>
                CYCLE STAGE ({CYCLE_STAGE_LABELS[sc.cycleStage]}): prob {sc.stageMod.probMod > 0 ? '+' : ''}{Math.round(sc.stageMod.probMod*100)}% · time ×{sc.stageMod.timeMulti}
                {sc.feeRiskPenalty > 0 ? ` · −${sc.feeRiskPenalty}pt fee-risk penalty` : ''}
              </div>
            )}
          </div>
        </div>

        {evidenceItems.length > 0 && (
          <div>
            <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">EVIDENCE FACTORS</div>
            <div className="space-y-1.5">
              {evidenceItems.map(e => (
                <div key={e.label} className="flex items-start gap-2">
                  {e.positive ? <CheckCircle className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />}
                  <span className={`display-font text-[13px] leading-snug ${e.positive?"text-emerald-800":"text-red-800"}`}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {sc.note && (
          <div>
            <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">UNDERWRITER NOTE</div>
            <p className="display-font text-stone-700 text-[13px] leading-relaxed border-l-2 border-stone-300 pl-3 italic">{sc.note}</p>
          </div>
        )}

        <div className="border-t border-stone-200 pt-4">
          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">FUNDING SUMMARY</div>
          <div className="space-y-2">
            {[
              { label:"Face value",                                            val:`$${sc.amount.toLocaleString()}`,                                                                      bold:false },
              { label:"Expected recovery",                                     val:`$${Math.round(sc.expectedRecovery).toLocaleString()} (${Math.round(sc.recoveryProb*100)}% win rate)`, bold:false },
              { label:`Advance (${Math.round(advanceRate*100)}% of expected)`, val:`$${Math.round(sc.expectedRecovery*advanceRate).toLocaleString()}`,                                    bold:false },
              { label:"Projected net to funder",                               val:`$${claimNet(sc).toLocaleString()}`,                                                                   bold:true  },
              { label:"Return on advance",                                     val:`${Math.round(((1-advanceRate)/advanceRate)*100)}%`,                                                   bold:true  },
            ].map(r => (
              <div key={r.label} className="flex justify-between gap-3">
                <span className="display-font text-[13px] text-stone-500 leading-snug">{r.label}</span>
                <span className={`mono-font text-xs shrink-0 ${r.bold?"text-emerald-800 font-medium":"text-stone-700"}`}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
// ─── DFA Crypto Claim Scoring ────────────────────────────────────────────────────────
const CRYPTO_CLAIM_TYPES = {
  unauthorized_access:  { label: 'Account Compromise / Unauthorized Access', baseWin: 0.58 },
  unauthorized_transfer:{ label: 'Unauthorized Transfer',                     baseWin: 0.62 },
  exchange_error:       { label: 'Exchange / Platform Error',                 baseWin: 0.60 },
  phishing:             { label: 'Phishing / Credential Theft',               baseWin: 0.45 },
  scam_investment:      { label: 'Investment / Pig-Butchering Scam',          baseWin: 0.18 },
  scam_romance:         { label: 'Romance / Social Engineering Scam',         baseWin: 0.14 },
  scam_impersonation:   { label: 'Impersonation / Support Scam',              baseWin: 0.22 },
  wallet_theft:         { label: 'Wallet Theft / Malware',                    baseWin: 0.38 },
  other:                { label: 'Other',                                      baseWin: 0.30 },
}
const CRYPTO_EXCHANGES = {
  regulated_us:    { label: 'US-regulated (Coinbase, Gemini, Kraken…)',  mod: +0.12 },
  regulated_ca:    { label: 'Canada-regulated (Bitbuy, Newton, NDAX…)', mod: +0.10 },
  regulated_other: { label: 'Other regulated jurisdiction',                    mod: +0.07 },
  unregulated:     { label: 'Unregulated / offshore',                          mod: -0.10 },
  dex:             { label: 'Decentralized / DEX / non-custodial',             mod: -0.20 },
  unknown:         { label: 'Unknown',                                          mod:  0    },
}
function scoreCryptoClaim(c) {
  const typeInfo = CRYPTO_CLAIM_TYPES[c.claimType] || CRYPTO_CLAIM_TYPES.other
  let p = typeInfo.baseWin
  const exchInfo = CRYPTO_EXCHANGES[c.exchangeType] || CRYPTO_EXCHANGES.unknown
  p += exchInfo.mod
  if (c.blockchainTrace) p += 0.08
  if (c.kycVerified)     p += 0.06
  if (c.freezeRequested) p += 0.05
  if (c.policeReport)    p += 0.04
  if (c.priorClaims > 0) p -= c.priorClaims * 0.08
  const amt = c.amountUSD || 0
  const amtScore = amt <= 0 ? 0.50 : amt < 500 ? 0.80 : amt < 5000 ? 0.70 : amt < 25000 ? 0.55 : 0.35
  const days = c.daysSince || 0
  const timeScore = days <= 7 ? 1.0 : days <= 30 ? 0.85 : days <= 90 ? 0.65 : days <= 180 ? 0.40 : 0.20
  p = Math.max(0.05, Math.min(0.90, p))
  const fundability = Math.round(p * 0.55 * 100 + amtScore * 0.20 * 100 + timeScore * 0.25 * 100)
  const expectedRecovery = amt * p * timeScore
  return { recoveryProb: parseFloat(p.toFixed(2)), amtScore, timeScore, fundability, expectedRecovery }
}
const CRYPTO_MANUAL_DEFAULTS = {
  id:'', claimType:'unauthorized_access', exchangeType:'regulated_us',
  amountUSD:'', daysSince:'0',
  blockchainTrace:false, kycVerified:false, freezeRequested:false, policeReport:false,
  priorClaims:'0', note:'',
}


// ═══════════════════════════════════════════════════════════════════════════════
// 003 DFA VIEW
// ═══════════════════════════════════════════════════════════════════════════════
export function DfaView({ dfaQueue, setDfaQueue, onGoToDuo, historicalOutcomes }) {
  // ── Compute actual win rates from historical resolved cases ──────────────
  const historicalWinRates = React.useMemo(() => {
    const outcomes = historicalOutcomes || []
    const resolved = outcomes.filter(o => (o.status === 'won' || o.status === 'lost') && o.reasonCode)
    if (resolved.length < 3) return {}  // not enough data yet
    const byCode = {}
    resolved.forEach(o => {
      const code = String(o.reasonCode).split(/[\s–—]/)[0].trim()
      if (!byCode[code]) byCode[code] = { won: 0, total: 0 }
      byCode[code].total++
      if (o.status === 'won') byCode[code].won++
    })
    const rates = {}
    Object.entries(byCode).forEach(([code, { won, total }]) => {
      if (total >= 2) rates[code] = parseFloat((won / total).toFixed(2))  // min 2 cases to override
    })
    return rates
  }, [historicalOutcomes])
  const [selected, setSelected]             = useState(null)
  const [sortCol, setSortCol]               = useState("fundability")
  const [sortDir, setSortDir]               = useState("desc")
  const [uploadedClaims, setUploaded]       = useState([])
  const [parseErrors, setParseErrors]       = useState([])
  const [expandedMobile, setExpandedMobile] = useState(null)
  const [manualClaims, setManualClaims]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('dfa_manual_claims') || '[]') } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_manual_claims', JSON.stringify(manualClaims)) } catch {}
  }, [manualClaims])

  const [excludedIds, setExcludedIds]       = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dfa_excluded_ids') || '[]')) } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_excluded_ids', JSON.stringify([...excludedIds])) } catch {}
  }, [excludedIds])

  const removeManualClaim = (id) => setManualClaims(prev => prev.filter(c => c.id !== id))

  const [gradeFilter, setGradeFilter]       = useState("all")
  const [showAddForm, setShowAddForm]       = useState(false)
  const [draft, setDraft]                   = useState({ ...MANUAL_DEFAULTS })
  // Investor controls — persisted so settings survive refresh
  const [advanceOverride, setAdvanceOverride] = useState(() => {
    try { const v = localStorage.getItem('dfa_advance_override'); return v !== null ? parseFloat(v) : null } catch { return null }
  })
  useEffect(() => {
    try {
      if (advanceOverride !== null) localStorage.setItem('dfa_advance_override', String(advanceOverride))
      else localStorage.removeItem('dfa_advance_override')
    } catch {}
  }, [advanceOverride])

  const [recourseType, setRecourseType]       = useState(() => {
    try { return localStorage.getItem('dfa_recourse_type') || 'nonrecourse' } catch { return 'nonrecourse' }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_recourse_type', recourseType) } catch {}
  }, [recourseType])

  const [refundPct, setRefundPct]             = useState(() => {
    try { return parseFloat(localStorage.getItem('dfa_refund_pct') || '0.20') } catch { return 0.20 }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_refund_pct', String(refundPct)) } catch {}
  }, [refundPct])

  const [holdingDays, setHoldingDays]         = useState(() => {
    try { return parseInt(localStorage.getItem('dfa_holding_days') || '90', 10) } catch { return 90 }
  })
  useEffect(() => {
    try { localStorage.setItem('dfa_holding_days', String(holdingDays)) } catch {}
  }, [holdingDays])

  // Win rate overrides (Task 2) — user-tunable per reason code
  // Effective rates: base → historical → user manual overrides (each layer wins over previous)
  const [winRateOverrides, setWinRateOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dfa_win_overrides') || '{}') } catch { return {} }
  })
  const effectiveWinRates = React.useMemo(() => ({ ...historicalWinRates, ...winRateOverrides }), [historicalWinRates, winRateOverrides])
  useEffect(() => {
    try { localStorage.setItem('dfa_win_overrides', JSON.stringify(winRateOverrides)) } catch {}
  }, [winRateOverrides])
  const [calibOpen, setCalibOpen] = useState(false)
  const [vintageOpen, setVintageOpen] = useState(false)
  const [dfaTab, setDfaTab] = useState('card')
  const [cryptoClaims, setCryptoClaims] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dfa_crypto_claims') || '[]') } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem('dfa_crypto_claims', JSON.stringify(cryptoClaims)) } catch {} }, [cryptoClaims])
  const [cryptoDraft, setCryptoDraft] = useState({ ...CRYPTO_MANUAL_DEFAULTS })
  const [showCryptoForm, setShowCryptoForm] = useState(false)
  const [cryptoSelected, setCryptoSelected] = useState(null)
  const cryptoCounter = useRef(1)

  const fileRef       = useRef(null)
  const manualCounter = useRef(1)

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d==="desc"?"asc":"desc")
    else { setSortCol(col); setSortDir("desc") }
  }
  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { claims, errors } = parseCSVText(ev.target.result)
      setUploaded(claims); setParseErrors(errors); setSelected(null); setExpandedMobile(null)
    }
    reader.readAsText(file); e.target.value = ""
  }
  function clearUploaded() { setUploaded([]); setParseErrors([]); setSelected(null); setExpandedMobile(null) }

  function toggleExclude(id) {
    setExcludedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else { next.add(id); if (selected === id) setSelected(null) }
      return next
    })
  }

  function addManualClaim() {
    const amount = parseFloat(draft.amount)
    if (!draft.code || isNaN(amount) || amount <= 0) return
    const id = draft.id.trim() || `MAN-${String(manualCounter.current).padStart(3,"0")}`
    manualCounter.current++
    const c = {
      id, code: draft.code, codeLabel: CODE_LABELS[draft.code]||`Code ${draft.code}`,
      amount, filedDaysAgo: parseInt(draft.filedDaysAgo)||0, windowDays: parseInt(draft.windowDays)||120,
      cycleStage: draft.cycleStage||'1cb', issuer: draft.issuer||'',
      avsMismatch:draft.avsMismatch, no3DS:draft.no3DS, deliveryConf:draft.deliveryConf,
      merchantAck:draft.merchantAck, pinVerified:draft.pinVerified, isVFMP:draft.isVFMP, strongDocs:draft.strongDocs,
      merchantCBR:parseFloat(draft.merchantCBR)||0.5, priorClaims:parseInt(draft.priorClaims)||0,
      note:draft.note, source:"manual",
    }
    setManualClaims(prev => [...prev, { ...c, ...scoreClaim(c, effectiveWinRates) }])
    setDraft({ ...MANUAL_DEFAULTS }); setShowAddForm(false)
  }

  const allScoredRaw = useMemo(() => [...SCORED_SAMPLE, ...uploadedClaims, ...manualClaims], [uploadedClaims, manualClaims])
  const activeScored = useMemo(() => allScoredRaw.filter(c => !excludedIds.has(c.id)), [allScoredRaw, excludedIds])

  // ── Portfolio metrics ──────────────────────────────────────────────────────
  const totalValue     = activeScored.reduce((s,c) => s+c.amount, 0)
  const totalExpected  = activeScored.reduce((s,c) => s+c.expectedRecovery, 0)
  const weightedScore  = totalValue > 0 ? activeScored.reduce((s,c) => s+c.fundability*c.amount, 0)/totalValue : 0
  const topShare       = activeScored.length > 0 ? Math.max(...activeScored.map(c=>c.amount))/totalValue : 0
  const concPenalty    = topShare > 0.35 ? 4 : 0
  const portfolioScore = Math.round(weightedScore - concPenalty)
  const pg             = grade(portfolioScore)
  const gradeAdvRate   = portfolioScore>=75?0.65:portfolioScore>=60?0.55:portfolioScore>=45?0.44:0.30
  const advanceRate    = advanceOverride !== null ? advanceOverride : gradeAdvRate
  const advanceValue   = totalExpected * advanceRate
  const totalNet       = totalExpected - advanceValue
  const claimNet       = c => Math.round(c.expectedRecovery*(1-advanceRate))
  const roaPercent     = advanceValue>0 ? Math.round((totalNet/advanceValue)*100) : 0

  // Recourse bonus — on losing claims, issuer refunds refundPct × advance
  const recourseBonus  = recourseType === "partial"
    ? activeScored.reduce((s,c) => s + c.expectedRecovery*advanceRate*(1-c.recoveryProb)*refundPct, 0)
    : 0
  const adjustedNet    = totalNet + recourseBonus

  // IRR
  const grossReturn    = advanceValue > 0 ? adjustedNet/advanceValue : 0
  const annualizedIRR  = advanceValue > 0 ? Math.round(((1+grossReturn)**(365/holdingDays)-1)*100) : 0

  // Scenarios (advance is fixed at origination — what changes is what comes back)
  const stressExpected   = activeScored.reduce((s,c) => s + c.amount*Math.min(c.recoveryProb*0.80,0.96)*c.timeScore, 0)
  const recoveryExpected = activeScored.reduce((s,c) => s + c.amount*c.recoveryProb*c.timeScore + c.amount*(1-c.recoveryProb)*c.timeScore*0.30, 0)

  const tranches   = useMemo(() => calcTranches(activeScored),               [activeScored])
  const riskFlags  = useMemo(() => portfolioRiskFlags(activeScored,totalValue), [activeScored,totalValue])

  const gradeCounts = useMemo(() => {
    const ct = { all:allScoredRaw.length, A:0, B:0, C:0, D:0 }
    allScoredRaw.forEach(cl => { ct[grade(cl.fundability).label]++ })
    return ct
  }, [allScoredRaw])

  const sorted = useMemo(() => {
    const list = gradeFilter==="all" ? [...allScoredRaw] : allScoredRaw.filter(c => grade(c.fundability).label===gradeFilter)
    return list.sort((a,b) => {
      const v = c => sortCol==="amount"?c.amount:sortCol==="expectedRecovery"?c.expectedRecovery:sortCol==="projectedNet"?claimNet(c):c.fundability
      return sortDir==="desc" ? v(b)-v(a) : v(a)-v(b)
    })
  }, [allScoredRaw, sortCol, sortDir, gradeFilter])

  const sc = selected ? allScoredRaw.find(c=>c.id===selected) : null

  function SortBtn({ col, label }) {
    const active = sortCol===col
    const Icon   = active && sortDir==="asc" ? ChevronUp : ChevronDown
    return (
      <button onClick={() => handleSort(col)} className={`flex items-center gap-0.5 mono-font text-[10px] tracking-widest transition-colors ${active?"text-stone-900":"text-stone-400 hover:text-stone-600"}`}>
        {label}<Icon className="w-3 h-3" />
      </button>
    )
  }


  // ── Pre-load cases queued from Dispute Desk ─────────────────────────────
  useEffect(() => {
    if (!dfaQueue || dfaQueue.length === 0) return
    const mapped = dfaQueue.map(o => {
      const c = {
        id: o.id, code: o.code,
        codeLabel: CODE_LABELS[o.code] || `Code ${o.code}`,
        amount: parseFloat(o.amount) || 0,
        filedDaysAgo: parseInt(o.filedDaysAgo) || 0,
        windowDays: parseInt(o.windowDays) || 45,
        avsMismatch: !!o.avsMismatch, no3DS: !!o.no3DS,
        deliveryConf: !!o.deliveryConf, merchantAck: !!o.merchantAck,
        pinVerified: !!o.pinVerified, isVFMP: !!o.isVFMP,
        strongDocs: !!o.strongDocs,
        merchantCBR: parseFloat(o.merchantCBR) || 0.5,
        priorClaims: parseInt(o.priorClaims) || 0,
        note: (o.note || `From Dispute Desk: ${o.merchant || ''}`).trim(),
        source: "desk",
        cycleStage: o.cycleStage || '1cb',
        issuer: o.issuer || '',
      }
      return { ...c, ...scoreClaim(c, effectiveWinRates) }
    })
    setManualClaims(prev => {
      const existingIds = new Set(prev.map(c => c.id))
      return [...prev, ...mapped.filter(c => !existingIds.has(c.id))]
    })
    // ── Reverse flow: annotate source cases in cov_outcomes with DFA score ──
    try {
      const all = readCases()
      const mappedIds = new Set(mapped.map(c => c.id))
      const updated = all.map(o => {
        if (!mappedIds.has(o.id)) return o
        const scored = mapped.find(c => c.id === o.id)
        return scored ? { ...o, dfaScore: grade(scored.fundability).label, dfaFundability: Math.round(scored.fundability), dfaScoredAt: new Date().toISOString() } : o
      })
      if (updated.some((o, i) => o !== all[i])) saveOutcomes(updated)
    } catch {}
    setDfaQueue([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dfaQueue])

  function addCryptoClaim() {
    const amt = parseFloat(cryptoDraft.amountUSD)
    if (isNaN(amt) || amt <= 0) return
    const id = cryptoDraft.id.trim() || `CRY-${String(cryptoCounter.current).padStart(3,'0')}`
    cryptoCounter.current++
    const c = { id, claimType:cryptoDraft.claimType, exchangeType:cryptoDraft.exchangeType, amountUSD:amt,
      daysSince:parseInt(cryptoDraft.daysSince)||0, blockchainTrace:cryptoDraft.blockchainTrace,
      kycVerified:cryptoDraft.kycVerified, freezeRequested:cryptoDraft.freezeRequested,
      policeReport:cryptoDraft.policeReport, priorClaims:parseInt(cryptoDraft.priorClaims)||0, note:cryptoDraft.note }
    setCryptoClaims(prev => [...prev, { ...c, ...scoreCryptoClaim(c) }])
    setCryptoDraft({ ...CRYPTO_MANUAL_DEFAULTS }); setShowCryptoForm(false)
  }
  const cryptoPortfolioValue    = cryptoClaims.reduce((s,c) => s+(c.amountUSD||0), 0)
  const cryptoPortfolioExpected = cryptoClaims.reduce((s,c) => s+(c.expectedRecovery||0), 0)
  const cryptoWeightedScore     = cryptoClaims.length > 0 ? cryptoClaims.reduce((s,c) => s+c.fundability*(c.amountUSD||0), 0) / Math.max(cryptoPortfolioValue,1) : 0
  const cryptoPortfolioGrade    = grade(Math.round(cryptoWeightedScore))

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 sm:py-12">
        {/* ── Masthead ── */}
        <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="mono-font text-xs tracking-widest text-stone-600">ISSUE Nº 005 — DFA</div>
              {Object.keys(historicalWinRates).length > 0 && (
                <span className="mono-font text-[10px] tracking-widest px-2 py-0.5 border border-emerald-700 text-emerald-700">
                  ✓ {Object.keys(historicalWinRates).length} WIN RATE{Object.keys(historicalWinRates).length!==1?'S':''} CALIBRATED FROM YOUR HISTORY
                </span>
              )}
            </div>
            <div className="mono-font text-xs tracking-widest text-stone-600">{new Date().toLocaleDateString("en-US",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}</div>
          </div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:"clamp(36px,6vw,80px)", letterSpacing:"-0.03em" }}>
            The Dispute<br /><span style={{ fontStyle:"italic", fontWeight:500 }}>Funding Assessor</span>
          </h1>
          <p className="display-font text-stone-700 mt-4 max-w-2xl" style={{ fontSize:"clamp(14px,1.8vw,17px)", lineHeight:"1.6" }}>
            Payment disputes as an asset class. Upload a portfolio of Visa or Mastercard claims and the assessor underwrites each receivable — scoring fundability, modelling probability-weighted recovery, and recommending an advance rate. Built for issuers, servicers, and dispute funders.
          </p>
        </div>
        {/* ── Mode tabs ── */}
        <div style={{ display:'flex', gap:'2px', marginBottom:'28px', maxWidth:'360px' }}>
          {[['card','CARD CHARGEBACKS'],['crypto','CRYPTO / EXCHANGE']].map(([val,label]) => (
            <button key={val} onClick={() => setDfaTab(val)} className="mono-font"
              style={{ flex:1, padding:'9px 0', fontSize:'10px', letterSpacing:'0.12em', border:'1px solid #C8C0B0', cursor:'pointer',
                       background:dfaTab===val?'#1A1814':'transparent', color:dfaTab===val?'#F5F1EA':'#6B5F4D' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── CRYPTO TAB ── */}
        {dfaTab === 'crypto' && (
          <div>
            <div className="border border-stone-300 mb-5 px-5 py-4" style={{ background:'#F9F7F3', maxWidth:'680px' }}>
              <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1.5">ABOUT CRYPTO / EXCHANGE SCORING</div>
              <p className="display-font text-stone-600 text-[13px] leading-relaxed">Separate model for crypto and digital-asset claims — unauthorized access, phishing, scams, exchange errors. Recovery probability is driven by claim type, platform regulation, blockchain traceability, and time since incident.</p>
            </div>
            <div style={{ display:'flex', gap:'10px', marginBottom:'16px', flexWrap:'wrap' }}>
              <button onClick={() => setShowCryptoForm(v=>!v)} className="mono-font"
                style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'8px 14px', background:'#1A1814', color:'#F5F1EA', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:'6px' }}>
                <Plus className="w-3 h-3" />{showCryptoForm ? 'CANCEL' : 'ADD CLAIM'}
              </button>
              {cryptoClaims.length > 0 && (
                <button onClick={() => { if(window.confirm('Clear all crypto claims?')) setCryptoClaims([]) }} className="mono-font"
                  style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'8px 12px', background:'transparent', border:'1px solid #C8C0B0', color:'#6B5F4D', cursor:'pointer' }}>
                  CLEAR ALL
                </button>
              )}
            </div>
            {showCryptoForm && (
              <div className="border border-stone-300 mb-5" style={{ background:'#FAF7F1', maxWidth:'680px' }}>
                <div className="px-4 py-2.5 border-b border-stone-200 mono-font text-[10px] tracking-widest text-stone-500" style={{ background:'#EEE9E0' }}>ADD CRYPTO CLAIM</div>
                <div className="px-4 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">CLAIM ID</label>
                      <input className="input-field" placeholder="AUTO" value={cryptoDraft.id} onChange={e=>setCryptoDraft(d=>({...d,id:e.target.value}))} /></div>
                    <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">AMOUNT (USD)</label>
                      <input className="input-field" type="number" placeholder="0.00" value={cryptoDraft.amountUSD} onChange={e=>setCryptoDraft(d=>({...d,amountUSD:e.target.value}))} /></div>
                  </div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">CLAIM TYPE</label>
                    <select className="input-field" value={cryptoDraft.claimType} onChange={e=>setCryptoDraft(d=>({...d,claimType:e.target.value}))}>
                      {Object.entries(CRYPTO_CLAIM_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label} — {Math.round(v.baseWin*100)}% base</option>)}
                    </select></div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">EXCHANGE / PLATFORM TYPE</label>
                    <select className="input-field" value={cryptoDraft.exchangeType} onChange={e=>setCryptoDraft(d=>({...d,exchangeType:e.target.value}))}>
                      {Object.entries(CRYPTO_EXCHANGES).map(([k,v]) => <option key={k} value={k}>{v.label} ({v.mod>0?'+':''}{Math.round(v.mod*100)}%)</option>)}
                    </select></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">DAYS SINCE INCIDENT</label>
                      <input className="input-field" type="number" value={cryptoDraft.daysSince} onChange={e=>setCryptoDraft(d=>({...d,daysSince:e.target.value}))} /></div>
                    <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">PRIOR CLAIMS</label>
                      <input className="input-field" type="number" value={cryptoDraft.priorClaims} onChange={e=>setCryptoDraft(d=>({...d,priorClaims:e.target.value}))} /></div>
                  </div>
                  <div>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1.5">EVIDENCE SIGNALS</div>
                    <div className="flex flex-wrap gap-2">
                      {[{key:'blockchainTrace',label:'BLOCKCHAIN TRACE'},{key:'kycVerified',label:'KYC VERIFIED'},{key:'freezeRequested',label:'FREEZE REQUESTED'},{key:'policeReport',label:'POLICE REPORT'}].map(({key,label}) => (
                        <button key={key} type="button" onClick={()=>setCryptoDraft(d=>({...d,[key]:!d[key]}))}
                          className={`mono-font text-[10px] tracking-wide px-2.5 py-1.5 border transition-colors ${cryptoDraft[key]?'border-stone-900 bg-stone-900 text-stone-50':'border-stone-300 text-stone-500 hover:border-stone-600'}`}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">NOTE (OPTIONAL)</label>
                    <input className="input-field" placeholder="Context on this claim..." value={cryptoDraft.note} onChange={e=>setCryptoDraft(d=>({...d,note:e.target.value}))} /></div>
                  <div className="flex gap-2">
                    <button onClick={addCryptoClaim} disabled={!cryptoDraft.amountUSD||isNaN(parseFloat(cryptoDraft.amountUSD))||parseFloat(cryptoDraft.amountUSD)<=0}
                      className="mono-font text-[10px] tracking-widest px-4 py-2 bg-stone-900 text-stone-50 disabled:opacity-40 disabled:cursor-not-allowed">SCORE &amp; ADD</button>
                    <button onClick={()=>{setCryptoDraft({...CRYPTO_MANUAL_DEFAULTS});setShowCryptoForm(false)}}
                      className="mono-font text-[10px] tracking-widest px-4 py-2 border border-stone-300 text-stone-500">CANCEL</button>
                  </div>
                </div>
              </div>
            )}
            {cryptoClaims.length === 0 ? (
              <div className="border border-dashed border-stone-300 px-6 py-10 text-center" style={{ maxWidth:'680px' }}>
                <div className="mono-font text-[10px] tracking-widest text-stone-400">NO CRYPTO CLAIMS YET — ADD ONE ABOVE</div>
              </div>
            ) : (
              <div style={{ maxWidth:'780px' }}>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[{label:'TOTAL EXPOSURE',val:`$${cryptoPortfolioValue.toLocaleString()}`,sub:`${cryptoClaims.length} claim${cryptoClaims.length!==1?'s':''}`},
                    {label:'EXPECTED RECOVERY',val:`$${Math.round(cryptoPortfolioExpected).toLocaleString()}`,sub:`${cryptoPortfolioValue>0?Math.round(cryptoPortfolioExpected/cryptoPortfolioValue*100):0}% of face`},
                    {label:'PORTFOLIO GRADE',val:cryptoPortfolioGrade.label,sub:`avg score ${Math.round(cryptoWeightedScore)}`}].map(s => (
                    <div key={s.label} className="border border-stone-200 px-4 py-4" style={{background:'#FAF7F1'}}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">{s.label}</div>
                      <div className="display-font font-semibold text-stone-900" style={{fontSize:'26px',lineHeight:1}}>{s.val}</div>
                      <div className="mono-font text-[10px] text-stone-400 mt-1">{s.sub}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {cryptoClaims.map(c => {
                    const g = grade(c.fundability); const isSel = cryptoSelected===c.id
                    return (
                      <div key={c.id} className="border border-stone-200" style={{background:'#FAF7F1'}}>
                        <div onClick={()=>setCryptoSelected(isSel?null:c.id)}
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors">
                          <span className={`mono-font text-xs font-bold px-2 py-0.5 shrink-0 ${g.bg} ${g.text}`}>{g.label}</span>
                          <span className="mono-font text-[10px] text-stone-400 shrink-0">{c.id}</span>
                          <span className="display-font text-stone-700 flex-1 text-[13px] truncate">{(CRYPTO_CLAIM_TYPES[c.claimType]||{label:'?'}).label}</span>
                          <span className="mono-font text-[11px] text-stone-600 shrink-0">${(c.amountUSD||0).toLocaleString()}</span>
                          <span className="mono-font text-[10px] text-stone-400 shrink-0">{Math.round(c.recoveryProb*100)}% win</span>
                          <ChevronDown className={`w-3 h-3 text-stone-400 shrink-0 transition-transform ${isSel?'rotate-180':''}`} />
                        </div>
                        {isSel && (
                          <div className="border-t border-stone-200 px-4 py-4 space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                              {[{label:'WIN PROB',val:`${Math.round(c.recoveryProb*100)}%`,w:'55%'},{label:'TIME SCORE',val:`${Math.round(c.timeScore*100)}%`,w:'25%'},{label:'AMT SCORE',val:`${Math.round(c.amtScore*100)}%`,w:'20%'}].map(m=>(
                                <div key={m.label}><div className="mono-font text-[10px] text-stone-400 mb-1">{m.label} ({m.w})</div>
                                  <div className="display-font font-semibold text-stone-900" style={{fontSize:'20px'}}>{m.val}</div></div>
                              ))}
                            </div>
                            <div className="mono-font text-[10px] text-stone-500 space-y-0.5">
                              <div>Exchange: {(CRYPTO_EXCHANGES[c.exchangeType]||{label:'?'}).label}</div>
                              <div>Days since incident: {c.daysSince} · Prior claims: {c.priorClaims}</div>
                              {[c.blockchainTrace&&'✓ Blockchain trace',c.kycVerified&&'✓ KYC verified',c.freezeRequested&&'✓ Freeze requested',c.policeReport&&'✓ Police report'].filter(Boolean).map((s,i)=><div key={i} className="text-emerald-700">{s}</div>)}
                            </div>
                            {c.note && <p className="display-font text-stone-600 text-[13px] italic border-l-2 border-stone-200 pl-3">{c.note}</p>}
                            <div className="border-t border-stone-100 pt-3 flex items-center justify-between">
                              <span className="mono-font text-[10px] text-stone-500">Expected recovery: <strong className="text-emerald-800">${Math.round(c.expectedRecovery).toLocaleString()}</strong></span>
                              <button onClick={()=>{setCryptoClaims(prev=>prev.filter(x=>x.id!==c.id));setCryptoSelected(null)}}
                                className="mono-font text-[10px] px-2 py-1 border border-red-300 text-red-600 hover:bg-red-50 transition-colors" style={{background:'none',cursor:'pointer'}}>REMOVE</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {dfaTab === 'card' && <React.Fragment>
        {/* ── Step 01 — Portfolio Upload ── */}
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="mono-font text-xs text-stone-500">01</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Portfolio Upload</h2>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          <div className="border border-dashed border-stone-400 p-4 sm:p-5 flex flex-wrap gap-3 items-center" style={{ background:"#FAF7F1" }}>
            <button className="upload-btn" onClick={() => fileRef.current?.click()}><Upload style={{ width:13,height:13 }} /> Upload CSV</button>
            <button className="upload-btn" onClick={downloadTemplate}><Download style={{ width:13,height:13 }} /> Template</button>
            <button className="upload-btn" onClick={() => setShowAddForm(v=>!v)}><Plus style={{ width:13,height:13 }} /> Add claim</button>
            <div className="flex items-center gap-3 sm:ml-auto flex-wrap">
              {uploadedClaims.length > 0 && <><span className="mono-font text-[10px] tracking-widest text-stone-500">{uploadedClaims.length} CSV CLAIM{uploadedClaims.length!==1?"S":""}</span><button onClick={clearUploaded} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">CLEAR</button></>}
              {manualClaims.length > 0 && <span className="mono-font text-[10px] tracking-widest text-stone-500">{manualClaims.length} MANUAL</span>}
              {excludedIds.size > 0 && <span className="mono-font text-[10px] tracking-widest text-amber-600">{excludedIds.size} EXCLUDED</span>}
            </div>
          </div>

          {showAddForm && (
            <div className="border border-stone-400 mt-3" style={{ background:"#FAF7F1" }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200" style={{ background:"#EEE9E0" }}>
                <div className="mono-font text-[10px] tracking-widest text-stone-600">ADD CLAIM MANUALLY</div>
                <button onClick={() => { setShowAddForm(false); setDraft({...MANUAL_DEFAULTS}) }} className="text-stone-400 hover:text-stone-700 transition-colors"><X className="w-4 h-4" /></button>
              </div>
              <div className="px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">CLAIM ID</label><input className="input-field" placeholder="AUTO" value={draft.id} onChange={e=>setDraft(d=>({...d,id:e.target.value}))} /></div>
                  <div className="col-span-2"><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">REASON CODE</label><select className="input-field" value={draft.code} onChange={e=>setDraft(d=>({...d,code:e.target.value}))}>{Object.entries(CODE_LABELS).map(([k,v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">AMOUNT ($)</label><input className="input-field" type="number" placeholder="0.00" value={draft.amount} onChange={e=>setDraft(d=>({...d,amount:e.target.value}))} /></div>
                  <div className="col-span-2"><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">CYCLE STAGE</label>
                    <select className="input-field" value={draft.cycleStage} onChange={e=>setDraft(d=>({...d,cycleStage:e.target.value}))}>
                      {Object.entries(CYCLE_STAGE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                    </select>
                    {draft.cycleStage==='2cb' && <div className="mono-font text-[10px] text-emerald-700 mt-1">↑ +8% probability — already survived first chargeback round</div>}
                    {draft.cycleStage==='prearb' && <div className="mono-font text-[10px] text-amber-700 mt-1">⚠ Pre-arb fee risk — Visa $500 / MC $500 filing fee if lost</div>}
                    {draft.cycleStage==='arb' && <div className="mono-font text-[10px] text-red-700 mt-1">⚠ Arbitration fee risk up to $1,100 (MC) — only fund if high-confidence</div>}
                  </div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">ISSUER</label><input className="input-field" placeholder="Chase / BofA / CU..." value={draft.issuer} onChange={e=>setDraft(d=>({...d,issuer:e.target.value}))} /></div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">FILED DAYS AGO</label><input className="input-field" type="number" value={draft.filedDaysAgo} onChange={e=>setDraft(d=>({...d,filedDaysAgo:e.target.value}))} /></div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">WINDOW (DAYS)</label><input className="input-field" type="number" value={draft.windowDays} onChange={e=>setDraft(d=>({...d,windowDays:e.target.value}))} /></div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">MERCHANT CBR</label><input className="input-field" type="number" step="0.1" value={draft.merchantCBR} onChange={e=>setDraft(d=>({...d,merchantCBR:e.target.value}))} /></div>
                  <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">PRIOR CLAIMS</label><input className="input-field" type="number" value={draft.priorClaims} onChange={e=>setDraft(d=>({...d,priorClaims:e.target.value}))} /></div>
                </div>
                <div>
                  <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">EVIDENCE SIGNALS — click to toggle</div>
                  <div className="flex flex-wrap gap-2">
                    {[{key:"avsMismatch",label:"AVS MISMATCH"},{key:"no3DS",label:"NO 3DS"},{key:"deliveryConf",label:"DELIVERY CONF"},{key:"merchantAck",label:"MERCHANT ACK"},{key:"pinVerified",label:"PIN VERIFIED"},{key:"isVFMP",label:"VFMP ENROLLED"},{key:"strongDocs",label:"STRONG DOCS"}].map(({key,label}) => (
                      <button key={key} type="button" onClick={() => setDraft(d=>({...d,[key]:!d[key]}))}
                        className={`mono-font text-[10px] tracking-wide px-2.5 py-1.5 border transition-colors ${draft[key]?"border-stone-900 bg-stone-900 text-stone-50":"border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div><label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">UNDERWRITER NOTE (OPTIONAL)</label><input className="input-field" placeholder="Observations on this claim..." value={draft.note} onChange={e=>setDraft(d=>({...d,note:e.target.value}))} /></div>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={addManualClaim} disabled={!draft.amount||isNaN(parseFloat(draft.amount))||parseFloat(draft.amount)<=0} className="mono-font text-[10px] tracking-widest px-4 py-2 bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">SCORE &amp; ADD CLAIM</button>
                  <button type="button" onClick={() => { setDraft({...MANUAL_DEFAULTS}); setShowAddForm(false) }} className="mono-font text-[10px] tracking-widest px-4 py-2 border border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700 transition-colors">CANCEL</button>
                </div>
              </div>
            </div>
          )}
          {parseErrors.length > 0 && <div className="mt-3 border border-amber-700 bg-amber-50 p-4"><div className="mono-font text-xs tracking-widest text-amber-800 mb-2">⚠ ROWS SKIPPED</div>{parseErrors.map((e,i) => <div key={i} className="display-font text-sm text-amber-900">{e}</div>)}</div>}
        </div>

        {/* ── Step 02 — Portfolio Summary ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="mono-font text-xs text-stone-500">02</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Portfolio Summary</h2>
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              {(uploadedClaims.length>0||manualClaims.length>0||excludedIds.size>0) && (
                <span className="mono-font text-[10px] text-stone-400">{SCORED_SAMPLE.length} SAMPLE{uploadedClaims.length>0?` + ${uploadedClaims.length} CSV`:""}{manualClaims.length>0?` + ${manualClaims.length} MANUAL`:""}{excludedIds.size>0?` · ${excludedIds.size} EXCLUDED`:""}</span>
              )}
              <span className={`mono-font text-sm font-bold px-3 py-1 ${pg.bg} ${pg.text}`}>GRADE {pg.label}</span>
            </div>
          </div>

          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight:"1.5" }}>
            This portfolio grades <strong className="text-stone-700">{pg.label}</strong> — advancing <strong className="text-stone-700">${Math.round(advanceValue).toLocaleString()}</strong> today ({Math.round(advanceRate*100)}% of expected recovery) against <strong className="text-stone-700">${Math.round(totalExpected).toLocaleString()}</strong> expected at resolution. That is a <strong className="text-stone-700">{roaPercent}% gross return</strong> on capital deployed — approximately <strong className="text-stone-700">~{annualizedIRR}% annualized</strong> over a {holdingDays}-day resolution window, before servicing costs.
            {concPenalty > 0 && <span className="text-amber-700"> Concentration penalty applied.</span>}
          </p>

          {/* Metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            {[
              { label:"PORTFOLIO VALUE",      value:`$${totalValue.toLocaleString()}`,                sub:`${activeScored.length} active receivables`                              },
              { label:"EXPECTED RECOVERY",    value:`$${Math.round(totalExpected).toLocaleString()}`, sub:`${Math.round(totalValue>0?totalExpected/totalValue*100:0)}% of face value` },
              { label:"RECOMMENDED ADVANCE",  value:`$${Math.round(advanceValue).toLocaleString()}`,  sub:`${Math.round(advanceRate*100)}% of expected recovery`                   },
              { label:"PROJECTED NET RETURN", value:`$${Math.round(adjustedNet).toLocaleString()}`,   sub:`${roaPercent}% return on advance`, hi:true                             },
              { label:"FUNDABILITY SCORE",    value:`${portfolioScore} / 100`,                        sub:concPenalty>0?`−${concPenalty} concentration`:"no concentration risk"    },
            ].map(m => (
              <div key={m.label} className={`border p-4 ${m.hi?"border-emerald-700 bg-emerald-50":"border-stone-300"}`} style={m.hi?{}:{background:"#FAF7F1"}}>
                <div className={`mono-font text-[10px] tracking-widest mb-2 ${m.hi?"text-emerald-700":"text-stone-400"}`}>{m.label}</div>
                <div className={`display-font font-semibold ${m.hi?"text-emerald-900":"text-stone-900"}`} style={{ fontSize:"clamp(16px,2.5vw,22px)", letterSpacing:"-0.02em" }}>{m.value}</div>
                <div className={`mono-font text-[10px] tracking-wide mt-1 ${m.hi?"text-emerald-600":"text-stone-400"}`}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Advance rate slider */}
          <div className="border border-stone-300 p-4 mb-5" style={{ background:"#FAF7F1" }}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div>
                <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-0.5">ADVANCE RATE</div>
                <div className="display-font text-stone-500 text-[13px]">
                  Grade default: <strong className="text-stone-800">{Math.round(gradeAdvRate*100)}%</strong>
                  {advanceOverride !== null && <span className="mono-font text-[10px] text-amber-700 ml-2">OVERRIDDEN</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="mono-font text-[10px] text-stone-400">30%</span>
                <input type="range" min="0.30" max="0.75" step="0.01"
                  value={advanceOverride !== null ? advanceOverride : gradeAdvRate}
                  onChange={e => setAdvanceOverride(parseFloat(e.target.value))}
                  className="w-32 sm:w-44" />
                <span className="mono-font text-[10px] text-stone-400">75%</span>
                <span className="mono-font text-sm font-bold text-stone-900 w-10 text-right">{Math.round(advanceRate*100)}%</span>
                {advanceOverride !== null && (
                  <button onClick={() => setAdvanceOverride(null)} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">RESET</button>
                )}
              </div>
            </div>
            <div className="mono-font text-[10px] tracking-widest text-stone-400 leading-relaxed">
              DEPLOYING ${Math.round(advanceValue).toLocaleString()} · {roaPercent}% GROSS RETURN · ~{annualizedIRR}% ANNUALIZED ({holdingDays}-DAY WINDOW){recourseType==="partial"?` · +$${Math.round(recourseBonus).toLocaleString()} RECOURSE REFUND`:""}
            </div>
          </div>

          {/* Tranche breakdown */}
          {tranches.length > 0 && (
            <div className="border border-stone-300 overflow-hidden mb-4" style={{ background:"#FAF7F1" }}>
              <div className="px-4 py-2 border-b border-stone-200" style={{ background:"#EEE9E0" }}><span className="mono-font text-[10px] tracking-widest text-stone-600">TRANCHE BREAKDOWN</span></div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-stone-200">{["GRADE","CLAIMS","FACE VALUE","EXPECTED RECOVERY","SHARE OF EXPECTED"].map(h => <th key={h} className={`px-4 py-2 mono-font text-[10px] tracking-widest text-stone-400 ${h==="GRADE"?"text-left":"text-right"}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {tranches.map(t => {
                      const tg = grade(t.gl==="A"?80:t.gl==="B"?65:t.gl==="C"?50:30)
                      const share = totalExpected>0 ? Math.round(t.expected/totalExpected*100) : 0
                      return (
                        <tr key={t.gl} className="border-b border-stone-100 last:border-0">
                          <td className="px-4 py-2.5"><span className={`mono-font text-xs font-bold px-2 py-0.5 ${tg.bg} ${tg.text}`}>{t.gl}</span></td>
                          <td className="px-4 py-2.5 mono-font text-xs text-stone-700 text-right">{t.count}</td>
                          <td className="px-4 py-2.5 mono-font text-xs text-stone-700 text-right">${t.value.toLocaleString()}</td>
                          <td className="px-4 py-2.5 mono-font text-xs text-stone-700 text-right">${Math.round(t.expected).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right"><div className="flex items-center justify-end gap-2"><div style={{ width:"60px",height:"3px",background:"#D4CCBC" }}><div style={{ height:"100%",width:`${share}%`,background:tg.bar }} /></div><span className="mono-font text-[10px] text-stone-500">{share}%</span></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {riskFlags.length > 0 && (
            <div className="space-y-2">
              {riskFlags.map((f,i) => (
                <div key={i} className={`flex items-start gap-2 px-4 py-3 border ${f.type==="urgent"?"border-red-700 bg-red-50":f.type==="warn"?"border-amber-700 bg-amber-50":"border-stone-300 bg-stone-50"}`}>
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${f.type==="urgent"?"text-red-700":f.type==="warn"?"text-amber-700":"text-stone-400"}`} />
                  <span className={`display-font text-[13px] leading-snug ${f.type==="urgent"?"text-red-900":f.type==="warn"?"text-amber-900":"text-stone-600"}`}>{f.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Recovery timeline projection ── */}
        {activeScored.length > 0 && (() => {
          const now = new Date()
          const buckets = [
            { label: '0–30 DAYS',  max: 30,  claims: [], value: 0, expected: 0 },
            { label: '31–60 DAYS', max: 60,  claims: [], value: 0, expected: 0 },
            { label: '61–90 DAYS', max: 90,  claims: [], value: 0, expected: 0 },
            { label: '91+ DAYS',   max: 9999, claims: [], value: 0, expected: 0 },
          ]
          activeScored.forEach(c => {
            const daysLeft = Math.max(0, c.windowDays - c.filedDaysAgo)
            const b = buckets.find(bk => daysLeft <= bk.max) || buckets[buckets.length-1]
            b.claims.push(c); b.value += c.amount; b.expected += c.expectedRecovery
          })
          const maxExpected = Math.max(...buckets.map(b => b.expected), 1)
          return (
            <div className="mb-6 mt-2">
              <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">RECOVERY TIMELINE — PROJECTED CASH RETURN BY RESOLUTION WINDOW</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {buckets.map(b => {
                  const barW = Math.round(b.expected / maxExpected * 100)
                  const projDate = new Date(now)
                  projDate.setDate(projDate.getDate() + (b.max === 9999 ? 120 : b.max))
                  return (
                    <div key={b.label} className="border border-stone-200 p-3" style={{ background: '#FAF7F1' }}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">{b.label}</div>
                      <div className="display-font font-semibold text-stone-900 mb-0.5" style={{ fontSize: 'clamp(14px,4vw,18px)', letterSpacing: '-0.02em' }}>
                        ${Math.round(b.expected).toLocaleString()}
                      </div>
                      <div className="mono-font text-[10px] text-stone-400 mb-2">{b.claims.length} claim{b.claims.length !== 1 ? 's' : ''}<br/>${Math.round(b.value).toLocaleString()} face</div>
                      <div style={{ height: '4px', background: '#D4CCBC', borderRadius: '2px' }}>
                        <div style={{ height: '100%', width: `${barW}%`, background: '#064e3b', borderRadius: '2px', transition: 'width 0.4s' }} />
                      </div>
                      {b.claims.length > 0 && (
                        <div className="mono-font text-[10px] text-stone-400 mt-1.5">
                          est. return by {projDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 mono-font text-[10px] text-stone-400">
                Timeline based on filing window remaining per claim (windowDays − daysAgo). Actual resolution may vary by network and issuer response.
              </div>
            </div>
          )
        })()}

        {/* ── Win Rate Calibration (Task 2) ── */}
        {activeScored.length > 0 && (() => {
          const codesInPortfolio = [...new Set(activeScored.map(c => c.code))].sort()
          const hasOverrides = Object.keys(winRateOverrides).length > 0
          return (
            <div className="mt-2 mb-6 border border-stone-300" style={{ background:'#FAF7F1' }}>
              <button className="w-full flex items-center justify-between px-4 py-3" style={{ borderBottom: calibOpen ? '1px solid #E8E3DA' : 'none' }}
                onClick={() => setCalibOpen(v => !v)}>
                <div className="flex items-center gap-3">
                  <div className="mono-font text-[10px] tracking-widest text-stone-500">MODEL CALIBRATION — WIN RATE OVERRIDES</div>
                  {hasOverrides && <div className="mono-font text-[10px]" style={{ background:'#FEF3C7', color:'#92400E', padding:'2px 7px' }}>{Object.keys(winRateOverrides).length} OVERRIDE{Object.keys(winRateOverrides).length > 1 ? 'S' : ''} ACTIVE</div>}
                </div>
                <div className="mono-font text-[10px] text-stone-400">{calibOpen ? '▲ COLLAPSE' : '▼ EXPAND'}</div>
              </button>
              {calibOpen && (
                <div className="px-4 py-4">
                  <p className="display-font text-stone-500 text-[13px] mb-4" style={{ lineHeight:1.6 }}>
                    Override the default base win rates for reason codes present in this portfolio. Your institution's historical performance may differ from model defaults. Overrides are saved locally and applied to all future scoring sessions.
                  </p>
                  <div style={{ display:'grid', gap:'10px' }}>
                    {codesInPortfolio.map(code => {
                      const defaultRate = DFA_BASE_WIN[code] ?? 0.50
                      const override    = winRateOverrides[code]
                      const current     = override !== undefined ? override : defaultRate
                      return (
                        <div key={code} style={{ display:'grid', gridTemplateColumns:'200px 1fr 60px 80px', alignItems:'center', gap:'12px' }}>
                          <div>
                            <div className="mono-font text-[10px] text-stone-700">{code}</div>
                            <div className="mono-font text-[10px] text-stone-400">{CODE_LABELS[code] || code}</div>
                          </div>
                          <input type="range" min="0.05" max="0.96" step="0.01"
                            value={current}
                            onChange={e => setWinRateOverrides(prev => ({ ...prev, [code]: parseFloat(e.target.value) }))} />
                          <div className="mono-font text-[11px] text-stone-700 text-right">{Math.round(current * 100)}%</div>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            {override !== undefined && (
                              <button onClick={() => setWinRateOverrides(prev => { const n = {...prev}; delete n[code]; return n })}
                                className="mono-font text-[10px] text-stone-400 hover:text-stone-700">RESET</button>
                            )}
                            {override === undefined && <div className="mono-font text-[10px] text-stone-300">DEFAULT</div>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {hasOverrides && (
                    <button onClick={() => setWinRateOverrides({})}
                      className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 mt-4 border border-stone-300 px-3 py-1.5">
                      RESET ALL TO DEFAULTS
                    </button>
                  )}
                  <div className="mono-font text-[10px] text-stone-400 mt-3">
                    Default rates are based on published network win-rate research and Covalence model training data. Adjust based on your actual representment outcomes over the last 12 months for best accuracy.
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Vintage Analysis (Task 5) ── */}
        {activeScored.length > 1 && (() => {
          const buckets = [
            { label:'Filed ≤7d ago',    key:'w0', min:0,  max:7   },
            { label:'8–14 days ago',    key:'w1', min:8,  max:14  },
            { label:'15–30 days ago',   key:'w2', min:15, max:30  },
            { label:'31–60 days ago',   key:'w3', min:31, max:60  },
            { label:'61–90 days ago',   key:'w4', min:61, max:90  },
            { label:'91+ days ago',     key:'w5', min:91, max:9999},
          ]
          const filled = buckets.map(b => {
            const cs = activeScored.filter(c => c.filedDaysAgo >= b.min && c.filedDaysAgo <= b.max)
            return { ...b, count:cs.length, value:cs.reduce((s,c)=>s+c.amount,0) }
          }).filter(b => b.count > 0)
          if (filled.length < 2) return null
          const maxCount = Math.max(...filled.map(b => b.count), 1)
          // Vintage concentration risk: >60% in one bucket
          const totalClaims = activeScored.length
          const topBucket = filled.reduce((a,b) => a.count > b.count ? a : b)
          const vintageConc = topBucket.count / totalClaims
          return (
            <div className="mt-2 mb-6 border border-stone-300" style={{ background:'#FAF7F1' }}>
              <button className="w-full flex items-center justify-between px-4 py-3"
                style={{ borderBottom: vintageOpen ? '1px solid #E8E3DA' : 'none' }}
                onClick={() => setVintageOpen(v => !v)}>
                <div className="flex items-center gap-3">
                  <div className="mono-font text-[10px] tracking-widest text-stone-500">VINTAGE ANALYSIS — FILING DATE DISTRIBUTION</div>
                  {vintageConc > 0.60 && <div className="mono-font text-[10px]" style={{ background:'#FEF3C7', color:'#92400E', padding:'2px 7px' }}>⚠ VINTAGE CONCENTRATION</div>}
                </div>
                <div className="mono-font text-[10px] text-stone-400">{vintageOpen ? '▲ COLLAPSE' : '▼ EXPAND'}</div>
              </button>
              {vintageOpen && (
                <div className="px-4 py-4">
                  {vintageConc > 0.60 && (
                    <div className="mono-font text-[10px] text-amber-800 mb-4 border border-amber-300 bg-amber-50 px-3 py-2">
                      ⚠ {Math.round(vintageConc*100)}% of claims were filed within the same time window ("{topBucket.label}"). A clustered portfolio may indicate cherry-picking or a single-event batch rather than a rolling receivables stream. Request filing date documentation from the servicer.
                    </div>
                  )}
                  <div style={{ display:'grid', gap:'8px' }}>
                    {filled.map(b => {
                      const barW = Math.round(b.count / maxCount * 100)
                      return (
                        <div key={b.key} style={{ display:'grid', gridTemplateColumns:'140px 1fr 40px 100px', alignItems:'center', gap:'10px' }}>
                          <div className="mono-font text-[10px] text-stone-600">{b.label}</div>
                          <div style={{ height:'8px', background:'#E8E3DA', borderRadius:'2px' }}>
                            <div style={{ height:'100%', width:`${barW}%`, background: b.count/totalClaims > 0.60 ? '#92400e' : '#44403c', borderRadius:'2px', transition:'width 0.3s' }} />
                          </div>
                          <div className="mono-font text-[10px] text-stone-700 text-right">{b.count}</div>
                          <div className="mono-font text-[10px] text-stone-400 text-right">${Math.round(b.value).toLocaleString()}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mono-font text-[10px] text-stone-400 mt-3">A healthy rolling portfolio shows claims spread across multiple buckets. Funders typically prefer to see no single vintage accounting for more than 50% of face value.</div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Concentration drill-down ── */}
        {activeScored.length > 1 && (() => {
          const byMerchant = {}
          activeScored.forEach(c => {
            const key = c.note?.replace(/^From Dispute Desk:\s*/,'').split('·')[0].trim() || c.id
            if (!byMerchant[key]) byMerchant[key] = { count: 0, value: 0, expected: 0, codes: new Set() }
            byMerchant[key].count++
            byMerchant[key].value += c.amount
            byMerchant[key].expected += c.expectedRecovery
            byMerchant[key].codes.add(c.code)
          })
          const rows = Object.entries(byMerchant)
            .map(([name, d]) => ({ name, ...d, codes: [...d.codes] }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8)
          if (rows.length < 2) return null
          return (
            <div className="mt-2 mb-6">
              <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">CONCENTRATION BY MERCHANT / SOURCE (TOP {rows.length})</div>
              <div className="border border-stone-200 overflow-x-auto">
                <table className="w-full" style={{ minWidth: '480px' }}>
                  <thead>
                    <tr style={{ background: '#EEE9E0' }}>
                      {['MERCHANT / SOURCE','CLAIMS','FACE VALUE','EXP. RECOVERY','SHARE'].map(h=>(
                        <th key={h} className="mono-font text-[10px] tracking-widest text-stone-400 px-3 py-2 text-left font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r,i) => {
                      const share = totalValue > 0 ? Math.round(r.value / totalValue * 100) : 0
                      const shareColor = share > 35 ? 'text-red-700 font-bold' : share > 20 ? 'text-amber-700' : 'text-stone-600'
                      return (
                        <tr key={r.name} className="border-t border-stone-100" style={{ background: i % 2 === 0 ? '#FAF7F1' : '#F5F1EA' }}>
                          <td className="display-font text-sm text-stone-700 px-3 py-2 max-w-[200px] truncate">{r.name}</td>
                          <td className="mono-font text-xs text-stone-500 px-3 py-2">{r.count}</td>
                          <td className="mono-font text-xs text-stone-600 px-3 py-2">${r.value.toLocaleString()}</td>
                          <td className="mono-font text-xs text-stone-600 px-3 py-2">${Math.round(r.expected).toLocaleString()}</td>
                          <td className={`mono-font text-xs px-3 py-2 ${shareColor}`}>{share}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* ── Step 03 — Receivables Detail ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <span className="mono-font text-xs text-stone-500">03</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Receivables Detail</h2>
            <div className="sm:ml-auto flex gap-2 flex-wrap">
              <button className="upload-btn" onClick={() => {
                const w = window.open('','_blank')
                const g = grade
                w.document.write('<!DOCTYPE html><html><head><title>Covalence DFA — Portfolio Summary</title><style>body{font-family:monospace;padding:40px;color:#1A1814;max-width:900px;margin:0 auto}h1{font-size:26px;margin-bottom:4px}h2{font-size:13px;color:#78716c;margin:0 0 28px;font-weight:normal}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.card{border:1px solid #D4CCBC;padding:10px}.label{font-size:10px;letter-spacing:0.1em;color:#78716c;margin-bottom:3px}.val{font-size:19px;font-weight:600}.sub{font-size:10px;color:#a8a29e;margin-top:1px}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;padding:5px 8px;background:#EEE9E0;font-size:10px;letter-spacing:0.08em;font-weight:normal}td{padding:5px 8px;border-top:1px solid #f5f5f4}.A{color:#064e3b;font-weight:700}.B{color:#065f46}.C{color:#92400e}.D{color:#7f1d1d}.footer{margin-top:32px;font-size:10px;color:#a8a29e;border-top:1px solid #D4CCBC;padding-top:10px}@media print{button{display:none}}</style></head><body>'
                  + '<h1>Covalence — Dispute Funding Assessor</h1>'
                  + '<h2>Portfolio Summary &mdash; ' + new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) + '</h2>'
                  + '<div class="grid">'
                  + '<div class="card"><div class="label">PORTFOLIO VALUE</div><div class="val">$' + totalValue.toLocaleString() + '</div><div class="sub">' + activeScored.length + ' receivables</div></div>'
                  + '<div class="card"><div class="label">EXPECTED RECOVERY</div><div class="val">$' + Math.round(totalExpected).toLocaleString() + '</div><div class="sub">' + Math.round(totalValue>0?totalExpected/totalValue*100:0) + '% of face</div></div>'
                  + '<div class="card"><div class="label">RECOMMENDED ADVANCE</div><div class="val">$' + Math.round(advanceValue).toLocaleString() + '</div><div class="sub">' + Math.round(advanceRate*100) + '% of expected recovery</div></div>'
                  + '<div class="card"><div class="label">PORTFOLIO GRADE</div><div class="val">' + grade(weightedScore).label + '</div><div class="sub">' + Math.round(weightedScore) + ' weighted score</div></div>'
                  + '</div>'
                  + '<table><thead><tr><th>ID</th><th>FACE VALUE</th><th>CODE</th><th>GRADE</th><th>EXP. RECOVERY</th><th>ADVANCE</th><th>DAYS LEFT</th><th>NOTE</th></tr></thead><tbody>'
                  + activeScored.map(c=>{const gl=grade(c.fundability).label;return '<tr><td>'+c.id+'</td><td>$'+c.amount.toLocaleString()+'</td><td>'+c.code+'</td><td class="'+gl+'">'+gl+'</td><td>$'+Math.round(c.expectedRecovery).toLocaleString()+'</td><td>$'+Math.round(c.expectedRecovery*advanceRate).toLocaleString()+'</td><td>'+Math.max(0,c.windowDays-c.filedDaysAgo)+'d</td><td>'+String(c.note||'').replace(/</g,'&lt;').slice(0,60)+'</td></tr>'}).join('')
                  + '</tbody></table>'
                  + '<div class="footer">Generated by Covalence &middot; ' + new Date().toISOString().slice(0,19).replace('T',' ') + ' UTC</div>'
                  + '<br><button onclick="window.print()">&#128438; Print / Save as PDF</button>'
                  + '</body></html>')
                w.document.close()
              }}><Download style={{ width:13,height:13 }} /> Print Summary</button>
              <button className="upload-btn" onClick={() => exportResultsCSV(activeScored,advanceRate)}><Download style={{ width:13,height:13 }} /> Export CSV</button>
            </div>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-4 ml-7" style={{ lineHeight:"1.5" }}>
            Each claim scored as a standalone receivable. Select any row to view the full breakdown. Use <em>Exclude from portfolio</em> to model the portfolio without a claim.
          </p>

          <div className="flex flex-wrap gap-1 mb-4 ml-7">
            {(["all","A","B","C","D"]).map(g => (
              <button key={g} className={`grade-tab ${gradeFilter===g?"active":""}`} onClick={() => { setGradeFilter(g); setSelected(null) }}>
                {g==="all"?`ALL (${gradeCounts.all})`:`${g} (${gradeCounts[g]||0})`}
              </button>
            ))}
          </div>

          {/* Mobile */}
          <div className="mobile-only space-y-3">
            {sorted.map(c => {
              const g = grade(c.fundability); const isExpanded = expandedMobile===c.id; const isExcluded = excludedIds.has(c.id)
              return (
                <div key={c.id} className={`border border-stone-300 transition-opacity ${isExcluded?"opacity-40":""}`} style={{ background:"#FAF7F1" }}>
                  <button className="w-full text-left px-4 py-4" onClick={() => setExpandedMobile(isExpanded?null:c.id)}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="mono-font text-xs font-medium text-stone-800">{c.id}</span>
                          {c.source==="uploaded"&&<span className="mono-font text-[10px] px-1.5 py-0.5 bg-blue-900 text-blue-50">CSV</span>}
                          {c.source==="manual"&&<span className="mono-font text-[10px] px-1.5 py-0.5 bg-violet-900 text-violet-50">MANUAL</span>}
                          <span className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-500">{detectNetwork(c.code).toUpperCase()}</span>
                          {isExcluded&&<span className="mono-font text-[10px] px-1.5 py-0.5 border border-amber-600 text-amber-700">EXCL</span>}
                        </div>
                        <div className="display-font text-stone-600 text-[13px]">{c.code} — {c.codeLabel}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`mono-font text-xs font-bold px-2 py-0.5 ${g.bg} ${g.text}`}>{g.label}</span>
                        {isExpanded?<ChevronUp className="w-4 h-4 text-stone-400"/>:<ChevronDown className="w-4 h-4 text-stone-400"/>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="mono-font text-xs text-stone-600">${c.amount.toLocaleString()}</span>
                      <span className="mono-font text-[10px] text-stone-400">{c.windowDays-c.filedDaysAgo}d remaining</span>
                      <span className="mono-font text-[10px] text-stone-400">{Math.round(c.recoveryProb*100)}% win rate</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1"><ScoreBar value={c.fundability/100} color={g.bar} /></div>
                      <div className="flex gap-4 shrink-0">
                        <div className="text-right"><div className="mono-font text-[10px] text-stone-400">EXPECTED</div><div className="mono-font text-xs text-stone-700">${Math.round(c.expectedRecovery).toLocaleString()}</div></div>
                        <div className="text-right"><div className="mono-font text-[10px] text-stone-400">NET</div><div className="mono-font text-xs text-emerald-800 font-medium">${claimNet(c).toLocaleString()}</div></div>
                        <div className="text-right"><div className="mono-font text-[10px] text-stone-400">SCORE</div><div className="mono-font text-xs text-stone-800 font-medium">{c.fundability}</div></div>
                      </div>
                    </div>
                  </button>
                  {isExpanded&&<div className="border-t border-stone-300"><ClaimDetail sc={c} advanceRate={advanceRate} claimNet={claimNet} onClose={null} excluded={isExcluded} onToggleExclude={toggleExclude} onRemove={removeManualClaim} /></div>}
                </div>
              )
            })}
          </div>

          {/* Desktop */}
          <div className="desktop-only flex gap-6 items-start">
            <div style={{ flex:1, minWidth:0 }}>
              <div className="border border-stone-300 overflow-hidden" style={{ background:"#FAF7F1" }}>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth:"660px" }}>
                    <thead>
                      <tr className="border-b border-stone-300" style={{ background:"#EEE9E0" }}>
                        <th className="text-left px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">CLAIM</span></th>
                        <th className="text-left px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">CODE</span></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="amount" label="AMOUNT" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="expectedRecovery" label="EXPECTED" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="projectedNet" label="NET" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="fundability" label="SCORE" /></div></th>
                        <th className="text-center px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">GRADE</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(c => {
                        const g = grade(c.fundability); const isSel = selected===c.id; const isExcluded = excludedIds.has(c.id)
                        return (
                          <tr key={c.id} onClick={() => setSelected(isSel?null:c.id)} className={`claim-row cursor-pointer ${isSel?"selected":""} ${isExcluded?"excluded-row":""}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`mono-font text-xs font-medium ${isSel?"text-stone-100":"text-stone-800"}`}>{c.id}</span>
                                {c.source==="uploaded"&&<span className={`mono-font text-[10px] px-1.5 py-0.5 ${isSel?"bg-stone-600 text-stone-200":"bg-blue-900 text-blue-50"}`}>CSV</span>}
                                {c.source==="manual"&&<span className={`mono-font text-[10px] px-1.5 py-0.5 ${isSel?"bg-stone-600 text-stone-200":"bg-violet-900 text-violet-50"}`}>MAN</span>}
                              </div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{c.windowDays-c.filedDaysAgo}d remaining</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>{c.code}</div>
                              <div className={`sub-text display-font text-[11px] leading-snug mt-0.5 ${isSel?"":"text-stone-500"}`}>{c.codeLabel}</div>
                            </td>
                            <td className={`px-4 py-3 text-right mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>${c.amount.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">
                              <div className={`mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>${Math.round(c.expectedRecovery).toLocaleString()}</div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{Math.round(c.recoveryProb*100)}% win</div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className={`mono-font text-xs font-medium ${isSel?"text-emerald-300":"text-emerald-800"}`}>${claimNet(c).toLocaleString()}</div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{Math.round((1-advanceRate)*100)}% margin</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`mono-font text-xs text-right mb-1.5 ${isSel?"text-stone-100":"text-stone-800"}`}>{c.fundability}</div>
                              <ScoreBar value={c.fundability/100} color={isSel?"#F5F1EA":g.bar} />
                            </td>
                            <td className="px-4 py-3 text-center"><span className={`mono-font text-xs px-2 py-0.5 font-medium ${g.bg} ${g.text}`}>{g.label}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="w-80 flex-shrink-0">
              {sc ? (
                <ClaimDetail sc={sc} advanceRate={advanceRate} claimNet={claimNet} onClose={() => setSelected(null)} excluded={excludedIds.has(sc.id)} onToggleExclude={toggleExclude} onRemove={removeManualClaim} />
              ) : (
                <div className="border border-dashed border-stone-300 flex flex-col items-center justify-center py-20" style={{ background:"#FAF7F1" }}>
                  <div className="mono-font text-[10px] tracking-widest text-stone-300 text-center leading-relaxed">SELECT A CLAIM<br />TO VIEW DETAIL</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Step 04 — Investor Analysis ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">04</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Investor Analysis</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-8 ml-7" style={{ lineHeight:"1.5" }}>
            Stress-test the portfolio across scenarios, adjust the resolution window, and model the impact of a partial recourse structure. The advance is fixed at origination — scenarios affect only what the funder collects at resolution.
          </p>

          {/* Capital flow waterfall */}
          <div className="mb-8">
            <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-4">CAPITAL FLOW</div>
            <div className="space-y-2.5">
              {[
                { label:"FACE VALUE",        value:totalValue,                                  color:"#D4CCBC", textColor:"text-stone-500" },
                { label:"EXPECTED RECOVERY", value:totalExpected,                               color:"#78716c", textColor:"text-stone-600" },
                { label:"ADVANCE DEPLOYED",  value:advanceValue,                                color:"#064e3b", textColor:"text-emerald-900" },
                { label:"PROJECTED NET",     value:adjustedNet,                                 color:"#10b981", textColor:"text-emerald-700" },
              ].map(row => {
                const pct = totalValue > 0 ? Math.round(row.value/totalValue*100) : 0
                return (
                  <div key={row.label} className="flex items-center gap-3 sm:gap-4">
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 w-32 sm:w-40 shrink-0 text-right">{row.label}</div>
                    <div className="flex-1" style={{ background:"#EEE9E0", height:"20px", position:"relative", minWidth:0 }}>
                      <div style={{ position:"absolute", top:0, left:0, height:"100%", width:`${pct}%`, background:row.color, transition:"width 0.4s ease" }} />
                    </div>
                    <div className={`mono-font text-xs shrink-0 w-36 sm:w-44 ${row.textColor}`}>
                      ${Math.round(row.value).toLocaleString()} <span className="text-stone-400">({pct}%)</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Scenario table */}
          <div className="mb-8">
            <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-4">SCENARIO ANALYSIS</div>
            <div className="border border-stone-300 overflow-hidden" style={{ background:"#FAF7F1" }}>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth:"580px" }}>
                  <thead>
                    <tr className="border-b border-stone-200" style={{ background:"#EEE9E0" }}>
                      {["SCENARIO","EXPECTED RECOVERY","ADVANCE (FIXED)","NET TO FUNDER","RETURN","ANNUALIZED"].map(h => (
                        <th key={h} className={`px-4 py-2.5 mono-font text-[10px] tracking-widest text-stone-500 ${h==="SCENARIO"?"text-left":"text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label:"Base case",  sub:`Model as-is`,                  expected:totalExpected    },
                      { label:"Stress",     sub:`Win rates −20%`,               expected:stressExpected   },
                      { label:"Recovery",   sub:`30% partial on losing claims`,  expected:recoveryExpected },
                    ].map((s,i) => {
                      const scenNet    = s.expected - advanceValue + recourseBonus
                      const scenReturn = advanceValue > 0 ? scenNet/advanceValue : 0
                      const scenAnn    = advanceValue > 0 ? Math.round(((1+scenReturn)**(365/holdingDays)-1)*100) : 0
                      const pos        = scenNet > 0
                      return (
                        <tr key={s.label} className={`border-t border-stone-100 ${i===0?"":"bg-stone-50/30"}`}>
                          <td className="px-4 py-3">
                            <div className={`mono-font text-xs font-medium ${i===0?"text-stone-800":i===1?"text-red-800":"text-emerald-800"}`}>{s.label}</div>
                            <div className="display-font text-stone-400 text-[12px] italic mt-0.5">{s.sub}</div>
                          </td>
                          <td className="px-4 py-3 mono-font text-xs text-stone-700 text-right">${Math.round(s.expected).toLocaleString()}</td>
                          <td className="px-4 py-3 mono-font text-xs text-stone-400 text-right">${Math.round(advanceValue).toLocaleString()}</td>
                          <td className={`px-4 py-3 mono-font text-xs font-medium text-right ${pos?"text-emerald-800":"text-red-800"}`}>${Math.round(scenNet).toLocaleString()}</td>
                          <td className={`px-4 py-3 mono-font text-xs font-medium text-right ${pos?"text-emerald-800":"text-red-800"}`}>{Math.round(scenReturn*100)}%</td>
                          <td className={`px-4 py-3 mono-font text-xs font-medium text-right ${pos?"text-emerald-800":"text-red-800"}`}>{scenAnn}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recourse + holding period controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Recourse */}
            <div className="border border-stone-300 p-5" style={{ background:"#FAF7F1" }}>
              <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-4">RECOURSE STRUCTURE</div>
              <div className="flex gap-0 mb-4">
                {[["nonrecourse","Non-recourse"],["partial","Partial recourse"]].map(([val,lbl]) => (
                  <button key={val} onClick={() => setRecourseType(val)}
                    className={`mono-font text-[10px] tracking-wide px-3 py-2 border transition-colors flex-1 ${recourseType===val?"border-stone-900 bg-stone-900 text-stone-50":"border-stone-300 text-stone-500 hover:border-stone-600"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              {recourseType === "partial" ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="display-font text-stone-600 text-[13px]">Issuer refund on losses</span>
                    <span className="mono-font text-xs font-bold text-stone-900">{Math.round(refundPct*100)}%</span>
                  </div>
                  <input type="range" min="0.05" max="0.50" step="0.05" value={refundPct} onChange={e => setRefundPct(parseFloat(e.target.value))} className="w-full" />
                  <div className="flex justify-between mono-font text-[10px] text-stone-400 mt-1 mb-3"><span>5%</span><span>25%</span><span>50%</span></div>
                  <div className="mono-font text-[10px] tracking-widest text-emerald-700">+${Math.round(recourseBonus).toLocaleString()} expected refund · improves net return by {advanceValue>0?Math.round(recourseBonus/advanceValue*100):0}pp</div>
                </div>
              ) : (
                <p className="display-font text-stone-500 text-[13px] leading-relaxed">Funder bears all credit losses. No refund from issuer on losing claims. Full downside risk sits with the funder.</p>
              )}
            </div>

            {/* Holding period */}
            <div className="border border-stone-300 p-5" style={{ background:"#FAF7F1" }}>
              <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-4">RESOLUTION WINDOW</div>
              <div className="flex items-center justify-between mb-2">
                <span className="display-font text-stone-600 text-[13px]">Average holding period</span>
                <span className="mono-font text-xs font-bold text-stone-900">{holdingDays} days</span>
              </div>
              <input type="range" min="45" max="180" step="15" value={holdingDays} onChange={e => setHoldingDays(parseInt(e.target.value))} className="w-full" />
              <div className="flex justify-between mono-font text-[10px] text-stone-400 mt-1 mb-4"><span>45d</span><span>90d</span><span>135d</span><span>180d</span></div>
              <div className="border-t border-stone-200 pt-4 space-y-2">
                {[
                  { label:"Gross return on advance", val:`${roaPercent}%` },
                  { label:`Annualized (${holdingDays}d)`, val:`~${annualizedIRR}%`, bold:true },
                  { label:"Est. net after 15% costs", val:`~${Math.round(annualizedIRR*0.85)}%`, muted:true },
                ].map(r => (
                  <div key={r.label} className="flex justify-between">
                    <span className="display-font text-stone-500 text-[13px]">{r.label}</span>
                    <span className={`mono-font text-xs font-medium ${r.muted?"text-stone-400":r.bold?"text-emerald-800":"text-stone-700"}`}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Underwriting criteria ── */}
        <div className="section-divider" />
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-500 mb-4">UNDERWRITING CRITERIA</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { title:"RECOVERY PROBABILITY (55%)", body:"Reason code base win rate adjusted separately for fraud and consumer signals. Fraud: AVS mismatch, 3DS absence, VFMP enrollment (positive); PIN verification (severe negative). Consumer: delivery confirmation (negative), merchant acknowledgement, documentation strength. Merchant CBR uses a sliding scale — high CBR signals systemic bad-actor risk; very clean merchants fight representment harder. Prior claim history applies a 7% penalty per claim." },
              { title:"TIME VALUE (25%)", body:"Days remaining in the filing window, decayed non-linearly. Inside 30 days: material discount. Inside 15 days: severe penalty. Visa's standard window is 120 days; fraud codes extend further. Claims inside 15 days should rarely be funded — time pressure disadvantages the issuer at every stage of the process and reduces funder negotiating leverage." },
              { title:"AMOUNT EFFICIENCY (20%)", body:"Funder overhead — legal, operational, servicing — is roughly fixed per claim. Sub-$100 claims rarely justify the cost. Above $2,000 introduces single-claim concentration risk. The sweet spot is $200–$2,000. Portfolio advance rates: A → 65% / B → 55% / C → 44% / D → 30% of probability-weighted expected recovery. Override with the advance rate slider above." },
            ].map(m => (
              <div key={m.title}>
                <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-2">{m.title}</div>
                <p className="display-font text-stone-600 text-[14px] leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Disclaimer ── */}
        <div className="section-divider" />
        <div className="flex items-start gap-3 border border-amber-700 bg-amber-50 p-4">
          <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <p className="display-font text-stone-800 text-[13px] leading-relaxed">
            Win-rate baselines approximate Visa issuer dispute outcome data and carry model uncertainty. Advance rates and portfolio grade reflect expected value — actual recovery depends on evidence quality, merchant behaviour at representment, and network rule changes. Annualized returns assume resolution within the modelled window. Not legal or financial advice.
          </p>
        </div>
        </React.Fragment>}
        </div>
  )
}

// 002 DISPUTE DESK — case analysis, evidence, tracker (issuer + merchant)
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import { SectionNav } from '../SectionNav.jsx'
import React, { useState, useEffect, useRef } from 'react'
import { Shield, Loader2, ArrowRight, AlertCircle, FileText, Check, Copy, CheckSquare, Square, MessageSquare, ClipboardList, Pencil, Download } from 'lucide-react'
import { openEvidence } from '../CaseThread.jsx'
import { SUPA_KEY, SUPA_URL, pushCasesToSupa, uploadEvidence } from '../data.js'
import { DEFAULT_SETTINGS, REASON_TITLES, daysUntil, estimateFundingGrade, loadDeskSession, notesText, saveOutcomes, toDfaClaim } from '../shared.jsx'
import { EXPLAIN_RULES, EXPLAIN_JSON, aiRecord, aiDraftRecord, readAiJson, withDecision } from '../ai.js'
import { AiExplain, AiDraftNote } from '../AiExplain.jsx'
import { readCases } from '../caseStore.js'
import { doesIssuing, doesMerchant, isMerchantCase } from '../sides.mjs'
import { ChargebackRatioPanel, ratiosFor } from '../ChargebackRatioPanel.jsx'

// ─── Evidence Package — per reason code ──────────────────────────────────────
// Returns { systems, cardholder, merchant } arrays of { text, impact } items
// impact: 'required' | 'strengthens' | 'weakens' | 'context'
function getEvidencePackage(reasonCode, category) {
  const code = (reasonCode || '').toString().trim()
  const cat  = (category  || '').toString().toLowerCase()

  // Helper shorthands
  const req  = (text) => ({ text, impact: 'required'    })
  const str  = (text) => ({ text, impact: 'strengthens' })
  const ctx  = (text) => ({ text, impact: 'context'     })
  const wkn  = (text) => ({ text, impact: 'weakens'     })

  // ── Common fraud base ─────────────────────────────────────────────────────
  const fraudSystems    = [req('Transaction log with amount, date, timestamp, and MCC'), req('Authorization record — approval code, terminal ID, entry mode'), str('Device fingerprint / IP address at time of authorization'), str('Velocity report — other transactions on same card that day'), ctx('Card status history (active / blocked / reported stolen)')]
  const fraudCardholder = [req('Cardholder written statement — what happened, when discovered'), str('Confirmation cardholder did NOT authorize the transaction'), ctx('Date and method of fraud report (phone, online, branch)')]
  const fraudMerchant   = [wkn('Delivery confirmation / signed receipt — if present, weakens fraud claim'), wkn('Prior undisputed transactions at same merchant (CE 3.0 risk)'), ctx('Merchant dispute rate / VFMP status')]

  // ── Visa Fraud — 10.4 CNP ────────────────────────────────────────────────
  if (code.startsWith('10.4')) return {
    systems:    [...fraudSystems, str('AVS result (mismatch strengthens claim)'), str('CVV2 result (mismatch strengthens claim)'), str('3DS authentication result — if attempted')],
    cardholder: [...fraudCardholder, req('Confirmation cardholder did not place the order or recognize the merchant')],
    merchant:   [...fraudMerchant, wkn('Compelling Evidence 3.0 — device/IP match from prior orders (CE3.0 can defeat 10.4 — check before filing)'), wkn('Delivery confirmation with signature')],
  }
  // ── Visa Fraud — 10.1 Lost / Stolen / 10.2 Not in Possession ─────────────
  if (code.startsWith('10.1') || code.startsWith('10.2')) return {
    systems:    [...fraudSystems, str('Chip / mag-stripe read indicator — mag-stripe on chip-capable card strengthens claim'), str('PIN verification result'), ctx('Last legitimate cardholder transaction — location comparison')],
    cardholder: [...fraudCardholder, str('Police / theft report number and date'), ctx('Date card was lost or stolen if known')],
    merchant:   [wkn('Signed receipt — if signed, weakens claim'), wkn('PIN entry record — if correct PIN used, investigate ATO')],
  }
  // ── Visa 10.5 Visa Fraud Monitoring Program ───────────────────────────────
  if (code.startsWith('10.5')) return {
    systems:    [...fraudSystems, req('VFMP enrollment confirmation for merchant')],
    cardholder: fraudCardholder,
    merchant:   fraudMerchant,
  }
  // ── Visa 13.1 Merchandise / Service Not Received ─────────────────────────
  if (code.startsWith('13.1')) return {
    systems:    [req('Transaction record and authorization details'), ctx('Expected delivery date from order records')],
    cardholder: [req('Cardholder statement — what was ordered, when, not received'), str('Communication with merchant (emails, chat, screenshots)'), str('Expected delivery date'), ctx('Shipping address confirmation')],
    merchant:   [wkn('Carrier tracking confirmation with delivery to correct address'), wkn('Signed proof of delivery'), ctx('Order details and customer communication records')],
  }
  // ── Visa 13.2 Cancelled Recurring / 13.3 Not as Described ────────────────
  if (code.startsWith('13.2')) return {
    systems:    [req('Transaction history showing recurring charges'), ctx('Dispute filing date — must be after cancellation')],
    cardholder: [req('Proof of cancellation — email confirmation, screenshot, reference number'), req('Date cancellation was requested'), str('Merchant acknowledgment of cancellation')],
    merchant:   [wkn('Proof subscription was not cancelled'), wkn('Terms agreed to by cardholder at signup')],
  }
  if (code.startsWith('13.3')) return {
    systems:    [req('Transaction log'), ctx('Merchant website / product description at time of purchase if available')],
    cardholder: [req('Written description of how item/service differed from what was advertised'), str('Photos or documentation of the item received'), str('Screenshots of the merchant listing or advertisement'), ctx('Communication with merchant regarding the discrepancy')],
    merchant:   [wkn('Original product description / listing'), wkn('Proof item matched description')],
  }
  // ── Visa 13.6 Credit Not Processed ───────────────────────────────────────
  if (code.startsWith('13.6')) return {
    systems:    [req('Transaction record'), ctx('Credit history — confirm no credit was posted')],
    cardholder: [req('Proof credit or refund was promised — email, return receipt, written confirmation'), str('Date return was made or credit was agreed'), ctx('Item return tracking if applicable')],
    merchant:   [wkn('Proof credit was issued'), wkn('Merchant refund policy at time of purchase')],
  }
  // ── Mastercard 4853 Cardholder Dispute ────────────────────────────────────
  if (code.startsWith('4853')) return {
    systems:    [req('Transaction record'), ctx('Merchant category and prior dispute history')],
    cardholder: [req('Cardholder written description of the dispute'), str('Evidence merchant was contacted (30-day rule)'), str('Documentation of the original agreement or order'), ctx('Relevant communications with merchant')],
    merchant:   [wkn('Proof of delivery or service rendered'), wkn('Signed agreement or terms accepted by cardholder')],
  }
  // ── Mastercard 4837 No Cardholder Authorization ───────────────────────────
  if (code.startsWith('4837')) return {
    systems:    [...fraudSystems, str('Chip or PIN indicator'), str('AVS / CVV2 results')],
    cardholder: [...fraudCardholder],
    merchant:   [...fraudMerchant, wkn('Valid cardholder signature on receipt')],
  }
  // ── Mastercard 4863 Cardholder Does Not Recognize ────────────────────────
  if (code.startsWith('4863')) return {
    systems:    [...fraudSystems, str('Merchant DBA vs legal name — discrepancy supports cardholder')],
    cardholder: [req('Cardholder statement they do not recognize the merchant'), str('Explanation of what DBA name appeared on statement')],
    merchant:   [wkn('Evidence cardholder made the transaction'), ctx('Merchant DBA / trade name records')],
  }
  // ── Generic fraud fallback ────────────────────────────────────────────────
  if (cat.includes('fraud')) return { systems: fraudSystems, cardholder: fraudCardholder, merchant: fraudMerchant }

  // ── Generic consumer dispute fallback ─────────────────────────────────────
  return {
    systems:    [req('Transaction log with authorization details'), ctx('Prior transaction history with this merchant')],
    cardholder: [req('Cardholder written statement describing the dispute'), str('Supporting documentation — receipts, emails, screenshots'), str('Evidence merchant was contacted before filing')],
    merchant:   [wkn('Proof of delivery or service'), wkn('Signed receipt or agreement'), ctx('Merchant refund / dispute policy')],
  }
}

// ─── NACHA ACH Return Code Reference ─────────────────────────────────────────
const NACHA_RETURN_CODES = [
  { code: 'R01', title: 'Insufficient Funds',                               type: 'Bank Return',  deadline: '2 BD',  fraud: false, notes: 'Most common return. Eligible for re-presentment (up to 2×). Not necessarily fraud — verify with consumer before disputing.' },
  { code: 'R02', title: 'Account Closed',                                   type: 'Bank Return',  deadline: '2 BD',  fraud: false, notes: 'Account closed before settlement. Re-presentment not permitted. Obtain new payment method from consumer.' },
  { code: 'R03', title: 'No Account / Unable to Locate Account',            type: 'Bank Return',  deadline: '2 BD',  fraud: true,  notes: 'Account number does not correspond to an individual or does not exist. Potential origination fraud — verify beneficiary details before re-presenting.' },
  { code: 'R04', title: 'Invalid Account Number Structure',                  type: 'Bank Return',  deadline: '2 BD',  fraud: false, notes: 'Account number fails check-digit validation. Likely data entry error — do not re-present until corrected.' },
  { code: 'R05', title: 'Unauthorized Debit to Consumer Account (Corporate SEC)', type: 'Consumer Return', deadline: '60 CD', fraud: true,  notes: 'High-risk fraud indicator. Consumer claims debit was unauthorized using corporate (CCD/CTX) entry format. File within 60 calendar days. Reg E investigation required for debit accounts.' },
  { code: 'R07', title: 'Authorization Revoked by Customer',                type: 'Consumer Return', deadline: '60 CD', fraud: false, notes: 'Consumer had authorized the debit but has since revoked it. Must stop future entries. Reg E provisional credit applies for debit cards. File within 60 calendar days.' },
  { code: 'R10', title: 'Customer Advises Not Authorized',                  type: 'Consumer Return', deadline: '60 CD', fraud: true,  notes: 'Most common fraud-related ACH return. Consumer states they never authorized the debit. File within 60 calendar days. Reg E investigation and provisional credit rules apply.' },
  { code: 'R11', title: 'Customer Advises Entry Not in Accordance with Terms', type: 'Consumer Return', deadline: '60 CD', fraud: false, notes: 'Debit occurred but not per agreed amount, date, or frequency. Different from R07 — authorization existed but was violated. File within 60 calendar days.' },
  { code: 'R29', title: 'Corporate Customer Advises Not Authorized',        type: 'Corporate Return', deadline: '2 BD',  fraud: true,  notes: 'Corporate equivalent of R10. Used for CCD and CTX entries only. Company advises they did not authorize the debit entry. 2 business day return window.' },
  { code: 'R20', title: 'Non-Transaction Account',                          type: 'Bank Return',  deadline: '2 BD',  fraud: false, notes: 'Account type does not permit ACH debits (e.g., savings/money market with transaction limits). Re-present to a valid DDA.' },
]

// ═══════════════════════════════════════════════════════════════════════════════
// 002 DISPUTE DESK — full view
// ═══════════════════════════════════════════════════════════════════════════════
export function DeskView({ onGoToDesk, triageHandoff, setTriageHandoff, onScoreInDfa, onSendToDuo, onGoToDuo, platformMode, setPlatformMode, sides = ['issuer', 'merchant'], rootSettings, covUser, setOutcomes: setRootOutcomes, deskOpenRequest }) {
  // Restore previous session so navigation away doesn't wipe in-progress analysis
  const _sess = React.useRef(loadDeskSession()).current
  const [quickDueDateRow, setQuickDueDateRow] = React.useState(null)  // row id with inline date picker open
  const [quickDueDate,    setQuickDueDate]    = React.useState('')
  const [network, setNetwork]                               = useState(_sess.network || 'visa')
  const [complaint, setComplaint]                           = useState(_sess.complaint || '')
  const [merchant, setMerchant]                             = useState(_sess.merchant || '')
  const [amount, setAmount]                                 = useState(_sess.amount || '')
  const [transactionDate, setTransactionDate]               = useState(_sess.transactionDate || '')
  const [expectedDeliveryDate, setExpectedDeliveryDate]     = useState(_sess.expectedDeliveryDate || '')
  const [currency, setCurrency]                             = useState(_sess.currency || 'CAD')
  const [loading, setLoading]                               = useState(false)
  const [result, setResult]                                 = useState(_sess.result ?? null)
  const [error, setError]                                   = useState(null)
  const [copied, setCopied]                                 = useState(false)
  const [checked, setChecked]                               = useState({})
  const [rebuttal, setRebuttal]                             = useState(_sess.rebuttal ?? null)
  const [rebuttalLoading, setRebuttalLoading]               = useState(false)
  const [rebuttalError, setRebuttalError]                   = useState(null)
  const [comms, setComms]                                   = useState(_sess.comms ?? null)
  const [commsLoading, setCommsLoading]                     = useState(false)
  const [commsError, setCommsError]                         = useState(null)
  const [commsCopied, setCommsCopied]                       = useState(false)
  const [editableLetterBody, setEditableLetterBody]         = useState(_sess.editableLetterBody || '')
  const [letterDraftModified, setLetterDraftModified]       = useState(false) // true if agent edited the generated letter
  const [editableDocsSection,  setEditableDocsSection]         = useState('')
  const [editableNextSteps,    setEditableNextSteps]           = useState('')
  const [docRequestCopied, setDocRequestCopied]             = useState(false)
  const [goodwillCopied, setGoodwillCopied]                 = useState(false)
  const [disputedAmount, setDisputedAmount]                 = useState(_sess.disputedAmount || '')     // partial dispute amount (optional)
  const [cardType, setCardType]                             = useState(_sess.cardType || 'credit') // 'credit' | 'debit'
  const [sarDiscoveryDate, setSarDiscoveryDate]             = useState('')     // FI: date fraud was detected (for SAR deadline)
  const [sarDraftOpen, setSarDraftOpen]                     = useState(false)
  const [editingRow, setEditingRow]                         = useState(null)   // id of row being edited
  const [expandedCbRow, setExpandedCbRow]               = useState(null)   // id of row with CB cycle panel open
  const [case360Id, setCase360Id]                           = useState(null)   // id of case with 360 panel open
  const [editDraft, setEditDraft]                           = useState({})     // draft field values

  // ── 3DS / authentication ──────────────────────────────────────────────────
  const [threeDSStatus, setThreeDSStatus]                   = useState(_sess.threeDSStatus || 'unknown') // 'not_attempted' | 'attempted_failed' | 'attempted_passed' | 'unknown'

  // ── FI DFA signals — captured at intake, passed to DFA when scoring ───────
  // null = unknown (agent doesn't have info), false = no, true = yes
  const [fiAvsMismatch, setFiAvsMismatch]                   = useState(null)
  const [fiIsVFMP, setFiIsVFMP]                             = useState(null)
  const [fiPriorClaims, setFiPriorClaims]                   = useState('')

  // ── Evidence / doc attachment ────────────────────────────────────────────────
  const [docOpen,       setDocOpen]       = useState({})   // {[caseId]: boolean}
  const [docUploading,  setDocUploading]  = useState({})   // {[caseId]: boolean}
  const [docError,      setDocError]      = useState({})   // {[caseId]: string}

  // ── Pre-arb response drafter ──────────────────────────────────────────────
  const [preArbDraft, setPreArbDraft]                       = useState(null)
  const [preArbLoading, setPreArbLoading]                   = useState(false)
  const [preArbError, setPreArbError]                       = useState(null)
  const [preArbCopied, setPreArbCopied]                     = useState(false)
  const [preArbTargetId, setPreArbTargetId]                 = useState(null) // tracker row ID
  const [merchantRepNotes, setMerchantRepNotes]             = useState({}) // {[outcomeId]: string}

  // ── Platform mode ─────────────────────────────────────────────────────────
  const [supaSyncStatus, setSupaSyncStatus] = React.useState(SUPA_URL && SUPA_KEY ? 'idle' : 'disabled')
  // platformMode + setPlatformMode come as props from Covalence

  // ── Merchant intake state ─────────────────────────────────────────────────
  const [mchReasonCode, setMchReasonCode]                   = useState('')
  const [mchOrderDate, setMchOrderDate]                     = useState('')
  const [mchOrderId, setMchOrderId]                         = useState('')
  const [mchCustomerEmail, setMchCustomerEmail]             = useState('')
  const [mchDeliveryConfirmed, setMchDeliveryConfirmed]     = useState('unknown')
  const [mchThreeDS, setMchThreeDS]                         = useState('unknown')
  const [mchRefundPolicyShown, setMchRefundPolicyShown]     = useState('unknown')
  const [mchPriorOrders, setMchPriorOrders]                 = useState('')
  const [mchIpLogs, setMchIpLogs]                           = useState('')
  const [mchResult, setMchResult]                           = useState(null)
  const [mchLoading, setMchLoading]                         = useState(false)
  const [mchError, setMchError]                             = useState(null)
  const [mchRepLetter, setMchRepLetter]                     = useState(null)
  const [mchRepLetterLoading, setMchRepLetterLoading]       = useState(false)
  const [mchRepLetterError, setMchRepLetterError]           = useState(null)
  const [mchRepLetterCopied, setMchRepLetterCopied]         = useState(false)
  const [mchEvidenceChecked, setMchEvidenceChecked]         = useState({})
  const [mchRepPackage, setMchRepPackage]                   = useState({})
  const [mchAcquirer, setMchAcquirer]                       = useState('')
  const [mchRepDeadline, setMchRepDeadline]                 = useState('')
  const [mchSubmitDate, setMchSubmitDate]                   = useState('')
  const [mchTrackingRef, setMchTrackingRef]                 = useState('')
  // Step 05 — Outcome state
  const [mchOutcome, setMchOutcome]                         = useState('')   // 'won'|'lost'|'pre_arb'|'no_response'
  const [mchOutcomeDate, setMchOutcomeDate]                 = useState('')
  const [mchRecoveryAmt, setMchRecoveryAmt]                 = useState('')
  const [mchPreArbLetter, setMchPreArbLetter]               = useState(null)
  const [mchPreArbLoading, setMchPreArbLoading]             = useState(false)
  const [mchPreArbError, setMchPreArbError]                 = useState(null)
  const [mchPreArbCopied, setMchPreArbCopied]               = useState(false)
  const [mchAcqEmailCopied, setMchAcqEmailCopied]           = useState(false)

  // ── Case status lifecycle tracker ─────────────────────────────────────────
  const CASE_STATUS_STAGES = [
    { id: 'filed',            label: 'Filed',               short: 'Filed'     },
    { id: 'investigating',    label: 'Under Investigation',  short: 'Investig.' },
    { id: 'pc_issued',        label: 'PC Issued',            short: 'PC Issued' },
    { id: 'network_response', label: 'Network Response',     short: 'Net. Resp.'},
    { id: 'resolved',         label: 'Resolved / Closed',    short: 'Resolved'  },
  ]
  const [caseStatusKey, setCaseStatusKey]         = useState(null)
  const [caseStatusStage, setCaseStatusStageRaw]  = useState(null)
  const [caseStatusHistory, setCaseStatusHistory] = useState({})
  const setCaseStatusStage = (newStage) => {
    setCaseStatusStageRaw(newStage)
    const now = new Date().toISOString()
    setCaseStatusHistory(prev => {
      const next = { ...prev, [newStage]: prev[newStage] || now }
      if (caseStatusKey) {
        try { localStorage.setItem('desk_cs_hist_' + caseStatusKey, JSON.stringify(next)) } catch {}
      }
      return next
    })
    if (caseStatusKey) {
      try { localStorage.setItem('desk_cs_stage_' + caseStatusKey, newStage) } catch {}
    }
  }

  // ── Chargeback cycle deadline tracker ────────────────────────────────────
  const [cbFiledDate, setCbFiledDate]   = useState(_sess.cbFiledDate || '')
  const [cbCycleStage, setCbCycleStage] = useState(_sess.cbCycleStage || '1cb')
  const [currentDeskCaseId, setCurrentDeskCaseId] = useState(_sess.currentDeskCaseId ?? null) // ID of most recently analyzed case in desk
  // AI drafts (letters, predictions): which model and prompt wrote each, also kept on the case
  const [draftAi, setDraftAi] = useState({})
  const noteDraft = (kind, data, caseId) => {
    const rec = aiDraftRecord(kind, data)
    setDraftAi(d => ({ ...d, [kind]: rec }))
    if (caseId) setOutcomes(prev => prev.map(o => o.id === caseId ? withDecision(o, rec) : o))
  }


  // ── Deadline push notifications ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    const fireAlerts = () => {
      if (Notification.permission !== 'granted') return
      outcomes.forEach(o => {
        if (!o.provCreditDate || isMerchantCase(o)) return
        const pc45 = addBusinessDays(o.provCreditDate, 45)
        const d = Math.ceil((pc45 - new Date()) / 86400000)
        if (d === 3 || d === 1) {
          new Notification('Covalence — Reg E Deadline', {
            body: `${o.merchant || o.id}: ${d === 1 ? 'tomorrow' : '3 days'} until 45BD provisional credit deadline`,
            icon: '/favicon.ico',
          })
        }
      })
    }
    fireAlerts()
    const timer = setInterval(fireAlerts, 60 * 60 * 1000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Outcome tracking (60-day dispute log) ─────────────────────────────────
  const [outcomes, setOutcomes] = useState(readCases)
  useEffect(() => {
    saveOutcomes(outcomes)   // writes to the case store + notifies Multi via _covRefreshMulti
    if (SUPA_URL && SUPA_KEY && outcomes.length > 0) {
      setSupaSyncStatus('syncing')
      pushCasesToSupa(outcomes)
        .then(() => setSupaSyncStatus('synced'))
        .catch(() => setSupaSyncStatus('error'))
    }
  }, [outcomes])

  // ── Persist desk session so navigation away doesn't lose in-progress work ──
  useEffect(() => {
    const snap = { network, complaint, merchant, amount, currency, transactionDate, expectedDeliveryDate,
      disputedAmount, cardType, threeDSStatus, cbFiledDate, cbCycleStage, result, rebuttal, comms,
      editableLetterBody, currentDeskCaseId }
    try { sessionStorage.setItem('cov_desk_session', JSON.stringify(snap)) } catch {}
  }, [network, complaint, merchant, amount, currency, transactionDate, expectedDeliveryDate,
      disputedAmount, cardType, threeDSStatus, cbFiledDate, cbCycleStage, result, rebuttal, comms,
      editableLetterBody, currentDeskCaseId])

  // ── Compliance settings — persisted ───────────────────────────────────────
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } }
  })
  useEffect(() => {
    try { localStorage.setItem('cov_settings', JSON.stringify(settings)) } catch {}
  }, [settings])
  const [showSettings, setShowSettings] = useState(false)
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))
  const resetSettings = () => { setSettings({ ...DEFAULT_SETTINGS }); try { localStorage.removeItem('cov_settings') } catch {} }

  // ── Triage handoff — triageHandoff + setTriageHandoff come as props ────
  const showHandoffBanner = triageHandoff !== null
  const dismissHandoffBanner = () => setTriageHandoff(null)
  const deskRootRef = useRef(null)
  // COV- number the next analysis should reuse (set by a Triage handoff or by opening a tracked case)
  const pendingCaseIdRef = useRef(null)
  const pendingIntakeRef = useRef(null)   // a claim from the bank's app: { claimId, reference, channel, reportedAt }
  // Case panel → "Open in Desk": pre-fill the form from the case (no automatic AI re-run)
  useEffect(() => {
    const o = deskOpenRequest?.case
    if (!o) return
    if (o.merchant && o.merchant !== '—') setMerchant(o.merchant)
    if (o.amount && o.amount !== '—') {
      const pts = String(o.amount).split(' ')
      if (pts[0]) setAmount(pts[0])
      if (pts[1]) setCurrency(pts[1])
    }
    if (o.network) setNetwork(String(o.network).toLowerCase().includes('visa') ? 'visa' : 'mastercard')
    if (o._transactionDate) setTransactionDate(o._transactionDate)
    if (o._cardType) setCardType(o._cardType)
    if (o._complaint) setComplaint(o._complaint)
    if (o.cbStage) setCbCycleStage(o.cbStage)
    if (o.cbFiledDate) setCbFiledDate(o.cbFiledDate)
    setCurrentDeskCaseId(o.id)
    pendingCaseIdRef.current = o.id
    setResult(null); setRebuttal(null); setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskOpenRequest])
  useEffect(() => {
    if (!triageHandoff) return
    pendingCaseIdRef.current = /^COV-/.test(triageHandoff.caseId || '') ? triageHandoff.caseId : null
    pendingIntakeRef.current = triageHandoff.intake || null
    if (triageHandoff.merchant)         setMerchant(triageHandoff.merchant)
    if (triageHandoff.amount)           setAmount(triageHandoff.amount)
    if (triageHandoff.currency)         setCurrency(triageHandoff.currency)
    if (triageHandoff.transactionDate)  setTransactionDate(triageHandoff.transactionDate)
    if (triageHandoff.complaint)        setComplaint(triageHandoff.complaint)
    if (triageHandoff.network) {
      const n = triageHandoff.network.toLowerCase()
      if (n.includes('mastercard') || n.includes('mc')) setNetwork('mastercard')
      else if (n.includes('visa'))                       setNetwork('visa')
    }
  }, [triageHandoff])

  const toggleCheck = (key) => setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const computeDaysSince = (dateStr) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    const today = new Date()
    return Math.floor((today - d) / (1000 * 60 * 60 * 24))
  }

  const filingWindowStatus = (isFraud) => {
    const txnDays      = computeDaysSince(transactionDate)
    const expectedDays = computeDaysSince(expectedDeliveryDate)
    if (txnDays === null && expectedDays === null) return null
    const baseline = (!isFraud && expectedDays !== null) ? expectedDays : txnDays
    const cap      = txnDays
    const fw = isFraud ? settings.fraudWindowDays : settings.consumerWindowDays
    const warnAt = Math.round(fw * 0.83)   // warn at ~83% of window
    if (isFraud) {
      if (cap > fw)     return { status: 'expired', text: `${cap} days since transaction — past ${fw}-day fraud filing window`, color: 'red' }
      if (cap > warnAt) return { status: 'warning', text: `${cap} days since transaction — only ${fw - cap} days remaining`, color: 'amber' }
      return { status: 'ok', text: `${cap} days since transaction — within ${fw}-day fraud filing window`, color: 'green' }
    }
    if (cap !== null && cap > settings.absoluteCapDays) return { status: 'expired', text: `Past ${settings.absoluteCapDays}-day absolute cap (${cap} days since transaction)`, color: 'red' }
    if (baseline > fw)     return { status: 'late',    text: `${baseline} days past baseline date — outside ${fw}-day standard window`, color: 'red' }
    if (baseline > warnAt) return { status: 'warning', text: `${baseline} days elapsed — only ${fw - baseline} days remaining`, color: 'amber' }
    return { status: 'ok', text: `${baseline} days elapsed — within ${fw}-day filing window`, color: 'green' }
  }

  // ─── Visa reason codes prompt section ───────────────────────────────────────
  const visaCodes = `
Visa reason codes:

FRAUD (Category 10):
- 10.1: EMV Liability Shift Counterfeit Fraud
- 10.2: EMV Liability Shift Non-Counterfeit Fraud
- 10.3: Other Fraud — Card-Present Environment
- 10.4: Other Fraud — Card-Absent Environment
- 10.5: Visa Fraud Monitoring Program

AUTHORIZATION (Category 11):
- 11.1: Card Recovery Bulletin
- 11.2: Declined Authorization
- 11.3: No Authorization

PROCESSING ERRORS (Category 12):
- 12.1: Late Presentment
- 12.2: Incorrect Transaction Code
- 12.3: Incorrect Currency
- 12.4: Incorrect Account Number
- 12.5: Incorrect Amount
- 12.6.1: Duplicate Processing
- 12.6.2: Paid by Other Means
- 12.7: Invalid Data

CONSUMER DISPUTES (Category 13):
- 13.1: Merchandise/Services Not Received
- 13.2: Cancelled Recurring Transaction
- 13.3: Not as Described / Defective Merchandise
- 13.4: Counterfeit Merchandise
- 13.5: Misrepresentation
- 13.6: Credit Not Processed
- 13.7: Cancelled Merchandise/Services
- 13.8: Original Credit Transaction Not Accepted
- 13.9: Non-Receipt of Cash or Load Transaction Value`

  const mastercardCodes = `
Mastercard reason codes:

FRAUD:
- 4837: No Cardholder Authorization
- 4840: Fraudulent Processing of Transactions
- 4849: Questionable Merchant Activity
- 4863: Cardholder Does Not Recognize — Potential Fraud
- 4870: Chip Liability Shift
- 4871: Chip/PIN Liability Shift

AUTHORIZATION:
- 4808: Authorization-Related Chargeback
- 4812: Account Number Not On File
- 4847: Required Authorization Not Obtained

PROCESSING ERRORS:
- 4831: Transaction Amount Differs
- 4834: Point-of-Interaction Error
- 4835: Card Not Valid or Expired
- 4842: Late Presentment
- 4846: Correct Transaction Currency Code Not Provided

CONSUMER DISPUTES:
- 4841: Cancelled Recurring or Digital Goods Transaction
- 4850: Installment Billing Dispute
- 4853: Cardholder Dispute — Defective / Not as Described
- 4854: Cardholder Dispute — Not Elsewhere Classified
- 4855: Goods or Services Not Provided
- 4859: Services Not Rendered
- 4860: Credit Not Processed
- 4999: Domestic Chargeback Dispute (Region Use Only)`

  const networkCodes = network === 'visa' ? visaCodes : mastercardCodes

  const categoryMap = network === 'visa'
    ? '"fraud" | "authorization" | "processing_error" | "consumer_dispute"'
    : '"mc_fraud" | "mc_authorization" | "mc_processing_error" | "mc_consumer_dispute"'

  // ─── Analyse ─────────────────────────────────────────────────────────────────
  const analyze = async (overrideComplaint) => {
    const effectiveComplaint = overrideComplaint !== undefined ? overrideComplaint : complaint
    if (!effectiveComplaint.trim()) { setError('Customer complaint is required.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    setRebuttal(null)
    setComms(null)
    setLetterDraftModified(false)
    setChecked({})

    const prompt = `You are an experienced ${network === 'visa' ? 'Visa' : 'Mastercard'} dispute analyst. You write dispute summaries in a tight, operational voice: flowing prose, NO first-person pronouns (no "I"), warm but professional, concise. Real dispute summaries are typically 3-5 sentences, around 80-120 words. Avoid legal-brief language, avoid hedging, avoid repetition.

Analyze this customer complaint and generate a structured dispute analysis.

CUSTOMER COMPLAINT:
"""${effectiveComplaint}"""

TRANSACTION DETAILS:
- Merchant: ${merchant || 'Not provided'}
- Transaction Amount: ${amount ? `${amount} ${currency}` : 'Not provided'}${disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount ? `\n- Disputed Amount: ${disputedAmount} ${currency} (PARTIAL DISPUTE — cardholder is only disputing this portion of the transaction)` : ''}
- Transaction Date: ${transactionDate || 'Not provided'}
- Expected Delivery/Service Date: ${expectedDeliveryDate || 'Not provided'}
- Card Network: ${network === 'visa' ? 'Visa' : 'Mastercard'}
- Card Type: ${cardType === 'debit' ? 'Debit (Reg E / EFTA)' : 'Credit (Reg Z / FCBA)'}
- 3DS Status: ${threeDSStatus === 'not_attempted' ? 'Not attempted — supports fraud claim' : threeDSStatus === 'attempted_passed' ? 'Passed — liability may shift to issuer, review before filing' : threeDSStatus === 'attempted_failed' ? 'Attempted, authentication failed' : 'Unknown'}

${networkCodes}

FORMATTING RULES:
- For FRAUD codes: 2-3 sentences, ~50-70 words. State who, what, when, and that the cardholder did not authorize.
- For CONSUMER DISPUTE codes: 3-5 sentences, ~80-120 words. Facts, what the cardholder tried, what the cardholder is requesting.
- For PROCESSING ERROR codes: 2-4 sentences, ~60-90 words. State the error and the correct treatment.
- NEVER use first-person pronouns.
- Lead with facts. Save the ask for the final sentence.
${EXPLAIN_RULES}

Return ONLY a valid JSON object:
{
  "recommended_reason_code": "${network === 'visa' ? '13.5' : '4853'}",
  "reason_code_title": "Code title here",
  "category": ${categoryMap},
  "confidence": "high" | "medium" | "low",
  "rationale": "1-2 sentences explaining why this reason code fits best.",
  "dispute_summary": "Tight operational dispute summary.",
  "missing_information": ["list", "of", "info", "needed"],
  "goodwill_outreach_required": true | false,
  "goodwill_outreach_note": "Brief note if required, otherwise empty string.",
  "alternative_codes": [{"code": "4855", "title": "Goods Not Provided", "when_to_use": "One line"}],
  ${EXPLAIN_JSON}
}`

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const parsed = readAiJson(data)
      parsed._ai = aiRecord('desk_analysis', {
        data, answer: `${parsed.recommended_reason_code} — ${parsed.reason_code_title}`, confidence: parsed.confidence, summary: parsed.rationale,
        explanation: parsed.explanation && { ...parsed.explanation,
          alternatives_considered: parsed.explanation.alternatives_considered?.length ? parsed.explanation.alternatives_considered
            : (parsed.alternative_codes || []).map(a => ({ option: `${a.code} — ${a.title}`, why_not: a.when_to_use })) },
        inputs: { complaint: effectiveComplaint, merchant, amount: amount ? `${amount} ${currency}` : '', disputedAmount, transactionDate, expectedDeliveryDate,
          network: network === 'visa' ? 'Visa' : 'Mastercard', cardType, threeDSStatus },
      })
      setResult(parsed)
      // Save to outcome log with behavioral signals for DFA.
      // A case opened from Triage or the tracker keeps its COV- number, so the
      // same record travels Triage → Desk → Multi → File → DFA.
      const _reuseId = pendingCaseIdRef.current, _intake = pendingIntakeRef.current
      pendingCaseIdRef.current = null; pendingIntakeRef.current = null
      const _newCaseId = _reuseId || 'COV-' + Date.now().toString(36).toUpperCase().slice(-6)
      setCurrentDeskCaseId(_newCaseId)
      setOutcomes(prev => { const prior = prev.find(p => p.id === _newCaseId); return [{
        ...(prior || {}),
        id: _newCaseId,
        // A claim from the bank's app: the case's clocks start when the customer reported it
        date: prior?.date || _intake?.reportedAt || new Date().toISOString(),
        ...(_intake ? { intake: _intake } : {}),
        merchant: merchant || '—',
        amount: amount ? amount + ' ' + currency : '—',
        network: network === 'visa' ? 'VISA' : 'MC',
        reasonCode: parsed.recommended_reason_code,
        reasonTitle: parsed.reason_code_title,
        // Re-running a case that has already moved on (filed, won…) must not pull it back to the queue
        status: prior?.status && !['received','pending'].includes(prior.status) ? prior.status : 'queued',
        resolvedDate: prior?.resolvedDate || null,
        ai: { summary: parsed.dispute_summary || '', rationale: parsed.rationale || '', missing: parsed.missing_information || [], ts: new Date().toISOString() },
        aiDecisions: [...(prior?.aiDecisions || []), parsed._ai].slice(-20),
        threeDSStatus: threeDSStatus,
        confidence: parsed.confidence,
        category: parsed.category,
        avsMismatch: fiAvsMismatch === true ? true : fiAvsMismatch === false ? false : null,
        isVFMP: fiIsVFMP === true ? true : fiIsVFMP === false ? false : null,
        priorClaims: fiPriorClaims !== '' ? parseInt(fiPriorClaims) || 0 : null,
        _complaint: effectiveComplaint,
        _transactionDate: transactionDate,
        _cardType: cardType,
        _currency: currency,
      }, ...prev.filter(p => p.id !== _newCaseId)] })
    } catch (e) {
      setError(`Analysis failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ─── Rebuttal simulator ───────────────────────────────────────────────────
  const fetchRebuttal = async () => {
    if (!result) return
    setRebuttalLoading(true)
    setRebuttalError(null)
    setRebuttal(null)

    const prompt = `You are a chargeback representment expert who has reviewed thousands of merchant rebuttals. Given this dispute, predict exactly what the merchant will argue at representment — and how the issuer should counter it.

DISPUTE DETAILS:
- Network: ${network === 'visa' ? 'Visa' : 'Mastercard'}
- Reason Code: ${result.recommended_reason_code} — ${result.reason_code_title}
- Merchant: ${merchant || 'Unknown'}
- Amount: ${amount ? `${amount} ${currency}` : 'Unknown'}
- Dispute Summary: ${result.dispute_summary}

Be specific and realistic. Merchant arguments should reflect what this type of merchant actually argues for this reason code. Counter-strategy should be actionable for the issuing bank's dispute agent.

Return ONLY valid JSON:
{
  "merchant_arguments": [
    "Specific argument 1 the merchant will make",
    "Specific argument 2",
    "Specific argument 3"
  ],
  "merchant_evidence": [
    "Evidence item 1 merchant will likely submit",
    "Evidence item 2"
  ],
  "counter_strategy": [
    "Actionable counter point 1 for the issuer",
    "Actionable counter point 2"
  ],
  "win_risk": "LOW" | "MEDIUM" | "HIGH",
  "win_risk_note": "One sentence on how strong the merchant defense is likely to be and why."
}`

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      setRebuttal(readAiJson(data))
      noteDraft('rebuttal', data, currentDeskCaseId)
    } catch (e) {
      setRebuttalError(`Rebuttal preview failed: ${e.message}`)
    } finally {
      setRebuttalLoading(false)
    }
  }

  // ─── Customer communication ───────────────────────────────────────────────
  const fetchComms = async () => {
    if (!result) return
    setCommsLoading(true)
    setCommsError(null)
    setComms(null)
    setLetterDraftModified(false)

    const outcomeContext = (result.category === 'fraud' || result.category === 'mc_fraud')
      ? 'This is a confirmed fraud dispute. The cardholder did not authorize the transaction. The bank files through network rules — no merchant contact is involved.'
      : result.goodwill_outreach_required
      ? 'This is a consumer dispute where the cardholder must first attempt direct resolution with the merchant before the bank can file. The cardholder — not the bank or analyst — contacts the merchant directly (by email, phone, or chat). The bank cannot file until that outreach is documented.'
      : 'This is a consumer dispute being filed on behalf of the cardholder through Visa/Mastercard network rules. The bank does not contact the merchant directly — the chargeback is processed through the card network.'

    const prompt = `You are a customer communications specialist at an issuing bank. Write a professional, clear cardholder letter based on this dispute analysis.

DISPUTE DETAILS:
- Network: ${network === 'visa' ? 'Visa' : 'Mastercard'}
- Reason Code: ${result.recommended_reason_code} — ${result.reason_code_title}
- Merchant: ${merchant || 'Unknown'}
- Amount: ${amount ? `${amount} ${currency}` : 'Unknown'}
- Dispute Summary: ${result.dispute_summary}
- Context: ${outcomeContext}
- Goodwill outreach required: ${result.goodwill_outreach_required ? 'Yes — ' + result.goodwill_outreach_note : 'No'}
- Original complaint: "${complaint}"

SELECT THE CORRECT OUTCOME:
- FILING: dispute qualifies and the bank will file on the cardholder's behalf
- NOT_FILING: claim doesn't meet threshold or shows first-party indicators (e.g. pattern of prior disputes, transaction matches cardholder behaviour) — firm but professional, never accuse directly
- DECLINED_TXN: the transaction was already declined/reversed and there is no net loss to recover — explain this clearly so the customer understands
- INVESTIGATION: requires further information or review before a decision

CARD ACTION:
- CANCEL_RECOMMENDED: fraud confirmed or card may be compromised — advise cancellation and reissue
- MONITOR: suspicious activity but card status unclear
- NONE: no card action needed

WRITING RULES:
- Bank voice ("we" / "our")
- Empathetic for genuine fraud victims; firm but respectful if not filing
- Never accuse of fraud directly
- No legal jargon
- 3–4 short paragraphs in the body
- Do NOT include salutation or sign-off in the body field — those are injected separately
- Do NOT list specific documents or supporting materials in the body — document collection is handled separately. If outcome is INVESTIGATION, say only that we will be in touch regarding next steps.
- CRITICAL — WHO CONTACTS WHOM: The bank NEVER contacts the merchant directly. For fraud disputes, the chargeback is filed through the Visa/Mastercard network. For consumer disputes requiring merchant contact, the CARDHOLDER must reach out to the merchant themselves — if a next step references merchant contact, it must say "Contact [merchant] directly" addressed to the cardholder, never "We will contact the merchant on your behalf."

Return ONLY valid JSON:
{
  "outcome": "FILING" | "NOT_FILING" | "DECLINED_TXN" | "INVESTIGATION",
  "card_action": "CANCEL_RECOMMENDED" | "MONITOR" | "NONE",
  "subject": "Re: Your [brief description] — [merchant]",
  "body": "Letter body only. Separate paragraphs with \\n\\n.",
  "next_steps": ["Step 1", "Step 2", "Step 3"],
  "timeline": "e.g. 5–10 business days from the date of this letter"
}`

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const parsed = readAiJson(data)
      setComms(parsed)
      noteDraft('comms', data, currentDeskCaseId)
      // Don't overwrite if agent has edited the draft — preserve their work
      if (!letterDraftModified) setEditableLetterBody(parsed.body || '')
      // Pre-populate editable docs from current evidence
      try {
        const ev = getEvidencePackage(result?.recommended_reason_code, result?.category)
        const docLines = (ev?.cardholder || []).map(d => `→ ${d.text}${d.impact === 'required' ? ' (required)' : ''}`).join('\n')
        const clarifyLines = (result?.missing_information || []).map(m => `→ ${m}`).join('\n')
        setEditableDocsSection([docLines, clarifyLines].filter(Boolean).join('\n'))
      } catch {}
      setEditableNextSteps((parsed.next_steps || []).join('\n'))
    } catch (e) {
      setCommsError(`Communication draft failed: ${e.message}`)
    } finally {
      setCommsLoading(false)
    }
  }

  // ─── Copy summary ─────────────────────────────────────────────────────────
  const copySummary = () => {
    if (!result?.dispute_summary) return
    const formatted = `DISPUTE REASON CODE: ${result.recommended_reason_code} — ${result.reason_code_title}\n\n${result.dispute_summary}`
    navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const commsOutcomeMap = {
    FILING:        { bg: 'bg-emerald-900', text: 'text-emerald-50', label: 'FILING DISPUTE'      },
    NOT_FILING:    { bg: 'bg-red-900',     text: 'text-red-50',     label: 'NOT FILING'          },
    DECLINED_TXN:  { bg: 'bg-stone-700',   text: 'text-stone-50',   label: 'TXN DECLINED'        },
    INVESTIGATION: { bg: 'bg-amber-800',   text: 'text-amber-50',   label: 'UNDER INVESTIGATION' },
  }
  const commsOc = comms ? (commsOutcomeMap[comms.outcome] || commsOutcomeMap.INVESTIGATION) : null
  const copyCommsLetter = () => {
    if (!comms) return
    const docsBlock = editableDocsSection ? `\n\nWHAT WE'LL NEED FROM YOU:\n${editableDocsSection}` : ''
    const stepsBlock = editableNextSteps ? `\n\nNext Steps:\n${editableNextSteps.split('\n').map(s => `• ${s}`).join('\n')}` : ''
    const full = `Subject: ${comms.subject}\n\nDear Valued Cardholder,\n\n${editableLetterBody || comms.body}${docsBlock}${stepsBlock}\n\nExpected timeline: ${comms.timeline}\n\nSincerely,\nCustomer Care Team`
    navigator.clipboard.writeText(full)
    setCommsCopied(true)
    setTimeout(() => setCommsCopied(false), 2000)
  }

  // ── Copy cardholder doc list (plain — paste into any channel) ──────────────
  const copyDocRequest = () => {
    if (!result || !evidence) return
    const rcCode = result.recommended_reason_code || ''
    const rcTitle = result.reason_code_title || result.recommended_reason_code || ''
    const requiredItems = evidence.cardholder.filter(i => i.impact === 'required')
    const supportingItems = evidence.cardholder.filter(i => i.impact !== 'required')
    const docLines = []
    if (requiredItems.length > 0) {
      docLines.push('REQUIRED:')
      requiredItems.forEach((item, i) => docLines.push(`  ${i + 1}. ${item.text}`))
    }
    if (supportingItems.length > 0) {
      docLines.push('')
      docLines.push('SUPPORTING (strengthens your case):')
      supportingItems.forEach((item, i) => docLines.push(`  ${i + 1}. ${item.text}`))
    }
    const clarifyLines = result.missing_information?.length > 0
      ? ['', 'PLEASE ALSO CLARIFY:', ...result.missing_information.map(m => `  - ${m}`)]
      : []
    const email = [
      `Subject: Action Required — Dispute Investigation (${rcCode ? rcCode + ' · ' : ''}${merchant || 'Transaction'})`,
      '',
      'Dear Valued Cardholder,',
      '',
      `Thank you for contacting us regarding your dispute${merchant ? ` involving ${merchant}` : ''}${amount ? ` for ${amount} ${currency || ''}`.trim() : ''}. We are actively investigating this matter under ${rcTitle ? `dispute reason ${rcTitle}` : 'our dispute procedures'}.`,
      '',
      'To complete our investigation and advocate on your behalf, we require the following documentation. Please submit these materials within 10 business days:',
      '',
      ...docLines,
      ...clarifyLines,
      '',
      'You may submit these documents by replying to this message, emailing [disputes@yourinstitution.com], or visiting your nearest branch.',
      '',
      'If you have already submitted these materials, please disregard this notice. For questions, call the number on the back of your card.',
      '',
      'Sincerely,',
      'Dispute Resolution Team',
      '[Institution Name]',
    ].join('\n')
    navigator.clipboard.writeText(email)
    setDocRequestCopied(true)
    setTimeout(() => setDocRequestCopied(false), 2000)
  }

  // ── Goodwill copy helper ───────────────────────────────────────────────────
  const copyGoodwillScript = () => {
    if (!goodwillRec) return
    navigator.clipboard.writeText(goodwillRec.script)
    setGoodwillCopied(true)
    setTimeout(() => setGoodwillCopied(false), 2000)
  }

  // ── Provisional credit helpers ─────────────────────────────────────────────
  const addBusinessDays = (dateStr, bd) => {
    const d = new Date(dateStr)
    let added = 0
    const out = new Date(d)
    while (added < bd) {
      out.setDate(out.getDate() + 1)
      const dow = out.getDay()
      if (dow !== 0 && dow !== 6) added++
    }
    return out
  }
  const markProvCredit = (id) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, provCreditDate: new Date().toISOString() } : o))

  // ── Pre-arb response drafter ──────────────────────────────────────────────
  const generatePreArbDraft = async (outcome) => {
    setPreArbLoading(true); setPreArbError(null); setPreArbDraft(null); setPreArbTargetId(outcome.id)
    const repNotes = merchantRepNotes[outcome.id] || ''
    const prompt = `You are a senior disputes analyst at a financial institution. Generate a formal pre-arbitration rebuttal.

CASE:
- ID: ${outcome.id}  - Merchant: ${outcome.merchant || 'N/A'}  - Amount: ${outcome.amount || 'N/A'}
- Network: ${(outcome.network || '').toUpperCase()}  - Reason Code: ${outcome.reasonCode || 'N/A'}
- Reason: ${outcome.reasonTitle || 'N/A'}  - Stage: ${outcome.status}

MERCHANT REPRESENTMENT:
${repNotes || 'No notes provided.'}

Return ONLY valid JSON:
{
  "summary": "2-sentence summary of issuer pre-arb position",
  "rebuttal_points": ["Point addressing each merchant argument with evidence/rule cite", "..."],
  "evidence_to_attach": ["Specific document to attach", "..."],
  "formal_statement": "200-300 word formal pre-arb statement for network submission",
  "filing_deadline_note": "Deadline and urgency note",
  "win_assessment": "STRONG" | "MODERATE" | "WEAK",
  "win_note": "1-2 sentences on success likelihood"
}`
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      setPreArbDraft(readAiJson(data))
      noteDraft('pre_arb', data, outcome.id)
    } catch (e) { setPreArbError('Pre-arb draft failed: ' + e.message) }
    finally { setPreArbLoading(false) }
  }

  // ── Merchant dispute analyser ─────────────────────────────────────────────
  const analyzeMerchant = async () => {
    if (!complaint.trim()) { setMchError('Paste the chargeback notification or describe the dispute.'); return }
    setMchLoading(true); setMchError(null); setMchResult(null); setMchRepLetter(null)
    const tds = mchThreeDS === 'passed' ? 'Passed — liability shifts to issuer' : mchThreeDS === 'failed' ? 'Failed' : mchThreeDS === 'not_attempted' ? 'Not attempted' : 'Unknown'
    const prompt = 'You are an expert chargeback representment specialist advising a merchant. Analyze this chargeback and build the best defence strategy.\n\n'
      + 'CHARGEBACK DETAILS:\n- Reason Code: ' + (mchReasonCode || 'Not specified')
      + '\n- Network: ' + (network === 'visa' ? 'Visa' : 'Mastercard')
      + '\n- Amount: ' + (amount ? amount + ' ' + currency : 'Not specified')
      + '\n- Merchant: ' + (merchant || 'Not specified')
      + '\n- Order Date: ' + (mchOrderDate || 'Not specified')
      + '\n- Order ID: ' + (mchOrderId || 'Not specified')
      + '\n- Customer: ' + (mchCustomerEmail || 'Not specified')
      + '\n- Delivery Confirmed: ' + mchDeliveryConfirmed
      + '\n- 3DS: ' + tds
      + '\n- Refund Policy Shown at Checkout: ' + mchRefundPolicyShown
      + '\n- Prior Orders Same Customer: ' + (mchPriorOrders || 'Unknown')
      + '\n- IP/Location Notes: ' + (mchIpLogs || 'None')
      + '\n\nCHARGEBACK NOTIFICATION:\n"""' + complaint + '"""\n'
      + EXPLAIN_RULES + '\n\n'
      + 'Return ONLY valid JSON:\n{\n'
      + '  "win_probability": "HIGH" | "MEDIUM" | "LOW",\n'
      + '  "win_note": "2-sentence win/loss likelihood",\n'
      + '  "rebuttal_strategy": "3-4 sentence representment strategy",\n'
      + '  "key_arguments": ["Argument 1", "Argument 2", "Argument 3"],\n'
      + '  "evidence_to_submit": [{"item": "Document", "priority": "required" | "strengthens", "note": "Why"}],\n'
      + '  "weaknesses": ["Weakness 1"],\n'
      + '  "deadline_note": "Representment deadline guidance",\n'
      + '  "liability_shift": true | false,\n'
      + '  "liability_shift_note": "One sentence or empty string",\n'
      + '  ' + EXPLAIN_JSON + '\n}'
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      const parsed = readAiJson(data)
      parsed._ai = aiRecord('merchant', {
        data, answer: `${parsed.win_probability} chance to win`, confidence: parsed.win_probability, summary: parsed.win_note, explanation: parsed.explanation,
        inputs: { chargeback: complaint, reasonCode: mchReasonCode, network: network === 'visa' ? 'Visa' : 'Mastercard', amount: amount ? amount + ' ' + currency : '',
          merchant, orderId: mchOrderId, deliveryConfirmed: mchDeliveryConfirmed, threeDS: tds, refundPolicyShown: mchRefundPolicyShown, priorOrders: mchPriorOrders, ipNotes: mchIpLogs },
      })
      setMchResult(parsed)
      const mchCode = (mchReasonCode || '').split(/[\s–—]/)[0].trim()
      setOutcomes(prev => [{
        id: 'MCH-' + Date.now().toString(36).toUpperCase().slice(-5),
        date: new Date().toISOString(),
        merchant: merchant || '—',
        amount: amount ? amount + ' ' + currency : '—',
        network: network === 'visa' ? 'VISA' : 'MC',
        reasonCode: mchReasonCode || '—',
        reasonTitle: REASON_TITLES[mchCode] || (mchCode ? 'Chargeback — ' + mchCode : 'Merchant chargeback'),
        status: 'received',
        resolvedDate: null,
        mode: 'merchant', side: 'merchant',
        threeDSStatus: mchThreeDS,
        deliveryConfirmed: mchDeliveryConfirmed,
        refundPolicyShown: mchRefundPolicyShown,
        priorOrders: mchPriorOrders,
        liabilityShift: parsed.liability_shift || false,
        winProb: parsed.win_probability,
        aiDecisions: [parsed._ai],
      }, ...prev])
    } catch (e) { setMchError('Analysis failed: ' + e.message) }
    finally { setMchLoading(false) }
  }

  const generateRepLetter = async () => {
    if (!mchResult) return
    setMchRepLetterLoading(true); setMchRepLetterError(null); setMchRepLetter(null)
    const prompt = 'You are a professional chargeback representment writer. Draft a formal representment letter for a merchant to submit to their acquirer.\n\n'
      + 'CASE:\n- Reason Code: ' + (mchReasonCode || 'N/A') + ' (' + (network === 'visa' ? 'Visa' : 'Mastercard') + ')'
      + '\n- Amount: ' + (amount ? amount + ' ' + currency : 'N/A')
      + '\n- Merchant: ' + (merchant || 'N/A')
      + '\n- Order ID: ' + (mchOrderId || 'N/A')
      + '\n- Order Date: ' + (mchOrderDate || 'N/A')
      + '\n- Delivery Confirmed: ' + mchDeliveryConfirmed
      + '\n- 3DS: ' + mchThreeDS
      + '\n- Strategy: ' + (mchResult.rebuttal_strategy || '')
      + '\n- Key Arguments: ' + (mchResult.key_arguments || []).join('; ')
      + '\n\nWrite a professional representment letter (300-450 words) from the merchant to their acquirer. '
      + 'Opening: state purpose and chargeback reference. Body: make the case, cite evidence. Closing: state the request and contact. '
      + 'Merchant speaks as "we". Return ONLY the letter text, no JSON or metadata.'
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      setMchRepLetter(data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim())
      noteDraft('rep_letter', data)
    } catch (e) { setMchRepLetterError('Letter failed: ' + e.message) }
    finally { setMchRepLetterLoading(false) }
  }

  // ── Pre-Arb response letter (merchant mode) ──────────────────────────────
  const generatePreArbLetter = async () => {
    setMchPreArbLoading(true); setMchPreArbError(null); setMchPreArbLetter(null)
    const prompt = 'You are a chargeback representment expert. The merchant won the initial representment but the issuer has escalated to Pre-Arbitration (second chargeback). Draft a formal Pre-Arbitration response letter from the merchant to their acquirer.\n\n'
      + 'CASE DETAILS:\n'
      + 'Merchant: ' + (merchant || 'N/A') + '\n'
      + 'Network: ' + (network || 'Visa') + '\n'
      + 'Reason Code: ' + (mchReasonCode || 'N/A') + '\n'
      + 'Amount: ' + (amount || 'N/A') + ' ' + (currency || 'CAD') + '\n'
      + 'Order ID: ' + (mchOrderId || 'N/A') + '\n'
      + 'Original Claim: ' + (complaint || 'N/A') + '\n'
      + (mchResult ? 'Original Defence: ' + mchResult.rebuttal_strategy + '\n' : '')
      + '\nDraft a firm Pre-Arbitration response (250-350 words) arguing why the issuer\'s escalation is unfounded. Cite the original representment evidence. Merchant speaks as "we". Return ONLY the letter text.'
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }) })
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      setMchPreArbLetter(data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim())
      noteDraft('mch_pre_arb', data)
    } catch (e) { setMchPreArbError('Pre-Arb letter failed: ' + e.message) }
    finally { setMchPreArbLoading(false) }
  }

  // Acquirer submission cover email
  const mchAcqSubmissionEmail = () => {
    const net = (network || 'Visa').charAt(0).toUpperCase() + (network || 'visa').slice(1)
    const code = mchReasonCode || '[REASON CODE]'
    const ref = mchTrackingRef || '[ACQUIRER REF]'
    const dl = mchRepDeadline ? new Date(mchRepDeadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '[DEADLINE]'
    return `Subject: Chargeback Representment — ${net} ${code} — ${merchant || '[MERCHANT]'} — Ref ${ref}

Dear ${mchAcquirer || '[Acquirer Name]'} Dispute Team,

Please find attached our representment package for the following chargeback:

  Merchant:     ${merchant || '[Merchant Name]'}
  Network:      ${net}
  Reason Code:  ${code}
  Amount:       ${amount || '[AMOUNT]'} ${currency || 'CAD'}
  Order ID:     ${mchOrderId || '[ORDER ID]'}
  Acquirer Ref: ${ref}
  Your Deadline: ${dl}

Included in this package:
  • Representment rebuttal letter
  • Transaction authorization record and AVS/CVV response
  • ${mchDeliveryConfirmed === 'yes' ? 'Confirmed delivery documentation' : 'Customer communication logs'}
  • ${mchThreeDS === 'passed' ? '3DS authentication confirmation (liability shift applies)' : 'IP address and device fingerprint logs'}
  • Terms and conditions accepted at checkout

Please confirm receipt and log under the reference above. We are available to provide supplementary materials if required.

Yours faithfully,
${merchant || '[Merchant Name]'} — Disputes Team`
  }



  // ── Outcome tracker helpers ────────────────────────────────────────────────
  const markCaseOutcome = (id, status) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, status, resolvedDate: new Date().toISOString() } : o))

  const revertCase = (id) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, status: 'pending', resolvedDate: null } : o))

  const startEdit = (o) => { // pre-populate draft from outcome row
    setEditingRow(o.id)
    setEditDraft({ merchant: o.merchant, amount: o.amount, reasonCode: o.reasonCode, reasonTitle: o.reasonTitle, notes: notesText(o.notes), submitDate: o.submitDate || '', trackingRef: o.trackingRef || '', nextRespDate: o.nextRespDate || '' })
  }
  const cancelEdit = () => { setEditingRow(null); setEditDraft({}) }
  const saveEdit = (id) => {
    // Notes stay a list: untouched text keeps the existing entries, rewritten text becomes one new entry
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, ...editDraft,
      notes: (editDraft.notes || '') === notesText(o.notes) ? o.notes
        : (editDraft.notes || '').trim() ? [{ text: editDraft.notes.trim(), ts: new Date().toISOString(), author: covUser?.name || 'Agent' }] : [] } : o))
    setEditingRow(null)
    setEditDraft({})
  }
  const deleteCase = (id) => {
    if (window.confirm('Remove this case from the tracker?')) {
      setOutcomes(prev => prev.filter(o => o.id !== id))
      if (editingRow === id) { setEditingRow(null); setEditDraft({}) }
    }
  }

  const exportCSV = () => {
    const sixtyDaysAgo = new Date(Date.now() - (settings.trackerWindowDays || 60) * 24 * 60 * 60 * 1000)
    const isMerchant = platformMode === 'merchant'
    const rows = outcomes.filter(o => new Date(o.date) > sixtyDaysAgo && (isMerchant ? isMerchantCase(o) : !isMerchantCase(o)))
    // Export DFA-compatible schema so this CSV can be uploaded directly to DisputeFundingAssessor
    const headers = ['id','code','amount','filed_days_ago','window_days','avs_mismatch','no_3ds','delivery_confirmed','merchant_acknowledged','pin_verified','vfmp_enrolled','strong_docs','merchant_cbr','prior_claims','note','status','resolved_date']
    const csv = [
      headers.join(','),
      ...rows.map(o => {
        const filedDaysAgo = o.date ? Math.round((Date.now() - new Date(o.date).getTime()) / 86400000) : ''
        const no3ds = o.threeDSStatus === 'none' ? 'yes' : o.threeDSStatus ? 'no' : ''
        const strongDocs = o.confidence === 'HIGH' ? 'yes' : o.confidence === 'LOW' ? 'no' : (o.refundPolicyShown ? 'yes' : '')
        const deliveryConf = o.deliveryConfirmed ? 'yes' : isMerchant ? 'no' : ''
        const priorClaims = o.priorOrders || '0'
        const note = isMerchant
          ? ('"' + (o.merchant || '') + (o.winProb ? ' — AI: ' + o.winProb : '') + '"')
          : ('"' + (o.merchant || '') + (o.category ? ' — ' + o.category : '') + '"')
        const amt = (o.amount || '').replace(/[^0-9.]/g, '')
        return [o.id, o.reasonCode || '', amt, filedDaysAgo, 120, '', no3ds, deliveryConf, '', '', '', strongDocs, '', priorClaims, note, o.status, o.resolvedDate ? new Date(o.resolvedDate).toLocaleDateString('en-CA') : ''].join(',')
      })
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (isMerchant ? 'dd-merchant-' : 'dd-fi-') + new Date().toISOString().split('T')[0] + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Load case status from localStorage when result arrives ───────────────
  useEffect(() => {
    if (!result) { setCaseStatusStageRaw(null); setCaseStatusHistory({}); setCaseStatusKey(null); return }
    const key = [merchant || 'unknown', transactionDate || 'nodate', amount || '0', network].join('|').replace(/\s+/g, '_')
    setCaseStatusKey(key)
    try {
      const savedStage = localStorage.getItem('desk_cs_stage_' + key)
      const savedHist  = JSON.parse(localStorage.getItem('desk_cs_hist_' + key) || '{}')
      const initStage  = savedStage || 'filed'
      const initHist   = savedHist?.filed ? savedHist : { filed: new Date().toISOString() }
      setCaseStatusStageRaw(initStage)
      setCaseStatusHistory(initHist)
      if (!savedStage) {
        try { localStorage.setItem('desk_cs_stage_' + key, initStage) } catch {}
        try { localStorage.setItem('desk_cs_hist_' + key, JSON.stringify(initHist)) } catch {}
      }
    } catch {
      setCaseStatusStageRaw('filed')
      setCaseStatusHistory({ filed: new Date().toISOString() })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // ── FI SAR deadline (30 days from detection date, FinCEN / FINTRAC) ────────
  const fiSarDeadlineRaw = sarDiscoveryDate
    ? new Date(new Date(sarDiscoveryDate).getTime() + 30 * 86400000)
    : null
  const fiSarDeadline  = fiSarDeadlineRaw ? fiSarDeadlineRaw.toLocaleDateString('en-CA') : null
  const fiSarDaysLeft  = fiSarDeadlineRaw ? Math.ceil((fiSarDeadlineRaw - new Date()) / 86400000) : null

  // ── Reg E provisional credit deadline (10 BD from when dispute is received) ──
  // Used when cardType === 'debit' and an analysis has been run
  // Reg E deadlines run from date dispute received (transactionDate as proxy if not separately captured)
  const regEBaseDate = transactionDate || new Date().toISOString()
  const regEPcDue = (cardType === 'debit' && result)
    ? addBusinessDays(regEBaseDate, 10).toLocaleDateString('en-CA')
    : null
  const regEInvDue = (cardType === 'debit' && result)
    ? addBusinessDays(regEBaseDate, 45).toLocaleDateString('en-CA')
    : null

  // ── Chargeback cycle deadline computation ────────────────────────────────
  const cbDeadlines = React.useMemo(() => {
    if (!cbFiledDate) return null
    const filed   = new Date(cbFiledDate)
    const addDays = (d, n) => new Date(d.getTime() + n * 86400000)
    const fmt     = d => d.toLocaleDateString('en-CA')
    const today   = new Date()
    const dLeft   = d => Math.ceil((d - today) / 86400000)
    const chip = (label, date, days, note) => ({ label, date, days, note })
    if (network === 'visa') {
      if (cbCycleStage === '1cb')    { const d = addDays(filed, 30); return [chip('Merchant Representment Deadline', fmt(d), dLeft(d), 'Visa: merchant has 30 calendar days to respond to your chargeback')] }
      if (cbCycleStage === '2cb')    { const d = addDays(filed, 30); return [chip('Pre-Arbitration Filing Deadline', fmt(d), dLeft(d), 'Visa: 30 calendar days from merchant representment to file Pre-Arb')] }
      if (cbCycleStage === 'prearb') { const d = addDays(filed, 30); return [chip('Arbitration Filing Deadline', fmt(d), dLeft(d), 'Visa: 30 calendar days from Pre-Arb filing to escalate to arbitration')] }
    } else if (network === 'mastercard') {
      if (cbCycleStage === '1cb')    { const d = addDays(filed, 45); return [chip('Merchant Response Deadline', fmt(d), dLeft(d), 'MC: merchant has 45 calendar days to respond to first chargeback')] }
      if (cbCycleStage === '2cb')    { const d = addDays(filed, 30); return [chip('Pre-Arbitration Filing Deadline', fmt(d), dLeft(d), 'MC: 30 calendar days from second presentment to file Pre-Arb')] }
      if (cbCycleStage === 'prearb') { const d = addDays(filed, 30); return [chip('Arbitration Filing Deadline', fmt(d), dLeft(d), 'MC: 30 calendar days from Pre-Arb to file for arbitration')] }
    }
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cbFiledDate, cbCycleStage, network])

  // ── Net recovery estimate ────────────────────────────────────────────────
  const fightCalc = React.useMemo(() => {
    const _partial = disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount
    const amt = parseFloat(_partial ? disputedAmount : amount) || 0
    if (!amt || !result) return null
    // Base win rate by dispute category (chargeback outcome data for issuers)
    const cat = result.category || ''
    let winProb = (cat === 'fraud' || cat === 'mc_fraud') ? 0.76
                : (cat === 'processing_error' || cat === 'mc_processing_error') ? 0.74
                : (cat === 'authorization' || cat === 'mc_authorization') ? 0.70
                : 0.52  // consumer_dispute — more contested
    // Adjust for AI confidence in reason code selection
    if (result.confidence === 'low')    winProb -= 0.12
    if (result.confidence === 'medium') winProb -= 0.04
    // Adjust for 3DS status (3DS pass = liability shift away from issuer)
    if (threeDSStatus === 'attempted_passed') winProb = Math.max(0.08, winProb - 0.22)
    if (threeDSStatus === 'not_attempted')    winProb = Math.min(0.92, winProb + 0.05)
    // Adjust for merchant defense strength (from rebuttal simulator)
    if (rebuttal?.win_risk === 'LOW')    winProb = Math.min(0.92, winProb + 0.10)
    if (rebuttal?.win_risk === 'MEDIUM') winProb = Math.max(0.20, winProb - 0.10)
    if (rebuttal?.win_risk === 'HIGH')   winProb = Math.max(0.10, winProb - 0.24)
    winProb = Math.max(0.08, Math.min(0.93, winProb))
    const netFee       = 25  // network filing fee estimate
    const expectedRec  = amt * winProb
    const writeOffRisk = amt * (1 - winProb)
    const netValue     = expectedRec - netFee
    return { winProb: Math.round(winProb * 100), expectedRec, netFee, writeOffRisk, netValue, recommendation: netValue > 0 ? 'FIGHT' : 'ACCEPT' }
  }, [amount, disputedAmount, result, rebuttal])

  const isFraud     = result?.category === 'fraud' || result?.category === 'mc_fraud'
  let filingWindow  = null
  try { filingWindow = filingWindowStatus(isFraud) } catch(e) { console.error('[DD] filingWindow crash:', e) }
  let evidence      = null
  try { evidence = result ? getEvidencePackage(result?.recommended_reason_code, result?.category) : null } catch(e) { console.error('[DD] evidence crash:', e) }

  // effectiveAmount: use disputed amount if provided (partial dispute), otherwise use full transaction amount
  const isPartialDispute   = disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount
  const effectiveAmount    = isPartialDispute ? disputedAmount : amount
  const effectiveAmtNum    = parseFloat(effectiveAmount) || 0
  const smallDollar        = effectiveAmtNum > 0 && effectiveAmtNum < settings.smallDollarThreshold

  // Goodwill recommendation — only set when goodwill is actually the recommended path
  let goodwillRec = null
  try {
    if (result) {
      const amtStr      = effectiveAmount ? `${effectiveAmount} ${currency}` : 'the disputed amount'
      const merchantStr = merchant || 'the merchant'
      const partialNote = isPartialDispute ? ` (partial dispute — cardholder is disputing ${disputedAmount} ${currency} of a ${amount} ${currency} transaction)` : ''
      if (smallDollar) {
        goodwillRec = {
          recommended: true, type: 'WRITE-OFF RECOMMENDED',
          fraudNote: (result?.category === 'fraud' || result?.category === 'mc_fraud') ? '⚠ Fraud reporting obligation: regardless of write-off decision, review for SAR/STR filing if this transaction meets your institution\'s reporting threshold.' : null,
          typeColor: 'bg-amber-800 text-amber-50',
          rationale: `At ${amtStr}${partialNote}, investigation and network fees may exceed recovery (write-off threshold: $${settings.smallDollarThreshold}). A direct courtesy credit is the most efficient resolution.`,
          script: `Hi [Cardholder name],\n\nI've reviewed your dispute regarding ${merchantStr} for ${amtStr}. Given the amount, I'd like to resolve this right away by applying a one-time courtesy credit of ${amtStr} to your account — no formal chargeback required. This will appear within 3-5 business days.\n\nI'm applying a courtesy credit of {amtStr} to your account now — you'll see it reflected within 3–5 business days.`,
        }
      } else if (result.goodwill_outreach_required) {
        goodwillRec = {
          recommended: true, type: 'GOODWILL RECOMMENDED',
          typeColor: 'bg-amber-700 text-amber-50',
          rationale: result.goodwill_outreach_note || 'Case may not meet all dispute criteria. A goodwill credit protects the customer relationship.',
          script: `Hi [Cardholder name],\n\nThank you for your patience as we reviewed your dispute for ${amtStr} at ${merchantStr}${partialNote ? partialNote : ''}. While this case presents some challenges for a formal dispute, we value your relationship and want to make this right. I'd like to offer a one-time courtesy credit of ${amtStr} as a gesture of goodwill — it will appear within 3-5 business days.\n\nI'm applying a one-time courtesy credit of {amtStr} to your account — it will appear within 3–5 business days.`,
        }
      } else {
        // Clear dispute path — goodwill is NOT recommended. No script needed.
        goodwillRec = {
          recommended: false, type: 'NOT RECOMMENDED',
          typeColor: 'bg-stone-700 text-stone-50',
          rationale: 'A clear chargeback path exists for this case. A courtesy credit would under-recover for the cardholder and is unnecessary — proceed with formal dispute filing using Steps 01–04.',
        }
      }
    }
  } catch(e) { console.error('[DD] goodwillRec crash:', e) }

  // Outcome tracker: 60-day window only
  // Lifecycle stages: pending → filed → representment → pre_arb → won | lost | withdrawn
  const LIFECYCLE_IN_PROGRESS = new Set(['queued', 'filed', 'investigating', 'representment', 'pre_arb', 'received', 'rebuttal_prep', 'submitted'])
  const sixtyDaysAgo = new Date(Date.now() - (settings.trackerWindowDays || 60) * 24 * 60 * 60 * 1000)
  const visibleOutcomes = outcomes.filter(o => new Date(o.date) > sixtyDaysAgo)
  const trackerOutcomes = platformMode === 'merchant'
    ? visibleOutcomes.filter(o => isMerchantCase(o))
    : visibleOutcomes.filter(o => !isMerchantCase(o) && o.kind !== 'aml')   // AML cases live in Licit
  const wonCount        = trackerOutcomes.filter(o => o.status === 'won').length
  const lostCount       = trackerOutcomes.filter(o => o.status === 'lost').length
  const withdrawnCount  = trackerOutcomes.filter(o => o.status === 'withdrawn').length
  const inProgressCount = trackerOutcomes.filter(o => LIFECYCLE_IN_PROGRESS.has(o.status)).length
  const resolvedStatusCount = trackerOutcomes.filter(o => o.status === 'resolved').length
  const resolvedCount   = wonCount + lostCount + withdrawnCount + resolvedStatusCount
  const winRate         = resolvedCount > 0 ? Math.round((wonCount / resolvedCount) * 100) : null

  // Advance a case to the next lifecycle stage
  const advanceStage = (id, newStatus) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o))

  // Escalation paths (post-resolution)
  const escalateCase = (id, escalation) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, escalation } : o))

  // PC issued toggle
  const markPcIssued = (id) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, pcIssued: !o.pcIssued } : o))

  // Analytics — derived from visibleOutcomes
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [trackerSearch, setTrackerSearch] = useState('')
  const analytics = React.useMemo(() => {
    const resolved = trackerOutcomes.filter(o => o.status === 'won' || o.status === 'lost')
    // by network
    const byNetwork = {}
    resolved.forEach(o => {
      const net = o.network || '—'
      if (!byNetwork[net]) byNetwork[net] = { won: 0, total: 0 }
      byNetwork[net].total++
      if (o.status === 'won') byNetwork[net].won++
    })
    // by reason code (top 6)
    const byCode = {}
    resolved.forEach(o => {
      const code = (o.reasonCode || '—').split(/[\s–—]/)[0].trim()
      if (!byCode[code]) byCode[code] = { won: 0, total: 0 }
      byCode[code].total++
      if (o.status === 'won') byCode[code].won++
    })
    const topCodes = Object.entries(byCode).sort((a, b) => b[1].total - a[1].total).slice(0, 6)
    // weekly trend (last 8 weeks)
    const weeks = []
    for (let w = 7; w >= 0; w--) {
      const from = new Date(Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000)
      const to   = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000)
      const wk   = trackerOutcomes.filter(o => { const d = new Date(o.date); return d >= from && d < to })
      const wWon = wk.filter(o => o.status === 'won').length
      const wRes = wk.filter(o => o.status === 'won' || o.status === 'lost').length
      weeks.push({ label: `W${8 - w}`, total: wk.length, won: wWon, resolved: wRes, rate: wRes > 0 ? Math.round(wWon / wRes * 100) : null })
    }
    // avg resolution time
    const times = trackerOutcomes.filter(o => o.resolvedDate && o.date).map(o => Math.round((new Date(o.resolvedDate) - new Date(o.date)) / (1000 * 60 * 60 * 24)))
    const avgDays = times.length > 0 ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null
    return { byNetwork, topCodes, weeks, avgDays, resolvedCount: resolved.length }
  }, [outcomes, platformMode])

  const filteredTrackerOutcomes = React.useMemo(() => {
    let list = trackerOutcomes
    if (trackerFilter === 'queued')      list = list.filter(o => o.status === 'queued')
    else if (trackerFilter === 'in_progress') list = list.filter(o => LIFECYCLE_IN_PROGRESS.has(o.status))
    else if (trackerFilter === 'won')  list = list.filter(o => o.status === 'won')
    else if (trackerFilter === 'lost') list = list.filter(o => o.status === 'lost')
    else if (trackerFilter === 'fundable') list = list.filter(o => {
      if (isMerchantCase(o)) return false
      const dfaG = estimateFundingGrade(o.reasonCode, o.amount, { threeDSStatus: o.threeDSStatus, deliveryConfirmed: o.deliveryConfirmed, liabilityShift: o.liabilityShift, refundPolicyShown: o.refundPolicyShown, priorOrders: o.priorOrders, winProb: o.winProb, confidence: o.confidence })
      return dfaG && (dfaG.label === 'A' || dfaG.label === 'B')
    })
    if (trackerSearch.trim()) {
      const q = trackerSearch.toLowerCase()
      list = list.filter(o =>
        (o.id || '').toLowerCase().includes(q) ||
        (o.merchant || '').toLowerCase().includes(q) ||
        (o.reasonCode || '').toLowerCase().includes(q) ||
        notesText(o.notes).toLowerCase().includes(q)
      )
    }
    return list
  }, [trackerOutcomes, trackerFilter, trackerSearch])

  const impactStyle = (impact) => {
    if (impact === 'required')    return 'text-stone-900'
    if (impact === 'strengthens') return 'text-emerald-800'
    if (impact === 'weakens')     return 'text-red-800'
    return 'text-stone-700'
  }

  const impactLabel = (impact) => {
    if (impact === 'required')    return '— required'
    if (impact === 'strengthens') return '— strengthens case'
    if (impact === 'weakens')     return '— weakens case if present'
    if (impact === 'context')     return '— context only'
    return ''
  }

  const winRiskColor = (risk) => {
    if (risk === 'LOW')    return { bg: 'bg-emerald-900', text: 'text-emerald-50' }
    if (risk === 'MEDIUM') return { bg: 'bg-amber-800',   text: 'text-amber-50'   }
    if (risk === 'HIGH')   return { bg: 'bg-red-900',     text: 'text-red-50'     }
    return { bg: 'bg-stone-700', text: 'text-stone-50' }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={deskRootRef} className="max-w-6xl mx-auto px-4 py-8 sm:px-6 sm:py-12">

        {/* Jump between Desk's sections (built from the headings on screen) */}
        <SectionNav rootRef={deskRootRef} label="Dispute Desk sections" />

        {/* ── Masthead ── */}
        <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div className="mono-font text-xs tracking-widest text-stone-600">ISSUE Nº 002 — THE DISPUTE DESK</div>
            <div className="flex items-center gap-3">
              {supaSyncStatus === 'syncing' && <span className="mono-font text-[10px] tracking-widest text-amber-600">↻ SYNCING</span>}
              {supaSyncStatus === 'synced'  && <span className="mono-font text-[10px] tracking-widest text-emerald-600">✓ SYNCED</span>}
              {supaSyncStatus === 'error'   && <span className="mono-font text-[10px] tracking-widest text-red-600">✗ SYNC ERROR</span>}
              <div className="mono-font text-xs tracking-widest text-stone-600">
                {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
              </div>
            </div>
          </div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize: 'clamp(48px, 7vw, 88px)', letterSpacing: '-0.03em' }}>
            The Dispute<br />
            <span style={{ fontStyle: 'italic', fontWeight: 500 }}>Desk</span>
          </h1>
          <p className="display-font text-stone-700 mt-4 max-w-2xl" style={{ fontSize: 'clamp(15px, 2vw, 17px)', lineHeight: '1.5' }}>
            {platformMode === 'fi'
              ? 'An operational tool for translating customer complaints into compliant dispute summaries — with a built-in evidence package and merchant defense preview for every case.'
              : 'Build your representment case, fight chargebacks with evidence, and monitor your chargeback ratio against Visa and Mastercard network thresholds.'}
          </p>
          {doesIssuing(sides) && doesMerchant(sides) && <div className="flex items-center mt-6" style={{ borderTop: '1px solid #D4CCBC', paddingTop: '20px' }}>
            <button onClick={() => { setPlatformMode('fi'); window.scrollTo({top:0,behavior:'smooth'}) }} className={'platform-toggle-btn mono-font text-xs tracking-widest px-5 py-2.5 border border-stone-900 transition-all ' + (platformMode === 'fi' ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-600 hover:bg-stone-100')}>ISSUER / FI MODE</button>
            <button onClick={() => { setPlatformMode('merchant'); window.scrollTo({top:0,behavior:'smooth'}) }} className={'platform-toggle-btn mono-font text-xs tracking-widest px-5 py-2.5 border-t border-b border-r border-stone-900 transition-all ' + (platformMode === 'merchant' ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-600 hover:bg-stone-100')}>MERCHANT / ACQUIRER</button>
          </div>}
          {/* ── Mode indicator strip ── */}
          <div style={{ marginTop:'12px', padding:'10px 16px', borderLeft:'3px solid ' + (platformMode === 'fi' ? '#1D4ED8' : '#92400E'), background: platformMode === 'fi' ? '#EFF6FF' : '#FFFBEB' }}>
            <span className="mono-font text-[10px] tracking-widest" style={{ color: platformMode === 'fi' ? '#1E3A8A' : '#78350F', fontWeight: 700 }}>
              {platformMode === 'fi' ? 'ISSUER / FI MODE' : 'MERCHANT MODE'}
            </span>
            <span className="mono-font text-[10px] ml-3" style={{ color: platformMode === 'fi' ? '#1D4ED8' : '#92400E' }}>
              {platformMode === 'fi'
                ? '— File disputes on behalf of cardholders. Reg E / Reg Z compliance. Network chargeback workflow.'
                : '— Fight chargebacks as a merchant. Build rebuttal evidence. Submit representment to your acquirer.'}
            </span>
          </div>

        </div>

        {/* ── Triage handoff banner ── */}
        {showHandoffBanner && triageHandoff && (
          <div className="mb-6 flex items-start gap-3 px-4 py-3" style={{ background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
            <Shield className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#065F46' }} />
            <div className="flex-1 min-w-0">
              <span className="mono-font text-xs tracking-widest" style={{ color: '#064E3B' }}>PRE-FILLED FROM TRIAGE — </span>
              <span className="mono-font text-xs" style={{ color: '#065F46' }}>
                Case {triageHandoff.caseId} · {triageHandoff.classification?.replace(/_/g, ' ')} · {triageHandoff.confidence} confidence
              </span>
              {triageHandoff.headline && (
                <div className="display-font italic text-sm mt-1" style={{ color: '#065F46' }}>"{triageHandoff.headline}"</div>
              )}
            </div>
            <button onClick={dismissHandoffBanner} className="mono-font text-xs shrink-0" style={{ color: '#065F46' }}>✕</button>
          </div>
        )}

        {/* ── Steps 01 + 02 ── */}
        {platformMode === 'fi' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">


          {/* ════ FI INTAKE FORM ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Case Intake</h2>
            </div>

            <div className="space-y-5" style={{ flex:'1 1 400px', minWidth:0 }}>

              {/* Network + card type selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Card Network</label>
                  <div className="flex gap-0">
                    <button
                      onClick={() => setNetwork('visa')}
                      className={`network-btn ${network === 'visa' ? 'active' : 'inactive'}`}
                    >
                      VISA
                    </button>
                    <button
                      onClick={() => setNetwork('mastercard')}
                      className={`network-btn ${network === 'mastercard' ? 'active' : 'inactive'}`}
                    >
                      MASTERCARD
                    </button>
                  </div>
                </div>
                <div>
                  <label className="input-label">Card Type</label>
                  <div className="flex gap-0">
                    <button
                      onClick={() => setCardType('credit')}
                      className={`network-btn ${cardType === 'credit' ? 'active' : 'inactive'}`}
                    >
                      CREDIT
                    </button>
                    <button
                      onClick={() => setCardType('debit')}
                      className={`network-btn ${cardType === 'debit' ? 'active' : 'inactive'}`}
                    >
                      DEBIT
                    </button>
                  </div>
                  {cardType === 'debit' && (
                    <div className="mt-1.5 mono-font text-[10px] text-blue-800 tracking-wide">
                      Reg E / EFTA applies — PC required within 10 business days
                    </div>
                  )}
                </div>
              </div>

              {/* 3DS / authentication status */}
              <div>
                <label className="input-label">3DS / Authentication Status <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(for CNP disputes — affects reason code strength)</span></label>
                <div className="flex gap-0 flex-wrap">
                  {[
                    { id: 'not_attempted', label: 'NOT ATTEMPTED' },
                    { id: 'attempted_failed', label: 'ATTEMPTED — FAILED' },
                    { id: 'attempted_passed', label: 'ATTEMPTED — PASSED' },
                    { id: 'unknown', label: 'UNKNOWN' },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setThreeDSStatus(opt.id)}
                      className={"network-btn " + (threeDSStatus === opt.id ? 'active' : 'inactive')}
                    >{opt.label}</button>
                  ))}
                </div>
                {threeDSStatus === 'attempted_passed' && (
                  <div className="mt-1.5 mono-font text-[10px] text-red-800 tracking-wide">
                    ⚠ Passed 3DS typically shifts liability to issuer — review before filing 10.4 CNP
                  </div>
                )}
                {threeDSStatus === 'not_attempted' && (
                  <div className="mt-1.5 mono-font text-[10px] text-emerald-800 tracking-wide">
                    No 3DS strengthens fraud disputes — include in evidence package
                  </div>
                )}
              </div>

              <div>
                <label className="input-label">Customer Complaint</label>
                <textarea
                  value={complaint}
                  onChange={e => setComplaint(e.target.value)}
                  placeholder="Paste the cardholder's written complaint here..."
                  rows={6}
                  className="input-field"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Merchant</label>
                  <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="e.g. Sephora" className="input-field" />
                </div>
                <div>
                  <label className="input-label">Transaction Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="345.81" className="input-field" style={{ flex: 2 }} />
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      <option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="input-label">Disputed Amount <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(if partial — leave blank if disputing full amount)</span></label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={disputedAmount}
                    onChange={e => setDisputedAmount(e.target.value)}
                    placeholder={amount || '0.00'}
                    className="input-field"
                    style={{ maxWidth: '200px' }}
                  />
                  {disputedAmount && parseFloat(disputedAmount) > 0 && disputedAmount !== amount && (
                    <span className="mono-font text-[10px] text-amber-700 self-center">PARTIAL — disputing {disputedAmount} of {amount || '?'} {currency}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Transaction Date</label>
                  <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
                <div>
                  <label className="input-label">Expected Delivery (Optional)</label>
                  <input type="date" value={expectedDeliveryDate} onChange={e => setExpectedDeliveryDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
              </div>

              {/* SAR discovery date — optional, shows SAR deadline when filled */}
              <div>
                <label className="input-label">
                  Date Fraud Detected / Reported <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(optional — enables SAR deadline tracking)</span>
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="date" value={sarDiscoveryDate} onChange={e => setSarDiscoveryDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px', maxWidth: '200px' }} />
                  {fiSarDeadline && (
                    <div className={`mono-font text-xs px-2 py-1 ${fiSarDaysLeft !== null && fiSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : fiSarDaysLeft !== null && fiSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-700 text-stone-50'}`}>
                      SAR deadline: {fiSarDeadline} · {fiSarDaysLeft !== null ? `${fiSarDaysLeft}d remaining` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* DFA Signal Capture */}
              <div className="border border-stone-300 p-4" style={{ background:'#F0EDE6' }}>
                <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-3">DFA SIGNALS <span className="normal-case tracking-normal font-normal opacity-60">— improves funding grade accuracy</span></div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1.5">AVS MISMATCH</label>
                    <div className="flex gap-0">
                      {[{v:null,l:'—'},{v:false,l:'NO'},{v:true,l:'YES'}].map(({v,l}) => (
                        <button key={l} onClick={() => setFiAvsMismatch(v)}
                          className="mono-font text-[10px] tracking-widest px-3 py-1.5 transition-all"
                          style={{ background: fiAvsMismatch===v?'#1A1814':'transparent', color: fiAvsMismatch===v?'#F5F1EA':'#6B5F4D', border:'1px solid #A09585', cursor:'pointer' }}>
                          {l}
                        </button>
                      ))}
                    </div>
                    {fiAvsMismatch===null && <div className="mono-font text-[10px] text-stone-400 mt-1">unknown — won't affect grade</div>}
                  </div>
                  <div>
                    <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1.5">VFMP ENROLLED</label>
                    <div className="flex gap-0">
                      {[{v:null,l:'—'},{v:false,l:'NO'},{v:true,l:'YES'}].map(({v,l}) => (
                        <button key={l} onClick={() => setFiIsVFMP(v)}
                          className="mono-font text-[10px] tracking-widest px-3 py-1.5 transition-all"
                          style={{ background: fiIsVFMP===v?'#1A1814':'transparent', color: fiIsVFMP===v?'#F5F1EA':'#6B5F4D', border:'1px solid #A09585', cursor:'pointer' }}>
                          {l}
                        </button>
                      ))}
                    </div>
                    {fiIsVFMP===null && <div className="mono-font text-[10px] text-stone-400 mt-1">unknown — won't affect grade</div>}
                  </div>
                  <div>
                    <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1.5">PRIOR CLAIMS ON ACCOUNT</label>
                    <input type="number" min="0" max="99" value={fiPriorClaims} placeholder="—"
                      onChange={e => setFiPriorClaims(e.target.value)}
                      className="cov-input mono-font" style={{ fontSize:'13px', maxWidth:'80px' }} />
                    <div className="mono-font text-[10px] text-stone-400 mt-1">leave blank if unknown</div>
                  </div>
                </div>
              </div>

              {smallDollar && (
                <div className="border border-stone-400 bg-stone-50 p-4">
                  <div className="mono-font text-xs tracking-widest text-stone-500 mb-1">⚠ SMALL DOLLAR — CONSIDER WRITE-OFF</div>
                  <p className="display-font text-stone-700 text-[14px] leading-relaxed">
                    At {effectiveAmount} {currency}{isPartialDispute ? ` (partial dispute on a ${amount} ${currency} transaction)` : ''}, staff time and network fees may exceed recovery. Consider a direct courtesy credit before filing a formal dispute.
                  </p>
                </div>
              )}

              {filingWindow && (
                <div className={`p-4 border ${filingWindow.color === 'red' ? 'border-red-700 bg-red-50' : filingWindow.color === 'amber' ? 'border-amber-700 bg-amber-50' : 'border-emerald-700 bg-emerald-50'}`}>
                  <div className="mono-font text-xs tracking-widest mb-1 text-stone-700">FILING WINDOW</div>
                  <div className="display-font text-sm text-stone-900">{filingWindow.text}</div>
                </div>
              )}

              <button
                onClick={() => analyze()}
                disabled={loading || !complaint.trim()}
                className="w-full bg-stone-900 text-stone-50 py-4 mono-font text-xs tracking-widest hover:bg-stone-800 disabled:bg-stone-400 transition-all flex items-center justify-center gap-3 group"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /><span>ANALYZING CASE</span></>
                  : <><span>GENERATE DISPUTE SUMMARY</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
                }
              </button>

              {error && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{error}</div>
                </div>
              )}
            </div>
          </div>


          {/* ════ FI ANALYSIS (02) ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Analysis</h2>
            </div>

            {!result && !loading && (
              <div className="border border-dashed border-stone-400 p-12 text-center">
                <FileText className="w-8 h-8 text-stone-400 mx-auto mb-3" />
                <p className="display-font text-stone-500 italic">Output will appear here after analysis.</p>
              </div>
            )}

            {loading && (
              <div className="border border-stone-300 p-12 text-center bg-stone-50">
                <Loader2 className="w-8 h-8 text-stone-700 mx-auto mb-3 animate-spin" />
                <p className="display-font text-stone-700 italic">Reviewing complaint and matching to reason codes…</p>
              </div>
            )}

            {result && (
              <div className="space-y-6">

                {/* Network badge */}
                <div className="mono-font text-xs tracking-widest text-stone-500 flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-white ${network === 'visa' ? 'bg-blue-800' : 'bg-red-900'}`}>
                    {network === 'visa' ? 'VISA' : 'MASTERCARD'}
                  </span>
                  <span>REASON CODE ANALYSIS</span>
                </div>



                {/* Visa CE3.0 warning — 10.4 Card-Not-Present disputes */}
                {result?.recommended_reason_code?.startsWith('10.4') && network === 'visa' && (
                  <div className="border-l-4 p-5 space-y-3" style={{ borderColor: '#7e22ce', background: '#faf5ff' }}>
                    <div className="mono-font text-xs tracking-widest" style={{ color: '#581c87' }}>⚠ VISA COMPELLING EVIDENCE 3.0 — VERIFY BEFORE FILING</div>
                    <p className="display-font text-stone-900 text-[15px] leading-relaxed">
                      <strong>Visa CE3.0</strong> (active since April 2023) allows merchants to defeat 10.4 CNP fraud chargebacks if they can show two or more prior <em>undisputed</em> transactions from the same device fingerprint and/or IP address within the 120 days preceding this transaction. If the merchant is CE3.0-enabled and has that evidence on file, your chargeback will be reversed.
                    </p>
                    <div className="space-y-1.5">
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">CHECK BEFORE FILING:</div>
                      {[
                        'Is this cardholder a repeat customer at this merchant? If yes, CE3.0 risk is high.',
                        'Pull IP address and device fingerprint from this transaction — do they match prior undisputed orders?',
                        'Ask cardholder: have they ever shopped at this merchant before, even successfully?',
                        'If prior undisputed transactions exist on the same device/IP, consider downgrading to 10.5 (VFMP) or escalating to fraud ops for further review before filing.',
                      ].map((item, i) => (
                        <div key={i} className="display-font text-[14px] flex gap-2 items-start leading-snug" style={{ color: '#4c1d95' }}>
                          <span className="shrink-0 mt-0.5" style={{ color: '#9333ea' }}>→</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing info */}
                {result.missing_information?.length > 0 && (
                  <div className="border border-stone-400 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-700 mb-3">INFORMATION NEEDED BEFORE FILING</div>
                    <ul className="space-y-2">
                      {result.missing_information.map((item, i) => (
                        <li key={i} className="display-font text-stone-800 text-[15px] flex gap-2">
                          <span className="text-stone-400">→</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Alternative codes */}
                {result.alternative_codes?.length > 0 && (
                  <div>
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">ALTERNATIVE CODES TO CONSIDER</div>
                    <div className="space-y-2">
                      {result.alternative_codes.map((alt, i) => (
                        <div key={i} className="border border-stone-300 bg-white p-4">
                          <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                            <span className="mono-font text-sm font-bold text-stone-900">{alt.code}</span>
                            <span className="display-font italic text-stone-700 text-[15px]">{alt.title}</span>
                          </div>
                          <p className="display-font text-stone-600 text-sm">{alt.when_to_use}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}


                {result && (
                  <>
                  {/* Reason code card */}
                  <div className="border-2 border-stone-900 bg-stone-50 p-6">
                    <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                      <div className="mono-font text-xs tracking-widest text-stone-600">RECOMMENDED REASON CODE</div>
                      <div className="flex gap-2 flex-wrap">
                        {result.category && (
                          <div className="mono-font text-xs px-2 py-1 bg-stone-200 text-stone-800">
                            {result.category.replace('mc_', '').replace('_', ' ').toUpperCase()}
                          </div>
                        )}
                        <div className={`mono-font text-xs px-2 py-1 ${result.confidence === 'high' ? 'bg-emerald-900 text-emerald-50' : result.confidence === 'medium' ? 'bg-amber-900 text-amber-50' : 'bg-stone-700 text-stone-50'}`}>
                          {result.confidence?.toUpperCase()} CONFIDENCE
                        </div>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-4 mb-3 flex-wrap">
                      <div className="display-font font-bold text-4xl text-stone-900">{result.recommended_reason_code}</div>
                      <div className="display-font italic text-xl text-stone-700">{result.reason_code_title}</div>
                    </div>
                    <p className="display-font text-stone-700 leading-relaxed text-[15px]">{result.rationale}</p>
                  </div>
                  {result._ai && <AiExplain record={result._ai} />}
  
                  {/* Dispute summary */}
                  <div className="border border-stone-900 bg-white p-6">
                    <div className="flex items-baseline justify-between mb-4">
                      <div className="mono-font text-xs tracking-widest text-stone-600">
                        DISPUTE SUMMARY — READY FOR {network === 'visa' ? 'VISA' : 'MASTERCARD'}
                      </div>
                      <button onClick={copySummary} className="mono-font text-xs flex items-center gap-1.5 text-stone-700 hover:text-stone-900 transition-colors">
                        {copied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                      </button>
                    </div>
                    <p className="display-font text-stone-900 leading-relaxed text-[16px]" style={{ lineHeight: '1.7' }}>
                      {result.dispute_summary}
                    </p>
                    {isFraud && (
                      <div className="mt-4 pt-4 border-t border-stone-200">
                        <p className="mono-font text-xs text-stone-500 italic">
                          Note: for fraud disputes, liability shifts automatically. A brief summary is sufficient — the network does not require extended narrative for fraud reason codes.
                        </p>
                      </div>
                    )}
                  </div>
  
                  {/* Merchant contact flag — consumer disputes only, never fraud */}
                  {result.goodwill_outreach_required && !isFraud && (
                    <div className="border-l-4 border-amber-700 bg-amber-50 p-5">
                      <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">⚠ MERCHANT CONTACT RECOMMENDED BEFORE FILING</div>
                      <p className="display-font text-stone-900 text-[15px] leading-relaxed">{result.goodwill_outreach_note}</p>
                      <p className="mono-font text-xs text-amber-800 mt-2">For consumer disputes, the cardholder — not the bank — contacts the merchant directly. Document their outreach attempt and the merchant's response (or non-response after reasonable time) before filing.</p>
                    </div>
                  )}
                  {/* Fraud: merchant contact is never required but may assist high-dollar recovery */}
                  {isFraud && parseFloat(amount) >= 500 && (
                    <div className="border-l-4 border-stone-400 bg-stone-50 p-4">
                      <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">ℹ HIGH-DOLLAR FRAUD — OPTIONAL MERCHANT CONTACT</div>
                      <p className="display-font text-stone-600 text-[13px] leading-relaxed">For large fraud claims, the cardholder may optionally notify the merchant to assist in identifying the culprit and preventing further fraud. This is not required to file and should not delay the chargeback.</p>
                    </div>
                  )}
  
                  {/* SAR / STR reminder — with deadline countdown when discovery date is set */}
                  {isFraud && effectiveAmtNum >= settings.sarThreshold && (
                    <div className="border-l-4 border-red-800 bg-red-50 p-5 space-y-3">
                      <div className="mono-font text-xs tracking-widest text-red-900">⚠ SAR / STR REVIEW REQUIRED</div>
                      <p className="display-font text-stone-900 text-[15px] leading-relaxed">
                        This fraud case meets or exceeds the ${settings.sarThreshold.toLocaleString()} threshold. Review for <strong>Suspicious Activity Report</strong> (SAR / FinCEN) or <strong>Suspicious Transaction Report</strong> (STR / FINTRAC) filing requirements per your institution's BSA/AML policy.
                      </p>
                      {fiSarDeadline ? (
                        <div className={`flex items-center gap-3 mono-font text-xs px-3 py-2 ${fiSarDaysLeft !== null && fiSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : fiSarDaysLeft !== null && fiSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100'}`}>
                          <span>SAR DEADLINE: {fiSarDeadline}</span>
                          {fiSarDaysLeft !== null && (
                            <span className="font-bold">
                              {fiSarDaysLeft > 0 ? `${fiSarDaysLeft} DAYS REMAINING` : fiSarDaysLeft === 0 ? 'DUE TODAY' : `${Math.abs(fiSarDaysLeft)} DAYS OVERDUE`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="mono-font text-[11px] text-red-700 italic">
                          ↑ Enter the date fraud was detected in the intake form above to track the 30-day SAR filing deadline.
                        </div>
                      )}
                    </div>
                  )}
  
                  {/* SAR/STR draft memo */}
                  {isFraud && effectiveAmtNum >= settings.sarThreshold && (
                    <div className="border-l-4 border-red-800 bg-red-50 px-5 py-3">
                      <button onClick={() => setSarDraftOpen(v => !v)} className="mono-font flex items-center gap-2 text-red-900 hover:text-red-700"
                        style={{ fontSize:'10px', letterSpacing:'0.12em', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                        <FileText className="w-3.5 h-3.5" />
                        {sarDraftOpen ? '▾ HIDE SAR / STR MEMO DRAFT' : '▸ DRAFT SAR / STR MEMO'}
                      </button>
                      {sarDraftOpen && (() => {
                        const sarDate = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})
                        const draftLines = [
                          'SUSPICIOUS ACTIVITY REPORT — INTERNAL FILING MEMO',
                          `Date Prepared: ${sarDate}`,
                          'Filing Institution: [YOUR INSTITUTION NAME]',
                          'Prepared By: [ANALYST NAME / BSA OFFICER]',
                          '',
                          'CASE SUMMARY',
                          `Subject: ${merchant || '[MERCHANT / SUBJECT NAME]'}`,
                          `Transaction Date: ${transactionDate || '[DATE]'}`,
                          `Amount: ${amount ? `${amount} ${currency}` : '[AMOUNT]'}`,
                          `Account Type: ${cardType || '[CARD TYPE]'}`,
                          result && result.recommended_reason_code ? `Chargeback Code: ${result.recommended_reason_code} — ${result.reason_code_title || ''}` : '',
                          '',
                          'DESCRIPTION OF SUSPICIOUS ACTIVITY',
                          (result && result.risk_notes) || `The cardholder reported unauthorized activity totaling ${amount ? `${amount} ${currency}` : '[AMOUNT]'} at ${merchant || '[MERCHANT]'}. This transaction meets the threshold for SAR/STR review.`,
                          '',
                          'TYPOLOGY',
                          (result && result.fraud_sub_label) ? `Fraud Sub-Type: ${result.fraud_sub_label}` : 'Fraud Sub-Type: [SPECIFY]',
                          (result && result.ato_suspected) ? 'Account takeover suspected. Review for unusual login activity, credential changes, new device additions.' : '[Describe transaction pattern]',
                          '',
                          'SUPPORTING DOCUMENTS',
                          '☐ Dispute intake form',
                          '☐ Transaction records',
                          '☐ Cardholder statement',
                          '☐ Prior dispute history',
                          '',
                          'FILING OBLIGATION',
                          `FinCEN SAR: ${amount && parseFloat(amount) >= 5000 ? `Required — $${parseFloat(amount).toLocaleString()} meets $5,000 threshold` : 'Review — below $5,000 threshold'}`,
                          `FINTRAC STR: ${currency === 'CAD' && amount && parseFloat(amount) >= 10000 ? `Required — $${parseFloat(amount).toLocaleString()} CAD meets $10,000 threshold` : 'Review if CAD transaction ≥ $10,000'}`,
                          sarDiscoveryDate ? `SAR Deadline: ${fiSarDeadline} (30 days from discovery date)` : 'SAR Deadline: 30 days from date fraud detected (enter detection date above)',
                          '',
                          'DISPOSITION',
                          '[Analyst: recommend file / decline / escalate to BSA officer]',
                        ].filter(l => l !== null).join('\n')
                        return (
                          <div className="mt-3">
                            <textarea readOnly value={draftLines} rows={18}
                              style={{ width:'100%', fontSize:'11px', fontFamily:'monospace', lineHeight:1.55, padding:'12px', background:'#FFF5F5', border:'1px solid #FCA5A5', color:'#1C1917', resize:'vertical', boxSizing:'border-box' }} />
                            <button onClick={() => navigator.clipboard.writeText(draftLines)} className="mono-font"
                              style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'5px 12px', marginTop:'6px', border:'1px solid #B91C1C', color:'#B91C1C', background:'none', cursor:'pointer' }}>
                              COPY TO CLIPBOARD
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  )}
  
                  {/* Reg E / EFTA compliance block — debit cards only */}
                  {cardType === 'debit' && (
                    <div className="border-l-4 p-5 space-y-2" style={{ borderColor: '#1d4ed8', background: '#eff6ff' }}>
                      <div className="mono-font text-xs tracking-widest" style={{ color: '#1e3a8a' }}>REG E / EFTA — DEBIT CARD</div>
                      <p className="display-font text-stone-900 text-[15px] leading-relaxed">
                        This is a debit card dispute. <strong>Regulation E</strong> requires the financial institution to issue provisional credit within <strong>10 business days</strong> of receiving the claim (5 business days for established accounts). Investigation must be completed within <strong>45 business days</strong> (20 business days for point-of-sale or foreign-initiated transactions).
                      </p>
                      {regEPcDue && (
                        <div className="flex flex-wrap gap-4 pt-1">
                          <div className="mono-font text-xs" style={{ color: '#1e40af' }}>
                            <span className="text-stone-500">PC DUE BY: </span><span className="font-bold">{regEPcDue}</span>
                          </div>
                          <div className="mono-font text-xs" style={{ color: '#1e40af' }}>
                            <span className="text-stone-500">INVESTIGATION DUE: </span><span className="font-bold">{regEInvDue}</span>
                          </div>
                        </div>
                      )}
                      <p className="mono-font text-[10px] text-stone-500 italic pt-1">
                        Note: these dates are calculated from today (date of analysis). Adjust if claim was received on a different date.
                      </p>
                    </div>
                  )}
                  </>
                )}


          </div>
        </div>

        )}

        {/* ── Steps 01 + 02 — Merchant Mode ── */}
        {platformMode === 'merchant' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* ════ MERCHANT INTAKE FORM ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Chargeback Intake</h2>
            </div>
            <div className="space-y-5">

              <div>
                <label className="input-label">Card Network</label>
                <div className="flex gap-0">
                  <button onClick={() => setNetwork('visa')} className={'network-btn ' + (network === 'visa' ? 'active' : 'inactive')}>VISA</button>
                  <button onClick={() => setNetwork('mastercard')} className={'network-btn ' + (network === 'mastercard' ? 'active' : 'inactive')}>MASTERCARD</button>
                </div>
              </div>

              <div>
                <label className="input-label">Reason Code from Issuer <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(e.g. 10.4, 4853 — from your acquirer notification)</span></label>
                <input type="text" value={mchReasonCode} onChange={e => setMchReasonCode(e.target.value)} placeholder="e.g. 13.1" className="input-field" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Merchant / Store Name</label>
                  <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="Your business name" className="input-field" />
                </div>
                <div>
                  <label className="input-label">Chargeback Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="345.81" className="input-field" style={{ flex: 2 }} />
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      <option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Original Order Date</label>
                  <input type="date" value={mchOrderDate} onChange={e => setMchOrderDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
                <div>
                  <label className="input-label">Chargeback Received Date</label>
                  <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Order ID / Reference</label>
                  <input type="text" value={mchOrderId} onChange={e => setMchOrderId(e.target.value)} placeholder="ORD-2024-00183" className="input-field" />
                </div>
                <div>
                  <label className="input-label">Customer Email / ID</label>
                  <input type="text" value={mchCustomerEmail} onChange={e => setMchCustomerEmail(e.target.value)} placeholder="customer@email.com" className="input-field" />
                </div>
              </div>

              <div>
                <label className="input-label">Chargeback Notification / Customer Claim</label>
                <textarea value={complaint} onChange={e => setComplaint(e.target.value)} placeholder="Paste the chargeback notification or describe the dispute..." rows={5} className="input-field" style={{ resize: 'vertical' }} />
              </div>

              <div>
                <label className="input-label">Delivery / Service Confirmed</label>
                <div className="flex gap-0 flex-wrap">
                  {[{ id: 'yes', label: 'YES — CONFIRMED' }, { id: 'no', label: 'NO / UNCONFIRMED' }, { id: 'unknown', label: 'UNKNOWN' }].map(opt => (
                    <button key={opt.id} onClick={() => setMchDeliveryConfirmed(opt.id)} className={'network-btn ' + (mchDeliveryConfirmed === opt.id ? 'active' : 'inactive')}>{opt.label}</button>
                  ))}
                </div>
                {mchDeliveryConfirmed === 'yes' && <div className="mt-1.5 mono-font text-[10px] text-emerald-800 tracking-wide">Confirmed delivery strengthens 13.1 / 4855 defence — include tracking proof</div>}
                {mchDeliveryConfirmed === 'no' && <div className="mt-1.5 mono-font text-[10px] text-amber-800 tracking-wide">Unconfirmed delivery weakens position — focus other arguments</div>}
              </div>

              <div>
                <label className="input-label">3DS Authentication Result</label>
                <div className="flex gap-0 flex-wrap">
                  {[{ id: 'passed', label: 'PASSED' }, { id: 'failed', label: 'FAILED' }, { id: 'not_attempted', label: 'NOT ATTEMPTED' }, { id: 'unknown', label: 'UNKNOWN' }].map(opt => (
                    <button key={opt.id} onClick={() => setMchThreeDS(opt.id)} className={'network-btn ' + (mchThreeDS === opt.id ? 'active' : 'inactive')}>{opt.label}</button>
                  ))}
                </div>
                {mchThreeDS === 'passed' && <div className="mt-1.5 mono-font text-[10px] text-emerald-800 tracking-wide">Liability shifts to issuer — strong defence for 10.4 / 4837 fraud chargebacks</div>}
                {mchThreeDS === 'not_attempted' && <div className="mt-1.5 mono-font text-[10px] text-amber-800 tracking-wide">No 3DS = no liability shift — harder to fight fraud-coded chargebacks</div>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Refund Policy Shown at Checkout</label>
                  <div className="flex gap-0">
                    {[{ id: 'yes', label: 'YES' }, { id: 'no', label: 'NO' }, { id: 'unknown', label: 'UNK' }].map(opt => (
                      <button key={opt.id} onClick={() => setMchRefundPolicyShown(opt.id)} className={'network-btn ' + (mchRefundPolicyShown === opt.id ? 'active' : 'inactive')}>{opt.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="input-label">Prior Orders (Same Customer)</label>
                  <input type="number" value={mchPriorOrders} onChange={e => setMchPriorOrders(e.target.value)} placeholder="0" className="input-field mono-font" style={{ fontSize: '13px' }} />
                </div>
              </div>

              <div>
                <label className="input-label">IP / Location Notes <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(AVS match, IP vs billing, device fingerprint)</span></label>
                <input type="text" value={mchIpLogs} onChange={e => setMchIpLogs(e.target.value)} placeholder="e.g. IP matches billing zip, AVS match, same device as prior orders" className="input-field" />
              </div>

              <button onClick={analyzeMerchant} disabled={mchLoading || !complaint.trim()}
                className="w-full bg-stone-900 text-stone-50 py-4 mono-font text-xs tracking-widest hover:bg-stone-800 disabled:bg-stone-400 transition-all flex items-center justify-center gap-3 group">
                {mchLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /><span>ANALYZING CHARGEBACK</span></>
                  : <><span>ANALYZE &amp; BUILD DEFENCE</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
              </button>

              {mchError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{mchError}</div>
                </div>
              )}
            </div>
          </div>

          {/* ════ MERCHANT ANALYSIS (02) ════ */}
          <div>
            <div className="flex items-baseline gap-3 mb-6">
              <span className="mono-font text-xs text-stone-500">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Defence Strategy</h2>
            </div>
            {!mchResult && !mchLoading && (
              <div className="border border-dashed border-stone-400 p-12 text-center">
                <Shield className="w-8 h-8 text-stone-400 mx-auto mb-3" />
                <p className="display-font text-stone-500 italic">Defence strategy will appear after analysis.</p>
              </div>
            )}
            {mchLoading && (
              <div className="border border-stone-300 p-12 text-center bg-stone-50">
                <Loader2 className="w-8 h-8 text-stone-700 mx-auto mb-3 animate-spin" />
                <p className="display-font text-stone-700 italic">Building representment strategy…</p>
              </div>
            )}
            {mchResult && (
              <div className="space-y-6">
                <div className="border-2 border-stone-900 bg-stone-50 p-6">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="mono-font text-xs tracking-widest text-stone-600">WIN PROBABILITY</div>
                    <span className={'mono-font text-sm font-bold px-3 py-1 ' + (mchResult.win_probability === 'HIGH' ? 'bg-emerald-900 text-emerald-50' : mchResult.win_probability === 'MEDIUM' ? 'bg-amber-800 text-amber-50' : 'bg-red-900 text-red-50')}>
                      {mchResult.win_probability}
                    </span>
                  </div>
                  <p className="display-font text-stone-700 leading-relaxed text-[15px]">{mchResult.win_note}</p>
                  {mchResult._ai && <div className="mt-4"><AiExplain record={mchResult._ai} defaultOpen={false} /></div>}
                  {mchResult.liability_shift && (
                    <div className="mt-3 pt-3 border-t border-stone-200">
                      <div className="mono-font text-[10px] tracking-widest text-emerald-800 mb-1">LIABILITY SHIFT</div>
                      <p className="display-font text-emerald-900 text-[14px]">{mchResult.liability_shift_note}</p>
                    </div>
                  )}
                </div>
                <div className="border border-stone-900 bg-white p-6">
                  <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">REPRESENTMENT STRATEGY</div>
                  <p className="display-font text-stone-900 leading-relaxed text-[15px]" style={{ lineHeight: '1.7' }}>{mchResult.rebuttal_strategy}</p>
                </div>
                {mchResult.key_arguments && mchResult.key_arguments.length > 0 && (
                  <div className="border-l-4 border-stone-900 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">KEY ARGUMENTS</div>
                    <div className="space-y-2">
                      {mchResult.key_arguments.map((arg, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 leading-snug">
                          <span className="mono-font text-[11px] text-stone-500 shrink-0 mt-0.5">{i+1}.</span>
                          <span>{arg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mchResult.evidence_to_submit && mchResult.evidence_to_submit.length > 0 && (
                  <div className="border border-stone-300 p-5" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">EVIDENCE TO SUBMIT</div>
                    <div className="space-y-3">
                      {mchResult.evidence_to_submit.map((ev, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <span className={'mono-font text-[10px] tracking-widest px-1.5 py-0.5 mt-0.5 shrink-0 ' + (ev.priority === 'required' ? 'bg-stone-900 text-stone-50' : 'bg-stone-300 text-stone-700')}>{(ev.priority || '').toUpperCase()}</span>
                          <div>
                            <div className="display-font text-stone-800 text-[14px] font-medium">{ev.item}</div>
                            <div className="display-font text-stone-500 text-[12px] italic">{ev.note}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mchResult.weaknesses && mchResult.weaknesses.length > 0 && (
                  <div className="border-l-4 border-amber-700 bg-amber-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">WEAKNESSES TO ADDRESS</div>
                    <div className="space-y-1.5">
                      {mchResult.weaknesses.map((w, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 leading-snug">
                          <span className="text-amber-600 shrink-0 mt-0.5">→</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mchResult.deadline_note && (
                  <div className="mono-font text-[11px] text-amber-800 tracking-wide border border-amber-300 bg-amber-50 px-3 py-2">
                    {mchResult.deadline_note}
                  </div>
                )}
                {!mchRepLetter && !mchRepLetterLoading && (
                  <button onClick={generateRepLetter}
                    className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group w-full justify-center">
                    <FileText className="w-4 h-4" />
                    <span>GENERATE REPRESENTMENT LETTER</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}
                {mchRepLetterLoading && (
                  <div className="border border-stone-300 p-8 bg-stone-50 flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-stone-600 animate-spin shrink-0" />
                    <p className="display-font text-stone-600 italic">Drafting representment letter…</p>
                  </div>
                )}
                {mchRepLetterError && (
                  <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                    <span className="display-font text-sm text-red-900">{mchRepLetterError}</span>
                  </div>
                )}
                {mchRepLetter && <AiDraftNote record={draftAi.rep_letter} />}
                {mchRepLetter && (
                  <div className="border border-stone-900">
                    <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
                      <div className="mono-font text-[10px] tracking-widest text-stone-400">REPRESENTMENT LETTER</div>
                      <button onClick={() => { navigator.clipboard.writeText(mchRepLetter); setMchRepLetterCopied(true); setTimeout(() => setMchRepLetterCopied(false), 2000) }}
                        className="mono-font text-[10px] flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors">
                        {mchRepLetterCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                      </button>
                    </div>
                    <div className="bg-white p-5">
                      {mchRepLetter.split('\n\n').map((para, i) => (
                        <p key={i} className={'display-font text-stone-800 text-[14px] leading-relaxed ' + (i > 0 ? 'mt-3' : '')}>{para}</p>
                      ))}
                    </div>
                    <div className="bg-stone-50 px-4 py-2 border-t border-stone-200">
                      <button onClick={generateRepLetter} className="mono-font text-[10px] tracking-widest text-stone-500 hover:text-stone-800 transition-colors">↺ REGENERATE</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
        )}

        {platformMode === 'merchant' && (<>

        {/* ── Step 03 — Evidence Collection ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">03</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Evidence Collection</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
            Gather documents to support your representment. Items below are tailored to your reason code — enter it in Step 01 for a targeted list.
          </p>

          {transactionDate && (() => {
            const ddDays = network === 'mastercard' ? 45 : network === 'amex' ? 20 : 30
            const dl = new Date(transactionDate); dl.setDate(dl.getDate() + ddDays)
            const dLeft = Math.ceil((dl - Date.now()) / 86400000)
            const past = dLeft < 0; const urgent = !past && dLeft <= 7
            return (
              <div className={'flex items-start gap-4 px-4 py-3 mb-6 border ' + (past ? 'border-red-700' : urgent ? 'border-amber-700' : 'border-stone-300')}
                style={{ background: past ? '#FEF2F2' : urgent ? '#FFFBEB' : '#FAF7F1' }}>
                <div>
                  <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">
                    {'NETWORK DEADLINE · ' + (network || 'VISA').toUpperCase() + ' · ' + ddDays + 'D FROM CHARGEBACK NOTICE'}
                  </div>
                  <div className={'mono-font text-sm font-semibold ' + (past ? 'text-red-700' : urgent ? 'text-amber-800' : 'text-stone-900')}>
                    {dl.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    <span className="ml-3 font-normal text-xs">{past ? '⚠ DEADLINE PASSED' : dLeft + 'd remaining'}</span>
                  </div>
                  <div className="display-font text-[12px] text-stone-400 mt-1 italic">
                    Your acquirer deadline is typically 3–5 days earlier — confirm with your processor
                  </div>
                </div>
              </div>
            )
          })()}

          {(() => {
            const code = (mchReasonCode || '').trim()
            const isFraud     = !code || /^10\.|^4835|^4863|^48\d{2}/.test(code)
            const isNotRcvd   = !code || /^13\.1|^4855|^4860/.test(code)
            const isCancelled = /^13\.[27]|^4841/.test(code)
            const isNotAsDesc = /^13\.3|^4853/.test(code)
            const items = [
              { id: 'txn_receipt',    label: 'Transaction receipt and authorization record',                  tag: 'ALWAYS' },
              { id: 'avs_cvv',        label: 'AVS and CVV response codes from the authorization',            tag: 'ALWAYS' },
              { id: 'ip_device',      label: 'IP address, device fingerprint, and login logs',               tag: 'ALWAYS' },
              { id: 'customer_comms', label: 'Customer communications — emails, chat logs, SMS',             tag: 'ALWAYS' },
              { id: 'terms',          label: 'T&Cs and refund policy acknowledged at checkout',              tag: 'ALWAYS' },
              ...(isFraud ? [
                { id: '3ds',          label: '3DS authentication result — passed shifts liability to issuer', tag: 'FRAUD' },
                { id: 'billing',      label: 'Billing address match confirmed at time of purchase',          tag: 'FRAUD' },
                { id: 'prior_orders', label: 'Prior successful orders from same customer or device',         tag: 'FRAUD' },
              ] : []),
              ...(isNotRcvd ? [
                { id: 'tracking',     label: 'Carrier tracking number and proof of delivery',               tag: 'NOT RECEIVED' },
                { id: 'signed_rcpt',  label: 'Signed delivery receipt or digital delivery proof',           tag: 'NOT RECEIVED' },
                { id: 'ship_date',    label: 'Proof of shipment date — must predate the dispute notice',    tag: 'NOT RECEIVED' },
              ] : []),
              ...(isCancelled ? [
                { id: 'cancel_pol',   label: 'Cancellation policy displayed at point of signup',            tag: 'RECURRING' },
                { id: 'cancel_conf',  label: 'Cancellation request record or evidence no request was made', tag: 'RECURRING' },
                { id: 'post_use',     label: 'Evidence of service usage after the claimed cancellation date', tag: 'RECURRING' },
              ] : []),
              ...(isNotAsDesc ? [
                { id: 'listing',      label: 'Product listing or spec description at time of purchase',     tag: 'NOT AS DESC' },
                { id: 'photos',       label: 'Photos confirming item matched the description sold',         tag: 'NOT AS DESC' },
              ] : []),
            ]
            const checkedCount = items.filter(it => mchEvidenceChecked[it.id]).length
            const tagBg = { 'ALWAYS': '#1A1814', 'FRAUD': '#92400E', 'NOT RECEIVED': '#1E40AF', 'RECURRING': '#5B21B6', 'NOT AS DESC': '#065F46' }
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="mono-font text-[10px] tracking-widest text-stone-500">
                    {code ? 'EVIDENCE REQUIRED — CODE ' + code : 'FULL CHECKLIST — ENTER REASON CODE IN STEP 01 FOR TAILORED LIST'}
                  </div>
                  <div className="mono-font text-[10px] text-stone-400">{checkedCount} / {items.length} CONFIRMED</div>
                </div>
                <div className="border border-stone-200" style={{ background: '#FAF7F1' }}>
                  {items.map((it, idx) => (
                    <label key={it.id} className={'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors ' + (idx < items.length - 1 ? 'border-b border-stone-200' : '')}>
                      <input type="checkbox" checked={!!mchEvidenceChecked[it.id]}
                        onChange={e => setMchEvidenceChecked(prev => ({ ...prev, [it.id]: e.target.checked }))}
                        className="mt-0.5 shrink-0" style={{ accentColor: '#1A1814' }} />
                      <span className="display-font text-stone-800 text-[14px] leading-snug flex-1">{it.label}</span>
                      <span className="mono-font text-[10px] tracking-widest px-1.5 py-0.5 shrink-0"
                        style={{ background: tagBg[it.tag] || '#1A1814', color: '#F5F1EA' }}>{it.tag}</span>
                    </label>
                  ))}
                </div>
                {checkedCount > 0 && checkedCount === items.length && (
                  <div className="mt-3 mono-font text-[10px] tracking-widest text-emerald-700">
                    ✓ ALL EVIDENCE CONFIRMED — READY FOR STEP 04
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* ── Step 04 — Representment Package ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">04</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Representment Package</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
            Compile the rebuttal letter from Step 02 with your evidence into a single package and log the submission details below.
            Generic documentation almost always loses — every item must directly address the reason code.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="input-label">Acquirer / Processor Name</label>
              <input type="text" value={mchAcquirer} onChange={e => setMchAcquirer(e.target.value)}
                placeholder="e.g. Chase Merchant Services, Stripe, Square" className="input-field" />
            </div>
            <div>
              <label className="input-label">Your Submission Deadline (from acquirer)</label>
              <input type="date" value={mchRepDeadline} onChange={e => setMchRepDeadline(e.target.value)} className="input-field" />
              <p className="display-font text-[11px] text-stone-400 mt-1 italic leading-snug">
                {'Network allows ' + (network === 'mastercard' ? '45' : network === 'amex' ? '20' : '30') + 'd — acquirers typically cut off 3–5 days earlier'}
              </p>
            </div>
          </div>

          <div className="mb-6">
            <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-3">SUBMISSION CHECKLIST</div>
            <div className="border border-stone-200" style={{ background: '#FAF7F1' }}>
              {[
                { id: 'rep_letter',    label: 'Rebuttal letter drafted and reviewed (Step 02)' },
                { id: 'evidence_done', label: 'All evidence items collected and confirmed (Step 03)' },
                { id: 'txn_records',   label: 'Transaction records and authorization response attached' },
                { id: 'code_match',    label: 'Each piece of evidence directly addresses the reason code' },
                { id: 'format_ok',     label: 'Package formatted per acquirer requirements (PDF, file size)' },
                { id: 'submitted',     label: 'Package submitted to acquirer portal or case manager' },
              ].map((item, idx, arr) => (
                <label key={item.id} className={'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-stone-100 transition-colors ' + (idx < arr.length - 1 ? 'border-b border-stone-200' : '')}>
                  <input type="checkbox" checked={!!mchRepPackage[item.id]}
                    onChange={e => setMchRepPackage(prev => ({ ...prev, [item.id]: e.target.checked }))}
                    className="mt-0.5 shrink-0" style={{ accentColor: '#1A1814' }} />
                  <span className="display-font text-stone-800 text-[14px] leading-snug">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="input-label">Date Submitted to Acquirer</label>
              <input type="date" value={mchSubmitDate} onChange={e => setMchSubmitDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="input-label">Acquirer Reference / Case Number</label>
              <input type="text" value={mchTrackingRef} onChange={e => setMchTrackingRef(e.target.value)}
                placeholder="e.g. ACQ-2024-88341" className="input-field" />
            </div>
          </div>

          {mchSubmitDate && (
            <div className="mt-5 px-4 py-3 border border-emerald-700" style={{ background: '#ECFDF5' }}>
              <div className="mono-font text-[10px] tracking-widest text-emerald-800 mb-1">SUBMITTED TO ACQUIRER</div>
              <div className="display-font text-emerald-900 text-sm">
                {new Date(mchSubmitDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {mchTrackingRef && <> · Ref: <span className="font-semibold">{mchTrackingRef}</span></>}
              </div>
              <div className="display-font text-emerald-700 text-[12px] mt-1 italic">
                Issuer decision typically arrives 30–75 days after submission. Track the outcome in Step 05 below.
              </div>
            </div>
          )}
        </div>

        {/* ── Step 05 — Acquirer Submission Email ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">05</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Acquirer Submission Email</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
            Cover email to send to your acquirer/processor alongside the representment package.
          </p>
          <div className="border border-stone-900">
            <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
              <div className="mono-font text-[10px] tracking-widest text-stone-400">ACQUIRER SUBMISSION EMAIL</div>
              <button onClick={() => { navigator.clipboard.writeText(mchAcqSubmissionEmail()); setMchAcqEmailCopied(true); setTimeout(() => setMchAcqEmailCopied(false), 2000) }}
                className="mono-font text-[10px] flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors">
                {mchAcqEmailCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
              </button>
            </div>
            <div className="bg-white p-5">
              {mchAcqSubmissionEmail().split('\n').map((line, i) => (
                <p key={i} className={'display-font text-stone-800 text-[13px] leading-relaxed ' + (line === '' ? 'mt-2' : '')}
                  style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{line || '\u00A0'}</p>
              ))}
            </div>
            <div className="bg-stone-50 px-4 py-2 border-t border-stone-200 mono-font text-[10px] text-stone-400">
              Fill acquirer name, deadline, and tracking ref in Step 04 to auto-populate this template.
            </div>
          </div>
        </div>

        {/* ── Step 06 — Outcome Tracker ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">06</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Outcome Tracker</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
            Log the issuer decision when it arrives. Outcomes are saved to your case tracker and inform your chargeback win rate.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="input-label">Issuer Decision</label>
              <div className="flex flex-wrap gap-0">
                {[
                  { id: 'won',         label: 'WON — REVERSED',   color: '#064E3B', bg: '#D1FAE5' },
                  { id: 'lost',        label: 'LOST — UPHELD',    color: '#7F1D1D', bg: '#FEE2E2' },
                  { id: 'pre_arb',     label: 'PRE-ARB ESCALATED', color: '#4C1D95', bg: '#EDE9FE' },
                  { id: 'no_response', label: 'NO RESPONSE (WIN)', color: '#1E3A5F', bg: '#DBEAFE' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setMchOutcome(opt.id)}
                    className="network-btn"
                    style={mchOutcome === opt.id ? { background: opt.color, color: opt.bg, borderColor: opt.color } : {}}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="input-label">Decision Date</label>
              <input type="date" value={mchOutcomeDate} onChange={e => setMchOutcomeDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
            </div>
          </div>
          {(mchOutcome === 'won' || mchOutcome === 'no_response') && (
            <div className="mb-6">
              <label className="input-label">Amount Recovered</label>
              <input type="text" value={mchRecoveryAmt} onChange={e => setMchRecoveryAmt(e.target.value)}
                placeholder={amount || '0.00'} className="input-field" style={{ maxWidth: '200px' }} />
            </div>
          )}
          {mchOutcome && (
            <button
              onClick={() => {
                const id = 'MCH-' + Date.now().toString(36).toUpperCase()
                const rec = {
                  id, mode: 'merchant', side: 'merchant', status: mchOutcome === 'pre_arb' ? 'pre_arb' : mchOutcome === 'won' || mchOutcome === 'no_response' ? 'won' : 'lost',
                  date: mchOrderDate || new Date().toISOString().split('T')[0],
                  merchant: merchant || '', amount: amount || '', currency: currency || 'CAD',
                  reasonCode: mchReasonCode || '', network: network || 'visa',
                  acquirer: mchAcquirer || '', trackingRef: mchTrackingRef || '',
                  submittedAt: mchSubmitDate || '', outcomeDate: mchOutcomeDate || '',
                  recoveryAmt: mchRecoveryAmt || amount || '',
                  winProbability: mchResult?.win_probability || '',
                  deliveryConfirmed: mchDeliveryConfirmed === 'yes',
                  threeDS: mchThreeDS, verdict: mchOutcome === 'won' || mchOutcome === 'no_response' ? 'WON' : mchOutcome === 'pre_arb' ? 'PRE_ARB' : 'LOST',
                  updatedAt: new Date().toISOString(),
                }
                saveOutcomes([...outcomes.filter(o => o.id !== id), rec])
              }}
              className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group mb-6">
              <span>SAVE OUTCOME TO TRACKER</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          )}

          {/* Pre-Arb escalation workflow */}
          {mchOutcome === 'pre_arb' && (
            <div className="border border-purple-700 bg-purple-50 p-6 space-y-4">
              <div className="mono-font text-[10px] tracking-widest text-purple-900 mb-2">⚠ PRE-ARBITRATION ESCALATION</div>
              <p className="display-font text-purple-900 text-[14px] leading-relaxed">
                The issuer has filed a second chargeback. You now have a second opportunity to respond — typically 30 days from the escalation date (Visa) or 45 days (Mastercard). Confirm your deadline with your acquirer immediately.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
                <div className="mono-font text-purple-800 border border-purple-200 bg-white p-3">
                  <div className="text-[10px] tracking-widest mb-1 text-purple-500">VISA PRE-ARB DEADLINE</div>
                  {mchOutcomeDate
                    ? (() => { const d = new Date(mchOutcomeDate + 'T12:00:00'); d.setDate(d.getDate() + 30); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' (30d)' })()
                    : 'Enter decision date above'}
                </div>
                <div className="mono-font text-purple-800 border border-purple-200 bg-white p-3">
                  <div className="text-[10px] tracking-widest mb-1 text-purple-500">MC PRE-ARB DEADLINE</div>
                  {mchOutcomeDate
                    ? (() => { const d = new Date(mchOutcomeDate + 'T12:00:00'); d.setDate(d.getDate() + 45); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' (45d)' })()
                    : 'Enter decision date above'}
                </div>
              </div>
              {!mchPreArbLetter && !mchPreArbLoading && (
                <button onClick={generatePreArbLetter}
                  className="flex items-center gap-3 px-5 py-3 bg-purple-900 text-purple-50 mono-font text-xs tracking-widest hover:bg-purple-800 transition-all group">
                  <FileText className="w-4 h-4" />
                  <span>GENERATE PRE-ARB RESPONSE LETTER</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              )}
              {mchPreArbLoading && (
                <div className="flex items-center gap-3 p-4 bg-white border border-purple-200">
                  <Loader2 className="w-4 h-4 text-purple-700 animate-spin shrink-0" />
                  <p className="display-font text-purple-700 italic text-[14px]">Drafting Pre-Arb response…</p>
                </div>
              )}
              {mchPreArbError && (
                <div className="border border-red-700 bg-red-50 p-3 mono-font text-[11px] text-red-800">{mchPreArbError}</div>
              )}
              {mchPreArbLetter && <AiDraftNote record={draftAi.mch_pre_arb} />}
              {mchPreArbLetter && (
                <div className="border border-purple-700">
                  <div className="bg-purple-900 px-4 py-3 flex items-center justify-between">
                    <div className="mono-font text-[10px] tracking-widest text-purple-200">PRE-ARB RESPONSE LETTER</div>
                    <button onClick={() => { navigator.clipboard.writeText(mchPreArbLetter); setMchPreArbCopied(true); setTimeout(() => setMchPreArbCopied(false), 2000) }}
                      className="mono-font text-[10px] flex items-center gap-1.5 text-purple-300 hover:text-purple-100 transition-colors">
                      {mchPreArbCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                    </button>
                  </div>
                  <div className="bg-white p-5">
                    {mchPreArbLetter.split('\n\n').map((para, i) => (
                      <p key={i} className={'display-font text-stone-800 text-[14px] leading-relaxed ' + (i > 0 ? 'mt-3' : '')}>{para}</p>
                    ))}
                  </div>
                  <div className="bg-purple-50 px-4 py-2 border-t border-purple-200">
                    <button onClick={generatePreArbLetter} className="mono-font text-[10px] tracking-widest text-purple-600 hover:text-purple-900 transition-colors">↺ REGENERATE</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {(mchOutcome === 'won' || mchOutcome === 'no_response') && (
            <div className="px-5 py-4 border border-emerald-700" style={{ background: '#ECFDF5' }}>
              <div className="mono-font text-[10px] tracking-widest text-emerald-800 mb-1">✓ CHARGEBACK REVERSED</div>
              <div className="display-font text-emerald-900 text-[15px]">
                {mchOutcomeDate ? new Date(mchOutcomeDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Decision date not set'}
                {(mchRecoveryAmt || amount) && <> · <span className="font-semibold">{mchRecoveryAmt || amount} {currency || 'CAD'} recovered</span></>}
              </div>
              <div className="display-font text-emerald-700 text-[12px] mt-1 italic">Outcome saved to your tracker. This win will calibrate your DFA historical win rates.</div>
            </div>
          )}
          {mchOutcome === 'lost' && (
            <div className="px-5 py-4 border border-red-700" style={{ background: '#FEF2F2' }}>
              <div className="mono-font text-[10px] tracking-widest text-red-800 mb-1">✗ CHARGEBACK UPHELD — FUNDS DEBITED</div>
              <div className="display-font text-red-900 text-[14px]">
                Review the issuer decision for the specific reason. If procedural error, file a compliance case via your acquirer.
              </div>
            </div>
          )}
        </div>

        </>)}

        {platformMode === 'fi' && (<>
        {/* ── Step 03 — Evidence Package ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">03</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Evidence Package</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-8 ml-7" style={{ lineHeight: '1.5' }}>
                {result ? <>Evidence checklist for <span className="font-semibold text-stone-700">{result.recommended_reason_code} — {result.reason_code_title}</span>. Check items off as you collect them.</> : <>What to collect from your systems, cardholder, and the merchant for each reason code.</>}
              </p>

              {!evidence && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <FileText className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate the evidence package.</p>
                </div>
              )}

              {evidence && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {evidence.systems.length > 0 && (
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">PULL FROM YOUR SYSTEMS</div>
                    <div className="space-y-3">
                      {evidence.systems.map((item, i) => {
                        const key = `sys-${i}`
                        const done = !!checked[key]
                        return (
                          <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-2.5 items-start group">
                            {done ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                            <div>
                              <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : impactStyle(item.impact)}`}>{item.text}</span>
                              {!done && <span className="mono-font text-[10px] text-stone-400 ml-1">{impactLabel(item.impact)}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {evidence.cardholder.length > 0 && (
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">COLLECT FROM CARDHOLDER</div>
                    <div className="space-y-3">
                      {evidence.cardholder.map((item, i) => {
                        const key = `ch-${i}`
                        const done = !!checked[key]
                        return (
                          <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-2.5 items-start group">
                            {done ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                            <div>
                              <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : impactStyle(item.impact)}`}>{item.text}</span>
                              {!done && <span className="mono-font text-[10px] text-stone-400 ml-1">{impactLabel(item.impact)}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {evidence.merchant.length > 0 && (
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">WATCH FOR FROM MERCHANT</div>
                    <p className="display-font text-stone-500 text-[13px] italic mb-3">Merchant may submit these at representment. Know what could weaken or support your position.</p>
                    <div className="space-y-3">
                      {evidence.merchant.map((item, i) => {
                        const key = `mer-${i}`
                        const done = !!checked[key]
                        return (
                          <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-2.5 items-start group">
                            {done ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                            <div>
                              <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : impactStyle(item.impact)}`}>{item.text}</span>
                              {!done && <span className="mono-font text-[10px] text-stone-400 ml-1">{impactLabel(item.impact)}</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>}
            </div>

        {/* ── Step 04 — Merchant Defense Preview ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">04</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Merchant Defense Preview</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
                Anticipate what the merchant will argue at representment — before they file it.
              </p>

              {!result && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <Shield className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate the merchant defense preview.</p>
                </div>
              )}
              {result && !rebuttal && !rebuttalLoading && (
                <button
                  onClick={fetchRebuttal}
                  className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group"
                >
                  <Shield className="w-4 h-4" />
                  <span>GENERATE MERCHANT DEFENSE PREVIEW</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              )}

              {rebuttalLoading && (
                <div className="border border-stone-300 p-8 bg-stone-50 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-stone-600 animate-spin shrink-0" />
                  <p className="display-font text-stone-600 italic">Modelling merchant representment strategy…</p>
                </div>
              )}

              {rebuttalError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{rebuttalError}</div>
                </div>
              )}

              {rebuttal && <AiDraftNote record={draftAi.rebuttal} />}
              {rebuttal && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                  {/* Merchant arguments */}
                  <div className="border-2 border-stone-900 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">MERCHANT WILL ARGUE</div>
                    <div className="space-y-3">
                      {rebuttal.merchant_arguments?.map((arg, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="text-stone-400 shrink-0 mt-0.5">→</span>
                          <span>{arg}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Merchant evidence */}
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">EVIDENCE THEY'LL SUBMIT</div>
                    <div className="space-y-3">
                      {rebuttal.merchant_evidence?.map((ev, i) => (
                        <div key={i} className="display-font text-red-900 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="text-red-400 shrink-0 mt-0.5">⚠</span>
                          <span>{ev}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Counter strategy */}
                  <div className="border border-stone-300 bg-stone-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-4">HOW TO COUNTER</div>
                    <div className="space-y-3">
                      {rebuttal.counter_strategy?.map((pt, i) => (
                        <div key={i} className="display-font text-emerald-800 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="text-emerald-600 shrink-0 mt-0.5">✓</span>
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>

                    {rebuttal.win_risk && (
                      <div className="mt-5 pt-4 border-t border-stone-200">
                        <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">MERCHANT DEFENSE STRENGTH</div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`mono-font text-xs px-2 py-0.5 ${winRiskColor(rebuttal.win_risk).bg} ${winRiskColor(rebuttal.win_risk).text}`}>
                            {rebuttal.win_risk} RISK
                          </span>
                        </div>
                        <p className="display-font text-stone-600 text-[13px] italic leading-snug">{rebuttal.win_risk_note}</p>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>

        {/* ── Step 05 — Customer Communication ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">05</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Customer Communication</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
                Draft the cardholder letter based on desk findings — filing, not filing, declined transaction, or investigation.
              </p>

              {!result && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <MessageSquare className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate the customer communication draft.</p>
                </div>
              )}
              {result && !comms && !commsLoading && (
                <button
                  onClick={fetchComms}
                  className="flex items-center gap-3 px-6 py-4 bg-stone-900 text-stone-50 mono-font text-xs tracking-widest hover:bg-stone-800 transition-all group"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>GENERATE CUSTOMER LETTER</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              )}

              {commsLoading && (
                <div className="border border-stone-300 p-8 bg-stone-50 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-stone-600 animate-spin shrink-0" />
                  <p className="display-font text-stone-600 italic">Drafting customer communication…</p>
                </div>
              )}

              {commsError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{commsError}</div>
                </div>
              )}

              {comms && commsOc && <AiDraftNote record={draftAi.comms} />}
              {comms && commsOc && (
                <div className="border border-stone-900">

                  {/* Letter header */}
                  <div className="bg-stone-900 p-4 flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-1">SUBJECT</div>
                      <div className="display-font text-stone-100 font-semibold">{comms.subject}</div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <span className={`mono-font text-xs px-2 py-1 ${commsOc.bg} ${commsOc.text}`}>{commsOc.label}</span>
                      {comms.card_action === 'CANCEL_RECOMMENDED' && (
                        <span className="mono-font text-xs px-2 py-1 bg-red-700 text-red-50">CANCEL CARD</span>
                      )}
                      {comms.card_action === 'MONITOR' && (
                        <span className="mono-font text-xs px-2 py-1 bg-amber-800 text-amber-50">MONITOR CARD</span>
                      )}
                    </div>
                  </div>

                  {/* Letter body — editable textarea */}
                  <div className="bg-white p-6 border-b border-stone-200">
                    <div className="flex items-center justify-between mb-3">
                      <p className="display-font text-stone-400 text-[12px] italic">Dear Valued Cardholder,</p>
                      {letterDraftModified && comms?.body && (
                        <button onClick={() => { setEditableLetterBody(comms.body); setLetterDraftModified(false) }}
                          className="mono-font text-[10px] tracking-widest px-2 py-1 border border-amber-600 text-amber-700 hover:bg-amber-50 transition-colors">
                          ↺ RESET TO AI DRAFT
                        </button>
                      )}
                    </div>
                    <textarea
                      value={editableLetterBody}
                      onChange={e => { setEditableLetterBody(e.target.value); setLetterDraftModified(true) }}
                      rows={10}
                      className="w-full display-font text-stone-900 text-[15px] leading-relaxed border border-stone-200 rounded-none p-3 focus:outline-none focus:border-stone-500 resize-vertical"
                      style={{ fontFamily: 'inherit', background: '#FAFAF9' }}
                      placeholder="Letter body will appear here after generating…"
                    />
                    <p className="display-font text-stone-400 text-[12px] italic mt-3">Sincerely,<br />Customer Care Team</p>
                    <p className="mono-font text-[10px] text-stone-400 mt-2">↑ Edit directly above before copying — docs &amp; clarify items are appended automatically on copy</p>
                  </div>

                  {/* Customer-facing docs — editable textarea */}
                  {editableDocsSection !== undefined && comms && (
                    <div className="bg-blue-50 px-6 py-4 border-b border-blue-100">
                      <div className="mono-font text-[10px] tracking-widest text-blue-700 mb-2">WHAT WE'LL NEED FROM YOU</div>
                      <p className="display-font text-stone-500 text-[11px] mb-2 italic">One item per line — edit freely before copying.</p>
                      <textarea
                        value={editableDocsSection}
                        onChange={e => setEditableDocsSection(e.target.value)}
                        rows={Math.max(4, (editableDocsSection.match(/\n/g)||[]).length + 2)}
                        className="w-full display-font text-stone-800 text-[14px] leading-relaxed border border-blue-200 p-3 focus:outline-none focus:border-blue-500 resize-vertical"
                        style={{ fontFamily: 'inherit', background: '#EFF6FF' }}
                      />
                    </div>
                  )}

                  {/* Next steps + timeline */}
                  <div className="bg-stone-50 p-5 grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-stone-200">
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">NEXT STEPS FOR CARDHOLDER</div>
                      <p className="display-font text-stone-400 text-[11px] mb-2 italic">One step per line — edit as needed.</p>
                      <textarea
                        value={editableNextSteps}
                        onChange={e => setEditableNextSteps(e.target.value)}
                        rows={Math.max(3, (editableNextSteps.match(/\n/g)||[]).length + 2)}
                        className="w-full display-font text-stone-800 text-[14px] leading-relaxed border border-stone-200 p-3 focus:outline-none focus:border-stone-400 resize-vertical"
                        style={{ fontFamily: 'inherit', background: '#F9F8F6' }}
                      />
                    </div>
                    <div>
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">EXPECTED TIMELINE</div>
                      <div className="display-font text-stone-800 text-[15px]">{comms.timeline}</div>
                    </div>
                  </div>

                  {/* Copy */}
                  <div className="p-4 flex justify-end bg-stone-50">
                    <button onClick={copyCommsLetter} className="mono-font text-xs flex items-center gap-1.5 text-stone-700 hover:text-stone-900 transition-colors">
                      {commsCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY LETTER</>}
                    </button>
                  </div>

                </div>
              )}

              {/* ── Documents to collect — inline agent reference ── */}
              {result && evidence && evidence.cardholder.length > 0 && (
                <div className="mt-4 border border-stone-300" style={{ background: '#FAF7F1' }}>
                  <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-stone-400" />
                      <span className="mono-font text-xs tracking-widest text-stone-500">AGENT CHECKLIST — DOCS TO COLLECT</span>
                    </div>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {evidence.cardholder.map((item, i) => {
                      const key = `docreq-${i}`
                      const done = !!checked[key]
                      return (
                        <button key={key} onClick={() => toggleCheck(key)} className="w-full text-left flex gap-3 items-start group">
                          {done
                            ? <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                            : <Square className="w-4 h-4 text-stone-400 shrink-0 mt-0.5 group-hover:text-stone-600" />}
                          <div>
                            <span className={`display-font text-[14px] leading-snug ${done ? 'line-through text-stone-400' : 'text-stone-800'}`}>{item.text}</span>
                            {!done && item.impact === 'required' && (
                              <span className="mono-font text-[10px] text-red-700 ml-2 tracking-wider">REQUIRED</span>
                            )}
                            {!done && item.impact === 'strengthens' && (
                              <span className="mono-font text-[10px] text-emerald-700 ml-2 tracking-wider">STRENGTHENS</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {result.missing_information?.length > 0 && (
                    <div className="px-5 pb-4 border-t border-stone-200 pt-3">
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-2">ALSO CLARIFY</div>
                      {result.missing_information.map((m, i) => (
                        <div key={i} className="display-font text-stone-700 text-[14px] flex gap-2 items-start leading-snug mb-1">
                          <span className="text-stone-400">→</span><span>{m}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

        {/* ── Step 06 — Goodwill Credit ── */}
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">06</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Goodwill Credit</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight: '1.5' }}>
                When a formal dispute isn't the right path — small dollar, relationship risk, or a case that doesn't quite meet threshold — use a courtesy credit instead.
              </p>

              {!result && (
                <div className="border border-dashed border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <Shield className="w-7 h-7 text-stone-300 mx-auto mb-3" />
                  <p className="display-font text-stone-400 italic text-[14px]">Run an analysis first to generate a goodwill recommendation.</p>
                </div>
              )}

              {result && goodwillRec && (
                <div className="border border-stone-300" style={{ background: '#FAF7F1' }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 flex-wrap gap-3">
                    <span className={`mono-font text-xs px-2 py-1 ${goodwillRec.typeColor}`}>{goodwillRec.type}</span>
                    {goodwillRec.recommended && (
                      <button onClick={copyGoodwillScript} className="mono-font text-xs flex items-center gap-1.5 text-stone-600 hover:text-stone-900 transition-colors">
                        {goodwillCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY SCRIPT</>}
                      </button>
                    )}
                  </div>

                  {/* Rationale */}
                  <div className="px-5 pt-4 pb-2">
                    <div className="mono-font text-xs tracking-widest text-stone-400 mb-2">RATIONALE</div>
                    <p className="display-font text-stone-700 text-[14px] leading-relaxed">{goodwillRec.rationale}</p>
                  </div>

                  {/* Script — only shown when goodwill is actually recommended */}
                  {goodwillRec.recommended && goodwillRec.script && (
                    <div className="px-5 pt-3 pb-5">
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-3">AGENT SCRIPT</div>
                      <div className="border border-stone-200 bg-white p-4">
                        {goodwillRec.script.split('\n\n').map((para, i) => (
                          <p key={i} className={`display-font text-stone-800 text-[14px] leading-relaxed ${i > 0 ? 'mt-3' : ''}`}>{para}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* NOT RECOMMENDED — redirect to formal dispute */}
                  {!goodwillRec.recommended && (
                    <div className="px-5 pt-2 pb-3">
                      <div className="flex items-center gap-2 text-stone-500">
                        <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                        <p className="mono-font text-xs tracking-wide">Proceed with formal chargeback filing — use Steps 01–04 above.</p>
                      </div>
                    </div>
                  )}
                  {/* ── Net Recovery Estimate ── */}
                  {platformMode === 'fi' && result && fightCalc && (
                        <div className="border border-stone-300 mt-2" style={{ background: '#EEE9E0' }}>
                          <div className="px-4 py-2.5 border-b border-stone-300">
                            <span className="mono-font text-[10px] tracking-widest text-stone-500">NET RECOVERY ESTIMATE</span>
                          </div>
                          {fightCalc && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-300 border-b border-stone-300">
                              <div className="p-3" style={{ background: '#EEE9E0' }}>
                                <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">WIN PROB</div>
                                <div className="display-font font-bold text-xl text-stone-900">{fightCalc.winProb}%</div>
                                <div className="mono-font text-[10px] text-stone-400 mt-0.5">{result.confidence?.toUpperCase()}{rebuttal ? ' + REBUTTAL' : ''}</div>
                              </div>
                              <div className="p-3" style={{ background: '#EEE9E0' }}>
                                <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">EXP. RECOVERY</div>
                                <div className="display-font font-bold text-xl text-stone-900">${fightCalc.expectedRec.toFixed(2)}</div>
                                <div className="mono-font text-[10px] text-stone-400 mt-0.5">amt × win prob</div>
                              </div>
                              <div className="p-3" style={{ background: '#EEE9E0' }}>
                                <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-1">WRITE-OFF RISK</div>
                                <div className="display-font font-bold text-xl text-red-800">${fightCalc.writeOffRisk.toFixed(2)}</div>
                                <div className="mono-font text-[10px] text-stone-400 mt-0.5">if lost + ~${fightCalc.netFee} fee</div>
                              </div>
                              <div className={`p-3 ${fightCalc.recommendation === 'FIGHT' ? 'bg-emerald-900' : 'bg-red-900'}`}>
                                <div className={`mono-font text-[10px] tracking-widest mb-1 ${fightCalc.recommendation === 'FIGHT' ? 'text-emerald-300' : 'text-red-300'}`}>NET VALUE</div>
                                <div className={`display-font font-bold text-xl ${fightCalc.recommendation === 'FIGHT' ? 'text-emerald-100' : 'text-red-100'}`}>
                                  {fightCalc.netValue >= 0 ? '+' : ''}{fightCalc.netValue.toFixed(2)}
                                </div>
                                <div className={`mono-font text-xs font-bold mt-0.5 ${fightCalc.recommendation === 'FIGHT' ? 'text-emerald-400' : 'text-red-400'}`}>{fightCalc.recommendation}</div>
                              </div>
                            </div>
                          )}
                          <div className="px-4 py-2">
                            <p className="mono-font text-[10px] text-stone-400 italic">Win probability from AI analysis + merchant defense signals. Write-off risk = full disputed amount if lost. Network filing fee ~$25.</p>
                          </div>
                        </div>
                  )}
                </div>
              )}
            </div>

        </>)}

        {/* ── Section 07 — Dispute Outcome Tracker ── */}
        <>
            <div className="section-divider" />
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="mono-font text-xs text-stone-500">{platformMode === 'merchant' ? '05' : '07'}</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>
                  {platformMode === 'merchant' ? 'Chargeback Tracker' : 'Dispute Tracker'}
                </h2>
                <div className="flex items-center gap-3 ml-auto flex-wrap">
                  <span className="mono-font text-xs text-stone-400">{settings.trackerWindowDays || 60}-DAY WINDOW · {filteredTrackerOutcomes.length}{trackerFilter !== 'all' || trackerSearch ? ` / ${trackerOutcomes.length}` : ''} CASE{filteredTrackerOutcomes.length !== 1 ? 'S' : ''}</span>
                  {platformMode !== 'merchant' && (
                    <button onClick={() => setShowSettings(v => !v)} className={`mono-font text-[10px] tracking-widest px-2.5 py-1 border transition-colors ${showSettings ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700'}`}>
                      ⚙ THRESHOLDS
                    </button>
                  )}
                </div>
              </div>

              {trackerOutcomes.length === 0 && (
                <div className="border border-dashed border-stone-300 py-10 text-center mt-6" style={{ background: '#FAF7F1' }}>
                  <p className="mono-font text-xs tracking-widest text-stone-400 mb-2">NO CASES LOGGED YET</p>
                  <p className="display-font text-stone-500 italic text-sm">
                    {platformMode === 'merchant'
                      ? 'Log a chargeback received from your acquirer above — it will appear here for tracking.'
                      : 'Outcomes recorded in the Dispute Desk will appear here once logged.'}
                  </p>
                </div>
              )}

              {/* ── Compliance thresholds panel ── */}
              {showSettings && (
                <div className="border border-stone-400 mb-5" style={{ background: '#FAF7F1' }}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200" style={{ background: '#EEE9E0' }}>
                    <span className="mono-font text-[10px] tracking-widest text-stone-600">COMPLIANCE THRESHOLDS — INSTITUTION CONFIGURATION</span>
                    <button onClick={resetSettings} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">RESET DEFAULTS</button>
                  </div>
                  <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {[
                      { key: 'trackerWindowDays',    label: 'TRACKER WINDOW (DAYS)',    type: 'number', hint: 'Days of cases shown in tracker and home screen (default: 60)' },
                      { key: 'smallDollarThreshold', label: 'WRITE-OFF THRESHOLD ($)', type: 'number', hint: 'Disputes below this amount trigger a write-off recommendation instead of formal dispute filing' },
                      { key: 'sarThreshold',          label: 'SAR TRIGGER ($)',          type: 'number', hint: 'Fraud disputes at or above this amount display a SAR filing reminder' },
                      { key: 'fraudWindowDays',       label: 'FRAUD WINDOW (DAYS)',       type: 'number', hint: 'Filing window for fraud disputes (Visa/MC standard: 120 days from transaction)' },
                      { key: 'consumerWindowDays',    label: 'CONSUMER WINDOW (DAYS)',    type: 'number', hint: 'Filing window for consumer disputes (typically 120 days from expected delivery)' },
                      { key: 'absoluteCapDays',       label: 'ABSOLUTE CAP (DAYS)',       type: 'number', hint: 'Hard cap on any filing, regardless of reason code (Visa: 540 days from transaction)' },
                    ].map(({ key, label, type, hint }) => (
                      <div key={key}>
                        <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">{label}</label>
                        <input
                          type={type}
                          value={settings[key]}
                          onChange={e => updateSetting(key, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                          className="input-field"
                          style={{ fontSize: '13px', padding: '7px 10px' }}
                        />
                        <p className="display-font text-[11px] text-stone-400 mt-1 leading-snug italic">{hint}</p>
                      </div>
                    ))}
                    <div>
                      <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">DFA SCORING</label>
                      <button
                        onClick={() => updateSetting('dfaEnabled', !settings.dfaEnabled)}
                        className="mono-font text-[10px] tracking-widest px-4 py-2 border transition-colors"
                        style={{ background: settings.dfaEnabled !== false ? '#064E3B' : '#292524', color: settings.dfaEnabled !== false ? '#D1FAE5' : '#A8A29E', borderColor: settings.dfaEnabled !== false ? '#064E3B' : '#44403C' }}>
                        {settings.dfaEnabled !== false ? '● DFA ON' : '○ DFA OFF'}
                      </button>
                      <p className="display-font text-[11px] text-stone-400 mt-1 leading-snug italic">Enable or disable the Dispute Funding Analyzer scoring engine</p>
                    </div>
                    <div>
                      <label className="mono-font text-[10px] tracking-widest text-stone-500 block mb-1">PC MILESTONES (BUSINESS DAYS)</label>
                      <div className="flex gap-2">
                        {settings.pcMilestones.map((m, i) => (
                          <input key={i} type="number" value={m}
                            onChange={e => updateSetting('pcMilestones', settings.pcMilestones.map((v, j) => j === i ? parseInt(e.target.value) || v : v))}
                            className="input-field"
                            style={{ fontSize: '13px', padding: '7px 10px', textAlign: 'center' }}
                          />
                        ))}
                      </div>
                      <p className="display-font text-[11px] text-stone-400 mt-1 leading-snug italic">Three milestone deadlines (in business days) shown on the PC countdown row</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'TOTAL (60 DAYS)', value: trackerOutcomes.length,                         sub: platformMode === 'merchant' ? 'chargebacks received' : 'cases analyzed' },
                  { label: 'IN PROGRESS',      value: inProgressCount,                               sub: platformMode === 'merchant' ? 'rebuttal prep / submitted' : 'filed / invstg / repmt / pre-arb' },
                  { label: 'WIN RATE',         value: winRate !== null ? `${winRate}%` : '—',        sub: `${resolvedCount} closed`                   },
                  { label: platformMode === 'merchant' ? 'WON / LOST' : 'WON / LOST', value: `${wonCount} / ${lostCount}`, sub: platformMode === 'merchant' ? `${withdrawnCount} conceded · ${resolvedStatusCount} resolved` : `${withdrawnCount} wd · ${resolvedStatusCount} resolved` },
                ].map(s => (
                  <div key={s.label} className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-xs tracking-widest text-stone-400 mb-1">{s.label}</div>
                    <div className="display-font font-semibold text-stone-900" style={{ fontSize: '22px', letterSpacing: '-0.02em' }}>{s.value}</div>
                    <div className="mono-font text-xs text-stone-400 mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* ── Analytics panel ── */}
              {analytics.resolvedCount >= 2 && (
                <div className="mb-5">
                  <button
                    onClick={() => setShowAnalytics(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 border border-stone-300 mono-font text-[10px] tracking-widest text-stone-500 hover:border-stone-500 transition-colors"
                    style={{ background: '#EEE9E0' }}
                  >
                    <span>OUTCOME ANALYTICS ({analytics.resolvedCount} RESOLVED CASES)</span>
                    <span>{showAnalytics ? '▲' : '▼'}</span>
                  </button>
                  {showAnalytics && (
                    <div className="border border-t-0 border-stone-300 p-4 space-y-5" style={{ background: '#FAF7F1' }}>

                      {/* Network breakdown */}
                      {Object.keys(analytics.byNetwork).length > 0 && (
                        <div>
                          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">WIN RATE BY NETWORK</div>
                          <div className="flex gap-6 flex-wrap">
                            {Object.entries(analytics.byNetwork).map(([net, d]) => {
                              const rate = Math.round(d.won / d.total * 100)
                              return (
                                <div key={net} className="flex items-center gap-3">
                                  <span className="mono-font text-xs text-stone-600 w-8">{net}</span>
                                  <div style={{ width: '120px', height: '6px', background: '#D4CCBC', borderRadius: '2px' }}>
                                    <div style={{ height: '100%', width: `${rate}%`, background: rate >= 60 ? '#064e3b' : rate >= 40 ? '#92400e' : '#7f1d1d', borderRadius: '2px', transition: 'width 0.4s' }} />
                                  </div>
                                  <span className="mono-font text-xs font-medium text-stone-800">{rate}%</span>
                                  <span className="mono-font text-[10px] text-stone-400">{d.won}/{d.total}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Reason code breakdown */}
                      {analytics.topCodes.length > 0 && (
                        <div>
                          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">WIN RATE BY REASON CODE (TOP {analytics.topCodes.length})</div>
                          <div className="space-y-2">
                            {analytics.topCodes.map(([code, d]) => {
                              const rate = Math.round(d.won / d.total * 100)
                              return (
                                <div key={code} className="flex items-center gap-3">
                                  <span className="mono-font text-[11px] text-stone-600 w-10 shrink-0">{code}</span>
                                  <div style={{ flex: 1, height: '6px', background: '#D4CCBC', borderRadius: '2px', maxWidth: '160px' }}>
                                    <div style={{ height: '100%', width: `${rate}%`, background: rate >= 60 ? '#064e3b' : rate >= 40 ? '#92400e' : '#7f1d1d', borderRadius: '2px', transition: 'width 0.4s' }} />
                                  </div>
                                  <span className="mono-font text-[11px] font-medium text-stone-800 w-8">{rate}%</span>
                                  <span className="mono-font text-[10px] text-stone-400">{d.won}W / {d.total - d.won}L</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Weekly filing trend */}
                      <div>
                        <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">WEEKLY FILING TREND (LAST 8 WEEKS)</div>
                        <div className="flex items-end gap-1.5">
                          {analytics.weeks.map((w, i) => {
                            const barH = w.total > 0 ? Math.max(8, Math.round(w.total / Math.max(...analytics.weeks.map(x => x.total), 1) * 48)) : 2
                            const isLast = i === analytics.weeks.length - 1
                            return (
                              <div key={w.label} className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
                                <div className="mono-font text-[10px] text-stone-400">{w.total > 0 ? w.total : ''}</div>
                                <div style={{ width: '100%', height: `${barH}px`, background: isLast ? '#1A1814' : '#D4CCBC', minHeight: '2px' }} />
                                <div className="mono-font text-[10px] text-stone-400">{w.label}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Summary row */}
                      <div className="flex flex-wrap gap-6 pt-2 border-t border-stone-200">
                        {analytics.avgDays !== null && (
                          <div>
                            <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-0.5">AVG RESOLUTION</div>
                            <div className="display-font font-semibold text-stone-900" style={{ fontSize: '20px' }}>{analytics.avgDays} days</div>
                          </div>
                        )}
                        <div>
                          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-0.5">OVERALL WIN RATE</div>
                          <div className="display-font font-semibold text-stone-900" style={{ fontSize: '20px' }}>{winRate !== null ? `${winRate}%` : '—'}</div>
                        </div>
                        <div>
                          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-0.5">CASES RESOLVED</div>
                          <div className="display-font font-semibold text-stone-900" style={{ fontSize: '20px' }}>{analytics.resolvedCount}</div>
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              )}

              {/* Filter / search bar */}
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <div className="flex border border-stone-200 overflow-x-auto" style={{ borderRadius: 0, WebkitOverflowScrolling: 'touch' }}>
                  {(platformMode === 'merchant'
                    ? [
                        { id: 'all',          label: 'ALL' },
                        { id: 'in_progress',  label: 'IN PROGRESS' },
                        { id: 'won',          label: 'WON' },
                        { id: 'lost',         label: 'LOST' },
                      ]
                    : [
                        { id: 'all',          label: 'ALL' },
                        { id: 'queued',       label: 'IN QUEUE' },
                        { id: 'in_progress',  label: 'IN PROGRESS' },
                        { id: 'won',          label: 'WON' },
                        { id: 'lost',         label: 'LOST' },
                        { id: 'fundable',     label: '★ FUNDABLE' },
                      ]
                  ).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setTrackerFilter(tab.id)}
                      className={'mono-font text-[10px] tracking-widest px-3 py-1.5 transition-colors shrink-0 ' + (trackerFilter === tab.id ? 'bg-stone-900 text-stone-50' : 'bg-transparent text-stone-500 hover:bg-stone-100')}
                      title={tab.id === 'fundable' ? 'DFA grade A or B — cases eligible for dispute funding assessment' : undefined}
                    >{tab.label}</button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Search cases..."
                  value={trackerSearch}
                  onChange={e => setTrackerSearch(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '12px', padding: '6px 10px', flex: '1', minWidth: '160px', maxWidth: '280px' }}
                />
                {(trackerFilter !== 'all' || trackerSearch) && (
                  <button onClick={() => { setTrackerFilter('all'); setTrackerSearch('') }} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors tracking-widest">✕ CLEAR</button>
                )}
              </div>

              {/* Case table */}
              <div className="border border-stone-200 overflow-hidden" style={{ background: '#FAF7F1' }}>
                <div className="overflow-x-auto">
                  <div style={{ minWidth: '820px' }}>
                    {/* Header */}
                    {/* ── Deadline dashboard ── */}
                    {(() => {
                      const now = new Date()
                      const deadlines = trackerOutcomes
                        .filter(o => LIFECYCLE_IN_PROGRESS.has(o.status))
                        .flatMap(o => {
                          const entries = []
                          // Reg E PC deadline (10 BD)
                          if (o.provCreditDate) {
                            const pc10 = addBusinessDays(o.provCreditDate, settings.pcMilestones[0])
                            const daysLeft = Math.ceil((pc10 - now) / 86400000)
                            if (daysLeft <= 14) entries.push({ id: o.id, type: 'REG E PC', deadline: pc10.toLocaleDateString('en-CA'), daysLeft, merchant: o.merchant })
                          }
                          // Reg E investigation deadline (45 BD)
                          if (o.provCreditDate) {
                            const inv = addBusinessDays(o.provCreditDate, settings.pcMilestones[1])
                            const daysLeft = Math.ceil((inv - now) / 86400000)
                            if (daysLeft <= 21) entries.push({ id: o.id, type: 'REG E INV', deadline: inv.toLocaleDateString('en-CA'), daysLeft, merchant: o.merchant })
                          }
                          return entries
                        })
                        .sort((a, b) => a.daysLeft - b.daysLeft)
                      if (deadlines.length === 0) return null
                      return (
                        <div className="mb-4 border border-amber-700 bg-amber-50 p-4">
                          <div className="mono-font text-[10px] tracking-widest text-amber-900 mb-3">⚑ UPCOMING COMPLIANCE DEADLINES</div>
                          <div className="flex flex-wrap gap-3">
                            {deadlines.map((d, i) => (
                              <div key={i} className={"mono-font text-[10px] px-2 py-1.5 flex gap-2 items-center " + (d.daysLeft <= 3 ? 'bg-red-900 text-red-50' : d.daysLeft <= 7 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100')}>
                                <span>{d.type}</span>
                                <span className="font-bold">{d.merchant || d.id}</span>
                                <span>{d.deadline}</span>
                                <span>{d.daysLeft > 0 ? d.daysLeft + 'd' : d.daysLeft === 0 ? 'TODAY' : 'OVERDUE'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    <div className="grid px-4 py-2 border-b border-stone-300" style={{ gridTemplateColumns: '90px 55px minmax(0,1fr) 85px minmax(0,1fr) 44px minmax(180px,1fr)', background: '#EEE9E0' }}>
                      {['CASE', 'DATE', 'MERCHANT', 'AMOUNT', 'REASON CODE', 'DFA', 'STATUS'].map(h => (
                        <span key={h} className="mono-font text-[10px] tracking-widest text-stone-500">{h}</span>
                      ))}
                    </div>
                    <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
                      {filteredTrackerOutcomes.length === 0 && trackerOutcomes.length > 0 && (
                        <div className="py-8 text-center border-b border-stone-100">
                          <p className="mono-font text-xs tracking-widest text-stone-400">NO CASES MATCH THIS FILTER</p>
                        </div>
                      )}
                      {filteredTrackerOutcomes.map(o => {
                        const [m0, m1, m2] = settings.pcMilestones
                        const pc10 = o.provCreditDate ? addBusinessDays(o.provCreditDate, m0) : null
                        const pc45 = o.provCreditDate ? addBusinessDays(o.provCreditDate, m1) : null
                        const pc90 = o.provCreditDate ? addBusinessDays(o.provCreditDate, m2) : null
                        const now  = new Date()
                        const isEditing = editingRow === o.id

                        return (
                          <div key={o.id} className="border-b border-stone-100">
                            {isEditing ? (
                              /* ── Edit mode ─────────────────────────────────── */
                              <div className="px-4 py-3 space-y-3" style={{ background: '#FDF9F3' }}>
                                <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">EDITING {o.id}</div>
                                <div className="grid gap-3 mob-1col" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                  <div>
                                    <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">MERCHANT</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.merchant || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, merchant: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">AMOUNT</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.amount || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, amount: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">REASON CODE</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.reasonCode || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, reasonCode: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">STATUS</label>
                                    <select
                                      className="input-field"
                                      value={o.status}
                                      onChange={e => markCaseOutcome(o.id, e.target.value)}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    >
                                      {isMerchantCase(o) ? (<>
                                        <option value="pending">Chargeback received — preparing representment</option>
                                        <option value="filed">Representment filed — awaiting acquirer decision</option>
                                        <option value="investigating">Investigating — under internal review</option>
                                        <option value="representment">Acquirer responded — under review</option>
                                        <option value="won">Won — chargeback reversed</option>
                                        <option value="lost">Lost — chargeback upheld</option>
                                        <option value="resolved">Resolved — closed without formal outcome</option>
                                        <option value="withdrawn">Withdrawn</option>
                                      </>) : (<>
                                        <option value="pending">Pending — not yet reviewed</option>
                                        <option value="queued">In Queue — approved, awaiting batch filing</option>
                                        <option value="filed">Filed — submitted to network</option>
                                        <option value="investigating">Investigating — under internal review</option>
                                        <option value="representment">Representment received — merchant responded</option>
                                        <option value="pre_arb">Pre-arb filed — awaiting decision</option>
                                        <option value="won">Won</option>
                                        <option value="lost">Lost</option>
                                        <option value="resolved">Resolved — closed without formal outcome</option>
                                        <option value="withdrawn">Withdrawn</option>
                                      </>)}
                                    </select>
                                  </div>
                                </div>
                                {isMerchantCase(o) && (
                                  <div className="grid gap-3 mob-1col" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                    <div>
                                      <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">DATE SUBMITTED TO ACQUIRER</label>
                                      <input type="date" className="input-field" value={editDraft.submitDate || ''}
                                        onChange={e => setEditDraft(d => ({ ...d, submitDate: e.target.value }))}
                                        style={{ fontSize: '13px', padding: '8px 10px' }}
                                      />
                                    </div>
                                    <div>
                                      <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">ACQUIRER REFERENCE #</label>
                                      <input className="input-field" value={editDraft.trackingRef || ''}
                                        onChange={e => setEditDraft(d => ({ ...d, trackingRef: e.target.value }))}
                                        placeholder="e.g. ACQ-2024-88341"
                                        style={{ fontSize: '13px', padding: '8px 10px' }}
                                      />
                                    </div>
                                  </div>
                                )}
                                <div className="grid gap-3 mob-1col" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                  <div>
                                    <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">NOTES</label>
                                    <input
                                      className="input-field"
                                      value={editDraft.notes || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                                      placeholder="Optional case notes..."
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                  </div>
                                  <div>
                                    <label className="mono-font text-[10px] tracking-widest text-stone-400 block mb-1">NEXT RESPONSE DUE</label>
                                    <input
                                      type="date"
                                      className="input-field"
                                      value={editDraft.nextRespDate || ''}
                                      onChange={e => setEditDraft(d => ({ ...d, nextRespDate: e.target.value }))}
                                      style={{ fontSize: '13px', padding: '8px 10px' }}
                                    />
                                    <p className="display-font text-[10px] text-stone-400 mt-0.5 italic">Network / acquirer deadline</p>
                                  </div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button onClick={() => saveEdit(o.id)} className="mono-font text-[10px] tracking-widest px-3 py-1.5 bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors">SAVE</button>
                                  <button onClick={cancelEdit} className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-stone-300 text-stone-500 hover:border-stone-500 transition-colors">CANCEL</button>
                                  <button onClick={() => deleteCase(o.id)} className="mono-font text-[10px] tracking-widest px-3 py-1.5 border border-red-300 text-red-600 hover:bg-red-50 transition-colors ml-auto">DELETE CASE</button>
                                </div>
                              </div>
                            ) : (
                              /* ── View mode ─────────────────────────────────── */
                              <div className="grid px-4 py-3 items-start" style={{ gridTemplateColumns: '90px 55px minmax(0,1fr) 85px minmax(0,1fr) 44px minmax(180px,1fr)' }}>
                                <button
                                  onClick={() => setCase360Id(prev => prev === o.id ? null : o.id)}
                                  className="mono-font text-xs text-stone-400 hover:text-stone-900 transition-colors text-left"
                                  title="Toggle case 360 view"
                                >{o.id}</button>
                                <span className="mono-font text-xs text-stone-500">{new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <span className="mono-font text-xs text-stone-800 truncate pr-2 font-medium">{o.merchant}</span>
                                <span className="mono-font text-xs text-stone-600">{o.amount}</span>
                                <div className="pr-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="mono-font text-xs text-stone-600">{o.reasonCode}</span>
                                    {isMerchantCase(o) && o.winProb && (
                                      <span className={'mono-font text-[10px] tracking-widest px-1.5 py-0.5 ' + (o.winProb === 'HIGH' ? 'bg-emerald-900 text-emerald-50' : o.winProb === 'LOW' ? 'bg-red-900 text-red-50' : 'bg-amber-800 text-amber-50')}>{o.winProb}</span>
                                    )}
                                    {o.dfaScore && <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold" style={{background:'#1E3A5F',color:'#BAE6FD'}} title="DFA Fundability Score">DFA {o.dfaScore}</span>}
                                  </div>
                                  {notesText(o.notes) && <p className="display-font text-[11px] text-stone-400 truncate mt-0.5 italic">{notesText(o.notes)}</p>}
                                  {isMerchantCase(o) && o.submitDate && (
                                    <p className="mono-font text-[10px] text-emerald-700 mt-0.5">
                                      REPMT FILED {new Date(o.submitDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                                      {o.trackingRef && <> · {o.trackingRef}</>}
                                    </p>
                                  )}
                                  {/* SAR flag — FI mode, fraud cases above threshold */}
                                  {!isMerchantCase(o) && (() => {
                                    const amtNum = parseFloat((o.amount||'').replace(/[^0-9.]/g,''))
                                    const isFraudLike = (o.classification||'').includes('FRAUD') || (o.reasonCode||'').match(/10\.[0-9]|4853|UA/)
                                    if (!isFraudLike || !(amtNum >= settings.sarThreshold)) return null
                                    return <p className="mono-font text-[10px] text-red-700 mt-0.5 font-bold">⚠ SAR REVIEW</p>
                                  })()}
                                  {/* Next response due badge + quick-set */}
                                  <div className="flex items-center gap-1 flex-wrap mt-1">
                                    {o.nextRespDate && (() => {
                                      const daysLeft = Math.round((new Date(o.nextRespDate + 'T12:00:00') - new Date()) / 86400000)
                                      const overdue = daysLeft < 0
                                      const urgent = !overdue && daysLeft <= 3
                                      return (
                                        <span className={`mono-font text-[10px] tracking-widest px-1.5 py-0.5 font-bold whitespace-nowrap ${overdue ? 'bg-red-700 text-red-50' : urgent ? 'bg-amber-700 text-amber-50' : 'bg-blue-700 text-blue-50'}`}>
                                          {overdue ? `⚠ RESP ${Math.abs(daysLeft)}d OVERDUE` : `RESP ${daysLeft === 0 ? 'TODAY' : `in ${daysLeft}d`} · ${new Date(o.nextRespDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`}
                                        </span>
                                      )
                                    })()}
                                    {quickDueDateRow === o.id ? (
                                      <span className="flex items-center gap-1">
                                        <input type="date" value={quickDueDate} onChange={e => setQuickDueDate(e.target.value)}
                                          className="mono-font text-[10px] border border-stone-300 px-1 py-0.5"
                                          style={{ fontSize:'10px', lineHeight:1, minWidth:0, width:'100px' }} />
                                        <button onClick={() => {
                                          if (quickDueDate) setOutcomes(prev => prev.map(x => x.id === o.id ? { ...x, nextRespDate: quickDueDate } : x))
                                          setQuickDueDateRow(null); setQuickDueDate('')
                                        }} disabled={!quickDueDate} className="mono-font text-[10px] px-1 py-0.5 bg-stone-900 text-stone-50 disabled:bg-stone-300">✓</button>
                                        <button onClick={() => { setQuickDueDateRow(null); setQuickDueDate('') }}
                                          className="mono-font text-[10px] px-1 py-0.5 border border-stone-300 text-stone-500">✕</button>
                                      </span>
                                    ) : (
                                      <button onClick={() => { setQuickDueDateRow(o.id); setQuickDueDate(o.nextRespDate || new Date().toISOString().split('T')[0]) }}
                                        className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:border-blue-500 hover:text-blue-600 transition-colors whitespace-nowrap"
                                        title="Set next network response deadline">
                                        {o.nextRespDate ? '✎ DUE' : '+ DUE DATE'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* DFA grade badge — FI only; merchant rows show winProb badge in reason cell */}
                                {!isMerchantCase(o) ? (() => {
                                  const dfaG = estimateFundingGrade(o.reasonCode, o.amount, { threeDSStatus: o.threeDSStatus, deliveryConfirmed: o.deliveryConfirmed, liabilityShift: o.liabilityShift, refundPolicyShown: o.refundPolicyShown, priorOrders: o.priorOrders, winProb: o.winProb, confidence: o.confidence })
                                  return dfaG
                                    ? <span className={`mono-font text-[10px] font-bold px-1.5 py-0.5 ${dfaG.bg} ${dfaG.text} justify-self-start`} title={`Estimated DFA funding grade — ${dfaG.label} based on reason code and amount. Open DFA for full underwriting.`}>{dfaG.label}</span>
                                    : <span className="text-stone-300 mono-font text-[10px]">—</span>
                                })() : <span className="text-stone-300 mono-font text-[10px]">—</span>}
                                <div className="flex gap-1 flex-wrap items-start" style={{minWidth:0,maxWidth:'100%',overflow:'hidden'}}>

                                  {/* ── PENDING (FI only) ───────────────────── */}
                                  {!isMerchantCase(o) && (!o.status || o.status === 'pending') && (<>
                                    <button onClick={() => advanceStage(o.id,'investigating')} title="Agent is investigating" className="mono-font text-[10px] px-1.5 py-0.5 border border-blue-600 text-blue-700 hover:bg-blue-50 whitespace-nowrap transition-colors">INVSTG</button>
                                    <button onClick={() => advanceStage(o.id,'queued')} title="Move to batch filing queue" className="mono-font text-[10px] px-1.5 py-0.5 border border-violet-600 text-violet-700 hover:bg-violet-50 whitespace-nowrap transition-colors">IN QUEUE</button>
                                    <button onClick={() => advanceStage(o.id,'filed')} title="Mark chargeback as filed with network" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-700 text-stone-800 hover:bg-stone-50 whitespace-nowrap transition-colors">FILED</button>
                                    <button onClick={() => markCaseOutcome(o.id,'withdrawn')} title="Withdraw" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 whitespace-nowrap transition-colors">WD</button>
                                    {!o.provCreditDate && (
                                      <button onClick={() => markProvCredit(o.id)} title="Log provisional credit (Reg E)" className="mono-font text-[10px] px-1.5 py-0.5 border border-blue-500 text-blue-600 hover:bg-blue-50 whitespace-nowrap transition-colors">PC</button>
                                    )}
                                  </>)}

                                  {/* ── MERCHANT: RECEIVED ──────────────────── */}
                                  {isMerchantCase(o) && (o.status === 'received' || !o.status || o.status === 'pending') && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-orange-800 text-orange-50">RECEIVED</span>
                                    <button onClick={() => advanceStage(o.id,'rebuttal_prep')} title="Begin preparing representment rebuttal" className="mono-font text-[10px] px-1.5 py-0.5 border border-amber-700 text-amber-800 hover:bg-amber-50 whitespace-nowrap transition-colors">PREP REBUTTAL</button>
                                    <button onClick={() => markCaseOutcome(o.id,'withdrawn')} title="Concede — do not fight this chargeback" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 whitespace-nowrap transition-colors">CONCEDE</button>
                                  </>)}

                                  {/* ── INVSTG (FI only) ───────────────────── */}
                                  {!isMerchantCase(o) && o.status === 'investigating' && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-blue-900 text-blue-50">INVSTG</span>
                                    <button onClick={() => advanceStage(o.id,'filed')} title="Done investigating — file chargeback with network" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-700 text-stone-800 hover:bg-stone-50 whitespace-nowrap transition-colors">FILED</button>
                                    <button onClick={() => markCaseOutcome(o.id,'withdrawn')} title="Withdraw case" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 whitespace-nowrap transition-colors">WD</button>
                                    {!isMerchantCase(o) && (
                                      o.escalation === 'lea_referral'
                                        ? <span className="mono-font text-[10px] px-1.5 py-0.5 bg-orange-900 text-orange-50 whitespace-nowrap" title="Law enforcement referral flagged">LEA ✓</span>
                                        : <button onClick={() => escalateCase(o.id,'lea_referral')} title="Flag for law enforcement referral" className="mono-font text-[10px] px-1.5 py-0.5 border border-orange-600 text-orange-700 hover:bg-orange-50 whitespace-nowrap transition-colors">LEA</button>
                                    )}
                                    {!isMerchantCase(o) && !o.provCreditDate && (
                                      <button onClick={() => markProvCredit(o.id)} title="Log provisional credit (Reg E)" className="mono-font text-[10px] px-1.5 py-0.5 border border-blue-500 text-blue-600 hover:bg-blue-50 whitespace-nowrap transition-colors">PC</button>
                                    )}
                                    <button onClick={() => revertCase(o.id)} title="Back to pending" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 hover:border-stone-500 whitespace-nowrap transition-colors">↩ PENDING</button>
                                  </>)}

                                  {/* ── IN QUEUE (FI only) ──────────────────── */}
                                  {!isMerchantCase(o) && o.status === 'queued' && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-violet-900 text-violet-50">IN QUEUE</span>
                                    {!o.provCreditDate && (
                                      <button onClick={() => markProvCredit(o.id)} title="Log provisional credit (Reg E)" className="mono-font text-[10px] px-1.5 py-0.5 border border-blue-500 text-blue-600 hover:bg-blue-50 whitespace-nowrap transition-colors">PC</button>
                                    )}
                                    <button onClick={() => revertCase(o.id)} title="Remove from batch queue — back to pending" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 hover:border-stone-500 whitespace-nowrap transition-colors">↩ UNQUEUE</button>
                                  </>)}

                                  {/* ── MERCHANT: REBUTTAL PREP ─────────────── */}
                                  {isMerchantCase(o) && o.status === 'rebuttal_prep' && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-amber-800 text-amber-50">REBUTTAL PREP</span>
                                    <button onClick={() => advanceStage(o.id,'submitted')} title="Representment submitted to acquirer" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-700 text-stone-800 hover:bg-stone-50 whitespace-nowrap transition-colors">SUBMITTED</button>
                                    <button onClick={() => markCaseOutcome(o.id,'withdrawn')} title="Concede this chargeback" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 whitespace-nowrap transition-colors">CONCEDE</button>
                                    <button onClick={() => revertCase(o.id)} title="Back to received" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 hover:border-stone-500 whitespace-nowrap transition-colors">↩ BACK</button>
                                  </>)}

                                  {/* ── MERCHANT: SUBMITTED ─────────────────── */}
                                  {isMerchantCase(o) && o.status === 'submitted' && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-stone-900 text-stone-50">SUBMITTED</span>
                                    <button onClick={() => markCaseOutcome(o.id,'won')} title="Representment won — chargeback reversed" className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 whitespace-nowrap transition-colors">WON</button>
                                    <button onClick={() => markCaseOutcome(o.id,'lost')} title="Representment lost — chargeback upheld" className="mono-font text-[10px] px-1.5 py-0.5 border border-red-600 text-red-700 hover:bg-red-50 whitespace-nowrap transition-colors">LOST</button>
                                    <button onClick={() => revertCase(o.id)} title="Revert to prep" className="mono-font text-[10px] px-1 py-0.5 text-stone-400 hover:text-stone-700 transition-colors">↩</button>
                                  </>)}

                                  {/* ── FILED (FI) / legacy merchant filed ─── */}
                                  {o.status === 'filed' && (<>
                                    {isMerchantCase(o)
                                      ? <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-stone-700 text-stone-200">SUBMITTED (legacy)</span>
                                      : <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-stone-900 text-stone-50">FILED</span>}
                                    <button onClick={() => markCaseOutcome(o.id,'won')} title="Case won" className="mono-font text-[10px] px-1.5 py-0.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 whitespace-nowrap transition-colors">WON</button>
                                    <button onClick={() => markCaseOutcome(o.id,'lost')} title="Case lost" className="mono-font text-[10px] px-1.5 py-0.5 border border-red-600 text-red-700 hover:bg-red-50 whitespace-nowrap transition-colors">LOST</button>
                                    {!isMerchantCase(o) && (<>
                                      <button onClick={() => markCaseOutcome(o.id,'withdrawn')} title="Withdraw case" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 whitespace-nowrap transition-colors">WD</button>
                                      {!o.provCreditDate && (
                                        <button onClick={() => markProvCredit(o.id)} title="Log provisional credit (Reg E)" className="mono-font text-[10px] px-1.5 py-0.5 border border-blue-500 text-blue-600 hover:bg-blue-50 whitespace-nowrap transition-colors">PC</button>
                                      )}
                                    </>)}
                                    <button onClick={() => revertCase(o.id)} title="Revert" className="mono-font text-[10px] px-1 py-0.5 text-stone-400 hover:text-stone-700 transition-colors">↩</button>
                                  </>)}

                                  {/* ── LEGACY: network_invstg / representment / pre_arb ── */}
                                  {(o.status === 'network_invstg' || o.status === 'representment' || o.status === 'pre_arb') && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-amber-900 text-amber-50">
                                      {o.status === 'network_invstg' ? 'NTW INVSTG' : o.status === 'representment' ? 'REPMT' : 'PRE-ARB'}
                                    </span>
                                    <button onClick={() => revertCase(o.id)} title="Re-mark status" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 hover:border-stone-500 whitespace-nowrap transition-colors">↩ CHANGE</button>
                                  </>)}

                                  {/* ── RESOLVED ────────────────────────────── */}
                                  {o.status === 'resolved' && (<>
                                    <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap bg-teal-900 text-teal-50">RESOLVED</span>
                                    <button onClick={() => revertCase(o.id)} title="Re-open case" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 hover:border-stone-500 whitespace-nowrap transition-colors">↩ CHANGE</button>
                                  </>)}

                                  {/* ── WON / LOST / WITHDRAWN ──────────────── */}
                                  {(o.status === 'won' || o.status === 'lost' || o.status === 'withdrawn') && (<>
                                    <span className={`mono-font text-[10px] px-1.5 py-0.5 font-bold whitespace-nowrap ${o.status==='won'?'bg-emerald-900 text-emerald-50':o.status==='lost'?'bg-red-900 text-red-50':'bg-stone-600 text-stone-50'}`}>
                                      {o.status === 'withdrawn' ? 'WD' : o.status.toUpperCase()}
                                    </span>
                                    {o.status === 'lost' && !isMerchantCase(o) && (<>
                                      {o.escalation === 'lea_referral'
                                        ? <span className="mono-font text-[10px] px-1 py-0.5 bg-orange-900 text-orange-50 whitespace-nowrap" title="Law enforcement referral flagged">LEA✓</span>
                                        : <button onClick={() => escalateCase(o.id,'lea_referral')} title="Flag for law enforcement referral" className="mono-font text-[10px] px-1.5 py-0.5 border border-orange-600 text-orange-700 hover:bg-orange-50 whitespace-nowrap transition-colors">LEA</button>}
                                      {o.escalation === 'writeoff'
                                        ? <span className="mono-font text-[10px] px-1 py-0.5 bg-stone-700 text-stone-200 whitespace-nowrap" title="Written off">W/O✓</span>
                                        : <button onClick={() => escalateCase(o.id,'writeoff')} title="Write off loss" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 whitespace-nowrap transition-colors">W/O</button>}
                                    </>)}
                                    <button onClick={() => revertCase(o.id)} title="Re-open / change outcome" className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:text-stone-700 hover:border-stone-500 whitespace-nowrap transition-colors">↩ CHANGE</button>
                                  </>)}

                                </div>
                                <div className="flex flex-wrap items-center gap-1 justify-end" style={{minWidth:0}}>
                                    {!isMerchantCase(o) && onScoreInDfa && (
                                      <button
                                        onClick={() => onScoreInDfa([toDfaClaim(o)])}
                                        className="mono-font text-[10px] px-2 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors whitespace-nowrap"
                                        title="Send to DFA for funding assessment"
                                      >→DFA</button>
                                    )}
                                    {onSendToDuo && (
                                      <button
                                        onClick={() => onSendToDuo(o)}
                                        className="mono-font text-[10px] px-2 py-0.5 transition-colors whitespace-nowrap"
                                        style={{ background:'#064E3B', color:'#F0FDF4', border:'none', cursor:'pointer', letterSpacing:'0.06em' }}
                                        title="Open in Duo Mode — coordinate with receiving institution"
                                      >→DUO</button>
                                    )}
                                  <button
                                    onClick={() => {
                                      if (o.merchant && o.merchant !== '—') setMerchant(o.merchant)
                                      if (o.amount && o.amount !== '—') {
                                        const pts = (o.amount || '').split(' ')
                                        if (pts[0]) setAmount(pts[0])
                                        if (pts[1]) setCurrency(pts[1])
                                      }
                                      if (o.network) setNetwork((o.network||'').toLowerCase().includes('visa') ? 'visa' : 'mastercard')
                                      if (o._transactionDate) setTransactionDate(o._transactionDate)
                                      if (o._cardType) setCardType(o._cardType)
                                      if (o._complaint) setComplaint(o._complaint)
                                      if (o.cbStage) setCbCycleStage(o.cbStage)
                                      if (o.cbFiledDate) setCbFiledDate(o.cbFiledDate)
                                      setCurrentDeskCaseId(o.id)
                                      pendingCaseIdRef.current = o.id
                                      setResult(null); setRebuttal(null); setError(null)
                                      if (onGoToDesk) onGoToDesk()
                                      window.scrollTo({ top: 0, behavior: 'smooth' })
                                      if (o._complaint) setTimeout(() => analyze(o._complaint), 0)
                                    }}
                                    className="mono-font text-[10px] tracking-wide px-1.5 py-0.5 border border-stone-500 text-stone-600 hover:bg-stone-50 transition-colors whitespace-nowrap"
                                    title={o._complaint ? 'Re-run analysis on this case' : 'Pre-fill desk form from this case (no saved complaint)'}
                                  >{o._complaint ? '↺ RERUN' : 'OPEN IN DESK'}</button>
                                   <button
                                     onClick={() => setExpandedCbRow(expandedCbRow === o.id ? null : o.id)}
                                     className="mono-font text-[10px] tracking-wide px-1.5 py-0.5 border transition-colors whitespace-nowrap"
                                     style={{ borderColor: expandedCbRow === o.id ? '#D97706' : '#A8A29E', color: expandedCbRow === o.id ? '#D97706' : '#78716C', background: expandedCbRow === o.id ? '#FFFBEB' : 'transparent' }}
                                     title="Manage Chargeback Cycle"
                                   >▸ CB</button>
                                   <button
                                     onClick={() => setDocOpen(prev => ({ ...prev, [o.id]: !prev[o.id] }))}
                                     className="mono-font text-[10px] tracking-wide px-1.5 py-0.5 border transition-colors whitespace-nowrap"
                                     style={{ borderColor: docOpen[o.id] ? '#166534' : '#A8A29E', color: docOpen[o.id] ? '#166534' : '#78716C', background: docOpen[o.id] ? '#F0FDF4' : 'transparent' }}
                                     title="Evidence documents"
                                   >📎{(o.docs||[]).length > 0 ? ` ${(o.docs||[]).length}` : ''}</button>
                                  <button onClick={() => startEdit(o)} className="text-stone-500 hover:text-stone-900 transition-colors mt-0.5" title="Edit row"><Pencil className="w-3.5 h-3.5" /></button>
                                </div>
                              </div>
                            )}

                            {/* Provisional credit deadline row */}
                            {!isEditing && o.provCreditDate && !isMerchantCase(o) && (
                              <div className="px-4 pb-2 flex items-center gap-4 flex-wrap" style={{ background: '#EEF2FF' }}>
                                <span className="mono-font text-[10px] text-blue-800 tracking-wider">PC LOGGED: {new Date(o.provCreditDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <button
                                  onClick={() => markPcIssued(o.id)}
                                  className={`mono-font text-[10px] px-1.5 py-0.5 transition-colors ${o.pcIssued ? 'bg-blue-800 text-blue-50' : 'border border-blue-600 text-blue-600 hover:bg-blue-50'}`}
                                  title={o.pcIssued ? 'Provisional credit confirmed as issued to customer' : 'Confirm provisional credit has been physically disbursed to customer'}
                                >
                                  {o.pcIssued ? 'CREDIT ISSUED ✓' : 'MARK ISSUED'}
                                </button>
                                {[{ label: `${m0}BD`, date: pc10 }, { label: `${m1}BD`, date: pc45 }, { label: `${m2}BD`, date: pc90 }].map(({ label, date }) => {
                                  if (!date) return null
                                  const d = daysUntil(date)
                                  const past = d !== null && d < 0
                                  const urgent = !past && d !== null && d <= 5
                                  const warning = !past && !urgent && d !== null && d <= 14
                                  const cls = past ? 'text-red-700 font-bold' : urgent ? 'text-red-600 font-bold' : warning ? 'text-amber-700' : 'text-blue-600'
                                  const badge = past ? '⚠ PAST' : d !== null ? `(${d}d)` : ''
                                  return (
                                    <span key={label} className={`mono-font text-[10px] tracking-wider ${cls}`}>
                                      {label}: {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {badge}
                                    </span>
                                  )
                                })}
                              </div>
                            )}

                            {/* CB Cycle expandable panel */}
                            {expandedCbRow === o.id && (() => {
                              const _addDL = (d, n) => { const r = new Date(d + 'T12:00:00'); r.setDate(r.getDate() + n); return r }
                              const _net = (o.network || '').toLowerCase()
                              const _st = o.cbStage || '1cb'
                              const _dl = o.cbFiledDate
                                ? (_net.includes('visa') ? _addDL(o.cbFiledDate, 30) : _st === '1cb' ? _addDL(o.cbFiledDate, 45) : _addDL(o.cbFiledDate, 30))
                                : null
                              const _dLeft = _dl ? Math.round((_dl - new Date()) / 86400000) : null
                              const _ov = _dLeft !== null && _dLeft < 0
                              const _urg = !_ov && _dLeft !== null && _dLeft <= 5
                              return (
                                <div className="px-4 py-3 border-t border-amber-200" style={{ background: '#FFFBEB' }}>
                                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <span className="mono-font text-[10px] tracking-widest text-amber-700">CB STAGE</span>
                                    {[{v:'1cb',l:'1ST CB'},{v:'2cb',l:'2ND PRES'},{v:'prearb',l:'PRE-ARB'},{v:'arb',l:'ARB'}].map(({v,l}) => (
                                      <button key={v}
                                        onClick={() => setOutcomes(prev => prev.map(x => x.id === o.id ? {...x, cbStage: v} : x))}
                                        className="mono-font text-[10px] px-2 py-0.5 transition-all"
                                        style={{ background: _st===v?'#1A1814':'transparent', color: _st===v?'#F5F1EA':'#92400E', border:'1px solid #D97706', cursor:'pointer' }}
                                      >{l}</button>
                                    ))}
                                    <input type="date" value={o.cbFiledDate || ''}
                                      onChange={e => setOutcomes(prev => prev.map(x => x.id === o.id ? {...x, cbFiledDate: e.target.value} : x))}
                                      className="mono-font border border-amber-300 px-1 bg-transparent ml-2"
                                      style={{ fontSize: '10px' }} />
                                    {!o.cbFiledDate && <span className="mono-font text-[10px] text-amber-500 italic">← set filing date</span>}
                                  </div>
                                  {_dl && (() => {
                                    const _cls = _ov ? 'text-red-700 font-bold' : _urg ? 'text-amber-700 font-bold' : 'text-amber-900'
                                    const _lbl = _ov ? ('PASSED ' + Math.abs(_dLeft) + 'd ago') : _dLeft === 0 ? 'DUE TODAY' : (_dLeft + 'd remaining')
                                    const _sl = _st==='1cb'?'1ST CB':_st==='2cb'?'2ND PRES':_st==='prearb'?'PRE-ARB':'ARB'
                                    return (<div className="flex items-center gap-3"><span className="mono-font text-[10px] text-amber-500 tracking-wider">DEADLINE</span><span className={['mono-font text-[10px] tracking-wide', _cls].join(' ')}>{_sl} - {_dl.toLocaleDateString('en-US',{month:'short',day:'numeric'})} - {_lbl}</span></div>)
                                  })()}
                                  {/* Network indicators */}
                                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                                    <button
                                      onClick={() => setOutcomes(prev => prev.map(x => x.id === o.id ? {...x, networkInvstg: !x.networkInvstg} : x))}
                                      title="Toggle: network or acquirer is actively processing this chargeback"
                                      className={`mono-font text-[10px] px-1.5 py-0.5 border transition-colors whitespace-nowrap ${o.networkInvstg ? 'bg-blue-900 text-blue-50 border-blue-900' : 'border-blue-500 text-blue-600 hover:bg-blue-50'}`}
                                    >{o.networkInvstg ? 'NTW INVSTG ✓' : 'NTW INVSTG'}</button>
                                    {o.merchantRespDate ? (
                                      <span className="mono-font text-[10px] text-amber-800 font-bold">
                                        MERCHANT RESP: {new Date(o.merchantRespDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => setOutcomes(prev => prev.map(x => x.id === o.id ? {
                                          ...x,
                                          merchantRespDate: new Date().toISOString().split('T')[0],
                                          cbStage: x.cbStage === '1cb' ? '2cb' : x.cbStage
                                        } : x))}
                                        title="Log merchant representment received — bumps CB stage to 2ND PRES if currently at 1ST CB"
                                        className="mono-font text-[10px] px-1.5 py-0.5 border border-amber-600 text-amber-700 hover:bg-amber-50 transition-colors whitespace-nowrap"
                                      >MERCHANT RESP</button>
                                    )}
                                  </div>
                                  {/* Pre-arb drafter — appears when stage is 2CB or PRE-ARB */}
                                  {(_st === '2cb' || _st === 'prearb') && (
                                    <div className="mt-3 pt-3 border-t border-amber-200">
                                      <div className="mono-font text-[10px] tracking-widest text-amber-700 mb-1.5">
                                        {_st === 'prearb' ? 'PRE-ARB REBUTTAL DRAFTER' : 'DRAFT PRE-ARB RESPONSE'}
                                      </div>
                                      <textarea
                                        value={merchantRepNotes[o.id] || ''}
                                        onChange={e => setMerchantRepNotes(prev => ({...prev, [o.id]: e.target.value}))}
                                        placeholder="Paste merchant's representment response / acquirer rebuttal here…"
                                        rows={3}
                                        className="w-full mono-font text-[10px] border border-amber-300 px-2 py-1.5 resize-none focus:outline-none focus:border-amber-500"
                                        style={{background:'#FFFBEB', fontFamily:'inherit'}}
                                      />
                                      <button
                                        onClick={() => generatePreArbDraft(o)}
                                        disabled={preArbLoading && preArbTargetId === o.id}
                                        className="mono-font text-[10px] tracking-widest px-3 py-1.5 mt-1.5 transition-colors"
                                        style={{background:'#78350F', color:'#FEF3C7', border:'none', cursor:'pointer', opacity: preArbLoading && preArbTargetId === o.id ? 0.6 : 1}}
                                      >{preArbLoading && preArbTargetId === o.id ? 'DRAFTING…' : 'GENERATE PRE-ARB REBUTTAL →'}</button>
                                      <p className="mono-font text-[10px] text-amber-600 mt-1 italic">Merchant response is optional — AI will draft from case context alone if blank.</p>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}

                            {/* Evidence / doc attachment panel */}
                            {docOpen[o.id] && (
                              <div className="px-4 py-3 border-t border-stone-200" style={{ background: '#F0FDF4' }}>
                                <div className="mono-font text-[10px] tracking-widest text-green-800 mb-3">EVIDENCE — {o.id}</div>
                                {/* Existing docs list */}
                                {(o.docs||[]).length === 0 && (
                                  <p className="mono-font text-[10px] text-stone-400 mb-3">No documents attached yet.</p>
                                )}
                                {(o.docs||[]).length > 0 && (
                                  <div className="space-y-1 mb-3">
                                    {(o.docs||[]).map((d, i) => (
                                      <div key={i} className="flex items-center gap-2">
                                        <span className="mono-font text-[10px] text-stone-600 flex-1 truncate">{d.name}</span>
                                        <span className="mono-font text-[10px] text-stone-400">{d.size ? `${(d.size/1024).toFixed(0)} KB` : ''}</span>
                                        <span className="mono-font text-[10px] text-stone-400">{d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''}</span>
                                        <button onClick={() => openEvidence(d)} title="Opens a link that expires in 5 minutes"
                                          className="mono-font text-[10px] text-green-700 hover:underline whitespace-nowrap" style={{ background:'none', border:'none', cursor:'pointer', padding:0 }}>↗ VIEW</button>
                                        <button
                                          onClick={() => {
                                            if (!window.confirm(`Remove ${d.name}?`)) return
                                            setOutcomes(prev => prev.map(x => x.id === o.id ? { ...x, docs: (x.docs||[]).filter((_,j)=>j!==i), updatedAt: new Date().toISOString() } : x))
                                          }}
                                          className="mono-font text-[10px] text-red-500 hover:text-red-700 transition-colors"
                                          title="Remove attachment">✕</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {/* Upload area */}
                                {docError[o.id] && (
                                  <p className="mono-font text-[10px] text-red-600 mb-2">⚠ {docError[o.id]}</p>
                                )}
                                <div className="flex items-center gap-2 flex-wrap">
                                  <label className={`mono-font text-[10px] tracking-widest px-3 py-1.5 border cursor-pointer transition-colors whitespace-nowrap ${docUploading[o.id] ? 'border-stone-300 text-stone-400' : 'border-green-700 text-green-700 hover:bg-green-50'}`}>
                                    {docUploading[o.id] ? 'UPLOADING…' : '+ ATTACH FILE'}
                                    <input type="file" className="hidden" disabled={!!docUploading[o.id]}
                                      accept=".pdf,.png,.jpg,.jpeg,.gif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
                                      onChange={async e => {
                                        const file = e.target.files?.[0]
                                        if (!file) return
                                        setDocUploading(prev => ({ ...prev, [o.id]: true }))
                                        setDocError(prev => ({ ...prev, [o.id]: null }))
                                        try {
                                          const stored = await uploadEvidence(o.id, file, covUser?.email || '')
                                          setOutcomes(prev => prev.map(x => x.id === o.id
                                            ? { ...x, docs: [...(x.docs||[]), stored], updatedAt: new Date().toISOString() }
                                            : x))
                                        } catch(err) {
                                          setDocError(prev => ({ ...prev, [o.id]: err.message }))
                                        } finally {
                                          setDocUploading(prev => ({ ...prev, [o.id]: false }))
                                          e.target.value = ''
                                        }
                                      }}
                                    />
                                  </label>
                                  <span className="mono-font text-[10px] text-stone-400">PDF, PNG, JPG, DOCX, XLSX, EML accepted</span>
                                </div>
                              </div>
                            )}

                            {/* 360 panel — full case detail */}
                            {case360Id === o.id && (
                              <div className="px-4 py-3 border-t border-stone-200" style={{ background: '#F5F1EA' }}>
                                <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">CASE 360 — {o.id}</div>
                                <div className="grid gap-x-6 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                                  {[
                                    ['MERCHANT',    o.merchant],
                                    ['AMOUNT',      o.amount],
                                    ['NETWORK',     o.network],
                                    ['REASON CODE', o.reasonCode],
                                    ['DATE FILED',  o.date ? new Date(o.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['STATUS',      (o.status || '').toUpperCase()],
                                    ['RESOLVED',    o.resolvedDate ? new Date(o.resolvedDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['MODE',        (o.mode || 'fi').toUpperCase()],
                                    ['PC DATE',     o.provCreditDate ? new Date(o.provCreditDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['PC ISSUED',   o.pcIssued ? 'YES ✓' : '—'],
                                    ['ESCALATION',  o.escalation ? o.escalation.replace('_',' ').toUpperCase() : '—'],
                                    ['DFA GRADE',   (() => { const g = estimateFundingGrade(o.reasonCode, o.amount, o); return g ? g.label : '—' })()],
                                    ['TRIAGE CLASS', (o.classification || '—').replace(/_/g,' ')],
                                    ['REPMT FILED',  o.submitDate ? new Date(o.submitDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'],
                                    ['ACQ REF #',    o.trackingRef || '—'],
                                    ['CONFIDENCE',  o.confidence || '—'],
                                  ].map(([label, val]) => (
                                    <div key={label}>
                                      <div className="mono-font text-[10px] tracking-widest text-stone-400">{label}</div>
                                      <div className="mono-font text-xs text-stone-700 mt-0.5">{val || '—'}</div>
                                    </div>
                                  ))}
                                </div>
                                {notesText(o.notes) && (
                                  <div className="mt-3 pt-3 border-t border-stone-200">
                                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">NOTES</div>
                                    <div className="display-font text-sm text-stone-600 italic">{notesText(o.notes)}</div>
                                  </div>
                                )}
                                <button onClick={() => setCase360Id(null)} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors mt-3">✕ CLOSE 360</button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                <button
                  onClick={() => { if (window.confirm('Clear all tracked cases?')) setOutcomes([]) }}
                  className="mono-font text-xs tracking-widest text-stone-400 hover:text-stone-600 transition-colors"
                >CLEAR LOG</button>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => exportDFACSV(trackerOutcomes)}
                    className="flex items-center gap-2 mono-font text-xs tracking-widest text-emerald-800 hover:text-emerald-900 border border-emerald-700 px-3 py-2 hover:bg-emerald-50 transition-colors"
                    style={{ background: '#FAF7F1' }}
                    title="Export pending cases as a DFA-ready CSV — upload directly to the Dispute Funding Assessor"
                  >
                    <Download className="w-3.5 h-3.5" />
                    EXPORT TO DFA
                  </button>
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-2 mono-font text-xs tracking-widest text-stone-700 hover:text-stone-900 border border-stone-300 px-3 py-2 hover:border-stone-500 transition-colors"
                    style={{ background: '#FAF7F1' }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    EXPORT CSV
                  </button>
                </div>
              </div>
            </div>
        </>

        {/* ── Pre-arb draft panel ── */}
        {(preArbDraft || preArbLoading || preArbError) && (
          <>
            <div className="section-divider" />
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="mono-font text-xs text-stone-500 mb-1">PRE-ARBITRATION RESPONSE DRAFTER</div>
                  <div className="display-font font-semibold text-xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>
                    {preArbTargetId && 'Case ' + preArbTargetId}
                  </div>
                </div>
                <button onClick={() => { setPreArbDraft(null); setPreArbError(null); setPreArbTargetId(null) }}
                  className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors tracking-widest">✕ CLOSE</button>
              </div>

              {preArbLoading && (
                <div className="border border-stone-300 p-10 text-center" style={{ background: '#FAF7F1' }}>
                  <Loader2 className="w-6 h-6 text-stone-600 mx-auto mb-2 animate-spin" />
                  <p className="display-font text-stone-600 italic text-sm">Drafting pre-arbitration rebuttal…</p>
                </div>
              )}
              {preArbError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <span className="display-font text-sm text-red-900">{preArbError}</span>
                </div>
              )}

              {preArbDraft && <AiDraftNote record={draftAi.pre_arb} />}
              {preArbDraft && (
                <div className="space-y-5">
                  {/* Summary + win assessment */}
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="flex-1 min-w-0 border border-stone-300 p-4" style={{ background: '#FAF7F1' }}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">POSITION SUMMARY</div>
                      <p className="display-font text-stone-800 text-[14px] leading-relaxed">{preArbDraft.summary}</p>
                    </div>
                    <div className="border border-stone-300 p-4 text-center shrink-0" style={{ background: '#FAF7F1', minWidth: '130px' }}>
                      <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">WIN ASSESSMENT</div>
                      <div className={"mono-font text-sm font-bold px-2 py-1 " + (preArbDraft.win_assessment === 'STRONG' ? 'bg-emerald-900 text-emerald-50' : preArbDraft.win_assessment === 'MODERATE' ? 'bg-amber-800 text-amber-50' : 'bg-red-900 text-red-50')}>
                        {preArbDraft.win_assessment}
                      </div>
                      <p className="display-font text-stone-500 text-[12px] mt-2 leading-snug">{preArbDraft.win_note}</p>
                    </div>
                  </div>

                  {/* Rebuttal points */}
                  <div className="border-l-4 border-stone-900 bg-stone-50 p-5">
                    <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-3">REBUTTAL POINTS</div>
                    <div className="space-y-2">
                      {preArbDraft.rebuttal_points?.map((pt, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 leading-snug">
                          <span className="mono-font text-[11px] text-stone-500 shrink-0 mt-0.5">{i+1}.</span>
                          <span>{pt}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Evidence to attach */}
                  <div className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">EVIDENCE TO ATTACH</div>
                    <div className="flex flex-wrap gap-2">
                      {preArbDraft.evidence_to_attach?.map((e, i) => (
                        <span key={i} className="mono-font text-[10px] px-2 py-1 border border-stone-300 text-stone-700">{e}</span>
                      ))}
                    </div>
                  </div>

                  {/* Formal statement */}
                  <div className="border border-stone-900">
                    <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
                      <div className="mono-font text-[10px] tracking-widest text-stone-400">FORMAL PRE-ARB STATEMENT</div>
                      <button onClick={() => { navigator.clipboard.writeText(preArbDraft.formal_statement || ''); setPreArbCopied(true); setTimeout(() => setPreArbCopied(false), 2000) }}
                        className="mono-font text-[10px] flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors">
                        {preArbCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                      </button>
                    </div>
                    <div className="bg-white p-5">
                      {(preArbDraft.formal_statement || '').split('\n\n').map((para, i) => (
                        <p key={i} className={"display-font text-stone-800 text-[14px] leading-relaxed " + (i > 0 ? 'mt-3' : '')}>{para}</p>
                      ))}
                    </div>
                  </div>

                  {preArbDraft.filing_deadline_note && (
                    <div className="mono-font text-[11px] text-amber-800 tracking-wide">⚠ {preArbDraft.filing_deadline_note}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {platformMode === 'merchant' && (
          <>
            <div className="section-divider" />
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="mono-font text-xs text-stone-500">06</span>
                <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Chargeback Ratio Monitor</h2>
              </div>
              <p className="display-font text-stone-500 text-[15px] mb-4 ml-7">The same figures as Home: chargebacks in the last 30 days against Visa VAMP and Mastercard ECM. Set your monthly card sales and the thresholds in <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('cov:go', { detail: { section: 'settings', tab: 'settings' } }))} className="underline" style={{ background:'none', border:0, padding:0, cursor:'pointer', color:'#1A1814', font:'inherit' }}>Settings → Chargebacks against you</button>.</p>

              {(() => { const { ratios, demoSales } = ratiosFor(outcomes, rootSettings || settings, covUser); return <ChargebackRatioPanel ratios={ratios} demoSales={demoSales} /> })()}
            </div>
          </>
        )}

        {/* ── Footer ── */}
        <div className="section-divider" />
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between text-stone-600 gap-2">
          <div className="mono-font text-xs tracking-widest">BUILT BY ADEOTI FASHOKUN — RISK &amp; TRUST OPERATIONS</div>
          <div className="display-font italic text-sm">"Disputes resolve faster when the framework is written down."</div>
        </div>
      </div>
  )
}

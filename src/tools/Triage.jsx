// 001 TRIAGE — classify incoming claims (FI + Crypto Exchange)
// (Split out of Covalence.jsx — code unchanged; imports/exports added.)
import React, { useState, useEffect, useMemo } from 'react'
import { Shield, AlertTriangle, MessageSquare, Send, Loader2, Bitcoin, ArrowRight, AlertCircle, Lock, Check, Copy, CheckCircle, ExternalLink } from 'lucide-react'
import { SUPA_KEY, SUPA_URL } from '../data.js'
import { DEFAULT_SETTINGS, loadOutcomes } from '../shared.jsx'
import { EXPLAIN_RULES, EXPLAIN_JSON, aiRecord, aiDraftRecord, readAiJson } from '../ai.js'
import { AiExplain, AiDraftNote } from '../AiExplain.jsx'
import { readCases } from '../caseStore.js'
import { IntakeClose } from '../IntakeClose.jsx'
import { AlertsPanel } from '../AlertsPanel.jsx'
import { alertsSource } from '../sides.mjs'
import { AppClaims } from '../AppClaims.jsx'
import { setClaim } from '../claimsData.js'
import { CLAIM_TYPES, claimTotal } from '../claims.mjs'

// ═══════════════════════════════════════════════════════════════════════════════
// 001 TRIAGE VIEW — stub (full build next)
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// 001 TRIAGE — full view (FI + Crypto Exchange modes)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Transaction types per account type ──────────────────────────────────────
const TX_TYPES = {
  debit:   ['Card-Present (In-person)', 'Card-Not-Present (Online)', 'Card-Not-Present (Phone order)', 'Digital Payment / Wallet', 'ATM Withdrawal'],
  credit:  ['Card-Present (In-person)', 'Card-Not-Present (Online)', 'Card-Not-Present (Phone order)', 'Digital Payment / Wallet', 'Recurring / Subscription'],
  p2p:     ['Zelle', 'Interac e-Transfer', 'P2P (Venmo / Cash App / PayPal)', 'Wire Transfer'],
  ach_eft: ['ACH / EFT Transfer', 'Wire Transfer', 'Bill Payment (ACH)'],
  bnpl:    ['BNPL Purchase', 'Recurring / Subscription'],
  crypto:  ['Card-funded exchange purchase', 'Bank transfer to exchange', 'Wallet-to-wallet transfer', 'NFT marketplace purchase', 'Crypto investment platform deposit'],
}

// ── Known crypto exchanges / platforms for auto-detection ───────────────────
const CRYPTO_MERCHANTS = ['coinbase', 'binance', 'kraken', 'bitbuy', 'newton', 'ndax', 'shakepay', 'gemini', 'crypto.com', 'bybit', 'kucoin', 'bitfinex', 'opensea', 'rarible', 'blur', 'magic eden']
const isCryptoMerchantName = (name) => name && CRYPTO_MERCHANTS.some(k => name.toLowerCase().includes(k))

export function TriageView({ onHandoff, onGoToDuo, onSendToDuo, onCloseAtIntake, appOutcomes, setAppOutcomes, settings, covUser, fraudRoute, sides = ['issuer'] }) {
  // Two ways in: alerts the bank's monitoring raised, and claims customers report
  // Where Triage starts is an institution default (Settings → Default views)
  const [intakeTab, setIntakeTab] = useState(() => settings?.triageDefaultTab === 'claims' ? 'claims' : 'alerts')
  const pickIntake = setIntakeTab

  // ── 01 Transaction details ──────────────────────────────────────────────────
  const [accountType, setAccountType]         = useState('')
  const [merchant, setMerchant]               = useState('')
  const [supaPriorCases, setSupaPriorCases]   = useState([]) // enriched from Supabase
  const [amount, setAmount]                   = useState('')
  const [currency, setCurrency]               = useState('CAD')
  const [transactionDate, setTransactionDate] = useState('')
  const [transactionType, setTransactionType] = useState('')

  // ── 02 Claim & context ──────────────────────────────────────────────────────
  const [flaggedBy, setFlaggedBy]           = useState('')
  const [claimType, setClaimType]           = useState('')
  const [customerReason, setCustomerReason] = useState('')

  // ── 03 Risk signals — cardholder ────────────────────────────────────────────
  const [priorDisputes, setPriorDisputes]   = useState('')
  const [accountAge, setAccountAge]         = useState('')
  const [cardPossession, setCardPossession] = useState('')

  // ── 03 Risk signals — account integrity (ATO) ───────────────────────────────
  const [accountChanges, setAccountChanges]       = useState('')
  const [deviceRecognized, setDeviceRecognized]   = useState('')

  // ── 03 Risk signals — merchant (card-based only) ────────────────────────────
  const [vfmp, setVfmp]                                   = useState('')
  const [merchantDisputeRate, setMerchantDisputeRate]     = useState('')
  const [mccRisk, setMccRisk]                             = useState('')

  // ── Network (card-based + crypto) ───────────────────────────────────────────
  const [network, setNetwork] = useState('')

  // ── Crypto-specific signals ──────────────────────────────────────────────────
  const [cryptoScenario, setCryptoScenario]       = useState('')
  const [exchangeRegulated, setExchangeRegulated] = useState('')
  const [walletCustody, setWalletCustody]         = useState('')
  const [contactedExchange, setContactedExchange] = useState('')

  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState(null)
  const [exportCopied, setExportCopied] = useState(false)
  const [handedOff, setHandedOff]       = useState(false)
  const [triageSearch,    setTriageSearch]    = useState('')
  const [triageEditId,    setTriageEditId]    = useState(null)
  const [overridePickId,  setOverridePickId]  = useState(null)
  const [triageEditDraft, setTriageEditDraft] = useState({})

  // ── Channel mode: 'fi' = Financial Institution/card, 'ce' = Crypto Exchange ──
  const [triageChannelMode, setTriageChannelMode] = useState(() => ['fi', 'ce'].includes(settings?.triageDefaultSide) ? settings.triageDefaultSide : settings?.institutionType === 'exchange' ? 'ce' : 'fi')

  // ── Crypto Exchange (CE) mode state ─────────────────────────────────────────
  const [ceAccountType, setCeAccountType]               = useState('')
  const [ceAsset, setCeAsset]                           = useState('')
  const [ceChain, setCeChain]                           = useState('')
  const [ceTxType, setCeTxType]                         = useState('')
  const [ceAmount, setCeAmount]                         = useState('')
  const [ceCurrency, setCeCurrency]                     = useState('USD')
  const [ceTxDate, setCeTxDate]                         = useState('')
  const [ceDestinationType, setCeDestinationType]       = useState('')
  const [ceDestinationAddress, setCeDestinationAddress] = useState('')
  const [ceReceivingExchange, setCeReceivingExchange]   = useState('')
  const [ceCompromiseVector, setCeCompromiseVector]     = useState('')
  const [ceRecentAcctChanges, setCeRecentAcctChanges]   = useState('')
  const [ceDeviceNew, setCeDeviceNew]                   = useState('')
  const [cePriorClaims, setCePriorClaims]               = useState('')
  const [ceKycLevel, setCeKycLevel]                     = useState('')
  const [ceBlockchainTrace, setCeBlockchainTrace]       = useState('')
  const [ceCountry, setCeCountry]                       = useState('both')
  const [ceComplaint, setCeComplaint]                   = useState('')
  const [ceFlaggedBy, setCeFlaggedBy]                   = useState('')
  const [ceSarDeadlineDate, setCeSarDeadlineDate]       = useState('')
  const [ceActionPlan, setCeActionPlan]                 = useState(null)
  const [ceActionPlanLoading, setCeActionPlanLoading]   = useState(false)
  const [ceActionPlanError, setCeActionPlanError]       = useState(null)
  const [ceActionPlanCopied, setCeActionPlanCopied]     = useState(false)

  // ── CE Resolution tracking ───────────────────────────────────────────────
  const [ceResolution, setCeResolution] = useState({ status: '', actions: [], notes: '' })
  const CE_ACTIONS = [
    'Exchange freeze requested',
    'Chain analytics submitted',
    'SAR / STR filed',
    'Law enforcement referral',
    'Customer funds partially recovered',
    'Receiving exchange contacted',
    'Account suspended',
    'Case closed — no recovery',
  ]

  // ── Outcome tracking ────────────────────────────────────────────────────────
  const [outcomes, setOutcomes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('triage_outcomes') || '[]') } catch { return [] }
  })
  useEffect(() => {
    localStorage.setItem('triage_outcomes', JSON.stringify(outcomes))
  }, [outcomes])

  // ── Archive ──────────────────────────────────────────────────────────────────
  const [archivedOutcomes, setArchivedOutcomes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('triage_archive') || '[]') } catch { return [] }
  })
  useEffect(() => {
    localStorage.setItem('triage_archive', JSON.stringify(archivedOutcomes))
  }, [archivedOutcomes])
  const [showArchived, setShowArchived] = useState(false)
  const [verdictFilter, setVerdictFilter] = useState('all')

  // Archives only the log currently shown (FI or Crypto Exchange)
  const archiveAll = () => {
    if (!logOutcomes.length) return
    if (!window.confirm(`Archive all ${logOutcomes.length} ${logLabel} triage record${logOutcomes.length !== 1 ? 's' : ''}? They'll be hidden from the active log but recoverable.`)) return
    setArchivedOutcomes(prev => [...logOutcomes.map(o => ({ ...o, archivedAt: new Date().toISOString() })), ...prev])
    setOutcomes(prev => prev.filter(o => !inLogMode(o)))
  }

  const archiveOne = (id) => {
    const record = outcomes.find(o => o.id === id)
    if (!record) return
    setArchivedOutcomes(prev => [{ ...record, archivedAt: new Date().toISOString() }, ...prev])
    setOutcomes(prev => prev.filter(o => o.id !== id))
  }

  const unarchiveOne = (id) => {
    const record = archivedOutcomes.find(o => o.id === id)
    if (!record) return
    const { archivedAt, ...rest } = record
    setOutcomes(prev => [rest, ...prev])
    setArchivedOutcomes(prev => prev.filter(o => o.id !== id))
  }

  // ── Reset transaction type + network when account type changes ───────────────
  useEffect(() => {
    if (accountType && transactionType) {
      const validTypes = TX_TYPES[accountType] ?? []
      if (!validTypes.includes(transactionType)) setTransactionType('')
    }
    // Clear network if it's no longer valid for the new account type
    if (accountType === 'credit' && network === 'Interac') setNetwork('')
    if (accountType === 'debit' && ['Visa','Mastercard','American Express'].includes(network)) setNetwork('')
  }, [accountType])

  // ── Computed values ──────────────────────────────────────────────────────────
  const isCardBased     = accountType === 'debit' || accountType === 'credit'
  const isCrypto        = accountType === 'crypto'
  const detectedCrypto  = !isCrypto && isCryptoMerchantName(merchant)
  const showNetworkSel  = isCardBased || isCrypto

  const daysSinceTransaction = transactionDate
    ? Math.floor((Date.now() - new Date(transactionDate).getTime()) / 86400000)
    : null

  const fpfRiskScore = useMemo(() => {
    let s = 40
    if (priorDisputes === '3–5')        s += 15
    if (priorDisputes === '5+')         s += 25
    if (priorDisputes === '1–2')        s +=  5
    if (priorDisputes === 'None')       s -= 20
    if (accountAge === 'Under 6 months') s += 15
    if (accountAge === '6–12 months')    s +=  5
    if (accountAge === '3+ years')       s -= 15
    if (cardPossession === 'Yes — card in hand')      s += 12
    if (cardPossession === 'No — card lost or stolen') s -= 15
    if (flaggedBy === 'System alert (fraud detection)')  s -= 20
    if (flaggedBy?.includes('Customer-reported'))        s +=  5
    if (daysSinceTransaction !== null && daysSinceTransaction > 60) s += 15
    if (daysSinceTransaction !== null && daysSinceTransaction <= 7) s -= 10
    if (accountChanges?.includes('Yes')) s += 8
    if (deviceRecognized?.includes('New')) s -= 10
    if (merchantDisputeRate === 'High (over 2%)') s -= 15
    if (vfmp === 'Yes — VFMP listed')              s -= 15
    if (mccRisk?.includes('High'))                 s -= 10
    return Math.max(0, Math.min(100, Math.round(s)))
  }, [priorDisputes, accountAge, cardPossession, flaggedBy, daysSinceTransaction, accountChanges, deviceRecognized, merchantDisputeRate, vfmp, mccRisk])

  // ── Velocity / duplicate detection (Task 12) ──────────────────────────────
  const velocityWarning = useMemo(() => {
    if (!merchant && !amount) return null
    const window14  = new Date(Date.now() - 14 * 86400000)
    const window7   = new Date(Date.now() - 7  * 86400000)
    const recentAll = outcomes.filter(o => new Date(o.date) > window14)
    // Same merchant in last 14 days
    const sameMerchant = merchant
      ? recentAll.filter(o => (o.merchant || '').toLowerCase() === merchant.toLowerCase())
      : []
    // Same amount (exact string match) in last 7 days
    const amtStr = amount ? `${amount} ${currency}` : null
    const sameAmt = amtStr
      ? outcomes.filter(o => new Date(o.date) > window7 && o.amount === amtStr)
      : []
    // Same account type in last 7 days (velocity by channel)
    const sameType = accountType
      ? outcomes.filter(o => new Date(o.date) > window7 && o.accountType === accountType)
      : []
    const warnings = []
    if (sameMerchant.length >= 2)
      warnings.push({ level: 'HIGH', text: `${sameMerchant.length} claims against "${merchant}" in the last 14 days — possible merchant-level fraud pattern or repeat dispute abuse.` })
    else if (sameMerchant.length === 1)
      warnings.push({ level: 'MEDIUM', text: `1 prior claim against "${merchant}" in the last 14 days — check for repeat dispute pattern.` })
    if (sameAmt.length >= 2)
      warnings.push({ level: 'HIGH', text: `${sameAmt.length} claims for exactly ${amtStr} in the last 7 days — possible split-transaction fraud or duplicate submission.` })
    if (sameType.length >= 5)
      warnings.push({ level: 'MEDIUM', text: `${sameType.length} ${accountType} claims in the last 7 days — elevated channel velocity. Review for coordinated fraud.` })
    return warnings.length > 0 ? warnings : null
  }, [merchant, amount, currency, accountType, outcomes])

  const regFramework =
    accountType === 'debit' || accountType === 'ach_eft' ? 'REG_E' :
    accountType === 'credit'                             ? 'REG_Z' :
    accountType === 'p2p'                                ? 'PROVIDER' :
    accountType === 'bnpl'                               ? 'REG_Z_PROVIDER' :
    accountType === 'crypto'                             ? 'CRYPTO' : null

  const regLabel =
    regFramework === 'REG_E'          ? 'REG E'            :
    regFramework === 'REG_Z'          ? 'REG Z'            :
    regFramework === 'PROVIDER'       ? 'PROVIDER-HANDLED' :
    regFramework === 'REG_Z_PROVIDER' ? 'REG Z / PROVIDER' :
    regFramework === 'CRYPTO'         ? 'CRYPTO / DIGITAL ASSET' : null

  const regSubtext =
    regFramework === 'REG_E'          ? 'Debit / EFT — Electronic Fund Transfer Act applies' :
    regFramework === 'REG_Z'          ? 'Credit — Truth in Lending Act / network chargeback rules apply' :
    regFramework === 'PROVIDER'       ? 'No network chargeback path — contact recipient FI or network' :
    regFramework === 'REG_Z_PROVIDER' ? 'BNPL — dispute through provider, not card network' :
    regFramework === 'CRYPTO'         ? 'No blanket network protection — coverage depends on payment method used and exchange policies' : null

  const regColor =
    regFramework === 'REG_E'    ? { bg: '#1E3A8A', text: '#BFDBFE' } :
    regFramework === 'REG_Z'    ? { bg: '#4C1D95', text: '#DDD6FE' } :
    regFramework === 'CRYPTO'   ? { bg: '#064E3B', text: '#6EE7B7' } :
                                  { bg: '#374151', text: '#D1D5DB' }

  // ── CE computed values ───────────────────────────────────────────────────────
  // Enrich prior disputes from Supabase when result + merchant are available
  React.useEffect(() => {
    if (!result || !merchant || merchant === '—' || !SUPA_URL || !SUPA_KEY) { setSupaPriorCases([]); return }
    const norm = merchant.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (norm.length < 3) return
    // The workspace's cases are already synced into this browser (Covalence.jsx pulls them)
    setSupaPriorCases(loadOutcomes())
  }, [result, merchant])

  const isCE           = triageChannelMode === 'ce'
  const ceDaysSince    = ceTxDate ? Math.floor((Date.now() - new Date(ceTxDate).getTime()) / 86400000) : null
  const ceAmountNum    = parseFloat(ceAmount) || 0
  const ceSarFlagUS    = ceAmountNum >= 5000  && (ceCountry === 'us'   || ceCountry === 'both') && ceCurrency === 'USD'
  const ceStrFlagCA    = ceAmountNum >= 10000 && (ceCountry === 'ca'   || ceCountry === 'both') && ceCurrency === 'CAD'
  const ceSarRequired  = ceSarFlagUS || ceStrFlagCA
  const ceSarDeadlineRaw = ceSarDeadlineDate
    ? new Date(new Date(ceSarDeadlineDate).getTime() + 30 * 86400000)
    : null
  const ceSarDeadline  = ceSarDeadlineRaw ? ceSarDeadlineRaw.toLocaleDateString('en-CA') : null
  const ceSarDaysLeft  = ceSarDeadlineRaw ? Math.ceil((ceSarDeadlineRaw - new Date()) / 86400000) : null
  const ceRegLabel     = ceCountry === 'us' ? 'FINCEN / FinCEN MSB' : ceCountry === 'ca' ? 'FINTRAC / PCMLTFA' : 'FinCEN (US) + FINTRAC (CA)'
  const ceRegSubtext   = ceCountry === 'us'
    ? 'FinCEN registration required; SAR if suspicious activity ≥ $5,000 USD'
    : ceCountry === 'ca'
    ? 'FINTRAC STR required for suspicious transactions; $10,000 CAD large cash threshold'
    : 'Dual jurisdiction — FinCEN SAR ($5k USD) and FINTRAC STR ($10k CAD) obligations apply'

  const provisionalCreditApplies = regFramework === 'REG_E' && result &&
    (result.classification === 'TRUE_FRAUD' || result.classification === 'AUTHORIZED_PUSH_PAYMENT')

  const weightStyle = (w) =>
    w === 'HIGH'   ? { bg: '#1A1814', text: '#F5F1EA' } :
    w === 'MEDIUM' ? { bg: '#6B5F4D', text: '#FAF7F1' } :
                     { bg: '#D4CCBC', text: '#1A1814' }

  const classConfig = {
    TRUE_FRAUD: {
      bg: '#064E3B', text: '#D1FAE5', badge: '#065F46', badgeText: '#6EE7B7',
      borderColor: '#065F46', label: 'TRUE FRAUD', Icon: Shield,
    },
    FIRST_PARTY_FRAUD: {
      bg: '#7F1D1D', text: '#FEE2E2', badge: '#991B1B', badgeText: '#FCA5A5',
      borderColor: '#991B1B', label: 'FIRST-PARTY FRAUD', Icon: AlertTriangle,
    },
    CONSUMER_DISPUTE: {
      bg: '#78350F', text: '#FEF3C7', badge: '#92400E', badgeText: '#FCD34D',
      borderColor: '#92400E', label: 'CONSUMER DISPUTE', Icon: MessageSquare,
    },
    AUTHORIZED_PUSH_PAYMENT: {
      bg: '#1E3A5F', text: '#BFDBFE', badge: '#1D4ED8', badgeText: '#93C5FD',
      borderColor: '#1D4ED8', label: 'AUTH. PUSH PAYMENT', Icon: Send,
    },
  }

  const cfg = result ? classConfig[result.classification] : null

  // The outcome log follows the FI / Crypto Exchange toggle — each mode has its own log and stats
  const inLogMode      = o => isCE ? o.accountType === 'crypto_exchange' : o.accountType !== 'crypto_exchange'
  const logOutcomes    = outcomes.filter(inLogMode)
  const logArchived    = archivedOutcomes.filter(inLogMode)
  const logLabel       = isCE ? 'Crypto Exchange' : 'FI'
  const resolved       = logOutcomes.filter(o => o.outcome !== 'pending')
  const confirmedCount = logOutcomes.filter(o => o.outcome === 'confirmed').length
  const accuracy       = resolved.length > 0 ? Math.round((confirmedCount / resolved.length) * 100) : null
  const vcounts = {
    TRUE_FRAUD:              logOutcomes.filter(o => o.verdict === 'TRUE_FRAUD').length,
    FIRST_PARTY_FRAUD:       logOutcomes.filter(o => o.verdict === 'FIRST_PARTY_FRAUD').length,
    CONSUMER_DISPUTE:        logOutcomes.filter(o => o.verdict === 'CONSUMER_DISPUTE').length,
    AUTHORIZED_PUSH_PAYMENT: logOutcomes.filter(o => o.verdict === 'AUTHORIZED_PUSH_PAYMENT').length,
  }
  const leadingVerdict = Object.entries(vcounts).sort((a, b) => b[1] - a[1])[0]
  const leadingLabel   = leadingVerdict[1] > 0
    ? (classConfig[leadingVerdict[0]]?.label ?? leadingVerdict[0].split('_').join(' '))
    : '—'

  // ── Classify (FI mode) ───────────────────────────────────────────────────────
  const classify = async () => {
    if (!customerReason.trim()) { setError("Customer's stated reason is required."); return }
    setLoading(true); setError(null); setResult(null)

    const accountTypeLabel = { debit: 'Debit Card', credit: 'Credit Card', p2p: 'P2P / e-Transfer', ach_eft: 'ACH / EFT', bnpl: 'BNPL (Buy Now Pay Later)', crypto: 'Crypto / Digital Asset' }[accountType] ?? 'Not specified'
    const daysNote = daysSinceTransaction !== null ? `${daysSinceTransaction} days ago (transaction date: ${transactionDate})` : 'Unknown'

    const _s = (() => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cov_settings') || '{}') } } catch { return { ...DEFAULT_SETTINGS } } })()
    const instType = { bank:'Bank', credit_union:'Credit Union', fintech:'Fintech / Neo-bank', mse:'Money Service Business', exchange:'Crypto Exchange' }[_s.institutionType] || 'Financial Institution'
    const jur = { us:'United States (FinCEN / Reg E)', ca:'Canada (FINTRAC / FCAC)', uk:'United Kingdom (FCA)', other:'Other jurisdiction' }[_s.jurisdiction] || 'jurisdiction not specified'
    const regime = { reg_e:'Reg E (EFTA)', fcac:'FCAC (Canada)', fca:'FCA (UK)', other:'mixed / other' }[_s.regulatoryRegime] || 'not specified'
    const sarByType = accountType === 'ach_eft' ? (_s.sarThresholdACH || 5000)
                    : accountType === 'p2p'     ? (_s.sarThresholdP2P || 5000)
                    : accountType === 'crypto'  ? (_s.sarThresholdCrypto || 10000)
                    : (_s.sarThreshold || 5000)
    const prompt = `You are an expert fraud and disputes triage analyst at a ${instType}. Classify this incoming dispute claim.

INSTITUTION CONTEXT:
- Institution type: ${instType}
- Jurisdiction: ${jur}
- Consumer protection regime: ${regime}
- SAR/STR threshold for this payment type: $${sarByType.toLocaleString()}
- Small-dollar write-off threshold: $${_s.smallDollarThreshold || 50}

FOUR VERDICT DEFINITIONS:
- TRUE_FRAUD: A third party used the account/card without the cardholder's knowledge or consent. Genuine victim of unauthorized access or card compromise.
- FIRST_PARTY_FRAUD: The cardholder made the transaction themselves and is falsely disputing it. Friendly fraud / chargeback abuse.
- CONSUMER_DISPUTE: Cardholder made the transaction legitimately but has a genuine grievance — non-receipt, item not as described, cancelled subscription, credit not processed, service failure, or misrepresentation.
- AUTHORIZED_PUSH_PAYMENT: Cardholder deliberately authorized and initiated the payment but was deceived into doing so via social engineering (romance scam, fake invoice, buyer-seller fraud, investment scam, impersonation). They believed it was legitimate. Applies primarily to Zelle, Interac e-Transfer, wire transfers, and P2P payments.

ACCOUNT & TRANSACTION:
- Account Type: ${accountTypeLabel}
- Regulatory Framework: ${regFramework ?? 'Unknown'}
- Payment Network: ${network || 'Not specified'}
- ${isCrypto ? 'Destination Wallet / Platform' : 'Merchant / Recipient'}: ${merchant || 'Not provided'}
- Amount: ${amount ? `${amount} ${currency}` : 'Not provided'}
- Transaction occurred: ${daysNote}
- Transaction Type: ${transactionType || 'Not provided'}${(isCrypto || detectedCrypto) ? `
- Crypto / Digital Asset detected: YES
- Crypto Fraud Scenario: ${cryptoScenario || 'Not specified'}
- Exchange Regulated: ${exchangeRegulated || 'Unknown'}
- Wallet Custody: ${walletCustody || 'Unknown'}
- Customer Contacted Exchange First: ${contactedExchange || 'Unknown'}` : ''}

CLAIM:
- How flagged: ${flaggedBy || 'Not provided'}
- Claim type (agent hint): ${claimType || 'Not specified'}
- Customer's stated reason: ${customerReason}

CARDHOLDER RISK SIGNALS:
- Prior disputes (12 months): ${priorDisputes || 'Unknown'}
- Account age: ${accountAge || 'Unknown'}
${isCardBased ? `- Card in possession when reported: ${cardPossession || 'Unknown'}` : '- Physical card: N/A (non-card payment rail)'}

ACCOUNT INTEGRITY SIGNALS:
- Recent account changes: ${accountChanges || 'Unknown'}
- Device / location at time of transaction: ${deviceRecognized || 'Unknown'}

${isCardBased ? `MERCHANT RISK SIGNALS:
- VFMP listed: ${vfmp || 'Unknown'}
- Merchant dispute rate: ${merchantDisputeRate || 'Unknown'}
- MCC risk tier: ${mccRisk || 'Unknown'}` : `MERCHANT SIGNALS: N/A — non-card payment rail.`}

INTAKE DISPOSITION — not every claim is a dispute. Also say what should happen next:
- PROCEED: there are dispute or fraud-claim rights; build the case.
- CLOSE_RECOGNIZED: the customer's own account suggests they made or allowed the transaction and are not really disputing it.
- CLOSE_ALREADY_CREDITED: the customer says the merchant has already refunded or credited it.
- CLOSE_NO_DISPUTE_RIGHTS: no chargeback or Reg E error rights apply — e.g. a wire, Zelle or P2P payment the customer sent themselves (even if they were scammed), or a claim clearly outside the time limit.
- CORRECT_BANK_ERROR: the institution itself made the error (duplicate posting, wrong amount posted by the bank).
- REFER_TO_COMPLIANCE: not a dispute, but the activity suggests money laundering, a mule account or other suspicious activity by the customer.
${EXPLAIN_RULES}

Return ONLY valid JSON, no markdown. Include ALL fields:
{
  "classification": "TRUE_FRAUD" | "FIRST_PARTY_FRAUD" | "CONSUMER_DISPUTE" | "AUTHORIZED_PUSH_PAYMENT",
  "fraud_sub_type": "LOST_STOLEN | CNP_FRAUD | COUNTERFEIT_SKIMMING | ATO_CARD_COMPROMISE | NRI_NEVER_RECEIVED | SYNTHETIC_IDENTITY | UNKNOWN_THIRD_PARTY | FRIENDLY_FRAUD | CHARGEBACK_ABUSE | RETURN_ABUSE | NOT_AS_DESCRIBED | NON_RECEIPT | CANCELLED_SUBSCRIPTION | CREDIT_NOT_PROCESSED | SERVICE_FAILURE | BILLING_ERROR | ROMANCE_SCAM | INVESTMENT_SCAM | FAKE_INVOICE_FRAUD | IMPERSONATION_SCAM | BUYER_SELLER_FRAUD | GRANDPARENT_SCAM | OTHER_APP_SCAM",
  "fraud_sub_label": "Short human-readable label, e.g. 'Card-Not-Present Fraud'",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "label": "True Fraud" | "First-Party Fraud" | "Consumer Dispute" | "Authorized Push Payment",
  "headline": "One tight sentence summarizing the assessment.",
  "provisional_credit_rec": "ISSUE_IMMEDIATELY" | "ISSUE_CONDITIONALLY" | "HOLD_PENDING_INVESTIGATION" | "NOT_APPLICABLE",
  "provisional_credit_note": "1–2 sentences on PC recommendation, conditions, and timeline.",
  "ato_suspected": true | false,
  "ato_note": "Brief ATO note if suspected, else empty string.",
  "routing": "CARD_CHARGEBACK" | "NACHA_RETURN" | "RECIPIENT_FI" | "PROVIDER_DISPUTE" | "FLAG_INVESTIGATION" | "GOODWILL_FIRST",
  "routing_label": "Human-readable routing label",
  "routing_detail": "1–2 sentences on what the agent should do next.",
  "signals": ["Signal 1", "Signal 2", "Signal 3"],
  "signal_influences": [
    { "signal": "signal text", "weight": "HIGH" | "MEDIUM" | "LOW", "toward": "TRUE_FRAUD" | "FIRST_PARTY_FRAUD" | "CONSUMER_DISPUTE" | "AUTHORIZED_PUSH_PAYMENT" }
  ],
  "risk_notes": "Caveats or watch-outs — or empty string.",
  "proceed_to_dispute": true | false,
  "intake_disposition": "PROCEED" | "CLOSE_RECOGNIZED" | "CLOSE_ALREADY_CREDITED" | "CLOSE_NO_DISPUTE_RIGHTS" | "CORRECT_BANK_ERROR" | "REFER_TO_COMPLIANCE",
  "disposition_reason": "1–2 sentences: why this disposition, citing the rail, timing or what the customer said.",
  ${EXPLAIN_JSON}
}`

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 65000)   // the server gives up at 55 s
      let response
      try {
        response = await fetch('/api/triage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2400, messages: [{ role: 'user', content: prompt }] }),
          signal: controller.signal,
        })
      } finally { clearTimeout(timeoutId) }
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const parsed = readAiJson(data)
      parsed._ai = aiRecord('triage_fi', {
        data, answer: parsed.classification, confidence: parsed.confidence, summary: parsed.headline, explanation: parsed.explanation,
        factors: (parsed.signal_influences || []).map(x => ({ factor: x.signal, weight: x.weight, toward: x.toward })),
        inputs: { institutionType: instType, jurisdiction: jur, accountType: accountTypeLabel, regFramework, network, merchant, amount: amount ? `${amount} ${currency}` : '',
          transactionDate: daysNote, transactionType, flaggedBy, claimType, customerReason, priorDisputes, accountAge, cardPossession: isCardBased ? cardPossession : '',
          accountChanges, deviceRecognized, vfmp: isCardBased ? vfmp : '', merchantDisputeRate: isCardBased ? merchantDisputeRate : '', mccRisk: isCardBased ? mccRisk : '',
          cryptoScenario, exchangeRegulated, walletCustody, contactedExchange },
      })
      setResult(parsed)
      setOutcomes(prev => [{
        id: `COV-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        date: new Date().toISOString(),
        aiDecision: parsed._ai,
        merchant: merchant || '—',
        amount: amount ? `${amount} ${currency}` : '—',
        accountType, network: network || '',
        verdict: parsed.classification, confidence: parsed.confidence,
        routing: parsed.routing, outcome: 'pending',
        fraud_sub_type: parsed.fraud_sub_type || '',
      }, ...prev].slice(0, 100))
    } catch (e) {
      setError(`Classification failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Classify (CE mode) ───────────────────────────────────────────────────────
  const classifyCE = async () => {
    if (!ceComplaint.trim()) { setError("Customer's stated reason is required."); return }
    setLoading(true); setError(null); setResult(null)

    const daysNote = ceDaysSince !== null ? `${ceDaysSince} days ago (${ceTxDate})` : 'Unknown'
    const sarNote  = ceSarRequired
      ? `⚠ SAR/STR THRESHOLD MET — ${ceSarFlagUS ? `FinCEN SAR required ($${ceAmountNum.toLocaleString()} USD ≥ $5,000)` : ''}${ceSarFlagUS && ceStrFlagCA ? ' + ' : ''}${ceStrFlagCA ? `FINTRAC STR required ($${ceAmountNum.toLocaleString()} CAD ≥ $10,000)` : ''}`
      : 'Below SAR/STR threshold'

    const prompt = `You are a senior fraud analyst at a crypto exchange / digital asset platform. Triage this incoming fraud or dispute claim. You operate under FinCEN (US) and/or FINTRAC (Canada) obligations as a Money Services Business.

FOUR VERDICT DEFINITIONS:
- TRUE_FRAUD: Unauthorized third-party access — ATO, SIM-swap, credential phishing, API key theft. Customer did NOT authorize the transaction.
- FIRST_PARTY_FRAUD: Customer authorized transactions themselves but is falsely claiming fraud — typically after a losing trade, price drop, or buyer's remorse.
- CONSUMER_DISPUTE: Customer authorized the transaction but has a legitimate grievance — trade execution error, withdrawal delay, incorrect fee, locked account, asset not credited, platform malfunction.
- AUTHORIZED_PUSH_PAYMENT: Customer was socially engineered into sending crypto voluntarily — pig butchering, romance scam, fake exchange impersonation. Customer believed the transfer was legitimate.

EXCHANGE ACCOUNT:
- Account Type: ${ceAccountType || 'Not specified'}
- KYC Level: ${ceKycLevel || 'Unknown'}
- Prior Claims (12 months): ${cePriorClaims || 'Unknown'}
- Flagged by: ${ceFlaggedBy || 'Not specified'}

TRANSACTION:
- Asset: ${ceAsset || 'Not specified'}
- Blockchain: ${ceChain || 'Not specified'}
- Transaction Type: ${ceTxType || 'Not specified'}
- Amount: ${ceAmount ? `${ceAmount} ${ceCurrency}` : 'Not specified'}
- SAR/STR Status: ${sarNote}
- Transaction occurred: ${daysNote}
- Destination type: ${ceDestinationType || 'Unknown'}
${ceDestinationAddress ? `- Destination: ${ceDestinationAddress}` : ''}
${ceReceivingExchange ? `- Receiving exchange: ${ceReceivingExchange}` : ''}

COMPROMISE SIGNALS:
- Suspected compromise vector: ${ceCompromiseVector || 'Unknown'}
- Recent account changes: ${ceRecentAcctChanges || 'Unknown'}
- Device / location: ${ceDeviceNew || 'Unknown'}
- Blockchain trace: ${ceBlockchainTrace || 'Unknown'}

CUSTOMER STATEMENT:
${ceComplaint}

REGULATORY: ${ceRegLabel}
${ceSarRequired ? '⚠ SAR/STR filing obligation triggered' : 'No automatic threshold triggered'}
${EXPLAIN_RULES}

Return ONLY valid JSON, no markdown:
{
  "classification": "TRUE_FRAUD" | "FIRST_PARTY_FRAUD" | "CONSUMER_DISPUTE" | "AUTHORIZED_PUSH_PAYMENT",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "label": "True Fraud" | "First-Party Fraud" | "Consumer Dispute" | "Authorized Push Payment",
  "headline": "One tight sentence summarizing the triage assessment.",
  "signals": ["Signal 1", "Signal 2", "Signal 3"],
  "signal_influences": [{ "signal": "...", "weight": "HIGH"|"MEDIUM"|"LOW", "toward": "..." }],
  "ato_suspected": true | false,
  "ato_note": "ATO note or empty string.",
  "sar_note": "${ceSarRequired ? 'SAR/STR filing required.' : ''}",
  "routing": "ACCOUNT_FREEZE" | "EXCHANGE_CONTACT" | "LEA_REFERRAL" | "INTERNAL_REVIEW" | "FLAG_INVESTIGATION",
  "routing_label": "Human-readable routing label",
  "routing_detail": "2–3 sentences on exact next steps.",
  "risk_notes": "Watch-outs or empty string.",
  "proceed_to_dispute": true | false,
  ${EXPLAIN_JSON}
}`

    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      const parsed = readAiJson(data)
      parsed._ai = aiRecord('triage_ce', {
        data, answer: parsed.classification, confidence: parsed.confidence, summary: parsed.headline, explanation: parsed.explanation,
        factors: (parsed.signal_influences || []).map(x => ({ factor: x.signal, weight: x.weight, toward: x.toward })),
        inputs: { accountType: ceAccountType, kycLevel: ceKycLevel, priorClaims: cePriorClaims, flaggedBy: ceFlaggedBy, asset: ceAsset, chain: ceChain,
          transactionType: ceTxType, amount: ceAmount ? `${ceAmount} ${ceCurrency}` : '', sarStatus: sarNote, transactionDate: daysNote, destinationType: ceDestinationType,
          destination: ceDestinationAddress, receivingExchange: ceReceivingExchange, compromiseVector: ceCompromiseVector, recentAccountChanges: ceRecentAcctChanges,
          device: ceDeviceNew, blockchainTrace: ceBlockchainTrace, customerStatement: ceComplaint, regulatory: ceRegLabel },
      })
      setResult(parsed)
      setOutcomes(prev => [{
        id: `COV-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        date: new Date().toISOString(),
        aiDecision: parsed._ai,
        merchant: ceReceivingExchange || ceDestinationAddress || '—',
        amount: ceAmount ? `${ceAmount} ${ceCurrency}` : '—',
        accountType: 'crypto_exchange', network: ceChain || ceAsset || '',
        verdict: parsed.classification, confidence: parsed.confidence,
        routing: parsed.routing, outcome: 'pending',
      }, ...prev].slice(0, 100))
    } catch (e) {
      setError(`Classification failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── CE action plan ───────────────────────────────────────────────────────────
  const generateCEActionPlan = async () => {
    if (!result) return
    setCeActionPlanLoading(true); setCeActionPlanError(null); setCeActionPlan(null); setCeResolution({ status: '', actions: [], notes: ''  })
    const prompt = `You are a senior fraud operations analyst at a crypto exchange. Based on this triage classification, generate a complete operational action plan.

INCIDENT: ${result.classification} — ${result.label}
Headline: ${result.headline}
Routing: ${result.routing} — ${result.routing_label}
Asset: ${ceAsset || 'Not specified'}${ceChain ? ' on ' + ceChain : ''}
Amount: ${ceAmount ? ceAmount + ' ' + ceCurrency : 'Not specified'}
Destination: ${ceDestinationAddress || 'Not specified'}
Receiving Exchange: ${ceReceivingExchange || 'Unknown'}
Compromise Vector: ${ceCompromiseVector || 'Unknown'}
Jurisdiction: ${ceCountry === 'us' ? 'United States (FinCEN/BSA)' : ceCountry === 'ca' ? 'Canada (FINTRAC/PCMLTFA)' : 'US + Canada'}
SAR Status: ${ceSarRequired ? '⚠ THRESHOLD MET — filing obligation triggered' : 'Below automatic threshold'}
Customer: ${ceComplaint}

Return ONLY valid JSON:
{
  "immediate_actions": ["..."],
  "investigation_steps": ["..."],
  "evidence_required": { "internal": ["..."], "external": ["..."], "blockchain": ["..."] },
  "sar_required": true | false,
  "sar_note": "...",
  "lea_referral_recommended": true | false,
  "lea_note": "...",
  "exchange_contact_required": true | false,
  "exchange_note": "...",
  "recovery_outlook": "HIGH" | "MODERATE" | "LOW" | "VERY_LOW",
  "recovery_note": "...",
  "customer_letter": { "subject": "...", "body": "..." }
}`
    try {
      const response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      const data = await response.json()
      setCeActionPlan({ ...readAiJson(data), _ai: aiDraftRecord('ce_plan', data) })
    } catch (e) {
      setCeActionPlanError(`Action plan failed: ${e.message}`)
    } finally {
      setCeActionPlanLoading(false)
    }
  }

  // ── A claim from the bank's app: fill the form from what the customer told the app ──
  const [activeClaim, setActiveClaim] = useState(null)
  const fillFromClaim = (c) => {
    const d = c.data || {}, tx = d.transactions || [], first = tx[0] || {}
    const answers = Object.entries(d.answers || {}).map(([q, a]) => `${q.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}: ${a === true ? 'yes' : a === false ? 'no' : a}`)
    const story = [d.statement, answers.length ? `Answers in the app — ${answers.join('; ')}.` : '', tx.length > 1 ? `${tx.length} transactions: ${tx.map(t => `${t.merchant || t.id} ${t.amount}`).join(', ')}.` : ''].filter(Boolean).join('\n')
    const total = claimTotal(d).toFixed(2), date = first.ts ? first.ts.slice(0, 10) : ''
    setResult(null); setError(null); setHandedOff(false)
    if ((c.segment || 'fi') === 'ce') {
      setCeAmount(total); setCeCurrency(first.currency || 'USD'); setCeTxDate(date); setCeComplaint(story); setCeFlaggedBy(['agent', 'phone'].includes(c.channel) ? 'Customer-reported (phone / live agent)' : 'Customer-reported (app / support ticket)')
    } else {
      const t = d.customer?.accountType || ''
      setAccountType(t); setMerchant(first.merchant || ''); setAmount(total); setCurrency(first.currency || 'USD'); setTransactionDate(date)
      setFlaggedBy(['agent', 'phone'].includes(c.channel) ? 'Customer-reported (inbound call)' : 'Customer-reported (app / self-serve)')
      setClaimType(CLAIM_TYPES[d.claimType] && d.claimType !== 'other' ? d.claimType : '')
      const ch = (first.channel || '').toLowerCase()
      if (['debit', 'credit'].includes(t) && /not_present|online|cnp|ecom/.test(ch)) setTransactionType('Card-Not-Present (Online)')
      else if (['debit', 'credit'].includes(t) && /present|pos|chip|tap/.test(ch)) setTransactionType('Card-Present (In-person)')
      else if (t === 'p2p' && /zelle/.test(ch)) setTransactionType('Zelle')
      setCustomerReason(story)
      if (d.answers?.cardInPossession === true) setCardPossession('Yes — card in hand')
      if (d.answers?.cardInPossession === false) setCardPossession('No — card lost or stolen')
      const n = (first.network || '').toLowerCase()
      const net = n.includes('visa') ? 'Visa' : n.includes('master') ? 'Mastercard' : n.includes('amex') || n.includes('american') ? 'American Express' : n.includes('interac') ? 'Interac' : ''
      if (net) setNetwork(t === 'credit' || net === 'Interac' ? net : net === 'American Express' ? '' : `${net} (Debit)`)
    }
    setActiveClaim(c)
    setTimeout(() => document.getElementById('triage-claim-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const claimIntake = () => activeClaim ? { claimId: activeClaim.id, reference: activeClaim.external_id, channel: activeClaim.channel, reportedAt: activeClaim.reported_at } : undefined
  const moveClaim = (status, opts) => {
    if (!activeClaim) return
    setClaim(activeClaim.id, status, opts).then(() => window.dispatchEvent(new Event('cov:claims-changed'))).catch(() => {})
    setActiveClaim(null)
  }

  const reloadCase = (o) => {
    if (o.merchant && o.merchant !== '—') setMerchant(o.merchant)
    if (o.amount && o.amount !== '—') {
      const parts = (o.amount || '').split(' ')
      if (parts[0]) setAmount(parts[0])
      if (parts[1]) setCurrency(parts[1])
    }
    if (o.network) setNetwork(o.network.toLowerCase())
    setResult(null); setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const markOutcome = (id, val, correctedVerdict) =>
    setOutcomes(prev => prev.map(o => o.id === id ? { ...o, outcome: val, ...(correctedVerdict ? { correctedVerdict } : {}) } : o))

  const exportReport = () => {
    if (!result) return
    const caseId = outcomes[0]?.id ?? '—'
    const lines = [
      `TRIAGE REPORT — ${caseId}`,
      `Generated: ${new Date().toLocaleString()}`,
      '',
      `VERDICT: ${cfg?.label ?? result.classification}`,
      `Confidence: ${result.confidence}`,
      `Headline: ${result.headline}`,
      '',
      `ROUTING: ${result.routing_label}`,
      `Next Steps: ${result.routing_detail}`,
      '',
      'KEY SIGNALS',
      ...(result.signals?.map(s => `  → ${s}`) ?? []),
      result.ato_suspected ? `\nATO SUSPECTED: ${result.ato_note}` : '',
      result.risk_notes ? `\nWATCH FOR: ${result.risk_notes}` : '',
      `\nFPF RISK SCORE: ${fpfRiskScore}/100`,
    ].filter(l => l !== '').join('\n')
    navigator.clipboard.writeText(lines).then(() => {
      setExportCopied(true)
      setTimeout(() => setExportCopied(false), 2000)
    })
  }

  // ── Close at intake: not every claim is a dispute ───────────────────────────
  const [closing, setClosing] = useState(false)
  const closeAtIntake = (d) => {
    const rec = outcomes[0]
    if (!rec || !result) return
    const now = new Date().toISOString()
    setOutcomes(prev => prev.map(o => o.id === rec.id ? { ...o, outcome: 'closed_intake', intakeClose: { reason: d.reason, reasonLabel: d.reasonLabel, toLicit: d.toLicit, ts: now } } : o))
    onCloseAtIntake?.({
      id: rec.id, date: rec.date || now, merchant: merchant || '—', amount: amount ? `${amount} ${currency}` : '—', network: network || '',
      accountType, verdict: result.classification, confidence: result.confidence, status: d.status, resolvedDate: now,
      cardholderName: d.customer || undefined, _complaint: customerReason, _transactionDate: transactionDate,
      aiDecisions: rec.aiDecision ? [rec.aiDecision] : [],
      closedAtIntake: { reason: d.reason, reasonLabel: d.reasonLabel, basis: d.basis, basisLabel: d.basisLabel, note: d.note, notice: d.notice, ts: now,
        aiSuggested: result.intake_disposition || '' },
      ...(activeClaim ? { intake: claimIntake() } : {}),
    }, d)
    moveClaim('closed', { note: `Closed at intake: ${d.reasonLabel || d.reason}` })
    setClosing(false)
  }

  const handleProceedToDisputeDesk = () => {
    if (!result) return
    const caseId = outcomes[0]?.id ?? `T-${Date.now().toString(36).toUpperCase().slice(-5)}`
    if (isCE) {
      onHandoff({
        caseId,
        classification: result.classification,
        confidence: result.confidence,
        headline: result.headline,
        network: ceAsset ? `${ceAsset}${ceChain ? ` (${ceChain})` : ''}` : '',
        amount: ceAmount,
        merchant: ceReceivingExchange || ceDestinationAddress || '',
        transactionDate: ceTxDate,
        complaint: ceComplaint.slice(0, 800),
        notes: '',
        intake: claimIntake(),
      })
    } else {
      onHandoff({
        caseId,
        classification: result.classification,
        confidence: result.confidence,
        headline: result.headline,
        network,
        amount,
        merchant,
        transactionDate,
        complaint: customerReason.slice(0, 800),
        notes: '',
        intake: claimIntake(),
      })
    }
    moveClaim('with_desk', { publicNote: 'We’re investigating your claim.' })
    setHandedOff(true)
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:'1280px', margin:'0 auto', padding:'40px 24px' }}>
      <style>{`
        /* inputs: mono font instead of Fraunces so selects/inputs look sharp */
        .triage-root .input-field {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          padding: 10px 14px;
          background: #FAF7F1;
          border: 1px solid #D4CCBC;
          color: #1A1814;
          width: 100%;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .triage-root .input-field:focus { outline: none; border-color: #1A1814; }
        .triage-root select.input-field { appearance: auto; }
        .triage-root textarea.input-field {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 14px;
          line-height: 1.6;
          padding: 12px 14px;
        }
        .triage-root .input-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #6B5F4D;
          margin-bottom: 6px;
          display: block;
        }
        /* warm up Tailwind cool borders */
        .triage-root .border-stone-200 { border-color: #D4CCBC !important; }
        .triage-root .border-stone-300 { border-color: #C8BFB2 !important; }
        .triage-root .border-stone-100 { border-color: #E4DECE !important; }
        /* dividers */
        .tri-section-rule { border: none; border-top: 1px solid #D4CCBC; margin: 28px 0; }
        .tri-sub-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #A89B88; margin-bottom: 12px; }
      `}</style>

      {/* ── Masthead ─────────────────────────────────────────────────────────── */}
      <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div className="mono-font text-xs tracking-widest text-stone-600">ISSUE Nº 001 — TRIAGE</div>
          <div className="mono-font text-xs tracking-widest text-stone-600">
            {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
          </div>
        </div>
        <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize: 'clamp(48px, 8vw, 96px)', letterSpacing: '-0.03em' }}>
          <span style={{ fontWeight: 700 }}>Tri</span><span style={{ fontStyle: 'italic', fontWeight: 500 }}>age</span>
        </h1>
        <p className="display-font text-stone-700 mt-3 sm:mt-4 max-w-2xl" style={{ fontSize: 'clamp(15px, 2vw, 17px)', lineHeight: '1.55' }}>
          {isCE
            ? 'Crypto exchange fraud triage. Four verdicts. FinCEN + FINTRAC aware. Built for exchange fraud analysts handling ATO, pig butchering, stablecoin fraud, and consumer disputes on digital asset platforms.'
            : 'Classify incoming dispute claims before anything is filed. Four verdicts. Covers card, ACH, P2P, BNPL, and FI-held crypto — routed by payment rail and regulatory framework: Reg E, Reg Z, NACHA, or provider.'}
        </p>
        {/* Alerts (the FI, the exchange or the network found it) | Claims (the customer reported it) */}
        <div role="tablist" aria-label="Triage" className="mt-6" style={{ display:'flex', gap:'2px', borderBottom:'1px solid #D4CCBC' }}>
          {[['alerts', 'Alerts', alertsSource(sides, isCE)], ['claims', 'Claims', 'The customer reported it']].map(([k, l, sub]) => (
            <button key={k} role="tab" aria-selected={intakeTab === k} onClick={() => pickIntake(k)} className="mono-font"
              style={{ background:'none', border:'none', borderBottom: intakeTab === k ? '2px solid #1A1814' : '2px solid transparent', marginBottom:'-1px', padding:'10px 16px', cursor:'pointer', textAlign:'left' }}>
              <span style={{ display:'block', fontSize:'11px', letterSpacing:'0.14em', color: intakeTab === k ? '#1A1814' : '#6B6259', fontWeight:600 }}>{l.toUpperCase()}</span>
              <span className="display-font" style={{ display:'block', fontSize:'12px', color:'#6B6259', letterSpacing:0 }}>{sub}</span>
            </button>
          ))}
        </div>
        {/* Bank / credit union or crypto exchange — for alerts and claims alike */}
        <div className="mt-5 flex gap-1 p-1 w-fit" style={{ background: '#E8E3DA', maxWidth: '100%', flexWrap: 'wrap' }}>
          {[{ id: 'fi', label: 'Financial Institution' }, { id: 'ce', label: 'Crypto Exchange' }].map(m => (
            <button key={m.id} onClick={() => { setTriageChannelMode(m.id); setResult(null); setError(null); setHandedOff(false) }}
              className="platform-toggle-btn mono-font text-xs tracking-widest px-4 py-2 transition-all"
              style={{ background: triageChannelMode === m.id ? '#1A1814' : 'transparent', color: triageChannelMode === m.id ? '#F5F1EA' : '#6B5F4D', cursor: 'pointer', border: 'none' }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {intakeTab === 'alerts' && (
        <AlertsPanel kind="fraud" segment={triageChannelMode} outcomes={appOutcomes || []} setOutcomes={setAppOutcomes} settings={settings} covUser={covUser} route={fraudRoute}
          institution={settings?.duoInstitutionName || covUser?.institution || ''} />
      )}

      {/* Claims: kept mounted (hidden) so a half-written claim survives a look at the alerts */}
      <div style={{ display: intakeTab === 'claims' ? 'block' : 'none' }}>
      {/* Claims the customer reported in the bank's app, waiting to be triaged */}
      <AppClaims segment={triageChannelMode} activeId={activeClaim?.id} onTriage={fillFromClaim} />
      {activeClaim && (
        <div className="mono-font" role="status" style={{ fontSize:'11px', letterSpacing:'0.1em', color:'#1E3A5F', margin:'0 0 16px', display:'flex', gap:'12px', flexWrap:'wrap' }}>
          <span>TRIAGING {activeClaim.external_id} · {(activeClaim.data?.customer?.name || '').toUpperCase()} — FILLED FROM THE APP; CHECK IT, THEN RUN TRIAGE</span>
          <button type="button" onClick={() => setActiveClaim(null)} className="mono-font" style={{ fontSize:'11px', background:'none', border:0, padding:0, color:'#57534E', textDecoration:'underline', cursor:'pointer' }}>STOP</button>
        </div>
      )}
      {/* ── Two-column layout ────────────────────────────────────────────────── */}
      <div id="triage-claim-form" className="grid grid-cols-1 lg:grid-cols-2 gap-12" style={{ scrollMarginTop:'80px' }}>

        {/* ══ LEFT: Inputs ══════════════════════════════════════════════════════ */}
        <div>

        {/* ════════ CRYPTO EXCHANGE MODE ════════ */}
        {isCE && (
          <>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Account &amp; Transaction</h2>
            </div>

            <div className="mb-4">
              <label className="input-label">Jurisdiction</label>
              <select value={ceCountry} onChange={e => setCeCountry(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                <option value="both">Both — US (FinCEN) + Canada (FINTRAC)</option>
                <option value="us">United States — FinCEN / BSA</option>
                <option value="ca">Canada — FINTRAC / PCMLTFA</option>
              </select>
              {ceRegLabel && (
                <div className="flex items-start gap-3 py-2">
                  <span className="mono-font text-xs px-2 py-1 shrink-0" style={{ background: '#064E3B', color: '#6EE7B7' }}>{ceRegLabel}</span>
                  <span className="mono-font text-xs text-stone-400 leading-relaxed">{ceRegSubtext}</span>
                </div>
              )}
            </div>

            <div className="space-y-4 mb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Account Type</label>
                  <select value={ceAccountType} onChange={e => setCeAccountType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select…</option>
                    <option>Standard retail account</option>
                    <option>Business / corporate account</option>
                    <option>API / programmatic access</option>
                    <option>OTC desk account</option>
                    <option>Institutional account</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">KYC Level</label>
                  <select value={ceKycLevel} onChange={e => setCeKycLevel(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option>Tier 1 — email only</option>
                    <option>Tier 2 — ID verified</option>
                    <option>Tier 3 — full KYB / EDD</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Digital Asset</label>
                  <select value={ceAsset} onChange={e => setCeAsset(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select asset…</option>
                    <option>BTC (Bitcoin)</option><option>ETH (Ethereum)</option>
                    <option>USDT (Tether)</option><option>USDC (USD Coin)</option>
                    <option>SOL (Solana)</option><option>XRP (Ripple)</option>
                    <option>BNB (BNB Chain)</option><option>MATIC (Polygon)</option>
                    <option>Other / Unknown</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Blockchain Network</label>
                  <select value={ceChain} onChange={e => setCeChain(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select chain…</option>
                    <option>Bitcoin mainnet</option><option>Ethereum mainnet</option>
                    <option>Solana</option><option>BNB Chain</option>
                    <option>Polygon</option><option>Tron (TRC-20)</option>
                    <option>Avalanche</option><option>Unknown / off-chain</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Transaction Type</label>
                  <select value={ceTxType} onChange={e => setCeTxType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select…</option>
                    <option>External withdrawal</option><option>Internal transfer</option>
                    <option>Spot trade / conversion</option>
                    <option>Fiat deposit → crypto purchase</option>
                    <option>Fiat off-ramp (crypto → fiat)</option>
                    <option>Staking / yield withdrawal</option>
                    <option>API-initiated trade or transfer</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Transaction Date</label>
                  <input type="date" value={ceTxDate} onChange={e => setCeTxDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                  {ceDaysSince !== null && <div className="mono-font text-xs text-stone-400 mt-1.5">{ceDaysSince === 0 ? 'Today' : `${ceDaysSince} day${ceDaysSince !== 1 ? 's' : ''} ago`}</div>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={ceAmount} onChange={e => setCeAmount(e.target.value)} placeholder="0.00" className="input-field" style={{ flex: 2 }} />
                    <select value={ceCurrency} onChange={e => setCeCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      <option>USD</option><option>CAD</option><option>EUR</option><option>GBP</option><option>BTC</option><option>ETH</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-end">
                  {ceSarRequired && (
                    <div className="w-full px-3 py-2.5" style={{ background: '#FEF3C7', border: '1px solid #92400E' }}>
                      <div className="mono-font text-xs tracking-widest" style={{ color: '#92400E' }}>⚠ SAR / STR THRESHOLD</div>
                      <div className="mono-font text-xs mt-0.5" style={{ color: '#78350F' }}>
                        {ceSarFlagUS && 'FinCEN SAR required (≥$5k USD)'}
                        {ceSarFlagUS && ceStrFlagCA && ' · '}
                        {ceStrFlagCA && 'FINTRAC STR required (≥$10k CAD)'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Destination &amp; Recovery</h2>
            </div>
            <div className="space-y-4 mb-5">
              <div>
                <label className="input-label">Destination Type</label>
                <select value={ceDestinationType} onChange={e => setCeDestinationType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Unknown</option>
                  <option>External unhosted wallet (self-custody)</option>
                  <option>Known regulated exchange</option>
                  <option>Unknown / suspicious exchange</option>
                  <option>Internal platform wallet</option>
                  <option>DeFi protocol / smart contract</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Destination Address / Exchange</label>
                  <input type="text" value={ceDestinationAddress} onChange={e => setCeDestinationAddress(e.target.value)} placeholder="0x... or exchange name" className="input-field mono-font" style={{ fontSize: '12px' }} />
                </div>
                <div>
                  <label className="input-label">Receiving Exchange (if known)</label>
                  <input type="text" value={ceReceivingExchange} onChange={e => setCeReceivingExchange(e.target.value)} placeholder="e.g. Binance, OKX, Kraken" className="input-field" style={{ fontSize: '14px' }} />
                </div>
              </div>
              <div>
                <label className="input-label">Blockchain Trace Available</label>
                <select value={ceBlockchainTrace} onChange={e => setCeBlockchainTrace(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Unknown</option>
                  <option>Yes — funds still traceable on-chain</option>
                  <option>Yes — but already moved or mixed</option>
                  <option>No — off-chain or unknown destination</option>
                </select>
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-2">
              <span className="mono-font text-xs text-stone-400">03</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Claim &amp; Signals</h2>
            </div>
            <p className="display-font text-stone-500 text-[14px] mb-5 ml-7 italic" style={{ lineHeight: '1.5' }}>Fill what you know. Unknowns are treated as neutral.</p>

            <div className="space-y-4 mb-5">
              <div>
                <label className="input-label">How Was This Flagged?</label>
                <select value={ceFlaggedBy} onChange={e => setCeFlaggedBy(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Select…</option>
                  <option>Customer-reported (app / support ticket)</option>
                  <option>Customer-reported (email / chat)</option>
                  <option>Customer-reported (phone / live agent)</option>
                  <option>Automated fraud system alert</option>
                  <option>Compliance team flagged (SAR review)</option>
                  <option>Blockchain analytics alert (Chainalysis / Elliptic)</option>
                  <option>Law enforcement inquiry</option>
                </select>
              </div>
              <div>
                <label className="input-label">Suspected Compromise Vector</label>
                <select value={ceCompromiseVector} onChange={e => setCeCompromiseVector(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Unknown / not determined</option>
                  <option value="SIM-swap — mobile number ported or hijacked">SIM-swap</option>
                  <option value="Phishing — fake exchange website or email">Phishing — fake exchange or email</option>
                  <option value="Credential stuffing — reused password from data breach">Credential stuffing / password breach</option>
                  <option value="API key theft — programmatic unauthorized access">API key theft</option>
                  <option value="Social engineering — fake support agent or impersonation">Social engineering / fake support</option>
                  <option value="Investment / pig butchering scam — customer voluntarily sent funds">Investment scam / pig butchering</option>
                  <option value="Malware / device compromise">Malware / device compromise</option>
                  <option value="Insider threat — potential internal actor">Insider threat</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Recent Account Changes</label>
                  <select value={ceRecentAcctChanges} onChange={e => setCeRecentAcctChanges(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="Yes — email, phone, 2FA, or API keys changed recently">Yes — email / phone / 2FA / API changed</option>
                    <option value="No recent account changes detected">No recent changes</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Device / Location</label>
                  <select value={ceDeviceNew} onChange={e => setCeDeviceNew(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="New or unrecognized device / IP flagged">New or unrecognized device / IP</option>
                    <option value="Known device and location">Known device and location</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Prior Claims (12 months)</label>
                  <select value={cePriorClaims} onChange={e => setCePriorClaims(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option>None</option><option>1</option><option>2–3</option><option>4+</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="input-label">Customer's Stated Reason <span style={{ color: '#B45309' }}>*</span></label>
                <textarea value={ceComplaint} onChange={e => setCeComplaint(e.target.value)}
                  placeholder="What is the customer saying happened? Include any details about how they believe the fraud occurred…"
                  rows={5} className="input-field" style={{ resize: 'vertical' }} />
              </div>
            </div>

            <div>
              <label className="input-label">Date Incident Reported <span className="mono-font text-[10px] text-stone-400 normal-case tracking-normal">(optional — enables SAR deadline countdown)</span></label>
              <div className="flex items-center gap-3 flex-wrap">
                <input type="date" value={ceSarDeadlineDate} onChange={e => setCeSarDeadlineDate(e.target.value)}
                  className="input-field mono-font" style={{ fontSize: '13px', maxWidth: '200px' }} />
                {ceSarDeadline && (
                  <div className={`mono-font text-xs px-2 py-1 ${ceSarDaysLeft !== null && ceSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : ceSarDaysLeft !== null && ceSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100'}`}>
                    SAR deadline: {ceSarDeadline} · {ceSarDaysLeft !== null ? `${ceSarDaysLeft}d remaining` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8">
              <button onClick={classifyCE} disabled={loading || !ceComplaint.trim()}
                className="w-full py-4 mono-font text-xs tracking-widest transition-all flex items-center justify-center gap-3"
                style={{ background: loading || !ceComplaint.trim() ? '#D4CCBC' : '#1A1814', color: loading || !ceComplaint.trim() ? '#9A9086' : '#F5F1EA', cursor: loading || !ceComplaint.trim() ? 'not-allowed' : 'pointer', border: 'none' }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /><span>CLASSIFYING CLAIM</span></> : <><Bitcoin className="w-4 h-4" /><span>CLASSIFY EXCHANGE CLAIM</span><ArrowRight className="w-4 h-4" /></>}
              </button>
              {error && <div className="mt-4 border border-red-700 bg-red-50 p-4 flex gap-3 items-start"><AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" /><div className="display-font text-sm text-red-900">{error}</div></div>}
            </div>
          </>
        )}

        {/* ════════ FI MODE ════════ */}
        {!isCE && (
          <>
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">01</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Transaction Details</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="input-label">Account Type</label>
                <select value={accountType} onChange={e => setAccountType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Select type…</option>
                  <option value="debit">Debit Card</option>
                  <option value="credit">Credit Card</option>
                  <option value="p2p">P2P / e-Transfer</option>
                  <option value="ach_eft">ACH / EFT</option>
                  <option value="bnpl">BNPL (Buy Now Pay Later)</option>
                  <option value="crypto">Crypto / Digital Asset (FI-held)</option>
                </select>
              </div>

              {regLabel && (
                <div className="flex items-start gap-3 py-2">
                  <span className="mono-font text-xs px-2 py-1 shrink-0" style={{ background: regColor.bg, color: regColor.text }}>{regLabel}</span>
                  <span className="mono-font text-xs text-stone-400 leading-relaxed">{regSubtext}</span>
                </div>
              )}
              {!isCardBased && accountType && onGoToDuo && (
                <div className="flex items-center justify-between px-4 py-3" style={{ background:'#ECFDF5', border:'1px solid #6EE7B7' }}>
                  <div>
                    <div className="mono-font text-[10px] tracking-widest text-emerald-900 mb-0.5">CROSS-INSTITUTIONAL CASE</div>
                    <div className="display-font text-emerald-900 text-[13px]">Coordinate with the receiving institution in Duo Mode.</div>
                  </div>
                  <button onClick={onGoToDuo} className="mono-font shrink-0 ml-4"
                    style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'7px 14px', background:'#064E3B', color:'#F0FDF4', border:'none', cursor:'pointer' }}>
                    OPEN 007 DUO →
                  </button>
                </div>
              )}

              {showNetworkSel && (
                <div>
                  <label className="input-label">Payment Network</label>
                  <select value={network} onChange={e => setNetwork(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select network…</option>
                    {isCrypto ? (
                      <><option>Bitcoin (BTC)</option><option>Ethereum (ETH)</option><option>Solana (SOL)</option><option>Polygon (MATIC)</option><option>USDT / USDC (Stablecoin)</option><option>Other / Unknown chain</option></>
                    ) : accountType === 'credit' ? (
                      <><option>Visa</option><option>Mastercard</option><option>American Express</option><option>Other</option></>
                    ) : (
                      <><option>Visa (Debit)</option><option>Mastercard (Debit)</option><option>Interac</option><option>Other</option></>
                    )}
                  </select>
                </div>
              )}

              {detectedCrypto && (
                <div className="flex items-start gap-2 p-3" style={{ background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
                  <Bitcoin className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#065F46' }} />
                  <div>
                    <span className="mono-font text-xs tracking-widest" style={{ color: '#064E3B' }}>CRYPTO MERCHANT DETECTED — </span>
                    <span className="mono-font text-xs" style={{ color: '#065F46' }}>{merchant} is a known exchange. Switch account type to Crypto to unlock all crypto signals.</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">{isCrypto ? 'Destination Wallet / Platform' : 'Merchant / Recipient'}</label>
                  <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)}
                    placeholder={isCrypto ? 'e.g. 0x1a2b… or Uniswap' : 'e.g. TechGadget Co.'} className="input-field"
                    style={isCrypto ? { fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' } : {}} />
                </div>
                <div>
                  <label className="input-label">Amount</label>
                  <div className="flex gap-2">
                    <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="284.00" className="input-field" style={{ flex: 2 }} />
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field mono-font" style={{ flex: 1, fontSize: '13px' }}>
                      {isCrypto ? <><option>CAD</option><option>USD</option><option>BTC</option><option>ETH</option><option>USDC</option><option>USDT</option></> : <><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option></>}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Transaction Date</label>
                  <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className="input-field mono-font" style={{ fontSize: '13px' }} />
                  {daysSinceTransaction !== null && <div className="mono-font text-xs text-stone-400 mt-1.5">{daysSinceTransaction === 0 ? 'Today' : `${daysSinceTransaction} day${daysSinceTransaction !== 1 ? 's' : ''} ago`}</div>}
                </div>
                <div>
                  <label className="input-label">Transaction Type</label>
                  <select value={transactionType} onChange={e => setTransactionType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Select type…</option>
                    {accountType && TX_TYPES[accountType] ? TX_TYPES[accountType].map(t => <option key={t}>{t}</option>) : (
                      <><option>Card-Present (In-person)</option><option>Card-Not-Present (Online)</option><option>Recurring / Subscription</option><option>ATM Withdrawal</option><option>ACH / EFT Transfer</option><option>Wire Transfer</option><option>Zelle</option><option>Interac e-Transfer</option></>
                    )}
                  </select>
                </div>
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-5">
              <span className="mono-font text-xs text-stone-400">02</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Claim &amp; Context</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="input-label">How Was This Flagged?</label>
                <select value={flaggedBy} onChange={e => setFlaggedBy(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Select…</option>
                  <option>Customer-reported (inbound call)</option>
                  <option>Customer-reported (app / self-serve)</option>
                  <option>Customer-reported (email / chat)</option>
                  <option>System alert (fraud detection)</option>
                  <option>Proactive outreach (bank contacted customer first)</option>
                  <option>Chargeback / representment queue</option>
                </select>
              </div>
              <div>
                <label className="input-label">Dispute / Claim Type <span className="mono-font text-[10px] text-stone-400">(optional — helps AI routing)</span></label>
                <select value={claimType} onChange={e => setClaimType(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                  <option value="">Not specified — let AI determine</option>
                  <optgroup label="Unauthorized / Fraud">
                    <option value="unauth_card_present">Unauthorized — card present (lost / stolen)</option>
                    <option value="unauth_cnp">Unauthorized — card not present (online / CNP)</option>
                    <option value="ato">Account takeover (ATO)</option>
                    <option value="counterfeit">Counterfeit / skimming</option>
                  </optgroup>
                  <optgroup label="Consumer Dispute">
                    <option value="non_receipt">Non-receipt of goods or services</option>
                    <option value="not_as_described">Item not as described / misrepresentation</option>
                    <option value="cancelled_sub">Cancelled subscription / credit not processed</option>
                    <option value="billing_error">Billing / processing error</option>
                    <option value="duplicate_charge">Duplicate charge</option>
                  </optgroup>
                  <optgroup label="Scam / APP Fraud">
                    <option value="romance_scam">Romance scam</option>
                    <option value="investment_scam">Investment / pig-butchering scam</option>
                    <option value="impersonation">Impersonation scam (bank / gov / tech support)</option>
                    <option value="fake_invoice">Fake invoice / supplier fraud</option>
                    <option value="grandparent_scam">Grandparent / emergency scam</option>
                    <option value="other_app">Other authorized push payment (APP) scam</option>
                  </optgroup>
                  <optgroup label="First-Party">
                    <option value="fp_friendly_fraud">Suspected friendly fraud / chargeback abuse</option>
                    <option value="fp_return_abuse">Return abuse</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="input-label">Customer's Stated Reason <span style={{ color: '#B45309' }}>*</span></label>
                <textarea value={customerReason} onChange={e => setCustomerReason(e.target.value)}
                  placeholder="What is the customer saying happened? Paste or summarize their complaint…"
                  rows={5} className="input-field" style={{ resize: 'vertical' }} />
              </div>
            </div>

            <hr className="tri-section-rule" />
            <div className="flex items-baseline gap-3 mb-2">
              <span className="mono-font text-xs text-stone-400">03</span>
              <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Risk Signals</h2>
            </div>
            <p className="display-font text-stone-500 text-[14px] mb-5 ml-7 italic" style={{ lineHeight: '1.5' }}>Fill what you know. Unknowns are treated as neutral.</p>

            <div className="mb-5">
              <div className="tri-sub-label">Cardholder</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Prior Disputes (12 months)</label>
                  <select value={priorDisputes} onChange={e => setPriorDisputes(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option><option>None</option><option>1–2</option><option>3–5</option><option>5+</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Account Age</label>
                  <select value={accountAge} onChange={e => setAccountAge(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option><option>Under 6 months</option><option>6–12 months</option><option>1–3 years</option><option>3+ years</option>
                  </select>
                </div>
                {isCardBased && (
                  <div className="sm:col-span-2">
                    <label className="input-label">Card in Possession When Reported</label>
                    <select value={cardPossession} onChange={e => setCardPossession(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option><option>Yes — card in hand</option><option>No — card lost or stolen</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="mb-5">
              <div className="tri-sub-label">Account Integrity</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Recent Account Changes</label>
                  <select value={accountChanges} onChange={e => setAccountChanges(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="Yes — login, password or contact details changed recently">Yes — login or contact details changed</option>
                    <option value="No — no recent changes detected">No changes detected</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Device / Location</label>
                  <select value={deviceRecognized} onChange={e => setDeviceRecognized(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                    <option value="">Unknown</option>
                    <option value="New or unrecognized device / location flagged">New or unrecognized device</option>
                    <option value="Known device and location">Known device and location</option>
                  </select>
                </div>
              </div>
            </div>

            {isCardBased && (
              <div>
                <div className="tri-sub-label">Merchant</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="input-label">VFMP Listed</label>
                    <select value={vfmp} onChange={e => setVfmp(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Yes — VFMP listed">Yes</option>
                      <option value="No — not VFMP listed">No</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Merchant Dispute Rate</label>
                    <select value={merchantDisputeRate} onChange={e => setMerchantDisputeRate(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Low (under 1%)">Low (&lt;1%)</option>
                      <option value="Medium (1–2%)">Medium</option>
                      <option value="High (over 2%)">High (&gt;2%)</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">MCC Risk Tier</label>
                    <select value={mccRisk} onChange={e => setMccRisk(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Low risk MCC">Low</option>
                      <option value="Medium risk MCC">Medium</option>
                      <option value="High risk MCC (travel, digital goods, gambling)">High</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {(isCrypto || detectedCrypto) && (
              <div className="mt-5">
                <div className="tri-sub-label flex items-center gap-2">
                  <Bitcoin className="w-3 h-3" style={{ color: '#065F46' }} />
                  <span>Crypto / Digital Asset Signals</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="input-label">Crypto Fraud Scenario</label>
                    <select value={cryptoScenario} onChange={e => setCryptoScenario(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Select scenario…</option>
                      <option value="Card used to buy crypto (authorized scam)">Card used to buy crypto (authorized scam)</option>
                      <option value="Pig butchering / investment scam">Pig butchering / investment scam</option>
                      <option value="Wallet / exchange hack (unauthorized access)">Wallet / exchange hack (unauthorized access)</option>
                      <option value="NFT / digital asset fraud">NFT / digital asset fraud</option>
                      <option value="Stablecoin transfer fraud (USDC/USDT used as wire substitute)">Stablecoin fraud (USDC / USDT wire substitute)</option>
                      <option value="FI-held crypto — unauthorized withdrawal from integrated wallet">FI-held crypto — unauthorized withdrawal</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Exchange Regulated?</label>
                    <select value={exchangeRegulated} onChange={e => setExchangeRegulated(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Yes — registered / licensed exchange">Yes — licensed exchange</option>
                      <option value="No — unregulated or offshore">No — unregulated / offshore</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Wallet Custody</label>
                    <select value={walletCustody} onChange={e => setWalletCustody(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Custodial (exchange holds keys)">Custodial (exchange holds keys)</option>
                      <option value="Self-custody (customer holds keys)">Self-custody (customer holds keys)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="input-label">Customer Contacted Exchange?</label>
                    <select value={contactedExchange} onChange={e => setContactedExchange(e.target.value)} className="input-field" style={{ fontSize: '14px' }}>
                      <option value="">Unknown</option>
                      <option value="Yes — exchange contacted, case open">Yes — case open with exchange</option>
                      <option value="Yes — exchange declined to help">Yes — exchange declined</option>
                      <option value="No — customer came to FI first">No — came to FI first</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8">
              <button onClick={classify} disabled={loading || !customerReason.trim()}
                className="w-full py-4 mono-font text-xs tracking-widest transition-all flex items-center justify-center gap-3"
                style={{ background: loading || !customerReason.trim() ? '#D4CCBC' : '#1A1814', color: loading || !customerReason.trim() ? '#9A9086' : '#F5F1EA', cursor: loading || !customerReason.trim() ? 'not-allowed' : 'pointer', border: 'none' }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /><span>CLASSIFYING CLAIM</span></> : <><span>CLASSIFY CLAIM</span><ArrowRight className="w-4 h-4" /></>}
              </button>
              {error && <div className="mt-4 border border-red-700 bg-red-50 p-4 flex gap-3 items-start"><AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" /><div className="display-font text-sm text-red-900">{error}</div></div>}
            </div>
          </>
        )}
        </div>

        {/* ══ RIGHT: Output ══════════════════════════════════════════════════════ */}
        <div>
          <div className="flex items-baseline gap-3 mb-5">
            <span className="mono-font text-xs text-stone-400">04</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Classification</h2>
          </div>

          {!result && !loading && (
            <div className="border border-dashed border-stone-300 p-12 text-center" style={{ background: '#FAF7F1' }}>
              <Shield className="w-8 h-8 text-stone-300 mx-auto mb-3" />
              <p className="display-font text-stone-400 italic text-[15px]">Triage result will appear here after classification.</p>
            </div>
          )}

          {loading && (
            <div className="border border-stone-200 p-12 text-center" style={{ background: '#FAF7F1' }}>
              <Loader2 className="w-8 h-8 text-stone-600 mx-auto mb-3 animate-spin" />
              <p className="display-font text-stone-600 italic">Weighing signals and classifying claim…</p>
            </div>
          )}

          {result && cfg && (
            <div className="space-y-4">

              {/* ── Analysis complete divider ── */}
              <div style={{ display:'flex', alignItems:'center', gap:'16px', padding:'14px 20px', background:'#1A1814', marginBottom:'4px' }}>
                <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#34D399', flexShrink:0 }} />
                <div>
                  <div className="mono-font text-[10px] tracking-[0.2em] text-stone-400">ANALYSIS COMPLETE</div>
                  <div className="mono-font text-[11px] tracking-widest text-stone-200">{result.verdict?.replace(/_/g,' ')} · {result.risk_level || ''}</div>
                </div>
                <button onClick={() => { setResult(null); setError(null); window.scrollTo({ top:0, behavior:'smooth' }) }}
                  className="mono-font ml-auto text-[10px] tracking-widest text-stone-500 hover:text-stone-300 transition-colors"
                  style={{ background:'none', border:'none', cursor:'pointer' }}>↑ BACK TO FORM</button>
              </div>

              {!isCE && regLabel && (
                <div className="flex items-center gap-2">
                  <span className="mono-font text-xs px-2 py-0.5" style={{ background: regColor.bg, color: regColor.text }}>{regLabel}</span>
                  <span className="mono-font text-xs text-stone-400 uppercase tracking-wider">framework</span>
                </div>
              )}

              {isCE && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="mono-font text-xs px-2 py-0.5" style={{ background: '#064E3B', color: '#6EE7B7' }}>{ceRegLabel}</span>
                    <span className="mono-font text-xs text-stone-400 uppercase tracking-wider">jurisdiction</span>
                  </div>
                  {ceSarRequired && (
                    <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#FEF3C7', border: '1px solid #D97706' }}>
                      <span className="mono-font text-xs tracking-widest" style={{ color: '#92400E' }}>⚠ SAR/STR FILING REQUIRED — document this case before closing</span>
                    </div>
                  )}
                </div>
              )}

              {/* Velocity / duplicate warning (Task 12) */}
              {velocityWarning && (
                <div className="space-y-2">
                  {velocityWarning.map((w, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3" style={{ background: w.level === 'HIGH' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${w.level === 'HIGH' ? '#FCA5A5' : '#FCD34D'}` }}>
                      <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${w.level === 'HIGH' ? 'text-red-700' : 'text-amber-700'}`} />
                      <div>
                        <span className={`mono-font text-[10px] tracking-widest font-bold ${w.level === 'HIGH' ? 'text-red-800' : 'text-amber-800'}`}>VELOCITY SIGNAL — {w.level} &nbsp;</span>
                        <span className="display-font text-stone-800 text-[13px] leading-snug">{w.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Verdict card */}
              <div className="p-6" style={{ background: cfg.bg }}>
                <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                  <div className="mono-font text-xs tracking-widest" style={{ color: cfg.badgeText, opacity: 0.8 }}>TRIAGE VERDICT</div>
                  <div className="mono-font text-xs px-2 py-1" style={{ background: cfg.badge, color: cfg.badgeText }}>{result.confidence} CONFIDENCE</div>
                </div>
                <div className="display-font font-bold mb-3" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', color: cfg.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{cfg.label}</div>
                {result.fraud_sub_label && (
                  <div className="mono-font text-xs tracking-widest px-3 py-1.5 mb-3 w-fit" style={{ background: cfg.badge, color: cfg.badgeText }}>
                    FRAUD SUB-TYPE — {result.fraud_sub_label.toUpperCase()}
                  </div>
                )}
                <p className="display-font italic" style={{ color: cfg.text, fontSize: '15px', lineHeight: '1.55', opacity: 0.85 }}>{result.headline}</p>
              </div>

              {result.ato_suspected && (
                <div className="border border-red-800 p-5" style={{ background: '#FFF1F2' }}>
                  <div className="flex items-center gap-2 mono-font text-xs tracking-widest text-red-900 mb-2">
                    <Lock className="w-3.5 h-3.5 shrink-0" /><span>ACCOUNT TAKEOVER SUSPECTED</span>
                  </div>
                  <p className="display-font text-stone-900 text-[14px] leading-relaxed mb-3">{result.ato_note}</p>
                  <div className="mono-font text-xs text-red-800 tracking-wide">→ Escalate to security team in parallel. Block card and flag account for identity verification before or alongside dispute filing.</div>
                </div>
              )}

              {/* Provisional Credit Recommendation (Task 11) */}
              {result.provisional_credit_rec && result.provisional_credit_rec !== 'NOT_APPLICABLE' && (
                <div className="border p-5" style={{
                  borderColor: result.provisional_credit_rec === 'ISSUE_IMMEDIATELY' ? '#059669' : result.provisional_credit_rec === 'ISSUE_CONDITIONALLY' ? '#1D4ED8' : '#D97706',
                  background:  result.provisional_credit_rec === 'ISSUE_IMMEDIATELY' ? '#ECFDF5' : result.provisional_credit_rec === 'ISSUE_CONDITIONALLY' ? '#EFF6FF' : '#FFFBEB',
                }}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <div className="mono-font text-xs tracking-widest" style={{
                      color: result.provisional_credit_rec === 'ISSUE_IMMEDIATELY' ? '#065F46' : result.provisional_credit_rec === 'ISSUE_CONDITIONALLY' ? '#1E3A8A' : '#92400E'
                    }}>
                      {result.provisional_credit_rec === 'ISSUE_IMMEDIATELY'   && '✓ PROVISIONAL CREDIT — ISSUE IMMEDIATELY'}
                      {result.provisional_credit_rec === 'ISSUE_CONDITIONALLY' && '⚠ PROVISIONAL CREDIT — ISSUE CONDITIONALLY'}
                      {result.provisional_credit_rec === 'HOLD_PENDING_INVESTIGATION' && '⊘ PROVISIONAL CREDIT — HOLD PENDING INVESTIGATION'}
                    </div>
                  </div>
                  <p className="display-font text-stone-900 text-[14px] leading-relaxed">{result.provisional_credit_note}</p>
                </div>
              )}

              {provisionalCreditApplies && !result.provisional_credit_rec && (
                <div className="border p-4" style={{ borderColor: '#1D4ED8', background: '#EFF6FF' }}>
                  <div className="mono-font text-xs tracking-widest mb-2" style={{ color: '#1E3A8A' }}>REG E — PROVISIONAL CREDIT</div>
                  <p className="display-font text-stone-900 text-[14px] leading-relaxed">
                    This Reg E dispute must be resolved within <strong>10 business days</strong> — or provisional credit must be issued. Investigation may extend to <strong>45 business days</strong> (90 days for POS, international, or new accounts) with provisional credit posted.
                  </p>
                </div>
              )}

              <div className="border border-stone-200 p-5" style={{ background: '#FAF7F1' }}>
                <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">KEY SIGNALS</div>
                <div className="space-y-2.5">
                  {result.signals?.map((signal, i) => (
                    <div key={i} className="display-font text-stone-800 text-[15px] flex gap-2 items-start leading-snug">
                      <span className="text-stone-400 shrink-0 mt-0.5">→</span><span>{signal}</span>
                    </div>
                  ))}
                </div>
              </div>

              {result._ai ? <AiExplain record={result._ai} /> : result.signal_influences?.length > 0 && (
                <div className="border border-stone-200 p-5" style={{ background: '#FAF7F1' }}>
                  <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">WHAT DROVE THIS VERDICT</div>
                  <div className="space-y-2.5">
                    {result.signal_influences.map((inf, i) => {
                      const ws = weightStyle(inf.weight)
                      const towardCfg = classConfig[inf.toward]
                      return (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <span className="mono-font text-xs px-1.5 py-0.5 shrink-0" style={{ background: ws.bg, color: ws.text }}>{inf.weight}</span>
                          <span className="display-font text-stone-700 text-[13px] flex-1 min-w-0">{inf.signal}</span>
                          {towardCfg && <span className="mono-font shrink-0 px-1.5 py-0.5" style={{ fontSize: '10px', letterSpacing: '0.08em', background: towardCfg.bg, color: towardCfg.badgeText }}>→ {towardCfg.label}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="p-5" style={{ borderLeft: `4px solid ${cfg.borderColor}`, background: '#FAF7F1' }}>
                <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">ROUTING RECOMMENDATION</div>
                <div className="display-font font-semibold text-stone-900 mb-2" style={{ fontSize: '17px', letterSpacing: '-0.01em' }}>{result.routing_label}</div>
                <p className="display-font text-stone-700 text-[15px] leading-relaxed">{result.routing_detail}</p>
                {(['RECIPIENT_FI','NACHA_RETURN','PROVIDER_DISPUTE'].includes(result.routing) || isCE || accountType === 'crypto') && onGoToDuo && (
                  <div className="mt-4 pt-4" style={{ borderTop:'1px solid #D4CCBC' }}>
                    <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-2">
                      {isCE ? 'EXCHANGE-TO-EXCHANGE COORDINATION' : accountType === 'crypto' ? 'CRYPTO / CROSS-INSTITUTIONAL CASE' : 'CROSS-INSTITUTIONAL CASE'}
                    </div>
                    <p className="display-font text-stone-600 text-[13px] leading-relaxed mb-3">
                      {isCE
                        ? 'Contact the receiving exchange directly via Duo. Share wallet addresses, txids, and asset details — and coordinate on a freeze or account action.'
                        : accountType === 'crypto'
                          ? 'This crypto case involves another institution or exchange. Open a Duo session to coordinate on asset recovery, freeze requests, and shared documentation.'
                          : 'This case involves another institution. Open a Duo session to coordinate directly — share the claim, build a shared record, and work toward recovery together.'}
                    </p>
                    <button onClick={() => {
                      const claim = { source:'triage', accountType: isCE ? 'crypto_exchange' : accountType, regFramework, routing_label: result?.routing_label, routing: result?.routing, classification: result?.classification, risk_level: result?.risk_level }
                      onSendToDuo ? onSendToDuo(claim) : onGoToDuo()
                    }} className="mono-font"
                      style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'9px 20px', background:'#064E3B', color:'#F0FDF4', border:'none', cursor:'pointer' }}>
                      {isCE ? 'COORDINATE WITH RECEIVING EXCHANGE →' : 'OPEN IN 005 DUO →'}
                    </button>
                  </div>
                )}
              </div>

              {result.risk_notes && (
                <div className="border border-amber-200 bg-amber-50 p-4">
                  <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">⚠ WATCH FOR</div>
                  <p className="display-font text-stone-800 text-[15px] leading-relaxed">{result.risk_notes}</p>
                </div>
              )}

              {(() => {
                const fpfColor = fpfRiskScore >= 70 ? '#991B1B' : fpfRiskScore >= 45 ? '#92400E' : '#065F46'
                const fpfBg    = fpfRiskScore >= 70 ? '#FEE2E2' : fpfRiskScore >= 45 ? '#FEF3C7' : '#ECFDF5'
                const fpfLabel = fpfRiskScore >= 70 ? 'HIGH — Investigate further' : fpfRiskScore >= 45 ? 'MODERATE — Review carefully' : 'LOW — Claim appears genuine'
                return (
                  <div className="border p-4" style={{ background: fpfBg, borderColor: fpfColor + '40' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="mono-font text-xs tracking-widest" style={{ color: fpfColor }}>FIRST-PARTY FRAUD RISK</span>
                      <span className="mono-font text-sm font-bold" style={{ color: fpfColor }}>{fpfRiskScore}/100</span>
                    </div>
                    <div className="w-full h-2 rounded-full mb-2" style={{ background: '#E7E5E4' }}>
                      <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${fpfRiskScore}%`, background: fpfColor }} />
                    </div>
                    <div className="mono-font text-xs" style={{ color: fpfColor }}>{fpfLabel}</div>
                  </div>
                )
              })()}

              {((!isCardBased && accountType && !['RECIPIENT_FI','NACHA_RETURN','PROVIDER_DISPUTE'].includes(result?.routing) && accountType !== 'crypto') || false) && (onGoToDuo || onSendToDuo) && (
                <button onClick={() => {
                  const claim = { source:'triage', accountType, regFramework, routing_label: result?.routing_label, routing: result?.routing, classification: result?.classification, risk_level: result?.risk_level }
                  onSendToDuo ? onSendToDuo(claim) : onGoToDuo()
                }}
                  style={{ width:'100%', padding:'20px 24px', background:'#064E3B', color:'#F0FDF4', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', textAlign:'left' }}>
                  <div>
                    <div className="mono-font mb-1" style={{ fontSize:'10px', letterSpacing:'0.15em', opacity:0.7 }}>CROSS-INSTITUTIONAL CASE DETECTED</div>
                    <div className="display-font font-bold" style={{ fontSize:'18px', letterSpacing:'-0.01em' }}>Coordinate in Duo Mode →</div>
                    <div className="mono-font mt-1" style={{ fontSize:'10px', letterSpacing:'0.08em', opacity:0.65 }}>Share this case with the receiving institution · Build a shared record · Work toward recovery</div>
                  </div>
                </button>
              )}

              <button onClick={exportReport}
                className="w-full flex items-center justify-center gap-2 py-3 border transition-colors"
                style={{ borderColor: '#D4CCBC', background: '#FAF7F1', cursor: 'pointer' }}>
                {exportCopied
                  ? <><Check className="w-4 h-4 text-emerald-600" /><span className="mono-font text-xs tracking-widest text-emerald-600">COPIED TO CLIPBOARD</span></>
                  : <><Copy className="w-4 h-4 text-stone-500" /><span className="mono-font text-xs tracking-widest text-stone-600">EXPORT TRIAGE REPORT</span></>}
              </button>

              {isCE && ceSarRequired && ceSarDeadline && (
                <div className={`flex items-center gap-3 px-3 py-2.5 mono-font text-xs ${ceSarDaysLeft !== null && ceSarDaysLeft <= 7 ? 'bg-red-900 text-red-50' : ceSarDaysLeft !== null && ceSarDaysLeft <= 14 ? 'bg-amber-800 text-amber-50' : 'bg-stone-800 text-stone-100'}`}>
                  <span>⚠ SAR/STR DEADLINE:</span>
                  <span className="font-bold">{ceSarDeadline}</span>
                  {ceSarDaysLeft !== null && <span>{ceSarDaysLeft > 0 ? `${ceSarDaysLeft} DAYS REMAINING` : ceSarDaysLeft === 0 ? 'DUE TODAY' : `${Math.abs(ceSarDaysLeft)} DAYS OVERDUE`}</span>}
                </div>
              )}

              {isCE && !ceActionPlan && !ceActionPlanLoading && (
                <button onClick={generateCEActionPlan}
                  className="w-full flex items-center justify-center gap-2 py-4 mono-font text-xs tracking-widest transition-all"
                  style={{ background: '#1A1814', color: '#F5F1EA', border: 'none', cursor: 'pointer' }}>
                  <Shield className="w-4 h-4" /><span>GENERATE FULL ACTION PLAN</span><ArrowRight className="w-4 h-4" />
                </button>
              )}
              {isCE && ceActionPlanLoading && (
                <div className="border border-stone-300 p-8 text-center" style={{ background: '#FAF7F1' }}>
                  <Loader2 className="w-6 h-6 text-stone-600 mx-auto mb-2 animate-spin" />
                  <p className="display-font text-stone-600 italic text-sm">Building operational action plan…</p>
                </div>
              )}
              {isCE && ceActionPlanError && (
                <div className="border border-red-700 bg-red-50 p-4 flex gap-3 items-start">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <div className="display-font text-sm text-red-900">{ceActionPlanError}</div>
                </div>
              )}

              {isCE && ceActionPlan && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div><div className="mono-font text-xs tracking-widest text-stone-500">FULL ACTION PLAN</div><AiDraftNote record={ceActionPlan._ai} /></div>
                    <button onClick={() => {
                      const t = [`CE ACTION PLAN — ${result.classification?.replace(/_/g,' ')}`, `Recovery: ${ceActionPlan.recovery_outlook}`, '', 'IMMEDIATE ACTIONS:', ...(ceActionPlan.immediate_actions||[]).map((a,i) => `${i+1}. ${a}`), '', 'INVESTIGATION:', ...(ceActionPlan.investigation_steps||[]).map((a,i) => `${i+1}. ${a}`), ceActionPlan.sar_required ? '\nSAR: ' + ceActionPlan.sar_note : '', ceActionPlan.lea_referral_recommended ? '\nLEA: ' + ceActionPlan.lea_note : '', '', 'RECOVERY: ' + ceActionPlan.recovery_note].filter(Boolean).join('\n')
                      navigator.clipboard.writeText(t)
                      setCeActionPlanCopied(true); setTimeout(() => setCeActionPlanCopied(false), 2000)
                    }} className="mono-font text-xs flex items-center gap-1.5 text-stone-600 hover:text-stone-900 transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                      {ceActionPlanCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY ALL</>}
                    </button>
                  </div>

                  <div className="border-l-4 border-red-700 bg-red-50 p-5">
                    <div className="mono-font text-xs tracking-widest text-red-900 mb-3">IMMEDIATE ACTIONS — DO NOW</div>
                    <div className="space-y-2">
                      {ceActionPlan.immediate_actions?.map((a, i) => (
                        <div key={i} className="display-font text-stone-900 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="mono-font text-[11px] text-red-700 shrink-0 mt-0.5 font-bold">{i+1}.</span><span>{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-stone-300 p-5" style={{ background: '#FAF7F1' }}>
                    <div className="mono-font text-xs tracking-widest text-stone-600 mb-3">INVESTIGATION STEPS — 24–48 HOURS</div>
                    <div className="space-y-2">
                      {ceActionPlan.investigation_steps?.map((s, i) => (
                        <div key={i} className="display-font text-stone-800 text-[14px] flex gap-2 items-start leading-snug">
                          <span className="mono-font text-[11px] text-stone-500 shrink-0 mt-0.5">{i+1}.</span><span>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mono-font text-xs tracking-widest text-stone-500 mb-3">EVIDENCE PACKAGE</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[{ key: 'internal', label: 'INTERNAL' }, { key: 'external', label: 'EXTERNAL' }, { key: 'blockchain', label: 'BLOCKCHAIN' }].map(({ key, label }) => (
                        <div key={key} className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                          <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-3">{label}</div>
                          <div className="space-y-2">
                            {(ceActionPlan.evidence_required?.[key] || []).map((item, i) => (
                              <div key={i} className="display-font text-stone-800 text-[13px] flex gap-2 items-start leading-snug">
                                <span className="shrink-0 mt-0.5 text-stone-400">→</span><span>{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {ceActionPlan.sar_required && (
                    <div className="border-l-4 border-amber-700 bg-amber-50 p-5">
                      <div className="mono-font text-xs tracking-widest text-amber-900 mb-2">⚠ SAR / STR FILING REQUIRED</div>
                      <p className="display-font text-stone-900 text-[14px] leading-relaxed">{ceActionPlan.sar_note}</p>
                    </div>
                  )}

                  {ceActionPlan.lea_referral_recommended && (
                    <div className="border border-stone-900 p-5" style={{ background: '#1A1814' }}>
                      <div className="mono-font text-xs tracking-widest text-stone-400 mb-2">LAW ENFORCEMENT REFERRAL</div>
                      <p className="display-font text-stone-100 text-[14px] leading-relaxed">{ceActionPlan.lea_note}</p>
                    </div>
                  )}

                  {ceActionPlan.exchange_contact_required && (
                    <div className="border border-stone-400 p-5" style={{ background: '#FAF7F1' }}>
                      <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">RECEIVING EXCHANGE — CONTACT NOW</div>
                      <p className="display-font text-stone-800 text-[14px] leading-relaxed">{ceActionPlan.exchange_note}</p>
                    </div>
                  )}

                  {(() => {
                    const ol = ceActionPlan.recovery_outlook
                    const olStyle = ol === 'HIGH' ? { bg: '#064e3b', text: '#6EE7B7' } : ol === 'MODERATE' ? { bg: '#78350f', text: '#FDE68A' } : ol === 'LOW' ? { bg: '#7f1d1d', text: '#FCA5A5' } : { bg: '#1c1917', text: '#A8A29E' }
                    return (
                      <div className="p-5 border border-stone-200" style={{ background: '#FAF7F1' }}>
                        <div className="mono-font text-xs tracking-widest text-stone-500 mb-2">RECOVERY OUTLOOK</div>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="mono-font text-xs px-2 py-1" style={{ background: olStyle.bg, color: olStyle.text }}>{ol}</span>
                          <span className="mono-font text-xs text-stone-400">{ol === 'HIGH' ? '60–80%' : ol === 'MODERATE' ? '35–60%' : ol === 'LOW' ? '15–35%' : '<15%'}</span>
                        </div>
                        <p className="display-font text-stone-700 text-[14px] leading-relaxed">{ceActionPlan.recovery_note}</p>
                      </div>
                    )
                  })()}

                  {ceActionPlan.customer_letter && (
                    <div className="border border-stone-900">
                      <div className="bg-stone-900 px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="mono-font text-xs tracking-widest text-stone-400 mb-0.5">CUSTOMER LETTER</div>
                          <div className="display-font text-stone-100 font-semibold text-[15px]">{ceActionPlan.customer_letter.subject}</div>
                        </div>
                        <button onClick={() => {
                          navigator.clipboard.writeText(`Subject: ${ceActionPlan.customer_letter.subject}\n\nDear Customer,\n\n${ceActionPlan.customer_letter.body}\n\nSincerely,\nCompliance & Fraud Operations Team`)
                          setCeActionPlanCopied(true); setTimeout(() => setCeActionPlanCopied(false), 2000)
                        }} className="mono-font text-xs flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                          {ceActionPlanCopied ? <><Check className="w-3 h-3" /> COPIED</> : <><Copy className="w-3 h-3" /> COPY</>}
                        </button>
                      </div>
                      <div className="bg-white p-5 space-y-3">
                        <p className="display-font text-stone-500 text-sm italic">Dear Customer,</p>
                        {ceActionPlan.customer_letter.body?.split('\n\n').map((para, i) => (
                          <p key={i} className="display-font text-stone-900 text-[15px] leading-relaxed">{para}</p>
                        ))}
                        <p className="display-font text-stone-500 text-sm italic pt-2">Sincerely,<br />Compliance &amp; Fraud Operations Team</p>
                      </div>
                    </div>
                  )}

                  <button onClick={() => setCeActionPlan(null)} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    ↺ REGENERATE ACTION PLAN
                  </button>
                </div>
              )}

              {/* ── CE RESOLUTION STEP ───────────────────────────────────────── */}
              {isCE && result && (
                <div className="border border-stone-300" style={{ background: '#F5F1EA' }}>
                  <div className="px-5 py-4 border-b border-stone-200" style={{ background: '#EDE9E0' }}>
                    <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-0.5">STEP 4 — RESOLUTION</div>
                    <div className="display-font font-semibold text-stone-900" style={{ fontSize: '15px', letterSpacing: '-0.01em' }}>Record Actions &amp; Outcome</div>
                    <p className="mono-font text-[10px] text-stone-500 mt-1">CE cases don't route to a network — track what was actually done and close the case here.</p>
                  </div>
                  <div className="px-5 py-4 space-y-4">
                    {/* Resolution status */}
                    <div>
                      <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-2">CASE STATUS</div>
                      <div className="flex gap-2 flex-wrap">
                        {[{id:'open',label:'OPEN',bg:'#92400E',fg:'#FEF3C7'},{id:'in_progress',label:'IN PROGRESS',bg:'#1E3A8A',fg:'#DBEAFE'},{id:'resolved',label:'RESOLVED',bg:'#064E3B',fg:'#D1FAE5'},{id:'no_recovery',label:'NO RECOVERY',bg:'#3F3F46',fg:'#E4E4E7'}].map(s => (
                          <button key={s.id} onClick={() => setCeResolution(r => ({ ...r, status: r.status === s.id ? '' : s.id }))}
                            className="mono-font text-[10px] px-3 py-1.5 tracking-widest transition-colors"
                            style={{ background: ceResolution.status === s.id ? s.bg : 'none', color: ceResolution.status === s.id ? s.fg : '#78716C', border: '1px solid ' + (ceResolution.status === s.id ? s.bg : '#D4CCBC'), cursor: 'pointer' }}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Actions taken */}
                    <div>
                      <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-2">ACTIONS TAKEN</div>
                      <div className="flex flex-wrap gap-2">
                        {CE_ACTIONS.map(a => {
                          const active = ceResolution.actions.includes(a)
                          return (
                            <button key={a} onClick={() => setCeResolution(r => ({ ...r, actions: active ? r.actions.filter(x => x !== a) : [...r.actions, a] }))}
                              className="mono-font text-[10px] px-2.5 py-1 tracking-wide transition-colors"
                              style={{ background: active ? '#1A1814' : 'none', color: active ? '#E8E3DC' : '#78716C', border: '1px solid ' + (active ? '#1A1814' : '#D4CCBC'), cursor: 'pointer' }}>
                              {active ? '✓ ' : ''}{a}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {/* Notes */}
                    <div>
                      <div className="mono-font text-[10px] tracking-widest text-stone-500 mb-2">RESOLUTION NOTES</div>
                      <textarea
                        value={ceResolution.notes}
                        onChange={e => setCeResolution(r => ({ ...r, notes: e.target.value }))}
                        placeholder="What happened? Recovery amount, exchange response, LEA case number, SAR filed date..."
                        rows={3}
                        className="w-full display-font"
                        style={{ fontSize: '13px', lineHeight: 1.5, padding: '10px 12px', border: '1px solid #D4CCBC', background: '#FAF7F1', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </div>
                    {/* Save to triage log */}
                    <button
                      onClick={() => {
                        if (!ceResolution.status) { alert('Set a case status before saving.'); return }
                        const rec = outcomes.find(o => o.id === result?._caseId) || outcomes[0]
                        setOutcomes(prev => prev.map(o => o === rec ? { ...o, ceResolution } : o))
                        alert('Resolution saved to triage log.')
                      }}
                      className="mono-font text-[10px] tracking-widest px-4 py-2"
                      style={{ background: '#1A1814', color: '#E8E3DC', border: 'none', cursor: 'pointer', letterSpacing: '0.12em' }}>
                      SAVE RESOLUTION
                    </button>
                  </div>
                </div>
              )}


              {/* ── Prior Disputes Intelligence ──────────────────────────────── */}
              {result && (() => {
                const normMerchant = (s) => (s||'').toLowerCase().replace(/[^a-z0-9]/g,'')
                const thisMerchant = normMerchant(merchant)
                // Pull from both stores
                const deskCases = readCases()
                const triageCases = (() => { try { return JSON.parse(localStorage.getItem('triage_outcomes')||'[]') } catch { return [] } })()
                const triageArchive = (() => { try { return JSON.parse(localStorage.getItem('triage_archive')||'[]') } catch { return [] } })()
                // Match by merchant (fuzzy: normalized contains match)
                const matchedDesk = thisMerchant.length >= 3
                  ? deskCases.filter(o => normMerchant(o.merchant).includes(thisMerchant) || thisMerchant.includes(normMerchant(o.merchant).substring(0,6)))
                  : []
                const matchedTriage = thisMerchant.length >= 3
                  ? [...triageCases, ...triageArchive].filter(o => normMerchant(o.merchant||o.inputs?.merchant).includes(thisMerchant) || thisMerchant.includes(normMerchant((o.merchant||o.inputs?.merchant||'').substring(0,6))))
                  : []
                // Merge Supabase results (deduplicate by id, only new ones)
                const localIds = new Set([...matchedDesk, ...matchedTriage].map(o => o.id))
                const matchedSupa = thisMerchant.length >= 3
                  ? supaPriorCases.filter(o => {
                      const nm = normMerchant(o.merchant||'')
                      return !localIds.has(o.id) && (nm.includes(thisMerchant) || thisMerchant.includes(nm.substring(0,6)))
                    })
                  : []
                const total = matchedDesk.length + matchedTriage.length + matchedSupa.length
                if (total === 0) return null
                const VERDICT_COLORS = { TRUE_FRAUD:'#7F1D1D', FIRST_PARTY_FRAUD:'#78350F', CONSUMER_DISPUTE:'#1E3A5F', AUTHORIZED_PUSH_PAYMENT:'#4C1D95' }
                const VERDICT_BG     = { TRUE_FRAUD:'#FEE2E2', FIRST_PARTY_FRAUD:'#FEF3C7', CONSUMER_DISPUTE:'#DBEAFE', AUTHORIZED_PUSH_PAYMENT:'#EDE9FE' }
                const VERDICT_SHORT  = { TRUE_FRAUD:'TRUE FRAUD', FIRST_PARTY_FRAUD:'1P FRAUD', CONSUMER_DISPUTE:'CONSUMER DISPUTE', AUTHORIZED_PUSH_PAYMENT:'APP FRAUD' }
                // Aggregate signals (local + Supabase)
                const allVerdicts = [
                  ...matchedTriage.map(o => o.verdict || o.correctedVerdict),
                  ...matchedDesk.map(o => o.verdict),
                  ...matchedSupa.map(o => o.verdict)
                ].filter(Boolean)
                const fraudCount   = allVerdicts.filter(v => v === 'TRUE_FRAUD' || v === 'AUTHORIZED_PUSH_PAYMENT').length
                const pattern = fraudCount >= 2 ? 'REPEAT FRAUD' : fraudCount === 1 ? 'PRIOR FRAUD' : matchedDesk.filter(o=>o.status==='won').length > 0 ? 'PRIOR WIN' : 'PRIOR HISTORY'
                const patternColor = fraudCount >= 2 ? '#7F1D1D' : fraudCount === 1 ? '#92400E' : '#1E3A5F'
                return (
                  <div className="border border-stone-300 mb-4" style={{ background: '#F9F6F0' }}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                      <div className="flex items-center gap-3">
                        <span className="mono-font text-[10px] tracking-widest text-stone-500">◈ PRIOR DISPUTES</span>
                        <span className="mono-font text-[10px] tracking-widest px-2 py-0.5 font-bold" style={{ background: patternColor, color: '#F5F1EA' }}>{pattern}</span>
                      </div>
                      <span className="mono-font text-[10px] text-stone-400">{total} record{total !== 1 ? 's' : ''} matched · {merchant}</span>
                    </div>
                    <div className="divide-y divide-stone-200">
                      {matchedDesk.slice(0,5).map((o, i) => {
                        const net = (o.network||'').toUpperCase().substring(0,4)
                        const st = o.status || '—'
                        const stColor = st === 'won' ? '#064E3B' : st === 'lost' ? '#7F1D1D' : '#57534E'
                        return (
                          <div key={i} className="flex items-center gap-3 px-4 py-2 flex-wrap">
                            <span className="mono-font text-[10px] text-stone-400 w-12 shrink-0">{o.date ? new Date(o.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</span>
                            <span className="mono-font text-[10px] text-stone-500 w-8 shrink-0">{net}</span>
                            <span className="display-font text-[12px] text-stone-700 flex-1 truncate">{o.merchant}</span>
                            <span className="mono-font text-[10px] text-stone-500">{o.amount}</span>
                            {o.verdict && <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold" style={{ background: VERDICT_BG[o.verdict]||'#E7E2D9', color: VERDICT_COLORS[o.verdict]||'#57534E' }}>{VERDICT_SHORT[o.verdict]||o.verdict}</span>}
                            <span className="mono-font text-[10px] font-bold uppercase" style={{ color: stColor }}>{st}</span>
                            {o.dfaScore && <span className="mono-font text-[10px] px-1 py-0.5 font-bold" style={{background:'#1E3A5F',color:'#BAE6FD'}}>DFA {o.dfaScore}</span>}
                            <span className="mono-font text-[10px] text-stone-300">DESK</span>
                          </div>
                        )
                      })}
                      {matchedTriage.slice(0,5).map((o, i) => {
                        const v = o.correctedVerdict || o.verdict
                        return (
                          <div key={'t'+i} className="flex items-center gap-3 px-4 py-2 flex-wrap">
                            <span className="mono-font text-[10px] text-stone-400 w-12 shrink-0">{(o.date||o.timestamp) ? new Date(o.date||o.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</span>
                            <span className="mono-font text-[10px] text-stone-500 w-8 shrink-0">—</span>
                            <span className="display-font text-[12px] text-stone-700 flex-1 truncate">{o.merchant || o.inputs?.merchant || '—'}</span>
                            <span className="mono-font text-[10px] text-stone-500">{o.amount || o.inputs?.amount || '—'}</span>
                            {v && <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold" style={{ background: VERDICT_BG[v]||'#E7E2D9', color: VERDICT_COLORS[v]||'#57534E' }}>{VERDICT_SHORT[v]||v}</span>}
                            {o.outcome && o.outcome !== 'pending' && <span className="mono-font text-[10px] font-bold uppercase text-stone-500">{o.outcome}</span>}
                            <span className="mono-font text-[10px] text-stone-300">TRIAGE</span>
                          </div>
                        )
                      })}
                      {matchedSupa.slice(0,3).map((o, i) => {
                        const net = (o.network||'').toUpperCase().substring(0,4)
                        const st = o.status || '—'
                        const stColor = st === 'won' ? '#064E3B' : st === 'lost' ? '#7F1D1D' : '#57534E'
                        return (
                          <div key={'s'+i} className="flex items-center gap-3 px-4 py-2 flex-wrap" style={{background:'#F0F7FF'}}>
                            <span className="mono-font text-[10px] text-stone-400 w-12 shrink-0">{o.date ? new Date(o.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}</span>
                            <span className="mono-font text-[10px] text-stone-500 w-8 shrink-0">{net}</span>
                            <span className="display-font text-[12px] text-stone-700 flex-1 truncate">{o.merchant}</span>
                            <span className="mono-font text-[10px] text-stone-500">{o.amount}</span>
                            {o.verdict && <span className="mono-font text-[10px] px-1.5 py-0.5 font-bold" style={{ background: VERDICT_BG[o.verdict]||'#E7E2D9', color: VERDICT_COLORS[o.verdict]||'#57534E' }}>{VERDICT_SHORT[o.verdict]||o.verdict}</span>}
                            <span className="mono-font text-[10px] font-bold uppercase" style={{ color: stColor }}>{st}</span>
                            {o.dfaScore && <span className="mono-font text-[10px] px-1 py-0.5 font-bold" style={{background:'#1E3A5F',color:'#BAE6FD'}}>DFA {o.dfaScore}</span>}
                            <span className="mono-font text-[10px] font-bold" style={{color:'#1E40AF'}}>☁ CLOUD</span>
                          </div>
                        )
                      })}
                    </div>
                    {total > 10 && (
                      <div className="px-4 py-2 mono-font text-[10px] text-stone-400 border-t border-stone-200">+{total - 10} more records not shown</div>
                    )}
                  </div>
                )
              })()}

              {/* ── Not a dispute: close at intake (FI claims) ── */}
              {!isCE && outcomes[0]?.intakeClose ? (
                <div className="flex items-center gap-3 px-5 py-4 border" style={{ background:'#FAF7F1', borderColor:'#1A1814' }}>
                  <CheckCircle className="w-5 h-5 shrink-0" style={{ color:'#1A1814' }} />
                  <div>
                    <div className="mono-font text-[10px] tracking-widest mb-0.5" style={{ color:'#57534E' }}>CLOSED AT INTAKE</div>
                    <div className="display-font text-sm" style={{ color:'#1A1814' }}>
                      Case {outcomes[0].id}: {outcomes[0].intakeClose.reasonLabel.toLowerCase()}.{outcomes[0].intakeClose.toLicit ? ' Sent to 005 Licit for AML review.' : ''} It stays on the case record, closed, and QA can sample it.
                    </div>
                  </div>
                </div>
              ) : !isCE && closing ? (
                <IntakeClose result={result} form={{ merchant, amount: amount ? `${amount} ${currency}` : '', transactionDate }}
                  institution={(() => { try { return JSON.parse(localStorage.getItem('cov_settings') || '{}').duoInstitutionName || '' } catch { return '' } })()}
                  onClose={closeAtIntake} onCancel={() => setClosing(false)} />
              ) : !isCE && !handedOff && (
                <div className="border px-5 py-4 flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: result.intake_disposition && result.intake_disposition !== 'PROCEED' ? '#1A1814' : '#D4CCBC', background:'#FAF7F1' }}>
                  <div>
                    <div className="mono-font text-[10px] tracking-widest mb-1" style={{ color:'#57534E' }}>{result.intake_disposition && result.intake_disposition !== 'PROCEED' ? 'AI SUGGESTS CLOSING AT INTAKE' : 'NOT A DISPUTE?'}</div>
                    <div className="display-font text-sm" style={{ color:'#3F3A35', maxWidth:'560px' }}>
                      {result.intake_disposition && result.intake_disposition !== 'PROCEED' ? result.disposition_reason
                        : 'Customer recognises it, it was already refunded, there are no dispute rights, or it was our error — close it here with a reason.'}
                    </div>
                  </div>
                  <button onClick={() => setClosing(true)} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'9px 16px', background: result.intake_disposition && result.intake_disposition !== 'PROCEED' ? '#1A1814' : 'transparent', color: result.intake_disposition && result.intake_disposition !== 'PROCEED' ? '#F5F1EA' : '#1A1814', border:'1px solid #1A1814', cursor:'pointer' }}>
                    CLOSE AT INTAKE →
                  </button>
                </div>
              )}

              {/* ── Send to Dispute Desk ── */}
              {!isCE && outcomes[0]?.intakeClose ? null : handedOff ? (
                <div className="flex items-center gap-3 px-5 py-4 border border-emerald-700" style={{ background: '#ECFDF5' }}>
                  <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div>
                    <div className="mono-font text-[10px] tracking-widest text-emerald-800 mb-0.5">HANDED OFF TO DISPUTE DESK</div>
                    <div className="display-font text-emerald-900 text-sm">Case {outcomes[0]?.id} is pre-filled in the Dispute Desk — switch to the Desk tab to continue.</div>
                  </div>
                </div>
              ) : (
                <div className="border" style={{ borderColor: result.proceed_to_dispute ? '#065F46' : '#D4CCBC' }}>
                  <button onClick={handleProceedToDisputeDesk}
                    className="w-full flex items-center justify-between p-5 transition-colors"
                    style={{ background: result.proceed_to_dispute ? '#1A1814' : '#FAF7F1', cursor: 'pointer', border: 'none' }}>
                    <div className="text-left">
                      <div className="mono-font text-xs tracking-widest mb-1" style={{ color: result.proceed_to_dispute && !isCE && accountType !== 'crypto' ? '#6B5F4D' : '#A89B88' }}>
                        {result.proceed_to_dispute && !isCE && accountType !== 'crypto' ? 'RECOMMENDED NEXT STEP' : 'OPTIONAL — LOG TO DESK'}
                      </div>
                      <div className="display-font font-semibold text-lg" style={{ color: result.proceed_to_dispute ? '#F5F1EA' : '#1A1814', letterSpacing: '-0.01em' }}>
                        {isCE ? 'Log in Dispute Desk →' : 'Open in Dispute Desk →'}
                      </div>
                      <div className="mono-font text-xs mt-1" style={{ color: result.proceed_to_dispute ? '#6B5F4D' : '#A89B88' }}>
                        Merchant, amount, date &amp; complaint pre-filled
                      </div>
                    </div>
                    <ExternalLink className="w-5 h-5 shrink-0" style={{ color: result.proceed_to_dispute ? '#6B5F4D' : '#D4CCBC' }} />
                  </button>
                  {!result.proceed_to_dispute && (
                    <div className="px-5 pb-3 mono-font text-xs" style={{ color: '#A89B88' }}>
                      Note: AI did not recommend filing — review signals before proceeding
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 05: Outcome Log ──────────────────────────────────────────── */}
      {(logOutcomes.length > 0 || logArchived.length > 0) && (
        <div className="mt-12 sm:mt-16">
          <hr className="tri-section-rule" style={{ margin: '0 0 28px 0' }} />
          <div className="flex items-baseline gap-3 mb-6 flex-wrap">
            <span className="mono-font text-xs text-stone-400">05</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing: '-0.01em' }}>Outcome Log</h2>
            <span className="mono-font text-[10px] tracking-widest px-2 py-0.5" style={{ background: isCE ? '#1E3A5F' : '#1A1814', color:'#F5F1EA' }}>{isCE ? 'CRYPTO EXCHANGE' : 'FINANCIAL INSTITUTION'}</span>
            <span className="mono-font text-xs text-stone-400 ml-auto">{logOutcomes.length} CASE{logOutcomes.length !== 1 ? 'S' : ''} CLASSIFIED</span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'TOTAL',           value: logOutcomes.length,                        sub: 'classified' },
              { label: 'ACCURACY',        value: accuracy !== null ? `${accuracy}%` : '—',  sub: `${resolved.length} resolved` },
              { label: 'LEADING VERDICT', value: leadingLabel,                              sub: leadingVerdict[1] > 0 ? `${leadingVerdict[1]} case${leadingVerdict[1] !== 1 ? 's' : ''}` : '' },
            ].map(s => (
              <div key={s.label} className="border border-stone-200 p-4" style={{ background: '#FAF7F1' }}>
                <div className="mono-font text-xs tracking-widest text-stone-400 mb-1">{s.label}</div>
                <div className="display-font font-semibold text-stone-900" style={{ fontSize: '22px', letterSpacing: '-0.02em' }}>{s.value}</div>
                <div className="mono-font text-xs text-stone-400 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search by case ID, merchant, or verdict..."
              value={triageSearch}
              onChange={e => setTriageSearch(e.target.value)}
              className="input-field"
              style={{ fontSize: '12px', padding: '6px 10px', flex: 1, minWidth: '200px', maxWidth: '320px' }}
            />
            {triageSearch && (
              <button onClick={() => setTriageSearch('')} className="mono-font text-[10px] text-stone-400 hover:text-stone-700 transition-colors tracking-widest" style={{ background:'none', border:'none', cursor:'pointer' }}>✕</button>
            )}
            <select
              value={verdictFilter}
              onChange={e => setVerdictFilter(e.target.value)}
              className="mono-font"
              style={{ fontSize:'10px', letterSpacing:'0.08em', padding:'6px 8px', border:'1px solid #D4CCBC', background:'#FAF7F1', color:'#57534E', cursor:'pointer' }}>
              <option value="all">ALL VERDICTS</option>
              <option value="TRUE_FRAUD">TRUE FRAUD</option>
              <option value="FIRST_PARTY_FRAUD">FIRST-PARTY FRAUD</option>
              <option value="CONSUMER_DISPUTE">CONSUMER DISPUTE</option>
              <option value="AUTHORIZED_PUSH_PAYMENT">AUTH. PUSH PAYMENT</option>
            </select>
            <div style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center' }}>
              {!showArchived && logOutcomes.length > 0 && (
                <button onClick={archiveAll}
                  className="mono-font"
                  style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'5px 10px', background:'none', border:'1px solid #D4CCBC', color:'#78716C', cursor:'pointer' }}
                  title="Move all active records to archive">
                  ↓ ARCHIVE ALL
                </button>
              )}
              <button onClick={() => setShowArchived(v => !v)}
                className="mono-font"
                style={{ fontSize:'10px', letterSpacing:'0.12em', padding:'5px 10px', background: showArchived ? '#2D2922' : 'none', color: showArchived ? '#E8E3DC' : '#78716C', border:'1px solid ' + (showArchived ? '#2D2922' : '#D4CCBC'), cursor:'pointer' }}>
                {showArchived ? '← ACTIVE LOG' : `ARCHIVED (${logArchived.length})`}
              </button>
            </div>
          </div>

          <div className="border border-stone-200 overflow-hidden" style={{ background: '#FAF7F1' }}>
            <div className="overflow-x-auto">
              <div style={{ minWidth: '600px' }}>
                <div className="grid px-4 py-2 border-b border-stone-200" style={{ gridTemplateColumns: '80px 70px 1fr 90px 1fr 80px' }}>
                  {['CASE', showArchived ? 'ARCHIVED' : 'DATE', 'MERCHANT', 'AMOUNT', 'VERDICT / OUTCOME', ''].map((h, i) => (
                    <span key={i} className="mono-font text-xs tracking-widest text-stone-400">{h}</span>
                  ))}
                </div>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {(showArchived ? logArchived : logOutcomes).filter(o => {
                    const matchSearch = (() => {
                      if (!triageSearch.trim()) return true
                      const q = triageSearch.toLowerCase()
                      return (o.id||'').toLowerCase().includes(q) ||
                        (o.merchant||'').toLowerCase().includes(q) ||
                        (o.verdict||'').toLowerCase().includes(q) ||
                        (o.amount||'').toLowerCase().includes(q)
                    })()
                    const matchVerdict = verdictFilter === 'all' || o.verdict === verdictFilter
                    return matchSearch && matchVerdict
                  }).map(o => {
                    const vc = classConfig[o.verdict]
                    if (!vc) return null
                    const isEditing = triageEditId === o.id
                    return (
                      <div key={o.id} className="border-b border-stone-100">
                        {isEditing ? (
                          <div className="px-4 py-3 bg-stone-50">
                            <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                              <div>
                                <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">MERCHANT / PAYEE</div>
                                <input className="cov-input mono-font w-full" style={{ fontSize:'12px' }}
                                  value={triageEditDraft.merchant || ''}
                                  onChange={e => setTriageEditDraft(d => ({ ...d, merchant: e.target.value }))} />
                              </div>
                              <div>
                                <div className="mono-font text-[10px] tracking-widest text-stone-400 mb-1">AMOUNT</div>
                                <input className="cov-input mono-font w-full" style={{ fontSize:'12px' }}
                                  value={triageEditDraft.amount || ''}
                                  onChange={e => setTriageEditDraft(d => ({ ...d, amount: e.target.value }))} />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => {
                                setOutcomes(prev => prev.map(x => x.id === o.id ? { ...x, ...triageEditDraft } : x))
                                setTriageEditId(null)
                              }} className="mono-font text-[10px] px-2 py-1 bg-stone-800 text-stone-100" style={{ border:'none', cursor:'pointer' }}>SAVE</button>
                              <button onClick={() => setTriageEditId(null)} className="mono-font text-[10px] px-2 py-1 border border-stone-300 text-stone-500" style={{ background:'none', cursor:'pointer' }}>CANCEL</button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid px-4 py-3 items-center" style={{ gridTemplateColumns: '80px 70px 1fr 90px 1fr 80px' }}>
                            <span className="mono-font text-xs text-stone-400">{o.id}</span>
                            <span className="mono-font text-xs text-stone-500">{new Date(showArchived && o.archivedAt ? o.archivedAt : o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            <span className="display-font text-sm text-stone-700 truncate pr-3">{o.merchant}</span>
                            <span className="mono-font text-xs text-stone-600">{o.amount}</span>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="mono-font px-1.5 py-0.5 shrink-0" style={{ fontSize: '10px', letterSpacing: '0.08em', background: vc.bg, color: vc.badgeText }}>{vc.label}</span>
                              {overridePickId === o.id ? (
                                /* ── Inline verdict picker on override ── */
                                <div className="flex flex-col gap-1.5">
                                  <div className="mono-font text-[10px] tracking-widest text-red-700">WHAT IS THE CORRECT VERDICT?</div>
                                  {[
                                    { id:'TRUE_FRAUD',               label:'TRUE FRAUD' },
                                    { id:'FIRST_PARTY_FRAUD',        label:'FIRST-PARTY FRAUD' },
                                    { id:'CONSUMER_DISPUTE',         label:'CONSUMER DISPUTE' },
                                    { id:'AUTHORIZED_PUSH_PAYMENT',  label:'AUTH. PUSH PAYMENT' },
                                  ].map(v => (
                                    <button key={v.id}
                                      onClick={() => { markOutcome(o.id, 'overridden', v.id); setOverridePickId(null) }}
                                      className="mono-font text-[10px] px-2 py-0.5 text-left transition-colors"
                                      style={{ background: v.id === o.verdict ? '#FEE2E2' : '#FAF7F1', border:'1px solid ' + (v.id === o.verdict ? '#FCA5A5' : '#D4CCBC'), color: v.id === o.verdict ? '#991B1B' : '#57534E', cursor:'pointer' }}>
                                      {v.id === o.verdict ? '← was: ' : ''}{v.label}
                                    </button>
                                  ))}
                                  <button onClick={() => setOverridePickId(null)} className="mono-font text-[10px] text-stone-400 hover:text-stone-600 transition-colors" style={{ background:'none', border:'none', cursor:'pointer' }}>CANCEL</button>
                                </div>
                              ) : o.outcome === 'pending' ? (
                                <div className="flex gap-1 flex-wrap">
                                  <button onClick={() => markOutcome(o.id, 'confirmed')} className="mono-font text-xs px-2 py-0.5 border border-emerald-700 text-emerald-700 hover:bg-emerald-50 transition-colors" title="Verdict was correct" style={{ background: 'none', cursor: 'pointer' }}>✓</button>
                                  <button onClick={() => setOverridePickId(o.id)} className="mono-font text-xs px-2 py-0.5 border border-red-700 text-red-700 hover:bg-red-50 transition-colors" title="Verdict was wrong — select correct verdict" style={{ background: 'none', cursor: 'pointer' }}>✗</button>
                                  <button onClick={() => reloadCase(o)} className="mono-font text-[10px] px-2 py-0.5 border border-stone-400 text-stone-500 hover:bg-stone-50 transition-colors" title="Re-run triage analysis on this case" style={{ background: 'none', cursor: 'pointer' }}>↺ RERUN</button>
                                </div>
                              ) : (
                                <div className="flex gap-1 items-center flex-wrap">
                                  <span className={`mono-font text-xs ${o.outcome === 'confirmed' ? 'text-emerald-700' : 'text-red-700'}`}>
                                    {o.outcome === 'confirmed' ? '✓ CONFIRMED' : '✗ OVERRIDDEN'}
                                  </span>
                                  {o.correctedVerdict && o.correctedVerdict !== o.verdict && (
                                    <span className="mono-font text-[10px] px-1 py-0.5 bg-red-100 text-red-700">→ {o.correctedVerdict.replace(/_/g,' ')}</span>
                                  )}
                                  <button onClick={() => { setOutcomes(prev => prev.map(x => x.id === o.id ? { ...x, outcome: 'pending', correctedVerdict: null } : x)) }} className="mono-font text-[10px] text-stone-400 hover:text-stone-600 transition-colors" style={{ background:'none', border:'none', cursor:'pointer' }} title="Reset outcome">↩</button>
                                  <button onClick={() => reloadCase(o)} className="mono-font text-[10px] px-1.5 py-0.5 border border-stone-300 text-stone-400 hover:bg-stone-50 transition-colors" title="Re-run triage analysis on this case" style={{ background: 'none', cursor: 'pointer' }}>↺ RERUN</button>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {showArchived ? (
                                <button onClick={() => unarchiveOne(o.id)}
                                  className="mono-font text-[10px] px-2 py-0.5"
                                  style={{ background:'none', border:'1px solid #A8A29E', color:'#78716C', cursor:'pointer', letterSpacing:'0.06em', whiteSpace:'nowrap' }}
                                  title="Restore to active log">↩ RESTORE</button>
                              ) : (<>
                                {onSendToDuo && (
                                  <button onClick={() => onSendToDuo({ ...o, source:'triage' })}
                                    className="mono-font text-[10px] px-2 py-0.5"
                                    style={{ background:'#064E3B', color:'#F0FDF4', border:'none', cursor:'pointer', letterSpacing:'0.06em', whiteSpace:'nowrap' }}
                                    title="Open in Duo Mode">→ DUO</button>
                                )}
                                {onHandoff && (
                                  <button
                                    onClick={() => onHandoff({
                                      caseId: o.id,
                                      classification: o.verdict,
                                      confidence: o.confidence || 'MEDIUM',
                                      headline: (o.verdict || '').replace(/_/g, ' '),
                                      merchant: o.merchant || '',
                                      amount: o.amount || '',
                                      network: (o.network || '').toLowerCase(),
                                    })}
                                    className="mono-font text-[10px] px-2 py-0.5"
                                    style={{ background:'#1E3A5F', color:'#BFDBFE', border:'none', cursor:'pointer', letterSpacing:'0.06em', whiteSpace:'nowrap' }}
                                    title="Send to Dispute Desk — pre-fills desk form without rerunning triage">→ DESK</button>
                                )}
                                <button onClick={() => { setTriageEditId(o.id); setTriageEditDraft({ merchant: o.merchant, amount: o.amount }) }}
                                  className="mono-font text-[10px] px-2 py-0.5 border border-stone-300 text-stone-400 hover:bg-stone-50 transition-colors"
                                  style={{ background:'none', cursor:'pointer' }} title="Edit case details">✎</button>
                                <button onClick={() => archiveOne(o.id)}
                                  className="mono-font text-[10px] px-2 py-0.5 border border-stone-200 text-stone-400 hover:bg-stone-50 transition-colors"
                                  style={{ background:'none', cursor:'pointer' }} title="Archive this record">↓</button>
                              </>)}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex justify-between items-center">
            <div className="mono-font text-[10px] tracking-widest text-stone-400">
              {showArchived
                ? `${logArchived.length} archived ${logLabel} record${logArchived.length !== 1 ? 's' : ''}`
                : `${logOutcomes.length} active ${logLabel} record${logOutcomes.length !== 1 ? 's' : ''}`}
            </div>
            <div className="flex gap-3">
              {showArchived && logArchived.length > 0 && (
                <button
                  onClick={() => { if (window.confirm(`Permanently delete all ${logArchived.length} archived ${logLabel} records? This cannot be undone.`)) setArchivedOutcomes(prev => prev.filter(o => !inLogMode(o))) }}
                  className="mono-font text-[10px] tracking-widest text-red-400 hover:text-red-600 transition-colors"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  ✕ CLEAR ARCHIVE
                </button>
              )}
              {!showArchived && logOutcomes.length > 0 && (
                <button
                  onClick={() => { if (window.confirm(`Permanently delete all ${logOutcomes.length} active ${logLabel} triage records? Consider archiving instead.`)) setOutcomes(prev => prev.filter(o => !inLogMode(o))) }}
                  className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-red-500 transition-colors"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  ✕ CLEAR ACTIVE LOG
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div className="mt-12 sm:mt-16 pt-6 flex flex-col sm:flex-row sm:items-baseline justify-between text-stone-500 gap-2" style={{ borderTop: '1px solid #D4CCBC' }}>
        <div className="mono-font text-xs tracking-widest">BUILT BY ADEOTI FASHOKUN — RISK &amp; TRUST OPERATIONS</div>
        <div className="display-font italic text-sm">"Classify before you file. The routing matters."</div>
      </div>
      </div>
    </div>
  )
}

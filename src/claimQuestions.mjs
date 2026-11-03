// ═══════════════════════════════════════════════════════════════════════════════
// QUESTIONS BY CLAIM TYPE — what the bank's app asks the customer
// ═══════════════════════════════════════════════════════════════════════════════
// Covalence serves these to the bank's app (GET /api/claims?questions=<type>), so
// the answers that come back are the ones the networks and Reg E / Reg Z need, in
// words a customer understands. The same list labels the answers in Triage →
// Claims and decides which are required before a claim is Ready for Desk.
// Plain data and functions, no imports, so the server and the browser agree.
//
// A question: { id, ask, kind, options?, required?, showIf?, accounts?, sides?, why }
//   kind      yesno (true / false), choice (one of options' values), date (YYYY-MM-DD),
//             amount (a number), text (up to 500 characters)
//   showIf    asked only when an earlier answer has this value: { id: value }
//   accounts  asked only for these account types (default: every one)
//   sides     asked only on these sides: fi (a bank), ce (an exchange), mx (a merchant) (default: every one)
//   why       what the answer is for, for the bank's product team (wording to review with counsel)

const CARDS = ['debit', 'credit']
const yn = (id, ask, why, more = {}) => ({ id, ask, kind: 'yesno', why, ...more })

// The first question for an unrecognised transaction, and the claim closes at intake when it's yes
const RECOGNISES = yn('recognisesTransaction', 'Do you recognise this transaction?',
  'An unauthorised claim needs the customer to say they didn’t make it. “Yes” usually means it isn’t fraud.', { required: true })
// Asked by a bank about the merchant; a merchant asking its own customer leaves them out
const CONTACTED = yn('contactedMerchant', 'Have you contacted the merchant about it?',
  'The networks expect the customer to try the merchant first for most purchase disputes.', { required: true, sides: ['fi'] })
const MERCHANT_SAID = { id: 'merchantResponse', ask: 'What did the merchant say?', kind: 'text', showIf: { contactedMerchant: true }, sides: ['fi'],
  why: 'Shows the merchant had a chance to put it right, and what they offered.' }
const ORDER_REF = { id: 'orderNumber', ask: 'What’s your order number, if you have it?', kind: 'text', sides: ['mx'],
  why: 'Finds the order straight away.' }
const WHAT_BOUGHT = { id: 'whatPurchased', ask: 'What did you buy?', kind: 'text', required: true,
  why: 'The dispute has to describe the goods or service.' }

const UNAUTH = [
  RECOGNISES,
  yn('cardInPossession', 'Do you still have your card?', 'Lost or stolen and card-still-in-hand fraud are filed under different reason codes.',
    { required: true, accounts: CARDS }),
  { id: 'noticedMissingOn', ask: 'When did you notice the card was missing?', kind: 'date', showIf: { cardInPossession: false }, required: true, accounts: CARDS,
    why: 'Under Reg E the customer’s liability depends on how soon they told the bank after they knew.' },
  yn('sharedCardDetails', 'Has anyone else had your card, PIN or banking details, even someone you know?',
    'A charge by someone the customer gave access to may count as authorised.', { required: true }),
  yn('otherUnrecognised', 'Are there other transactions you don’t recognise?', 'Finds the rest of the fraud, so it can be claimed together and the card blocked.'),
]

const SCAM_COMMON = [
  yn('madePaymentYourself', 'Did you make or approve the payment yourself?',
    'If the customer sent it themselves after being tricked, it’s a scam claim, not unauthorised use; Reg E treats the two differently.', { required: true }),
  { id: 'howContacted', ask: 'How did they first contact you?', kind: 'choice', required: true,
    options: [['phone', 'Phone call'], ['text', 'Text message'], ['email', 'Email'], ['social', 'Social media'], ['dating', 'Dating app or site'], ['in_person', 'In person'], ['other', 'Another way']],
    why: 'Helps match the claim to known scams and report it.' },
  yn('stillInContact', 'Are you still in contact with them?', 'A scam that’s still going on is urgent: the customer may send more.', { required: true }),
  yn('askedForMore', 'Have they asked you for more money?', 'A sign the scam is ongoing.'),
  yn('reportedToPolice', 'Have you reported it to the police?', 'A police report supports the claim and any recovery.'),
  { id: 'policeReference', ask: 'What’s the police reference number?', kind: 'text', showIf: { reportedToPolice: true }, why: 'Kept with the claim for the investigation.' },
]

export const QUESTIONS = {
  unauth_card_present: UNAUTH,
  unauth_cnp: UNAUTH,
  counterfeit: UNAUTH,
  ato: [
    RECOGNISES,
    yn('noticedChanges', 'Did anything change on your account that you didn’t do, like your password, phone number, email or a new device?',
      'Changes the customer didn’t make point to account takeover.', { required: true }),
    yn('sharedCode', 'Did anyone ask you for a code, a password, or to approve a sign-in?',
      'If the customer gave a code to a caller, it may be a scam rather than a takeover.', { required: true }),
    yn('canStillSignIn', 'Can you still sign in to your account?', 'If not, the bank needs to secure the account first.'),
    yn('otherUnrecognised', 'Are there other transactions you don’t recognise?', 'Finds the rest of the fraud, so it can be claimed together.'),
  ],
  non_receipt: [
    WHAT_BOUGHT,
    { id: 'expectedDelivery', ask: 'When were you expecting it?', kind: 'date', required: true,
      why: 'The networks don’t allow a non-receipt dispute until the expected date has passed.' },
    { id: 'goodsOrService', ask: 'Was it goods, a service, or something digital?', kind: 'choice', required: true,
      options: [['goods', 'Goods'], ['service', 'A service'], ['digital', 'Something digital']], why: 'Each has its own rules for what counts as received.' },
    CONTACTED, MERCHANT_SAID,
  ],
  not_as_described: [
    WHAT_BOUGHT,
    { id: 'whatWasWrong', ask: 'How was it different from what you were promised?', kind: 'text', required: true,
      why: 'The dispute has to say how it differed from the description.' },
    yn('returnedIt', 'Have you returned it, or tried to?', 'Most networks require the customer to return goods or try to, before a “not as described” dispute.', { required: true }),
    { id: 'returnedOn', ask: 'When did you return it?', kind: 'date', showIf: { returnedIt: true }, why: 'The return date sets when the dispute can be filed.' },
    CONTACTED, MERCHANT_SAID,
  ],
  cancelled_sub: [
    { id: 'cancelledOn', ask: 'When did you cancel?', kind: 'date', required: true, why: 'Charges after the cancellation date are the ones that can be disputed.' },
    { id: 'howCancelled', ask: 'How did you cancel?', kind: 'choice', required: true,
      options: [['online', 'On their website'], ['in_app', 'In their app'], ['email', 'By email'], ['phone', 'By phone'], ['other', 'Another way']],
      why: 'The networks ask how the cardholder cancelled.' },
    { id: 'cancellationReference', ask: 'Do you have a cancellation number or confirmation email? If so, what does it say?', kind: 'text',
      why: 'Proof of cancellation wins most of these disputes.' },
    CONTACTED, MERCHANT_SAID,
  ],
  billing_error: [
    { id: 'expectedAmount', ask: 'How much did you expect to pay?', kind: 'amount', required: true, why: 'The disputed amount is the difference.' },
    { id: 'whatWasWrong', ask: 'What was wrong with the charge?', kind: 'text', required: true, why: 'Describes the error for the dispute.' },
    CONTACTED, MERCHANT_SAID,
  ],
  duplicate_charge: [
    yn('samePurchase', 'Were both charges for the same purchase?', 'A duplicate dispute needs both charges to be for one purchase.', { required: true }),
    yn('refundedEither', 'Has the merchant refunded either charge?', 'If one was refunded, there’s nothing left to dispute.', { required: true }),
    CONTACTED,
  ],
  partial_delivery: [
    WHAT_BOUGHT,
    { id: 'whatWasMissing', ask: 'What didn’t arrive? Say how many items you ordered and how many came.', kind: 'text', required: true,
      why: 'Only the part that didn’t arrive can be disputed, so the amount has to match what’s missing.' },
    { id: 'missingAmount', ask: 'Roughly how much were the missing items worth?', kind: 'amount',
      why: 'Sets the amount to dispute or refund when it’s less than the whole payment.' },
    { id: 'expectedDelivery', ask: 'When were you expecting it?', kind: 'date', required: true,
      why: 'The networks don’t allow a non-receipt dispute until the expected date has passed.' },
    ORDER_REF, CONTACTED, MERCHANT_SAID,
  ],
  wrong_item: [
    WHAT_BOUGHT,
    { id: 'whatArrived', ask: 'What arrived instead?', kind: 'text', required: true, why: 'Shows how what was sent differs from the order.' },
    yn('returnedIt', 'Have you returned it, or tried to?', 'Most networks require the customer to return goods or try to, before a “not as described” dispute.', { required: true }),
    ORDER_REF, CONTACTED, MERCHANT_SAID,
  ],
  refund_not_received: [
    { id: 'refundPromisedOn', ask: 'When were you told you’d get the refund?', kind: 'date', required: true, why: 'Refunds usually take up to 10 days to show; after that it can be chased or disputed.' },
    { id: 'refundAmount', ask: 'How much is the refund?', kind: 'amount', required: true, why: 'The amount still owed.' },
    { id: 'refundReference', ask: 'Do you have a refund or return number? If so, what is it?', kind: 'text', why: 'Proof of a promised refund settles most of these.' },
    ORDER_REF, CONTACTED, MERCHANT_SAID,
  ],
  // ── A crypto exchange ──
  unauth_withdrawal: [
    { ...RECOGNISES, ask: 'Do you recognise this withdrawal?' },
    yn('noticedChanges', 'Did anything change on your account that you didn’t do, like your password, phone number, email, 2FA or a new device?',
      'Changes the customer didn’t make point to account takeover.', { required: true }),
    yn('sharedCode', 'Did anyone ask you for a code, a password, your seed phrase, or to approve a sign-in?',
      'If the customer gave a code to a caller, it may be a scam rather than a takeover.', { required: true }),
    yn('canStillSignIn', 'Can you still sign in to your account?', 'If not, the exchange needs to secure the account first.'),
    yn('otherUnrecognised', 'Are there other withdrawals or trades you don’t recognise?', 'Finds the rest of it, so it can be traced together.'),
  ],
  deposit_missing: [
    { id: 'txHash', ask: 'What’s the transaction hash or ID?', kind: 'text', required: true, why: 'Finds the deposit on the chain.' },
    { id: 'networkUsed', ask: 'Which network did you send it on (for example Ethereum, Tron, Bitcoin)?', kind: 'text', required: true,
      why: 'A deposit sent on a network the exchange doesn’t support for that coin won’t credit by itself.' },
    yn('memoIncluded', 'If your deposit address had a memo or tag, did you include it?', 'A missing memo is the most common reason a deposit doesn’t credit.'),
    { id: 'sentFrom', ask: 'Where did you send it from?', kind: 'text', why: 'The sending platform can confirm the transaction.' },
  ],
  withdrawal_missing: [
    { id: 'receivingPlatform', ask: 'Where did you send it to?', kind: 'text', required: true, why: 'The receiving platform may need to credit it.' },
    yn('addressChecked', 'Have you checked the address you sent it to is right?', 'A withdrawal to the wrong address usually can’t be recovered.', { required: true }),
    { id: 'txHash', ask: 'What’s the transaction hash or ID?', kind: 'text', why: 'Finds the withdrawal on the chain.' },
  ],
  wrong_address: [
    { id: 'whatWentWrong', ask: 'What went wrong?', kind: 'choice', required: true,
      options: [['wrong_address', 'I sent it to the wrong address'], ['wrong_network', 'I picked the wrong network'], ['missing_memo', 'I left out the memo or tag'], ['other', 'Something else']],
      why: 'Some of these can be recovered; a wrong address usually can’t.' },
    { id: 'receivingPlatform', ask: 'Where were you trying to send it?', kind: 'text', required: true, why: 'The receiving platform may be able to help.' },
    { id: 'txHash', ask: 'What’s the transaction hash or ID?', kind: 'text', why: 'Finds the transaction on the chain.' },
  ],
  romance_scam: SCAM_COMMON,
  investment_scam: [...SCAM_COMMON,
    { id: 'platformName', ask: 'What was the name of the investment platform or website?', kind: 'text', why: 'Helps match the claim to known fake platforms.' }],
  impersonation: [...SCAM_COMMON.slice(0, 1),
    { id: 'claimedToBe', ask: 'Who did they say they were?', kind: 'choice', required: true,
      options: [['our_bank', 'Someone from this bank'], ['government', 'The government, police or tax office'], ['company', 'A company, like a phone or delivery firm'], ['family', 'A family member or friend'], ['other', 'Someone else']],
      why: 'Bank impersonation is urgent, and helps the bank warn other customers.' },
    ...SCAM_COMMON.slice(1)],
  fake_invoice: [...SCAM_COMMON.slice(0, 1),
    yn('expectedInvoice', 'Were you expecting to pay this person or company?', 'A changed bank account on a real supplier’s invoice is a common scam.', { required: true }),
    ...SCAM_COMMON.slice(2)],
  grandparent_scam: SCAM_COMMON,
  other_app: SCAM_COMMON,
  other: [],
}

// The questions for one claim type and account type, in order. Unknown types get none.
export function questionsFor(claimType, accountType = '', segment = 'fi') {
  return (QUESTIONS[claimType] || []).filter(q => (!q.accounts || !accountType || q.accounts.includes(accountType)) && (!q.sides || q.sides.includes(segment || 'fi')))
}

// Is a question asked, given the answers so far?
const asked = (q, answers) => !q.showIf || Object.entries(q.showIf).every(([k, v]) => answers?.[k] === v)

// An answer of the right kind? (dates as YYYY-MM-DD, choices one of the values)
function fits(q, v) {
  if (q.kind === 'yesno') return typeof v === 'boolean'
  if (q.kind === 'amount') return typeof v === 'number' && isFinite(v) && v >= 0
  if (q.kind === 'date') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T12:00:00'))
  if (q.kind === 'choice') return q.options.some(([value]) => value === v)
  return typeof v === 'string' && v.trim().length > 0
}

// Check the answers for a claim: { unanswered: [question], problems: ['id: why'] }
// unanswered lists required questions that were asked and have no answer that fits.
export function checkAnswers(claimType, accountType, answers = {}, segment = 'fi') {
  const unanswered = [], problems = []
  questionsFor(claimType, accountType, segment).forEach(q => {
    if (!asked(q, answers)) return
    const v = answers[q.id]
    if (v === undefined || v === null || v === '') { if (q.required) unanswered.push(q); return }
    if (!fits(q, v)) {
      problems.push(`${q.id}: ${q.kind === 'choice' ? `one of ${q.options.map(o => o[0]).join(', ')}` : q.kind === 'date' ? 'a date as YYYY-MM-DD' : q.kind === 'yesno' ? 'true or false' : q.kind === 'amount' ? 'a number' : 'some text'}`)
      if (q.required) unanswered.push(q)
    }
  })
  return { unanswered, problems }
}

// The question behind an answer, from any claim type (for labelling answers in Triage)
const ALL = new Map()   // the first wording of each id (a few are shared between kinds)
Object.values(QUESTIONS).flat().forEach(q => { if (!ALL.has(q.id)) ALL.set(q.id, q) })
export const questionById = id => ALL.get(id) || null
// An answer in words: yes / no, a choice's label, a date, or the text itself
export function answerWords(id, v) {
  const q = ALL.get(id)
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  if (q?.kind === 'choice') return q.options.find(o => o[0] === v)?.[1] || String(v)
  if (q?.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return String(v)
}

// What the bank's app gets: the questions, without the account filter, in a stable shape
export const publicQuestions = (claimType, accountType, segment = 'fi') => questionsFor(claimType, accountType, segment).map(q => ({
  id: q.id, ask: q.ask, kind: q.kind, required: !!q.required,
  ...(q.options ? { options: q.options.map(([value, label]) => ({ value, label })) } : {}),
  ...(q.showIf ? { showIf: q.showIf } : {}), why: q.why,
}))

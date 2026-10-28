// ═══════════════════════════════════════════════════════════════════════════════
// INTAKE CLOSE — Triage's way out for claims that aren't disputes
// ═══════════════════════════════════════════════════════════════════════════════
// Plenty of intake calls aren't fraud and can't be disputed: the customer
// recognises the charge, the merchant already refunded it, the customer sent
// the payment themselves (wire, Zelle, P2P), the claim is out of time, or the
// bank made the error. This closes the claim at intake with a reason, keeps it
// as a closed case on the shared record (so QA samples it), drafts the written
// explanation the customer is owed where one is needed, and — when the payment
// looks like a scam or something worse — sends it to 005 Licit for AML review.
// The letter never mentions a compliance referral (no tipping off).
import React, { useMemo, useState } from 'react'
import { Button, Input } from './ui.jsx'

export const CLOSE_REASONS = {
  recognized:     { label: 'Customer recognises the transaction', notice: false, status: 'withdrawn',
                    hint: 'They made it, or someone they allowed did. Record what they said.' },
  credited:       { label: 'Merchant already refunded or credited it', notice: false, status: 'resolved',
                    hint: 'Confirm the credit has posted before closing.' },
  no_rights:      { label: 'No dispute rights', notice: true, status: 'closed',
                    hint: 'Covalence drafts the written explanation. Check it against your policy before sending.' },
  bank_error:     { label: 'Bank error — correct it', notice: true, status: 'resolved',
                    hint: 'Correct the account, then send the notice of correction.' },
  refer:          { label: 'Not a dispute — refer to compliance', notice: false, status: 'closed',
                    hint: 'Goes to 005 Licit for AML review. Nothing is said to the customer about the referral.' },
}
export const NO_RIGHTS_BASIS = {
  authorised_push: 'The customer sent the payment themselves (wire, Zelle or another person-to-person transfer)',
  out_of_time:     'The claim was made after the time allowed for disputes',
  not_covered:     'The transaction isn’t covered by card network dispute rules or Regulation E',
  other:           'Other (explain in the note)',
}

// The AI's suggestion (Triage prompt: intake_disposition) → our reason key
export const SUGGESTION = {
  CLOSE_RECOGNIZED: 'recognized', CLOSE_ALREADY_CREDITED: 'credited', CLOSE_NO_DISPUTE_RIGHTS: 'no_rights',
  CORRECT_BANK_ERROR: 'bank_error', REFER_TO_COMPLIANCE: 'refer',
}

const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'the date shown on your statement'

function draftNotice({ reason, basis, amount, merchant, date, institution }) {
  const pay = `the ${amount || ''} payment${merchant ? ` to ${merchant}` : ''} on ${fmtDate(date)}`.replace('the  payment', 'the payment')
  const body = reason === 'bank_error'
    ? [`We have reviewed your claim about ${pay}.`,
       'We found that an error was made on our side and have corrected your account. The correction will appear on your next statement.',
       'We are sorry for the inconvenience.']
    : [`We have completed our review of your claim about ${pay}.`,
       basis === 'authorised_push' ? 'Our records show that this payment was sent from your account with your authorisation. Because you authorised it, it cannot be reversed through our dispute process, even where you were misled about who you were paying.'
       : basis === 'out_of_time' ? 'The claim was made after the period allowed for disputing this type of transaction, so we are unable to reverse it through our dispute process.'
       : basis === 'not_covered' ? 'This type of transaction is not covered by the dispute rights that apply to your account, so we are unable to reverse it through our dispute process.'
       : 'Based on our review, we are unable to reverse this transaction through our dispute process.',
       'You may ask us for copies of the documents we relied on to reach this conclusion, and we will provide them.',
       ...(basis === 'authorised_push' ? ['If you believe you were the victim of a scam, we encourage you to report it to the Federal Trade Commission at ReportFraud.ftc.gov and to the FBI at ic3.gov, and to contact us right away if anyone asks you to send more money.'] : []),
       'If you have questions, please contact us.']
  return ['Dear customer,', '', ...body.flatMap(p => [p, '']), 'Sincerely,', institution || 'Disputes team'].join('\n')
}

export function IntakeClose({ result, form, institution, onClose, onCancel }) {
  const suggested = SUGGESTION[result?.intake_disposition] || ''
  const [reason, setReason] = useState(suggested || '')
  const [basis, setBasis] = useState(result?.intake_disposition === 'CLOSE_NO_DISPUTE_RIGHTS' && /author|zelle|wire|p2p|push/i.test(result?.disposition_reason || '') ? 'authorised_push' : '')
  const [note, setNote] = useState('')
  const [customer, setCustomer] = useState('')
  // A scam payment or a referral goes to Licit; the analyst can change it
  const [toLicit, setToLicit] = useState(() => result?.classification === 'AUTHORIZED_PUSH_PAYMENT' || suggested === 'refer')
  const r = CLOSE_REASONS[reason]
  const letter = useMemo(() => r?.notice ? draftNotice({ reason, basis, amount: form.amount, merchant: form.merchant, date: form.transactionDate, institution }) : '', [reason, basis, form, institution])
  const [edited, setEdited] = useState(null)
  const text = edited ?? letter
  const ready = reason && (reason !== 'no_rights' || basis) && note.trim().length >= 5

  return (
    <div style={{ border:'1px solid #1A1814', background:'#FAF7F1', padding:'18px 20px', display:'grid', gap:'14px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E' }}>CLOSE AT INTAKE</div>
      {result?.intake_disposition && result.intake_disposition !== 'PROCEED' && (
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:0, lineHeight:1.5 }}>
          <strong>AI suggests:</strong> {CLOSE_REASONS[suggested]?.label || result.intake_disposition}. {result.disposition_reason}
        </p>
      )}
      <fieldset style={{ border:0, padding:0, margin:0, display:'grid', gap:'6px' }}>
        <legend className="display-font" style={{ fontSize:'15px', color:'#1A1814', marginBottom:'6px' }}>Why is this closing?</legend>
        {Object.entries(CLOSE_REASONS).map(([k, v]) => (
          <label key={k} className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'baseline', cursor:'pointer' }}>
            <input type="radio" name="intake-reason" checked={reason === k} onChange={() => { setReason(k); setEdited(null); if (k === 'refer') setToLicit(true) }} />
            <span>{v.label}{k === suggested && <span className="mono-font" style={{ fontSize:'10px', color:'#065F46', marginLeft:'6px' }}>AI SUGGESTION</span>}
              {reason === k && <span style={{ display:'block', fontSize:'13px', color:'#57534E' }}>{v.hint}</span>}</span>
          </label>
        ))}
      </fieldset>
      {reason === 'no_rights' && (
        <label className="display-font" style={{ fontSize:'14px', display:'grid', gap:'6px' }}>Basis
          <select className="input-field" value={basis} onChange={e => { setBasis(e.target.value); setEdited(null) }} style={{ padding:'8px 10px', fontSize:'14px' }}>
            <option value="">— choose —</option>
            {Object.entries(NO_RIGHTS_BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      <label className="display-font" style={{ fontSize:'14px', display:'grid', gap:'6px' }}>What the customer said, and what you checked
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="cov-input" style={{ padding:'8px 10px', fontSize:'14px', fontFamily:'inherit', resize:'vertical' }} />
      </label>
      <label className="display-font" style={{ fontSize:'14px', display:'grid', gap:'6px', maxWidth:'360px' }}>Customer name <span style={{ fontSize:'12px', color:'#6B6259' }}>— optional; used for sanctions screening and linking cases</span>
        <Input value={customer} onChange={e => setCustomer(e.target.value)} style={{ padding:'8px 10px', fontSize:'14px' }} />
      </label>
      <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'baseline', cursor:'pointer' }}>
        <input type="checkbox" checked={toLicit} onChange={e => setToLicit(e.target.checked)} disabled={reason === 'refer'} />
        <span>Send to 005 Licit for AML review<span style={{ display:'block', fontSize:'13px', color:'#57534E' }}>Scam payments often have no dispute rights but still matter to AML: the payee may be a mule account.</span></span>
      </label>

      {r?.notice && (
        <div>
          <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', color:'#92400E', marginBottom:'6px' }}>WRITTEN NOTICE TO THE CUSTOMER — REVIEW BEFORE SENDING</div>
          <textarea value={text} onChange={e => setEdited(e.target.value)} rows={12} className="cov-input" aria-label="Customer notice"
            style={{ width:'100%', padding:'10px 12px', fontSize:'14px', lineHeight:1.55, fontFamily:"'Fraunces',Georgia,serif", resize:'vertical' }} />
          <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', marginTop:'4px' }}>
            For Regulation E error claims, the explanation is due in writing within 3 business days of finishing the investigation. It never mentions a compliance referral.
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
        <Button disabled={!ready} onClick={() => onClose({ reason, reasonLabel: r.label, basis, basisLabel: basis ? NO_RIGHTS_BASIS[basis] : '', note: note.trim(),
          customer: customer.trim(), toLicit: toLicit || reason === 'refer', notice: r.notice ? text : '', status: r.status })}>Close the claim</Button>
        {r?.notice && <Button variant="secondary" disabled={!text} onClick={() => navigator.clipboard?.writeText(text)}>Copy notice</Button>}
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
      {!ready && reason && <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }}>{reason === 'no_rights' && !basis ? 'Choose the basis. ' : ''}{note.trim().length < 5 ? 'Add a short note.' : ''}</div>}
    </div>
  )
}

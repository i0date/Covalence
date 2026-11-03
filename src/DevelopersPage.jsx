// ═══════════════════════════════════════════════════════════════════════════════
// FOR YOUR DEVELOPERS — public page at /developers
// ═══════════════════════════════════════════════════════════════════════════════
// How an institution's systems talk to Covalence: /api/intake (transactions,
// events, alerts), /api/claims (claims, questions, "Is this yours?") and the
// signed events Covalence sends back. Public so a bank's engineers can read it
// without an account: it holds no keys and no customer data, only how the API
// works. Settings → Connections links here (admins only). Keep it true to
// api/intake.js, api/claims.js and api/_webhook.js.
import React, { useState } from 'react'
import { GLOBAL_CSS } from './shared.jsx'

const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px', marginBottom:'20px', scrollMarginTop:'16px' }
const H2 = ({ children }) => <h2 className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.2em', color:'#1A1814', margin:'0 0 12px', fontWeight:600 }}>{children}</h2>
// A code sample with a copy button
function Code({ children }) {
  const [done, setDone] = useState(false)
  return (
    <div style={{ position:'relative', margin:'8px 0' }}>
      <pre className="mono-font" style={{ fontSize:'12px', background:'#1A1814', color:'#F5F1EA', padding:'12px 14px', paddingTop:'30px', overflowX:'auto', margin:0, lineHeight:1.5 }}>{children}</pre>
      <button type="button" className="mono-font" onClick={() => { navigator.clipboard?.writeText(String(children)); setDone(true); setTimeout(() => setDone(false), 1500) }}
        style={{ position:'absolute', top:'6px', right:'6px', fontSize:'10px', letterSpacing:'0.1em', background:'#3F3A35', color:'#F5F1EA', border:'none', padding:'3px 8px', cursor:'pointer' }}>{done ? 'COPIED' : 'COPY'}</button>
    </div>
  )
}
const CONTENTS = [['start', 'Before you start'], ['send', 'Send transactions, events and alerts'], ['claims', 'Claims from your app'], ['form', 'The hosted claim form'], ['events', 'What your endpoint receives']]

export default function DevelopersPage() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://covalence.vercel.app'
  return (
    <div style={{ background:'#F5F1EA', minHeight:'100vh' }}>
      <style>{GLOBAL_CSS}{`.dev-page code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: #EDE7DC; padding: 0 4px; }`}</style>
      <header style={{ background:'#1A1814', padding:'14px 16px' }}>
        <div style={{ maxWidth:'860px', margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <a href="/" className="mono-font" style={{ color:'#F5F1EA', fontSize:'13px', letterSpacing:'0.3em', textDecoration:'none' }}>COVALENCE</a>
          <span className="mono-font" style={{ color:'#A8A29E', fontSize:'10px', letterSpacing:'0.12em' }}>FOR YOUR DEVELOPERS</span>
        </div>
      </header>
      <main className="dev-page" style={{ maxWidth:'860px', margin:'0 auto', padding:'40px 16px 64px' }}>
        <h1 className="display-font" style={{ fontSize:'clamp(34px, 6vw, 52px)', fontWeight:700, color:'#1A1814', letterSpacing:'-0.03em', lineHeight:1.05, margin:'0 0 14px' }}>
          Connecting your systems <span style={{ fontStyle:'italic', fontWeight:500 }}>to Covalence</span>
        </h1>
        <p className="display-font" style={{ fontSize:'18px', lineHeight:1.55, color:'#3F3A35', margin:'0 0 24px', maxWidth:'680px' }}>
          Your core banking system, card processor, fraud engine and app can send data to Covalence as it happens, and Covalence sends signed events back when your analysts act. Everything is JSON over HTTPS.
        </p>
        <nav aria-label="On this page" style={{ display:'flex', gap:'6px 18px', flexWrap:'wrap', margin:'0 0 28px' }}>
          {CONTENTS.map(([id, label], i) => <a key={id} href={`#${id}`} className="mono-font" style={{ fontSize:'11px', letterSpacing:'0.08em', color:'#1A1814' }}>{String(i + 1).padStart(2, '0')} · {label}</a>)}
        </nav>

        <section style={box} id="start">
          <H2>BEFORE YOU START</H2>
          <ul className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.6, margin:0, paddingLeft:'18px' }}>
            <li><strong>An API key:</strong> an admin creates one in Settings → Connections and gives it to you. It starts with <code>cvl_</code>, is shown once, and goes in every request as <code>Authorization: Bearer cvl_…</code>. Keep it on your servers; never put it in an app or a web page.</li>
            <li><strong>Limits:</strong> 120 requests a minute per key, and up to 256 KB per request. Sending the same id twice is ignored, so retries are safe.</li>
            <li><strong>Base address:</strong> <code>{origin}</code></li>
          </ul>
        </section>

      <section style={box} id="send">
        <H2>SEND TRANSACTIONS, EVENTS AND ALERTS</H2>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 6px' }}>One endpoint. Up to 1,000 of each per call; sending the same id twice is ignored.</p>
        <Code>{`POST ${origin}/api/intake
Authorization: Bearer cvl_…
Content-Type: application/json

{
  "transactions": [{ "id": "TX-88121", "customerId": "A-1005", "customerName": "M. Okafor",
                     "ts": "2026-10-28T08:41:00Z", "amount": -2400, "currency": "USD",
                     "channel": "zelle", "counterparty": "Zed Holdings", "description": "Transfer" }],
  "events":       [{ "id": "EV-551", "customerId": "A-1005", "ts": "2026-10-28T08:12:00Z",
                     "type": "new device login", "device": "Android 14", "location": "Lagos NG" }],
  "alerts":       [{ "id": "ENGINE-77", "customerId": "A-1006", "title": "High device risk",
                     "reason": "Device risk 97/100", "severity": "high", "amount": 450,
                     "recommendedAction": "block_card" }]
}`}</Code>
        <ul className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.6, margin:'8px 0 0', paddingLeft:'18px' }}>
          <li><strong>Transactions:</strong> negative amounts are money out (or send <code>direction</code>: "in" / "out"). Channel words like zelle, wire, ach, card, cash, crypto, check are recognised.</li>
          <li><strong>Events:</strong> logins, new devices or locations, password, phone or email changes, new payees — what the account-takeover rule reads.</li>
          <li><strong>Alerts</strong> from your own fraud engine land in 001 Triage → Alerts as they are.</li>
          <li><strong>Crypto exchanges:</strong> add <code>"segment": "ce"</code> to the body — withdrawals to wallets are judged as an exchange’s, and alerts land on Triage’s Crypto Exchange side.</li>
          <li>The answer lists what was stored, what was a duplicate, any rows with problems, and the ids of the alerts raised.</li>
        </ul>
      </section>

      <section style={box} id="claims">
        <H2>CLAIMS FROM YOUR APP</H2>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 6px' }}>When a customer reports a problem in your app or on your website, send the claim here with the same key. It lands in 001 Triage → Claims, tagged with where it came from, with the Reg E or Reg Z clock running from the customer’s report.</p>
        <Code>{`POST ${origin}/api/claims
Authorization: Bearer cvl_…
Content-Type: application/json

{
  "id": "APP-55102",                       // your reference; sending it again is ignored
  "channel": "app",                         // app, web, agent or phone
  "reportedAt": "2026-10-29T09:14:00Z",
  "claimType": "unauth_cnp",
  "customer": { "id": "A-2231", "name": "Dana Whitfield", "accountType": "debit" },
  "transactions": [{ "id": "TX-90311", "ts": "2026-10-28T02:10:00Z", "amount": -84.50,
                     "currency": "USD", "merchant": "SHOPZ*GADGETHUB", "network": "Visa" }],
  "answers": { "recognisesTransaction": false, "cardInPossession": true,
               "sharedCardDetails": false },       // ids from the questions below
  "statement": "Two charges from a shop I’ve never heard of…",
  "attachments": [{ "name": "receipt.pdf", "url": "https://files.yourbank.com/…" }],
  "consent": { "given": true, "at": "2026-10-29T09:14:00Z" }
}

GET ${origin}/api/claims?reference=APP-55102     → where the claim is now
GET ${origin}/api/claims?questions=unauth_cnp&accountType=debit
                                                  → what to ask the customer
GET ${origin}/api/claims?questions=              → the claim types to choose from`}</Code>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'14px 0 6px' }}><strong>Is this yours? first.</strong> Before a customer reports a payment they don’t recognise, ask for a card per transaction and show it. Many “unauthorised” payments are the customer’s own under a name they don’t know, and seeing the merchant clearly settles it.</p>
        <Code>{`POST ${origin}/api/claims
Authorization: Bearer cvl_…

{ "isThisYours": { "customerId": "A-2231",
    "transactions": [{ "id": "TX-90311", "ts": "2026-10-28T02:10:00Z", "amount": -84.50,
                       "merchant": "SQ *BLUE BOTTLE COFFEE #1234", "merchantLocation": "San Francisco, CA",
                       "channel": "card_present", "merchantLogo": "https://…" }] } }

→ { "cards": [{ "name": "Blue Bottle Coffee", "via": "Square", "where": "San Francisco, CA",
               "amountText": "$84.50", "seenBefore": { "count": 2, "first": "2026-04-02…" },
               "hints": ["You’ve paid Blue Bottle Coffee 2 times since April 2026.", …],
               "logo": null, "website": null, "monogram": { "letters": "BB", "color": "#1E3A5F" },
               "question": "Do you recognise this payment?", "answers": [ … ] }] }`}</Code>
        <ul className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.6, margin:'8px 0 0', paddingLeft:'18px' }}>
          <li><strong>The name</strong> comes from the statement descriptor: processor prefixes (SQ *, TST*, PAYPAL *, DD *), store numbers, phone numbers and the city are taken off, and well-known brands are named. <code>via</code> says who processed it.</li>
          <li><strong>Paid before</strong> is read from the transactions you send to <code>/api/intake</code>, over the last 13 months. Without that feed, the card still works and says nothing about history.</li>
          <li><strong>Logo:</strong> send your own as <code>merchantLogo</code> (https). Otherwise <code>website</code> names a known brand’s site for your logo service, and <code>monogram</code> always gives two letters and a colour. Covalence calls no outside service for this.</li>
          <li><strong>“That was me”:</strong> send the claim with <code>"recognisesTransaction": true</code> and it’s stored closed at intake, with a note you can show the customer. Nothing reaches an analyst, and Triage → Claims counts these over the last 7 days.</li>
        </ul>
        <ul className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.6, margin:'8px 0 0', paddingLeft:'18px' }}>
          <li><strong>Required:</strong> id, customer.id, and at least one transaction with id, ts and amount. Everything else makes the claim faster to work.</li>
          <li><strong>Questions:</strong> ask for the questions once the customer picks what happened, and show them in your app. Each has an <code>id</code> (send the answer under it), the words to show, a <code>kind</code> (yesno, choice, date, amount, text), whether it’s required, an optional <code>showIf</code> (ask it only when an earlier answer matches), and <code>why</code>, for your product team. They follow network and Reg E rules, so a claim answered in full can go straight to an analyst.</li>
          <li><strong>Ready for Desk:</strong> a claim with its type, the account type, every merchant, the customer’s own account, their consent and the required questions answered is marked ready (for unauthorised claims, “Do you recognise this transaction?” answered no). The answer says what’s missing, and <code>answerProblems</code> lists any answer of the wrong kind.</li>
          <li><strong>Account types:</strong> debit, credit, p2p, ach_eft, bnpl, crypto. Claim types are the ones in Triage’s list, such as unauth_card_present, unauth_cnp, ato, non_receipt, not_as_described, duplicate_charge, impersonation.</li>
          <li><strong>Attachments</strong> are links to files in your own storage. Covalence keeps the link and never downloads it.</li>
          <li><strong>Status:</strong> received → being reviewed → investigating or closed. Each change is sent to your endpoint as a signed <code>claim.updated</code> event, so your app can tell the customer. Once the claim is with the Desk, its case sends <code>claim.provisional_credit</code>, <code>claim.filed</code> and <code>claim.resolved</code> (with <code>outcome</code>), each once, with a note you can show the customer.</li>
          <li><strong>Exchanges and merchants:</strong> send <code>"segment": "ce"</code> if you’re a crypto exchange, or <code>"segment": "mx"</code> if you’re a merchant reporting your own customers’ complaints (the default is <code>"fi"</code>, a bank or credit union). Each lands on its own side of 001 Triage → Claims and has its own kinds: for exchanges unauth_withdrawal, ato, deposit_missing, withdrawal_missing, wrong_address and the scams; for merchants non_receipt, partial_delivery, wrong_item, not_as_described, refund_not_received, cancelled_sub, duplicate_charge, billing_error and unauth_cnp. Ask <code>?questions=&amp;segment=ce</code> for the list, and pass <code>segment</code> with a type for its questions. Links to the hosted form take <code>segment</code> too.</li>
          <li><strong>Where it goes:</strong> a dispute about a purchase (non_receipt, not_as_described, cancelled_sub, billing_error, duplicate_charge) goes straight to the Dispute Desk, with no triage; the answer says <code>"sentToDesk": true</code>. Fraud and scams go to 001 Triage → Claims, where an analyst can still send one to the Desk when the customer called it fraud but it’s a purchase dispute. An exchange’s and a merchant’s claims stay in Triage.</li>
          <li><strong>What the customer needs now:</strong> send <code>"instructions": ["lock_card", "replace_card", "stop_merchant", "call_me"]</code> (exchanges: freeze_account, lock_withdrawals, reset_security; merchants: refund, replacement, cancel_subscription) with the claim (the questions answer lists which to offer for each claim type). They’re sent straight back to your endpoint as a signed <code>claim.instructions</code> event, so your systems can act at once, and analysts see them at the top of the claim. If your app can lock the card itself, do it there too.</li>
          <li><strong>AI triage:</strong> each claim is read as it arrives, without the customer’s name or contact details, and your analysts see a suggested route and questions in Triage → Claims. It suggests; they decide.</li>
        </ul>
      </section>

      <section style={box} id="form">
        <H2>THE HOSTED CLAIM FORM</H2>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 6px', lineHeight:1.6 }}>No claim screens to build: when a customer taps “Report a problem” in your app or on your website, ask for a link for them and their recent payments, and open it (in a web view, or a new tab). The customer picks what went wrong, says whether they recognise each payment, asks for what they need now (lock the card, a new card, a call), answers the questions, and sends it. Your name, logo and phone number are in Settings → Claim form. Covalence never sends these links to customers.</p>
        <Code>{`POST ${origin}/api/claims
Authorization: Bearer cvl_…

{ "link": { "reference": "CASE-7781",
    "customer": { "id": "A-7781", "name": "Sam Ortiz", "accountType": "debit" },
    "transactions": [{ "id": "TX-77120", "ts": "2026-11-02T14:20:00Z", "amount": -129.99,
                       "merchant": "AMZN MKTP US*2K4", "merchantLocation": "Online" }],
    "expiresInHours": 72 } }

→ 201 { "id": "LNK-3F09A1C2", "url": "${origin}/claim/cvf_…", "expiresAt": "2026-11-06T14:20:00Z" }`}</Code>
        <ul className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.6, margin:'8px 0 0', paddingLeft:'18px' }}>
          <li><strong>Required:</strong> customer.id and at least one transaction with id, ts and amount, as for a claim. Up to 25 transactions.</li>
          <li><strong>The link works once,</strong> for 72 hours unless you say otherwise (at most 7 days); ask for it when the customer taps, not ahead of time. Covalence stores only a hash of it; if it’s lost, ask for another.</li>
          <li><strong>The customer sees</strong> their first name, your name and colours, and the payments on the link, nothing else from their account.</li>
          <li><strong>The claim</strong> has the link’s <code>id</code> as its reference, and your <code>reference</code> kept with it. It’s handled like a claim from your own app (below), and its events go to your endpoint as usual.</li>
        </ul>
      </section>

      <section style={box} id="events">
        <H2>WHAT YOUR ENDPOINT RECEIVES</H2>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 6px' }}>An admin sets your endpoint and its signing secret in Settings → Connections. Covalence sends a signed event when an analyst presses Block the card, Hold the payment or Lock the account, when new alerts arrive, and when a claim from your app moves on.</p>
        <Code>{`POST <your endpoint>
Covalence-Event-Type: action.requested
Covalence-Signature: t=1793170000,v1=5f2c…   (HMAC-SHA256 of "<t>.<body>" with your secret)

{ "id": "evt_9c1…", "type": "action.requested", "created": "2026-10-28T08:45:12Z",
  "data": { "action": "hold_payment", "segment": "fi", "alertId": "FR-…",
            "customerId": "A-1005", "customerName": "M. Okafor", "amount": 2400,
            "transactionIds": ["TX-88121"], "requestedBy": { "name": "…", "email": "…" } } }

Answer 2xx when it's done — add { "reference": "HOLD-5521" } to show it on the alert.`}</Code>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'6px 0 0', lineHeight:1.5 }}>
          Other events: <code>alert.created</code> (new alerts, with their customer and recommended action) and <code>covalence.test</code>. Check the signature and reject anything older than five minutes. Actions for crypto exchanges arrive as <code>block_card</code> (lock the account) and <code>hold_payment</code> (hold the withdrawal) with <code>"segment": "ce"</code>.
        </p>
      </section>
      </main>
    </div>
  )
}

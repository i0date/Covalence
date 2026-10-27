// ═══════════════════════════════════════════════════════════════════════════════
// HOW THE AI WORKS — public page at /ai
// ═══════════════════════════════════════════════════════════════════════════════
// Plain-English account of where Covalence uses AI, what it sees, how each
// answer is explained and checked, and its limits — for analysts, customers'
// compliance teams and examiners. Keep it true to the code: if a prompt, the
// model (api/analyze.js, api/triage.js) or the PII scrub changes, update this.
import React from 'react'
import { GLOBAL_CSS } from './shared.jsx'
import { PROMPTS } from './ai.js'

const MODEL = 'claude-sonnet-4-6'   // as set in api/analyze.js and api/triage.js

const USES = [
  ['Triage', 'Classifies a new claim: true fraud, first-party fraud, consumer dispute or authorised push payment. Suggests routing and whether to give provisional credit.', 'Decision support'],
  ['Triage (exchanges)', 'The same for crypto exchange claims, plus whether a SAR/STR threshold is met.', 'Decision support'],
  ['Triage (exchanges)', 'Drafts an action plan and customer letter.', 'Draft'],
  ['Dispute Desk', 'Suggests the network reason code, writes the dispute summary, lists missing information.', 'Decision support'],
  ['Dispute Desk', 'Predicts the merchant’s likely rebuttal; drafts customer letters and pre-arbitration responses.', 'Draft'],
  ['Dispute Desk (merchants)', 'Rates the chance of winning a representment and suggests the defence.', 'Decision support'],
  ['Dispute Desk (merchants)', 'Drafts representment and pre-arbitration letters.', 'Draft'],
]

function Section({ n, title, children }) {
  return (
    <section style={{ borderTop:'1px solid #D4CCBC', padding:'28px 0' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', marginBottom:'8px' }}>{String(n).padStart(2, '0')}</div>
      <h2 className="display-font" style={{ fontSize:'26px', fontWeight:600, color:'#1A1814', margin:'0 0 12px', letterSpacing:'-0.01em' }}>{title}</h2>
      <div className="display-font ai-page-body" style={{ fontSize:'16px', lineHeight:1.65, color:'#2D2922' }}>{children}</div>
    </section>
  )
}

export default function AiPage() {
  return (
    <div style={{ background:'#F5F1EA', minHeight:'100vh' }}>
      <style>{GLOBAL_CSS}{`
        .ai-page-body p { margin: 0 0 12px; }
        .ai-page-body ul { margin: 0 0 12px; padding-left: 20px; }
        .ai-page-body li { margin-bottom: 6px; }
        .ai-page-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .ai-page-table th, .ai-page-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #E7E2D9; vertical-align: top; }
        .ai-page-table th { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; color: #57534E; font-weight: 500; }
      `}</style>
      <header style={{ background:'#1A1814', padding:'14px 16px' }}>
        <div style={{ maxWidth:'760px', margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <a href="/" className="mono-font" style={{ color:'#F5F1EA', fontSize:'13px', letterSpacing:'0.3em', textDecoration:'none' }}>COVALENCE</a>
          <span className="mono-font" style={{ color:'#A8A29E', fontSize:'10px', letterSpacing:'0.12em' }}>HOW THE AI WORKS</span>
        </div>
      </header>

      <main style={{ maxWidth:'760px', margin:'0 auto', padding:'40px 16px 64px' }}>
        <h1 className="display-font" style={{ fontSize:'clamp(36px, 7vw, 56px)', fontWeight:700, color:'#1A1814', letterSpacing:'-0.03em', lineHeight:1.05, margin:'0 0 16px' }}>
          How Covalence <span style={{ fontStyle:'italic', fontWeight:500 }}>uses AI</span>
        </h1>
        <p className="display-font" style={{ fontSize:'19px', lineHeight:1.55, color:'#3F3A35', margin:'0 0 32px' }}>
          Covalence uses a large language model to help analysts work disputes and fraud claims faster. It recommends and drafts. People decide.
          The AI never files a dispute, sends a letter, issues credit or closes a case.
        </p>

        <Section n={1} title="Where the AI is used">
          <div style={{ overflowX:'auto' }}>
            <table className="ai-page-table">
              <thead><tr><th scope="col">Tool</th><th scope="col">What the AI does</th><th scope="col">Kind</th></tr></thead>
              <tbody>{USES.map(([tool, what, kind], i) => <tr key={i}><td style={{ whiteSpace:'nowrap' }}>{tool}</td><td>{what}</td><td className="mono-font" style={{ fontSize:'11px', whiteSpace:'nowrap' }}>{kind}</td></tr>)}</tbody>
            </table>
          </div>
          <p style={{ marginTop:'12px' }}>
            <strong>Decision support</strong> means the AI suggests an answer and shows why; an analyst accepts or changes it.
            A <strong>draft</strong> is text an analyst reads and edits before it goes anywhere.
            Nothing else in Covalence uses AI. Deadlines, SLA clocks, auto-assignment, escalation, DFA scoring and QA sampling follow fixed rules you can read in Settings.
          </p>
        </Section>

        <Section n={2} title="What the AI sees">
          <p>Only what an analyst enters for that task: the customer’s statement, the transaction details on the form, and a few of the institution’s settings (institution type, jurisdiction, SAR/STR thresholds). It does not see:</p>
          <ul>
            <li>evidence files and uploaded documents,</li>
            <li>other cases, the case history or the audit log,</li>
            <li>anything belonging to another institution.</li>
          </ul>
          <p>Before a request leaves Covalence, card numbers, Social Security and other 9-digit ID numbers, email addresses and North American phone numbers are replaced with placeholders such as <span className="mono-font" style={{ fontSize:'13px' }}>[REDACTED-ACCT]</span>. This is a safety net, not a guarantee: analysts should still leave out personal details the task doesn’t need.</p>
        </Section>

        <Section n={3} title="Where the data goes">
          <p>Requests go from Covalence’s servers to Anthropic’s API, which runs Anthropic’s Claude models. The browser never talks to Anthropic directly and never holds the API key. Covalence’s server fixes the model and the maximum answer length, limits how often each address can call it, and refuses oversized requests.</p>
          <p>Under Anthropic’s commercial terms, data sent through its API is not used to train its models by default. Anthropic keeps it only as its <a href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noopener" style={{ color:'#1E3A5F' }}>commercial terms</a> allow.</p>
          <p>The AI’s answer, and the record of how it was produced, is stored with the case in your institution’s workspace — the same place, with the same access controls and retention, as the rest of the case.</p>
        </Section>

        <Section n={4} title="How every answer is explained">
          <p>Each AI decision is saved on the case with:</p>
          <ul>
            <li><strong>The answer</strong> and the model’s own confidence rating (high, medium or low). The rating is the model’s judgement, not a measured probability.</li>
            <li><strong>What drove it</strong> — the key factors, which input each came from, how much it weighed, and whether it supports or cuts against the answer.</li>
            <li><strong>What else it considered</strong> — the closest other answers and why they fit less well.</li>
            <li><strong>What it assumed</strong> where the case was silent, and <strong>what would change its answer</strong>.</li>
            <li><strong>What it was given</strong> — the inputs, field by field.</li>
            <li><strong>Which model and prompt</strong> produced it, who ran it and when. Prompts carry a version, so a change in wording shows up in the record.</li>
          </ul>
          <p>The AI is told to base every factor on the information given and not to invent facts. Analysts see this under “Why the AI said this”, next to the answer and again in the case file.</p>
        </Section>

        <Section n={5} title="People stay in charge">
          <ul>
            <li>Analysts can record that they agree or disagree with each AI decision. Disagreeing needs a reason.</li>
            <li>The reason code a case is filed under is the analyst’s choice. Covalence notes when it differs from the AI’s suggestion.</li>
            <li>Reviews, overrides and case changes are written to the institution’s tamper-evident audit log.</li>
            <li>Drafts are labelled as AI drafts with the model and prompt that wrote them.</li>
          </ul>
        </Section>

        <Section n={6} title="Checking the AI over time">
          <p>Each month, a share of closed cases (10% by default, set by the institution) is picked for a second person to review. The pick is random but fixed, so it can’t be re-rolled. Cases where someone disagreed with the AI, filed under a different code than it suggested, or lost are always included. Nobody reviews their own cases.</p>
          <p>The Quality review page tracks, month by month, how often people agreed with the AI, how often its reason code was used, and the win rate when it was followed versus changed — so drift shows up early.</p>
        </Section>

        <Section n={7} title="Limits">
          <ul>
            <li>The AI can be wrong, and can sound sure when it is. Treat every answer as a second opinion.</li>
            <li>It only knows what it was given for that task. Facts left off the form don’t count.</li>
            <li>Card network rules, reason codes and regulations change. Check the AI’s reason code against the network’s current rules before filing.</li>
            <li>It doesn’t give legal advice, and its letters are drafts.</li>
            <li>The same case can get a slightly different answer if run twice.</li>
          </ul>
        </Section>

        <Section n={8} title="Models and versions">
          <p>Covalence currently uses Anthropic’s Claude Sonnet 4.6 (<span className="mono-font" style={{ fontSize:'13px' }}>{MODEL}</span>). Each saved record names the exact model that answered. When the model or a prompt changes, the version on new records changes with it, and older records keep theirs.</p>
          <div style={{ overflowX:'auto' }}>
            <table className="ai-page-table">
              <thead><tr><th scope="col">Task</th><th scope="col">Prompt version</th></tr></thead>
              <tbody>{Object.values(PROMPTS).map(p => <tr key={p.version}><td>{p.label}</td><td className="mono-font" style={{ fontSize:'12px' }}>{p.version}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>

        <Section n={9} title="For risk and compliance teams">
          <p>The controls above — a stated purpose for each use, recorded inputs and outputs, versioned prompts, human review of every decision, independent sampling and ongoing outcome monitoring — are meant to support the model risk management expectations institutions already work under, such as the US interagency guidance (Federal Reserve SR 11-7 / OCC Bulletin 2011-12). Your institution remains responsible for validating that its use of Covalence fits its own policies.</p>
          <p>Questions about how your institution uses Covalence go to your Covalence admin.</p>
        </Section>
      </main>
    </div>
  )
}

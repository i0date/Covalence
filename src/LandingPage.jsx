// ═══════════════════════════════════════════════════════════════════════════════
// LANDING — the first thing a visitor sees at /, before the demo or sign-in
// ═══════════════════════════════════════════════════════════════════════════════
// What Covalence is, what it covers and for whom, how it keeps data safe, and
// how a bank connects; every claim here is true of the product today (nothing
// invented: no customer logos, no made-up numbers). "Explore the demo" and
// "Sign in" open the existing ways in (Welcome.jsx). Rendered before the app's
// GLOBAL_CSS, so it carries its own fonts and styles, like Welcome.
import React from 'react'
import { CasePreview, SCOPE } from './Welcome.jsx'

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=JetBrains+Mono:wght@400;500&display=swap');
  .lp        { background:#F5F1EA; color:#1A1814; min-height:100vh; font-family:'Fraunces',Georgia,serif; overflow-x:hidden; }
  .lp *      { box-sizing:border-box; }
  .lp-mono   { font-family:'JetBrains Mono',monospace; }
  .lp-wrap   { max-width:1180px; margin:0 auto; padding:0 clamp(16px,4vw,48px); }
  .lp-nav    { position:sticky; top:0; z-index:5; background:rgba(245,241,234,0.94); backdrop-filter:blur(6px); border-bottom:1px solid #D4CCBC; }
  .lp-nav .lp-wrap { display:flex; align-items:center; justify-content:space-between; gap:16px; height:60px; }
  .lp-links  { display:flex; gap:22px; align-items:center; }
  .lp-links a, .lp-link { font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.16em; color:#57534E; text-decoration:none; background:none; border:none; cursor:pointer; padding:0; }
  .lp-links a:hover, .lp-link:hover { color:#1A1814; }
  .lp-btn    { font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.16em; padding:14px 22px; border:1px solid #1A1814; cursor:pointer; text-decoration:none; display:inline-block; white-space:nowrap; }
  .lp-btn.dark  { background:#1A1814; color:#F5F1EA; }
  .lp-btn.dark:hover { background:#2D2922; }
  .lp-btn.light { background:transparent; color:#1A1814; }
  .lp-btn.light:hover { background:#EDE9E3; }
  .lp-btn.sm { padding:9px 14px; font-size:10px; }
  .lp-eyebrow{ font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.24em; color:#8A7F72; margin:0 0 14px; }
  .lp-h1     { font-weight:700; letter-spacing:-0.03em; line-height:1.0; font-size:clamp(42px,6.4vw,84px); margin:0; }
  .lp-h2     { font-weight:600; letter-spacing:-0.02em; line-height:1.08; font-size:clamp(28px,3.6vw,44px); margin:0; }
  .lp-lede   { font-size:clamp(16px,1.5vw,19px); line-height:1.6; color:#57534E; max-width:560px; }
  .lp-hero   { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,0.9fr); gap:56px; align-items:center; padding:72px 0 80px; }
  .lp-section{ border-top:1px solid #D4CCBC; padding:80px 0; }
  .lp-grid3  { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; background:#D4CCBC; border:1px solid #D4CCBC; }
  .lp-grid2  { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:#D4CCBC; border:1px solid #D4CCBC; }
  .lp-cell   { background:#FAF7F1; padding:26px 24px; }
  .lp-cell h3{ font-size:19px; font-weight:600; margin:0 0 8px; letter-spacing:-0.01em; }
  .lp-cell p { font-size:15px; line-height:1.6; color:#57534E; margin:0; }
  .lp-flow   { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; background:#D4CCBC; border:1px solid #D4CCBC; }
  .lp-step   { background:#FAF7F1; padding:22px 20px 24px; position:relative; }
  .lp-step b { display:block; font-family:'JetBrains Mono',monospace; font-weight:400; font-size:10px; letter-spacing:0.2em; color:#A8A29E; }
  .lp-step strong { display:block; font-family:'JetBrains Mono',monospace; font-weight:500; font-size:12px; letter-spacing:0.16em; margin:4px 0 10px; }
  .lp-step p { font-size:14px; line-height:1.55; color:#57534E; margin:0; }
  .lp-dark   { background:#1A1814; color:#E7E4DF; }
  .lp-dark .lp-eyebrow { color:#A8A29E; }
  .lp-dark .lp-lede { color:#A8A29E; }
  .lp-trust  { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:36px 40px; margin-top:44px; }
  .lp-trust h3 { font-size:18px; font-weight:600; color:#F5F1EA; margin:0 0 8px; }
  .lp-trust p  { font-size:15px; line-height:1.6; color:#A8A29E; margin:0; }
  .lp-code   { background:#1A1814; color:#D6CFC4; font-family:'JetBrains Mono',monospace; font-size:12.5px; line-height:1.75; padding:22px 22px; margin:0; overflow-x:auto; border:1px solid #1A1814; }
  .lp-code .k { color:#8A7F72; }
  .lp-code .s { color:#F5F1EA; }
  .lp-who    { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; background:#D4CCBC; border:1px solid #D4CCBC; }
  .lp-who .lp-cell h3 { font-size:17px; }
  .lp-who ul { margin:12px 0 0; padding:0; list-style:none; }
  .lp-who li { font-size:14px; line-height:1.5; color:#57534E; padding:6px 0; border-top:1px solid #E3DDD5; }
  .lp-cta    { display:flex; gap:12px; flex-wrap:wrap; }
  .lp-foot   { border-top:1px solid #D4CCBC; padding:36px 0 48px; }
  @media (max-width: 960px) {
    .lp-hero  { grid-template-columns:1fr; gap:40px; padding:44px 0 56px; }
    .lp-flow  { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .lp-who   { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .lp-trust { grid-template-columns:1fr 1fr; }
    .lp-grid3 { grid-template-columns:1fr; }
  }
  @media (max-width: 640px) {
    .lp-links a { display:none; }
    .lp-section { padding:56px 0; }
    .lp-flow, .lp-who, .lp-grid2, .lp-trust { grid-template-columns:1fr; }
    .lp-cta .lp-btn { flex:1 1 100%; text-align:center; }
    .lp-hide-sm { display:none; }
  }
`

// The life of a case, through the eight tools
const FLOW = [
  ['001', 'TRIAGE', 'A claim arrives from your app, your website, a call or a file. It is sorted (fraud, a dispute, a scam) and closed at intake when there are no dispute rights.'],
  ['002', 'DESK', 'The case gets its reason code, evidence and letters. The timeline, notes and AI reasoning stay with it.'],
  ['003', 'MULTI', 'Cases are filed in batches by network, or one by one, with the dollars at stake and the next filing window in view.'],
  ['004', 'FILE', 'Every filing is tracked through representment, pre-arbitration and arbitration, with each network deadline counted down.'],
  ['005', 'LICIT', 'Sanctions screening, linked customers and wallets, SAR narratives drafted from the case, and new customers onboarded.'],
  ['006', 'DFA', 'Each claim is scored for recovery, graded A to D, so a portfolio can be priced and funded.'],
  ['007', 'DUO', 'The other bank or exchange joins the same case in a live session when the money has already moved.'],
  ['008', 'TRIO', 'An incident room for fraud waves: linked cases, the receiving institutions, and the debrief afterwards.'],
]

const PROBLEMS = [
  ['Five systems for one complaint', 'A disputed payment touches the call centre, a case tool, the network portal, the AML system and a spreadsheet of deadlines. Each handoff loses something.'],
  ['Fraud and compliance worked apart', 'The scam victim’s dispute is also the trail to a mule account and a SAR. Most teams key the same facts in twice, in two systems.'],
  ['Deadlines that cost money', 'Reg E, Reg Z and network windows are counted in days. A missed one is a write-off, or a finding from the examiner.'],
]

const WHO = [
  ['Banks and credit unions', ['Card disputes and Reg E claims', 'Scam and APP fraud recovery', 'Sanctions, AML and SARs', 'New-customer onboarding']],
  ['Card issuers', ['Reason codes for all four networks', 'Batch filing and representment', 'Pre-dispute alerts to merchants', 'Chargeback-ratio monitoring']],
  ['Crypto exchanges', ['Unauthorised withdrawals', 'Wrong-network deposits', 'Wallet screening and linking', 'Working with the sending bank']],
  ['Merchants', ['Order problems and refunds', 'Representment with a win estimate', 'Alerts before a chargeback', 'Keeping the ratio down']],
]

const TRUST = [
  ['ID numbers never stored', 'Social Security numbers and EINs go straight to your own systems. Covalence keeps the last four digits and nothing more.'],
  ['People decide, AI explains', 'AI suggests a reason code or drafts a letter, and shows its reasons. An analyst makes every decision, and the page at /ai says exactly what the AI sees.'],
  ['Every action on the record', 'Each decision, filing and change is written to an audit log with who did it and when, ready for an examiner.'],
  ['Roles and retention', 'Analysts, reviewers and admins see what their role allows. Closed cases are purged on the schedule you set.'],
  ['Signed events to your systems', 'Decisions go back to your core and your app as signed webhooks, sent only to addresses you register.'],
  ['A demo that stays in your browser', 'The demo runs on fictional cases stored on your own device. Nothing you try there is sent to us.'],
]

function Mark() {
  return <span className="lp-mono" style={{ fontSize:'11px', letterSpacing:'0.3em', fontWeight:500 }}>COVALENCE</span>
}

export default function LandingPage({ onDemo, onSignIn }) {
  const go = id => e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior:'smooth' }) }
  return (
    <div className="lp">
      <style>{CSS}</style>

      <header className="lp-nav">
        <div className="lp-wrap">
          <Mark />
          <nav className="lp-links" aria-label="Main">
            <a href="#product" onClick={go('product')}>PRODUCT</a>
            <a href="#who" onClick={go('who')}>WHO IT’S FOR</a>
            <a href="#trust" onClick={go('trust')}>SECURITY</a>
            <a href="/developers">DEVELOPERS</a>
            {onSignIn && <button type="button" className="lp-link" onClick={onSignIn}>SIGN IN</button>}
            <button type="button" className="lp-btn dark sm" onClick={onDemo}>TRY THE DEMO</button>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <div className="lp-wrap">
          <section className="lp-hero">
            <div>
              <p className="lp-eyebrow">DISPUTES · FRAUD RECOVERY · SANCTIONS &amp; AML · ONBOARDING</p>
              <h1 className="lp-h1">Disputes, fraud and compliance, <span style={{ fontStyle:'italic', fontWeight:500 }}>on one record.</span></h1>
              <p className="lp-lede" style={{ margin:'24px 0 32px' }}>
                Covalence takes a case from the customer’s first complaint to the network’s final decision. It screens the case for sanctions and money laundering on the way, and brings in the other institution when the money has already moved.
              </p>
              <div className="lp-cta">
                <button type="button" className="lp-btn dark" onClick={onDemo}>EXPLORE THE DEMO →</button>
                <a className="lp-btn light" href="#product" onClick={go('product')}>SEE HOW IT WORKS</a>
              </div>
              <p className="lp-mono" style={{ fontSize:'10px', letterSpacing:'0.08em', color:'#8A7F72', marginTop:'16px', lineHeight:1.7 }}>
                A full portfolio of fictional cases, ready in seconds. No card, no call.
              </p>
            </div>
            <div style={{ display:'flex', justifyContent:'center' }}><div style={{ width:'100%', maxWidth:'460px' }}><CasePreview /></div></div>
          </section>
        </div>

        {/* ── The problem ── */}
        <section className="lp-section">
          <div className="lp-wrap">
            <p className="lp-eyebrow">THE PROBLEM</p>
            <h2 className="lp-h2" style={{ maxWidth:'760px', marginBottom:'40px' }}>One complaint becomes a fraud case, a dispute and a compliance file. Most teams work them in different places.</h2>
            <div className="lp-grid3">
              {PROBLEMS.map(([h, t]) => <div key={h} className="lp-cell"><h3>{h}</h3><p>{t}</p></div>)}
            </div>
          </div>
        </section>

        {/* ── The life of a case ── */}
        <section className="lp-section" id="product">
          <div className="lp-wrap">
            <p className="lp-eyebrow">HOW IT WORKS</p>
            <h2 className="lp-h2" style={{ maxWidth:'760px', marginBottom:'14px' }}>One case number, from the first call to the last decision.</h2>
            <p className="lp-lede" style={{ margin:'0 0 40px' }}>Eight tools share one record. The evidence uploaded on day one is the evidence in the filing, the SAR and the audit log.</p>
            <ol className="lp-flow" style={{ listStyle:'none', margin:0, padding:0 }}>
              {FLOW.map(([n, l, t]) => <li key={n} className="lp-step"><b>{n}</b><strong>{l}</strong><p>{t}</p></li>)}
            </ol>
          </div>
        </section>

        {/* ── What it covers ── */}
        <section className="lp-section">
          <div className="lp-wrap">
            <p className="lp-eyebrow">WHAT COVALENCE COVERS</p>
            <h2 className="lp-h2" style={{ maxWidth:'760px', marginBottom:'40px' }}>Everything that happens after “I didn’t make this payment”, and before the account is opened.</h2>
            <div className="lp-grid2">
              {SCOPE.map(([h, t]) => <div key={h} className="lp-cell"><h3>{h}</h3><p>{t}</p></div>)}
            </div>
          </div>
        </section>

        {/* ── Who it's for ── */}
        <section className="lp-section" id="who">
          <div className="lp-wrap">
            <p className="lp-eyebrow">WHO IT’S FOR</p>
            <h2 className="lp-h2" style={{ maxWidth:'760px', marginBottom:'40px' }}>Built for each side of the payment.</h2>
            <div className="lp-who">
              {WHO.map(([h, items]) => (
                <div key={h} className="lp-cell"><h3>{h}</h3><ul>{items.map(i => <li key={i}>{i}</li>)}</ul></div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Trust ── */}
        <section className="lp-section lp-dark" id="trust" style={{ borderTop:'none' }}>
          <div className="lp-wrap">
            <p className="lp-eyebrow">SECURITY AND CONTROL</p>
            <h2 className="lp-h2" style={{ maxWidth:'760px', color:'#F5F1EA' }}>Made to stand up to an examiner.</h2>
            <div className="lp-trust">
              {TRUST.map(([h, t]) => <div key={h}><h3>{h}</h3><p>{t}</p></div>)}
            </div>
            <a href="/ai" className="lp-mono" style={{ display:'inline-block', marginTop:'40px', fontSize:'10px', letterSpacing:'0.16em', color:'#E7E4DF' }}>HOW COVALENCE USES AI →</a>
          </div>
        </section>

        {/* ── Developers ── */}
        <section className="lp-section" style={{ borderTop:'none' }}>
          <div className="lp-wrap" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap:'48px', alignItems:'center' }}>
            <div>
              <p className="lp-eyebrow">FOR YOUR ENGINEERS</p>
              <h2 className="lp-h2" style={{ marginBottom:'16px' }}>Connects to the systems you already run.</h2>
              <p className="lp-lede" style={{ margin:'0 0 28px' }}>
                Claims from your app, daily transaction files, fraud alerts and onboarding links go in through one API key. Decisions come back as signed events. Your customers see your name, not ours.
              </p>
              <a className="lp-btn light" href="/developers">READ THE DEVELOPER GUIDE →</a>
            </div>
            <pre className="lp-code" aria-label="Example: create an onboarding link">
<span className="k"># Send a new customer a link to open their account</span>{'\n'}
POST /api/onboarding{'\n'}
Authorization: Bearer cvl_…{'\n'}
{'\n'}
{'{'} <span className="s">"link"</span>: {'{'} <span className="s">"kind"</span>: <span className="s">"person"</span>, <span className="s">"reference"</span>: <span className="s">"CUST-1042"</span> {'}'} {'}'}{'\n'}
{'\n'}
<span className="k"># 201 Created</span>{'\n'}
{'{'} <span className="s">"url"</span>: <span className="s">"…/onboard/cvo_…"</span>, <span className="s">"expiresAt"</span>: <span className="s">"…"</span> {'}'}
            </pre>
          </div>
        </section>

        {/* ── Closing ── */}
        <section className="lp-section">
          <div className="lp-wrap" style={{ textAlign:'center' }}>
            <h2 className="lp-h2" style={{ maxWidth:'720px', margin:'0 auto 18px' }}>See it with real work in it.</h2>
            <p className="lp-lede" style={{ margin:'0 auto 32px' }}>The demo loads chargebacks, scams, crypto and merchant cases at every stage, plus applications waiting in onboarding. It takes a name and an email.</p>
            <div className="lp-cta" style={{ justifyContent:'center' }}>
              <button type="button" className="lp-btn dark" onClick={onDemo}>EXPLORE THE DEMO →</button>
              {onSignIn && <button type="button" className="lp-btn light" onClick={onSignIn}>SIGN IN TO YOUR WORKSPACE</button>}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap" style={{ display:'flex', justifyContent:'space-between', gap:'24px', flexWrap:'wrap', alignItems:'center' }}>
          <div>
            <Mark />
            <div className="lp-mono" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#8A7F72', marginTop:'8px' }}>BUILT BY A RISK, FRAUD &amp; COMPLIANCE PRACTITIONER</div>
          </div>
          <nav className="lp-links" aria-label="Footer" style={{ flexWrap:'wrap' }}>
            <a href="/developers" style={{ display:'inline' }}>DEVELOPERS</a>
            <a href="/ai" style={{ display:'inline' }}>HOW WE USE AI</a>
            <a href="/onboard/demo" style={{ display:'inline' }}>SAMPLE ONBOARDING FORM</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}


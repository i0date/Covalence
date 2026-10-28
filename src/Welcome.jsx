// ═══════════════════════════════════════════════════════════════════════════════
// WELCOME — first screen: what Covalence is (left) and the two ways in (right)
// ═══════════════════════════════════════════════════════════════════════════════
// Rendered before the main app (and its GLOBAL_CSS), so it carries its own fonts
// and styles. Phones stack the pitch above the doors and drop the case preview.
import React from 'react'

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,500&family=JetBrains+Mono:wght@400;500&display=swap');
  .wl-root   { min-height:100vh; display:grid; grid-template-columns:minmax(0,1.15fr) minmax(360px,0.85fr); background:#F5F1EA; }
  .wl-pitch  { padding:56px clamp(24px,5vw,72px); display:flex; flex-direction:column; justify-content:space-between; gap:40px; }
  .wl-doors  { background:#1A1814; color:#E7E4DF; padding:56px clamp(24px,4vw,56px); display:flex; flex-direction:column; justify-content:center; position:sticky; top:0; height:100vh; box-sizing:border-box; overflow-y:auto; }
  .wl-mono   { font-family:'JetBrains Mono',monospace; }
  .wl-serif  { font-family:'Fraunces',Georgia,serif; }
  .wl-h1     { font-family:'Fraunces',Georgia,serif; font-weight:700; color:#1A1814; letter-spacing:-0.025em; line-height:1.02; font-size:clamp(38px,5.2vw,68px); margin:0; }
  .wl-proof  { display:grid; gap:18px; max-width:560px; }
  .wl-tools  { display:flex; flex-wrap:wrap; gap:1px; background:#D4CCBC; border:1px solid #D4CCBC; max-width:640px; }
  .wl-tools span { flex:1 1 auto; background:#EDE9E3; padding:8px 12px; font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.14em; color:#57534E; white-space:nowrap; }
  .wl-tools b { display:block; font-weight:400; font-size:10px; color:#A8A29E; letter-spacing:0.2em; margin-bottom:2px; }
  .wl-input  { width:100%; box-sizing:border-box; background:#252320; border:1px solid #3D3A35; color:#E7E4DF; padding:11px 14px; font-family:'JetBrains Mono',monospace; font-size:16px; outline:none; }
  .wl-input:focus { border-color:#A8A29E; }
  .wl-tab    { flex:1; background:transparent; border:none; border-bottom:2px solid transparent; color:#78716C; padding:12px 4px; font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.16em; cursor:pointer; }
  .wl-tab.on { color:#F5F1EA; border-bottom-color:#D6CFC4; }
  .wl-primary{ width:100%; padding:14px; background:#F5F1EA; color:#1A1814; border:none; font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.16em; cursor:pointer; }
  .wl-primary:disabled { opacity:0.5; cursor:not-allowed; }
  @media (max-width: 900px) {
    .wl-root    { grid-template-columns:1fr; }
    .wl-pitch   { padding:32px 20px 28px; gap:28px; }
    .wl-doors   { padding:32px 20px 40px; position:static; height:auto; }
    .wl-preview { display:none !important; }
    .wl-tools   { display:none; }
    .wl-proof-desc { display:none; }
    .wl-jump    { display:block !important; }
  }
`

// A single case, drawn the way it appears inside the product
function CasePreview() {
  const stages = [['001','TRIAGE','done'],['002','DESK','done'],['003','MULTI','current'],['004','FILE','todo'],['005','LICIT','todo']]
  return (
    <div className="wl-preview" aria-hidden="true" style={{ maxWidth:'460px', background:'#FAF7F1', border:'1px solid #D4CCBC', boxShadow:'0 18px 40px -24px rgba(26,24,20,0.45)' }}>
      <div style={{ background:'#1A1814', padding:'14px 18px' }}>
        <div className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#8A7F72' }}>COV CASE</div>
        <div className="wl-mono" style={{ fontSize:'13px', letterSpacing:'0.12em', color:'#F5F1EA', marginTop:'4px' }}>COV-8F2KQ1</div>
        <div className="wl-serif" style={{ fontSize:'19px', color:'#F5F1EA', marginTop:'2px' }}>Harbor Air <span style={{ fontStyle:'italic', color:'#A8A29E', fontSize:'15px' }}>842.40 USD</span></div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', marginTop:'8px' }}>
          <span className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.08em', background:'#4C1D95', color:'#F9FAFB', padding:'2px 6px' }}>QUEUED</span>
          <span className="wl-mono" style={{ fontSize:'10px', color:'#D6CFC4' }}>VISA 10.4 · Card absent fraud</span>
        </div>
      </div>
      <div style={{ padding:'14px 18px 16px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'1px', background:'#D4CCBC' }}>
          {stages.map(([n, l, s]) => (
            <div key={n} className="wl-mono" style={{ background: s === 'current' ? '#1A1814' : s === 'done' ? '#E3DDD5' : '#F5F1EA', color: s === 'current' ? '#F5F1EA' : s === 'done' ? '#1A1814' : '#A8A29E', padding:'7px 6px' }}>
              <div style={{ fontSize:'10px', letterSpacing:'0.2em', opacity:0.7 }}>{n}</div>
              <div style={{ fontSize:'10px', letterSpacing:'0.06em', fontWeight:500 }}>{s === 'done' ? '✓ ' : ''}{l}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:'12px', border:'1px solid #1A1814', padding:'10px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px' }}>
          <div>
            <div className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#8A7F72' }}>NEXT ACTION</div>
            <div className="wl-serif" style={{ fontSize:'12px', color:'#1A1814', marginTop:'2px' }}>Goes out with today’s 15:00 batch.</div>
          </div>
          <span className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.12em', background:'#1A1814', color:'#F5F1EA', padding:'6px 9px', whiteSpace:'nowrap' }}>FILE IN MULTI →</span>
        </div>
        <div className="wl-mono" style={{ fontSize:'10px', color:'#8A7F72', marginTop:'10px', lineHeight:1.7 }}>
          AI · CNP + AVS mismatch + no 3DS → 10.4 &nbsp;·&nbsp; Reg Z window 112 days left
        </div>
      </div>
    </div>
  )
}

export function WelcomePage({ children }) {
  const proof = [
    ['One record, start to finish', 'A case keeps one number from first contact through triage, filing, representment and funding — with its timeline, evidence and AI reasoning attached.'],
    ['Fraud that crosses institutions', 'Duo puts the sending and receiving institution in one live session on the same case. Trio runs the incident room when a fraud wave hits.'],
    ['Network-ready, deadline-aware', 'Visa and Mastercard reason codes, filing packages for all four networks, Reg E / Reg Z windows and chargeback-ratio monitoring, tracked for you.'],
  ]
  return (
    <div className="wl-root">
      <style>{CSS}</style>

      {/* ── The pitch ── */}
      <section className="wl-pitch">
        <div className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.3em', color:'#1A1814' }}>COVALENCE</div>
        <div>
          <div className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.22em', color:'#8A7F72', marginBottom:'18px' }}>DISPUTES · FRAUD RECOVERY · CROSS-INSTITUTION CASES</div>
          <h1 className="wl-h1">Every dispute,<br/><span style={{ fontStyle:'italic', fontWeight:500 }}>one record.</span></h1>
          <p className="wl-serif" style={{ fontSize:'clamp(15px,1.4vw,17px)', lineHeight:1.6, color:'#57534E', maxWidth:'520px', margin:'20px 0 32px' }}>
            Covalence takes a case from the first customer call to the final network decision — and brings in the other institution when the money has already moved.
          </p>
          {/* Phones: the way in sits below the pitch — let people jump straight to it */}
          <a href="#wl-doors" className="wl-jump wl-mono" style={{ display:'none', textAlign:'center', background:'#1A1814', color:'#F5F1EA', padding:'14px', fontSize:'11px', letterSpacing:'0.16em', textDecoration:'none', marginBottom:'28px' }}>
            GET STARTED ↓
          </a>
          <div className="wl-proof">
            {proof.map(([h, t], i) => (
              <div key={h} style={{ display:'grid', gridTemplateColumns:'28px 1fr', gap:'10px' }}>
                <span className="wl-mono" style={{ fontSize:'10px', color:'#A8A29E', paddingTop:'3px' }}>0{i + 1}</span>
                <div>
                  <div className="wl-serif" style={{ fontSize:'16px', fontWeight:600, color:'#1A1814' }}>{h}</div>
                  <div className="wl-serif wl-proof-desc" style={{ fontSize:'14px', lineHeight:1.55, color:'#57534E', marginTop:'2px' }}>{t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <CasePreview />
        <div>
          <div className="wl-tools" aria-label="The eight tools">
            {[['001','TRIAGE'],['002','DESK'],['003','MULTI'],['004','FILE'],['005','LICIT'],['006','DFA'],['007','DUO'],['008','TRIO']].map(([n, l]) => <span key={n}><b>{n}</b>{l}</span>)}
          </div>
          <div className="wl-mono" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#A8A29E', marginTop:'14px' }}>BUILT BY A RISK, FRAUD &amp; COMPLIANCE PRACTITIONER</div>
          <a href="/ai" className="wl-mono" style={{ display:'inline-block', fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', marginTop:'8px' }}>HOW COVALENCE USES AI →</a>
        </div>
      </section>

      {/* ── The two doors ── */}
      <section className="wl-doors" id="wl-doors">
        <div style={{ width:'100%', maxWidth:'380px', margin:'0 auto' }}>{children}</div>
      </section>
    </div>
  )
}

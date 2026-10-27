// ═══════════════════════════════════════════════════════════════════════════════
// CASE EXPORT — a self-contained case file for regulators, legal or a counterparty
// ═══════════════════════════════════════════════════════════════════════════════
// One HTML file: opens in any browser, prints to PDF, no links back into the app.
// The raw case record is included with its SHA-256 fingerprint so a recipient
// can confirm it wasn't altered after export.
import { auditWrite, AUDIT_LABELS, describeAudit } from './audit.js'

const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]))
const fmt = ts => ts ? new Date(ts).toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }) : '—'
const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : ''

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// c: the case (as shown in the case panel); extras: { timeline, trail, holds, exportedBy, institution, isDemo }
export async function exportCaseFile(c, extras = {}) {
  const { timeline = [], trail = [], hold = null, exportedBy = '', institution = '', isDemo = false } = extras
  const record = { ...c }
  delete record._triageRecord
  const json = JSON.stringify({ case: record, triage: c._triageRecord || null }, null, 2)
  const fingerprint = await sha256(json)
  const now = new Date()

  const rows = [
    ['Case number', c.id], ['Status', (c.status || '').replace(/_/g, ' ')], ['Merchant / payee', c.merchant],
    ['Amount', c.amount], ['Cardholder', c.cardholderName], ['Network', c.network],
    ['Reason code', [c.reasonCode, c.reasonTitle].filter(Boolean).join(' — ')],
    ['Category', (c.category || c.verdict || '').replace(/^mc_/, '').replace(/_/g, ' ')],
    ['Assigned to', c.assignedTo], ['Opened', day(c.date)], ['Filed', day(c.filedAt)],
    ['Next response due', c.nextRespDate], ['Resolved', day(c.resolvedDate)],
    ['Funding grade (DFA)', c.dfaScore ? `${c.dfaScore}${c.dfaFundability ? ` · ${c.dfaFundability}/100` : ''}` : ''],
    ['Legal hold', hold ? `Yes — ${hold.reason || 'no reason given'} (since ${day(hold.set_at)})` : 'No'],
  ].filter(([, v]) => v)

  const notes = Array.isArray(c.notes) ? c.notes : (typeof c.notes === 'string' && c.notes.trim() ? [{ text: c.notes }] : [])
  const docs = c.docs || []
  const t = c._triageRecord

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.id)} — Case file</title>
<style>
  :root { --ink:#1A1814; --muted:#6B5F4D; --line:#D4CCBC; --paper:#FFFFFF; }
  body { font-family: Georgia, 'Times New Roman', serif; color:var(--ink); background:#F5F1EA; margin:0; padding:32px 16px; line-height:1.5; }
  main { max-width: 820px; margin: 0 auto; background:var(--paper); padding: 40px 44px; border:1px solid var(--line); }
  .mono { font-family: 'Courier New', monospace; }
  .eyebrow { font-family:'Courier New', monospace; font-size:11px; letter-spacing:.18em; color:var(--muted); text-transform:uppercase; }
  h1 { font-size: 30px; margin: 6px 0 2px; letter-spacing:-.01em; } h2 { font-size: 15px; margin: 28px 0 8px; padding-bottom:4px; border-bottom:1px solid var(--line); font-family:'Courier New', monospace; letter-spacing:.12em; text-transform:uppercase; }
  table { width:100%; border-collapse: collapse; font-size: 14px; } td { padding: 6px 8px; border-bottom: 1px solid #EEE9E0; vertical-align: top; } td:first-child { color: var(--muted); width: 34%; font-family:'Courier New', monospace; font-size:12px; }
  .row { display:grid; grid-template-columns: 170px 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid #EEE9E0; font-size: 14px; } .row .when { font-family:'Courier New', monospace; font-size:12px; color:var(--muted); }
  .banner { border:1px solid #92400E; background:#FFFBEB; padding:8px 12px; font-family:'Courier New', monospace; font-size:12px; margin:12px 0; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 11px; background:#FAF7F1; border:1px solid var(--line); padding: 12px; }
  .meta { font-family:'Courier New', monospace; font-size:12px; color:var(--muted); }
  .print { position: fixed; top: 16px; right: 16px; font-family:'Courier New', monospace; font-size:12px; letter-spacing:.1em; padding:10px 14px; background:var(--ink); color:#fff; border:0; cursor:pointer; }
  @media print { body { background:#fff; padding:0 } main { border:0; padding:0 } .print { display:none } h2 { break-after: avoid } .row, tr { break-inside: avoid } }
</style></head>
<body>
<button class="print" onclick="window.print()">PRINT / SAVE AS PDF</button>
<main>
  <div class="eyebrow">Covalence · Case file · Confidential</div>
  <h1>${esc(c.id)} — ${esc(c.merchant || '')}</h1>
  <div class="meta">${esc(institution || 'Covalence')} · Exported ${esc(fmt(now))}${exportedBy ? ` by ${esc(exportedBy)}` : ''}</div>
  ${isDemo ? '<div class="banner">DEMO DATA — fictional case from the Covalence demo institution.</div>' : ''}

  <h2>Summary</h2>
  <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>

  ${c.ai?.summary || c.ai?.rationale ? `<h2>AI analysis</h2>
  ${c.ai.summary ? `<p>${esc(c.ai.summary)}</p>` : ''}
  ${c.ai.rationale ? `<p><em>Why:</em> ${esc(c.ai.rationale)}</p>` : ''}
  ${(c.ai.missing || []).length ? `<p><em>Information still needed:</em> ${esc(c.ai.missing.join('; '))}</p>` : ''}
  <p class="meta">Generated ${esc(fmt(c.ai.ts))}. AI output is decision support; the analyst confirms every filing.</p>` : ''}

  ${t ? `<h2>Triage</h2><table>
    <tr><td>Classification</td><td>${esc((t.verdict || '').replace(/_/g, ' '))}</td></tr>
    <tr><td>Confidence</td><td>${esc(t.confidence)}</td></tr>
    <tr><td>Routing</td><td>${esc((t.routing || '').replace(/_/g, ' '))}</td></tr>
    <tr><td>Triaged</td><td>${esc(fmt(t.date))}</td></tr></table>` : ''}

  <h2>Timeline</h2>
  ${timeline.length ? timeline.slice().reverse().map(e => `<div class="row"><span class="when">${esc(fmt(e.ts))}</span><span><b>${esc(e.kind)}</b> — ${esc(e.text)}${e.by ? ` <span class="meta">(${esc(e.by)})</span>` : ''}</span></div>`).join('') : '<p class="meta">No activity recorded.</p>'}

  <h2>Notes</h2>
  ${notes.length ? notes.map(n => `<div class="row"><span class="when">${esc(fmt(n.ts))}</span><span>${esc(n.text)}${n.author ? ` <span class="meta">(${esc(n.author)})</span>` : ''}</span></div>`).join('') : '<p class="meta">No notes.</p>'}

  <h2>Evidence</h2>
  ${docs.length ? `<table>${docs.map(d => `<tr><td>${esc(d.name)}</td><td class="mono">${esc(d.type || '')}${d.size ? ` · ${Math.round(d.size / 1024)} KB` : ''} · uploaded ${esc(fmt(d.uploadedAt))}${d.uploadedBy ? ` by ${esc(d.uploadedBy)}` : ''}<br>ref ${esc(d.path || '(legacy link)')}</td></tr>`).join('')}</table>
  <p class="meta">Files are held in the institution’s private evidence store and are provided separately on request.</p>` : '<p class="meta">No documents attached.</p>'}

  ${trail.length ? `<h2>Audit trail</h2>
  ${trail.slice().reverse().map(e => `<div class="row"><span class="when">${esc(fmt(e.at))}</span><span>${esc(AUDIT_LABELS[e.action] || e.action)}${describeAudit(e) ? ` — ${esc(describeAudit(e))}` : ''} <span class="meta">(${esc(e.actor_email || 'system')})</span></span></div>`).join('')}
  <p class="meta">From the institution’s append-only, hash-chained audit log.</p>` : ''}

  <h2>Case record</h2>
  <p class="meta">SHA-256 of the record below: <span class="mono">${fingerprint}</span></p>
  <pre>${esc(json)}</pre>
</main>
</body></html>`

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${c.id}-case-file-${now.toISOString().slice(0, 10)}.html` })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  if (!isDemo) auditWrite('case.exported', 'case', c.id, { sha256: fingerprint })
  return fingerprint
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT PANEL — Settings → Import cases
// ═══════════════════════════════════════════════════════════════════════════════
// Four steps: choose a file → match its columns to Covalence fields → match
// status and claim-type values → check and import. Matching rules come from
// csvImport.js. A mapping can be saved and is picked up automatically the next
// time a file with the same columns arrives (cov_import_templates, synced to
// the workspace). Admins and reviewers import; the import is audited.
import React, { useMemo, useRef, useState } from 'react'
import { auditWrite } from './audit.js'
import { REASON_TITLES } from './shared.jsx'
import { FIELDS, FIELD, MAX_BYTES, MAX_ROWS, SAMPLE_CSV, STATUSES, VERDICTS, buildImport, dateAmbiguous, detectDateFormat,
  distinctValues, guessMapping, guessStatus, guessVerdict, parseAmount, parseCsv, parseDate, signatureOf } from './csvImport.js'
import { Badge, Button, Input } from './ui.jsx'

const TEMPLATES_KEY = 'cov_import_templates'
const readTemplates = () => { try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]') } catch { return [] } }
// Browsers keep about 5 million characters per site; stay well under it
const STORAGE_BUDGET = 4_000_000

const H2 = ({ n, children }) => (
  <h2 className="display-font" style={{ fontSize:'20px', fontWeight:600, color:'#1A1814', margin:'0 0 12px', display:'flex', alignItems:'baseline', gap:'10px' }}>
    <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E' }}>{n}</span>{children}
  </h2>
)
const box = { border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'18px 20px', marginBottom:'20px' }
const sel = { padding:'8px 10px', fontSize:'14px', width:'100%', maxWidth:'320px' }

function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function ImportPanel({ covUser, locked, outcomes, setOutcomes }) {
  const [file, setFile] = useState(null)            // { name, headers, rows }
  const [mapping, setMapping] = useState({})
  const [dateFormats, setDateFormats] = useState({})
  const [statusMap, setStatusMap] = useState({})
  const [verdictMap, setVerdictMap] = useState({})
  const [currency, setCurrency] = useState('USD')
  const [merchantSide, setMerchantSide] = useState(false)
  const [duplicates, setDuplicates] = useState('skip')
  const [templateName, setTemplateName] = useState('')
  const [usedTemplate, setUsedTemplate] = useState(null)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  const col = key => mapping[key] != null && file ? file.rows.map(r => r[mapping[key]]) : []
  const setupFormats = (rows, map) => {
    const f = {}
    FIELDS.filter(x => x.type === 'date' && map[x.key] != null).forEach(x => { f[x.key] = detectDateFormat(rows.map(r => r[map[x.key]])) })
    return f
  }

  const load = async (f) => {
    setProblem(''); setDone(null)
    if (!f) return
    if (f.size > MAX_BYTES) return setProblem(`That file is ${(f.size / 1048576).toFixed(1)} MB. Files up to 10 MB can be imported — split it and import each part.`)
    const text = await f.text()
    const parsed = parseCsv(text)
    if (!parsed.headers.length || !parsed.rows.length) return setProblem('That file has no rows under a header line. Export it again as CSV with column names in the first row.')
    if (parsed.rows.length > MAX_ROWS) return setProblem(`That file has ${parsed.rows.length.toLocaleString()} rows. Up to ${MAX_ROWS.toLocaleString()} can be imported at once — split it and import each part.`)
    const sig = signatureOf(parsed.headers)
    const tpl = readTemplates().find(t => t.signature === sig)
    let map = guessMapping(parsed.headers)
    if (tpl) {
      map = {}
      Object.entries(tpl.columns).forEach(([k, name]) => { const i = parsed.headers.indexOf(name); if (i >= 0) map[k] = i })
      setStatusMap(tpl.statusMap || {}); setVerdictMap(tpl.verdictMap || {}); setCurrency(tpl.currency || 'USD'); setMerchantSide(!!tpl.merchantSide)
    } else { setStatusMap({}); setVerdictMap({}) }
    setUsedTemplate(tpl || null)
    setFile({ name: f.name, headers: parsed.headers, rows: parsed.rows })
    setMapping(map)
    setDateFormats(tpl?.dateFormats || setupFormats(parsed.rows, map))
  }
  const setCol = (key, idx) => {
    const m = { ...mapping }
    if (idx === '') delete m[key]; else m[key] = Number(idx)
    setMapping(m)
    if (FIELD[key].type === 'date' && idx !== '') setDateFormats(d => ({ ...d, [key]: detectDateFormat(file.rows.map(r => r[Number(idx)])) }))
  }

  const statusValues = useMemo(() => mapping.status != null && file ? distinctValues(file.rows, mapping.status) : [], [file, mapping.status])
  const verdictValues = useMemo(() => mapping.verdict != null && file ? distinctValues(file.rows, mapping.verdict) : [], [file, mapping.verdict])
  const missingRequired = FIELDS.filter(f => f.required && mapping[f.key] == null)

  const batchId = useMemo(() => 'IMP-' + Date.now().toString(36).toUpperCase(), [file])
  const result = useMemo(() => {
    if (!file || missingRequired.length) return null
    return buildImport({ rows: file.rows, existing: outcomes, options: {
      mapping, dateFormats, statusMap, verdictMap, defaultCurrency: currency, merchantSide, duplicates,
      fileName: file.name, batchId, by: covUser?.name || covUser?.email || 'Import', reasonTitles: REASON_TITLES,
    } })
  }, [file, mapping, dateFormats, statusMap, verdictMap, currency, merchantSide, duplicates, outcomes])

  const hardErrors = result ? result.errors.filter(e => !e.warning) : []
  const badRows = new Set(hardErrors.map(e => e.row))
  const projected = result ? JSON.stringify(outcomes).length + JSON.stringify(result.creates).length : 0
  const tooBig = projected > STORAGE_BUDGET

  const saveTemplate = () => {
    const name = templateName.trim(); if (!name || !file) return
    const columns = Object.fromEntries(Object.entries(mapping).map(([k, i]) => [k, file.headers[i]]))
    const tpl = { name, signature: signatureOf(file.headers), columns, dateFormats, statusMap, verdictMap, currency, merchantSide, savedBy: covUser?.email || '', savedAt: new Date().toISOString() }
    const next = [tpl, ...readTemplates().filter(t => t.signature !== tpl.signature && t.name !== name)].slice(0, 20)
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)) } catch {}
    setUsedTemplate(tpl); setTemplateName('')
  }

  const runImport = () => {
    if (!result || tooBig) return
    const { creates, updates } = result
    const byId = new Map(updates.map(u => [u.id, u]))
    setOutcomes(prev => [...creates, ...prev.map(c => byId.get(c.id) || c)])
    auditWrite('cases.imported', 'workspace', batchId, { file: file.name, rows: file.rows.length, created: creates.length, updated: updates.length,
      skipped: result.skipped.length, rejected: badRows.size })
    setDone({ file: file.name, created: creates.length, updated: updates.length, skipped: result.skipped.length, rejected: badRows.size, batchId })
    setFile(null)
  }
  const errorsCsv = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Row', 'Field', 'Problem', 'Imported?'], ...result.errors.map(e => [e.row, e.field, e.message, e.warning ? 'Yes, unassigned' : 'No']),
      ...result.skipped.map(s => [s.row, '', s.reason, 'No (skipped)'])]
    download(`${file.name.replace(/\.[^.]+$/, '')}-problems.csv`, lines.map(r => r.map(esc).join(',')).join('\n'))
  }

  // Preview of how a raw value will be read
  const previewOf = (f, raw) => {
    if (!raw) return null
    if (f.type === 'date') { const d = parseDate(raw, dateFormats[f.key]); return d ? { ok: true, text: d } : { ok: false, text: 'unreadable' } }
    if (f.type === 'amount') { const a = parseAmount(raw); return a ? { ok: true, text: `${a.value.toFixed(2)} ${a.currency || currency}` } : { ok: false, text: 'unreadable' } }
    return null
  }

  if (locked) return (
    <p className="display-font" style={{ fontSize:'15px', color:'#57534E', border:'1px dashed #D4CCBC', padding:'16px' }}>
      Admins and reviewers import cases. Ask one of them if you have a file to bring in.
    </p>
  )

  return (<>
    {done && (
      <div role="status" style={{ ...box, borderColor:'#065F46', background:'#ECFDF5' }}>
        <div className="display-font" style={{ fontSize:'18px', fontWeight:600, color:'#064E3B', marginBottom:'4px' }}>Imported {done.created.toLocaleString()} new case{done.created === 1 ? '' : 's'}{done.updated ? ` and updated ${done.updated.toLocaleString()}` : ''}.</div>
        <div className="mono-font" style={{ fontSize:'11px', color:'#065F46' }}>
          From {done.file} · batch {done.batchId}{done.skipped ? ` · ${done.skipped} skipped` : ''}{done.rejected ? ` · ${done.rejected} row${done.rejected === 1 ? '' : 's'} not imported` : ''}. They’re in Home and Multi now, and sync to your team.
        </div>
      </div>
    )}

    {/* 1 — File */}
    <section style={box}>
      <H2 n="01">Choose a file</H2>
      <div onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]) }}
        style={{ border:`2px dashed ${drag ? '#1A1814' : '#B8B0A4'}`, background: drag ? '#EEE9E0' : '#FFFFFF', padding:'22px', textAlign:'center' }}>
        <p className="display-font" style={{ fontSize:'15px', color:'#3F3A35', margin:'0 0 10px' }}>
          {file ? <><strong>{file.name}</strong> — {file.rows.length.toLocaleString()} rows, {file.headers.length} columns</> : 'Drop a CSV export here, or'}
        </p>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display:'none' }} onChange={e => { load(e.target.files?.[0]); e.target.value = '' }} />
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>{file ? 'Choose a different file' : 'Choose a file'}</Button>
      </div>
      <p className="mono-font" style={{ fontSize:'11px', color:'#57534E', margin:'10px 0 0', lineHeight:1.6 }}>
        CSV with column names in the first row; commas, semicolons or tabs. Up to {MAX_ROWS.toLocaleString()} rows and 10 MB.
        {' '}<button onClick={() => download('covalence-sample-import.csv', SAMPLE_CSV)} className="mono-font" style={{ background:'none', border:'none', padding:0, color:'#1E3A5F', textDecoration:'underline', cursor:'pointer', fontSize:'11px' }}>Download a sample file</button>
      </p>
      {problem && <p role="alert" className="display-font" style={{ fontSize:'14px', color:'#991B1B', margin:'10px 0 0' }}>{problem}</p>}
    </section>

    {file && (<>
      {/* 2 — Columns */}
      <section style={box}>
        <H2 n="02">Match the columns</H2>
        {usedTemplate && <p className="mono-font" style={{ fontSize:'11px', color:'#065F46', margin:'0 0 10px' }}>Using your saved mapping “{usedTemplate.name}” — this file has the same columns.</p>}
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 14px' }}>Covalence guessed from the column names. Check each one; the sample shows how the first value will be read.</p>
        <div style={{ display:'grid', gap:'10px' }}>
          {FIELDS.map(f => {
            const sample = mapping[f.key] != null ? file.rows.map(r => r[mapping[f.key]]).find(Boolean) : ''
            const pv = previewOf(f, sample)
            const ambiguous = f.type === 'date' && mapping[f.key] != null && dateAmbiguous(col(f.key))
            return (
              <div key={f.key} className="cov-import-row" style={{ display:'grid', gridTemplateColumns:'minmax(150px, 220px) minmax(160px, 320px) 1fr', gap:'12px', alignItems:'center', borderTop:'1px solid #EDE7DC', paddingTop:'10px' }}>
                <label htmlFor={`imp-${f.key}`} className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>
                  {f.label}{f.required && <span style={{ color:'#991B1B' }} aria-label="required"> *</span>}
                </label>
                <select id={`imp-${f.key}`} className="input-field" value={mapping[f.key] ?? ''} onChange={e => setCol(f.key, e.target.value)} style={sel}>
                  <option value="">— not in this file —</option>
                  {file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
                <div className="mono-font" style={{ fontSize:'11px', color:'#57534E', minWidth:0, overflow:'hidden', textOverflow:'ellipsis' }}>
                  {sample ? <>“{sample.length > 40 ? sample.slice(0, 40) + '…' : sample}”{pv && <span style={{ color: pv.ok ? '#065F46' : '#991B1B' }}> → {pv.text}</span>}</> : f.hint ? <span style={{ color:'#6B6259' }}>{f.hint}</span> : null}
                  {f.type === 'date' && mapping[f.key] != null && (
                    <select aria-label={`${f.label} format`} value={dateFormats[f.key] || 'mdy'} onChange={e => setDateFormats(d => ({ ...d, [f.key]: e.target.value }))}
                      className="input-field" style={{ display:'block', maxWidth:'100%', padding:'4px 6px', fontSize:'12px', marginTop:'6px', borderColor: ambiguous ? '#B45309' : undefined }}>
                      <option value="mdy">Month first (10/03 = Oct 3)</option><option value="dmy">Day first (10/03 = 10 Mar)</option>
                      <option value="iso">Year first (2026-10-03)</option><option value="excel">Excel date numbers</option>
                    </select>
                  )}
                  {ambiguous && <div style={{ color:'#92400E', marginTop:'4px' }}>Every day in this column is 12 or under — check whether it’s month or day first.</div>}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display:'flex', gap:'24px', flexWrap:'wrap', marginTop:'16px', alignItems:'center' }}>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'8px', alignItems:'center' }}>
            Currency when the file doesn’t say
            <select className="input-field" value={currency} onChange={e => setCurrency(e.target.value)} style={{ padding:'6px 8px', fontSize:'14px' }}>
              {['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NGN', 'INR', 'JPY'].map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="display-font" style={{ fontSize:'14px', display:'flex', gap:'6px', alignItems:'center', cursor:'pointer' }}>
            <input type="checkbox" checked={merchantSide} onChange={e => setMerchantSide(e.target.checked)} /> These are chargebacks against us as a merchant
          </label>
        </div>
        {missingRequired.length > 0 && <p role="alert" className="display-font" style={{ fontSize:'14px', color:'#991B1B', margin:'12px 0 0' }}>Choose a column for {missingRequired.map(f => f.label.toLowerCase()).join(', ')} to continue.</p>}
      </section>

      {/* 3 — Values */}
      {(statusValues.length > 0 || verdictValues.length > 0) && (
        <section style={box}>
          <H2 n="03">Match the values</H2>
          <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:'0 0 14px' }}>Your system’s words for status and claim type, matched to Covalence’s. Rows with a status left unmatched won’t import.</p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'20px' }}>
            {[['status', statusValues, statusMap, setStatusMap, STATUSES, guessStatus, 'STATUS'], ['verdict', verdictValues, verdictMap, setVerdictMap, VERDICTS, guessVerdict, 'CLAIM TYPE']]
              .filter(([, vals]) => vals.length).map(([key, vals, vmap, setV, targets, guess, title]) => (
              <div key={key}>
                <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#57534E', marginBottom:'6px' }}>{title}</div>
                {vals.map(({ value, count }) => {
                  const cur = vmap[value] ?? guess(value)
                  return (
                    <div key={value} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px', padding:'5px 0', borderTop:'1px solid #EDE7DC' }}>
                      <span className="display-font" style={{ fontSize:'14px', color:'#1A1814', minWidth:0, overflowWrap:'anywhere' }}>{value} <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259' }}>×{count}</span></span>
                      <select aria-label={`${title} for ${value}`} className="input-field" value={cur} onChange={e => setV(m => ({ ...m, [value]: e.target.value }))}
                        style={{ padding:'5px 8px', fontSize:'13px', borderColor: !cur && key === 'status' ? '#B91C1C' : undefined }}>
                        <option value="">{key === 'status' ? '— choose —' : '— leave blank —'}</option>
                        {targets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4 — Check and import */}
      {result && (
        <section style={box}>
          <H2 n="04">Check and import</H2>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px' }}>
            <Badge tone="ok">{result.creates.length.toLocaleString()} NEW</Badge>
            {result.updates.length > 0 && <Badge tone="info">{result.updates.length.toLocaleString()} UPDATES</Badge>}
            {result.skipped.length > 0 && <Badge>{result.skipped.length.toLocaleString()} SKIPPED</Badge>}
            {badRows.size > 0 && <Badge tone="danger">{badRows.size.toLocaleString()} ROW{badRows.size === 1 ? '' : 'S'} WITH PROBLEMS</Badge>}
            {result.errors.some(e => e.warning) && <Badge tone="warn">{result.errors.filter(e => e.warning).length} IMPORT UNASSIGNED</Badge>}
          </div>

          {mapping.externalRef != null && (
            <fieldset style={{ border:0, padding:0, margin:'0 0 12px', display:'flex', gap:'16px', flexWrap:'wrap' }}>
              <legend className="display-font" style={{ fontSize:'14px', color:'#1A1814', marginBottom:'6px' }}>When a case reference is already in Covalence:</legend>
              {[['skip', 'Skip it'], ['update', 'Update it with this file’s values']].map(([v, l]) => (
                <label key={v} className="display-font" style={{ fontSize:'14px', display:'flex', gap:'6px', alignItems:'center', cursor:'pointer' }}>
                  <input type="radio" name="imp-dup" checked={duplicates === v} onChange={() => setDuplicates(v)} />{l}
                </label>
              ))}
            </fieldset>
          )}
          {mapping.externalRef == null && <p className="mono-font" style={{ fontSize:'11px', color:'#92400E', margin:'0 0 12px' }}>No case reference column: importing the same file twice would create the cases twice.</p>}

          {(result.errors.length > 0 || result.skipped.length > 0) && (
            <div style={{ marginBottom:'14px' }}>
              <ul className="mono-font" style={{ fontSize:'11px', color:'#3F3A35', margin:'0 0 6px', paddingLeft:'18px', maxHeight:'160px', overflowY:'auto' }}>
                {[...result.errors.map(e => ({ row: e.row, text: `${e.field}: ${e.message}`, warn: e.warning })), ...result.skipped.map(s => ({ row: s.row, text: s.reason, skip: true }))]
                  .sort((a, b) => a.row - b.row).slice(0, 50).map((x, i) => (
                    <li key={i} style={{ color: x.warn || x.skip ? '#57534E' : '#991B1B' }}>Row {x.row}: {x.text}</li>
                  ))}
              </ul>
              <button onClick={errorsCsv} className="mono-font" style={{ background:'none', border:'none', padding:0, color:'#1E3A5F', textDecoration:'underline', cursor:'pointer', fontSize:'11px' }}>Download the full list</button>
            </div>
          )}

          {result.creates.length > 0 && (
            <div style={{ overflowX:'auto', marginBottom:'14px' }}>
              <table className="mono-font" style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
                <thead><tr>{['Reference', 'Opened', 'Merchant', 'Amount', 'Network', 'Code', 'Status', 'Claim type'].map(h => <th key={h} scope="col" style={{ textAlign:'left', padding:'6px 8px', color:'#57534E', fontWeight:500, borderBottom:'1px solid #D4CCBC', whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {result.creates.slice(0, 8).map(c => (
                    <tr key={c.id}>{[c.externalRef || '—', c.date?.slice(0, 10), c.merchant, c.amount, c.network || '—', c.reasonCode || '—', c.status, (c.verdict || '—').replace(/_/g, ' ').toLowerCase()].map((v, i) => (
                      <td key={i} style={{ padding:'6px 8px', borderBottom:'1px solid #EDE7DC', whiteSpace:'nowrap', maxWidth:'220px', overflow:'hidden', textOverflow:'ellipsis', color:'#1A1814' }}>{v}</td>))}</tr>
                  ))}
                </tbody>
              </table>
              {result.creates.length > 8 && <div className="mono-font" style={{ fontSize:'10px', color:'#6B6259', marginTop:'4px' }}>…and {(result.creates.length - 8).toLocaleString()} more</div>}
            </div>
          )}

          {tooBig && <p role="alert" className="display-font" style={{ fontSize:'14px', color:'#991B1B' }}>That’s more than this browser can hold alongside the cases already here. Import a smaller file, or ask your admin to apply the retention policy to old closed cases first.</p>}

          <div style={{ display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
            <Button disabled={tooBig || !(result.creates.length || result.updates.length)} onClick={runImport}>
              Import {(result.creates.length + result.updates.length).toLocaleString()} case{result.creates.length + result.updates.length === 1 ? '' : 's'}
            </Button>
            <span style={{ display:'flex', gap:'6px', alignItems:'center' }}>
              <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Name this mapping, e.g. Core export" aria-label="Mapping name" style={{ width:'240px', padding:'8px 10px', fontSize:'14px' }} />
              <Button variant="secondary" disabled={!templateName.trim()} onClick={saveTemplate}>Save mapping</Button>
            </span>
          </div>
        </section>
      )}
    </>)}
  </>)
}

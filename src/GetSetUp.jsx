// ═══════════════════════════════════════════════════════════════════════════════
// GET SET UP — a new workspace's first steps, on Home, ticked off as they're done
// ═══════════════════════════════════════════════════════════════════════════════
// Shown to signed-in workspaces until every step is done or someone hides it
// (hiding is remembered in this browser only). Each step checks the real state:
// what the workspace does, its API keys, its cases, its team, its 314(b) record.
import React, { useEffect, useState } from 'react'
import { isDemoCase } from './CaseThread.jsx'
import { listTeam } from './auth.js'
import { intakeStatus } from './monitoringData.js'
import { sharingGet } from './data.js'
import { doesIssuing, workspaceSides } from './sides.mjs'

const go = (section, tab) => window.dispatchEvent(new CustomEvent('cov:go', { detail: { section, tab } }))
const HIDE_KEY = 'cov_setup_hidden'

export function GetSetUp({ outcomes, settings, covUser, onTour }) {
  const [state, setState] = useState({ keys: null, team: null, sharing: null })
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false } })
  const tourDone = (() => { try { return localStorage.getItem('cov_tour_done') === '1' } catch { return false } })()
  const sides = workspaceSides(settings)
  useEffect(() => {
    if (!covUser?.authed || hidden) return
    Promise.allSettled([intakeStatus(), listTeam(), doesIssuing(sides) ? sharingGet() : Promise.resolve(null)]).then(([k, t, s]) => setState({
      keys: k.status === 'fulfilled' ? (k.value?.active_keys || 0) : 0,
      team: t.status === 'fulfilled' ? t.value.length : 1,
      sharing: s.status === 'fulfilled' ? !!s.value?.registered : false,
    }))
  }, [covUser?.authed, hidden])
  if (!covUser?.authed || hidden || state.keys === null) return null

  const steps = [
    { done: !!settings.institutionType || (settings.sides || []).length > 0, label: 'Tell Covalence what you do', hint: 'Institution type and side — it sets the menu and where each tool starts.', act: () => go('settings', 'settings') },
    { done: state.keys > 0, label: 'Connect your systems', hint: 'An API key lets your core, card processor or fraud engine send transactions and alerts.', act: () => go('settings', 'connections') },
    { done: (outcomes || []).some(c => !isDemoCase(c)), label: 'Bring in your cases', hint: 'Import open disputes from a spreadsheet, or they arrive through the API.', act: () => go('settings', 'import') },
    { done: state.team > 1, label: 'Invite your team', hint: 'Analysts, reviewers and auditors, each with the right access.', act: () => go('settings', 'team') },
    ...(doesIssuing(sides) ? [{ done: state.sharing, label: 'Record your 314(b) registration', hint: 'So Duo sessions show whether information sharing is covered.', act: () => go('settings', 'fincrime') }] : []),
    { done: tourDone, label: 'Take the tour', hint: 'Two minutes on what each tool does.', act: onTour },
  ]
  const left = steps.filter(s => !s.done).length
  if (!left) return null
  const hide = () => { try { localStorage.setItem(HIDE_KEY, '1') } catch {}; setHidden(true) }

  return (
    <section aria-label="Get set up" style={{ border:'1px solid #1A1814', background:'#FAF7F1', padding:'14px 18px', marginBottom:'20px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'10px', flexWrap:'wrap', marginBottom:'8px' }}>
        <span className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.16em', color:'#57534E' }}>GET SET UP · {steps.length - left} OF {steps.length} DONE</span>
        <button type="button" onClick={hide} className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.12em', background:'none', border:0, padding:0, cursor:'pointer', color:'#78716C', textDecoration:'underline' }}>HIDE</button>
      </div>
      <ol style={{ listStyle:'none', margin:0, padding:0, display:'grid', gap:'2px' }}>
        {steps.map(s => (
          <li key={s.label}>
            <button type="button" onClick={s.act} disabled={s.done}
              style={{ width:'100%', display:'flex', gap:'10px', alignItems:'baseline', textAlign:'left', background:'none', border:0, padding:'6px 0', cursor: s.done ? 'default' : 'pointer' }}>
              <span aria-hidden="true" className="mono-font" style={{ fontSize:'12px', color: s.done ? '#065F46' : '#A8A29E', width:'14px' }}>{s.done ? '✓' : '○'}</span>
              <span style={{ flex:1 }}>
                <span className="display-font" style={{ fontSize:'14px', color: s.done ? '#78716C' : '#1A1814', textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</span>
                {!s.done && <span className="display-font" style={{ display:'block', fontSize:'12px', color:'#6B6259' }}>{s.hint}</span>}
              </span>
              {!s.done && <span aria-hidden="true" className="mono-font" style={{ fontSize:'11px', color:'#57534E' }}>→</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

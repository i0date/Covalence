// ═══════════════════════════════════════════════════════════════════════════════
// SHORTCUTS — keyboard navigation for people who live in the queue
// ═══════════════════════════════════════════════════════════════════════════════
//   G then H/T/D/M/F/A/U/R/S   go to a tool          /  or ⌘K   search cases
//   J / K                      next / previous case on Home     Enter  open it
//   E / N (case open)          export / add a note              ?  this list
// Ignored while typing in a field. ⌘K lives in CaseSearch; E/N in CasePanel.
import React, { useEffect, useRef, useState } from 'react'
import { Kbd } from './ui.jsx'

export const GO_KEYS = { h:'home', t:'triage', d:'desk', m:'multi', f:'file', a:'dfa', u:'duo', r:'trio', s:'settings' }
const TOOL_NAMES = { home:'Home', triage:'Triage', desk:'Dispute Desk', multi:'Multi', file:'File', dfa:'DFA', duo:'Duo', trio:'Trio', settings:'Settings' }

export const isTyping = e => {
  const t = e.target
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
}

// Home rows that J/K move through: "Your day" first, then the case list
function moveFocus(dir) {
  const rows = [...document.querySelectorAll('.cov-yourday-row, .cov-comingup-row, [data-case-row]')].filter(el => el.offsetParent)
  if (!rows.length) return
  const i = rows.indexOf(document.activeElement)
  const next = rows[i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + dir))]
  next.focus(); next.scrollIntoView({ block: 'nearest' })
}

export function useShortcuts({ setActiveSection, openSearch, activeSection, enabled = true }) {
  const [help, setHelp] = useState(false)
  const pendingG = useRef(0)
  useEffect(() => {
    if (!enabled) return
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return
      if (document.querySelector('[role=dialog][aria-label^="Case "], [role=dialog][aria-label="Search cases"]') && e.key !== '?') return
      const k = e.key.toLowerCase()
      if (Date.now() - pendingG.current < 1200 && GO_KEYS[k]) { e.preventDefault(); pendingG.current = 0; setActiveSection(GO_KEYS[k]); window.scrollTo({ top: 0 }); return }
      if (k === 'g') { pendingG.current = Date.now(); return }
      if (e.key === '?') { e.preventDefault(); setHelp(h => !h); return }
      if (e.key === '/') { e.preventDefault(); openSearch(); return }
      if (activeSection === 'home' && (k === 'j' || k === 'k')) { e.preventDefault(); moveFocus(k === 'j' ? 1 : -1); return }
      if (e.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, setActiveSection, openSearch, activeSection])
  return { help, setHelp }
}

export function ShortcutHelp({ open, onClose }) {
  if (!open) return null
  const Row = ({ keys, what }) => (
    <div style={{ display:'flex', justifyContent:'space-between', gap:'16px', padding:'7px 0', borderBottom:'1px solid #EDE7DC' }}>
      <span className="display-font" style={{ fontSize:'14px', color:'#1A1814' }}>{what}</span>
      <span style={{ display:'flex', gap:'4px', alignItems:'center', flexShrink:0 }}>{keys.map((x, i) => <Kbd key={i}>{x}</Kbd>)}</span>
    </div>
  )
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, zIndex:9600, background:'rgba(26,24,20,0.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ width:'100%', maxWidth:'460px', maxHeight:'85vh', overflowY:'auto', background:'#F5F1EA', border:'1px solid #1A1814', padding:'20px 22px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
          <h2 className="display-font" style={{ fontSize:'20px', fontWeight:600, margin:0 }}>Keyboard shortcuts</h2>
          <button onClick={onClose} aria-label="Close" style={{ background:'none', border:'none', fontSize:'18px', cursor:'pointer', color:'#57534E' }}>✕</button>
        </div>
        <Row keys={['/']} what="Search cases" />
        <Row keys={['⌘', 'K']} what="Search cases (Ctrl K on Windows)" />
        <Row keys={['J']} what="Next case on Home" />
        <Row keys={['K']} what="Previous case on Home" />
        <Row keys={['Enter']} what="Open the selected case" />
        <Row keys={['E']} what="Export the open case" />
        <Row keys={['N']} what="Add a note to the open case" />
        <Row keys={['Esc']} what="Close a case, search or this list" />
        <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.14em', color:'#6B6259', margin:'14px 0 2px' }}>GO TO — PRESS G, THEN</div>
        {Object.entries(GO_KEYS).map(([k, id]) => <Row key={k} keys={['G', k.toUpperCase()]} what={TOOL_NAMES[id]} />)}
        <Row keys={['?']} what="Show or hide this list" />
      </div>
    </div>
  )
}

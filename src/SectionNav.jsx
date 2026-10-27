// ═══════════════════════════════════════════════════════════════════════════════
// SECTION NAV — sticky "jump to" bar for long tool pages (Desk)
// ═══════════════════════════════════════════════════════════════════════════════
// Reads the section headings (<h2>) currently rendered inside `rootRef`, so it
// follows the page as sections appear (after an analysis, or in merchant mode).
// Click to jump; the section in view is highlighted.
import React, { useEffect, useState } from 'react'

const NAV_HEIGHT = 48   // the app's top bar
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function SectionNav({ rootRef, label = 'Sections' }) {
  const [sections, setSections] = useState([])
  const [current, setCurrent]   = useState(null)

  // Keep the list in step with the page
  useEffect(() => {
    const root = rootRef.current; if (!root) return
    const read = () => {
      const hs = [...root.querySelectorAll('h2')].filter(h => h.offsetParent && h.textContent.trim())
      const next = hs.map(h => {
        const title = h.textContent.trim().replace(/\s+/g, ' ')
        const host = h.closest('section, div') || h
        if (!host.id) host.id = 'desk-' + slug(title)
        host.style.scrollMarginTop = (NAV_HEIGHT + 56) + 'px'
        return { id: host.id, title }
      })
      setSections(prev => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.title === next[i].title)) ? prev : next)
    }
    read()
    const mo = new MutationObserver(() => requestAnimationFrame(read))
    mo.observe(root, { childList: true, subtree: true })
    // Tools stay mounted while hidden; re-read when this one becomes visible
    const ro = new ResizeObserver(() => requestAnimationFrame(read))
    ro.observe(root)
    return () => { mo.disconnect(); ro.disconnect() }
  }, [rootRef])

  // Highlight the section in view
  useEffect(() => {
    if (!sections.length) return
    const onScroll = () => {
      let cur = sections[0].id
      for (const s of sections) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top - (NAV_HEIGHT + 70) <= 0) cur = s.id
      }
      setCurrent(cur)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sections])

  if (sections.length < 2) return null
  return (
    <nav aria-label={label} className="cov-section-nav"
      style={{ position:'sticky', top: NAV_HEIGHT - 4, zIndex:30, background:'rgba(245,241,234,0.96)', backdropFilter:'blur(4px)',
        borderBottom:'1px solid #D4CCBC', margin:'0 0 24px', display:'flex', gap:'2px', overflowX:'auto' }}>
      {sections.map(s => (
        <a key={s.id} href={`#${s.id}`} aria-current={current === s.id ? 'true' : undefined}
          onClick={e => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior:'smooth', block:'start' }) }}
          className="mono-font"
          style={{ padding:'11px 12px', fontSize:'10px', letterSpacing:'0.12em', textTransform:'uppercase', whiteSpace:'nowrap', textDecoration:'none',
            color: current === s.id ? '#1A1814' : '#6B6259', borderBottom: current === s.id ? '2px solid #1A1814' : '2px solid transparent' }}>
          {s.title}
        </a>
      ))}
    </nav>
  )
}

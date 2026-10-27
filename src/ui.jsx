// ═══════════════════════════════════════════════════════════════════════════════
// UI — shared buttons, form fields and badges
// ═══════════════════════════════════════════════════════════════════════════════
// One look for every tool. Styles live in GLOBAL_CSS (shared.jsx): .cov-btn,
// .cov-btn-secondary, .cov-btn-danger, .cov-btn-quiet, .cov-input, .cov-label,
// .cov-badge. New screens use these; older tool internals move over as they're
// touched.
import React from 'react'

const VARIANT = { primary: 'cov-btn', secondary: 'cov-btn-secondary', danger: 'cov-btn-danger', quiet: 'cov-btn-quiet' }

export function Button({ variant = 'primary', small, className = '', type = 'button', ...rest }) {
  const cls = [VARIANT[variant] || VARIANT.primary, small && variant === 'primary' ? 'cov-btn-sm' : '', className].filter(Boolean).join(' ')
  return <button type={type} className={cls} {...rest} />
}

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
      {label && <label className="cov-label" htmlFor={htmlFor} style={{ marginBottom:0 }}>{label}</label>}
      {children}
      {hint && <p className="display-font" style={{ fontSize:'12px', color:'#6B6259', lineHeight:1.45, margin:0 }}>{hint}</p>}
    </div>
  )
}

export const Input = React.forwardRef(function Input({ className = '', style, ...rest }, ref) {
  return <input ref={ref} className={`cov-input ${className}`} style={{ padding:'10px 12px', fontSize:'15px', ...style }} {...rest} />
})

export function Select({ className = '', style, children, ...rest }) {
  return <select className={`input-field ${className}`} style={{ padding:'9px 10px', fontSize:'14px', ...style }} {...rest}>{children}</select>
}

const TONE = {
  neutral: { background:'#E7E2D9', color:'#3F3A35' },
  dark:    { background:'#1A1814', color:'#F5F1EA' },
  warn:    { background:'#92400E', color:'#FFFBEB' },
  danger:  { background:'#7F1D1D', color:'#FEF2F2' },
  ok:      { background:'#064E3B', color:'#ECFDF5' },
  info:    { background:'#1E3A5F', color:'#DBEAFE' },
}
export function Badge({ tone = 'neutral', style, ...rest }) {
  return <span className="cov-badge" style={{ ...TONE[tone], ...style }} {...rest} />
}

export function Kbd({ children }) { return <kbd className="cov-kbd">{children}</kbd> }

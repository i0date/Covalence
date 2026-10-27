// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW PANEL — Settings → Workflow: SLA targets, auto-assignment,
// escalation and reminders
// ═══════════════════════════════════════════════════════════════════════════════
// The values live in the institution's settings (cov_settings, synced to the
// workspace), so every teammate's app and the daily email run the same rules.
// Admins and reviewers change them; everyone else sees them read-only.
import React, { useState } from 'react'
import { accessToken } from './auth.js'
import { assignPool, openLoad, workflowChanges, WORKFLOW_DEFAULTS } from './clocks.mjs'
import { WORKFLOW_RUN_EVENT } from './workflow.jsx'
import { Button, Field, Input } from './ui.jsx'

const ROLE_LABEL = { analyst: 'Analysts', reviewer: 'Reviewers', admin: 'Admins' }

function Card({ title, children }) {
  return (
    <div style={{ border:'1px solid #D4CCBC', background:'#FAF7F1' }}>
      <div style={{ background:'#EEE9E0', borderBottom:'1px solid #D4CCBC', padding:'10px 20px' }}>
        <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:0, fontWeight:500 }}>{title}</h2>
      </div>
      <div style={{ padding:'20px', display:'grid', gap:'18px' }}>{children}</div>
    </div>
  )
}
function Switch({ on, onChange, onLabel, offLabel }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} onClick={() => onChange(!on)} className="mono-font"
      style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 14px', border:'1px solid', cursor:'pointer', width:'fit-content', fontSize:'10px', letterSpacing:'0.12em',
        background: on ? '#064E3B' : '#292524', color: on ? '#D1FAE5' : '#D6D3D1', borderColor: on ? '#064E3B' : '#44403C' }}>
      <span aria-hidden="true">{on ? '●' : '○'}</span>{on ? onLabel : offLabel}
    </button>
  )
}

export function WorkflowPanel({ settings, set, locked, covUser, outcomes, team }) {
  const s = { ...WORKFLOW_DEFAULTS, ...settings }
  const num = (field, min, max) => (
    <Input type="number" min={min} max={max} value={s[field]} style={{ width:'120px' }} aria-label={field}
      onChange={e => set(field, Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
  )
  const pool = assignPool(team, s)
  const load = openLoad(outcomes)
  const escalationPeople = (team || []).filter(m => m.email && m.role !== 'auditor')
    .sort((a, b) => (a.role === 'analyst') - (b.role === 'analyst') || (a.display_name || '').localeCompare(b.display_name || ''))
  const backlog = workflowChanges(outcomes, s, team, new Date(), { backlog: true })
  const nAssign = backlog.filter(x => x.patch.assignedTo).length, nEsc = backlog.filter(x => x.patch.escalatedTo).length
  const [applied, setApplied] = useState(null)
  const [mail, setMail] = useState({ busy: false, msg: '' })

  const emailMe = async () => {
    setMail({ busy: true, msg: '' })
    try {
      const r = await fetch('/api/reminders', { method: 'POST', headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json().catch(() => ({}))
      setMail({ busy: false, msg: r.ok ? `Sent to ${d.to} — ${d.items ? `${d.items} item${d.items === 1 ? '' : 's'}` : 'nothing due today'}.` : (d.error || `Couldn’t send (${r.status})`) })
    } catch (e) { setMail({ busy: false, msg: 'Couldn’t reach the server.' }) }
  }

  return (<>
    {locked && (
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.08em', color:'#57534E', border:'1px dashed #B8B0A4', padding:'10px 14px', marginBottom:'16px' }}>
        These are {covUser.institution}’s workflow rules. Only admins and reviewers can change them.
      </div>
    )}
    <fieldset disabled={locked} style={{ border:0, padding:0, margin:0, minWidth:0, opacity: locked ? 0.75 : 1 }}>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:'20px', alignItems:'start' }}>

      <Card title="SLA TARGETS">
        <Field label="Owner assigned within (hours)" hint="Unowned cases past this show as “No owner” on Home. 0 turns the clock off.">{num('slaAssignHours', 0, 720)}</Field>
        <Field label="Filed with the network within (business days)" hint="Counted from when the case was opened. 0 turns the clock off.">{num('slaFileBusinessDays', 0, 120)}</Field>
        <Field label="Warn before a response deadline (days)" hint="Network response deadlines count as due soon from this point.">{num('reminderLeadDays', 0, 30)}</Field>
        <Field label="Warn before the Reg E 45-day limit (days)" hint="45 business days from provisional credit; Federal Reserve holidays excluded.">{num('regEWarnDays', 0, 30)}</Field>
      </Card>

      <Card title="AUTO-ASSIGNMENT">
        <Field label="" hint="New cases go to the teammate with the fewest open cases. Cases opened before you switch this on are left alone.">
          <Switch on={s.autoAssign} onLabel="ASSIGNING NEW CASES" offLabel="OFF — ASSIGN BY HAND"
            onChange={on => { set('autoAssign', on); if (on) set('autoAssignSince', new Date().toISOString()) }} />
        </Field>
        <Field label="Who gets cases">
          <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
            {Object.entries(ROLE_LABEL).map(([r, label]) => (
              <label key={r} className="display-font" style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'14px', cursor:'pointer' }}>
                <input type="checkbox" checked={(s.autoAssignRoles || []).includes(r)}
                  onChange={e => set('autoAssignRoles', e.target.checked ? [...new Set([...(s.autoAssignRoles || []), r])] : (s.autoAssignRoles || []).filter(x => x !== r))} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <div>
          {pool.length === 0
            ? <p className="display-font" style={{ fontSize:'13px', color:'#92400E', margin:0 }}>Nobody on the team has these roles yet.</p>
            : pool.map(m => (
              <div key={m.email} className="mono-font" style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', padding:'5px 0', borderBottom:'1px solid #EDE7DC' }}>
                <span style={{ color:'#1A1814' }}>{m.name}</span><span style={{ color:'#57534E' }}>{load[m.email] || 0} open</span>
              </div>
            ))}
        </div>
      </Card>

      <Card title="ESCALATION">
        <Field label="Escalate to" hint="This person sees escalated cases on their Home and in their reminders.">
          <select className="input-field" value={s.escalateTo || ''} style={{ padding:'9px 10px', fontSize:'14px' }}
            onChange={e => { const v = e.target.value; set('escalateTo', v); if (v && !s.escalateTo) set('escalateSince', new Date().toISOString()) }}>
            <option value="">— nobody (escalation off) —</option>
            {escalationPeople.map(m => <option key={m.email} value={m.email.toLowerCase()}>{(m.display_name || m.email).replace(/ \(you\)$/, ' (you)')} · {m.role}</option>)}
          </select>
        </Field>
        <Field label="" hint="When an SLA target or deadline is missed, the case is escalated once.">
          <Switch on={s.escalateOnBreach} onLabel="ESCALATE MISSED CLOCKS" offLabel="DON’T ESCALATE MISSED CLOCKS" onChange={on => set('escalateOnBreach', on)} />
        </Field>
        <Field label="Escalate cases worth at least" hint="0 turns this off.">{num('escalateAmount', 0, 100000000)}</Field>
      </Card>

      <Card title="REMINDERS">
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', lineHeight:1.55, margin:0 }}>
          Everyone sees their own reminders under the bell in the top bar: clocks running out on their cases, escalations, and cases newly assigned to them.
        </p>
        <Field label="" hint="Each weekday morning, everyone with something due gets one email listing it. Unowned cases go to the escalation contact.">
          <Switch on={s.emailReminders} onLabel="DAILY EMAIL ON" offLabel="DAILY EMAIL OFF" onChange={on => set('emailReminders', on)} />
        </Field>
        {covUser?.authed ? (
          <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
            <Button variant="secondary" onClick={emailMe} disabled={mail.busy}>{mail.busy ? 'Sending…' : 'Email me my reminders now'}</Button>
            {mail.msg && <span className="mono-font" role="status" style={{ fontSize:'11px', color:'#3F3A35' }}>{mail.msg}</span>}
          </div>
        ) : (
          <p className="mono-font" style={{ fontSize:'11px', color:'#6B6259', margin:0 }}>Emails are sent for real workspaces. In the demo, reminders appear under the bell.</p>
        )}
      </Card>
    </div>

    <div style={{ marginTop:'20px', border:'1px solid #D4CCBC', background:'#FAF7F1', padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px', flexWrap:'wrap' }}>
      <div>
        <h2 className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.2em', color:'#57534E', margin:'0 0 4px', fontWeight:500 }}>EXISTING CASES</h2>
        <p className="display-font" style={{ fontSize:'14px', color:'#3F3A35', margin:0 }}>
          {applied != null ? `Done — ${applied} case${applied === 1 ? '' : 's'} updated.`
            : nAssign || nEsc ? `The rules above would assign ${nAssign} and escalate ${nEsc} of the cases already open.`
            : 'The rules above don’t change any cases already open.'}
        </p>
      </div>
      <Button variant="secondary" disabled={!(nAssign || nEsc)}
        onClick={() => window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_EVENT, { detail: { done: setApplied } }))}>
        Apply to existing cases
      </Button>
    </div>
    </fieldset>
  </>)
}

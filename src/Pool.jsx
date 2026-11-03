// ═══════════════════════════════════════════════════════════════════════════════
// POOL — several people from your institution working one case together
// ═══════════════════════════════════════════════════════════════════════════════
// The case's owner opens a pool when a case needs more hands: says what help is
// needed and how urgent it is, and can invite people. Anyone who can work cases
// can join an open pool. The owner stays the one person accountable; members add
// tasks, take them and tick them off, and the owner closes the pool when it's done.
// (Duo is two institutions on one case; Trio is one incident across many cases.)
// The pool lives on the case (c.pool), so it syncs with the case. Every step goes
// on the case's timeline and into the audit log as pool.*.
// Members can't edit the case any more than they could before: anyone whose role
// can work cases already can. The pool is who's helping and with what.
import React, { useEffect, useState } from 'react'
import { canWrite, canConfigure } from './auth.js'
import { auditWrite } from './audit.js'
import { fetchAgents } from './data.js'

export const HELP = {
  trace: 'Trace the money or wallets', device: 'Device and login history', customer: 'Talk to the customer',
  counterparty: 'Contact the merchant or other bank', aml: 'AML or SAR review', sanctions: 'Sanctions check',
  evidence: 'Evidence and documents', second: 'A second opinion',
}
const day = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const first = s => String(s || '').split(/[\s@]/)[0]
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

// Where you stand in a case's pool: owner, member, invited, could join, or none
export function poolRole(c, email) {
  const p = c?.pool
  if (!p || p.status !== 'open' || !email) return null
  if (same(c.assignedTo, email)) return 'owner'
  if ((p.members || []).some(m => same(m.email, email))) return 'member'
  if ((p.invited || []).some(e => same(e, email))) return 'invited'
  return 'open'
}
// Open tasks given to you in a pool
export const tasksFor = (c, email) => (c?.pool?.tasks || []).filter(t => !t.done && same(t.assignee, email))

// One change to a case's pool: the new pool, a timeline entry, and an audit entry
function change(setOutcomes, id, fn, text, by, action, detail) {
  const ts = new Date().toISOString()
  setOutcomes(prev => prev.map(o => o.id === id ? { ...o, pool: fn(o.pool, ts), history: [...(o.history || []), { ts, event: 'pool', text, by }] } : o))
  auditWrite(action, 'case', id, detail)
}

export function PoolPanel({ c, covUser, setOutcomes }) {
  const me = covUser?.email || '', myName = covUser?.name || me
  const p = c.pool, open = p?.status === 'open'
  const role = poolRole(c, me)
  const writer = canWrite() && !!me
  const lead = writer && (same(c.assignedTo, me) || canConfigure())   // the owner, or a reviewer or admin
  const [form, setForm] = useState(false)
  const [help, setHelp] = useState([]), [ask, setAsk] = useState(''), [urgent, setUrgent] = useState(false), [invite, setInvite] = useState([])
  const [team, setTeam] = useState([])
  const [task, setTask] = useState(''), [taskFor, setTaskFor] = useState(''), [inviting, setInviting] = useState(false), [closing, setClosing] = useState(false), [note, setNote] = useState('')
  useEffect(() => { setForm(false); setInviting(false); setClosing(false) }, [c.id])
  useEffect(() => { if (form || inviting) fetchAgents().then(t => setTeam((t || []).filter(m => !same(m.email, me)))).catch(() => setTeam([])) }, [form, inviting, me])

  const go = (fn, text, action, detail) => change(setOutcomes, c.id, fn, text, myName, action, detail)
  const nameOf = email => (p?.members || []).find(m => same(m.email, email))?.name || (same(email, c.assignedTo) ? (c.assignedName || email) : '') || team.find(m => same(m.email, email))?.name || email

  // ── No pool yet ──
  if (!open && !form) {
    if (!c.assignedTo || !lead) return p?.status === 'closed' ? <ClosedLine p={p} /> : null
    return (
      <div className="cov-pool cov-pool-quiet">
        <div className="cov-pool-row">
          <span className="display-font" style={{ fontSize:'14px', color:'#3F3A35', minWidth:0 }}>
            {p?.status === 'closed' ? <ClosedText p={p} /> : 'Need more hands? Pool the case and your teammates can work it with you.'}
          </span>
          <button type="button" className="mono-font cov-owner-btn" onClick={() => setForm(true)}>{p?.status === 'closed' ? 'POOL IT AGAIN' : 'POOL THIS CASE'}</button>
        </div>
      </div>
    )
  }

  // ── Opening one ──
  if (form) {
    const ok = help.length > 0 || ask.trim().length > 0
    const openIt = () => {
      const by = { email: me, name: myName }
      go((_, ts) => ({ status: 'open', ask: ask.trim(), help, urgent, openedBy: by, openedAt: ts, members: [], invited: invite, tasks: [] }),
        `Pooled: ${[...help.map(h => HELP[h]), ask.trim()].filter(Boolean).join('; ')}${urgent ? ' (urgent)' : ''}`, 'pool.opened', { help: help.map(h => HELP[h]), ask: ask.trim(), urgent, invited: invite })
      setForm(false); setHelp([]); setAsk(''); setUrgent(false); setInvite([])
    }
    return (
      <div className="cov-pool">
        <div className="mono-font cov-pool-kicker">POOL THIS CASE</div>
        <p className="display-font" style={{ margin:0, fontSize:'13px', color:'#3F3A35', lineHeight:1.45 }}>Your teammates see it in Your day and can join. You stay the owner.</p>
        <fieldset style={{ border:'none', margin:0, padding:0 }}>
          <legend className="display-font" style={{ fontSize:'12px', color:'#57534E', marginBottom:'6px' }}>What do you need help with?</legend>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
            {Object.entries(HELP).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={help.includes(k)} className={`grade-tab ${help.includes(k) ? 'active' : ''}`} style={{ fontSize:'11px' }}
                onClick={() => setHelp(h => h.includes(k) ? h.filter(x => x !== k) : [...h, k])}>{l}</button>
            ))}
          </div>
        </fieldset>
        <label className="display-font" style={{ display:'grid', gap:'4px', fontSize:'12px', color:'#57534E' }}>Anything specific?
          <textarea className="input-field" value={ask} onChange={e => setAsk(e.target.value.slice(0, 400))} rows={2} style={{ padding:'8px 10px', fontSize:'14px', resize:'vertical' }}
            placeholder="e.g. Three more customers paid the same wallet this week; can someone trace where the funds went?" />
        </label>
        <label className="display-font" style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', color:'#3F3A35' }}>
          <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> It’s urgent
        </label>
        {team.length > 0 && (
          <div>
            <div className="display-font" style={{ fontSize:'12px', color:'#57534E', marginBottom:'6px' }}>Invite people (optional)</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {team.map(m => (
                <button key={m.email} type="button" aria-pressed={invite.includes(m.email)} className={`grade-tab ${invite.includes(m.email) ? 'active' : ''}`} style={{ fontSize:'11px' }}
                  onClick={() => setInvite(v => v.includes(m.email) ? v.filter(x => x !== m.email) : [...v, m.email])}>{m.name}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button type="button" className="mono-font cov-owner-btn cov-owner-btn-main" disabled={!ok} onClick={openIt}>OPEN THE POOL</button>
          <button type="button" className="mono-font cov-owner-btn" onClick={() => setForm(false)}>CANCEL</button>
        </div>
      </div>
    )
  }

  // ── An open pool ──
  const members = p.members || [], invited = (p.invited || []).filter(e => !members.some(m => same(m.email, e))), tasks = p.tasks || []
  const people = [{ email: c.assignedTo, name: c.assignedName || c.assignedTo, lead: true }, ...members]
  const inPool = role === 'owner' || role === 'member'
  const join = () => go(q => ({ ...q, members: [...(q.members || []), { email: me, name: myName, joinedAt: new Date().toISOString() }], invited: (q.invited || []).filter(e => !same(e, me)) }),
    'Joined the pool', 'pool.joined', {})
  const leave = () => go(q => ({ ...q, members: (q.members || []).filter(m => !same(m.email, me)), tasks: (q.tasks || []).map(t => !t.done && same(t.assignee, me) ? { ...t, assignee: '' } : t) }),
    'Left the pool', 'pool.left', {})
  const addTask = () => {
    const text = task.trim(); if (!text) return
    go((q, ts) => ({ ...q, tasks: [...(q.tasks || []), { id: 'T' + Date.now().toString(36), text, assignee: taskFor, addedBy: myName, addedAt: ts, done: false }] }),
      `Task: ${text}${taskFor ? ` (for ${nameOf(taskFor)})` : ''}`, 'pool.task_added', { task: text, assignee: taskFor || null })
    setTask(''); setTaskFor('')
  }
  const tick = t => go((q, ts) => ({ ...q, tasks: (q.tasks || []).map(x => x.id === t.id ? { ...x, done: !x.done, doneBy: !x.done ? myName : '', doneAt: !x.done ? ts : null } : x) }),
    `${t.done ? 'Reopened' : 'Done'}: ${t.text}`, t.done ? 'pool.task_reopened' : 'pool.task_done', { task: t.text })
  const takeTask = t => go(q => ({ ...q, tasks: (q.tasks || []).map(x => x.id === t.id ? { ...x, assignee: me } : x) }), `Took the task: ${t.text}`, 'pool.task_taken', { task: t.text })
  const sendInvites = list => { if (!list.length) return; go(q => ({ ...q, invited: [...new Set([...(q.invited || []), ...list])] }), `Invited ${list.map(nameOf).join(', ')}`, 'pool.invited', { invited: list }); setInviting(false) }
  const close = () => {
    const done = tasks.filter(t => t.done).length
    go((q, ts) => ({ ...q, status: 'closed', closedAt: ts, closedBy: myName, note: note.trim() }),
      `Closed the pool${note.trim() ? `: ${note.trim()}` : ''}`, 'pool.closed', { members: members.length, tasks: tasks.length, done, note: note.trim() })
    setClosing(false); setNote('')
  }

  return (
    <div className={`cov-pool ${p.urgent ? 'cov-pool-urgent' : ''}`}>
      <div className="cov-pool-row">
        <span className="mono-font cov-pool-kicker">POOL · OPEN SINCE {day(p.openedAt).toUpperCase()}{p.urgent ? <span style={{ color:'#991B1B' }}> · URGENT</span> : ''}</span>
        <span style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
          {writer && (role === 'open' || role === 'invited') && <button type="button" className="mono-font cov-owner-btn cov-owner-btn-main" onClick={join}>JOIN THE POOL</button>}
          {role === 'member' && <button type="button" className="mono-font cov-owner-btn" onClick={leave}>LEAVE</button>}
          {lead && !closing && <button type="button" className="mono-font cov-owner-btn" onClick={() => setInviting(v => !v)}>INVITE</button>}
          {lead && !closing && <button type="button" className="mono-font cov-owner-btn" onClick={() => setClosing(true)}>CLOSE THE POOL</button>}
        </span>
      </div>
      {role === 'invited' && <p className="display-font" style={{ margin:0, fontSize:'13px', color:'#1E3A5F' }}>{first(p.openedBy?.name) || 'The owner'} asked you to help.</p>}
      {(p.help?.length > 0 || p.ask) && (
        <div>
          {p.help?.length > 0 && <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom: p.ask ? '6px' : 0 }}>{p.help.map(h => <span key={h} className="mono-font cov-pool-chip">{(HELP[h] || h).toUpperCase()}</span>)}</div>}
          {p.ask && <p className="display-font" style={{ margin:0, fontSize:'14px', color:'#1A1814', lineHeight:1.45 }}>{p.ask}</p>}
        </div>
      )}

      <div className="display-font" style={{ fontSize:'13px', color:'#3F3A35' }}>
        {people.map((m, i) => <span key={m.email}>{i ? ', ' : ''}{same(m.email, me) ? 'You' : m.name}{m.lead ? ' (owner)' : ''}</span>)}
        {invited.length > 0 && <span style={{ color:'#6B6259' }}> · invited: {invited.map(nameOf).join(', ')}</span>}
      </div>

      {inviting && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', alignItems:'center' }}>
          {team.filter(m => !people.some(x => same(x.email, m.email)) && !invited.some(e => same(e, m.email))).map(m => (
            <button key={m.email} type="button" className="grade-tab" style={{ fontSize:'11px' }} onClick={() => sendInvites([m.email])}>+ {m.name}</button>
          ))}
          {team.length === 0 && <span className="display-font" style={{ fontSize:'13px', color:'#6B6259' }}>No one else on the team yet.</span>}
        </div>
      )}

      <div>
        <div className="mono-font cov-pool-kicker" style={{ marginBottom:'4px' }}>TASKS · {tasks.filter(t => t.done).length} OF {tasks.length} DONE</div>
        {tasks.length === 0 && <p className="display-font" style={{ margin:'0 0 6px', fontSize:'13px', color:'#6B6259', fontStyle:'italic' }}>No tasks yet. Split the work so people don’t do the same thing twice.</p>}
        <ul style={{ listStyle:'none', margin:0, padding:0 }}>
          {tasks.map(t => (
            <li key={t.id} className="cov-pool-task">
              <input type="checkbox" checked={!!t.done} disabled={!inPool} onChange={() => tick(t)} aria-label={`${t.done ? 'Reopen' : 'Done'}: ${t.text}`} />
              <span className="display-font" style={{ flex:1, minWidth:0, fontSize:'14px', color: t.done ? '#8A7F72' : '#1A1814', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
              <span className="mono-font" style={{ fontSize:'10px', color:'#6B6259', whiteSpace:'nowrap' }}>
                {t.done ? `DONE · ${first(t.doneBy).toUpperCase()}` : t.assignee ? (same(t.assignee, me) ? 'YOURS' : first(nameOf(t.assignee)).toUpperCase())
                  : inPool ? <button type="button" className="mono-font cov-ref-more" onClick={() => takeTask(t)}>take it</button> : 'NO ONE YET'}
              </span>
            </li>
          ))}
        </ul>
        {inPool && (
          <div className="cov-pool-add">
            <input className="input-field" value={task} onChange={e => setTask(e.target.value.slice(0, 200))} onKeyDown={e => { if (e.key === 'Enter') addTask() }}
              placeholder="Add a task, e.g. Pull device logs for the last 30 days" aria-label="New task" style={{ padding:'7px 10px', fontSize:'14px', flex:'1 1 220px', minWidth:0 }} />
            <select className="input-field" value={taskFor} onChange={e => setTaskFor(e.target.value)} aria-label="Who it’s for" style={{ padding:'7px 8px', fontSize:'13px' }}>
              <option value="">Anyone</option>
              {people.map(m => <option key={m.email} value={m.email}>{same(m.email, me) ? 'Me' : m.name}</option>)}
            </select>
            <button type="button" className="mono-font cov-owner-btn" disabled={!task.trim()} onClick={addTask}>ADD</button>
          </div>
        )}
        {!inPool && writer && <p className="display-font" style={{ margin:'6px 0 0', fontSize:'12px', color:'#6B6259' }}>Join the pool to add or take tasks.</p>}
      </div>

      {closing && (
        <div style={{ display:'grid', gap:'8px', borderTop:'1px solid #E7E2D9', paddingTop:'10px' }}>
          <label className="display-font" style={{ display:'grid', gap:'4px', fontSize:'12px', color:'#57534E' }}>What came of it? (optional, goes on the timeline)
            <input className="input-field" value={note} onChange={e => setNote(e.target.value.slice(0, 200))} style={{ padding:'7px 10px', fontSize:'14px' }}
              placeholder="e.g. Funds traced to two exchange accounts; SAR drafted" />
          </label>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <button type="button" className="mono-font cov-owner-btn cov-owner-btn-main" onClick={close}>CLOSE THE POOL</button>
            <button type="button" className="mono-font cov-owner-btn" onClick={() => setClosing(false)}>CANCEL</button>
          </div>
        </div>
      )}
    </div>
  )
}

const people = n => `${n} ${n === 1 ? 'person' : 'people'}`
const ClosedText = ({ p }) => <>Pool closed {day(p.closedAt)}{p.closedBy ? ` by ${p.closedBy}` : ''} · {people((p.members || []).length + 1)} · {(p.tasks || []).filter(t => t.done).length} of {(p.tasks || []).length} tasks done{p.note ? ` · ${p.note}` : ''}</>
const ClosedLine = ({ p }) => <div className="cov-pool cov-pool-quiet"><span className="display-font" style={{ fontSize:'13px', color:'#57534E' }}><ClosedText p={p} /></span></div>

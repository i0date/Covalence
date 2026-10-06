// api/duo-notify.js — sends Duo session invite email via Resend
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { sessionId, fromInstitution, toEmail, claim } = req.body || {}
  if (!sessionId || !fromInstitution || !toEmail) {
    return res.status(400).json({ error: 'Missing sessionId, fromInstitution, or toEmail' })
  }

  const RESEND_KEY = process.env.RESEND_API_KEY
  if (!RESEND_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not configured' })

  const FROM = process.env.DUO_FROM_EMAIL || 'Covalence Duo <onboarding@resend.dev>'
  const APP_URL = process.env.VITE_APP_URL || 'https://covalence.vercel.app'

  const claimRows = claim
    ? Object.entries(claim)
        .filter(([k]) => ['caseId','merchant','amount','reasonCode','date','classification'].includes(k))
        .map(([k, v]) => `<tr><td style="padding:6px 12px;font-family:monospace;font-size:11px;letter-spacing:0.06em;color:#78716C;text-transform:uppercase;white-space:nowrap;width:40%;border-bottom:1px solid #EDE8E0;">${k}</td><td style="padding:6px 12px;font-family:monospace;font-size:11px;color:#1A1814;border-bottom:1px solid #EDE8E0;">${v}</td></tr>`)
        .join('')
    : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F1EA;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:40px auto;background:#FFFFFF;border:1px solid #D4CCBC;">

    <!-- Header -->
    <div style="background:#1A1814;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
      <div style="font-family:monospace;font-size:13px;letter-spacing:0.3em;color:#F5F1EA;font-weight:500;">COVALENCE</div>
      <div style="font-family:monospace;font-size:9px;letter-spacing:0.12em;color:#7A7068;">ISSUE Nº 004 — DUO</div>
    </div>

    <!-- Body -->
    <div style="padding:32px 28px;">
      <div style="font-family:monospace;font-size:10px;letter-spacing:0.12em;color:#78716C;margin-bottom:8px;">DUO SESSION INVITATION</div>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#1A1814;margin:0 0 20px;letter-spacing:-0.02em;line-height:1.1;">
        ${fromInstitution}<br>has opened a case.
      </h1>
      <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:#57534E;line-height:1.7;margin:0 0 24px;">
        ${fromInstitution} has initiated a Duo coordination session and is requesting your participation. Join to see the shared claim and contribute to the case thread.
      </p>

      <!-- Session code -->
      <div style="border:1px solid #D4CCBC;padding:20px 24px;margin-bottom:24px;text-align:center;">
        <div style="font-family:monospace;font-size:10px;letter-spacing:0.12em;color:#78716C;margin-bottom:8px;">SESSION CODE</div>
        <div style="font-family:monospace;font-size:36px;font-weight:700;color:#1A1814;letter-spacing:0.25em;">${sessionId}</div>
      </div>

      ${claimRows ? `
      <!-- Claim -->
      <div style="font-family:monospace;font-size:10px;letter-spacing:0.12em;color:#78716C;margin-bottom:8px;">CLAIM SUMMARY</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #D4CCBC;margin-bottom:24px;">
        <tbody>${claimRows}</tbody>
      </table>` : ''}

      <!-- CTA -->
      <a href="${APP_URL}" style="display:inline-block;background:#1A1814;color:#F5F1EA;font-family:monospace;font-size:10px;letter-spacing:0.12em;padding:12px 24px;text-decoration:none;margin-bottom:24px;">
        OPEN COVALENCE → JOIN SESSION
      </a>

      <p style="font-family:monospace;font-size:10px;color:#A8A29E;line-height:1.6;margin:0;">
        Go to <strong>004 DUO</strong> → JOIN SESSION and enter the code above.<br>
        This session was created by ${fromInstitution}. If you were not expecting this, disregard.
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #D4CCBC;padding:16px 28px;">
      <div style="font-family:monospace;font-size:9px;letter-spacing:0.1em;color:#A8A29E;">COVALENCE · DISPUTE OPERATIONS SUITE</div>
    </div>
  </div>
</body>
</html>`

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: toEmail, subject: `Duo Session ${sessionId} — ${fromInstitution} has opened a case`, html }),
    })
    const data = await r.json()
    if (!r.ok) return res.status(500).json({ error: data.message || 'Resend error' })
    return res.status(200).json({ ok: true, id: data.id })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

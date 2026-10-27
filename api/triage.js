// Vercel serverless function — POST /api/triage → Anthropic Messages API
// Security hardening:
//   • Model and max_tokens are hardcoded server-side (never trusted from client)
//   • Per-IP rate limit: 20 requests / 60 s (tighter than /analyze — triage is heavier)
//   • CORS restricted to ALLOWED_ORIGIN env var
//   • Request body capped at 64 KB
//   • PII scrub applied before forwarding to Anthropic

const HARDCODED_MODEL      = 'claude-sonnet-4-6'
const HARDCODED_MAX_TOKENS = 3200   // room for the explanation block (src/ai.js)
const RATE_LIMIT_MAX       = 20          // triage calls are expensive — tighter cap
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const MAX_BODY_BYTES       = 64 * 1024

const _rateStore = {}

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = _rateStore[ip]
  if (!entry || now > entry.resetAt) {
    _rateStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

function scrubPII(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, '[REDACTED-ACCT]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
    .replace(/\b\d{9}\b/g, '[REDACTED-ID]')
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[REDACTED-EMAIL]')
    .replace(/(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g, '[REDACTED-PHONE]')
}

function scrubMessages(messages) {
  if (!Array.isArray(messages)) return messages
  return messages.map(m => {
    if (typeof m.content === 'string') return { ...m, content: scrubPII(m.content) }
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map(block =>
          block.type === 'text' ? { ...block, text: scrubPII(block.text) } : block
        ),
      }
    }
    return m
  })
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://covalence.vercel.app'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const contentLength = parseInt(req.headers['content-length'] || '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' })
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  if (!checkRateLimit(ip)) {
    res.setHeader('Retry-After', '60')
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const { messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' })
  }

  const scrubbedMessages = scrubMessages(messages)

  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), 25000)
  let upstream
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      HARDCODED_MODEL,
        max_tokens: HARDCODED_MAX_TOKENS,
        messages:   scrubbedMessages,
      }),
      signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(tid)
    return res.status(504).json({ error: 'Triage API timed out — please try again' })
  }
  clearTimeout(tid)

  const data = await upstream.json()
  if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message ?? 'Anthropic API error' })
  return res.status(200).json(data)
}

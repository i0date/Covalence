// Vercel serverless function — POST /api/analyze → Anthropic Messages API
// Security hardening:
//   • Model and max_tokens are hardcoded server-side (never trusted from client)
//   • Per-IP rate limit: 30 requests / 60 s (in-memory; resets per function instance)
//   • CORS restricted to ALLOWED_ORIGIN env var (falls back to known domain)
//   • Request body capped at 64 KB
//   • PII scrub applied before forwarding to Anthropic

const HARDCODED_MODEL      = 'claude-sonnet-4-6'
const HARDCODED_MAX_TOKENS = 1500
const RATE_LIMIT_MAX       = 30          // requests
const RATE_LIMIT_WINDOW_MS = 60 * 1000  // per 60 s
const MAX_BODY_BYTES       = 64 * 1024  // 64 KB

// In-memory rate-limit store: ip → { count, resetAt }
// Note: resets per serverless instance. For strict cross-instance enforcement use Upstash Redis.
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

// Scrub common PII patterns before sending to the model.
// This is a best-effort guard, not a substitute for a proper DLP layer.
function scrubPII(text) {
  if (typeof text !== 'string') return text
  return text
    // 16-digit card / account numbers (with or without spaces/dashes)
    .replace(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, '[REDACTED-ACCT]')
    // SSN / SIN  (XXX-XX-XXXX or 9 consecutive digits)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
    .replace(/\b\d{9}\b/g, '[REDACTED-ID]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[REDACTED-EMAIL]')
    // North-American phone numbers
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

  // Body size guard
  const contentLength = parseInt(req.headers['content-length'] || '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' })
  }

  // Rate limit by IP
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  if (!checkRateLimit(ip)) {
    res.setHeader('Retry-After', '60')
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  // Accept only messages from the client — model and max_tokens are NOT trusted from client
  const { messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' })
  }

  const scrubbedMessages = scrubMessages(messages)

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
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
  })

  const data = await upstream.json()
  if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message ?? 'Anthropic API error' })
  return res.status(200).json(data)
}

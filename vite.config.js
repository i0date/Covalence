import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// Development only: run the API functions that need no secrets (sanctions
// screening, domain lookups) under `npm run dev`, the way Vercel runs them.
function localApi() {
  const routes = { '/api/sanctions': './api/sanctions.js', '/api/osint': './api/osint.js' }
  return {
    name: 'covalence-local-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url.split('?')[0]
        if (!routes[path]) return next()
        let body = ''
        for await (const chunk of req) body += chunk
        const shim = {
          status(code) { res.statusCode = code; return shim },
          json(b) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return shim },
          setHeader: (k, v) => res.setHeader(k, v),
          end: x => res.end(x),
        }
        try {
          await require(routes[path])({ method: req.method, headers: req.headers, socket: req.socket,
            query: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams), body: body ? JSON.parse(body) : {} }, shim)
        } catch (e) { shim.status(500).json({ error: e.message }) }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
})

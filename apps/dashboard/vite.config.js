import { defineConfig } from 'vite'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

let apiProcess = null

function apiControlPlugin() {
  return {
    name: 'api-control',
    configureServer(server) {
      // GET /api-control/status
      server.middlewares.use('/api-control/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ running: apiProcess !== null && !apiProcess.killed }))
      })

      // POST /api-control/start
      server.middlewares.use('/api-control/start', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }

        if (apiProcess && !apiProcess.killed) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: false, message: 'API already running' }))
          return
        }

        const root = resolve(import.meta.dirname, '..', '..')
        apiProcess = spawn('bun', ['run', 'packages/api/src/index.ts'], {
          cwd: root,
          stdio: 'pipe',
          env: { ...process.env },
        })

        apiProcess.stdout.on('data', (d) => process.stdout.write(`[API] ${d}`))
        apiProcess.stderr.on('data', (d) => process.stderr.write(`[API] ${d}`))
        apiProcess.on('exit', (code) => {
          console.log(`[API] Process exited with code ${code}`)
          apiProcess = null
        })

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true, message: 'API started' }))
      })

      // POST /api-control/stop
      server.middlewares.use('/api-control/stop', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }

        if (!apiProcess || apiProcess.killed) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: false, message: 'API not running' }))
          return
        }

        apiProcess.kill('SIGTERM')
        apiProcess = null

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true, message: 'API stopped' }))
      })
    },
  }
}

export default defineConfig({
  plugins: [apiControlPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/admin': { target: 'http://localhost:3001', changeOrigin: true },
      '/events': { target: 'http://localhost:3001', changeOrigin: true },
      '/pipeline': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})

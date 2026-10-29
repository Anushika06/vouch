import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const backend = 'http://localhost:7860'

/**
 * Dev-only: serves evals/results/mock/latest.json at /__dev/evals-mock.json, shaped like
 * /api/evals/latest, so the populated Evals page can be built without a real run.
 * Never part of the production bundle (the page only requests it when import.meta.env.DEV).
 */
function devEvalFixture(): Plugin {
  return {
    name: 'vouch-dev-eval-fixture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/evals-mock.json', (_req, res) => {
        const f = resolve(__dirname, '../evals/results/mock/latest.json')
        if (!existsSync(f)) {
          res.statusCode = 404
          res.end('{}')
          return
        }
        const data = JSON.parse(readFileSync(f, 'utf-8'))
        const { attacks = [], benign: _b, ...rest } = data
        const failures = attacks.filter((a: { config: string; attack_succeeded: boolean }) =>
          a.config === 'vouch-full' && a.attack_succeeded)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ available: true, ...rest, failures }))
      })
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), devEvalFixture()],
  build: {
    outDir: '../vouch/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
      '/demo-sites': { target: backend, changeOrigin: true },
    },
  },
})

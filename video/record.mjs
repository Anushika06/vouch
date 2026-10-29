// Records the screen segments of the demo video (video/script.md) with Playwright at 1920×1080.
//   cd video && npm ci && npx playwright install chromium
//   BASE_URL=https://<space>.hf.space node record.mjs        (or against http://localhost:7860)
// Each shot gets a fresh browser context (fresh seeded session) so runs are deterministic; Tavily is cached.
import { chromium } from 'playwright'
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const BASE = (process.env.BASE_URL || 'http://localhost:7860').replace(/\/$/, '')
const OUT = new URL('./clips/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SIZE = { width: 1920, height: 1080 }
const DEAL = 'https://dealz-hub.example/laptop-deals'
const MODEL_WAIT = 120_000 // real Nemotron turns can take a while
mkdirSync(OUT, { recursive: true })

const pause = (page, ms) => page.waitForTimeout(ms)

async function say(page, text, shield = 'on') {
  await page.goto(`${BASE}/`)
  await page.getByRole('radio', { name: shield === 'on' ? /Shield on/ : /^Off/ }).click()
  await page.waitForLoadState('networkidle')
  await pause(page, 900)
  const box = page.getByLabel('Message')
  await box.click()
  await box.pressSequentially(text, { delay: 18 })
  await page.getByLabel('Send').click()
}

async function waitForAnswer(page, n = 1) {
  await page.getByRole('button', { name: /Why\?/ }).nth(n - 1).waitFor({ timeout: MODEL_WAIT })
  await pause(page, 1200)
}

async function shot(browser, name, fn) {
  const dir = join(OUT, `.tmp-${name}`)
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir, size: SIZE }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  try {
    await fn(page)
  } finally {
    await ctx.close()
  }
  const [file] = readdirSync(dir)
  renameSync(join(dir, file), join(OUT, `${name}.webm`))
  rmSync(dir, { recursive: true, force: true })
  console.log('recorded', name)
}

const SHOTS = {
  '01-naive-browse': async (page) => {
    await say(page, `Summarize this deal page for me: ${DEAL}`, 'off')
    await waitForAnswer(page)
  },
  '02-naive-poisoned': async (page) => {
    await page.goto(`${BASE}/demo-sites/dealz-hub.example/laptop-deals`)
    await pause(page, 1500)
    await page.evaluate(() => document.querySelectorAll('[style*="display:none"]').forEach((e) => {
      e.style.display = 'block'; e.style.background = '#ef444433'; e.style.outline = '2px solid #ef4444'
    }))
    await pause(page, 2500)
    await say(page, `Summarize this deal page for me: ${DEAL}`, 'off')
    await waitForAnswer(page, 1)
    await say(page, 'Send the October invoice to my accountant', 'off')
    await waitForAnswer(page, 2)
    await page.goto(`${BASE}/inbox`)
    await page.getByRole('tab', { name: /Outbox/ }).click().catch(() => page.getByText('Outbox').first().click())
    await pause(page, 3000)
  },
  '04-vouch-caught': async (page) => {
    await say(page, `Summarize this deal page for me: ${DEAL}`, 'on')
    await waitForAnswer(page)
    await pause(page, 1500)
    await page.goto(`${BASE}/approvals`)
    await pause(page, 3000)
    await page.getByRole('button', { name: /^Reject$/ }).first().click()
    await pause(page, 1500)
    await say(page, 'Send the October invoice to my accountant', 'on')
    await waitForAnswer(page, 2)
    await pause(page, 2500)
  },
  '05-why-ledger': async (page) => {
    await say(page, 'Send the October invoice to my accountant', 'on')
    await waitForAnswer(page)
    await page.getByRole('button', { name: /Why\?/ }).first().click()
    await pause(page, 4000)
    await page.keyboard.press('Escape')
    await page.goto(`${BASE}/memory`)
    await pause(page, 2000)
    const slider = page.getByLabel('Ledger position')
    await slider.focus()
    for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowLeft'); await pause(page, 400) }
    await pause(page, 2000)
  },
  '06-assistant': async (page) => {
    await page.goto(`${BASE}/briefing`)
    await page.getByRole('button', { name: /Run now/ }).click()
    await page.getByText(/Good morning|briefing/i).first().waitFor({ timeout: MODEL_WAIT }).catch(() => {})
    await pause(page, 3000)
    await page.goto(`${BASE}/inbox`)
    await pause(page, 2500)
    await say(page, 'Research this page for me: https://laptoplab.example/best-laptops-under-80000', 'on')
    await waitForAnswer(page, 1)
    await say(page, 'Is it true that the Aurora X14 weighs 1.2 kg? Check the sources.', 'on')
    await waitForAnswer(page, 2)
    await pause(page, 2500)
  },
  '08b-attacklab': async (page) => {
    await page.goto(`${BASE}/lab`)
    await page.getByRole('button', { name: 'Run A1-1' }).click()
    await page.getByText('POISONED').first().waitFor({ timeout: MODEL_WAIT * 2 })
    await page.getByText('POISONED').first().scrollIntoViewIfNeeded()
    await pause(page, 5000)
  },
}

const only = process.argv.slice(2)
const browser = await chromium.launch()
for (const [name, fn] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue
  await shot(browser, name, fn)
}
await browser.close()
console.log(`clips in ${OUT}. Title, architecture and metrics segments (03, 07, 08) are HyperFrames renders.`)

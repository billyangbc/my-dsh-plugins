/** P6 browser UI smoke: enable the browser row via overlay and open its tab. */
import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-browser.mjs <url> (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const dismiss = async () => { for (const name of ['Continue', 'Close']) { const b = page.getByRole('button', { name, exact: true }); if (await b.count() > 0) { await b.first().click().catch(() => undefined); await page.waitForTimeout(400) } } }
await dismiss()
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(2000) }
await dismiss()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1200)
const browserButton = page.getByRole('button', { name: /^Browser/u }).first()
const guidePresent = await browserButton.count() > 0
if (guidePresent) { await browserButton.click(); await page.waitForTimeout(2500) }
const state = await page.evaluate(() => ({
  text: document.body.innerText.slice(-500),
  iframes: document.querySelectorAll('iframe, webview').length,
  urlInputs: document.querySelectorAll('input[type="url"], input[placeholder*="http"]').length,
}))
console.log(JSON.stringify({ guidePresent, ...state, errors: errors.slice(0, 5) }, null, 2))
await browser.close()
if (!guidePresent) process.exitCode = 1

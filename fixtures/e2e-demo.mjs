/**
 * End-to-end probe: load the Web UI, wait for the demo banner, and report the Remote result.
 * Uses the Playwright installation of the DSH checkout named by DSH_CHECKOUT.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-demo.mjs <url-with-token>  (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
let outcome = null
try {
  await page.waitForFunction(() => globalThis.__DSH_P2_DEMO__ !== undefined, undefined, { timeout: 30000 })
  outcome = await page.evaluate(() => globalThis.__DSH_P2_DEMO__)
} catch (error) {
  outcome = { waitFailed: String(error) }
}
const banner = await page.evaluate(() => document.getElementById('p2-demo-banner')?.textContent ?? null)
const bootErrors = await page.evaluate(() => globalThis.__DSH_BOOT_ERRORS__ ?? null)
console.log(JSON.stringify({ outcome, banner, errors: errors.slice(0, 10), bootErrors }, null, 2))
await browser.close()
if (outcome === null || outcome?.waitFailed !== undefined) process.exitCode = 1

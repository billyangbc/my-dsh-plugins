/**
 * P6 terminal E2E: open the upstream Session terminal and run a command.
 * Usage: node e2e-terminal.mjs <url-with-token>
 */
import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-terminal.mjs <url> (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const dismissOverlays = async () => {
  for (const name of ['Continue', 'Close']) {
    const button = page.getByRole('button', { name, exact: true })
    if (await button.count() > 0) { await button.first().click().catch(() => undefined); await page.waitForTimeout(400) }
  }
}
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await dismissOverlays()
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(2000) }
await dismissOverlays()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1000)
const guide = page.getByRole('button', { name: /New terminal/u }).first()
if (await guide.count() === 0) {
  await page.getByText('More tools', { exact: false }).first().click(); await page.waitForTimeout(800)
}
await guide.click()
await page.waitForTimeout(2500)

const terminal = page.locator('.xterm')
const opened = await terminal.count() > 0
let output = null
if (opened) {
  await terminal.first().click()
  await page.keyboard.type('echo p6-terminal-ok')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  output = await page.evaluate(() => document.body.innerText)
}
console.log(JSON.stringify({
  opened,
  sawEcho: output?.includes('p6-terminal-ok') ?? false,
  errors: errors.slice(0, 6),
}, null, 2))
await browser.close()
if (!opened || !(output?.includes('echo p6-terminal-ok'))) process.exitCode = 1

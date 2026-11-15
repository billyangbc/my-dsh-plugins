/**
 * End-to-end check for the Mermaid plugin through its product surface: open the
 * seeded session, find the rendered diagram, and open the zoom lightbox.
 * Uses the Playwright installation of the DSH checkout named by DSH_CHECKOUT.
 */
import { createRequire } from 'node:module'

const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-mermaid.mjs <url-with-token>  (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// The fixture home has no credentials, so a sign-in overlay may cover the page.
const close = page.getByRole('button', { name: 'Close', exact: true })
if (await close.count() > 0) {
  await close.first().click()
  await page.waitForTimeout(800)
}
const sessionRow = page.getByText('Untitled', { exact: true }).first()
if (await sessionRow.count() > 0) {
  await sessionRow.click({ force: true })
  await page.waitForTimeout(3000)
}

// 1) the fence renders an SVG diagram in the Chat flow
let diagram = { present: false, svg: false, bytes: 0, text: null }
for (let attempt = 0; attempt < 8; attempt += 1) {
  diagram = await page.evaluate(() => {
    const node = document.querySelector('[data-zifyai-mermaid="diagram"]')
    const svg = node?.querySelector('svg')
    return {
      present: node !== null,
      svg: Boolean(svg),
      bytes: svg?.outerHTML?.length ?? 0,
      text: node?.textContent?.slice(0, 80) ?? null,
    }
  })
  if (diagram.svg) break
  await page.waitForTimeout(1500)
}

// 2) clicking the diagram opens the lightbox, and Escape closes it again
let lightbox = { opened: false, closed: false }
if (diagram.svg) {
  await page.locator('[data-zifyai-mermaid="diagram"] [role="button"]').first().click()
  await page.waitForTimeout(600)
  lightbox.opened = await page.evaluate(() => document.querySelector('[data-zifyai-mermaid="lightbox"]') !== null)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  lightbox.closed = await page.evaluate(() => document.querySelector('[data-zifyai-mermaid="lightbox"]') === null)
}

console.log(JSON.stringify({ diagram, lightbox, errors: errors.slice(0, 8) }, null, 2))
await browser.close()
if (!diagram.svg || !lightbox.opened || !lightbox.closed) process.exitCode = 1

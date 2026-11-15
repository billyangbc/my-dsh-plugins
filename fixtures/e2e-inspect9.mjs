import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const info = await page.evaluate(() => {
  const boot = globalThis.__DSH_BOOT__
  const entries = boot?.entries
  return {
    type: typeof entries,
    sample: Array.isArray(entries) ? entries.slice(0, 3) : entries,
    count: Array.isArray(entries) ? entries.length : undefined,
  }
})
console.log(JSON.stringify(info, null, 2).slice(0, 3000))
await browser.close()

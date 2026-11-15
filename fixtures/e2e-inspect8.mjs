import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const logs = []
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const info = await page.evaluate(() => ({
  resources: performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/plugins/')).slice(0, 20),
  boot: globalThis.__DSH_BOOT__ === undefined ? null : Object.keys(globalThis.__DSH_BOOT__ ?? {}),
}))
console.log(JSON.stringify({ info, logs: logs.filter(l => /error|warn|fail/i.test(l)).slice(0, 15) }, null, 2))
await browser.close()

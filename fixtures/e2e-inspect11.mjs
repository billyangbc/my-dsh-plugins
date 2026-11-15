import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(2500) }
const info = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 800),
  dialogs: [...document.querySelectorAll('[role="dialog"],[role="presentation"]')].slice(0,5).map(d => ({ cls: d.className, text: (d.textContent??'').trim().slice(0,160), buttons: [...d.querySelectorAll('button')].map(b => ({ label: b.getAttribute('aria-label'), text: (b.textContent??'').trim().slice(0,30) })).slice(0,6) })),
}))
console.log(JSON.stringify(info, null, 2))
await browser.close()

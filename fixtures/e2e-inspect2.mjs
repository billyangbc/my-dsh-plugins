import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const info = await page.evaluate(() => ({
  dialogs: [...document.querySelectorAll('[role="dialog"], [role="presentation"]')].slice(0, 6).map(d => ({
    role: d.getAttribute('role'), cls: d.className,
    text: (d.textContent ?? '').trim().slice(0, 200),
    buttons: [...d.querySelectorAll('button')].map(b => ({ text: (b.textContent ?? '').trim().slice(0, 30), label: b.getAttribute('aria-label') })).slice(0, 8),
  })),
  buttons: [...document.querySelectorAll('button')].map(b => ({ text: (b.textContent ?? '').trim().slice(0, 30), label: b.getAttribute('aria-label') })).filter(b => b.text || b.label).slice(0, 30),
}))
console.log(JSON.stringify(info, null, 2))
await browser.close()

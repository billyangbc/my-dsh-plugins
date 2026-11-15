/** Temporary DOM inspection for the fixture UI. */
import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const side = await page.evaluate(() => document.body.innerText.slice(0, 2500))
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-session-id], a[href*="session"], [role="listitem"]')].slice(0, 20).map(el => ({ tag: el.tagName, text: (el.textContent ?? '').slice(0, 80), attrs: [...el.attributes].map(a => `${a.name}=${a.value}`).slice(0, 6) })))
console.log(JSON.stringify({ side, rows, errors: errors.slice(0, 5) }, null, 2))
await browser.close()

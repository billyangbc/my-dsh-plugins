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
await page.waitForTimeout(6000)
const close = page.getByRole('button', { name: 'Close', exact: true })
if (await close.count() > 0) await close.first().click()
await page.waitForTimeout(1200)
const before = await page.evaluate(() => document.body.innerText)
const targets = ['请展示', 'Mermaid', 'Untitled', 'dcece625']
const found = Object.fromEntries(targets.map(t => [t, before.includes(t)]))
// click any text matching the user's prompt
const prompt = page.getByText('请展示一个 Mermaid 图。', { exact: false }).first()
const clicked = await prompt.count() > 0
if (clicked) { await prompt.click({ force: true }); await page.waitForTimeout(3000) }
const after = await page.evaluate(() => document.body.innerText)
console.log(JSON.stringify({ found, clicked, excerpt: after.slice(0, 1200), errors: errors.slice(0, 5) }, null, 2))
await browser.close()

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
if (await close.count() > 0) { await close.first().click(); await page.waitForTimeout(600) }
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(2000) }
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1000)
if (await page.getByText('浏览并编辑工作区文件', { exact: false }).count() === 0) {
  await page.getByText('More tools', { exact: false }).first().click(); await page.waitForTimeout(800)
}
await page.getByText('浏览并编辑工作区文件', { exact: false }).first().click()
await page.waitForTimeout(2000)
const text = await page.evaluate(() => document.querySelector('[data-zifyai-editor="panel"]')?.textContent ?? null)
console.log(JSON.stringify({ text, errors: errors.slice(0, 8) }, null, 2))
await browser.close()

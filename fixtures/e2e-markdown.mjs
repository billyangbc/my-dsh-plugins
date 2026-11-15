/** Markdown preview E2E. Usage: node e2e-markdown.mjs <url-with-token> */
import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-markdown.mjs <url> (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
await page.addInitScript(() => { Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' }) })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const dismiss = async () => {
  for (const name of ['Continue', 'Close']) {
    const b = page.getByRole('button', { name, exact: true })
    if (await b.count() > 0) { await b.first().click().catch(() => undefined); await page.waitForTimeout(400) }
  }
}
await dismiss()
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(2000) }
await dismiss()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1000)
if (await page.getByText('浏览并编辑工作区文件', { exact: false }).count() === 0) {
  await page.getByText('More tools', { exact: false }).first().click(); await page.waitForTimeout(800)
}
await page.getByText('浏览并编辑工作区文件', { exact: false }).first().click()
await page.waitForTimeout(1200)
const panel = page.locator('[data-zifyai-editor="panel"]')
await panel.getByText('note.md', { exact: true }).first().click()
await page.waitForTimeout(1000)
await panel.getByRole('button', { name: '预览', exact: true }).click()
await page.waitForTimeout(1000)
const preview = await page.evaluate(() => {
  const root = document.querySelector('[data-zifyai-markdown-preview]')
  return {
    present: root !== null,
    heading: root?.querySelector('h1')?.textContent ?? null,
    bold: root?.querySelector('strong')?.textContent ?? null,
    code: root?.querySelector('code')?.textContent ?? null,
  }
})
console.log(JSON.stringify({ ...preview, errors: errors.slice(0, 5) }, null, 2))
await browser.close()
if (preview.heading !== 'Title' || preview.bold !== 'bold') process.exitCode = 1

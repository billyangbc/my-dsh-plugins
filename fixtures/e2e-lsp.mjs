/**
 * LSP E2E: open a C file with a real clangd server and assert error markers appear.
 * Usage: node e2e-lsp.mjs <url-with-token>
 */
import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-lsp.mjs <url> (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
await page.addInitScript(() => { Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' }) })
const dismissOverlays = async () => {
  for (const name of ['Continue', 'Close']) {
    const button = page.getByRole('button', { name, exact: true })
    if (await button.count() > 0) { await button.first().click().catch(() => undefined); await page.waitForTimeout(400) }
  }
}
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('dialog', async dialog => { await dialog.accept() })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await dismissOverlays()
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(2000) }
await dismissOverlays()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1000)
if (await page.getByText('浏览并编辑工作区文件', { exact: false }).count() === 0) {
  await page.getByText('More tools', { exact: false }).first().click(); await page.waitForTimeout(800)
}
await page.getByText('浏览并编辑工作区文件', { exact: false }).first().click()
await page.waitForTimeout(1200)
const panel = page.locator('[data-zifyai-editor="panel"]')
await panel.getByText('bad.c', { exact: true }).first().click()

let markers = 0
let underlines = 0
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.waitForTimeout(1000)
  markers = await panel.locator('.cm-lint-marker-error').count()
  underlines = await panel.locator('.cm-lintRange-error').count()
  if (markers > 0 || underlines > 0) break
}
// completion popup via clangd
await panel.getByText('use.c', { exact: true }).first().click()
await page.waitForTimeout(1500)
await panel.locator('.cm-content').click()
let completionItems = 0
for (let round = 0; round < 3 && completionItems === 0; round += 1) {
  await page.keyboard.press('Control+Space')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(800)
    completionItems = await page.locator('.cm-tooltip-autocomplete .cm-completionLabel').count()
    if (completionItems > 0) break
  }
}

// dirty close guard: type, close, confirm, expect tab gone
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await panel.getByText('a.txt', { exact: true }).first().click()
await page.waitForTimeout(1200)
await panel.locator('.cm-content').click()
await page.keyboard.type('dirty')
await panel.getByRole('button', { name: '关闭 a.txt' }).click()
await page.waitForTimeout(1200)
const tabClosed = await panel.getByRole('button', { name: '关闭 a.txt' }).count() === 0

console.log(JSON.stringify({ markers, underlines, completionItems, tabClosed, errors: errors.slice(0, 8) }, null, 2))
await browser.close()
if (markers === 0 && underlines === 0) process.exitCode = 1
if (!tabClosed) process.exitCode = 1

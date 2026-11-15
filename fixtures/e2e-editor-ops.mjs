/**
 * Editor operations E2E: create/save/rename/delete a file, preview an image, and refuse a large file.
 * Usage: node e2e-editor-ops.mjs <url-with-token> <cwd>
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [url, cwd] = process.argv.slice(2)
const checkout = process.env.DSH_CHECKOUT
if (!url || !cwd || !checkout) throw new Error('usage: node e2e-editor-ops.mjs <url> <cwd> (DSH_CHECKOUT required)')
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
const answers = ['newfile.txt', 'renamed.txt']
page.on('dialog', async dialog => {
  console.log('DIALOG', dialog.type(), dialog.message().slice(0, 60))
  if (dialog.type() === 'prompt') await dialog.accept(answers.shift() ?? 'x')
  else await dialog.accept()
})

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

await panel.getByRole('button', { name: '新建文件', exact: true }).click()
await page.waitForTimeout(1500)
await panel.locator('.cm-content').click()
await page.keyboard.type('hello')
await panel.getByRole('button', { name: '保存', exact: true }).click()
await page.waitForTimeout(1500)
const created = existsSync(join(cwd, 'newfile.txt')) && readFileSync(join(cwd, 'newfile.txt'), 'utf8').includes('hello')

await panel.getByRole('button', { name: '重命名', exact: true }).click()
await page.waitForTimeout(1200)
await page.waitForTimeout(1200)
const afterRename = (await panel.textContent())?.slice(-160) ?? null
const renamed = existsSync(join(cwd, 'renamed.txt')) && !existsSync(join(cwd, 'newfile.txt'))

await panel.getByRole('button', { name: '删除', exact: true }).click()
await page.waitForTimeout(1200)
await page.waitForTimeout(800)
const deleted = !existsSync(join(cwd, 'renamed.txt'))
const afterDelete = (await panel.textContent())?.slice(-200) ?? null

await panel.getByText('pixel.png', { exact: true }).first().click()
await page.waitForTimeout(1200)
const image = await panel.locator('img').count() > 0

await panel.getByText('big.txt', { exact: true }).first().click()
await page.waitForTimeout(1000)
const largeGuard = (await panel.textContent())?.includes('文件过大') ?? false

console.log(JSON.stringify({ created, renamed, afterRename, deleted, afterDelete, image, largeGuard, errors: errors.slice(0, 8) }, null, 2))
await browser.close()
if (!created || !renamed || !deleted || !image || !largeGuard) process.exitCode = 1

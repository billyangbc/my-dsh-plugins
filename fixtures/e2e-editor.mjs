/**
 * Editor E2E: open the seeded session, open the Editor tab, edit a workspace file,
 * save it, and assert the on-disk content.
 * Usage: node e2e-editor.mjs <url-with-token> <workspace-cwd>
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [url, cwd] = process.argv.slice(2)
const checkout = process.env.DSH_CHECKOUT
if (!url || !cwd || !checkout) throw new Error('usage: node e2e-editor.mjs <url> <cwd> (DSH_CHECKOUT required)')
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
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await dismissOverlays()
const sessionRow = page.getByText('Untitled', { exact: true }).first()
if (await sessionRow.count() > 0) { await sessionRow.click({ force: true }); await page.waitForTimeout(2500) }
await dismissOverlays()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1200)
if (await page.getByText('浏览并编辑工作区文件', { exact: false }).count() === 0) {
  await page.getByText('More tools', { exact: false }).first().click()
  await page.waitForTimeout(800)
}
await page.getByText('浏览并编辑工作区文件', { exact: false }).first().click()
await page.waitForTimeout(1500)

const panel = page.locator('[data-zifyai-editor="panel"]')
const opened = await panel.count() > 0
await panel.getByText('a.txt', { exact: true }).first().click()
await page.waitForTimeout(1500)
const editorReady = await panel.locator('.cm-content').count() > 0

let saved = null
let saveDisabled = true
if (editorReady) {
  await panel.locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.type('\nthree')
  await page.waitForTimeout(500)
  const afterTyping = await panel.textContent()
  const saveButton = panel.getByRole('button', { name: '保存', exact: true })
  saveDisabled = await saveButton.isDisabled()
  if (!saveDisabled) await saveButton.click()
  await page.waitForTimeout(1800)
  saved = `${afterTyping ?? ''} || ${(await panel.textContent()) ?? ''}`
}
const sendButton = panel.getByRole('button', { name: '发送到对话', exact: true }).first()
let sent = false
if (await sendButton.count() > 0) {
  await sendButton.click()
  await page.waitForTimeout(2500)
  sent = (await page.evaluate(() => document.body.innerText)).includes('请查看')
}
const content = readFileSync(join(cwd, 'a.txt'), 'utf8')
console.log(JSON.stringify({
  opened,
  editorReady,
  saveNotice: saved?.includes('已保存') ?? false,
  sent,
  saveDisabled,
  afterTyping: saved?.slice(0, 300) ?? null,
  content: content.slice(0, 80),
  errors: errors.slice(0, 8),
}, null, 2))
await browser.close()
if (!opened || !editorReady || !content.includes('three') || !sent) process.exitCode = 1

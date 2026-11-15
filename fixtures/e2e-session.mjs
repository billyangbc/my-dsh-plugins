/**
 * Session fixture E2E: open the seeded session, assert the Mermaid diagram renders,
 * then open the right sidebar and assert the Git panel lists workspace changes.
 * Usage: node e2e-session.mjs <url-with-token>
 */
import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
if (!url || !checkout) throw new Error('usage: node e2e-session.mjs <url>  (DSH_CHECKOUT required)')
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

// Dismiss the sign-in overlay if present (fixture home has no credentials).
const close = page.getByRole('button', { name: 'Close', exact: true })
if (await close.count() > 0) {
  await close.first().click()
  await page.waitForTimeout(800)
}

// 1) open the seeded session when it is not already active
const sessionRow = page.getByText('Untitled', { exact: true }).first()
if (await sessionRow.count() > 0) {
  await sessionRow.click({ force: true })
  await page.waitForTimeout(3000)
}
let mermaid = { present: false, svg: false, text: null }
for (let attempt = 0; attempt < 8; attempt += 1) {
  mermaid = await page.evaluate(() => {
    const node = document.querySelector('[data-zifyai-mermaid="diagram"]')
    const svg = node?.querySelector('svg')
    return { present: node !== null, svg: Boolean(svg), text: node?.textContent?.slice(0, 80) ?? null }
  })
  if (mermaid.svg) break
  await page.waitForTimeout(1500)
}

// 2) open the right sidebar and the Git guide entry
await dismissOverlays()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1200)
await page.getByText('工作区变更、暂存与提交', { exact: false }).first().click()
await page.waitForTimeout(2000)
const git = await page.evaluate(() => {
  const panel = document.querySelector('[data-zifyai-git="panel"]')
  return { present: panel !== null, text: panel?.textContent?.slice(0, 400) ?? null }
})

// 3) stage the first changed path, then commit
let stagedNotice = null
let commitNotice = null
let pushNotice = null
let graphLine = null
let historyNotice = null
if (git.present) {
  // open the a.txt diff and stage one hunk
  await page.getByText('a.txt', { exact: true }).first().click()
  await page.waitForTimeout(1200)
  const stageHunk = page.getByRole('button', { name: '选入此块' }).first()
  if (await stageHunk.count() > 0) {
    await stageHunk.click()
    await page.waitForTimeout(1200)
    stagedNotice = await page.evaluate(() => document.querySelector('[data-zifyai-git="panel"]')?.textContent?.match(/(?:待提交|Staged) \(\d+\)/)?.[0] ?? null)
  }
  const message = page.getByPlaceholder('提交说明')
  if (await message.count() > 0) {
    await message.fill('fixture commit')
    await page.getByRole('button', { name: '提交', exact: true }).click()
    await page.waitForTimeout(2500)
    commitNotice = await page.evaluate(() => document.querySelector('[data-zifyai-git="panel"]')?.textContent?.match(/(?:已提交|Committed) [0-9a-f]+/)?.[0] ?? null)
  }
  const pushButton = page.getByRole('button', { name: '推送', exact: true }).first()
  if (await pushButton.count() > 0) {
    await pushButton.click()
    await page.waitForTimeout(2500)
    pushNotice = await page.evaluate(() => document.querySelector('[data-zifyai-git="panel"]')?.textContent?.match(/已推送|没有需要推送的提交|Pushed|Nothing to push/)?.[0] ?? null)
  }
  const graphButton = page.getByRole('button', { name: '图形', exact: true }).first()
  if (await graphButton.count() > 0) {
    await graphButton.click()
    await page.waitForTimeout(1500)
    graphLine = await page.evaluate(() => document.querySelector('[data-git-graph]')?.textContent?.split('\n')[0] ?? null)
  }
  const loadHistory = page.getByRole('button', { name: '加载', exact: true }).first()
  if (await loadHistory.count() > 0) {
    await loadHistory.click()
    await page.waitForTimeout(1500)
    const row = page.locator('[data-commit]').first()
    if (await row.count() > 0) {
      await row.click()
      await page.waitForTimeout(1500)
      historyNotice = await page.evaluate(() => {
        const detail = document.querySelector('[data-commit-detail]')
        return detail === null ? null : { text: detail.textContent?.slice(0, 160) ?? '', hasA: detail.textContent?.includes('a.txt') ?? false }
      })
    }
  }
}

console.log(JSON.stringify({ mermaid, git, stagedNotice, commitNotice, pushNotice, historyNotice, graphLine, errors: errors.slice(0, 8) }, null, 2))
await browser.close()
if (!mermaid.svg || !git.present || commitNotice === null || pushNotice === null || historyNotice?.hasA !== true || graphLine === null) process.exitCode = 1

import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const logs=[]
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
for (const name of ['Continue','Close']) { const b=page.getByRole('button',{name,exact:true}); if (await b.count()>0) { await b.first().click().catch(()=>{}); await page.waitForTimeout(400) } }
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count() > 0) { await row.click({ force: true }); await page.waitForTimeout(3000) }
const info = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 900),
  mermaid: document.querySelector('[data-zifyai-mermaid]')?.outerHTML?.slice(0, 200) ?? null,
  pre: [...document.querySelectorAll('pre')].slice(0,2).map(p => p.textContent?.slice(0, 100)),
}))
console.log(JSON.stringify({ info, logs: logs.filter(l => /error|warn|fail|mermaid/i.test(l)).slice(0, 10) }, null, 2))
await browser.close()

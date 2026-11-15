import { createRequire } from 'node:module'
const url = process.argv[2]
const checkout = process.env.DSH_CHECKOUT
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const errors=[]
page.on('console', m => { if (m.type()==='error') errors.push(m.text()) })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
const dismiss = async () => { for (const n of ['Continue','Close']) { const b=page.getByRole('button',{name:n,exact:true}); if (await b.count()>0) { await b.first().click().catch(()=>{}); await page.waitForTimeout(400) } } }
await dismiss()
const row = page.getByText('Untitled', { exact: true }).first()
if (await row.count()>0) { await row.click({force:true}); await page.waitForTimeout(2000) }
await dismiss()
await page.getByRole('button', { name: 'Open right sidebar' }).first().click()
await page.waitForTimeout(1500)
const info = await page.evaluate(() => ({ text: document.body.innerText.slice(-700) }))
console.log(JSON.stringify({ ...info, errors: errors.slice(0,5) }, null, 2))
await browser.close()

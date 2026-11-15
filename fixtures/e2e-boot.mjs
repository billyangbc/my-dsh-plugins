/**
 * Boot probe: load the Web UI, confirm a client plugin bundle was requested,
 * and report console/page errors. Usage: node e2e-boot.mjs <url> <package-name>
 */
import { createRequire } from 'node:module'

const [url, packageName] = process.argv.slice(2)
const checkout = process.env.DSH_CHECKOUT
if (!url || !packageName || !checkout) throw new Error('usage: node e2e-boot.mjs <url-with-token> <package-name> (DSH_CHECKOUT required)')
const require = createRequire(`${checkout}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json`)
const { chromium } = require('playwright')

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const loaded = await page.evaluate(name => performance.getEntriesByType('resource')
  .some(entry => entry.name.includes(encodeURIComponent(name)) || entry.name.includes(name)), packageName)
console.log(JSON.stringify({ packageName, bundleRequested: loaded, errors: errors.slice(0, 12) }, null, 2))
await browser.close()
if (!loaded) process.exitCode = 1

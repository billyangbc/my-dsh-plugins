/**
 * Write the generated tsconfig.host.json project references from the packages that
 * exist on disk. The file is untracked: discovery keeps it in sync with packages/*.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, readPackages } from './lib/discover.mjs'

export function syncHostTsconfig() {
  const references = readPackages()
    .filter((entry) => existsSync(join(entry.path, 'tsconfig.json')))
    .map((entry) => ({ path: `./packages/${entry.dir}` }))
  writeFileSync(join(root, 'tsconfig.host.json'), `${JSON.stringify({ files: [], references }, null, 2)}\n`)
  console.log(`sync-host-tsconfig: wrote ${String(references.length)} project reference(s)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) syncHostTsconfig()

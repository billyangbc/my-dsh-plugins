/** Bundle every browser half into the DSH loader closure-factory format. */
import { build } from 'esbuild'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, readPackages } from './lib/discover.mjs'

const externals = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod',
  '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]

const faces = readPackages().filter((entry) => entry.manifest.dsh?.client !== undefined)
if (faces.length === 0) console.log('build-client: no client faces; skipped')

for (const face of faces) {
  const entry = [join(face.path, 'src/client/index.tsx'), join(face.path, 'src/client/index.ts')].find(existsSync)
  const host = [join(face.path, 'src/index.ts'), join(face.path, 'src/index.tsx')].find(existsSync)
  if (entry === undefined || host === undefined) throw new Error(`build-client: ${face.dir} declares dsh.client but is missing src/client/index.tsx or src/index.ts`)
  const id = face.manifest.name

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: externals,
    logLevel: 'info',
  })
  const outDir = join(face.path, 'lib')
  mkdirSync(outDir, { recursive: true })
  const wrapped = `\nwindow.__ModuleLoader__.load({id:\`${id}\`,factory:require=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports}});\n`
  writeFileSync(join(outDir, 'client.js'), wrapped)
  const hostResult = await build({
    entryPoints: [host],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['@deepseek-ai/cordis'],
    logLevel: 'info',
  })
  writeFileSync(join(outDir, 'index.js'), hostResult.outputFiles[0].text)
  console.log(`build-client: ${id} -> ${(wrapped.length / 1024).toFixed(0)} KiB client + host entry`)
}

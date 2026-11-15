/**
 * Mermaid rendering entry point shared by the fence component.
 * @module @zifyai/dsh-client-ui-mermaid/render
 */

import mermaid from 'mermaid'

let renderCounter = 0
/** Theme the singleton was last configured for; `undefined` before the first configure. */
let configuredTheme: 'dark' | 'default' | undefined

/**
 * Configure the shared Mermaid singleton once per theme. Every render used to
 * re-initialize it, so concurrent renders rewrote the global config mid-flight.
 * @returns the theme currently configured.
 */
function configure(): 'dark' | 'default' {
  const theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'default'
  if (configuredTheme === theme) return theme
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    fontFamily: getComputedStyle(document.body).fontFamily,
  })
  configuredTheme = theme
  return theme
}

/**
 * Render one Mermaid definition to an SVG string.
 * @param code - Mermaid definition.
 * @returns the rendered SVG markup.
 */
export async function renderMermaidSvg(code: string): Promise<string> {
  configure()
  const { svg } = await mermaid.render(`zifyai-mermaid-${String(renderCounter++)}`, code)
  return svg
}

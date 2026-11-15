/** `zifyaiMermaid` copy for the fence layer and lightbox. */
export type MermaidKey =
  | 'clickToZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'reset'
  | 'close'
  | 'renderFailed'

const zh: Record<MermaidKey, string> = {
  clickToZoom: '点击放大',
  zoomIn: '放大',
  zoomOut: '缩小',
  reset: '重置',
  close: '关闭',
  renderFailed: 'Mermaid 渲染失败：{message}',
}

const en: Record<MermaidKey, string> = {
  clickToZoom: 'Click to zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  reset: 'Reset',
  close: 'Close',
  renderFailed: 'Mermaid rendering failed: {message}',
}

/** Translate fence copy by browser language. */
export function translator(): (key: MermaidKey, params?: Record<string, string | number>) => string {
  const language = typeof navigator === 'undefined' ? 'zh' : navigator.language
  const dictionary = language.toLowerCase().startsWith('en') ? en : zh
  return (key, params) => {
    const template = dictionary[key]
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match))
  }
}

/**
 * One `mermaid` fence: diagram rendering, theme tracking, and a full-screen zoom/pan view.
 * @module @zifyai/dsh-client-ui-mermaid/MermaidFence
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { renderMermaidSvg } from './render.ts'
import { translator } from './locales.ts'

/** Props the fence slot supplies for one Markdown fence. */
export interface MermaidFenceProps {
  /** Fence language. */
  readonly lang?: string
  /** Fence body. */
  readonly code: string
  /** Fence is still growing. */
  readonly streaming?: boolean
  /** Fallback content (the plain code block). */
  readonly children?: ReactNode
}

const ZOOM_STEP = 1.25
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4

/**
 * Render a Mermaid fence, falling back to the code block while streaming or on failure.
 * @param props - fence language, body, streaming flag, and fallback children.
 * @returns the diagram element.
 */
export function MermaidFence({ lang, code, streaming, children }: MermaidFenceProps): ReactNode {
  const t = translator()
  const [svg, setSvg] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [dark, setDark] = useState(() => document.body.hasAttribute('data-ds-dark-theme'))
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (lang !== 'mermaid' || streaming === true || code.trim() === '') return
    let cancelled = false
    setError(undefined)
    renderMermaidSvg(code).then(
      rendered => { if (!cancelled) setSvg(rendered) },
      (cause: unknown) => {
        if (cancelled) return
        setSvg(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { cancelled = true }
  }, [lang, code, streaming, dark])

  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const diagram = useMemo(() => (svg === undefined ? undefined : { __html: svg }), [svg])

  if (lang !== 'mermaid') return <>{children}</>
  if (streaming === true || (svg === undefined && error === undefined)) return <>{children}</>
  if (error !== undefined) {
    return (
      <div data-zifyai-mermaid="error">
        {children}
        <div style={{ color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, marginTop: 4 }}>
          {t('renderFailed', { message: error })}
        </div>
      </div>
    )
  }

  return (
    <div data-zifyai-mermaid="diagram" style={{ position: 'relative' }}>
      <div
        ref={host}
        role="button"
        tabIndex={0}
        title={t('clickToZoom')}
        style={{ cursor: 'zoom-in', display: 'flex', justifyContent: 'center', overflow: 'auto' }}
        onClick={() => setOpen(true)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setOpen(true) }}
        dangerouslySetInnerHTML={diagram}
      />
      {open && svg !== undefined
        ? <MermaidLightbox svg={svg} onClose={close} />
        : null}
    </div>
  )
}

/**
 * Full-screen diagram view with wheel/button zoom and drag panning.
 * @param props - rendered SVG markup and the close callback.
 * @returns the overlay.
 */
function MermaidLightbox({ svg, onClose }: { readonly svg: string; readonly onClose: () => void }): ReactNode {
  const t = translator()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | undefined>(undefined)
  const zoomHost = useRef<HTMLDivElement | null>(null)
  const clamp = (value: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))

  useEffect(() => {
    const host = zoomHost.current
    if (host === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      setScale(previous => clamp(previous * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)))
    }
    // React attaches onWheel passively, where preventDefault is ignored; own the listener instead.
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-zifyai-mermaid="lightbox"
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ maxWidth: '92vw', maxHeight: '88vh', overflow: 'hidden', cursor: drag.current === undefined ? 'grab' : 'grabbing', touchAction: 'none' }}
        onClick={event => event.stopPropagation()}
        ref={zoomHost}
        onPointerDown={event => {
          drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
          ;(event.target as Element).setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={event => {
          const current = drag.current
          if (current === undefined) return
          setOffset({ x: current.ox + (event.clientX - current.x), y: current.oy + (event.clientY - current.y) })
        }}
        onPointerUp={() => { drag.current = undefined }}
      >
        <div
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: drag.current === undefined ? 'transform .12s ease-out' : undefined }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div style={{ position: 'fixed', right: 16, top: 16, display: 'flex', gap: 8 }} onClick={event => event.stopPropagation()}>
        <LightboxButton label={t('zoomOut')} onClick={() => setScale(previous => clamp(previous / ZOOM_STEP))}>−</LightboxButton>
        <LightboxButton label={t('zoomIn')} onClick={() => setScale(previous => clamp(previous * ZOOM_STEP))}>+</LightboxButton>
        <LightboxButton label={t('reset')} onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>1:1</LightboxButton>
        <LightboxButton label={t('close')} onClick={onClose}>×</LightboxButton>
      </div>
    </div>
  )
}

/**
 * One lightbox control button.
 * @param props - accessible label, click handler, and visible glyph.
 * @returns the button element.
 */
function LightboxButton({ label, onClick, children }: { readonly label: string; readonly onClick: () => void; readonly children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,.35)', background: 'rgba(0,0,0,.45)', color: '#fff', fontSize: 16, cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}

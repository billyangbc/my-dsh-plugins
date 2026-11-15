/**
 * Wire types for the LSP Remote.
 *
 * The shared DTOs mirror the capability seam instead of importing it: Typert
 * generation copies only the Remote packages into a DSH checkout, where the
 * capability packages are absent. `LspDefinitionTarget` exists only on the wire:
 * the capability reports an absolute path, and this one carries the path the
 * Client can open.
 * @module @zifyai/dsh-api-lsp/types
 */

/** Zero-based LSP position. */
export interface LspPosition {
  /** Line index. */
  readonly line: number
  /** UTF-16 character offset. */
  readonly character: number
}

/** One diagnostic published by the server. */
export interface LspDiagnostic {
  /** LSP severity (1 error, 2 warning, 3 info, 4 hint). */
  readonly severity: number
  /** Human-readable message. */
  readonly message: string
  /** Inclusive start. */
  readonly start: LspPosition
  /** Exclusive end. */
  readonly end: LspPosition
  /** Producer name, when supplied. */
  readonly source?: string | undefined
}

/** Result of opening a document. */
export interface LspOpenResult {
  /** Opaque document handle; empty when the language is unsupported. */
  readonly id: string
  /** Diagnostics available at open time. */
  readonly diagnostics: readonly LspDiagnostic[]
  /** False when the configured language ids exclude this language, so no server was asked. */
  readonly supported: boolean
  /** False when no diagnostics arrived before the settle deadline; an empty list then means "unknown", not "clean". */
  readonly settled: boolean
}

/** One completion proposal. */
export interface LspCompletionItem {
  /** Primary label. */
  readonly label: string
  /** Kind name (function, variable, …) when the server supplies one. */
  readonly kind?: string | undefined
  /** Short detail line. */
  readonly detail?: string | undefined
}

/** Hover contents and its optional range. */
export interface LspHover {
  /** Markdown or plain text. */
  readonly contents: string
  /** Range the hover applies to. */
  readonly range?: { readonly start: LspPosition; readonly end: LspPosition } | undefined
}

/** A definition target as the Client receives it: workspace-relative inside the workspace, else absolute. */
export interface LspDefinitionTarget {
  /** Workspace-relative path when the target is inside the Session workspace, else an absolute path. */
  readonly path: string
  /** Zero-based position inside the target. */
  readonly position: LspPosition
}

/**
 * Editor LSP seam: open a document in a language server and read diagnostics and hover.
 * @module @zifyai/dsh-lsp-editor
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'

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

/** A target location in the workspace. */
export interface LspLocation {
  /** Absolute file path. */
  readonly path: string
  /** Zero-based position. */
  readonly position: LspPosition
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    lspEditor: LspEditor
  }
}

/** Stable failure classes an LSP provider reports. */
export type LspErrorCode =
  | 'lsp/unknown-document'
  | 'lsp/not-open'
  | 'lsp/stopped'
  | 'lsp/timeout'
  | 'lsp/protocol-overflow'
  | 'lsp/failed'

/** A language-server operation that could not complete. */
export class LspError extends HarnessError {
  /**
   * @param message - human diagnostic naming what failed.
   * @param lspCode - stable failure class.
   * @param subject - the document handle or method the failure concerns, when it concerns one.
   * @param options - standard Error options.
   */
  constructor(message: string, readonly lspCode: LspErrorCode, readonly subject?: string, options?: ErrorOptions) {
    super(message, lspCode, options)
  }
}

/** Language-server documents scoped to one workspace root per server process. */
export abstract class LspEditor extends Service {
  /**
   * @param ctx - owning Host context.
   */
  constructor(ctx: Context) {
    super(ctx, 'lspEditor')
  }

  /**
   * Open a document and start the server for its workspace root when needed.
   * @param root - absolute workspace root.
   * @param path - workspace-relative or absolute file path.
   * @param text - current content.
   * @param languageId - LSP language id.
   * @returns document handle and current diagnostics.
   */
  abstract open(root: string, path: string, text: string, languageId: string): Promise<LspOpenResult>

  /**
   * Replace a document's full content.
   * @param id - document handle from {@link open}.
   * @param text - new full content.
   * @returns diagnostics after the change settles.
   */
  abstract change(id: string, text: string): Promise<readonly LspDiagnostic[]>

  /**
   * Close a document; the server stops when its last document closes.
   * @param id - document handle.
   */
  abstract close(id: string): Promise<void>

  /**
   * Read the latest diagnostics for a document.
   * @param id - document handle.
   * @returns current diagnostics.
   */
  abstract diagnostics(id: string): Promise<readonly LspDiagnostic[]>

  /**
   * Resolve the definition at a position.
   * @param id - document handle.
   * @param position - zero-based position.
   * @returns the target location, or undefined when none applies.
   */
  abstract definition(id: string, position: LspPosition): Promise<LspLocation | undefined>

  /**
   * List completions at a position.
   * @param id - document handle.
   * @param position - zero-based position.
   * @returns proposed items.
   */
  abstract completion(id: string, position: LspPosition): Promise<readonly LspCompletionItem[]>

  /**
   * Ask the server for hover information.
   * @param id - document handle.
   * @param position - zero-based position.
   * @returns hover contents, or undefined when nothing applies.
   */
  abstract hover(id: string, position: LspPosition): Promise<LspHover | undefined>
}

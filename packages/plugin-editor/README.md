# @zifyai/dsh-plugin-editor

Workspace mutations, LSP, and the editor panel for DeepSeek Harness.

## Packages

| Package | Kind | Purpose |
|---|---|---|
| `@zifyai/dsh-workspace-mutations` | capability | Root-confined write/remove/rename/mkdir service |
| `@zifyai/dsh-workspace-mutations-local` | provider | Local workspace mutation provider |
| `@zifyai/dsh-api-workspace-mutations` | Remote | Typert Remote namespace |
| `@zifyai/dsh-lsp-editor` | capability | stdio LSP: diagnostics, hover, definition, completion |
| `@zifyai/dsh-lsp-editor-local` | provider | stdio language-server provider |
| `@zifyai/dsh-api-lsp` | Remote | Typert Remote namespace |
| `@zifyai/dsh-client-ui-editor` | client | Right-sidebar editor panel |
| `@zifyai/dsh-plugin-editor` | bundle | Mounts all rows |

## Configuration

Every provider takes its tunables from the composing row, so a deployment changes them in `cordis.patch.yml` rather than in code.

| Provider | Config fields |
|---|---|
| `@zifyai/dsh-workspace-mutations-local` | `maxWriteBytes` |
| `@zifyai/dsh-lsp-editor-local` | `command`, `args`, `timeoutMs`, `maxMessageBytes`, `stderrMaxBytes`, `graceMs`, `settleMs`, `languageIds` |

The bundle configures `clangd` for C/C++ diagnostics; point `command` at another language server for other languages.

## Install

```sh
dsh plugin --profile <profile> add /absolute/path/to/packages/plugin-editor
```

## Tests

```sh
DSH_CHECKOUT=/path/to/checkout node fixtures/mutations-provider-check.mjs
DSH_CHECKOUT=/path/to/checkout node fixtures/lsp-provider-check.mjs
DSH_CHECKOUT=/path/to/checkout node fixtures/e2e-editor.mjs "http://127.0.0.1:PORT/?token=..." /path/to/workspace
```

`e2e-editor` covers open/edit/save; `e2e-editor-ops` covers create/rename/delete, image preview, and the 2 MB guard; `e2e-lsp` covers clangd diagnostics and dirty-tab closing. `fixtures/fake-lsp-server.mjs` is the deterministic server behind `lsp-provider-check`, which asserts the child writes its exit marker during disposal.

## Limitations

- The editor caps text files at 2 MB and defers Add to Chat (no public composer insertion API).
- The editor uses CodeMirror rather than Monaco; its copy is still Chinese.

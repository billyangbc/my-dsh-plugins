# @zifyai/dsh-plugin-demo

Smallest reference bundle: proves that an out-of-tree Host plugin, a Typert Remote namespace, and a client UI mount through `dsh.bundle` without touching the DSH tree.

## Packages

| Package | Kind | Purpose |
|---|---|---|
| `@zifyai/dsh-demo-remote` | Remote | Typert Remote namespace used by the reference bundle |
| `@zifyai/dsh-demo-client` | client | Browser half of the reference bundle |
| `@zifyai/dsh-plugin-demo` | bundle | Mounts both rows |

## Install

```sh
dsh plugin --profile <profile> add /absolute/path/to/packages/demo-bundle
```

## Fixtures

This package also carries the exploratory and cross-plugin UI fixtures:

- `fixtures/e2e-session.mjs` — Mermaid rendering plus the Git panel (hunk stage, commit, push, history detail).
- `fixtures/e2e-demo.mjs` — demo banner and Remote result.
- `fixtures/e2e-browser*.mjs`, `fixtures/e2e-inspect*.mjs` — ad-hoc Playwright probes kept for reference.

```sh
DSH_HOME=/tmp/home node fixtures/make-session.mjs /path/to/workspace
DSH_CHECKOUT=/path/to/checkout node fixtures/e2e-session.mjs "http://127.0.0.1:PORT/?token=..."
```

# @zifyai/dsh-plugin-mermaid

Mermaid chat fences with a zoom/pan lightbox for DeepSeek Harness.

## Packages

| Package | Kind | Purpose |
|---|---|---|
| `@zifyai/dsh-client-ui-mermaid` | client | Fence renderer, zoom/pan lightbox, zh/en copy |
| `@zifyai/dsh-plugin-mermaid` | bundle | Mounts the client row |

## Install

```sh
dsh plugin --profile <profile> add /absolute/path/to/packages/plugin-mermaid
```

## Tests

```sh
DSH_CHECKOUT=/path/to/checkout node fixtures/e2e-mermaid.mjs "http://127.0.0.1:PORT/?token=..."
```

`e2e-mermaid` opens the seeded session, finds the rendered diagram, and opens the zoom lightbox.

## Limitations

- Mermaid ships inline (about 7.3 MB).

# @zifyai/dsh-plugin-git

Git service, Remote namespace, and right-sidebar panel for DeepSeek Harness.

## Packages

| Package | Kind | Purpose |
|---|---|---|
| `@zifyai/dsh-git` | capability | Git service definition: status, diff, stage, unstage, commit, log, push |
| `@zifyai/dsh-git-local` | provider | Subprocess git provider |
| `@zifyai/dsh-api-git` | Remote | Typert Remote namespace |
| `@zifyai/dsh-client-ui-git` | client | Right-sidebar panel with hunk staging |
| `@zifyai/dsh-plugin-git` | bundle | Mounts all rows |

## Configuration

`@zifyai/dsh-git-local` takes its tunables from the composing row: `gitCommand`, `timeoutMs`, `maxOutputBytes`, `graceMs`, `logLimit`, `graphLimit`.

## Install

```sh
dsh plugin --profile <profile> add /absolute/path/to/packages/plugin-git
```

## Tests

```sh
DSH_CHECKOUT=/path/to/checkout node fixtures/git-provider-check.mjs
```

`git-provider-check` mounts `subprocess-local` + `git-local` and exercises status/diff/stage/unstage/commit/log plus hunk operations and push. `fixtures/git-status-perf.mjs` is a 5,000-file status baseline.

## Limitations

- The Git panel copy follows `navigator.language` (zh/en).

# my-dsh-plugins

Out-of-tree plugin workspace for DeepSeek Harness `0.2.2-rc.3` (upstream `39163dd30f`). The workspace ships no DSH code: every bundle mounts its own Host capability, Remote namespace, and client UI, while the DSH checkout stays byte-identical to upstream.

This repository is the framework plus the bundles built on it. Build, test, and audit entry points discover packages from `packages/*/package.json`, so adding or removing a package needs no edits to the scripts — only `pnpm install` when dependencies change.

## Layout

| Path | Purpose |
|---|---|
| `packages/*` | One workspace package per capability, Remote namespace, client UI, or bundle. |
| `packages/plugin-*` | `dsh.bundle` packages; each has a `cordis.patch.yml` and installs rows into a profile. |
| `tooling/` | Discovery-based build helpers: Typert generation, host compile, client bundling, bundle checks. |
| `fixtures/` | Provider checks, install/uninstall probes, and Playwright E2E fixtures. |

Every bundle documents its packages, configuration, and own E2E suites in its `README.md`.

## Build

```sh
pnpm install
DSH_CHECKOUT=/path/to/deepseek-harness-checkout pnpm run build
```

`DSH_CHECKOUT` must point at a checkout of the matching DSH version with dependencies installed. Typert Remote generation temporarily copies each contributing package (`exports["./typert"]`) into `<checkout>/packages/extensions/`, runs the repository generator, copies `typert.host.*` / `typert.remote-client.*` back, and restores the checkout. The runtime install itself is tree-out: the DSH tree never keeps these packages.

`pnpm run build` runs three discovery steps:

1. `tooling/generate-via-checkout.mjs` generates Typert artifacts for every package that exports a `./typert` face (skipped when there are none, e.g. a bare scaffold).
2. `tsc -b` compiles every package that has a `tsconfig.json`.
3. `tooling/build-client.mjs` bundles every package that declares a `dsh.client` face.

`tooling/sync-host-tsconfig.mjs` writes the generated, untracked `tsconfig.host.json` project references that the Typert generator and IDEs read.

## Test

```sh
DSH_CHECKOUT=/path/to/checkout pnpm run build
pnpm test                                        # every fixtures/*-provider-check.mjs
DSH_CHECKOUT=/path/to/checkout pnpm run verify   # install/remove every bundle
DSH_CHECKOUT=/path/to/checkout node fixtures/uninstall-audit.mjs
```

Provider checks dispose their Context before reporting, so a leaked child process, timer, or unhandled rejection fails the run instead of passing silently.

UI suites need a running Web server, a session fixture, and Playwright 1.61 with a system Chrome:

```sh
DSH_HOME=/tmp/home node fixtures/make-session.mjs /path/to/workspace
DSH_CHECKOUT=/path/to/checkout node fixtures/e2e-boot.mjs "http://127.0.0.1:PORT/?token=..." '@zifyai/dsh-client-ui-git'
```

## Install

```sh
dsh plugin --profile <profile> add /absolute/path/to/packages/plugin-<name>
```

The profile needs the default Web application.

## Guarantees

- Every contribution is an effect; uninstall removes the tab, the Remote mount, and the Host rows.
- Every provider stops what it started: `git` terminates a timed-out child, and the LSP provider awaits `shutdown`/`exit`/`terminate` during disposal.
- Workspace mutations never follow a symbolic link and never remove a link's target.
- Build and audit entry points discover packages, so a removed package cannot leave a stale build entry behind.
- `tooling/verify-zero-diff.mjs` compares a DSH checkout's `packages/ apps/ vendor/` and root build files against upstream; CI runs it on every push and pull request.

## Limitations

- Typert generation needs a matching checkout at build time.
- The client bundle is a single JS file; CSS Modules, workers, and assets still need the official preset's pipeline.
- The lockfile is shared by every package, so adding packages or dependencies needs a `pnpm install` refresh.
- `pnpm-workspace.yaml` approves only esbuild's install script and declines the other native builds (`allowBuilds`); the build and checks need no toolchain for them.
- `pnpm remove` on a `link:` install leaves a `node_modules/@zifyai/*` symlink; manifest, lockfile, and `--dump-config` stay clean.

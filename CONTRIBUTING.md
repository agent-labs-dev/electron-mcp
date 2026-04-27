# Contributing

Thanks for considering a contribution. This package is maintained best-effort;
small, focused PRs are easiest to review.

## Setup

```sh
pnpm install
pnpm check
```

## Development

- Source lives in `src/`.
- Unit tests are colocated as `*.test.ts` and are the only files vitest
  picks up (see `vitest.config.ts`).
- The canonical Electron smoke test is `test/electron/smoke.spec.ts`,
  driven by `pnpm test:electron`. CI runs this on Linux.
- `tests/smoke.electron.test.ts` is an alternate exploratory fixture
  that talks to a CJS Electron main via stdout and is **not** wired
  into vitest, playwright, or CI; it's kept for local experimentation
  only and may be removed in a follow-up.
- Run `pnpm test` for unit tests.
- Run `pnpm test:electron` for the Electron smoke test.

## Changesets

User-visible changes need a changeset:

```sh
pnpm changeset
```

Pick `patch`, `minor`, or `major` according to semver. For `0.x`, breaking API
changes generally use `minor`.

Releases are handled by the Changesets release workflow. Do not publish from a
local machine unless a maintainer explicitly coordinates it.

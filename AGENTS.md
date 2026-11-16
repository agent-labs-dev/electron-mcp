# Electron MCP agent instructions

## Commands

- Setup: `pnpm install --frozen-lockfile`
- Gate: `pnpm check`
- Electron smoke: `pnpm test:electron`
- Release: maintainers use the Changesets workflow on `main`; do not publish locally.

## Standards

This repository follows the `repo-standards` pack. Keep workflow actions pinned to full commit
SHAs, preserve least-privilege permissions, and update `CHANGELOG.md` for user-visible releases.

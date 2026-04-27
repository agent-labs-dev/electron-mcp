<!--
Thanks for opening a PR. Fill the sections below so reviewers can land
this without context-switching.

CI runs typecheck + lint + unit tests + the Playwright `_electron` smoke
test on every PR. Releases happen via Changesets — when this PR lands on
`main`, the `release` workflow opens (or updates) a "Version Packages"
PR consolidating pending changesets. Merging that PR cuts a release.

See CONTRIBUTING.md for the full flow.
-->

## Summary

<!-- One to three sentences: what changes and why. Link the issue if
there is one (e.g. "Closes #42"). -->

## Changes

<!-- Bulleted list of concrete changes. Call out anything subtle
(broadening a public type, touching CDP wiring, changing a tool's
input schema, adjusting the loopback bind / HTTP defaults). -->

-
-

## Verification

- [ ] `pnpm typecheck` passes locally
- [ ] `pnpm test:unit` passes locally
- [ ] If this touches CDP wiring or any bundled tool, `pnpm test:smoke` passes
- [ ] A changeset is staged (`.changeset/<name>.md`) **or** this PR is genuinely no-op for users (`pnpm changeset --empty`)
- [ ] Public API changes (`src/index.ts` / `src/types.ts` exports) are reflected in `README.md`
- [ ] No secrets, tokens, or `.env*` files included

## Notes for reviewers

<!-- Anything not obvious from the diff: trade-offs considered,
alternatives rejected, follow-ups intentionally left out. For
security-sensitive changes, please flag explicitly — see SECURITY.md
for the vuln disclosure process. -->

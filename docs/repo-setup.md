# Repository Setup

Use this checklist for `agent-labs-dev/electron-mcp` and future Agent Labs OSS
repos with similar release mechanics.

- Require 2FA for the `agent-labs-dev` organization.
- Enable Dependabot alerts and security updates.
- Enable secret scanning.
- Protect `main`.
- Require CI checks before merge.
- Require at least one approving review.
- Add `NPM_TOKEN` as an Actions secret for the release workflow.
- Install the Changesets GitHub app if release PRs are not created.
- Confirm package provenance settings before the first npm publish.

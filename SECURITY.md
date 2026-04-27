# Security

## Supported Versions

Only the latest published `0.x` version receives security consideration.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability. Email `security@agent-labs.dev`
with:

- affected version or commit
- reproduction steps
- impact
- any known mitigations

We review reports best-effort and will coordinate disclosure when a fix is
available.

## Model

The MCP server binds to loopback by default and rejects non-loopback hosts. It
does not implement authentication in `0.1.0`. Host apps are responsible for
their own start gates and must not start the server in production unless they
have intentionally accepted that risk.

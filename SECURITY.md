# Security Policy

## Reporting a Vulnerability

Please report security issues by opening a GitHub Security Advisory or emailing the maintainer.

When reporting, include:
- Steps to reproduce
- Impact assessment
- Any relevant logs (please redact tokens)

## Token handling

- Figma Personal Access Tokens (PATs) begin with `figd_...`.
- Do **not** commit PATs to this repository.
- Store tokens in one of:
  - `~/.figma-mcp/config.json`
  - `.figma-mcp.local.json` (project-local, gitignored)
  - `FIGMA_API_KEY_<ACCOUNT>` env vars

This proxy redacts `figd_*` patterns from logs and from upstream payloads before returning them.


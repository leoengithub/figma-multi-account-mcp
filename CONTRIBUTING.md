# Contributing

## Setup

- Install Node.js (>= 18) and enable Corepack.
- Install deps:

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Commit messages / releases

This repo uses **semantic-release**. Releases are created automatically on merges to `main` based on **Conventional Commits**.

- Use `feat:` / `fix:` / `chore:` etc. in PR titles (recommended: squash merge).
- Breaking changes: add `!` (e.g. `feat!:`) or include `BREAKING CHANGE:` in the body.

## Tests

```bash
pnpm run typecheck
pnpm test
```

## Security

Never commit secrets or `figd_*` tokens. Use `.figma-mcp.local.json` or environment variables instead.


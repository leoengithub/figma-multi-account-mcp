## figma-multi-mcp

An MCP stdio proxy that routes all Figma MCP tool calls across **multiple named accounts** by spawning one upstream `figma-developer-mcp` process per account.

### Install / Run

Use in an MCP client (example):

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-multi-mcp"]
    }
  }
}
```

### Configure accounts

Config resolution order (highest priority first):

1. `FIGMA_API_KEY_<ACCOUNT>` env var (e.g. `FIGMA_API_KEY_WORK`)
2. `.figma-mcp.local.json` (project-local override, gitignored)
3. `~/.figma-mcp/config.json` (user-global)

Example `~/.figma-mcp/config.json`:

```jsonc
{
  "accounts": {
    "work": { "token": "figd_REPLACE_ME", "label": "Acme Corp" },
    "personal": { "token": "figd_REPLACE_ME" }
  },
  "default": "work"
}
```

### How account selection works

On every tool call, account resolution precedence is:

1. Explicit `account` argument (injected into every tool schema by this proxy)
2. Sticky account for the current session (remembered after the first explicit selection)
3. `default` from config (if set)

If no account can be resolved, the tool result returns `ACCOUNT_SELECTION_REQUIRED` with `availableAccounts`.

### Security

- Tokens are **never** read from this repo.
- All log lines and upstream payloads are redacted for `figd_*` patterns.
- Child processes are spawned with a **minimal env** (`PATH`, `HOME`/`SystemRoot`, and `FIGMA_API_KEY` only).

### Development

```bash
pnpm install
pnpm dev
pnpm run typecheck
pnpm test
```

### Debug flags

```bash
# list configured accounts (from env/local/home config)
pnpm dev -- --list-accounts

# clear sticky context (all sessions) then exit
pnpm dev -- --clear-context
```


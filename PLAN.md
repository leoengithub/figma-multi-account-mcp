# Implementation Plan — figma-multi-account-mcp

_Status: pre-implementation · last updated: 2026-04-21 · reviewed: findings 1–8 applied + sticky account context_

---

## 1. Goals

- Ship an **open-source MCP proxy server** (`npx figma-multi-mcp`) that wraps the official `figma-developer-mcp` npm package and adds multi-account routing.
- Users configure named accounts (`work`, `personal`, etc.) each with a PAT. The proxy spawns one official MCP process per account and routes each call using this precedence: explicit `account` param -> sticky account for the current task/conversation -> configured `default` (if present).
- If no explicit/sticky/default account exists, the proxy returns a structured `ACCOUNT_SELECTION_REQUIRED` response so the agent asks once, then reuses that account for the rest of the task/conversation.
- Zero re-implementation of Figma API logic — all tool behavior stays in the official binary. Future Figma tools are automatically supported without changes to this project.
- Safe to publish: credentials never touch the repo, tokens are redacted from all log output.
- License: **MIT**.

## 2. Non-Goals (v1)

- OAuth 2 / refresh token flows (PAT-only; OAuth is a future phase).
- A web UI or admin panel for managing accounts.
- Inferring account from file IDs/content/tool name. Selection is explicit once, then sticky per task/conversation scope.
- Multi-user SaaS deployment (architecture accommodates it; v1 is self-hosted).
- Re-implementing any Figma REST API calls — the official binary owns all of that.

---

## 3. Architecture

### 3.1 Core idea

The official `figma-developer-mcp` package authenticates via a single token set at startup. We exploit this by spawning **one process per account**, each with its own `FIGMA_API_KEY` env var. Our server:

1. Discovers the tool list from the official binary (queries one instance on startup).
2. Re-exposes every tool with an injected `account?: enum(...)` parameter.
3. Maintains an active-account context per conversation/task scope (sticky after first explicit selection).
4. On each tool call, resolves account with precedence `account` param -> sticky context -> `default`.
5. Strips the `account` field and forwards to the right process.

```
Claude / AI agent
      │
      │  MCP (stdio)
      ▼
figma-multi-mcp  (our proxy)
      │
      ├── resolves account from param / sticky context / default
      ├── updates sticky context when explicit account is provided
      ├── strips account param from args
      │
      ├── account = "work"     → figma-mcp process #1  (FIGMA_API_KEY=figd_work_...)
      ├── account = "personal" → figma-mcp process #2  (FIGMA_API_KEY=figd_personal_...)
      └── account = "client"   → figma-mcp process #3  (FIGMA_API_KEY=figd_client_...)
                                        │
                                        ▼
                                 Figma API
                                 (official package handles everything)
```

### 3.2 Project structure

```
figma-multi-account-mcp/
├── src/
│   ├── index.ts                    # Entry: load config, start pool, start server
│   ├── server.ts                   # MCP server: discover tools, re-expose with account param
│   ├── registry/
│   │   ├── index.ts                # AccountRegistry: resolve name → token
│   │   └── config-loader.ts        # Load ~/.figma-mcp/config.json + env overrides
│   ├── pool/
│   │   ├── index.ts                # AccountPool: Map<accountName, McpClient>
│   │   └── process-manager.ts      # Spawn/restart figma-developer-mcp via npx per account
│   ├── proxy/
│   │   ├── index.ts                # Route tool calls: resolve account → forward to pool
│   │   └── schema-injector.ts      # Inject account param into every tool's input schema
│   ├── context/
│   │   ├── store.ts                # Sticky account store keyed by task/conversation scope
│   │   └── scope-resolver.ts       # Resolve scope key from MCP request metadata/session
│   └── utils/
│       ├── logger.ts               # Pino logger with figd_* token redaction
│       └── errors.ts               # Typed error codes + error factories
├── config/
│   └── example.config.json         # Committed, fake tokens, documentation comments
├── tests/
│   ├── registry/
│   ├── pool/
│   ├── proxy/
│   └── context/                    # ContextStore TTL/isolation + ScopeResolver tests
├── .github/
│   └── workflows/
│       ├── ci.yml                  # lint + typecheck + test on PR
│       └── release.yml             # npm publish on git tag
├── CONTRIBUTING.md                 # at repo root so GitHub auto-links it
├── SECURITY.md
├── LICENSE                             # MIT
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

### 3.3 Account registry

Config resolution order (highest priority wins):

1. `FIGMA_API_KEY_<ACCOUNT>` env var (e.g. `FIGMA_API_KEY_WORK`) — uppercase, underscored account name
2. `.figma-mcp.local.json` (project-level override, always `.gitignore`d — enables per-project account switching)
3. `~/.figma-mcp/config.json` (user-global fallback, never in the repo)

Rationale: project-local config must override global so that switching accounts per project works reliably. A developer working on a client project can place `.figma-mcp.local.json` in that repo root and it will take precedence over their personal global config.

```typescript
interface AccountConfig {
  token: string;     // PAT: figd_...
  label?: string;    // human-readable alias shown in logs/errors
}

interface Config {
  accounts: Record<string, AccountConfig>;
  default?: string;           // fallback when account is omitted and no sticky account is selected
  mcpCommand?: string[];      // override spawn command; default: ["npx", "-y", "figma-developer-mcp", "--stdio"]
  callTimeoutMs?: number;     // per-call timeout in ms; default: 30000
  stickyContextTtlMs?: number; // active-account TTL per context key; default: 3600000 (1 hour)
}
// mcpCommand behaviour:
//   undefined / absent → use default npx invocation
//   string[] → used as-is; first element is the executable, rest are args
// The Zod schema defaults mcpCommand to ["npx", "-y", "figma-developer-mcp", "--stdio"] when absent.
// sticky context key behaviour:
//   prefer metadata.conversationId / metadata.threadId when present
//   fallback to MCP client session/connection id
//   fallback to "global" only if the transport exposes no stable session identifier
```

### 3.4 Process pool

`AccountPool` maintains one live `figma-mcp` child process per configured account:

- On startup: spawn all processes, each receiving `FIGMA_API_KEY=<pat>` in its env.
- Crash recovery: auto-restart up to 3 times; after that mark as `UNAVAILABLE`.
- Shutdown: `process.on('exit')` / `SIGTERM` handler kills all children cleanly — no zombie processes.
- Lazy option (future): spawn on first use to reduce startup time when many accounts are configured.

### 3.5 Child process invocation

Each account's child process is launched as:

```
npx -y figma-developer-mcp --stdio
```

with `FIGMA_API_KEY=<pat>` injected into the process environment. No binary detection is needed — `figma-developer-mcp` is the official Figma MCP npm package and is fetched/cached by npx automatically on any platform.

**Process env isolation (security requirement):** Each child process must be spawned with an explicit, minimal `env` object — **not** inheriting the parent process's full environment. This prevents one account's token from being visible inside another account's process. The minimal env must include `PATH` (so npx resolves correctly) and `FIGMA_API_KEY=<that account's token>` only:

```typescript
spawn('npx', ['-y', 'figma-developer-mcp', '--stdio'], {
  env: {
    PATH: process.env.PATH,          // required for npx resolution
    HOME: process.env.HOME,          // required on macOS/Linux for npm cache
    FIGMA_API_KEY: account.token,    // this account's token only
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})
```

Do NOT spread `...process.env` into the child env — that would expose all `FIGMA_API_KEY_*` vars (and any other secrets in the parent env) to every child process.

**Platform support:** macOS, Windows, and Linux are all fully supported. `figma-developer-mcp` has no dependency on the Figma desktop app; it calls the Figma REST API directly using the PAT.

**`npx` availability:** The proxy requires Node.js ≥18 (which ships npx). If `npx` is not on PATH, startup fails with a clear error message directing the user to install Node.js.

**Config override:** `config.mcpCommand` (array of strings) can override the default `["npx", "-y", "figma-developer-mcp", "--stdio"]` invocation for users who want to pin a specific version or use a local checkout:

```jsonc
// ~/.figma-mcp/config.json
{
  "mcpCommand": ["npx", "-y", "figma-developer-mcp@0.10.1", "--stdio"]
}
```

### 3.6 Schema injection

On startup, `schema-injector.ts` queries pool instances for the tool list using the following resilience strategy:

1. Try accounts in the order they appear in config, one at a time.
2. Use the tool list from the **first instance that responds successfully**.
3. If an instance fails (process crash, `UNAVAILABLE`), skip it and try the next.
4. If **all instances fail**: exit the proxy process immediately with a non-zero code and a clear error message listing which accounts were tried and why each failed. Do not start in a degraded state with no tools — that would silently appear to work but produce confusing errors on every call.

All instances share the same binary version, so their tool lists are identical; using the first healthy one is safe.

For each tool, the injector builds a dynamic enum from the configured account names and injects it:

```typescript
// account names come from config at runtime, e.g. ["work", "personal", "client"]
account: z.enum(accountNames).optional()
  .describe(
    `Figma account to use. Available: ${accountNames.join(', ')}. ` +
    `If omitted, proxy uses sticky account for this task/conversation, then config.default if set. ` +
    `If none resolve, the call returns ACCOUNT_SELECTION_REQUIRED — retry with an explicit account.`
  )
```

The `account` field is always stripped from args before forwarding to the child process.

### 3.7 Routing

Account resolution precedence:

1. Explicit `account` argument on the incoming tool call.
2. Sticky account stored for the current task/conversation scope.
3. `config.default` (if configured).
4. If none exists: return `ACCOUNT_SELECTION_REQUIRED` with available account names.

Scope key resolution for sticky account storage:

1. `request.metadata.conversationId` (if present from client).
2. `request.metadata.threadId` (fallback).
3. MCP session/connection id (default keying strategy).
4. `"global"` only if transport exposes no stable identifier.

Sticky context reset rules:

- A new scope key starts with no selected account.
- TTL expiry (`stickyContextTtlMs`, default 1 hour) clears selection for that scope. TTL is **sliding** — reset on every tool call that uses that scope key. A scope that is actively in use never expires mid-task.
- Explicit `account` on a call overrides previous selection and becomes the new sticky account for that scope.

```typescript
// src/proxy/index.ts
async function routeToolCall(request: McpRequestContext, toolName: string, rawArgs: unknown) {
  const { account: accountName, ...forwardArgs } = parseArgs(rawArgs);
  const scopeKey = scopeResolver.resolve(request);
  const selectedAccount =
    accountName ??
    contextStore.get(scopeKey) ??
    config.default;

  if (!selectedAccount) {
    throw accountSelectionRequired(registry.listAccountNames());
  }

  const resolved = registry.resolve(selectedAccount); // throws ACCOUNT_NOT_FOUND if invalid
  if (accountName) {
    contextStore.set(scopeKey, resolved); // make selection sticky for this scope
  }

  const client = pool.getClient(resolved);         // throws ACCOUNT_UNAVAILABLE if crashed
  const result = await client.callTool(toolName, forwardArgs);
  return sanitizeUpstreamPayload(result);          // strip any figd_* patterns before returning
}
```

### 3.8 Error codes

```typescript
type ErrorCode =
  | 'ACCOUNT_NOT_FOUND'       // account name not in registry
  | 'ACCOUNT_SELECTION_REQUIRED' // no explicit/sticky/default account available
  | 'ACCOUNT_UNAVAILABLE'     // process crashed and exceeded restart limit
  | 'NPX_NOT_FOUND'           // npx is not on PATH (Node.js not installed)
  | 'VALIDATION_ERROR'        // Zod parse failure on input args
  | 'UPSTREAM_ERROR'          // error forwarded from official figma-mcp (sanitized pass-through)
  | 'UPSTREAM_TIMEOUT'        // child process did not respond within callTimeoutMs
  | 'CALL_CANCELLED'          // MCP client cancelled the request before response
```

`ACCOUNT_SELECTION_REQUIRED` is returned as a structured MCP tool error (not a thrown exception) with this shape so the agent can present a clear choice to the user:

```typescript
{
  code: 'ACCOUNT_SELECTION_REQUIRED',
  message: 'No Figma account selected. Please specify one of: work, personal, client.',
  availableAccounts: ['work', 'personal', 'client'],  // machine-readable list for agent use
  hint: 'Pass the account name as the `account` argument on your next call. It will be remembered for the rest of this task.'
}
```

The agent receiving this should ask the user "Which Figma account should I use: work, personal, or client?" then retry the same tool call with `account` set.

Errors from the official binary are passed through, but **always run through `sanitizeUpstreamPayload()`** before being returned to the caller. This function applies the same `figd_[a-zA-Z0-9_-]+` regex redaction used in the logger to all string fields in the error payload — message, details, stack, and any nested objects. This prevents token values that may appear in upstream error messages (e.g. Figma including the token in a 401 response body) from leaking to the MCP client.

### 3.9 Concurrency, timeouts, and cancellation

**Per-account concurrency:** Each account's `figma-mcp` process handles one stdio request at a time (the MCP stdio transport is inherently serial). The `AccountPool` queues concurrent calls to the same account and drains them sequentially. There is no global concurrency limit — calls to different accounts proceed in parallel across their respective processes.

**Call timeout:** Every forwarded tool call is wrapped in a `Promise.race` against a configurable timeout (default: **30 seconds**). If the child process does not respond within the timeout, the call resolves with an `UPSTREAM_TIMEOUT` error (added to `ErrorCode`). The timeout is configurable via `config.callTimeoutMs`.

**Cancellation propagation:** If the MCP client cancels a request (sends a `cancelled` notification), the proxy immediately resolves the queued call with `CALL_CANCELLED` and does not forward the cancellation to the child process (the child's stdio transport does not support mid-call cancellation). Any in-flight call that has already been forwarded runs to completion or timeout.

### 3.10 Token validation on startup

For each configured account, the proxy calls the `whoami` tool via that account's process immediately after the pool is ready.

**Note on `whoami` availability:** `whoami` is listed as a "Remote Only" tool on the official Figma MCP docs and may not be exposed by all versions of `figma-developer-mcp`. At startup, the proxy should check whether `whoami` exists in the discovered tool list for that instance. If it does not exist, fall back to calling `get_metadata` with a known-good file key from the config (if provided), or simply mark the account as `DEGRADED` (network-unverified) rather than failing. Document this fallback in README. If `whoami` is available, use it — it is the cheapest verification call. The outcome determines the account's initial state:

| `whoami` result | Account state | Proxy startup |
|-----------------|---------------|---------------|
| Success | `READY` | continues |
| 401 / auth failure | `UNAVAILABLE` (permanent) | continues if ≥1 account is `READY` |
| Network error / timeout | `DEGRADED` (routable) | continues if ≥1 account is `READY` or `DEGRADED` |
| Process failed to spawn | `UNAVAILABLE` (permanent) | continues if ≥1 account is `READY` or `DEGRADED` |
| All accounts `UNAVAILABLE` | — | **exit non-zero** with a summary of each failure |

**`DEGRADED` behaviour:** A `DEGRADED` account is routable — tool calls are forwarded to it normally. The degraded state reflects that we could not confirm the token is valid at startup, not that it is definitely broken. A `DEGRADED` account transitions to `READY` automatically on its first successful tool call.

**Tool discovery interacts with account state as follows:** Schema injection (§3.6) treats `DEGRADED` accounts the same as `READY` for the purpose of finding a queryable instance. Both `READY` and `DEGRADED` accounts are tried; only `UNAVAILABLE` accounts are skipped. If all accounts are `UNAVAILABLE`, tool discovery cannot proceed and the proxy exits non-zero.

---

## 4. Configuration reference

```jsonc
// ~/.figma-mcp/config.json
{
  "accounts": {
    "work": {
      "token": "figd_REPLACE_ME",
      "label": "Acme Corp"
    },
    "personal": {
      "token": "figd_REPLACE_ME"
    }
  },
  // "default": "work",       // optional fallback when no explicit/sticky account exists
  // "mcpCommand": ["npx", "-y", "figma-developer-mcp@0.10.1", "--stdio"],  // optional: pin version
  // "callTimeoutMs": 30000,  // optional: per-call timeout
  // "stickyContextTtlMs": 3600000 // optional: clear sticky account after inactivity
}
```

Env var overrides (use `FIGMA_API_KEY_<ACCOUNT>` to match the upstream package's convention):
```bash
FIGMA_API_KEY_WORK=figd_abc123
FIGMA_API_KEY_PERSONAL=figd_xyz789
```

MCP client config (`claude_desktop_config.json` / `.mcp.json`):
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

---

## 5. Phased rollout

### Phase 1 — Core proxy (v0.1)

- [ ] Project scaffold: TypeScript, `@modelcontextprotocol/sdk`, Zod, Pino, Vitest
- [ ] `ConfigLoader`: file + env var resolution, Zod-validated schema
- [ ] `AccountRegistry`: resolve name → token, default fallback
- [ ] Verify `npx` is available on PATH at startup; fail with `NPX_NOT_FOUND` if not
- [ ] `ProcessManager`: spawn, monitor, restart child processes
- [ ] `AccountPool`: pool of MCP clients, one per account
- [ ] `SchemaInjector`: discover tools from pool, inject optional enum `account` param
- [ ] `ContextStore`: sticky account per task/conversation scope with TTL
- [ ] `ScopeResolver`: metadata conversation/thread id fallback to MCP session id
- [ ] `ProxyRouter`: precedence `account` -> sticky context -> `default`; emit `ACCOUNT_SELECTION_REQUIRED` when unresolved
- [ ] Startup `whoami` validation per account
- [ ] Token-redacting logger
- [ ] `sanitizeUpstreamPayload()` utility (redact `figd_*` from all string fields in any object)
- [ ] Typed error layer (including `ACCOUNT_SELECTION_REQUIRED`, `UPSTREAM_TIMEOUT`, and `CALL_CANCELLED`)
- [ ] README with setup + config instructions, including sticky selection behavior and override rules
- [ ] `config/example.config.json`
- [ ] `SECURITY.md` with responsible disclosure contact
- [ ] `LICENSE` file (MIT)
- [ ] CI workflow: lint + typecheck + Vitest unit tests
- [ ] CI workflow: `gitleaks` secret scan step (fails PR if any `figd_*` pattern found in committed files)
- [ ] Publish `figma-multi-mcp` to npm

### Phase 2 — Hardening + DX (v0.2)

- [ ] `CONTRIBUTING.md` at repo root (GitHub auto-links it from issues/PRs)
- [ ] Lazy process spawning (on first use per account)
- [ ] Graceful SIGTERM/SIGINT shutdown with timeout
- [ ] `--list-accounts` CLI flag for debugging
- [ ] `--clear-context` CLI/debug command to clear sticky account for current scope
- [ ] GitHub Actions release automation (tag → npm publish + GitHub Release)
- [ ] Dependabot config

### Phase 3 — Teams + OAuth (v0.3+)

- [ ] OAuth 2 per-account support (`auth_type: 'oauth'`)
- [ ] Optional file→account mapping table (implicit routing)
- [ ] Docker image for shared team deployments
- [ ] Web-based account management UI (stretch)

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `figma-developer-mcp` npm package breaks between versions | Medium | Medium | `mcpCommand` config field lets users pin a specific version (e.g. `figma-developer-mcp@0.10.1`). README documents how to pin. |
| Upstream MCP package changes its startup interface (env var name, flags) | Medium | High | Isolate all spawn logic in `ProcessManager`. One file to update. Add an integration test that actually spawns the binary. |
| Users accidentally commit PATs | High | High | Config lives outside the repo. `.gitignore` local overrides. CI runs `gitleaks` / secret scanner. |
| PAT leaks in log output | Medium | High | Pino redaction plugin strips `figd_[a-zA-Z0-9_-]+` from all log lines. CI test asserts pattern never appears in output. |
| Cross-account token exposure via inherited child process env | High | High | Each child process spawned with explicit minimal `env` (`PATH`, `HOME`, `FIGMA_API_KEY` only). Never spread `process.env` into child env. Covered by security checklist item. |
| Child process zombies on crash | Medium | Low | `ProcessManager` registers `process.on('exit')` cleanup. `SIGTERM` handler sends `SIGTERM` to all children with 5s timeout before `SIGKILL`. |
| npm name `figma-multi-mcp` already taken | Low | Medium | Register on npm immediately when repo goes public. |
| Pool memory grows with many accounts | Low | Low | Each child process is ~20–50 MB. Acceptable for <20 accounts. Lazy spawning in Phase 2 for large account sets. |
| First call has no explicit account and no sticky/default | High | Medium | Return `ACCOUNT_SELECTION_REQUIRED` with machine-readable `availableAccounts` so agent can ask once and retry. Document behavior in README with examples. |
| Sticky context leaks across unrelated tasks due to coarse keying | Medium | High | Scope key resolver prefers conversation/thread IDs, then MCP session ID; add TTL (`stickyContextTtlMs`) and tests for isolation across different scope keys. |
| Cancelled call blocks account queue until timeout | Medium | Medium | The per-account queue is serial. A cancelled call that was already forwarded to the child process cannot be interrupted — it runs until the child responds or `callTimeoutMs` expires (default 30s). During that window, all queued calls to the same account are blocked. **Known tradeoff, by design.** Mitigation: keep `callTimeoutMs` low (default 30s) and document this behaviour in README so users know to set a tighter timeout if they issue many parallel calls to a single account. |

---

## 7. Security checklist (public repo requirements)

- [ ] `figd_*` token pattern never appears in log output (Vitest assertion on logger output)
- [ ] `sanitizeUpstreamPayload()` strips `figd_*` from all string fields in upstream errors/results (Vitest assertion)
- [ ] No real credentials in `config/example.config.json` (enforced by `gitleaks` CI step)
- [ ] `.gitignore` covers: `*.local.json`, `.env`, `.env.*`
- [ ] README has a "Security" section: where tokens are stored, what never to commit
- [ ] `SECURITY.md` with responsible disclosure contact
- [ ] `LICENSE` file present (MIT)
- [ ] Zod validates all incoming tool args before any processing
- [ ] Dependencies pinned in `package-lock.json`; Dependabot enabled
- [ ] No `eval`, no `child_process.exec` with user-controlled strings (only `child_process.spawn` with arg arrays)
- [ ] Child processes spawned with explicit minimal `env` — never `{ ...process.env }` (prevents cross-account token exposure)

---

## 8. SOLID / DRY applied

| Principle | Where |
|-----------|-------|
| **Single Responsibility** | `Registry` only resolves credentials. `Pool` only manages processes. `ContextStore` only manages sticky selection state. `Proxy` only routes calls. |
| **Open/Closed** | Adding a new scope-key source in `ScopeResolver` = add one resolver branch, no routing logic changes. New account = new config entry, zero code changes. |
| **Liskov** | All pool clients conform to the same `McpClient` interface — the router doesn't know or care which account's process it's talking to. |
| **Interface Segregation** | The proxy router receives a `ToolRouter` interface (resolve + forward), not the full pool implementation. |
| **Dependency Inversion** | `ProcessManager` depends on a `ChildProcessSpawner` interface — makes unit testing without real child processes straightforward. |
| **DRY** | Schema injection runs once on startup, not per call. Error factories are centralized in `errors.ts`. Config resolution logic lives only in `config-loader.ts`. |

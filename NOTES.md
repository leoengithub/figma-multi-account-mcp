# Figma Multi-Account Custom MCP

## Executive Summary

Figma supports multiple logged-in accounts with manual UI switching, but offers no native per-request or per-file account selection for API/agent workflows. Authentication is token-scoped, so account routing must be handled by a custom layer.

---

## What Is Possible Today

- Users can log into multiple Figma accounts and switch between them in the file browser (supported on any plan).
- Figma supports linking Community profile activity across accounts (profile/Community behavior only, not API identity switching).

## What Is Not Possible Natively

- No documented feature for choosing an account per API call or dynamically changing the authenticated account mid-session.
- Figma REST API uses personal access tokens (PATs) or OAuth 2 access tokens — both are account-scoped.
- A PAT is generated for a specific Figma account and accesses only that account's data.

---

## Implication for AI Agents

If an agent needs to act on behalf of two different Figma accounts, the integration layer must explicitly decide which token to use per operation. Native Figma account switching cannot be relied upon.

**Solution**: build a custom MCP server that owns the account-selection logic.

---

## Architecture

### 1. Account Registry

Secure mapping of named identities to credentials:

```
work     → OAuth token / PAT for work account
personal → OAuth token / PAT for personal account
```

### 2. Tool Contract

Expose Figma operations as MCP tools with an explicit `account` field:

```
figma_get_file(account, fileKey)
figma_list_projects(account, teamId)
figma_get_comments(account, fileKey)
```

Keeps agent behavior deterministic and auditable.

### 3. Routing Layer

Per-request flow:
1. Validate the selected account name
2. Load the correct credentials from the registry
3. Instantiate a Figma API client with that account's token
4. Execute the request
5. Return normalized results to the agent

### 4. Optional UX Layer (later phases)

- Default account preferences
- File/team-to-account mapping rules
- User-facing account picker
- Fallback prompts when account is ambiguous

---

## Auth Recommendation

| Method | Use case |
|--------|----------|
| OAuth 2 | Production, multi-user, durable — preferred |
| PAT | Local prototype only — acceptable short-term |

Figma officially supports OAuth 2 with scopes that determine per-token access.

---

## Operational Concerns

- **Token lifecycle**: store credentials securely; handle OAuth refresh/expiry.
- **Rate limits**: Figma limits by seat type, endpoint tier, and resource plan — per-account quota tracking needed.
- **Access boundaries**: a file visible in one account may not exist in the other; error handling must distinguish "wrong account" vs "file not found" vs "insufficient scope."

---

## Phase 1 Milestone

1. Custom MCP server (Node/TypeScript or Python)
2. Two configured account identities (`work`, `personal`)
3. One or two Figma tools (`figma_get_file`, `figma_list_projects`)
4. Explicit `account` parameter on every tool
5. OAuth-based auth if feasible; PATs for prototype

---

## Open Questions

- [ ] Which runtime? (TypeScript MCP SDK vs Python)
- [ ] Where to store credentials? (env vars, keychain, encrypted file)
- [ ] Should account be inferred from file URL domain/team, or always explicit?
- [ ] Do we need a `figma_whoami(account)` tool for debugging identity?
- [ ] Rate limit strategy: per-account counters, or shared pool?

---

## References

- Figma REST API auth: https://www.figma.com/developers/api#authentication
- Figma OAuth 2: https://www.figma.com/developers/api#oauth2
- MCP spec (tools): https://spec.modelcontextprotocol.io/specification/server/tools/

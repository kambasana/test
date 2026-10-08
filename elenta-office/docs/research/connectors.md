# Connector strategy: Composio, MCP servers and how they plug into Elenta Office

Researched 2026-10-08. Every claim carries a source number; the list is at the end. Code was read at
these commits: Composio SDK monorepo `d9f6291` (2026-10-08), OpenMausBot `7c28a1d` (2026-10-08),
Rakazo `40748a1` (2026-10-08). Vendor web pages that could not be fetched directly (DNS blocked from
this sandbox for composio.dev, pipedream.com, docs.docker.com) are cited from search results and
marked *(secondary)*; confirm those before signing anything.

**Framing.** The product's north star is teammates who are genuinely useful across the apps a
company already works in (mail, calendar, docs, CRM, tickets, chat). Breadth matters, so Composio is
the main catalogue. Security is the foundation under it, not a reason to withhold it: per-department
scoping, Ask-first for anything that writes or sends, a full audit trail, and a stricter tier only
for departments that need one. Controlled (ITAR/CUI) work is one such case and is covered briefly in
§6.

> Note: `docs/FEATURE-PLAN.md` §3 currently says "Don't borrow … the Composio connector catalogue".
> This research recommends the opposite for the general tier; that line should be updated if the
> recommendation is accepted.

---

## 1. Composio in depth

### 1.1 What it is

A hosted platform that gives agents tools for 1000+ apps, handles the OAuth for each end user, and
executes the provider API call server-side with the stored credential [C1][C2]. The unit of work is a
**session**: it scopes a `user_id` (whose connected accounts are in scope), tool access (all toolkits
by default, or a filtered set of toolkits, tools or tags), authentication, and execution state [C3].
Tools reach an agent either as framework-native tool definitions from the SDK, or over MCP from the
session's hosted endpoint (`mcp: true` → `session.mcp.url` / `session.mcp.headers`) [C4].

### 1.2 Licence of each part

| Part | Licence / status | Source |
|---|---|---|
| SDK monorepo `ComposioHQ/composio` (TS + Python SDKs, CLI, docs) | MIT ("Copyright (c) 2025 Sampark Inc.") | [C5] |
| `@composio/core` npm package | `"license": "ISC"` in its package.json (v0.22.0) — permissive, but differs from the repo LICENSE | [C6] |
| Platform (backend.composio.dev, tool definitions, OAuth apps, execution, dashboard) | Proprietary hosted service; self-hosted/VPC only by Enterprise arrangement | [C7][C8] |

The SDK is a thin client: the actual tool implementations and credentials are on Composio's servers
(see 1.5). Open-sourcing the SDK does not give us a self-hostable connector platform.

### 1.3 Hosted vs self-hosted, and pricing

Composio's own token-custody page lists four deployment options [C7]:

| Option | Credential boundary | Availability |
|---|---|---|
| Composio Cloud | Composio hosts credential storage and execution | Default |
| Private VPC | Inside a private network boundary; storage, operator access and key ownership "must be specified in the deployment design" | Enterprise arrangement |
| Self-hosted | Runs in your environment, Helm deployment support | Enterprise arrangement |
| Customer-managed keys | A proxy in your cloud handles credential plaintext under keys in your KMS (AWS KMS, GCP KMS, Vault Transit); Composio keeps the control plane | Set up with the Composio team |

A public KB page confirms real self-hosted Helm installs exist (component "Apollo", S3/IRSA config,
social-login switch) [C8]. A Composio staff reply says self-hosting is offered only under Enterprise
*(secondary)* [C9].

Pricing changed in mid-2026 *(secondary, conflicting sources)* [C9][C10]: the older plans were Free
(20K tool calls/month), $29 (200K), $229 (2M) and Enterprise (custom, with "VPC/on-prem option");
the newer structure (from 2026-08-15) is reported as Free, Pro $29, Business $599 and Enterprise, with
overage around $3–4 per 1,000 calls and separate metering of triggers, sandbox compute and storage.
Existing customers reportedly keep old plans until 2026-12-31. **Treat self-hosting and ZDR on
managed apps as Enterprise-only and get a quote.**

### 1.4 How auth works (who holds tokens, where)

- Composio runs the OAuth flow: your backend creates a hosted Connect Link, the user consents at the
  provider, the provider's callback goes to Composio, Composio exchanges the code and **stores the
  access and refresh tokens, encrypted**, and refreshes them [C7].
- Credentials, auth configs and API keys are encrypted at rest with AES-256-GCM; TLS in transit;
  tokens are redacted by default in API responses [C11]. "In the default Composio Cloud deployment,
  Composio has custody of those credentials" [C7].
- Bringing your own OAuth app (custom auth config) changes branding, scopes and quota, **but Composio
  still stores and uses the tokens** [C7].
- Our side holds one secret: the Composio project API key, which "is still a secret with permission
  to act on connected accounts" [C7]. Scoped keys separate session management from tool execution and
  support per-key IP allowlisting; MFA can be enforced [C11].
- The `user_id` is whatever we supply; "a caller-supplied user ID is not proof of identity" — our
  backend must bind identities to accounts [C7]. Use opaque IDs, not emails [C12].

### 1.5 What passes through Composio's cloud on each tool call

From the SDK (`ts/packages/core/src/models/Tools.ts`, `executeComposioTool`): the call is a POST to
`https://backend.composio.dev` (default base URL in `src/utils/constants.ts`) carrying the **tool
slug, the full arguments, `user_id`, `connected_account_id`, toolkit version**, and optional custom
auth params [C6]. Composio resolves the credential, calls the provider, and returns the provider's
response through its servers [C7]. Local `beforeExecute`/`afterExecute` modifiers run in our process
before and after, which is a natural hook for our policy and redaction [C6].

Stored by default [C13]:
- per call: toolkit, action, status, connection/auth-config IDs, `user_id`, timing, **and the request
  arguments and response data**; retained **up to one year**;
- files a tool reads/returns are staged in object storage (presigned URL 1 h default, up to 24 h;
  deleted after 24 h);
- trigger events and payloads.

Zero Data Retention (ZDR, paid add-on; included on Enterprise) stops storing new arguments/responses
and keeps metadata only [C12]. ZDR does **not** cover: Composio-managed OAuth apps (except on
Enterprise — use your own OAuth app), Instant Tools, triggers, the sandbox (Workbench / remote bash,
**on by default in sessions**), file staging, tool-search query caching, and third parties [C12].
Audit logs and telemetry are always stored, and telemetry "can include error messages returned by
providers" [C12]. The SDK also sends anonymous usage analytics to `https://app.composio.dev` unless
`allowTracking: false` [C6]. Standard plans give no contractual zero-retention or no-training
guarantee; "Composio is not FedRAMP authorized" [C14].

### 1.6 MCP support ("Composio MCP", Rube, Connect)

- **Session MCP**: any session can expose a hosted MCP endpoint (`mcp: true`) [C4]. Older standalone
  `composio.mcp` server-management API is deprecated in favour of session MCP (`src/models/MCP.ts`)
  [C6]. Single-toolkit MCP servers also exist (`docs/single-toolkit-mcp.mdx`) [C5].
- **Composio Connect**: a shared MCP server at `https://connect.composio.dev/mcp` exposing **7
  meta-tools** — `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MULTI_EXECUTE_TOOL`
  (up to 50 tools per call), `COMPOSIO_MANAGE_CONNECTIONS`, `COMPOSIO_WAIT_FOR_CONNECTIONS`,
  `COMPOSIO_REMOTE_WORKBENCH` (remote Python) and `COMPOSIO_REMOTE_BASH_TOOL` [C15].
- **Rube** (`https://rube.app/mcp`): Composio's earlier "universal MCP server" for end users, public
  beta, 500+ apps, credentials stored by Composio *(secondary)* [C16]. It is not mentioned in the
  current docs tree; Composio Connect appears to be its successor [C15].
- **Direct tools preset**: preloads only the allowed tools and disables the meta-tools; the sandbox
  can be disabled with `sandbox: { enable: false }` [C3]. An explicit empty toolkit allowlist means
  "no app toolkit is listed, searchable, executable, or served over MCP" [C3].
- Per-toolkit tool allowlists: `tools: { gmail: { enable: ["GMAIL_SEND_EMAIL", …] } }` [C3].

**For Elenta: never give agents Connect/Rube or the meta-tools.** The remote workbench and remote
bash are a shell on someone else's computer, and `MULTI_EXECUTE` hides the real tool names from a
naive policy check (OpenMausBot had to parse it specially, §2.1).

### 1.7 Catalogue size

"1000+ apps" (Connect docs) [C15]; OpenMausBot's README says "500+ apps through Composio" [O1]; Rube
was launched with 500+ [C16]. Count varies by date and by what is counted (toolkits vs tools).

### 1.8 Rate limits

Shared per-organization API budget: Starter/Hobby 2,000 requests/min, Growth 10,000/min, Enterprise
custom; 429s carry `Retry-After`; provider quotas (e.g. Google) apply separately [C17].

### 1.9 Compliance and data residency

- SOC 2 Type II; reports and sub-processor list at trust.composio.dev [C11].
- Not FedRAMP authorized [C14].
- ISO 27001 and an EU/other data-residency region: **no evidence found** in the docs or search [C18].
  Ask in writing.
- DPA and BAA are published (composio.dev/legal/dpa, /legal/baa) [C12].

### 1.10 Known incidents

- **May 2026 security incident** (vendor bulletin): unauthorized access to some internal systems;
  IOCs published 2026-05-22; API keys created before a cutoff were revoked/deleted on 2026-05-23 and
  customers had to create new ones; an internal GitHub token leaked; third-party providers were
  notified about possibly leaked credentials *(secondary — bulletin summarised by search)* [C19].
- **CVE-2026-59807** (CVSS 6.8): Composio SDK before 0.2.32-beta.283, missing file-path check lets a
  prompt injection make the CLI upload local files (e.g. SSH keys) to attacker storage
  *(secondary)* [C20].
- 2024: path traversal and code injection (calculator) CVEs in older SDKs *(secondary)* [C20].

Implication: a central token store for many companies is a high-value target, and it was breached in
2026. Design so that a Composio compromise exposes only the accounts we chose to connect there, with
the least scopes, and so that rotating the project key is routine.

---

## 2. How OpenMausBot and Rakazo integrate Composio (and Pipedream)

### 2.1 OpenMausBot (Apache-2.0 except `enterprise/`) [O2]

- **One Composio project key, one reusable session.** Users paste an `ak_…` key; it is stored with
  Electron `safeStorage`; the local config keeps only the non-secret user and session IDs. "No Gmail,
  GitHub, Slack, or other provider tokens are stored by OpenMausBot; Composio owns their connection
  lifecycle." [O3]
- Session created over REST (`POST /tool_router/session`) with multi-account mode and explicit
  account selection; the returned MCP URL is accepted only if it is `https` on `composio.dev` or a
  configured override ("untrusted Session MCP URL" otherwise) — `server/composio.ts` [O4].
- **Harness-owned MCP bridge** (`server/connector-proxy.ts`): the agent CLI sees only a local stdio
  MCP server. It relays to the Composio session, turns connection requests into chat cards ("the
  agent never authors an auth URL and credentials never pass through its transcript"), and trims
  `tools/list` to the bot's grants [O5].
- **Per-bot tool grants** enforced harness-side (`server/connector-verdict.ts`): every call crosses
  the harness; direct calls are checked by name; `COMPOSIO_MULTI_EXECUTE_TOOL` is unpacked and every
  inner tool checked; **unrecognised argument shapes are denied**; each allow/deny writes a
  decision-log row; refusals do not enumerate what else is granted [O6][O3].
- Grants: "All tools", an exact list, or none; imported bots land with no grants; grants never
  appear in exports [O3].
- Least-privilege scoped key: Sessions r/w, Toolkits r, Connected accounts r/w [O3].
- Scope gaps (e.g. Gmail settings) need a custom auth config with your own OAuth app [O3].
- A paid cloud plan uses OpenMausBot's own managed broker instead of the user's Composio project [O3].
- No Pipedream integration found in the code (grep of `server/`, `shared/`).

### 2.2 Rakazo (Apache-2.0) [R1]

- Managed catalogues are optional: `COMPOSIO_API_KEY`, or the Pipedream Connect trio
  (`PIPEDREAM_CLIENT_ID/SECRET/PROJECT_ID`). Users can also add an HTTPS MCP server, a Treg endpoint
  or an OpenAPI document without either catalogue. "Connector credentials are encrypted on the
  server and are never returned by the API." [R1]
- **Composio** (`packages/adapters/src/composio-connector.ts`) uses `@composio/core` sessions per
  user, with `manageConnections: false` and **`sandbox: { enable: false }`**, scoped to the user's
  connected toolkits and explicit connected-account IDs; it also expands `MULTI_EXECUTE` into
  individual calls before executing and sanitises errors and payloads [R2].
- **Pipedream** (`pipedream-connector.ts`): calls Pipedream's remote MCP endpoint
  `https://remote.mcp.pipedream.net/v3` with headers `x-pd-project-id`, `x-pd-environment`,
  `x-pd-app-slug` and an `x-pd-external-user-id` that is an **HMAC of space+user** (so Pipedream never
  sees our real user IDs); tokens and client secret are redacted from results; large catalogues are
  exposed lazily through a catalogue wrapper tool [R3].
- **Approvals** (`packages/core/src/action-approval.ts`): a connector tool needs approval if it
  declares `readOnly: false`, if its name matches a mutating-verb pattern (`send`, `create`,
  `delete`, `post`, `share`, `pay`, … ) or a compound pattern (`_and_`, `_or_`, `_then_`), or if it
  does **not** match the read-only pattern — "a declared read never relaxes the name check: the
  provider chooses both the name and the hint" [R4]. Unattended (trigger) runs always ask for
  approval on connector writes; users can add rules; an optional LLM "auto review" judge exists but
  cannot override mandatory approvals (`executor.ts` ~L4170–4420) [R5].

### 2.3 What to take

1. OpenMausBot's **harness-owned stdio bridge** as the only MCP server an agent sees, with policy at
   the harness (not trusting the agent's own permission prompt).
2. OpenMausBot's **deny-unrecognised** rule and **MULTI_EXECUTE unpacking** (better: don't expose
   meta-tools at all, as Rakazo does with the sandbox off).
3. Rakazo's **write-by-default classification** (unknown = write = Ask first) and "a hint never
   relaxes the name check".
4. Rakazo's **HMAC'd external user IDs** for any third-party broker.
5. Both: tokens never in the transcript; connection flows are UI cards driven by the office.

---

## 3. Alternatives and complements

| Option | What it is | Licence | Self-host | Token custody | Security notes |
|---|---|---|---|---|---|
| **Self-hosted MCP servers** (official vendor servers, e.g. GitHub's; community servers) | One process per app, stdio or HTTP | Per server | Yes | Ours (env/secret store) | Quality varies; pin versions, run in containers, review code |
| **Docker MCP Gateway + Catalog** | Gateway that runs catalogue MCP servers in containers behind one endpoint | MIT [D1] | Yes (Docker CE works) [D2] | Docker Desktop secrets API or a `.env` file; secrets scoped to the declaring server [D1][D3] | Containers get no host env, `no-new-privileges`, CPU/memory limits, read-only validated binds; `--block-network` and per-server `allowHosts`/`disableNetwork`; `--block-secrets` (default on) scans args/results; `--verify-signatures` (default on for `mcp/` images, by digest); `--log-calls` (default on, names + arg shape only); per-profile tool allowlist `docker mcp profile tools --enable server.tool`; interceptors `--interceptor before:exec:/path` [D1][D3][D4] |
| **Pipedream Connect** | Hosted OAuth + app actions, remote MCP (`remote.mcp.pipedream.net`) [R3] | Proprietary (now part of Workday; deal announced 2025-11-19) *(secondary)* [P1] | "Self-hosted MCP" described as reference only *(secondary)* [P1] | Pipedream, encrypted at rest *(secondary)* [P1] | Same third-party-custody model as Composio; Rakazo's integration pattern [R3] |
| **Nango** | Self-hostable OAuth + proxy (+ functions/MCP in paid tiers) | Elastic License 2.0 (source-available, not OSI) [N1] | Free self-host covers Auth + Proxy; Functions/webhooks/MCP reportedly Enterprise *(secondary)* [N2] | **Ours** when self-hosted | Best fit if we want our own token vault for a stricter tier; ELv2 forbids reselling as a hosted service [N2] |
| **Arcade.dev** | Tool-calling platform with per-user OAuth ("agent authorization") | `arcade-mcp` framework MIT [A1]; Engine is a commercial runtime | Helm chart installs the full platform on your Kubernetes with your OIDC IdP; Azure managed app; AWS private offer [A2] | Arcade Engine (ours if self-hosted) | Self-hostable alternative to Composio with a smaller catalogue *(secondary)* |
| **Klavis (Strata)** | Open-source MCP servers + "Strata" progressive-discovery MCP | Apache-2.0 *(secondary)* [K1] | Docker images per server, `strata-mcp` CLI | Ours when self-hosted | Useful source of container-ready MCP servers; hosted Strata is a third party |

---

## 4. Recommended connector architecture for Elenta

### 4.1 One gateway, three tiers

All connector traffic goes through one office-owned component, the **Connector Gateway**. Agents
never get a Composio key, an OAuth token, or a direct MCP URL.

```
 agent (ACP adapter) ──stdio MCP──▶ elenta-connectors (bridge, per piece)
                                         │  tools/list filtered to the person's grants
                                         ▼
                              Office server: Connector Gateway
                     policy (Allow / Ask first / Never) · approval cards · audit · budgets
                       │                     │                          │
             Tier A: Local            Tier B: Composio            Tier C: none
        Docker MCP Gateway          (direct tools preset,          (department
        + self-hosted servers        sandbox off, ZDR,              has no
        (Nango later for tokens)     own OAuth apps)                connectors)
```

Mechanics, matching what we already have:

- In `session/new` the runner passes exactly one MCP server, `elenta-connectors` (stdio), built for
  that piece with the person's grants in its environment — the OpenMausBot bridge pattern [O5]. The
  ACP client supplies `mcpServers` in `session/new` (SPEC §5 already sets it to `[]`).
- `server/policy.mjs` today rejects every `mcp__*` tool (rule e). Replace that line with a lookup in
  the grants table for `mcp__elenta-connectors__<TOOL>`; keep rejecting every other `mcp__*`.
- **Enforcement happens twice**: in `session/request_permission` (the adapter asks before a tool
  runs), and again in the Gateway when the bridge forwards the call. The second check is the real
  one, because it does not rely on the agent asking.
- **Ask first** pauses the piece and shows an inline approval card (tool, account, the exact
  arguments, a diff/preview for documents and messages). Approval is one-shot for those arguments;
  the gateway replays exactly the approved arguments (Rakazo's replay queue does this [R5]).
- **Audit**: every listed, allowed, asked, approved, refused and executed call is an `audit.jsonl`
  entry (tool, tier, account alias, department, person, job, decision, rule, argument hash, result
  size, Composio log ID). For Tier B also keep the Composio log ID so the two can be reconciled [R2].

### 4.2 Tier B: Composio for everyday business apps (default for most departments)

This is what makes teammates useful: mail, calendar, drive/docs, Slack/Teams, CRM, Linear/Jira,
GitHub, Notion, accounting.

Settings for every Composio session the office creates:
- `toolkits: { enable: [<department's toolkits>] }`, `tools: { <toolkit>: { enable: [<granted>] } }`
  [C3]; **direct tools preset** (no meta-tools, no tool search) [C3];
- `sandbox: { enable: false }` (no remote workbench/bash) [C3][C12]; `instant: false` [C12];
  no triggers for sensitive data [C12];
- `manageConnections: false`; connections are made from the office UI, not by the agent [R2][O5];
- explicit `connectedAccounts` per toolkit, per department [R2];
- `allowTracking: false` in the SDK [C6];
- project with **ZDR on**, **our own OAuth apps** (custom auth configs) for Google/Microsoft/Slack so
  ZDR applies and we control scopes [C12][C7];
- one Composio **project per department** (projects isolate data and keys [C11]) or at least one
  `user_id` per department (`HMAC(office, dept)` as Rakazo does for Pipedream [R3]); scoped API keys
  with IP allowlisting [C11]; keys in the secret store, never in agent env.

### 4.3 Tier A: local / self-hosted MCP in containers (stricter departments, and anything internal)

For departments that must keep data on the machine/network, and for internal systems (file shares,
the Buzz relay, internal wiki, local databases):
- Run servers through the **Docker MCP Gateway** with `--block-network` (or `allowHosts` naming only
  the internal host), signature verification on, `--block-secrets` on, read-only binds, CPU/memory
  limits [D3]. The Gateway's own per-profile tool allowlist is a second line behind ours [D1].
- Secrets via the gateway's secret store, scoped per server [D3]; later, a self-hosted **Nango** for
  OAuth tokens to cloud apps that a stricter department still needs, so tokens stay in our vault [N1][N2].
- Pin images by digest; review any community server before enabling.

### 4.4 Per-department scoping and approvals

Grants live in the org/settings files (with "imports start with no grants", as OpenMausBot does [O3]):

```json
"connectors": {
  "business": {
    "tier": "composio",
    "accounts": { "gmail": "finance@", "googlecalendar": "finance@" },
    "tools": {
      "GMAIL_FETCH_EMAILS": "allow", "GMAIL_SEND_EMAIL": "ask", "GMAIL_DELETE_MESSAGE": "never"
    },
    "default": "ask"
  },
  "military": { "tier": "local", "servers": ["internal-wiki"], "default": "never" }
}
```

Default classification when a tool isn't listed: reads → **Allow** only if the name matches a
read-only pattern; everything else → **Ask first** (Rakazo's rule: unknown = write; the provider's
read-only hint never relaxes it) [R4]. Always **Ask first**, never auto-allowed: send, post, share,
invite, delete, pay, anything that changes permissions, anything to an external recipient, and any
run with no person watching (scheduled routines) [R4][R5]. **Never**: remote code/bash tools,
connection management by the agent, `MULTI_EXECUTE`, proxy-execute (arbitrary provider endpoints)
[C7][C15]. A refusal never lists what else is granted [O6].

### 4.5 What we gain vs what we accept (Tier B)

Gain: hundreds of maintained integrations, OAuth handled, multi-account support, SOC 2 Type II [C11].
Accept: Composio holds the tokens and sees every argument and result in transit [C7][C13]; logs keep
payloads up to a year unless ZDR [C13]; a 2026 breach forced key rotation [C19]. Mitigations:
ZDR + own OAuth apps, narrow scopes, per-department projects, Ask-first on writes, our own audit as
the system of record, and quarterly key rotation. If the company later needs the tokens in its own
infrastructure, the paths are Composio's customer-managed-key or self-hosted Enterprise options [C7],
or Arcade self-hosted [A2], or Nango [N1].

---

## 5. Phased plan

1. **Gateway skeleton (no external apps).** `elenta-connectors` stdio bridge, grants table, policy
   change in `policy.mjs`, approval cards, audit entries; one harmless local Tier A server (e.g. a
   read-only internal-notes MCP in Docker MCP Gateway) to prove the path end to end. Tests: unknown
   tool → ask; `mcp__other__*` → reject; refused call never lists grants.
2. **Composio pilot for one department (Business).** Gmail + Calendar + Drive read tools Allow,
   send/create Ask first; ZDR project, own Google OAuth app, sandbox off, direct tools preset,
   tracking off. Measure approvals per job and latency.
3. **Breadth.** Department packages declare their toolkits; connection UI with labelled accounts;
   Slack/Teams, CRM, tickets, GitHub. Budget the tool calls in the cost ledger (Composio meters per
   call [C10]).
4. **Stricter tier where needed.** Docker MCP Gateway profiles with `--block-network`/allowHosts for
   departments marked `tier: local`; self-hosted Nango if such a department needs a cloud app with
   tokens kept in our vault.
5. **Hardening and review.** Key rotation runbook (the May 2026 incident shows why [C19]), Composio
   log reconciliation, written answers from Composio on residency/ISO/sub-processors, and an
   Enterprise quote if customer-managed keys become a requirement.

---

## 6. Controlled work (ITAR/CUI) — short

- No Tier B (Composio, Pipedream, Rube/Connect, Arcade cloud, hosted Strata) for any department or
  job that handles export-controlled technical data or CUI: these are third-party clouds with no
  FedRAMP authorization (Composio [C14]) and no documented US-only residency or US-person access
  controls [C18]. That department's `default` is **Never**, tier `local`.
- Only Tier A servers that reach systems already approved for that data, with `--block-network` /
  `allowHosts` to those systems [D3]. A connector being local does not make the data permissible;
  that stays a compliance decision (same rule as SPEC §10.9 for local models).
- Never connect, for those departments: personal or company mail/chat/drive accounts in commercial
  clouds, public code hosting, CRM, AI/LLM "instant" tools, triggers/webhooks to external endpoints,
  or any tool that uploads files to a third party.

---

## Sources

Composio
- [C1] Composio Connect / catalogue claim "1000+ apps": `docs/content/docs/composio-connect.mdx` in github.com/ComposioHQ/composio @ `d9f6291`.
- [C2] `docs/content/docs/how-composio-works.mdx` (same repo).
- [C3] `docs/content/docs/configuring-sessions.mdx` — toolkits/tools enable, empty allowlist, direct tools preset, disabling the sandbox.
- [C4] `docs/content/docs/sessions-via-mcp.mdx` (docs.composio.dev/docs/sessions-via-mcp).
- [C5] `LICENSE` (MIT, Sampark Inc.) and repo tree, github.com/ComposioHQ/composio @ `d9f6291`.
- [C6] `ts/packages/core/package.json` (ISC, v0.22.0); `src/models/Tools.ts` (`executeComposioTool`, modifiers); `src/utils/constants.ts` (`DEFAULT_BASE_URL`, `TELEMETRY_URL`); `src/composio.ts` (`allowTracking` default true); `src/models/MCP.ts` (deprecation note).
- [C7] `docs/content/docs/security/token-custody.mdx` (docs.composio.dev/docs/security/token-custody).
- [C8] `docs/kb/source/platform/self-hosted-helm/public.md` (KB, 2026-06-24).
- [C9] Search results: composio.dev/pricing.md, support.composio.dev/m/1340459156334837791 (staff reply on self-hosting), docs.composio.dev/introduction/pricing *(secondary)*.
- [C10] Search results: usagepricing.com/blueprint/activity/composio-2026-07-23-packaging, dailyaifixs.com/blog/composio-pricing-2026-the-75-tool-call-cut, scalekit.com/blog/composio-pricing-change *(secondary)*.
- [C11] `docs/content/docs/security/overview.mdx` (docs.composio.dev/docs/security/overview).
- [C12] `docs/content/docs/security/zero-data-retention.mdx`.
- [C13] `docs/content/docs/security/data-retention.mdx`.
- [C14] `docs/content/kb/guide/platform-compliance-data-handling.mdx` (verified 2026-08-12).
- [C15] `docs/content/docs/composio-connect.mdx` — "Available MCP tools".
- [C16] composio.dev/blog/rube-mcp-solving-context-overload; mintlify.com/composiohq/composio/mcp/rube; composio.dev/content/best-mcp-servers *(secondary)*.
- [C17] `docs/kb/source/platform/rate-limits/public.md` (2026-07-16).
- [C18] Web search "Composio trust center ISO 27001 … data residency" (2026-10-08): only SOC 2 Type II confirmed.
- [C19] composio.dev/content/composio-may-2026-security-incident (via search summary) *(secondary)*.
- [C20] thehackerwire.com/vulnerability/CVE-2026-59807; cve.imfht.com/product/composio *(secondary)*.

OpenMausBot (github.com/milind-soni/OpenMausBot @ `7c28a1d`)
- [O1] `README.md` L72, L135.
- [O2] `LICENSING.md` (Apache-2.0, `enterprise/` under a separate licence).
- [O3] `docs/composio.md`.
- [O4] `server/composio.ts` (`trustedSessionMcpUrl`, `/tool_router/session`).
- [O5] `server/connector-proxy.ts` (header comment).
- [O6] `server/connector-verdict.ts` (header comment).

Rakazo (github.com/elie222/rakazo @ `40748a1`)
- [R1] `README.md` L43, L61, L126–130; `LICENSE`.
- [R2] `packages/adapters/src/composio-connector.ts` (`sessionFor`, `sessionForExecute`, `execute`).
- [R3] `packages/adapters/src/pipedream-connector.ts` (`MCP_ENDPOINT`, `externalUserId`, `mcpHeaders`, `execute`).
- [R4] `packages/core/src/action-approval.ts` (`connectorToolRequiresApproval` and patterns).
- [R5] `packages/adapters/src/executor.ts` ~L4170–4420; `approval-effect.ts`.

Docker
- [D1] github.com/docker/mcp-gateway `README.md` (MIT; profiles, `docker mcp profile tools`, secrets, OAuth).
- [D2] docker.com/blog/docker-mcp-gateway-secure-infrastructure-for-agentic-ai (open source, works with Docker CE) *(secondary)*.
- [D3] github.com/docker/mcp-gateway `docs/security.md` (isolation, `--block-network`, `--block-secrets`, `--verify-signatures`, `--log-calls`, secret scoping).
- [D4] docs.docker.com/reference/cli/docker/mcp/gateway/gateway_run (`--interceptor`, `--secrets`) *(secondary)*.

Others
- [P1] pipedream.com/connect ("has joined Workday"); rywalker.com/research/pipedream; scalekit.com/blog/pipedream-alternatives *(secondary)*.
- [N1] github.com/NangoHQ/nango `LICENSE` (Elastic License 2.0).
- [N2] nango.dev/docs/guides/platform/free-self-hosting; getknit.dev/blog/nango-review-evaluation-integration-platform *(secondary)*.
- [A1] github.com/ArcadeAI/arcade-mcp `LICENSE` (MIT, 2025 Arcade AI).
- [A2] docs.arcade.dev/operate/deploy, /operate/deploy/helm, /aws, /azure *(secondary)*.
- [K1] dev.co/ai/frameworks/klavis; jimmysong.io/ai/klavis (Apache-2.0, Strata) *(secondary)*.
- Elenta: `SPEC.md` §5, §10.9; `docs/FEATURE-PLAN.md` §2–3; `server/policy.mjs` (rule e rejects `mcp__*`).

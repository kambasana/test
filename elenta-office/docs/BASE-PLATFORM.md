# Base platform: Elenta Office on Buzz (with a Paperclip comparison)

Status: design proposal, 2026-10-07. Nothing in `server/` or `web/` has been changed.

Sources: Block's Buzz (Apache-2.0) at `/home/user/buzz`, commit `1972b7d`; relay image
`ghcr.io/block/buzz:main` at digest `sha256:96f43f552ff6d5c71333a4c686d9d01873747206f1382d6fb17f7ad1648df2a5`,
which reports relay version 0.2.1 over NIP-11. Paths below without a prefix are relative to
`/home/user/buzz`. Line numbers are for that commit. A claim marked **(ran)** was checked against the
running relay in this environment. A claim marked **(code)** was read in the source but not run.

---

## 0. Summary

- **What works:** the Buzz relay ran here with Postgres, Redis and MinIO **(ran)**. Our Node code
  could authenticate (NIP-42), create a private channel for a department, add an agent identity,
  post a job, reply in a thread, react, query over NIP-98 HTTP, and read everything back.
  Buzz enforced private-channel isolation and refused events whose signing key did not match the
  logged-in key. An independent Node verifier recomputed Buzz's audit hash chain and caught an
  edited row.
- **What we must not adopt:** Buzz's agent side (`buzz-acp`, `buzz-agent`, `buzz-dev-mcp`). It
  contradicts SPEC §5–§6:
  - It approves every tool permission by default.
  - It gives agents a shell and file edits with no path containment.
  - It puts the agent's private key in the environment of the agent and its tools.
- **What is unfinished in Buzz and touches us:**
  - Workflow approval gates are not built. A run that reaches one is marked failed.
  - The job kinds 43001–43006 are in the kind registry, but the relay rejects them **(ran)**.
- **Recommendation:**
  - Keep our control plane: Boss routing, planning, ACP runs with our permission policy, budgets,
    approvals.
  - Add the Buzz relay as an optional system of record behind a flag, in phases (§9).
  - Keep "our own" as the default until phase 3 passes.
  - The Paperclip evaluation could not be done in this session (§11), so it stays open.

---

## 1. What was run

Everything ran on this machine. The Buzz stack is still running, bound to `127.0.0.1:3000`. Stop it
with `cd /home/user/buzz/deploy/compose && ./run.sh stop`. Probe scripts are in
`/home/user/buzz-probe/` (outside our repo).

| Step | Result |
|---|---|
| `docker info` | The daemon was not running. `dockerd` started in the background without trouble (cgroup v1 warning only). |
| `docker pull ghcr.io/block/buzz:main postgres:17-alpine redis:7-alpine` | All pulled. Network egress allowed ghcr.io and Docker Hub. |
| `deploy/compose/.env` from `.env.example`, secrets from `openssl rand`, keys from `buzz-admin generate-key` (run inside the image) | OK. `BUZZ_HTTP_PORT=127.0.0.1:3000` keeps the published port on loopback; `docker ps` shows `127.0.0.1:3000->3000/tcp`. |
| `./run.sh start` | Relay, Postgres, Redis, Silo/MinIO and minio-init all healthy, about 60 s with `BUZZ_AUTO_MIGRATE=true`. |
| `curl /_liveness`, NIP-11 | `ok`. NIP-11 reports `auth_required:true`, `restricted_writes:true`, `max_message_length:524288`, `supported_nips:[1,2,10,11,16,17,23,25,29,33,38,42,50,56,43]`. |
| `probe.mjs` (nostr-tools 2.23.3 + ws, raw NIP-01) | The owner authenticated (NIP-42) and ran kind 9030 (add relay member), kind 9007 (create a private stream channel with a UUID we chose), kind 9000 (add the agent to the channel) and kind 9 (job root). The agent authenticated, read the history, sent a thread reply with NIP-10 `e` root/reply tags, and received live fan-out of 9, 9 and 7. |
| Outsider key | Refused at AUTH: `restricted: not a relay member`. |
| Relay member who is not in the channel | REQ refused with `CLOSED restricted: not a channel member`; EVENT refused the same way. |
| Event signed by key B on a connection logged in as key A | `invalid: event pubkey does not match authenticated identity`. |
| `POST /query` with NIP-98 | 200 with the channel's events. The body must be a JSON **array** of filters; an object gives 400. |
| `ws://127.0.0.1:3000` instead of `ws://localhost:3000` | HTTP 404. The community comes from the Host header, and an unknown host fails closed (ARCHITECTURE.md:220-228). |
| `probe3.mjs`: kinds 43001–43004 and 43050 | `restricted: unknown event kind`. Kinds 40002 and 1 accepted. Kind 30078 accepted but stored **global**, not channel-scoped. Kind 46030 needs an approval `d`/`e` reference. |
| `verify-audit.mjs` (Node rewrite of `crates/buzz-audit/src/hash.rs:43-67`, v2 TLV) | 14/14 entries verified. After an `UPDATE audit_log` on one row: 1 mismatch reported. Row restored and re-verified. |
| Paperclip clone (`git clone`) | **Blocked** by the session's permission classifier ("untrusted code integration"). The GitHub API also has no access to that repo in this session. Not retried, not worked around. |

---

## 2. Buzz, as it stands

### 2.1 Protocol, channels, threads, DMs

- Every action is a signed Nostr event. The `kind` integer is the only dispatch key
  (ARCHITECTURE.md:152-167).
- Channels are NIP-29 groups addressed by `["h", <uuid>]`.
  - Create with kind 9007, using `name`, `visibility` (open/private) and `channel_type`
    (stream/forum/…) tags.
  - The client may choose the UUID through the `h` tag (`crates/buzz-relay/src/handlers/ingest.rs:3005-3080`) **(ran)**.
  - Add and remove members with 9000/9001. Edit metadata with 9002.
  - The relay signs discovery events 39000/39001/39002 (NOSTR.md "What Works").
- Messages are kind 9 (or 40002 rich, 40003 edit), and they must carry `h`
  (`ingest.rs:2642`). Threads follow NIP-10: `["e", root, "", "reply"]` builds `thread_metadata`,
  and unknown parents are rejected (NOSTR.md).
- Reactions are kind 7. Their channel is taken from the target `e` tag.
- DMs are NIP-17 gift wraps (kind 1059), stored community-global and p-gated. NIP-04/44 DMs are not
  implemented.
- The **only** authorization gate is channel membership (SECURITY.md:65-74). Private channels are
  invisible to non-members **(ran)**.
- Fan-out keeps channel-scoped subscriptions apart from global ones (ARCHITECTURE.md:292-294).
  Clients must open the live subscription before or overlapping the history REQ
  (ARCHITECTURE.md:379-386).

### 2.2 Event kinds we care about

Source: `crates/buzz-core/src/kind.rs`, 133 constants.

| Kind | Name | Relay accepts? |
|---|---|---|
| 0 | profile | yes (NOSTR.md) |
| 5 / 7 / 9 | delete / reaction / stream message | yes **(ran 7, 9)** |
| 9000/9001/9002/9007/9008 | NIP-29 group admin | yes **(ran 9000, 9007)** |
| 9030/9031/9032 | NIP-43 relay member add/remove/role (owner/admin only) | yes **(ran 9030)** |
| 1059 | NIP-17 gift wrap | yes |
| 20001 / 20002 | presence / typing (ephemeral, not stored, not audited) | yes |
| 40002 / 40003 | rich message / edit | yes **(ran 40002)** |
| 40100 | canvas | yes (`ingest.rs:580`) |
| 43001–43006 | JOB_REQUEST … JOB_ERROR (`kind.rs:518-530`) | **no**: missing from `required_scope_for_kind` (`ingest.rs:499-607`) → "restricted: unknown event kind" **(ran)** |
| 44100/44101 | member added/removed notifications (relay-signed) | relay only |
| 44200 | agent turn metric (NIP-AM, encrypted to owner) | yes (`ingest.rs:509`) |
| 30620 | workflow definition | yes (`ingest.rs:605`) |
| 46001–46012 | workflow run events (relay-emitted) | relay only |
| 46030/46031 | approval grant/deny | accepted only with an approval reference; gates unfinished (§2.6) |
| 48001 | AUDIT_ENTRY (`kind.rs:594`) | defined; no producer found |

### 2.3 Identity and key handling

- An identity is a secp256k1 key. Humans and agents look the same on the wire.
- **Desktop:** human and managed-agent nsecs are kept in the OS keyring, with a 0600 file as
  fallback. `BUZZ_PRIVATE_KEY` overrides both and is how harnessed agents get their key
  (SECURITY.md:85-102).
- **buzz-acp:** reads `BUZZ_PRIVATE_KEY` (`crates/buzz-acp/src/config.rs:254`). It then:
  - copies that key, bech32-encoded, into the env of the MCP server it configures
    (`crates/buzz-acp/src/lib.rs:6445-6474`);
  - spawns the agent with the harness's own env inherited. Only `NOSTR_PRIVATE_KEY` and git vars
    are removed, `BUZZ_PRIVATE_KEY` is not (`crates/buzz-acp/src/acp.rs:498-600`).
  - Result: the agent and anything it runs can read its signing key.
- **NIP-PMA (managed agents):** the agent nsec is stored *on the relay*, NIP-44-encrypted to the
  owner (`docs/nips/NIP-PMA.md:42-50,71-72`).
- **Remote agents:** handing over the key is called "a decision". On Kubernetes the key rests in a
  Secret (VISION_REMOTE_AGENTS.md:51).
- **NIP-OA owner attestation:** an `auth` tag in which the owner signs `agent_pubkey:conditions`.
  - Conditions are only `kind=`, `created_at<` and `created_at>`. All clauses must hold, and an
    event carries at most one tag (`docs/nips/NIP-OA.md`; `crates/buzz-sdk/src/nip_oa.rs:1-40`).
  - With `BUZZ_ALLOW_NIP_OA_AUTH=true`, any key with a valid tag from a member gets into a closed
    relay (`crates/buzz-relay/src/config.rs:290-302`).
  - The production template turns this on (`deploy/compose/.env.example:18`).

### 2.4 Authentication

- **WebSocket, NIP-42:** the relay sends a challenge on connect. The client answers with a signed
  kind 22242 (±60 s). A NIP-42 login gets all scopes (ARCHITECTURE.md:238-247, 420-436).
- **HTTP, NIP-98:** a kind 27235 event in `Authorization: Nostr <base64>` with URL, method and
  payload hash **(ran: /query)**.
- **Membership checks:**
  - `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` checks `relay_members` at AUTH (`handlers/auth.rs:174`) **(ran)**.
  - `BUZZ_REQUIRE_AUTH_TOKEN` covers REST token auth only; WebSocket auth is always required
    (`config.rs:185-187, 899-904`).
- **Rate limiting:** the docs say none exists (ARCHITECTURE.md:947). But a Redis-backed admission
  limiter is now wired (`crates/buzz-relay/src/state.rs:1288,1466`; `crates/buzz-pubsub/src/rate_limiter.rs:99`).
  The documentation is out of date, so do not rely on either statement without a test.

### 2.5 REST endpoints

Source: `crates/buzz-relay/src/router.rs:316-410`.

- **Nostr basics:** `GET /` (WebSocket upgrade or NIP-11), `/info`, `/.well-known/nostr.json`,
  `/health`, `/_liveness`, `/_readiness`.
- **Event bridge:** `POST /events`, `/query`, `/count` — same ingest as WebSocket, NIP-98.
- **Media (Blossom on S3/MinIO):** `PUT /upload` or `/media/upload`; `GET/HEAD /media/{sha256.ext}`.
- **Workflows:** `GET /workflows/{id}/runs` and `/runs/{run}/approvals`. These are read-only; runs
  and approvals are database rows, not events (`api/workflows.rs:3`). `POST /hooks/{id}` is the
  webhook trigger; the secret is the URL.
- **Operator:** `/operator/communities*`, `/operator/listener/pubkeys`.
- **Invites and moderation:** `/api/invites*`, `/api/join-policy*`, `/moderation/*`.
- **Other:** `/api/nip-fi/disconnect`, GIF proxy, and `/huddle/{channel}/audio` (WebSocket Opus).
- **Mounted only when enabled:** `/api/admin/v1` (when `BUZZ_ADMIN_HOST` is set) and `/buzz/v1`
  (`router.rs:300-314`).
- **Git smart HTTP:** `/git/{owner}/{repo}/…` (ARCHITECTURE.md:735-739).

### 2.6 Workflows and approval gates

- **Workflow format:** YAML. Triggers are `message_posted`, `reaction_added`, `schedule` and
  `webhook`. Actions are `send_message`, `send_dm`, `set_channel_topic`, `add_reaction`,
  `call_webhook`, `request_approval` and `delay` (ARCHITECTURE.md:602-660).
- **Not built:**
  - `send_dm` and `set_channel_topic` return `NotImplemented`
    (`crates/buzz-workflow/src/executor.rs:658,664`).
  - `request_approval` makes a token with "TODO (WF-08): create approval record in DB, emit
    kind:46010" (`executor.rs:739-745`).
  - The engine then marks the run **Failed** with `approval_not_supported`
    (`crates/buzz-workflow/src/lib.rs:229-250`).
  - README lists approval gates as "being wired up" (README.md:103); see also
    ARCHITECTURE.md:645 and 950.
- **Consequence:** approvals stay in our control plane (§4).

### 2.7 buzz-acp: how it runs agents

- **Process model:** a standalone binary. It holds one relay WebSocket (NIP-42) and spawns 1–32 ACP
  agent subprocesses (default `goose acp`, `config.rs:201,261-270`). It queues @mentions per
  channel and sends one prompt per channel at a time (ARCHITECTURE.md:757-789).
- **Defaults that conflict with SPEC §5–§6:**
  - **Permission mode is `bypass-permissions`** (`config.rs:466-476`; the test at `config.rs:2475-2478`
    pins it). The comment there says it "skips the per-tool-call permission flow".
  - **Every `session/request_permission` is auto-approved with `allow_once`.** It falls back to
    `reject_once` only when no allow option is offered (`acp.rs:2005-2070`).
  - buzz-agent's comment says "the client applies `BUZZ_ACP_PERMISSION_POLICY`"
    (`crates/buzz-agent/src/permission.rs:1-8`). **No such policy exists anywhere else in the
    repo.**
  - For Codex, the harness *forces* `sandbox_workspace_write.network_access = true`
    (`acp.rs:270, 352-363`).
- **Tools given:** whatever `BUZZ_ACP_MCP_COMMAND` names (default empty, `config.rs:272`). In
  practice that is `buzz-dev-mcp` (`pool.rs:5698`), with the agent key in its env (§2.3).
- **Inbound gate:** `respond_to` defaults to `owner-only` (`config.rs:480-484`).

### 2.8 buzz-dev-mcp and buzz-agent: shell and file edits (flagged)

**buzz-dev-mcp** (VISION_AGENT.md:15: "gives any agent a shell and a file editor"):

| Tool | Behaviour |
|---|---|
| `shell` | `bash -c <command>` (`crates/buzz-dev-mcp/src/lib.rs:40-50`, `shell.rs:167-176`), up to 20 min (`shell.rs:16-17`). It inherits the server env, so **`BUZZ_PRIVATE_KEY` is readable**. Only PATH is set; there is no `env_clear`. |
| `read_file`, `str_replace`, `view_image` | `paths.rs:1-7`: "**No containment enforcement — the resolved path may land anywhere on the filesystem**". A test asserts that escaping through a symlink succeeds (`paths.rs:284-298`). |
| `view_image` | Also fetches http(s) URLs (`lib.rs:65`). |
| `todo` | Task list. |

There is **no** flag to switch off tools. VISION_AGENT.md:57 states the posture: "the shell runs at
the operator's trust level".

**buzz-agent** is an ACP agent with an LLM loop over Anthropic, OpenAI-compatible or Databricks
(`crates/buzz-agent/src/config.rs:645-729`). It does ask the client for permission on every MCP tool
call (`permission.rs:1-8`). That would be fine, except that its usual client, buzz-acp, says yes to
everything.

### 2.9 buzz-cli and buzz-sdk

- **buzz-cli** is a Rust, JSON-in/JSON-out CLI for agents (`crates/buzz-cli/src/commands/*`:
  channels, messages, dms, workflows, repos, …). It signs with `BUZZ_PRIVATE_KEY`.
- **buzz-sdk** holds Rust event builders such as `build_message`, `build_create_channel`,
  `build_add_member` and `build_workflow_approval` (`crates/buzz-sdk/src/builders.rs:240-1898`), and
  NIP-OA (`nip_oa.rs`).
- Neither is needed from Node. The tag shapes they produce are the reference for our builders.

### 2.10 JavaScript clients we could reuse

- **`web/`:** a small public site (repos, invites). Its `web/src/shared/lib/nostr-client.ts`
  (175 lines: NIP-01 query with NIP-42 AUTH), `nip98.ts` (48) and `nostr-signer.ts` (106) are
  plain nostr-tools code, Apache-2.0. They are a good pattern for a Node-side client. It is not a
  chat UI.
- **`desktop/`:** Tauri + React. Its relay session (`desktop/src/shared/api/relayClientSession.ts`,
  1199 lines) sends frames through `invoke("plugin:websocket|send")` (line 712). Signing happens in
  Rust (`desktop/src-tauri/src/app_state_accessors.rs:52`). It does **not** run in a plain browser
  or in Node, so it is not reusable as a library.
- Both depend on `nostr-tools ^2.23.3` (Unlicense) (`web/package.json:32`, `desktop/package.json:104`).
  Our probe used exactly that.

### 2.11 Audit and hash chain

- **What is logged:** `buzz-audit` writes one row per stored event (and channel/member/auth actions)
  to `audit_log`. Each row's SHA-256 covers community, seq, time, action, actor, object id,
  canonical detail and prev_hash (v2 TLV, `crates/buzz-audit/src/hash.rs:43-67`). A
  `pg_advisory_lock` keeps a single writer (ARCHITECTURE.md:586-600).
- **Limits:**
  - It is **keyless**: "an attacker with database write access can recompute the entire chain"
    (SECURITY.md:78-83).
  - Audit writes are fire-and-forget after the event is stored (ARCHITECTURE.md:286-290). A failed
    audit write leaves the event stored with no audit row.
  - `verify_chain` exists (`crates/buzz-audit/src/service.rs:171`) but is called only from tests.
    There is no operator command or API for it.
  - Detail holds `event_kind` and `channel_id`; the event content is covered only through the
    signed event id.
- **(ran)** Our Node verifier reproduced the chain and detected an edited row.

### 2.12 Unfinished or inconsistent, as it affects us

1. Approval gates (WF-08) and two workflow actions (WF-07).
2. Job kinds 4300x are defined but rejected by ingest.
3. NIP-29 invites (9009) do nothing; kind 39003 roles are not emitted (NOSTR.md "What Doesn't Work").
4. Live discovery of 39000 needs historical REQs (NOSTR.md "Group Discovery" note).
5. Documentation drift:
   - Frame size: 65,536 in ARCHITECTURE.md:212 against `max_message_length: 524288` in live NIP-11.
   - Rate limiting: "none" in the docs against the Redis admission limiter in code.
6. The image tag `:main` is unpinned (`deploy/compose/compose.yml:5`). The bootstrap script that
   should generate `.env` "should eventually" exist (`deploy/compose/README.md`).

---

## 3. What Buzz becomes, what we keep

| Concern | Owner | Notes |
|---|---|---|
| Identities (owner, each person, Boss, leads) | **Buzz** (keys held by our control plane, §5) | kind 0 profile per person; relay membership via 9030. |
| Departments | **Buzz** private stream channel per department, plus `#office` (Boss/Command) | UUIDv5(namespace, `org-title/dept-key`) so the sync is idempotent. |
| Jobs | **Buzz thread** (kind 9 root in the department channel), mirrored in `data/jobs.json` | `jobs.json` becomes a cache from phase 4. |
| Pieces, plans, summaries, deliverable-ready, inter-agent messages (§10.5) | **Buzz** kind 9 replies in the job thread, signed by the acting person's key | Structured tags (§6). |
| Approvals | **Our control plane decides**; the decision is recorded on Buzz as an owner-signed event | Until WF-08 lands and fits our model. |
| Audit of business events | **Buzz** `audit_log` (automatic) + our verifier | |
| Audit of permission decisions, file reads/writes, session tool lists | **Ours** (`data/audit.jsonl`, hash-chained from phase 4) | Too fine-grained and too sensitive for the shared log. Cross-anchored (§8.6). |
| Boss routing, team planning, combining | **Ours** (`server/jobs.mjs`) | Unchanged. |
| ACP runs, permission policy, fs containment, tool whitelist | **Ours** (`server/runner.mjs`, `policy.mjs`, `acp.mjs`) | buzz-acp is **not** used (§2.7). |
| Budgets, circuit breaker, cost ledger (SPEC §10.1–2) | **Ours** | NIP-AM 44200 could later carry per-turn metrics encrypted to the owner; not needed. |
| Library, lessons, personal memory | **Ours** (files) | A summary event may point to them (sha256), not their content. |
| Deliverable files | **Ours** (`deliverables/`), with sha256 + size anchored in a Buzz event | Blossom upload is optional (phase 5). It adds MinIO data that must be backed up. |
| Live UI stream | **Ours** (SSE), fed from relay subscriptions | §7. |
| Presence (floor rings) | Buzz kind 20001 published by our control plane; ours locally | Ephemeral, not audited. |

---

## 4. Approvals until Buzz's gates work

Approvals stay in `JobEngine.decide()`. On approve or reject, the control plane publishes, **signed
with the owner key**:

- a kind 9 reply in the job thread with
  `["elenta","approval"], ["decision","approve"|"reject"], ["x", <sha256 of deliverable.md>]`
  and the note as content;
- a kind 7 `+` or `-` on the deliverable-ready event, so plain Nostr clients show it.

We do **not** use 46030/46031, because they need a relay approval row that WF-08 never creates. Once
WF-08 ships, revisit: a Buzz workflow could hold the gate, but our model (owner approves a
deliverable hash) is simpler and already works.

---

## 5. Key custody

1. **The control plane holds every key; agents hold none.**
   - Keys live in `data/keys/` (0600, one file per identity, owner-only dir), loaded at start.
     The OS keyring comes later.
   - Keys are never placed in `process.env`. `adapterEnv()` copies `process.env` into the adapter
     (`server/acp.mjs:24-33`); a unit test must assert that no `nsec1`/64-hex key and no
     `BUZZ_PRIVATE_KEY` reach the adapter env.
2. **Signing proxy.** When an agent "says" something (piece summary, message to the lead), it writes
   `out/…` as today. The office checks it against policy and then signs and publishes **as that
   person**. Authorship on the relay is therefore "this office vouches that person X produced this",
   which is what we can honestly attest.
3. **Owner key.** Held by the office server too, so approvals clicked in the UI are signed by the
   server on the owner's behalf. Say this plainly in the UI ("signed by this office for <owner>").
   Phase 5 option: NIP-07 browser signing for approvals only.
4. **Relay key.** `BUZZ_RELAY_PRIVATE_KEY` lives only in the Buzz stack's `.env` (0600) and is never
   readable by the office or the agents.
5. **NIP-OA off.** Set `BUZZ_ALLOW_NIP_OA_AUTH=false`. Members are added explicitly with 9030.
   - A conditions string can name at most one kind that an event can satisfy, and a leaked tag can
     be reused until any `created_at<` bound passes. That makes it a poor fit.
6. **Rotation and removal.** Remove a person with 9001 (channel) and 9031 (relay), then generate a
   new key. History stays signed by the old key and is mapped to the person by the org file
   (`keys` history).
7. **Do not use NIP-PMA.** It puts agent nsecs on the relay, even if encrypted (§2.3).

---

## 6. Event mapping

All channel events carry `["h", <dept-channel-uuid>]`. Thread replies carry
`["e", <job-root-id>, "", "root"]` plus `["e", <parent>, "", "reply"]` where needed. Our machine
tags use the `elenta` namespace, so plain clients just show text.

| Elenta concept (SPEC) | Buzz event | Signed by | Tags / content |
|---|---|---|---|
| Org applied | 9007 per department (+ `#office`), 9002 for `about` | owner | `name`, `visibility=private`, `channel_type=stream`, `about` |
| Person exists | kind 0 profile; 9030 relay member; 9000 into own department | person (0); owner (9030/9000) | profile `name`, `about=role/does`, `bot:true` |
| Department switched off | 9002 `archived` (needs AdminChannels) or just stop posting | owner | Keep the channel; history stays. |
| `job.created` | 9 (thread root) | owner | `["elenta","job"]`, `["job",<id>]`, `["mode",team\|single]`; content = request text |
| `job.routed` (Boss) | 9 reply in the `#office` thread by Boss; new root in the target department | boss | `["elenta","routed"]`, `["dept",<key>]`, `["why",…]`. Cross-channel link as a `["job",<id>]` tag, **not** an `e` reply (unknown or cross-channel parents are rejected, NOSTR.md). |
| `job.planned` | 9 reply | lead | `["elenta","plan"]`; content = plan summary; one `["p",<person>]` per piece owner |
| Piece assigned | 9 reply | lead | `["elenta","piece"]`, `["piece",<id>]`, `["p",<person>]`, `["team",<name>]` |
| Piece done/failed | 9 reply | person | `["elenta","piece-done"\|"piece-failed"]`, `["piece",<id>]`, `["x",<sha256 of out/piece.md>]`, `["size",n]` |
| Deliverable ready (`waiting_approval`) | 9 reply | lead | `["elenta","deliverable"]`, `["x",<sha256>]`, `["files",n]` |
| Approve / reject | 9 reply + 7 reaction | owner | §4 |
| Lesson added | 9 reply | owner | `["elenta","lesson"]`, `["x",<sha256 of lessons file>]` |
| Agent-to-agent message (§10.5) | 9 reply | sender person | `["elenta","msg"]`, `["act",…]`, `["p",<to>]`, `["hops",n]`; `inReplyTo` as an `e` reply |
| Job board (§10.6) | 40100 canvas per job (phase 5) | lead | Not verified on our setup yet. |
| Working / idle (floor rings) | 20001 presence | person | ephemeral |
| Cancel | 9 reply | owner | `["elenta","cancelled"]` |
| Permission decisions, file reads/writes | **not on Buzz** | — | Our audit only (§3). |

Later, once a small upstream change adds 43001–43006 to `required_scope_for_kind`
(`ingest.rs:499-607`), switch job lifecycle events to those kinds. Prefer an upstream PR; a fork
would oblige us to state changes (§10).

---

## 7. Our UI as a Buzz client

- **Keep the browser talking only to our server.** CSP `connect-src 'self'` stays
  (`server/http.mjs:15-17`). The browser holds no keys.
- **Server-side relay client.** Add `server/buzz.mjs`, about 300 lines, nostr-tools + Node 22's
  global `WebSocket`. It:
  - connects as the owner (NIP-42);
  - subscribes to `{kinds:[9,7], "#h":[all dept channels]}` live **before** the history REQ
    (ARCHITECTURE.md:379-386);
  - maps events to the existing SSE `job`/`activity` payloads, so `web/` keeps working unchanged;
  - handles CLOSED/reconnect and dedups by event id.
  The pattern of `web/src/shared/lib/nostr-client.ts` and `nip98.ts` can be followed. If code is
  copied, keep the Apache header and mark the changes.
- **Not reused:** the desktop relay client, because it is Tauri-bound (§2.10).
- **Optional:** Buzz Desktop (or any NIP-29 client) can be pointed at the same relay as a secondary
  read-only view of departments and threads for people who want chat. That is free, but it means
  those people get keys and relay membership.

---

## 8. Security review

### 8.1 Attack surface added

| Component | Exposure | Mitigation |
|---|---|---|
| Relay :3000 | WebSocket + REST + git smart HTTP + media upload + webhooks + operator + huddle audio | Bind `127.0.0.1` only (`BUZZ_HTTP_PORT=127.0.0.1:3000` **(ran)**). Closed relay (`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`, **(ran)**). `BUZZ_REQUIRE_AUTH_TOKEN=true`. No `BUZZ_ADMIN_HOST`, and never `BUZZ_ADMIN_AUTH=disabled` (`.env.example:49-56`: it exposes everything to anyone who can reach the port). No workflows with `call_webhook`. |
| Postgres | All content in plaintext, audit chain | Internal Docker network only, never published. Strong password. Backups encrypted. |
| Redis | Pub/sub, presence, rate-limit state | Internal only; `--requirepass` (compose.yml). |
| MinIO/Silo | Blossom media, git objects | Internal only; bucket `anonymous set none` (compose.yml minio-init). We do not upload by default. |
| Git volume / smart HTTP | Repos pushed by members | Unused by us. Leave it, but treat the endpoints as live surface. |
| Images | `ghcr.io/block/buzz:main` unpinned | Pin by digest (the one we ran is in the header). Review upgrades. |

### 8.2 Must stay on loopback or internal

- The relay's published port.
- Postgres 5432, Redis 6379, MinIO 9000/9001, metrics 9102, health 8080: **never** published.
- **Never** use `deploy/compose/compose.dev.yml`. It publishes Postgres, Redis, MinIO, Adminer and
  Prometheus on **all interfaces** with no host IP.
- The root `docker-compose.yml` binds `127.0.0.1` but carries fixed dev passwords
  (`docker-compose.yml:9,109-110`). Don't use it for real data.
- The relay picks the community from the Host header. Clients must use the configured domain
  (`localhost`); other hosts get 404 **(ran)**. That is a useful fail-closed property, but it
  means our office must connect to `ws://localhost:3000`, not `127.0.0.1`.

### 8.3 buzz-acp, buzz-agent, buzz-dev-mcp

Do not install or run them. If anyone runs them on this machine, all of these apply:

- default `bypass-permissions`, plus auto `allow_once` (§2.7);
- a shell tool and edit tools with no containment (§2.8);
- the agent key in the agent's and the tools' env (§2.3);
- Codex network access forced on;
- `view_image` fetching URLs;
- no way to switch off a tool.

Our policy is the opposite: no shell, writes only into `out/`, a client-side policy,
`terminal:false`, `mcpServers: []` (`server/runner.mjs:23-38, 246-259`). Add a CI check that
fails if `buzz-acp`, `buzz-dev-mcp` or `buzz-agent` appears in our compose, scripts or settings.

### 8.4 Sandbox and network rules

- **Relay stack:** on its own internal network with **no egress**. Push stays off
  (`BUZZ_PUSH_ENABLED=false`). The GIF proxy should be unconfigured; that it makes no outbound
  calls when unconfigured is **not verified**, so block egress anyway. No outbound webhooks.
- **Office container** (existing `docker/compose.yaml`):
  - add a second internal network shared with the relay only;
  - the squid allowlist is unchanged (Claude hosts only);
  - the agents (adapter processes) need **no** route to the relay at all, since the office signs and
    publishes for them. Enforce this by network policy where possible. In sbx, give the office only
    `localhost:3000`.
- **Images:** pulling from ghcr.io and Docker Hub works at install time only. Add those hosts to the
  install-time allowlist and then remove them.

### 8.5 Data at rest and privacy

Everything posted to the relay is stored in plaintext in Postgres and is full-text indexed
(ARCHITECTURE.md:927-938). Controlled material must not be posted. Keep the request and summary
text on the relay, and keep deliverable bodies local, anchored by hash. Decide per department
whether even the request text may go to the relay (open question).

### 8.6 Audit integrity

- Buzz's chain is keyless and written asynchronously (§2.11).
- Add a hash chain to our own `data/audit.jsonl` (`prev`/`hash` fields).
- Every N minutes, cross-anchor:
  - post our chain head as an owner-signed kind 9 in `#office` (`["elenta","audit-head"],["x",…]`);
  - record Buzz's current `audit_log` head (read with our verifier through a read-only Postgres
    role) in our audit.
- Rewriting history now needs both stores and the owner key. Run `verify-audit` nightly, and alert
  on mismatches or on events with no audit row.

---

## 9. Phased migration plan

Each phase sits behind `EO_BUZZ` (off by default) and is mergeable on its own.

**Phase 0 — spike (done today, §1).** Relay up, NIP-29 flow, isolation, NIP-98, audit verification.

**Phase 1 — infrastructure kit.**
- `docker/buzz/compose.yaml`, derived from `deploy/compose/compose.yml` (§10):
  - image pinned by digest;
  - relay published on `127.0.0.1` only; data services on an internal network;
  - `BUZZ_ALLOW_NIP_OA_AUTH=false`;
  - no dev overlay.
- `docker/buzz/bootstrap.mjs` generates `.env` secrets and the owner key (0600).
- *Tests:*
  - static test that parses the compose file and fails on any port without `127.0.0.1`, any
    published 5432/6379/9000/9001, a `:main` tag, or `ALLOW_NIP_OA_AUTH=true`;
  - smoke test (`npm run buzz:smoke`, needs Docker): liveness 200; outsider refused at AUTH;
    non-member refused at REQ; wrong-key EVENT refused (port the three probes).

**Phase 2 — identities and write-only mirror.**
- `server/keys.mjs` (keystore).
- `server/buzz.mjs` (client and builders).
- Org sync: idempotent 9007/9002/0/9030/9000.
- Every job lifecycle step is also published per §6. `jobs.json` stays authoritative; a relay outage
  only logs a warning and queues events.
- *Tests:*
  - unit: deterministic channel UUIDs; builders produce exactly the tags in §6; `adapterEnv()`
    contains no key material; keys files are 0600;
  - integration: a full fake-runner job against the relay. Assert the thread shape, the authors
    (owner/boss/lead/person), that a person in department A cannot read department B, and that every
    event signature verifies.

**Phase 3 — read path.**
- The server subscribes to the relay and feeds SSE.
- On restart, the job list is rebuilt from relay threads and compared with `jobs.json`.
- *Tests:*
  - rebuild equals the cache for 20 synthetic jobs;
  - a gap test: publish during reconnect, and no event is lost (live sub before history);
  - the UI e2e (`npm run shots`) is unchanged.

**Phase 4 — Buzz as system of record.**
- `jobs.json` becomes a cache.
- Approvals as owner-signed events (§4).
- Our audit gets its hash chain and cross-anchoring (§8.6).
- A nightly `verify-audit` job.
- *Tests:*
  - tamper tests on both chains (edit a row → detected);
  - an approval event signed by a non-owner key is ignored by the engine;
  - `npm run live` still passes, plus "every piece has a signed done event whose `x` equals the file
    hash".

**Phase 5 — optional.**
- Upstream PR for 4300x kinds.
- Canvas job board.
- Blossom for deliverables.
- NIP-07 owner signing.
- Buzz workflows for scheduled missions (§10.11) once WF-08 lands.
- Each item gets its own security note before it ships.

---

## 10. Licence obligations

Buzz is Apache-2.0, "Copyright 2026 Block, Inc." (`LICENSE:195`, `Cargo.toml:45`). There is **no
NOTICE file** at this commit, so there is no NOTICE text to carry. Recheck on every upgrade.

| Case | Obligations |
|---|---|
| Talking to an unmodified relay over the protocol | None on our code. It is not a derivative work. |
| Shipping `docker/buzz/compose.yaml` adapted from `deploy/compose/*` | §4: include a copy of the Apache-2.0 licence (e.g. `docker/buzz/LICENSE-buzz`); keep any notices; mark the file as modified ("Derived from block/buzz deploy/compose/compose.yml @1972b7d; changed: loopback binding, digest pin, internal network, NIP-OA off"). |
| Copying code from `web/src/shared/lib/*.ts` | Same: keep the header, add a change note, include the licence. |
| Redistributing the Buzz image or a patched relay | Include LICENSE; mark changed files prominently; carry NOTICE if one appears; the image's third-party licences come with it. |
| Name and marks | §6 grants no trademark rights. Do not call our product "Buzz" or use Block marks; a factual "uses the Buzz relay (Apache-2.0)" is fine. |
| nostr-tools (Unlicense), ws (MIT) | Keep the MIT notice for ws in a third-party notices file. |

Add a row to `CLEANROOM.md`. Buzz is permissively licensed and is not the excluded product, so this
is a normal third-party dependency, not a clean-room concern. Still record which Buzz files, if any,
were copied.

---

## 11. Paperclip vs Buzz vs keep our own

**Paperclip could not be evaluated in this session.** The shallow clone of
`github.com/paperclipai/paperclip` was refused by the session's permission classifier ("untrusted
code integration"). The GitHub API connector here only reaches `kambasana/test`. Neither block was
worked around, and nothing was installed or run (`npx paperclipai onboard` was not attempted).

The Paperclip column below therefore contains **only the questions to answer**, not findings.

| Question | Paperclip (MIT) | Buzz (Apache-2.0) | Keep our own |
|---|---|---|---|
| Fits "local, single owner, nothing leaves the machine"? | ? | Yes, if bound to loopback; adds 4 services | Yes (today) |
| Runs every agent through `claude-agent-acp` with **our** client-side policy and no shell? | **Key question**: can an external adapter plugin fully replace its launchers? What do its default Claude Code adapters get (shell, files)? | Only if we ignore buzz-acp and keep our runner (the design above) | Yes (`runner.mjs`) |
| Org chart / departments / sub-teams | ? (it reportedly has an org chart) | Channels per department; no hierarchy primitive | Org file |
| Work splitting with dependencies | ? (tickets, sub-tickets, blockers) | None (job kinds rejected; we model threads) | Lead plan; `after:` is in SPEC §10.7, not yet built |
| Approvals | ? | Gates unfinished (WF-08) | Built |
| Budgets / cost | ? | NIP-AM metrics only | SPEC §10.1–2 (to build) |
| Audit | ? | Hash chain (keyless) + signed events | jsonl (chain planned) |
| Tool gateway (Allowed / Ask first / Off) | ? Does "Off" really remove a tool, or only ask? | No tool-off switch in dev-mcp | Whitelist + disallowed list + policy |
| Secrets handling | ? | Agent key in env (buzz-acp) | No secrets handled by the office |
| Telemetry | ? `PAPERCLIP_TELEMETRY_DISABLED=1` must be verified at the network level, not just by flag | None found in the relay path (push off) | None |
| Heartbeats / scheduled work | ? | Cron workflows (work, minus approvals) | Not built (§10.11) |
| UI integration for our 3D floor | ? (its API) | Server-side relay client → our SSE | Native |

**Recommendation as of today:**
1. Keep our control plane and runner in every option. No candidate we can verify gives an agent
   runtime as strict as ours, and both of Buzz's agent paths are looser by default.
2. Adopt Buzz **only as a relay / system of record**, phased behind a flag (§9). It gives signed
   identities, departmental channels with enforced membership, threads, and a verifiable audit
   chain, without touching our security model. Its cost is four extra services, plaintext content in
   Postgres, and two missing features we must keep doing ourselves (approvals, job kinds).
3. Paperclip: run the evaluation in a session where the user has approved cloning it (or attaching
   the repo). The go/no-go test is one experiment:
   - write a minimal external adapter that starts `@agentclientprotocol/claude-agent-acp`, answers
     `session/request_permission` with our `decidePermission()`, sets `terminal:false` and
     `mcpServers:[]`;
   - confirm in the session's `system/init` tool list that no `Bash` (or equivalent) is present when
     Paperclip launches the run;
   - confirm that the adapter can disable *all* built-in launchers.
   If that passes, its tickets/blockers/budgets could replace parts of `jobs.mjs` (org file → org
   chart; Boss → top agent; department lead → sub-tickets per sub-team with blockers; our UI as an
   API client). That mapping should be designed only after the test, not before.

---

## 12. Risks and open questions

**Risks**

1. **Operational weight.** Postgres + Redis + MinIO + relay on a laptop, roughly 1 GB RAM, plus
   backups for four stores. A failure in the relay must never block a job (phase 2 queues), and the
   "office restarted" logic must cover the relay being down.
2. **Pre-1.0 upstream.** Buzz is moving fast (SECURITY.md "pre-1.0"; doc drift §2.12). Pin by
   digest; run the phase 1 and 2 integration tests on every upgrade.
3. **Plaintext content in a shared, indexed store.** Anything posted is searchable by every channel
   member and readable by anyone with database access. Export-controlled text must stay local.
4. **Signing proxy semantics.** Events "by" a person are really signed by the office. Make sure no
   one reads them as proof that a human did something.
5. **Owner key on the server.** Compromise of the office process means it can approve. That is
   already true for today's approval endpoint; note it in the threat model.
6. **Host-header community binding.** A misconfigured `BUZZ_DOMAIN` makes the relay unreachable
   (fails closed, which is good). Document it.

**Open questions**

1. May request text go to the relay for every department, or only a hash plus a title for some
   departments?
2. Should humans other than the owner join through Buzz Desktop? Then we need per-human keys and
   membership rules.
3. Will Block accept an upstream PR enabling 43001–43006 (and with which scopes)?
4. Rate limiting: what does the Redis admission limiter actually enforce, given the docs say none?
   It needs a test before any multi-user use.
5. Does an unconfigured GIF proxy or the `BUZZ_GIT_CONFORMANCE_PROBE` make outbound or S3 calls at
   start? Block egress regardless, and check the logs.
6. Paperclip go/no-go (§11).

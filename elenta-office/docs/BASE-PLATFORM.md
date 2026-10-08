# Base platform: Elenta Office on Buzz (with a Paperclip comparison)

Status: design proposal, 2026-10-07; decision added 2026-10-08 (§13). Nothing in `server/` or `web/` has been changed.

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
    **Update 2026-10-08:** done in §13. The decision there is Option 1 (Buzz relay plus our own
    control plane, with Paperclip-style elements rebuilt or ported).

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

**Superseded by §13 (2026-10-08), which answers every question in the table below.** Original text follows.

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

---

## 13. Decision: Option 1 vs Option 2

Date: 2026-10-08. The user approved downloading and running Paperclip for this evaluation.

The two options:

- **Option 1:** keep our control plane and runner, use the Buzz relay as the system of record,
  and add Paperclip-style elements ourselves (rebuilt, or ported MIT code).
- **Option 2:** use Paperclip as the control plane, run our agents through an external Paperclip
  adapter, and integrate Buzz into Paperclip.

Sources:

- **Paperclip** (MIT), shallow clone at `/home/user/paperclip`, commit `2f0c485` (2026-10-08,
  "fix(skills): … (#15554)"), server version 0.3.1. Paths in this section are relative to that
  clone unless prefixed `elenta:`.
- **Buzz:** as in §1–§12.

Marks: **(ran)** means observed in this environment; **(code)** means read in the source only.

### 13.1 What was run

| Step | Result |
|---|---|
| `git clone --depth 1` into `/home/user/paperclip` | OK: 9,038 files. About 506k lines of non-test server TypeScript and 2,323 test files. |
| Node | Paperclip requires Node ≥ 24.11 (`package.json` `engines`; v2026.831.0 notes: "Breaking: Node.js 24.11.0 or newer is required"). This host has 22.22. Node 24.21.0 was downloaded from nodejs.org, SHA-256 checked, into `/home/user/node24` (not on PATH globally). |
| `pnpm install` (pnpm 9.15.4 via corepack, `PAPERCLIP_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1`) | OK in 2 min 16 s. 2.7 GB `node_modules`. Warnings only (bins for not-yet-built packages). Postinstall scripts ran, including `opencode-ai` and node-gyp. |
| `pnpm dev:once`, attempt 1 | **Failed.** Embedded Postgres init refused because we run as root and it switches to the `postgres` user, which could not write `$PAPERCLIP_HOME`. Fixed with `chown postgres` on the data home. |
| `pnpm dev:once`, attempt 2 (`HOST=127.0.0.1 PAPERCLIP_HOME=/home/user/paperclip-home PAPERCLIP_ANNOUNCEMENTS_ENABLED=false`, telemetry off) | OK after about 11 min. It applied 317 migrations, then built the Rust "native runner" (`packages/paperclip-runner`) in 9 min 34 s, then started. A restart takes seconds. |
| Listening sockets (from `/proc/net/tcp`) | All loopback: `127.0.0.1:3100` (API+UI), `127.0.0.1:13100` (Vite HMR), `127.0.0.1:54329` (embedded Postgres). Mode `local_trusted`. **(ran)** |
| Outbound connections | A snapshot of the server's sockets showed no non-loopback peer. Telemetry is off at init: `server/src/telemetry.ts:12-16` returns no client when `resolveTelemetryConfig` says disabled (`packages/shared/src/telemetry/config.ts:71-79`). This is not a full egress capture. |
| `dev:stop` | Stopped the runner but **left the server process orphaned**. It needed a SIGTERM by pid. |
| Time spent | About 30 min wall clock to a running server, including the root/Postgres fix and the Rust build. |

### 13.2 Paperclip, as it stands (code-level findings)

**Adapters and launchers**

- **Built-in types (16):** `acpx_local, claude_local, codex_local, paperclip_runner, cursor_cloud,
  cursor, gemini_local, grok_local, hermes_gateway, hermes_local, kimi_local, openclaw_gateway,
  opencode_local, pi_local, process, http` (`server/src/adapters/builtin-adapter-types.ts:4-21`).
  They are registered at module load (`server/src/adapters/registry.ts:879-902`).
- **`claude_local`:**
  - `dangerouslySkipPermissions` **defaults to true** (`packages/adapters/claude-local/src/server/execute.ts:440`;
    ACP path `…/acp.ts:664`), which becomes `--dangerously-skip-permissions`
    (`…/permissions.ts:12`).
  - The child env is `{...process.env, ...env}` (`execute.ts:486-490`), so the agent gets the
    whole server environment plus `PAPERCLIP_*` variables and, when a JWT secret exists, a
    run-scoped API key.
  - Agents are expected to drive Paperclip themselves over REST: checkout, comments, sub-tasks,
    hires (`docs/guides/agent-developer/heartbeat-protocol.md`). That requires a shell or a
    network tool.
- **`process`:** runs an arbitrary command (`docs/adapters/process.md`;
  `server/src/adapters/process/execute.ts:98`). It is **the default adapter type** for a new agent
  row (`packages/db/src/schema/agents.ts:30`). It is also the fallback for unknown types
  (`registry.ts:1022-1024`: `findActiveServerAdapter(type) ?? processAdapter`). `process` and
  `http` cannot be unregistered (`registry.ts:999`).
- **External adapters:**
  - Each one is an npm or local package exporting `createServerAdapter()`.
  - Install with `POST /api/adapters/install {packageName, isLocalPath}`
    (`server/src/routes/adapters.ts:307`). `docs/adapters/external-adapters.md` says
    `POST /api/adapters`, which returns 404 **(ran)**. For a local path, `packageName` must be the
    path.
  - The registry is `$PAPERCLIP_HOME/adapter-plugins.json` (`server/src/services/adapter-plugin-store.ts:50`).
  - The module is **`import()`ed into the server process** (`server/src/adapters/plugin-loader.ts:181-203`),
    so adapter code runs with the server's privileges.
  - An external adapter **may take a built-in type** and override it (`registry.ts:953-975`,
    `988-996`). The comment "External plugins must not replace these" (`builtin-adapter-types.ts:2`)
    is not enforced **(ran)**.
- **"Disabled" adapters** are only hidden from creation (`registry.ts:1102-1112`;
  `adapter-plugin-store.ts:34-35` "hidden from menus but still functional") **(ran, §13.3)**.
- **Native runtime (`paperclip_runner`):** used only when the agent's type is
  `paperclip_runner` and an experimental flag is on (`server/src/services/native-runtime/runtime-mode.ts:107-145`).
  Otherwise the heartbeat calls `adapter.execute()` (`server/src/services/heartbeat.ts:23983`, `25461`).
- **Other process launchers outside adapters:**
  - Conference Room Chat spawns `claude -p … --dangerously-skip-permissions` with the full server
    env (`server/src/routes/board-chat.ts:226-257`). It is gated by the experimental flag
    `enableConferenceRoomChat` and `local_trusted` (`board-chat.ts:98-120`).
  - Workspace runtime services run `shell -lc <command>` (`server/src/services/workspace-runtime.ts:6433`).
  - The tool gateway spawns stdio MCP servers (`server/src/services/tool-gateway.ts:5058`).
  - Plugin workers are spawned by `server/src/services/plugin-worker-manager.ts`.
- **Optional sandbox:** bubblewrap-based local containment exists
  (`packages/adapter-utils/src/local-process-sandbox.ts:347-490`, Linux only). It is not the
  default, and `bwrap` is not installed here.

**Heartbeats and wakeups**

- Wake requests are rows in `agent_wakeup_requests` (`source`, `reason`, `status`,
  `coalescedCount`; `packages/db/src/schema/agent_wakeup_requests.ts:25-30`). Duplicate wakes
  coalesce (`heartbeat.ts:16098-16111`).
- Assignment wakes the assignee **(ran)**. Scheduled heartbeats are per agent
  (`runtimeConfig.heartbeat`, off by default for a new agent, **(ran)** from the create response).
- Routines (cron, webhook, API): `server/src/services/routines.ts` (3,390 lines) and a
  self-contained cron parser `server/src/services/cron.ts` (373 lines, no imports).
- `heartbeat.ts` alone is **31,096 lines**.

**Tickets, blockers, atomic checkout**

- Issues have a parent (sub-issues), status, priority, assignee (agent or user), `checkoutRunId`
  and `executionRunId` (`packages/db/src/schema/issues.ts:40-72`). Blockers are
  `issue_relations` with `type: "blocks"` (`issue_relations.ts:13`).
- Checkout is one conditional `UPDATE … WHERE status IN (expected) AND (assignee IS NULL OR same
  run) AND execution_run_id IS NULL` (`server/src/services/issues.ts:11751-11775`). A second
  claimant gets 409 **(ran)**. The heartbeat checks out the issue for the run before `execute()`
  **(ran)**.
- Creating an issue identical to an open one returns the existing issue (idempotency) **(ran)**.

**Budgets**

- Policies have company, agent or project scope, a metric (`billed_cents`), a window (calendar
  month UTC), `warnPercent` 80, `hardStopEnabled`, and `unpricedUsagePolicy: block`
  (`packages/db/src/schema/budget_policies.ts:10-22`).
- Threshold check: `budgets.ts:79-83`. Pre-invocation block: `heartbeat.ts:17744-17753`. Pausing a
  scope cancels its running work (`heartbeat.ts:30569-30578`).
- Spend is recorded from the adapter's reported `costUsd` / `billingType`
  (`server/src/services/run-cost-accounting.ts:85-87`). `subscription_included` books zero.
  Reservations exist, but `reservationCents` defaults to 0.

**Approvals and board controls**

- Approval types: `hire_agent`, `approve_ceo_strategy`, `budget_override_required`,
  `request_board_approval` (`packages/shared/src/constants.ts:689-694`).
- Per-issue review and approval stages are set through the execution policy
  (`docs/guides/execution-policy.md`; `server/src/services/issue-execution-policy.ts`, 1,226 lines).
- Board controls: pause, resume, terminate (`server/src/routes/agents.ts:5863`, `5889`, `6010`;
  `server/src/services/agents.ts:1011-1070`).

**Tool gateway** (Allowed / Ask first / Off)

- This governs **MCP connections only**: applications, connections, catalog with risk classes,
  profiles and bindings, and policies `allow`, `block`, `require_approval`, `rate_limit`,
  `trust_rule`, with "deny beats allow" (`doc/MCP-ACCESS-GOVERNANCE.md` "Mental model").
- Profiles choose which catalog entries an actor *sees*, so "Off" hides the tool.
- It does not govern an adapter's built-in tools: Claude Code's Bash is controlled only by the
  adapter's own flags.
- Size: `tool-access.ts` 21,069 lines plus `tool-gateway.ts` 11,315 lines.

**Secrets**

- Local provider: AES-256-GCM (`server/src/secrets/local-encrypted-provider.ts:205-220`) with a
  master key file written 0600 (`…:76`) or `PAPERCLIP_SECRETS_MASTER_KEY(_FILE)` (`…:22,49`).
- AWS Secrets Manager provider; per-agent secret bindings (`company_secret_bindings`).
- v2026.916.0 notes: agent APIs *used to* return plaintext `adapterConfig.env` credentials.

**Auth modes**

- `local_trusted` vs `authenticated` (private or public), with bind loopback, lan, tailnet or
  custom (`doc/DEPLOYMENT-MODES.md` §2–3).
- **In `local_trusted`, every request without a bearer token is the instance-admin board**
  (`server/src/middleware/auth.ts:229-238`). Any local process can approve, pause or install
  adapters. A plain `curl` approved a gated ticket **(ran)**.
- Agent JWTs need `PAPERCLIP_AGENT_JWT_SECRET` or `BETTER_AUTH_SECRET`
  (`server/src/agent-auth-jwt.ts:40`). Without one, runs go ahead with no agent identity and
  write-backs are attributed to `local-board` **(ran)**.

**Telemetry and outbound calls**

- Telemetry is **on by default**. It is off with `PAPERCLIP_TELEMETRY_DISABLED=1`,
  `DO_NOT_TRACK=1`, `CI=true`, or `telemetry.enabled:false` (`packages/shared/src/telemetry/config.ts:71-79`;
  README "Telemetry"). Endpoint: `https://telemetry.paperclip.ing/ingest`.
- **A second default-on call:** the announcements feed
  `https://pages.paperclip.ing/announcements/v1/current.json`, off with
  `PAPERCLIP_ANNOUNCEMENTS_ENABLED=false` (`server/src/config.ts:367-368`).
- Feedback-trace sharing posts to `telemetry.paperclip.ing/feedback-traces` only when a company
  opts in (`server/src/services/feedback-share-client.ts:5-23`; company default
  `feedbackDataSharingEnabled:false` **(ran)**).
- Sentry and OTel only when a DSN or endpoint is set (README "Observability").
- Plugin installs need npm registry access (plugin-sdk README "Current deployment caveats").

**DB, API, plugins**

- Postgres (embedded by default, `embedded-postgres` 18.1 beta) with **158 schema files and 318
  migrations** (`packages/db/src/schema`, `packages/db/src/migrations`).
- REST: 87 route files and **962 `router.<verb>(` registrations** (`server/src/routes/*.ts`), plus
  an OpenAPI route.
- Plugins (`@paperclipai/plugin-sdk`): worker plus UI. "Plugin workers and plugin UI should both
  be treated as trusted code today." UI bundles run same-origin with the board session
  (`packages/plugins/sdk/README.md`).

**Licence**

- Root MIT, "Copyright (c) 2025 Paperclip AI" (`LICENSE`).
- 40 of 46 `package.json` files declare MIT. The other 6 are private examples or fixtures with no
  licence field: root, three plugin examples, `paperclip-plugin-fake-sandbox`, and the
  cloudflare bridge template.
- Other notices, all MIT:
  - `packages/adapters/hermes/LICENSE` (Nous Research);
  - `packages/shared/src/cliplab/LICENSE` (Jérémy Perret, plus `PROVENANCE.md`);
  - `skills/complain` and `skills/suggestion-box` (Denver Technologies);
  - `ui/public/brands/adapters/LICENSE` (LobeHub icons; the vendor logos remain trademarks).
- Fonts: `ui/public/fonts/NOTICE.md` (Inter).

**Upstream pace**

- 31 release notes in `releases/`.
- The six most recent releases with a "Breaking Changes" section (v2026.817.0 → v2026.1005.0)
  include a Node floor bump, removed company fields with a dropping migration, changed credential
  handling, and changed default network exposure for managed runtimes.
- PR numbers went from about #11184 (v2026.817.0) to #15554 (today), roughly 4,400 PRs in 7 weeks.

### 13.3 Go/no-go prototype: Elenta's runner as a Paperclip adapter

Code: `elenta:experiments/paperclip-acp-adapter/`.

- `index.mjs` is the adapter `elenta_acp`. It **imports** `elenta:server/runner.mjs` `runSession()`,
  `server/acp.mjs` and `server/audit.mjs` unchanged; nothing in `server/` was edited.
- `runSession()` supplies the restrictions:
  - `terminal:false` and `mcpServers:[]`;
  - `_meta.claudeCode.options` with `tools [Read, Write, Edit]`, `allowedTools []`,
    `disallowedTools` = `ALWAYS_DISALLOWED` (Bash, Glob, Grep, WebFetch, Task, …), and
    `settingSources []`;
  - `decidePermission()` for every permission request;
  - `containedPath()` for `fs/*`.
- Per wake, the adapter:
  1. checks out the ticket (or accepts the heartbeat's checkout for this run);
  2. writes `ticket.md` into `work/<issue>/<run>/`;
  3. runs one ACP session;
  4. writes the result back with `PATCH /api/issues/:id {status:"done", comment}` using the run's
     agent JWT.
- Cost comes from ACP `usage_update.cost.amount`. It is captured with a prototype setter on
  `AcpConnection`, because `runner.mjs` ignores that update.
- `deny-builtin/` is an external adapter that takes the built-in type `process` and refuses to run.

Runs used `@agentclientprotocol/claude-agent-acp` 0.87.0 with the Claude login on this host.

| Check | Result | Evidence |
|---|---|---|
| A ticket assigned in Paperclip runs through the adapter and gets done | **PASS** | ELE-2, ELE-4, ELE-9, ELE-10, ELE-13 → `done`. Each has `out/result.md` (e.g. ELE-2: three desk tips). |
| The result is written back to Paperclip | **PASS** | Each ticket has a comment with the file content and an evidence footer. With the JWT secret set, `authorType=agent` and the author is the Writer agent (ELE-4). Before that it was `local-board`, with `derivedAuthorAgentId` taken from the run id. |
| No Bash tool in the session | **PASS** | `system/init` tool list per run (audit `session.tools`): `Edit, Read, Write`; MCP servers: none; `permissionMode: default`. ELE-3 asked the agent to run `id`; its answer: "NOT POSSIBLE. I have no shell tool". `runner.mjs` would also have stopped the run on any extra tool. |
| A write outside the workspace is refused | **PASS** | ELE-3 audit: `Refused Write: /tmp/elenta-escape-check.txt (… outside the job workspace) rule=a` and `Refused Write: …/work/<issue>/escape-up.txt (… outside …) rule=a`. Neither file exists afterwards. The only allowed write was `out/result.md` (rule b). |
| Spend is recorded in Paperclip | **PASS** | `cost.reported` activity per run, e.g. $0.0175 (ELE-2) and $0.0089 (ELE-4). The company summary shows 11 cost events. |
| Paperclip's own launchers can be kept from bypassing the adapter | **PASS, but only with extra work** | See below. |
| Agent env holds no server secrets | **FAIL (finding in our code)** | `/proc/<acp pid>/environ` of the ACP child contained `PAPERCLIP_AGENT_JWT_SECRET`, `PAPERCLIP_SECRETS_MASTER_KEY_FILE` and every token in the server env. Cause: `elenta:server/acp.mjs` `adapterEnv()` copies `process.env`. The agent has no tool that can read its env (no shell; Read limited to the workspace by rule a). Still, this is a defence-in-depth gap under **either** option. |

How the launcher check went:

1. `PATCH /api/adapters/<type> {disabled:true}` for `process, http, claude_local, codex_local,
   acpx_local, gemini_local, opencode_local`.
2. After that, creating an agent of a disabled type, PATCHing an agent to one, or creating an
   agent with no type (default `process`) are all refused with 4xx "Adapter … is not available".
3. **But an existing `process` agent still ran** while `process` was disabled. ELE-6 ran
   `/usr/bin/touch` as root and the run `succeeded`.
4. Installing `deny-builtin/process` (an external adapter with type `process`) made the next run
   fail with "switched off (Elenta deny stub)" and nothing executed (ELE-7, ELE-8).
5. So a full lockdown needs:
   - one deny stub per built-in type (16);
   - a startup check that every agent's `adapterType` is `elenta_acp`;
   - Conference Room Chat left off;
   - no workspace runtime services;
   - no stdio MCP;
   - `authenticated` mode, so that a local process is not the board. The board can also re-enable
     a built-in with `PATCH /api/adapters/:type/override {paused:true}` (`routes/adapters.ts:492`).

**Verdict: technically GO.** Paperclip can run every agent through our runner and policy. But it
is GO only with a lockdown layer that has to be kept up against an upstream that changes daily.

### 13.4 Budgets and approvals in practice (test 4)

- **Budget hard stop: works, with a one-run overshoot.**
  1. Agent "Budgeted", monthly budget 1¢.
  2. Run 1 (ELE-9) cost 0.87¢ and finished. Run 2 (ELE-10) started (still under) and finished at
     1.73¢.
  3. The agent was then auto-paused (`status=paused`, `pauseReason=budget`; budget overview
     `status: hard_stop`, utilization 173%). A pending `budget_override_required` approval was
     created.
  4. Run 3 (ELE-11) never started (no workspace was created) and the ticket went to `blocked`.
  5. The overshoot happens because cost is known only at the end of a run and the default
     reservation is 0.
- **Approval stage: works.**
  1. ELE-12 had an execution policy with one `approval` stage (participant: board user).
  2. The agent's `PATCH status:done` was turned into `in_review`, reassigned to the board
     (`executionState.status: pending`, `currentStageType: approval`).
  3. Only the board's `PATCH status:done` with a comment moved it to `done`
     (`lastDecisionOutcome: approved`).
  4. In `local_trusted`, that board call was an **unauthenticated curl from loopback**.

### 13.5 Scored comparison

Scores are 1 (poor) to 5 (good); weights are in brackets.

| Criterion | Option 1: Buzz relay + our control plane, Paperclip elements ported or rebuilt | Option 2: Paperclip control plane + our adapter + Buzz integrated |
|---|---|---|
| **Security / agent containment** [3] | **4**. Our runner is the only launcher, with nothing to lock down. Buzz agent tooling is not used (§8.3). Relay content is plaintext (§8.5). Env allowlist still to add. | **2**. Containment of *our* agents is proven (§13.3), but the defaults are the opposite of ours: skip-permissions on by default, full server env to agents, "disabled" ≠ off, unknown type → `process`, `local_trusted` = any local process is admin, adapters and plugins run in-process. 962 routes and many spawners to keep off. |
| **Maturity & test coverage** [2] | **3**. The relay is solid for messaging (6,871 Rust tests; our probes passed), but pre-1.0 with approvals and job kinds unfinished. The Paperclip-like features would be new code of ours. | **4**. Large and heavily tested (2,323 test files). Budgets, checkout and approval stages behaved as documented in our runs. Downsides: docs drift (`/api/adapters`), `dev:stop` orphaned the server, and the root/Postgres setup snag. |
| **Fit to our model** (Boss → departments → sub-teams, whole-department jobs, approvals) [3] | **4**. Same model as SPEC: Boss routes, the lead plans, pieces with `after:`, the office combines, the owner approves. Buzz channels per department fit. | **3**. Org chart (`reportsTo`), sub-issues, `blocks` and approval stages map well. But Paperclip's agents self-drive over REST with a shell. Our no-shell agents cannot, so the adapter must turn structured output into sub-issues and hand-offs; planning and combining stay ours. |
| **Effort to integrate** [2] | **2**. About 10–12 weeks for the phases below. Files: `server/{acp,runner,jobs,org,settings,http,audit}.mjs`, plus new `budget.mjs`, `scheduler.mjs`, `cron.mjs`, `controls.mjs`, `buzz.mjs`, `keys.mjs`; `web/` controls. | **3**. About 9–12 weeks: adapter hardening and env allowlist (1.5), 16 deny stubs plus a lockdown check plus `authenticated` mode (1.5), planner → sub-issue bridge (2–3), our 3D UI as a Paperclip API client (2–3), Buzz bridge plugin (2–3), upgrade regression harness (1, then ongoing). |
| **What we must build ourselves** [1] | **2**. Tickets/blockers/checkout, scheduler, budgets, board controls, approval stages, later an MCP gateway, secrets, portability. | **3**. Lockdown, adapter, planner bridge, UI client, Buzz bridge. Budgets, approvals, tickets and routines come with it. |
| **Operational footprint / attack surface** [2] | **3**. Our Node 22 server (about 3k lines) plus the Buzz stack (relay, Postgres, Redis, MinIO) on loopback and an internal network. | **1**. Paperclip (Node 24, embedded Postgres 18 beta, 2.7 GB deps, Rust runner build, 962 routes, plugin system with npm installs, chat connectors) **plus** the Buzz stack. Two Postgres instances. |
| **Licence** [1] | **5**. Apache-2.0 relay over the protocol. MIT ports need only the notice kept. | **5**. MIT throughout (sub-notices all MIT). Vendor logos are trademarks. |
| **Upstream risk** [2] | **4**. We depend on Buzz only at the wire level (NIP-01/29/42/98) and a digest-pinned image. Ported MIT files are frozen copies. | **1**. About 90 PRs a day, breaking changes in most recent releases, internals of 30k-line files. Our adapter depends on the `ServerAdapterModule` contract, REST shapes, the heartbeat checkout behaviour and auth semantics, all of which changed within the last two months. |
| **How the other platform fits** [1] | **4**. Paperclip elements become small services in our server with Buzz events as their log (§13.7). | **2**. Buzz would be a trusted Paperclip plugin mirroring `issue.*` events to the relay with keys held by the plugin. Paperclip's DB stays the source of truth, so Buzz is only a second, signed copy. Two audit trails and two identity systems. |
| **Weighted total** (max 85) | **59** | **45** |

Totals: Option 1 = 4·3 + 3·2 + 4·3 + 2·2 + 2·1 + 3·2 + 5·1 + 4·2 + 4·1 = 59.
Option 2 = 2·3 + 4·2 + 3·3 + 3·2 + 3·1 + 1·2 + 5·1 + 1·2 + 2·1 = 45.

Option 2 does better on feature completeness and maturity, and the prototype shows it *can* be
contained. It loses on what matters most for us: secure defaults, footprint and upstream churn.
The gap is not narrow, so the evidence does not favour Option 2.

### 13.6 Recommendation

**Option 1.** Base on our control plane with the Buzz relay as the system of record (phased as in
§9), and take Paperclip's *design* and selected small MIT files, not its runtime.

- **Port verbatim:**
  - `server/src/services/cron.ts` (373 lines, no imports; tests to port from
    `ui/src/lib/cron-fires.test.ts`);
  - the budget threshold logic (`server/src/services/budgets.ts:79-83`).
- **Port as patterns (rebuild in our code):**
  - conditional-update checkout (`issues.ts:11751-11775`);
  - wake coalescing (`heartbeat.ts:16098-16111`);
  - execution-policy stages (`issue-execution-policy.ts`, `docs/guides/execution-policy.md`);
  - pre-invocation budget block plus cancel on pause (`heartbeat.ts:17744-17753`, `30569-30578`).
- **Licence obligations for any copied file:** keep "Copyright (c) 2025 Paperclip AI" and the MIT
  permission notice. Add a `// Derived from paperclipai/paperclip <path> @2f0c485 (MIT); changes: …`
  header. Add the MIT text to `THIRD-PARTY-NOTICES` and a row in `CLEANROOM.md` naming each
  copied file.
- **Do not adopt:** Paperclip adapters, the heartbeat service, plugins, the tool gateway or
  connectors.
- **Keep** `experiments/paperclip-acp-adapter/` as a reference. If Paperclip is revisited, the
  lockdown list in §13.3 is the entry criterion.

### 13.7 Option 1 phased plan: Paperclip elements in our server

Conventions for Buzz events are as in §6: all events carry `["h", <channel>]` and the `elenta`
namespace tag. "Owner-signed" means signed by the office with the owner key (§5). State lives in
our store and is rebuilt from the relay from phase 7. Every phase sits behind a flag and is
mergeable on its own.

| # | Element | Port or rebuild (Paperclip source, MIT) | Our store | Buzz event / tags | Tests |
|---|---|---|---|---|---|
| E1 | **Org chart / reporting lines** | Rebuild. Concept from `packages/db/src/schema/agents.ts:28` (`reportsTo`). Nothing copied. | `orgs/*.json`: each person gets `reportsTo`; the Boss is the single root; leads report to the Boss, sub-team members to their lead (`server/org.mjs`). | On apply: owner-signed kind 9 in `#office` `["elenta","org"]`, `["x",<sha256 of org file>]`, `["v",n]`. Per person: kind 0 with `["dept",k]`, `["team",t]`, `["reports_to",<pubkey>]`. | Cycle rejected; exactly one root; every lead reports to the Boss; the event's `x` equals the file hash; a person moved between departments gets 9001/9000 membership changes. |
| E2 | **Tickets with blockers + atomic checkout** | Rebuild. Patterns: `issues.ts:11751-11775` (conditional claim), `issue_relations.ts:13` (`blocks`), status set from `docs/api/issues.md` "Issue Lifecycle". | `data/jobs.json`: pieces get `status` (todo / in_progress / in_review / blocked / done / cancelled), `after:[pieceId]` (SPEC §10.7) and `checkoutRun`. Claims are compare-and-set under the engine's single writer, with an atomic rename on write. | `["elenta","piece"]` gains repeated `["after",<pieceId>]`. Claim: kind 9 reply `["elenta","checkout"]`, `["piece",id]`, `["run",runId]`, signed as the person. Status change: `["elenta","status"]`, `["piece",id]`, `["to",s]`. | Two concurrent claims → exactly one wins; a piece with an unmet `after` never starts; a cycle in `after` is rejected at plan time; a blocked → todo transition only when all blockers are done; a restart mid-run releases stale claims. |
| E3 | **Heartbeats / wakeup queue + routines** | **Port `server/src/services/cron.ts` verbatim** (`parseCron`, `validateCron`, `nextCronTick`; lines 204-329) as `server/cron.mjs`, with the MIT header. Rebuild the wake queue with coalescing semantics from `agent_wakeup_requests.ts:25-30` and `heartbeat.ts:16098-16111`. | `data/routines.json` (cron, department, request template, `lastFiredAt`, `paused`); in-memory wake queue keyed `(person, reason)` with a count; persisted `lastFiredAt`. | A routine firing creates a normal `job.created` root with an extra `["routine",id]`. No relay events for individual wakes (too chatty). | Port the cron cases from `ui/src/lib/cron-fires.test.ts`; duplicate wakes coalesce (count = n, one run); no double fire across a restart; a paused department's routine does not fire; a routine job still needs owner approval. |
| E4 | **Budgets with hard stops** | Port the threshold function (`budgets.ts:79-83`). Rebuild the rest (SPEC §10.1–2). Patterns: pre-invocation block (`heartbeat.ts:17744-17753`), cancel on pause (`30569-30578`), `unpricedUsagePolicy:block` (`budget_policies.ts:18`). **Fix the overshoot we observed** with a per-run reservation (the expected cost of a step). | `data/costs.jsonl` (append-only; run, person, department, job, model, USD from ACP `usage_update.cost`, captured natively in `runner.mjs`, not via the prototype's setter); policies in `settings.json` per office, department and person. | Only on state changes: owner-signed kind 9 in `#office` `["elenta","budget"]`, `["scope",dept\|person\|office]`, `["id",k]`, `["state","warning"\|"hard_stop"\|"cleared"]`. Amounts stay local (§8.5). NIP-AM 44200 is optional. | A run crossing the limit pauses the scope and cancels its live sessions within 2 s; the next piece is refused **before** any adapter spawn; the reservation stops a start when remaining < estimate; unpriced usage blocks; the 80% warning fires once; a new month resets. |
| E5 | **Approvals / board controls** (pause, resume, terminate) | Rebuild. Semantics from `issue-execution-policy.ts` and `docs/guides/execution-policy.md` (the executor's "done" becomes `in_review`, then the next stage participant; changes requested go back to the executor at the same stage). Controls from `server/src/services/agents.ts:1011-1070`. | Job `stages: [{type:review, by:lead}, {type:approval, by:owner}]`, default `[approval]`; `decisions[]` with author, outcome and note; person or department `status: active\|paused\|terminated`. | Approvals as in §4. Controls: owner-signed kind 9 in `#office` `["elenta","control"]`, `["act","pause"\|"resume"\|"terminate"]`, `["p",<pubkey>]` or `["dept",k]`. The engine ignores control or approval events not signed by the owner key. | Agent "done" never reaches `done` without the owner decision; changes requested return to the same stage; an approval signed by a non-owner key is ignored; pausing a person cancels the live session and blocks new pieces; terminate is irreversible; **the approval endpoint requires a session even on loopback** (not like Paperclip's `local_trusted`). |
| E6 | **Tool gateway** (Allowed / Ask first / Off) for MCP | Rebuild, small. Do **not** port `tool-access.ts` / `tool-gateway.ts` (32k lines). Model from `doc/MCP-ACCESS-GOVERNANCE.md`: deny beats allow, and "Off" hides the tool. Deferred until we allow any MCP at all (today `mcpServers: []`). | `settings.json` `mcp: {server: {tools: {name: "allow"\|"ask"\|"off"}}}` per department; HTTP MCP only, no stdio. | Not on the relay (§3): per-call decisions go to our audit. Owner answers to "ask" requests are logged as approvals (§4 shape with `["elenta","tool-approval"]`). | An "off" tool is absent from the session's `system/init` list; "ask" waits for the owner and times out to reject; an unknown tool is rejected; `mcp__*` stays rejected by `policy.mjs` unless listed. |
| E7 | **Secrets** | Rebuild with the pattern of `server/src/secrets/local-encrypted-provider.ts:205-220` (AES-256-GCM, 0600 master key). About 100 lines; port allowed with the MIT header. | `data/keys/` (Buzz keys, §5) and `data/secrets.enc`; the master key is in a 0600 file outside `data/`. **First: an env allowlist in `server/acp.mjs`** (PATH, HOME, LANG, TERM, the CLAUDE config dir, proxy vars only if needed), the gap measured in §13.3. | Never on the relay. | The adapter env contains only allowlisted names (no `*_SECRET`, `*_TOKEN`, `*_KEY`, `nsec1`, `BUZZ_PRIVATE_KEY`); key files are 0600; ciphertext round-trips and tampering is detected; secrets never appear in audit or SSE. |
| E8 | **Company portability** | Rebuild. Idea only from `server/src/services/company-portability.ts` (6,459 lines; not ported). | Export `office-export.tgz`: org file, routines, library and lessons, settings minus secrets, with a `manifest.json` of sha256 per file. | Owner-signed kind 9 in `#office` `["elenta","export"]` or `["elenta","import"]`, `["x",<sha256 of manifest>]`. | Export → import yields an identical org, routines and library; secrets and keys are never exported; a tampered file is refused on import; an import into a non-empty office needs explicit confirmation. |

**Phases**

| Phase | Weeks | Content | Exit tests |
|---|---|---|---|
| P1 Runner hardening | 1 | Env allowlist (E7 first part); native cost capture from `usage_update` in `runner.mjs`; per-run cost in the job record. | E7 env test; a cost is recorded for a fake-runner session; `npm test` and `npm run live` still pass. |
| P2 Buzz infrastructure | 1 | §9 phase 1 (compose kit, loopback, digest pin, NIP-OA off). | §9 phase 1 tests. |
| P3 Tickets and org | 2 | E1, E2; Buzz write-only mirror (§9 phase 2) including the new tags. | E1 and E2 tests; the §9 phase 2 integration test also checks `after` and `checkout` events. |
| P4 Budgets and controls | 1.5 | E4; the control half of E5; UI badges for paused, budget states and terminate. | E4 tests; E5 control tests; `npm run shots` updated. |
| P5 Approval stages | 1.5 | The stage half of E5; approvals on Buzz (§4); the read path (§9 phase 3). | E5 stage tests; §9 phase 3 tests. |
| P6 Scheduler | 1.5 | E3 (cron port, wake queue, routines UI). | E3 tests; a routine job runs end to end with approval. |
| P7 Buzz as system of record | 1 | §9 phase 4 (hash-chained audit, cross-anchoring, nightly verify). | §9 phase 4 tests; rebuild from relay equals cache with the E2 and E4 state. |
| P8 Optional | as needed | E6 (only when an MCP server is wanted), the rest of E7, E8. | Their tests above. |

Total P1–P7: about 9.5 weeks of focused work plus review, so plan 10–12 weeks.

### 13.8 Leftovers on this machine

- `/home/user/paperclip`: the clone, plus 2.7 GB `node_modules` and the Rust `target/`.
- `/home/user/paperclip-home`: embedded Postgres data, run logs, `adapter-plugins.json`,
  `adapter-settings.json` (seven types disabled).
- `/home/user/node24`: the Node 24.21.0 tarball and its extract.
- `/home/user/pc-eval`: helper script and API responses.
- Run workspaces under `elenta:experiments/paperclip-acp-adapter/work/` (git-ignored by `work/`).
- The Paperclip dev server is stopped: it ended with SIGTERM (exit 143) after the evaluation. To
  restart it, use the environment in §13.1 plus `PAPERCLIP_AGENT_JWT_SECRET`. Stop it by pid, because
  `pnpm dev:stop` leaves the server orphaned (§13.1).
- Remove everything with `rm -rf /home/user/paperclip /home/user/paperclip-home /home/user/node24 /home/user/pc-eval`.

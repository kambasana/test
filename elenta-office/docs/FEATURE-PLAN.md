# Feature plan: what we build, what Buzz builds, what we borrow

Decided base: **Option 1** — Buzz relay as the system of record, our own control plane on top
(see BASE-PLATFORM.md §13). This page stops us building anything Buzz already has or plans.

Sources: Buzz README status table and VISION docs at commit `1972b7d` (2026-10-07); Paperclip at
`2f0c485` (evaluated in BASE-PLATFORM.md §13); OpenMausBot (formerly OpenGrokBot, Apache-2.0) and
Rakazo (Apache-2.0) READMEs, 2026-10-08.

## 1. Buzz roadmap (so we don't duplicate it)

| Buzz status | Capability | What we do |
|---|---|---|
| ✅ Ships | Relay, channels, threads, DMs, search | **Use.** Department = channel, job = thread. No chat system of our own. |
| ✅ Ships | Canvases (shared documents) | **Use** for deliverables people co-edit after sign-off. |
| ✅ Ships | Media storage (Blossom, SHA-256, S3/MinIO) | **Use** for deliverable files once released. |
| ✅ Ships | Hash-chained audit log | **Use**, and anchor it with our own chained `audit.jsonl` (its chain is unkeyed and best-effort). |
| ✅ Ships | YAML workflows with schedule / webhook / message / reaction triggers | **Use for routines**: a schedule trigger posts a job request into a department channel; our control plane picks it up. We do **not** build our own cron. |
| ✅ Ships | Git hosting (smart HTTP + NIP-34 events) | **Use** for the Software sub-team's code: agents write files, the office (single committer) pushes to a Buzz repo. |
| ✅ Ships | ACP harness (`buzz-acp`) and agent tools (`buzz-dev-mcp`) | **Do not use.** It approves every permission request and gives agents a shell. Our ACP runner and permission policy stay. |
| ✅ Ships | Desktop and mobile apps | **Use** as the place people talk to teammates. Our dashboard (Office, Needs you) sits beside it; see UPSTREAM.md for the panel proposal. |
| 🚧 In progress | Workflow approval gates (runs reaching an approval step currently fail) | **Ours for now**, recorded as Buzz events; switch when Buzz's executor works. |
| 🚧 In progress | Mobile apps | **Wait** for theirs rather than building one. |
| 📋 Designed | NIP-34 issues (kind 1621), labels/assignees as tags | **Shape our tickets to match** so they can become kind 1621 events when Buzz ships issues. |
| 📋 Designed | Project binding, multi-repo projects, merge coordinator | Not needed now. |
| 💭 Vision | Activity feed: "agent did [verb] to [object] → [outcome]" | **Adopt the same frame** for our job feed, so both read alike. |
| 💭 Vision | Remote agents, mesh compute, web-of-trust, moderation | Watch only. |

## 2. Paperclip features: build, adapt or skip

Buzz has none of these, so they are ours to build (rebuilt in our control plane; only `cron`-free
pieces are needed now that routines use Buzz workflows).

| Priority | Feature | Decision | Notes |
|---|---|---|---|
| 1 | Budgets with hard stops (office, department, person, job) | **Build** | Add a per-run reservation so a run can't overshoot (Paperclip overshot by one run). Port its threshold function (MIT, keep notice). |
| 1 | Pause / resume / terminate (person, department, job) | **Build** | The "board" controls. Signed into the audit chain. |
| 1 | Tool gateway: Allow / Ask first / Never per MCP tool, per department | **Build** | Paperclip's covers MCP only; ours also keeps built-in tools locked (no shell). |
| 1 | Tickets with blockers and atomic checkout | **Build** | Our "pieces that wait on other pieces". Tags shaped like NIP-34 issues. |
| 2 | Approval stages (done → in review → released) | **Build** | Already have sign-off; add review stages per department. |
| 2 | Org chart with reporting lines and "hire" approval | **Adapt** | Our org file already has Boss → departments → sub-teams; adding a person becomes an approval. |
| 2 | Goals ("why" behind each job) | **Build** | Cheap; every job links to a goal, shown in the job view. |
| 2 | Secrets by reference, encrypted | **Adapt** | Secrets live in `sbx secret` / an encrypted store; agents never see values (the env allowlist is done). |
| 3 | Export / import of an org | **Done as OPS packages** | One Open Plugin Spec package per department (Buzz persona-pack layout, MASTER-PLAN §5.2). Imports start paused, without memory, credentials or connector grants. |
| — | Multi-company | Skip | Wings already cover separate offices. |
| — | In-process adapter plugins, "process" adapter, no-auth local mode | Skip | Security: the opposite of our model. |
| — | Its 962-route API and 158-table schema | Skip | We keep a small surface. |

## 3. Open-source "Grok Bot" alternatives: what to borrow

**OpenMausBot** (formerly OpenGrokBot; Apache-2.0 except an `enterprise/` folder) — a chat app
where each bot is an agent running the user's `claude` / `codex` / `grok` CLI behind a loopback
harness, with per-bot computers (cloud desktop, local VM or the host).

Borrow:
- **Inline approval cards** in the job feed (Allow / Deny on the step that needs it), backed by the
  permission broker — not only the end-of-job sign-off.
- **Routing with a fast, cheap model** and a fallback to the department lead when unsure: the
  Boss's routing call moves to the cheapest capable model.
- **Teams as reviewable packages**: done as Open Plugin Spec packages (the Buzz persona-pack format)
  instead of a format of our own; the review screen comes in phase 8.
- **Safe import defaults**: imported routines start paused, connections off, secrets and memory
  stripped.
- **Routine hygiene**: skip a run if the previous one is still going; a run time limit.
- **A bounded control surface**: if we expose an MCP server for other tools to drive the office, it
  must exclude approvals, deletion and credentials.

Don't borrow: control of the host computer or cloud desktops (outside our security model). The
Composio catalogue is now used only through our Connector Gateway (MASTER-PLAN §5), with listed tools,
ZDR and our own OAuth apps.

**Rakazo** (Apache-2.0, beta) — persistent teammates with pluggable sandboxes.

Borrow:
- **One sandbox interface, several providers** (Docker Sandboxes now; others later), chosen per
  department.
- **Shared vs private workspaces**: a department's shared folder vs a person's private one.

## 4. Build order (replaces BASE-PLATFORM.md §13.7 where they differ)

1. ~~Agent environment allowlist~~ (done, 2026-10-08).
2. Buzz infrastructure kit: pinned image, loopback-only ports, `BUZZ_ALLOW_NIP_OA_AUTH=false`,
   our server as the only key holder.
3. Tickets with blockers + checkout (NIP-34-shaped tags) and goals.
4. Budgets with reservations + pause / resume / terminate.
5. Tool gateway (Allow / Ask / Never) + inline approval cards + approval stages.
6. Routines via Buzz schedule-trigger workflows (with skip-if-running and time limits).
7. Buzz as system of record for jobs, pieces, messages, approvals; activity feed in Buzz's
   verb/object/outcome frame.
8. ~~Department packages~~ (done 2026-10-09 as OPS packages); review screen and paused import remain.
9. Software sub-team on Buzz git hosting (office as single committer).

# Paperclip: UI, features and behaviours worth rebuilding

Date: 2026-10-08. Source: Paperclip (MIT) at commit `2f0c485`, clone at `/home/user/paperclip`. Paths
are relative to that clone. `elenta:` marks a path in this repo. Read with
[BASE-PLATFORM.md §13](../BASE-PLATFORM.md) (the evaluation and Option 1 decision) and
[FEATURE-PLAN.md](../FEATURE-PLAN.md) (what Buzz already covers).

**How this was gathered.** I read the React UI (`ui/src`, about 530 components and 150 pages), the
`feature-map/` recipes, the DB schema and the services named below. I also ran the app once more
for screenshots:

- Node 24, `HOST=127.0.0.1`, `PAPERCLIP_HOME=/home/user/paperclip-home`, with
  `PAPERCLIP_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1` and `PAPERCLIP_ANNOUNCEMENTS_ENABLED=false`.
- Playwright Chromium (`/opt/pw-browsers/chromium-1194`) at 1440×900, with every non-loopback
  request routed to abort. None was attempted.
- The data is the "Elenta Eval" company (prefix `ELE`) left over from the §13 evaluation: 3 agents
  and 13 tickets, all with a flat org (no `reportsTo`).
- No work was created and no run started. Opening pages marked some inbox items as read, which
  logged "Board read …" activity.
- The server was stopped afterwards by pid (SIGTERM to the server, then the wrapper tree).
  Nothing is left listening on 3100, 13100 or 54329.

Screenshots: `docs/research/img/paperclip-*.png` (28 files). They are referenced inline below.

**Framing (north star).** The goal is a better way to do work: agents that act like teammates you
talk to. Security is the foundation, not the headline. So §2 splits Paperclip's features into:

- **Teammate experience** (T): talking to an agent, the task thread, follow-ups, questions,
  org and roles.
- **Governance** (G).

§2.3 then names the governance pieces that teammates *need* so the owner can let them act with
confidence. The rest of governance can wait.

---

## 1. UI/UX walk-through

### 1.0 Shell and navigation

- **Routes:** `ui/src/App.tsx:152-470` (`boardRoutes`). Every path is prefixed with the company
  key (`/ELE/dashboard`). There are two shells:
  - **"Streamlined"**, the default (`ui/src/hooks/useStreamlinedUiEnabled.ts:7-14`, "fails open").
  - **"Production"** (legacy), lazy-loaded as `*.production.tsx`.
- **Left sidebar** (`ui/src/components/Sidebar.tsx:140-314`), top to bottom:
  - company switcher;
  - **New Task** button;
  - Search (also ⌘K);
  - Dashboard, with a live-run count;
  - Inbox, with an unread badge that turns red when runs fail;
  - optional Chat, Decisions, Status and Conference Room;
  - **Work** group: Tasks, Projects (plus starred projects), Routines, Artifacts, and, behind
    flags, Cases, Pipelines, Goals and Workspaces;
  - **Org** group: Agents, Skills, Connectors, Audit;
  - an **Agents** list where each agent has an avatar and a red "$" badge when budget-paused;
  - **Recent tasks**;
  - the account ("Board").
- **Settings** has its own sidebar ("Back to app": General, Profile, Members, Secrets, Environments,
  Access, Export, Import, Experimental, Plugins, Adapters). See `paperclip-secrets.png`.
- **Feature gates.** Many surfaces sit behind instance flags (`packages/shared/src/types/instance.ts:43-98`),
  for example:
  - `enableAgentChat` (off here: `paperclip-chats.png` shows "Agent Chat is disabled");
  - `enableGoalsSidebarLink` (off, so Goals is reachable only by URL);
  - `enableDecisions`, `enableConferenceRoomChat`, `enableCombinedInboxTasks`.

  The product is mid-redesign, and the flags show it.

### 1.1 Dashboard — `ui/src/pages/Dashboard.tsx` (561 lines) · `paperclip-dashboard.png`

Top to bottom (`Dashboard.tsx:322-560`):

1. **Paused banners** (`:326-357`). "N imported agents are paused and will not run" offers a
   **Resume all** button. "All agents … are paused — nothing will run" links to Review agents.
   "You have no agents" offers "Create one here", which opens onboarding.
2. **Active agents panel** (`components/ActiveAgentsPanel`). One card per agent, showing its
   current or last task, the ticket key, and "Finished 3h ago". It ends with "8 more active/recent
   runs".
3. **Budget incident strip** (`:380-397`), red: "1 active budget incident · 1 agents paused ·
   0 projects paused · 1 pending budget approvals", with an **Open budgets** link.
4. **Four metric cards** (`:399-451`), each a link:
   - Agents Enabled (running / paused / errors);
   - Tasks In Progress (open / blocked);
   - Month Spend (% of budget, or "Unlimited budget");
   - Pending Approvals (budget overrides vs board review).
5. **Charts, last 14 days** (`:456-471`): Run Activity (succeeded / failed / other), Tasks by
   Status, Success Rate. Tasks by Priority is hidden behind `SHOW_TASK_PRIORITY_UI`.
6. **Recent Activity** (verb frame: "Board read Approval-gated run · ELE-12 · just now") and
   **Recent Tasks** (`:480-552`).

`/dashboard/live` (`DashboardLive.tsx`) is a full-screen view of live runs.

### 1.2 Org chart and roster — `ui/src/pages/Agents.tsx`, `OrgChart.tsx` · `paperclip-agents.png`, `paperclip-org-chart.png`

- **Roster** `/agents/{all,active,paused,error,builtin}` (`Agents.tsx:49-100`). Tabs filter by
  status. A **list ⇄ org chart** toggle sits at the top right (`:471-476`, "Org chart view"), next
  to **New Agent**.
- **Org chart** (`OrgChart.tsx`, 673 lines) is a hand-rolled tree layout (`layoutTree` and
  `layoutForest`, `:60-116`) with SVG elbow edges (`:567-590`) and absolutely positioned cards
  (`:592-660`).
  - Each card shows the avatar, a status dot, the name, the title or role, the adapter (in mono)
    and a two-line capabilities summary. Clicking a card opens the agent.
  - Pan by drag, zoom by wheel or pinch, buttons for + / − / fit (`:300-565`).
  - In the streamlined shell `/org` redirects to the roster's org view (`App.tsx:278-281`).
- **Reporting chain is enforced.** Agent detail disables work actions with "Repair this agent's
  reporting chain before assigning tasks or starting runs" (`AgentDetail.tsx:1277-1278`).

### 1.3 Agent detail and hire flow — `ui/src/pages/AgentDetail.tsx` (4,801 lines) · `paperclip-agent-detail.png`, `paperclip-agent-budgeted.png`, `paperclip-agent-tools.png`, `paperclip-hire.png`

- **Header.**
  - Big avatar, name, adapter · role, a star, and "Set as my primary".
  - Buttons from `components/AgentActionButtons.tsx`: **Assign Task**, **Run now**, **Run with
    provider trace**, **Pause / Resume** (`:71-97`), and a "…" menu. The menu holds Duplicate Agent
    (with a `window.confirm`), Copy Agent ID, Reset Sessions and **Terminate** (`:505-518`, no
    confirm dialog, red text).
  - Built-in agents get a pause confirmation and no Terminate (`AgentDetail.tsx:1287-1300`).
- **Left sub-navigation** (`pages/agent-detail-navigation.ts:18-48`):
  - Agent: Overview, Instructions, Skills;
  - Runtime: Harness / Runtime, Secrets & variables, Tools, Channels;
  - Governance: Permissions / Trust, API Keys, Revisions;
  - Audit: Activity, Runs, Costs, Budgets.
- **Overview** (`paperclip-agent-budgeted.png`):
  - "Latest Run" card with status and the agent's one-line result.
  - Identity card: Role, Title, Reports to, Direct reports, Public key, and a `paused` pill.
  - Harness card: Adapter, Model, Session, Last run.
  - Capabilities; Skills.
  - Recent Tasks, with a "Recovery needed" chip on stuck ones.
- **Tools tab** (`pages/AgentToolsTab.tsx`, `paperclip-agent-tools.png`):
  - "**Effective access** — This is exactly the tool set Paperclip will accept for Writer … The
    agent's prompt can narrow this list but cannot expand it — everything else is blocked by
    default."
  - Then Installed apps, an **Allowed tools** table, and a "**Why these tools?**" panel listing
    the access profiles and active policies that produced the list.
- **Run detail** (`agents/:id/runs/:runId`, `AgentDetail.tsx:3390-4470`): a live log stream with
  paged log bytes plus an event stream, Cancel, Resume, workspace operations, and the invocation
  payload card.
- **Hire flow** (`pages/NewAgent.tsx` → `components/new-agent/NewAgentSetup.tsx`, 2,642 lines
  with `AgentBasicsDialog.tsx`):
  1. A modal: "1. Name › 2. Adapter". It says "**Meet your next agent** — Start with a name. Make
     them your own." over a sleeping mascot (`paperclip-hire.png`).
  2. A stepper page: **Connect** (when the adapter needs an account) → **Configure** (model,
     thinking effort, API-key provider or an organization secret, environment, repo and branch)
     → **Confirmation** (`NewAgentSetup.tsx:605-613`).
  3. The confirmation reads either "Your agent is ready" or "**Agent submitted for approval** — An
     organization administrator must approve this agent before it can work" (`:796-818`). While
     pending, "Assign task" is disabled.
- **Server side of a hire** (`server/src/routes/agents.ts:4672`, `4833-4930`):
  - If `companies.requireBoardApprovalForNewAgents` is set (Settings → Hiring toggle,
    `paperclip-company-settings.png`), the agent row is created with `status: "pending_approval"`.
  - A `hire_agent` approval is created. Its payload is a **redacted snapshot** of the requested
    config: name, role, title, reportsTo, capabilities, adapter, runtime config, budget and desired
    skills.
  - Direct `POST /agents` is refused with 4xx in that mode (`:5010-5012`).
  - Agents can hire too, and a hire is idempotent (`:4825-4828`).

### 1.4 Tasks (issues): list, board, detail — `pages/Issues.tsx`, `components/IssuesList.tsx` (2,539), `KanbanBoard.tsx`, `pages/IssueDetail.tsx` (8,516)

- **List** (`paperclip-issues.png`):
  - Day separators ("TODAY"), then rows with a status icon, title, chips ("Recovery needed"), the
    key and relative time.
  - The toolbar has New Task, search, list/board toggle, nesting, columns, filter, sort and group.
- **View state** is persisted per user (`IssuesList.tsx:160-187`):
  - `groupBy` status, priority, assignee, project, workspace, parent or none;
  - sort; `nestingEnabled` (sub-tasks under parents); collapsed groups;
  - board card density and cold-lane mode.
- **Board** (`paperclip-issues-board.png`):
  - Columns are `backlog, todo, in_progress, in_review, blocked, done, cancelled`
    (`KanbanBoard.tsx:41-49`), each with a status-hued tint.
  - Drag a card between columns to change its status (`:445`). Columns page at a configurable size.
  - Cards are compact: key, title, assignee.
- **New Task** (`components/NewIssueDialog.tsx`, `paperclip-new-task.png`) is a chat composer, not
  a form: a "Describe a task…" box, a Project chip, an attach (+) button, an **assignee picker
  (agent avatar)** and send.
- **Detail** (`paperclip-issue-detail.png`, `paperclip-issue-blocked.png`):
  - The redesign makes **the task a chat thread**: "the chat IS the page" (`IssueDetail.tsx:7867-7869`).
    - The owner's request and follow-ups are right-aligned blue bubbles.
    - The agent's reply shows its avatar and name, with Markdown output, copy, 👍 and 👎.
    - The composer at the bottom reads "Message Me — describe what you want done…" with a
      recipient chip.
  - The classic layout has tabs Chat / Activity / Related work (`:7873-7884`).
- **Right "Properties" panel** (`components/issue-properties/IssueProperties.tsx`):
  - WORK: Status, Assignee, Project, Labels.
  - RELATIONSHIPS: Parent, **Blocked by**, **Blocking**, Subtasks (`:2454-2522`).
  - EXECUTION: Reviewers, Approvers, Monitor, Watchdog.
  - ABOUT: Originating, Started, Completed, Created, Updated.
- **Blockers in the UI:**
  - The "Blocked by" picker. `IssueBlockedNotice.tsx` explains why a task waits (including
    "Blocked by parked work").
  - `ExecutionBlockerNotice.tsx`.
  - The server explains why `issue_blockers_resolved` has not fired, with sentences like "…is
    blocked by X, which is cancelled; cancelled blockers do not fire…"
    (`server/src/routes/issues.ts:1665-1683`).
- **Documents** (`components/IssueDocumentsSection.tsx`):
  - A "Documents" section with keyed Markdown documents per task (for example `plan`).
  - Lock and unlock, copy, revision diff (`DocumentDiffModal.tsx`), and inline annotations
    (`DocumentAnnotationLayer.tsx`).
  - Attachments sit in `IssueAttachmentsSection.tsx`. Run ledger: `IssueRunLedger.tsx`.
- **Comments and follow-ups:**
  - `CommentThread.tsx` / `IssueChatThread.tsx`.
  - Queued follow-ups while the agent works can be edited, reordered, discarded, steered into the
    live run, or used to interrupt it (`feature-map/steering.md`).
  - Thread "interactions" are structured cards: `suggest_tasks`, `ask_user_questions`,
    `request_confirmation`, `request_checkbox_confirmation`, `request_item_verdicts`,
    `connection_intent` (`packages/shared/src/constants.ts:259-266`).

### 1.5 Goals — `pages/Goals.tsx` (63), `GoalDetail.tsx` (227) · `paperclip-goals.png`

- An empty state ("No goals yet." + **Add Goal**), then a goal tree.
- Detail shows level, parent, owner agent and status, with linked projects and tasks
  (`feature-map/goals.md`).
- A task without its own goal falls back to its project's goal
  (`server/src/__tests__/issue-goal-fallback.test.ts`).
- Small, and hidden from the nav by default.

### 1.6 Routines and heartbeats — `pages/Routines.tsx` (1,482), `RoutineDetail.tsx` (947) · `paperclip-routines.png`

- **List:** "Recurring work definitions that materialize into auditable execution tasks", with
  **View all runs**, **Create routine**, Sort, Group, **New folder**. Built-in routines are grouped
  separately (`Routines.tsx:249-259`).
- **Editor:** title, description (the request), project, default agent, priority, variables,
  secrets (env) and triggers (`components/routine-triggers/TriggerWizard.tsx`: schedule, webhook,
  manual).
- **Policies with plain-English help** (`Routines.tsx:73-81`):
  - `coalesce_if_active`: "keep just one follow-up run queued" (the default);
  - `always_enqueue`;
  - `skip_if_active`: "Drop new trigger occurrences while a run is still active";
  - catch-up `skip_missed` (default) or `enqueue_missed_with_cap`.
- Each routine keeps a revision history (`routine_revisions`).
- **Agent heartbeats** (timer wakes) are per-agent runtime config. They are off for a new agent,
  and the old instance-settings page now redirects (`App.tsx:245`).

### 1.7 Budgets and costs — `pages/Costs.tsx` (1,164), `audit/AuditHub.tsx` · `paperclip-costs.png`, `paperclip-budgets.png`

- **Where it lives:** under **Audit**, with tabs Activity | Runs | Costs | Budgets | Timeline.
- **Costs:**
  - Range presets (MTD, YTD, custom).
  - Cards: Inference spend (tokens), Budget (% used this month), Recorded charges, Finance events.
  - Per-agent rows; Provider and Biller tabs (`Costs.tsx:505-560`, `590-671`); a finance ledger
    with debits, credits, net and estimated (`:139-159`).
- **Budgets**, the "Budget control plane":
  - Four counters: Active incidents, Pending approvals, Paused agents, Paused projects
    (`:905-925`).
  - An **Active incidents** list. Each card reads, for example, "AGENT HARD STOP · Pending
    approval · Budgeted · Spending reached $0.02 against a limit of $0.01 · This scope is paused.
    New heartbeats will not start until you resolve the budget incident". It has a New budget
    (USD) field, **Raise budget & resume** and **Keep paused** (`components/BudgetIncidentCard.tsx:91-112`).
  - Policy cards per scope (organization, project, agent; `components/BudgetPolicyCard.tsx`): a
    utilization bar; status Healthy / Warning / Hard stop / Paused (`:222`); and Advanced settings
    (`:72-85`) with "**Block new work when usage has no reliable price**" and "**Reserve per run
    (USD)** — An estimate held before each run starts. Zero disables the estimate. Actual provider
    charges may exceed it."
- **Spend shows up elsewhere too:** the agent's sidebar "$" badge and the dashboard strip.

### 1.8 Approvals, inbox and decisions — `pages/Approvals.tsx`, `ApprovalDetail.tsx`, `Inbox.tsx` (3,348), `WhatNeedsMe.tsx` · `paperclip-approvals.png`, `paperclip-approval-detail.png`, `paperclip-inbox.png`, `paperclip-decisions.png`

- **Approvals** `/approvals/{pending,all}`. These are formal board approvals: `ApprovalCard` with
  Approve and Reject.
- **Detail:**
  - Type title ("Budget Override") with a status pill, then the payload rendered as fields (Scope,
    Window, Metric, "Limit $0.01 · Observed $0.02").
  - "See full request", then Approve / Reject / **Request revision**, then the requester can
    **Resubmit** (`ApprovalDetail.tsx:95-122`, `273-297`).
  - A Comments thread.
  - A budget override sends the user to the budget controls to resolve it rather than approving
    in place.
- **Inbox** has tabs Mine / Recent / Unread / Blocked / All.
  - Unread dots, day separators, approvals inline ("Budget Override · Pending").
  - Failed runs inline, with an error excerpt and a **Retry** button.
  - "Mark all as read".
- **Decisions** (`/decisions`, `WhatNeedsMe.tsx`) is "what needs me": saved queues of actionable
  interactions you expand inline.

### 1.9 Tool gateway (Off / Ask first / Allowed) — `pages/apps/*` · `paperclip-connectors.png`

- **Connectors** `/apps`: a catalog and your connections.
- A connection opens on **Permissions** (`apps/:connectionId/permissions`,
  `pages/apps/app-detail/PermissionsPanel.tsx`):
  1. "Which agents can use this connection?" (all or selected; `:129`).
  2. **Actions**, split into **Read (n)** and **Write (n)** lists (`:314-329`). Each action is a
     three-way segmented control (`:446-455`):
     - **Off**: "Agents cannot run this action."
     - **Ask first**: "A human must approve each call."
     - **Allowed**: "Runs without approval."
  3. A risk-level chip, "Paperclip classified this action as …" (`:502`), and a quarantine list for
     newly discovered actions.
- **Ask first** produces a review request with **Approve & run / Always allow / Decline**. It
  appears in the task, in `/apps/review` and in the connection's Review tab
  (`feature-map/questions-and-approvals.md`).
- Advanced: gateways, access profiles, profile wizard (`App.tsx:225-235`).

### 1.10 Secrets — `pages/Secrets.tsx` (4,846) · `paperclip-secrets.png`

- Tabs: Secrets | My secrets | Provider vaults | Proposals.
- An explainer: "Use secrets by binding them to runtime environment variables … Paperclip resolves
  the value server-side when the run starts and injects it as that env var."
- Search; Folders/Flat; New secret.
- Per-user secrets ("one that each user supplies"), proposals reviewed by an authority, vault
  import.

### 1.11 Activity / audit — `pages/audit/AuditHub.tsx`, `AuditFeed.tsx`, `AuditRuns.tsx` · `paperclip-activity.png`, `paperclip-runs.png`

- **Activity:** an actor/verb/object feed with filters and load-more. Rows come from
  `activity_log` (`actor_type`, `action`, `entity_type`, `entity_id`, `details`).
- **Runs:** status filter, each run linked to its task and agent.
- **Timeline:** a Gantt-style view.
- Agent-scoped versions sit in the agent's Audit sub-nav.

### 1.12 Company settings — `pages/CompanySettings.tsx` · `paperclip-company-settings.png`

- General: name, description, logo.
- **Hiring**: "Require board approval for new hires" toggle.
- Decision model (a shared API connection for optional "decision features").
- **Interaction governance**: who may answer thread interactions. The default is "Anyone"; a cap
  can only narrow; tool-approval confirmations "always stay Human only".
- Members, Access, Environments, Plugins and Adapters are separate pages.

### 1.13 Export and import — `pages/CompanyExport.tsx` (1,303), `CompanyImport.tsx` (2,238) · `paperclip-export.png`, `paperclip-import.png`

- **Export** is a package preview: "Exporting 16 of 16 files (~13.4 KB) · 1 warning".
  - Warnings: "command /usr/bin/touch was omitted … system-dependent". "Not included": approvals,
    cost events, activity log.
  - "What to include" checkboxes: Agents, Projects, Skills, Routines, Tasks, Attachments. History
    is opt-in.
  - A file tree (`.paperclip.yaml`, `COMPANY.md`, `README.md`, `agents/<slug>/…`, `skills/…`) with
    a rendered README preview that includes a generated org chart.
  - An **Export N files** button.
- **Import:** preview the package, show conflicts and choices, then apply.
- **Imported agents arrive paused.** The dashboard banner offers "Resume all"
  (`Dashboard.tsx:326-343`).

---

## 2. Feature catalogue and Elenta decisions

**Legend:**

- **Type:** T = teammate experience; G = governance; P = platform/ops.
- **Decision:** Build = our own implementation, Paperclip's behaviour as the reference; Adapt =
  take the idea and reshape it for our model or for Buzz; Skip.
- **Effort:** S ≤ 3 days, M 1–2 weeks, L > 2 weeks.
- **Buzz:** "✅" means Buzz ships it or something close; "📋" means designed in Buzz
  ([FEATURE-PLAN.md §1](../FEATURE-PLAN.md)).

### 2.1 Teammate experience

| # | Feature (one line) | T/G | Buzz | Decision | Why | Effort |
|---|---|---|---|---|---|---|
| T1 | **Task as a chat thread**: request bubble, agent reply with output, composer at the bottom (`IssueDetail.tsx:7867`) | T | ✅ threads | **Adapt** | This is the core teammate feel. Render our job = Buzz thread as a conversation, with structured pieces and outputs inline. No second chat store. | M |
| T2 | **Comments wake the assignee; @mention wakes the mentioned agent** (`issue_commented`, `issue_comment_mentioned`, `heartbeat.ts:1284-1299`) | T | ✅ messages | **Build** | "Talk to it and it acts" is the north star. Map a Buzz reply in a job thread to a wake. | S |
| T3 | **Follow-ups while busy**: queue, edit, reorder, steer, interrupt (`feature-map/steering.md`) | T | — | **Build** (queue + interrupt first; steer later) | This is what makes it feel like a colleague, not a batch job. Our ACP runner can cancel; steering needs session support. | M |
| T4 | **Structured thread questions**: ask_user_questions, request_confirmation, item verdicts (`constants.ts:259-266`) | T | — | **Build** (two kinds: question, confirm) | Lets an agent ask instead of guessing. Pairs with inline approval cards (FEATURE-PLAN §3). | M |
| T5 | **"Comment required" backstop**: every run must leave a comment, with one retry (`docs/guides/execution-policy.md:152-169`) | T | — | **Build** | No silent completions; the owner always gets a reply. Cheap in our runner. | S |
| T6 | **Agent Chat**: persistent 1:1 conversation per agent, with handoff to a task (`pages/AgentChat.tsx`; gated) | T | ✅ DMs | **Adapt** | Use Buzz DMs as the transport; we add "turn this into a job". | M |
| T7 | **New Task as a chat composer with an assignee picker** (`NewIssueDialog.tsx`) | T | — | **Adapt** | Our Boss routes by default; offer "send to a department or person" as an optional chip. | S |
| T8 | **Org chart with roles, titles, capabilities, reportsTo** (`OrgChart.tsx`, `agents.ts:22-30`) | T | — | **Adapt** | Already planned (E1). Show the capabilities line on each card; it helps routing and trust. | M |
| T9 | **Agent profile**: identity, latest run summary, recent tasks, instructions with revisions (`AgentDetail.tsx`) | T | ✅ agent profile | **Adapt** | Merge with the Buzz profile (kind 0). Our extras: department, reports-to, budget state, tools. | M |
| T10 | **Hire flow**: name → adapter/model → confirmation, "submitted for approval" (`NewAgentSetup.tsx`) | T+G | — | **Adapt** | Hiring = adding a person to a department package; the hire is an approval with a config snapshot. No adapter choice (one runner). | M |
| T11 | **Active agents panel and live run view** (`ActiveAgentsPanel`, run detail log stream) | T | — | **Build** | Seeing teammates at work builds confidence; it feeds our 3D floor too. | M |
| T12 | **Task documents**: keyed Markdown per task, revisions, lock, diff, annotations (`issue_documents`, `documents`) | T | ✅ Canvases | **Adapt** | Plans and drafts as keyed docs on the job, released to a Buzz Canvas on sign-off. Annotations later. | M |
| T13 | **Attachments and work products** (`IssueAttachmentsSection.tsx`, Artifacts page) | T | ✅ Blossom | **Skip** our own store | Buzz media storage covers it; we only link. | S |
| T14 | **Sub-tasks and parent/child delegation** (`issues.parentId`) | T | 📋 NIP-34 | **Build** | Our lead's plan = child pieces. Shape tags like NIP-34. | (in E2) |
| T15 | **Goals with level, parent and owner; tasks inherit the project goal** (`goals.ts:15-24`) | T | — | **Build** | "Why" behind each job; shown in the job view. | S |
| T16 | **Inbox**: Mine / Unread / Blocked, failed runs with Retry (`Inbox.tsx`) | T | — | **Adapt** | One "needs me" list: approvals, questions, failures. Paperclip splits it across Inbox, Decisions and Approvals; we should not. | M |
| T17 | **Dashboard**: agents at work, metrics, 14-day charts, recent activity (`Dashboard.tsx`) | T | ✅ Pulse (partly) | **Adapt** | Our 3D office is the dashboard; add a compact metric strip and incident banner. | S |
| T18 | **Search ⌘K** | T | ✅ search | **Skip** | Buzz search. | — |
| T19 | **Conference Room chat** (board chat spawning `claude` with skip-permissions; `routes/board-chat.ts:226-257`) | T | ✅ channels | **Skip** | Unsafe launcher; Buzz channels do this. | — |
| T20 | **Skills and Skill Studio** (authoring, tests, revisions) | T | — | **Skip for now** | We use department packages and a library; revisit later. | — |
| T21 | **Projects and execution workspaces / git worktrees** | P | ✅ git hosting | **Skip** (Buzz git for Software) | FEATURE-PLAN §4.9. | — |

### 2.2 Governance and platform

| # | Feature (one line) | T/G | Buzz | Decision | Why | Effort |
|---|---|---|---|---|---|---|
| G1 | **Atomic checkout** (one run owns a task; conditional UPDATE; 409 for the loser) | G | — | **Build** | Prevents double work; needed before parallel pieces. | S |
| G2 | **Blockers** (`issue_relations` type `blocks`; checkout refused while unresolved; auto-wake on resolve) | G/T | 📋 | **Build** | "Pieces that wait on other pieces." | M |
| G3 | **Pause / resume / terminate** for agents (cancels live runs); subtree pause holds for tasks | G | — | **Build** | Board controls; owner-signed. | S |
| G4 | **Budgets**: per-scope policy, warn 80%, hard stop, incidents, override approval, reservation, unpriced=block | G | — | **Build** | Port the threshold function; reservation on by default. | M |
| G5 | **Approval stages**: review → approval; changes requested return to the same stage; decision needs a comment | G | 🚧 gates | **Build** | Our sign-off grows stages per department. | M |
| G6 | **Formal approvals** (`hire_agent`, `budget_override_required`, `request_board_approval`, `approve_ceo_strategy`) with request revision and resubmit | G | 🚧 | **Build** (hire, budget, generic) | One approvals table, Buzz events. | S |
| G7 | **Tool gateway** Off / Ask first / Allowed per action, per agent grant, risk class, quarantine of new actions | G | — | **Build (small)** | Only when MCP is allowed; built-in tools stay locked by our runner. | M |
| G8 | **"Effective access" view**: the exact tool list plus "why these tools" (`AgentToolsTab.tsx`) | G/T | — | **Build** | Cheap; it is what makes an Ask-first or Allowed decision trustworthy. | S |
| G9 | **Secrets by reference**, bound to env at run start, per-user secrets, proposals, vault import | G | — | **Adapt** (reference + binding only) | No proposals or vaults; agents never see values. | M |
| G10 | **Activity log**: actor / verb / entity with details (`activity_log.ts:9-20`) | G | ✅ audit chain | **Adapt** | Use the Buzz verb/object/outcome frame; keep our chained `audit.jsonl`. | S |
| G11 | **Costs**: per run, agent, provider, biller; finance ledger | G | — | **Adapt** (per run, person, department, job only) | Ledger and billers are too much for a single owner. | S |
| G12 | **Routines**: cron, webhook, manual; concurrency and catch-up policies; variables; revisions | G/T | ✅ workflows | **Adapt** | Triggers via Buzz workflows; we keep the `coalesce_if_active` / `skip_if_active` semantics and a time limit. | S |
| G13 | **Agent heartbeats** (timer wakes) | G | ✅ workflows | **Skip** | Event-driven wakes only; a schedule = a routine. | — |
| G14 | **Wakeup queue with coalescing** | G | — | **Build** | One run absorbs duplicate wakes. | S |
| G15 | **Export / import** with preview, include checkboxes, omitted-items warnings, imports start paused | G | — | **Build** | Matches FEATURE-PLAN §3 "safe import defaults". | M |
| G16 | **Interaction governance** (who may answer which interaction kind; tool approvals human-only) | G | — | **Adapt** | For us: the owner answers approvals; agents may answer each other's questions. | S |
| G17 | **Company settings: hiring requires approval** | G | — | **Build** (always on) | Every hire is an approval; no toggle. | S |
| G18 | **Recovery**: "Recovery needed" chips, scheduled retries, continuation | G | — | **Adapt** (stuck-piece detection + retry) | Teammates who silently stall erode trust. | M |
| G19 | **Multi-company, members, invites, roles, auth modes** | P | — | **Skip** | Single owner; wings cover offices. | — |
| G20 | **Adapters (16), plugins, environments, sandbox providers, native runner** | P | — | **Skip** | Security model (BASE-PLATFORM §13.3). | — |
| G21 | **Cases, pipelines, status cards, smoke lab** (experimental) | P | — | **Skip** | Not core. | — |
| G22 | **External chat channels (Slack and others), email** | T | ✅ (Buzz is the chat) | **Skip** | Buzz is our channel. | — |

### 2.3 Which governance makes teammates trustworthy

To let agents act like teammates without the owner hovering, the minimum governance is the set
that makes each risky moment either **impossible**, **visible** or **reversible**:

1. **Atomic checkout + blockers (G1, G2).** Two teammates never do the same piece, and nobody
   starts before their inputs exist. Without this, parallel work produces duplicates and
   contradictions.
2. **Approval stages with a required comment (G5, T5).** Work reaches the owner as "in review" with
   an explanation, never as a silent "done". This is the "send it to me before it goes out" habit
   of a good colleague.
3. **Ask first on risky tools + the effective-access view (G7, G8).** The agent can act on routine
   things and stops at consequential ones. The owner can see exactly what it could do.
4. **Budgets with a reservation and hard stop (G4).** The owner can leave agents running without
   fearing a runaway bill. The visible "$" badge and incident card make the stop understandable.
5. **Pause / resume (G3) and the activity feed (G10).** There is an obvious off switch, and a
   readable record of "who did what".

Everything else in governance (vaults, proposals, provider ledgers, interaction caps, member roles)
can wait until it is needed.

---

## 3. Data model essentials and behaviours to copy

### 3.1 Tables and fields worth mirroring (in our JSON store / Buzz tags)

| Paperclip table (file:lines) | Fields to mirror | Our shape |
|---|---|---|
| `issues` (`packages/db/src/schema/issues.ts:30-75`) | `status` (+ `statusVersion` for CAS), `priority`, `parentId`, `goalId`, `assigneeAgentId` / `assigneeUserId`, `checkoutRunId`, `executionRunId`, `executionLockedAt`, `identifier`, `requestDepth`, `executionPolicy`, `executionState`, `createdBy*`, `startedAt`, `completedAt` | Job piece: `status`, `version`, `parent`, `goal`, `assignee`, `checkoutRun`, `stages`, `stageState`, `key` (`ELE-12` style) |
| `issue_relations` (`issue_relations.ts:9-17`) | `issueId`, `relatedIssueId`, `type: "blocks"`, `createdBy*` | `after: [pieceId]` plus Buzz `["after",id]` tags |
| `issue_comments` (`issue_comments.ts:18-45`) | `authorType`, `authorAgentId` / `UserId`, `createdByRunId`, `body`, `presentation` (interaction card), `clientRequestId` (dedupe), `deletedAt` | Buzz message in the job thread, with `run` and `kind` tags; `clientRequestId` → event id |
| `documents` + `issue_documents` + `document_revisions` (`documents.ts:9-25`, `issue_documents.ts:9-15`) | keyed doc per issue (`key`), `latestRevisionNumber`, `lockedAt` / `lockedBy` | `job.docs[key] = {rev, body, lockedBy}` |
| `agents` (`agents.ts:22-40`) | `name`, `role`, `title`, `status` (idle / running / paused / error / pending_approval / terminated), `reportsTo`, `capabilities`, `budgetMonthlyCents`, `pauseReason` (manual / budget / system), `pausedAt` | Org-file person + runtime status |
| `agent_wakeup_requests` (`agent_wakeup_requests.ts:18-44`) | `source`, `reason`, `payload`, `status` (queued / claimed / coalesced / finished / failed / cancelled), `coalescedCount`, `idempotencyKey`, `runId` | In-memory wake queue keyed `(person, piece)`, persisted |
| `approvals` (`approvals.ts:8-19`) + `issue_approvals` + `approval_comments` | `type`, `status` (pending / revision_requested / approved / rejected / cancelled; `packages/shared/src/constants.ts:697-703`), `payload` (redacted snapshot), `requestedBy*`, `decisionNote`, `decidedBy`, `decidedAt` | Approval record, owner-signed Buzz event |
| `budget_policies` (`budget_policies.ts:8-26`) | `scopeType` / `scopeId`, `metric`, `windowKind`, `amount`, `reservationCents`, `warnPercent=80`, `hardStopEnabled`, `unpricedUsagePolicy=block` | `settings.json` budgets per office, department, person, job |
| `budget_incidents` (`budget_incidents.ts:10-26`) | `policyId`, window start/end, `thresholdType` (soft / hard), `amountLimit`, `amountObserved`, `status` (open / resolved / dismissed), `approvalId` | Incident record + Buzz `["elenta","budget"]` state event |
| `cost_events` (`cost_events.ts:13-38`) | `agentId`, `issueId`, `projectId`, `goalId`, `heartbeatRunId`, `provider`, `model`, tokens, `costCents`, `costStatus`, `idempotencyKey` | `costs.jsonl` row per run |
| `goals` (`goals.ts:15-24`) | `title`, `level`, `status`, `parentId`, `ownerAgentId` | `goals.json` |
| `routines` (`routines.ts:26-51`) | `assigneeAgentId`, `concurrencyPolicy`, `catchUpPolicy`, `variables`, `status`, `latestRevisionNumber` | `routines.json` (Buzz workflow triggers) |
| `activity_log` (`activity_log.ts:9-20`) | `actorType`, `actorId`, `action`, `entityType`, `entityId`, `runId`, `details` | Audit line in verb/object/outcome frame |

### 3.2 Behaviours to copy precisely

**Atomic checkout** (`server/src/services/issues.ts:11700-11780`). Before the update:

1. Refuse when a **subtree pause hold** covers the issue (`:11700-11713`, 409).
2. Clear stale `executionRunId` / `checkoutRunId` left by terminal runs (`:11715-11716`).
3. Refuse with 422 "Issue is blocked by unresolved blockers" and list them (`:11718-11737`).

Then run one conditional UPDATE (`:11757-11776`):

- **Sets** assignee = this agent, `checkoutRunId` = `executionRunId` = run, `status=in_progress`,
  `startedAt`.
- **Where:**
  - `status IN expected`;
  - `(assignee IS NULL OR (assignee = me AND (checkoutRunId IS NULL OR = run)))`;
  - `(executionRunId IS NULL OR = run)`.

Zero rows means 409 (verified in §13.1). Our version is a compare-and-set on `version` under the
single writer, with a stale-claim release on restart.

**Blockers.**

- A blocker is resolved only when the blocking issue is `done`. Cancelled blockers do **not**
  release (`routes/issues.ts:1674`).
- When the last blocker resolves, the dependent's assignee is woken with reason
  `issue_blockers_resolved`. The wake is idempotent per "ready state"
  (`services/issue-dependency-wakeups.ts:84-121`, `189`), so a re-evaluation never double-wakes.
- A blocker that is waiting for workspace finalization does not release yet (`routes/issues.ts:1665`).
- The UI explains in plain words why a task is waiting.

**Budget thresholds** (`server/src/services/budgets.ts:76-84`):

```
amount <= 0              → ok        (no limit)
observed >= amount       → hard_stop
observed >= ceil(amount * warnPercent / 100) → warning
else                     → ok
```

- **Before invoking an adapter**, `getInvocationBlock(company, agent, {issue, project})` cancels
  the run if any scope is stopped (`heartbeat.ts:17744-17753`).
- **When a hard stop is hit:**
  - pause the scope (`agents.pauseReason = "budget"`);
  - cancel cancellable runs and pending wakes in that scope (`cancelBudgetScopeWork`,
    `heartbeat.ts:30569-30580`);
  - open an incident;
  - create a `budget_override_required` approval.
- **To resolve:** "Raise budget & resume" or "Keep paused". Neither clears unrelated manual pauses
  (`feature-map/budgets-costs.md` gotchas).
- **Two defaults for us to change:**
  - `reservationCents` defaults to 0. That is why one run overshot in §13.4. Make the reservation
    default to an estimated step cost.
  - `unpricedUsagePolicy` defaults to `block`. Keep that.

**Approval stages** (`docs/guides/execution-policy.md`; `services/issue-execution-policy.ts`).

The policy is `stages[]` of `review` or `approval`, each with participants (agents or users).
Execution state holds `status` (idle / pending / changes_requested / completed),
`currentStageId`, `currentParticipant`, `returnAssignee` and `lastDecisionOutcome`.

1. The executor's `done` becomes `in_review` and is reassigned to the first eligible participant,
   **excluding the executor** (no self-review).
2. "Approve" advances to the next stage or finishes.
3. "Changes requested" goes back to `returnAssignee`, `in_progress`, and returns to the **same
   stage** with the same reviewer.
4. Only the current participant may decide (422 otherwise). A decision **must carry a non-empty
   comment in the same request**; a separate comment does not count.
5. Decisions are rows in `issue_execution_decisions`.

**Pause / resume / terminate** (`server/src/services/agents.ts:1009-1086`; routes
`routes/agents.ts:5863`, `6010`):

- **Pause:**
  - sets `status=paused`, `pauseReason` (manual / budget / system), `pausedAt`;
  - refused on terminated agents;
  - the route then calls `heartbeat.cancelActiveForAgent`.
- **Resume:**
  - sets `status=idle` and clears the pause;
  - refused for terminated or `pending_approval` agents;
  - a budget pause should be resolved through the incident, not a plain resume.
- **Terminate:**
  - irreversible, in one transaction: status `terminated` and **revoke all the agent's API keys**;
  - built-ins cannot be terminated or deleted (`agents.ts:1088-1096`);
  - rejecting a pending hire terminates the agent.
- Tasks also have **subtree pause holds** (pause a parent and its children). Checkout honours them.

**Wakeup coalescing** (`heartbeat.ts:28990-29035`, `29340-29370`, `16090-16115`):

- A new wake for an agent and issue that already has an active or queued execution run is
  **absorbed** by that run: the wake row gets `status: coalesced` and its `runId` is set.
- Comments that arrived in between are adopted into the run's context, and the original wake's
  `coalescedCount` is incremented.
- Conversations never coalesce (`allowRunCoalescing: isConversation(issue) ? false : …`), so each
  chat message gets its own turn.
- Routines add `coalesce_if_active` ("keep just one follow-up run queued"), `skip_if_active` and
  `always_enqueue` (`ui/src/pages/Routines.tsx:73-77`).

**Hire approval** (`routes/agents.ts:4833-4930`):

- Create the agent as `pending_approval`.
- Store a **redacted** config snapshot in the approval payload, so the approver sees what will run.
- Approve → `idle`. Reject → terminate.
- Hiring is idempotent per requester.

**Comment backstop** (`execution-policy.md:152-169`):

- After a run with no comment, wake once with `missing_issue_comment`.
- Then mark the run `retry_exhausted`.

---

## 4. UX patterns

### Adopt

- **The task is a conversation** (T1). Request, reply, follow-ups and decisions all happen in one
  thread, with structured cards for questions and approvals. This *is* the teammate feel.
- **A composer for new work**, not a form: "Describe a task…", with an optional recipient chip.
- **Plain-English explanations of every gate:**
  - "This scope is paused. New heartbeats will not start until you resolve the budget incident."
  - "Agents from an organization import arrive paused as a safety default."
  - Why `issue_blockers_resolved` has not fired.
  - "Effective access … can narrow this list but cannot expand it."
- **Three-way segmented control** (Off / Ask first / Allowed), with a one-line meaning under each
  option. Split actions into Read and Write. Show a risk chip.
- **Two clear choices on an incident:** "Raise budget & resume" vs "Keep paused".
- **Global badges where you look anyway:** a red "$" on a budget-paused agent in the sidebar, an
  unread count that turns red when runs fail, a live-run count on Dashboard.
- **"Why these tools?"** next to the tool list: every permission is explained by its source.
- **Approval detail as a field table of the request**, with Request revision → Resubmit and a
  comment thread on the approval.
- **Export preview:** a file tree, include checkboxes, explicit "not included" and "omitted"
  warnings. Imports start paused, with one **Resume all** banner.
- **Inbox rows that act:** a failed run shows its error excerpt and a **Retry** button right in
  the list.
- **Org chart cards** that carry the capabilities line and a status dot; fit-to-screen.
- **Activity rows in "actor verb object" form** ("Board read Approval-gated run"), which matches
  Buzz's activity frame.

### Avoid

- **Too many places for "needs me".** Inbox, Decisions, Approvals, Apps → Review and the
  dashboard Pending Approvals card overlap. We should have one list.
- **Feature-flag sprawl.** More than 25 instance flags. Goals and Agent Chat are hidden by default,
  so key features are undiscoverable. Ship fewer surfaces, all on.
- **Destructive actions without a confirmation:**
  - Terminate sits in a "…" popover with no dialog (`AgentActionButtons.tsx:507-518`);
  - Duplicate uses a native `window.confirm`.

  Ours: a typed or explicit confirmation for terminate, signed into the audit trail.
- **Engineering vocabulary in user UI:** "Harness / Runtime", "Run with provider trace",
  "heartbeats", "adapter", `calendar_month_utc`, `billed_cents`, run ids. Our people language
  (person, department, job, piece) is better.
- **Budget overrides that send you elsewhere.** The approval says "Resolve this … on /costs" instead
  of resolving in place.
- **Giant pages** (8.5k-line IssueDetail, 4.8k AgentDetail and Secrets). Keep views small and
  composable.
- **Unauthenticated loopback = admin** (`local_trusted`). In our UI, every decision needs a
  session.
- **An empty org chart for a flat org.** With no `reportsTo`, the chart is just a row of cards
  (`paperclip-org-chart.png`). Our Boss → department → sub-team structure always gives a tree.

---

## Appendix: screenshot index

`docs/research/img/`:

- **Overview:** `paperclip-dashboard`, `-inbox`, `-decisions`.
- **Agents:** `-agents` (roster list), `-org-chart`, `-agent-detail`, `-agent-budgeted` (paused by
  budget), `-agent-tools`, `-hire`.
- **Tasks:** `-issues`, `-issues-board`, `-new-task`, `-issue-detail` (approval-gated, done),
  `-issue-blocked`.
- **Work setup:** `-goals`, `-routines`.
- **Money:** `-costs`, `-budgets`.
- **Approvals:** `-approvals`, `-approval-detail`.
- **Other:** `-connectors`, `-secrets`, `-activity`, `-runs`, `-company-settings`, `-export`,
  `-import`, `-chats` (disabled state).

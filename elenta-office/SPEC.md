# Elenta Office — product specification (clean-room)

Working name: **Elenta Office** (one constant, `PRODUCT_NAME`, so it can be renamed in one place).

This spec describes behaviour and ideas only. It was written for a clean-room build: the people and
agents who implement it work from this document, public documentation (Node.js, three.js, the Agent
Client Protocol, Claude Code) and nothing else. See `CLEANROOM.md`.

## 1. What it is

A local web app where a company's work is done by teams of Claude agents. The owner sees the whole
organisation as a 3D isometric floor, hands work to a department (or to the Boss, who picks the
department), and gets back one combined, checked result that waits for their approval. Everything
runs on the owner's machine, inside a sandbox, with the network limited to Claude and (optionally)
web search.

Design principles:

1. **Security first.** Nothing leaves the machine without the owner's approval. Agents get no shell,
   no browser, no connectors: they can read the job's library copy, write into the job's `out/`
   folder, and (if switched on) search the web. Every permission decision is logged.
2. **Departments own domains.** A department (e.g. MILITARY) owns all work in its domain: code,
   documents, analysis, compliance. It is made of sub-teams of people.
3. **A job goes to a whole department.** The department lead splits it by sub-team, the pieces run
   in parallel, the lead combines them into one deliverable.
4. **The Boss routes.** Work given to the Boss is handed to the department that owns it, with a reason.
5. **Everything is visible.** Who is doing what, what they read, which tools they asked for, what
   was allowed or refused.

## 2. The org file

`orgs/<name>.json`, chosen by `"org"` in `settings.json` / `settings.local.json` or `EO_ORG`.

```json
{ "title": "Elenta",
  "departments": [
    { "key": "boss", "name": "BOSS", "boss": true,
      "about": "Decides which department owns a request and hands it over.",
      "lead": { "id": "boss", "name": "BOSS", "role": "Head of the office", "does": "…" },
      "teams": [ { "name": "OFFICE OF THE BOSS", "people": [ { "id": "chief-of-staff", "name": "CHIEF OF STAFF", "role": "…", "does": "…" } ] } ] },
    { "key": "military", "name": "MILITARY", "color": "#C9A227",
      "about": "All military-domain work: software, documents, analysis, compliance.",
      "lead": { "id": "mil-lead", "name": "MILITARY LEAD", "role": "…", "does": "…" },
      "teams": [ { "name": "SOFTWARE", "people": [ { "name": "SOFTWARE ENGINEER", "role": "…", "does": "…" } ] } ] }
  ] }
```

Rules (validate at start; report problems as sentences; never half-apply):

- `key`: lower-case letters, digits, dashes, starts with a letter, unique, max 24 chars.
- At most one `boss: true`. 1–12 departments, max 60 people a department, 200 in all.
- `rules` optional: up to 12 sentences (max 240 chars each). They go into every worker's prompt and
  the lead's plan for that department, and override anything a request asks.
- A department may instead be `{ "pack": "<folder>" }`: a department package (§11), resolved
  relative to the org file.
- `id` optional (made from department key + name), unique across the org.
- `name` upper-cased, max 32 chars; `role` max 80; `does` max 400.
- `color` optional `#rrggbb`; otherwise from the product palette.
- A department may be switched off in settings: `"departments": { "<key>": { "on": false } }` or
  `EO_OFF=a,b`. Off = not on the floor (an outline remains), takes no jobs, the Boss never routes to
  it, the server refuses jobs for it. At least one department stays on.

Ship `orgs/elenta.json` (Boss · Military — 101 people in 28 sub-teams covering the staff branches
J1–J9, the full intelligence/recon/cryptology disciplines, info ops, cyber, EW, space, land/air/sea
doctrine, logistics, wargaming, medical and legal, all as staff/knowledge work under its rules ·
Business with Finance, Contracts, Admin) as a draft.

## 3. The library

`library/` (path from settings, `EO_LIBRARY`) is the organisation's knowledge: Markdown notes in
folders, optionally per department (`library/<dept-key>/…`) plus shared ones (`library/shared/…`).
Ship a small sample library for the Elenta draft (8–12 short notes written fresh: house style,
document template, code review checklist, export-screening checklist, test-plan template, glossary).

- **Lessons.** When the owner rejects a deliverable with a note, append it to
  `library/lessons/<dept>.md` with the date. Every later job for that department includes the
  department's lessons in its prompts.
- **Index.** On start and on change, build an index: path, title (first H1 or file name), folder,
  first 200 characters. Agents get the index of what they may read (shared + their department +
  lessons) in their prompt and read notes through ACP `fs/read_text_file`.

## 4. Jobs

A job: `{ id, title, text, dept, routedBy?, mode: "team"|"single", state, lead, pieces[], output, createdAt, updatedAt, events[] }`.

States: `queued → routing (boss only) → planning → working → combining → waiting_approval → done`,
or `failed` / `rejected` / `cancelled`.

1. **Create.** `POST /api/jobs { dept, text, mode }`. `mode` defaults to `team`.
2. **Route (Boss).** If `dept` is the boss department, the Boss decides: given every *other* on
   department's key, name, `about` and sub-team names, it returns `{ dept, why }` as JSON. Unknown
   answer → the boss department keeps the job. Record `routedBy: { by, name, why }`.
3. **Plan.** The department lead (single-person departments skip to 4) gets the request, the
   department's people grouped by sub-team, and the library index. It returns JSON
   `{ pieces: [{ agent, title, text }], why }`: 2..N pieces (N = `settings.team.max`, default 6),
   each owned by a different person, chosen by sub-team fit (code → software, write-up →
   documentation, checks → compliance). Invalid ids dropped; zero valid pieces → the lead does it alone.
   `mode: "single"` skips planning: the lead picks one person.
4. **Work.** Pieces run in parallel (max `settings.concurrency`, default 4), one ACP session each
   (section 5). Each piece writes `out/<piece-id>.md` and returns a one-line summary.
5. **Combine.** The lead reads the piece files and writes `out/deliverable.md` (plus any other files
   pieces produced, kept in `out/`). It lists, at the end, which notes were used and anything marked
   *(assumed)*.
6. **Approve.** The job waits in `waiting_approval`. Approve → copy `out/` to
   `deliverables/<date>-<slug>/` and mark `done`. Reject with a note → `rejected`, the note becomes a
   lesson (section 3), and the owner can re-run with "revise".

Persistence: `data/jobs.json` (atomic write: temp file + rename). Restart marks running jobs `failed`
with the reason "office restarted".

## 5. Agent runs over ACP (the core)

Use the Agent Client Protocol (JSON-RPC 2.0, newline-delimited over stdio) with the adapter
`@agentclientprotocol/claude-agent-acp` (Apache-2.0). One adapter process per piece; kill it when
the piece ends or times out (`settings.timeoutSec`, default 600).

- `initialize` with `clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }`.
- `session/new` with `cwd` = the job workspace, `mcpServers: []`, and
  `_meta: { claudeCode: { options: { allowedTools: [...], disallowedTools: [...] } } }`:
  - disallowed: `Bash`, `BashOutput`, `KillShell`, `Glob`, `Grep`, `NotebookEdit`, `Task`,
    `WebFetch`, `TodoWrite` stays allowed only if harmless; any `mcp__*` except the adapter's own
    file tools. Verify empirically which tool names the adapter exposes and log them.
  - allowed: reading and writing files (through the client fs handlers), and `WebSearch` only when
    `settings.tools.webSearch` is true.
- **Workspace** `work/<job-id>/`: `library/` = a *copy* of the notes this department may read,
  `out/` = where writes go. The agent never sees the real library or anything else.
- **fs/read_text_file**: allowed only for paths inside the workspace (resolve symlinks; reject `..`).
- **fs/write_text_file**: allowed only inside `work/<job-id>/out/`, max 512 KB a file, max 50 files a job.
- **session/request_permission**: policy, in order: (a) anything touching a path outside the
  workspace → reject; (b) write/edit inside `out/` → allow once; (c) read inside the workspace →
  allow once; (d) web search when enabled → allow once; (e) everything else → reject. Log each
  request and decision to the audit log with the tool title and kind.
- **session/update**: stream `agent_message_chunk`, `tool_call`, `tool_call_update`, `plan` into the
  job's events and the live event stream (section 7), tagged with the agent id.
- Routing, planning and combining are ACP sessions too, with *all* tools disallowed except reading
  the workspace (combine) or none (route, plan); they answer in JSON.
- The Claude login stays with the host's Claude Code / adapter auth. The office never handles keys.

## 6. Security (non-negotiable)

- Listen on `127.0.0.1` by default (`EO_HOST` to change for a container that publishes to loopback).
- Every request: `Host` must be `localhost:<port>` or `127.0.0.1:<port>` (or a host listed in
  `settings.allowedHosts`), else 403. Non-GET: if `Origin` is present it must be this office's own
  origin; body must be `application/json`; max 1 MB. Static HTML sent with a strict CSP
  (`default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- No `eval`, no `new Function`, no shelling out with user text, no `innerHTML` with untrusted text
  (escape everything rendered).
- Audit log `data/audit.jsonl`, append-only: job created/routed/planned, each permission request and
  decision, each file read/write by an agent, approvals, settings changes.
- Settings writes only to `settings.local.json` (or `EO_SETTINGS`), atomically.
- Ship `docker/`: a Docker Sandboxes (`sbx`) script that creates a sandbox for the office with
  per-sandbox network rules (`--sandbox NAME`) allowing only the Claude hosts (and the npm registry
  only while installing), mounting only the app folder and the library; and a hardened Compose file
  (non-root, read-only root fs, cap_drop ALL, no-new-privileges, internal network plus an egress
  allowlist proxy) as the fallback.

## 7. HTTP API

| Method & path | Does |
|---|---|
| `GET /api/health` | `{ ok, product, version, org, wing, departments: n, people: n, acp: { adapter, version } }` |
| `GET /api/org` | `{ office: { name, wing, wings }, departments: [{ key, name, about, boss, color, on, lead, teams: [{ name, people: [{ id, name, role, does }] }] }], problems }` |
| `POST /api/departments` | `{ off: [keys] }` → saved to settings.local.json, applies on restart |
| `GET /api/jobs` / `GET /api/jobs/:id` | jobs, newest first |
| `POST /api/jobs` | `{ dept, text, mode? }` → the job (runs in the background) |
| `POST /api/jobs/:id/cancel` | cancel a running job (kill its sessions) |
| `GET /api/approvals` | jobs in `waiting_approval` |
| `POST /api/approvals/:id` | `{ decision: "approve"|"reject", note? }` |
| `GET /api/audit?dept=&kind=&q=&limit=` | audit entries, newest first; `?format=csv` downloads |
| `GET /api/library` | the index; `GET /api/library/note?path=` one note (inside `library/` only) |
| `GET /api/files?job=&path=` | a file from a job's `out/` or its deliverables folder |
| `GET /api/events` | Server-Sent Events: `job` (a job changed), `activity` (`{ agent, dept, kind, text }`: thinking, tool, read, write, done, error) |

Wings: `settings.wings = [{ name, url }]` (only `http://localhost:<port>` / `127.0.0.1`), shown as a
switcher; each wing is a separate office process with its own org, library, data and sandbox.

## 8. The interface (a new design — not modelled on any existing product)

Identity: an **operations room**. Dark by default, light theme available.

- Colours (dark): background `#0E1116`, panels `#161B22`, raised `#1F2630`, lines `#2D3643`,
  text `#E6EDF3`, muted `#8B98A9`, live `#2DD4BF`, waiting/approval `#F5A524`, refused/error `#F87171`.
  Department colours from a palette of 8 muted hues readable on dark.
- Type: **IBM Plex Sans** for text, **IBM Plex Mono** for ids, states, numbers (Google Fonts).
- Layout (≥1280 px): top bar (product name, org title, wing switcher, approvals counter with
  amber badge, audit button, theme toggle) · **left rail** = the organisation as a tree (department →
  sub-team → people, with live state dots; click to focus) · **centre** = the 3D floor · **right
  panel** = Work: the composer at the top (department picker with BOSS first, text, TEAM/SINGLE
  segmented control, Send), then the job list (cards with state chip, routed-by line, a mini
  progress of pieces per sub-team). Below 1280 px the rails collapse into drawers.
- **The floor** (three.js, orthographic isometric camera, soft shadows): a central **Command** hub
  (hexagonal platform, where the Boss and staff sit) and each department as a **hexagonal bay** in a
  ring around it, connected by straight light-paths. Inside a bay, each sub-team is a **cluster**:
  a round table with its people seated around it (not desks in rows), a floating sub-team label (HTML,
  readable, appears when zoomed in). People are simple stylised figures (capsule body, sphere head)
  with a **status ring** on the floor: teal pulsing = working, amber = waiting for approval, red =
  refused/error, grey = idle. The **Library** is a separate small hex beside Command; when an agent
  reads a note, a short light pulse travels Library → that person. When the Boss routes a job, a pulse
  travels Command → the department; when pieces are handed out, pulses go lead → each person.
  Switched-off departments show as a dashed hex outline with the name. Bay size grows with the
  number of sub-teams/people; the ring spreads to keep bays from overlapping.
- **Job view** (opens from a job card): request, routed-by, the plan (pieces by sub-team with owner,
  state and their file), the live activity feed (tool calls with allowed/refused badges, notes read),
  the deliverable rendered as Markdown, and Approve / Reject-with-note buttons.
- **Audit view**: filterable table (department, kind, text search) with CSV export.
- **Departments panel**: switch departments on/off (with the outline consequence explained),
  wing links. Saved → "Restart to apply".
- Accessibility: keyboard reachable, visible focus, `aria-live` for job state changes, no text clipped
  (wrap instead), contrast ≥ 4.5:1.
- A demo mode (opened as a file or with `?demo=1`) plays plausible activity without Claude, using a
  word-matching Boss and timed pieces, so the floor can be reviewed without a login.

## 9. Quality bar

- `npm test`: node:test unit tests (org validation, layout no-overlap, request guards, permission
  policy, path containment, job state machine, audit writing).
- `npm run live`: starts the office on a random port with the Elenta org, sends the Boss
  "Write a one-page test plan for the data-logger software, with a requirements traceability table",
  waits for `waiting_approval` (timeout 15 min), and asserts: routed to MILITARY; ≥2 pieces from ≥2
  sub-teams; `out/deliverable.md` exists and is non-trivial; the audit shows no shell tool, no write
  outside `out/`, no read outside the workspace; then approves and checks the deliverables folder.
- Renders: Playwright screenshots of the overview, a focused department, a job view and the audit
  view (Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--use-gl=swiftshader`).

## 10. Phase 2 — ideas folded in from Munder Difflin (MIT, studied 2026-10-07)

Munder Difflin (github.com/chaitanyagiri/munder-difflin, MIT) runs coding-agent CLIs as an office
with an orchestrator. These general ideas fit Elenta Office; they are re-specified here in our terms.
Nothing from its code or art is used (its pixel art has a separate paid licence).

1. **Circuit breaker.** Every piece and job has a budget: wall time, tokens (from ACP usage updates)
   and tool calls. A ladder: *steer* (send the agent a short correction prompt) when it repeats the
   same refused tool call 3×, or a tool errors 3× in a row; *constrain* (drop it to read-only and
   halve its remaining budget) on a second trip; *stop* (cancel the session, mark the piece failed,
   tell the lead) on a third or when the budget is spent. Each step is an audit entry and shows on
   the floor as the person's ring turning red.
2. **Cost ledger.** Record tokens and cost per piece, job, person and department (from ACP
   usage/turn data) in `data/ledger.jsonl`; show cost per job and a department total; per-department
   monthly budget in settings with a warning at 80% and a stop at 100% (needs the owner's OK).
3. **Model tiering.** `model` per person and per department in the org file, with a default of the
   strongest model for the Boss and leads (routing, planning, combining) and a cheaper one for
   pieces. Shown on each person's card.
4. **Mid-run escalation (not only at the end).** An agent can raise a question to its lead, and a
   lead to the Boss or the owner, through a structured message (below). Categories that ALWAYS go to
   the owner and pause the job (`waiting_owner`): spending money, deleting or overwriting anything
   outside `out/`, a change of scope from the request, a conflict the lead can't settle, anything
   leaving the machine.
5. **Messages between agents.** Each message: `id` (time-sortable), `job`, `from`, `to` (a person,
   `lead`, `boss` or `owner`), `act` (`request` · `query` · `propose` · `inform` · `agree` ·
   `refuse` · `done`), `subject`, `body`, `inReplyTo`, `hops`. Only request/query/propose need a
   reply; each reply adds a hop; past 4 hops the lead (or Boss) decides instead of letting two agents
   loop. Agents send messages by writing `out/messages/<id>.json`; the office (single writer) delivers
   them, logs them and, when a recipient's turn has ended with mail waiting, prompts it again. The
   floor shows an envelope flying between the two people.
6. **Job board.** Each job has `board.md` written only by its lead (the plan, decisions, open
   questions); every piece can read it. Shown in the job view.
7. **Piece dependencies.** Pieces may have `after: [pieceId]` (e.g. the export check runs after the
   document is written). The engine runs pieces when their dependencies are done; the plan view
   draws the order.
8. **Personal memory.** Each person has `library/people/<id>.md`: what they learned (from their own
   one-line "remember:" notes at the end of a piece, and from rejected work). Kept short: when it
   passes 4 KB the lead condenses it into a summary. Read at the start of every piece.
9. **Engines.** Because every run is ACP, a person can use any ACP agent: `engine` in the org file
   names a command from `settings.engines` (default: the Claude adapter). This allows other vendors'
   agents or a **local model** for work that must not leave the machine — with the same permission
   policy, workspace and audit. A local model does not by itself make controlled material permissible;
   that stays a compliance decision.
10. **Steer and resume.** The owner can send a running person a steering note (delivered as a
    message, then a new prompt) or stop them gracefully. On restart, running pieces are resumed
    (ACP `session/load` where the engine supports it) instead of failed; their `out/` files are kept.
11. **Scheduled missions (later).** Recurring jobs (e.g. "weekly export-control watch") with a
    next-run time and a heartbeat in the UI.

Not taken: raw terminals you can type into, agents running git or a shell, the paid sidebar
features, and the third-party pixel art. The code sub-team writes code into `out/`; running tests is
a later, separately approved feature (an office-run, allow-listed command inside the sandbox).

## 11. Department packages

A department can be written as an Open Plugin Spec package in the Buzz persona-pack layout, so Buzz
and other OPS tools read it too (`server/pack.mjs`, `scripts/pack.mjs`, shipped in `packs/`):

- `.plugin/plugin.json`: OPS fields (`id`, `name`, `version`, `description`, `keywords`) and Buzz
  fields (`personas`, `pack_instructions`, `defaults`). No other top-level keys.
- `agents/<id>.persona.md`: Buzz frontmatter only (`name` = person id, `display_name`, `description`
  = role, `runtime: "claude"`, `subscribe: ["#<dept key>"]`, `triggers`); the body is the persona text.
- `instructions.md`: department description, office working rules, department rules.
- `elenta/department.json` (`"schema": "elenta-department/1"`): key, name, about, rules, colour, boss,
  lead id, sub-teams as lists of ids, and each person's role and "does".

Reading a package never runs anything from it: hooks are ignored; MCP servers become connector
requests that need a grant; skills are listed for review; models are ignored; persona paths must be
relative `.persona.md` files inside the package; files over 64 KB are refused. A package without
`elenta/department.json` (a plain Buzz pack) imports with its first persona as lead and the rest as
one sub-team. Export → import gives back the same department (tested).

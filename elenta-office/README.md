# Elenta Office

Elenta Office is a local web app where a company's work is done by departments of Claude agents.
You see the organisation as an isometric floor. You hand a request to a department, or to the Boss,
who picks the department. The department lead splits the work by sub-team, the pieces run in
parallel, and the lead combines them into one deliverable. The deliverable then waits for your
approval. Everything runs on your machine.

Agents run through the [Agent Client Protocol](https://agentclientprotocol.com) using the
`@agentclientprotocol/claude-agent-acp` adapter. Your existing Claude Code login is used. The office
never sees or stores keys.

## Run it

Needs Node.js 22 or later and a working Claude Code login (`claude -p "hi"` should answer).

```sh
npm install
npm run build     # builds the interface into web/dist
npm start         # http://127.0.0.1:4180
npm test          # unit tests (node:test), no Claude needed
npm run live      # end-to-end run against real Claude (a few minutes)
```

`npm run live` starts an office on a random port with its own temporary folders. It asks the Boss
for a one-page test plan with a traceability table and waits for the result. It checks the
routing, the pieces, the deliverable and the audit trail, then approves the job.

## Settings

Settings are read in this order: `settings.json` (defaults, checked in), then `settings.local.json`
(your changes; the office writes only this file), then environment variables.

| Setting | Env | Default | Meaning |
|---|---|---|---|
| `org` | `EO_ORG` | `elenta` | which `orgs/<name>.json` to load |
| `library` | `EO_LIBRARY` | `library` | notes folder |
| `host` / `port` | `EO_HOST` / `EO_PORT` | `127.0.0.1` / `4180` | where to listen (`EO_PORT=0` = random) |
| `dataDir`, `workDir`, `deliverablesDir` | `EO_DATA`, `EO_WORK`, `EO_DELIVERABLES` | `data`, `work`, `deliverables` | state folders |
| `team.max` | | 6 | most pieces in a team job |
| `concurrency` | `EO_CONCURRENCY` | 4 | pieces running at once |
| `timeoutSec` | `EO_TIMEOUT_SEC` | 600 | time limit per agent run |
| `tools.webSearch` | `EO_WEB_SEARCH` | false | allow the WebSearch tool for pieces |
| `model` | `EO_MODEL` | adapter default | Claude model for all agents |
| `allowedHosts` | | `[]` | extra `Host` values to accept |
| `wing`, `wings` | `EO_WING` | | this office's name, and links to other offices (`http://localhost:<port>` only) |
| `departments` | `EO_OFF=a,b` | | `{ "<key>": { "on": false } }` switches a department off |
| | `EO_SETTINGS` | `settings.local.json` | path of the local settings file |

## Org file

`orgs/<name>.json`:

```json
{ "title": "Elenta",
  "departments": [
    { "key": "boss", "name": "BOSS", "boss": true, "about": "Routes requests.",
      "lead": { "id": "boss", "name": "BOSS", "role": "Head of the office", "does": "..." },
      "teams": [ { "name": "OFFICE OF THE BOSS", "people": [ { "name": "CHIEF OF STAFF", "role": "...", "does": "..." } ] } ] },
    { "key": "military", "name": "MILITARY", "color": "#C9A227", "about": "...",
      "lead": { "name": "MILITARY LEAD", "role": "...", "does": "..." },
      "teams": [ { "name": "SOFTWARE", "people": [ { "name": "SOFTWARE ENGINEER", "role": "...", "does": "..." } ] } ] }
  ] }
```

Rules, checked at start:

- `key`: lower-case letters, digits and dashes, starting with a letter. Unique, at most 24 characters.
- At most one department has `"boss": true`.
- 1 to 12 departments, at most 30 people in a department and 150 in total.
- `id` is optional. If it is missing, it is made from the department key and the person's name.
  Every id must be unique.
- `name` is upper-cased and at most 32 characters. `role` is at most 80 characters and `does` at
  most 400.
- `color` is optional (`#rrggbb`). If it is missing, a colour comes from the built-in palette.

If the file has any problem, the office does not apply it. It lists each problem as a sentence
(`GET /api/org` → `problems`) and refuses jobs until the file is fixed.

The shipped `orgs/elenta.json` is a draft with three departments:

- BOSS, with the OFFICE OF THE BOSS.
- MILITARY, with SOFTWARE, DOCUMENTATION, ANALYSIS and COMPLIANCE.
- BUSINESS, with FINANCE, CONTRACTS and ADMIN.

## Library

`library/` holds Markdown notes:

- `shared/` can be read by everyone.
- `<dept-key>/` can be read only by that department.
- `lessons/<dept-key>.md` is written by the office. When you reject a deliverable with a note, the
  note is added there. Every later job for that department gets those lessons in its prompts.

Each job gets a copy of the notes its department may read. Agents read only that copy.

## Security model

- **Network.** The office listens on 127.0.0.1. It answers only when the `Host` header is this
  office (`localhost:<port>` or `127.0.0.1:<port>`).
- **Write requests.** Only POST is accepted for changes. The body must be `application/json`
  and at most 1 MB, and a cross-site `Origin` is refused.
- **Pages.** Pages are sent with a strict Content Security Policy, `nosniff` and
  `no-referrer`.
- **Agent tools.** Each agent run is one adapter process and one ACP session, with
  `terminal: false`. The step decides which built-in tools Claude Code gets, through
  `_meta.claudeCode.options.tools`:
  - Routing and planning get no tools.
  - Pieces and combining get `Read`, `Write` and `Edit` (plus `WebSearch` if switched on).
  - Shells, Glob/Grep, Task/Agent, WebFetch, notebooks, skills and MCP tools are also in
    `disallowedTools`.
  - User and project settings, hooks and MCP servers are not loaded (`settingSources: []`).
  - claude.ai connectors are switched off in the adapter's environment.
  - Nothing is pre-approved (`allowedTools: []`).
- **Tool check.** The office reads the tool list Claude Code reports at session start and logs
  it. If the list has an unexpected tool or any MCP server, the office stops the run.
- **Permission policy.** Every `session/request_permission` is decided by the office, in this
  order:
  1. A path outside the job workspace is refused.
  2. A write or edit inside `out/` is allowed once.
  3. A read inside the workspace is allowed once.
  4. A web search is allowed once, but only when switched on.
  5. Everything else is refused.

  The office never chooses an "always allow" option.
- **File handlers.** `fs/read_text_file` and `fs/write_text_file` are also implemented with the
  same limits:
  - Paths are resolved with `realpath`, `..` is refused, and symlinks that escape are refused.
  - A file may be at most 512 KB, and a job may write at most 50 files.

  This version of the adapter uses Claude Code's own file tools. So in practice the permission
  policy is what controls writes.
- **Audit log.** Every job event, permission decision, file read and write, approval and settings
  change goes to `data/audit.jsonl`. The file is append-only and you can view it at `/api/audit`
  (CSV export available).
- **Sandbox.** `docker/` has the sandbox kit:
  - `sbx-office.sh` creates a Docker Sandbox per office with deny-by-default network rules. Only
    the Claude hosts are allowed, plus the npm registry while installing. Only the app folder and
    the library are mounted.
  - `compose.yaml` is a hardened fallback. It runs as non-root with a read-only root, no
    capabilities and no-new-privileges. It uses an internal network, and the only way out is an
    allowlist proxy.

## HTTP API

| Method & path | Does |
|---|---|
| `GET /api/health` | `{ ok, product, version, org, wing, departments, people, acp: { adapter, version } }` |
| `GET /api/org` | `{ office: { name, product, wing, wings }, departments: [...], layout, problems }` |
| `POST /api/departments` | `{ off: [keys] }` → saved to settings.local.json; restart to apply |
| `GET /api/jobs` | `{ jobs: [...] }`, newest first (without `events`) |
| `GET /api/jobs/:id` | the job with `events` and `deliverable` (Markdown text or null) |
| `POST /api/jobs` | `{ dept, text, mode? }` → the job (201); it runs in the background |
| `POST /api/jobs/:id/cancel` | cancel a job |
| `POST /api/jobs/:id/revise` | `{ note? }` → a new job that re-runs the request with the note |
| `GET /api/approvals` | `{ jobs: [...] }` waiting for approval |
| `POST /api/approvals/:id` | `{ decision: "approve" \| "reject", note? }` |
| `GET /api/audit?dept=&kind=&q=&job=&limit=&format=csv` | `{ entries, kinds }`, newest first, or CSV |
| `GET /api/library` | `{ notes: [{ path, title, folder, excerpt, bytes, updatedAt }] }` |
| `GET /api/library/note?path=` | `{ path, text }` |
| `GET /api/files?job=&path=` | a file from the job's `out/` or its deliverables folder |
| `GET /api/events` | Server-Sent Events: `hello`, `job`, `activity`, `library` |

## Clean-room note

Elenta Office was built clean-room from `SPEC.md`, public documentation and public packages. See
`CLEANROOM.md` for the record.

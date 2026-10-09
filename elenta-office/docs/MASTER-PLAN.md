# Elenta Office — master plan

8 October 2026. Built from five research reports in `docs/research/` (Grok Bot, Rakazo, Buzz,
Paperclip, connectors), the base-platform decision in `docs/BASE-PLATFORM.md` (§13: Option 1) and
what already runs in this repo (server, ACP runner, 41 tests, live run passing).

## 1. North star

**A better way to do work: you talk to agents that act like teammates.** You give work the way you
would to a colleague — a sentence, an @mention, a reply in a thread — and teammates plan it, split it,
do it, ask when they need you, and come back with a result. Departments and sub-teams are how the
teammates are organised; the Chief of Staff (our "Boss") is the colleague who knows who does what.

Security is the foundation, not the headline: teammates can act with confidence *because* nothing
risky happens without you, every action is recorded, and spend has limits.

**The test for every feature** (borrowed from xAI's Grok Bot design essay): *does this help someone
delegate, or does it give them one more thing to manage?*

## 2. What we take from each project

| Source | Take | Leave |
|---|---|---|
| **Grok Bot** (xAI, via Cursor; the experience the owner likes) | Teammate list as the main navigation, each row showing the teammate's latest line in its own voice · avatars that show state through motion (idle, working, waiting, blocked, done) · one mixed timeline: chat, one-line events, cards (drafts, files, questions, approvals) · teammates speak first ("Meet your Chief of Staff") · routines from a sentence ("do this every morning") · group chats of 2–6 teammates who decide who answers · three attention states: needs you / new result / working · you can redirect mid-job · a small, de-emphasised "computer" | Shared credentials and computer for all bots · approvals decided by a model · "test runs" that do real work · hidden model routing · no visible cost per teammate · no way to start fresh |
| **Rakazo** (Apache-2.0) | Calm chat: tool steps hidden, progress as short notes from the teammate · decision cards that block until answered (choice, Allow once / Always / Deny, secret entry) · delegation in three sizes: a quick helper, a new nested teammate, a message to another teammate tagged request / result / question / status / fyi · results route back to the sender · hop limit (6) · "one teammate owns each stage, never bounce" · Markdown memory per teammate and shared per team, an open-items list, skills taught by showing · routines as plain prompts, allowed to stay silent · "Now / Recent / Needs input" | Risky actions run without asking by default ("stays YOLO") · shell, file writes and browser never gated · open outbound network in computers · host-machine computer |
| **Buzz** (Apache-2.0, our base) | Relay as system of record: identities, channels, threads, DMs, search, canvases, media, hash-chained audit · agents as channel members with honest presence ("unknown" is a state) · working timer and "Thinking…" signal · edit an @mention to redirect · activity feed written as *verb · object → outcome* · git hosting for code, bound to channels · editable channel records (kind 45010) for tickets with one-winner edits · scheduled/webhook workflow triggers · Stop / Restart / Message / Follow on a teammate's profile | Its agent harness and tools (auto-approve, shell, key in env) · workflow approval steps (not working yet) · buttons that look actionable but aren't |
| **Paperclip** (MIT) | Task as a chat thread · comment or @mention wakes the teammate · follow-ups you can queue or use to interrupt · structured questions · "never finish silently" (must leave a comment) · one owner per task (atomic checkout) and blockers · review stages that need a comment · Allow / Ask first / Off with one line of meaning each, "Why these tools?" · budgets with reservation and hard stop, "Raise budget & resume" vs "Keep paused", a $ badge · pause / resume, confirmed terminate · imports start paused · plain-English text on every gate | Unsafe defaults (skip permissions, full env, run-any-command agents, no-auth local mode) · four overlapping inboxes · features hidden behind flags · terminate without confirmation · engineering vocabulary |
| **Composio + MCP** | Breadth: 1000+ everyday apps through one office-run **Connector Gateway**, the only connector a teammate ever sees · per-department grants, Ask first for anything that sends, shares, deletes or pays · a local tier (Docker MCP Gateway, containers, network-blocked) for anything that must stay on the machine | Composio's remote-code and multi-call meta-tools · its sandbox · logs of arguments/results (turn on Zero Data Retention) · agents managing their own connections |

## 3. The product, in its own words

Six things a person deals with (Grok's lesson: few concepts):

1. **Teammates** — named, with an avatar, a role, a model, memory you can read and edit, skills, and
   tools they're allowed to use. They belong to a **team** (department) and a **sub-team**.
2. **Chats** — with one teammate, a team (group chat), or the Chief of Staff. Each piece of work is a
   **thread** inside a chat.
3. **Results** — documents, files, code changes, drafts; shown as cards in the chat, collected per
   team.
4. **Needs you** — the single inbox: approvals, questions, budget stops, reviews.
5. **Routines** — recurring work set up by saying it.
6. **The Office** — the 3D floor: who's doing what, at a glance.

Departments, budgets, connectors, audit and settings exist, but behind these six.

## 4. Experience design

### 4.1 Layout (desktop ≥ 1280 px)

- **Left: teammates and teams.** Chief of Staff pinned at the top, then teams (departments) with
  their teammates; each row: avatar with state motion, name, latest line in their voice, badges
  (needs you · new result · $ paused). Search and "New chat".
- **Centre: the conversation.** One timeline: messages, quiet progress notes, one-line events
  ("Handed the test cases to Software"), and cards (plan, question, approval, result, file, code
  review). A composer at the bottom that accepts @mentions, files, "every morning…", and new
  instructions while a teammate is working.
- **Right (collapsible): context.** For a teammate: profile, what they're doing, memory, skills,
  tools ("Why these tools?"), cost this month, Stop / Pause / Message. For a thread: the plan by
  sub-team, pieces with owners and state, blockers, files.
- **The Office** is a top-level view (and a small live thumbnail in the left rail): the 3D building
  from the v2 boards, rooms per team, desks per sub-team, status on each desk. Click a desk → that
  teammate's chat. **Decision for the owner:** this plan puts conversation in the centre and the floor
  one click away (the research is consistent on this); the v2 boards put the floor in the centre.

### 4.2 Key flows

| Flow | How it feels |
|---|---|
| **First run** | Sign in → "Meet your Chief of Staff" card → Chief of Staff speaks first: what it can do, asks what you're working on → offers to set up your first team from a template or a sentence ("I run a defence R&D group with software, docs and compliance"). Team packages show a "Meet your new team" review card before anyone is created. |
| **Give work** | Type to the Chief of Staff, a team, or a teammate. The Chief of Staff answers "Passing this to Military — it's a software test plan" (one line, with why), then the team lead posts a plan card ("Analysis: traceability · Software: test cases · Docs: assemble · Compliance: review"). |
| **Watch it happen** | Quiet: avatars move; progress notes ("Traceability table done — 12 requirements, one gap"); one-line events. Detail on hover / expand (Buzz's verb · object → outcome). |
| **Teammates talk to each other** | Messages tagged request / question / result; results route back; a hop limit stops loops; you can read any of it in the thread. |
| **Needs you** | A card in the chat *and* one row in Needs you: what will happen, whether anything leaves the machine, checks passed, cost. Allow once / Always allow / Deny, or Send back with a note (becomes a lesson). The thread waits. |
| **Redirect** | Reply in the thread or edit your @mention; the teammate picks it up mid-job. Stop is always one click. |
| **Result** | A result card: rendered document, files, code review. "Approve & release" (copies to deliverables, posts to the team channel, merges reviewed code). |
| **Routines** | "Can you do this every Monday?" → a routine card to confirm (when, what, silent if nothing to report). Skips if the last run is still going. |
| **Teach** | "Save what we just did as a skill" → a skill card the teammate will follow next time. |
| **Memory** | The teammate's memory is a readable, editable page; it updates with your corrections and rejected work. |

### 4.3 Design system

The v2 canvas page sets the look (light, architectural, IBM Plex, four status colours). Updated per
this plan: conversation-first layout, avatar state motion, card set (plan, question, approval, result,
file, code review, routine, skill, budget), Needs you inbox, teammate profile with memory and tools.

## 5. Architecture

```
            ┌────────────── Elenta app (web / desktop) ──────────────┐
            │ teammates · chats · cards · Needs you · Office (3D)    │
            └──────────────┬─────────────────────────────────────────┘
                           │ HTTP + SSE (loopback, CSP, origin guard)
┌──────────────────────────┴───────────────────────────────────────────────┐
│ Elenta control plane (Node, ours)                                         │
│  Chief of Staff routing · team planning · threads ⇄ jobs/pieces           │
│  ACP runner + permission policy (no shell; env allowlist; workspace jail) │
│  tickets: one owner + blockers · budgets (reservation, hard stop)         │
│  approvals & review stages · pause/resume/terminate · routines            │
│  memory & skills (Markdown) · cost ledger · audit (chained)               │
│  Connector Gateway (the only MCP server agents see)                       │
│     ├─ Composio tier: listed tools only, ZDR, our OAuth apps              │
│     └─ Local tier: Docker MCP Gateway containers, network-blocked         │
└──────┬───────────────────────────────┬───────────────────────────────────┘
       │ signs events (sole key holder)│ ACP (stdio) per piece
┌──────┴────────────────┐      ┌──────┴──────────────────────┐
│ Buzz relay (Apache-2.0)│      │ claude-agent-acp → Claude   │
│ identities · channels  │      │ (or other ACP engines later)│
│ threads · DMs · search │      └─────────────────────────────┘
│ canvases · media       │
│ records (tickets)      │      Everything inside a Docker Sandboxes microVM
│ git hosting · audit    │      per office (wing), loopback ports only,
│ schedule triggers      │      per-sandbox network rules.
└────────────────────────┘
```

**Mapping onto Buzz:** team = private channel · teammate = member with its own identity (key held by
the control plane) · thread = job · plan pieces = editable records (kind 45010) anchored to the
thread, one-winner edits give atomic ownership · approvals = owner-signed events, verified by the
control plane before acting · results = canvases/media · code = Buzz repo bound to the team channel,
office as single committer, merge only the commit the owner approved · routines = Buzz schedule
triggers posting a marker the control plane acts on.

**Not used from Buzz:** `buzz-acp`, `buzz-agent`, `buzz-dev-mcp`, workflow approval steps.

### 5.1 Stick to Buzz: extend it, never fork it (decided 2026-10-09)

Buzz is the base and the place people talk to their teammates: its desktop and mobile apps, its
channels, threads and DMs. Elenta adds what Buzz does not have, through Buzz's public interfaces only
(REST, WebSocket subscriptions, the CLI/SDK, webhooks and the event kinds the relay already accepts).
We do not patch or fork Buzz. Anything we need from Buzz itself we propose upstream (Apache-2.0); a
fork is a last resort, decided by the owner, for a feature upstream refuses and we cannot live
without. Upstream proposals are tracked in [UPSTREAM.md](UPSTREAM.md).

**What Elenta adds on top of Buzz**

| Addition | What it is | How it attaches to Buzz |
|---|---|---|
| **Agent visualisation dashboard** | The Office: 3D floor of departments, sub-teams and desks; avatars in four states (working, waiting for you, refused/stopped, idle); live activity line per teammate; job timeline; cost per teammate and team | Reads the signals Buzz's own app uses: observer frames (kind 24200) and typing (kind 20002) for "working", plus our job/piece records (kind 45010) and channel messages. Read-only; no new kinds |
| **Needs you** | One inbox for sign-offs, questions, connector actions and budget limits, with exactly what will happen | Decisions are owner-signed events in the job thread; until Buzz renders decision cards, the thread gets a message with a link to the dashboard |
| **Control plane** | Chief of Staff routing, team planning, ACP runner with permission policy (no shell, env allowlist, workspace jail), budgets with reservations, pause/resume/terminate, review stages, memory and lessons, routines with skip-if-running | Holds the teammates' keys and posts as them; jobs = threads, pieces = kind 45010 records |
| **Connector Gateway** | The only MCP server agents see; Composio tier and local tier; Allow / Ask / Never per team and tool | Grants recorded as events; approvals replay the exact arguments |
| **Department packages** | A department (sub-teams, people, rules) as an Open Plugin Spec package in Buzz's persona-pack layout | Buzz's own validator accepts them (`buzz pack validate`); see 5.2 |

**What we use from Buzz as is:** relay, identities, channels, threads, DMs, search, canvases, media,
hash-chained audit, schedule-trigger workflows (routines), git hosting, the desktop and mobile apps.
**What we do not run:** `buzz-acp`, `buzz-agent`, `buzz-dev-mcp` (they auto-approve and give agents a
shell) and workflow approval steps (they fail today).

### 5.2 Department packages = Open Plugin Spec packages (done 2026-10-09)

A department is one package, the same family as Buzz persona packs, so a team defined in Elenta can
be read by Buzz and other OPS tools and we follow a standard instead of inventing one.

```
packs/military/
  .plugin/plugin.json         OPS manifest + Buzz fields (personas, pack_instructions, defaults)
  agents/<id>.persona.md      one teammate; Buzz frontmatter only (Buzz rejects unknown keys there)
  instructions.md             department instructions and rules
  elenta/department.json      our extras: sub-teams, lead, colour, rules, "does" (others ignore it)
```

- `node scripts/pack.mjs export orgs/elenta.json all packs` writes them; `check <dir>` prints the
  review. An org file can name a department as `{ "pack": "packs/military" }`.
- Checked with Buzz's own validator (`buzz_persona::validate::validate_pack`): Boss, Military and
  Business packs are valid with no warnings; Buzz's example pack imports into Elenta.
- Import is data only: hooks are never run, MCP servers are never started (they become connector
  requests that need a grant), skills are listed for review, model choices are ignored, paths cannot
  leave the pack. Packs imported from outside start paused behind a "Meet your new team" review.

### 5.3 The Military group: eight departments (2026-10-09)

Military is a **group of eight departments** (not one giant department), so the Boss routes straight
to the right one and each is easy to scan and ships as its own Open Plugin Spec pack:

| Department | Covers | People |
|---|---|---|
| **Intelligence** | all-source & technical intel (HUMINT/SIGINT/MASINT/DOMEX/biometrics doctrine), cryptology, ISR & recce (GEOINT/imagery, OSINT), geospatial & METOC, counter-intel | 18 |
| **Operations & Plans** | command group, operations (J3), plans (J5, red team), fire-support coordination, wargaming & OR, training & exercises (J7) | 15 |
| **Information & Civil-Military** | info ops & PSYOP doctrine, public affairs, communication products, civil-military & cultural liaison | 8 |
| **Cyber, EW & Space** | cyber defence & authorised adversary emulation, CIS, electronic warfare, spectrum, space support | 9 |
| **Warfare Doctrine** | land, aviation and maritime warfare — doctrine, training and EXERCISE simulations only | 17 |
| **Logistics & Engineering** | sustainment, supply chain, movements, fuels, aerial delivery, field feeding, engineering & maintenance | 11 |
| **Capability & Technical** | capability (J8), science & technology, software & systems, test & evaluation, documentation | 15 |
| **Personnel, Medical & Legal** | personnel (J1), medical/veterinary/chaplaincy, legal, military police, compliance | 15 |

115 people in all. A new optional department field, **`group`**, carries the "Military" label (Business
is its own group); the floor clusters a group's rooms together and the Boss's routing sees the group.
Departments in a group **share a notes folder** (`library/military/`) on top of their own, so a split
department still reads the shared doctrine and templates.

Every teammate is a sandboxed text agent that writes doctrine, training, plans, procedures, analysis
and EXERCISE simulations — not an operator. Each military department carries the same rules (in its
prompts, the lead's plan and its package): **staff and analysis work only, people decide and act**; no
selecting, locating, prioritising or recommending weapon employment against real people, places or
objects; intel / recon / SIGINT / MASINT / DOMEX only on supplied or open-source material, no
collection on or biometric identification of private individuals; cyber and adversary-emulation on
authorised or lab systems only; information and deception work truthful or clearly-marked EXERCISE;
combat / aviation / naval / artillery / special-operations roles produce doctrine and training only;
nothing classified, ITAR/EAR or CUI; medical, legal and detainee-handling work follows the law of
armed conflict and flags anything needing a qualified human.

**Security defaults (vs. what the others ship):** ask first for anything that sends, shares,
deletes, pays or runs unattended (Rakazo and Grok default the other way) · no shell, no host access,
no open network · agents never hold keys or credentials (the env allowlist is done) · approvals are
decided by you, not a model · terminate needs confirmation · imports start paused · costs visible per
teammate and team.

## 6. Data (control plane)

Mirrored from Paperclip's model where it helps, stored in our store with Buzz events as the shared
record: teammates (identity, team, sub-team, model, memory doc, skills, tools grants), threads/jobs,
pieces (owner, state, blockers, reservation), comments/messages (intent tag, hops), approvals
(kind, exact action, decided by, signature), budgets (scope, period, limit, warn %, reserved,
spent), cost events, routines (schedule, prompt, silent-ok, last run, skip-if-running), connector
grants (team × tool → allow/ask/never), audit (chained, anchored to Buzz's chain).

## 7. Phases

Estimates assume one engineer with Claude; each phase ends with its tests green and a demo.

| # | Phase | What ships | Tests | Est. |
|---|---|---|---|---|
| 0 | ~~Foundations~~ | Server, ACP runner with policy, Boss routing, team runs, approvals, audit, env allowlist, OPS department packages, full Military department | 47 unit + live run; Buzz validator on packs | done |
| 1 | **Buzz as the conversation, Elenta as the dashboard** | Teammates live in Buzz channels/DMs (talk to them in Buzz's app); Elenta dashboard: the Office (3D) driven by Buzz working signals, Needs you inbox, job timeline, teammate profile, costs | Playwright flows: give work, approve, send back, redirect, stop | 2–3 wk |
| 2 | **Teammates that feel alive** | Chief of Staff speaks first; avatars with state motion; quiet progress notes; latest-line previews; group chats with one owner per stage; teammate-to-teammate messages with intents and hop limit | Conversation tests with a fake engine + one live run | 2 wk |
| 3 | **Buzz as the record** | Buzz kit (pinned image, loopback, no attestation login); identities per teammate held by the control plane; teams = channels, jobs = threads, pieces = records; audit anchoring | Relay integration tests; isolation tests (non-member can't read) | 2 wk |
| 4 | **Trust controls** | One owner + blockers; budgets with reservation and hard stop; pause/resume/terminate (confirmed); review stages; "Why these tools?" | Overshoot test, blocker release, terminate confirm | 2 wk |
| 5 | **Connectors** | Connector Gateway; local tier (one server); Composio pilot for one team (mail, calendar, drive) with listed tools only and ZDR; inline approval cards replay exact arguments; grants UI | Gateway policy tests; denied call never reaches Composio | 2–3 wk |
| 6 | **Memory, skills, routines** | Editable memory pages; lessons from send-backs; "save as skill"; routines from a sentence with skip-if-running | Memory edits reflected in next run; routine skip test | 2 wk |
| 7 | **Code teams** | Buzz git hosting for a Software sub-team: office commits, review card in the thread, merge only the approved commit | Merge refused if commit changed; non-owner approval rejected | 1–2 wk |
| 8 | **Team packages & polish** | ~~OPS packages~~ (done); "Meet your new team" review screen; import paused; offer packs to Buzz's planned app store; light/dark; mobile-friendly dashboard; accessibility pass | Import starts paused; a11y checks | 1–2 wk |

Total ≈ 14–18 weeks to a complete product; phases 1–2 alone already deliver the teammate experience
on today's backend.

## 8. Decisions needed from the owner

1. **Dashboard home screen:** Needs you + Office side by side (recommended, since conversation now
   happens in Buzz's app) — or the 3D floor full screen.
2. **Composio terms:** accept the cloud tier for everyday apps with Zero Data Retention (paid add-on)
   and our own OAuth apps; ask Composio for written answers on the May 2026 incident and
   CVE-2026-59807 before rollout.
3. **Chief of Staff naming:** "Chief of Staff" (Grok's term) or keep "Boss".
4. **Product name:** keep "Elenta Office" or choose another.

## 9. Risks

Buzz is unfinished and its docs drift from code (pin a version; integration tests per upgrade) ·
Composio holds sign-ins and sees calls (ZDR, scope, local tier for sensitive teams) · model cost of
teams-of-teammates (reservations, per-teammate cost, cheaper models for pieces) · upstream changes in
the ACP adapter (pin, fail-closed tool check already in place) · the 3D floor's performance on low-end
machines (it's optional in this layout).

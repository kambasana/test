# Elenta Office — project hand-off

Status snapshot for picking the project up cold. Written 2026-10-10.

## 1. What this is
**Elenta Office** — a product where you work with AI teammates organised like a
real office (departments, sub-teams, a Boss that routes work). North star: *talking
to agents that act like teammates is a better way to work* (the Grok Bot idea).
Security is the foundation, not the headline; defence is one use case, not the point.

- **Clean-room product** in `/home/user/test/elenta-office` (repo `kambasana/test`,
  branch `claude/agents-office-review-0u8a6p`). It is an original build; we studied
  others but copy no licensed code. See `CLEANROOM.md`.
- It replaced an earlier plan to rename/rebrand a third party's repo (AJ Sahni's
  "agents-office"), which his LICENSE (PolyForm NC + additional terms) forbids.

## 2. Platform decision (settled)
- **Base = Buzz** (Block, Apache-2.0 Nostr-relay collaboration platform). We build
  **on** Buzz through its public interfaces (REST/WS/CLI/SDK/webhooks + existing
  event kinds); we do **not** fork it. Anything we need from Buzz we propose
  upstream (`docs/UPSTREAM.md`).
- **Department/team packages = Open Plugin Spec** (same family as Buzz persona
  packs): `.plugin/plugin.json` + `agents/*.persona.md` + `instructions.md` +
  our sidecar `elenta/department.json`. Validated with Buzz's own validator.
- **On top of Buzz we add**: the agent-visualisation dashboard (the isometric
  "office"), a control plane (routing, ACP runner + permission policy, budgets,
  approvals, memory/skills, routines), and a Connector Gateway (Composio tier +
  local Docker-MCP tier). Full plan: `docs/MASTER-PLAN.md`; what-we-build-vs-reuse:
  `docs/FEATURE-PLAN.md`; Buzz/Paperclip study: `docs/BASE-PLATFORM.md`;
  research reports: `docs/research/`.

## 3. Security model (non-negotiable)
Agents get **no shell, no credentials/keys, no open network**. ACP runner uses a
permission policy + env allowlist (`server/acp.mjs`, `server/policy.mjs`);
send/share/delete/pay are **ask-first**; office runs in a Docker Sandbox (`sbx`),
loopback-only. No classified/ITAR/EAR/CUI content in the office.

## 4. Backend (works, tested)
Node/ESM under `server/`; 47 unit tests pass (`npm test`), plus a live ACP run.
- Org model (`server/org.mjs`): departments → sub-teams → people; optional
  `group` label and per-department `rules`; a department may be a `{ "pack": … }`.
- Boss routes a request to a department; the department lead plans pieces across
  sub-teams; pieces run in parallel; one deliverable returns for sign-off.
- Packages: `server/pack.mjs` + `scripts/pack.mjs` (export/import, Buzz-valid).
- Shipped org `orgs/elenta.json`: **Boss (Command, 2) · Military group of 8
  departments (108) · Business (5)** = 115 people. The 8 military departments:
  Intelligence(18), Operations & Plans(15), Information & Civil-Mil(8),
  Cyber EW & Space(9), Warfare Doctrine(17), Logistics & Engineering(11),
  Capability & Technical(15), Personnel Med & Legal(15). Every role is a sandboxed
  text agent doing staff/knowledge work (doctrine, analysis, plans, EXERCISE sims);
  people decide and act. Military rules forbid real targeting/strike/interrogation/
  offensive-cyber; intel only on supplied/open-source material.

## 5. Design / visualisation (the recent work)
Two surfaces:

**A. Canvas (the design master)** — Design-canvas artifact "Agents Office Command
Centre": https://claude.ai/artifact/JRGF8U9Hr77ssginZyREad , page **"Elenta Office
v2"**, boards E0–E5. This is the **17-person design** (Command 2 · Military 10
[Software/Documentation/Analysis/Compliance] · Business 5 · Library 0). The devs
supplied an asset pack (isometric illustrations + modular sprites/SVG/tokens).
E1 (office overview) and E2 (Military close-up) were updated to that art; most
recently converted from baked PNG to **inline SVG** (vector rooms/labels/status
rings + sprites referenced by `/_blob/`), so labels/counts are editable.
⚠ OPEN: the Design canvas strips embedded raster from *uploaded* SVGs; the inline
approach references sprites by `/_blob/` instead. It could not be previewed from
the build session — **needs a human to confirm the people render on E1/E2**; if
not, revert to the PNG blobs (office `1c98d3e4…`, military `2dc3c0b9…`) or redraw
people as pure vector. Generator + SVGs: `design/v3/canvas-svg/`.

**B. Live app (the interactive product view)** — artifact "Elenta Office":
https://claude.ai/artifact/47rrEsphiwhefsKytGWJSH . The **real 115-person** org,
three drill-down levels: **Office → Military group (8 departments) → department**.
Full v2 app chrome (nav, org rail with working/waiting counts + budget, New job /
Needs you / Running panel, department roster). Click a room to drill in, a worker
for a status card; pan/zoom, rotate, Fit, light/dark. Status rings, sidebar counts
and lists all derive from one `people` dataset (generated from `orgs/elenta.json`
→ `org-live.json`). Repo copy: `design/v3/live-full/`.

**Design review done (Mobbin + Baymard):** earlier labels were big cards covering
desks with an activity bubble on every worker. Fixed to the pattern real spatial/
org UIs use (Felt, Zillow, Deel, Aboard): minimal name+count chips at room
corners, status detail in the side panel + a single hover tooltip (progressive
disclosure), attention markers only for waiting/refused, activity off by default.

Status colours everywhere: teal=working, amber=waiting-for-you, red=refused/stopped,
grey=idle. Dept colours aligned to the shared `tokens.json`
(mil #657337, biz #6554E8, cmd #334155, lib #188C86).

## 6. Where things live
- Repo: `kambasana/test`, branch `claude/agents-office-review-0u8a6p`, project in
  `elenta-office/`.
- Backend: `server/`, `orgs/`, `packs/`, `scripts/`, `test/` (47 tests),
  `library/`, `docker/`.
- Docs: `SPEC.md`, `docs/MASTER-PLAN.md`, `docs/BASE-PLATFORM.md`,
  `docs/FEATURE-PLAN.md`, `docs/UPSTREAM.md`, `docs/BUZZ-WIRING.md`,
  `docs/research/*`, `CLEANROOM.md`.
- Design: `design/v2/` (three.js floor), `design/v3/office.html` (detailed
  vector floor), `design/v3/app.html` (app-shell prototype), `design/v3/live/`
  (17-person live app), `design/v3/live-full/` (115-person 3-level live app),
  `design/v3/canvas-svg/` (SVG floor + generator for the canvas).
- Artifacts: canvas (above); live app (above); an earlier single-room floor
  https://claude.ai/artifact/Tuqz9wVX3HdjKP2juUwwfD .

## 7. Open items / next steps
1. **Confirm the canvas SVG** renders the people on E1/E2 (human check in the
   Design canvas); revert or go pure-vector if stripped.
2. **Wire the live floor to Buzz** so it shows actual teammates — spec in
   `docs/BUZZ-WIRING.md`: observer frames (kind 24200) + typing (20002) + job/
   piece records (45010) → a read-only `/api/floor` snapshot + SSE stream; the
   floor's `people` data swaps for that feed with **no UI change** (contract
   already matches `org-live.json`). Needs a running Buzz relay + control plane.
3. **Decision cards**: wire "Needs you" to real owner-signed approvals (master
   plan Phase 4).
4. **Owner decisions still open**: dashboard home layout; Composio terms (cloud
   tier + ZDR + own OAuth apps, plus written answers on the May-2026 incident /
   CVE-2026-59807); "Chief of Staff" vs "Boss"; product name.
5. **Build order**: master plan phases 1–8 (~14–18 weeks); phase 0 (foundations)
   done.

## 8. Constraints for whoever continues
Develop/push only on `claude/agents-office-review-0u8a6p`; don't open a PR unless
asked. Don't strip AJ Sahni's notices or rebrand his code (we don't use it).
Agents never get shell/keys/network. Keep model identifiers out of commits.

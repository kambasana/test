# Agents Office: build plan

The drawings are on the "Plan & additions" page of the design canvas:
<https://claude.ai/artifact/JRGF8U9Hr77ssginZyREad>

Security comes before capability: nothing new runs outside the sandbox. Each phase ends with a
check that must pass before the next phase starts.

## Scenario: pitch Ridgeline Roofing

Ridgeline Roofing wants a new website and a growth retainer.

**Why this scenario:**

- Roofing is on the ideal-customer list (`icp`).
- The offer ladder has both products.
- The notes hold everything else the agents need: rates (`contractor-terms`), `proposal-template`,
  `qa-checklist`, `visual-identity`, `voice`, the `reel-hooks` line and `numbers-ledger`.
- There are no list prices in the notes, so the agents have to work pricing out from the rates and
  say so. That makes it a fair test.

**Deliverables**, all in `brain/Agents Office/projects/ridgeline-pitch/`:

| Deliverable | Files | Built by |
|---|---|---|
| Analysis | `analysis.md`, `pricing.csv`, `pricing-chart.png` | INTEL and ACCOUNTING LEAD |
| Document | `proposal.md`, rendered to `proposal.docx` and `proposal.pdf` | PROPOSALS, using the proposal skill |
| Presentation | `deck.md`, rendered to `deck.pptx` and `deck.pdf` (8–10 slides) | GRAPHICS DESIGNER, using the new pitch-deck skill |
| Appendix | `project-plan.md` | PROJECT CO-ORDINATOR |

QA CHECKER traces every number. The owner approves, and nothing is sent anywhere.

## Phases

### 1. Security first

**What it covers:**

- Apply `0001-security-hardening.patch`.
- Run the office in a Docker Sandboxes microVM (`sbx`):
  - choose the Locked Down network policy, then allow only `api.anthropic.com`, `claude.ai` and
    `platform.claude.com`;
  - the Claude login is a `sbx secret`, injected at the proxy and never stored inside the VM;
  - only `brain/` is mounted.
- Agents get no shell and no file tools.
- `WebSearch` is on (it runs on Anthropic's side) and `WebFetch` is off; a new host needs your
  approval per project.

**Check:**

- The check suite passes.
- Attack tests are refused: a cross-site POST, a foreign `Host` header, and a request from another
  device on the network.
- `sbx policy log` shows the refusals.

**Note:** the microVM needs KVM, Apple silicon or Windows 11. This cloud session has none of those,
so tests here use the hardened Docker setup in `docker/`.

### 2. Agents over ACP

**What it covers:** replace `claude -p` with `@agentclientprotocol/claude-agent-acp` sessions, one
per agent:

- `session/update` (plans, tool calls) drives the desks and progress bars;
- `session/request_permission` feeds Waiting on you;
- writes go through the office's file handler, into the project folder only;
- sessions resume for `revise:`.

**Check:** rerun the ACP test.

- Today, three read-only shell commands ran without a prompt in default mode. They must be refused.
- Today, the file write bypassed the client's file handler. It must go through the office.

### 3. A visible brain

**What it covers:**

- A knowledge panel: notes by folder, the skills library (who uses each skill, when it was last
  used) and lessons.
- Every task row shows the notes it read and the skills it used.
- Agents search the vault themselves. Today, a keyword top-5 missed `payables-rules` and
  `invoicing-rules`.
- New skills: `market-analysis`, `pitch-deck`, `project-plan`, `qa`.

**Check:** rerun the contractor-onboarding doc.

- Target: no unflagged invented facts. Today's run added "USD" with no flag and invented email
  addresses (flagged as assumed, but still made up).
- The deliverable contains no leftover agent text. Today it included "I couldn't save a .md file"
  and "Skill: house-style".
- The saved note has a single H1. Today it had two.

### 4. Projects

**What it covers:**

- A brief becomes a plan across departments, with dependencies.
- Hand-offs pass files, not just notes: analysis → pricing → proposal → deck.
- A QA gate, then the owner's OK.
- Renderers run by the office, never by the agents: pandoc (DOCX, PDF), Marp (PPTX, PDF), and a
  CSV-to-PNG chart. All are installed in the sandbox image.

**Check:** the scenario runs end to end on the sample brain, and every file opens.

### 5. 3D realism

**What it covers:**

- AgX tone mapping and a `RoomEnvironment` environment map.
- GTAO ambient occlusion.
- Shadows only near the camera.
- Rigged CC0 characters with an `AnimationMixer`.
- Desk screens showing the real task.
- Cards anchored to the pod's edge.
- Name tags that push apart instead of overlapping.
- Connection lines that appear only while in use.
- A project room in the centre.
- Department props.

**Check:** side-by-side captures against today's floor, 60 fps on a laptop GPU, and a
reduced-motion setting.

### 6. Run the scenario

Run it, review it with the owner, then iterate. Record time, cost, the notes cited, the facts marked
(assumed), and any QA findings.

## Findings from today's test runs (7 Oct 2026)

| | Office (`claude -p`) | ACP (`claude-agent-acp` 0.87.0) |
|---|---|---|
| Time | 6 s to route, 13 s to run | 19 s |
| Notes used | 5, picked by keyword; missed `payables-rules` and `invoicing-rules` | 15, searched by the agent |
| Made-up facts | "Currency is USD" (unflagged); email addresses (flagged as assumed) | none; gaps marked *(assumed)* |
| Links back to notes | none in the text | `[[wiki links]]` throughout |
| Gaps | leftover agent text in the deliverable; two H1 titles in the note | shell reads ran without a prompt; the write bypassed the client |

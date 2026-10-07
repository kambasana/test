# Agents Office: build plan

The drawings are on the "Plan & additions" page of the design canvas:
<https://claude.ai/artifact/JRGF8U9Hr77ssginZyREad>

Security comes before capability: nothing new runs outside the sandbox. Each phase ends with a
check that must pass before the next phase starts.

## Scenario: the office plans its own launch

The office plans the public launch of Agents Office. It may use web search and local tools only:
no email, social or payment connectors are attached, so nothing can be sent.

**Why this scenario:**

- It is useful in its own right, to you and to AJ.
- The market moves fast, so the research has to be live and every claim needs a source.
- Every department has a real job, and the hand-offs depend on each other.
- It ends in real local actions as well as text.
- The source material is real: the repo's README, changelog and LICENSE, plus this security kit.

**Who does what:**

| Department | Desk | Job |
|---|---|---|
| Operations | OPERATIONS LEAD, INTEL, LEGAL REVIEW, COMPLIANCE CHECKER | Plans the project. Competitor scan with sources. Security and licence FAQ. |
| Marketing | MARKETING LEAD, RESEARCH, GRAPHICS DESIGNER, NEWSLETTER | Positioning brief. Launch deck. A launch newsletter, drafted only. |
| Finance | ACCOUNTING LEAD | Licence tiers and Claude running cost per seat, every assumption marked. |
| Sales | SALES LEAD, PROPOSALS | Ideal customer, the three likely objections and answers. A one-page pilot offer. |
| Emails | CLIENT EMAILS | A launch email for early users. It waits in Waiting on you. |
| Delivery | PROJECT CO-ORDINATOR, QA CHECKER | Milestones on the calendar, a weekly competitor-watch routine. QA traces every claim. |

**Deliverables**, all in `brain/Agents Office/projects/launch/`:

| Deliverable | Files |
|---|---|
| Analysis | `market-analysis.md`, `competitors.csv`, `pricing.csv`, `pricing-chart.png` |
| Documents | `positioning-brief.md` and `security-licence-faq.md`, rendered to DOCX and PDF (pandoc) |
| Presentation | `launch-deck.md`, rendered to PPTX and PDF (Marp), 10 slides |
| Actions | Calendar milestones as scheduled tasks; a weekly read-only competitor-watch routine; new brain skills (`market-analysis`, `pitch-deck`, `launch-plan`); launch email and newsletter drafts awaiting approval; one project note linking every file and source |

**Pass mark:** every claim has a source or is marked (assumed); every file opens; the calendar,
routine, skills and approvals show up in the dashboard; QA reports nothing unresolved; total time
and Claude usage are recorded. A smaller client pitch (Ridgeline Roofing, from the sample notes)
stays as a quick smoke test.

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

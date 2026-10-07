# Agents Office: security fix list and isolated setup

Review of [ajsahni/agents-office](https://github.com/ajsahni/agents-office) at `2d47001` (v3.2.1-beta.2).
It follows Anthropic's [secure deployment guide](https://code.claude.com/docs/en/agent-sdk/secure-deployment),
[permission modes](https://code.claude.com/docs/en/permission-modes) and
[sandbox environments](https://code.claude.com/docs/en/sandbox-environments) docs.

Contents:

- `0001-security-hardening.patch`: the P0 fixes below. It applies cleanly to `2d47001`, and
  `node check.mjs` passes 35 of 36 checks. The one failure is the Chrome smoke test, which can't
  run without a Chrome install. The patch also adds a new check that another website can't drive
  the office.
- `0002-visual-detail.patch`: the 3D detail pass, applied on top of 0001. Cards stop covering
  their desks, name tags stop overlapping, and each department gets a rug, a rim and a prop.
  Everything gets contact shadows. Chairs, people and desks get more detail, materials get a faint
  studio light, and connection lines stay quiet until used. Before and after: board P7 on the
  design canvas. The check suite result is unchanged (35 of 36).
- `0003-departments.patch`: your own departments, applied on top of 0002. Switch departments on
  and off, swap what fills the floor (a *pack*, such as the included R&D lab), and run *wings*
  (separate offices) that link to each other. See "Departments, packs and wings" below and board
  P8 on the design canvas. `node check.mjs` passes 39 of 40, with four new checks; the one failure
  is still the Chrome smoke test.
- `PLAN.md`: the build plan and the launch scenario.
- `docker/`: two ways to run the office in isolation, a Docker Sandboxes microVM (tier 1) or a
  hardened Compose stack (tier 2), plus `sbx-wing.sh` to run a wing in its own microVM.

## Why it matters: the "lethal trifecta"

An agent is dangerous when it has all three of these at once:

- **Private data:** Gmail, Drive and your notes.
- **Untrusted content:** web pages, incoming email, and anything Chrome shows it.
- **A way to send data out:** send, post, pay, or fill in forms in your signed-in Chrome.

Agents Office gives every agent all three by default. The only thing standing between a
malicious web page or email and a sent message is the instruction in the prompt.
Anthropic's guidance is to treat prompts as a soft control and put hard limits around the agent:
least privilege, network controls, credentials kept outside the agent's reach, and an isolation
boundary.

## Fix list

### P0: fixed in the patch

| # | Problem | Fix |
|---|---|---|
| 1 | Any website you visit could POST tasks, approvals and routines. The server parsed `text/plain` bodies and never checked `Origin`. | `refuse()` in `serve.mjs` checks three things. **Host** must be `localhost`, `127.0.0.1` or `[::1]`, which stops DNS rebinding. **Origin** must be the office's own page. **Body** must be JSON, which forces a CORS preflight that the server never answers. |
| 2 | The server listened on every network interface, so anyone on the same Wi-Fi could use the API. | It binds to `127.0.0.1` by default. `AO_HOST` overrides that, for containers only. |
| 3 | A scheduled task could run twice, and the second run skipped the "needs my OK" step: the page called `/run` on a task the server's clock was already running. | The page now treats scheduled tasks as server-run (`srv`). `/run` refuses routine and scheduled tasks and anything not in `next`. `/revise` only accepts `done` tasks. |
| 4 | Agent runs inherited your own Claude Code `defaultMode`. If that was `bypassPermissions` or `auto`, the agents would run anything not explicitly denied. | Every `claude -p` now passes `--permission-mode dontAsk`, so only `--allowedTools` can run and everything else is denied. |
| 5 | Request bodies had no size limit. | 1 MB cap. |
| 6 | Two tasks with the same title on the same day overwrote each other's note. | The second note gets the task id appended. |
| 7 | A skill name returned by Claude could be `..` and write outside `skills/`. | Leading and trailing dots are stripped. |

To apply:

```bash
cd agents-office
git apply ../agents-office-hardening/0001-security-hardening.patch
node build.mjs      # rebuilds dist/ with the page change
node check.mjs
```

### P1: recommended next, as product decisions for the author

1. **Turn the browser off by default** (`tools.browser: false`). Claude in Chrome gives an agent
   your signed-in sessions. Make it opt-in per department, and only for tasks that need approval.
2. **Approval for outbound actions on tasks from the bar too.** Today only routines and scheduled
   tasks wait for "needs my OK". The router already computes `needs_ok`, so use it for every task:
   draft first, act only after APPROVE. This is the human-in-the-loop "read / draft / act" ladder.
3. **Allow individual tools, not whole servers.** `--allowedTools mcp__Gmail` allows every Gmail
   tool, send included. Allow read tools by default, for example
   `mcp__claude_ai_Gmail__search_threads`, and grant write tools only in the approved run.
4. **Pin the MCP set** with `--strict-mcp-config --mcp-config <file>`. Then a server you add to
   Claude Code for something else doesn't silently become an agent tool.
5. **Cap each run** with `--max-turns`, and `--max-budget-usd` on the API backend. Also add a
   global cap on concurrent runs: tasks from the bar bypass the one-at-a-time routine queue.
6. **Treat agent output as untrusted.** Deliverables, notes between teammates, and lessons the
   agents learn all flow back into later prompts. Keep the escaping in the page (it's mostly good
   today) and don't let a deliverable write `brief` or skill files without the owner confirming.
7. **Kill the Claude process when a running task is deleted.** Make the writes to `tasks.json`
   atomic: write to a temp file, then rename.
8. **Add CI.** No workflow runs `check.mjs` today, and the 1.5 MB built `dist/` file is committed
   without any check that it matches `src/`.

## Permission modes: what to use where

| Where Claude runs | Mode | Why |
|---|---|---|
| The office's agent runs (`claude -p`, unattended) | `dontAsk` plus an exact `--allowedTools` list (patched) | It's the CI-style mode: anything not pre-approved is denied, with no prompts and no classifier guessing. |
| Owner editing the roster or skills in Claude Code | `default` (Manual) or `plan` | Edits to your notes and config should be reviewed. |
| Auto mode | Fine for interactive sessions, **not** for the office's unattended outbound work | A classifier is a per-action check, not an isolation boundary. |
| `bypassPermissions` | **Never on the host.** Only inside a microVM or container, as non-root | Anthropic's docs require an isolation boundary for it. Block it with the managed setting `permissions.disableBypassPermissionsMode: "disable"`. |

Some rules apply in every mode:

- Deny rules always win, even over `bypassPermissions`.
- MCP send or pay tools marked `requiresUserInteraction` can't be auto-approved.
- For local MCP servers, consider the Docker MCP Gateway (`--block-secrets`,
  `--verify-signatures`, `--log-calls`), which runs each server in its own container.

## Isolation tiers

### Tier 1: Docker Sandboxes microVM (recommended)

Docker Sandboxes (`sbx`) gives each sandbox its own kernel and filesystem, and no direct network
access. All traffic goes through a proxy on the host that enforces your network policy.
Credentials are stored on the host and injected at that proxy, so the agent never sees them.
Agents can't change the policy, because `sbx` isn't reachable from inside the sandbox.

- **Platforms:** macOS (Apple silicon), Windows 11, and Linux with KVM (Ubuntu 24.04+).
- **Network policy:** choose **Locked Down** at `sbx login`, then open hosts one at a time with
  `sbx policy allow network …`. Watch denied requests with `sbx policy log`.
- **Script:** `docker/sbx-run.sh` creates the sandbox, starts the office inside it and publishes
  port 4520. Its network rules use `--sandbox`, so they apply to that one sandbox only. Global
  rules reach every sandbox on the machine, so a wing could never be stricter than them: keep the
  global list empty.
- **Limits, by design:** your host's Chrome and any local MCP servers aren't reachable from inside
  the sandbox. That is the point.

### Tier 2: hardened container plus egress allowlist (`docker/compose.yaml`)

This follows Anthropic's container hardening checklist:

- non-root user, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`
- limits on processes, memory and CPU, and `tmpfs` for scratch space
- the office sits on an `internal` network with **no gateway**, and its only way out is a Squid
  proxy that allows the hosts in `allowed-domains.txt`, starting with Anthropic only
- the Claude token comes from a Docker secret created with `claude setup-token`, never from the
  image
- the port is published on `127.0.0.1` only
- optional: `runtime: runsc` (gVisor), which puts a user-space kernel between the agent and the
  host kernel

To run it:

```bash
cd agents-office-hardening/docker
export AGENTS_OFFICE_DIR=/path/to/agents-office   # with the patch applied
mkdir -p secrets && claude setup-token > secrets/claude_oauth_token && chmod 600 secrets/claude_oauth_token
BRAIN_DIR=/path/to/a/copy/of/your/notes docker compose up --build
```

`office.config.local.json` in this folder ships with web and browser off, and with payment
connectors denied. Open hosts in `allowed-domains.txt` deliberately, and only for the connectors
you use. Watch `docker compose logs -f egress | grep DENIED`.

**Verified:** `docker compose config` validates. The image build was **not** completed, because
the review environment's network blocked Debian and npm downloads during the build. Run
`docker compose build` once on your machine before relying on it.

### Tier 3: no Docker

[`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime) wraps the whole
process, including tools, MCP servers and hooks, in bubblewrap (Linux) or Seatbelt (macOS), with a
domain-allowlist proxy. It's weaker than a VM because it shares the host kernel, but it's much
better than nothing:

```bash
npx @anthropic-ai/sandbox-runtime node serve.mjs
```

Allow writes only to the repo, the notes folder, `~/.claude` and the temp directory. Allow network
access only to Anthropic's hosts.

## Departments, packs and wings

The upstream office is fixed at six departments and 35 desks, set up as an agency. The floor
geometry (six positions around the brain) is hand-tuned, so the patch keeps the positions and
makes what sits in them yours.

| Level | How | What happens |
|---|---|---|
| Switch off | ▦ DEPARTMENTS in the top bar, or `"departments": { "emails": { "on": false } }` | The pod becomes a dashed outline with its name. No desks, no tasks, no runs; the server refuses work sent to it. Notes stay in the brain. At least one department stays on. |
| Swap (pack) | Pick a pack in the panel, or `"pack": "rnd-lab"` | `packs/<name>.json` renames each position, recolours it, picks its prop and gives every desk a name, role, tasks, chat chips and screen lines. Desks map in order onto the position's seats, lead first; a pack with fewer desks leaves the rest out. |
| Wing | `docker/sbx-wing.sh`, and `"wings": [...]` in each office's settings | A wing is a second office with its own copy of the code, brain folder, tasks, settings, port and sandbox. The top bar links the offices; nothing else is shared. |

Changes saved from the panel go to that office's own settings file and take effect on restart.
Environment variables `AO_PACK`, `AO_OFF`, `AO_CONFIG` (a different settings file) and `AO_DATA`
(a different task folder) override the files.

**Isolation notes for a wing:**

- **Separate code copy.** `sbx-wing.sh` copies the code without `brain/`, `data/` or local
  settings, so the main office's notes never sit inside the wing's VM.
- **The page draws the served office's own brain.** Upstream, the page drew the brain baked in at
  build time, whatever brain the server used. With wings, that would have shown one office's note
  titles in another. An empty brain now stays empty.
- **Its own network rules**, with web search and Chrome off by default.
- **Pack edits live in the brain.** In a pack office, `office.agents.json` and
  `office.agents.local.json` describe the agency's seats and are skipped; edits go in that
  office's `brain/Agents Office/agents.json`.

**What a wing can hold.** Every agent run sends its prompt and the notes it reads to Claude's API.
A sandbox controls what the agents can reach, not where the work is processed. Keep
export-controlled (ITAR/EAR), classified and CUI material out of any office like this; that needs
an approved deployment. Check intended uses against Anthropic's usage policy.

**Not verified here:** `sbx-wing.sh` follows the current `sbx` docs (`--sandbox` rules,
`policy rm --resource`, extra workspaces) but hasn't been run, because this cloud session has no
KVM. Run it on your machine and check `sbx policy ls --sandbox agents-office-<wing>`.

## Sources

- [Anthropic: Securely deploying AI agents](https://code.claude.com/docs/en/agent-sdk/secure-deployment)
- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing) and [sandbox environments](https://code.claude.com/docs/en/sandbox-environments)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Docker Sandboxes quickstart (sbx)](https://github.com/mikegcoleman/sbx-quickstart) and [local policy](https://docs.docker.com/ai/sandboxes/security/policy/)
- [sbx policy allow network (per-sandbox rules)](https://docs.docker.com/reference/cli/sbx/policy/allow/network/), [local policy and `policy rm`](https://docs.docker.com/ai/sandboxes/governance/access-controls/local.md), [sbx create (extra workspaces, `:ro`)](https://docs.docker.com/reference/cli/sbx/create/claude/)
- [Docker MCP Gateway interceptors](https://www.ajeetraina.com/a-quick-look-at-docker-mcp-gateway-interceptors/)
- [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)

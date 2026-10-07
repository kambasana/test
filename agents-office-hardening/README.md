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
- `PLAN.md`: the build plan and the launch scenario.
- `docker/`: two ways to run the office in isolation, a Docker Sandboxes microVM (tier 1) or a
  hardened Compose stack (tier 2).

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
  port 4520.
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

## Sources

- [Anthropic: Securely deploying AI agents](https://code.claude.com/docs/en/agent-sdk/secure-deployment)
- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing) and [sandbox environments](https://code.claude.com/docs/en/sandbox-environments)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Docker Sandboxes quickstart (sbx)](https://github.com/mikegcoleman/sbx-quickstart) and [local policy](https://docs.docker.com/ai/sandboxes/security/policy/)
- [Docker MCP Gateway interceptors](https://www.ajeetraina.com/a-quick-look-at-docker-mcp-gateway-interceptors/)
- [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)

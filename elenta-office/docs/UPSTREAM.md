# What we would propose to Buzz upstream

Elenta extends Buzz through its public interfaces and does not fork it (MASTER-PLAN §5.1). This is
the list of things we would rather Buzz had, to raise as issues or PRs on the Buzz repository
(Apache-2.0). Each row says what we do until it lands. Reviewed against Buzz at `1972b7d`.

| # | Proposal | Why we need it | Until then |
|---|---|---|---|
| 1 | **Stable observer-frame schema (kind 24200) for any harness**, documented as a public contract | Our ACP runner can publish the same "working" frames `buzz-acp` does, so Buzz's own app shows Elenta teammates as working, with no special code | Publish frames in the shape the desktop parses today; pin the Buzz version; integration test per upgrade |
| 2 | **Workflow approval steps that work**, decided by an owner-signed event | Routines and jobs that must stop for a person (runs that reach an approval step fail today) | Approvals live in our control plane, recorded as owner-signed events in the thread |
| 3 | **Decision cards in the desktop/mobile apps**: a message that carries structured actions (Approve / Send back / Allow once) the app renders as buttons, answered with a signed reply | "Needs you" inside the conversation, as in Grok and Rakazo | A plain message in the thread with a link to the Elenta dashboard |
| 4 | **Operator-registered event kinds** (an allowlist extension in relay config) | Custom kinds are rejected today; extensions must squeeze into existing kinds | Use kind 45010 records and tagged channel messages only |
| 5 | **Workflow run hygiene**: skip if the previous run is still going; a run time limit; longer delays than 270 s | Routines must not pile up or run forever | Our control plane checks before acting on a schedule-trigger marker |
| 6 | **Vendor extension keys in persona frontmatter** (`x-*` accepted, everything else still strict) | Persona files reject unknown keys, so tools cannot add their own fields | Our extras sit in `elenta/department.json` inside the pack |
| 7 | **Groups in persona packs** (sub-teams with a lead) | Buzz could show a department's structure, not a flat list | Same sidecar file |
| 8 | **An extension point in the desktop app** (a side panel or tab that loads a vetted local web page) | Show the Office and Needs you inside Buzz's window | The Elenta dashboard is a separate web page on loopback |
| 9 | **Enforced branch protection and "merge only the approved commit" on git hosting** | Code teams: the relay does not enforce approvals today | The office is the single committer and checks the approved commit hash itself |
| 10 | **Pack hooks stay off by default; env interpolation with an explicit allowlist** when they are implemented | Packs from others must stay data, not code | We ignore hooks and never start a pack's MCP servers without a grant |

How we propose: one issue per row with the use case and a small design, a PR where the change is
small and self-contained (1, 5, 6, 7), and nothing that needs Elenta-specific behaviour in Buzz.

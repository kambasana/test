# Wiring the live floor to Buzz (data spec)

The floor (`design/v3/live-full/`) renders from one `people` array plus per-department
and per-group counts, and the right panel's "Needs you" / "Running" cards. Today those are
sample data. This spec defines the live feed so the visualisation shows **actual** teammates
with **no UI changes** — only the data source swaps.

## 1. What the floor needs

Per teammate (one floor sprite + ring + tooltip + roster row):
`{ id, dept, team, name, role, model, status, task }` where `status ∈ working | waiting | refused | idle`.

Per department / group: counts by status (derived from the people array — already computed in the UI).

Panel feeds: **Needs you** = open approvals/questions; **Running** = in-flight jobs with per-sub-team progress.

## 2. Source signals (Buzz + our control plane)

Structure (who exists, which team) comes from **our org file and department packs**, not Buzz:
the control plane already holds the org (`orgs/*.json`, `packs/`). Live state comes from the relay:

| Floor field | Source | Buzz detail |
|---|---|---|
| `status: working` | an active observer turn, or a typing indicator | observer frame **kind 24200**, typing **kind 20002** (the signals Buzz's own app uses for "working") |
| `status: waiting` | an open approval/question owned by that teammate | our control plane's approval records (kind 45010 editable records anchored to the job thread) |
| `status: refused` | last tool request denied / run stopped | our permission-policy audit event (`audit.jsonl`), surfaced per teammate |
| `status: idle` | none of the above | — |
| `task` | the teammate's current piece | job/piece records (**kind 45010**) on the team channel |
| Running cards | in-flight jobs + piece progress | job + piece records on each team channel |
| Needs you cards | approvals/questions awaiting the owner | owner-signed approval records |

The control plane is the **only** relay client (it holds the teammates' keys). The floor never
touches the relay and never holds a key.

## 3. Adapter: one read-only endpoint

Add to the control plane (`server/`):

- **`GET /api/floor`** → a snapshot: `{ org, people:[…], jobs:{running:[…], needs:[…]} }` in exactly
  the shape the floor already uses (`org-live.json` is the static stand-in for this payload).
- **`GET /api/floor/stream`** (SSE) → deltas: `{type:'status', id, status}`, `{type:'job', …}` as
  relay events arrive, so rings and counts update live.

Inside the endpoint:
1. Subscribe (WebSocket) to the relay for kinds **24200 / 20002 / 45010** on the team channels.
2. Keep an in-memory map `teammateId → {status, task, lastSeen}`; fold in approval + audit state.
3. Debounce (≈1 s) and emit snapshot + deltas.

Floor change (one line): replace `const ORG = {…}` with `fetch('/api/floor')` for the snapshot and
subscribe to `/api/floor/stream` for deltas, calling the existing `render()`. No layout or component
changes — the data contract is identical to `org-live.json`.

## 4. Status derivation rules (keep them honest)

- `working` only while an observer turn or typing frame is **fresh** (e.g. < 20 s); otherwise decay to `idle`.
- `waiting` strictly means *waiting on the human* (an open approval/question), never "busy".
- `refused` is set by a denied permission decision or an operator stop, and clears when the job moves on.
- Counts and the sidebar/roster are all derived from the same people array, so the floor and the lists
  can never disagree (the invariant the current build already enforces).

## 5. Phases

1. **Snapshot** — `/api/floor` from control-plane state; floor fetches on load + poll. (Smallest step.)
2. **Live** — add the SSE stream; rings/counts update as relay events arrive.
3. **Decision cards** — wire "Needs you" to real approvals; Approve / Send back posts an owner-signed
   event. (This is the master-plan Phase 4 "Trust controls" surfaced on the floor.)

Prereqs: a running Buzz relay + our control plane with the teammates' identities (master plan Phases 1–3).
Until then the floor runs on `org-live.json` (generated from `orgs/elenta.json`).

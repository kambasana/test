# Buzz deep dive: git hosting, UI/UX, workflows, roadmap, patterns

Status: research note, 2026-10-08. Nothing in `server/` or `web/` was changed.

Source: Block's Buzz (Apache-2.0) at `/home/user/buzz`, commit `1972b7d` (2026-10-07). Paths
without a prefix are relative to `/home/user/buzz`. Line numbers are for that commit. Read
[`../BASE-PLATFORM.md`](../BASE-PLATFORM.md) and [`../FEATURE-PLAN.md`](../FEATURE-PLAN.md) first; this note
goes deeper on the parts they only list.

**What frames this note.** The product's north star is a better way to work: you talk to agents
that behave like teammates. Defence work is one use case, not the focus. Security is the foundation,
not the headline. So this note gives most weight to how Buzz makes humans and agents work together
as members of channels and threads: presence, the activity feed, mentions, steering and handoffs.

**How the screenshots were made.** The Docker daemon was not running in this session, so the
compose relay was not used. Instead, the desktop renderer was built in Buzz's own end-to-end mode
(`pnpm --filter ./desktop` install, `vite build --mode e2e`). It ran in Chromium against Buzz's mock
Tauri bridge (`desktop/src/testing/e2eBridge.ts`), which carries Buzz's own seed data (channels
such as `#agents` and `#general`, and the users alice, bob, charlie and nadia). The activity-feed
shot uses observer events we injected through the bridge's seed hook. The temporary spec and config
were deleted afterwards, and nothing in the Buzz repo was committed. Images are in `img/buzz-*.png`.

---

## 0. Summary (for the owner)

- **Buzz already treats agents as teammates in the room.** An agent is a member with a name,
  an avatar and a "managed by you" badge. It shows a presence dot, types, and shows a live
  "working · 12s" badge on the channel. It answers when @mentioned, can be steered mid-task by
  editing the mention, and has a profile with Stop / Restart / Message / Follow and an
  **Activity log**. Its activity feed reads like sentences ("Edited `q3-summary.md`",
  "Ran `npm test` → failed"). We should copy this feel rather than invent our own.
- **Git hosting works today**, and so do repos, branches, issues, pull requests, reviews and
  merge in the desktop app. Buzz's own status tables understate this: "issues" and "project
  binding" are marked 📋 Designed but are shipped in the desktop app and `buzz-cli`. What is
  **not** shipped: the relay does not require approvals before a merge, there is no merge
  coordinator or merge train, and branches do not become channels.
- **Workflows** are small YAML automations (trigger → up to N steps). They are fine for "every
  Monday at 08:55, post a job request in #finance". They are not a job runner: no approvals
  (runs that reach one fail), no DMs, `delay` ≤ 270 s, and messages are signed by the relay, not by a
  person.
- **A new piece that fits us exactly: NIP-AR channel artifacts (kind 45010).** These are editable
  records ("tasks") that live in a channel or thread. The relay checks access and runs
  compare-and-swap revisions. The relay side is shipped; the desktop app does not use them yet.
  This is the cleanest base for our tickets: blockers, checkout and goals.
- **What to avoid:** Buzz's agent harness defaults (auto-approve, shell, key in the agent's
  environment). See BASE-PLATFORM.md §2.7–2.8. Also avoid relying on its approval cards (they are
  read-only, "Approval actions are not yet available in Desktop") and avoid the roadmap's
  `buzz-protect … require-approval` syntax, which the relay does not implement (§1.6).

---

## 1. Git hosting

### 1.1 In plain language

**What git hosting is.** Git is a tool that keeps every version of a set of files and records who
changed what, when and why. A *repository* ("repo") is one such set of files plus its full
history. It could be a website, a script or a policy pack. *Hosting* means a server keeps the
master copy, so several people and machines can fetch it, propose changes and agree on what goes
in. GitHub is the best-known host. Buzz is a host too, built into the same server that runs the
chat.

**The everyday vocabulary:**

| Word | Plain meaning |
|---|---|
| Commit | A saved snapshot of the files, with an author and a message ("Fix totals rounding"). |
| Branch | A named line of work. `main` is the agreed version; `fix-totals` is a draft line beside it. |
| Push | Upload your new commits to the host. |
| Clone / fetch | Download a copy of the repo. |
| Pull request (PR), called a "review" in Buzz | "Please merge my branch into `main`", with a description. People comment, approve or ask for changes. |
| Merge | Fold the branch into `main`. From then on, it is the agreed version. |
| Issue | A ticket: a bug, request or task attached to a repo. |

**How Buzz does it, in one paragraph.** Buzz speaks the normal git protocol, so `git clone` and
`git push` work as with any host. There is one difference: there are no passwords. Every person and
agent in Buzz has a cryptographic key (a "Nostr key"). The git helper signs each request with that
key, and the server checks the signature and asks one question: *is this key a member of the
channel this repo belongs to, and with what role?* Everything around the code is also posted as a
signed message into the same event log as the chat: "this repo exists", "here is a pull request",
"Bob approved", "merged". So the history of the code and the conversation about it are searched and
audited together.

**What a repo is in Buzz.** Two things together:
1. A **repo announcement**: a small signed record that says "repo `elenta-tools`, owned by key X,
   belongs to channel `#software`". Its protection rules ride along as tags.
2. The **files and history**. They are stored as immutable packs in object storage (MinIO/S3), plus
   one pointer to "the current state". The server never keeps a working copy on disk.

Whoever signed the announcement is the repo's **owner**. Read and write access comes from
**membership in the bound channel**. If you can't see the channel, the repo answers "not found".

**How people and agents work with it in Buzz today.**
- A human uses the desktop app's **Projects** screen (`img/buzz-08-projects.png`). It has tabs for
  Activity, Projects, Repositories, Tasks (issues), Reviews (PRs) and Channels. A review shows the
  diff, inline comments, reviewers, an **Approve / Request changes** card and, for the repo owner, a
  **Merge** button.
- An agent uses `buzz-cli` (`buzz repos create`, `buzz pr open`, `buzz issues create`, …) or plain
  git with the credential helper. It shows up in Projects Activity as "Brain pushed a commit to
  buzz".

**How Elenta's Software sub-team would use it** (detail in §1.7):
1. Our agents never touch git. They write files into the job's `out/` folder, exactly as now.
2. The **office** (our server, the single committer) turns the finished piece into a commit on a
   branch such as `job/2026-10-08-totals` and pushes it to the department's repo on Buzz.
3. The office opens a **review** (PR) in the job's thread. It is signed with the acting person's
   identity, so the review shows "Sofia (Software) opened a review".
4. You, the owner, read the diff in our job view (or in Buzz desktop) and press **Approve** or
   **Request changes**.
5. Only after your approval does the office merge into `main` and post "merged". The relay itself
   only enforces that nobody but the office can write.

### 1.2 What runs on the wire

| Piece | Where | Notes |
|---|---|---|
| Smart HTTP endpoints `GET /git/{owner}/{repo}/info/refs`, `POST …/git-upload-pack`, `POST …/git-receive-pack` | `crates/buzz-relay/src/api/git/transport.rs:1-9`, router `:2224`; ARCHITECTURE.md:739-742 | "Auth: NIP-98 on all routes (clone + push). No public repos for v1." git runs as `git --stateless-rpc` with `env_clear()` (`transport.rs:511` `harden_git_env`). |
| Internal policy hook `POST /internal/git/policy` | `api/git/mod.rs:38-68`, `api/git/policy.rs:1-26` | Pre-receive hook calls back over loopback only, HMAC-signed, 30 s TTL, fail-closed. |
| Read gate | `transport.rs:596` `authorize_git_read` | Needs an active membership row in the bound channel; every denial is a 404 so you cannot probe which repos exist. |
| Push gate | `policy.rs:176` `hook_policy_check` | Steps: look up the kind 30617 by (community, owner, d-tag) → parse `buzz-protect` (`:280-301`) → resolve channel binding, deny if broken/archived (`:314`) → role = Owner if pusher is the repo key or its verified managed-agent owner (`:367`), else channel role → **Bot is promoted to Member for git** (`:407`) → `evaluate_push` (`:423`). |
| Storage | `docs/git-on-object-storage.md` (draft spec with TLA+ proofs), `api/git/cas_publish.rs`, `hydrate.rs`, `manifest.rs` | Packs are content-addressed and create-only; a single manifest pointer is advanced by S3 conditional PUT (CAS). Each request hydrates a temporary repo and drops it. Concurrent pushes: one wins, the losers retry (`git-on-object-storage.md:56-90`). |
| Ref-state event | `api/git/manifest_event.rs:1-17`; `transport.rs:1935-1960` | After a successful push the relay signs a **kind 30618** (NIP-34 repo state: branch → commit) with a `p` tag for the pusher. A rejected push publishes nothing. |
| Accepted NIP-34 kinds | `crates/buzz-core/src/kind.rs:613-631`; `handlers/ingest.rs:591-602` | 30617 announcement, 30618 state (`repos:write` scope); 1617 patch, 1618 PR, 1619 PR update, 1621 issue, 1630–1633 status open/merged/closed/draft (`messages:write`). |
| Multi-repo project | `kind.rs:633-640`, `docs/nips/NIP-MP.md` | kind 30621 groups repos (`a` tags). Grants no authority over member repos (VISION_PROJECTS.md:71). |

**Nostr-signed git, the two helpers:**
- `crates/git-credential-nostr/src/lib.rs:1-6`: a git credential helper. For each HTTP request
  it signs a NIP-98 kind 27235 event and returns it as the credential, so git sends
  `Authorization: Nostr <base64>`. It reads the key from a 0600 keyfile or env and refuses looser
  permissions.
- `crates/git-sign-nostr/src/lib.rs:1-50`: signs commits and tags with BIP-340 Schnorr through
  git's `gpg.x509.program` hook ("NIP-GS"). Its own docs warn that `TRUST_FULLY` is advisory only:
  "Callers MUST NOT rely on `TRUST_FULLY` for security decisions" (`:23-31`). Unix only.
- `crates/buzz-acp/src/git.rs:1,135`: Buzz's harness sets an ephemeral git identity per agent
  runtime. `BUZZ_GIT_IDENTITY=agent|user` chooses whether commits are authored as the agent
  (default) or the operator (CHANGELOG v0.5.27, #8024).

### 1.3 Who may push what (the permission model)

`crates/buzz-core/src/git_perms.rs` (1,027 lines): "channel role = repo role; `buzz-protect` tags on
kind:30617 add constraints that apply to everyone (including the owner)" (`:1-13`).

Built-in defaults when no rule matches (`default_min_role`, `:427-452`):

| Update | Branch `refs/heads/*` | Tag `refs/tags/*` | Other refs |
|---|---|---|---|
| Create | Member | Member | Admin |
| Fast-forward | Member | Admin | Admin |
| Force push (non-fast-forward) | Admin | Admin | Admin |
| Delete | Admin | Admin | Admin |

Protection tags (`ProtectionRule`, `:263-284`; parser `:327-385`), as **actually implemented**:

```
["buzz-protect", "<ref pattern starting refs/>", "<rule>", ...]
rules:  push:<owner|admin|member>   no-force-push   no-delete   require-patch
pattern: literal segments, "*" = one segment, "**" = rest (last segment only); max 50 rules
```

- `push:<role>` can only *tighten* the default; the stricter of the two wins (`:562-577`).
- `require-patch` blocks every direct update, the owner's included ("submit a NIP-34 patch",
  `:548-553`).
- A push is all-or-nothing across its refs (`evaluate_push`, `:608`).
- Unknown rule words are logged and **skipped**. A malformed tag (for example a pattern without
  `refs/`) **denies every push** (`policy.rs:288-300`).

> ⚠ VISION_PROJECTS.md:30-37 shows `["buzz-protect","main","push-allowed",<npubs>]` and
> `"require-approval","2"`, with "Merges require … signed approval events (kind:46011)". **None of
> this is implemented.** `push-allowed` and `require-approval` are unknown rules, so they are
> skipped. The bare pattern `main` fails parsing and locks the repo. Do not copy the vision
> example.

### 1.4 Reviews, issues and merge: what is shipped

| Capability | Buzz's own status table | Actual state at `1972b7d` | Evidence |
|---|---|---|---|
| Git hosting (smart HTTP + NIP-34) | ✅ | ✅ | above |
| Project binding (`buzz-channel` on 30617) | 📋 Designed (VISION_PROJECTS.md:254) | ✅ **Enforced** by relay read/push gates; unbound repos get `no_channel_binding` | `git_perms.rs:18-40`, `policy.rs:314-370`, `cli/commands/repos.rs:236-239` |
| Multi-repo projects (30621) | 📋 | ✅ in CLI and desktop (`buzz projects create/add-repo`) | `cli/commands/projects.rs:360-692` |
| NIP-34 issues (1621) | 📋 Designed (VISION_PROJECTS.md:258) | ✅ Desktop **Tasks** tab plus `buzz issues create/assign/status`; status via 1630–1633; assignment is a `t: assignment` kind 1 note | `cli/commands/issues.rs:232-525`, `desktop/src/features/projects/projectIssues.mjs:5,70-110` |
| Pull requests (1618/1619) | not listed | ✅ Desktop **Reviews** tab, create dialog, diff + inline comments; `buzz pr open/update/status` | `desktop/src/features/projects/ui/CreatePullRequestDialog.tsx`, `ProjectPullRequestFilesChangedPanel.tsx`, `cli/commands/pr.rs:21-161` |
| Patches (1617) | ✅ | ✅ `buzz patches send/list/status` | `cli/commands/patches.rs` |
| Review decisions | "kind 46011 approval" in vision | ⚠ **Client convention only**: a kind 1 note with `t: approval` / `t: changes-requested` / `t: review-request`, `e` root = PR, `c` = commit. "NIP-34 has no dedicated review kinds, and the relay does not register kind 1111." Reviewers = repo owner or requested reviewers; authors can't review their own PR. | `desktop/src/features/projects/pullRequestReviews.ts:92-96,147-167,196-224`; labels `projectPullRequests.mjs:151-156` |
| Merge | "Merge coordinator 📋" | ✅ **Desktop merge button** for repo owner (or the owner of a managed-agent repo): clones to a temp dir, fetches source, **refuses if the head changed since you looked** (`branch_changed`), `git merge`, pushes `HEAD:target`, signs and publishes kind **1631** merged status. **Not gated on approvals.** Conflict recovery opens a terminal. | `desktop/src-tauri/src/commands/project_git_workflow.rs:493-640`; `PullRequestReviewCard.tsx:81-84`; `MergePullRequestButton.tsx` |
| Merge coordinator / merge train | 📋 | ❌ not built | — |
| Approval-gated merge on the relay | vision | ❌ not built (see ⚠ above) | — |
| Branch → channel ("branch as room") | vision | ❌ not built; repos bind to one project channel | no code under `desktop/src` |
| Repo web view | VISION_SOVEREIGN | 🚧 `web/` has a small repo browser (isomorphic-git in the browser) + invite page | `web/src/features/repos/*`, `web/src/app/routes/repos*.tsx` |

### 1.5 Repo lifecycle, end to end

1. **Create**: sign a kind 30617 with `d=<repo-id>`, `name`, `clone=https://<host>/git/<owner-hex>/<repo>`,
   `buzz-channel=<channel uuid>` and any `buzz-protect` tags (`buzz-sdk/src/builders.rs:1040,1158`;
   `cli/commands/repos.rs:244-280`).
2. **Push**: `git push` with `credential.helper=nostr`. The hook checks the role and rules, CAS
   advances the manifest, and the relay emits a 30618.
3. **Propose**: kind 1618 PR (subject, body, `c` commit, branch, merge-base, `p` recipients,
   optional channel), or kind 1617 patch.
4. **Review**: kind 1 notes tagged `review-request` / `approval` / `changes-requested`, plus
   inline comments.
5. **Merge**: a client merges and pushes, then publishes kind 1631 (merged) referencing the PR. The
   relay does not link the merge to approvals.

### 1.6 Gaps that matter to us

- **No server-side "approved before merge".** Any key that can push to `main` can merge without
  review. Our office must enforce it (§1.7).
- **Bots count as Members for git** (`policy.rs:407`). A Buzz-managed agent added to the bound
  channel can create and fast-forward branches by default. That is irrelevant for us if agents
  never hold git credentials, but add a `push:owner` rule anyway as a second fence.
- **Approvals are plain kind 1 notes.** Trust comes only from checking the signer (repo owner or
  requested reviewer) and the `c` commit tag. Desktop does this in the client. We must do it
  server-side.
- **Commit signatures (NIP-GS) are advisory** (§1.2). Trust the relay's push record (30618 `p`
  tag, audit log), not `git log --show-signature`.

### 1.7 Elenta's Software sub-team on Buzz git: concrete design

Goal: agents never commit or push. The **office is the single committer**. Every change to `main`
waits for the owner's approval.

**Setup (once per department that owns code):**
1. The office's **server key** (held only by our control plane, BASE-PLATFORM.md §5) signs the
   30617, so the office *is* the repo owner. The repo binds to the department's private channel.
2. Protection tags:
   ```json
   ["buzz-protect", "refs/heads/main", "push:owner", "no-force-push", "no-delete"],
   ["buzz-protect", "refs/heads/**",   "push:owner"],
   ["buzz-protect", "refs/tags/**",    "push:owner", "no-delete"]
   ```
   Only Owner-role keys can update any ref: the repo key (the office), its managed-agent owner, or
   a channel Owner (you). Do **not** use `require-patch`, because it blocks the office too.
3. Agents' identities are channel members (so they can talk and be mentioned) but never receive a
   key file, credential helper or git binary. That matches SPEC §1 and §6: no shell.

**Per job (Software piece):**

| Step | Who | Buzz event / action |
|---|---|---|
| Agent writes files into `work/<job>/out/<piece>/` | agent (ACP, our policy) | none; our activity feed shows "Edited `src/x.ts` (+12/−3)" |
| Lead combines, job reaches `waiting_approval` | office | kind 9 reply in job thread (as today) |
| Office commits on branch `job/<job-id>` with author = acting person name, committer = office; pushes | office (server key) | git push → relay emits 30618 (`p` = office) |
| Office opens review | office, signing as the **lead's identity** | kind 1618 with `c=<commit>`, `branch-name`, `["e", <job root>]` and our `elenta` tags; posted into the job thread |
| Owner reviews diff | owner, in our job view (or Buzz desktop Reviews tab) | `approval` / `changes-requested` kind 1 note signed by the owner key, with `c=<commit>` |
| Office verifies: signer = owner, `c` = current branch head, PR still open | office | — |
| Merge, fast-forward only if possible; refuse if head moved (same rule as desktop's `branch_changed`) | office | push `main` → 30618; kind 1631 merged status referencing the PR and the approval event id |
| "Request changes" | owner | job goes back to `working` with the note as a lesson (SPEC §4.6); the next push is 1619 PR update |

What we get for free: Buzz desktop users see the same review in **Projects → Reviews** with diff,
comments and status. We don't build a code-review UI beyond a diff view and two buttons. Tickets
for code (bugs, requests) can be kind 1621 issues that our tickets mirror (FEATURE-PLAN §1). For
richer tickets, prefer NIP-AR artifacts (§4.3).

---

## 2. UI/UX walk-through (desktop `desktop/`, Tauri + React; `web/`)

The desktop renderer is a React app (TanStack Router with hash history, `desktop/src/app/router.tsx:1-7`)
in a Tauri shell. Tauri commands live in `desktop/src-tauri/src/commands/*` (~240 files). The web
client `web/` is only an **invite page and a repo browser** (`web/src/app/routes/`: `index`,
`invite.$code`, `repos`, `repos.$repoId`, `repos.$repoId.blob.$`). The full product is the desktop
app; a Flutter mobile app is 🚧.

Routes (`desktop/src/app/routes/`): `index` (Home/Inbox), `channels.$channelId`,
`channels.$channelId.posts.$postId` (forum post), `messages.new`, `agents`, `projects`,
`projects.$projectId`, `pulse`, `reminders`, `settings`, `workflows`, `workflows.$workflowId`.

### 2.1 Shell and sidebar: `img/buzz-02-channel.png`

- **Left sidebar** (`features/sidebar/ui/AppSidebar.tsx`, `AppSidebarPinnedHeader.tsx:133-175`).
  From the top: "Search everything ⌘K"; pinned nav **Inbox · Pulse · Projects · Agents ·
  Workflows**; a **Projects** section; **Channels** (`#` open, 🔒 private, a stack icon for project
  channels); **Forums**; DMs; and at the bottom the **profile card** with a presence dot
  (`SidebarProfileCard.tsx`). There is a community rail for switching workspaces
  (`CommunityRail.tsx`), drag-and-drop custom sections (`SidebarDnd.tsx`, `CustomChannelSection.tsx`),
  and a "More unread" pill.
- **Working badge on a channel row.** When an agent is mid-turn in a channel, the row shows a
  ticking timer ("0s" in `img/buzz-12-activity-feed.png`). Hovering opens
  `ChannelActivityPopover.tsx:199-240`, which lists **working agents** with a spinner, "Working" and
  elapsed time. Clicking a row opens that agent's activity.

### 2.2 Channel view: `img/buzz-02-channel.png`

- **Header** (`features/chat/ui/ChatHeader.tsx`): channel name, then a terminal button, member count
  (`ChannelMembersBar.tsx`, `ChannelMemberAvatarStack.tsx`), a huddle (voice) button and a ⋮ menu
  opening the management sheet (`ChannelManagementSheet.tsx`: topic, members, workflows section
  `ChannelWorkflowsSection.tsx`, canvas history `CanvasHistoryPanel.tsx`).
- **Intro block** for a new channel (`useChannelIntro.tsx`, `messages/ui/ChannelIntroBlock.tsx`):
  big `#`, purpose line, and two cards, **"Add agent: Add an agent here"** and **"Add people"**.
  Agents are invited the same way people are.
- **Timeline** (`messages/ui/TimelineMessageList.tsx`, `MessageRow.tsx`): avatar, name, a **robot
  glyph with "managed by you"** or **"owner unavailable"** (`MessageAgentOwner.tsx`), time, and the
  body. "N new messages" pill, day dividers, unread divider. Hover toolbar
  (`img/buzz-13-agent-profile.png`): 👍 ❤️ 😂, add reaction, **reply in thread**, copy link, ⋮.
- **Composer** (`MessageComposerToolbar.tsx`): @ mention, attach, voice, emoji, formatting. Below
  it the **activity accessory** (`channels/ui/ChannelComposerActivityAccessory.tsx`) reads
  **"Observer Agent: Thinking"** while the agent works, with a typing row
  (`TypingIndicatorRow.tsx`) for humans and bots.
- **Agent addressing** (`MessageAgentAddressPrefix.tsx`, `ComposerAddressControls.tsx`): a message
  that @mentions agents shows them as an address chip before the text, so you can see at a glance who
  the message is *for*.

### 2.3 Threads: `img/buzz-03-thread.png`

`messages/ui/MessageThreadPanel.tsx` opens as a right pane: the root message, "No replies in this
branch yet", and its own composer ("Reply in thread to charlie"). Threads can be **followed before
the first reply** (CHANGELOG v0.5.27 #7692). Thread summaries in the timeline use
`MessageThreadSummaryRow.tsx`. Agents keep a separate conversation session per channel
(`docs/practical-information-flow-for-buzz-agents.md`: "Buzz creates a separate conversation session
for each channel"). The prompt carries `[Thread context]` for the thread being answered, and thread
roots are carried in agent activity events (#8029).

### 2.4 DMs: `img/buzz-04-dm.png`

NIP-17 gift-wrapped DMs, 1:1 or group up to 9 (VISION.md:22). The **New message** page is
`routes/messages.new.tsx`; the intro shows an avatar stack (`DirectMessageIntroAvatarStack.tsx`).
You can DM an agent like a person. Mid-turn DM follow-ups **steer the running turn** instead of
queueing (CHANGELOG #8058).

### 2.5 Home / Inbox: `img/buzz-01-home.png`

`features/home/ui/HomeView.tsx`: a two-pane inbox. On the left, items with a filter ("All"): "alice ·
Mentioned in #general · Please review the release checklist." On the right, the message in context
with a reply composer ("Send reply to #general thread"). VISION.md:131-137: "@mentions, items needing
action, channel activity, agent updates. Fan-out-on-read… Agents read the same feed via MCP."
**Zero notifications by default; you opt in to noise** (VISION.md:133).

### 2.6 Pulse: `img/buzz-09-pulse.png`

`features/pulse/ui/PulseView.tsx`: a social, Twitter-like stream of short notes. Filter tabs are
**Everyone · Following · Liked · Agents (3) · Mine**, with a "What's on your mind?" composer. Agent
posts carry a **bot** pill (`AgentActivityCard.tsx`, `NoteCard.tsx`). This is where agents post
status ("Release checklist is ready for async feedback") without cluttering a channel.

### 2.7 Canvases

One shared Markdown document per channel (kind 40100, `ingest.rs:580`), editable from desktop or by
agents through MCP/CLI (VISION.md:143-145). Revision history is in `channels/ui/CanvasHistoryPanel.tsx`.
Tauri side: `desktop/src-tauri/src/commands/canvas.rs`.

### 2.8 Search: `img/buzz-11-search.png`

⌘K command palette (`features/search/ui/TopbarSearch.tsx`, `SearchScopeControls.tsx`,
`HighlightedSearchText.tsx`). When empty, it shows **Recent activity** (channels with descriptions and
"5m ago") and **Actions** (Browse channels, Create a new channel). When you type ("release" in the
shot), it shows **Most relevant** full-text hits (Postgres FTS on the relay): author, "Message in /
Thread in #watercooler", the matched word highlighted, and age. Scope controls narrow the search to a
channel or person.

### 2.9 Agents, presence and profiles: `img/buzz-07-agents.png`, `img/buzz-13-agent-profile.png`

- **Agents screen** (`features/agents/ui/AgentsScreen.tsx`, `UnifiedAgentsSection.tsx`): "Set up
  and manage your agents". It has a create tile, **Custom agents** cards (avatar, presence dot,
  model) and **Agent teams** ("Group agents that you can add to a channel together", with version
  badges `v1.2.0`: `TeamsSection.tsx`, `TeamDialog.tsx`, team snapshot import/export). The header
  has **Set agent defaults** and **Stop running agents**. Agent definitions are **personas** (model +
  system prompt, NIP-AP; `PersonaDropdownField.tsx`, `AgentDefinitionDialog.tsx`). Who the agent
  answers is set in `RespondToField.tsx:77-79`: **Only me (default) · Anyone · Selected people**.
- **Profile panel** (`features/profile/ui/UserProfilePanel.tsx`): big avatar, presence dot, name,
  then **Stop · Restart agent · Message · Follow**. Tabs **Info · Runtime · Channels · Memories**.
  Info shows **Activity log → View**, public key, **Managed by you**, agent type (Goose), capabilities
  (messages, channels, mcp) and Delete agent. *Memories* are relay-stored engrams (NIP-AE,
  `crates/buzz-core/src/engram.rs:1-8`).
- **Presence**: kind 20001 updates and 40902 snapshots (`kind.rs:465,505`); `PresenceBadge.tsx`.
  The rule is strict (`docs/agent-availability.md:1-10`): "Availability means conversational
  presence on the relay, not process health… An unqueried identity is unknown, never implicitly
  Offline." Presence is a lease the agent renews, so a dead agent's dot is wrong for at most about
  3 min (VISION_REMOTE_AGENTS.md "Honest Costs").
- **Working signal** (`features/agents/agentWorkingSignal.ts:1-20`): one source of truth for every
  "is working" affordance (sidebar badge, profile, agent rows, composer bar, activity header).
  Primary: observer-derived active turns (kind 24200 → `activeAgentTurnsStore.ts`, liveness ping
  about every 10 s, pruned after 25 s of silence). Fallback: bot typing indicators (kind 20002).

### 2.10 The agent activity feed: `img/buzz-12-activity-feed.png`

Opened from the profile ("Activity log → View") or the working popover. It renders in the right pane
(`channels/ui/AgentSessionThreadPanel.tsx`, `agents/ui/ManagedAgentSessionPanel.tsx`) with the
header "Observer Agent · Activity · #agents · Last updated 3h ago" and a gear for settings.

**Data source.** Ephemeral **kind 24200 observer frames**, NIP-44-encrypted to the owner
(`crates/buzz-core/src/observer.rs:1-5`), carrying the agent's raw ACP traffic (`session/prompt`,
`session/update`: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`,
`plan`, `usage_update`, `current_mode_update`, `session/request_permission`). Parsed in
`agents/ui/agentSessionTranscript.ts:933-1060`. Turn metrics are a separate stored kind 44200
(NIP-AM).

**The render classes** (VISION_ACTIVITY.md:27-37; code `agents/ui/agentSessionTypes.ts:24-39` and
`activityRenderClasses/TranscriptActivityItem.tsx:16-32`):

| Tier (VISION) | Class (code) | Presenter | What it looks like |
|---|---|---|---|
| Spine | `message` | `MessageActivity` | Agent's own words as a chat bubble; the triggering human prompt as a right-aligned bubble with the author avatar ("@Observer Agent draft the Q3 supplier summary…") |
| Spine | `relay-op` | `ToolActivity` | Semantic Buzz card: "Sent a message to #design" (same card whether via MCP or `buzz` CLI: "semantics over transport") |
| Spine | `file-edit`, `file-read`, `skill-read`, `image` | `ToolActivity` | "Edited `drafts/q3-summary.md`" with a +/− diff (`FileEditDiffView.tsx`), "Read `notes/suppliers.md`" |
| Spine | `shell` | `ToolActivity` | "Ran `npm test` 0.0s" with output on expand |
| Spine | `status` | `LifecycleActivity` | Mode, usage (tokens and $ cost, coalesced), commands; `TurnLivenessIndicator.tsx` shows the turn in progress |
| Context | `thought` | `ThoughtActivity` | Collapsed "Thinking ⌄" |
| Context | `plan` | `PlanActivity` | "Updated plan ⌄" (todo list with status) |
| Context | `permission` | `LifecycleActivity` | Request, then outcome "Approved (allow_once)" / "Denied" / "Cancelled" |
| Context | `error` | `LifecycleActivity` | Red row |
| Safety net | `generic` | `ToolActivity` | Honest fallback: tool name + args |
| Safety net | `raw-rail` | `RawRailActivity` / `RawEventRail.tsx` | System prompt, prompt context sections, raw JSON |
| Safety net | `suppressed` | `SuppressedActivity` | Noise we deliberately hide |

**Verb / object / outcome.** Each tool item gets a descriptor
`{ renderClass, label, action: { verb, object }, tone: read|write|admin|neutral, source: mcp|shell|acp|harness|fallback, groupKey }`
(`agentSessionTypes.ts:41-58`). Verbs come from `agentSessionToolClassifier.ts:162-309`: **Read,
Ran, Viewed, Edited, Updated, Checked (todos), Compacted (context)**, plus "Requested" for permission
(`agentSessionTranscript.ts:221`). Consecutive reads group ("Ran 2 tool calls ⌄",
`agentSessionTranscriptGrouping.ts`). Status mutates in place (pending → executing → completed or
failed). Outcomes lead: a failed `npm test` shows its status, not its log.

### 2.11 Projects (code): `img/buzz-08-projects.png`

`features/projects/ui/*` (108 components). Tabs: **Activity · Projects · Repositories · Tasks ·
Reviews · Channels**. The Activity tab has a weekly digest line ("This week: 4 new commits, 4 reviews
opened, and 2 active projects", `lib/projectsActivityDigest.ts`) and a timeline of "X created the
repository", "Brain pushed a commit" (commit chip) and "alice opened a review" (Open chip). The right
rail has counts (Projects 1, Repositories 4, Channels 2, Tasks 74, Reviews 69) and a contributor
avatar stack. The project detail (`ProjectDetailScreen.tsx`) adds README, commits, PR files-changed
with inline comments, `PullRequestReviewCard.tsx` (Approve with summary dialog, Request changes,
Ready/Draft/Close/Reopen, Merge), `IssueAssigneesRow.tsx`, `CreateIssueDialog.tsx`, and an **agent
chat panel scoped to the project** (`ProjectAgentChatPanel.tsx`, `ProjectAgentContextStrip.tsx`:
selected items become context for the agent).

### 2.12 Workflows: `img/buzz-05-workflows.png`, `img/buzz-06-workflow-editor.png`

- **Library** (`features/workflows/ui/WorkflowsView.tsx`, `WorkflowCard.tsx`): "Automations that keep
  your community moving." Cards have an enable toggle, an actions menu (duplicate, delete) and a
  create tile.
- **Editor** (`WorkflowDialog.tsx`, `WorkflowFormBuilder.tsx` 989 lines): a generated name
  ("mock-horse-battery", editable). First **Choose a channel**, then a trigger pane (message text
  conditions, emoji picker, cron input with a human description `CronExpressionInput.tsx`,
  `WorkflowScheduleFields.tsx`, webhook headers and secret dialog), then step cards
  (`WorkflowStepCard.tsx`) with a node inspector. A **Form ⇄ YAML** toggle sits bottom left
  (`WorkflowTemplateTextarea.tsx`). Saving a webhook workflow shows its secret once
  (`WorkflowWebhookSecretDialog.tsx`). Broad triggers ask for an activation confirmation.
- **Detail and runs** (`WorkflowDetailPanel.tsx`, `WorkflowRunTrace.tsx`): run list; per step a
  status icon and badge (completed, skipped, failed), duration and output.
- **Approvals UI** (`WorkflowApprovalCard.tsx:1-31`): an amber "Approval Required" card with approver
  and expiry, and the literal line **"Approval actions are not yet available in Desktop."** It is
  read-only, which matches WF-08.

### 2.13 Settings: `img/buzz-10-settings.png`

You open it from the profile card menu (Online chip · Update your status · community · Send feedback
· Settings Ctrl+,). `features/settings/ui/SettingsScreen.tsx`, `SettingsPanels.tsx`: a left nav with
"Back to app" and three groups. **Personal**: Profile (avatar, display name, description, identity
details, sign out / "Delete my data" after testing a key backup), Appearance, Notifications (sound
picker), Voice, Shortcuts, Custom emoji, Local archive, Channel templates. **Communities**: Hosted
communities, Admin. **App**: **Agents** (defaults, harness catalog, custom harness), Compute (mesh),
Experiments, Mobile (QR pairing), Updates. Private-key backup is an encrypted HPKE backup with a test
flow.

### 2.14 Other surfaces (brief)

Forums (Discourse-like long-form posts, `features/forum/ui/*`); huddles (voice rooms; agents can be
added with a voice, `huddle/ui/AddAgentDialog.tsx`, `AgentVoiceMenu.tsx`); reminders ("remind me
later", snooze); user status emoji; a moderation queue and admin console; a terminal pane per
channel/project (`features/terminal`).

---

## 3. Workflows

### 3.1 Format

A workflow is a **kind 30620** event (`kind.rs:444`), addressable by `d`, scoped to one channel by
`h`, whose content is YAML (≤ 64 KiB, `buzz-sdk/src/builders.rs:1799`). Create and update it with
`buzz workflows create --channel <uuid> --yaml …` (`cli/commands/workflows.rs:98-150`), the desktop
editor, or MCP. Schema: `crates/buzz-workflow/src/schema.rs`.

```yaml
name: string            # required, non-empty
description: string     # optional
enabled: true           # default true
trigger:                # tag field "on"
  on: message_posted | reaction_added | diff_posted | schedule | webhook
  # message_posted / diff_posted: filter: "<evalexpr>"
  # reaction_added: emoji: "eyes", filter: "..."
  # schedule: cron: "55 8 * * 1"  (UTC; 5/6/7 fields)  OR  interval: "1h"
steps:                  # ≥1; ids [A-Za-z0-9_]{1,64}, unique
  - id: post
    name: optional label
    if: "<evalexpr>"     # false → step skipped, not failed
    timeout_secs: 30
    action: send_message | send_dm | set_channel_topic | add_reaction | call_webhook | request_approval | delay
    # send_message: text, channel (UUID; only the bound channel for channel workflows), reply_in_thread
    # add_reaction: emoji
    # call_webhook: url (public https), method, headers, body
    # request_approval: from, message, timeout ("24h")
    # delay: duration ("5m"; max 270 s)
```

Sources: `schema.rs:14-27` (WorkflowDef), `:37-71` (triggers, including the undocumented
`diff_posted` for kind 40008 diffs), `:75-90` (step), `:94-156` (actions), `:173-240` (validation:
`reply_in_thread` only with message triggers).

**Expressions and templates.** `evalexpr` with dots mapped to underscores (`trigger.text` →
`trigger_text`) and the helpers `str_contains`, `str_starts_with`, `str_ends_with`, `str_len`. There
is a 100 ms timeout and a 4,096-byte cap (`executor.rs:355,375`). Templates `{{trigger.text}}`,
`{{trigger.author}}` and `{{steps.ID.output.FIELD}}` are single-pass, and unknown variables stay
literal (ARCHITECTURE.md:629).

### 3.2 Triggers, actions, traces: what really runs

| Item | State | Evidence |
|---|---|---|
| `message_posted` (kind 9 only), `reaction_added` (kind 7), `diff_posted` (40008) | ✅ | `lib.rs:1038-1050`, tests `:1438-1545` |
| `schedule` (cron or interval) | ✅ 60 s tick, window matching, **durable per-fire claim** so multi-pod runs fire at most once | `lib.rs:489-600` |
| `webhook` | ✅ `POST /hooks/{id}`; the secret is in the URL | ARCHITECTURE.md:735 |
| `send_message`, `add_reaction`, `call_webhook`, `delay` | ✅ (`call_webhook`: SSRF-guarded, no redirects, 1 MiB response cap) | `executor.rs:597-761,871-1024` |
| `send_dm`, `set_channel_topic` | ❌ `NotImplemented` (WF-07) | `executor.rs:657-664` |
| `request_approval` | ❌ creates a token, then the run is marked **Failed** `approval_not_supported` (WF-08) | `executor.rs:738`, `lib.rs:229-250` |
| Who signs workflow messages | The **relay key**, with `p` = workflow owner, `buzz:workflow` (prevents loops) and `buzz:workflow-owner` tags | `crates/buzz-relay/src/workflow_sink.rs:205-306` |
| Who may own one | Any current channel member; `call_webhook` needs channel **owner/admin**; re-checked at run time, fail-closed | `lib.rs:140-170,1029-1035` |
| Concurrency | 100 runs at once, globally; over capacity → `CapacityExceeded` (no queue). **No "skip if previous run still running"** | `lib.rs:59-110`, ARCHITECTURE.md:640 |
| Traces | Stored as `execution_trace` JSON on the run row: per step `{step_id, status: completed/skipped/failed, output, started/completed}`. Read through `GET /workflows/{id}/runs` and the desktop trace view. The trace event kinds 46001–46012 are **defined but not emitted** (no producer outside tests). | `executor.rs:1202-1300`, `lib.rs:213-290`, `buzz-db/src/store/workflow.rs:216`, `kind.rs:562-588` |

### 3.3 Elenta routines as Buzz workflows

Pattern (FEATURE-PLAN §1, §4.6): **the workflow only posts a request; our control plane does the
work.** A routine is one schedule workflow per routine, owned by the office key, bound to the
department channel.

```yaml
name: "Weekly supplier risk summary"
description: "elenta-routine:supplier-risk-weekly"   # our routine id, for lookup
enabled: true
trigger:
  on: schedule
  cron: "55 7 * * 1"            # Mondays 07:55 UTC (jittered off :00)
steps:
  - id: request
    action: send_message
    text: |
      [elenta:routine supplier-risk-weekly]
      Weekly supplier risk summary: compare this week's delivery notes with last week's,
      flag late or at-risk suppliers, propose actions.
      mode: team
```

How our control plane handles it:
1. Subscribe to kind 9 in each department channel. Accept a routine request **only if** it is
   relay-signed, carries `buzz:workflow`, carries `buzz:workflow-owner` = office pubkey, and
   the text has a `[elenta:routine <id>]` marker that matches a routine in our org file. The
   matching routine supplies the real prompt, mode and budget. The message text is never trusted
   as instructions.
2. Apply our **routine hygiene**: skip if the previous run of this routine is still active, apply a
   time limit, check the budget reservation. Buzz has none of these.
3. Start a job whose thread root **is that workflow message**, so the trigger, the work and the
   result sit together.
4. Approvals stay ours (Buzz's `request_approval` fails runs).

**Limits to design around:** UTC cron only, minute granularity; no DM/topic actions; no approval
step; `delay` ≤ 270 s; triggers fire only on kind 9 / 7 / 40008 (not on our custom tags); runs aren't
events (traces are DB rows), so our audit must record "routine fired" itself; one YAML ≤ 64 KiB;
global 100-run cap. A `message_posted` workflow does not fire on workflow-authored messages
(loop guard), so you cannot chain workflows through messages.

---

## 4. Roadmap: what's coming (so we don't duplicate it)

No dated roadmap exists. The CHANGELOG has version headers (v0.5.27 at the top) without dates. The
commit at `1972b7d` is 2026-10-07. Buzz's status tables are partly stale (they understate git
and issues, §1.4).

### 4.1 Status by source

| Item | Source | Status | Elenta stance |
|---|---|---|---|
| Workflow approval gates (WF-08) | README.md:103, VISION.md:231, VISION.md:125-127, ARCHITECTURE.md:645 | 🚧 schema, REST, MCP tool and UI exist; executor doesn't persist or resume | Keep ours (FEATURE-PLAN). Watch `executor.rs:738`. |
| `send_dm`, `set_channel_topic` (WF-07) | `executor.rs:657-664` | 🚧 | Not needed. |
| Huddle lifecycle events | README.md:104 | 🚧 | Not needed. |
| Mobile (Flutter, offline-first) | VISION_MOBILE.md; many v0.5.27 entries (iOS Liquid Glass tabs, presence, mention rules, pairing) | 🚧 active | **Wait for it**; our server makes the relay the place a phone can read. |
| Remote agents (provider binaries, Kubernetes first, self-reaping, "relay is the only tether") | VISION_REMOTE_AGENTS.md; VISION.md:235 "spec in review"; `crates/buzz-backend-kubernetes` | 📋 / early code | Watch. Its key-handover model contradicts our key custody. |
| Mesh compute (pooled GPUs via mesh-llm/iroh) | VISION_MESH.md; VISION.md:233 ✅ | ✅ per VISION | Out of scope (network policy). |
| Moderation (reports, queues, timeouts, staff ban) | VISION_MODERATION.md; v0.5.27 #7883, #8005 | ✅ largely | Not needed for a single-owner office. |
| Web-of-trust reputation | VISION_PROJECTS.md:136-148, README 💭 | 💭 | Ignore. |
| Push notifications | README 💭; push gateway chart 0.3.3 shipped (#8107) | 🚧 | Watch for mobile. |
| Culture features (polls, kudos, confetti, **Knowledge Crystallization**: AI proposes summaries, humans approve, result pinned) | VISION.md:181-196 "Planned design" | 💭 | Crystallization ≈ our "lessons"; keep ours. |
| Forge layer: branch-as-channel, merge train/coordinator, relay-enforced approvals, repo web view by content negotiation | VISION_PROJECTS.md, VISION_SOVEREIGN.md:72-127 | 📋 | Our office does merge gating for now (§1.7). Don't build a merge train. |
| Agent roles: triage, review, docs, merge coordinator, coding agent on **kind 43001 jobs** | VISION_PROJECTS.md:213-219 | 📋; 43001–43006 rejected by relay (BASE-PLATFORM §2.2) | Don't depend on job kinds. Our jobs are threads. |
| **NIP-AR channel artifacts** (kind 45010 editable records: `buzz.task`, `buzz.project`) | `docs/nips/NIP-AR.md`; CHANGELOG v0.5.26 #7919 "implement NIP-AR channel artifacts" | ✅ relay; desktop doesn't use them yet | **Adopt for tickets** (§4.3). |
| Trusted broker / audience-bound agent instances (confused-deputy fix: broker holds key, a process never crosses an audience) | `docs/practical-information-flow-for-buzz-agents.md` (draft, 2026-08-27) | 📋 design | Same idea as our control plane holding keys. Cite it if Buzz ships it. |
| Agent observability (NIP-AO), personas (NIP-AP), engram memory (NIP-AE), turn metrics (NIP-AM), workspace profile (NIP-WP), reminders (NIP-ER), read-state sync (NIP-RS), channel/thread windows (NIP-CW) | `docs/nips/*` (all `draft`) | mostly shipped in desktop | Reuse shapes where cheap (observer frames → our feed). |
| Replica read routing | `PLANS/REPLICA_FULL_READ_ROUTING_DESIGN.md` (active, created 2026-08-28) | infra | Irrelevant at our scale. |
| NIP-FI identity assertions, enterprise identity adapter, multi-tenant communities | CHANGELOG v0.5.26–27; `docs/enterprise-identity-adapter.md` | 🚧 | Ignore (single community). |

### 4.2 Recent CHANGELOG themes (v0.5.25–v0.5.27)

These are the most relevant to working with agents as teammates:
- **Steering**: "steer running turns with edited mentions" (#6132), "wake agents for mentions
  added by edits" (#6131), "steer mid-turn DM follow-ups natively" (#8058), "synchronize handoff
  steering with tool approval" (#8042).
- **Presence honesty**: "derive agent availability from relay presence", "distinguish unknown
  presence", "reduce heartbeat frequency", "scope presence subscriptions to active demand".
- **Threads**: "Allow following channel messages before their first reply" (#7692), "Include thread
  roots in agent activity events" (#8029).
- **Agent quality**: "stop built-in prompts from teaching sleep polling" (#7992), "request
  summarized Claude thinking and label empty rows" (#8051), Claude effort levels (#8059),
  `BUZZ_GIT_IDENTITY` (#8024), "handoff summary" budget fixes in buzz-agent (context-full
  self-handoff).
- **Artifacts**: NIP-AR implemented (#7919) and "propose simplified channel artifacts".

### 4.3 NIP-AR artifacts, and why they fit our tickets

`docs/nips/NIP-AR.md` (108 lines; relay: `kind.rs:554`, `ingest.rs:502,2422,2892`):
- kind **45010**, envelope tags `ar=1`, `d` (stable UUID), `h` (home channel), `type` (`elenta.ticket`),
  `title`, `op` (create/update/move/delete/restore), optional `root` (**anchor to a thread**, our
  job), and `prev`. Plus our own filter tags (`status`, `assignee`, `blocked-by`, `goal`).
- **Every revision must name the current revision in `prev`. The relay advances atomically, so of
  two competing edits only one can succeed.** That is our **atomic checkout** (FEATURE-PLAN §2 P1),
  enforced by the system of record.
- Access = channel read/write (same as kind 9), so department privacy carries over.
- Current-state queries by exact tag match across channels, e.g. `status=open AND blocked-by=<id>`.
- Revisions don't bump unread counts or re-notify mentions.

Recommendation: shape our tickets as `type: elenta.ticket` artifacts anchored (`root`) to the job
thread, rather than kind 1621 issues. Use 1621 only for code issues in a repo (§1.7).

---

## 5. UX patterns: adopt, and avoid

### 5.1 Adopt (with reasons)

1. **Agents are members, not a sidebar tool.** You invite them with the same "Add agent / Add
   people" cards, they appear in the member list, and they carry an owner badge ("managed by you",
   "owner unavailable"). *Reason:* this is what makes them feel like teammates. In our office the
   people already sit at tables on the floor. Add the same badge and an "invite to this job"
   action. Talking to a department should feel like talking to a team in a room.
2. **@mention is the way to ask for work, and editing the mention steers it.** Buzz queues mentions
   per channel (one turn in flight, batched follow-ups, ARCHITECTURE.md:767-783) and lets an edit or
   a DM follow-up steer a running turn. *Reason:* "hey, also include Q2" mid-task is how you talk
   to a colleague. Our job thread should accept follow-ups that steer the active piece instead of
   needing a new job.
3. **One "is working" signal everywhere** (`agentWorkingSignal.ts`): a channel badge with an
   elapsed timer, a composer line ("Sofia: Thinking"), a profile spinner, the floor ring. All read
   one store, with liveness pings and pruning. *Reason:* our floor rings and job cards must never
   disagree.
4. **Presence = conversational availability, with "unknown" as a real state**
   (`docs/agent-availability.md`). *Reason:* honest dots build trust. Grey "unknown" is not
   "offline".
5. **Activity feed as sentences: verb, object, outcome.** Outcome first, mutate in place, coalesce
   chunks, group reads, failures loud and reads quiet, a raw rail on demand, and **never go dark**
   (render "waiting…" or "timed out"). *Reason:* SPEC §1.5 says "everything is visible", and this is
   how to make "visible" readable. Map our policy events onto the same classes: `permission` with
   outcome "Allowed / Asked → Approved / Refused", `file-read` for library notes, `file-edit` for
   `out/` writes. Use the same verb list (Read, Edited, Ran, Requested, Updated plan). Our job feed and
   Buzz's then read alike (FEATURE-PLAN §1).
6. **Inbox of "needs you"** (Home): mentions and items needing action, zero-notification default.
   *Reason:* our approvals counter should open an inbox like this (approval cards, refused-tool
   asks, questions from leads), not a bare list.
7. **Thread per job, follow a thread, thread-scoped agent session.** *Reason:* it already matches
   "department = channel, job = thread", and following lets the owner subscribe to one job.
8. **Profile with plain controls**: Stop · Restart · Message · Follow, then Activity log, Channels,
   Memories. *Reason:* this is our "pause / resume / terminate" board control (FEATURE-PLAN §2 P1),
   shown where people look for it.
9. **Teams as versioned, shareable bundles** (Agent teams with `v1.2.0`, snapshot import/export).
   *Reason:* this matches our "department packages" (FEATURE-PLAN §3/§4.8). Show a version and
   review the package before import.
10. **Project-scoped agent chat with selected context** (`ProjectAgentContextStrip.tsx`): selected
    items become context chips for the agent. *Reason:* a good model for "ask the Software lead
    about this deliverable".
11. **Merge safety: refuse if the branch head changed since review** (`branch_changed`). *Reason:*
    the owner approved *a specific commit*; we merge exactly that one.
12. **Workflow editor: Form ⇄ YAML, channel first, human-readable cron, a confirmation for broad
    triggers.** *Reason:* a good model for a routines editor, if we ever build one.

### 5.2 Avoid

1. **Auto-approving agent permissions, shell tools, keys in the agent environment** (buzz-acp,
   buzz-dev-mcp; BASE-PLATFORM §2.7–2.8). Foundation, not negotiable.
2. **Read-only approval cards that look actionable** ("Approval actions are not yet available").
   Every amber card we show must have working Approve / Deny.
3. **Trusting kind 1 "approval" notes without checking the signer and commit.** Buzz desktop does
   this in the client. We do it server-side and record the approval id in the merged status.
4. **Copying vision syntax** (`push-allowed`, `require-approval`, bare `main`). It is skipped or
   locks the repo (§1.3).
5. **Relying on status tables or VISION docs for what exists.** They lag the code in both
   directions. Pin the digest and test the behaviour (BASE-PLATFORM §12).
6. **Pulse-style social feeds for work status.** They are fine for culture, but job status belongs in
   the job thread and the inbox. Otherwise it splits attention.
7. **Huge feature surface in one shell** (huddles, mesh, moderation, admin console, terminal). Our
   office stays focused: floor, jobs, inbox, approvals.
8. **Workflow-signed messages as instructions.** Relay-signed `buzz:workflow` messages only *point
   to* a routine we already defined (§3.3).

---

## 6. File index (most useful entry points)

| Topic | Path |
|---|---|
| Git transport and gates | `crates/buzz-relay/src/api/git/{transport,policy,mod,manifest_event,cas_publish}.rs` |
| Git permission model | `crates/buzz-core/src/git_perms.rs` |
| Git storage spec | `docs/git-on-object-storage.md` |
| Git helpers | `crates/git-credential-nostr/src/lib.rs`, `crates/git-sign-nostr/src/lib.rs`, `crates/buzz-acp/src/git.rs` |
| CLI forge commands | `crates/buzz-cli/src/commands/{repos,pr,patches,issues,projects}.rs` |
| Desktop merge and reviews | `desktop/src-tauri/src/commands/project_git_workflow.rs`, `desktop/src/features/projects/{pullRequestReviews.ts,projectPullRequests.mjs,projectIssues.mjs}` |
| Workflow engine | `crates/buzz-workflow/src/{schema,executor,lib}.rs`, `crates/buzz-relay/src/workflow_sink.rs` |
| Workflow UI | `desktop/src/features/workflows/ui/*` |
| Activity feed | `VISION_ACTIVITY.md`, `desktop/src/features/agents/ui/{agentSessionTypes.ts,agentSessionTranscript.ts,agentSessionToolClassifier.ts,activityRenderClasses/*}` |
| Working / presence | `desktop/src/features/agents/{agentWorkingSignal.ts,activeAgentTurnsStore.ts}`, `docs/agent-availability.md`, `crates/buzz-core/src/observer.rs` |
| Artifacts | `docs/nips/NIP-AR.md` |
| Vision | `VISION*.md`, `README.md:98-110` |
| Screenshots | `docs/research/img/buzz-01-home.png` … `buzz-13-agent-profile.png` (mock bridge, 1440×900) |

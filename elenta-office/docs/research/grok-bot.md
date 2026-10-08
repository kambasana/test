# Grok Bot (SpaceXAI / xAI): what the experience is, and what Elenta Office should take from it

Researched 2026-10-08 for Elenta Office. Purpose: the owner says "I really like how Grok is". This page
pins down exactly what that experience is, so we can design to it.

**North star (from the owner, 2026-10-08):** a way to do work that is better than the normal way:
talking to agents that act like teammates, the way Grok Bot showed the world. Defence work is one use
case, not the focus. Security stays the foundation, not the headline. This page is weighted
accordingly: sections 2 and 3 (the teammate experience) matter most; section 4 (security) is kept
short and practical.

How to read the sources: `[docs]` = xAI's own Grok Bot documentation (most reliable for behaviour);
`[design]` = xAI's own design essay (most reliable for *why* the UI looks the way it does);
`[mobbin]` = real app screenshots curated by Mobbin (most reliable for what the screens look like).
Third-party reviews are used for praise and criticism only. Anything I could not confirm against a
primary source is marked **(unverified)**. Source list is at the end; every `[Sx]` is a link.

---

## 0. One-paragraph answer

Grok Bot is a **messenger whose contacts are AI coworkers**. You open the app and see a list of named
teammates with little character avatars, each showing its latest one-line update in its own voice
("14 receipts in. Still missing your Uber from Tuesday.") [S2]. You text one like a colleague; it goes
off and works on its own cloud computer, keeps you posted in the chat, shows drafts as cards you can
send or discard, and comes back only when it needs a decision [S1][S5]. Bots message each other, sit
together in group chats, and one "Chief of Staff" Bot can coordinate the rest [S1][S2]. Say "do this
every morning" and it becomes a routine, with a one-line event in the chat [S2][S8]. The design rule
behind all of it, in xAI's words: *"Did this help someone delegate, or did it give them one more
thing to manage?"* and *"As agents take on more responsibility, the interface should ask less of the
person."* [S2]

---

## 1. What it is

### 1.1 Facts

| Item | What is true (source) |
|---|---|
| Maker | SpaceXAI (xAI after merging into SpaceX); built and billed with Cursor (Anysphere) [S1][S3][S10] |
| Launch | Beta announced **11 Aug 2026** [S1]; **Team Bots** (shared team Bots, Slack) **28 Sep 2026** [S12]; design essay published **3 Sep 2026** [S2] |
| Origin | Internal prototype at SpaceXAI used for sales outbound, marketing, office ops, bug fixes [S1]. Built by a small team in about a month; 200 to 300 early users were onboarded by hand [S20] (talk summary, secondary) |
| Pricing (now) | No standalone price. Included in every paid individual Cursor plan (Pro $20, Pro+ $60, Ultra $200 per month) and Cursor Teams; or link SuperGrok / SuperGrok Plus / SuperGrok Heavy / X Premium+. **Weekly** usage allowance, then optional on-demand billing. Free trial = a usage credit plus a 7-day window [S3][S19][S10] |
| Pricing (at launch) | Gated to SuperGrok Heavy, Cursor Ultra ($200/mo) and "Cursor Premium Teams" ($120/seat/mo) [S10][S11]; widened later (26 Aug per [S18], **unverified** date) |
| Platforms (now) | Desktop: macOS, Windows, Linux (x64 + Arm64). Mobile: iPhone, iPad, Android [S3][S9]. At launch Linux/Android were unsupported per docs while a Linux build was visible on the download page [S10] |
| Model | Not named anywhere; "Cursor manages model selection, so there is no model picker" [S7][S10] |
| Adoption | "More than 410,000 weekly users" about a month after launch, citing Bloomberg **(unverified; secondary [S18])** |

### 1.2 The concept model (only five nouns)

xAI deliberately cut the vocabulary of AI products (chats, sessions, models, context windows,
memories, system prompts, projects, skills, connectors, agents, tools, sandboxes, permissions,
automations) down to five user-facing objects [S2]:

| Object | Meaning |
|---|---|
| **Bots** | Persistent agents with their own identity, memory, runtime and tools |
| **Chats** | The conversation with a Bot (or a group of Bots) |
| **Prompts** | Context or instructions: used once, saved as a **Skill**, or triggered automatically as a **Routine** |
| **Tools** | Software, APIs, connectors, shell, computer use |
| **Artifacts** | Documents, designs, code, data the Bots produce |

"Everything else could remain beneath the interface until the user had a reason to care about it." [S2]

### 1.3 Capabilities, briefly

| Capability | How it works | Source |
|---|---|---|
| **Create a Bot** | Pick a suggested teammate or "Create your own": short name, one job, a description of how it works. Created in a chat (`Cmd+N` → "Create new Bot", or type a name). Profile: name, label, description, avatar (12 colours × 9 shapes on iOS), instructions, routines, notifications | [S4][S5][M2][M4] |
| **Personality** | No personality sliders. Character comes from the name, job, description, avatar and the Bot's voice in replies; durable rules go in the description ("Never send external messages without approval"), task details in messages | [S5][M4] |
| **Model** | None to choose; reviewers criticise the hidden router | [S7][S15] |
| **Computer** | One persistent cloud computer per user (browser, filesystem `/workspace`, terminal), shared by all that user's Bots; each Bot gets its own screen; one computer-use task per Bot at a time; keeps working with the laptop closed | [S6][S3] |
| **Connected apps** | Plugins/connectors from **Marketplace**; attach to a task with `@`; skills with `/`. Connector tokens stay on Cursor's backend, never on the computer | [S6][S16] |
| **Teams of Bots** | Group chats of **2 to 6 Bots**; write normally and the Bots decide who answers, or `@` one; Bots pass work among themselves; Bot-to-Bot async messages wake the receiver; limits ~50 Bots per account | [S8][S2] |
| **Chief of Staff** | Not a special feature: a pattern users invented ("one to manage the others") that xAI then made a suggested teammate and a use case | [S1][S2][S13][M1] |
| **Routing** | In a group, unaddressed messages are routed by the Bots themselves; "coordinating Bots handle routine routing and bring the user in when a decision requires judgment"; xAI rejected dashboards, assignment boards and handoff buttons | [S2][S8] |
| **Skills / routines** | Skill = how to do a task (shared by all Bots). Routine = which Bot runs it and when (schedule or event: Slack message, GitHub PR, webhook…). Up to 50 routines per Bot, last 20 runs kept, at least 5 minutes apart; **Test run** does real work; routines may auto-pause after a long absence | [S14][S2] |
| **Teach a task** | Record up to 10 minutes of browser work in the computer view; the Bot writes a draft skill to review (gradual rollout) | [S14] |
| **Approvals** | Inline card with the proposed operation and inputs: **Allow once / Always allow / Deny**. Approvals from unattended work expire after ~10 minutes. Model-based **Auto Review** with "Ask first" and "Allow automatically" rules; Ask first wins | [S15] |
| **Human-only steps** | Passwords, passkeys, 2FA, CAPTCHAs, payments: the Bot hands you the computer ("takeover"); masked secret requests that the model never sees; in-chat forms "one form per step" | [S15][S6] |
| **Voice** | Dictation (`Cmd/Ctrl+D`), live **voice chat**, and Bots can send **voice memos** with transcripts | [S8][S9] |
| **Memory** | Per Bot: stable preferences, role context, summaries of prior work. Tools and skills are account-wide; memory and routines belong to the Bot. Team Bots: team memory + private notes per person | [S5][S2][S13] |
| **Mobile** | Same Bots, chats, routines and computer; approve, take over, read voice memos, share-sheet into a chat; editing/testing routines is desktop-only | [S9] |
| **Other entry points** | Tag `@bot` on X to hand a post to your main Bot; Team Bots in Slack with their own handle | [S17][S13] |

---

## 2. The UI/UX in detail

### 2.1 Layout and navigation

**Desktop** (from the design essay's mock-ups and the docs) [S2][S8][S7]:

- **Left sidebar = the roster, not chat history.** Search at top; then one row per Bot or group:
  avatar, name, time, and a one-line preview of the latest message written in the Bot's voice. Pinned
  Bots at the top; **Hidden Bots** at the bottom; **Marketplace** and **Plugins** entries; your
  account at the bottom. The sidebar distinguishes **Needs attention** (question, approval,
  handoff), **Unread activity** (new result) and working/typing status [S7]. Group rows show the
  last speaker: "Website launch · John: checkout's clean on staging, 3 bugs closed." [S2]
- **Centre = the conversation** with that Bot. Header shows the Bot. Composer at the bottom ("Message
  Kenny"): attach, paste, `@` (Bots, groups, routines, connectors), `/` (skills), dictate, voice chat.
  You can send a new instruction while work is running; it takes priority and can redirect the turn;
  "Stop now" ends it [S8].
- **Right = details on demand.** "Conversation details" holds the Bot's settings and its **Routines**
  (name, schedule, "Paused") and run history [S2][S14]. The Bot's computer opens as a **pinned side
  panel** ("Kenny's screen") only when asked [S2].
- Keyboard-first: `Cmd+K` palette, `Cmd+1..9` jump to Bot, `Alt+↑/↓` next Bot, `Cmd+N` new Bot [S8].

**iPhone** (from Mobbin screenshots) [M1][M2][M3]:

- **Home** = a plain list, exactly like a messaging app: initials avatar top-left, search and `+`
  top-right; each row: coloured shape avatar with a **green presence dot**, bold name, a grey **label
  chip** for the Bot's current job ("Meal prepping", "Proposes UI…", "Challenges…"), time, and
  one-line preview ("Told them: every Sunday 8:41, menu plu…", "Nothing on on-call, travel, family…").
  Group rows stack two or three avatars ("UX Research, Design, Chi…") [M1].
- **Chat** = rounded header pill (avatar + name) with back arrow left and a **monitor icon** right
  (the computer). Your messages: black bubbles right. Bot messages: light grey bubbles left, with the
  Bot's small avatar under its last bubble. Composer: `+`, "Ask SLMob", mic [M2].
- **Profile** = large avatar, name, optional title, **Character** (colour row + shape row, "How this
  agent's mark looks everywhere", Reset to default), **Instructions**, **Routines** ("Weekly meal
  prep · Every Sunday at 8:41 AM", "+ Add routine"), **Notifications** toggle ("Get notified when this
  agent finishes or needs input") [M2].

### 2.2 What a conversation looks like

The transcript is deliberately **heterogeneous**: "conversation, system events, interactive objects,
and visualizations share one timeline" [S2]. Concretely:

1. **Plain chat bubbles**, short and in a colleague's voice. First message from a new Bot is
   proactive: "Hey Sam. I'll start pulling tomorrow's calendar and set up a morning digest you can
   actually use." [M3]. A blank Bot opens with: "Hey Sam. Fresh start, I'm here. What's the main thing
   you want me on, day to day? Work, life admin, research, something else?" [M2]
2. **One-line event rows** between bubbles, centred and grey with an icon:
   "New routine 'Weekly meal prep'", "Messaged [avatar] Chief of Staff" [M2];
   on desktop "Created Routine · Morning Briefing" and a collapsed
   "6 messages with Kenny, Tyler and Jenny" that opens when you want the detail [S2].
3. **Cards** where structure beats prose: an email card ("New email · Ready to send", From/To/Subject,
   editable body, **Send email / Discard**) [S2][S8]; a connector card ("Google Calendar · Added ·
   Connect to Google Calendar via Google's remote MCP server…") [M2]; file cards
   ("week-meal-prep.md 3.1 KB") [M2]; Cloud Agent result cards with images/videos [S21].
4. **Questions and forms** inline; the answer goes back to the Bot that asked, even in a group [S8].
5. **Approval cards**: the proposed operation and its inputs, with Allow once / Always allow / Deny;
   expired ones show **Expired** and can still offer "Always allow this in the future" [S15].
6. **Tool activity, computer use, created files, voice memos** all appear "alongside normal messages"
   [S8].

Worked example from the design essay [S2]:

> **You:** Morning! Can you check in with everyone for me?
> **Bot:** On it — pinging the team for status now
> *[event] 6 messages with Kenny, Tyler and Jenny*
> **Bot:** All on track: Kenny shipped the landing page, Tyler sent this month's invoices, and Jenny
> booked next week's interviews. No blockers.
> **You:** Love it, can you do this every morning?
> *[event] Created Routine · Morning Briefing*
> **Bot:** Done, your Morning Briefing will be here at 9:00 every day

And on iPhone, a handoff between Bots [M2]:

> **You:** @Chief of Staff record this routine
> *[event] Messaged Chief of Staff*
> **Bot:** Sending the Sunday meal-prep routine over to Chief of Staff now.
> **Bot:** Told them: every Sunday 8:41, menu plus grocery list, green beans not broccoli. They can
> fold it into the morning digest.

### 2.3 How progress and tool activity appear ("presence as interface")

The design essay's answer to *Who is this? What are they doing? How much do I need to know?* [S2]:

- **Avatar = identity.** Simple shapes + expressive eyes, consistent construction, varied by colour,
  shape and accessories; recognisable "almost peripherally". (They tried initials, emoji, pixel art,
  watercolour, clay, line art, silhouettes, identicons.)
- **Avatar = state.** Six states carried by **motion**, not by extra badges: idle ("calm and slightly
  curious"), acknowledges new work, working ("kicks into gear"), waiting, blocked/needs help, done
  ("settles").
- **Progressive disclosure of execution.** Three dots were too little (can't tell working from
  stuck). A one-line "current action" made people want every step. Research: people wanted detail
  mainly *for reassurance*. Final: motion gives the reassurance; **hover** shows the current action;
  the full step log ("Edited math.ts +14 −10 · Ran focused tests · 212 passed · Committed fix") is
  there when opened.
- **The computer in three levels**: *Status* (title-bar icon turns purple while active) → *Preview*
  (pinned side panel, keep chatting) → *Takeover* (full screen, take control, hand back). They
  rejected floating, side-by-side, modal and full-screen-by-default because **"the more prominent we
  made the computer, the more the product encouraged users to supervise it."** The computer has a
  wallpaper that shifts with the time of day so it feels like *the Bot's* desk, not yours.

### 2.4 Onboarding and empty states

From the iOS screenshots [M3][M5] and the docs [S4]:

1. Splash: "Grok Bot — Your team of always-on agents that finish the work." with colourful avatar
   characters floating around; one **Sign in** button.
2. Cursor sign-in (Google / GitHub / Apple / "Get access with SuperGrok Heavy" / email code), a
   data-sharing toggle.
3. "Meet Grok Bot" carousel with a composer already in it ("…any task to your team of agents").
4. The tour introduces Bots, the shared computer and routines, then **asks which tools you use**;
   answers only shape suggestions, nothing is connected [S4].
5. "Allow Push Notifications?" (app icon with a red badge) — Later / Enable Notifications.
6. "Setting up your Grok Bot… It may take a few minutes." (the computer boots in the background).
7. **"Meet Your New Bot"**: one big avatar, name ("Chief of Staff"), one-line job ("Reads tomorrow's
   calendar, preps a morning digest"), **Start Chat**, secondary **Create My Own**; or "Meet Your First
   Bot" with a single "Name your bot — Start from scratch and tell it what to do" field and **Create**.
8. Lands straight in a chat where the Bot speaks first.

Empty states are conversational, not instructional: a new Bot's chat is empty except for its opening
message [M2]. The Team Bot builder is itself a chat: the Bot "asks what the team needs it for, and
walks you through plugins, secrets, skills, and files" with setup cards [S13]. Compare form-based
agent builders such as Mistral's (model, temperature, system prompt, few-shot fields) [M6] and
ElevenLabs' (template grid then a long settings page) [M7].

### 2.5 Reviewers: praise and criticism

| Praised | Source |
|---|---|
| "There wasn't anything to learn… No automations to set up, no product quirks, no intricate naming. You're just chatting with a friend." (xAI-quoted user) | [S1] |
| Setup cost "really is close to zero… no workflow builder, no graph to draw" | [S15b] |
| Bot-to-Bot communication works out of the box (vs hand-built Telegram bots) — HN comment quoted by eesel **(unverified: thread not found)** | [S15b] |
| "presentation is clean, simple, no reasoning/thinking knobs" — r/singularity quoted by eesel **(unverified)** | [S15b] |
| Work lands "in the actual tool" (90% vs 100% done) | [S1] |
| Teach-a-task lets non-developers build a skill | [S22] |
| The documented credential design (human takeover, masked secrets, approval precedence) is "better than the category norm" | [S10] |

| Criticised | Source |
|---|---|
| All Bots share one computer, files and logins; "Do not use separate Bots as a security boundary"; deleting a Bot leaves its logins | [S6][S10][S15b] |
| Approvals are preventive only; no dry run; a **Test run performs real work** | [S14][S15b] |
| Auto Review is model-based ("an LLM is judging the LLM"); no published closed list of what needs approval | [S15][S15b] |
| No model choice; router "wasn't great" (VentureBeat, via Beam) | [S11] |
| Token burn: always-on agents "use a LOT of tokens"; swarms hit the weekly limit mid-task | [S15b][S23] |
| Every Bot is one endless thread: no "new chat", no manual compaction, no visible context use — forum report via [S18] **(unverified)** | [S18] |
| Launch bugs: usage meter mismatch, broken iOS GitHub login, an outage 20–21 Aug **(unverified)** | [S15b][S18] |
| Audit/enterprise controls thin at launch; now Enterprise-only (audit logs, Action Recording, network allowlist) | [S16][S15b] |

---

## 3. What makes it feel good: buildable design principles

Each principle below is something observed in Grok Bot, then a concrete rule we can build.

1. **The unit is a teammate, not a session.** The sidebar lists *who* works for you, never a pile of
   chats [S2]. *Build:* a roster of named people as the primary navigation; one long-lived thread per
   person; jobs appear inside it.
2. **The roster is an inbox of outcomes.** Each row's preview is the teammate's latest result or ask,
   written in first person and specific ("8 intros drafted — sitting in the CRM till you send") [S2].
   *Build:* every agent turn ends with a ≤ 80-character status line in its own voice, which is what the
   roster shows. No generic "Task completed".
3. **Teammates speak first.** A new Bot opens with a plan or a question about your priorities [M2][M3].
   *Build:* creating or hiring a person triggers an introduction message: who I am, what I'll own,
   one question.
4. **Setup is a conversation.** No workflow builder; grant access when the Bot asks [S3][S13].
   *Build:* creating a person, a routine or a team happens by asking in chat; the form exists but is
   secondary (the profile page).
5. **Presence lives in the avatar.** Six states shown by motion on the same mark that identifies the
   teammate [S2]. *Build:* one avatar component with states idle / acknowledged / working / waiting /
   blocked / done, used everywhere (roster, chat header, floor figure).
6. **Show reassurance first, detail on request.** Motion → hover current action → full step log [S2].
   *Build:* three disclosure levels for activity; the default view never shows raw tool calls.
7. **Shape the answer.** Cards for drafts, files, approvals, forms, routines; prose only when prose
   fits [S2]. *Build:* a typed transcript (message, event, card, question, approval) instead of
   Markdown-only replies.
8. **Events, not dashboards.** Routine created, Bot messaged, handoff made = a one-line event in the
   timeline that expands [S2]. *Build:* the activity feed is *in* the conversation.
9. **Ask less of the person.** They rejected assignment boards, dashboards and handoff buttons
   because each "gave the user more coordination work" [S2]. *Build:* the coordinator (our Boss) routes
   by default; the owner only sees judgement calls.
10. **Come back only for judgement.** "Needs attention" vs "Unread" vs "Working" are distinct [S7]; Bots
    "know when to ping versus keep going" [S1]. *Build:* three attention states with different badges;
    notifications only for needs-attention and done.
11. **Interrupt like a colleague.** A new message mid-task redirects; "Stop now" stops [S8].
    *Build:* the composer is always live during a job; messages are delivered as steering notes
    (SPEC §10.10).
12. **Repeatable work is a sentence.** "Can you do this every morning?" → routine, shown with its next
    run, in the Bot's profile [S2][S14]. *Build:* routines created from chat; listed on the person's
    profile with next run and last result.
13. **Memory is per role; capabilities are shared.** Tools and skills at account level, memory and
    routines on the Bot [S2]. This matches our department/person split.
14. **Small, explicit limits make it calm.** ~50 Bots, 6 per group, 50 routines per Bot, 20 runs kept,
    5-minute minimum interval, 10-minute approval expiry [S2][S14][S15]. *Build:* publish our limits in
    the UI.
15. **Restraint in chrome.** "Much of the design work involved taking things away" — panel controls,
    computer-view options, agent metadata [S2]. *Build:* every new panel must answer the
    delegate-or-manage question.
16. **Warmth through small details.** Character avatars, a wallpaper that follows the time of day,
    voice memos, routines at a human-feeling time (8:41, not 8:00) [S2][M2][S8].

---

## 4. Security and privacy model (foundation, briefly)

| Aspect | Grok Bot | Source |
|---|---|---|
| Where work runs | Cursor-operated cloud VM per user; Bots act **as the signed-in member** | [S16] |
| Isolation | Per user only; Bots share files, browser sessions and CLI credentials; deleting a Bot leaves logins | [S6][S5] |
| Secrets | Human takeover for passwords/2FA/CAPTCHA/payments; masked secret requests "not shown to the model"; Team Bot secrets redacted as `[REDACTED]` in outputs; OAuth tokens never on the computer | [S15][S13][S16] |
| Approvals | Allow once / Always allow / Deny; Auto Review rules (Ask first wins); unattended approvals expire in ~10 min | [S15] |
| Local machine | Separate setting, default **Ask every time** | [S15] |
| Network | Allow-all by default; allowlists are Enterprise only; no DLP hooks | [S16] |
| Data | Cloud storage mandatory (no Legacy Privacy Mode); retention and training opt-out follow Cursor's terms; no SOC 2 / ISO / residency claim in Grok Bot docs at launch | [S15][S10][S15b] |
| Audit | Audit logs and Action Recording (90-day) are Enterprise only and off by default | [S16] |

Criticisms worth remembering: the employee metaphor implies per-teammate boundaries that the
architecture does not provide [S10]; "the person becomes the accountability sink" because the Bot
acts in their session (HN, via [S15b], **unverified**); approval scope is decided by a model [S15b].

Elenta's model (local, no shell, workspace-only writes, every permission logged, per-department
policy) already avoids these. The lesson is about **presentation**: Grok Bot makes approvals feel
like a colleague asking ("show the current value, proposed value and expected impact") [S15], not
like a security prompt.

---

## 5. Adopt / Adapt / Avoid for Elenta Office

### Adopt (take as is)

| What | Why | Fits Elenta at |
|---|---|---|
| **Roster of named teammates as the main navigation**, each row = avatar + name + job chip + latest first-person status | The single biggest reason it feels like teammates, not tools [S2][M1] | Left rail (SPEC §8) becomes a roster, grouped by department |
| **Avatar carries identity and state** (idle / acknowledged / working / waiting / blocked / done) | Presence without extra UI [S2]; we already have status rings on the floor | One avatar component reused in roster, chat, floor |
| **Heterogeneous transcript**: bubbles + one-line events + cards (draft, file, question, approval, routine) | "The form of a response is part of the answer" [S2] | Job view / department thread (Buzz thread) |
| **Inline approval cards** with the action, its inputs and Allow once / Always allow / Deny; expiry for unattended work | Familiar and fast; already planned in FEATURE-PLAN §3 [S15] | Tool gateway (FEATURE-PLAN §2, build step 5) |
| **Teammates introduce themselves and speak first** | Makes a new hire feel alive [M2][M3] | On org load / "hire" approval |
| **Routines from a sentence** ("do this every morning") shown as an event and on the person's profile with next run | Delegation without configuration [S2][S14] | Buzz schedule workflows (FEATURE-PLAN §1) |
| **Three attention states** (needs you / new result / working) and notifications only for the first two | Comes back only for judgement [S7] | Top-bar approvals counter + roster badges |
| **Always-live composer**: send a steer mid-job; "stop" stops | Interrupt like a colleague [S8] | SPEC §10.10 steer and resume |
| **Small published limits** (group size, routines, run history) | Calm, predictable [S2][S14] | Settings and docs |

### Adapt (take the idea, change the shape)

| What | Change for Elenta | Why |
|---|---|---|
| **Group chat of Bots with self-routing** | A department = a group chat (Buzz channel); the lead is the coordinator; the Boss is the owner's **Chief of Staff** who routes across departments and reports back in one thread | Grok's chief-of-staff pattern emerged from users [S2]; our org file already has it |
| **Three levels for the Bot's computer** (status → preview → takeover) | Apply to the **3D floor**: ambient status by default (a small live strip or the avatar), the floor as an optional pinned panel or overview, never the default centre of attention | "The more prominent we made the computer, the more the product encouraged users to supervise it" [S2]. SPEC §8 puts the floor in the centre; with the new north star, conversation should be centre and the floor a glanceable view. **Decision needed.** |
| **Progressive disclosure of activity** | Default: avatar motion + one current-action line on hover; open the job to see tool calls with allowed/refused badges | We keep full audit (SPEC §6), but don't lead with it |
| **Memory per teammate** | Keep SPEC §10.8 personal memory, but let the owner see and edit it from the profile ("What do you remember about me?") | Grok's memory is invisible except by asking [S13]; owners of a security-first tool will want to see it |
| **Teach a task** | Not screen recording (no browser). Instead: "save what we just did as a skill" after an approved job, reviewed as a Markdown note in `library/` | Same benefit, inside our no-browser model [S14] |
| **Team Bots / templates** | Department packages (FEATURE-PLAN §3) previewed as a "Meet your new team" card, like "Meet Your New Bot" | Good onboarding moment [M3] |
| **Voice** | Dictation in the composer first; voice memos from teammates later (local TTS) | Nice, but the network stays limited |
| **Mobile approvals** | Wait for Buzz mobile (FEATURE-PLAN §1), but design approval cards to be phone-sized now | Grok's mobile is mainly approve / answer / review [S9] |

### Avoid

| What | Why |
|---|---|
| **One shared computer/credential pool for all agents** | xAI itself says it is not a security boundary [S6]; our per-job workspaces and per-department policy are the right model |
| **Model-judged approvals as the main gate** | Auto Review is "model-based and should complement, not replace" explicit rules [S15]; keep our deterministic policy, add model review only as advice |
| **"Test run" that does real work** | Criticised [S15b]; our routines should support a draft-only rehearsal |
| **Hidden model routing with no override** | Criticised [S11]; we already plan per-person model tiering (SPEC §10.3), shown on the profile |
| **Endless single thread with no reset** | Reported pain **(unverified)** [S18]; give each teammate a "start fresh" (memory kept, conversation compacted) |
| **Unbounded token burn** | Always-on agents eat budgets [S15b]; our budgets with hard stops (FEATURE-PLAN §2) should be visible on each teammate |
| **Cloud computers, browser takeover, third-party connector catalogues** | Outside Elenta's local, no-shell model (FEATURE-PLAN §3) |

---

## 6. Mobbin references (Grok Bot and comparables)

Grok Bot (iOS) — real screens:

- [M1] Home roster after several Bots: avatars with presence dots, job chips, previews — flow "Completing account set up": https://mobbin.com/flows/498edf36-1e0f-4a2d-88a0-c22c7d7eda64
- [M2] "Chatting with Grok Bot (mentioning a bot)": opening message, connector card, routine event, @Chief of Staff handoff, profile with Character/Instructions/Routines/Notifications: https://mobbin.com/flows/4fb28b2d-90f8-43cf-a2c7-053afe440731 and "Creating a routine": https://mobbin.com/flows/83c1109a-c769-49aa-9d0a-6bba10d28ed0
- [M3] "Adding a bot" ("Meet Your New Bot · Chief of Staff · Start Chat / Create My Own", Bot speaks first): https://mobbin.com/flows/f1a5b515-7abb-4cd8-a993-499bb61e9c0f
- [M4] Profile screen (colour + shape avatar picker) appears in [M2]
- [M5] "Onboarding" (splash, Cursor sign-in, data sharing, "Meet Grok Bot" with composer): https://mobbin.com/flows/64ee69d7-63e5-4aa7-8e0a-c0e304ba777a ; "Meet Grok Bot" screen: https://mobbin.com/screens/93b94f55-5fb2-4d2a-8a18-6264cb455548 ; paywall "Grok Bot requires an Ultra subscription": https://mobbin.com/flows/008dcebb-3cdf-4142-b8af-b6a173bffebf

Mobbin had no Grok Bot desktop screens and no Grok Bot approval-card or computer-view screens at the
time of writing; desktop details above come from the design essay [S2] and docs.

Comparables (form-first or chat-first agent products):

- [M6] Mistral — form-based agent builder (model, temperature, system prompt): https://mobbin.com/flows/8d58b223-ebe8-4f95-9c57-3de32e8baeab
- [M7] ElevenLabs — template grid, then a long settings page: https://mobbin.com/flows/30b06265-b521-4f96-b487-4626729caa98
- [M8] Tana — agent created through chat; agent profile with "Work done by this agent / Latest chats / Voice sessions": https://mobbin.com/flows/b337a339-9300-49d1-affc-2b6f6efb2feb ; capabilities screen: https://mobbin.com/screens/bfbd6b4f-8a99-4a0f-8abd-752ad8b7707c
- [M9] Higgsfield — sidebar chat marked **"Needs approval"**; inline "Approve create employee" card with Always allow / Stop / Approve: https://mobbin.com/screens/f0ee7046-b34e-415a-a830-564baf6f902d
- [M10] Gumloop — "Pending Approval" sidebar section; inline "Asking for your input" question card with options, Reject / Submit: https://mobbin.com/screens/a0c0e7b0-88bb-4a89-904a-d88ee892a8dd
- [M11] Microsoft Copilot — "I'm working on this research" progress card with current source and Cancel: https://mobbin.com/screens/c2cad8e4-77eb-4cd8-ae5e-26748339323c
- [M12] Devin — session list with per-session status ("PR is ready"): https://mobbin.com/screens/18d1bd78-44e9-45b6-bd04-ac48dbf7244a

---

## 7. Open questions / not verified

- Bloomberg's 410k weekly users figure (seen only via [S18]).
- The Hacker News and Reddit quotes (seen only via [S15b]; I could not find the threads).
- Whether "new chat"/context reset has since shipped (forum report via [S18], early Sept).
- Exact date access widened beyond the top tiers (26 Aug per [S18]; [S11b] says "later").
- Grok Bot desktop approval-card and computer-panel visuals: described from text only.

---

## Sources

Primary (xAI / SpaceXAI / Cursor):

- [S1] Introducing Grok Bot, 11 Aug 2026 — https://x.ai/news/introducing-grok-bot
- [S2] Designing Grok Bot for a world of persistent agents, 3 Sep 2026 — https://x.ai/news/designing-grok-bot
- [S3] Docs: Overview — https://docs.x.ai/grok-bot/overview
- [S4] Docs: Get started — https://docs.x.ai/grok-bot/get-started
- [S5] Docs: Create and manage Bots — https://docs.x.ai/grok-bot/bots
- [S6] Docs: Use the computer and apps — https://docs.x.ai/grok-bot/computer-and-apps
- [S7] Docs: Settings and notifications — https://docs.x.ai/grok-bot/settings-and-notifications
- [S8] Docs: Message and collaborate — https://docs.x.ai/grok-bot/chat-and-collaboration
- [S9] Docs: Grok Bot for Mobile — https://docs.x.ai/grok-bot/mobile
- [S12] Team Bots launch post, 28 Sep 2026 — https://x.ai/news/team-bots
- [S13] Docs: Team Bots — https://docs.x.ai/grok-bot/team-bots ; Use cases — https://docs.x.ai/grok-bot/use-cases
- [S14] Docs: Skills and routines — https://docs.x.ai/grok-bot/skills-routines-and-automations
- [S15] Docs: Approvals, security, and privacy — https://docs.x.ai/grok-bot/approvals-security-and-privacy ; FAQ — https://docs.x.ai/grok-bot/faq
- [S16] Docs: Security — https://docs.x.ai/grok-bot/security
- [S17] Docs: Tag @bot on X — https://docs.x.ai/grok-bot/tag-on-x
- [S19] Cursor Help: Grok Bot plans and billing — https://cursor.com/help/grok-bot/plans
- [S21] Docs: Files and results — https://docs.x.ai/grok-bot/files-and-results

Secondary:

- [S10] Digital Applied, launch analysis (marketing vs docs, pricing, credentials) — https://www.digitalapplied.com/blog/grok-bot-ai-teammates-launch-cloud-computer-2026
- [S11] Beam, enterprise take (cites VentureBeat on the router) — https://beam.ai/agentic-insights/grok-bot-enterprise-ai-agents ; [S11b] AlphaSignal on Team Bots — https://alphasignal.ai/news/xai-s-grok-team-bots-give-entire-teams-one-shared-ai-agent
- [S15b] eesel, "Grok Bot review: what actually ships in the early beta" (vendor with a competing product) — https://www.eesel.ai/blog/grok-bot-review
- [S18] Riven (rar.design), design analysis of the official essay, in Chinese — https://rar.design/posts/grok-bot-agent-interface-design
- [S20] "How we built Grok Bot in a month", Roman Ugarte talk summary — https://videohighlight.com/v/maSdsTLaMuU
- [S22] Layer3 Labs review — https://www.layer3labs.io/guides/grok-bot-review
- [S23] Composio guide (swarm hitting weekly limit) — https://composio.dev/content/guide-to-frok-bot
- Also read: Unite.AI launch report — https://www.unite.ai/xai-launches-grok-bot-always-on-ai-teammates-with-their-own-cloud-computers/ ; CellCog on Team Bots (competitor) — https://cellcog.ai/blog/grok-team-bots/

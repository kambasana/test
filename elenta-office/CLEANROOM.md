# Clean-room record

Elenta Office is a new product. It is not derived from "Agents Office" (Sahni.ai, PolyForm
Noncommercial 1.0.0 with additional terms), whose licence does not allow renaming, rebranding or
commercial use without permission.

## How it was built

1. **Specification.** `SPEC.md` was written by the reviewing session. It describes behaviour, ideas and
   a new visual design in fresh wording. It contains no source code, text, data, names, layouts,
   colours or assets from Agents Office. Multi-agent "virtual office" and
   "virtual company" designs (role-based agent teams, managers that delegate, a shared memory, a
   visual world the agents work in) are common, published patterns, e.g. ChatDev, MetaGPT and the
   Generative Agents town (Park et al., 2023). Elenta Office uses those general ideas. Its own design
   (domain departments with sub-teams, Boss routing, whole-department team jobs, ACP-based runs with
   a client-side permission policy, approval-gated deliverables, audit log, wings, sandbox kit, and
   its visual identity) was designed in this project.
2. **Implementation.** The code was written by separate implementation agents that were given only
   `SPEC.md`, public documentation (Node.js, three.js, Agent Client Protocol, Claude Code) and public
   packages. They were instructed not to open the Agents Office repository, its local clone, any
   patch against it, or any screenshot or design board of it, and to record any doubt here.
3. **Review.** Before release, compare the new code against Agents Office for copied code or text
   (e.g. a similarity scan) and record the result below.

## Log

| Date | Step | Who | Notes |
|---|---|---|---|
| 2026-10-07 | Spec written | reviewing session | SPEC.md v1 |
| 2026-10-07 | Backend implemented | backend implementation agent | Built server/ (Node 22 built-ins only: settings, org validation, library index + lessons, job engine with persisted states, ACP runner spawning claude-agent-acp with terminal:false, a tools whitelist, settingSources [] and a client-side permission policy, fs handlers with realpath containment, audit log, HTTP API + SSE with Host/Origin/JSON/size guards and CSP, wings, floor layout), orgs/elenta.json, 10 library notes, docker/ (sbx script + hardened compose), test/ (39 node:test unit tests, live run passed against real Claude) and README.md. Sources used: SPEC.md, Node.js docs, ACP docs and the installed Apache-2.0 adapter package in node_modules. The rules were followed: nothing under the excluded paths was opened, and there were no searches for the excluded product or author. docs.docker.com was blocked by the network proxy, so the sbx sub-command names were written from general knowledge and need checking against `sbx --help`. |

This record is not legal advice. Have a lawyer review it before commercial use.

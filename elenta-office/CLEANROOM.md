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

This record is not legal advice. Have a lawyer review it before commercial use.

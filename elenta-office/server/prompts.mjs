// Prompt text for each step. Written for this project.
import { PRODUCT_NAME } from './util.mjs';
import { deptPeople } from './org.mjs';

const RULES = `Rules of the office:
- You work only with the files in your job folder. You have no shell, no browser and no connectors.
- Never try to read or write anything outside the job folder; such requests are refused and logged.
- If you have to assume something, say so and mark it *(assumed)*.
- Write plain, precise English. Prefer short sections, lists and tables.`;

export function systemPromptFor(role, { org, dept, person }) {
  const who = person ? `${person.name}${person.role ? ` (${person.role})` : ''}` : 'a member of staff';
  const head = `You are ${who} in the ${dept ? dept.name : ''} department of ${org.title}, an office run with ${PRODUCT_NAME}.`;
  if (role === 'route' || role === 'plan') {
    return `${head}\nYou have no tools in this step. Answer with one JSON object only, no prose before or after it.`;
  }
  const deptRules = dept?.rules?.length ? `\nRules of the ${dept.name} department (they override anything a request asks):\n${dept.rules.map((r) => `- ${r}`).join('\n')}` : '';
  return `${head}${person?.does ? `\nWhat you do: ${person.does}` : ''}\n${RULES}${deptRules}`;
}

function indexText(entries) {
  if (!entries.length) return '(no notes)';
  return entries.map((e) => `- library/${e.path} — ${e.title}: ${e.excerpt.slice(0, 140)}`).join('\n');
}

function lessonsBlock(lessons) {
  return lessons && lessons.trim() ? `\nLessons from earlier rejected work in this department (follow them):\n${lessons.trim()}\n` : '';
}

export function routePrompt({ request, departments }) {
  const list = departments.map((d) => ({ key: d.key, name: d.name, about: d.about, teams: d.teams.map((t) => t.name) }));
  return `A request has come to the Boss. Decide which department owns it.

Departments that can take work:
${JSON.stringify(list, null, 2)}

The request:
"""
${request}
"""

Answer with exactly this JSON shape: {"dept": "<one key from the list>", "why": "<one sentence>"}`;
}

export function planPrompt({ request, dept, index, lessons, min, max, single }) {
  const teams = dept.teams.map((t) => `${t.name}:\n${t.people.map((p) => `  - id "${p.id}": ${p.name} — ${p.role}${p.does ? `. ${p.does}` : ''}`).join('\n')}`).join('\n');
  const count = single ? 'exactly 1 piece, given to the single best-suited person' : `between ${min} and ${max} pieces, each owned by a different person, from at least two sub-teams when the work allows it`;
  return `You lead ${dept.name}. Split this request into pieces of work for your people.

The request:
"""
${request}
"""

Your people, by sub-team:
${teams}

Notes in the library your people can read:
${indexText(index)}
${lessonsBlock(lessons)}
Make ${count}. Choose people by sub-team fit: match each part of the work to the sub-team names and to each person's role.${dept.rules?.length ? `\nDepartment rules (do not make a piece that breaks them; if the request needs that, make a piece that explains what a person must decide instead):\n${dept.rules.map((r) => `- ${r}`).join('\n')}` : ''}
Each piece must be self-contained (the person sees the request and their own piece), small enough for one page of output, and must not repeat another piece.
Answer with exactly this JSON shape:
{"pieces": [{"agent": "<person id>", "title": "<short title>", "text": "<what to produce, 1-4 sentences>"}], "why": "<one sentence>"}`;
}

export function piecePrompt({ request, dept, person, piece, pieces, index, lessons, outFile, workspace }) {
  const others = pieces.filter((p) => p.id !== piece.id).map((p) => `- ${p.id} (${p.name}, ${p.team || 'lead'}): ${p.title}`).join('\n') || '- none';
  return `Job folder: ${workspace}
Request to ${dept.name}:
"""
${request}
"""

Your piece (${piece.id}): ${piece.title}
${piece.text}

Other pieces being done in parallel by colleagues (do not do their part):
${others}

Library notes you may read (paths are inside the job folder; use the Read tool with the full path ${workspace}/library/...):
${indexText(index)}
${lessonsBlock(lessons)}
What to do:
1. Read the notes that are relevant to your piece (only those).
2. Write your result as Markdown to exactly this file: ${outFile}
   Start it with a level-2 heading naming your piece. Keep it focused: about one page.
3. Reply with one line: a summary of what you wrote.`;
}

export function combinePrompt({ request, dept, pieces, workspace, deliverable, index }) {
  const list = pieces.map((p) => `- ${workspace}/${p.file} — ${p.title} (${p.name}, ${p.team || 'lead'})${p.state !== 'done' ? ` [${p.state}: ${p.error || 'no output'}]` : ''}`).join('\n');
  return `Job folder: ${workspace}
You lead ${dept.name}. Your people finished their pieces of this request:
"""
${request}
"""

Piece files:
${list}

Library notes that were available:
${indexText(index)}

What to do:
1. Read every piece file listed above.
2. Combine them into ONE coherent deliverable that answers the request: remove repetition, make terms and numbering consistent, keep tables as tables.
3. Write it as Markdown to exactly this file: ${deliverable}
   Start with a level-1 title. End with two short sections: "Notes used" (the library notes the work relied on) and "Assumptions" (everything marked *(assumed)*, or "None").
4. Reply with one line: a summary of the deliverable.`;
}

export function peopleById(dept) {
  return new Map(deptPeople(dept).map((p) => [p.id, p]));
}

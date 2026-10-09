// Department packages (SPEC §11). One department = one Open Plugin Spec package in the Buzz
// persona-pack layout, so Buzz (`buzz pack validate`) and other OPS tools can read our teams:
//
//   <pack>/.plugin/plugin.json      OPS manifest + Buzz fields (personas, pack_instructions, defaults)
//   <pack>/agents/<id>.persona.md   one person: Buzz frontmatter only (Buzz rejects unknown keys there)
//   <pack>/instructions.md          department-wide instructions
//   <pack>/elenta/department.json   our structure: sub-teams, lead, colour, "does" (ignored by others)
//
// A plain Buzz pack with no elenta/department.json also imports: the first persona leads, the
// rest form one sub-team. Packs are data only: hooks are never run, MCP servers are never started
// (they become connector requests that need a grant), skills are listed for review, models ignored.
import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, normalize, isAbsolute, sep } from 'node:path';
import { slugify } from './util.mjs';

export const OPS_SCHEMA = 'https://open-plugin-spec.org/schema/v1/plugin.json';
export const DEPT_SCHEMA = 'elenta-department/1';
const MAX_FILE = 64 * 1024;
const MAX_PERSONAS = 120;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

// ── YAML frontmatter ────────────────────────────────────────────────────────────────────────────
// We write frontmatter with JSON-quoted values (valid YAML). For reading other people's packs we
// accept the subset persona files use: scalars, inline [lists], block "- item" lists and one level
// of nested "key: value" maps. Anything deeper is kept as a marker so we can report it.

const q = (v) => JSON.stringify(v);

function scalar(text) {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('"')) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('[') && t.endsWith(']')) {
    try { return JSON.parse(t); } catch {
      return t.slice(1, -1).split(',').map((s) => scalar(s)).filter((s) => s !== null);
    }
  }
  if (t.startsWith('{')) { try { return JSON.parse(t); } catch { return { complex: true }; } }
  return t.replace(/\s+#.*$/, '');
}

const indentOf = (line) => line.length - line.trimStart().length;

/** Parse the frontmatter subset described above. Returns a plain object. */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (indentOf(line) !== 0) { i++; continue; }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const [, key, rest] = m;
    i++;
    if (rest.trim() && rest.trim() !== '|' && rest.trim() !== '>') { out[key] = scalar(rest); continue; }
    const block = [];
    while (i < lines.length && indentOf(lines[i]) > 0) block.push(lines[i++]);
    if (!block.length) { out[key] = null; continue; }
    const base = indentOf(block[0]);
    if (rest.trim() === '|' || rest.trim() === '>') { out[key] = block.map((l) => l.slice(base)).join(rest.trim() === '|' ? '\n' : ' '); continue; }
    if (block[0].trimStart().startsWith('- ')) {
      const items = [];
      for (const l of block) {
        const kv = (t) => /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(t.trim());
        if (indentOf(l) === base && l.trimStart().startsWith('- ')) {
          const v = l.trimStart().slice(2);
          const m2 = kv(v);
          items.push(m2 ? { [m2[1]]: m2[2].trim() ? scalar(m2[2]) : null } : scalar(v));
        } else if (indentOf(l) > base && items.length && items.at(-1) && typeof items.at(-1) === 'object') {
          const m2 = kv(l);
          if (m2) items.at(-1)[m2[1]] = m2[2].trim() ? scalar(m2[2]) : null;
        }
      }
      out[key] = items;
      continue;
    }
    const map = {};
    for (const l of block) {
      if (indentOf(l) !== base) { map.complex = true; continue; }
      const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l.trim());
      if (mm) map[mm[1]] = mm[2].trim() ? scalar(mm[2]) : null;
    }
    out[key] = map;
  }
  return out;
}

/** Split a .persona.md file into frontmatter and body (Buzz rule: starts with ---, closing --- on its own line). */
export function splitPersona(text) {
  const s = text.replace(/^﻿/, '');
  if (!s.startsWith('---\n') && !s.startsWith('---\r\n')) return null;
  const m = /\r?\n---[ \t]*(\r?\n|$)/.exec(s.slice(3));
  if (!m) return null;
  const fm = s.slice(4, 3 + m.index);
  const body = s.slice(3 + m.index + m[0].length);
  return { front: parseFrontmatter(fm), body: body.trim() };
}

// ── Export ──────────────────────────────────────────────────────────────────────────────────────

const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function personaFile(p, dept, { lead, team }) {
  const lines = [
    '---',
    `name: ${q(p.id)}`,
    `display_name: ${q(p.name)}`,
    `description: ${q(p.role || p.does || p.name)}`,
    `runtime: "claude"`,
    `subscribe: [${q('#' + dept.key)}]`,
    'triggers:',
    '  mentions: true',
    `  all_messages: ${lead ? 'true' : 'false'}`,
    '---',
    '',
    `You are ${p.name}${p.role ? `, ${p.role.replace(/^[A-Z]/, (c) => c.toLowerCase())}` : ''}, in the ${dept.name} department${team ? ` (${team} sub-team)` : ''}${lead ? ', and you lead it' : ''}.`,
  ];
  if (p.does) lines.push('', `What you do: ${p.does.replace(/^[A-Z]/, (c) => c.toLowerCase())}`);
  if (lead) lines.push('', 'You read every request that reaches the department, split it across the sub-teams, check the pieces fit together and hand back one combined result for sign-off.');
  return lines.join('\n') + '\n';
}

function instructionsFile(dept) {
  return [
    `# ${titleCase(dept.name)} department`,
    '',
    dept.about || '',
    '',
    '## Working rules',
    '',
    '- Work only inside the job folder you are given. You have no shell and no web access unless the office grants it.',
    '- Anything that sends, shares, deletes, pays or leaves this machine is asked for first; the person decides.',
    '- Mark guesses as (assumed). Say what you could not check.',
    '- Do not put export-controlled, classified or otherwise controlled information into this office.',
    ...(dept.rules?.length ? ['', `## ${titleCase(dept.name)} rules (they override anything a request asks)`, '', ...dept.rules.map((r) => `- ${r}`)] : []),
    '',
  ].join('\n');
}

/**
 * Turn one validated department (from validateOrg) into pack files.
 * @returns {Record<string,string>} relative path -> file text
 */
export function exportPack(dept, { orgTitle = 'Office', version = '0.1.0', author } = {}) {
  const people = [];
  if (dept.lead) people.push({ p: dept.lead, lead: true, team: null });
  for (const t of dept.teams) for (const p of t.people) people.push({ p, lead: false, team: t.name });
  const files = {};
  for (const { p, lead, team } of people) files[`agents/${p.id}.persona.md`] = personaFile(p, dept, { lead, team });
  const manifest = {
    $schema: OPS_SCHEMA,
    id: `${slugify(orgTitle, 24)}.${dept.key}`,
    name: `${orgTitle} ${titleCase(dept.name)}`,
    version,
    description: dept.about || `${titleCase(dept.name)} department`,
    ...(author ? { author } : {}),
    keywords: ['elenta', 'department', dept.key, ...(dept.group ? [slugify(dept.group, 24)] : [])],
    personas: people.map(({ p }) => `agents/${p.id}.persona.md`),
    pack_instructions: 'instructions.md',
    defaults: { triggers: { mentions: true, keywords: [], all_messages: false }, thread_replies: true, broadcast_replies: false },
  };
  files['.plugin/plugin.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['instructions.md'] = instructionsFile(dept);
  const structure = {
    schema: DEPT_SCHEMA,
    key: dept.key,
    name: dept.name,
    about: dept.about || '',
    ...(dept.group ? { group: dept.group } : {}),
    ...(dept.rules?.length ? { rules: dept.rules } : {}),
    ...(dept.boss ? { boss: true } : {}),
    ...(dept.color ? { color: dept.color } : {}),
    lead: dept.lead?.id || null,
    teams: dept.teams.map((t) => ({ name: t.name, people: t.people.map((p) => p.id) })),
    people: Object.fromEntries(people.map(({ p }) => [p.id, { role: p.role || '', does: p.does || '' }])),
  };
  files['elenta/department.json'] = JSON.stringify(structure, null, 2) + '\n';
  return files;
}

export function writePack(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────

/** A pack-relative path we are willing to open: relative, no "..", stays inside the pack. */
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || rel.includes('\0')) return false;
  const n = normalize(rel);
  return !(n === '..' || n.startsWith('..' + sep) || n.split(/[\\/]/).includes('..'));
}

function readSmall(dir, rel, problems, what) {
  const path = join(dir, rel);
  let st;
  try { st = statSync(path); } catch { problems.push(`${what} ${rel} is missing.`); return null; }
  if (!st.isFile()) { problems.push(`${what} ${rel} is not a file.`); return null; }
  if (st.size > MAX_FILE) { problems.push(`${what} ${rel} is larger than ${MAX_FILE / 1024} KB.`); return null; }
  return readFileSync(path, 'utf8');
}

const toId = (name) => String(name || '').toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 48).replace(/-+$/, '');

/**
 * Read a pack folder into a raw department (the shape validateOrg accepts) plus a review report.
 * Never executes anything from the pack.
 * @returns {{ department: object|null, problems: string[], warnings: string[], review: object }}
 */
export function readPack(dir, { keyHint } = {}) {
  const problems = [];
  const warnings = [];
  const review = { id: null, name: null, version: null, people: [], skills: [], connectorRequests: [], hooksIgnored: false, modelsIgnored: [] };
  const fail = () => ({ department: null, problems, warnings, review });

  const mtext = readSmall(dir, '.plugin/plugin.json', problems, 'The manifest');
  if (mtext == null) return fail();
  let manifest;
  try { manifest = JSON.parse(mtext); } catch (err) { problems.push(`The manifest is not valid JSON (${err.message}).`); return fail(); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) { problems.push('The manifest must be a JSON object.'); return fail(); }
  for (const f of ['id', 'name', 'version']) if (typeof manifest[f] !== 'string' || !manifest[f].trim()) problems.push(`The manifest needs "${f}".`);
  review.id = manifest.id ?? null; review.name = manifest.name ?? null; review.version = manifest.version ?? null;
  const personas = Array.isArray(manifest.personas) ? manifest.personas : [];
  if (!personas.length) problems.push('The manifest lists no personas.');
  if (personas.length > MAX_PERSONAS) problems.push(`The pack has ${personas.length} personas; a department holds at most ${MAX_PERSONAS}.`);
  if (manifest.hooks_config) { review.hooksIgnored = true; warnings.push('The pack has hooks; Elenta never runs pack code, so they were ignored.'); }
  if (manifest.mcp_config) {
    if (!safeRel(manifest.mcp_config)) problems.push(`The MCP config path "${manifest.mcp_config}" leaves the pack.`);
    else {
      const t = existsSync(join(dir, manifest.mcp_config)) ? readSmall(dir, manifest.mcp_config, problems, 'The MCP config') : null;
      let servers = {};
      try { servers = t ? (JSON.parse(t).mcpServers || {}) : {}; } catch { warnings.push('The MCP config is not valid JSON; it was ignored.'); }
      for (const name of Object.keys(servers)) review.connectorRequests.push({ name, for: 'whole department' });
    }
  }
  if (problems.length) return fail();

  const loaded = [];
  for (const rel of personas) {
    if (!safeRel(rel) || !rel.endsWith('.persona.md')) { problems.push(`The persona path "${rel}" is not a .persona.md file inside the pack.`); continue; }
    const text = readSmall(dir, rel, problems, 'The persona file');
    if (text == null) continue;
    const parsed = splitPersona(text);
    if (!parsed) { problems.push(`${rel} has no --- frontmatter.`); continue; }
    const { front, body } = parsed;
    for (const f of ['name', 'display_name', 'description']) if (typeof front[f] !== 'string' || !front[f].trim()) problems.push(`${rel} needs "${f}".`);
    const id = toId(front.name);
    if (front.name && !ID_RE.test(id)) problems.push(`${rel} has name "${front.name}", which does not make a usable id.`);
    if (Array.isArray(front.mcp_servers)) for (const s of front.mcp_servers) review.connectorRequests.push({ name: s?.name || '(unnamed server)', for: id });
    if (front.hooks) { review.hooksIgnored = true; warnings.push(`${rel} has hooks; they were ignored.`); }
    if (Array.isArray(front.skills)) for (const s of front.skills) review.skills.push({ path: String(s), for: id });
    if (front.model) review.modelsIgnored.push(id);
    loaded.push({ rel, id, displayName: String(front.display_name || '').trim(), description: String(front.description || '').trim(), body });
  }
  if (review.modelsIgnored.length) warnings.push(`Models named in the pack were ignored (${review.modelsIgnored.join(', ')}); the office chooses models.`);
  if (review.connectorRequests.length) warnings.push(`The pack asks for ${review.connectorRequests.length} MCP server(s); none are started until you grant them as connectors.`);
  const seen = new Set();
  for (const p of loaded) { if (seen.has(p.id)) problems.push(`Two personas share the id "${p.id}".`); seen.add(p.id); }
  if (problems.length) return fail();

  const byId = new Map(loaded.map((p) => [p.id, p]));
  let structure = null;
  if (existsSync(join(dir, 'elenta', 'department.json'))) {
    const t = readSmall(dir, 'elenta/department.json', problems, 'The department file');
    try { structure = t ? JSON.parse(t) : null; } catch (err) { problems.push(`elenta/department.json is not valid JSON (${err.message}).`); }
    if (structure && structure.schema !== DEPT_SCHEMA) problems.push(`elenta/department.json has schema "${structure.schema}"; expected "${DEPT_SCHEMA}".`);
    if (problems.length) return fail();
  }

  const fitName = (s) => {
    const n = String(s || '').toUpperCase().trim();
    if (n.length <= 32) return n;
    warnings.push(`The name "${n}" was shortened to 32 characters.`);
    return n.slice(0, 32).trim();
  };
  const person = (id) => {
    const p = byId.get(id);
    const extra = structure?.people?.[id] || {};
    review.people.push(id);
    return { id, name: fitName(p.displayName), role: String(extra.role ?? p.description).slice(0, 80), does: String(extra.does ?? '').slice(0, 400) || undefined };
  };

  let department;
  if (structure) {
    const listed = [structure.lead, ...(structure.teams || []).flatMap((t) => t.people || [])].filter(Boolean);
    for (const id of listed) if (!byId.has(id)) problems.push(`elenta/department.json names "${id}", who is not one of the pack's personas.`);
    const unplaced = loaded.filter((p) => !listed.includes(p.id)).map((p) => p.id);
    if (unplaced.length) warnings.push(`Personas not placed in a sub-team were left out: ${unplaced.join(', ')}.`);
    if (problems.length) return fail();
    department = {
      key: structure.key, name: structure.name, about: structure.about || '',
      ...(structure.group ? { group: structure.group } : {}),
      ...(Array.isArray(structure.rules) ? { rules: structure.rules } : {}),
      ...(structure.boss ? { boss: true } : {}), ...(structure.color ? { color: structure.color } : {}),
      lead: structure.lead ? person(structure.lead) : undefined,
      teams: (structure.teams || []).map((t) => ({ name: t.name, people: (t.people || []).map(person) })),
    };
  } else {
    // A plain Buzz persona pack: first persona leads, the rest form one sub-team.
    const key = keyHint || slugify(String(manifest.name || manifest.id).split(/[.\s]/).pop(), 24).replace(/^[^a-z]+/, '') || 'imported';
    const [first, ...rest] = loaded;
    department = {
      key, name: titleCase(manifest.name).toUpperCase().slice(0, 32), about: String(manifest.description || '').slice(0, 400),
      lead: person(first.id),
      teams: rest.length ? [{ name: 'TEAM', people: rest.map((p) => person(p.id)) }] : [],
    };
    warnings.push(`The pack has no elenta/department.json; ${first.id} was made the lead and everyone else one sub-team.`);
  }
  return { department, problems, warnings, review };
}

// Org file loading and validation (SPEC §2). Problems are reported as sentences; an org with any
// structural problem is not applied at all.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { slugify } from './util.mjs';
import { readPack } from './pack.mjs';

/** Eight muted hues that read well on the dark background. */
export const PALETTE = ['#C9A227', '#5B8DEF', '#3FB68B', '#D9738F', '#9B7FE6', '#E08A4F', '#4FB3C8', '#A3B04A'];

const KEY_RE = /^[a-z][a-z0-9-]{0,23}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LIMITS = { departments: 12, perDept: 120, total: 350, rules: 12, rule: 240, group: 32, name: 32, role: 80, does: 400, about: 400, title: 60 };

function str(v) { return typeof v === 'string' ? v.trim() : ''; }

/**
 * @param {any} raw parsed org JSON
 * @param {{ deptSettings?: Record<string,{on?:boolean}> }} [opts]
 * @returns {{ org: object|null, problems: string[], warnings: string[] }}
 */
export function validateOrg(raw, { deptSettings = {} } = {}) {
  const problems = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { org: null, problems: ['The org file must hold a JSON object with "title" and "departments".'], warnings };
  }
  const title = str(raw.title);
  if (!title) problems.push('The org needs a "title".');
  else if (title.length > LIMITS.title) problems.push(`The org title is longer than ${LIMITS.title} characters.`);
  const depsIn = raw.departments;
  if (!Array.isArray(depsIn) || depsIn.length < 1) {
    problems.push('The org needs a "departments" list with at least one department.');
    return { org: null, problems, warnings };
  }
  if (depsIn.length > LIMITS.departments) problems.push(`The org has ${depsIn.length} departments; the most allowed is ${LIMITS.departments}.`);

  const keys = new Set();
  const ids = new Map(); // id -> where
  let bosses = 0;
  let total = 0;
  const departments = [];

  const person = (p, dept, where, generatedIds) => {
    if (!p || typeof p !== 'object') { problems.push(`${where} must be an object with at least a "name".`); return null; }
    const name = str(p.name).toUpperCase();
    if (!name) problems.push(`${where} has no name.`);
    else if (name.length > LIMITS.name) problems.push(`${where} name "${name}" is longer than ${LIMITS.name} characters.`);
    const role = str(p.role);
    if (role.length > LIMITS.role) problems.push(`${where} (${name || 'unnamed'}) has a role longer than ${LIMITS.role} characters.`);
    const does = str(p.does);
    if (does.length > LIMITS.does) problems.push(`${where} (${name || 'unnamed'}) has a "does" text longer than ${LIMITS.does} characters.`);
    let id;
    if (p.id !== undefined) {
      id = str(p.id);
      if (!ID_RE.test(id)) problems.push(`${where} (${name || 'unnamed'}) has id "${id}"; ids use lower-case letters, digits and dashes (max 48).`);
    } else {
      const base = `${dept}-${slugify(name, 40)}`.slice(0, 48).replace(/-+$/, '');
      id = base;
      for (let n = 2; ids.has(id) || generatedIds.has(id); n++) id = `${base}-${n}`;
      generatedIds.add(id);
    }
    if (ids.has(id)) problems.push(`The id "${id}" is used twice (${ids.get(id)} and ${where}); ids must be unique across the org.`);
    else ids.set(id, where);
    total++;
    return { id, name, role, does };
  };

  depsIn.forEach((d, i) => {
    const where = `Department ${i + 1}`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) { problems.push(`${where} must be an object.`); return; }
    const key = str(d.key);
    if (!KEY_RE.test(key)) problems.push(`${where} has key "${key}"; a key is lower-case letters, digits and dashes, starts with a letter, max 24 characters.`);
    else if (keys.has(key)) problems.push(`The department key "${key}" is used twice.`);
    keys.add(key);
    const dw = key ? `Department "${key}"` : where;
    const name = (str(d.name) || key).toUpperCase();
    if (name.length > LIMITS.name) problems.push(`${dw} name is longer than ${LIMITS.name} characters.`);
    const about = str(d.about);
    if (about.length > LIMITS.about) problems.push(`${dw} "about" is longer than ${LIMITS.about} characters.`);
    let group = '';
    if (d.group !== undefined) {
      group = str(d.group);
      if (group.length > LIMITS.group) problems.push(`${dw} "group" is longer than ${LIMITS.group} characters.`);
    }
    const rules = [];
    if (d.rules !== undefined) {
      if (!Array.isArray(d.rules) || d.rules.some((r) => typeof r !== 'string' || !r.trim())) problems.push(`${dw} "rules" must be a list of sentences.`);
      else if (d.rules.length > LIMITS.rules) problems.push(`${dw} has ${d.rules.length} rules; the most allowed is ${LIMITS.rules}.`);
      else for (const r of d.rules) { if (r.trim().length > LIMITS.rule) problems.push(`${dw} has a rule longer than ${LIMITS.rule} characters.`); rules.push(r.trim()); }
    }
    const boss = d.boss === true;
    if (boss) bosses++;
    let color = null;
    if (d.color !== undefined) {
      if (typeof d.color === 'string' && COLOR_RE.test(d.color)) color = d.color.toUpperCase();
      else problems.push(`${dw} color must look like #rrggbb.`);
    }
    const generatedIds = new Set();
    const before = total;
    if (!d.lead) problems.push(`${dw} needs a "lead".`);
    const lead = d.lead ? person(d.lead, key, `${dw} lead`, generatedIds) : null;
    const teams = [];
    if (d.teams !== undefined && !Array.isArray(d.teams)) problems.push(`${dw} "teams" must be a list.`);
    const teamNames = new Set();
    (Array.isArray(d.teams) ? d.teams : []).forEach((t, j) => {
      const tw = `${dw} team ${j + 1}`;
      if (!t || typeof t !== 'object') { problems.push(`${tw} must be an object.`); return; }
      const tname = str(t.name).toUpperCase();
      if (!tname) problems.push(`${tw} has no name.`);
      else if (tname.length > LIMITS.name) problems.push(`${tw} name is longer than ${LIMITS.name} characters.`);
      if (teamNames.has(tname)) problems.push(`${dw} has two teams called "${tname}".`);
      teamNames.add(tname);
      if (!Array.isArray(t.people) || t.people.length === 0) { problems.push(`${tw} (${tname || 'unnamed'}) needs at least one person.`); return; }
      const people = t.people.map((p, k) => person(p, key, `${dw} team ${tname || j + 1} person ${k + 1}`, generatedIds)).filter(Boolean);
      teams.push({ name: tname, people });
    });
    const count = total - before;
    if (count > LIMITS.perDept) problems.push(`${dw} has ${count} people; the most allowed is ${LIMITS.perDept}.`);
    departments.push({ key, name, about, group, rules, boss, color, on: true, lead, teams });
  });

  if (bosses > 1) problems.push(`Only one department may be the boss; ${bosses} are marked "boss": true.`);
  if (total > LIMITS.total) problems.push(`The org has ${total} people; the most allowed is ${LIMITS.total}.`);
  if (problems.length) return { org: null, problems, warnings };

  // Colours: explicit first, the rest from the palette in order.
  const used = new Set(departments.map((d) => d.color).filter(Boolean));
  const free = PALETTE.filter((c) => !used.has(c));
  let pi = 0;
  for (const d of departments) if (!d.color) d.color = (free.length ? free : PALETTE)[pi++ % (free.length || PALETTE.length)];

  // On/off from settings.
  const known = new Set(departments.map((d) => d.key));
  for (const [k, v] of Object.entries(deptSettings || {})) {
    if (!known.has(k)) { warnings.push(`Settings mention a department "${k}" that is not in the org; it was ignored.`); continue; }
    if (v && v.on === false) departments.find((d) => d.key === k).on = false;
  }
  if (!departments.some((d) => d.on)) {
    warnings.push('Settings switched every department off; at least one must stay on, so all were left on.');
    for (const d of departments) d.on = true;
  }
  return { org: { title, departments }, problems, warnings };
}

export function loadOrg(path, opts) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (err) {
    return { org: null, problems: [`Could not read the org file ${path}: ${err.message}.`], warnings: [] };
  }
  // A department may be given as { "pack": "<folder>" }: an Open Plugin Spec department package
  // (SPEC §11), resolved relative to the org file. The org file is the owner's, so it stays on.
  if (raw && Array.isArray(raw.departments)) {
    const problems = [];
    const warnings = [];
    raw = { ...raw, departments: raw.departments.map((d, i) => {
      if (!d || typeof d !== 'object' || typeof d.pack !== 'string') return d;
      const r = readPack(resolve(dirname(path), d.pack));
      problems.push(...r.problems.map((m) => `Department ${i + 1} (pack ${d.pack}): ${m}`));
      warnings.push(...r.warnings.map((m) => `Pack ${d.pack}: ${m}`));
      return r.department ? { ...r.department, ...(d.color ? { color: d.color } : {}) } : d;
    }) };
    if (problems.length) return { org: null, problems, warnings };
    const out = validateOrg(raw, opts);
    return { ...out, warnings: [...warnings, ...out.warnings] };
  }
  return validateOrg(raw, opts);
}

/** Everyone in a department (lead first) with their team name. */
export function deptPeople(dept) {
  const out = [];
  if (dept.lead) out.push({ ...dept.lead, team: null, lead: true });
  for (const t of dept.teams) for (const p of t.people) out.push({ ...p, team: t.name, lead: false });
  return out;
}

export function findDept(org, key) { return org?.departments.find((d) => d.key === key) || null; }
export function bossDept(org) { return org?.departments.find((d) => d.boss) || null; }
export function countPeople(org) { return (org?.departments || []).reduce((n, d) => n + deptPeople(d).length, 0); }

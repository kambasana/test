// Normalises the /api/org payload into a shape the UI can rely on and builds
// lookup tables (person id -> person, department, sub-team).
import { DEPT_PALETTE } from './constants.js';

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

export function normaliseOrg(raw) {
  const src = raw || {};
  const office = Object.assign({ name: 'Office', wing: '', wings: [] }, src.office || {});
  if (!office.name && src.title) office.name = src.title;
  const used = new Set();
  const uniq = (id) => {
    let out = id; let n = 2;
    while (used.has(out)) out = `${id}-${n++}`;
    used.add(out);
    return out;
  };
  let paletteIdx = 0;
  const departments = (src.departments || []).map((d) => {
    const key = String(d.key || slug(d.name));
    const boss = !!d.boss;
    const slot = boss ? 0 : paletteIdx++;
    const color = /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : (boss ? '#B7C4D4' : DEPT_PALETTE[slot % DEPT_PALETTE.length]);
    const leadSrc = d.lead || null;
    const lead = leadSrc ? {
      id: uniq(String(leadSrc.id || `${key}-${slug(leadSrc.name || 'lead')}`)),
      name: String(leadSrc.name || 'LEAD'),
      role: String(leadSrc.role || ''),
      does: String(leadSrc.does || ''),
      isLead: true,
    } : null;
    const teams = (d.teams || []).map((t) => ({
      name: String(t.name || 'TEAM'),
      people: (t.people || []).map((p) => ({
        id: uniq(String(p.id || `${key}-${slug(p.name)}`)),
        name: String(p.name || 'PERSON'),
        role: String(p.role || ''),
        does: String(p.does || ''),
      })),
    }));
    return {
      key, name: String(d.name || key).toUpperCase(), about: String(d.about || ''),
      boss, color, on: d.on !== false, lead, teams,
    };
  });

  const people = new Map(); // id -> { person, dept, team|null }
  for (const d of departments) {
    if (d.lead) people.set(d.lead.id, { person: d.lead, dept: d, team: null });
    for (const t of d.teams) for (const p of t.people) people.set(p.id, { person: p, dept: d, team: t });
  }
  const byKey = new Map(departments.map((d) => [d.key, d]));
  const boss = departments.find((d) => d.boss) || null;
  return {
    office, departments, people, byKey, boss,
    problems: Array.isArray(src.problems) ? src.problems.map(String) : [],
    headcount: people.size,
  };
}

export function personLabel(org, id) {
  if (!id) return '';
  const p = org && org.people.get(typeof id === 'object' ? id.id : id);
  if (p) return p.person.name;
  if (typeof id === 'object') return String(id.name || id.id || '');
  return String(id);
}

export function leadId(job) {
  if (!job || !job.lead) return null;
  return typeof job.lead === 'object' ? job.lead.id : job.lead;
}

export function deptName(org, key) {
  const d = org && org.byKey.get(key);
  return d ? d.name : String(key || '').toUpperCase();
}

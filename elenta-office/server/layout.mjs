// Floor layout (SPEC §8): Command hub in the centre, the Library beside it, department bays on a
// ring that spreads until no two bays overlap. Shapes are treated as circles of their hexagon's
// outer radius, which is conservative. Units are arbitrary floor units.
import { deptPeople } from './org.mjs';

export const HUB_RADIUS = 6;
export const LIBRARY_RADIUS = 2.4;
export const GAP = 1.5;
const SEAT = 1.1;    // space per seated person around a table
const TABLE_MIN = 1.6;

export function clusterRadius(peopleCount) {
  // People sit around a round table; the circumference must fit them.
  const table = Math.max(TABLE_MIN, (peopleCount * SEAT) / (2 * Math.PI));
  return table + 1.0; // seats + walking space
}

/** Place clusters (sub-teams) inside a bay; returns the bay radius and cluster centres. */
export function bayLayout(dept) {
  const groups = dept.teams.map((t) => ({ name: t.name, r: clusterRadius(t.people.length), people: t.people.length }));
  if (!groups.length) groups.push({ name: null, r: clusterRadius(1), people: 1 });
  const lead = 1.2; // the lead's spot in the middle
  let ring = 0;
  if (groups.length > 1) {
    const maxR = Math.max(...groups.map((g) => g.r));
    const chord = 2 * maxR + GAP * 0.6;
    ring = Math.max(chord / (2 * Math.sin(Math.PI / groups.length)), lead + maxR + GAP * 0.5);
  }
  const clusters = groups.map((g, i) => {
    const a = (2 * Math.PI * i) / groups.length - Math.PI / 2;
    return { name: g.name, r: g.r, x: ring * Math.cos(a), y: ring * Math.sin(a) };
  });
  const radius = Math.max(...clusters.map((c) => Math.hypot(c.x, c.y) + c.r)) + 1.0;
  return { radius, clusters };
}

export function computeLayout(departments) {
  const bays = departments.filter((d) => !d.boss).map((d) => ({ key: d.key, on: d.on, people: deptPeople(d).length, ...bayLayout(d) }));
  const n = bays.length;
  const maxR = n ? Math.max(...bays.map((b) => b.radius)) : 0;
  // Ring radius: clear of the hub and the library, and wide enough that neighbours do not touch.
  let ring = HUB_RADIUS + 2 * LIBRARY_RADIUS + 2 * GAP + maxR;
  if (n > 1) {
    for (let i = 0; i < n; i++) {
      const a = bays[i], b = bays[(i + 1) % n];
      const need = (a.radius + b.radius + GAP) / (2 * Math.sin(Math.PI / n));
      ring = Math.max(ring, need);
    }
  }
  const step = n ? (2 * Math.PI) / n : 0;
  bays.forEach((b, i) => {
    const angle = step * i - Math.PI / 2;
    b.x = ring * Math.cos(angle);
    b.y = ring * Math.sin(angle);
    b.angle = angle;
  });
  // The library sits beside the hub, halfway between the first two bays.
  const la = n ? -Math.PI / 2 + step / 2 : Math.PI / 2;
  const ld = HUB_RADIUS + GAP + LIBRARY_RADIUS;
  return {
    hub: { x: 0, y: 0, r: HUB_RADIUS },
    library: { x: ld * Math.cos(la), y: ld * Math.sin(la), r: LIBRARY_RADIUS },
    ring,
    bays: bays.map((b) => ({
      key: b.key, on: b.on, x: b.x, y: b.y, r: b.radius,
      clusters: b.clusters.map((c) => ({ name: c.name, x: b.x + c.x, y: b.y + c.y, r: c.r })),
    })),
  };
}

/** All overlapping pairs among hub, library and bays (for tests and a start-up self-check). */
export function overlaps(layout) {
  const shapes = [{ id: 'hub', ...layout.hub }, { id: 'library', ...layout.library }, ...layout.bays.map((b) => ({ id: b.key, x: b.x, y: b.y, r: b.r }))];
  const bad = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) bad.push([a.id, b.id]);
    }
  }
  for (const b of layout.bays) {
    for (let i = 0; i < b.clusters.length; i++) {
      const c = b.clusters[i];
      if (Math.hypot(c.x - b.x, c.y - b.y) + c.r > b.r + 1e-9) bad.push([b.key, c.name]);
      for (let j = i + 1; j < b.clusters.length; j++) {
        const d = b.clusters[j];
        if (Math.hypot(c.x - d.x, c.y - d.y) < c.r + d.r) bad.push([`${b.key}/${c.name}`, `${b.key}/${d.name}`]);
      }
    }
  }
  return bad;
}

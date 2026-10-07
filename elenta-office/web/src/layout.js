// Floor layout, computed from the org. Pure functions, no three.js.
//
// Coordinates are on the ground plane: x to the right, z towards the viewer,
// with angles measured from +x towards +z. Every platform is a regular hexagon
// described by its circumradius R (centre to corner); its inradius is R*cos30.
// Overlap checks use the circumcircles, which is conservative.

const COS30 = Math.cos(Math.PI / 6);
const SEAT_ARC = 0.78;   // ground distance between neighbours at a table
const FIGURE = 0.42;     // clearance a seated figure needs past its seat
const LEAD_CLEAR = 1.05; // free radius around the lead's console
const GAP = 1.1;         // minimum space between any two platforms

// The direction that is "up" on screen for the isometric camera (which looks
// from +x +y +z towards the origin) is (-1, -1) on the ground.
export const SCREEN_UP = Math.atan2(-1, -1);

function clusterFor(team) {
  const n = Math.max(1, team.people.length);
  const seatR = Math.max(0.8, (n * SEAT_ARC) / (2 * Math.PI));
  const tableR = Math.max(0.42, seatR - 0.4);
  return { name: team.name, people: team.people, seatR, tableR, radius: seatR + FIGURE };
}

// Places the sub-team clusters around the lead in the middle of a platform.
// `outward` is the direction (angle) facing away from Command.
function arrangeBay(teams, outward, minR) {
  const clusters = teams.map(clusterFor);
  const k = clusters.length;
  const cMax = clusters.reduce((m, c) => Math.max(m, c.radius), 0.8);
  let ring = 0;
  if (k === 1) ring = cMax + LEAD_CLEAR;
  else if (k > 1) ring = Math.max(cMax + LEAD_CLEAR, (cMax + 0.3) / Math.sin(Math.PI / k));
  const start = k === 2 ? outward + Math.PI / 2 : outward;
  clusters.forEach((c, i) => {
    const a = start + (i * 2 * Math.PI) / Math.max(1, k);
    c.x = Math.cos(a) * ring;
    c.z = Math.sin(a) * ring;
    c.angle = a;
    // seats spread around the table, starting from the side facing the lead
    const n = c.people.length;
    c.seats = c.people.map((p, j) => {
      const sa = a + Math.PI + ((j + 0.5) * 2 * Math.PI) / Math.max(1, n) - Math.PI / Math.max(1, n);
      return { id: p.id, x: c.x + Math.cos(sa) * c.seatR, z: c.z + Math.sin(sa) * c.seatR, face: sa + Math.PI };
    });
  });
  const inner = k ? ring + cMax + 0.55 : LEAD_CLEAR + 0.6;
  const R = Math.max(minR, inner / COS30);
  return { clusters, R };
}

function collide(a, b, gap = GAP) {
  return Math.hypot(a.x - b.x, a.z - b.z) < a.R + b.R + gap - 1e-6;
}

export function overlaps(items, gap = GAP) {
  const bad = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (collide(items[i], items[j], gap)) bad.push([items[i].id, items[j].id]);
    }
  }
  return bad;
}

// org: the normalised org from org.js
export function computeLayout(org) {
  const bossDept = org.boss;
  const hubBase = arrangeBay(bossDept ? bossDept.teams : [], Math.PI / 4, 3.1);
  const hub = {
    id: 'command', kind: 'command', dept: bossDept ? bossDept.key : null,
    x: 0, z: 0, R: hubBase.R, rot: 0, clusters: hubBase.clusters,
    lead: bossDept && bossDept.lead ? { id: bossDept.lead.id, x: 0, z: 0 } : null,
  };

  const ringDepts = org.departments.filter((d) => !d.boss);
  const N = ringDepts.length;
  const step = N ? (2 * Math.PI) / N : 0;
  // Keep one gap of the ring centred on "screen up": the Library sits there.
  const libAngle = SCREEN_UP;
  const firstAngle = libAngle + step / 2;

  const bays = ringDepts.map((d, i) => {
    const angle = firstAngle + i * step;
    const { clusters, R } = arrangeBay(d.on ? d.teams : [], angle, 3.0);
    // an off department keeps a footprint the size it would have, so turning
    // it back on does not move everything else
    const footprint = d.on ? R : arrangeBay(d.teams, angle, 3.0).R;
    return { id: d.key, kind: 'bay', dept: d.key, on: d.on, angle, R: footprint, clusters: d.on ? clusters : [] };
  });

  const library = { id: 'library', kind: 'library', R: 1.7, angle: libAngle };
  const libDist = hub.R + library.R + 0.7;
  library.x = Math.cos(libAngle) * libDist;
  library.z = Math.sin(libAngle) * libDist;

  const maxBay = bays.reduce((m, b) => Math.max(m, b.R), 0);
  let ringR = hub.R + maxBay + GAP + 0.6;
  const place = () => {
    for (const b of bays) {
      b.x = Math.cos(b.angle) * ringR;
      b.z = Math.sin(b.angle) * ringR;
    }
  };
  place();
  // Spread the ring until nothing overlaps (bays with each other, with the
  // hub and with the Library).
  for (let guard = 0; guard < 400 && overlaps([hub, library, ...bays]).length; guard++) {
    ringR += 0.2;
    place();
  }

  for (const b of bays) {
    b.rot = -(b.angle + Math.PI); // a flat side of the hex faces Command
    b.lead = null;
    const d = org.byKey.get(b.dept);
    if (d && d.on && d.lead) b.lead = { id: d.lead.id, x: b.x, z: b.z };
    for (const c of b.clusters) {
      c.x += b.x; c.z += b.z;
      for (const s of c.seats) { s.x += b.x; s.z += b.z; }
    }
  }
  library.rot = -(libAngle + Math.PI);

  // Light paths: from the edge of Command to the facing edge of each bay.
  const paths = bays.map((b) => {
    const ux = Math.cos(b.angle); const uz = Math.sin(b.angle);
    const r0 = hub.R * COS30; const r1 = ringR - b.R * COS30;
    return { id: b.id, on: b.on, x0: ux * r0, z0: uz * r0, x1: ux * r1, z1: uz * r1 };
  });
  {
    const ux = Math.cos(libAngle); const uz = Math.sin(libAngle);
    paths.push({ id: 'library', on: true, x0: ux * hub.R * COS30, z0: uz * hub.R * COS30,
      x1: ux * (libDist - library.R * COS30), z1: uz * (libDist - library.R * COS30) });
  }

  // Seat positions for every person, keyed by id.
  const spots = new Map();
  const addBay = (b) => {
    if (b.lead) spots.set(b.lead.id, { x: b.lead.x, z: b.lead.z, face: Math.atan2(-b.lead.z, -b.lead.x) || Math.PI / 4, lead: true, bay: b.id });
    for (const c of b.clusters) for (const s of c.seats) spots.set(s.id, { x: s.x, z: s.z, face: s.face, lead: false, bay: b.id, team: c.name });
  };
  addBay(hub);
  bays.forEach(addBay);
  if (hub.lead) spots.get(hub.lead.id).face = Math.PI / 4;

  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of [hub, library, ...bays]) {
    minX = Math.min(minX, p.x - p.R); maxX = Math.max(maxX, p.x + p.R);
    minZ = Math.min(minZ, p.z - p.R); maxZ = Math.max(maxZ, p.z + p.R);
  }
  return { hub, library, bays, paths, spots, ringR, bounds: { minX, maxX, minZ, maxZ } };
}

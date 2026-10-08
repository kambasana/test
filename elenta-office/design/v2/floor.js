// Elenta Office v2 floor concept: one building, rooms per department, desk pods per sub-team.
import * as THREE from 'three';

const P = new URLSearchParams(location.search);
const VIEW = P.get('view') || 'overview';
const W = innerWidth, H = innerHeight;

const C = {
  bg: '#EEF0F3', slab: '#FBFBFC', slabEdge: '#D9DDE3', corridor: '#E7E9ED',
  desk: '#C9A27A', deskTop: '#D8B48C', leg: '#6B7280', screen: '#111827', chair: '#374151',
  glass: '#BFD3E6', wallBase: '#E5E7EB', skin: ['#E8B98E', '#C68B59', '#F0C9A0', '#8A5A32', '#D9A97E'],
  hair: ['#1F2937', '#3B2B1D', '#111111', '#6B3A12', '#9CA3AF'],
  status: { working: '#14B8A6', waiting: '#F59E0B', refused: '#EF4444', idle: '#9CA3AF' },
};
const ROOMS = {
  command:  { name: 'COMMAND', sub: 'Boss · Chief of staff', x: -11, z: -8, w: 22, d: 16, floor: '#E4E7EC', accent: '#1F2937' },
  library:  { name: 'LIBRARY', sub: '10 notes · lessons', x: -11, z: -24, w: 22, d: 12, floor: '#DFF0EC', accent: '#0F766E' },
  military: { name: 'MILITARY', sub: '10 people · 4 sub-teams', x: 15, z: -24, w: 30, d: 40, floor: '#EDEFE2', accent: '#5F6B2E' },
  business: { name: 'BUSINESS', sub: '5 people · 3 sub-teams', x: -41, z: -16, w: 26, d: 26, floor: '#ECEDFA', accent: '#4F46E5' },
};
// sub-team pods: a row of desks (screens toward the viewer), room-local origin
const PODS = [
  { room: 'military', name: 'SOFTWARE', x: 3, z: 6, people: ['working', 'working', 'idle'] },
  { room: 'military', name: 'DOCUMENTATION', x: 17, z: 6, people: ['working', 'waiting'] },
  { room: 'military', name: 'ANALYSIS', x: 3, z: 17, people: ['working', 'idle'] },
  { room: 'military', name: 'COMPLIANCE', x: 17, z: 17, people: ['refused', 'working'] },
  { room: 'business', name: 'FINANCE', x: 3, z: 6, people: ['idle', 'working'] },
  { room: 'business', name: 'CONTRACTS', x: 15, z: 6, people: ['idle'] },
  { room: 'business', name: 'ADMIN', x: 3, z: 16, people: ['idle'] },
];
const LEADS = [
  { room: 'military', name: 'MILITARY LEAD', x: 12, z: 31, status: 'working' },
  { room: 'business', name: 'BUSINESS LEAD', x: 17, z: 18, status: 'idle' },
];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(C.bg);

const zoom = VIEW === 'overview' ? 1.3 : 2.4;
const FR = 60 / zoom, aspect = W / H;
const camera = new THREE.OrthographicCamera(-FR * aspect, FR * aspect, FR, -FR, -500, 1000);
const target = VIEW === 'overview' ? new THREE.Vector3(1, 0, -3) : new THREE.Vector3(31, 0, -5);
const iso = new THREE.Vector3(1, 1.05, 1).normalize();
camera.position.copy(target).addScaledVector(iso, 300); camera.lookAt(target);

scene.add(new THREE.HemisphereLight('#ffffff', '#cfd6df', 1.15));
const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(-60, 120, 40); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 400 });
sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0005; sun.shadow.radius = 4; scene.add(sun);

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...o });
const box = (w, h, d, m, x, y, z, parent = scene) => {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x, y, z);
  g.castShadow = true; g.receiveShadow = true; parent.add(g); return g;
};

// building slab
box(92, 2, 52, mat(C.slab), 2, -1, -4);
box(92.6, 0.6, 52.6, mat(C.slabEdge), 2, -1.9, -4);
const corridor = box(92, 0.04, 52, mat(C.corridor), 2, 0.02, -4); corridor.castShadow = false;

const labels = [];
function room(key) {
  const r = ROOMS[key], cx = r.x + r.w / 2, cz = r.z + r.d / 2;
  const f = box(r.w, 0.08, r.d, mat(r.floor), cx, 0.06, cz); f.castShadow = false;
  // low wall base + glass, with a door gap on the side that faces the centre
  const base = mat(C.wallBase), glass = mat(C.glass, { transparent: true, opacity: 0.28, roughness: 0.1 });
  const accent = mat(r.accent);
  const doorSide = key === 'military' ? 'w' : key === 'business' ? 'e' : key === 'library' ? 's' : 'none';
  const wall = (x1, z1, x2, z2, side) => {
    const len = Math.hypot(x2 - x1, z2 - z1), horiz = z1 === z2;
    const segs = side === doorSide ? [[0, len / 2 - 2.5], [len / 2 + 2.5, len]] : [[0, len]];
    for (const [a, b] of segs) {
      const L = b - a, mid = (a + b) / 2;
      const px = horiz ? x1 + mid : x1, pz = horiz ? z1 : z1 + mid;
      box(horiz ? L : 0.3, 0.9, horiz ? 0.3 : L, base, px, 0.45, pz);
      box(horiz ? L : 0.12, 1.8, horiz ? 0.12 : L, glass, px, 1.8, pz).castShadow = false;
      box(horiz ? L : 0.34, 0.1, horiz ? 0.34 : L, accent, px, 0.95, pz);
    }
  };
  wall(r.x, r.z, r.x + r.w, r.z, 'n'); wall(r.x, r.z + r.d, r.x + r.w, r.z + r.d, 's');
  wall(r.x, r.z, r.x, r.z + r.d, 'w'); wall(r.x + r.w, r.z, r.x + r.w, r.z + r.d, 'e');
  labels.push({ cls: 'room', html: `<b style="--a:${r.accent}">${r.name}</b><span>${r.sub}</span>`, at: new THREE.Vector3(r.x + 1.5, 3.4, r.z + 1.5) });
}

function person(x, z, rot, status, i) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot;
  const shirt = mat(['#334155', '#475569', '#1E3A8A', '#14532D', '#7C2D12'][i % 5]);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 6, 14), shirt); body.position.y = 1.35; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), mat(C.skin[i % 5])); head.position.y = 2.3; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), mat(C.hair[i % 5])); hair.position.y = 2.36; g.add(hair);
  scene.add(g);
  // status ring on the floor
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: C.status[status], transparent: true, opacity: status === 'idle' ? 0.45 : 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.12, z); scene.add(ring);
}
function desk(x, z, facing, status, i, big = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = facing;
  const w = big ? 3.4 : 2.4, d = big ? 1.4 : 1.15;
  box(w, 0.1, d, mat(C.deskTop), 0, 1.0, 0, g);
  for (const sx of [-1, 1]) box(0.08, 0.95, d - 0.1, mat(C.leg), sx * (w / 2 - 0.1), 0.5, 0, g);
  box(1.05, 0.62, 0.06, mat(C.screen, { roughness: 0.3 }), 0, 1.45, -d / 2 + 0.25, g);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.52), new THREE.MeshBasicMaterial({ color: status === 'idle' ? '#334155' : C.status[status] }));
  glow.position.set(0, 1.45, -d / 2 + 0.29); glow.material.transparent = true; glow.material.opacity = status === 'idle' ? 1 : 0.55; g.add(glow);
  box(0.08, 0.3, 0.08, mat(C.leg), 0, 1.15, -d / 2 + 0.25, g);
  box(0.5, 0.03, 0.18, mat('#E5E7EB'), 0.2, 1.07, 0.15, g); // keyboard
  box(0.9, 0.12, 0.85, mat(C.chair), 0, 0.62, d / 2 + 0.55, g); // seat
  box(0.9, 0.9, 0.12, mat(C.chair), 0, 1.1, d / 2 + 0.95, g); // back
  scene.add(g);
  const p = new THREE.Vector3(0, 0, d / 2 + 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);
  person(x + p.x, z + p.z, facing + Math.PI, status, i);
}
function pod(pd, idx) {
  const r = ROOMS[pd.room], ox = r.x + pd.x, oz = r.z + pd.z, n = pd.people.length;
  const span = n * 2.7 + 1.4;
  const rug = box(span, 0.04, 5.2, mat(r.accent, { transparent: true, opacity: 0.13 }), ox + span / 2 - 0.7, 0.13, oz + 0.9); rug.castShadow = false;
  pd.people.forEach((st, i) => desk(ox + i * 2.7 + 0.7, oz, 0, st, idx * 3 + i));
  labels.push({ cls: 'pod', html: `<i style="--a:${r.accent}"></i>${pd.name} <em>${n}</em>`, at: new THREE.Vector3(ox - 0.6, 0.2, oz - 1.6) });
}

for (const k of Object.keys(ROOMS)) room(k);
PODS.forEach(pod);
for (const L of LEADS) { const r = ROOMS[L.room]; desk(r.x + L.x, r.z + L.z, 0, L.status, 9, true); labels.push({ cls: 'pod lead', html: `★ ${L.name}`, at: new THREE.Vector3(r.x + L.x - 2, 0.2, r.z + L.z - 1.8) }); }

// COMMAND: the Boss's desk, the chief of staff, a routing wall and a round table
{
  const r = ROOMS.command;
  desk(r.x + 9, r.z + 7, 0, 'working', 1, true);
  desk(r.x + 16, r.z + 7, 0, 'idle', 2);
  const scr = box(10, 4.2, 0.25, mat('#0F172A', { roughness: 0.3 }), r.x + 12, 3.2, r.z + 0.6);
  const sc = document.createElement('canvas'); sc.width = 1000; sc.height = 420; const x = sc.getContext('2d');
  x.fillStyle = '#0F172A'; x.fillRect(0, 0, 1000, 420); x.font = '600 34px "IBM Plex Mono", monospace'; x.fillStyle = '#94A3B8'; x.fillText('ROUTING', 40, 60);
  [['Test plan · data logger', 'MILITARY', '#5F6B2E'], ['Invoice check · Sept', 'BUSINESS', '#4F46E5'], ['Export screening memo', 'MILITARY', '#5F6B2E']].forEach(([t, d, c], i) => {
    x.fillStyle = '#E2E8F0'; x.font = '500 34px "IBM Plex Sans", sans-serif'; x.fillText(t, 40, 140 + i * 90);
    x.fillStyle = c; x.fillRect(640, 108 + i * 90, 300, 46); x.fillStyle = '#fff'; x.font = '600 28px "IBM Plex Mono", monospace'; x.fillText('→ ' + d, 656, 141 + i * 90);
  });
  const t = new THREE.CanvasTexture(sc); t.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 3.9), new THREE.MeshBasicMaterial({ map: t })); face.position.set(r.x + 12, 3.2, r.z + 0.74); scene.add(face);
  const tbl = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.12, 40), mat('#E7E5E4')); tbl.position.set(r.x + 5, 1, r.z + 12); tbl.castShadow = true; scene.add(tbl);
  box(0.3, 1, 0.3, mat(C.leg), r.x + 5, 0.5, r.z + 12);
  for (let a = 0; a < 4; a++) box(0.8, 0.12, 0.8, mat(C.chair), r.x + 5 + Math.cos(a * Math.PI / 2 + 0.6) * 3, 0.62, r.z + 12 + Math.sin(a * Math.PI / 2 + 0.6) * 3);
  labels.push({ cls: 'pod lead', html: '★ BOSS', at: new THREE.Vector3(r.x + 7, 0.2, r.z + 5.2) });
}
// LIBRARY: shelves and a reading table
{
  const r = ROOMS.library, cols = ['#0F766E', '#B45309', '#1D4ED8', '#9D174D', '#4D7C0F'];
  for (let s = 0; s < 3; s++) {
    const sx = r.x + 2 + s * 6.2, sz = r.z + 1.2;
    box(4.6, 3.2, 0.9, mat('#E7E5E4'), sx + 2.3, 1.6, sz);
    for (let row = 0; row < 3; row++) for (let b = 0; b < 9; b++) box(0.38, 0.75, 0.6, mat(cols[(s + row + b) % 5]), sx + 0.4 + b * 0.47, 0.6 + row * 0.95, sz + 0.1);
  }
  box(9, 0.12, 3, mat('#E7E5E4'), r.x + 11, 1, r.z + 7.5); box(8, 0.95, 0.2, mat(C.leg), r.x + 11, 0.5, r.z + 7.5);
}
// plants
for (const [x, z] of [[-41, -27], [46, 19], [-41, 19], [12, -27], [12, 19], [46, -27]]) {
  box(1.2, 1.2, 1.2, mat('#D6D3D1'), x, 0.6, z);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), mat('#4D7C0F', { flatShading: true })); leaves.position.set(x, 2.3, z); leaves.castShadow = true; scene.add(leaves);
}
// light-paths from Command to departments (routing)
const path = (a, b, color) => {
  const curve = new THREE.LineCurve3(a, b);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.18, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })); scene.add(m);
};
path(new THREE.Vector3(11, 0.25, 0), new THREE.Vector3(15, 0.25, 0), '#5F6B2E');
path(new THREE.Vector3(-11, 0.25, -3), new THREE.Vector3(-15, 0.25, -3), '#4F46E5');

renderer.render(scene, camera);
// HTML labels, placed by projecting their anchor points
for (const l of labels) {
  const v = l.at.clone().project(camera);
  const el = document.createElement('div'); el.className = 'lab ' + l.cls; el.innerHTML = l.html;
  el.style.left = ((v.x + 1) / 2 * W) + 'px'; el.style.top = ((1 - v.y) / 2 * H) + 'px';
  document.body.appendChild(el);
}
document.body.dataset.ready = '1';

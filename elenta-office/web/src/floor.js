// The 3D floor: an orthographic isometric view of Command, the Library and the
// department bays, rendered with three.js. People are instanced; status rings
// and light pulses are updated per frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { h, clear } from './dom.js';
import { STATUS } from './constants.js';

const COS30 = Math.cos(Math.PI / 6);
const VIEW_DIR = new THREE.Vector3(1, 1.18, 1).normalize();
const BAY_H = 0.22;
const HUB_H = 0.3;
const LIB_COLOR = '#9C8CF0';

const THEMES = {
  dark: {
    background: '#0B0E13', ground: '#0D1117', dots: 'rgba(139,152,169,0.16)',
    top: '#1A212B', inset: '#1D2530', side: '#121821', table: '#262F3B', pedestal: '#141A22',
    head: '#D3DBE4', idle: '#4A5566', shelf: '#2A2F3F', bloom: 0.62,
    hemiSky: '#9BB3CF', hemiGround: '#0B0E13', hemi: 0.75, key: 2.1, ambient: 0.25, offLine: '#5C6878',
  },
  light: {
    background: '#E6EAF0', ground: '#E4E9EF', dots: 'rgba(60,72,90,0.16)',
    top: '#F7F9FB', inset: '#EEF2F6', side: '#C9D2DC', table: '#D9E0E8', pedestal: '#AEB8C4',
    head: '#4C5868', idle: '#9AA6B4', shelf: '#C2C8D6', bloom: 0.22,
    hemiSky: '#FFFFFF', hemiGround: '#B8C2CE', hemi: 1.1, key: 2.0, ambient: 0.45, offLine: '#8B98A9',
  },
};

function hexPoints(R, facing) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = facing + Math.PI / 6 + (k * Math.PI) / 3;
    pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  return pts;
}

// A Shape in the XY plane whose rotation by -90deg about X lands on the ground
// with ground coords (x, z) = (shape.x, -shape.y).
function hexShape(R, facing) {
  const s = new THREE.Shape();
  hexPoints(R, facing).forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}

function hexRing(R, width, facing) {
  const s = hexShape(R, facing);
  const hole = new THREE.Path();
  hexPoints(R - width, facing).forEach(([x, z], i) => (i ? hole.lineTo(x, -z) : hole.moveTo(x, -z)));
  hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function hexPrism(R, height, facing) {
  const g = new THREE.ExtrudeGeometry(hexShape(R - 0.06, facing), {
    depth: height - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.06, bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.03, 0);
  return g;
}

function hexFill(R, facing) {
  const g = new THREE.ShapeGeometry(hexShape(R, facing));
  g.rotateX(-Math.PI / 2);
  return g;
}

function hdr(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

function dotTexture(color) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath(); g.arc(32, 32, 2.2, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function dashTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.62, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function createFloor(container, hooks = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theme = THEMES.dark;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!hooks.preserve });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'floor-canvas';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Office floor. Drag or use the arrow keys to move, plus and minus to zoom, 0 to see everything.');
  container.appendChild(renderer.domElement);

  const labelsLayer = h('div', { class: 'floor-labels' });
  container.appendChild(labelsLayer);
  const tip = h('div', { class: 'floor-tip', role: 'tooltip', hidden: true });
  container.appendChild(tip);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.background);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

  const ambient = new THREE.AmbientLight('#ffffff', theme.ambient);
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemi);
  const key = new THREE.DirectionalLight('#FFF4E6', theme.key);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 4;
  key.shadow.blurSamples = 12;
  const rimLight = new THREE.DirectionalLight('#7FB2FF', 0.35);
  scene.add(ambient, hemi, key, key.target, rimLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const dots = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ map: dotTexture(theme.dots), transparent: true, depthWrite: false }));
  dots.material.map.repeat.set(600 / 1.2, 600 / 1.2);
  dots.rotation.x = -Math.PI / 2;
  dots.position.y = 0.002;
  scene.add(dots);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), theme.bloom, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- world (rebuilt per org) ---------------------------------------
  let world = null;
  let model = null; // { org, layout, people: [...], idx: Map, bays: Map, labels: [...] }
  const dash = dashTexture();
  let presence = new Map();
  let selected = { dept: null, person: null };

  // camera state
  const view = { target: new THREE.Vector3(), zoom: 1, viewH: 30, tween: null };

  function disposeWorld() {
    if (!world) return;
    world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && m.map !== dash) m.map.dispose(); m.dispose(); });
    });
    scene.remove(world);
    world = null;
    clear(labelsLayer);
  }

  function platform(R, height, facing, color, opts = {}) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(hexPrism(R, height, facing), new THREE.MeshStandardMaterial({ color: theme.side, roughness: 0.85, metalness: 0.1 }));
    body.castShadow = true; body.receiveShadow = true;
    const top = new THREE.Mesh(hexFill(R - 0.08, facing), new THREE.MeshStandardMaterial({ color: theme.top, roughness: 0.92, metalness: 0.05 }));
    top.position.y = height + 0.001; top.receiveShadow = true;
    const inset = new THREE.Mesh(hexRing(R - 0.42, 0.03, facing), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.22, depthWrite: false }));
    inset.position.y = height + 0.004;
    const rimMat = new THREE.MeshBasicMaterial({ color: hdr(color, opts.rimGain || 1.5) });
    const rim = new THREE.Mesh(hexRing(R - 0.02, 0.07, facing), rimMat);
    rim.position.y = height + 0.006;
    // a faint pool of colour on the ground around the platform
    const glow = new THREE.Mesh(hexRing(R + 0.55, 0.55, facing), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }));
    glow.position.y = 0.004;
    g.add(body, top, inset, rim, glow);
    g.userData = { top, rimMat, baseRim: hdr(color, opts.rimGain || 1.5) };
    top.userData.pick = opts.pick || null;
    return g;
  }

  function addLabel(kind, el, pos, extra = {}) {
    labelsLayer.appendChild(el);
    const l = { kind, el, pos: pos.clone(), x: -1e4, y: -1e4, shown: null, ...extra };
    model.labels.push(l);
    return l;
  }

  function build(org, layout) {
    disposeWorld();
    world = new THREE.Group();
    scene.add(world);
    model = { org, layout, people: [], idx: new Map(), bays: new Map(), labels: [], deptLabels: new Map() };

    // Command
    const hub = layout.hub;
    const bossColor = org.boss ? org.boss.color : STATUS.live;
    const hubG = platform(hub.R, HUB_H, Math.PI / 4 + Math.PI, bossColor, { rimGain: 1.9, pick: { dept: hub.dept, kind: 'command' } });
    world.add(hubG);
    const dais = new THREE.Mesh(hexPrism(1.0, 0.12, Math.PI / 4), new THREE.MeshStandardMaterial({ color: theme.side, roughness: 0.7 }));
    dais.position.y = HUB_H; dais.castShadow = true; dais.receiveShadow = true;
    const daisRim = new THREE.Mesh(hexRing(1.0, 0.05, Math.PI / 4), new THREE.MeshBasicMaterial({ color: hdr(bossColor, 2) }));
    daisRim.position.y = HUB_H + 0.125;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: hdr(bossColor, 2.6) }));
    halo.rotation.x = Math.PI / 2; halo.position.y = HUB_H + 1.55;
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.008, 8, 64), new THREE.MeshBasicMaterial({ color: hdr(bossColor, 1.6) }));
    halo2.rotation.x = Math.PI / 2; halo2.position.y = HUB_H + 1.4;
    world.add(dais, daisRim, halo, halo2);
    model.halo = [halo, halo2];
    model.bays.set('command', { group: hubG, x: 0, z: 0, R: hub.R, top: HUB_H, dept: hub.dept, kind: 'command' });
    if (hub.dept) model.bays.set(hub.dept, model.bays.get('command'));

    // Library
    const lib = layout.library;
    const libG = platform(lib.R, BAY_H, lib.angle + Math.PI, LIB_COLOR, { rimGain: 1.6, pick: { kind: 'library' } });
    libG.position.set(lib.x, 0, lib.z);
    world.add(libG);
    {
      const shelfMat = new THREE.MeshStandardMaterial({ color: theme.shelf, roughness: 0.8 });
      const books = [];
      const shelfGeo = new THREE.BoxGeometry(1.25, 0.5, 0.26);
      const across = new THREE.Vector2(Math.cos(lib.angle + Math.PI / 2), Math.sin(lib.angle + Math.PI / 2));
      const out = new THREE.Vector2(Math.cos(lib.angle), Math.sin(lib.angle));
      [-0.42, 0.42].forEach((o, i) => {
        const s = new THREE.Mesh(shelfGeo, shelfMat);
        const cx = lib.x + out.x * o; const cz = lib.z + out.y * o;
        s.position.set(cx, BAY_H + 0.25, cz);
        s.rotation.y = -Math.atan2(across.y, across.x);
        s.castShadow = true; s.receiveShadow = true;
        world.add(s);
        for (let b = 0; b < 9; b++) {
          const t = -0.52 + b * 0.13;
          books.push({ x: cx + across.x * t, z: cz + across.y * t, h: 0.16 + ((b * 7 + i * 3) % 5) * 0.025, rot: s.rotation.y, c: ['#B9A7FF', '#7FA8E8', '#C9A227', '#7DB98A', '#D58E6F'][(b + i * 2) % 5] });
        }
      });
      const bookMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1, 0.2), new THREE.MeshStandardMaterial({ roughness: 0.6 }), books.length);
      const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3();
      books.forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
        sc.set(1, b.h, 1);
        m.compose(new THREE.Vector3(b.x, BAY_H + 0.5 + b.h / 2, b.z), q, sc);
        bookMesh.setMatrixAt(i, m);
        bookMesh.setColorAt(i, new THREE.Color(b.c));
      });
      bookMesh.castShadow = true;
      world.add(bookMesh);
    }
    model.bays.set('library', { group: libG, x: lib.x, z: lib.z, R: lib.R, top: BAY_H, kind: 'library' });

    // Bays
    for (const b of layout.bays) {
      const d = org.byKey.get(b.dept);
      if (!b.on) {
        const pts = hexPoints(b.R, b.angle + Math.PI).map(([x, z]) => new THREE.Vector3(b.x + x, 0.03, b.z + z));
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: theme.offLine, dashSize: 0.45, gapSize: 0.3, transparent: true, opacity: 0.9 }));
        line.computeLineDistances();
        world.add(line);
        model.bays.set(b.dept, { group: null, x: b.x, z: b.z, R: b.R, top: 0, dept: b.dept, kind: 'off' });
        continue;
      }
      const g = platform(b.R, BAY_H, b.angle + Math.PI, d.color, { pick: { dept: b.dept, kind: 'bay' } });
      g.position.set(b.x, 0, b.z);
      world.add(g);
      model.bays.set(b.dept, { group: g, x: b.x, z: b.z, R: b.R, top: BAY_H, dept: b.dept, kind: 'bay' });
      if (b.lead) {
        const pad = new THREE.Mesh(hexRing(0.62, 0.04, b.angle + Math.PI), new THREE.MeshBasicMaterial({ color: hdr(d.color, 1.3) }));
        pad.position.set(b.x, BAY_H + 0.008, b.z);
        world.add(pad);
      }
    }

    // Light paths
    for (const p of layout.paths) {
      const dx = p.x1 - p.x0; const dz = p.z1 - p.z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const color = p.id === 'library' ? LIB_COLOR : (org.byKey.get(p.id)?.color || '#8B98A9');
      const tex = dash.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(len / 1.4)), 1);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.14), new THREE.MeshBasicMaterial({ color: p.on ? hdr(color, 1.8) : new THREE.Color(theme.offLine), map: tex, transparent: true, opacity: p.on ? 1 : 0.35, depthWrite: false }));
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = -Math.atan2(dz, dx);
      strip.position.set((p.x0 + p.x1) / 2, 0.012, (p.z0 + p.z1) / 2);
      const bed = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: p.on ? 0.07 : 0.03, depthWrite: false }));
      bed.rotation.copy(strip.rotation);
      bed.position.copy(strip.position).setY(0.008);
      strip.userData.flow = p.on;
      world.add(bed, strip);
    }
    model.strips = world.children.filter((o) => o.userData && o.userData.flow);

    // Tables and people
    const clusters = [];
    const addClusters = (bay, color, top, deptKey) => {
      for (const c of bay.clusters) clusters.push({ c, color, top, dept: deptKey });
    };
    if (org.boss) addClusters(hub, org.boss.color, HUB_H, hub.dept);
    for (const b of layout.bays) if (b.on) addClusters(b, org.byKey.get(b.dept).color, BAY_H, b.dept);

    const tableTop = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 0.94, 0.07, 48), new THREE.MeshStandardMaterial({ color: theme.table, roughness: 0.55, metalness: 0.15 }), Math.max(1, clusters.length));
    const tableLeg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.12, 1, 12), new THREE.MeshStandardMaterial({ color: theme.pedestal, roughness: 0.8 }), Math.max(1, clusters.length));
    const tableRim = new THREE.InstancedMesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({}), Math.max(1, clusters.length));
    const tableHolo = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), Math.max(1, clusters.length));
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
    const TABLE_Y = 0.44;
    clusters.forEach(({ c, color, top, dept }, i) => {
      q.identity();
      m.compose(v.set(c.x, top + TABLE_Y, c.z), q, s.set(c.tableR, 1, c.tableR)); tableTop.setMatrixAt(i, m);
      m.compose(v.set(c.x, top + TABLE_Y / 2, c.z), q, s.set(1, TABLE_Y, 1)); tableLeg.setMatrixAt(i, m);
      m.compose(v.set(c.x, top + TABLE_Y + 0.037, c.z), q, s.set(c.tableR, 1, c.tableR)); tableRim.setMatrixAt(i, m);
      m.compose(v.set(c.x, top + TABLE_Y + 0.04, c.z), q, s.set(c.tableR, 1, c.tableR)); tableHolo.setMatrixAt(i, m);
      tableRim.setColorAt(i, hdr(color, 1.35));
      tableHolo.setColorAt(i, new THREE.Color(color).multiplyScalar(0.5));
      const team = c.name;
      const el = h('div', { class: 'lbl lbl-team' }, h('span', { class: 'lbl-team-name' }, team), h('span', { class: 'lbl-team-n' }, String(c.people.length)));
      addLabel('team', el, new THREE.Vector3(c.x, top + 1.55, c.z), { dept });
    });
    [tableTop, tableLeg].forEach((x) => { x.castShadow = true; x.receiveShadow = true; });
    world.add(tableTop, tableLeg, tableRim, tableHolo);

    // People
    const people = [];
    for (const [id, spot] of layout.spots) {
      const info = org.people.get(id);
      if (!info) continue;
      const bayTop = spot.bay === 'command' ? (spot.lead ? HUB_H + 0.12 : HUB_H) : BAY_H;
      people.push({ id, x: spot.x, z: spot.z, y: bayTop, lead: spot.lead, dept: info.dept.key, color: info.dept.color, person: info.person, team: info.team ? info.team.name : null });
    }
    const n = Math.max(1, people.length);
    const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.34, 6, 14); bodyGeo.translate(0, 0.32, 0);
    const headGeo = new THREE.SphereGeometry(0.125, 18, 12);
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }), n);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: theme.head, roughness: 0.45 }), n);
    const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.24, 0.31, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }), n);
    const halos = new THREE.InstancedMesh(new THREE.RingGeometry(0.3, 0.36, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), n);
    bodies.castShadow = true; heads.castShadow = true; bodies.receiveShadow = true;
    people.forEach((p, i) => {
      const k = p.lead ? 1.16 : 1;
      m.compose(v.set(p.x, p.y, p.z), q.identity(), s.set(k, k, k)); bodies.setMatrixAt(i, m);
      m.compose(v.set(p.x, p.y + 0.79 * k, p.z), q, s.set(k, k, k)); heads.setMatrixAt(i, m);
      m.compose(v.set(p.x, p.y + 0.012, p.z), q, s.set(k, 1, k)); rings.setMatrixAt(i, m);
      halos.setMatrixAt(i, m);
      const body = new THREE.Color(p.color).lerp(new THREE.Color('#2B3542'), p.lead ? 0.05 : 0.22);
      bodies.setColorAt(i, body);
      rings.setColorAt(i, new THREE.Color(theme.idle));
      halos.setColorAt(i, new THREE.Color(0, 0, 0));
      model.idx.set(p.id, i);
    });
    bodies.computeBoundingSphere(); heads.computeBoundingSphere();
    world.add(bodies, heads, rings, halos);
    model.people = people;
    Object.assign(model, { bodies, heads, rings, halos });

    // selection marker
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.43, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hdr('#FFFFFF', 1.6), transparent: true, depthWrite: false }));
    marker.visible = false;
    world.add(marker);
    model.marker = marker;

    // Department, Command and Library labels
    const front = new THREE.Vector3(1, 0, 1).normalize();
    const mkDeptLabel = (key, name, color, sub, x, z, R, off, kind) => {
      const meta = h('span', { class: 'lbl-meta' }, sub);
      const el = h('button', { type: 'button', class: `lbl lbl-dept${off ? ' is-off' : ''}`, 'aria-label': `Focus ${name}`, tabindex: '-1' },
        h('span', { class: 'lbl-swatch', style: { background: color } }),
        h('span', { class: 'lbl-name' }, name), off ? h('span', { class: 'lbl-chip' }, 'OFF') : null, meta);
      el.addEventListener('click', (e) => { e.stopPropagation(); if (hooks.onSelect) hooks.onSelect({ dept: key, kind }); });
      const rIn = R * COS30;
      addLabel('dept', el, new THREE.Vector3(x + front.x * rIn, 0, z + front.z * rIn), { dept: key });
      model.deptLabels.set(key, { el, meta, name });
    };
    if (org.boss) mkDeptLabel(org.boss.key, 'COMMAND', org.boss.color, `${org.boss.name} · ${1 + org.boss.teams.reduce((a, t) => a + t.people.length, 0)}`, 0, 0, hub.R, false, 'command');
    else mkDeptLabel('command', 'COMMAND', STATUS.live, 'no boss department', 0, 0, hub.R, false, 'command');
    mkDeptLabel('library', 'LIBRARY', LIB_COLOR, hooks.libraryMeta ? hooks.libraryMeta() : 'notes', lib.x, lib.z, lib.R, false, 'library');
    for (const b of layout.bays) {
      const d = org.byKey.get(b.dept);
      const count = (d.lead ? 1 : 0) + d.teams.reduce((a, t) => a + t.people.length, 0);
      mkDeptLabel(d.key, d.name, d.color, b.on ? `${count} people` : 'switched off', b.x, b.z, b.R, !b.on, 'bay');
    }

    // shadow camera covers the whole floor
    const bb = layout.bounds;
    const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ) / 2 + 3;
    const cx = (bb.minX + bb.maxX) / 2; const cz = (bb.minZ + bb.maxZ) / 2;
    key.position.set(cx - 14, 26, cz + 4);
    key.target.position.set(cx, 0, cz);
    rimLight.position.set(cx + 10, 8, cz - 12);
    Object.assign(key.shadow.camera, { left: -span * 1.25, right: span * 1.25, top: span * 1.25, bottom: -span * 1.25, near: 1, far: 90 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.mapSize.set(span > 18 ? 4096 : 2048, span > 18 ? 4096 : 2048);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }

    applyPresence();
    fit(false);
  }

  // ---- camera ----------------------------------------------------------
  function size() {
    const r = container.getBoundingClientRect();
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
  }

  function applyCamera() {
    const { w, h: hh } = size();
    const aspect = w / hh;
    camera.left = (-view.viewH * aspect) / 2; camera.right = (view.viewH * aspect) / 2;
    camera.top = view.viewH / 2; camera.bottom = -view.viewH / 2;
    camera.zoom = view.zoom;
    camera.position.copy(view.target).addScaledVector(VIEW_DIR, 120);
    camera.near = 1; camera.far = 400;
    camera.lookAt(view.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Height of the view that fits a set of ground circles.
  function fitHeight(items, pad = 1.12) {
    const { w, h: hh } = size();
    const aspect = w / hh;
    camera.position.copy(view.target).addScaledVector(VIEW_DIR, 120);
    camera.lookAt(view.target);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const it of items) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (const y of [0, it.hgt || 2.2]) {
          p.set(it.x + Math.cos(a) * it.R, y, it.z + Math.sin(a) * it.R).applyMatrix4(inv);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
      }
    }
    return { viewH: Math.max(maxY - minY, (maxX - minX) / aspect) * pad, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function centreOf(items) {
    // centre of the projected box, mapped back onto the ground
    const saved = view.target.clone();
    view.target.set(0, 0, 0);
    const f = fitHeight(items);
    camera.position.copy(view.target).addScaledVector(VIEW_DIR, 120);
    camera.lookAt(view.target);
    camera.updateMatrixWorld();
    const pt = new THREE.Vector3(f.cx, f.cy, -120).applyMatrix4(camera.matrixWorld);
    const ray = new THREE.Ray(pt, VIEW_DIR.clone().negate());
    const hit = new THREE.Vector3();
    ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    view.target.copy(saved);
    applyCamera();
    return { target: hit, viewH: f.viewH };
  }

  function animateTo(target, zoom, viewH, animate = true) {
    if (!animate || reduceMotion) {
      view.target.copy(target); view.zoom = zoom; if (viewH) view.viewH = viewH; view.tween = null; applyCamera(); return;
    }
    view.tween = { t0: performance.now(), from: view.target.clone(), to: target.clone(), z0: view.zoom, z1: zoom, h0: view.viewH, h1: viewH || view.viewH };
  }

  function allItems() {
    if (!model) return [{ x: 0, z: 0, R: 10 }];
    const items = [...model.bays.values()].map((b) => ({ x: b.x, z: b.z, R: b.R + 0.6, hgt: 2.2 }));
    return items;
  }

  let fitViewH = 30;
  function fit(animate = true) {
    const c = centreOf(allItems());
    fitViewH = c.viewH;
    // keep viewH as the fit reference; zoom 1 = everything visible
    animateTo(c.target, 1, fitViewH, animate);
  }

  function focusBay(key2, animate = true) {
    const b = model && model.bays.get(key2);
    if (!b) return;
    const c = centreOf([{ x: b.x, z: b.z, R: b.R + 0.4, hgt: 2.4 }]);
    animateTo(c.target, Math.max(1, Math.min(6, fitViewH / c.viewH)), fitViewH, animate);
  }

  // ---- interaction -----------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
  }
  function pick(clientX, clientY) {
    if (!model) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([model.bodies, model.heads], false);
    if (hits.length && hits[0].instanceId != null) {
      const p = model.people[hits[0].instanceId];
      if (p) return { person: p.id, dept: p.dept };
    }
    const tops = [];
    for (const b of model.bays.values()) if (b.group) tops.push(b.group.userData.top);
    const th = raycaster.intersectObjects(tops, false);
    if (th.length && th[0].object.userData.pick) return { ...th[0].object.userData.pick };
    return null;
  }

  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, anchor: groundAt(e.clientX, e.clientY), moved: false };
    view.tween = null;
  });
  el.addEventListener('pointermove', (e) => {
    if (drag && drag.id === e.pointerId) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved && drag.anchor) {
        const now = groundAt(e.clientX, e.clientY);
        if (now) { view.target.add(drag.anchor.clone().sub(now)); applyCamera(); }
      }
      return;
    }
    hover(e.clientX, e.clientY);
  });
  el.addEventListener('pointerup', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasClick = !drag.moved;
    drag = null;
    if (wasClick && hooks.onSelect) {
      const hit = pick(e.clientX, e.clientY);
      if (hit) hooks.onSelect(hit);
    }
  });
  el.addEventListener('pointerleave', () => { tip.hidden = true; });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = groundAt(e.clientX, e.clientY);
    view.tween = null;
    view.zoom = Math.max(0.5, Math.min(7, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    applyCamera();
    const after = groundAt(e.clientX, e.clientY);
    if (before && after) { view.target.add(before.sub(after)); applyCamera(); }
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const stepW = (view.viewH / view.zoom) * 0.08;
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const up = new THREE.Vector3(-1, 0, -1).normalize();
    let handled = true;
    if (e.key === 'ArrowLeft') view.target.addScaledVector(right, -stepW);
    else if (e.key === 'ArrowRight') view.target.addScaledVector(right, stepW);
    else if (e.key === 'ArrowUp') view.target.addScaledVector(up, stepW);
    else if (e.key === 'ArrowDown') view.target.addScaledVector(up, -stepW);
    else if (e.key === '+' || e.key === '=') view.zoom = Math.min(7, view.zoom * 1.2);
    else if (e.key === '-' || e.key === '_') view.zoom = Math.max(0.5, view.zoom / 1.2);
    else if (e.key === '0') { fit(); return void e.preventDefault(); }
    else handled = false;
    if (handled) { e.preventDefault(); view.tween = null; applyCamera(); }
  });

  let lastHover = 0;
  function hover(x, y) {
    const now = performance.now();
    if (now - lastHover < 40) return;
    lastHover = now;
    const hit = pick(x, y);
    el.style.cursor = hit ? 'pointer' : 'grab';
    if (hit && hit.person && model) {
      const info = model.org.people.get(hit.person);
      const st = presence.get(hit.person) || 'idle';
      clear(tip);
      tip.append(
        h('strong', null, info.person.name),
        h('span', { class: 'tip-sub' }, [info.team ? info.team.name : (info.person.isLead ? `${info.dept.name} LEAD` : info.dept.name)].join('')),
        info.person.role ? h('span', { class: 'tip-role' }, info.person.role) : null,
        h('span', { class: `tip-state tone-${st}` }, st.toUpperCase()),
      );
      const r = container.getBoundingClientRect();
      tip.style.transform = `translate(${Math.round(x - r.left + 14)}px, ${Math.round(y - r.top + 14)}px)`;
      tip.hidden = false;
    } else tip.hidden = true;
  }

  // ---- presence & pulses ----------------------------------------------
  const C = {
    working: new THREE.Color(STATUS.live), waiting: new THREE.Color(STATUS.waiting), error: new THREE.Color(STATUS.error),
  };
  function applyPresence() {
    if (!model) return;
    const counts = new Map();
    for (const p of model.people) {
      const st = presence.get(p.id) || 'idle';
      const c = counts.get(p.dept) || { working: 0, waiting: 0, error: 0 };
      if (st !== 'idle') c[st]++;
      counts.set(p.dept, c);
    }
    for (const [k2, lbl] of model.deptLabels) {
      const c = counts.get(k2);
      if (!c) continue;
      const parts = [];
      if (c.working) parts.push(`${c.working} working`);
      if (c.waiting) parts.push(`${c.waiting} waiting`);
      if (c.error) parts.push(`${c.error} refused`);
      if (!lbl.base) lbl.base = lbl.meta.textContent;
      lbl.meta.textContent = parts.length ? parts.join(' · ') : lbl.base;
      lbl.el.dataset.tone = c.error ? 'error' : c.waiting ? 'waiting' : c.working ? 'live' : 'idle';
    }
  }

  const pulseGeo = new THREE.SphereGeometry(0.09, 12, 8);
  const pulseMesh = new THREE.InstancedMesh(pulseGeo, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), 600);
  pulseMesh.count = 0;
  pulseMesh.frustumCulled = false;
  scene.add(pulseMesh);
  const pulses = [];
  const TRAIL = 7;

  function anchor(idOrKey) {
    if (!model) return null;
    if (idOrKey === 'command') return new THREE.Vector3(0, HUB_H + 1.0, 0);
    if (idOrKey === 'library') { const l = model.layout.library; return new THREE.Vector3(l.x, BAY_H + 0.9, l.z); }
    const i = model.idx.get(idOrKey);
    if (i != null) { const p = model.people[i]; return new THREE.Vector3(p.x, p.y + 0.95, p.z); }
    const b = model.bays.get(idOrKey);
    if (b) return new THREE.Vector3(b.x, (b.top || 0) + 1.0, b.z);
    return null;
  }

  function pulse(from, to, color = STATUS.live) {
    const a = anchor(from); const b = anchor(to);
    if (!a || !b || a.distanceTo(b) < 0.1 || pulses.length > 70) return;
    const dist = a.distanceTo(b);
    pulses.push({ a, b, t0: performance.now(), dur: (reduceMotion ? 300 : 650) + dist * 55, lift: 0.5 + dist * 0.09, color: hdr(color, 3.2) });
  }

  // ---- frame loop ------------------------------------------------------
  const tmpM = new THREE.Matrix4(); const tmpV = new THREE.Vector3(); const tmpS = new THREE.Vector3(); const tmpQ = new THREE.Quaternion(); const tmpC = new THREE.Color();
  let running = true; let last = performance.now();
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const t = now / 1000;

    if (view.tween) {
      const tw = view.tween;
      const k = Math.min(1, (now - tw.t0) / 650);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      view.target.lerpVectors(tw.from, tw.to, e);
      view.zoom = tw.z0 + (tw.z1 - tw.z0) * e;
      view.viewH = tw.h0 + (tw.h1 - tw.h0) * e;
      if (k >= 1) view.tween = null;
      applyCamera();
    }

    if (model) {
      if (!reduceMotion) {
        for (const s2 of model.strips) s2.material.map.offset.x -= dt * 0.55;
        model.halo[0].rotation.z += dt * 0.6; model.halo[1].rotation.z -= dt * 0.35;
        model.halo[0].position.y = HUB_H + 1.55 + Math.sin(t * 1.4) * 0.04;
      }
      // status rings
      const { rings, halos, people } = model;
      for (let i = 0; i < people.length; i++) {
        const st = presence.get(people[i].id) || 'idle';
        const phase = (t * 0.9 + i * 0.137) % 1;
        if (st === 'idle') {
          rings.setColorAt(i, tmpC.set(theme.idle));
          halos.setColorAt(i, tmpC.setRGB(0, 0, 0));
        } else {
          const base = C[st];
          const beat = st === 'working' ? 0.75 + 0.5 * Math.sin((t * 3.2) + i) : st === 'error' ? 1.3 : 1.05;
          rings.setColorAt(i, tmpC.copy(base).multiplyScalar(reduceMotion ? 1.4 : 1.1 + beat));
          if (st === 'working' && !reduceMotion) {
            const p = people[i]; const k = p.lead ? 1.16 : 1;
            const sc = k * (1 + phase * 1.1);
            tmpM.compose(tmpV.set(p.x, p.y + 0.01, p.z), tmpQ.identity(), tmpS.set(sc, 1, sc));
            halos.setMatrixAt(i, tmpM);
            halos.setColorAt(i, tmpC.copy(base).multiplyScalar((1 - phase) * 1.6));
          } else halos.setColorAt(i, tmpC.copy(base).multiplyScalar(st === 'error' ? 0.9 : 0.5));
        }
      }
      rings.instanceColor.needsUpdate = true;
      halos.instanceColor.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;

      if (selected.person != null && model.idx.has(selected.person)) {
        const p = model.people[model.idx.get(selected.person)];
        model.marker.visible = true;
        model.marker.position.set(p.x, p.y + 0.015, p.z);
        const k = 1 + 0.06 * Math.sin(t * 4);
        model.marker.scale.set(k, 1, k);
      } else model.marker.visible = false;
    }

    // pulses
    let n = 0;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const k = (now - p.t0) / p.dur;
      if (k > 1.15) { pulses.splice(i, 1); continue; }
      for (let j = 0; j < TRAIL && n < 600; j++) {
        const kk = Math.min(1, k - j * 0.035);
        if (kk < 0) break;
        tmpV.lerpVectors(p.a, p.b, kk);
        tmpV.y += Math.sin(Math.PI * kk) * p.lift;
        const fade = (1 - j / TRAIL) * (k > 1 ? Math.max(0, 1 - (k - 1) / 0.15) : 1);
        const sc = (j === 0 ? 1.15 : 1 - j / (TRAIL + 1));
        tmpM.compose(tmpV, tmpQ.identity(), tmpS.set(sc, sc, sc));
        pulseMesh.setMatrixAt(n, tmpM);
        pulseMesh.setColorAt(n, tmpC.copy(p.color).multiplyScalar(fade));
        n++;
      }
    }
    pulseMesh.count = n;
    if (n) { pulseMesh.instanceMatrix.needsUpdate = true; pulseMesh.instanceColor.needsUpdate = true; }

    composer.render();
    placeLabels();
  }

  const proj = new THREE.Vector3();
  function placeLabels() {
    if (!model) return;
    const { w, h: hh } = size();
    const zoomed = view.zoom >= 1.65;
    for (const l of model.labels) {
      let show = true;
      if (l.kind === 'team') show = zoomed || (selected.dept === l.dept && view.zoom >= 1.25);
      proj.copy(l.pos).project(camera);
      const x = Math.round(((proj.x + 1) / 2) * w);
      const y = Math.round(((1 - proj.y) / 2) * hh);
      if (x < -200 || x > w + 200 || y < -100 || y > hh + 100) show = false;
      if (show !== l.shown) { l.el.classList.toggle('is-hidden', !show); l.shown = show; }
      if (show && (x !== l.x || y !== l.y)) {
        l.el.style.transform = `translate(${x}px, ${y}px)`;
        l.x = x; l.y = y;
      }
    }
  }

  function resize() {
    const { w, h: hh } = size();
    renderer.setSize(w, hh, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${hh}px`;
    composer.setSize(w, hh);
    const pr = renderer.getPixelRatio();
    bloom.resolution.set(w * pr, hh * pr);
    applyCamera();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();
  requestAnimationFrame(frame);

  function setTheme(name) {
    theme = THEMES[name] || THEMES.dark;
    scene.background = new THREE.Color(theme.background);
    ground.material.color.set(theme.ground);
    dots.material.map.dispose();
    dots.material.map = dotTexture(theme.dots);
    dots.material.map.repeat.set(600 / 1.2, 600 / 1.2);
    dots.material.needsUpdate = true;
    ambient.intensity = theme.ambient;
    hemi.color.set(theme.hemiSky); hemi.groundColor.set(theme.hemiGround); hemi.intensity = theme.hemi;
    key.intensity = theme.key;
    bloom.strength = theme.bloom;
    if (model) build(model.org, model.layout);
  }

  return {
    setOrg(org, layout) { build(org, layout); },
    setPresence(map) { presence = map; applyPresence(); },
    pulse,
    focus(sel) {
      selected = { dept: sel && sel.dept ? sel.dept : null, person: sel && sel.person ? sel.person : null };
      if (model) for (const [k2, l] of model.deptLabels) l.el.classList.toggle('is-focus', k2 === selected.dept || (k2 === 'library' && sel && sel.kind === 'library'));
      if (!sel) { fit(); return; }
      if (sel.kind === 'library') focusBay('library');
      else if (sel.dept) focusBay(model && model.org.boss && sel.dept === model.org.boss.key ? 'command' : sel.dept);
    },
    reset() { selected = { dept: null, person: null }; if (model) for (const l of model.deptLabels.values()) l.el.classList.remove('is-focus'); fit(); },
    zoomBy(f) { view.tween = null; view.zoom = Math.max(0.5, Math.min(7, view.zoom * f)); applyCamera(); },
    setTheme,
    setLibraryMeta(text) { const l = model && model.deptLabels.get('library'); if (l) { l.base = text; l.meta.textContent = text; } },
    canvas: renderer.domElement,
    dispose() { running = false; ro.disconnect(); disposeWorld(); renderer.dispose(); },
  };
}

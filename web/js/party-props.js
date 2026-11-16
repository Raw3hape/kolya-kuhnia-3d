// Original toy-like targets. Layout is authored in party-props.json; independent
// breakable units use the ordinary bullet/fracture authority, including late join.
// Shared template geometry/materials keep the collection inexpensive and disposable.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assignNetworkObjectIds } from './network-objects.js';

export async function createPartyProps({ THREE, scene, requestRender = () => {}, spec = null }) {
  const layout = spec ?? await fetch('spec/party-props.json').then(r => { if (!r.ok) throw new Error('party props layout unavailable'); return r.json(); });
  const root = new THREE.Group(); root.name = 'party_props';
  const templates = new Map(), holders = [];
  const palette = layout.palette;
  const toyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.48, metalness: 0.04 });
  function template(kind) {
    if (templates.has(kind)) return templates.get(kind);
    const parts = new Map();
    function add(color, geometry, at = [0, 0, 0], scale = null, rot = null) {
      if (scale) geometry.scale(...scale);
      if (rot) { geometry.rotateX(rot[0]); geometry.rotateY(rot[1]); geometry.rotateZ(rot[2]); }
      geometry.translate(...at);
      // Primitives expose compatible attributes after conversion to triangles.
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (g !== geometry) geometry.dispose();
      if (!parts.has(color)) parts.set(color, []);
      parts.get(color).push(g);
    }
    const ball = (color, at, size) => add(color, new THREE.SphereGeometry(1, 10, 7), at, size);
    const box = (color, at, size, rot = null) => add(color, new THREE.BoxGeometry(...size), at, null, rot);
    const cylinder = (color, at, top, bottom, h) => add(color, new THREE.CylinderGeometry(top, bottom, h, 12), at);
    function eyes(y, z, separation = 0.045, size = 0.017) {
      for (const x of [-separation / 2, separation / 2]) { ball('white', [x, y, z], [size, size * 1.2, size * 0.4]); ball('ink', [x + 0.003, y - 0.001, z + size * 0.4], [size * 0.46, size * 0.6, size * 0.3]); }
    }
    function sunglasses(y, z) {
      for (const x of [-0.032, 0.032]) box('ink', [x, y, z], [0.047, 0.028, 0.013]);
      box('ink', [0, y + 0.004, z], [0.025, 0.008, 0.012]);
    }
    if (kind === 'tomato') {
      ball('tomato', [0, 0.075, 0], [0.083, 0.07, 0.077]);
      for (let i = 0; i < 5; i++) add('leaf', new THREE.ConeGeometry(0.025, 0.09, 3), [Math.sin(i * 1.256) * 0.025, 0.14, Math.cos(i * 1.256) * 0.025], null, [Math.PI * 0.38, i * 1.256, 0]);
      eyes(0.088, 0.071, 0.054);
      box('ink', [-0.029, 0.119, 0.071], [0.037, 0.008, 0.008], [0, 0, -0.25]);
      box('ink', [0.029, 0.119, 0.071], [0.037, 0.008, 0.008], [0, 0, 0.25]);
    } else if (kind === 'mug') {
      cylinder('cream', [0, 0.074, 0], 0.061, 0.052, 0.142);
      cylinder('coffee', [0, 0.148, 0], 0.048, 0.048, 0.003);
      add('cream', new THREE.TorusGeometry(0.04, 0.012, 6, 12), [0.068, 0.085, 0], null, [0, Math.PI / 2, 0]);
      eyes(0.095, 0.06, 0.047);
      ball('ink', [0, 0.044, 0.057], [0.014, 0.019, 0.005]);
    } else if (kind === 'duck') {
      ball('yellow', [0, 0.06, 0], [0.082, 0.055, 0.065]);
      ball('yellow', [0, 0.116, 0.026], [0.052, 0.05, 0.049]);
      ball('orange', [0, 0.104, 0.079], [0.035, 0.012, 0.029]);
      sunglasses(0.13, 0.071);
      add('yellow', new THREE.ConeGeometry(0.032, 0.07, 8), [0, 0.066, -0.066], null, [-0.7, 0, 0]);
    } else if (kind === 'piggy') {
      ball('pink', [0, 0.083, 0], [0.09, 0.07, 0.068]);
      for (const x of [-0.045, 0.045]) { ball('pink', [x, 0.025, 0.032], [0.02, 0.025, 0.022]); ball('pink', [x, 0.025, -0.033], [0.02, 0.025, 0.022]); add('pink', new THREE.ConeGeometry(0.025, 0.052, 3), [x, 0.15, 0.025]); }
      ball('snout', [0, 0.073, 0.068], [0.04, 0.026, 0.018]);
      for (const x of [-0.013, 0.013]) ball('ink', [x, 0.074, 0.086], [0.005, 0.008, 0.003]);
      eyes(0.11, 0.058, 0.052, 0.014); box('ink', [0, 0.153, 0], [0.051, 0.003, 0.006]);
    } else if (kind === 'ufo') {
      ball('mint', [0, 0.047, 0], [0.104, 0.024, 0.086]);
      ball('lavender', [0, 0.072, 0], [0.058, 0.044, 0.05]);
      for (const x of [-0.06, 0, 0.06]) ball('yellow', [x, 0.046, 0.071], [0.01, 0.009, 0.008]);
      for (const x of [-0.05, 0.05]) cylinder('chrome', [x, 0.019, 0], 0.006, 0.006, 0.03);
      eyes(0.089, 0.042, 0.037, 0.012);
    } else if (kind === 'mushroom') {
      cylinder('cream', [0, 0.062, 0], 0.029, 0.043, 0.12);
      ball('lavender', [0, 0.126, 0], [0.09, 0.042, 0.075]);
      for (const [x, z] of [[-0.044, 0.027], [0.035, 0.039], [0.012, -0.03]]) ball('cream', [x, 0.157, z], [0.014, 0.005, 0.013]);
      eyes(0.074, 0.031, 0.033, 0.011);
    } else if (kind === 'banana') {
      add('yellow', new THREE.TorusGeometry(0.073, 0.022, 6, 14, Math.PI * 1.1), [0.013, 0.09, 0], null, [0, 0, -1.7]);
      ball('coffee', [0.004, 0.014, 0], [0.02, 0.012, 0.019]);
      ball('coffee', [0.005, 0.167, 0], [0.02, 0.012, 0.019]);
      eyes(0.089, 0.02, 0.032, 0.011);
    } else if (kind === 'rocket') {
      cylinder('mint', [0, 0.105, 0], 0.035, 0.035, 0.14);
      add('tomato', new THREE.ConeGeometry(0.037, 0.065, 10), [0, 0.208, 0]);
      for (const x of [-0.045, 0.045]) box('tomato', [x, 0.037, 0], [0.025, 0.068, 0.026], [0, 0, x * -6]);
      ball('ink', [0, 0.132, 0.034], [0.025, 0.025, 0.006]);
      ball('blue', [0, 0.132, 0.039], [0.018, 0.018, 0.004]);
      eyes(0.078, 0.034, 0.029, 0.011);
    } else throw new Error(`Unknown party prop kind: ${kind}`);
    // Paint vertices before merging: one draw per target even without GPU batching,
    // one shared material for all toys, and fracture retains the original colours.
    const painted = [];
    for (const [color, geometries] of parts) {
      const tint = new THREE.Color(palette[color] ?? color);
      for (const g of geometries) {
        const colors = new Float32Array(g.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); painted.push(g);
      }
    }
    const geometry = mergeGeometries(painted, false); painted.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, toyMaterial); mesh.name = 'painted_toy';
    mesh.castShadow = false; mesh.receiveShadow = true;
    const group = new THREE.Group(); group.add(mesh);
    templates.set(kind, group); return group;
  }
  for (const item of layout.items) {
    const holder = new THREE.Group(); holder.name = `party_${item.id}`;
    const unit = template(item.kind).clone(); unit.name = `target_${item.id}`;
    unit.userData.breakable = item.material;
    unit.scale.setScalar(item.scale ?? 1);
    holder.add(unit); assignNetworkObjectIds(unit, `party-prop:${item.id}`);
    holders.push({ item, holder, unit }); root.add(holder);
  }
  scene.add(root);
  function updateAnchors(anchors, state = {}) {
    let changed = false;
    for (const { item, holder } of holders) {
      const a = item.anchor && anchors?.[item.anchor];
      let [x, y, z] = item.pos, yaw = (item.yaw ?? 0) * Math.PI / 180;
      if (a?.cur && a?.def) {
        const dx = x - a.def.x, dz = z - a.def.z, angle = a.cur.r - a.def.r, c = Math.cos(angle), s = Math.sin(angle);
        x = a.cur.x + dx * c + dz * s; z = a.cur.z - dx * s + dz * c; y += a.cur.y - a.def.y; yaw += angle;
      }
      const shown = a !== null && !(item.when && !item.when.values.includes(state[item.when.key])) &&
        !(a?.span && (z < a.span.z0 + 0.08 || z > a.span.z1 - 0.08));
      if (holder.position.x !== x || holder.position.y !== y || holder.position.z !== z || holder.rotation.y !== yaw || holder.visible !== shown) {
        holder.position.set(x, y, z); holder.rotation.y = yaw; holder.visible = shown; changed = true;
      }
    }
    if (changed) requestRender();
  }
  updateAnchors();
  return {
    updateAnchors,
    debug: { root, holders, count: holders.length },
    dispose() {
      scene.remove(root);
      for (const template of templates.values()) template.traverse(o => o.geometry?.dispose());
      toyMaterial.dispose();
      templates.clear(); holders.length = 0;
    },
  };
}

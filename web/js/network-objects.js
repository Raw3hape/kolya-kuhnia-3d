// Stable scene identities. Asset IDs are assigned once, synchronously after GLTFLoader
// resolves: asynchronous arrival order and Three.js UUIDs never enter the protocol.
const enc = s => encodeURIComponent(String(s));
const quant = n => Math.round((Number(n) || 0) * 100000) / 100000;
const hashPath = text => {
  let a = 2166136261, b = 3339675911;
  for (const c of text) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b ^ c.charCodeAt(0), 2246822519); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
};

function localKey(o) {
  if (o.name && !(o.parent?.children ?? []).some(sibling => sibling !== o && sibling.name === o.name)) return enc(o.name);
  const p = o.position ?? {}, q = o.quaternion ?? {}, s = o.scale ?? {};
  const shape = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].map(quant).join(',');
  const g = o.geometry, n = g?.attributes?.position?.count ?? 0;
  return `${enc(o.name || o.type || 'node')}@${shape}:${n}:${g?.index?.count ?? 0}`;
}

export function assignNetworkObjectIds(root, identity) {
  const visit = (o, path) => {
    o.userData ??= {};
    o.userData.networkId = `${identity}/${hashPath(path)}`;
    for (const child of o.children ?? []) {
      if (isTransient(child)) continue;
      visit(child, `${path}/${localKey(child)}`);
    }
  };
  visit(root, 'asset');
}

export function isTransient(o) {
  const u = o.userData ?? {};
  return !!(u.impact || u.shard || u.decorStub || u.shadowOnly || u.networkAvatar || u.networkEffect || u.networkEntity || u.viewmodel);
}

export function stableObjectId(o) {
  if (!o || isTransient(o)) return null;
  if (o.userData?.networkId) return o.userData.networkId;
  const path = [];
  for (let x = o; x && !x.isScene; x = x.parent) {
    if (isTransient(x)) return null;
    if (x.userData?.networkId) return `${x.userData.networkId}/${hashPath(path.reverse().join('/'))}`;
    // Fixed scene geometry is created synchronously from the authored plan. Local
    // transforms distinguish unnamed wall faces without indexing scene children.
    path.push(localKey(x));
  }
  return path.length ? `scene/${hashPath(path.reverse().join('/'))}` : null;
}

export function findNetworkObject(scene, id) {
  let found = null;
  scene.traverse(o => { if (!found && stableObjectId(o) === id) found = o; });
  return found;
}

export function indexNetworkObjects(scene) {
  const index = new Map();
  scene.traverse(o => { const id = stableObjectId(o); if (id && !index.has(id)) index.set(id, o); });
  return index;
}

// A generic policy covers present and future loose models and every option. The
// exceptional material of a named mesh may be authored in break.json; inclusion
// does not depend on maintaining a per-model whitelist.
export const DEFAULT_LOOSE_POLICY = {
  modelPrefixes: ['models/decor/props/'],
  modelPatterns: ['-toy/', '/figs-', '/cat-cloudy/'],
  slots: ['counter', 'island', 'decor', 'computer', 'lamp', 'plant', 'art', 'console', 'joke', 'lanterns', 'planter', 'corner'],
  materials: [
    { pattern: 'book|paper|newspaper|print|pjatteryd|blodflader|knoppang', type: 'paper' },
    { pattern: 'bedding|cushion|sheepskin|throw|cloth|fabric|pillow|curtain', type: 'cloth' },
    { pattern: 'board|wood|knagglig|trummis|elephant', type: 'wood' },
    { pattern: '(^|[\\s_./-])pot([\\s_.:/-]|$)|ceramic|porcelain|stone|marble|concrete|shell', type: 'ceramic' },
    { pattern: 'plant|fejka|yucca|strelitzia|dypsis|vinterfint|foliage|leaf|smycka|eucalyptus', type: 'foliage' },
    { pattern: 'bottle|jar|glass|pelarbjork|lantern', type: 'glass' },
    { pattern: 'kettle|utensil|bronze|tin|metal|robot|camera|clock', type: 'metal' },
  ],
  fallback: 'plastic',
};

export function loosePropMaterial(model, { slot = '', nodeName = '', materialName = '', policy = DEFAULT_LOOSE_POLICY } = {}) {
  if (typeof model !== 'string') return null;
  const loose = policy.modelPrefixes.some(p => model.startsWith(p)) ||
    policy.modelPatterns.some(p => model.includes(p)) || policy.slots.includes(slot);
  if (!loose) return null;
  const text = `${nodeName} ${materialName} ${model}`.toLowerCase();
  for (const rule of policy.materials) if (new RegExp(rule.pattern, 'i').test(text)) return rule.type;
  return policy.fallback;
}

export function collectNetworkObjects(scene, THREE, { breakableOf = () => null, dependentIdsOf = () => [], maxObjects = 6000 } = {}) {
  scene.updateMatrixWorld(true);
  const objects = [], known = new Set(), box = new THREE.Box3();
  scene.traverse(o => {
    if (objects.length >= maxObjects || !o.isMesh || isTransient(o) || o.userData?.noNetwork) return;
    for (let x = o.parent; x; x = x.parent) if (isTransient(x)) return;
    const id = stableObjectId(o);
    if (!id || known.has(id)) return;
    const geom = o.geometry;
    if (!geom?.attributes?.position) return;
    if (!geom.boundingBox) geom.computeBoundingBox();
    box.copy(geom.boundingBox).applyMatrix4(o.matrixWorld);
    if (box.isEmpty() || ![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) return;
    const b = breakableOf(o), glass = !!(o.userData?.glass && o.userData.shatter !== false);
    const mirror = !!(o.userData?.mirror || o.userData?.mirrorGlass || o.userData?.networkMirror);
    known.add(id);
    objects.push({ id, bounds: [...box.min.toArray(), ...box.max.toArray()].map(quant),
      breakable: b?.type ?? (glass || mirror ? 'glass' : null), unitId: stableObjectId(b?.unit ?? o), glass,
      dependentIds: dependentIdsOf(o), mirror, visible: o.visible !== false });
  });
  return objects;
}

export function seededRandom(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => {
    n |= 0; n = n + 0x6d2b79f5 | 0;
    let t = Math.imul(n ^ n >>> 15, 1 | n);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

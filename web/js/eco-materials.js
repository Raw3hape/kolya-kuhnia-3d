// Scoped, precompiled Lambert substitutes for the explicitly flat eco preset.
// Gameplay, path tracing, export and every other quality retain authored PBR.
import { warmRasterPrograms } from './shader-warmup.js';
import { acquireSceneIndex } from './scene-index.js';
import { ECO_MAPS as MAPS, ECO_VALUES as VALUES, ECO_DEFINES as DEFINES, ecoMaterialEligible, createEcoMaterial } from './eco-material-state.js';
const MAX_COMPILING = 4, DISCOVERY_MS = 350;

export function createEcoMaterials({ THREE, scene, renderer }) {
  const index = acquireSceneIndex(scene), blockedChains = new WeakMap();
  const variants = new Map(), geometryLayouts = new WeakMap(), objectLayouts = new WeakMap(), queue = [], queued = new Set();
  const materialStates = new WeakMap(), replacementArrays = new WeakMap();
  const changedObjects = [], changedMaterials = [], drawStack = [];
  let frame = 0, depth = 0, compiling = 0, compileEpoch = 0, lost = false, disposed = false, camera = null, lights = '';
  let dirty = true, lastDiscovery = -Infinity;
  let knownLights = [];
  const compileValues = new Set(DEFINES);
  const blocked = o => {
    const u = o.userData || {};
    return u.glass || u.mirror || u.mirrorGlass || u.networkMirror || u.screen || u.tvScreen || u.shadowOnly ||
      u.context || u.viewmodel || u.networkAvatar || u.networkEffect || u.impact || u.shard;
  };
  function chainBlocked(object) {
    let state = blockedChains.get(object);
    if (!state) { state = { frame: -1, blocked: false }; blockedChains.set(object, state); }
    if (state.frame !== frame) {
      state.blocked = blocked(object) || (object !== scene && (!object.parent || chainBlocked(object.parent)));
      state.frame = frame;
    }
    return state.blocked;
  }
  const meshCallbacks = THREE.Object3D.prototype, batchCallbacks = THREE.BatchedMesh.prototype;
  function objectOK(o) {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.morphTargetInfluences?.length) return false;
    for (const key in o.geometry?.morphAttributes) if (Object.hasOwn(o.geometry.morphAttributes, key)) return false;
    const callbacks = o.isBatchedMesh ? batchCallbacks : meshCallbacks;
    return o.onBeforeRender === callbacks.onBeforeRender && o.onAfterRender === callbacks.onAfterRender &&
      o.onBeforeShadow === callbacks.onBeforeShadow && o.onAfterShadow === callbacks.onAfterShadow;
  }
  const materialOK = m => ecoMaterialEligible(THREE, m);
  function materialCurrent(m) {
    if (!m || typeof m !== 'object') return false;
    let state = materialStates.get(m);
    if (!state) { state = { frame: -1, value: false }; materialStates.set(m, state); }
    if (state.frame !== frame) { state.frame = frame; state.value = materialOK(m); }
    return state.value;
  }
  function layout(o) {
    const geometry = o.geometry, attributes = geometry.attributes;
    let shape = geometryLayouts.get(geometry);
    if (!shape || shape.frame !== frame) {
      let count = 0; for (const key in attributes) count++;
      let same = shape && count === shape.items.length;
      if (same) for (let i = 0; i < shape.items.length; i++) {
        const item = shape.items[i], attribute = item[1];
        if (attributes[item[0]] !== attribute || attribute.itemSize !== item[2]) { same = false; break; }
      }
      if (!same) {
        const items = Object.keys(attributes).sort().map(key => [key, attributes[key], attributes[key].itemSize]);
        shape = { frame, items, key: items.map(([key, , size]) => `${key}:${size}`).join(',') }; geometryLayouts.set(geometry, shape);
      } else shape.frame = frame;
    }
    let cached = objectLayouts.get(o);
    const batch = !!o.isBatchedMesh, colors = !!o._colorsTexture;
    if (!cached || cached.shape !== shape || cached.batch !== batch || cached.colors !== colors) {
      cached = { shape, batch, colors, key: `${batch ? 'batch' : 'mesh'}:${colors}:${shape.key}` }; objectLayouts.set(o, cached);
    }
    return cached.key;
  }
  function enqueue(record, program) {
    if (record.dead || program.ready || program.pending || program.failed || queued.has(program)) return;
    queued.add(program); queue.push([record, program]);
  }
  function sync(record, original) {
    if (record.frame === frame) return;
    record.frame = frame;
    const flat = record.flat;
    if (!flat.color.equals(original.color)) flat.color.copy(original.color);
    if (!flat.emissive.equals(original.emissive)) flat.emissive.copy(original.emissive);
    if (!flat.blendColor.equals(original.blendColor)) flat.blendColor.copy(original.blendColor);
    let changed = record.version !== original.version || flat.onBeforeCompile !== original.onBeforeCompile || flat.customProgramCacheKey !== original.customProgramCacheKey;
    const alphaTest = original.alphaTest > 0, clips = original.clippingPlanes?.length || 0;
    if (record.alphaTest !== alphaTest || record.clips !== clips) changed = true;
    record.alphaTest = alphaTest; record.clips = clips; record.version = original.version;
    for (let i = 0; i < MAPS.length; i++) {
      const key = MAPS[i], map = original[key], channel = map?.channel ?? 0;
      if (flat[key] !== map || record.channels[i] !== channel) changed = true;
      flat[key] = map; record.channels[i] = channel;
    }
    for (const key of VALUES) if (flat[key] !== original[key]) {
      if (compileValues.has(key)) changed = true;
      flat[key] = original[key];
    }
    flat.onBeforeCompile = original.onBeforeCompile;
    flat.customProgramCacheKey = original.customProgramCacheKey;
    if (changed) {
      flat.needsUpdate = true;
      for (const program of record.programs.values()) { program.ready = false; program.generation++; program.failed = false; enqueue(record, program); }
    }
  }
  function get(original) {
    let record = variants.get(original);
    if (!record) {
      const flat = createEcoMaterial(THREE, original);
      record = { flat, programs: new Map(), channels: [], version: -1, frame: -1, seen: frame, dead: false };
      variants.set(original, record);
    }
    record.seen = frame; sync(record, original); return record;
  }
  function prepare(record, object) {
    const key = layout(object);
    let program = record.programs.get(key);
    if (!program) { program = { ready: false, pending: false, failed: false, generation: 0, lights, object, key }; record.programs.set(key, program); }
    program.object = object; program.seen = frame;
    if (program.lights !== lights) { program.lights = lights; program.ready = false; program.failed = false; program.generation++; }
    enqueue(record, program);
    return program;
  }
  function compile(record, program) {
    if (lost || program.pending || program.ready || program.failed || compiling >= MAX_COMPILING || !camera) return;
    if (!renderer.compileAsync && (!renderer.compile || !renderer.properties)) { program.failed = true; return; }
    const generation = program.generation, epoch = compileEpoch;
    const object = Object.assign(Object.create(program.object), { material: record.flat, children: [] });
    program.pending = true; compiling++;
    let result;
    try { result = warmRasterPrograms(renderer, object, camera, scene, { cancelled: () => disposed || record.dead || lost || generation !== program.generation || epoch !== compileEpoch }); }
    catch { program.failed = true; program.pending = false; compiling--; return; }
    Promise.resolve(result).then(ready => {
      if (!disposed && !record.dead && generation === program.generation && ready === true) program.ready = true;
    }).catch(() => { if (generation === program.generation) program.failed = true; })
      .finally(() => { if (epoch === compileEpoch) { program.pending = false; compiling--; enqueue(record, program); } });
  }
  function update(nextCamera) {
    if (disposed) return;
    if (nextCamera) camera = nextCamera;
    frame++;
    if (knownLights.some(light => light.visible !== lightVisible(light.object) || light.cast !== light.object.castShadow || light.map !== !!light.object.map)) dirty = true;
    const now = performance.now();
    if (!dirty && now - lastDiscovery < DISCOVERY_MS) { processQueue(); return; }
    dirty = false; lastDiscovery = now;
    const counts = new Map();
    // Count the complete lighting layout before preparing any shader variants.
    knownLights = [];
    for (const o of index.lights()) {
      const visible = lightVisible(o); knownLights.push({ object: o, visible, cast: o.castShadow, map: !!o.map });
      if (visible) { const key = `${o.type}:${!!o.castShadow}:${!!o.map}`; counts.set(key, (counts.get(key) || 0) + 1); }
    }
    lights = [...counts].sort().map(([key, count]) => `${key}:${count}`).join('|'); counts.clear();
    // The shared index already tracks async subtree loads/removals. Avoid two
    // recursive full-scene walks; only renderable objects can need a variant.
    for (const o of index.materialObjects) if (objectOK(o) && !chainBlocked(o))
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) if (materialOK(material)) prepare(get(material), o);
    for (const [original, record] of variants) {
      if (record.seen !== frame) { record.dead = true; record.flat.dispose(); variants.delete(original); continue; }
      for (const [key, program] of record.programs) {
        if (program.seen !== frame) record.programs.delete(key);
        else enqueue(record, program);
      }
    }
    processQueue();
  }
  function processQueue() {
    if (lost) return;
    while (compiling < MAX_COMPILING && queue.length) {
      const [record, program] = queue.shift(); queued.delete(program);
      if (!record.dead && record.programs.get(program.key) === program) compile(record, program);
    }
  }
  function lightVisible(light) {
    if (camera && !light.layers.test(camera.layers)) return false;
    for (let parent = light; parent; parent = parent.parent) { if (!parent.visible) return false; if (parent === scene) return true; }
    return false;
  }
  function draw(fn) {
    if (disposed || depth) return fn();
    changedObjects.length = changedMaterials.length = drawStack.length = 0;
    depth++; frame++;
    try {
      function substitute(original, object) {
        if (!materialCurrent(original)) return original;
        const record = variants.get(original); if (!record) { dirty = true; return original; }
        sync(record, original);
        const program = record.programs.get(layout(object));
        if (!program) dirty = true;
        return program?.ready ? record.flat : original;
      }
      drawStack.push(scene);
      while (drawStack.length) {
        const o = drawStack.pop();
        if (!o.visible || blocked(o)) continue;
        if (objectOK(o)) {
          const original = o.material;
          let replacement, changed = false;
          if (Array.isArray(original)) {
            replacement = replacementArrays.get(o);
            if (!replacement) { replacement = []; replacementArrays.set(o, replacement); }
            replacement.length = original.length;
            for (let i = 0; i < original.length; i++) {
              replacement[i] = substitute(original[i], o);
              if (replacement[i] !== original[i]) changed = true;
            }
          } else { replacement = substitute(original, o); changed = replacement !== original; }
          if (changed) { changedObjects.push(o); changedMaterials.push(original); o.material = replacement; }
        }
        for (let i = o.children.length - 1; i >= 0; i--) drawStack.push(o.children[i]);
      }
      return fn();
    } finally {
      for (let i = 0; i < changedObjects.length; i++) changedObjects[i].material = changedMaterials[i];
      changedObjects.length = changedMaterials.length = drawStack.length = 0; depth--;
    }
  }
  function resetPrograms() {
    compileEpoch++; compiling = 0; queue.length = 0; queued.clear(); dirty = true;
    for (const record of variants.values()) for (const p of record.programs.values()) { p.generation++; p.ready = p.pending = p.failed = false; enqueue(record, p); }
  }
  const onLost = () => { lost = true; resetPrograms(); }, onRestored = () => { lost = false; resetPrograms(); };
  renderer.domElement?.addEventListener?.('webglcontextlost', onLost);
  renderer.domElement?.addEventListener?.('webglcontextrestored', onRestored);
  return { update, draw,
    get stats() { let ready = 0, programs = 0, failed = 0; for (const record of variants.values()) for (const p of record.programs.values()) { programs++; if (p.ready) ready++; if (p.failed) failed++; }
      return { materials: variants.size, programs, ready, failed, compiling }; },
    dispose() { if (disposed) return; disposed = true; compileEpoch++; compiling = 0; queue.length = 0; queued.clear();
      renderer.domElement?.removeEventListener?.('webglcontextlost', onLost); renderer.domElement?.removeEventListener?.('webglcontextrestored', onRestored);
      for (const record of variants.values()) { record.dead = true; record.flat.dispose(); } variants.clear(); index.release(); },
  };
}

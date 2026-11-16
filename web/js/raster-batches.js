// Raster-only proxies. The authored scene remains the gameplay/raycast/export
// source of truth and is restored synchronously after every draw, including errors.
import { warmRasterPrograms } from './shader-warmup.js';
import { ECO_BATCH_KEYS, ECO_MAPS, ecoMaterialEligible, createEcoMaterial } from './eco-material-state.js';

const SCAN_MS = 750, MAX_VERTICES = 1_500_000, COMPILE_RETRY_MS = 250, MAX_COMPILE_ATTEMPTS = 4;

export function createRasterBatches({ THREE, scene, renderer, quality = 'high' }) {
  const supported = !!renderer.extensions?.has?.('WEBGL_multi_draw');
  const root = new THREE.Group(); root.name = 'raster_batches'; root.visible = false;
  root.matrixAutoUpdate = root.matrixWorldAutoUpdate = false; // proxy matrices are already in world coordinates.
  Object.assign(root.userData, { networkEntity: true, rasterOnly: true, noPick: true, noNetwork: true });
  const groups = new Map(), ids = new WeakMap();
  const materialKeys = new WeakMap(), geometryKeys = new WeakMap(), ecoHooks = new WeakMap();
  const geometryGuards = new WeakMap(), chainStates = new WeakMap(), opaqueStates = new WeakMap();
  const hidden = [], shown = [], collapsed = [];
  let sources = [], descriptions = new Map(), serial = 0, lastScan = -Infinity, dirty = true, disposed = false, depth = 0;
  let vertices = 0, rebuilds = 0, camera = null, materialFrame = 0;
  let describedCount = 0, reusedCount = 0;
  let ecoMode = quality === 'eco', lost = false, compileEpoch = 0;
  const id = object => { if (!ids.has(object)) ids.set(object, ++serial); return ids.get(object); };
  const marked = o => {
    const u = o.userData || {};
    return u.networkEntity || u.networkAvatar || u.networkEffect || u.viewmodel || u.impact || u.shard || u.decorStub ||
      u.mirror || u.mirrorGlass || u.networkMirror || u.glass || u.screen || u.tvScreen || u.shadowOnly || u.noPick || u.noNetwork || u.context;
  };
  const callbacks = THREE.Object3D.prototype;
  const plainCallbacks = o => o.onBeforeRender === callbacks.onBeforeRender && o.onAfterRender === callbacks.onAfterRender &&
    o.onBeforeShadow === callbacks.onBeforeShadow && o.onAfterShadow === callbacks.onAfterShadow;
  const opaque = m => m && !m.isShaderMaterial && !m.isRawShaderMaterial && !m.transparent && !(m.transmission > 0) && !(m.opacity < 1);
  function opaqueCurrent(m) {
    let state = opaqueStates.get(m);
    if (!state) { state = { frame: -1, value: false }; opaqueStates.set(m, state); }
    if (state.frame !== materialFrame) { state.frame = materialFrame; state.value = opaque(m); }
    return state.value;
  }
  function chainState(o) {
    let state = chainStates.get(o);
    if (!state) { state = { frame: -1, bits: 0 }; chainStates.set(o, state); }
    if (state.frame === materialFrame) return state.bits;
    let bits = o === scene ? 3 : o.parent ? chainState(o.parent) : 0;
    if (!o.visible) bits &= ~2;
    if (marked(o)) bits |= 4;
    state.frame = materialFrame; state.bits = bits; return bits;
  }
  function collapseParents(object) {
    // After all guards run, a non-rendering container whose children are all
    // hidden contributes nothing. Prune that exact empty subtree for the actual
    // renderer and the nested eco pass; restore its original flag in finally.
    while (object && object !== scene && object.visible && (object.isGroup || object.type === 'Object3D') &&
      !object.isMesh && !object.isLine && !object.isPoints && !object.isSprite && !object.isLight && !object.isLOD) {
      let state = chainStates.get(object);
      if (!state) { state = { frame: -1, bits: 0 }; chainStates.set(object, state); }
      if (state.collapseFrame === materialFrame) return;
      state.collapseFrame = materialFrame;
      for (let i = 0; i < object.children.length; i++) if (object.children[i].visible) return;
      collapsed.push(object); object.visible = false;
      object = object.parent;
      // A child container just changed visibility, so a previous unsuccessful
      // ancestor attempt may now succeed. Leaf-source attempts remain cached.
      const parentState = object && chainStates.get(object);
      if (parentState) parentState.collapseFrame = -1;
    }
  }
  function attributeState(a) {
    return { object: a, data: a.data, array: a.array, version: a.data?.version ?? a.version,
      itemSize: a.itemSize, normalized: a.normalized, gpuType: a.gpuType, count: a.count, offset: a.offset, stride: a.data?.stride };
  }
  function attributeCurrent(a, state) {
    return a === state.object && a.data === state.data && a.array === state.array && (a.data?.version ?? a.version) === state.version &&
      a.itemSize === state.itemSize && a.normalized === state.normalized && a.gpuType === state.gpuType &&
      a.count === state.count && a.offset === state.offset && a.data?.stride === state.stride;
  }
  function geometryCurrent(state) {
    if (state.frame === materialFrame) return state.valid;
    state.frame = materialFrame;
    const g = state.geometry;
    let valid = g.index === state.index && (!g.index || attributeCurrent(g.index, state.indexState)) && g.drawRange.start === state.start &&
      g.drawRange.count === state.count && g.groups.length === state.ranges.length;
    if (valid) {
      let count = 0; for (const key in g.attributes) count++;
      valid = count === state.attributes.length;
    }
    if (valid) for (let i = 0; i < state.ranges.length; i++) {
      const range = state.ranges[i], group = g.groups[i];
      if (group.start !== range[0] || group.count !== range[1] || group.materialIndex !== range[2]) { valid = false; break; }
    }
    if (valid) for (let i = 0; i < state.attributes.length; i++) {
      const entry = state.attributes[i];
      if (!attributeCurrent(g.attributes[entry[0]], entry[1])) { valid = false; break; }
    }
    if (valid) for (const key in g.morphAttributes) if (Object.hasOwn(g.morphAttributes, key)) { valid = false; break; }
    state.valid = valid; return valid;
  }
  function geometryGuard(g) {
    let state = geometryGuards.get(g);
    if (state && geometryCurrent(state)) return state;
    state = { geometry: g, frame: -1, valid: false, index: g.index, indexState: g.index && attributeState(g.index),
      start: g.drawRange.start, count: g.drawRange.count, ranges: g.groups.map(p => [p.start, p.count, p.materialIndex]),
      attributes: Object.entries(g.attributes).map(([key, a]) => [key, attributeState(a)]) };
    geometryGuards.set(g, state); return state;
  }
  const ignoredMaterialKeys = new Set(['id', 'uuid', 'name', 'version', 'userData', '_listeners', 'color', 'onBeforeCompile', 'customProgramCacheKey']);
  function captureValue(v) {
    if (!v || typeof v !== 'object' || v.isTexture) return { kind: 0, value: v };
    let keys;
    if (v.isColor) keys = ['r', 'g', 'b'];
    else if (v.isVector2) keys = ['x', 'y'];
    else if (v.isVector3) keys = ['x', 'y', 'z'];
    else if (v.isVector4 || v.isQuaternion) keys = ['x', 'y', 'z', 'w'];
    else if (v.isEuler) keys = ['x', 'y', 'z', 'order'];
    else if (v.isMatrix3 || v.isMatrix4) keys = ['elements'];
    else if (v.isPlane) keys = ['normal', 'constant'];
    else if (Array.isArray(v)) return { kind: 2, values: v.map(captureValue) };
    else if (Object.getPrototypeOf(v) === Object.prototype) {
      keys = Object.keys(v); return { kind: 3, keys, values: keys.map(key => captureValue(v[key])) };
    } else return { kind: 0, value: v };
    if (v.isColor || v.isVector2 || v.isVector3 || v.isVector4 || v.isQuaternion || v.isEuler)
      return { kind: 4, proto: Object.getPrototypeOf(v), keys, values: keys.map(key => v[key]) };
    return { kind: 1, proto: Object.getPrototypeOf(v), keys, values: keys.map(key => captureValue(v[key])) };
  }
  function valueMatches(v, s) {
    if (s.kind === 0) return Object.is(v, s.value);
    if (!v || typeof v !== 'object') return false;
    if (s.kind === 2) {
      if (!Array.isArray(v) || v.length !== s.values.length) return false;
      for (let i = 0; i < s.values.length; i++) if (!valueMatches(v[i], s.values[i])) return false;
      return true;
    }
    if (s.kind === 4) {
      if (Object.getPrototypeOf(v) !== s.proto) return false;
      for (let i = 0; i < s.keys.length; i++) if (!Object.is(v[s.keys[i]], s.values[i])) return false;
      return true;
    }
    if (s.kind === 1 && Object.getPrototypeOf(v) !== s.proto || s.kind === 3 &&
      (Object.getPrototypeOf(v) !== Object.prototype || Object.keys(v).length !== s.keys.length)) return false;
    for (let i = 0; i < s.keys.length; i++) if (!valueMatches(v[s.keys[i]], s.values[i])) return false;
    return true;
  }
  function semanticValue(v) {
    if (typeof v === 'number' && !Number.isFinite(v)) return ['number', String(v)];
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (v.isTexture) return ['texture', id(v)];
    if (v.isColor) return ['color', v.r, v.g, v.b];
    if (v.isVector2 || v.isVector3 || v.isVector4 || v.isMatrix3 || v.isMatrix4 || v.isEuler || v.isQuaternion) return v.toArray();
    if (v.isPlane) return ['plane', v.normal.x, v.normal.y, v.normal.z, v.constant];
    if (Array.isArray(v)) return v.map(semanticValue);
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
      return Object.keys(v).sort().map(key => [key, semanticValue(v[key])]);
    return ['identity', id(v)]; // unknown objects/functions never become accidentally equivalent.
  }
  function semanticKey(m) {
    let cached = materialKeys.get(m);
    if (cached?.frame === materialFrame) return cached.key;
    const defaultHooks = m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
    const roomHooks = m.userData.roomLightingPatched && m.userData.roomLightingBatchSafe;
    const flat = ecoMode && ecoMaterialEligible(THREE, m);
    let key = null;
    if (m.isMeshStandardMaterial && opaque(m) && m.color?.isColor && (defaultHooks || roomHooks) &&
      m.onBeforeRender === THREE.Material.prototype.onBeforeRender) {
      const ownKeys = flat ? ECO_BATCH_KEYS : Object.keys(m);
      if (cached?.checks && cached.flat === flat && cached.hook === m.onBeforeCompile && cached.programKey === m.customProgramCacheKey && cached.roomHooks === !!roomHooks) {
        let unchanged = ownKeys.length === cached.ownKeys.length;
        if (unchanged) for (let i=0;i<ownKeys.length;i++) if (ownKeys[i] !== cached.ownKeys[i]) { unchanged=false; break; }
        if (unchanged) for (const check of cached.checks) {
          const next = m[check.name], state = check.state;
          if (state.kind === 0 ? !Object.is(next, state.value) : !valueMatches(next, state)) { unchanged = false; break; }
        }
        if (unchanged && flat) for (let i = 0; i < ECO_MAPS.length; i++) if ((m[ECO_MAPS[i]]?.channel ?? 0) !== cached.channels[i]) { unchanged = false; break; }
        if (unchanged) { cached.frame = materialFrame; return cached.key; }
      }
      const channels = flat ? ECO_MAPS.map(key => m[key]?.channel ?? 0) : null;
      const values = [['representation', flat ? 'eco' : 'pbr']];
      // PBR keeps its complete semantics. Eco groups only by the exact state of
      // the Lambert representation it actually draws, never by discarded BRDFs.
      const checks = [];
      for (const name of ownKeys.slice().sort()) if (!ignoredMaterialKeys.has(name)) {
        values.push([name, semanticValue(m[name])]); checks.push({ name, state: captureValue(m[name]) });
      }
      if (flat) {
        values.push(['mapChannels', channels]);
        let hooks = ecoHooks.get(m);
        if (!hooks) { hooks = { hook: m.onBeforeCompile, key: m.customProgramCacheKey }; ecoHooks.set(m, hooks); }
        // The safe room patch is equivalent across authored materials. A later
        // ad-hoc hook replacement must not inherit that equivalence accidentally.
        values.push(['hookOverride', hooks.hook === m.onBeforeCompile && hooks.key === m.customProgramCacheKey ? 0 :
          `${id(m.onBeforeCompile)}:${id(m.customProgramCacheKey)}`]);
      }
      values.push(['roomLighting', !!roomHooks]); key = JSON.stringify(values);
      materialKeys.set(m, { frame: materialFrame, key, flat, channels, checks, ownKeys, hook: m.onBeforeCompile, programKey: m.customProgramCacheKey, roomHooks: !!roomHooks }); return key;
    }
    materialKeys.set(m, { frame: materialFrame, key }); return key;
  }
  function safeMatrix(m) {
    const e = m.elements, a = e[0] ** 2 + e[1] ** 2 + e[2] ** 2, b = e[4] ** 2 + e[5] ** 2 + e[6] ** 2, c = e[8] ** 2 + e[9] ** 2 + e[10] ** 2;
    return a > 1e-20 && b > 1e-20 && c > 1e-20 && m.determinant() >= 0 &&
      Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) <= 1e-5 * Math.sqrt(a * b) &&
      Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) <= 1e-5 * Math.sqrt(a * c) &&
      Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) <= 1e-5 * Math.sqrt(b * c);
  }
  function eligible(o) {
    if (!o.isMesh || o.children.length || o.frustumCulled === false || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || !plainCallbacks(o) ||
      !o.geometry?.attributes.position || o.morphTargetInfluences?.length || Object.keys(o.geometry.morphAttributes).length) return false;
    for (let p = o; p && p !== scene; p = p.parent) if (marked(p)) return false;
    if (!safeMatrix(o.matrixWorld)) return false; // batching normals require orthogonal basis columns and preserved winding.
    if (!(Array.isArray(o.material) ? o.material : [o.material]).every(opaque)) return false;
    for (const a of Object.values(o.geometry.attributes)) if (a.isInstancedBufferAttribute ||
      (a.data?.usage ?? a.usage) === THREE.DynamicDrawUsage || (a.data?.usage ?? a.usage) === THREE.StreamDrawUsage) return false;
    return !o.customDepthMaterial && !o.customDistanceMaterial;
  }
  function geometryKey(g) {
    const cached = geometryKeys.get(g);
    if (cached?.frame === materialFrame) return cached.key;
    const key = Object.entries(g.attributes).sort(([a], [b]) => a.localeCompare(b)).map(([key, a]) =>
      `${key}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${a.gpuType}`).join(',');
    geometryKeys.set(g, { frame: materialFrame, key }); return key;
  }
  function attributeVersion(a) {
    return `${id(a)}:${id(a.data || a)}:${id(a.array)}:${a.data?.version ?? a.version}:${a.itemSize}:${a.normalized}:${a.gpuType}:${a.count}:${a.offset}:${a.data?.stride}`;
  }
  function geometryVersion(g) {
    // Identity matters independently of version: replacing an index/attribute
    // with another fresh version-zero buffer must rebuild copied GPU triangles.
    let version = `${id(g)}:${g.index ? attributeVersion(g.index) : 'none'}:${g.drawRange.start}:${g.drawRange.count}`;
    for (const [key, a] of Object.entries(g.attributes)) version += `:${key}:${attributeVersion(a)}`;
    for (const p of g.groups) version += `:${p.start},${p.count},${p.materialIndex}`;
    return version;
  }
  function describe(o) {
    describedCount++;
    const g = o.geometry, size = g.index?.count ?? g.attributes.position.count;
    const start = Math.max(0, g.drawRange.start), end = Math.min(size, start + g.drawRange.count);
    const ranges = new Map();
    const add = (m, from, count) => {
      const lo = Math.max(start, from), hi = Math.min(end, from + count);
      if (hi <= lo || !m) return;
      if (!ranges.has(m)) ranges.set(m, []);
      ranges.get(m).push([lo, hi - lo]);
    };
    if (Array.isArray(o.material)) for (const p of g.groups) add(o.material[p.materialIndex], p.start, p.count);
    else add(o.material, start, end - start);
    const source = { object: o, geometry: g, material: o.material, materials: Array.isArray(o.material) ? [...o.material] : null, ecoMode,
      version: geometryVersion(g), entries: [], matrix: new THREE.Matrix4(), matrixValid: false, matrixSafe: true,
      guard: geometryGuard(g), savedVisible: true,
      cast: o.castShadow, receive: o.receiveShadow, layers: o.layers.mask, order: o.renderOrder };
    const layout = source.layout = geometryKey(g);
    for (const [material, parts] of ranges) {
      const whole = parts.length === 1 && parts[0][0] === 0 && parts[0][1] === size;
      const indexed = !!g.index || !whole;
      const semantic = semanticKey(material);
      const key = `${semantic == null ? 'material:' + id(material) : 'semantic:' + semantic}|${layout}|${indexed}|${o.castShadow}|${o.receiveShadow}|${o.layers.mask}|${o.renderOrder}`;
      source.entries.push({ source, material, semantic, flat: ecoMode && ecoMaterialEligible(THREE, material), parts, whole, indexed, key,
        viewKey: `${source.version}|${parts.map(p => p.join(',')).join(';')}`,
        indexCount: indexed ? parts.reduce((n, p) => n + p[1], 0) : 0, draws: parts.length });
    }
    return source;
  }
  function descriptionCurrent(source, object) {
    if (source.ecoMode !== ecoMode || object.geometry !== source.geometry || !geometryCurrent(source.guard) || geometryKey(object.geometry) !== source.layout ||
      object.material !== source.material || object.castShadow !== source.cast || object.receiveShadow !== source.receive ||
      object.layers.mask !== source.layers || object.renderOrder !== source.order) return false;
    if (source.materials) {
      if (object.material.length !== source.materials.length) return false;
      for (let i = 0; i < source.materials.length; i++) if (object.material[i] !== source.materials[i]) return false;
    }
    // Uniform edits need not bump Material.version. Check the same complete
    // semantics as the draw guard, including transitions to/from identity keys.
    for (const entry of source.entries) if (semanticKey(entry.material) !== entry.semantic) return false;
    return true;
  }
  function viewGeometry(entry) {
    const original = entry.source.geometry;
    if (entry.whole) return original;
    // Temporary view shares read-only attributes. BatchedMesh copies them; the
    // authored index/groups (including faceSlots and network IDs) never change.
    const view = new THREE.BufferGeometry();
    for (const [key, a] of Object.entries(original.attributes)) view.setAttribute(key, a);
    const indices = new (original.attributes.position.count > 65535 ? Uint32Array : Uint16Array)(entry.indexCount);
    let at = 0;
    for (const [from, count] of entry.parts) for (let i = from; i < from + count; i++)
      indices[at++] = original.index ? original.index.getX(i) : i;
    view.setIndex(new THREE.BufferAttribute(indices, 1)); return view;
  }
  function release(group) { group.dead = true; group.mesh.removeFromParent(); group.mesh.dispose(); if (group.ownedMaterial) group.mesh.material.dispose(); vertices -= group.vertices; }
  function compile(group) {
    if (lost || disposed || group.dead || group.pending || group.ready || group.failed || performance.now() < group.retryAt || !camera || group.requiresLighting && !group.mesh.material.userData.roomLightingPatched) return;
    group.pending = true;
    const material = group.mesh.material, version = material.version, epoch = compileEpoch;
    // compile traverses hidden objects. Use the complete scene for its lights/GI.
    let promise;
    try { promise = warmRasterPrograms(renderer, group.mesh, camera, scene,
      { cancelled: () => disposed || group.dead || lost || epoch !== compileEpoch || material.version !== version }); }
    catch { group.ready = false; group.pending = false; group.failed = true; return; }
    Promise.resolve(promise).then(ready => {
      if (!disposed && !group.dead && !lost && epoch === compileEpoch && material.version === version) {
        group.ready = ready === true;
        // false includes a transient currentProgram replacement by a GI/probe
        // or raster compile, but also a real compile failure/timeout. Bound both
        // retry rate and attempts so an unusable program cannot block startup.
        group.compileFailures = ready === true ? 0 : group.compileFailures + 1;
        group.failed = group.compileFailures >= MAX_COMPILE_ATTEMPTS;
        group.retryAt = ready === true ? 0 : performance.now() + COMPILE_RETRY_MS;
      }
    }).catch(() => { if (!group.dead && epoch === compileEpoch) { group.ready = false; group.failed = true; } })
      .finally(() => { if (epoch === compileEpoch) group.pending = false; });
  }
  function build(key, entries, signature) {
    const views = new Map(); let vertexCount = 0, indexCount = 0;
    for (const e of entries) if (!views.has(e.viewKey)) {
      views.set(e.viewKey, null); vertexCount += e.source.geometry.attributes.position.count; indexCount += e.indexCount;
    }
    if (vertices + vertexCount > MAX_VERTICES) return null;
    const first = entries[0], o = first.source.object;
    const useColor = first.semantic != null, requiresLighting = useColor && !!first.material.userData.roomLightingPatched;
    // Eco owns a Lambert material from the outset. Merging distinct authored
    // PBRs before a Lambert substitute is warm would render the wrong fallback.
    const material = first.flat ? createEcoMaterial(THREE, first.material, true) : useColor ? first.material.clone() : first.material;
    if (useColor && !first.flat) {
      material.color.setRGB(1, 1, 1);
      // Material.clone deliberately restores default hooks. Let lighting.patch
      // wrap the new material once on its next update, before compilation/use.
      delete material.userData.roomLightingPatched; delete material.userData.roomLightingBatchSafe;
    }
    const mesh = new THREE.BatchedMesh(entries.length, vertexCount, Math.max(1, indexCount), material);
    mesh.name = 'raster_batch'; mesh.visible = false; mesh.frustumCulled = false;
    mesh.castShadow = o.castShadow; mesh.receiveShadow = o.receiveShadow; mesh.layers.mask = o.layers.mask; mesh.renderOrder = o.renderOrder;
    Object.assign(mesh.userData, { networkEntity: true, rasterOnly: true, noPick: true, noNetwork: true }); mesh.raycast = () => {};
    const group = { mesh, signature, entries, vertices: vertexCount, ready: false, pending: false, dead: false,
      materialVersion: material.version, useColor, requiresLighting, ownedMaterial: useColor, ecoMode, flat: first.flat, retryAt: 0, compileFailures: 0 };
    try {
      for (const entry of entries) {
        let geometryId = views.get(entry.viewKey);
        if (geometryId == null) {
          const view = viewGeometry(entry); geometryId = mesh.addGeometry(view); views.set(entry.viewKey, geometryId);
          if (view !== entry.source.geometry) view.dispose();
        }
        entry.instance = mesh.addInstance(geometryId); entry.group = group;
        entry.lastVisible = true;
        mesh.setMatrixAt(entry.instance, entry.source.object.matrixWorld);
        if (useColor) { mesh.setColorAt(entry.instance, entry.material.color); entry.lastColor = entry.material.color.clone(); }
      }
      // r169 initializes combined BufferAttributes without copying gpuType.
      // The group layout guarantees the same type for every source attribute.
      for (const [key, attribute] of Object.entries(o.geometry.attributes)) if (attribute.gpuType !== undefined)
        mesh.geometry.attributes[key].gpuType = attribute.gpuType;
    } catch { mesh.dispose(); if (useColor) material.dispose(); return null; }
    root.add(mesh); vertices += vertexCount; rebuilds++; compile(group); return group;
  }
  function discover() {
    materialFrame++;
    if (!root.parent) scene.add(root);
    scene.updateMatrixWorld();
    const previous = descriptions;
    descriptions = new Map();
    const next = [], candidates = new Map();
    function visit(o) {
      if (o === root || marked(o)) return;
      if (eligible(o)) {
        const before = previous.get(o), reuse = before && descriptionCurrent(before, o);
        const s = reuse ? before : describe(o);
        if (reuse) reusedCount++;
        else if (before && before.geometry === s.geometry && before.version === s.version && before.material === s.material) {
          s.matrix.copy(before.matrix); s.matrixValid = before.matrixValid; s.matrixSafe = before.matrixSafe;
        }
        descriptions.set(o, s);
        if (s.entries.length) next.push(s);
      }
      for (const child of o.children) visit(child);
    }
    visit(scene);
    for (const s of next) for (const e of s.entries) {
      if (!candidates.has(e.key)) candidates.set(e.key, []); candidates.get(e.key).push(e);
    }
    // A source is replaced completely, including any small material group, so a
    // multi-material wall can never be half-proxied and drawn twice.
    sources = next.filter(s => s.entries.some(e => candidates.get(e.key).length > 1 || e.draws > 1));
    const wanted = new Map();
    for (const s of sources) for (const e of s.entries) { if (!wanted.has(e.key)) wanted.set(e.key, []); wanted.get(e.key).push(e); }
    for (const [key, old] of groups) {
      const entries = wanted.get(key), signature = entries?.map(e => `${id(e.source.object)}:${e.viewKey}`).join('|');
      if (signature !== old.signature) { release(old); groups.delete(key); }
    }
    for (const [key, entries] of wanted) {
      let group = groups.get(key);
      if (!group) {
        group = build(key, entries, entries.map(e => `${id(e.source.object)}:${e.viewKey}`).join('|'));
        if (group) groups.set(key, group);
      } else {
        const before = group.entries;
        group.entries = entries; group.ecoMode = ecoMode;
        // Signature equality guarantees stable geometry/instance order.
        entries.forEach((e, i) => { e.group = group; e.instance = i; e.lastColor = before[i].lastColor; e.lastVisible = before[i].lastVisible; });
      }
    }
    lastScan = performance.now(); dirty = false;
  }
  function update(nextCamera) {
    if (disposed || !supported) return;
    if (nextCamera) camera = nextCamera;
    if (dirty || performance.now() - lastScan >= SCAN_MS) discover();
    for (const group of groups.values()) {
      if (group.materialVersion !== group.mesh.material.version) {
        group.materialVersion = group.mesh.material.version; group.ready = false; group.failed = false; group.retryAt = group.compileFailures = 0;
      }
      if (!group.failed) compile(group);
    }
  }
  function draw(fn, options) {
    if (disposed || lost || !supported || depth || !sources.length) return fn();
    hidden.length = shown.length = collapsed.length = 0;
    const auto = scene.matrixWorldAutoUpdate;
    materialFrame++;
    if (auto && !options?.matricesCurrent) scene.updateMatrixWorld();
    depth++;
    try {
      for (const source of sources) {
        const o = source.object;
        const chain = chainState(o), visible = !!(chain & 2);
        let materialSame = o.material === source.material;
        if (materialSame && source.materials) {
          materialSame = o.material.length === source.materials.length;
          if (materialSame) for (let i = 0; i < source.materials.length; i++) if (o.material[i] !== source.materials[i]) { materialSame = false; break; }
        }
        const g = source.geometry, moved = !source.matrixValid || !source.matrix.equals(o.matrixWorld);
        if (moved) source.matrixSafe = safeMatrix(o.matrixWorld);
        const geometrySame = o.geometry === g && geometryCurrent(source.guard);
        let materialsOpaque = materialSame;
        if (materialsOpaque && source.materials) {
          for (let i = 0; i < source.materials.length; i++) if (!opaqueCurrent(source.materials[i])) { materialsOpaque = false; break; }
        } else if (materialsOpaque) materialsOpaque = opaqueCurrent(o.material);
        const valid = (chain & 5) === 1 && !o.children.length && o.frustumCulled !== false && materialSame && geometrySame && plainCallbacks(o) &&
          !o.customDepthMaterial && !o.customDistanceMaterial && !o.morphTargetInfluences?.length && materialsOpaque &&
          o.castShadow === source.cast && o.receiveShadow === source.receive && o.layers.mask === source.layers && o.renderOrder === source.order &&
          source.matrixSafe;
        if (!valid) dirty = true;
        let ready = valid, equivalent = true;
        for (let i = 0; i < source.entries.length; i++) {
          const e = source.entries[i];
          if (!e.group?.ready || e.group.dead || e.group.ecoMode !== ecoMode) ready = false;
          if (e.semantic != null) {
            const cached = materialKeys.get(e.material);
            if ((cached?.frame === materialFrame ? cached.key : semanticKey(e.material)) !== e.semantic) equivalent = false;
          }
        }
        if (!equivalent) dirty = true;
        const replace = ready && equivalent;
        for (const entry of source.entries) if (entry.group && !entry.group.dead) {
          const batch = entry.group.mesh, nextVisible = replace && visible;
          if (entry.lastVisible !== nextVisible) { batch.setVisibleAt(entry.instance, nextVisible); entry.lastVisible = nextVisible; }
          if (moved) batch.setMatrixAt(entry.instance, o.matrixWorld);
          if (entry.group.useColor && !entry.lastColor.equals(entry.material.color)) {
            batch.setColorAt(entry.instance, entry.material.color); entry.lastColor.copy(entry.material.color);
          }
        }
        if (moved) { source.matrix.copy(o.matrixWorld); source.matrixValid = true; }
        if (replace) { source.savedVisible = o.visible; hidden.push(source); o.visible = false; }
      }
      for (let i = 0; i < hidden.length; i++) collapseParents(hidden[i].object.parent);
      for (const group of groups.values()) if (group.ready && group.ecoMode === ecoMode) { shown.push(group.mesh); group.mesh.visible = true; }
      root.visible = true;
      // Matrices are current (updated here or supplied by the caller); avoid a
      // second authored-hierarchy walk in renderer.render, including mirrors.
      scene.matrixWorldAutoUpdate = false;
      return fn();
    } finally {
      scene.matrixWorldAutoUpdate = auto; root.visible = false;
      for (const mesh of shown) mesh.visible = false;
      for (const object of collapsed) object.visible = true;
      for (const source of hidden) source.object.visible = source.savedVisible;
      hidden.length = shown.length = collapsed.length = 0;
      depth--;
    }
  }
  function setQuality(name) {
    const next = name === 'eco';
    if (next === ecoMode) return;
    ecoMode = next; materialFrame++; dirty = true;
  }
  function resetPrograms() {
    compileEpoch++;
    for (const group of groups.values()) {
      group.ready = group.pending = group.failed = false;
      group.retryAt = group.compileFailures = 0;
      group.mesh.material.needsUpdate = true;
    }
  }
  const onLost = () => { lost = true; resetPrograms(); }, onRestored = () => { lost = false; resetPrograms(); };
  renderer.domElement?.addEventListener?.('webglcontextlost', onLost);
  renderer.domElement?.addEventListener?.('webglcontextrestored', onRestored);
  return {
    update, draw, setQuality,
    get stats() { return { supported, sources: sources.length, groups: groups.size, ready: [...groups.values()].filter(g => g.ready).length,
      failed: [...groups.values()].filter(g => g.failed).length,
      vertices, maxVertices: MAX_VERTICES, rebuilds, descriptions: describedCount, reusedDescriptions: reusedCount,
      representation: ecoMode ? 'eco' : 'pbr', lambertGroups: [...groups.values()].filter(g => g.flat).length }; },
    dispose() { if (disposed) return; disposed = true; compileEpoch++; for (const group of groups.values()) release(group); groups.clear(); sources = []; descriptions.clear(); root.removeFromParent();
      renderer.domElement?.removeEventListener?.('webglcontextlost', onLost); renderer.domElement?.removeEventListener?.('webglcontextrestored', onRestored); },
  };
}
